import { EntityCollection, JulianDate, type Viewer } from "cesium";
import { describe, expect, it } from "vitest";
import type { StructureInfluence } from "../../features/disaster/services/floodSimulation";
import {
  clearProtectionVisualization,
  syncProtectionVisualization,
} from "./protectionVisualization";

function scene(): Viewer {
  return { entities: new EntityCollection() } as unknown as Viewer;
}

function influence(preview = false): StructureInfluence {
  return {
    placementId: "levee-1",
    structureId: "levee",
    longitude: 140.3837,
    latitude: 37.3655,
    headingDegrees: 90,
    radiusMeters: 200,
    effectiveness: 1,
    coverageTone: "good",
    coveredSiteIds: ["bank-1"],
    adverseSiteIds: [],
    preview,
    effectLabel: "",
    zoneMeaning: "",
    coverageHint: "",
    zone: {
      kind: "strip",
      lengthMeters: 380,
      widthMeters: 56,
      longitude: 140.3837,
      latitude: 37.3655,
      headingDegrees: 90,
      structureId: "levee",
      extentMeters: 200,
    },
  };
}

describe("protection visualization", () => {
  it("cleans legacy decorations without touching facilities or adding weakness markers", () => {
    const viewer = scene();
    for (const id of [
      "protect-zone-axis-old",
      "protect-bank-old",
      "facility-outcome-old",
      "facility-outcome-link-old",
      "facility-water-effect-old",
      "facility-1",
    ]) {
      viewer.entities.add({ id });
    }
    syncProtectionVisualization(
      viewer,
      [influence()],
      [
        {
          id: "bank-1",
          longitude: 140.38,
          latitude: 37.36,
          protectionStrength: 0.8,
          overflowing: false,
          primaryHazard: "overtopping",
        },
      ],
      { showBankSites: true },
    );
    expect(viewer.entities.values.map((entity) => entity.id)).toEqual(["facility-1"]);
  });

  it("keeps one preview surface stable across flood ticks and removes it on completion", () => {
    const viewer = scene();
    const preview = influence(true);
    syncProtectionVisualization(viewer, [preview], [], { showBankSites: false });
    const entity = viewer.entities.values[0];
    expect(viewer.entities.values).toHaveLength(1);
    expect(entity.corridor).toBeDefined();
    syncProtectionVisualization(
      viewer,
      [{ ...preview, effectiveness: 0.5, coveredSiteIds: ["bank-2"] }],
      [],
      { showBankSites: false },
    );
    expect(viewer.entities.values[0]).toBe(entity);
    syncProtectionVisualization(viewer, [influence()], [], { showBankSites: false });
    expect(viewer.entities.values).toHaveLength(0);
  });

  it("refreshes a changed range and can rebuild after explicit clearing", () => {
    const viewer = scene();
    const preview = influence(true);
    syncProtectionVisualization(viewer, [preview], [], { showBankSites: false });
    const changed = {
      ...preview,
      zone: { ...preview.zone, kind: "strip" as const, lengthMeters: 380, widthMeters: 80 },
    };
    syncProtectionVisualization(viewer, [changed], [], { showBankSites: false });
    expect(viewer.entities.values[0].corridor?.width?.getValue(JulianDate.now())).toBe(80);
    clearProtectionVisualization(viewer);
    syncProtectionVisualization(viewer, [changed], [], { showBankSites: false });
    expect(viewer.entities.values).toHaveLength(1);
  });
});
