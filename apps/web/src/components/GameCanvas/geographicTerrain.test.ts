import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createGeographicTerrain } from "./geographicTerrain";
import { decodeKoriyamaTerrain, sampleKoriyamaTerrain } from "./koriyamaTerrain";
import { geoToWorld, worldToGeo } from "./dioramaSpace";

const base = new URL("../../../public/geodata/koriyama/", import.meta.url);
const metadata = JSON.parse(readFileSync(new URL("terrain-metadata.json", base), "utf8"));
const terrain = decodeKoriyamaTerrain(Uint8Array.from(readFileSync(new URL("terrain.bin", base))).buffer, metadata);

describe("measured terrain mesh", () => {
  it("preserves actual elevations and upward triangle winding in bounded tiles", () => {
    const result = createGeographicTerrain(terrain, 25);
    expect(result.stats.tiles).toBeGreaterThan(1);
    expect(result.stats.triangles).toBeGreaterThan(10000);
    for (const object of result.group.children) {
      const mesh = object as THREE.Mesh;
      const positions = mesh.geometry.getAttribute("position");
      const normals = mesh.geometry.getAttribute("normal");
      expect(positions.count).toBeLessThanOrEqual(33 * 33);
      const indices = mesh.geometry.index!;
      for (let n = 0; n < indices.count; n += 57) {
        const i = indices.getX(n);
        const p = worldToGeo(positions.getX(i), positions.getZ(i));
        // GPU float32 X/Z can round an exact boundary a fraction of a mm outward.
        expect(p.longitude).toBeGreaterThanOrEqual(metadata.bounds[0] - 1e-8);
        expect(p.longitude).toBeLessThanOrEqual(metadata.bounds[2] + 1e-8);
        expect(p.latitude).toBeGreaterThanOrEqual(metadata.bounds[1] - 1e-8);
        expect(p.latitude).toBeLessThanOrEqual(metadata.bounds[3] + 1e-8);
        const measured = sampleKoriyamaTerrain(terrain,
          Math.max(metadata.bounds[0], Math.min(metadata.bounds[2], p.longitude)),
          Math.max(metadata.bounds[1], Math.min(metadata.bounds[3], p.latitude)));
        expect(measured.localY).not.toBeNull();
        expect(positions.getY(i)).toBeCloseTo(measured.localY!, 2);
        expect(normals.getY(i)).toBeGreaterThan(0);
      }
      mesh.geometry.dispose();
    }
    ((result.group.children[0] as THREE.Mesh).material as THREE.Material).dispose();
  });
  it("does not create flat ground when all elevations are missing", () => {
    const empty = { ...terrain, quality: new Uint8Array(terrain.quality.length),
      elevationsCm: new Int32Array(terrain.elevationsCm.length).fill(metadata.noData) };
    const result = createGeographicTerrain(empty, 50);
    expect(result.group.children).toHaveLength(0);
    expect(result.stats.missingTriangles).toBeGreaterThan(0);
    const p = geoToWorld(140.3837, 37.3655);
    expect(result.sampleGround(p.x, p.z)).toBeNull();
  });
  it("rejects unusable mesh resolutions", () => {
    for (const spacing of [0, NaN, Infinity, 101])
      expect(() => createGeographicTerrain(terrain, spacing)).toThrow(RangeError);
  });
});
