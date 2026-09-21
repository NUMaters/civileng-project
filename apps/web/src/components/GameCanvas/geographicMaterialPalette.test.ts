import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { GEOGRAPHIC_MATERIAL_PALETTE as palette } from "./geographicMaterialPalette";
import { GEOGRAPHIC_LIGHTING_STYLE as lighting } from "./geographicLightingStyle";
import { createGeographicWorld } from "./geographicWorld";
import { worldToGeo } from "./dioramaSpace";
import { disposeDioramaObject } from "./disposeDioramaObject";
import { vegetationColor, vegetationHashUnit } from "./geographicVegetationStyle";

describe("vivid material candidate", () => {
  it("separates warm roofs/cool roofs/green ground without increasing exposure", () => {
    expect(palette.roofs).toHaveLength(5);
    const colors = palette.roofs.map(c => new THREE.Color(c));
    expect(colors.filter(c => c.r > c.b)).toHaveLength(3);
    expect(colors.filter(c => c.b > c.r)).toHaveLength(2);
    const ground = new THREE.Color(palette.ground);
    expect(ground.g).toBeGreaterThan(ground.r * 2);
    expect(ground.g).toBeGreaterThan(ground.b * 5);
    expect(lighting.exposure).toBe(0.95);
    expect(lighting.sun.intensity).toBe(2.5);
    expect(lighting.hemisphere.intensity).toBe(0.60);
    expect(palette.provenance).toContain("not surveyed");
    for (const id of ["osm/1", "campus/2", "riverbank/3"]) {
      const slot = Math.floor(vegetationHashUnit(id) * palette.crowns.length);
      expect(vegetationColor(id)).toEqual(new THREE.Color(palette.crowns[slot]));
    }
  });

  it("bakes only linear RGB palette changes into the existing roof/wall batch", () => {
    const ring: [number, number][] = [[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]].map(([x, z]) => {
      const p = worldToGeo(x!, z!); return [p.longitude, p.latitude];
    });
    const world = createGeographicWorld({ type: "FeatureCollection", bbox: [140, 37, 141, 38], features: [{
      type: "Feature", id: "palette-fixture", properties: { kind: "building", height: "10", version: 1, timestamp: "test" },
      geometry: { type: "MultiPolygon", coordinates: [[ring]] },
    }] }, { groundSampler: () => 12, allowIllustrativeHip: false });
    try {
      expect(world.children).toHaveLength(1);
      const mesh = world.children[0] as THREE.Mesh;
      const colors = mesh.geometry.getAttribute("color");
      const mask = mesh.geometry.getAttribute("roofMask");
      const positions = mesh.geometry.getAttribute("position");
      expect(positions.count).toBe(30); // Two roof triangles and eight wall triangles.
      const wall = new THREE.Color(palette.wall), roofs = palette.roofs.map(c => new THREE.Color(c));
      const close = (i: number, c: THREE.Color) => Math.abs(colors.getX(i) - c.r) < 1e-6 &&
        Math.abs(colors.getY(i) - c.g) < 1e-6 && Math.abs(colors.getZ(i) - c.b) < 1e-6;
      for (let i = 0; i < positions.count; i++) {
        expect(mask.getX(i) === 1 ? roofs.some(c => close(i, c)) : close(i, wall)).toBe(true);
        expect(positions.getY(i)).toBeGreaterThanOrEqual(12);
        expect(positions.getY(i)).toBeLessThanOrEqual(22.081);
      }
      expect(mesh.geometry.getAttribute("facadeUv").count).toBe(positions.count);
    } finally { disposeDioramaObject(world); }
  });
});
