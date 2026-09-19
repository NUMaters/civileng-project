import { loadRules, loadStructures } from "@civilcraft/game-data/load";
import {
  getHazardKindLabel,
  type HazardKind,
  type StructureEffects,
} from "@civilcraft/game-data/types";
import type { PlacedStructure } from "../../construction";
import {
  getStructureEffectLabel,
  getStructureZoneMeaning,
} from "../../construction/structureVisuals";
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
  type OverflowCandidate,
} from "./overflowBankSites";
import { influenceStrengthAt, resolveInfluenceZone, type InfluenceZone } from "./influenceZones";

export type GamePhase = "idle" | "preparation" | "disaster" | "result" | "review";

/** 局所越水／侵食／内水地点。 */
export type OverflowSite = {
  id: string;
  longitude: number;
  latitude: number;
  /** 流出方向（度、北=0・時計回り）。 */
  outflowHeadingDegrees: number;
  /** 0〜1。越水量・標高弱点・防護施設で決まる。 */
  intensity: number;
  /** この地点の主たる災害種別。 */
  primaryHazard: HazardKind;
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
  primaryHazard: HazardKind;
};

/** 施設1基の川への影響範囲（地図表示用）。向きに必ず追従する。 */
export type StructureInfluence = {
  placementId: string;
  structureId: string;
  longitude: number;
  latitude: number;
  /** 影響圏の主軸（施設の向き）。描画・減衰の両方で必須。 */
  headingDegrees: number;
  /** 最大到達の目安（互換・テスト用）。 */
  radiusMeters: number;
  zone: InfluenceZone;
  /** 短い効果ラベル。 */
  effectLabel: string;
  /** 影響圏の形の意味（配置判断用）。 */
  zoneMeaning: string;
  /** 近傍弱点へのカバー状態。 */
  coverageTone: "good" | "warn" | "bad";
  /** プレイヤー向けの短いカバー説明。 */
  coverageHint: string;
  /** 影響圏内で相性の良い弱点 ID。 */
  coveredSiteIds: string[];
  /** 影響圏内で相性が悪く、流入増などの干渉につながる弱点 ID。 */
  adverseSiteIds: string[];
  /** 位置・向き・標高から見た配置有効率 0〜1。 */
  effectiveness: number;
  /** 仮配置のプレビュー影響圏。 */
  preview?: boolean;
};

export type FloodSimulationState = {
  phase: GamePhase;
  phaseRemainingSeconds: number;
  disasterElapsedSeconds: number;
  rainfallIntensity: number;
  /** 天候の目標雨量（0〜1）。現在値はここに向かって補間する。 */
  rainfallTarget: number;
  /** 次の天候変化までの残り秒。 */
  weatherHoldRemaining: number;
  /** 天候乱数の内部状態（再現用シード）。 */
  weatherRng: number;
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

export type BeginDisasterOptions = {
  /** 天候乱数の初期シード。未指定時は毎プレイランダム。 */
  weatherSeed?: number;
};

export type MitigationSummary = StructureEffects & {
  activeStructureCount: number;
  /** 配置有効率の平均 0〜1。 */
  averageEffectiveness: number;
  /**
   * 誤配置・同地点の過密による悪化 0〜1。
   * 流入増・越水開始水位低下に使う（置けば置くほど得、を防ぐ）。
   */
  placementInterference: number;
};

const rules = loadRules();
const structureById = new Map(loadStructures().map((structure) => [structure.id, structure]));

const INITIAL_RIVER_LEVEL_METERS = 2.2;
/** 計画高水位相当。低いほど早く越水し、難易度が上がる。 */
const BASE_OVERFLOW_LEVEL_METERS = 4.72;
/** テスト／デバッグ用の既定天候シード（中庸な雨量推移）。 */
export const DEFAULT_WEATHER_SEED = 42_601;

export { applyOverflowTerrainElevations };

export function createInitialFloodState(): FloodSimulationState {
  return {
    phase: "idle",
    phaseRemainingSeconds: rules.timing.phases.preparationSeconds,
    disasterElapsedSeconds: 0,
    rainfallIntensity: 0,
    rainfallTarget: 0.3,
    weatherHoldRemaining: 0,
    weatherRng: DEFAULT_WEATHER_SEED,
    riverLevelMeters: INITIAL_RIVER_LEVEL_METERS,
    overflowMeters: 0,
    overflowLevelMeters: BASE_OVERFLOW_LEVEL_METERS,
    floodDepthMeters: 0,
    floodedAreaPercent: 0,
    floodplainFillRatio: 0,
    floodplainHalfWidthMeters: 0,
    damagePercent: 0,
    score: 2_000,
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
    placementInterference: 0,
  };
}

export function beginPreparation(): FloodSimulationState {
  return {
    ...createInitialFloodState(),
    phase: "preparation",
  };
}

export function beginDisaster(
  current: FloodSimulationState,
  options: BeginDisasterOptions = {},
): FloodSimulationState {
  const weatherSeed =
    options.weatherSeed ?? (Math.floor(Math.random() * 0x7fff_ffff) || DEFAULT_WEATHER_SEED);
  let weatherRng = weatherSeed >>> 0 || DEFAULT_WEATHER_SEED;
  const first = pickWeatherTarget(0, weatherRng);
  weatherRng = first.weatherRng;
  return {
    ...current,
    phase: "disaster",
    phaseRemainingSeconds: rules.timing.phases.disasterSeconds,
    disasterElapsedSeconds: 0,
    rainfallIntensity: first.rainfallTarget * 0.85,
    rainfallTarget: first.rainfallTarget,
    weatherHoldRemaining: first.holdSeconds,
    weatherRng,
  };
}

/** 結果画面を閉じ、最終状態のまま地図を自由に見られるプレビューへ。 */
export function enterReview(current: FloodSimulationState): FloodSimulationState {
  if (current.phase !== "result" && current.phase !== "review") {
    return current;
  }
  return {
    ...current,
    phase: "review",
    phaseRemainingSeconds: 0,
  };
}

/** 結果サマリーを再度モーダル表示する。 */
export function reopenResult(current: FloodSimulationState): FloodSimulationState {
  if (current.phase !== "review" && current.phase !== "result") {
    return current;
  }
  return {
    ...current,
    phase: "result",
    phaseRemainingSeconds: rules.timing.phases.resultSeconds,
  };
}

export function advanceFloodSimulation(
  current: FloodSimulationState,
  placements: PlacedStructure[],
  deltaSeconds = 1,
): FloodSimulationState {
  if (current.phase === "idle" || current.phase === "result" || current.phase === "review") {
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
  const weather = advanceWeather(current, progress, deltaSeconds);
  const rainfallIntensity = weather.rainfallIntensity;
  // 水位上昇は旧設定よりやや緩め。雨の波と適所混成で緊張感を保つ。
  // 水位は時間経過で確実に上がり、雨の波は揺れ幅。遊水地込みの混成でクリア可能。
  const unmitigatedRiverLevel =
    INITIAL_RIVER_LEVEL_METERS + progress * 4.55 + rainfallIntensity * 0.32;
  const riverLevelMeters = Math.max(
    INITIAL_RIVER_LEVEL_METERS,
    unmitigatedRiverLevel -
      mitigation.waterLevelReduction * 2.6 +
      mitigation.placementInterference * 0.4,
  );
  const overflowLevelMeters = Math.max(
    INITIAL_RIVER_LEVEL_METERS + 0.8,
    BASE_OVERFLOW_LEVEL_METERS +
      mitigation.overflowPrevention * 1.52 +
      mitigation.channelCapacityIncrease * 1.2 -
      mitigation.placementInterference * 0.35,
  );
  const overflowMeters = Math.max(0, riverLevelMeters - overflowLevelMeters);
  const inflowPerSecond =
    overflowMeters *
    (1 - mitigation.overflowPrevention * 0.34) *
    (1 + mitigation.placementInterference * 0.4) *
    0.034;
  const drainagePerSecond = mitigation.drainageCapacity * 0.035;
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
    floodDepthMeters * 17 + Math.min(2.2, breachLoad) * 9.0 + Math.max(0, overflowMeters) * 4.0,
    0,
    100,
  );
  const damagePercent = clamp(
    floodedAreaPercent *
      (1 - mitigation.bankProtection * 0.38) *
      (1 -
        Math.min(0.32, bankEffects.protectedBankSites.filter((s) => !s.overflowing).length * 0.04)),
    0,
    100,
  );
  const floodplain = calculateFloodplainExtent({
    riverLevelMeters,
    overflowMeters,
    overflowLevelMeters,
  });
  // 施設数ボーナスは出さない。配置の質（有効率）と干渉の少なさで加点する。
  const score = Math.max(
    0,
    Math.round(
      2_200 -
        damagePercent * 8 -
        floodDepthMeters * 35 +
        mitigation.averageEffectiveness * 140 -
        mitigation.placementInterference * 90 +
        (1 - rainfallIntensity) * 40,
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
      rainfallTarget: 0,
      weatherHoldRemaining: 0,
      weatherRng: weather.weatherRng,
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
    rainfallTarget: weather.rainfallTarget,
    weatherHoldRemaining: weather.weatherHoldRemaining,
    weatherRng: weather.weatherRng,
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
  const activePlacements = placements.filter((placement) => placement.preview !== true);
  const overflowSites: OverflowSite[] = [];
  const protectedBankSites: ProtectedBankSite[] = [];

  for (const candidate of listOverflowCandidates()) {
    const vulnerability = resolveCandidateVulnerability(candidate);
    const hazardPressure = resolveHazardPressure(
      candidate.primaryHazard,
      overflowMeters,
      floodDepthMeters,
    );
    let protection = 0;
    let erosionStress = 0;

    for (const placement of activePlacements) {
      const contribution = evaluateLocalContribution(placement, candidate);
      if (contribution >= 0) {
        protection = combineProtection(protection, contribution);
      } else {
        // 河道掘削などが侵食点で負の相性になる場合、圧力を押し上げる。
        erosionStress += Math.abs(contribution);
      }
    }

    const intensity =
      hazardPressure <= 0.01
        ? 0
        : clamp(
            (hazardPressure * vulnerability + erosionStress * 0.9 - protection * 1.55) *
              (0.5 + hazardPressure * 0.55),
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
        primaryHazard: candidate.primaryHazard,
      });
    }

    if (protection >= 0.12 || overflowing || erosionStress >= 0.08) {
      protectedBankSites.push({
        id: candidate.id,
        longitude: candidate.longitude,
        latitude: candidate.latitude,
        protectionStrength: clamp(protection, 0, 1),
        overflowing,
        primaryHazard: candidate.primaryHazard,
      });
    }
  }

  overflowSites.sort((left, right) => right.intensity - left.intensity);
  return { overflowSites, protectedBankSites };
}

/**
 * 災害種別ごとの局所圧力。
 * 越水は overflow、侵食は overflow＋水深、内水は水深主導。
 */
function resolveHazardPressure(
  hazard: HazardKind,
  overflowMeters: number,
  floodDepthMeters: number,
): number {
  switch (hazard) {
    case "overtopping":
      return clamp(overflowMeters / 1.6 + floodDepthMeters * 0.15, 0, 1.4);
    case "erosion":
      return clamp(overflowMeters / 2.1 + floodDepthMeters * 0.35, 0, 1.35);
    case "inlandPonding":
      return clamp(floodDepthMeters * 0.95 + Math.max(0, overflowMeters - 0.15) * 0.25, 0, 1.4);
    case "capacityShortage":
      return clamp(overflowMeters / 1.9 + floodDepthMeters * 0.2, 0, 1.2);
    default:
      return clamp(overflowMeters / 1.8 + floodDepthMeters * 0.55, 0, 1.4);
  }
}

/**
 * 施設×弱点種別の局所寄与。相性が低い／負だとほぼ効かない／悪化する。
 */
function evaluateLocalContribution(
  placement: PlacedStructure,
  candidate: OverflowCandidate,
): number {
  const definition = structureById.get(placement.structureId);
  if (definition === undefined) {
    return 0;
  }
  const affinity = definition.hazardAffinity[candidate.primaryHazard] ?? 0;
  if (Math.abs(affinity) < 0.04) {
    return 0;
  }

  const distance = distanceInMeters(
    placement.position.longitude,
    placement.position.latitude,
    candidate.longitude,
    candidate.latitude,
  );
  const zone = resolveInfluenceZone(placement, calculateHydraulicEffectiveness(placement));
  const shapeStrength = influenceStrengthAt(zone, candidate.longitude, candidate.latitude);
  if (shapeStrength < 0.04 && distance > zone.extentMeters * 1.15) {
    return 0;
  }
  const radius = zone.extentMeters;
  const effectWeight = localEffectWeight(definition.effects, candidate.primaryHazard);
  if (effectWeight <= 0.02 && affinity > 0) {
    return 0;
  }

  const heading =
    candidate.primaryHazard === "inlandPonding" || candidate.primaryHazard === "capacityShortage"
      ? 1
      : protectionHeadingBonus(placement, candidate.outflowHeadingDegrees);
  const hydraulic = calculateHydraulicEffectiveness(placement);
  const magnitude =
    shapeStrength *
    Math.exp(-distance / Math.max(radius * 1.8, 80)) *
    Math.abs(affinity) *
    Math.max(effectWeight, affinity < 0 ? 0.7 : 0) *
    heading *
    hydraulic *
    (affinity < 0 ? 1.05 : 0.92);

  return affinity < 0 ? -magnitude : magnitude;
}

function localEffectWeight(effects: StructureEffects, hazard: HazardKind): number {
  switch (hazard) {
    case "overtopping":
      return effects.overflowPrevention;
    case "erosion":
      return effects.bankProtection;
    case "inlandPonding":
      return effects.drainageCapacity;
    case "capacityShortage":
      return Math.max(effects.channelCapacityIncrease, effects.waterLevelReduction);
    default:
      return 0;
  }
}

/** 施設ごとの川への影響半径の目安（最大到達）。 */
export function getStructureInfluenceRadiusMeters(structureId: string): number {
  switch (structureId) {
    case "levee":
      return 200;
    case "revetment":
      return 120;
    case "retention-basin":
      return 300;
    case "drainage-pump":
      return 240;
    case "channel-dredging":
      return 270;
    default:
      return 180;
  }
}

export { getStructureEffectLabel, getStructureZoneMeaning, getRiverPlacementContext };

export function calculateStructureInfluences(placements: PlacedStructure[]): StructureInfluence[] {
  // 仮配置も含める（向き調整中に影響圏が追従して見えるようにする）。
  // 治水効果の数値計算側は preview を除外する。
  return placements.map((placement) => {
    const effectiveness = calculatePlacementEffectiveness(placement);
    const zone = resolveInfluenceZone(placement, effectiveness);
    const coverage = resolveInfluenceCoverage(placement, zone);
    return {
      placementId: placement.id,
      structureId: placement.structureId,
      longitude: placement.position.longitude,
      latitude: placement.position.latitude,
      headingDegrees: zone.headingDegrees,
      radiusMeters: zone.extentMeters,
      zone,
      effectLabel: getStructureEffectLabel(placement.structureId),
      zoneMeaning: getStructureZoneMeaning(placement.structureId),
      coverageTone: coverage.tone,
      coverageHint: coverage.hint,
      coveredSiteIds: coverage.coveredSiteIds,
      adverseSiteIds: coverage.adverseSiteIds,
      effectiveness,
      preview: placement.preview === true,
    };
  });
}

/**
 * 影響圏が近傍の弱点をどうカバーしているかを評価する。
 * 範囲内かつ相性が良い弱点があるほど good。
 */
function resolveInfluenceCoverage(
  placement: PlacedStructure,
  zone: InfluenceZone,
): {
  tone: "good" | "warn" | "bad";
  hint: string;
  coveredSiteIds: string[];
  adverseSiteIds: string[];
} {
  const definition = structureById.get(placement.structureId);
  if (definition === undefined) {
    return {
      tone: "warn",
      hint: "影響範囲を弱点へ合わせる",
      coveredSiteIds: [],
      adverseSiteIds: [],
    };
  }

  let bestGood = 0;
  let bestGoodHazard: HazardKind | null = null;
  let bestMismatch = 0;
  const coveredSiteIds: string[] = [];
  const adverseSiteIds: string[] = [];

  for (const candidate of listOverflowCandidates()) {
    const strength = influenceStrengthAt(zone, candidate.longitude, candidate.latitude);
    if (strength < 0.08) {
      continue;
    }
    const affinity = definition.hazardAffinity[candidate.primaryHazard] ?? 0;
    if (affinity >= 0.35) {
      coveredSiteIds.push(candidate.id);
      const score = affinity * strength;
      if (score > bestGood) {
        bestGood = score;
        bestGoodHazard = candidate.primaryHazard;
      }
    } else if (affinity < 0.15) {
      const mismatch = strength * (affinity < 0 ? 1.2 : 0.7);
      bestMismatch = Math.max(bestMismatch, mismatch);
      if (mismatch >= 0.12) {
        adverseSiteIds.push(candidate.id);
      }
    }
  }

  if (bestGood >= 0.18 && bestGoodHazard !== null) {
    return {
      tone: "good",
      hint: `${getHazardKindLabel(bestGoodHazard)}の弱点をカバー`,
      coveredSiteIds,
      adverseSiteIds,
    };
  }
  if (bestMismatch >= 0.12) {
    return {
      tone: "bad",
      hint: "相性の悪い弱点に当たっている",
      coveredSiteIds,
      adverseSiteIds,
    };
  }
  return {
    tone: "warn",
    hint: "弱点が範囲外 — 位置・向きを調整",
    coveredSiteIds,
    adverseSiteIds,
  };
}

export function calculateMitigation(placements: PlacedStructure[]): MitigationSummary {
  const combined = emptyMitigation();
  let effectivenessSum = 0;
  let interferenceSum = 0;
  const typeCounts = new Map<string, number>();
  /** 弱点地点ごとの防護寄与回数（過密逓減用）。 */
  const coverCounts = new Map<string, number>();

  const active = placements.filter((placement) => placement.preview !== true);

  for (const placement of active) {
    const definition = structureById.get(placement.structureId);
    if (definition === undefined) {
      continue;
    }

    const typeIndex = (typeCounts.get(placement.structureId) ?? 0) + 1;
    typeCounts.set(placement.structureId, typeIndex);
    // 同種を重ねるほど全球寄与を落とす（2基目 70%、3基目以降 40%）。
    const stackScale = typeIndex === 1 ? 1 : typeIndex === 2 ? 0.7 : 0.4;

    const effectiveness = calculatePlacementEffectiveness(placement);
    const roleFit = resolveRoleFit(placement);
    const mismatch = resolveMismatchPenalty(placement);
    interferenceSum += mismatch;

    // 近い弱点への重複カバーも逓減する。
    let siteStackScale = 1;
    const nearest = nearestCandidate(placement);
    if (nearest !== null) {
      const coverIndex = (coverCounts.get(nearest.id) ?? 0) + 1;
      coverCounts.set(nearest.id, coverIndex);
      siteStackScale = coverIndex === 1 ? 1 : coverIndex === 2 ? 0.62 : 0.3;
    }

    const scale = effectiveness * stackScale * siteStackScale * (0.4 + roleFit * 0.6);
    effectivenessSum += effectiveness;

    const effects = definition.effects;
    const affinity = definition.hazardAffinity;
    combined.waterLevelReduction +=
      effects.waterLevelReduction *
      scale *
      affinityGate(affinity.capacityShortage, affinity.overtopping, 0.35);
    combined.overflowPrevention = combineProtection(
      combined.overflowPrevention,
      effects.overflowPrevention * scale * Math.max(0, affinity.overtopping),
    );
    combined.drainageCapacity +=
      effects.drainageCapacity * scale * Math.max(0, affinity.inlandPonding);
    combined.bankProtection = combineProtection(
      combined.bankProtection,
      effects.bankProtection * scale * Math.max(0, affinity.erosion),
    );
    combined.channelCapacityIncrease +=
      effects.channelCapacityIncrease * scale * Math.max(0, affinity.capacityShortage);
    combined.activeStructureCount += 1;
  }

  // 施設が多いほど干渉が残りやすい（スパム抑制）。適所混成の 4〜5 基は許容する。
  const spamPressure = active.length <= 4 ? 0 : clamp((active.length - 4) * 0.07, 0, 0.3);
  const placementInterference = clamp(
    interferenceSum / Math.max(1, active.length) + spamPressure,
    0,
    1,
  );

  return {
    waterLevelReduction: softCap(combined.waterLevelReduction, 0.58, 1.7),
    overflowPrevention: clamp(combined.overflowPrevention, 0, 0.84),
    drainageCapacity: softCap(combined.drainageCapacity, 1.45, 1.35),
    bankProtection: clamp(combined.bankProtection, 0, 0.88),
    channelCapacityIncrease: softCap(combined.channelCapacityIncrease, 1.0, 1.45),
    activeStructureCount: combined.activeStructureCount,
    averageEffectiveness:
      combined.activeStructureCount > 0 ? effectivenessSum / combined.activeStructureCount : 0,
    placementInterference,
  };
}

/** 効果種別が想定する弱点相性。低いと全球寄与が薄くなる。 */
function affinityGate(primary: number, secondary: number, secondaryWeight: number): number {
  return clamp(Math.max(0, primary) + Math.max(0, secondary) * secondaryWeight, 0, 1.15);
}

/**
 * 施設の得意分野と、近傍弱点の一致度 0〜1。
 * 合わない場所に置くと全球効果が大きく落ちる。
 */
function resolveRoleFit(placement: PlacedStructure): number {
  const definition = structureById.get(placement.structureId);
  if (definition === undefined) {
    return 0;
  }
  const primary = definition.role.primaryHazard;
  let best = 0;
  for (const candidate of listOverflowCandidates()) {
    const distance = distanceInMeters(
      placement.position.longitude,
      placement.position.latitude,
      candidate.longitude,
      candidate.latitude,
    );
    if (distance > 420) {
      continue;
    }
    const affinity = definition.hazardAffinity[candidate.primaryHazard] ?? 0;
    const proximity = Math.exp(-distance / 260);
    if (candidate.primaryHazard === primary) {
      best = Math.max(best, clamp(affinity, 0, 1) * proximity);
    } else {
      best = Math.max(best, clamp(affinity, 0, 1) * proximity * 0.55);
    }
  }
  return clamp(best, 0, 1);
}

/**
 * 誤配置ペナルティ 0〜1。
 * 近傍弱点との相性が悪い／負だと、かえって流域を悪化させる。
 */
function resolveMismatchPenalty(placement: PlacedStructure): number {
  const definition = structureById.get(placement.structureId);
  if (definition === undefined) {
    return 0;
  }
  const nearest = nearestCandidate(placement);
  if (nearest === null) {
    // 弱点から遠いだけの配置は効果薄＋軽い無駄置きペナルティ。
    return 0.22;
  }
  const affinity = definition.hazardAffinity[nearest.primaryHazard] ?? 0;
  if (affinity < 0) {
    return clamp(0.32 + Math.abs(affinity) * 0.8, 0, 1);
  }
  if (affinity < 0.15) {
    return clamp(0.22 + (0.15 - affinity) * 1.2, 0, 0.75);
  }
  const roleMismatch =
    nearest.primaryHazard !== definition.role.primaryHazard && affinity < 0.4 ? 0.12 : 0;
  return roleMismatch;
}

function nearestCandidate(placement: PlacedStructure): OverflowCandidate | null {
  let best: OverflowCandidate | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of listOverflowCandidates()) {
    const distance = distanceInMeters(
      placement.position.longitude,
      placement.position.latitude,
      candidate.longitude,
      candidate.latitude,
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  if (best === null || bestDistance > 480) {
    return null;
  }
  return best;
}

/** 線形加算を頭打ちにして「同じ効果の積み上げ」を抑える。 */
function softCap(value: number, cap: number, steepness: number): number {
  if (value <= 0) {
    return 0;
  }
  return cap * (1 - Math.exp((-steepness * value) / Math.max(cap, 0.01)));
}

/**
 * 公開: テストと HUD 用。位置・向き・標高・弱点近接を織り込む。
 */
export function calculatePlacementEffectiveness(placement: PlacedStructure): number {
  const hydraulic = calculateHydraulicEffectiveness(placement);
  const weaknessBoost = nearestWeaknessBoost(placement);
  const roleFit = resolveRoleFit(placement);
  const mismatch = resolveMismatchPenalty(placement);
  const combined = hydraulic * 0.62 + weaknessBoost * 0.22 + roleFit * 0.28 - mismatch * 0.35;
  if (!Number.isFinite(combined)) {
    return 0.3;
  }
  return clamp(combined, 0.08, 1);
}

function nearestWeaknessBoost(placement: PlacedStructure): number {
  const definition = structureById.get(placement.structureId);
  if (definition === undefined) {
    return 0;
  }
  let best = 0;
  for (const candidate of listOverflowCandidates()) {
    const affinity = definition.hazardAffinity[candidate.primaryHazard] ?? 0;
    if (affinity <= 0.08) {
      continue;
    }
    const distance = distanceInMeters(
      placement.position.longitude,
      placement.position.latitude,
      candidate.longitude,
      candidate.latitude,
    );
    const vulnerability = resolveCandidateVulnerability(candidate);
    const cover = Math.exp(-distance / 320) * vulnerability * affinity;
    best = Math.max(best, cover);
  }
  return clamp(best, 0, 1);
}

/**
 * 雨量をランダムに落ち着かせたり強めたりする。
 * 終盤ほど豪雨が出やすいが、常時ピークではない。
 */
function advanceWeather(
  current: FloodSimulationState,
  progress: number,
  deltaSeconds: number,
): Pick<
  FloodSimulationState,
  "rainfallIntensity" | "rainfallTarget" | "weatherHoldRemaining" | "weatherRng"
> {
  let weatherRng = current.weatherRng >>> 0 || DEFAULT_WEATHER_SEED;
  let rainfallTarget = current.rainfallTarget;
  let weatherHoldRemaining = current.weatherHoldRemaining - deltaSeconds;

  while (weatherHoldRemaining <= 0) {
    const next = pickWeatherTarget(progress, weatherRng);
    weatherRng = next.weatherRng;
    rainfallTarget = next.rainfallTarget;
    weatherHoldRemaining += next.holdSeconds;
  }

  const step = Math.min(1, deltaSeconds * 0.14);
  const rainfallIntensity = clamp(
    current.rainfallIntensity + (rainfallTarget - current.rainfallIntensity) * step,
    0,
    1,
  );

  return {
    rainfallIntensity,
    rainfallTarget,
    weatherHoldRemaining,
    weatherRng,
  };
}

function pickWeatherTarget(
  progress: number,
  weatherRng: number,
): { rainfallTarget: number; holdSeconds: number; weatherRng: number } {
  let rng = weatherRng;
  const roll = nextUnit(rng);
  rng = roll.rng;
  // 終盤ほど強い雨の出やすさを少しだけ上げる（常時豪雨にはしない）。
  const heavyBias = progress * 0.12;
  let rainfallTarget: number;
  if (roll.value < 0.34 - heavyBias * 0.4) {
    // 小康
    const span = nextUnit(rng);
    rng = span.rng;
    rainfallTarget = 0.1 + span.value * 0.22;
  } else if (roll.value < 0.72 - heavyBias * 0.15) {
    // 並雨
    const span = nextUnit(rng);
    rng = span.rng;
    rainfallTarget = 0.38 + span.value * 0.28;
  } else {
    // 強雨
    const span = nextUnit(rng);
    rng = span.rng;
    rainfallTarget = 0.72 + span.value * 0.26;
  }

  const hold = nextUnit(rng);
  rng = hold.rng;
  const holdSeconds = 5 + hold.value * 12;

  return {
    rainfallTarget: clamp(rainfallTarget, 0, 1),
    holdSeconds,
    weatherRng: rng,
  };
}

/** xorshift32。テスト再現用に状態を返す。 */
function nextUnit(state: number): { value: number; rng: number } {
  let x = state >>> 0 || DEFAULT_WEATHER_SEED;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  x >>>= 0;
  return { value: (x >>> 0) / 0x1_0000_0000, rng: x };
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
