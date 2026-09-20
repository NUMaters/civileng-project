import { describe, expect, it } from "vitest";
import { getDioramaGuidance, initialDioramaFocus } from "./dioramaGuidance";
import { calculateStructureInfluences } from "../../features/disaster/services/floodSimulation";

describe("diorama guidance", () => {
  it("starts near an actual high-vulnerability overtopping site", () => {
    expect(initialDioramaFocus().id).toBe("campus-core");
    expect(getDioramaGuidance([]).some((site) => site.id === initialDioramaFocus().id)).toBe(true);
  });
  it("matches each hint to the hazard it actually addresses", () => {
    const sites = getDioramaGuidance([]);
    expect(sites.find((site) => site.id === "inland-campus")?.advice).toContain("排水機場");
    expect(sites.find((site) => site.id === "north-bend")?.advice).toContain("護岸");
  });
  it("removes covered sites only after construction is confirmed", () => {
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
    expect(getDioramaGuidance([influence!]).some((item) => item.id === site.id)).toBe(false);
    expect(
      getDioramaGuidance([{ ...influence!, preview: true }]).some((item) => item.id === site.id),
    ).toBe(true);
  });
});
