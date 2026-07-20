import { describe, expect, it } from "vitest";
import type { PlacedStructure } from "../../construction";
import {
  advanceFloodSimulation,
  beginDisaster,
  calculateMitigation,
  calculateOverflowSites,
  createInitialFloodState,
} from "./floodSimulation";

function placement(structureId: string, longitude = 140.3838): PlacedStructure {
  return {
    id: `${structureId}-test`,
    structureId,
    position: { longitude, latitude: 37.3598, height: 0 },
    headingDegrees: 0,
  };
}

describe("floodSimulation", () => {
  it("施設がない場合は大雨で浸水被害が発生する", () => {
    let state = beginDisaster(createInitialFloodState());
    for (let second = 0; second < 90; second += 1) {
      state = advanceFloodSimulation(state, []);
    }

    expect(state.phase).toBe("result");
    expect(state.damagePercent).toBeGreaterThan(5);
    expect(state.isClear).toBe(false);
  });

  it("重点地点付近の堤防は被害をクリア閾値未満に抑える", () => {
    let state = beginDisaster(createInitialFloodState());
    const placements = [placement("levee")];
    for (let second = 0; second < 90; second += 1) {
      state = advanceFloodSimulation(state, placements);
    }

    expect(state.phase).toBe("result");
    expect(state.damagePercent).toBeLessThan(5);
    expect(state.isClear).toBe(true);
  });

  it("重点地点から離れるほど同じ施設の効果が小さくなる", () => {
    const nearby = calculateMitigation([placement("levee")]);
    const distant = calculateMitigation([placement("levee", 140.395)]);

    expect(nearby.overflowPrevention).toBeGreaterThan(distant.overflowPrevention);
  });

  it("越水時は局所流出地点が現れ、近傍の堤防で抑えられる", () => {
    let unprotected = beginDisaster(createInitialFloodState());
    for (let second = 0; second < 75; second += 1) {
      unprotected = advanceFloodSimulation(unprotected, []);
    }
    expect(unprotected.overflowMeters).toBeGreaterThan(0.05);
    expect(unprotected.overflowSites.length).toBeGreaterThan(0);

    const sitesWithoutLevee = calculateOverflowSites([], 0.8, 0.4);
    const sitesWithLevee = calculateOverflowSites([placement("levee")], 0.8, 0.4);
    const coreWithout =
      sitesWithoutLevee.find((site) => site.id === "campus-core")?.intensity ?? 0;
    const coreWith = sitesWithLevee.find((site) => site.id === "campus-core")?.intensity ?? 0;
    expect(coreWith).toBeLessThan(coreWithout);
  });
});
