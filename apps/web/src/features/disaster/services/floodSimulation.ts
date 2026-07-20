import { loadRules, loadStructures } from "@civilcraft/game-data/load";
import type { StructureEffects } from "@civilcraft/game-data/types";
import type { PlacedStructure } from "../../construction";

export type GamePhase = "idle" | "preparation" | "disaster" | "result";

/** 局所越水地点（岸から市街地側へ水が溢れるポイント）。 */
export type OverflowSite = {
  id: string;
  longitude: number;
  latitude: number;
  /** 流出方向（度、北=0・時計回り）。 */
  outflowHeadingDegrees: number;
  /** 0〜1。越水量と防護施設の近さで決まる。 */
  intensity: number;
};

export type FloodSimulationState = {
  phase: GamePhase;
  phaseRemainingSeconds: number;
  disasterElapsedSeconds: number;
  rainfallIntensity: number;
  riverLevelMeters: number;
  /** 計画高水位を超えた分（m）。0 なら越水なし。 */
  overflowMeters: number;
  floodDepthMeters: number;
  floodedAreaPercent: number;
  damagePercent: number;
  score: number;
  isClear: boolean | null;
  overflowSites: OverflowSite[];
};

export type MitigationSummary = StructureEffects & {
  activeStructureCount: number;
};

const rules = loadRules();
const structureById = new Map(loadStructures().map((structure) => [structure.id, structure]));

const INITIAL_RIVER_LEVEL_METERS = 2.2;
const BASE_OVERFLOW_LEVEL_METERS = 4.9;
const PROTECTION_TARGET = { longitude: 140.3838, latitude: 37.3598 } as const;

/**
 * 局所越水の候補地点（阿武隈川右岸寄り・工学部周辺の弱点）。
 * 近くに堤防・護岸があると intensity が下がる。
 */
const OVERFLOW_CANDIDATES: ReadonlyArray<{
  id: string;
  longitude: number;
  latitude: number;
  outflowHeadingDegrees: number;
  vulnerability: number;
}> = [
  {
    id: "campus-south",
    longitude: 140.3826,
    latitude: 37.3584,
    outflowHeadingDegrees: 95,
    vulnerability: 1,
  },
  {
    id: "campus-core",
    longitude: 140.3842,
    latitude: 37.3602,
    outflowHeadingDegrees: 110,
    vulnerability: 1.15,
  },
  {
    id: "campus-north",
    longitude: 140.3854,
    latitude: 37.3638,
    outflowHeadingDegrees: 85,
    vulnerability: 0.9,
  },
  {
    id: "mid-east",
    longitude: 140.3792,
    latitude: 37.3568,
    outflowHeadingDegrees: 100,
    vulnerability: 0.75,
  },
  {
    id: "north-bend",
    longitude: 140.3888,
    latitude: 37.3724,
    outflowHeadingDegrees: 70,
    vulnerability: 0.7,
  },
];

export function createInitialFloodState(): FloodSimulationState {
  return {
    phase: "idle",
    phaseRemainingSeconds: rules.timing.phases.preparationSeconds,
    disasterElapsedSeconds: 0,
    rainfallIntensity: 0,
    riverLevelMeters: INITIAL_RIVER_LEVEL_METERS,
    overflowMeters: 0,
    floodDepthMeters: 0,
    floodedAreaPercent: 0,
    damagePercent: 0,
    score: 1_000,
    isClear: null,
    overflowSites: [],
  };
}

export function beginPreparation(): FloodSimulationState {
  return {
    ...createInitialFloodState(),
    phase: "preparation",
  };
}

export function beginDisaster(current: FloodSimulationState): FloodSimulationState {
  return {
    ...current,
    phase: "disaster",
    phaseRemainingSeconds: rules.timing.phases.disasterSeconds,
    disasterElapsedSeconds: 0,
    rainfallIntensity: 0.2,
  };
}

export function advanceFloodSimulation(
  current: FloodSimulationState,
  placements: PlacedStructure[],
  deltaSeconds = 1,
): FloodSimulationState {
  if (current.phase === "idle" || current.phase === "result") {
    return current;
  }

  if (current.phase === "preparation") {
    const remaining = Math.max(0, current.phaseRemainingSeconds - deltaSeconds);
    if (remaining === 0) {
      return beginDisaster(current);
    }
    return { ...current, phaseRemainingSeconds: remaining };
  }

  const elapsed = Math.min(
    rules.timing.phases.disasterSeconds,
    current.disasterElapsedSeconds + deltaSeconds,
  );
  const progress = elapsed / rules.timing.phases.disasterSeconds;
  const mitigation = calculateMitigation(placements);
  const rainfallIntensity = calculateRainfallIntensity(progress);
  const unmitigatedRiverLevel =
    INITIAL_RIVER_LEVEL_METERS + progress * 4.3 + rainfallIntensity * 0.35;
  const riverLevelMeters = Math.max(
    INITIAL_RIVER_LEVEL_METERS,
    unmitigatedRiverLevel - mitigation.waterLevelReduction * 2.3,
  );
  const overflowLevel =
    BASE_OVERFLOW_LEVEL_METERS +
    mitigation.overflowPrevention * 1.8 +
    mitigation.channelCapacityIncrease * 1.1;
  const overflowMeters = Math.max(0, riverLevelMeters - overflowLevel);
  const inflowPerSecond = overflowMeters * (1 - mitigation.overflowPrevention * 0.35) * 0.045;
  const drainagePerSecond = mitigation.drainageCapacity * 0.025;
  const floodDepthMeters = Math.max(
    0,
    current.floodDepthMeters + (inflowPerSecond - drainagePerSecond) * deltaSeconds,
  );
  const floodedAreaPercent = clamp(floodDepthMeters * 28, 0, 100);
  const damagePercent = clamp(floodedAreaPercent * (1 - mitigation.bankProtection * 0.45), 0, 100);
  const overflowSites = calculateOverflowSites(placements, overflowMeters, floodDepthMeters);
  const score = Math.max(
    0,
    Math.round(
      1_000 - damagePercent * 9 - floodDepthMeters * 40 + mitigation.activeStructureCount * 8,
    ),
  );
  const remaining = Math.max(0, rules.timing.phases.disasterSeconds - elapsed);

  if (remaining === 0) {
    return {
      phase: "result",
      phaseRemainingSeconds: rules.timing.phases.resultSeconds,
      disasterElapsedSeconds: elapsed,
      rainfallIntensity: 0,
      riverLevelMeters,
      overflowMeters,
      floodDepthMeters,
      floodedAreaPercent,
      damagePercent,
      score,
      isClear: damagePercent < rules.victory.clearThresholdPercent,
      overflowSites,
    };
  }

  return {
    phase: "disaster",
    phaseRemainingSeconds: remaining,
    disasterElapsedSeconds: elapsed,
    rainfallIntensity,
    riverLevelMeters,
    overflowMeters,
    floodDepthMeters,
    floodedAreaPercent,
    damagePercent,
    score,
    isClear: null,
    overflowSites,
  };
}

/** 越水量と施設配置から、岸の局所流出地点を算出する。 */
export function calculateOverflowSites(
  placements: PlacedStructure[],
  overflowMeters: number,
  floodDepthMeters: number,
): OverflowSite[] {
  if (overflowMeters <= 0.02 && floodDepthMeters <= 0.01) {
    return [];
  }

  const protective = placements.filter(
    (placement) =>
      placement.structureId === "levee" ||
      placement.structureId === "revetment" ||
      placement.structureId === "retention-basin",
  );

  const basePressure = clamp(overflowMeters / 1.8 + floodDepthMeters * 0.55, 0, 1.4);
  const sites: OverflowSite[] = [];

  for (const candidate of OVERFLOW_CANDIDATES) {
    let protection = 0;
    for (const placement of protective) {
      const distance = distanceInMeters(
        placement.position.longitude,
        placement.position.latitude,
        candidate.longitude,
        candidate.latitude,
      );
      const coverage =
        placement.structureId === "levee"
          ? Math.exp(-distance / 280)
          : placement.structureId === "revetment"
            ? Math.exp(-distance / 220)
            : Math.exp(-distance / 360) * 0.7;
      protection = combineProtection(protection, coverage * 0.85);
    }

    const intensity = clamp(
      (basePressure * candidate.vulnerability - protection * 1.15) * (0.55 + basePressure * 0.5),
      0,
      1,
    );
    if (intensity < 0.08) {
      continue;
    }
    sites.push({
      id: candidate.id,
      longitude: candidate.longitude,
      latitude: candidate.latitude,
      outflowHeadingDegrees: candidate.outflowHeadingDegrees,
      intensity,
    });
  }

  return sites.sort((left, right) => right.intensity - left.intensity);
}

export function calculateMitigation(placements: PlacedStructure[]): MitigationSummary {
  const combined: MitigationSummary = {
    waterLevelReduction: 0,
    overflowPrevention: 0,
    drainageCapacity: 0,
    bankProtection: 0,
    channelCapacityIncrease: 0,
    activeStructureCount: 0,
  };

  for (const placement of placements) {
    const definition = structureById.get(placement.structureId);
    if (definition === undefined) {
      continue;
    }
    const effectiveness = calculatePlacementEffectiveness(placement);
    combined.waterLevelReduction += definition.effects.waterLevelReduction * effectiveness;
    combined.overflowPrevention = combineProtection(
      combined.overflowPrevention,
      definition.effects.overflowPrevention * effectiveness,
    );
    combined.drainageCapacity += definition.effects.drainageCapacity * effectiveness;
    combined.bankProtection = combineProtection(
      combined.bankProtection,
      definition.effects.bankProtection * effectiveness,
    );
    combined.channelCapacityIncrease += definition.effects.channelCapacityIncrease * effectiveness;
    combined.activeStructureCount += 1;
  }

  return {
    ...combined,
    waterLevelReduction: clamp(combined.waterLevelReduction, 0, 0.65),
    overflowPrevention: clamp(combined.overflowPrevention, 0, 0.95),
    drainageCapacity: clamp(combined.drainageCapacity, 0, 2),
    bankProtection: clamp(combined.bankProtection, 0, 0.95),
    channelCapacityIncrease: clamp(combined.channelCapacityIncrease, 0, 1.5),
  };
}

function calculateRainfallIntensity(progress: number): number {
  return clamp(0.25 + Math.sin(progress * Math.PI) * 0.75, 0, 1);
}

function calculatePlacementEffectiveness(placement: PlacedStructure): number {
  const distanceMeters = distanceInMeters(
    placement.position.longitude,
    placement.position.latitude,
    PROTECTION_TARGET.longitude,
    PROTECTION_TARGET.latitude,
  );
  return 0.35 + 0.65 * Math.exp(-distanceMeters / 650);
}

function distanceInMeters(
  longitudeA: number,
  latitudeA: number,
  longitudeB: number,
  latitudeB: number,
): number {
  const latitudeRadians = ((latitudeA + latitudeB) * 0.5 * Math.PI) / 180;
  const eastMeters = (longitudeA - longitudeB) * 111_320 * Math.cos(latitudeRadians);
  const northMeters = (latitudeA - latitudeB) * 110_540;
  return Math.hypot(eastMeters, northMeters);
}

function combineProtection(current: number, addition: number): number {
  return 1 - (1 - current) * (1 - addition);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
