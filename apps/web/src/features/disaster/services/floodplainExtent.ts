/**
 * 氾濫原指標（シミュレーション用）。
 * 画面上の河道沿い広域水色帯には使わない（浸水は決壊地点の可視化のみ）。
 */

/** 平常時本川コリドー片岸幅の目安（m）。参考値。 */
export const NORMAL_CHANNEL_HALF_WIDTH_M = 42;

/**
 * 越水後に想定する決壊近傍の影響半径の目安（m）。
 * かつての河道沿い広域帯（200〜320 m）は使わない。
 */
export const NEAR_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M = 90;

/** 強い越水時の最大片岸相当（m）。決壊プルーム用の上限目安。 */
export const FULL_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M = 140;

/**
 * 指標の立ち上がりに使う水位（m）。描画は overflowMeters が立ってから。
 */
export const FLOODPLAIN_WARN_LEVEL_METERS = 4.5;

/**
 * 越水しているときだけ fillRatio > 0。
 * 増水だけでは 0（街が冠水しているように見せない）。
 */
export function calculateFloodplainExtent(input: {
  riverLevelMeters: number;
  overflowMeters: number;
  overflowLevelMeters?: number;
}): { fillRatio: number; halfWidthMeters: number } {
  const overflowBoost = clamp01(input.overflowMeters / 1.2);
  if (overflowBoost < 0.02) {
    return { fillRatio: 0, halfWidthMeters: 0 };
  }
  const fillRatio = overflowBoost;
  const halfWidthMeters =
    NEAR_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M +
    (FULL_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M - NEAR_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M) *
      smoothstep(overflowBoost);
  return { fillRatio, halfWidthMeters };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}
