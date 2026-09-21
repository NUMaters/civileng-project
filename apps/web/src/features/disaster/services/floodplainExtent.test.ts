import { describe, expect, it } from "vitest";
import {
  calculateFloodplainExtent,
  FULL_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M,
  NEAR_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M,
  NORMAL_CHANNEL_HALF_WIDTH_M,
} from "./floodplainExtent";

describe("calculateFloodplainExtent", () => {
  it("増水だけでは氾濫原指標を出さない", () => {
    const calm = calculateFloodplainExtent({
      riverLevelMeters: 2.2,
      overflowMeters: 0,
    });
    expect(calm.fillRatio).toBe(0);
    expect(calm.halfWidthMeters).toBe(0);

    const risen = calculateFloodplainExtent({
      riverLevelMeters: 4.8,
      overflowMeters: 0,
      overflowLevelMeters: 4.9,
    });
    expect(risen.fillRatio).toBe(0);
    expect(risen.halfWidthMeters).toBe(0);
  });

  it("越水すると決壊近傍の指標が立ち上がる", () => {
    const mid = calculateFloodplainExtent({
      riverLevelMeters: 5.4,
      overflowMeters: 0.5,
      overflowLevelMeters: 4.9,
    });
    expect(mid.fillRatio).toBeGreaterThan(0.3);
    expect(mid.fillRatio).toBeLessThan(1);
    expect(mid.halfWidthMeters).toBeGreaterThan(NEAR_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M - 1);
  });

  it("強い越水では最大片岸幅へ近づく", () => {
    const flooded = calculateFloodplainExtent({
      riverLevelMeters: 6.2,
      overflowMeters: 1.4,
      overflowLevelMeters: 4.9,
    });
    expect(flooded.fillRatio).toBe(1);
    expect(flooded.halfWidthMeters).toBe(FULL_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M);
  });

  it("平常時片岸より越水時の目安幅の方が広い", () => {
    expect(NEAR_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M).toBeGreaterThan(NORMAL_CHANNEL_HALF_WIDTH_M);
    expect(FULL_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M).toBeGreaterThan(
      NEAR_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M,
    );
  });
});
