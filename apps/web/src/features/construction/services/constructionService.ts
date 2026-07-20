import { loadRules, loadStructures } from "@civilcraft/game-data/load";
import type { GeoPosition, PlacementResult, StructureDefinition } from "../types/construction";

const rules = loadRules();
const structureCatalog = loadStructures();

export const INITIAL_BUDGET = rules.budget.initialBudgetSolo;
export const MAX_BUDGET = rules.budget.maxBudget;
export const BUDGET_INCOME_PREPARATION = rules.budget.incomePerSecondPreparation;
export const BUDGET_INCOME_DISASTER = rules.budget.incomePerSecondDisaster;
export const DISASTER_START_GRANT = rules.budget.disasterStartGrant;

export type BudgetEconomyPhase = "idle" | "preparation" | "disaster" | "result" | "review";

export type BudgetTickInput = {
  currentBudget: number;
  deltaSeconds: number;
  phase: BudgetEconomyPhase;
  /** 確定済み配置の structureId 一覧（維持費算出用）。 */
  placedStructureIds: readonly string[];
};

export type BudgetTickResult = {
  budget: number;
  /** 表示用。正なら補給超過、負なら維持費超過。 */
  netIncomePerSecond: number;
  grossIncomePerSecond: number;
  maintenancePerSecond: number;
};

export function placeStructure(
  structure: StructureDefinition,
  position: GeoPosition,
  currentBudget: number,
  placementId: string,
  headingDegrees: number,
): PlacementResult {
  if (currentBudget < structure.constructionCost) {
    return {
      ok: false,
      reason: `${structure.displayName}の建設にはあと${formatBudget(structure.constructionCost - currentBudget)}必要です`,
    };
  }

  return {
    ok: true,
    placement: {
      id: placementId,
      structureId: structure.id,
      position,
      headingDegrees: normalizeHeadingDegrees(headingDegrees),
    },
    remainingBudget: currentBudget - structure.constructionCost,
  };
}

/**
 * 準備／災害中の予算経済を 1 フレーム進める。
 * 補給 − 維持費。結果・レビュー・待機では変動しない。
 */
export function tickBudgetEconomy(input: BudgetTickInput): BudgetTickResult {
  const maintenancePerSecond = calculateMaintenancePerSecond(input.placedStructureIds);
  const grossIncomePerSecond = resolveGrossIncomePerSecond(input.phase);
  const netIncomePerSecond = grossIncomePerSecond - maintenancePerSecond;

  if (input.phase !== "preparation" && input.phase !== "disaster") {
    return {
      budget: input.currentBudget,
      netIncomePerSecond: 0,
      grossIncomePerSecond: 0,
      maintenancePerSecond,
    };
  }

  const delta = netIncomePerSecond * Math.max(0, input.deltaSeconds);
  const budget = clampBudget(input.currentBudget + delta);
  return {
    budget,
    netIncomePerSecond,
    grossIncomePerSecond,
    maintenancePerSecond,
  };
}

/** 災害開始時の緊急予算を加算する。 */
export function applyDisasterStartGrant(currentBudget: number): number {
  return clampBudget(currentBudget + DISASTER_START_GRANT);
}

export function calculateMaintenancePerSecond(
  placedStructureIds: readonly string[],
): number {
  let total = 0;
  for (const structureId of placedStructureIds) {
    const structure = structureCatalog.find(({ id }) => id === structureId);
    if (structure !== undefined) {
      total += structure.maintenanceCostPerSecond;
    }
  }
  return total;
}

export function resolveGrossIncomePerSecond(phase: BudgetEconomyPhase): number {
  if (phase === "preparation") {
    return BUDGET_INCOME_PREPARATION;
  }
  if (phase === "disaster") {
    return BUDGET_INCOME_DISASTER;
  }
  return 0;
}

export function clampBudget(value: number): number {
  return Math.max(0, Math.min(MAX_BUDGET, value));
}

export function normalizeHeadingDegrees(headingDegrees: number): number {
  const wrapped = headingDegrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export function formatBudget(value: number): string {
  return `${Math.round(value).toLocaleString("ja-JP")} pt`;
}

/** HUD 用。+80 pt/s のように符号付きで返す。 */
export function formatBudgetRate(netIncomePerSecond: number): string {
  const rounded = Math.round(netIncomePerSecond);
  if (rounded > 0) {
    return `+${rounded.toLocaleString("ja-JP")} pt/s`;
  }
  if (rounded < 0) {
    return `${rounded.toLocaleString("ja-JP")} pt/s`;
  }
  return "±0 pt/s";
}
