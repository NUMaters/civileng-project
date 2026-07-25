/** ドック上で軸を確定するまでの最小移動量（CSS px）。 */
export const DOCK_GESTURE_LOCK_PX = 10;

export type DockPointerIntent = "pending" | "scroll" | "drag";

/**
 * ドックカードのポインタ意図を判定する。
 * - 横優勢 → スクロール
 * - 上方向かつ縦が明確に優勢 → 配置ドラッグ
 * - 下方向の縦移動はドラッグにしない（誤開始防止）
 * 斜めはヒステリシスで上方向ドラッグを少し優先しつつ、横送りも守りやすい。
 */
export function resolveDockPointerIntent(dx: number, dy: number, lockPx = DOCK_GESTURE_LOCK_PX): DockPointerIntent {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < lockPx && ay < lockPx) {
    return "pending";
  }
  // 上方向かつ縦が横より明確に大きいときだけ配置ドラッグ
  if (dy < 0 && ay > ax * 1.15) {
    return "drag";
  }
  // それ以外（横・下・曖昧な斜め）はスクロール／無視扱い
  if (ax >= lockPx || dy >= 0) {
    return "scroll";
  }
  return "pending";
}
