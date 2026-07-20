import { describe, expect, it } from "vitest";
import { getStructureModelParts } from "./structureModels";

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
});
