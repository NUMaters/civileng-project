import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createGeographicTrain, selectGeographicTrainTrack, sampleTrainTrack } from "./geographicTrain";
import type { KoriyamaGeodata } from "./koriyamaGeodata";
import { decodeKoriyamaTerrain, sampleKoriyamaTerrain } from "./koriyamaTerrain";
import { worldToGeo } from "./dioramaSpace";
const root = new URL("../../../public/geodata/koriyama/", import.meta.url);
const data: KoriyamaGeodata = JSON.parse(readFileSync(new URL("features.geojson", root), "utf8"));
const terrain = decodeKoriyamaTerrain(Uint8Array.from(readFileSync(new URL("terrain.bin", root))).buffer,
  JSON.parse(readFileSync(new URL("terrain-metadata.json", root), "utf8")));
describe("source-aligned commuter train", () => {
  it("batches windows and resamples ground while moving, hiding missing interior terrain", () => {
    let missing = false;
    const train = createGeographicTrain(data, () => missing ? null : 17);
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    let batches = 0, meshes = 0;
    train.group.traverse(object => {
      if (object instanceof THREE.Mesh) {
        meshes++; geometries.add(object.geometry);
        for (const m of Array.isArray(object.material) ? object.material : [object.material]) materials.add(m);
      }
      if (object instanceof THREE.InstancedMesh) { batches++; expect(object.count).toBe(7); }
    });
    try {
      expect(meshes).toBe(12); expect(batches).toBe(3);
      train.update(0);
      expect(train.group.children.every(car => car.visible)).toBe(true);
      for (const car of train.group.children) expect(car.position.y).toBeCloseTo(17.14);
      missing = true; train.update(1);
      expect(train.group.children.every(car => !car.visible)).toBe(true);
    } finally {
      train.group.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
    }
  });
  it("selects an actual mainline run inside measured terrain", () => {
    const track = selectGeographicTrainTrack(data, (x, z) => {
      const p = worldToGeo(x, z); return sampleKoriyamaTerrain(terrain, p.longitude, p.latitude).localY;
    });
    expect(track).not.toBeNull();
    const source = data.features.find(f => f.id === track!.sourceId)!;
    expect(source.properties.name).toBe("JR東北本線");
    expect(track!.length).toBeGreaterThan(200);
    for (const p of track!.points) {
      const sampled = sampleTrainTrack(track!.points, p.distance)!;
      expect(sampled.x).toBeCloseTo(p.x, 6); expect(sampled.z).toBeCloseTo(p.z, 6);
      expect(sampled.y).toBeCloseTo(p.y, 6);
    }
    expect(sampleTrainTrack(track!.points, -1)).toBeNull();
    expect(sampleTrainTrack(track!.points, track!.length + 1)).toBeNull();
  });
  it("does not fabricate a track when ground is unavailable", () => {
    expect(selectGeographicTrainTrack(data, () => null)).toBeNull();
  });
});
