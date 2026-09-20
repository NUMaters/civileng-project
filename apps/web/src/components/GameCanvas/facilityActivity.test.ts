import { expect, it } from "vitest";
import type { PlacedStructure } from "../../features/construction";
import { calculateOverflowSites, calculatePositiveSiteContributions, calculateStructureInfluences, createInitialFloodState,
  refreshPlacementEffects, type StructureInfluence } from "../../features/disaster/services/floodSimulation";
import { listOverflowCandidates } from "../../features/disaster/services/overflowBankSites";
import { resolveFacilityActivity } from "./facilityActivity";

const pump: PlacedStructure = { id: "pump", structureId: "drainage-pump", headingDegrees: 50,
  position: { longitude: 140.3791, latitude: 37.36035, height: 20 } };
const influence = (): StructureInfluence => ({ ...calculateStructureInfluences([pump])[0],
  coveredSiteIds: ["inland-campus"], adverseSiteIds: [], effectiveness: 0.8,
  positiveSiteContributions: [{ siteId: "inland-campus", strength: 0.6 }] });
const storm = () => ({ ...createInitialFloodState(), phase: "disaster" as const, riverLevelMeters: 4.7,
  floodDepthMeters: 0.7, protectedBankSites: [{ id: "inland-campus", longitude: 140.3791, latitude: 37.36035,
    primaryHazard: "inlandPonding" as const, protectionStrength: 0.9, overflowing: false }] });

it("keeps mixed positive/adverse activity with a separate warning", () => {
  const own = influence();
  const result = resolveFacilityActivity({ ...own, adverseSiteIds: ["campus-core"] }, storm());
  expect(result.activity).toBeCloseTo(0.48);
  expect(result.activity).toBe(resolveFacilityActivity(own, storm()).activity);
  expect(result.warning).toBe("相性注意1地点");
  expect(result.label).toContain("排水中");
  expect(result.label).toContain(result.warning!);
});
it("does not borrow another facility's aggregate protection", () => {
  const own = influence();
  for (const protectionStrength of [0, 0.2, 1]) {
    const state = storm(); state.protectedBankSites[0].protectionStrength = protectionStrength;
    expect(resolveFacilityActivity(own, state).activity).toBeCloseTo(0.48);
    expect(resolveFacilityActivity({ ...own, positiveSiteContributions: [] }, state).activity).toBe(0);
  }
  expect(resolveFacilityActivity(own, { ...storm(), protectedBankSites: [] }).activity).toBeCloseTo(0.48);
  expect(resolveFacilityActivity({ ...own, positiveSiteContributions: undefined }, storm()).activity).toBe(0);
});
it("keeps previews, missing state, idle and preparation inactive", () => {
  expect(resolveFacilityActivity(undefined, storm()).activity).toBe(0);
  expect(resolveFacilityActivity(influence(), undefined).activity).toBe(0);
  expect(resolveFacilityActivity({ ...influence(), preview: true }, storm()).activity).toBe(0);
  for (const phase of ["idle", "preparation"]) {
    expect(resolveFacilityActivity(influence(), { ...storm(), phase }).activity).toBe(0);
  }
});
it("keeps pumps dry without ponding and basins dry without river rise", () => {
  const own = influence();
  expect(resolveFacilityActivity(own, { ...storm(), floodDepthMeters: 0 }).activity).toBe(0);
  expect(resolveFacilityActivity({ ...own, structureId: "retention-basin" },
    { ...storm(), riverLevelMeters: 2.2 }).activity).toBe(0);
  expect(resolveFacilityActivity({ ...own, structureId: "retention-basin" }, storm()).activity).toBeGreaterThan(0);
});
it("fails closed for adverse-only, zero or invalid own contribution/effectiveness/demand", () => {
  for (const strength of [0, -1, NaN, Infinity]) {
    const own = { ...influence(), adverseSiteIds: ["bad"], positiveSiteContributions: [{ siteId: "inland-campus", strength }] };
    expect(resolveFacilityActivity(own, storm()).activity).toBe(0);
    expect(resolveFacilityActivity(own, storm()).warning).toBeTruthy();
  }
  for (const effectiveness of [0, -1, NaN, Infinity]) {
    expect(resolveFacilityActivity({ ...influence(), effectiveness }, storm()).activity).toBe(0);
  }
  for (const floodDepthMeters of [-1, NaN, Infinity]) {
    expect(resolveFacilityActivity(influence(), { ...storm(), floodDepthMeters }).activity).toBe(0);
  }
});
it("reports continuing flood only at sites receiving this facility's contribution", () => {
  const state = storm(); state.protectedBankSites[0].overflowing = true;
  expect(resolveFacilityActivity(influence(), state).label).toContain("浸水が継続");
  state.protectedBankSites[0].id = "unrelated";
  expect(resolveFacilityActivity(influence(), state).label).not.toContain("浸水が継続");
  for (const phase of ["result", "review"]) {
    expect(resolveFacilityActivity(influence(), { ...storm(), phase }).activity).toBeCloseTo(0.48);
  }
});
it("matches real single-facility protection without mutating the original placement", () => {
  const placement = Object.freeze({ ...pump, position: Object.freeze({ ...pump.position }) });
  const own = calculatePositiveSiteContributions(placement);
  const state = refreshPlacementEffects(storm(), [placement]);
  expect(own.length).toBeGreaterThan(0);
  expect(state.structureInfluences[0].positiveSiteContributions).toEqual(own);
  const inland = own.find(item => item.siteId === "inland-campus")!;
  expect(inland.strength).toBeGreaterThan(0.12);
  expect(state.protectedBankSites.find(site => site.id === inland.siteId)!.protectionStrength).toBeCloseTo(inland.strength);
  expect(calculatePositiveSiteContributions(placement)).toEqual(own);
  expect(calculatePositiveSiteContributions({ ...placement, preview: true })).toEqual([]);
});
it("does not confuse real basin affinity coverage with nonzero ponding contribution", () => {
  const basin = { ...pump, id: "basin", structureId: "retention-basin" };
  const own = calculateStructureInfluences([basin])[0];
  expect(own.coveredSiteIds).toContain("inland-campus");
  expect(own.positiveSiteContributions!.some(site => site.siteId === "inland-campus")).toBe(false);
  const state = refreshPlacementEffects(storm(), [pump, basin]);
  expect(state.protectedBankSites.find(site => site.id === "inland-campus")!.protectionStrength).toBeGreaterThan(0);
  expect(resolveFacilityActivity({ ...own, coveredSiteIds: ["inland-campus"],
    positiveSiteContributions: [{ siteId: "inland-campus", strength: 0 }] }, state).activity).toBe(0);
});
it.each(["drainage-pump", "retention-basin"])("keeps real mixed %s placements operating", structureId => {
  // Bounded real-candidate search, not fabricated positive/adverse site metadata.
  const placements = listOverflowCandidates().flatMap(site => [0, 50, 90, 180, 270].map(headingDegrees => ({
    id: `${structureId}:${site.id}:${headingDegrees}`, structureId, headingDegrees,
    position: { longitude: site.longitude, latitude: site.latitude, height: 20 },
  })));
  const baseline = new Map(calculateOverflowSites([], 0.5, 0.4).map(site => [site.id, site.intensity]));
  const mixed = calculateStructureInfluences(placements).find((own, index) => own.coveredSiteIds.length > 0 &&
    own.adverseSiteIds.length > 0 && resolveFacilityActivity(own, storm()).activity > 0 &&
    // Prove a real negative effect too, not merely a low-affinity coverage warning.
    calculateOverflowSites([placements[index]], 0.5, 0.4).some(site => own.adverseSiteIds.includes(site.id) &&
      site.intensity > (baseline.get(site.id) ?? 0)));
  expect(mixed).toBeDefined();
  expect(mixed!.positiveSiteContributions!.length).toBeGreaterThan(0);
  expect(resolveFacilityActivity(mixed, storm()).warning).toBeTruthy();
});
