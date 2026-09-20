import { ABUKUMA_RIVER_CENTERLINE } from "./abukumaRiverGeometry";

export const DIORAMA_ORIGIN = { longitude: 140.3837, latitude: 37.3655 };
const LAT_METERS = 110_540;
const LON_METERS = 111_320 * Math.cos((DIORAMA_ORIGIN.latitude * Math.PI) / 180);
/** Three.js: east +X, north -Z, altitude +Y. Distances are meters. */
export function geoToWorld(longitude: number, latitude: number) {
  return {
    x: (longitude - DIORAMA_ORIGIN.longitude) * LON_METERS,
    z: -(latitude - DIORAMA_ORIGIN.latitude) * LAT_METERS,
  };
}
export function worldToGeo(x: number, z: number) {
  return {
    longitude: DIORAMA_ORIGIN.longitude + x / LON_METERS,
    latitude: DIORAMA_ORIGIN.latitude - z / LAT_METERS,
    height: 20,
  };
}
export const RIVER_POINTS = ABUKUMA_RIVER_CENTERLINE.map((p) => geoToWorld(p.lon, p.lat)).sort(
  (a, b) => a.z - b.z,
);
/** The real Abukuma centerline, interpolated along the valley. */
export function riverX(z: number): number {
  for (let i = 1; i < RIVER_POINTS.length; i++) {
    const a = RIVER_POINTS[i - 1]!,
      b = RIVER_POINTS[i]!;
    if (z <= b.z) return a.x + (b.x - a.x) * Math.max(0, Math.min(1, (z - a.z) / (b.z - a.z || 1)));
  }
  return RIVER_POINTS.at(-1)!.x;
}
export function groundY(x: number, z: number): number {
  const d = Math.abs(x - riverX(z));
  return d < 44 ? 0 : Math.min(9, (d - 44) * 0.35);
}

/** Pick the visible bank/water surface, not an invisible plane below the banks. */
export function intersectDioramaSurface(
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
): { x: number; z: number } | null {
  if (direction.y >= -0.000001 || origin.y < 9) return null;
  const top = (9 - origin.y) / direction.y;
  const bottom = (0.4 - origin.y) / direction.y;
  const at = (t: number) => ({ x: origin.x + direction.x * t, z: origin.z + direction.z * t });
  const above = (t: number) => {
    const p = at(t);
    return origin.y + direction.y * t - Math.max(0.4, groundY(p.x, p.z));
  };
  // Scan from the camera so a far bank cannot hide a nearer intersection.
  let low = top;
  for (let sample = 1; sample <= 32; sample++) {
    let high = top + ((bottom - top) * sample) / 32;
    if (above(high) <= 0) {
      for (let iteration = 0; iteration < 20; iteration++) {
        const middle = (low + high) / 2;
        if (above(middle) > 0) low = middle;
        else high = middle;
      }
      return at(high);
    }
    low = high;
  }
  return at(bottom);
}
