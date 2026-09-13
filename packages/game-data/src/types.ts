export type StructureEffects = {
  waterLevelReduction: number;
  overflowPrevention: number;
  drainageCapacity: number;
  bankProtection: number;
  channelCapacityIncrease: number;
};

/**
 * 局所災害・弱点の種類。
 * 施設の `hazardAffinity` と突き合わせ、相性の良い対策だけが効く。
 */
export type HazardKind = "overtopping" | "erosion" | "inlandPonding" | "capacityShortage";

export type StructureHazardAffinity = Record<HazardKind, number>;

export type StructureRole = {
  /** 主に効く災害・弱点の種類。 */
  primaryHazard: HazardKind;
  /** プレイヤー向けの強み（短い文）。 */
  strengths: string[];
  /** プレイヤー向けの弱み・使えない場面。 */
  weaknesses: string[];
};

export type StructureDefinition = {
  id: string;
  displayName: string;
  description: string;
  constructionCost: number;
  constructionTimeSeconds: number;
  maintenanceCostPerSecond: number;
  allowedTerrains: string[];
  supportedDisasters: string[];
  effects: StructureEffects;
  role: StructureRole;
  /** 各 HazardKind への相性 0〜1（負値は侵食悪化など不利）。 */
  hazardAffinity: StructureHazardAffinity;
};

export type BudgetRules = {
  initialBudgetSolo: number;
  initialBudgetMultiplayerPerPlayer: number;
  /** 準備フェーズ中の毎秒補給（pt/s）。 */
  incomePerSecondPreparation: number;
  /** 災害フェーズ中の毎秒補給（pt/s）。緊急対応用にやや多め。 */
  incomePerSecondDisaster: number;
  /** 災害開始時の一括緊急予算（pt）。 */
  disasterStartGrant: number;
  /** 所持予算の上限（pt）。貯め込みを抑え選択を促す。 */
  maxBudget: number;
  description: string;
};

export type GameTiming = {
  totalPlayTimeSeconds: number;
  phases: {
    preparationSeconds: number;
    disasterSeconds: number;
    resultSeconds: number;
  };
};

export type VictoryConditions = {
  clearThresholdPercent: number;
  failureThresholdPercent: number;
  description: string;
};

export type DisasterDefinition = {
  id: string;
  displayName: string;
  description: string;
  mvp: boolean;
};

export type GameRulesBundle = {
  budget: BudgetRules;
  timing: GameTiming;
  victory: VictoryConditions;
};

export type GameDataBundle = {
  structures: StructureDefinition[];
  rules: GameRulesBundle;
  disasters: DisasterDefinition[];
};

export const HAZARD_KIND_LABELS: Record<HazardKind, string> = {
  overtopping: "越水",
  erosion: "侵食",
  inlandPonding: "内水",
  capacityShortage: "水位上昇",
};

export function getHazardKindLabel(kind: HazardKind): string {
  return HAZARD_KIND_LABELS[kind] ?? kind;
}
