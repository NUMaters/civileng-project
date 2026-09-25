import type { StructureInfluence } from "./floodSimulation";

/** Educational fill fraction, not measured m³ or a mass-conserving water budget.
 * Full local activity fills an empty basin in 45 simulated seconds. The river
 * demand ramp (2.2–4.7 m, matching facility activity) is a game convention,
 * not an intake elevation survey.
 * Existing static basin mitigation remains independent of this bookkeeping,
 * including when full; no drainage, overflow routing, or capacity feedback is modeled.
 */
export const RETENTION_FILL_SECONDS = 45;

type RetentionInfluence = Pick<
  StructureInfluence,
  "placementId" | "structureId" | "preview" | "effectiveness" | "positiveSiteContributions"
>;

function fraction(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

/** Integrate only this step's activity. Missing entries start empty; absent or
 * preview basins are pruned. A zero step refreshes membership without filling.
 * Constant inputs give the same result for any partition of the elapsed time.
 */
export function advanceRetentionStorage(
  current: Readonly<Record<string, number>> | undefined,
  influences: ReadonlyArray<RetentionInfluence>,
  riverLevelMeters: number,
  deltaSeconds: number,
): Record<string, number> {
  const next: Record<string, number> = {};
  const dt = Number.isFinite(deltaSeconds) ? Math.max(0, deltaSeconds) : 0;
  const demand = fraction((riverLevelMeters - 2.2) / 2.5);
  for (const influence of influences) {
    if (influence.structureId !== "retention-basin" || influence.preview) continue;
    const previous = Object.hasOwn(current ?? {}, influence.placementId)
      ? fraction(current![influence.placementId])
      : 0;
    // Use the strongest of this basin's own positive local contributions. More
    // candidate sites must not multiply its capacity or borrow a neighbour's work.
    const contribution = (influence.positiveSiteContributions ?? []).reduce(
      (strongest, site) => Math.max(strongest, fraction(site.strength)),
      0,
    );
    const activity = contribution * fraction(influence.effectiveness) * demand;
    Object.defineProperty(next, influence.placementId, {
      value: Math.min(1, previous + activity * (dt / RETENTION_FILL_SECONDS)),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return next;
}
