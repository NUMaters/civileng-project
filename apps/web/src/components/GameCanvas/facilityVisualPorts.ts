/** Illustrative facility-local metres, not surveyed levels or hydraulic inputs.
 * DioramaGameMap applies rotation.y = -heading: local -Z is the stored bearing.
 */
export const PUMP_PORTS = [-9, 0, 9].map(x => ({
  mouth: [x, 5, -13] as [number, number, number],
  direction: [0, 0, -1] as [number, number, number],
}));
export const PUMP_JET_LENGTH = 4;
export const PUMP_BORE_RADIUS = 1.25;

export const BASIN_PORTS = {
  inletHalfWidth: 6,
  sillHeight: 1.2,
  outerZ: -36,
  innerCrestZ: -24,
  poolZ: -19,
  outletHalfWidth: 3,
  outletFloor: 0.3,
  outletCeiling: 3,
  outletInnerX: 30,
  outletOuterX: 46,
} as const;

/** A continuous, non-uphill illustrative inlet sheet ending at the animated pool.
 * No outlet animation: normalized activity cannot tell us when storage drains.
 */
export function basinInletHeight(z: number, poolHeight: number): number {
  const head = Math.max(BASIN_PORTS.sillHeight + 0.12, poolHeight + 0.08);
  const t = Math.max(0, Math.min(1, (z - BASIN_PORTS.innerCrestZ) /
    (BASIN_PORTS.poolZ - BASIN_PORTS.innerCrestZ)));
  return head + (poolHeight + 0.08 - head) * t;
}
