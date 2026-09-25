import { getStructureModelParts } from "./structureModels";
import type { SurfaceSampler } from "./riverBoundary";

/** Local metre coordinates, matching the committed model's placement origin. */
export type FloodBarrierPlacement = Readonly<{
  structureId: string;
  x: number;
  z: number;
  headingDegrees: number;
  preview?: boolean;
}>;
type Point = Readonly<{ x: number; z: number }>;
type Vertex = Point & { y: number };
type Triangle = readonly [Vertex, Vertex, Vertex];
export type FacilityFloodBarrier = Readonly<{
  /** Maximum construction elevation intersecting a convex CCW cell (x,z).
   * null means no construction; never substitutes for missing terrain. */
  cellElevation: (corners: readonly Point[]) => number | null;
  facilityCount: number;
}>;

/** Bound retained geometry; reject oversize input rather than silently drop protection. */
export const MAX_FLOOD_BARRIERS = 256;

/** Snapshot on committed placement changes ONLY. No global or coordinate cache.
 * Uses the visual levee geometry, including toe/crest, at sampled ground + 0.5m.
 * Educational rendering layer only: does not alter DEM, discharge or score models.
 * Unknown placement ground means unknown construction elevation: omit, never use 0.
 */
export function createFacilityFloodBarrier(
  placements: readonly FloodBarrierPlacement[], sampleGround: SurfaceSampler,
): FacilityFloodBarrier {
  const committed = placements.filter(p => p.structureId === "levee" && !p.preview &&
    [p.x, p.z, p.headingDegrees].every(Number.isFinite));
  if (committed.length > MAX_FLOOD_BARRIERS) throw new RangeError("Too many flood barriers");
  const facilities: { triangles: Triangle[]; minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  for (const p of committed) {
    const ground = sampleGround(p.x, p.z);
    if (ground === null || !Number.isFinite(ground)) continue;
    const angle = p.headingDegrees * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const triangles: Triangle[] = [];
    for (const part of getStructureModelParts("levee")) {
      const d = part.dimensions!;
      // Box top and closed embankment mesh; projected vertical faces have no area.
      const positions = part.mesh?.positions ?? [
        [-d.length / 2, -d.width / 2, d.height / 2], [d.length / 2, -d.width / 2, d.height / 2],
        [d.length / 2, d.width / 2, d.height / 2], [-d.length / 2, d.width / 2, d.height / 2],
      ];
      const indices = part.mesh?.indices ?? [0, 1, 2, 0, 2, 3];
      const vertices = positions.map(v => {
        const east = v[0]! + (part.offsetEast ?? 0), north = v[1]! + (part.offsetNorth ?? 0);
        // Model (east,north,up) -> Three (east,up,-north), rotationY=-heading.
        return { x: p.x + cos * east + sin * north, z: p.z + sin * east - cos * north,
          y: ground + 0.5 + part.centerHeight + v[2]! };
      });
      for (let i = 0; i < indices.length; i += 3) {
        const a = vertices[indices[i]!]!, b = vertices[indices[i + 1]!]!, c = vertices[indices[i + 2]!]!;
        if (Math.abs(cross(a, b, c)) > 1e-9) triangles.push([a, b, c]);
      }
    }
    const vertices = triangles.flat();
    facilities.push({ triangles, minX: Math.min(...vertices.map(v => v.x)), maxX: Math.max(...vertices.map(v => v.x)),
      minZ: Math.min(...vertices.map(v => v.z)), maxZ: Math.max(...vertices.map(v => v.z)) });
  }
  return Object.freeze({ facilityCount: facilities.length, cellElevation(corners: readonly Point[]) {
    if (corners.length < 3 || corners.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z))) return null;
    const minX = Math.min(...corners.map(p => p.x)), maxX = Math.max(...corners.map(p => p.x));
    const minZ = Math.min(...corners.map(p => p.z)), maxZ = Math.max(...corners.map(p => p.z));
    let height = -Infinity;
    for (const f of facilities) {
      if (maxX <= f.minX || minX >= f.maxX || maxZ <= f.minZ || minZ >= f.maxZ) continue;
      for (const triangle of f.triangles) {
        let polygon: Vertex[] = [...triangle];
        for (let i = 0; i < corners.length && polygon.length; i++) {
          const a = corners[i]!, b = corners[(i + 1) % corners.length]!, clipped: Vertex[] = [];
          for (let j = 0; j < polygon.length; j++) {
            const u = polygon[j]!, v = polygon[(j + 1) % polygon.length]!;
            const du = cross(a, b, u), dv = cross(a, b, v);
            if (du >= 0) clipped.push(u);
            if ((du >= 0) !== (dv >= 0)) {
              const t = du / (du - dv);
              clipped.push({ x: u.x + t * (v.x - u.x), z: u.z + t * (v.z - u.z), y: u.y + t * (v.y - u.y) });
            }
          }
          polygon = clipped;
        }
        // Touching an edge alone must not widen the levee by another whole cell.
        if (polygon.length < 3 || Math.abs(polygon.reduce((sum, p, i) => {
          const q = polygon[(i + 1) % polygon.length]!;
          return sum + (p.x - polygon[0]!.x) * (q.z - polygon[0]!.z) - (q.x - polygon[0]!.x) * (p.z - polygon[0]!.z);
        }, 0)) < 1e-9) continue;
        for (const v of polygon) height = Math.max(height, v.y);
      }
    }
    return height === -Infinity ? null : height;
  } });
}

function cross(a: Point, b: Point, p: Point): number {
  return (b.x - a.x) * (p.z - a.z) - (b.z - a.z) * (p.x - a.x);
}
