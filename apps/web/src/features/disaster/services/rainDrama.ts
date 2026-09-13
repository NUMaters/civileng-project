/**
 * 大雨演出の強さ（0〜1）。
 * 雨勢そのものに加え、溢れ・水深・被害が増えるほど盛り上げる。
 */
export function resolveRainDrama(input: {
  phase: string;
  rainfallIntensity: number;
  overflowMeters: number;
  floodDepthMeters: number;
  damagePercent: number;
}): number {
  if (input.phase !== "disaster" && input.phase !== "result" && input.phase !== "review") {
    return 0;
  }
  const rain = clamp01(input.rainfallIntensity);
  const crisis = clamp01(
    input.overflowMeters / 1.15 +
      input.floodDepthMeters / 1.4 +
      input.damagePercent / 85,
  );
  // 平常の雨＋危機時の増幅。ピークでほぼ真っ黒な豪雨になる。
  return clamp01(rain * 0.5 + crisis * 0.55 + rain * crisis * 0.4);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
