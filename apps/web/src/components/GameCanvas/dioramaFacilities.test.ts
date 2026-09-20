import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createDioramaFacility } from "./dioramaFacilities";

describe("sculpted facility models", () => {
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
