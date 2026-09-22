import * as THREE from "three";
import { expect, it } from "vitest";
import { resolveDredgingBaseY } from "./dredgingFloat";
import { createRiverSurfaceSampler } from "./riverSurface";

it("tracks a changing rendered water surface with the hull waterline at local Y=2", () => {
  const geometry = new THREE.PlaneGeometry(100, 100).rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial();
  const water = new THREE.Mesh(geometry, material);
  water.userData.riverStageEligible = true;
  const sample = createRiverSurfaceSampler([water]);
  try {
    for (const level of [0, 2.2, 6.5, 1.2, -3]) {
      water.position.y = level;
      const base = resolveDredgingBaseY(sample(10, 10), -10)!;
      expect(base + 2).toBeCloseTo(level);
      expect(base + 4).toBeGreaterThan(level); // deck remains above storm-end water
      expect(base).toBeLessThan(level);
      expect(resolveDredgingBaseY(sample(10, 10), null)).toBe(base);
    }
    expect(resolveDredgingBaseY(sample(1000, 1000), 8)).toBe(8.5);
    expect(resolveDredgingBaseY(sample(1000, 1000), null)).toBeNull();
  } finally { geometry.dispose(); material.dispose(); }
});

it("falls back only to finite known ground and never turns unknown elevation into zero", () => {
  for (const water of [null, NaN, Infinity, -Infinity]) {
    expect(resolveDredgingBaseY(water, 7)).toBe(7.5);
    expect(resolveDredgingBaseY(water, 0)).toBe(0.5);
    expect(resolveDredgingBaseY(water, -5)).toBe(-4.5);
    for (const ground of [null, NaN, Infinity, -Infinity]) expect(resolveDredgingBaseY(water, ground)).toBeNull();
  }
  for (const ground of [null, NaN, Infinity, -Infinity]) expect(resolveDredgingBaseY(0, ground)).toBe(-2);
});
