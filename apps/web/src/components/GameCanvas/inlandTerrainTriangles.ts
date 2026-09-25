import type { RenderedTerrainSurface } from "./geographicTerrain";

type Point = { x: number; z: number };
/** Setup-only clipping to the exact terrain triangles. Heights remain measured
 * rendered Y, with caller-enforced raw DEM validity. At most four terrain cells
 * for a <=4m footprint and terrain spacing >=4m. No geometry is draped across
 * a terrain diagonal, preventing water from being buried between point samples.
 */
export function inlandTerrainTriangles(surface: RenderedTerrainSurface,
  minX: number, minZ: number, maxX: number, maxZ: number,
  sample: (x: number, z: number) => number | null): Float64Array | null {
  const xs = surface.xCoordinates, zs = surface.zCoordinates;
  if (![minX, minZ, maxX, maxZ, surface.originX, surface.originZ, surface.maxX, surface.maxZ,
    surface.cellWidth, surface.cellHeight].every(Number.isFinite) || minX >= maxX || minZ >= maxZ ||
    !Number.isInteger(surface.columns) || !Number.isInteger(surface.rows) || surface.columns < 1 || surface.rows < 1 ||
    xs.length !== surface.columns + 1 || zs.length !== surface.rows + 1 ||
    surface.cellWidth <= 0 || surface.cellHeight <= 0 ||
    surface.originX !== xs[0] || surface.originZ !== zs[0] || surface.maxX !== xs.at(-1) || surface.maxZ !== zs.at(-1)) return null;
  const cell = (values: Float32Array, value: number) => {
    let lo = 0, hi = values.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >>> 1; if (values[mid]! <= value) lo = mid; else hi = mid; }
    return lo;
  };
  if (minX < xs[0]! || minZ < zs[0]! || maxX > xs.at(-1)! || maxZ > zs.at(-1)!) return null;
  const c0 = cell(xs, minX), c1 = cell(xs, maxX), r0 = cell(zs, minZ), r1 = cell(zs, maxZ);
  if (c1 < c0 || r1 < r0 || (c1 - c0 + 1) * (r1 - r0 + 1) > 4 ||
    !(xs[c0]! <= minX && xs[c1 + 1]! >= maxX && zs[r0]! <= minZ && zs[r1 + 1]! >= maxZ)) return null;
  for (let c = c0; c <= c1; c++) if (!Number.isFinite(xs[c]) || !Number.isFinite(xs[c + 1]) || xs[c]! >= xs[c + 1]!) return null;
  for (let r = r0; r <= r1; r++) if (!Number.isFinite(zs[r]) || !Number.isFinite(zs[r + 1]) || zs[r]! >= zs[r + 1]!) return null;
  const vertices: number[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const a = { x: xs[c]!, z: zs[r]! }, b = { x: xs[c + 1]!, z: zs[r]! },
      d = { x: xs[c]!, z: zs[r + 1]! }, e = { x: xs[c + 1]!, z: zs[r + 1]! };
    for (let polygon of [[a, d, b], [b, d, e]]) {
      for (const [axis, edge, sign] of [["x", minX, 1], ["x", maxX, -1], ["z", minZ, 1], ["z", maxZ, -1]] as const) {
        const result: Point[] = [];
        for (let i = 0; i < polygon.length; i++) {
          const p = polygon[i]!, q = polygon[(i + 1) % polygon.length]!;
          const dp = (p[axis] - edge) * sign, dq = (q[axis] - edge) * sign;
          if (dp >= 0) result.push(p);
          if ((dp >= 0) !== (dq >= 0)) {
            const t = dp / (dp - dq); result.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t });
          }
        }
        polygon = result;
      }
      for (let i = 1; i + 1 < polygon.length; i++) {
        const p = polygon[0]!, q = polygon[i]!, s = polygon[i + 1]!;
        if (Math.abs((q.x - p.x) * (s.z - p.z) - (s.x - p.x) * (q.z - p.z)) < 1e-10) continue;
        for (const v of [p, q, s]) {
          const y = sample(v.x, v.z);
          if (y === null || !Number.isFinite(y)) return null;
          vertices.push(v.x, y, v.z);
        }
      }
    }
  }
  // Eight source triangles clipped to a rectangle yield at most 40 triangles;
  // fixed ceiling also guards malformed grids before allocating GPU storage.
  if (vertices.length > 40 * 9) return null;
  return new Float64Array(vertices);
}
