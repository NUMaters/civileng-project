import { describe, expect, it } from "vitest";
import { getStructureFootprintMeters, getStructureModelParts } from "./structureModels";

const STRUCTURE_IDS = [
  "levee",
  "retention-basin",
  "drainage-pump",
  "revetment",
  "channel-dredging",
] as const;

describe("getStructureModelParts", () => {
  it("5 施設すべてに複数パーツとマテリアル種別がある", () => {
    for (const id of STRUCTURE_IDS) {
      const parts = getStructureModelParts(id);
      expect(parts.length).toBeGreaterThanOrEqual(4);
      for (const part of parts) {
        expect(part.material).toBeTruthy();
        expect(part.centerHeight).toBeGreaterThan(0);
      }
    }
  });

  it("堤防は芝・アスファルト層を含む", () => {
    const materials = getStructureModelParts("levee").map((part) => part.material);
    expect(materials).toContain("grass");
    expect(materials).toContain("asphalt");
    expect(materials).toContain("earth");
  });

  it("堤防のフットプリントはドラッグ用に十分なサイズを持つ", () => {
    const footprint = getStructureFootprintMeters("levee");
    expect(footprint.length).toBeGreaterThan(80);
    expect(footprint.width).toBeGreaterThan(20);
    expect(footprint.height).toBeGreaterThan(5);
  });
});
