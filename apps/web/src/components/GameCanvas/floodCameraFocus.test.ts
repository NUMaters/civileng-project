import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { getFloodCameraFocus, frameRenderedFloodPatch, selectRenderedFloodPatch, type RenderedFloodPatch } from "./floodCameraFocus";

function patch(size = 40): RenderedFloodPatch {
  return { id: "actual-wet-grid", anchor: { x: 10, y: 4, z: 20 }, vertexCount: 12, areaM2: size * size,
    bounds: { minX: 10 - size / 2, maxX: 10 + size / 2, minY: 3, maxY: 5, minZ: 20 - size / 2, maxZ: 20 + size / 2 } };
}

describe("rendered flood camera planning", () => {
  it("selects by emitted area instead of inflated bounds, keeping ties stable", () => {
    const small = { ...patch(200), areaM2: 2 }, large = { ...patch(20), id: "large", areaM2: 100 };
    expect(selectRenderedFloodPatch([])).toBeNull();
    expect(selectRenderedFloodPatch([small, large])).toBe(large);
    expect(selectRenderedFloodPatch([large, { ...large, id: "tie" }])).toBe(large);
    const noArea = { ...patch(40), areaM2: undefined };
    expect(selectRenderedFloodPatch([small, noArea])).toBe(noArea);
  });

  it("ignores invalid or unrendered patches", () => {
    const p = patch();
    const invalid = [{ ...p, vertexCount: 0 }, { ...p, vertexCount: 4 }, { ...p, areaM2: NaN },
      { ...p, areaM2: 0 }, { ...p, anchor: { ...p.anchor, x: Infinity } },
      { ...p, bounds: { ...p.bounds, minX: 100 } }];
    expect(selectRenderedFloodPatch(invalid)).toBeNull();
    for (const bad of invalid) expect(frameRenderedFloodPatch(bad, 43, 390 / 700)).toBeNull();
  });

  it("keeps tiny patches at the controls minimum and targets the actual wet anchor", () => {
    const p = patch(3), plan = frameRenderedFloodPatch(p, 43, 390 / 700)!;
    expect(plan.distance).toBe(190);
    expect(plan.target).toEqual(p.anchor);
    expect(plan.target).not.toBe(p.anchor);
    const zero = { ...p, bounds: { minX: 10, maxX: 10, minY: 4, maxY: 4, minZ: 20, maxZ: 20 }, areaM2: undefined };
    expect(frameRenderedFloodPatch(zero, 43, 1)?.distance).toBe(190);
  });

  it("backs out further for portrait/narrow views and increased HUD padding", () => {
    const p = patch(120);
    const landscape = frameRenderedFloodPatch(p, 43, 1.5)!;
    const portrait = frameRenderedFloodPatch(p, 43, 390 / 700)!;
    const narrow = frameRenderedFloodPatch(p, 43, 0.3)!;
    expect(portrait.distance).toBeGreaterThan(landscape.distance);
    expect(narrow.distance).toBeGreaterThan(portrait.distance);
    expect(frameRenderedFloodPatch(p, 43, 1, 0.4)!.distance).toBeGreaterThan(frameRenderedFloodPatch(p, 43, 1, 0.8)!.distance);
    expect(narrow.distance).toBeLessThanOrEqual(1500);
  });

  it("fits every bounds corner inside usable portrait space for preserved camera directions", () => {
    const base = patch(100);
    // Off-center wet anchor; never substitute the possibly dry bounds midpoint.
    const p = { ...base, anchor: { x: base.bounds.minX + 1, y: 4, z: base.bounds.maxZ - 1 } };
    const result = frameRenderedFloodPatch(p, 43, 390 / 700)!;
    expect(result.target).toEqual(p.anchor);
    for (const direction of [[1, 1, 1], [-1, 2, 0.1], [0, 1, -2]]) {
      const camera = new THREE.PerspectiveCamera(43, 390 / 700, 1, 6000);
      const target = new THREE.Vector3(result.target.x, result.target.y, result.target.z);
      camera.position.copy(target).add(new THREE.Vector3(direction[0], direction[1], direction[2]).normalize().multiplyScalar(result.distance));
      camera.lookAt(target); camera.updateMatrixWorld(true);
      for (const x of [p.bounds.minX, p.bounds.maxX]) for (const y of [p.bounds.minY, p.bounds.maxY]) for (const z of [p.bounds.minZ, p.bounds.maxZ]) {
        const screen = new THREE.Vector3(x, y, z).project(camera);
        expect(Math.abs(screen.x)).toBeLessThan(0.9);
        expect(Math.abs(screen.y)).toBeLessThan(0.55);
        expect(screen.z).toBeGreaterThan(-1); expect(screen.z).toBeLessThan(1);
      }
    }
  });

  it("provides the main getFloodCameraFocus API with exact perspective fit and expandable distance", () => {
    const p = patch(600);
    const options = { verticalFovDegrees: 43, aspect: 390 / 700, margins: { top: 0.2, bottom: 0.3 } };
    const result = getFloodCameraFocus([p], options)!;
    expect(result.patchId).toBe(p.id);
    expect(result.distance).toBeGreaterThan(1500);
    const camera = new THREE.PerspectiveCamera(43, options.aspect, 1, 10000);
    const target = new THREE.Vector3(result.target.x, result.target.y, result.target.z);
    const offset = new THREE.Vector3(result.cameraOffset.x, result.cameraOffset.y, result.cameraOffset.z);
    expect(offset.length()).toBeCloseTo(result.distance);
    camera.position.copy(target).add(offset); camera.lookAt(target); camera.updateMatrixWorld(true);
    for (const x of [p.bounds.minX, p.bounds.maxX]) for (const y of [p.bounds.minY, p.bounds.maxY]) for (const z of [p.bounds.minZ, p.bounds.maxZ]) {
      const screen = new THREE.Vector3(x, y, z).project(camera);
      expect(Math.abs(screen.x)).toBeLessThan(0.84);
      expect(Math.abs(screen.y)).toBeLessThan(0.4);
    }
    expect(getFloodCameraFocus([patch(3)], options)!.distance).toBe(190);
    expect(getFloodCameraFocus([patch(3)], { ...options, minDistance: 120 })!.distance).toBe(120);
    expect(getFloodCameraFocus([p], { ...options, aspect: 0 })).toBeNull();
    expect(getFloodCameraFocus([p], { ...options, margins: { bottom: 0.5 } })).toBeNull();
    expect(getFloodCameraFocus([], options)).toBeNull();
  });

  it("returns null for invalid input and impossible capped fits, never NaN/Infinity", () => {
    for (const fov of [NaN, Infinity, 0, -1, 180]) expect(frameRenderedFloodPatch(patch(), fov, 1)).toBeNull();
    for (const aspect of [NaN, Infinity, 0, -1, 1e-300]) expect(frameRenderedFloodPatch(patch(), 43, aspect)).toBeNull();
    for (const ratio of [NaN, Infinity, 0, -1, 1.1]) expect(frameRenderedFloodPatch(patch(), 43, 1, ratio)).toBeNull();
    expect(frameRenderedFloodPatch(patch(1000), 43, 390 / 700)).toBeNull();
    expect(frameRenderedFloodPatch(patch(), 43, Number.MAX_VALUE)?.distance).toBeGreaterThanOrEqual(190);
  });
});
