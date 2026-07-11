import { describe, expect, it } from "vitest";
import { getCesiumPerformanceSettings } from "./cesiumPerformance";

describe("getCesiumPerformanceSettings", () => {
  it("reduces detail and memory use on mobile devices", () => {
    const mobileSettings = getCesiumPerformanceSettings(true);
    const desktopSettings = getCesiumPerformanceSettings(false);

    expect(mobileSettings.maximumScreenSpaceError).toBeGreaterThan(
      desktopSettings.maximumScreenSpaceError,
    );
    expect(mobileSettings.cacheBytes).toBeLessThan(desktopSettings.cacheBytes);
    expect(mobileSettings.resolutionScale).toBeLessThan(desktopSettings.resolutionScale);
  });

  it("returns stable desktop settings", () => {
    expect(getCesiumPerformanceSettings(false)).toEqual({
      maximumScreenSpaceError: 16,
      cacheBytes: 268_435_456,
      resolutionScale: 1,
    });
  });
});
