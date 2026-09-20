import { describe, expect, it } from "vitest";
import {
  calculateStructureInfluences,
  createInitialFloodState,
  type StructureInfluence,
} from "../disaster/services/floodSimulation";
import { getPlacementFeedback, getRiverMissionFeedback } from "./riverMissionFeedback";

const realInfluence = calculateStructureInfluences([
  {
    id: "levee-core",
    structureId: "levee",
    position: { longitude: 140.37776, latitude: 37.359853, height: 22 },
    headingDegrees: 140,
  },
])[0]!;

function influence(overrides: Partial<StructureInfluence> = {}): StructureInfluence {
  return {
    ...realInfluence,
    coverageTone: "good",
    effectiveness: 0.8,
    coveredSiteIds: ["core"],
    adverseSiteIds: [],
    ...overrides,
  };
}

function mission(influences: StructureInfluence[]) {
  return getRiverMissionFeedback({
    ...createInitialFloodState(),
    phase: "preparation",
    structureInfluences: influences,
  });
}

describe("river mission progress", () => {
  it("ignores previews for objectives, coverage and quality", () => {
    const result = mission([influence({ preview: true })]);
    expect(result.stage).toBe(1);
    expect(result.coveredSites).toBe(0);
    expect(result.averageEffectiveness).toBeNull();
  });

  it("requires compatible coverage without adverse sites for the first objective", () => {
    expect(mission([influence({ coveredSiteIds: [] })]).stage).toBe(1);
    expect(mission([influence({ adverseSiteIds: ["erosion"] })]).stage).toBe(1);
    expect(mission([influence({ coverageTone: "warn" })]).stage).toBe(1);
    expect(mission([influence()]).stage).toBe(2);
  });

  it("counts distinct effective roles, not the number of facilities", () => {
    expect(mission([influence(), influence({ placementId: "second" })]).stage).toBe(2);
    expect(mission([influence(), influence({ structureId: "drainage-pump" })]).stage).toBe(3);
    expect(
      mission([influence(), influence({ structureId: "drainage-pump", preview: true })]).stage,
    ).toBe(2);
  });

  it("deduplicates coverage and averages all confirmed placement quality", () => {
    const result = mission([
      influence(),
      influence({ effectiveness: 0.2, coveredSiteIds: ["core", "south"] }),
    ]);
    expect(result.coveredSites).toBe(2);
    expect(result.averageEffectiveness).toBe(0.5);
  });

  it("reports weather and actual protection without counting unprotected or overflowing sites", () => {
    const site = {
      id: "core",
      longitude: 140,
      latitude: 37,
      primaryHazard: "overtopping" as const,
    };
    const result = getRiverMissionFeedback({
      ...createInitialFloodState(),
      phase: "disaster",
      rainfallIntensity: 0.74,
      protectedBankSites: [
        { ...site, protectionStrength: 0.6, overflowing: false },
        { ...site, id: "overflow", protectionStrength: 0.6, overflowing: true },
        { ...site, id: "bare", protectionStrength: 0, overflowing: false },
      ],
    });
    expect(result.stage).toBe(3);
    expect(result.protectedSites).toBe(1);
    expect(result.overflowingSites).toBe(1);
    expect(result.objective).toContain("74%");
    expect(result.objective).toContain("防護中 1地点");
  });
});

describe("confirmed placement feedback", () => {
  it("uses the real simulation assessment and facility name", () => {
    const result = getPlacementFeedback(realInfluence);
    expect(result.message).toContain("堤防");
    expect(result.message).toContain(`${Math.round(realInfluence.effectiveness * 100)}%`);
    expect(result.message).toContain(
      `弱点カバー ${new Set(realInfluence.coveredSiteIds).size}地点`,
    );
  });

  it("warns about adverse sites even when coverage is also good", () => {
    const result = getPlacementFeedback(influence({ adverseSiteIds: ["bad", "bad"] }));
    expect(result.tone).toBe("warn");
    expect(result.message).toContain("相性注意 1地点");
  });

  it("warns about out-of-range placement without claiming protection", () => {
    const result = getPlacementFeedback(influence({ coveredSiteIds: [] }));
    expect(result.tone).toBe("warn");
    expect(result.message).toContain("弱点が範囲外");
  });

  it("gives positive feedback only for compatible coverage", () => {
    expect(getPlacementFeedback(influence()).tone).toBe("success");
    expect(getPlacementFeedback(influence({ coverageTone: "bad" })).tone).toBe("warn");
  });
});
