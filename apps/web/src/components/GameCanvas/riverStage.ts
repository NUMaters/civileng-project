import type { Mesh } from "three";

/** Display safety limit, not a surveyed flood stage or hydraulic prediction. */
export const MAX_RIVER_RISE_METERS = 10;

/** Owns local Y translation of eligible source meshes (source Y is baked into
 * geometry). Expected parent space is the geographic world's metre-scale space.
 * CPU transforms keep rendering, culling and raycasting on the same surface.
 */
export function createRiverStageController(meshes: readonly Mesh[], baseline = 2.2) {
  if (!Number.isFinite(baseline)) throw new RangeError("River baseline must be finite");
  const riverMeshes = [...new Set(meshes)].filter(mesh => mesh.userData.riverStageEligible === true);
  let previousRise: number | undefined;
  function setRise(rise: number): void {
    if (rise === previousRise) return;
    previousRise = rise;
    for (const mesh of riverMeshes) {
      mesh.position.y = rise;
      mesh.updateMatrix();
      mesh.updateWorldMatrix(true, false);
    }
  }
  return {
    update(level: number): void {
      setRise(Number.isFinite(level) ? Math.max(0, Math.min(MAX_RIVER_RISE_METERS, level - baseline)) : 0);
    },
    reset(): void { setRise(0); },
  };
}
