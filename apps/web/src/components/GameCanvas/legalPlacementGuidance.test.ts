import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { loadRules, loadStructures } from "@civilcraft/game-data/load";
import { resolveLegalPumpGuidance, type LegalGuidanceSurface } from "./legalPlacementGuidance";
import { listOverflowCandidates } from "../../features/disaster/services/overflowBankSites";
import { getDioramaGuidance } from "./dioramaGuidance";
import { geoToWorld, worldToGeo } from "./dioramaSpace";
import { decodeKoriyamaTerrain, sampleKoriyamaTerrain } from "./koriyamaTerrain";
import type { KoriyamaGeodata } from "./koriyamaGeodata";
import { nearestPointOnRiverCenterline, pointInPolygonDegrees, resolvePlaceablePosition, PLACEABLE_CORRIDOR_HALF_WIDTH_M } from "./riverPlacement";
import { suggestedStructureHeading } from "../../features/disaster/services/hydraulicPlacement";
import { advanceFloodSimulation, beginDisaster, beginPreparation } from "../../features/disaster/services/floodSimulation";
import { applyDisasterStartGrant, INITIAL_BUDGET, placeStructure, tickBudgetEconomy } from "../../features/construction/services/constructionService";
import type { PlacedStructure } from "../../features/construction/types/construction";

const read = (file: string) => readFileSync(new URL(`../../../public/geodata/koriyama/${file}`, import.meta.url));
const terrain = decodeKoriyamaTerrain(Uint8Array.from(read("terrain.bin")).buffer, JSON.parse(read("terrain-metadata.json").toString()));
const data = JSON.parse(read("features.geojson").toString()) as KoriyamaGeodata;
const water = data.features.flatMap(f => f.properties.kind === "water" && f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : []);
const surface: LegalGuidanceSurface = {
  sampleGround: (x, z) => { const p = worldToGeo(x, z); return sampleKoriyamaTerrain(terrain, p.longitude, p.latitude).localY; },
  isWater: p => water.some(rings => {
    const inside = (ring: typeof rings[number]) => pointInPolygonDegrees(p.longitude, p.latitude, ring.map(([lon, lat]) => ({ lon, lat })));
    return inside(rings[0]!) && !rings.slice(1).some(inside);
  }),
};
const site = (id: string) => listOverflowCandidates().find(p => p.id === id)!;

describe("separate legal inland-pump action anchor", () => {
  it.each(["inland-campus", "inland-south"])("keeps %s source fixed and returns a validated land anchor", id => {
    const hazard = Object.freeze({ ...site(id) });
    const before = JSON.stringify(hazard);
    expect(resolvePlaceablePosition({ ...hazard, height: 20 })).toBeUndefined();
    const result = resolveLegalPumpGuidance(hazard, surface), a = result.actionAnchor!;
    expect(result.reason).toBe("available");
    expect(JSON.stringify(hazard)).toBe(before);
    expect(result.source).toEqual(hazard);
    expect(a.derived).toBe(true);
    expect(a.advice).toContain("川岸に排水機場を配置");
    expect(a.position).not.toMatchObject({ longitude: hazard.longitude, latitude: hazard.latitude });
    expect(resolvePlaceablePosition(a.position)).toEqual(a.position);
    expect(surface.isWater(a.position)).toBe(false);
    const local = geoToWorld(a.position.longitude, a.position.latitude);
    expect(a.groundY).toBe(surface.sampleGround(local.x, local.z));
    expect(a.position.height).toBe(worldToGeo(local.x, local.z).height);
    expect(a.headingDegrees).toBe(suggestedStructureHeading("drainage-pump", a.position));
    const nearest = nearestPointOnRiverCenterline(hazard.longitude, hazard.latitude);
    expect(nearestPointOnRiverCenterline(a.position.longitude, a.position.latitude).distanceMeters).toBeLessThan(PLACEABLE_CORRIDOR_HALF_WIDTH_M);
    // Same bank side, on the original source-to-centreline segment, not a new hazard.
    const scale = (a.position.longitude - nearest.longitude) / (hazard.longitude - nearest.longitude);
    expect(scale).toBeGreaterThan(0); expect(scale).toBeLessThan(1);
    expect(a.position.latitude).toBeCloseTo(nearest.latitude + (hazard.latitude - nearest.latitude) * scale, 12);
    console.info("legal pump anchor", id, JSON.stringify(a));
  });

  it("keeps an already legal land anchor unchanged", () => {
    const a = resolveLegalPumpGuidance(site("inland-campus"), surface).actionAnchor!;
    const hazard = { ...site("inland-campus"), longitude: a.position.longitude, latitude: a.position.latitude };
    const result = resolveLegalPumpGuidance(hazard, surface);
    expect(result.actionAnchor?.derived).toBe(false);
    expect(result.actionAnchor?.position).toEqual(a.position);
  });

  it("has bounded work and returns no anchor across water or missing terrain", () => {
    for (const sample of [null, NaN]) {
      const sampleGround = vi.fn(() => sample);
      expect(resolveLegalPumpGuidance(site("inland-campus"), { ...surface, sampleGround }).actionAnchor).toBeNull();
      expect(sampleGround.mock.calls.length).toBeLessThanOrEqual(4);
    }
    const sampleGround = vi.fn(() => 12), isWater = vi.fn(() => true);
    expect(resolveLegalPumpGuidance(site("inland-campus"), { sampleGround, isWater }).reason).toBe("no-legal-bank-anchor");
    expect(sampleGround).not.toHaveBeenCalled();
    expect(isWater.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("validates each fallback rather than accepting a rejected projection", () => {
    const isWater = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const sampleGround = vi.fn(() => 12);
    const result = resolveLegalPumpGuidance(site("inland-campus"), { sampleGround, isWater });
    expect(result.reason).toBe("available");
    expect(isWater).toHaveBeenCalledTimes(2);
    expect(sampleGround).toHaveBeenCalledTimes(1);
    expect(result.actionAnchor?.position).toEqual(isWater.mock.calls[1]![0]);
    expect(resolvePlaceablePosition(result.actionAnchor!.position)).toBeDefined();
  });

  it("does not derive anchors for other hazards or invalid coordinates", () => {
    const sampleGround = vi.fn(() => 12), isWater = vi.fn(() => false);
    expect(resolveLegalPumpGuidance(site("campus-core"), { sampleGround, isWater }).reason).toBe("not-inland-pump");
    expect(resolveLegalPumpGuidance({ ...site("inland-campus"), longitude: NaN }, { sampleGround, isWater }).reason).toBe("invalid-source");
    expect(sampleGround).not.toHaveBeenCalled(); expect(isWater).not.toHaveBeenCalled();
  });
});

describe("ordinary-budget guide strategy — model feasibility, not phone usability", () => {
  it.each([42601, 20260921])("can clear seed %i with six spaced confirmations and no budget override", seed => {
    const rules = loadRules(), definitions = new Map(loadStructures().map(s => [s.id, s]));
    const guides = getDioramaGuidance([]);
    const plan = [
      ["levee", "campus-core"], ["levee", "campus-south"], ["levee", "campus-north"],
      ["revetment", "north-bend"], ["drainage-pump", "inland-campus"], ["retention-basin", "mid-east"],
    ].map(([type, id], index) => {
      const source = guides.find(g => g.id === id)!;
      expect(source).toBeDefined();
      const p = geoToWorld(source.longitude, source.latitude);
      const anchor = type === "drainage-pump" ? resolveLegalPumpGuidance(source, surface).actionAnchor : null;
      if (type === "drainage-pump") expect(anchor).not.toBeNull();
      const position = anchor?.position ?? worldToGeo(p.x, p.z);
      expect(resolvePlaceablePosition(position)).toBeDefined();
      const local = geoToWorld(position.longitude, position.latitude);
      expect(surface.sampleGround(local.x, local.z)).not.toBeNull();
      return { at: (index + 1) * 15, placement: { id: `${type}/${id}`, structureId: type!, position,
        headingDegrees: anchor?.headingDegrees ?? suggestedStructureHeading(type!, position) } };
    });
    let state = beginPreparation(), budget = INITIAL_BUDGET, minimum = budget, spent = 0, next = 0;
    const placed: PlacedStructure[] = [], times: number[] = [], dt = 0.05;
    const prep = rules.timing.phases.preparationSeconds, rain = rules.timing.phases.disasterSeconds;
    for (let tick = 0; tick < Math.round((prep + rain) / dt); tick++) {
      const time = tick * dt;
      if (tick === Math.round(prep / dt)) { state = beginDisaster(state, { weatherSeed: seed }); budget = applyDisasterStartGrant(budget); }
      if (next < plan.length && time + 1e-8 >= plan[next]!.at) {
        const p = plan[next]!.placement, definition = definitions.get(p.structureId)!;
        const result = placeStructure(definition, p.position, budget, p.id, p.headingDegrees);
        if (!result.ok) throw new Error(`Unaffordable normal confirmation at ${time}: ${result.reason}`);
        budget = result.remainingBudget; minimum = Math.min(minimum, budget); spent += definition.constructionCost;
        placed.push(result.placement); times.push(time); next++;
      }
      budget = tickBudgetEconomy({ currentBudget: budget, deltaSeconds: dt, phase: time < prep ? "preparation" : "disaster",
        placedStructureIds: placed.map(p => p.structureId) }).budget;
      if (time >= prep) state = advanceFloodSimulation(state, placed, dt);
    }
    // Finish only a floating-point residual, not extra rain time or a changed rule.
    if (state.phase === "disaster") state = advanceFloodSimulation(state, placed, Math.max(0, rain - state.disasterElapsedSeconds));
    expect(times).toEqual([15, 30, 45, 60, 75, 90]);
    expect(spent).toBe(17800); expect(minimum).toBeCloseTo(3445, 4);
    expect(state.phase).toBe("result"); expect(state.isClear).toBe(true);
    expect(state.damagePercent).toBeLessThan(rules.victory.clearThresholdPercent);
    console.info("ordinary-budget legal guides", JSON.stringify({ seed, spent, minimum, finalBudget: budget, damage: state.damagePercent }));
  }, 15000);
});
