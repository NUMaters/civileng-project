import { describe, expect, it } from "vitest";
import type { PlacedStructure } from "../../construction";
import {
  advanceFloodSimulation,
  beginDisaster,
  calculateMitigation,
  calculateOverflowSites,
  calculatePlacementEffectiveness,
  createInitialFloodState,
  refreshPlacementEffects,
} from "./floodSimulation";

/** キャンパスコア弱点の河岸に、川沿い向きの堤防を置く。 */
function bankLevee(
  id: string,
  longitude: number,
  latitude: number,
  headingDegrees = 50,
): PlacedStructure {
  return {
    id,
    structureId: "levee",
    position: { longitude, latitude, height: 22 },
    headingDegrees,
  };
}

const CORE = bankLevee("levee-core", 140.37776, 37.359853, 50);
const SOUTH = bankLevee("levee-south", 140.37492, 37.357985, 65);
const NORTH = bankLevee("levee-north", 140.38349, 37.364066, 40);

function channelMisplacedLevee(): PlacedStructure {
  return {
    id: "levee-channel",
    structureId: "levee",
    // 中心線付近・向きが流出方向と合いにくい
    position: { longitude: 140.37737, latitude: 37.36024, height: 17 },
    headingDegrees: 140,
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

  it("主要弱点を河岸堤防で押さえると被害が大きく減る", () => {
    let bare = beginDisaster(createInitialFloodState());
    let defended = beginDisaster(createInitialFloodState());
    const placements = [CORE, SOUTH, NORTH];
    for (let second = 0; second < 90; second += 1) {
      bare = advanceFloodSimulation(bare, []);
      defended = advanceFloodSimulation(defended, placements);
    }

    expect(defended.damagePercent).toBeLessThan(bare.damagePercent * 0.55);
    expect(defended.mitigation.averageEffectiveness).toBeGreaterThan(0.5);
    expect(defended.overflowSites.length).toBeLessThan(bare.overflowSites.length);
  });

  it("河岸＋適切な向きの堤防は、河道の誤配置より効く", () => {
    const bank = calculateMitigation([CORE]);
    const channel = calculateMitigation([channelMisplacedLevee()]);

    expect(bank.overflowPrevention).toBeGreaterThan(channel.overflowPrevention);
    expect(bank.averageEffectiveness).toBeGreaterThan(channel.averageEffectiveness);
  });

  it("川から遠い配置は効果が小さくなる", () => {
    const nearby = calculateMitigation([CORE]);
    const distant = calculateMitigation([
      bankLevee("far", 140.395, 37.36, 50),
    ]);

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
    const sitesWithLevee = calculateOverflowSites([CORE], 0.8, 0.4);
    const coreWithout =
      sitesWithoutLevee.find((site) => site.id === "campus-core")?.intensity ?? 0;
    const coreWith = sitesWithLevee.find((site) => site.id === "campus-core")?.intensity ?? 0;
    expect(coreWith).toBeLessThan(coreWithout);
  });

  it("水位上昇に伴い氾濫原が拡大する", () => {
    let state = beginDisaster(createInitialFloodState());
    expect(state.floodplainFillRatio).toBe(0);

    for (let second = 0; second < 40; second += 1) {
      state = advanceFloodSimulation(state, []);
    }
    expect(state.floodplainFillRatio).toBeGreaterThan(0.2);
    expect(state.floodplainHalfWidthMeters).toBeGreaterThanOrEqual(200);

    for (let second = 0; second < 50; second += 1) {
      state = advanceFloodSimulation(state, []);
    }
    expect(state.floodplainFillRatio).toBeGreaterThan(0.7);
    expect(state.floodplainHalfWidthMeters).toBeGreaterThan(200);
  });

  it("堤防配置で影響圏と治水効果が可視化用に出る", () => {
    const state = refreshPlacementEffects(createInitialFloodState(), [CORE]);
    expect(state.structureInfluences).toHaveLength(1);
    expect(state.structureInfluences[0]?.radiusMeters).toBeGreaterThan(200);
    expect(state.structureInfluences[0]?.effectiveness).toBeGreaterThan(0.45);
    expect(state.mitigation.activeStructureCount).toBe(1);
    expect(state.mitigation.overflowPrevention).toBeGreaterThan(0.25);
  });

  it("向きが川と直交する堤防は平行な堤防より配置効率が低い", () => {
    const aligned = calculatePlacementEffectiveness(CORE);
    const skewed = calculatePlacementEffectiveness({
      ...CORE,
      id: "skew",
      headingDegrees: CORE.headingDegrees + 90,
    });
    expect(aligned).toBeGreaterThan(skewed);
  });
});
