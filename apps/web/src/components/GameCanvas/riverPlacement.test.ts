import { describe, expect, it } from "vitest";
import {
  ABUKUMA_RIVER_CENTERLINE,
  NEAR_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M,
  PLACEABLE_CORRIDOR_HALF_WIDTH_M,
} from "./abukumaRiverGeometry";
import {
  isInPlaceableRiverZone,
  nearestPointOnRiverCenterline,
  resolvePlaceablePosition,
} from "./riverPlacement";

function offsetFromCenterline(distanceMeters: number, bearingEast = true) {
  const mid = ABUKUMA_RIVER_CENTERLINE[Math.floor(ABUKUMA_RIVER_CENTERLINE.length / 2)];
  if (mid === undefined) {
    throw new Error("centerline missing");
  }
  const metersPerDegreeLon = 111_320 * Math.cos((mid.lat * Math.PI) / 180);
  const sign = bearingEast ? 1 : -1;
  return {
    longitude: mid.lon + (sign * distanceMeters) / metersPerDegreeLon,
    latitude: mid.lat,
    height: 20,
  };
}

describe("resolvePlaceablePosition", () => {
  it("中心線上（河道）は配置できる", () => {
    const mid = ABUKUMA_RIVER_CENTERLINE[10];
    expect(mid).toBeDefined();
    if (mid === undefined) {
      return;
    }
    const result = resolvePlaceablePosition({
      longitude: mid.lon,
      latitude: mid.lat,
      height: 18,
    });
    expect(result).toBeDefined();
    expect(result?.longitude).toBeCloseTo(mid.lon, 5);
    expect(result?.latitude).toBeCloseTo(mid.lat, 5);
  });

  it("河岸（片岸 55 m）は位置を保ったまま配置できる", () => {
    const bank = offsetFromCenterline(55);
    const nearest = nearestPointOnRiverCenterline(bank.longitude, bank.latitude);
    expect(nearest.distanceMeters).toBeGreaterThan(45);
    expect(nearest.distanceMeters).toBeLessThan(PLACEABLE_CORRIDOR_HALF_WIDTH_M);

    const result = resolvePlaceablePosition(bank);
    expect(result).toBeDefined();
    expect(result?.longitude).toBeCloseTo(bank.longitude, 6);
    expect(result?.latitude).toBeCloseTo(bank.latitude, 6);
  });

  it("本川付近でも中心線へスナップせずドロップ位置を維持する", () => {
    const nearCenter = offsetFromCenterline(12);
    const nearest = nearestPointOnRiverCenterline(nearCenter.longitude, nearCenter.latitude);
    expect(nearest.distanceMeters).toBeLessThan(20);

    const result = resolvePlaceablePosition(nearCenter);
    expect(result).toBeDefined();
    expect(result?.longitude).toBeCloseTo(nearCenter.longitude, 6);
    expect(result?.latitude).toBeCloseTo(nearCenter.latitude, 6);
    expect(result?.longitude).not.toBeCloseTo(nearest.longitude, 6);
  });

  it("帯内の任意距離（片岸 30 m / 70 m）でもそのまま置ける", () => {
    for (const distance of [30, 70]) {
      const spot = offsetFromCenterline(distance);
      const result = resolvePlaceablePosition(spot);
      expect(result, `${distance}m`).toBeDefined();
      expect(result?.longitude).toBeCloseTo(spot.longitude, 6);
      expect(result?.latitude).toBeCloseTo(spot.latitude, 6);
    }
  });

  it("市街地側（片岸 150 m）には置けない", () => {
    const urban = offsetFromCenterline(150);
    const nearest = nearestPointOnRiverCenterline(urban.longitude, urban.latitude);
    expect(nearest.distanceMeters).toBeGreaterThan(PLACEABLE_CORRIDOR_HALF_WIDTH_M);
    expect(resolvePlaceablePosition(urban)).toBeUndefined();
    expect(isInPlaceableRiverZone(urban)).toBe(false);
  });

  it("配置可能半幅は決壊近傍の影響目安より狭い", () => {
    expect(PLACEABLE_CORRIDOR_HALF_WIDTH_M).toBeLessThan(NEAR_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M);
  });
});
