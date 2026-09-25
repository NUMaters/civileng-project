import { layoutFacilityLabel, type FacilityLabelBounds, type FacilityLabelLayout } from "./facilityLabelLayout";

/** Rank only real projected anchors in the currently unobscured map. The label
 * must fit using its observed border-box size; never clamp an offscreen site into view.
 * Infinity means ineligible. Scratch layout is caller-owned, as in facility labels.
 */
export function scoreGuidanceAnchor(
  x: number, y: number, depth: number, viewportWidth: number, viewportHeight: number,
  width: number, height: number, bounds: FacilityLabelBounds, out: FacilityLabelLayout,
): number {
  if (!Number.isFinite(depth) || depth < -1 || depth > 1 ||
    !Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight) ||
    x < 0 || x > viewportWidth || y < 0 || y > viewportHeight ||
    x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom ||
    !layoutFacilityLabel(x, y, width, height, bounds, out)) return Infinity;
  return Math.abs(y - (bounds.top + bounds.bottom) / 2) +
    Math.abs(x - (bounds.left + bounds.right) / 2) * 0.4;
}
