import * as THREE from "three";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canopyContainsCrown, convertImageryCanopyObservations, createGeographicCanopy, type CanopyOptions, type CanopyPatch, type ImageryCanopyObservations } from "./geographicCanopy";
import { convertImageryTreeObservations, type ImageryTreeObservations, type VegetationPoint } from "./imageryVegetation";
import { createImageryVegetationExclusions } from "./imageryVegetationExclusions";
import { intersectsVegetationExclusion } from "./geographicImageryVegetation";
import { createVegetationStyleResources, vegetationColor } from "./geographicVegetationStyle";
import { disposeDioramaObject } from "./disposeDioramaObject";
import { koriyamaGeoToLocal } from "./koriyamaGeodata";
import { worldToGeo } from "./dioramaSpace";
import { decodeKoriyamaTerrain, sampleKoriyamaTerrain } from "./koriyamaTerrain";

const read = (file: string) => readFileSync(new URL(`../../../public/geodata/koriyama/${file}`, import.meta.url));
const source: ImageryCanopyObservations = JSON.parse(read("imagery-canopy-observations.json").toString());
const observed: ImageryTreeObservations = JSON.parse(read("imagery-tree-observations.json").toString());
const groups: THREE.Group[] = [];
const ring = (x: number, z: number, n: number) => [{ x, z }, { x: x + n, z }, { x: x + n, z: z + n }, { x, z: z + n }];
const patch = (rings = [ring(0, 0, 60)], id = "test"): CanopyPatch => ({ id, rings, source: source.source });
function create(patches: CanopyPatch[], extra: Partial<CanopyOptions> = {}) {
  const r = createGeographicCanopy(patches, { bounds: { minX: 0, minZ: 0, maxX: 100, maxZ: 100 }, groundSampler: () => 12, exclusions: [], observedCrowns: [], ...extra });
  groups.push(r.group); return r;
}
afterEach(() => groups.splice(0).forEach(disposeDioramaObject));

function ringArea(r: readonly VegetationPoint[]) {
  return Math.abs(r.reduce((sum, p, i) => { const q = r[(i + 1) % r.length]!; return sum + p.x * q.z - q.x * p.z; }, 0)) / 2;
}
// This closed, radially nested crown has one upper and one lower surface.
// Half the sum of triangle XZ projection areas is its actual mesh plan footprint,
// not the larger circular clearance envelope or a claim of observed leaf cover.
function crownFootprint(geometry: THREE.BufferGeometry) {
  const p = geometry.getAttribute("position"), index = geometry.index!;
  let area = 0;
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    area += Math.abs((p.getX(b) - p.getX(a)) * (p.getZ(c) - p.getZ(a)) - (p.getZ(b) - p.getZ(a)) * (p.getX(c) - p.getX(a))) / 4;
  }
  return area;
}
function renderCost(group: THREE.Group) {
  let triangles = 0, instanceBytes = 0;
  for (const mesh of group.children as THREE.InstancedMesh[]) {
    triangles += mesh.count * mesh.geometry.index!.count / 3;
    instanceBytes += mesh.instanceMatrix.array.byteLength + (mesh.instanceColor?.array.byteLength ?? 0);
  }
  return { meshes: group.children.length, triangles, instanceBytes };
}

describe("bounded imagery canopy reconstruction", () => {
  it("preserves seven source envelopes and labels internal placement as illustrative, not observed trees", () => {
    const patches = convertImageryCanopyObservations(source);
    expect(patches).toHaveLength(7);
    expect(patches.filter(p => p.illustrativeProfile).map(p => p.id)).toEqual([
      "riverbank-middle-canopy-core", "riverbank-north-canopy-core",
    ]);
    expect(patches.map(p => p.rings[0]!.length)).toEqual(source.patches.map(p => p.rings[0]!.length));
    for (const p of patches) expect(p.source).toBe(source.source);
    expect(source.source.mapUrl).toBe("https://maps.gsi.go.jp/#18/37.3600/140.3825/&base=seamlessphoto&ls=seamlessphoto&disp=1");
    const riverbankIds = ["riverbank-south-canopy-core", "riverbank-middle-canopy-core", "riverbank-north-canopy-core"];
    expect(patches.filter(p => riverbankIds.includes(p.id)).map(p => p.id).sort()).toEqual([...riverbankIds].sort());
    const mapBounds = { minX: koriyamaGeoToLocal([140.370, 37.379]).x, maxX: koriyamaGeoToLocal([140.398, 37.351]).x,
      minZ: koriyamaGeoToLocal([140.370, 37.379]).z, maxZ: koriyamaGeoToLocal([140.398, 37.351]).z };
    for (const patch of patches.filter(p => riverbankIds.includes(p.id))) {
      const sourcePatch = source.patches.find(candidate => candidate.id === patch.id)!;
      expect(sourcePatch.rings).toEqual([sourcePatch.observationView!.screenVerticesPx.map(([x, y]) => [x - 1066, y - 367])]);
      expect(patch.observationView?.mapUrl).toBe("https://maps.gsi.go.jp/#18/37.360206/140.378269/&ls=seamlessphoto&disp=1&vs=c1g1j0h0k0l0u0t0z0r0s0m0f1");
      expect(patch.observationView?.referenceTileTopLeftScreenPx).toEqual([1066, 367]);
      expect(patch.observationView?.captureDateUncertainty).toMatch(/unverified/);
      const points = patch.rings.flat();
      expect(points.every(p => p.x >= mapBounds.minX && p.x <= mapBounds.maxX && p.z >= mapBounds.minZ && p.z <= mapBounds.maxZ)).toBe(true);
    }
    const r = create([patch()]);
    expect(r.stats.counts.rendered).toBeGreaterThan(0);
    expect(r.records.every(c => c.positionSource === "illustrative-within-imagery-envelope")).toBe(true);
    expect(r.group.userData.policy.radiusRangeM).toEqual([2.3, 3.5]);
    expect(create([]).group.children).toHaveLength(0);
  });

  it("restricts the opt-in profile and retains full-crown exclusions, nullable edge DEM and budgets", () => {
    const p: CanopyPatch = { ...patch([ring(0, 0, 60)], "riverbank-south-canopy-core"), illustrativeProfile: "riverbank-detail-v1" };
    const detailed = create([p]);
    expect(detailed.records.every(r => r.radiusM >= 1.8 && r.radiusM <= 2.6)).toBe(true);
    expect(detailed.records.filter(r => r.reason === "rendered").every(r => canopyContainsCrown(p.rings, r, r.radiusM))).toBe(true);
    expect(() => create([{ ...p, id: "campus-north-grove-core" }])).toThrow(/out-of-scope/);
    const invalid = structuredClone(source);
    invalid.patches[0]!.illustrativeProfile = "riverbank-detail-v1";
    expect(() => convertImageryCanopyObservations(invalid)).toThrow(/out-of-scope/);
    expect(create([p], { maxCells: 4 }).stats.skippedPatches).toEqual([{ id: p.id, reason: "cell-budget" }]);
    expect(create([p], { maxTrees: 1 }).stats.counts.rendered).toBe(1);
    const centres = new Set(detailed.records.map(r => `${r.x}/${r.z}`));
    const edgeMissing = create([p], { groundSampler: (x, z) => centres.has(`${x}/${z}`) ? 10 : null });
    expect(edgeMissing.stats.counts.rendered).toBe(0);
    expect(edgeMissing.stats.counts["no-ground-data"]).toBeGreaterThan(0);
    const blocked = create([p], { exclusions: [{ sourceId: "water", kind: "water", geometry: { type: "polygon", rings: p.rings } }] });
    expect(blocked.stats.counts.rendered).toBe(0);
    const override = create([p], { spacingM: 6, radiusRangeM: [2.3, 3.5] });
    expect(override.records).toEqual(create([{ ...p, illustrativeProfile: undefined }]).records);
  });

  it("requires the FULL crown to fit concave polygons, holes and local bounds", () => {
    const concave: VegetationPoint[] = [{ x: 0, z: 0 }, { x: 60, z: 0 }, { x: 60, z: 20 }, { x: 20, z: 20 }, { x: 20, z: 60 }, { x: 0, z: 60 }];
    const rings = [concave, ring(5, 5, 8)];
    expect(canopyContainsCrown(rings, { x: 18, z: 18 }, 3)).toBe(false);
    expect(canopyContainsCrown(rings, { x: 9, z: 9 }, 1)).toBe(false);
    const sample = vi.fn((x: number, z: number) => {
      expect(x).toBeGreaterThanOrEqual(2); expect(x).toBeLessThanOrEqual(58);
      expect(z).toBeGreaterThanOrEqual(2); expect(z).toBeLessThanOrEqual(58); return 10;
    });
    const r = create([patch(rings)], { bounds: { minX: 2, minZ: 2, maxX: 58, maxZ: 58 }, groundSampler: sample });
    expect(r.stats.counts.rendered).toBeGreaterThan(0);
    for (const c of r.records.filter(c => c.reason === "rendered")) expect(canopyContainsCrown(rings, c, c.radiusM)).toBe(true);
    expect(r.stats.counts.boundary).toBeGreaterThan(0);
  });

  it("does not retry rejected cells, caps work, skips noData, and is stable across patch order", () => {
    const a = patch(), b = patch([ring(65, 65, 30)], "second");
    const one = create([a, b]), two = create([b, a]);
    expect(one.records).toEqual(two.records);
    expect(one.stats.evaluatedCells).toBeLessThanOrEqual(8192);
    expect(create([a], { maxCells: 4 }).stats.skippedPatches).toEqual([{ id: a.id, reason: "cell-budget" }]);
    expect(create([a], { groundSampler: () => null }).stats.counts.rendered).toBe(0);
    expect(create([a], { groundSampler: () => NaN }).stats.counts["no-ground-data"]).toBeGreaterThan(0);
    expect(create([a], { maxTrees: 1 }).stats.counts.rendered).toBe(1);
    expect(() => create([a, a])).toThrow(RangeError);
    expect(() => create([a], { spacingM: .01 })).toThrow(RangeError);
    const original = JSON.stringify(a);
    create([a], { exclusions: [{ sourceId: "building", kind: "building", geometry: { type: "polygon", rings: a.rings } }] });
    expect(JSON.stringify(a)).toBe(original);
  });

  it("keeps rounded shared style inside its radius, welds seam normals and deterministically varies greens", () => {
    const style = createVegetationStyleResources();
    try {
      const p = style.crown.getAttribute("position"), n = style.crown.getAttribute("normal");
      const seen = new Map<string, number[]>();
      for (let i = 0; i < p.count; i++) {
        expect(Math.hypot(p.getX(i), p.getZ(i))).toBeLessThanOrEqual(1.000001);
        expect(Math.abs(p.getY(i))).toBeLessThanOrEqual(1);
        expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 5);
        const key = [p.getX(i), p.getY(i), p.getZ(i)].map(v => Math.round(v * 1e6)).join("/");
        const normal = [n.getX(i), n.getY(i), n.getZ(i)];
        if (seen.has(key)) expect(normal).toEqual(seen.get(key)); else seen.set(key, normal);
      }
      expect(style.crown.index!.count / 3).toBeLessThanOrEqual(400);
      expect(vegetationColor("a")).toEqual(vegetationColor("a"));
      expect(new Set(Array.from({ length: 80 }, (_, i) => vegetationColor(`tree-${i}`).getHex())).size).toBeGreaterThan(1);
    } finally { style.crown.dispose(); style.trunk.dispose(); style.leaf.dispose(); style.bark.dispose(); }
  });

  it("excludes explicit crowns even when their individual renderer withheld them, and never samples rejected ground", () => {
    const c = convertImageryTreeObservations(observed)[0]!;
    const p = worldToGeo(30, 30);
    const sample = vi.fn(() => 12);
    const blocked = create([patch()], { observedCrowns: [{ ...c, coordinates: [p.longitude, p.latitude], crownRadiusM: 100 }], groundSampler: sample });
    expect(blocked.stats.counts.rendered).toBe(0);
    expect(blocked.stats.counts["explicit-crown"]).toBeGreaterThan(0);
    expect(sample).not.toHaveBeenCalled();
    const exclusion = { sourceId: "water-source", kind: "water" as const, geometry: { type: "polygon" as const, rings: [ring(0, 0, 60)] } };
    const flooded = create([patch()], { exclusions: [exclusion], groundSampler: sample });
    expect(flooded.stats.counts.rendered).toBe(0); expect(flooded.stats.counts.excluded).toBeGreaterThan(0);
    expect(sample).not.toHaveBeenCalled();
    const full = create([patch()], { maxInstancesPerBatch: 3 });
    for (const mesh of full.group.children as THREE.InstancedMesh[]) {
      expect(mesh.count).toBeLessThanOrEqual(3);
      expect(mesh.boundingBox).not.toBeNull(); expect(mesh.boundingSphere).not.toBeNull();
    }
  });

  it("checks actual DEM, source exclusions and all 34 observed crowns with bounded draw calls", () => {
    const patches = convertImageryCanopyObservations(source), observedCrowns = convertImageryTreeObservations(observed);
    const exclusions = createImageryVegetationExclusions(JSON.parse(read("features.geojson").toString()), JSON.parse(read("plateau-buildings.geojson").toString()), JSON.parse(read("landcover.geojson").toString()));
    const terrain = decodeKoriyamaTerrain(Uint8Array.from(read("terrain.bin")).buffer, JSON.parse(read("terrain-metadata.json").toString()));
    const nw = koriyamaGeoToLocal([140.370, 37.379]), se = koriyamaGeoToLocal([140.398, 37.351]);
    const groundSampler = vi.fn((x: number, z: number) => { const p = worldToGeo(x, z); return sampleKoriyamaTerrain(terrain, p.longitude, p.latitude).localY; });
    const options = { bounds: { minX: nw.x, minZ: nw.z, maxX: se.x, maxZ: se.z }, exclusions, observedCrowns, groundSampler };
    const baseline = create(patches.map(p => ({ ...p, illustrativeProfile: undefined })), options);
    const baselineGroundCalls = groundSampler.mock.calls.length;
    groundSampler.mockClear();
    const r = create(patches, options);
    const detailedGroundCalls = groundSampler.mock.calls.length;
    const accepted = r.records.filter(c => c.reason === "rendered");
    expect(baseline.stats.counts.rendered).toBe(66);
    expect(baseline.stats.evaluatedCells).toBe(409);
    expect(accepted.length).toBe(73);
    expect(r.stats.evaluatedCells).toBe(448); expect(r.stats.meshes).toBeLessThanOrEqual(10);
    expect(r.stats.skippedPatches).toEqual([]); expect(r.stats.counts.capacity).toBe(0);
    const campus = (record: { patchId: string }) => record.patchId.startsWith("campus-");
    expect(r.records.filter(campus)).toEqual(baseline.records.filter(campus));
    expect(r.records.filter(c => c.patchId === "riverbank-south-canopy-core")).toEqual(baseline.records.filter(c => c.patchId === "riverbank-south-canopy-core"));
    expect(r.records.filter(campus).filter(c => c.reason === "rendered")).toHaveLength(58);
    expect(baselineGroundCalls).toBe(66 * 9); expect(detailedGroundCalls).toBe(73 * 9);
    expect(renderCost(r.group).triangles - renderCost(baseline.group).triangles).toBeLessThanOrEqual(7 * 400);
    expect(renderCost(r.group).instanceBytes - renderCost(baseline.group).instanceBytes).toBe(7 * 140);
    for (const c of accepted) {
      expect(canopyContainsCrown(patches.find(p => p.id === c.patchId)!.rings, c, c.radiusM)).toBe(true);
      for (const o of observedCrowns) { const p = koriyamaGeoToLocal(o.coordinates); expect(Math.hypot(c.x - p.x, c.z - p.z)).toBeGreaterThan(c.radiusM + o.crownRadiusM); }
      for (const e of exclusions) expect(intersectsVegetationExclusion(c, c.radiusM, e)).toBe(false);
      for (const other of accepted) if (other !== c) expect(Math.hypot(c.x - other.x, c.z - other.z)).toBeGreaterThan(c.radiusM + other.radiusM);
    }
    const crown = (r.group.children as THREE.InstancedMesh[]).find(m => m.userData.part === "crown")!;
    const unitArea = crownFootprint(crown.geometry);
    expect(unitArea).toBeGreaterThan(2.8); expect(unitArea).toBeLessThan(Math.PI);
    const coverage = patches.filter(p => p.id.startsWith("riverbank-")).map(p => {
      const areaM2 = ringArea(p.rings[0]!) - p.rings.slice(1).reduce((sum, ring) => sum + ringArea(ring), 0);
      const footprint = (result: typeof r) => result.records.filter(c => c.patchId === p.id && c.reason === "rendered").reduce((sum, c) => sum + unitArea * c.radiusM ** 2, 0);
      return { id: p.id, areaM2, beforeM2: footprint(baseline), afterM2: footprint(r) };
    });
    const before = coverage.reduce((sum, p) => sum + p.beforeM2, 0), after = coverage.reduce((sum, p) => sum + p.afterM2, 0);
    for (const p of coverage) expect(p.afterM2).toBeGreaterThanOrEqual(p.beforeM2);
    expect(after / before).toBeGreaterThan(1.2);
    console.info("canopy detail comparison", JSON.stringify({ coverage, beforeCost: renderCost(baseline.group), afterCost: renderCost(r.group), baselineGroundCalls, detailedGroundCalls }));
    console.info("actual canopy", JSON.stringify({ stats: r.stats, perPatch: patches.map(p => {
      const records = r.records.filter(c => c.patchId === p.id);
      const counts = records.reduce<Record<string, number>>((all, record) => { all[record.reason] = (all[record.reason] ?? 0) + 1; return all; }, {});
      return { id: p.id, counts };
    }) }));
  }, 60_000);
});
