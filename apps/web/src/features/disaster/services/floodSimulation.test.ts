import { describe, expect, it } from "vitest";
import type { PlacedStructure } from "../../construction";
import {
  advanceFloodSimulation,
  beginDisaster,
  calculateMitigation,
  calculateOverflowSites,
  calculatePlacementEffectiveness,
  createInitialFloodState,
  enterReview,
  refreshPlacementEffects,
  reopenResult,
} from "./floodSimulation";

/** キャンパスコア弱点の河岸に、堤体が川沿いになる向きの堤防を置く。
 * 向き矢印は法面側（河道横断）。堤体長軸は向き+90°。
 */
function bankLevee(
  id: string,
  longitude: number,
  latitude: number,
  headingDegrees = 140,
): PlacedStructure {
  return {
    id,
    structureId: "levee",
    position: { longitude, latitude, height: 22 },
    headingDegrees,
  };
}

const CORE = bankLevee("levee-core", 140.37776, 37.359853, 140);
const SOUTH = bankLevee("levee-south", 140.37492, 37.357985, 155);
const NORTH = bankLevee("levee-north", 140.38349, 37.364066, 130);

function channelMisplacedLevee(): PlacedStructure {
  return {
    id: "levee-channel",
    structureId: "levee",
    // 中心線付近・向きが河道に沿い堤体が横断（効きにくい）
    position: { longitude: 140.37737, latitude: 37.36024, height: 17 },
    headingDegrees: 50,
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
    expect(state.structureInfluences[0]?.radiusMeters).toBeGreaterThan(80);
    expect(state.structureInfluences[0]?.zone.kind).toBe("strip");
    expect(state.structureInfluences[0]?.effectiveness).toBeGreaterThan(0.45);
    expect(state.mitigation.activeStructureCount).toBe(1);
    expect(state.mitigation.overflowPrevention).toBeGreaterThan(0.25);
  });

  it("仮配置でも影響圏は出るが防衛数値には乗らない", () => {
    const preview = { ...CORE, id: "preview-levee", preview: true as const };
    const state = refreshPlacementEffects(createInitialFloodState(), [preview]);
    expect(state.structureInfluences).toHaveLength(1);
    expect(state.structureInfluences[0]?.preview).toBe(true);
    expect(state.structureInfluences[0]?.zone.kind).toBe("strip");
    expect(state.mitigation.activeStructureCount).toBe(0);
    expect(state.mitigation.overflowPrevention).toBe(0);
  });

  it("堤体が川と直交する向きは、堤体が川沿いの向きより配置効率が低い", () => {
    const aligned = calculatePlacementEffectiveness(CORE);
    const skewed = calculatePlacementEffectiveness({
      ...CORE,
      id: "skew",
      headingDegrees: CORE.headingDegrees + 90,
    });
    expect(aligned).toBeGreaterThan(skewed);
  });

  it("結果からプレビューへ遷移でき、プレビュー中は状態が凍結される", () => {
    let state = beginDisaster(createInitialFloodState());
    for (let second = 0; second < 90; second += 1) {
      state = advanceFloodSimulation(state, []);
    }
    expect(state.phase).toBe("result");
    const damage = state.damagePercent;

    state = enterReview(state);
    expect(state.phase).toBe("review");
    expect(state.damagePercent).toBe(damage);

    state = advanceFloodSimulation(state, [], 5);
    expect(state.phase).toBe("review");
    expect(state.damagePercent).toBe(damage);

    state = reopenResult(state);
    expect(state.phase).toBe("result");
  });

  it("越水点には堤防が効き、排水機場だけでは抑えきれない", () => {
    const leveeAtCore: PlacedStructure = {
      id: "levee-core",
      structureId: "levee",
      position: { longitude: 140.37776, latitude: 37.359853, height: 22 },
      headingDegrees: 140,
    };
    const pumpAtCore: PlacedStructure = {
      id: "pump-core",
      structureId: "drainage-pump",
      position: { longitude: 140.37776, latitude: 37.359853, height: 18 },
      headingDegrees: 50,
    };

    let withLevee = beginDisaster(createInitialFloodState());
    let withPump = beginDisaster(createInitialFloodState());
    for (let second = 0; second < 90; second += 1) {
      withLevee = advanceFloodSimulation(withLevee, [leveeAtCore]);
      withPump = advanceFloodSimulation(withPump, [pumpAtCore]);
    }

    const leveeCore = withLevee.overflowSites.find((site) => site.id === "campus-core");
    const pumpCore = withPump.overflowSites.find((site) => site.id === "campus-core");
    expect(pumpCore?.intensity ?? 0).toBeGreaterThan(leveeCore?.intensity ?? 0);
    expect(withLevee.damagePercent).toBeLessThan(withPump.damagePercent);
  });

  it("侵食点には護岸が効き、堤防だけでは抑えきれない", () => {
    const revetmentAtBend: PlacedStructure = {
      id: "rev-bend",
      structureId: "revetment",
      position: { longitude: 140.385275, latitude: 37.371045, height: 21 },
      headingDegrees: 110,
    };
    const leveeAtBend: PlacedStructure = {
      id: "levee-bend",
      structureId: "levee",
      position: { longitude: 140.385275, latitude: 37.371045, height: 21 },
      headingDegrees: 110,
    };

    let withRevetment = beginDisaster(createInitialFloodState());
    let withLevee = beginDisaster(createInitialFloodState());
    for (let second = 0; second < 90; second += 1) {
      withRevetment = advanceFloodSimulation(withRevetment, [revetmentAtBend]);
      withLevee = advanceFloodSimulation(withLevee, [leveeAtBend]);
    }

    const revSite = withRevetment.overflowSites.find((site) => site.id === "north-bend");
    const leveeSite = withLevee.overflowSites.find((site) => site.id === "north-bend");
    expect(leveeSite?.intensity ?? 0).toBeGreaterThanOrEqual(revSite?.intensity ?? 0);
  });
});
