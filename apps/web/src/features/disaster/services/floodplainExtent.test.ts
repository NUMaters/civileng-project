import { describe, expect, it } from "vitest";
import {
  calculateFloodplainExtent,
  FLOODPLAIN_WARN_LEVEL_METERS,
  FULL_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M,
  NEAR_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M,
  NORMAL_CHANNEL_HALF_WIDTH_M,
} from "./floodplainExtent";

describe("calculateFloodplainExtent", () => {
  it("通常水位では氾濫原を出さない", () => {
    const extent = calculateFloodplainExtent({
      riverLevelMeters: 2.2,
      overflowMeters: 0,
    });
    expect(extent.fillRatio).toBe(0);
    expect(extent.halfWidthMeters).toBe(NEAR_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M);
  });

  it("警告水位を超えると氾濫原が立ち上がる", () => {
    const mid = calculateFloodplainExtent({
      riverLevelMeters: (FLOODPLAIN_WARN_LEVEL_METERS + 4.9) / 2,
      overflowMeters: 0,
      overflowLevelMeters: 4.9,
    });
    expect(mid.fillRatio).toBeGreaterThan(0.3);
    expect(mid.fillRatio).toBeLessThan(1);
    expect(mid.halfWidthMeters).toBe(NEAR_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M);
  });

  it("越水すると最大片岸幅へ広がる", () => {
    const flooded = calculateFloodplainExtent({
      riverLevelMeters: 6.2,
      overflowMeters: 1.4,
      overflowLevelMeters: 4.9,
    });
    expect(flooded.fillRatio).toBe(1);
    expect(flooded.halfWidthMeters).toBe(FULL_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M);
  });

  it("平常時片岸より氾濫寸前・最大幅の方が広い", () => {
    expect(NEAR_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M).toBeGreaterThan(NORMAL_CHANNEL_HALF_WIDTH_M);
    expect(FULL_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M).toBeGreaterThan(
      NEAR_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M,
    );
  });
});
