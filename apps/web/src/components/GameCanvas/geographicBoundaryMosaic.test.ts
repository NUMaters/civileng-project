import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { disposeDioramaObject } from "./disposeDioramaObject";
import { createGeographicBoundaryMosaic } from "./geographicBoundaryMosaic";

const groups: THREE.Group[] = [];
afterEach(() => groups.splice(0).forEach(disposeDioramaObject));

describe("fixed map boundary haze", () => {
  it("surrounds but never covers the playable rectangle and fades a generated town silhouette", () => {
    const bounds = { minX: 0, minZ: 0, maxX: 1000, maxZ: 2000 };
    const group = createGeographicBoundaryMosaic(bounds, () => 12, 100, 400);
    groups.push(group);
    expect(group.userData.role).toBe("visual-boundary-only");
    expect(group.userData.effect).toBe("atmospheric-depth-fade");
    expect(group.userData.fadeBands).toBe(4);
    expect(group.userData.generatedBuildingCount).toBeGreaterThan(100);
    expect(group.userData.backdrop).toBe("sky-blue");
    expect(group.children.length).toBeLessThanOrEqual(9);
    let count = 0;
    for (const mesh of group.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh)) {
      if (!mesh.name.includes("ground")) continue;
      count += mesh.count;
      for (let index = 0; index < mesh.count; index++) {
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        mesh.getMatrixAt(index, matrix); position.setFromMatrixPosition(matrix);
        expect(position.x < bounds.minX || position.x > bounds.maxX || position.z < bounds.minZ || position.z > bounds.maxZ).toBe(true);
      }
    }
    expect(count).toBeGreaterThan(100);
    expect(count).toBeLessThan(350);
    const buildingBands = group.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh && child.name.includes("building"));
    expect(buildingBands).toHaveLength(4);
    const opacities = buildingBands.map(mesh => (mesh.material as THREE.MeshBasicMaterial).opacity);
    expect(opacities).toEqual([...opacities].sort((a, b) => b - a));
    expect(opacities.at(-1)).toBeLessThan(opacities[0]! / 4);
  });

  it("rejects invalid dimensions", () => {
    expect(() => createGeographicBoundaryMosaic({ minX: 0, minZ: 0, maxX: 0, maxZ: 1 }, () => 0)).toThrow(RangeError);
  });
});
