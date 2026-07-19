import type { GeoPosition, PlacementResult, StructureDefinition } from "../types/construction";

export const INITIAL_BUDGET = 10_000;

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

export function normalizeHeadingDegrees(headingDegrees: number): number {
  const wrapped = headingDegrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export function formatBudget(value: number): string {
  return `${value.toLocaleString("ja-JP")} pt`;
}
