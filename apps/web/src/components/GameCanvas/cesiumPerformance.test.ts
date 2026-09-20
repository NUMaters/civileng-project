import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCesiumRenderProfile,
  resolveCesiumRenderProfile,
  resolveCesiumResolutionScale,
} from "./cesiumPerformance";

describe("cesiumPerformance", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a non-mobile profile by default in node", () => {
    const profile = resolveCesiumRenderProfile();
    expect(["desktop", "low"]).toContain(profile.id);
    expect(profile.loadBuildings).toBe(true);
  });

  it("keeps 3D buildings enabled for the mobile profile", () => {
    vi.stubGlobal("window", {
      matchMedia: vi.fn().mockReturnValue({ matches: true }),
    });
    vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 8 });

    const profile = resolveCesiumRenderProfile();

    expect(profile.id).toBe("mobile");
    expect(profile.loadBuildings).toBe(true);
    expect(profile.buildingMaximumScreenSpaceError).toBeLessThanOrEqual(20);
    expect(profile.resolutionScaleFloor).toBeGreaterThanOrEqual(0.5);
    expect(profile.overlayFrameIntervalMs).toBeLessThanOrEqual(1000 / 24);
  });

  it("disables 3D buildings as a fallback on low-end mobile devices", () => {
    vi.stubGlobal("window", {
      matchMedia: vi.fn().mockReturnValue({ matches: true }),
    });
    vi.stubGlobal("navigator", { hardwareConcurrency: 4, deviceMemory: 4 });

    const profile = resolveCesiumRenderProfile();

    expect(profile.id).toBe("mobile");
    expect(profile.loadBuildings).toBe(false);
  });

  it("caps resolution scale with profile floor", () => {
    const profile = getCesiumRenderProfile();
    const scale = resolveCesiumResolutionScale(profile);
    expect(scale).toBeGreaterThanOrEqual(profile.resolutionScaleFloor);
    expect(scale).toBeLessThanOrEqual(1);
  });
});
