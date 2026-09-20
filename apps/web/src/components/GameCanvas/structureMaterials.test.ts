import { describe, expect, it } from "vitest";
import { ColorMaterialProperty, JulianDate } from "cesium";
import { createStructureMaterial } from "./structureMaterials";
import { getStructureModelParts } from "./structureModels";

const IDS = ["levee", "retention-basin", "drainage-pump", "revetment", "channel-dredging"] as const;

describe("createStructureMaterial", () => {
  it("uses opaque texture-free completed parts and readable opaque previews", () => {
    for (const id of IDS) {
      for (const part of getStructureModelParts(id)) {
        const material = createStructureMaterial(part.material);
        expect(material).toBeInstanceOf(ColorMaterialProperty);
        expect(material.getValue(JulianDate.now()).color.alpha).toBe(1);
        const preview = createStructureMaterial(part.material, { preview: true });
        expect(preview).toBeInstanceOf(ColorMaterialProperty);
        expect(preview.getValue(JulianDate.now()).color.alpha).toBe(1);
      }
    }
  });
  it("preserves custom accent colors without preview transparency", () => {
    const material = createStructureMaterial("accent", { preview: true, accentHex: "#ef6b4a" });
    const color = material.getValue(JulianDate.now()).color;
    expect(color.alpha).toBe(1);
    expect(color.red).toBeCloseTo(239 / 255);
    expect(color.green).toBeCloseTo(107 / 255);
    expect(color.blue).toBeCloseTo(74 / 255);
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
