import * as THREE from "three";
import { expect, it } from "vitest";
import { followGeographicShadows } from "./geographicShadows";
it("moves the shadow region with play without changing light direction or updating every frame", () => {
  const sun = new THREE.DirectionalLight();
  const target = new THREE.Vector3(200, 22, -1200);
  expect(followGeographicShadows(sun, target, true)).toBe(true);
  expect(sun.target.position.equals(target)).toBe(true);
  expect(sun.position.clone().sub(target).toArray()).toEqual([-360, 650, 300]);
  expect(followGeographicShadows(sun, target.clone().add(new THREE.Vector3(20, 0, 0)))).toBe(false);
  target.z += 200;
  expect(followGeographicShadows(sun, target)).toBe(true);
  expect(sun.position.clone().sub(target).toArray()).toEqual([-360, 650, 300]);
  sun.dispose();
});
