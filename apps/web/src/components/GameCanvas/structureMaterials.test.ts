import { describe, expect, it } from "vitest";
import { ColorMaterialProperty, JulianDate } from "cesium";
import { createStructureMaterial } from "./structureMaterials";
import { getStructureModelParts } from "./structureModels";

const IDS = ["levee", "retention-basin", "drainage-pump", "revetment", "channel-dredging"] as const;

describe("createStructureMaterial", () => {
  it("uses opaque texture-free completed parts and translucent previews", () => {
    for (const id of IDS) {
      for (const part of getStructureModelParts(id)) {
        const material = createStructureMaterial(part.material);
        expect(material).toBeInstanceOf(ColorMaterialProperty);
        expect(material.getValue(JulianDate.now()).color.alpha).toBe(1);
        const preview = createStructureMaterial(part.material, { preview: true });
        expect(preview.getValue(JulianDate.now()).color.alpha).toBeCloseTo(0.58);
      }
    }
  });
  for (const id of IDS) {
    it(`builds solid materials for ${id} parts`, () => {
      const parts = getStructureModelParts(id);
      for (const part of parts) {
        const material = createStructureMaterial(part.material, {
          preview: true,
          accentHex: part.accentHex,
          solidOnly: true,
        });
        expect(material).toBeTruthy();
      }
    });
  }
});
