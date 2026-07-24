/** ドック上で軸を確定するまでの最小移動量（CSS px）。 */
export const DOCK_GESTURE_LOCK_PX = 12;

export type DockPointerIntent = "pending" | "scroll" | "drag";

/**
 * ドックカードのポインタ意図を判定する。
 * 横移動が優勢ならスクロール、縦（上方向の配置）が優勢ならドラッグ。
 * 同程度の斜めはスクロールを優先し、誤ドラッグを抑える。
 */
export function resolveDockPointerIntent(dx: number, dy: number, lockPx = DOCK_GESTURE_LOCK_PX): DockPointerIntent {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < lockPx && ay < lockPx) {
    return "pending";
  }
  // 横が同等以上ならスクロール（ドックの横送りを優先）
  if (ax >= ay) {
    return "scroll";
  }
  return "drag";
}
