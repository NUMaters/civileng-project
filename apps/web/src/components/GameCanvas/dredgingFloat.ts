/** Visual barge placement only. Hull spans local Y=0..4, waterline is Y=2.
 * Use the current rendered river surface, never a simulated/guessed datum.
 * Missing/nonfinite water falls back to known ground + 0.5; both unknown hides
 * the model rather than manufacturing a zero elevation. No DEM/hydrology edits.
 */
export function resolveDredgingBaseY(waterY: number | null, groundY: number | null): number | null {
  if (waterY !== null && Number.isFinite(waterY)) return waterY - 2;
  if (groundY !== null && Number.isFinite(groundY)) return groundY + 0.5;
  return null;
}
