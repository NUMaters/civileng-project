import { describe, expect, it } from "vitest";
import { resolveRainDrama } from "./rainDrama";

describe("resolveRainDrama", () => {
  it("準備中は 0", () => {
    expect(
      resolveRainDrama({
        phase: "preparation",
        rainfallIntensity: 1,
        overflowMeters: 2,
        floodDepthMeters: 2,
        damagePercent: 80,
      }),
    ).toBe(0);
  });

  it("災害中は雨勢だけで立ち上がる", () => {
    const mild = resolveRainDrama({
      phase: "disaster",
      rainfallIntensity: 0.4,
      overflowMeters: 0,
      floodDepthMeters: 0,
      damagePercent: 0,
    });
    expect(mild).toBeGreaterThan(0.15);
    expect(mild).toBeLessThan(0.45);
  });

  it("溢れ・被害が増えると演出が強まる", () => {
    const calm = resolveRainDrama({
      phase: "disaster",
      rainfallIntensity: 0.55,
      overflowMeters: 0,
      floodDepthMeters: 0,
      damagePercent: 0,
    });
    const crisis = resolveRainDrama({
      phase: "disaster",
      rainfallIntensity: 0.55,
      overflowMeters: 1.2,
      floodDepthMeters: 1.1,
      damagePercent: 45,
    });
    expect(crisis).toBeGreaterThan(calm + 0.2);
  });
});
