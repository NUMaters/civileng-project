import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { createRiverStageController, MAX_RIVER_RISE_METERS } from "./riverStage";

const meshes: THREE.Mesh[] = [];
function water(eligible?: unknown) {
  const geometry = new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2).translate(0, 3, 0);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  if (eligible !== undefined) mesh.userData.riverStageEligible = eligible;
  meshes.push(mesh);
  return mesh;
}
afterEach(() => {
  for (const mesh of meshes.splice(0)) {
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
  }
});

describe("river stage", () => {
  it("sets absolute rise and immediately raycasts the transformed surface, including reset", () => {
    const mesh = water(true), parent = new THREE.Group();
    parent.position.set(20, 7, 30);
    parent.add(mesh);
    mesh.matrixAutoUpdate = false;
    const original = Array.from(mesh.geometry.getAttribute("position").array);
    const stage = createRiverStageController([mesh, mesh]);
    const hitY = () => new THREE.Raycaster(new THREE.Vector3(20, 100, 30), new THREE.Vector3(0, -1, 0))
      .intersectObject(mesh)[0]!.point.y;
    stage.update(5.2);
    expect(mesh.position.y).toBeCloseTo(3);
    expect(hitY()).toBeCloseTo(13);
    stage.update(5.2);
    expect(hitY()).toBeCloseTo(13); // no accumulation or renderer tick needed
    stage.update(3.2);
    expect(hitY()).toBeCloseTo(11);
    stage.reset();
    expect(mesh.position.y).toBe(0);
    expect(hitY()).toBeCloseTo(10);
    expect(Array.from(mesh.geometry.getAttribute("position").array)).toEqual(original);
  });

  it("leaves basins, other waterways and unmarked meshes untouched", () => {
    const river = water(true), others = [water(false), water(), water("true")];
    for (const mesh of others) { mesh.position.y = 4; mesh.updateMatrixWorld(true); }
    const matrices = others.map(mesh => mesh.matrixWorld.clone());
    const stage = createRiverStageController([river, ...others]);
    stage.update(6);
    expect(river.position.y).toBeCloseTo(3.8);
    stage.reset();
    others.forEach((mesh, i) => {
      expect(mesh.position.y).toBe(4);
      expect(mesh.matrixWorld.equals(matrices[i]!)).toBe(true);
    });
  });

  it("bounds finite rise, resets invalid input and supports a custom baseline", () => {
    const mesh = water(true), stage = createRiverStageController([mesh], 4);
    for (const level of [4, 0, -100]) { stage.update(level); expect(mesh.position.y).toBe(0); }
    stage.update(6);
    expect(mesh.position.y).toBe(2);
    stage.update(Number.MAX_VALUE);
    expect(mesh.position.y).toBe(MAX_RIVER_RISE_METERS);
    for (const level of [NaN, Infinity, -Infinity]) {
      stage.update(6);
      stage.update(level);
      expect(mesh.position.y).toBe(0);
      expect(mesh.matrixWorld.elements.every(Number.isFinite)).toBe(true);
    }
    for (const baseline of [NaN, Infinity, -Infinity]) expect(() => createRiverStageController([], baseline)).toThrow(RangeError);
    expect(() => { const empty = createRiverStageController([]); empty.update(5); empty.reset(); }).not.toThrow();
  });
});
