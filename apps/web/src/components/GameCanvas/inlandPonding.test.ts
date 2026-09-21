import { readFileSync } from "node:fs";
import { afterAll, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createInlandPonding } from "./inlandPonding";
import { geoToWorld, worldToGeo } from "./dioramaSpace";
import { decodeKoriyamaTerrain, sampleKoriyamaTerrain } from "./koriyamaTerrain";
import type { KoriyamaGeodata } from "./koriyamaGeodata";
import { pointInPolygonDegrees } from "./riverPlacement";
import { listOverflowCandidates } from "../../features/disaster/services/overflowBankSites";
import { advanceFloodSimulation, beginDisaster, beginPreparation, type OverflowSite } from "../../features/disaster/services/floodSimulation";
import type { PlacedStructure } from "../../features/construction";
import { suggestedStructureHeading } from "../../features/disaster/services/hydraulicPlacement";
import { createGeographicTerrain } from "./geographicTerrain";
import { disposeDioramaObject } from "./disposeDioramaObject";

const bounds = { minX: -1000, minZ: -1000, maxX: 1000, maxZ: 1000 };
const site: OverflowSite = { id: "fixture", ...worldToGeo(0, 0), primaryHazard: "inlandPonding", intensity: 1, outflowHeadingDegrees: 0 };
const state = (time: number, sites = [site], depth = 1) => ({ phase: "disaster" as const,
  disasterElapsedSeconds: time, overflowSites: sites, floodDepthMeters: depth });
const options = { bounds, sampleGround: (x: number, z: number) => (x * x + z * z) / 500,
  classifyWater: () => "dry" as const, classifyFootprint: () => "dry" as const };

it("fades only the artificial domain edge and supplies finite local water depth without extra draws", () => {
  const field = createInlandPonding({ ...options, sampleGround: () => 0 });
  field.update(state(0)); field.update(state(10));
  const mesh = field.group.children[0] as THREE.Mesh;
  const attribute = mesh.geometry.getAttribute("inlandAppearance");
  let transparentEdge = 0, interior = 0;
  for (let i = 0; i < mesh.geometry.drawRange.count; i++) {
    expect(attribute.getX(i)).toBeGreaterThan(0);
    expect(Number.isFinite(attribute.getX(i))).toBe(true);
    expect(attribute.getY(i)).toBeGreaterThanOrEqual(0);
    expect(attribute.getY(i)).toBeLessThanOrEqual(1);
    if (attribute.getY(i) === 0) transparentEdge++;
    if (attribute.getY(i) === 1) interior++;
  }
  expect(transparentEdge).toBeGreaterThan(0); expect(interior).toBeGreaterThan(0);
  expect(field.stats.drawCalls).toBe(1);
  const snapshot = attribute.array.slice(); field.update(state(10));
  expect(attribute.array).toEqual(snapshot);
  expect((mesh.material as THREE.ShaderMaterial).fragmentShader).toContain("tonemapping_fragment");
  field.dispose();
});

it("emits a connected terrain contour, preserves source, and reports field coverage separately from demand", () => {
  const field = createInlandPonding(options);
  expect(field.sample(0, 0).status).toBe("unknown");
  field.update(state(0)); field.update(state(10));
  expect(field.sample(0, 0).status).toBe("wet");
  expect(field.sample(55, 55).status).toBe("dry");
  expect(field.sample(200, 200).status).toBe("unknown");
  expect(field.sample(1100, 0).status).toBe("outside");
  expect(field.stats.areaM2).toBeGreaterThan(100);
  expect(field.stats.areaM2).toBeLessThan(2000);
  const p = (field.group.children[0] as THREE.Mesh).geometry.getAttribute("position");
  const count = (field.group.children[0] as THREE.Mesh).geometry.drawRange.count;
  for (let i = 0; i < count; i++) expect(p.getY(i)).toBeGreaterThan(options.sampleGround(p.getX(i), p.getZ(i)));
  expect(site).toMatchObject({ longitude: worldToGeo(0, 0).longitude, latitude: worldToGeo(0, 0).latitude });
  field.dispose();
});

it("retains a puddle when its source vanishes; pause/result freeze, rewind/reset clear, disposal once", () => {
  const field = createInlandPonding(options);
  field.update(state(0)); field.update(state(10)); const area = field.stats.areaM2;
  field.update(state(10, [])); expect(field.stats.areaM2).toBe(area);
  field.update(state(11, [])); expect(field.stats.areaM2).toBeGreaterThan(0); expect(field.stats.areaM2).toBeLessThan(area);
  const remaining = field.stats.areaM2;
  field.update({ ...state(20, []), phase: "result" }); expect(field.stats.areaM2).toBe(remaining);
  field.update(state(0)); expect(field.stats.sites).toBe(0);
  field.update(state(10)); expect(field.stats.areaM2).toBeCloseTo(area);
  const mesh = field.group.children[0] as THREE.Mesh;
  const geometry = vi.spyOn(mesh.geometry, "dispose"), material = vi.spyOn(mesh.material as THREE.Material, "dispose");
  field.dispose(); field.dispose(); expect(geometry).toHaveBeenCalledTimes(1); expect(material).toHaveBeenCalledTimes(1);
  expect(field.sample(0, 0).status).toBe("unknown");
});

it("excludes water/no-data cells and does not cross a disconnected dry ridge or sample outside bounds", () => {
  const sampleGround = vi.fn((x: number, z: number) => x > 8 && x < 16 ? null : z > 8 && z < 16 ? 10 : 0);
  const field = createInlandPonding({ bounds: { minX: -20, maxX: 60, minZ: -20, maxZ: 60 }, sampleGround,
    classifyWater: (x, z) => x < -8 && z < -8 ? "water" : "dry",
    classifyFootprint: (x, z) => x < -8 && z < -8 ? "water" : "dry" });
  field.update(state(0)); field.update(state(10));
  expect(field.sample(0, 0).status).toBe("wet");
  expect(field.sample(12, 0).status).toBe("unknown");
  expect(field.sample(-12, -12).status).toBe("unknown");
  expect(field.sample(0, 30).status).toBe("dry");
  expect(field.sample(30, 0).status).toBe("dry");
  for (const [x, z] of sampleGround.mock.calls) expect(x >= -20 && x <= 60 && z >= -20 && z <= 60).toBe(true);
  const calls = sampleGround.mock.calls.length;
  field.update(state(11)); expect(sampleGround.mock.calls.length).toBe(calls);
  field.dispose();
});

it("caps source/geometry resources and ignores river sources without relocating rejected seeds", () => {
  const field = createInlandPonding(options);
  const sites = Array.from({ length: 20 }, (_, i) => ({ ...site, id: `${i}` }));
  field.update(state(0, sites)); field.update(state(10, sites));
  expect(field.stats.sites).toBe(4); expect(field.group.children).toHaveLength(4);
  expect(field.stats.triangles * 3).toBeLessThanOrEqual(field.stats.maxVertices);
  field.update({ ...state(0), phase: "preparation" }); expect(field.stats.sites).toBe(0);
  field.update(state(0, [{ ...site, primaryHazard: "overtopping" }]));
  field.update(state(10, [{ ...site, primaryHazard: "overtopping" }])); expect(field.stats.sites).toBe(0);
  field.dispose();
});

it("retires absent fully receded sources and reuses their four slots for a fifth source", () => {
  const field = createInlandPonding(options);
  const first = Array.from({ length: 4 }, (_, i) => ({ ...site, id: `old-${i}` }));
  field.update(state(0, first)); field.update(state(10, first));
  const meshes = field.group.children.slice() as THREE.Mesh[];
  const disposals = meshes.map(m => vi.spyOn(m.geometry, "dispose"));
  const material = vi.spyOn(meshes[0]!.material as THREE.Material, "dispose");
  field.update(state(11, [])); expect(field.stats.sites).toBe(4);
  // A vanished source isn't immediately deleted; a long recession frees slots.
  const fifth = { ...site, id: "fifth" };
  field.update(state(110, [fifth])); expect(field.stats.sites).toBe(0);
  expect(field.stats.allocatedVertices).toBe(0); expect(field.group.children).toHaveLength(0);
  for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  expect(material).not.toHaveBeenCalled();
  expect(field.sample(0, 0).status).toBe("unknown");
  field.update(state(111, [fifth])); expect(field.stats.sites).toBe(1);
  expect(field.group.children[0]!.userData.source.id).toBe("fifth");
  expect(field.sample(0, 0).status).toBe("wet");
  field.dispose(); for (const dispose of disposals) expect(dispose).toHaveBeenCalledTimes(1);
  expect(material).toHaveBeenCalledTimes(1);
});

const read = (file: string) => readFileSync(new URL(`../../../public/geodata/koriyama/${file}`, import.meta.url));
const metadata = JSON.parse(read("terrain-metadata.json").toString());
const terrain = decodeKoriyamaTerrain(Uint8Array.from(read("terrain.bin")).buffer, metadata);
const rendered = createGeographicTerrain(terrain, 12);
afterAll(() => disposeDioramaObject(rendered.group));
const data: KoriyamaGeodata = JSON.parse(read("features.geojson").toString());
const waters = data.features.filter(f => f.properties.kind === "water" || f.properties.kind === "waterway")
  .flatMap(f => f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [])
  .map(rings => rings.map(ring => ring.map(([lon, lat]) => ({ lon, lat }))));
const nw = geoToWorld(metadata.bounds[0], metadata.bounds[3]), se = geoToWorld(metadata.bounds[2], metadata.bounds[1]);
const actual = { bounds: { minX: nw.x, minZ: nw.z, maxX: se.x, maxZ: se.z },
  sampleGround: (x: number, z: number) => { const p = worldToGeo(x, z);
    return sampleKoriyamaTerrain(terrain, p.longitude, p.latitude).localY === null ? null : rendered.sampleRenderedGround(x, z); },
  classifyWater: (x: number, z: number): "water" | "dry" | "unknown" => { const p = worldToGeo(x, z); return waters.some(rings =>
    pointInPolygonDegrees(p.longitude, p.latitude, rings[0]!) && !rings.slice(1).some(r => pointInPolygonDegrees(p.longitude, p.latitude, r))) ? "water" : "dry"; },
  // Polygon/rectangle overlap oracle for this OSM-only fixture, not the
  // production rendered triangle mask. Also detects enclosed thin polygons.
  classifyFootprint: (minX: number, minZ: number, maxX: number, maxZ: number): "water" | "dry" | "unknown" =>
    [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]].some(([x, z]) => actual.classifyWater(x!, z!) === "water") ||
    waterEdges.some(([a, b]) => {
      let low = 0, high = 1;
      for (const [start, delta, min, max] of [[a.x, b.x - a.x, minX, maxX], [a.z, b.z - a.z, minZ, maxZ]]) {
        if (Math.abs(delta!) < 1e-12) { if (start! < min! || start! > max!) return false; }
        else { const t1 = (min! - start!) / delta!, t2 = (max! - start!) / delta!;
          low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2)); }
      }
      return low <= high;
    }) ? "water" : "dry",
};
const waterEdges = waters.flatMap(rings => rings.flatMap(ring => ring.slice(1).map((p, i) =>
  [geoToWorld(ring[i]!.lon, ring[i]!.lat), geoToWorld(p.lon, p.lat)] as const)));

it.each(["inland-campus", "inland-south"])("keeps actual %s source fixed and contours on bundled DEM/OSM land", id => {
  const source = { ...listOverflowCandidates().find(s => s.id === id)!, intensity: 0.8 };
  const field = createInlandPonding(actual);
  field.update(state(0, [source])); field.update(state(20, [source]));
  const p = geoToWorld(source.longitude, source.latitude);
  expect(field.sample(p.x, p.z).status).toBe("wet");
  expect(field.stats.areaM2).toBeGreaterThan(10);
  for (const object of field.group.children) {
    const g = (object as THREE.Mesh).geometry, v = g.getAttribute("position");
    for (let i = 0; i < g.drawRange.count; i++) {
      expect(actual.classifyWater(v.getX(i), v.getZ(i))).toBe("dry");
      expect(actual.sampleGround(v.getX(i), v.getZ(i))).not.toBeNull();
    }
  }
  console.info(id, { ...field.stats }); field.dispose();
});

it("shows less inland ponding with pump than without using identical actual simulation weather/time", () => {
  const position = { longitude: 140.3790252355544, latitude: 37.36042958969283, height: 20 };
  const pump: PlacedStructure = { id: "pump", structureId: "drainage-pump", position,
    headingDegrees: suggestedStructureHeading("drainage-pump", position) };
  const run = (placements: PlacedStructure[]) => {
    const field = createInlandPonding(actual);
    let s = beginDisaster(beginPreparation(), { weatherSeed: 42601 }); field.update(s);
    for (let i = 0; i < 900; i++) { s = advanceFloodSimulation(s, placements, 0.1); field.update(s); }
    const result = { area: field.stats.areaM2, depth: s.floodDepthMeters, sites: field.stats.sites };
    field.dispose(); return result;
  };
  const baseline = run([]), pumped = run([pump]);
  console.info("same-seed actual simulation", { baseline, pumped });
  expect(baseline.sites).toBe(2); expect(baseline.area).toBeGreaterThan(0);
  expect(pumped.depth).toBeLessThan(baseline.depth);
  // This real DEM has broad downhill land: do not tune terrain/head to manufacture
  // a chosen percentage. Require a visible, non-roundoff footprint difference.
  expect(baseline.area - pumped.area).toBeGreaterThan(500);
});

it("never treats unknown mask coverage as dry, and caches rejected seeds", () => {
  const sampleGround = vi.fn(() => 0);
  const field = createInlandPonding({ bounds, sampleGround, classifyWater: () => "unknown", classifyFootprint: () => "unknown" });
  field.update(state(0)); field.update(state(1)); field.update(state(2));
  expect(field.stats.rejectedSites).toBe(1); expect(field.stats.sites).toBe(0);
  expect(field.sample(0, 0).status).toBe("unknown"); expect(sampleGround).not.toHaveBeenCalled();
  field.dispose();
});

it("is deterministic at equivalent constant-input elapsed times and limits uploads to 10Hz", () => {
  const a = createInlandPonding(options), b = createInlandPonding(options);
  a.update(state(0)); b.update(state(0));
  a.update(state(0.05)); expect(a.stats.sites).toBe(0);
  for (let i = 1; i <= 100; i++) a.update(state(i / 10));
  b.update(state(10));
  expect(a.stats.areaM2).toBeCloseTo(b.stats.areaM2, 6);
  expect(a.sample(0, 0).depthMeters).toBeCloseTo(b.sample(0, 0).depthMeters!, 9);
  a.dispose(); b.dispose();
});

it("excludes a thin waterway missed by all nine points, caches footprint queries, and rejects unknown cells", () => {
  // Cell x=2..6 has sample x=2,4,6: the 0.2m strip at 4.6..4.8 is missed.
  const classifyFootprint = vi.fn((minX: number, _minZ: number, maxX: number) =>
    minX <= 4.8 && maxX >= 4.6 ? "water" as const : minX >= 10 ? "unknown" as const : "dry" as const);
  const field = createInlandPonding({ ...options, sampleGround: () => 0,
    classifyWater: x => x >= 4.6 && x <= 4.8 ? "water" : "dry", classifyFootprint });
  field.update(state(0)); field.update(state(10));
  expect(field.sample(0, 0).status).toBe("wet");
  expect(field.sample(3, 0).status).toBe("unknown");
  expect(field.sample(12, 0).status).toBe("unknown");
  const calls = classifyFootprint.mock.calls.length;
  expect(calls).toBeLessThanOrEqual(1024);
  field.update(state(11)); expect(classifyFootprint).toHaveBeenCalledTimes(calls);
  const mesh = field.group.children[0] as THREE.Mesh, p = mesh.geometry.getAttribute("position");
  for (let i = 0; i < mesh.geometry.drawRange.count; i++) expect(p.getX(i)).toBeLessThanOrEqual(2);
  field.dispose();
});

it("uses rendered terrain heights after raw validity checking, without a raw-height fallback", () => {
  const raw = (x: number) => x >= 8 ? null : 0;
  const rendered = (x: number) => x <= -8 ? null : 0.45;
  const field = createInlandPonding({ ...options, sampleGround: (x) => raw(x) === null ? null : rendered(x) });
  field.update(state(0, [site], 0)); field.update(state(10, [site], 0));
  const mesh = field.group.children[0] as THREE.Mesh, p = mesh.geometry.getAttribute("position");
  expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
  for (let i = 0; i < mesh.geometry.drawRange.count; i++) expect(p.getY(i)).toBeGreaterThan(0.45);
  expect(field.sample(10, 0).status).toBe("unknown"); expect(field.sample(-10, 0).status).toBe("unknown");
  field.dispose();
});
