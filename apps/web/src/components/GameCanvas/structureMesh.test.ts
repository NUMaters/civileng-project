import { describe, expect, it } from "vitest";
import { getStructureModelParts } from "./structureModels";
import { structureMeshUri } from "./structureMesh";

describe("structureMeshUri", () => {
  it("exports finite, lit triangles with an explicit Z-up conversion and caches the asset", () => {
    for (const id of ["levee", "retention-basin", "revetment"]) {
      for (const part of getStructureModelParts(id).filter((p) => p.mesh)) {
        const color = [0.4, 0.5, 0.3, 1];
        const uri = structureMeshUri(part, color);
        expect(structureMeshUri(part, color)).toBe(uri);
        const gltf = JSON.parse(decodeURIComponent(uri.slice(uri.indexOf(",") + 1)));
        expect(gltf.asset.version).toBe("2.0");
        expect(gltf.accessors[0].count).toBe(part.mesh!.indices.length);
        expect(gltf.materials[0].alphaMode).toBe("OPAQUE");
        expect(gltf.nodes[0].rotation).toEqual([-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
        const binary = atob(gltf.buffers[0].uri.split(",")[1]);
        const floats = new Float32Array(Uint8Array.from(binary, (c) => c.charCodeAt(0)).buffer);
        expect([...floats].every(Number.isFinite)).toBe(true);
        const normals = floats.slice(part.mesh!.indices.length * 3);
        for (let i = 0; i < normals.length; i += 3) {
          expect(Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!)).toBeCloseTo(1);
        }
      }
    }
  });
});
