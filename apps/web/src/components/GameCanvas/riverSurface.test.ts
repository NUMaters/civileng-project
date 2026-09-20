import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRiverSurfaceSampler, RIVER_SURFACE_CACHE_LIMIT, RIVER_SURFACE_EDGE_TOLERANCE } from "./riverSurface";
import { createRiverStageController } from "./riverStage";

const owned: THREE.Mesh[] = [];
function mesh(geometry: THREE.BufferGeometry, eligible: unknown = true) {
  const result = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  result.userData.riverStageEligible = eligible;
  owned.push(result);
  return result;
}
function triangle(indexed = false, reverse = false) {
  // y = 2 + x + 2z inside x >= 0, z >= 0, x + z <= 10.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 2, 0, 10, 12, 0, 0, 22, 10], 3));
  if (indexed) geometry.setIndex(reverse ? [2, 1, 0] : [0, 1, 2]);
  return geometry;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const object of owned.splice(0)) {
    object.geometry.dispose();
    (object.material as THREE.Material).dispose();
  }
});

describe("rendered river surface sampler", () => {
  it.each([[false, false], [true, false], [true, true]])("interpolates the actual triangle (indexed=%s, reverse=%s)", (indexed, reverse) => {
    const sample = createRiverSurfaceSampler([mesh(triangle(indexed, reverse))]);
    expect(sample(2, 3)).toBeCloseTo(10);
    expect(sample(0, 0)).toBe(2);
    expect(sample(10, 0)).toBe(12);
    expect(sample(0, 10)).toBe(22);
    expect(sample(5, 5)).toBeCloseTo(17);
    expect(sample(9, 9)).toBeNull(); // inside bounding box, outside triangle
  });

  it("reads increased, decreased and reset stage at the same cached coordinate", () => {
    const river = mesh(triangle()), sample = createRiverSurfaceSampler([river]);
    const stage = createRiverStageController([river]);
    expect(sample(2, 3)).toBeCloseTo(10);
    stage.update(5.2);
    expect(sample(2, 3)).toBeCloseTo(13);
    stage.update(3.2);
    expect(sample(2, 3)).toBeCloseTo(11);
    stage.reset();
    expect(sample(2, 3)).toBeCloseTo(10);
    river.position.y = 4; // no updateMatrixWorld or renderer tick required
    expect(sample(2, 3)).toBeCloseTo(14);
    expect(sample.cacheSize).toBe(1);
  });

  it("uses strict source eligibility, excluding ponds and other waterways", () => {
    const river = mesh(triangle());
    const others = [false, undefined, "true"].map(flag => {
      const other = mesh(triangle());
      other.userData.riverStageEligible = flag;
      other.position.y = 100;
      return other;
    });
    expect(createRiverSurfaceSampler(others)(2, 3)).toBeNull();
    expect(createRiverSurfaceSampler([river, river, ...others])(2, 3)).toBeCloseTo(10);
    expect(createRiverSurfaceSampler([])(0, 0)).toBeNull();
  });

  it("retains polygon holes and missing triangles with no height fallback", () => {
    const shape = new THREE.Shape();
    shape.moveTo(-10, -10); shape.lineTo(10, -10); shape.lineTo(10, 10); shape.lineTo(-10, 10); shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-2, -2); hole.lineTo(-2, 2); hole.lineTo(2, 2); hole.lineTo(2, -2); hole.closePath();
    shape.holes.push(hole);
    const river = mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, 7, 0));
    const sample = createRiverSurfaceSampler([river]);
    expect(sample(0, 0)).toBeNull();
    expect(sample(1.99, 0)).toBeNull();
    expect(sample(5, 0)).toBeCloseTo(7);
    river.position.y = 8;
    expect(sample(0, 0)).toBeNull();
    expect(sample(5, 0)).toBeCloseTo(15);
    expect(sample(11, 0)).toBeNull();
  });

  it("rejects invalid input, nodata vertices, degenerate triangles and invalid indices", () => {
    const river = mesh(triangle()), sample = createRiverSurfaceSampler([river]);
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(sample(value, 0)).toBeNull();
      expect(sample(0, value)).toBeNull();
    }
    expect(sample.cacheSize).toBe(0);
    expect(sample(Number.MAX_VALUE, Number.MAX_VALUE)).toBeNull();
    for (const value of [NaN, Infinity, -Infinity]) {
      const geometry = triangle(); geometry.getAttribute("position").setY(0, value);
      expect(createRiverSurfaceSampler([mesh(geometry)])(2, 3)).toBeNull();
    }
    const flat = triangle(); flat.getAttribute("position").setZ(2, 0);
    expect(createRiverSurfaceSampler([mesh(flat)])(2, 0)).toBeNull();
    const badIndex = triangle(); badIndex.setIndex([0, 1, 999]);
    expect(createRiverSurfaceSampler([mesh(badIndex)])(2, 3)).toBeNull();
    expect(createRiverSurfaceSampler([mesh(new THREE.BufferGeometry())])(0, 0)).toBeNull();
    river.position.y = NaN;
    expect(sample(2, 3)).toBeNull();
    river.position.y = 0;
    expect(sample(2, 3)).toBeCloseTo(10);
  });

  it("uses a metre-bounded edge tolerance without broad outside searches", () => {
    const sample = createRiverSurfaceSampler([mesh(triangle())]);
    const e = RIVER_SURFACE_EDGE_TOLERANCE;
    expect(e).toBeLessThanOrEqual(1e-4);
    expect(sample(-e / 2, 2)).toBeCloseTo(6);
    expect(sample(-e * 1.01, 2)).toBeNull();
    // Per-edge tolerance alone would incorrectly admit this outside corner.
    expect(sample(-e * 0.8, -e * 0.8)).toBeNull();
    expect(sample(5 + e, 5 + e)).toBeNull();
    expect(sample(-0.001, 2)).toBeNull();
    expect(sample(0, 2)).toBeCloseTo(6);
  });

  it("respects drawRange and indexes many spatially separated triangles", () => {
    const vertices: number[] = [];
    for (let i = 0; i < 32; i++) vertices.push(i * 20, i, 0, i * 20 + 10, i, 0, i * 20, i, 10);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setDrawRange(3, 30 * 3);
    const sample = createRiverSurfaceSampler([mesh(geometry)]);
    expect(sample(1, 1)).toBeNull();
    for (let i = 1; i < 31; i++) {
      expect(sample(i * 20 + 1, 1)).toBeCloseTo(i);
      expect(sample(i * 20 + 15, 1)).toBeNull();
    }
    expect(sample(621, 1)).toBeNull();
  });

  it("caches all overlapping mesh hits, then chooses the current upper surface", () => {
    const a = mesh(triangle()), b = mesh(triangle());
    b.position.y = 2;
    const sample = createRiverSurfaceSampler([a, b]);
    expect(sample(2, 3)).toBeCloseTo(12);
    a.position.y = 5;
    expect(sample(2, 3)).toBeCloseTo(15);
    a.visible = false;
    expect(sample(2, 3)).toBeCloseTo(12);
    a.visible = true; b.position.y = 10;
    expect(sample(2, 3)).toBeCloseTo(20);
    b.userData.riverStageEligible = false;
    expect(sample(2, 3)).toBeCloseTo(15);
  });

  it("bounds hit/miss caching, uses exact coordinates, and does not reread geometry or raycast", () => {
    const river = mesh(triangle()), sample = createRiverSurfaceSampler([river]);
    const positions = river.geometry.getAttribute("position");
    const read = vi.spyOn(positions, "getX");
    const raycast = vi.spyOn(river, "raycast");
    const traverse = vi.spyOn(river, "traverse");
    expect(sample(2, 3)).toBeCloseTo(10);
    expect(sample(2.00001, 3)).toBeCloseTo(10.00001, 7);
    expect(sample.cacheSize).toBe(2);
    for (let i = 0; i < RIVER_SURFACE_CACHE_LIMIT + 20; i++) sample(100 + i, 100);
    expect(sample.cacheSize).toBe(RIVER_SURFACE_CACHE_LIMIT);
    river.position.y = 6;
    expect(sample(2, 3)).toBeCloseTo(16); // evicted coordinate still works
    for (let i = 0; i < 100; i++) expect(sample(2, 3)).toBeCloseTo(16);
    expect(sample.cacheSize).toBe(RIVER_SURFACE_CACHE_LIMIT);
    expect(read).not.toHaveBeenCalled();
    expect(raycast).not.toHaveBeenCalled();
    expect(traverse).not.toHaveBeenCalled();
  });
});
