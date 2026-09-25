import type { RiverHydraulics } from "./riverWaterSurface";

type WaterStyle = { speed: number; muddy: number; amplitude: number; specular: number };
type TextureFrame = {
  widthMeters: number;
  heightMeters: number;
  east: number;
  north: number;
};

function bounded(value: number, max = 1): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : 0;
}

/** Bounded visual response, not a replacement for the flood simulation. */
export function hydraulicsToWaterStyle(hydraulics: RiverHydraulics): WaterStyle {
  const level = bounded((hydraulics.riverLevelMeters - 2.2) / 4.4);
  const rain = bounded(hydraulics.rainfallIntensity);
  const overflow = bounded(hydraulics.overflowMeters / 3);
  const calm = bounded(hydraulics.mitigationCalm ?? 0);
  const flood = hydraulics.activeFlood ? level : 0;
  return {
    speed: (0.8 + level * 1.2 + rain * 0.5 + overflow * 0.8 + flood * 0.4) * (1 - calm * 0.35),
    muddy: bounded(level * 0.5 + rain * 0.2 + overflow * 0.3),
    amplitude: (0.22 + level * 0.12 + rain * 0.08 + overflow * 0.08) * (1 - calm * 0.3),
    specular: 0.06 + level * 0.025,
  };
}

/** Exponential interpolation has the same response at 12, 24 and 60 Hz. */
export function smoothWaterStyle(from: WaterStyle, to: WaterStyle, seconds: number): WaterStyle {
  const alpha = 1 - Math.exp(-3.1 * Math.max(0, seconds));
  return {
    speed: from.speed + (to.speed - from.speed) * alpha,
    muddy: from.muddy + (to.muddy - from.muddy) * alpha,
    amplitude: from.amplitude + (to.amplitude - from.amplitude) * alpha,
    specular: from.specular + (to.specular - from.specular) * alpha,
  };
}

/** Rectangle uses radians. The centerline is upstream south -> downstream north. */
export function riverTextureFrame(
  rectangle: { west: number; east: number; south: number; north: number },
  centerline: ReadonlyArray<{ lon: number; lat: number }>,
): TextureFrame {
  const latitude = (rectangle.north + rectangle.south) / 2;
  const radius = 6_371_000;
  const first = centerline[0];
  const last = centerline[centerline.length - 1];
  const east = first && last ? (last.lon - first.lon) * Math.cos(latitude) : 0;
  const north = first && last ? last.lat - first.lat : 1;
  const length = Math.hypot(east, north);
  return {
    widthMeters: Math.max(1, (rectangle.east - rectangle.west) * radius * Math.cos(latitude)),
    heightMeters: Math.max(1, (rectangle.north - rectangle.south) * radius),
    east: length > 0 ? east / length : 0,
    north: length > 0 ? north / length : 1,
  };
}

/** Reuse the uniform; positive travel + sampling (position - travel) moves north. */
export function advanceRiverFlow(
  offset: { x: number; y: number },
  direction: Pick<TextureFrame, "east" | "north">,
  metersPerSecond: number,
  seconds: number,
): void {
  const distance = metersPerSecond * Math.max(0, seconds);
  offset.x += direction.east * distance;
  offset.y += direction.north * distance;
}
