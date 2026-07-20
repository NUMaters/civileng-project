import { loadRules, loadStructures } from "@civilcraft/game-data/load";
import type { StructureEffects } from "@civilcraft/game-data/types";
import type { PlacedStructure } from "../../construction";
import { getStructureEffectLabel } from "../../construction/structureVisuals";
import { calculateFloodplainExtent } from "./floodplainExtent";
import {
  calculateHydraulicEffectiveness,
  getRiverPlacementContext,
  protectionHeadingBonus,
} from "./hydraulicPlacement";
import {
  applyOverflowTerrainElevations,
  listOverflowCandidates,
  resolveCandidateVulnerability,
} from "./overflowBankSites";

export type GamePhase = "idle" | "preparation" | "disaster" | "result";

/** 局所越水地点（岸から市街地側へ水が溢れるポイント）。 */
export type OverflowSite = {
  id: string;
  longitude: number;
  latitude: number;
  /** 流出方向（度、北=0・時計回り）。 */
  outflowHeadingDegrees: number;
  /** 0〜1。越水量・標高弱点・防護施設で決まる。 */
  intensity: number;
};

/** 弱点地点の防護状態（施設効果の可視化用）。 */
export type ProtectedBankSite = {
  id: string;
  longitude: number;
  latitude: number;
  /** 0〜1。施設による抑え込みの強さ。 */
  protectionStrength: number;
  /** true なら越水プルームが出ている。false なら施設が抑え込み中。 */
  overflowing: boolean;
};

/** 施設1基の川への影響範囲（地図表示用）。 */
export type StructureInfluence = {
  placementId: string;
  structureId: string;
  longitude: number;
  latitude: number;
  radiusMeters: number;
  /** 短い効果ラベル。 */
  effectLabel: string;
  /** 位置・向き・標高から見た配置有効率 0〜1。 */
  effectiveness: number;
};

export type FloodSimulationState = {
  phase: GamePhase;
  phaseRemainingSeconds: number;
  disasterElapsedSeconds: number;
  rainfallIntensity: number;
  riverLevelMeters: number;
  /** 計画高水位を超えた分（m）。0 なら越水なし。 */
  overflowMeters: number;
  /** 施設込みの越水開始水位（m）。 */
  overflowLevelMeters: number;
  floodDepthMeters: number;
  floodedAreaPercent: number;
  /** 氾濫寸前〜越水時の氾濫原の塗りつぶし率（0〜1）。通常水位では 0。 */
  floodplainFillRatio: number;
  /** 描画・判定用の氾濫原片岸幅（m）。 */
  floodplainHalfWidthMeters: number;
  damagePercent: number;
  score: number;
  isClear: boolean | null;
  overflowSites: OverflowSite[];
  /** 施設による治水効果の集計。 */
  mitigation: MitigationSummary;
  /** 弱点地点ごとの防護／越水状態。 */
  protectedBankSites: ProtectedBankSite[];
  /** 確定配置の影響圏。 */
  structureInfluences: StructureInfluence[];
};

export type MitigationSummary = StructureEffects & {
  activeStructureCount: number;
  /** 配置有効率の平均 0〜1。 */
  averageEffectiveness: number;
};

const rules = loadRules();
const structureById = new Map(loadStructures().map((structure) => [structure.id, structure]));

const INITIAL_RIVER_LEVEL_METERS = 2.2;
const BASE_OVERFLOW_LEVEL_METERS = 4.9;

export { applyOverflowTerrainElevations };

export function createInitialFloodState(): FloodSimulationState {
  return {
    phase: "idle",
    phaseRemainingSeconds: rules.timing.phases.preparationSeconds,
    disasterElapsedSeconds: 0,
    rainfallIntensity: 0,
    riverLevelMeters: INITIAL_RIVER_LEVEL_METERS,
    overflowMeters: 0,
    overflowLevelMeters: BASE_OVERFLOW_LEVEL_METERS,
    floodDepthMeters: 0,
    floodedAreaPercent: 0,
    floodplainFillRatio: 0,
    floodplainHalfWidthMeters: 0,
    damagePercent: 0,
    score: 1_000,
    isClear: null,
    overflowSites: [],
    mitigation: emptyMitigation(),
    protectedBankSites: [],
    structureInfluences: [],
  };
}

function emptyMitigation(): MitigationSummary {
  return {
    waterLevelReduction: 0,
    overflowPrevention: 0,
    drainageCapacity: 0,
    bankProtection: 0,
    channelCapacityIncrease: 0,
    activeStructureCount: 0,
    averageEffectiveness: 0,
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
  const overflowLevelMeters =
    BASE_OVERFLOW_LEVEL_METERS +
    mitigation.overflowPrevention * 1.8 +
    mitigation.channelCapacityIncrease * 1.1;
  const overflowMeters = Math.max(0, riverLevelMeters - overflowLevelMeters);
  const inflowPerSecond = overflowMeters * (1 - mitigation.overflowPrevention * 0.35) * 0.045;
  const drainagePerSecond = mitigation.drainageCapacity * 0.025;
  const floodDepthMeters = Math.max(
    0,
    current.floodDepthMeters + (inflowPerSecond - drainagePerSecond) * deltaSeconds,
  );
  const bankEffects = calculateBankEffects(placements, overflowMeters, floodDepthMeters);
  // 浸水面積は水深＋主要な決壊（強度上位）に依存。弱点を押さえると広がらない。
  const breachLoad = bankEffects.overflowSites
    .slice(0, 5)
    .reduce((sum, site) => sum + site.intensity, 0);
  const floodedAreaPercent = clamp(
    floodDepthMeters * 22 + Math.min(2.2, breachLoad) * 14 + Math.max(0, overflowMeters) * 5,
    0,
    100,
  );
  const damagePercent = clamp(
    floodedAreaPercent *
      (1 - mitigation.bankProtection * 0.4) *
      (1 - Math.min(0.35, bankEffects.protectedBankSites.filter((s) => !s.overflowing).length * 0.04)),
    0,
    100,
  );
  const floodplain = calculateFloodplainExtent({
    riverLevelMeters,
    overflowMeters,
    overflowLevelMeters,
  });
  const score = Math.max(
    0,
    Math.round(
      1_000 -
        damagePercent * 9 -
        floodDepthMeters * 40 +
        mitigation.activeStructureCount * 8 +
        mitigation.averageEffectiveness * 40,
    ),
  );
  const remaining = Math.max(0, rules.timing.phases.disasterSeconds - elapsed);
  const structureInfluences = calculateStructureInfluences(placements);

  if (remaining === 0) {
    return {
      phase: "result",
      phaseRemainingSeconds: rules.timing.phases.resultSeconds,
      disasterElapsedSeconds: elapsed,
      rainfallIntensity: 0,
      riverLevelMeters,
      overflowMeters,
      overflowLevelMeters,
      floodDepthMeters,
      floodedAreaPercent,
      floodplainFillRatio: floodplain.fillRatio,
      floodplainHalfWidthMeters: floodplain.halfWidthMeters,
      damagePercent,
      score,
      isClear: damagePercent < rules.victory.clearThresholdPercent,
      overflowSites: bankEffects.overflowSites,
      mitigation,
      protectedBankSites: bankEffects.protectedBankSites,
      structureInfluences,
    };
  }

  return {
    phase: "disaster",
    phaseRemainingSeconds: remaining,
    disasterElapsedSeconds: elapsed,
    rainfallIntensity,
    riverLevelMeters,
    overflowMeters,
    overflowLevelMeters,
    floodDepthMeters,
    floodedAreaPercent,
    floodplainFillRatio: floodplain.fillRatio,
    floodplainHalfWidthMeters: floodplain.halfWidthMeters,
    damagePercent,
    score,
    isClear: null,
    overflowSites: bankEffects.overflowSites,
    mitigation,
    protectedBankSites: bankEffects.protectedBankSites,
    structureInfluences,
  };
}

/** 準備フェーズなど、配置変更だけで治水表示を更新する。 */
export function refreshPlacementEffects(
  current: FloodSimulationState,
  placements: PlacedStructure[],
): FloodSimulationState {
  const mitigation = calculateMitigation(placements);
  const bankEffects = calculateBankEffects(
    placements,
    current.overflowMeters,
    current.floodDepthMeters,
  );
  return {
    ...current,
    mitigation,
    overflowSites: bankEffects.overflowSites,
    protectedBankSites: bankEffects.protectedBankSites,
    structureInfluences: calculateStructureInfluences(placements),
  };
}

/** 越水量と施設配置から、岸の局所流出地点を算出する。 */
export function calculateOverflowSites(
  placements: PlacedStructure[],
  overflowMeters: number,
  floodDepthMeters: number,
): OverflowSite[] {
  return calculateBankEffects(placements, overflowMeters, floodDepthMeters).overflowSites;
}

function calculateBankEffects(
  placements: PlacedStructure[],
  overflowMeters: number,
  floodDepthMeters: number,
): { overflowSites: OverflowSite[]; protectedBankSites: ProtectedBankSite[] } {
  const protective = placements.filter(
    (placement) =>
      placement.preview !== true &&
      (placement.structureId === "levee" ||
        placement.structureId === "revetment" ||
        placement.structureId === "retention-basin"),
  );

  const basePressure = clamp(overflowMeters / 1.8 + floodDepthMeters * 0.55, 0, 1.4);
  const overflowSites: OverflowSite[] = [];
  const protectedBankSites: ProtectedBankSite[] = [];

  for (const candidate of listOverflowCandidates()) {
    const vulnerability = resolveCandidateVulnerability(candidate);
    let protection = 0;
    for (const placement of protective) {
      const distance = distanceInMeters(
        placement.position.longitude,
        placement.position.latitude,
        candidate.longitude,
        candidate.latitude,
      );
      const coverageRadius =
        placement.structureId === "levee"
          ? 280
          : placement.structureId === "revetment"
            ? 220
            : 360;
      const coverage =
        Math.exp(-distance / coverageRadius) *
        (placement.structureId === "retention-basin" ? 0.7 : 0.85) *
        protectionHeadingBonus(placement, candidate.outflowHeadingDegrees) *
        calculateHydraulicEffectiveness(placement);
      protection = combineProtection(protection, coverage);
    }

    const intensity =
      overflowMeters <= 0.02 && floodDepthMeters <= 0.01
        ? 0
        : clamp(
            (basePressure * vulnerability - protection * 1.2) * (0.55 + basePressure * 0.5),
            0,
            1,
          );
    const overflowing = intensity >= 0.08;

    if (overflowing) {
      overflowSites.push({
        id: candidate.id,
        longitude: candidate.longitude,
        latitude: candidate.latitude,
        outflowHeadingDegrees: candidate.outflowHeadingDegrees,
        intensity,
      });
    }

    if (protection >= 0.12 || overflowing) {
      protectedBankSites.push({
        id: candidate.id,
        longitude: candidate.longitude,
        latitude: candidate.latitude,
        protectionStrength: clamp(protection, 0, 1),
        overflowing,
      });
    }
  }

  overflowSites.sort((left, right) => right.intensity - left.intensity);
  return { overflowSites, protectedBankSites };
}

/** 施設ごとの川への影響半径（可視化・説明用）。 */
export function getStructureInfluenceRadiusMeters(structureId: string): number {
  switch (structureId) {
    case "levee":
      return 280;
    case "revetment":
      return 220;
    case "retention-basin":
      return 360;
    case "drainage-pump":
      return 200;
    case "channel-dredging":
      return 420;
    default:
      return 180;
  }
}

export { getStructureEffectLabel, getRiverPlacementContext };

export function calculateStructureInfluences(
  placements: PlacedStructure[],
): StructureInfluence[] {
  return placements
    .filter((placement) => placement.preview !== true)
    .map((placement) => {
      const effectiveness = calculatePlacementEffectiveness(placement);
      return {
        placementId: placement.id,
        structureId: placement.structureId,
        longitude: placement.position.longitude,
        latitude: placement.position.latitude,
        radiusMeters: getStructureInfluenceRadiusMeters(placement.structureId) * (0.7 + 0.3 * effectiveness),
        effectLabel: getStructureEffectLabel(placement.structureId),
        effectiveness,
      };
    });
}

export function calculateMitigation(placements: PlacedStructure[]): MitigationSummary {
  const combined: MitigationSummary = {
    waterLevelReduction: 0,
    overflowPrevention: 0,
    drainageCapacity: 0,
    bankProtection: 0,
    channelCapacityIncrease: 0,
    activeStructureCount: 0,
    averageEffectiveness: 0,
  };

  let effectivenessSum = 0;

  for (const placement of placements) {
    if (placement.preview === true) {
      continue;
    }
    const definition = structureById.get(placement.structureId);
    if (definition === undefined) {
      continue;
    }
    const effectiveness = calculatePlacementEffectiveness(placement);
    effectivenessSum += effectiveness;
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
    combined.channelCapacityIncrease +=
      definition.effects.channelCapacityIncrease * effectiveness;
    combined.activeStructureCount += 1;
  }

  return {
    ...combined,
    waterLevelReduction: clamp(combined.waterLevelReduction, 0, 0.65),
    overflowPrevention: clamp(combined.overflowPrevention, 0, 0.95),
    drainageCapacity: clamp(combined.drainageCapacity, 0, 2),
    bankProtection: clamp(combined.bankProtection, 0, 0.95),
    channelCapacityIncrease: clamp(combined.channelCapacityIncrease, 0, 1.5),
    averageEffectiveness:
      combined.activeStructureCount > 0
        ? effectivenessSum / combined.activeStructureCount
        : 0,
  };
}

/**
 * 公開: テストと HUD 用。位置・向き・標高・弱点近接を織り込む。
 */
export function calculatePlacementEffectiveness(placement: PlacedStructure): number {
  const hydraulic = calculateHydraulicEffectiveness(placement);
  const weaknessBoost = nearestWeaknessBoost(placement);
  const combined = hydraulic * 0.82 + weaknessBoost * 0.18;
  if (!Number.isFinite(combined)) {
    return 0.35;
  }
  return clamp(combined, 0.15, 1);
}

function nearestWeaknessBoost(placement: PlacedStructure): number {
  let best = 0;
  for (const candidate of listOverflowCandidates()) {
    const distance = distanceInMeters(
      placement.position.longitude,
      placement.position.latitude,
      candidate.longitude,
      candidate.latitude,
    );
    const vulnerability = resolveCandidateVulnerability(candidate);
    const cover = Math.exp(-distance / 320) * vulnerability;
    best = Math.max(best, cover);
  }
  return clamp(best, 0, 1);
}

function calculateRainfallIntensity(progress: number): number {
  return clamp(0.25 + Math.sin(progress * Math.PI) * 0.75, 0, 1);
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
