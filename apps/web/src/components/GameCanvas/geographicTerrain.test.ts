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
  it("uses bit-identical normals at every shared actual DEM tile vertex", () => {
    const result = createGeographicTerrain(terrain, 12);
    const seen = new Map<string, number[]>();
    let shared = 0, mismatched = 0, nonUnit = 0;
    const materials = new Set<THREE.Material>();
    for (const object of result.group.children) {
      const mesh = object as THREE.Mesh;
      const p = mesh.geometry.getAttribute("position"), n = mesh.geometry.getAttribute("normal");
      for (let i = 0; i < p.count; i++) {
        const key = `${p.getX(i)}/${p.getZ(i)}`;
        const value = [p.getY(i), n.getX(i), n.getY(i), n.getZ(i)];
        if (seen.has(key)) { if (value.some((v, i) => v !== seen.get(key)![i])) mismatched++; shared++; }
        else seen.set(key, value);
      }
      for (const i of new Set(mesh.geometry.index!.array)) {
        if (Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) > 1e-6) nonUnit++;
      }
      mesh.geometry.dispose();
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
    }
    materials.forEach((m) => m.dispose());
    expect(shared).toBeGreaterThan(1000);
    expect({ mismatched, nonUnit }).toEqual({ mismatched: 0, nonUnit: 0 });
  });

  it("excludes no-data triangles from normals on both sides of tile seams", () => {
    const missing = { ...terrain, quality: terrain.quality.slice(), elevationsCm: terrain.elevationsCm.slice() };
    // Raster gap crosses multiple rendering-tile boundaries, independently of their resolution.
    for (let row = 80; row < 280; row++) for (let column = 120; column < 165; column++) {
      const i = row * metadata.width + column;
      missing.quality[i] = 0; missing.elevationsCm[i] = metadata.noData;
    }
    const spacing = 25;
    const result = createGeographicTerrain(missing, spacing);
    const cols = Math.ceil((result.bounds.maxX - result.bounds.minX) / spacing);
    const rows = Math.ceil((result.bounds.maxZ - result.bounds.minZ) / spacing);
    const seen = new Map<string, number[]>();
    const materials = new Set<THREE.Material>();
    let shared = 0, mismatched = 0, nonFinite = 0, missingNormals = 0, invalidReferences = 0;
    expect(result.stats.missingTriangles).toBeGreaterThan(0);
    expect(result.stats.triangles).toBeGreaterThan(0);
    for (const object of result.group.children) {
      const mesh = object as THREE.Mesh;
      const [, column, row] = mesh.name.split("-").map(Number);
      const width = Math.min(32, cols - column!);
      const p = mesh.geometry.getAttribute("position"), n = mesh.geometry.getAttribute("normal");
      const valid = new Set<number>();
      for (let i = 0; i < p.count; i++) {
        const x = result.bounds.minX + (result.bounds.maxX - result.bounds.minX) * (column! + i % (width + 1)) / cols;
        const z = result.bounds.minZ + (result.bounds.maxZ - result.bounds.minZ) * (row! + Math.floor(i / (width + 1))) / rows;
        if (result.sampleGround(x, z) !== null) valid.add(i);
        const value = [n.getX(i), n.getY(i), n.getZ(i)];
        if (!value.every(Number.isFinite)) nonFinite++;
        const key = `${p.getX(i)}/${p.getZ(i)}`;
        if (seen.has(key)) { if (value.some((v, i) => v !== seen.get(key)![i])) mismatched++; shared++; }
        else seen.set(key, value);
        if (!valid.has(i) && value.some((v) => v !== 0)) missingNormals++;
      }
      for (const i of mesh.geometry.index!.array) if (!valid.has(i)) invalidReferences++;
      mesh.geometry.dispose();
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
    }
    materials.forEach((m) => m.dispose());
    expect(shared).toBeGreaterThan(100);
    expect({ mismatched, nonFinite, missingNormals, invalidReferences }).toEqual({ mismatched: 0, nonFinite: 0, missingNormals: 0, invalidReferences: 0 });
  });

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
