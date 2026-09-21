import * as THREE from "three";
import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { createRenderedWaterMask, WATER_MASK_EDGE_EPSILON as EPS } from "./renderedWaterMask";
import { createGeographicTerrain } from "./geographicTerrain";
import { decodeKoriyamaTerrain, type KoriyamaTerrainMetadata } from "./koriyamaTerrain";
import { createGeographicWorld } from "./geographicWorld";
import type { KoriyamaGeodata } from "./koriyamaGeodata";
import { disposeDioramaObject } from "./disposeDioramaObject";

const bounds = { minX: -32, minZ: -32, maxX: 32, maxZ: 32 };
const owned: THREE.Object3D[] = [];
function mesh(xz: number[] = [1, 1, 7, 1, 1, 7]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float64Array(xz.flatMap((v, i) => i % 2 ? [0, v] : [v])), 3));
  const m = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  owned.push(m); return m;
}
function rectangle(x0: number, z0: number, x1: number, z1: number) {
  return mesh([x0, z0, x1, z0, x1, z1, x0, z0, x1, z1, x0, z1]);
}
afterEach(() => { for (const object of owned.splice(0)) disposeDioramaObject(object); });

it("requires known finite bounds and returns unknown outside, not fabricated dry ground", () => {
  const mask = createRenderedWaterMask([], bounds);
  expect(mask.classify(0, 0)).toBe("dry");
  expect(mask.classify(32, 32)).toBe("dry");
  for (const x of [NaN, Infinity, -Infinity, 32.001]) expect(mask.classify(x, 0)).toBe("unknown");
  expect(mask.classifyFootprint(31, 0, 33, 4)).toBe("unknown");
  expect(mask.classifyFootprint(4, 0, 0, 4)).toBe("unknown");
  expect(mask.classifyFootprint(0, NaN, 4, 4)).toBe("unknown");
  expect(() => createRenderedWaterMask([], { ...bounds, maxX: NaN })).toThrow(RangeError);
  expect(() => createRenderedWaterMask([], { ...bounds, maxX: -32 })).toThrow(RangeError);
  expect(() => createRenderedWaterMask([], { ...bounds, maxX: 1e9 })).toThrow(RangeError);
});

it.each([false, true])("honours active drawRange and triangle winding (indexed %s)", indexed => {
  const m = mesh([1, 1, 7, 1, 1, 7, -7, -7, -1, -7, -7, -1]);
  if (indexed) m.geometry.setIndex([2, 1, 0, 5, 4, 3]);
  m.geometry.setDrawRange(3, 3);
  const mask = createRenderedWaterMask([m, m], bounds);
  expect(mask.stats.triangles).toBe(1); expect(mask.stats.meshes).toBe(1);
  expect(mask.classify(2, 2)).toBe("dry"); expect(mask.classify(-6, -6)).toBe("water");
  expect(mask.classifyFootprint(1, 1, 4, 4)).toBe("dry");
  expect(m.geometry.drawRange).toEqual({ start: 3, count: 3 });
});

it("preserves real triangulated holes, while including non-stage-eligible water ribbons", () => {
  const shape = new THREE.Shape();
  shape.moveTo(-10, -10); shape.lineTo(10, -10); shape.lineTo(10, 10); shape.lineTo(-10, 10); shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-3, -3); hole.lineTo(-3, 3); hole.lineTo(3, 3); hole.lineTo(3, -3); hole.closePath(); shape.holes.push(hole);
  const polygon = mesh(); polygon.geometry.dispose(); polygon.geometry = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
  const ribbon = rectangle(-10, 0.9, 10, 1.1); ribbon.userData.riverStageEligible = false;
  const mask = createRenderedWaterMask([polygon, ribbon], bounds);
  expect(mask.classify(0, 0)).toBe("dry"); expect(mask.classify(0, 1)).toBe("water");
  expect(mask.classify(5, 0)).toBe("water");
  expect(mask.classifyFootprint(-1, -1, 1, 0.5)).toBe("dry");
  expect(mask.classifyFootprint(-1, -1, 1, 2)).toBe("water");
});

it("snapshots world XZ without mutating matrices and ignores increased/reset Y or visibility", () => {
  const m = mesh(), parent = new THREE.Group(); parent.position.set(10, 20, 10); parent.rotation.y = Math.PI / 2; parent.add(m);
  const before = m.matrixWorld.clone(), mask = createRenderedWaterMask([m], bounds);
  expect(mask.classify(12, 8)).toBe("water"); expect(m.matrixWorld.equals(before)).toBe(true);
  for (const y of [100, -100, 0]) {
    m.position.y = y; m.visible = false;
    expect(mask.classify(12, 8)).toBe("water");
    expect(createRenderedWaterMask([m], bounds).classify(12, 8)).toBe("water");
  }
  m.geometry.getAttribute("position").setX(0, 1000);
  expect(mask.classify(12, 8)).toBe("water"); // immutable geometry snapshot
});

it("preserves Float64 coordinates and finite-edge Euclidean epsilon, including corner distance", () => {
  const x = 1_000_000.00005, m = mesh([x, 1, x + 2, 1, x, 3]);
  const mask = createRenderedWaterMask([m], { minX: x - 4, maxX: x + 4, minZ: -4, maxZ: 4 });
  expect(mask.classify(x - EPS * 0.5, 2)).toBe("water");
  expect(mask.classify(x - EPS * 1.1, 2)).toBe("dry");
  expect(mask.classifyFootprint(x - EPS * 1.1, 1.5, x - EPS * 1.1, 2)).toBe("dry");
  expect(mask.classifyFootprint(x - EPS * 0.5, 1.5, x - EPS * 0.5, 2)).toBe("water");
  expect(mask.classifyFootprint(x - EPS * 0.8, 1 - EPS * 0.8, x - EPS * 0.8, 1 - EPS * 0.8)).toBe("dry");
});

it.each(["nan", "index", "range", "matrix", "missing"])("fails closed for malformed %s data", kind => {
  const m = mesh();
  if (kind === "nan") m.geometry.getAttribute("position").setY(0, NaN);
  if (kind === "index") m.geometry.setIndex([0, 1, 90]);
  if (kind === "range") m.geometry.setDrawRange(-1, 3);
  if (kind === "matrix") m.position.y = Infinity;
  if (kind === "missing") m.geometry.deleteAttribute("position");
  const mask = createRenderedWaterMask([m], bounds);
  expect(mask.stats.invalidInputs).toBeGreaterThan(0);
  expect(mask.classify(-20, -20)).toBe("unknown"); expect(mask.classifyFootprint(0, 0, 4, 4)).toBe("unknown");
});

it("omitted/no-data and zero-area triangles do not invent a water footprint", () => {
  const m = mesh([0, 0, 1, 1, 2, 2]), empty = mesh(); empty.geometry.setDrawRange(0, 0);
  const mask = createRenderedWaterMask([m, empty], bounds);
  expect(mask.stats.degenerateTriangles).toBe(1); expect(mask.stats.triangles).toBe(0);
  expect(mask.classifyFootprint(0, 0, 4, 4)).toBe("dry");
});

it("64 candidates work; 65 makes the entire bucket unknown without retained truncated references", () => {
  const m = mesh(Array.from({ length: 64 }, () => [1, 1, 7, 1, 1, 7]).flat());
  expect(createRenderedWaterMask([m], bounds).classify(2, 2)).toBe("water");
  const mask = createRenderedWaterMask([m, mesh(), rectangle(8, 1, 10, 3)], bounds);
  expect(mask.stats.maxCandidates).toBeGreaterThanOrEqual(65); expect(mask.stats.overflowBuckets).toBeGreaterThan(0);
  expect(mask.classify(2, 2)).toBe("unknown"); expect(mask.classify(-20, -20)).toBe("dry");
  expect(mask.classifyFootprint(6, 1, 10, 3)).toBe("unknown"); // even with known water in adjacent bucket
  const overflowOnly = createRenderedWaterMask([m, mesh()], bounds);
  expect(overflowOnly.stats.triangleReferences).toBe(0);
});

it("detects thin ribbon crossing a 4m cell between all nine sample points", () => {
  const mask = createRenderedWaterMask([rectangle(-1, 0.9, 5, 1.1)], bounds);
  for (const x of [0, 2, 4]) for (const z of [0, 2, 4]) expect(mask.classify(x, z)).toBe("dry");
  expect(mask.classifyFootprint(0, 0, 4, 4)).toBe("water");
});

it("handles contained triangles, contained boxes, crossings, touching and separated overlapping AABBs", () => {
  const mask = createRenderedWaterMask([mesh()], bounds);
  expect(mask.classifyFootprint(0, 0, 8, 8)).toBe("unknown"); // tolerance touches nine buckets; bounded, not scanned
  expect(mask.classifyFootprint(0.1, 0.1, 7.9, 7.9)).toBe("water");
  expect(mask.classifyFootprint(2, 2, 3, 3)).toBe("water");
  expect(mask.classifyFootprint(0, 2, 8, 3)).toBe("water");
  expect(mask.classifyFootprint(7, 1, 7.5, 2)).toBe("water");
  expect(mask.classifyFootprint(5, 5, 6, 6)).toBe("dry");
  expect(mask.classifyFootprint(6, 6, 10, 10)).toBe("dry"); // four buckets
  expect(mask.classifyFootprint(-20, -20, 20, 20)).toBe("unknown");
});

it("matches an independent polygon-clipping oracle for 1000 bounded cell/triangle pairs", () => {
  let seed = 91231;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let trial = 0; trial < 1000; trial++) {
    const points = Array.from({ length: 3 }, () => ({ x: random() * 16 - 8, z: random() * 16 - 8 }));
    const x = random() * 12 - 8, z = random() * 12 - 8;
    let clipped = points;
    // Sutherland-Hodgman reference: does not reuse production SAT or buckets.
    for (const [axis, edge, sign] of [["x", x, 1], ["x", x + 4, -1], ["z", z, 1], ["z", z + 4, -1]] as const) {
      const result: { x: number; z: number }[] = [];
      for (let i = 0; i < clipped.length; i++) {
        const a = clipped[i]!, b = clipped[(i + 1) % clipped.length]!;
        const da = (a[axis] - edge) * sign, db = (b[axis] - edge) * sign;
        if (da >= 0) result.push(a);
        if ((da >= 0) !== (db >= 0)) {
          const t = da / (da - db); result.push({ x: a.x + t * (b.x - a.x), z: a.z + t * (b.z - a.z) });
        }
      }
      clipped = result;
    }
    const mask = createRenderedWaterMask([mesh(points.flatMap(p => [p.x, p.z]))], bounds);
    expect(mask.classifyFootprint(x, z, x + 4, z + 4), `trial ${trial}`).toBe(clipped.length ? "water" : "dry");
  }
});

it("includes epsilon contacts across bucket seams without exceeding a four-bucket cell query", () => {
  const mask = createRenderedWaterMask([rectangle(8 + EPS * 0.5, 2, 9, 3)], bounds);
  expect(mask.classifyFootprint(4, 0, 8, 4)).toBe("water");
  expect(mask.classifyFootprint(4 - EPS, 0, 8 - EPS, 4)).toBe("dry");
  expect(createRenderedWaterMask([], bounds).classifyFootprint(-4, -4, 0, 0)).toBe("dry");
});

it("actual Koriyama all-water dataset fits candidate/memory budgets, independent of stage", () => {
  const read = (file: string) => readFileSync(new URL(`../../../public/geodata/koriyama/${file}`, import.meta.url));
  const osm = JSON.parse(read("features.geojson").toString()) as KoriyamaGeodata;
  const metadata = JSON.parse(read("terrain-metadata.json").toString()) as KoriyamaTerrainMetadata;
  const terrain = createGeographicTerrain(decodeKoriyamaTerrain(Uint8Array.from(read("terrain.bin")).buffer, metadata)); owned.push(terrain.group);
  const world = createGeographicWorld({ ...osm, features: osm.features.filter(f => ["water", "waterway"].includes(f.properties.kind)) }, {
    localBounds: terrain.bounds, groundSampler: terrain.sampleGround, surfaceGridSpacing: 12,
    surfaceSampler: (x, z) => { const y = terrain.sampleGround(x, z); return y === null ? null : y + 0.35; },
  }); owned.push(world);
  const start = performance.now(), mask = createRenderedWaterMask(world.waterMeshes, terrain.bounds), setupMs = performance.now() - start;
  const s = mask.stats;
  expect(s.meshes).toBe(51); expect(s.triangles).toBe(17562); expect(s.maxCandidates).toBe(58);
  expect(s.overflowBuckets).toBe(0); expect(s.invalidInputs).toBe(0);
  expect(s.retainedTypedArrayBytes).toBe(s.triangleBytes + s.bucketCountBytes + s.bucketOffsetBytes + s.referenceBytes);
  expect(s.peakTypedArrayBytes).toBe(s.retainedTypedArrayBytes + s.buildScratchTypedArrayBytes);
  expect(s.retainedTypedArrayBytes).toBeLessThan(2 * 1024 * 1024);
  for (const m of world.waterMeshes) {
    const p = m.geometry.getAttribute("position");
    const x = (p.getX(0) + p.getX(1) + p.getX(2)) / 3, z = (p.getZ(0) + p.getZ(1) + p.getZ(2)) / 3;
    expect(mask.classify(x, z)).toBe("water");
    const b = terrain.bounds;
    const fullyCovered = x - 2 >= b.minX && x + 2 <= b.maxX && z - 2 >= b.minZ && z + 2 <= b.maxZ;
    expect(mask.classifyFootprint(x - 2, z - 2, x + 2, z + 2)).toBe(fullyCovered ? "water" : "unknown");
    m.position.y += 100;
    expect(mask.classify(x, z)).toBe("water");
  }
  const queryStart = performance.now();
  let unknown = 0;
  for (let i = 0; i < 10000; i++) {
    const x = terrain.bounds.minX + 4 + ((i * 37) % 2400), z = terrain.bounds.minZ + 4 + ((i * 53) % 3000);
    if (mask.classifyFootprint(x, z, x + 4, z + 4) === "unknown") unknown++;
  }
  expect(unknown).toBe(0);
  console.info("renderedWaterMask actual-data budget", { ...s, setupMs, footprintQueries: 10000, footprintMs: performance.now() - queryStart });
});
