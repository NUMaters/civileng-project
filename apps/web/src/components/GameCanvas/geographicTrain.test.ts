import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { selectGeographicTrainTrack, sampleTrainTrack } from "./geographicTrain";
import type { KoriyamaGeodata } from "./koriyamaGeodata";
import { decodeKoriyamaTerrain, sampleKoriyamaTerrain } from "./koriyamaTerrain";
import { worldToGeo } from "./dioramaSpace";
const root = new URL("../../../public/geodata/koriyama/", import.meta.url);
const data: KoriyamaGeodata = JSON.parse(readFileSync(new URL("features.geojson", root), "utf8"));
const terrain = decodeKoriyamaTerrain(Uint8Array.from(readFileSync(new URL("terrain.bin", root))).buffer,
  JSON.parse(readFileSync(new URL("terrain-metadata.json", root), "utf8")));
describe("source-aligned commuter train", () => {
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
