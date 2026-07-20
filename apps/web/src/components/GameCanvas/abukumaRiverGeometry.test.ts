import { describe, expect, it } from "vitest";
import {
  ABUKUMA_FULL_OVERFLOW_FLOODPLAIN,
  ABUKUMA_NEAR_OVERFLOW_FLOODPLAIN,
  ABUKUMA_PLACEABLE_CORRIDOR,
  ABUKUMA_RIVER_CENTERLINE,
  buildCenterlineCorridorRing,
  NEAR_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M,
  PLACEABLE_CORRIDOR_HALF_WIDTH_M,
} from "./abukumaRiverGeometry";

describe("buildCenterlineCorridorRing", () => {
  it("閉じたリングを返し、中心線上の点を内包する", () => {
    const ring = buildCenterlineCorridorRing(
      ABUKUMA_RIVER_CENTERLINE,
      NEAR_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M,
    );
    expect(ring.length).toBeGreaterThan(ABUKUMA_RIVER_CENTERLINE.length);
    const first = ring[0];
    const last = ring[ring.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    expect(first?.lon).toBeCloseTo(last?.lon ?? 0, 5);
    expect(first?.lat).toBeCloseTo(last?.lat ?? 0, 5);

    const mid = ABUKUMA_RIVER_CENTERLINE[Math.floor(ABUKUMA_RIVER_CENTERLINE.length / 2)];
    expect(mid).toBeDefined();
    if (mid !== undefined) {
      expect(pointInRing(mid.lon, mid.lat, ring)).toBe(true);
      expect(pointInRing(mid.lon + 0.02, mid.lat, ring)).toBe(false);
    }
  });

  it("事前計算した氾濫原ポリゴンが空でない", () => {
    expect(ABUKUMA_NEAR_OVERFLOW_FLOODPLAIN.length).toBeGreaterThan(10);
    expect(ABUKUMA_FULL_OVERFLOW_FLOODPLAIN.length).toBeGreaterThan(10);
  });

  it("配置可能コリドーは中心線を含み、市街地側は含まない", () => {
    expect(ABUKUMA_PLACEABLE_CORRIDOR.length).toBeGreaterThan(10);
    expect(PLACEABLE_CORRIDOR_HALF_WIDTH_M).toBe(75);
    const mid = ABUKUMA_RIVER_CENTERLINE[Math.floor(ABUKUMA_RIVER_CENTERLINE.length / 2)];
    expect(mid).toBeDefined();
    if (mid === undefined) {
      return;
    }
    expect(pointInRing(mid.lon, mid.lat, ABUKUMA_PLACEABLE_CORRIDOR)).toBe(true);
    expect(pointInRing(mid.lon + 0.01, mid.lat, ABUKUMA_PLACEABLE_CORRIDOR)).toBe(false);
  });
});

function pointInRing(
  longitude: number,
  latitude: number,
  ring: ReadonlyArray<{ lon: number; lat: number }>,
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const pi = ring[i];
    const pj = ring[j];
    if (pi === undefined || pj === undefined) {
      continue;
    }
    const intersects =
      pi.lat > latitude !== pj.lat > latitude &&
      longitude <
        ((pj.lon - pi.lon) * (latitude - pi.lat)) / (pj.lat - pi.lat + Number.EPSILON) + pi.lon;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}
