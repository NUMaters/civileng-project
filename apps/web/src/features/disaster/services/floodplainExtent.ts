/**
 * 氾濫原（氾濫寸前〜越水）の幅・水位しきい値。
 * 平常時の本川水面幅は `riverWaterSurface` 側のまま変えず、ここは拡大流域専用。
 */

/** 平常時本川コリドー片岸幅の目安（m）。参考値。 */
export const NORMAL_CHANNEL_HALF_WIDTH_M = 42;

/**
 * 氾濫寸前に想定する河道沿い氾濫原の片岸幅（m）。
 * 本川外側の低地・堤内地側の冠水帯を含む。
 */
export const NEAR_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M = 200;

/** 越水後にさらに広がる最大片岸幅（m）。 */
export const FULL_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M = 320;

/**
 * 氾濫原の視認を開始する水位（m）。
 * 計画高水位（約 4.9 m）手前から河道沿い帯を広げ始める。
 */
export const FLOODPLAIN_WARN_LEVEL_METERS = 3.6;

/**
 * 水位・越水量から氾濫原の塗りつぶし率（0〜1）と描画半幅（m）を求める。
 * 通常水位では fillRatio=0。警告水位を超えてから立ち上がり、越水で最大幅へ伸びる。
 */
export function calculateFloodplainExtent(input: {
  riverLevelMeters: number;
  overflowMeters: number;
  overflowLevelMeters?: number;
}): { fillRatio: number; halfWidthMeters: number } {
  const overflowLevel = input.overflowLevelMeters ?? 4.9;
  const approachSpan = Math.max(0.5, overflowLevel - FLOODPLAIN_WARN_LEVEL_METERS);
  const approachRatio = clamp01(
    (input.riverLevelMeters - FLOODPLAIN_WARN_LEVEL_METERS) / approachSpan,
  );
  const overflowBoost = clamp01(input.overflowMeters / 1.4);
  const fillRatio = clamp01(
    Math.max(approachRatio, overflowBoost > 0 ? 0.55 + overflowBoost * 0.45 : 0),
  );
  const halfWidthMeters =
    NEAR_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M +
    (FULL_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M - NEAR_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M) *
      overflowBoost;
  return { fillRatio, halfWidthMeters };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
