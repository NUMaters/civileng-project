import type { FacilityLabelBounds, FacilityLabelLayout } from "./facilityLabelLayout";
import { FACILITY_BODY_GAP } from "./facilityModelLabelLayout";

export const MAX_GUIDANCE_OBSTACLES = 64;

function overlaps(left: number, top: number, right: number, bottom: number, body: FacilityLabelBounds): boolean {
  return left <= body.right + FACILITY_BODY_GAP && right >= body.left - FACILITY_BODY_GAP &&
    top <= body.bottom + FACILITY_BODY_GAP && bottom >= body.top - FACILITY_BODY_GAP;
}

/** Allocation-free conservative clearance for the label and its painted pointer.
 * The pointer's bounding rectangle may reject a marginally clear triangle, but
 * never admits a triangle crossing a facility. No alternate/invented site anchors.
 */
export function guidanceClearsFacilities(
  layout: FacilityLabelLayout, width: number, height: number,
  obstacles: readonly FacilityLabelBounds[], count: number,
): boolean {
  if (!Number.isInteger(count) || count < 0 || count > obstacles.length || count > MAX_GUIDANCE_OBSTACLES) return false;
  const baseX = layout.x + layout.pointerBaseX;
  const tipX = layout.x + layout.pointerTipX;
  const baseY = layout.pointerSide === "bottom" ? layout.y + height : layout.y;
  const tipY = baseY + (layout.pointerSide === "bottom" ? layout.pointerHeight : -layout.pointerHeight);
  const pointerLeft = Math.min(baseX - 6, tipX), pointerRight = Math.max(baseX + 6, tipX);
  const pointerTop = Math.min(baseY, tipY), pointerBottom = Math.max(baseY, tipY);
  for (let i = 0; i < count; i++) {
    const body = obstacles[i];
    if (overlaps(layout.x, layout.y, layout.x + width, layout.y + height, body) ||
      overlaps(pointerLeft, pointerTop, pointerRight, pointerBottom, body)) return false;
  }
  return true;
}
