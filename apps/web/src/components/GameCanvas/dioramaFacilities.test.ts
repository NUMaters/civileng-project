import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createDioramaFacility } from "./dioramaFacilities";
import { createFacilityOperationVisuals } from "./facilityOperationVisuals";
import { configureDioramaThumbnailCamera } from "./dioramaThumbnails";
import { disposeDioramaObject } from "./disposeDioramaObject";

describe("sculpted facility models", () => {
  for (const [id, triangleBudget, draws, halfX, halfZ, height] of [
    ["levee", 1200, 4, 49, 19, 15.1],
    ["revetment", 2200, 3, 40, 12, 13.5],
    ["channel-dredging", 6200, 5, 39, 19, 33.7],
  ] as const) {
    it(`${id} preserves footprint, ownership, thumbnail and bounded budget`, () => {
      const group = createDioramaFacility(id);
      const other = createDioramaFacility(id);
      const resources = new Set<THREE.BufferGeometry | THREE.Material>();
      const camera = new THREE.PerspectiveCamera(32, 256 / 192, 0.1, 1000);
      configureDioramaThumbnailCamera(camera, group, id);
      let triangles = 0;
      for (const [index, child] of group.children.entries()) {
        const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
        const copy = other.children[index] as typeof mesh;
        expect(mesh.geometry).not.toBe(copy.geometry);
        expect(mesh.material).not.toBe(copy.material);
        expect(resources.has(mesh.geometry)).toBe(false);
        expect(resources.has(mesh.material)).toBe(false);
        resources.add(mesh.geometry); resources.add(mesh.material);
        const positions = mesh.geometry.getAttribute("position");
        triangles += positions.count / 3;
        expect(positions.array).toEqual(copy.geometry.getAttribute("position").array);
        expect(Array.from(mesh.geometry.getAttribute("normal").array).every(Number.isFinite)).toBe(true);
        for (let i = 0; i < positions.count; i++) {
          const p = new THREE.Vector3().fromBufferAttribute(positions, i).project(camera);
          expect(Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z))).toBeLessThan(1);
        }
      }
      const bounds = new THREE.Box3().setFromObject(group);
      console.info(id, triangles, group.children.length, bounds.min.toArray(), bounds.max.toArray());
      expect(triangles).toBeLessThanOrEqual(triangleBudget);
      expect(group.children).toHaveLength(draws);
      for (const [actual, expected] of [
        [bounds.min.x, -halfX], [bounds.max.x, halfX], [bounds.min.z, -halfZ],
        [bounds.max.z, halfZ], [bounds.min.y, 0], [bounds.max.y, height],
      ]) expect(actual).toBeCloseTo(expected, 4);
      expect(group.position.toArray()).toEqual([0, 0, 0]);
      expect(group.scale.toArray()).toEqual([1, 1, 1]);
      expect(group.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
      expect(group.userData.modelProvenance).toBe("illustrative-player-structure; not-surveyed");
      disposeDioramaObject(group); disposeDioramaObject(other);
    });
    it(`${id} keeps operational streaks clear on the river side`, () => {
      const model = createDioramaFacility(id);
      const operation = createFacilityOperationVisuals(id);
      model.updateMatrixWorld(true);
      for (const child of model.children) ((child as THREE.Mesh).material as THREE.Material).side = THREE.DoubleSide;
      const flow = operation.group.getObjectByName("directional-water-flow") as THREE.InstancedMesh;
      const matrix = new THREE.Matrix4();
      for (const amount of [0.001, 0.5, 1]) for (const time of [0, 1, 3, 5, 7.99]) {
        operation.update(amount, time);
        for (let i = 0; i < flow.count; i++) {
          flow.getMatrixAt(i, matrix);
          const start = new THREE.Vector3().setFromMatrixPosition(matrix);
          const direction = new THREE.Vector3(0, 0, id === "channel-dredging" && start.z < 0 ? -1 : 1);
          expect(new THREE.Raycaster(start, direction, 0.001, 30).intersectObject(model, true)).toHaveLength(0);
        }
      }
      disposeDioramaObject(model); disposeDioramaObject(operation.group);
    });
  }
  for (const id of ["drainage-pump", "retention-basin"]) {
    it(`${id} stays bounded, deterministic and independently owned`, () => {
      const a = createDioramaFacility(id);
      const b = createDioramaFacility(id);
      const resources = new Set<THREE.BufferGeometry | THREE.Material>();
      const disposed = vi.fn();
      let triangles = 0;
      a.children.forEach((child, i) => {
        const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
        const other = b.children[i] as typeof mesh;
        triangles += mesh.geometry.getAttribute("position").count / 3;
        expect(mesh.geometry).not.toBe(other.geometry);
        expect(mesh.material).not.toBe(other.material);
        expect(resources.has(mesh.geometry)).toBe(false);
        expect(resources.has(mesh.material)).toBe(false);
        resources.add(mesh.geometry);
        resources.add(mesh.material);
        mesh.geometry.addEventListener("dispose", disposed);
        mesh.material.addEventListener("dispose", disposed);
        expect(mesh.geometry.getAttribute("position").array).toEqual(other.geometry.getAttribute("position").array);
        expect(Array.from(mesh.geometry.getAttribute("normal").array).every(Number.isFinite)).toBe(true);
      });
      const bounds = new THREE.Box3().setFromObject(a);
      expect(a.position.toArray()).toEqual([0, 0, 0]);
      expect(a.scale.toArray()).toEqual([1, 1, 1]);
      expect(a.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-0.0001);
      expect(bounds.max.x).toBeLessThanOrEqual(id === "drainage-pump" ? 18.001 : 46.001);
      expect(bounds.min.x).toBeGreaterThanOrEqual(id === "drainage-pump" ? -18.001 : -46.001);
      expect(bounds.max.z).toBeLessThanOrEqual(id === "drainage-pump" ? 18.001 : 36.001);
      expect(bounds.min.z).toBeGreaterThanOrEqual(id === "drainage-pump" ? -18.001 : -36.001);
      expect(bounds.max.y).toBeLessThanOrEqual(id === "drainage-pump" ? 23.001 : 16.401);
      expect(a.children.length).toBeLessThanOrEqual(6);
      expect(a.userData.modelProvenance).toBe("illustrative-player-structure; not-surveyed");
      const blue = a.getObjectByName(`${id}:blue`) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      expect(blue.material.roughness).toBe(0.38);
      expect(triangles).toBeLessThanOrEqual(id === "drainage-pump" ? 4500 : 1700);
      console.info(`${id}: ${triangles} triangles, ${a.children.length} opaque draws`);
      for (const group of [a, b]) for (const child of group.children) {
        const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      expect(disposed).toHaveBeenCalledTimes(a.children.length * 2);
    });
  }
});
