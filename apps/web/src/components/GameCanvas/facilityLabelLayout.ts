export const FACILITY_LABEL_MARGIN = 8;
const POINTER_GAP = 7;

export type FacilityLabelBounds = { left: number; top: number; right: number; bottom: number };
export type FacilityLabelLayout = {
  x: number; y: number;
  pointerSide: "top" | "bottom";
  pointerHeight: number; pointerBaseX: number; pointerTipX: number;
  pointerLeft: number; pointerWidth: number;
};

/** CSS-pixel layout using cached border-box sizes and measured HUD/dock boundaries.
 * Writes into a reusable result: no objects, DOM reads or allocations in the frame loop.
 * The triangle tip remains at the projected anchor, even after moving the label.
 */
export function layoutFacilityLabel(
  anchorX: number, anchorY: number, width: number, height: number,
  bounds: FacilityLabelBounds, out: FacilityLabelLayout,
): boolean {
  if (!Number.isFinite(anchorX) || !Number.isFinite(anchorY) || !Number.isFinite(width) ||
    !Number.isFinite(height) || !Number.isFinite(bounds.left) || !Number.isFinite(bounds.right) ||
    !Number.isFinite(bounds.top) || !Number.isFinite(bounds.bottom) || width <= 0 || height <= 0 ||
    width > bounds.right - bounds.left || height + POINTER_GAP > bounds.bottom - bounds.top) return false;

  out.x = Math.max(bounds.left, Math.min(anchorX - width / 2, bounds.right - width));
  const above = anchorY - POINTER_GAP - height;
  const below = anchorY + POINTER_GAP;
  if (above >= bounds.top) {
    out.y = Math.min(above, bounds.bottom - height);
    out.pointerSide = "bottom";
    out.pointerHeight = anchorY - out.y - height;
  } else if (below + height <= bounds.bottom) {
    out.y = Math.max(bounds.top, below);
    out.pointerSide = "top";
    out.pointerHeight = out.y - anchorY;
  } else {
    // Neither side fits without covering the anchor; hide rather than detach the pointer.
    return false;
  }
  out.pointerTipX = anchorX - out.x;
  // The painted triangle must extend beyond the label when the anchor is at a
  // viewport edge. A clip-path alone cannot paint outside its background box.
  out.pointerLeft = Math.min(0, out.pointerTipX);
  out.pointerWidth = Math.max(width, out.pointerTipX) - out.pointerLeft;
  const inset = Math.min(13, width / 2);
  out.pointerBaseX = Math.max(inset, Math.min(out.pointerTipX, width - inset));
  return true;
}
