import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import * as THREE from "three";
import { createInlandPonding } from "./inlandPonding";
import { createRenderedWaterMask } from "./renderedWaterMask";
import { createGeographicTerrain } from "./geographicTerrain";
import { createGeographicWorld } from "./geographicWorld";
import { decodeKoriyamaTerrain } from "./koriyamaTerrain";
import type { KoriyamaGeodata } from "./koriyamaGeodata";
import { disposeDioramaObject } from "./disposeDioramaObject";
import { listOverflowCandidates } from "../../features/disaster/services/overflowBankSites";
import { advanceFloodSimulation, beginDisaster, beginPreparation } from "../../features/disaster/services/floodSimulation";
import { suggestedStructureHeading } from "../../features/disaster/services/hydraulicPlacement";

const read = (file: string) => readFileSync(new URL(`../../../public/geodata/koriyama/${file}`, import.meta.url));
const terrain = createGeographicTerrain(decodeKoriyamaTerrain(Uint8Array.from(read("terrain.bin")).buffer,
  JSON.parse(read("terrain-metadata.json").toString())), 12);
const osm: KoriyamaGeodata = JSON.parse(read("features.geojson").toString());
const world = createGeographicWorld({ ...osm, features: osm.features.filter(f => ["water", "waterway"].includes(f.properties.kind)) }, {
  localBounds: terrain.bounds, groundSampler: terrain.sampleGround, surfaceGridSpacing: 12,
  surfaceSampler: (x, z) => { const y = terrain.sampleGround(x, z); return y === null ? null : y + 0.35; },
});
const mask = createRenderedWaterMask(world.waterMeshes, terrain.bounds);
const options = { bounds: terrain.bounds,
  renderedSurface: terrain.renderedSurface,
  sampleGround: (x: number, z: number) => terrain.sampleGround(x, z) === null ? null : terrain.sampleRenderedGround(x, z),
  classifyWater: mask.classify, classifyFootprint: mask.classifyFootprint,
};
afterAll(() => { disposeDioramaObject(world); disposeDioramaObject(terrain.group); });

it("both actual inland fields stay above rendered terrain and cannot overlap any water ribbon/polygon", () => {
  const field = createInlandPonding(options);
  try {
    const sites = listOverflowCandidates().filter(s => s.primaryHazard === "inlandPonding").map(s => ({ ...s, intensity: 0.8 }));
    expect(sites).toHaveLength(2); expect(mask.stats.meshes).toBe(51);
    let tested = 0, minClearance = Infinity;
    for (const [elapsed, floodDepthMeters] of [[0, 0], [1, 0], [5, 0.05], [10, 0.15], [15, 0.35], [20, 0.7], [25, 1], [30, 1.5]]) {
      field.update({ phase: "disaster", disasterElapsedSeconds: elapsed!, overflowSites: sites, floodDepthMeters: floodDepthMeters! });
      for (const object of field.group.children) {
        const mesh = object as THREE.Mesh, p = mesh.geometry.getAttribute("position");
        for (let i = 0; i < mesh.geometry.drawRange.count; i += 3) {
          const xs = [p.getX(i), p.getX(i + 1), p.getX(i + 2)], zs = [p.getZ(i), p.getZ(i + 1), p.getZ(i + 2)];
          expect(mask.classifyFootprint(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs))).toBe("dry");
          // Vertices, edge interiors and triangle interiors, not merely grid centres.
          for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4 - a; b++) {
            const u = a / 4, v = b / 4, w = 1 - u - v;
            const x = xs[0]! * u + xs[1]! * v + xs[2]! * w, z = zs[0]! * u + zs[1]! * v + zs[2]! * w;
            const ground = options.sampleGround(x, z); expect(ground).not.toBeNull();
            minClearance = Math.min(minClearance, p.getY(i) - ground!); tested++;
          }
        }
      }
    }
    console.info("actual all-water integration", { ...field.stats, tested, minClearance });
    expect(field.stats.sites).toBe(2); expect(field.stats.areaM2).toBeGreaterThan(100);
    expect(tested).toBeGreaterThan(10000); expect(minClearance).toBeGreaterThanOrEqual(0.034);
  } finally { field.dispose(); }
});

it("actual rendered-water mask plus terrain shows reduced ponding with pump, with no scoring feedback", () => {
  const position = { longitude: 140.3790252355544, latitude: 37.36042958969283, height: 20 };
  const pump = { id: "pump", structureId: "drainage-pump", position, headingDegrees: suggestedStructureHeading("drainage-pump", position) };
  const run = (withPump: boolean) => {
    const field = createInlandPonding(options);
    const updateMs: number[] = [];
    let state = beginDisaster(beginPreparation(), { weatherSeed: 42601 });
    field.update(state);
    for (let i = 0; i < 900; i++) {
      state = advanceFloodSimulation(state, withPump ? [pump] : [], 0.1);
      const input = JSON.stringify(state);
      const started = performance.now(); field.update(state);
      if (field.stats.sites) updateMs.push(performance.now() - started);
      expect(JSON.stringify(state)).toBe(input);
    }
    updateMs.sort((a, b) => a - b);
    const result = { areaM2: field.stats.areaM2, drawCalls: field.stats.drawCalls, depth: state.floodDepthMeters,
      allocatedPositionBytes: field.stats.allocatedVertices * 3 * Float32Array.BYTES_PER_ELEMENT,
      activeUpdates: updateMs.length, medianMs: updateMs[Math.floor(updateMs.length / 2)],
      p95Ms: updateMs[Math.floor(updateMs.length * 0.95)], maxMs: updateMs.at(-1) };
    field.dispose(); return result;
  };
  const baseline = run(false), pumped = run(true);
  console.info("all-water/DEM actual simulation comparison", { baseline, pumped });
  expect(baseline.areaM2 - pumped.areaM2).toBeGreaterThan(500);
  expect(pumped.depth).toBeLessThan(baseline.depth);
  expect(baseline.drawCalls).toBe(2); expect(pumped.drawCalls).toBe(2);
});

it("Diorama constructs mask once, preserves river field, forwards authoritative elapsed, and disposes before scene", () => {
  const source = readFileSync(new URL("./DioramaGameMap.tsx", import.meta.url), "utf8");
  expect(source).toContain("createRenderedWaterMask(world.waterMeshes, terrain.bounds)");
  expect(source).toContain("terrain.sampleGround(x, z) === null ? null : terrain.sampleRenderedGround(x, z)");
  expect(source).toContain("createDioramaInundation(terrain.sampleGround, riverBoundary)");
  const frame = source.slice(source.indexOf("const draw ="), source.indexOf("latest.current.onReadyChange?.(true)"));
  expect(frame).not.toContain("createRenderedWaterMask(");
  expect(frame).toContain("if (state) inlandPonding.update(state)");
  expect(source.indexOf("scene.remove(inlandPonding.group)")).toBeLessThan(source.indexOf("inlandPonding.dispose()"));
  expect(source.indexOf("inlandPonding.dispose()")).toBeLessThan(source.indexOf("disposeObject(scene)"));
});
