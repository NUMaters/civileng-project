import { expect, it } from "vitest";
import { createInitialFloodState, type StructureInfluence } from "../../features/disaster/services/floodSimulation";
import { resolveFacilityActivity } from "./facilityActivity";

const influence = { structureId: "levee", coveredSiteIds: ["bank"], adverseSiteIds: [], effectiveness: 0.8 } as unknown as StructureInfluence;
const storm = () => ({ ...createInitialFloodState(), phase: "disaster" as const, riverLevelMeters: 4.7,
  floodDepthMeters: 0.7, protectedBankSites: [{ id: "bank", longitude: 140.38, latitude: 37.36,
    primaryHazard: "overtopping" as const, protectionStrength: 0.6, overflowing: false }] });

it("does not claim activity from previews, dry preparation or out-of-range/adverse placement", () => {
  expect(resolveFacilityActivity(influence, createInitialFloodState()).activity).toBe(0);
  expect(resolveFacilityActivity({ ...influence, preview: true }, storm()).activity).toBe(0);
  expect(resolveFacilityActivity({ ...influence, coveredSiteIds: [] }, storm()).activity).toBe(0);
  expect(resolveFacilityActivity({ ...influence, adverseSiteIds: ["bad"] }, storm()).activity).toBe(0);
});
it("links activity to actual protection and water load without claiming complete protection", () => {
  expect(resolveFacilityActivity(influence, storm()).activity).toBeCloseTo(0.48);
  expect(resolveFacilityActivity(influence, { ...storm(), protectedBankSites: [] }).activity).toBe(0);
  const state = storm(); state.protectedBankSites[0]!.overflowing = true;
  expect(resolveFacilityActivity(influence, state).label).toContain("浸水が継続");
});
it("keeps pumps idle without inland floodwater even if the river is high", () => {
  const pump = { ...influence, structureId: "drainage-pump" };
  expect(resolveFacilityActivity(pump, { ...storm(), floodDepthMeters: 0 }).activity).toBe(0);
  expect(resolveFacilityActivity(pump, storm()).label).toContain("排水中");
});
