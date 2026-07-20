export type StructureEffects = {
  waterLevelReduction: number;
  overflowPrevention: number;
  drainageCapacity: number;
  bankProtection: number;
  channelCapacityIncrease: number;
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
};

export type BudgetRules = {
  initialBudgetSolo: number;
  initialBudgetMultiplayerPerPlayer: number;
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
