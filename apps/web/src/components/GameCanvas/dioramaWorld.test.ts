import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { createDioramaWorld } from "./dioramaWorld";
import { riverX, RIVER_POINTS } from "./dioramaSpace";

const worlds: THREE.Group[] = [];
function createWorld() {
  const world = createDioramaWorld();
  worlds.push(world);
  return world;
}
function batch(world: THREE.Group, name: string): THREE.InstancedMesh {
  const mesh = world.getObjectByName(name);
  expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
  return mesh as THREE.InstancedMesh;
}
function transforms(mesh: THREE.InstancedMesh) {
  return Array.from({ length: mesh.count }, (_, index) => {
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(index, matrix);
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    matrix.decompose(position, new THREE.Quaternion(), scale);
    return { position, scale };
  });
}
afterEach(() => {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  for (const world of worlds.splice(0)) {
    world.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
      }
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
  }
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
});

describe("toy town scenery", () => {
  it("mixes cottages, townhouses and flat-roof apartments within a bounded instanced budget", () => {
    const world = createWorld();
    const walls = transforms(batch(world, "walls"));
    for (const height of [9, 18, 36, 45]) {
      expect(walls.filter(({ scale }) => scale.y === height).length).toBeGreaterThan(10);
    }
    expect(batch(world, "roofs").count).toBeLessThan(
      walls.filter(({ scale }) => scale.y >= 9).length,
    );
    // Ten terrain/road ribbons plus at most 21 instanced batches (two new detail batches).
    expect(world.children.length).toBeLessThanOrEqual(31);
    let instances = 0;
    for (const child of world.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      if (!child.geometry.getAttribute("color")) {
        // Road ribbons use uniform materials; all objects other than ribbons are instanced.
        if (!child.name.includes("road") && child.name !== "continuous-green-bank") {
          expect(child).toBeInstanceOf(THREE.InstancedMesh);
        }
      }
      if (child instanceof THREE.InstancedMesh) instances += child.count;
    }
    expect(instances).toBeLessThan(20000);
  });

  it("preserves the actual river edge at every centerline knot", () => {
    const banks = createWorld().children.filter((child) => child.name === "continuous-green-bank");
    expect(banks).toHaveLength(2);
    banks.forEach((bank, index) => {
      const positions = (bank as THREE.Mesh).geometry.getAttribute("position");
      const zs: number[] = [];
      for (let vertex = 0; vertex < positions.count; vertex += 9) {
        const z = positions.getZ(vertex);
        zs.push(z);
        expect(positions.getX(vertex)).toBeCloseTo(riverX(z) + (index === 0 ? -44 : 44), 3);
      }
      for (const point of RIVER_POINTS.filter((point) => point.z > -2200 && point.z < 1800)) {
        expect(zs.some((z) => Math.abs(z - point.z) < 0.001)).toBe(true);
      }
    });
  });

  it("keeps added details out of the open bank and buildings beyond the sidewalk", () => {
    const world = createWorld();
    for (const [name, min, max] of [
      ["rocks", 43, 54],
      ["flowers", 83, 92],
    ] as const) {
      const details = transforms(batch(world, name));
      expect(details.length).toBeGreaterThan(50);
      for (const { position, scale } of details) {
        for (const z of [position.z - scale.z, position.z, position.z + scale.z]) {
          const offset = Math.abs(position.x - riverX(z));
          expect(offset - scale.x).toBeGreaterThan(min);
          expect(offset + scale.x).toBeLessThan(max);
        }
        expect(Math.abs(position.z + 400)).toBeGreaterThan(40);
        expect(Math.abs(position.z - 640)).toBeGreaterThan(40);
      }
    }
    for (const { position, scale } of transforms(batch(world, "walls"))) {
      for (const z of [position.z - scale.z / 2, position.z + scale.z / 2]) {
        expect(Math.abs(position.x - riverX(z)) - scale.x / 2).toBeGreaterThan(127);
      }
    }
  });

  it("produces identical instance positions and colors on repeated creation", () => {
    const first = createWorld();
    const second = createWorld();
    for (const child of first.children) {
      if (!(child instanceof THREE.InstancedMesh)) continue;
      const other = batch(second, child.name);
      expect(other.count).toBe(child.count);
      expect(
        other.instanceMatrix.array.every((value, i) => value === child.instanceMatrix.array[i]),
      ).toBe(true);
      expect(
        other.instanceColor?.array.every((value, i) => value === child.instanceColor?.array[i]),
      ).toBe(true);
    }
  });
});
