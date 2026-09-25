import type { RenderedFloodPatch, FloodPoint } from "./dioramaInundation";
export type { RenderedFloodPatch } from "./dioramaInundation";

/** Stable ID order avoids reordering when areas fluctuate. First visit retains
 * the existing largest-patch preference; subsequent visits advance even if the
 * previous patch vanished. Prefix IDs at the caller to separate source kinds.
 */
export function nextRenderedFloodPatch(patches: readonly RenderedFloodPatch[], previousId: string | null): RenderedFloodPatch | null {
  const eligible = patches.filter(valid);
  if (!previousId) return selectRenderedFloodPatch(eligible);
  eligible.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return eligible.find(p => p.id > previousId) ?? eligible[0] ?? null;
}

export type FloodCameraOptions = {
  verticalFovDegrees: number;
  aspect: number;
  /** Fractions of the full viewport. Each must be in [0, 0.5). */
  margins?: Partial<{ top: number; bottom: number; left: number; right: number }>;
  minDistance?: number;
};

/** Tap-time fixed-45-degree plan. Caller temporarily expands maxDistance when
 * necessary, and restores the previous pose/limit on return. Target is wet geometry.
 */
export function getFloodCameraFocus(patches: readonly RenderedFloodPatch[], options: FloodCameraOptions): {
  patchId: string; target: FloodPoint; cameraOffset: FloodPoint; distance: number;
} | null {
  const patch = selectRenderedFloodPatch(patches);
  if (!patch) return null;
  const { verticalFovDegrees: fov, aspect, minDistance = 190 } = options;
  const margins = { top: 0.18, bottom: 0.3, left: 0.08, right: 0.08, ...options.margins };
  if (!Number.isFinite(fov) || fov <= 0 || fov >= 180 || !Number.isFinite(aspect) || aspect <= 0 ||
      !Number.isFinite(minDistance) || minDistance < 0 ||
      Object.values(margins).some(value => !Number.isFinite(value) || value < 0 || value >= 0.5)) return null;
  const tangent = Math.tan(fov * Math.PI / 360);
  const vertical = tangent * (1 - 2 * Math.max(margins.top, margins.bottom));
  const horizontal = tangent * aspect * (1 - 2 * Math.max(margins.left, margins.right));
  if (!Number.isFinite(vertical) || vertical <= 0 || !Number.isFinite(horizontal) || horizontal <= 0) return null;
  const { bounds: b, anchor: a } = patch;
  const s = Math.SQRT1_2;
  let distance = Math.max(2, minDistance);
  for (const x of [b.minX, b.maxX]) for (const y of [b.minY, b.maxY]) for (const z of [b.minZ, b.maxZ]) {
    const dx = x - a.x, dy = y - a.y, dz = z - a.z;
    const towardCamera = (dy + dz) * s, screenUp = (dy - dz) * s;
    distance = Math.max(distance, towardCamera + 2,
      towardCamera + Math.abs(dx) * 1.1 / horizontal,
      towardCamera + Math.abs(screenUp) * 1.1 / vertical);
  }
  const offset = distance * s;
  if (!Number.isFinite(distance) || !Number.isFinite(a.y + offset) || !Number.isFinite(a.z + offset)) return null;
  return { patchId: patch.id, target: { ...a }, cameraOffset: { x: 0, y: offset, z: offset }, distance };
}

function valid(patch: RenderedFloodPatch): boolean {
  const b = patch.bounds, a = patch.anchor;
  return Number.isInteger(patch.vertexCount) && patch.vertexCount >= 3 && patch.vertexCount % 3 === 0 &&
    (patch.areaM2 === undefined || (Number.isFinite(patch.areaM2) && patch.areaM2 > 0)) &&
    [b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ, a.x, a.y, a.z].every(Number.isFinite) &&
    b.minX <= a.x && a.x <= b.maxX && b.minY <= a.y && a.y <= b.maxY && b.minZ <= a.z && a.z <= b.maxZ;
}

/** Largest emitted surface. If area is absent, use XZ bounds area; ties keep input order. */
export function selectRenderedFloodPatch(patches: readonly RenderedFloodPatch[]): RenderedFloodPatch | null {
  let selected: RenderedFloodPatch | null = null, largest = -1;
  for (const patch of patches) {
    if (!valid(patch)) continue;
    const b = patch.bounds;
    const area = patch.areaM2 ?? (b.maxX - b.minX) * (b.maxZ - b.minZ);
    if (!Number.isFinite(area)) continue;
    if (area > largest) { selected = patch; largest = area; }
  }
  return selected;
}

/** Pure tap-time plan in the patch's local metre space; no camera mutation.
 * Keep the wet anchor as target. A sphere enclosing every bounds corner around
 * that anchor fits for ANY preserved normalized camera direction, not only a
 * particular heading/pitch. Symmetric vertical space defaults to 55% of viewport
 * (140px HUD + 160px dock at 700px); horizontal space reserves 5% on either side.
 * Distances are compatible with controls [190, 1500]. Return null for invalid
 * input or an impossible fit rather than silently clipping water at the cap.
 */
export function frameRenderedFloodPatch(
  patch: RenderedFloodPatch,
  fovDegrees: number,
  aspect: number,
  usableHeightRatio = 0.55,
): { target: FloodPoint; distance: number } | null {
  if (!valid(patch) || !Number.isFinite(fovDegrees) || fovDegrees <= 0 || fovDegrees >= 180 ||
      !Number.isFinite(aspect) || aspect <= 0 || !Number.isFinite(usableHeightRatio) ||
      usableHeightRatio <= 0 || usableHeightRatio > 1) return null;
  const tangent = Math.tan(fovDegrees * Math.PI / 360);
  const usableTangent = Math.min(tangent * aspect * 0.9, tangent * usableHeightRatio);
  if (!Number.isFinite(usableTangent) || usableTangent <= 0) return null;
  const { bounds: b, anchor: a } = patch;
  const radius = Math.hypot(
    Math.max(Math.abs(b.minX - a.x), Math.abs(b.maxX - a.x)),
    Math.max(Math.abs(b.minY - a.y), Math.abs(b.maxY - a.y)),
    Math.max(Math.abs(b.minZ - a.z), Math.abs(b.maxZ - a.z)),
  );
  // Sphere angular radius: sin(half-angle) = radius / distance. 10% breathing room.
  const distance = Math.max(190, radius * 1.1 * Math.hypot(1, usableTangent) / usableTangent);
  if (!Number.isFinite(distance) || distance > 1500) return null;
  return { target: { x: a.x, y: a.y, z: a.z }, distance };
}
