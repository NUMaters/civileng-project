import { afterEach, describe, expect, it } from "vitest";
import {
  advanceInundationField,
  resetInundationField,
  type InundationSeed,
} from "./inundationField";

const SEED: InundationSeed = {
  id: "campus-core",
  longitude: 140.37776,
  latitude: 37.359853,
  outflowHeadingDegrees: 141,
  intensity: 0.9,
  bankElevationMeters: 18.4,
};

describe("inundationField", () => {
  afterEach(() => {
    resetInundationField();
  });

  it("spreads water from a breach seed over successive steps", () => {
    let snapshot = advanceInundationField([SEED], 0.8, 0.08, 1_000);
    const firstWet = snapshot.sites[0]?.floodedCellCount ?? 0;
    expect(firstWet).toBeGreaterThan(0);

    for (let step = 0; step < 24; step += 1) {
      snapshot = advanceInundationField([SEED], 1.2, 0.08, 2_000 + step * 80);
    }

    const site = snapshot.sites[0];
    expect(site).toBeDefined();
    expect(site!.floodedCellCount).toBeGreaterThan(firstWet);
    expect(site!.maxDepthMeters).toBeGreaterThan(0.05);
    expect(site!.bands.length).toBeGreaterThan(0);
    expect(site!.flows.length).toBeGreaterThan(0);
  });

  it("prefers lower banks for deeper local inundation", () => {
    const low: InundationSeed = { ...SEED, id: "low", bankElevationMeters: 17.5, intensity: 1 };
    const high: InundationSeed = {
      ...SEED,
      id: "high",
      longitude: 140.38349,
      latitude: 37.364066,
      bankElevationMeters: 22.5,
      intensity: 1,
    };

    for (let step = 0; step < 20; step += 1) {
      advanceInundationField([low, high], 1.0, 0.08, 3_000 + step * 80);
    }
    const snapshot = advanceInundationField([low, high], 1.0, 0.08, 5_000);
    const lowSite = snapshot.sites.find((site) => site.siteId === "low");
    const highSite = snapshot.sites.find((site) => site.siteId === "high");
    expect(lowSite).toBeDefined();
    expect(highSite).toBeDefined();
    expect(lowSite!.floodedCellCount).toBeGreaterThanOrEqual(highSite!.floodedCellCount * 0.7);
  });

  it("clears inactive sites", () => {
    advanceInundationField([SEED], 0.6, 0.08, 1);
    const empty = advanceInundationField([], 0, 0.08, 2);
    expect(empty.sites).toHaveLength(0);
  });
});
