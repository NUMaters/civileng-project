import { describe, expect, it } from "vitest";
import { createStructureMaterial } from "./structureMaterials";
import { getStructureModelParts } from "./structureModels";

const IDS = [
  "levee",
  "retention-basin",
  "drainage-pump",
  "revetment",
  "channel-dredging",
] as const;

describe("createStructureMaterial", () => {
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
