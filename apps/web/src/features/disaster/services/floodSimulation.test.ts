import { loadRules } from "@civilcraft/game-data/load";
import { describe, expect, it } from "vitest";
import type { PlacedStructure } from "../../construction";
import {
  advanceFloodSimulation,
  beginDisaster,
  calculateMitigation,
  calculateOverflowSites,
  calculatePlacementEffectiveness,
  createInitialFloodState,
  DEFAULT_WEATHER_SEED,
  enterReview,
  refreshPlacementEffects,
  reopenResult,
} from "./floodSimulation";

const CLEAR_THRESHOLD = loadRules().victory.clearThresholdPercent;
const DISASTER_SECONDS = loadRules().timing.phases.disasterSeconds;

/** キャンパスコア弱点の河岸に、堤体が川沿いになる向きの堤防を置く。 */
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

function place(
  id: string,
  structureId: string,
  longitude: number,
  latitude: number,
  headingDegrees: number,
): PlacedStructure {
  return {
    id,
    structureId,
    position: { longitude, latitude, height: 20 },
    headingDegrees,
  };
}

const CORE = bankLevee("levee-core", 140.37776, 37.359853, 140);
const SOUTH = bankLevee("levee-south", 140.37492, 37.357985, 155);
const NORTH = bankLevee("levee-north", 140.38349, 37.364066, 130);
const REVETMENT = place("rev-bend", "revetment", 140.385275, 37.371045, 110);
const PUMP = place("pump-inland", "drainage-pump", 140.3791, 37.36035, 50);
const BASIN = place("basin-south", "retention-basin", 140.3762, 37.3584, 90);

/** 越水・侵食・内水・貯留を組み合わせた適所配置。 */
const BALANCED_DEFENSE = [CORE, SOUTH, NORTH, REVETMENT, PUMP, BASIN];

function startDisaster() {
  return beginDisaster(createInitialFloodState(), { weatherSeed: DEFAULT_WEATHER_SEED });
}

function runToResult(placements: PlacedStructure[]) {
  let state = startDisaster();
  for (let second = 0; second < DISASTER_SECONDS + 2; second += 1) {
    state = advanceFloodSimulation(state, placements);
  }
  return state;
}

function channelMisplacedLevee(): PlacedStructure {
  return {
    id: "levee-channel",
    structureId: "levee",
    position: { longitude: 140.37737, latitude: 37.36024, height: 17 },
    headingDegrees: 50,
  };
}

describe("floodSimulation", () => {
  it("施設がない場合は大雨で浸水被害が発生する", () => {
    const state = runToResult([]);

    expect(state.phase).toBe("result");
    expect(state.damagePercent).toBeGreaterThan(CLEAR_THRESHOLD);
    expect(state.isClear).toBe(false);
  });

  it("堤防1基だけではクリアできない", () => {
    const state = runToResult([CORE]);
    expect(state.isClear).toBe(false);
    expect(state.damagePercent).toBeGreaterThan(CLEAR_THRESHOLD);
  });

  it("同種の堤防を重ねるだけではクリアできない", () => {
    const state = runToResult([CORE, SOUTH, NORTH]);
    expect(state.isClear).toBe(false);
    expect(state.damagePercent).toBeGreaterThan(CLEAR_THRESHOLD);
  });

  it("適所の混成配置ならクリアできる", () => {
    const state = runToResult(BALANCED_DEFENSE);

    expect(state.phase).toBe("result");
    expect(state.damagePercent).toBeLessThan(CLEAR_THRESHOLD);
    expect(state.isClear).toBe(true);
    expect(state.score).toBeGreaterThan(1_500);
  });

  it("適所混成は無防備より被害を大きく減らす", () => {
    const bare = runToResult([]);
    const defended = runToResult(BALANCED_DEFENSE);

    expect(defended.damagePercent).toBeLessThan(bare.damagePercent * 0.25);
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
    const distant = calculateMitigation([bankLevee("far", 140.395, 37.36, 50)]);

    expect(nearby.overflowPrevention).toBeGreaterThan(distant.overflowPrevention);
  });

  it("決壊口への排水機場は誤配置で被害が増える", () => {
    const pumpOnBreach = place("pump-wrong", "drainage-pump", 140.37776, 37.359853, 50);
    const bare = runToResult([]);
    const wrong = runToResult([pumpOnBreach]);
    expect(wrong.damagePercent).toBeGreaterThan(bare.damagePercent);
    expect(wrong.mitigation.placementInterference).toBeGreaterThan(0.3);
  });

  it("内水地点の堤防は干渉を生み、適所堤防より効果が薄い", () => {
    const inlandLevee = place("levee-inland", "levee", 140.3791, 37.36035, 140);
    const fit = calculateMitigation([CORE]);
    const mismatch = calculateMitigation([inlandLevee]);
    expect(mismatch.placementInterference).toBeGreaterThan(fit.placementInterference);
    expect(mismatch.overflowPrevention).toBeLessThan(fit.overflowPrevention);
  });

  it("同種施設の追加は全球効果が逓減する", () => {
    const one = calculateMitigation([CORE]);
    const two = calculateMitigation([CORE, SOUTH]);
    const three = calculateMitigation([CORE, SOUTH, NORTH]);
    const gain12 = two.overflowPrevention - one.overflowPrevention;
    const gain23 = three.overflowPrevention - two.overflowPrevention;
    expect(gain12).toBeGreaterThan(gain23);
  });

  it("雨量は時間経過で落ち着いたり強まったりする", () => {
    let state = startDisaster();
    const samples: number[] = [];
    for (let second = 0; second < 60; second += 1) {
      state = advanceFloodSimulation(state, []);
      samples.push(state.rainfallIntensity);
    }
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    expect(max - min).toBeGreaterThan(0.12);
    expect(min).toBeLessThan(0.55);
    expect(max).toBeGreaterThan(0.45);
  });

  it("越水時は局所流出地点が現れ、近傍の堤防で抑えられる", () => {
    let unprotected = startDisaster();
    for (let second = 0; second < DISASTER_SECONDS - 10; second += 1) {
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

  it("越水後にのみ氾濫原指標が立つ", () => {
    let state = startDisaster();
    expect(state.floodplainFillRatio).toBe(0);

    for (let second = 0; second < 30; second += 1) {
      state = advanceFloodSimulation(state, []);
    }
    // 増水途中でも越水前は 0（街全体の冠水表現に使わない）。
    if (state.overflowMeters < 0.02) {
      expect(state.floodplainFillRatio).toBe(0);
    }

    for (let second = 0; second < DISASTER_SECONDS; second += 1) {
      state = advanceFloodSimulation(state, []);
    }
    expect(state.overflowMeters).toBeGreaterThan(0.05);
    expect(state.floodplainFillRatio).toBeGreaterThan(0.2);
    expect(state.floodplainHalfWidthMeters).toBeGreaterThan(0);
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

  it("仮配置の影響圏は弱点カバー状態を示す", () => {
    const preview = { ...CORE, id: "preview-levee", preview: true as const };
    const state = refreshPlacementEffects(createInitialFloodState(), [preview]);
    const influence = state.structureInfluences[0];
    expect(influence?.zoneMeaning).toContain("帯");
    expect(influence?.coverageTone).toBe("good");
    expect(influence?.coverageHint).toContain("カバー");
    expect(influence?.coveredSiteIds.length).toBeGreaterThan(0);
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
    let state = runToResult([]);
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

    const withLevee = runToResult([leveeAtCore]);
    const withPump = runToResult([pumpAtCore]);

    expect(withLevee.damagePercent).toBeLessThan(withPump.damagePercent);
    expect(withPump.mitigation.placementInterference).toBeGreaterThan(
      withLevee.mitigation.placementInterference,
    );
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

    const withRevetment = runToResult([revetmentAtBend]);
    const withLevee = runToResult([leveeAtBend]);

    const revSite = withRevetment.overflowSites.find((site) => site.id === "north-bend");
    const leveeSite = withLevee.overflowSites.find((site) => site.id === "north-bend");
    expect(leveeSite?.intensity ?? 0).toBeGreaterThanOrEqual(revSite?.intensity ?? 0);
  });
});
