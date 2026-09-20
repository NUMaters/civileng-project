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
