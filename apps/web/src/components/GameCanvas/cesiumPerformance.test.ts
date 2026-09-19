import { describe, expect, it } from "vitest";
import {
  getCesiumRenderProfile,
  resolveCesiumRenderProfile,
  resolveCesiumResolutionScale,
} from "./cesiumPerformance";

describe("cesiumPerformance", () => {
  it("returns a non-mobile profile by default in node", () => {
    const profile = resolveCesiumRenderProfile();
    expect(["desktop", "low"]).toContain(profile.id);
    expect(profile.loadBuildings).toBe(true);
  });

  it("caps resolution scale with profile floor", () => {
    const profile = getCesiumRenderProfile();
    const scale = resolveCesiumResolutionScale(profile);
    expect(scale).toBeGreaterThanOrEqual(profile.resolutionScaleFloor);
    expect(scale).toBeLessThanOrEqual(1);
  });
});
