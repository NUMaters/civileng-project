import * as THREE from "three";
import { expect, it } from "vitest";
import { GEOGRAPHIC_LIGHTING_STYLE as style } from "./geographicLightingStyle";

it("increases key/fill contrast without boosting exposure or changing sun/shadow configuration", () => {
  expect(style.sun.intensity / style.hemisphere.intensity).toBeGreaterThan(2.4 / .85);
  expect(style.exposure).toBeLessThanOrEqual(1);
  expect(style.fog.near).toBeGreaterThan(1700); expect(style.fog.far).toBeGreaterThan(style.fog.near);
  // Cooler ground fill avoids adding yellow-green illumination to every wall and road.
  const fill = new THREE.Color(style.hemisphere.ground);
  expect(fill.b).toBeGreaterThan(fill.g); expect(fill.g).toBeGreaterThan(fill.r);
  expect(style).not.toHaveProperty("shadow"); expect(style).not.toHaveProperty("sunPosition");
  expect(style.provenance).toContain("no change to source elevations");
});
