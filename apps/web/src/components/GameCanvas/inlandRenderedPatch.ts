import type { BufferAttribute } from "three";
import type { RenderedFloodPatch } from "./dioramaInundation";
import { inlandWaterAlpha } from "./inlandWaterMaterial";

/** Snapshot only uploaded Float32 geometry. Bounds/area conservatively include
 * partly faded triangles but exclude fully discarded ones. The anchor must lie inside a visibly non-discarded
 * triangle. Never target the source location or a possibly dry bounds centre.
 * Runs at geometry-upload cadence (<=10Hz), never from a frame-time getter.
 */
export function inlandRenderedPatch(id: string, p: BufferAttribute, appearance: BufferAttribute, count: number): RenderedFloodPatch | null {
  if (!Number.isInteger(count) || count < 3 || count % 3 || count > p.count || count > appearance.count) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let areaM2 = 0, best = 0, visibleVertices = 0;
  let anchor: { x: number; y: number; z: number } | undefined;
  for (let i = 0; i < count; i += 3) {
    const ax = p.getX(i), ay = p.getY(i), az = p.getZ(i);
    const bx = p.getX(i + 1), by = p.getY(i + 1), bz = p.getZ(i + 1);
    const cx = p.getX(i + 2), cy = p.getY(i + 2), cz = p.getZ(i + 2);
    if (![ax, ay, az, bx, by, bz, cx, cy, cz].every(Number.isFinite)) return null;
    // Alpha is monotone in both attributes. Their independent maxima give a
    // conservative upper bound even when they occur at different vertices.
    if (inlandWaterAlpha(Math.max(appearance.getX(i), appearance.getX(i + 1), appearance.getX(i + 2)),
      Math.max(appearance.getY(i), appearance.getY(i + 1), appearance.getY(i + 2))) < 0.003) continue;
    visibleVertices += 3;
    minX = Math.min(minX, ax, bx, cx); maxX = Math.max(maxX, ax, bx, cx);
    minY = Math.min(minY, ay, by, cy); maxY = Math.max(maxY, ay, by, cy);
    minZ = Math.min(minZ, az, bz, cz); maxZ = Math.max(maxZ, az, bz, cz);
    const area = Math.hypot((by - ay) * (cz - az) - (bz - az) * (cy - ay),
      (bz - az) * (cx - ax) - (bx - ax) * (cz - az), (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
    areaM2 += area;
    // Four strictly interior barycentric candidates; interpolated attributes
    // match the shader, not alpha averaged after its nonlinear smoothsteps.
    for (let k = 0; k < 4; k++) {
      const u = k === 0 ? 1 / 3 : k === 1 ? 0.8 : 0.1;
      const v = k === 0 ? 1 / 3 : k === 2 ? 0.8 : 0.1;
      const w = 1 - u - v;
      const alpha = inlandWaterAlpha(appearance.getX(i) * u + appearance.getX(i + 1) * v + appearance.getX(i + 2) * w,
        appearance.getY(i) * u + appearance.getY(i + 1) * v + appearance.getY(i + 2) * w);
      // >=1% opacity is conservative relative to the shader's 0.003 discard.
      if (alpha >= 0.01 && area * alpha > best) {
        best = area * alpha; anchor = { x: ax * u + bx * v + cx * w, y: ay * u + by * v + cy * w, z: az * u + bz * v + cz * w };
      }
    }
  }
  if (!anchor || !Number.isFinite(areaM2) || areaM2 <= 0) return null;
  return Object.freeze({ id: `inland:${id}`, vertexCount: visibleVertices, areaM2,
    anchor: Object.freeze(anchor), bounds: Object.freeze({ minX, minY, minZ, maxX, maxY, maxZ }) });
}
