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

  it("uses a safe middle profile when mobile memory is not exposed", () => {
    vi.stubGlobal("window", {
      matchMedia: vi.fn().mockReturnValue({ matches: true }),
    });
    vi.stubGlobal("navigator", { hardwareConcurrency: 8 });

    const profile = resolveCesiumRenderProfile();

    expect(profile.id).toBe("mobile");
    expect(profile.loadBuildings).toBe(true);
    expect(profile.targetRenderPixels).toBeLessThan(860_000);
    expect(profile.buildingMaximumScreenSpaceError).toBeGreaterThan(20);
  });

  it("keeps 3D buildings with coarser detail on low-end mobile devices", () => {
    vi.stubGlobal("window", {
      matchMedia: vi.fn().mockReturnValue({ matches: true }),
    });
    vi.stubGlobal("navigator", { hardwareConcurrency: 4, deviceMemory: 4 });

    const profile = resolveCesiumRenderProfile();

    expect(profile.id).toBe("mobile");
    expect(profile.loadBuildings).toBe(true);
    expect(profile.buildingMaximumScreenSpaceError).toBe(32);
    expect(profile.imageryMaximumLevel).toBe(17);
    expect(profile.targetRenderPixels).toBeLessThanOrEqual(860_000);
    expect(profile.waterFlowStreakCount).toBe(0);
  });

  it("uses the mobile budget on landscape touch screens and allows close photo detail", () => {
    vi.stubGlobal("window", {
      matchMedia: vi.fn((query: string) => ({ matches: query.includes("pointer: coarse") })),
      innerWidth: 932,
      innerHeight: 430,
      devicePixelRatio: 3,
    });
    vi.stubGlobal("navigator", { hardwareConcurrency: 8, deviceMemory: 8 });
    const profile = resolveCesiumRenderProfile();
    expect(profile.id).toBe("mobile");
    expect(profile.imageryMaximumLevel).toBe(18);
    const scale = resolveCesiumResolutionScale(profile);
    expect(scale).toBeLessThan(1);
    expect(scale).toBeGreaterThanOrEqual(profile.resolutionScaleFloor);
  });

  it("caps resolution scale with profile floor", () => {
    const profile = getCesiumRenderProfile();
    const scale = resolveCesiumResolutionScale(profile);
    expect(scale).toBeGreaterThanOrEqual(profile.resolutionScaleFloor);
    expect(scale).toBeLessThanOrEqual(1);
  });
});
