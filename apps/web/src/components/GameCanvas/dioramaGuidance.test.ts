import { describe, expect, it } from "vitest";
import { getDioramaGuidance, initialDioramaFocus, isPreferredDioramaGuidanceCandidate } from "./dioramaGuidance";
import { calculateOverflowSites, calculateStructureInfluences } from "../../features/disaster/services/floodSimulation";
import type { PlacedStructure } from "../../features/construction";
import { listOverflowCandidates } from "../../features/disaster/services/overflowBankSites";

function placeAt(structureId: string, siteId: string, headingDegrees = 50): PlacedStructure {
  const site = listOverflowCandidates().find(candidate => candidate.id === siteId)!;
  return { id: `${structureId}:${siteId}`, structureId, headingDegrees,
    position: { longitude: site.longitude, latitude: site.latitude, height: 20 } };
}

describe("diorama guidance", () => {
  it("keeps the original real candidate coordinates while marking covered positive contributions", () => {
    const candidates = listOverflowCandidates().filter(candidate =>
      ["overtopping", "erosion", "inlandPonding"].includes(candidate.primaryHazard));
    const [influence] = calculateStructureInfluences([placeAt("levee", "campus-core")]);
    const sites = getDioramaGuidance([influence!]);

    expect(sites.map(site => site.id)).toEqual(candidates.map(candidate => candidate.id));
    for (const candidate of candidates) {
      const site = sites.find(item => item.id === candidate.id)!;
      expect([site.longitude, site.latitude]).toEqual([candidate.longitude, candidate.latitude]);
    }
    expect(sites.find(site => site.id === "campus-core")?.hasContribution).toBe(true);
    expect(sites.find(site => site.id === "campus-south")?.hasContribution).toBe(false);
  });

  it("starts near an actual high-vulnerability overtopping site", () => {
    expect(initialDioramaFocus().id).toBe("campus-core");
    expect(getDioramaGuidance([]).some((site) => site.id === initialDioramaFocus().id)).toBe(true);
  });
  it("matches each hint to the hazard it actually addresses", () => {
    const sites = getDioramaGuidance([]);
    expect(sites.find((site) => site.id === "inland-campus")?.advice).toContain("排水機場");
    expect(sites.find((site) => site.id === "north-bend")?.advice).toContain("護岸");
  });
  it("keeps a weak positive contribution visible with preparation-safe wording", () => {
    const site = initialDioramaFocus();
    const [influence] = calculateStructureInfluences([
      {
        id: "guide-test",
        structureId: "levee",
        headingDegrees: 51,
        position: { longitude: site.longitude, latitude: site.latitude, height: 20 },
        preview: false,
      },
    ]);
    expect(influence!.coveredSiteIds).toContain(site.id);
    expect(influence!.positiveSiteContributions!.find(item => item.siteId === site.id)!.strength).toBeGreaterThan(0);
    const sites = getDioramaGuidance([{
      ...influence!,
      positiveSiteContributions: [{ siteId: site.id, strength: Number.EPSILON }],
    }]);
    expect(sites.some((item) => item.id === site.id)).toBe(true);
    expect(sites.find((item) => item.id === site.id)?.hasContribution).toBe(true);
    expect(sites.find((item) => item.id === site.id)?.advice).toBe("この地点に効果あり。大雨で確かめよう");
    expect(
      getDioramaGuidance([{ ...influence!, preview: true }]).some((item) => item.id === site.id),
    ).toBe(true);
  });

  it("keeps the actual ponding hint after a basin covers it but contributes zero drainage", () => {
    const [basin] = calculateStructureInfluences([placeAt("retention-basin", "inland-campus")]);
    expect(basin.coveredSiteIds).toContain("inland-campus");
    // Populated by evaluateLocalContribution: positive affinity alone is not an effect.
    expect(basin.positiveSiteContributions!.some(site => site.siteId === "inland-campus")).toBe(false);
    const hint = getDioramaGuidance([basin]).find(site => site.id === "inland-campus")!;
    const actual = listOverflowCandidates().find(site => site.id === "inland-campus")!;
    expect(hint.longitude).toBe(actual.longitude);
    expect(hint.latitude).toBe(actual.latitude);
    expect(hint.advice).toContain("排水機場");
  });

  it("keeps the actual erosion hint when an unsuitable basin increases local pressure", () => {
    const placement = placeAt("retention-basin", "north-bend");
    const [basin] = calculateStructureInfluences([placement]);
    expect(basin.adverseSiteIds).toContain("north-bend");
    expect(basin.positiveSiteContributions!.some(site => site.siteId === "north-bend")).toBe(false);
    const intensity = (placements: PlacedStructure[]) =>
      calculateOverflowSites(placements, 0.5, 0.4).find(site => site.id === "north-bend")?.intensity ?? 0;
    expect(intensity([placement])).toBeGreaterThan(intensity([]));
    expect(getDioramaGuidance([basin]).some(site => site.id === "north-bend")).toBe(true);
  });

  it("marks positively covered sites without suppressing adverse or other candidates", () => {
    const placements = listOverflowCandidates().flatMap(site => [0, 50, 90, 180, 270].map(heading =>
      placeAt("drainage-pump", site.id, heading)));
    const mixed = calculateStructureInfluences(placements).find(influence => influence.adverseSiteIds.length > 0 &&
      influence.positiveSiteContributions!.some(site => influence.coveredSiteIds.includes(site.siteId)))!;
    expect(mixed).toBeDefined();
    const shown = new Set(getDioramaGuidance([mixed]).map(site => site.id));
    const initiallyShown = new Set(getDioramaGuidance([]).map(site => site.id));
    const positive = mixed.positiveSiteContributions!.filter(site => mixed.coveredSiteIds.includes(site.siteId));
    expect(positive.some(site => initiallyShown.has(site.siteId))).toBe(true);
    for (const site of positive) {
      expect(shown.has(site.siteId)).toBe(true);
      expect(getDioramaGuidance([mixed]).find(item => item.id === site.siteId)?.hasContribution).toBe(true);
    }
    for (const id of mixed.adverseSiteIds.filter(id => initiallyShown.has(id))) expect(shown.has(id)).toBe(true);
  });

  it("keeps preview and legacy unattributed guidance instead of assuming protection", () => {
    const placement = placeAt("levee", "campus-core", 140);
    const [confirmed] = calculateStructureInfluences([placement]);
    const [preview] = calculateStructureInfluences([{ ...placement, preview: true }]);
    expect(preview.positiveSiteContributions).toEqual([]);
    expect(getDioramaGuidance([preview])).toEqual(getDioramaGuidance([]));
    expect(getDioramaGuidance([{ ...confirmed, positiveSiteContributions: undefined }])).toEqual(getDioramaGuidance([]));
    expect(getDioramaGuidance([{ ...confirmed, positiveSiteContributions: [] }])).toEqual(getDioramaGuidance([]));
  });

  it.each([0, -0.1, NaN, Infinity, -Infinity])("marks no contribution for invalid/nonpositive strength %s", strength => {
    const [influence] = calculateStructureInfluences([placeAt("levee", "campus-core", 140)]);
    expect(getDioramaGuidance([{ ...influence, positiveSiteContributions: [{ siteId: "campus-core", strength }] }])
      .find(site => site.id === "campus-core")?.hasContribution).toBe(false);
  });

  it("does not mark positive effects outside the existing coverage gate", () => {
    const [influence] = calculateStructureInfluences([placeAt("levee", "campus-core", 140)]);
    expect(influence.positiveSiteContributions!.some(site => site.siteId === "campus-core")).toBe(true);
    const sites = getDioramaGuidance([{ ...influence, coveredSiteIds: [] }]);
    expect(sites).toHaveLength(getDioramaGuidance([]).length);
    expect(sites.find(site => site.id === "campus-core")?.hasContribution).toBe(false);
  });

  it("retains valid positive coverage when another facility at the same site is unsuitable", () => {
    const placements = [placeAt("retention-basin", "inland-campus"), placeAt("drainage-pump", "inland-campus")];
    const [basin, pump] = calculateStructureInfluences(placements);
    expect(pump.positiveSiteContributions!.some(site => site.siteId === "inland-campus")).toBe(true);
    expect(getDioramaGuidance([basin]).find(site => site.id === "inland-campus")?.hasContribution).toBe(false);
    expect(getDioramaGuidance([basin, pump]).find(site => site.id === "inland-campus")?.hasContribution).toBe(true);
  });

  it("orders clear candidates by readiness tier, then existing geometric score", () => {
    expect(isPreferredDioramaGuidanceCandidate(false, 900, true, 10)).toBe(true);
    expect(isPreferredDioramaGuidanceCandidate(true, 10, false, 900)).toBe(false);
    expect(isPreferredDioramaGuidanceCandidate(true, 10, undefined, Infinity)).toBe(true);
    expect(isPreferredDioramaGuidanceCandidate(false, Infinity, undefined, Infinity)).toBe(false);
    expect(isPreferredDioramaGuidanceCandidate(false, NaN, undefined, Infinity)).toBe(false);
    expect(isPreferredDioramaGuidanceCandidate(false, 20, false, 40)).toBe(true);
    expect(isPreferredDioramaGuidanceCandidate(false, 40, false, 20)).toBe(false);
  });
});
