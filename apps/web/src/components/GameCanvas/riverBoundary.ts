import { isAbukumaWater } from "./geographicWorld";
import { koriyamaGeoToLocal, type KoriyamaGeodata } from "./koriyamaGeodata";
import type { FloodSimulationState } from "../../features/disaster/services/floodSimulation";

export type BankPoint = { x: number; z: number };
export type BankSurfacePoint = BankPoint & { y: number };
export const MAX_RIVER_EDGE_POINTS = 32;
export type RiverBoundary = {
  sourceId: string;
  polygonIndex: number;
  segmentIndex: number;
  anchor: BankPoint;
  left: BankSurfacePoint;
  right: BankSurfacePoint;
  /** Optional mesh-triangle breakpoints along the same original source edge. */
  edge?: readonly BankSurfacePoint[];
  /** Unit vector pointing out of the source polygon. */
  inland: BankPoint;
  isLand: (x: number, z: number) => boolean;
};
export type RiverBoundarySite = FloodSimulationState["overflowSites"][number];
export type RiverBoundaryResolver = (site: RiverBoundarySite) => RiverBoundary | null;
export type SurfaceSampler = (x: number, z: number) => number | null;
export type RiverWaterSampler = SurfaceSampler & {
  sampleEdge: (left: BankPoint, right: BankPoint) => BankSurfacePoint[] | null;
};

const cross = (a: BankPoint, b: BankPoint) => a.x * b.z - a.z * b.x;
function inside(p: BankPoint, ring: readonly BankPoint[]): boolean {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) result = !result;
  }
  return result;
}

/** Source X/Z only; never infer banks from a centerline width. The caller must
 * sample the CURRENT rendered river surface (including stage), not a DEM or a
 * fabricated absolute river datum. Search distance is a rejection bound, not an
 * offset. Only original exterior edges can be outlets; island/clip edges cannot.
 */
export function createRiverBoundaryResolver(
  data: KoriyamaGeodata,
  sampleWater: SurfaceSampler,
  { maxSearchMeters = 224, inletWidthMeters = 16 } = {},
): RiverBoundaryResolver {
  if (![maxSearchMeters, inletWidthMeters].every(v => Number.isFinite(v) && v > 0)) throw new RangeError("Invalid river boundary limits");
  const polygons = data.features.filter(isAbukumaWater).flatMap(feature =>
    feature.geometry.type !== "MultiPolygon" ? [] : feature.geometry.coordinates.map((polygon, polygonIndex) => ({
      sourceId: feature.id, polygonIndex, rings: polygon.map(ring => ring.map(koriyamaGeoToLocal)),
    })),
  );
  const inWater = (p: BankPoint) => polygons.some(({ rings }) => rings[0] && inside(p, rings[0]) && !rings.slice(1).some(r => inside(p, r)));
  const isLand = (x: number, z: number) => !inWater({ x, z });
  const min = koriyamaGeoToLocal([data.bbox[0], data.bbox[3]]), max = koriyamaGeoToLocal([data.bbox[2], data.bbox[1]]);
  return site => {
    if (!["overtopping", "erosion"].includes(site.primaryHazard) ||
        ![site.longitude, site.latitude, site.outflowHeadingDegrees].every(Number.isFinite)) return null;
    const origin = koriyamaGeoToLocal([site.longitude, site.latitude]);
    const angle = site.outflowHeadingDegrees * Math.PI / 180;
    const direction = { x: Math.sin(angle), z: -Math.cos(angle) };
    const hits: (RiverBoundary & { distance: number })[] = [];
    for (const polygon of polygons) {
      const ring = polygon.rings[0] ?? [];
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i]!, b = ring[i + 1]!;
        if (([min.x, max.x].some(x => Math.abs(a.x - x) < 1e-4 && Math.abs(b.x - x) < 1e-4)) ||
            ([min.z, max.z].some(z => Math.abs(a.z - z) < 1e-4 && Math.abs(b.z - z) < 1e-4))) continue;
        const edge = { x: b.x - a.x, z: b.z - a.z }, length = Math.hypot(edge.x, edge.z);
        const denominator = cross(direction, edge);
        if (Math.abs(denominator) < 1e-8 || length < 1e-8) continue;
        const relative = { x: a.x - origin.x, z: a.z - origin.z };
        const distance = cross(relative, edge) / denominator, u = cross(relative, direction) / denominator;
        if (Math.abs(distance) > maxSearchMeters || u <= 0 || u >= 1) continue;
        const anchor = { x: a.x + u * edge.x, z: a.z + u * edge.z };
        // Numerical side probe only; it never moves the returned bank.
        const before = { x: anchor.x - direction.x * 0.02, z: anchor.z - direction.z * 0.02 };
        const after = { x: anchor.x + direction.x * 0.02, z: anchor.z + direction.z * 0.02 };
        if (!inWater(before) || inWater(after)) continue;
        const tangent = { x: edge.x / length, z: edge.z / length };
        let inland = { x: -tangent.z, z: tangent.x };
        if (inland.x * direction.x + inland.z * direction.z < 0) inland = { x: -inland.x, z: -inland.z };
        if (inWater({ x: anchor.x + inland.x * 0.02, z: anchor.z + inland.z * 0.02 })) continue;
        const halfWidth = Math.min(inletWidthMeters / 2, u * length, (1 - u) * length);
        if (halfWidth < 1e-4) continue; // degenerate vertex hit: fail closed
        const left = { x: anchor.x - tangent.x * halfWidth, z: anchor.z - tangent.z * halfWidth };
        const right = { x: anchor.x + tangent.x * halfWidth, z: anchor.z + tangent.z * halfWidth };
        const ly = sampleWater(left.x, left.z), ry = sampleWater(right.x, right.z);
        if (ly === null || ry === null || !Number.isFinite(ly) || !Number.isFinite(ry)) continue;
        const sampler = sampleWater as SurfaceSampler & Partial<Pick<RiverWaterSampler, "sampleEdge">>;
        // Mesh-aware sampling retains every triangle break; generic callbacks
        // are discretely checked at <=4m and make no mesh-continuity guarantee.
        const edgePoints = sampler.sampleEdge ? sampler.sampleEdge(left, right) : Array.from(
          { length: Math.ceil(halfWidth * 2 / 4) + 1 }, (_, i) => {
            const t = i / Math.ceil(halfWidth * 2 / 4), x = left.x + (right.x - left.x) * t, z = left.z + (right.z - left.z) * t;
            return { x, z, y: sampleWater(x, z) };
          });
        if (!edgePoints || edgePoints.length > MAX_RIVER_EDGE_POINTS || edgePoints.some(p => p.y === null || !Number.isFinite(p.y))) continue;
        hits.push({ sourceId: polygon.sourceId, polygonIndex: polygon.polygonIndex, segmentIndex: i,
          anchor, left: { ...left, y: ly }, right: { ...right, y: ry }, edge: edgePoints as BankSurfacePoint[], inland, isLand, distance });
      }
    }
    hits.sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance));
    if (!hits[0] || (hits[1] && Math.abs(Math.abs(hits[1].distance) - Math.abs(hits[0].distance)) < 1e-6)) return null;
    return hits[0];
  };
}
