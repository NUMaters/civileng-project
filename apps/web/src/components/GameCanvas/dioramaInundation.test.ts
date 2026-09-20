import * as THREE from "three";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInitialFloodState,
  beginDisaster,
  advanceFloodSimulation,
  DEFAULT_WEATHER_SEED,
  type FloodSimulationState,
} from "../../features/disaster/services/floodSimulation";
import {
  advanceInundationField,
  resetInundationField,
} from "../../features/disaster/services/inundationField";
import {
  getCandidateBankElevationMeters,
  listOverflowCandidates,
} from "../../features/disaster/services/overflowBankSites";
import { createDioramaInundation, type DioramaInundation } from "./dioramaInundation";
import { geoToWorld, groundY, riverX, worldToGeo } from "./dioramaSpace";
import { createRiverBoundaryResolver, MAX_RIVER_EDGE_POINTS, type RiverBoundary, type SurfaceSampler } from "./riverBoundary";
import type { GeoPoint, KoriyamaGeodata } from "./koriyamaGeodata";
import { createGeographicWorld } from "./geographicWorld";
import { createGeographicTerrain } from "./geographicTerrain";
import { decodeKoriyamaTerrain, type KoriyamaTerrainMetadata } from "./koriyamaTerrain";
import { createRiverStageController } from "./riverStage";
import { createRiverSurfaceSampler } from "./riverSurface";

const adapters: DioramaInundation[] = [];
// Compare full reusable buffers without Vitest recursively diffing 145k scalars.
function expectSameBuffer(a: ArrayBufferView, b: ArrayBufferView) {
  expect(a.byteLength).toBe(b.byteLength);
  expect(Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength))).toBe(true);
}
const candidate = listOverflowCandidates().find((site) => site.id === "campus-core")!;
function wetState(): FloodSimulationState {
  return {
    ...createInitialFloodState(),
    phase: "disaster",
    overflowMeters: 1,
    floodDepthMeters: 1.2,
    overflowSites: [{ ...candidate, intensity: 0.9 }],
  };
}
function setup() {
  const adapter = createDioramaInundation();
  adapters.push(adapter);
  const mesh = adapter.group.children[0] as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshBasicMaterial
  >;
  return { adapter, mesh, geometry: mesh.geometry };
}
function run(adapter: DioramaInundation, state = wetState(), count = 100) {
  adapter.update(state, 0, 0);
  for (let i = 0; i < count; i++)
    adapter.update({ ...state, disasterElapsedSeconds: (i + 1) / 10 }, 0.1, (i + 1) / 10);
}
afterEach(() => {
  adapters.splice(0).forEach((adapter) => adapter.dispose());
  resetInundationField();
});

function connectedSetup(sample: SurfaceSampler = () => 0, water: SurfaceSampler = () => 2) {
  const geo = (x: number, z: number): GeoPoint => { const p = worldToGeo(x, z); return [p.longitude, p.latitude]; };
  const data: KoriyamaGeodata = { type: "FeatureCollection", bbox: [140, 37, 141, 38], features: [{
    type: "Feature", id: "relation/18504988", properties: { kind: "water", water: "river", version: 1, timestamp: "test" },
    geometry: { type: "MultiPolygon", coordinates: [[[geo(-100, -300), geo(0, -300), geo(0, 300), geo(-100, 300), geo(-100, -300)]]] },
  }] };
  const resolveBoundary = createRiverBoundaryResolver(data, water);
  const adapter = createDioramaInundation(sample, resolveBoundary);
  adapters.push(adapter);
  const geometry = (adapter.group.children[0] as THREE.Mesh).geometry;
  const state = { ...wetState(), overflowSites: [{ ...wetState().overflowSites[0]!, ...worldToGeo(60, 0), outflowHeadingDegrees: 90 }] };
  return { adapter, geometry, state, resolveBoundary };
}

describe("rendered flood patch snapshots", () => {
  it("removes an invalid replacement bank immediately even during upload throttling", () => {
    const fixture = connectedSetup();
    let boundary = fixture.resolveBoundary(fixture.state.overflowSites[0]!)!;
    const adapter = createDioramaInundation(() => 0, () => boundary);
    adapters.push(adapter);
    run(adapter, fixture.state, 1);
    expect(adapter.getRenderedPatches()).toHaveLength(1);
    boundary = { ...boundary, anchor: { x: boundary.anchor.x + 100, z: boundary.anchor.z } };
    adapter.update({ ...fixture.state, disasterElapsedSeconds: 0.2 }, 0.1, 0.11);
    expect(adapter.getRenderedPatches()).toEqual([]);
    expect(adapter.group.userData.floodGrid.cachedSites).toBe(0);
    run(adapter, fixture.state, 10);
    expect(adapter.getRenderedPatches()).toEqual([]);
  });

  it.each(["distributed", "clustered", "cell-boundary"])("partitions maximum %s edge breakpoints without duplicate area or buffer overflow at 24 sites", distribution => {
    const interior = Array.from({ length: MAX_RIVER_EDGE_POINTS - 2 }, (_, i) =>
      distribution === "clustered" ? 0.01 + i * 0.001 : -7.9 + 15.8 * (i + 1) / (MAX_RIVER_EDGE_POINTS - 1));
    if (distribution === "cell-boundary") interior.splice(0, 3, -4, 0, 4);
    interior.sort((a, b) => a - b);
    const boundary: RiverBoundary = { sourceId: "test", polygonIndex: 0, segmentIndex: 0,
      anchor: { x: 0, z: 0 }, left: { x: 0, y: 2, z: -7.9 }, right: { x: 0, y: 2, z: 7.9 },
      inland: { x: 1, z: 0 }, isLand: x => x >= 0,
      edge: [-7.9, ...interior, 7.9].map(z => ({ x: 0, y: 2, z })) };
    const adapter = createDioramaInundation(() => 0, () => boundary);
    adapters.push(adapter);
    const state = { ...wetState(), overflowSites: Array.from({ length: 24 }, (_, i) => ({ ...wetState().overflowSites[0]!, id: `edge-${i}` })) };
    const geometry = (adapter.group.children[0] as THREE.Mesh).geometry;
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    const write = positions.setXYZ.bind(positions);
    vi.spyOn(positions, "setXYZ").mockImplementation((index, x, y, z) => {
      expect(index).toBeLessThan(positions.count);
      expect([x, y, z].every(Number.isFinite)).toBe(true);
      return write(index, x, y, z);
    });
    run(adapter, state, 1);
    expect(adapter.getRenderedPatches()).toHaveLength(24);
    // The first step also propagates into neighboring cells. Measure ONLY the
    // inlet band's projected area; sloped Y surfaces have a larger 3D area.
    let area = 0, sourceVertices = 0;
    for (let i = 0; i < adapter.getRenderedPatches()[0]!.vertexCount; i += 3) {
      const x = [0, 1, 2].map(k => positions.getX(i + k));
      const z = [0, 1, 2].map(k => positions.getZ(i + k));
      if (x.every(v => v >= 0 && v <= 4) && z.every(v => v >= -7.900001 && v <= 7.900001)) {
        area += Math.abs((x[1]! - x[0]!) * (z[2]! - z[0]!) - (x[2]! - x[0]!) * (z[1]! - z[0]!)) / 2;
        sourceVertices += 3;
      }
    }
    expect(area).toBeCloseTo(15.8 * 4, 4);
    expect(sourceVertices).toBe((4 + (distribution === "cell-boundary" ? 27 : 30)) * 6);
    expect(positions.count).toBe(24 * (58 * 48 + MAX_RIVER_EDGE_POINTS) * 6);
  });

  it("keeps an unrelated valid patch when an invalid bank replaces another during throttle", () => {
    const fixture = connectedSetup();
    const valid = fixture.resolveBoundary(fixture.state.overflowSites[0]!)!;
    let rejected = false;
    const adapter = createDioramaInundation(() => 0, site =>
      rejected && site.id === "bad" ? { ...valid, inland: { x: 0, z: 0 } } : valid);
    adapters.push(adapter);
    const state = { ...fixture.state, overflowSites: [fixture.state.overflowSites[0]!, { ...fixture.state.overflowSites[0]!, id: "bad" }] };
    run(adapter, state, 1);
    expect(adapter.getRenderedPatches()).toHaveLength(2);
    rejected = true;
    adapter.update({ ...state, disasterElapsedSeconds: 0.2 }, 0.1, 0.11);
    expect(adapter.getRenderedPatches().map(p => p.id)).toEqual([state.overflowSites[0]!.id]);
    expect(adapter.group.visible).toBe(true);
    expect(adapter.group.userData.floodGrid.cachedSites).toBe(1);
  });

  it.each(["backtracking", "duplicate", "off-segment", "too-many"])("rejects %s source edge breaks without a synthetic fallback", kind => {
    const fixture = connectedSetup();
    const boundary = fixture.resolveBoundary(fixture.state.overflowSites[0]!)!;
    const point = (t: number) => ({ x: boundary.left.x + (boundary.right.x - boundary.left.x) * t,
      y: 2, z: boundary.left.z + (boundary.right.z - boundary.left.z) * t });
    const edge = kind === "backtracking" ? [point(0), point(0.7), point(0.3), point(1)] :
      kind === "duplicate" ? [point(0), point(0.5), point(0.5), point(1)] :
      kind === "off-segment" ? [point(0), { ...point(0.5), x: point(0.5).x + 1 }, point(1)] :
      Array.from({ length: MAX_RIVER_EDGE_POINTS + 1 }, (_, i) => point(i / MAX_RIVER_EDGE_POINTS));
    const adapter = createDioramaInundation(() => 0, () => ({ ...boundary, edge }));
    adapters.push(adapter);
    run(adapter, fixture.state, 10);
    expect(adapter.getRenderedPatches()).toEqual([]);
    expect(adapter.group.userData.floodGrid.cachedSites).toBe(0);
  });
  it("describes only emitted Float32 triangles with a wet anchor and deep immutability", () => {
    const { adapter, geometry, state } = connectedSetup();
    expect(adapter.getRenderedPatches()).toEqual([]);
    run(adapter, state, 10);
    const patches = adapter.getRenderedPatches();
    expect(patches).toHaveLength(1);
    expect(patches.reduce((sum, p) => sum + p.vertexCount, 0)).toBe(geometry.drawRange.count);
    const patch = patches[0]!, p = geometry.getAttribute("position");
    expect(patch.id).toBe(state.overflowSites[0]!.id);
    expect(patch.vertexCount).toBeLessThan(p.count);
    const bounds = new THREE.Box3();
    const triangle = new THREE.Triangle(), anchor = new THREE.Vector3(patch.anchor.x, patch.anchor.y, patch.anchor.z);
    const closest = new THREE.Vector3();
    let onTriangle = false, area = 0;
    for (let i = 0; i < patch.vertexCount; i += 3) {
      triangle.a.fromBufferAttribute(p, i); triangle.b.fromBufferAttribute(p, i + 1); triangle.c.fromBufferAttribute(p, i + 2);
      bounds.expandByPoint(triangle.a); bounds.expandByPoint(triangle.b); bounds.expandByPoint(triangle.c);
      area += triangle.getArea();
      if (triangle.getArea() > 0 && triangle.closestPointToPoint(anchor, closest).distanceTo(anchor) < 1e-6) onTriangle = true;
    }
    expect(onTriangle).toBe(true);
    expect(patch.areaM2).toBeCloseTo(area, 6);
    expect(patch.bounds).toEqual({ minX: bounds.min.x, minY: bounds.min.y, minZ: bounds.min.z,
      maxX: bounds.max.x, maxY: bounds.max.y, maxZ: bounds.max.z });
    for (const value of [patches, patch, patch.anchor, patch.bounds]) expect(Object.isFrozen(value)).toBe(true);
    const before = JSON.stringify(patches);
    // Unused allocation contents are irrelevant to focus metadata.
    p.setXYZ(p.count - 1, 1e9, 1e9, 1e9);
    adapter.update({ ...state, disasterElapsedSeconds: 1.1 }, 0.1, 1.01);
    expect(adapter.getRenderedPatches()).toBe(patches); // field advanced, upload still throttled
    adapter.update({ ...state, disasterElapsedSeconds: 1.2 }, 0.1, 1.2);
    expect(adapter.getRenderedPatches()).not.toBe(patches);
    expect(JSON.stringify(patches)).toBe(before); // old snapshot never mutated
    expect(adapter.getRenderedPatches()[0]!.bounds.maxX).toBeLessThan(1000);
  });

  it("retains the same snapshot while paused/result/review and hides/reset/disposes safely", () => {
    const { adapter, geometry, state } = connectedSetup();
    run(adapter, state, 10);
    const snapshot = adapter.getRenderedPatches();
    for (const phase of ["disaster", "result", "review"]) {
      adapter.update({ ...state, phase, disasterElapsedSeconds: 1 }, 1, 2);
      expect(adapter.getRenderedPatches()).toBe(snapshot);
    }
    adapter.group.visible = false;
    expect(adapter.getRenderedPatches()).toEqual([]);
    adapter.group.visible = true;
    const mesh = adapter.group.children[0]!;
    mesh.visible = false;
    expect(adapter.getRenderedPatches()).toEqual([]);
    mesh.visible = true;
    expect(adapter.getRenderedPatches()).toBe(snapshot);
    adapter.update({ ...state, phase: "preparation", disasterElapsedSeconds: 1 }, 0, 3);
    expect(adapter.getRenderedPatches()).toEqual([]);
    expect(geometry.drawRange.count).toBe(0);
    adapter.dispose();
    expect(adapter.getRenderedPatches()).toEqual([]);
    expect(snapshot.length).toBe(1);
  });

  it.each(["elapsed", "clock", "water", "rewind"])("clears stale patches on invalid input or %s", kind => {
    const { adapter, state } = connectedSetup();
    run(adapter, state, 10);
    expect(adapter.getRenderedPatches()).toHaveLength(1);
    adapter.update({ ...state, disasterElapsedSeconds: kind === "elapsed" ? NaN : kind === "rewind" ? 0 : 1,
      floodDepthMeters: kind === "water" ? NaN : state.floodDepthMeters }, 0, kind === "clock" ? Infinity : 2);
    expect(adapter.getRenderedPatches()).toEqual([]);
    expect(adapter.group.visible).toBe(false);
  });

  it.each(["boundary", "throat", "removed"])("removes a %s-invalid site during throttle while preserving valid rendered water", mode => {
    const base = connectedSetup();
    let reject = false;
    const sample = (x: number, z: number) => reject && mode === "throat" && z > 0 && x > 2 && x < 6 ? 5 : 0;
    const adapter = createDioramaInundation(sample, site => reject && mode === "boundary" && site.id === "second" ? null : base.resolveBoundary(site));
    adapters.push(adapter);
    const sites = [-120, 120].map((z, i) => ({ ...base.state.overflowSites[0]!, id: i ? "second" : "first", ...worldToGeo(60, z) }));
    const state = { ...base.state, overflowSites: sites };
    run(adapter, state, 10);
    const before = adapter.getRenderedPatches();
    expect(before.map(p => p.id)).toEqual(["first", "second"]);
    reject = true;
    // Only .01 renderer seconds after the last upload: stale removal must bypass .1 throttle.
    adapter.update({ ...state, overflowSites: mode === "removed" ? sites.slice(0, 1) : sites, disasterElapsedSeconds: 1.1 }, 0.1, 1.01);
    expect(adapter.group.visible).toBe(true);
    const patches = adapter.getRenderedPatches();
    expect(patches.map(p => p.id)).toEqual(["first"]);
    const geometry = (adapter.group.children[0] as THREE.Mesh).geometry;
    expect(geometry.drawRange.count).toBe(patches[0]!.vertexCount);
    const p = geometry.getAttribute("position");
    for (let i = 0; i < geometry.drawRange.count; i++) expect(p.getZ(i)).toBeLessThan(0);
  });

  it("a newly rejected site cannot hide existing valid geometry between uploads", () => {
    const base = connectedSetup();
    const adapter = createDioramaInundation(() => 0, site => site.id === "rejected" ? null : base.resolveBoundary(site));
    adapters.push(adapter);
    run(adapter, base.state, 10);
    const snapshot = adapter.getRenderedPatches();
    adapter.update({ ...base.state, disasterElapsedSeconds: 1.1,
      overflowSites: [...base.state.overflowSites, { ...base.state.overflowSites[0]!, id: "rejected" }] }, 0.1, 1.01);
    expect(adapter.group.visible).toBe(true);
    expect(adapter.getRenderedPatches()).toBe(snapshot);
  });
});

describe("source-connected inundation", () => {
  it("shows connected flood with actual scene water/DEM and a late unprotected simulation state", () => {
    const read = (file: string) => readFileSync(new URL(`../../../public/geodata/koriyama/${file}`, import.meta.url));
    const osm = JSON.parse(read("features.geojson").toString()) as KoriyamaGeodata;
    const metadata = JSON.parse(read("terrain-metadata.json").toString()) as KoriyamaTerrainMetadata;
    const terrain = createGeographicTerrain(decodeKoriyamaTerrain(Uint8Array.from(read("terrain.bin")).buffer, metadata));
    // Same production water construction and complete DEM; omit unrelated buildings
    // to keep this acceptance test bounded. No candidate or datum substitutions.
    const world = createGeographicWorld({ ...osm, features: osm.features.filter(f => ["water", "waterway"].includes(f.properties.kind)) }, {
      localBounds: terrain.bounds, groundSampler: terrain.sampleGround, surfaceGridSpacing: 12,
      surfaceSampler: (x, z) => { const y = terrain.sampleGround(x, z); return y === null ? null : y + 0.35; },
    });
    try {
      const stage = createRiverStageController(world.waterMeshes);
      const resolve = createRiverBoundaryResolver(osm, createRiverSurfaceSampler(world.waterMeshes));
      const adapter = createDioramaInundation(terrain.sampleGround, resolve);
      adapters.push(adapter);
      let state = beginDisaster(createInitialFloodState(), { weatherSeed: DEFAULT_WEATHER_SEED });
      for (let i = 0; i < 80; i++) state = advanceFloodSimulation(state, [], 1);
      expect(state.phase).toBe("disaster");
      stage.update(state.riverLevelMeters);
      adapter.update(state, 0, 0);
      state = advanceFloodSimulation(state, [], 0.1);
      stage.update(state.riverLevelMeters);
      adapter.update(state, 0.1, 0.1);
      const geometry = (adapter.group.children[0] as THREE.Mesh).geometry;
      const p = geometry.getAttribute("position"), count = geometry.drawRange.count;
      const eligible = state.overflowSites.filter(s => s.primaryHazard === "overtopping" || s.primaryHazard === "erosion").slice(0, 24);
      const visibleSites: string[] = [], unresolved: string[] = [], blocked: string[] = [];
      for (const site of eligible) {
        const bank = resolve(site);
        if (!bank) { unresolved.push(site.id); continue; }
        let attached = false;
        for (let i = 0; i < count; i++) {
          if (Math.hypot(p.getX(i) - bank.left.x, p.getY(i) - bank.left.y, p.getZ(i) - bank.left.z) < 0.001) { attached = true; break; }
        }
        (attached ? visibleSites : blocked).push(site.id);
      }
      console.info("actual connected flood acceptance", { elapsed: state.disasterElapsedSeconds, riverLevel: state.riverLevelMeters,
        overflow: state.overflowMeters, eligibleSites: eligible.length, vertices: count, visibleSites, unresolved, blocked });
      expect(adapter.group.visible).toBe(true);
      expect(count).toBeGreaterThan(12);
      expect(visibleSites.length, "Actual stage must create a source-attached visible flood, not merely fail closed").toBeGreaterThan(0);
      for (let i = 0; i < count; i++) expect([p.getX(i), p.getY(i), p.getZ(i)].every(Number.isFinite)).toBe(true);
    } finally {
      const materials = new Set<THREE.Material>();
      for (const root of [world, terrain.group]) for (const child of root.children) {
        const mesh = child as THREE.Mesh; mesh.geometry.dispose();
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
      }
      materials.forEach(m => m.dispose());
    }
  }, 60_000);

  it("seeds 4m subcells directly at the bank and propagates from the actual inlet", () => {
    const { adapter, geometry, state } = connectedSetup();
    adapter.update(state, 0, 0);
    adapter.update({ ...state, disasterElapsedSeconds: 0.1 }, 0.1, 0.1);
    const firstCount = geometry.drawRange.count;
    expect(firstCount).toBeGreaterThanOrEqual(18);
    const p = geometry.getAttribute("position");
    const n = Array.from({ length: firstCount }, (_, i) => i).find(i => Math.abs(p.getX(i)) < 1e-5)!;
    expect(p.getX(n)).toBeCloseTo(0, 5);
    expect(p.getX(n + 1)).toBeCloseTo(0, 5);
    expect(p.getX(n + 2)).toBeCloseTo(4, 5); // actual first subcell, no detached 8m throat
    expect(p.getY(n)).toBeCloseTo(2, 5);
    expect(p.getY(n + 1)).toBeCloseTo(2, 5);
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    for (const x of [0.1, 1, 2, 3.9]) for (const z of [-7, -3, 1, 5]) {
      ray.ray.origin.set(x, 10, z);
      expect(ray.intersectObject(adapter.group.children[0]!, false).length).toBeGreaterThan(0);
    }
    // Moving the old site farther inland does not move injection to that remote point.
    const other = connectedSetup();
    other.state.overflowSites[0] = { ...other.state.overflowSites[0]!, ...worldToGeo(90, 0) };
    other.adapter.update(other.state, 0, 0);
    other.adapter.update({ ...other.state, disasterElapsedSeconds: 0.1 }, 0.1, 0.1);
    expect(other.geometry.drawRange.count).toBe(firstCount);
    const otherPositions = other.geometry.getAttribute("position");
    for (let i = 0; i < firstCount; i++) {
      expect(otherPositions.getX(i)).toBeCloseTo(p.getX(i), 4);
      expect(otherPositions.getY(i)).toBeCloseTo(p.getY(i), 4);
      expect(otherPositions.getZ(i)).toBeCloseTo(p.getZ(i), 4);
    }
    for (let i = 2; i <= 100; i++) adapter.update({ ...state, disasterElapsedSeconds: i / 10 }, 0.1, i / 10);
    expect(geometry.drawRange.count).toBeGreaterThan(firstCount);
    for (let i = 0; i < geometry.drawRange.count; i++) {
      expect(p.getX(i)).toBeGreaterThanOrEqual(-1e-5);
      expect(p.getY(i)).toBeLessThanOrEqual(2.00001);
    }
  });

  it("rejects missing or uphill throats before injecting, including obstructions between endpoints", () => {
    for (const sample of [(() => null), (() => NaN), ((x: number) => x > 2 && x < 6 ? null : 0),
      ((x: number) => x > 2 && x < 6 ? 5 : 0)]) {
      const { adapter, geometry, state } = connectedSetup(sample);
      run(adapter, state, 10);
      expect(geometry.drawRange.count).toBe(0);
      expect(adapter.group.visible).toBe(false);
    }
    const missingWater = connectedSetup(() => 0, () => null);
    run(missingWater.adapter, missingWater.state, 10);
    expect(missingWater.geometry.drawRange.count).toBe(0);
  });

  it("wets only the low portion of the former first 16m cell, preserving a high inland ridge", () => {
    // Same old 8m-ridge fixture: it must no longer suppress wet shore at x=0..4,
    // but it must still exclude the raised part and all land behind the ridge.
    const { adapter, geometry, state } = connectedSetup(x => x >= 8 && x <= 12 ? 5 : 0);
    run(adapter, state, 200);
    expect(geometry.drawRange.count).toBeGreaterThan(0);
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    for (const x of [0.1, 1, 2, 3.9]) {
      ray.ray.origin.set(x, 10, 1);
      expect(ray.intersectObject(adapter.group.children[0]!, false).length).toBeGreaterThan(0);
    }
    const p = geometry.getAttribute("position");
    for (let i = 0; i < geometry.drawRange.count; i++) expect(p.getX(i)).toBeLessThanOrEqual(4.00001);
    for (const x of [8, 10, 12, 16, 24, 40]) {
      ray.ray.origin.set(x, 10, 1);
      expect(ray.intersectObject(adapter.group.children[0]!, false)).toHaveLength(0);
    }
  });

  it("reuses bounded geometry buffers and keeps at most 24 source grids", () => {
    const { adapter, geometry, state } = connectedSetup();
    state.overflowSites = Array.from({ length: 30 }, (_, i) => ({ ...state.overflowSites[0]!, id: `site-${i}` }));
    const p = geometry.getAttribute("position"), colors = geometry.getAttribute("color");
    const pb = p.array, cb = colors.array;
    run(adapter, state, 2);
    expect(adapter.getRenderedPatches()).toHaveLength(24);
    expect(adapter.group.children).toHaveLength(1);
    expect(geometry.getAttribute("position").array).toBe(pb);
    expect(geometry.getAttribute("color").array).toBe(cb);
    expect(geometry.drawRange.count).toBeLessThanOrEqual(p.count);
    expect(adapter.group.userData.floodGrid.geometryBufferBytes).toBeLessThan(11_000_000);
    expect(adapter.group.userData.floodGrid.maxCellsPerSite).toBe(58 * 48);
  });

  it("does not propagate through a no-data barrier or higher-than-river cells", () => {
    for (const value of [null, 5]) {
      const { adapter, geometry, state } = connectedSetup(x => x >= 28 && x <= 44 ? value : 0);
      run(adapter, state, 100);
      expect(geometry.drawRange.count).toBeGreaterThan(0);
      const p = geometry.getAttribute("position");
      for (let i = 0; i < geometry.drawRange.count; i++) expect(p.getX(i)).toBeLessThanOrEqual(24.00001);
    }
  });

  it("excludes inland ponding in both paths and permits erosion at the bank", () => {
    const { adapter, geometry, state } = connectedSetup();
    state.overflowSites[0]!.primaryHazard = "inlandPonding";
    run(adapter, state, 10);
    expect(geometry.drawRange.count).toBe(0);
    const legacy = setup();
    run(legacy.adapter, state, 10);
    expect(legacy.geometry.drawRange.count).toBe(0);
    state.overflowSites[0]!.primaryHazard = "erosion";
    run(adapter, state, 10);
    expect(geometry.drawRange.count).toBeGreaterThan(0);
  });

  it("freezes elapsed pause/review, bounds catchup/storage and clears a lost source", () => {
    let water: number | null = 2;
    const { adapter, geometry, state } = connectedSetup(() => 0, () => water);
    run(adapter, state, 10);
    const p = geometry.getAttribute("position") as THREE.BufferAttribute;
    const before = p.array.slice(), version = p.version, capacity = p.count;
    for (let i = 0; i < 100; i++) adapter.update({ ...state, disasterElapsedSeconds: 1 }, 1, 2 + i);
    expectSameBuffer(p.array, before);
    expect(p.version).toBe(version);
    adapter.update({ ...state, phase: "review", disasterElapsedSeconds: 1 }, 1, 103);
    expectSameBuffer(p.array, before);
    const control = connectedSetup();
    run(control.adapter, control.state, 20);
    adapter.update({ ...state, disasterElapsedSeconds: 1000 }, 1000, 104);
    expect(geometry.drawRange.count).toBe(control.geometry.drawRange.count);
    expectSameBuffer(p.array.slice(0, geometry.drawRange.count * 3),
      control.geometry.getAttribute("position").array.slice(0, control.geometry.drawRange.count * 3));
    expect(p.count).toBe(capacity);
    expect(geometry.drawRange.count).toBeLessThanOrEqual(capacity);
    water = null;
    adapter.update({ ...state, disasterElapsedSeconds: 1000.1 }, 0.1, 105);
    expect(geometry.drawRange.count).toBe(0);
    water = 2;
    adapter.update(state, 0, 106);
    expect(geometry.drawRange.count).toBe(0);
    adapter.update({ ...state, disasterElapsedSeconds: 0.1 }, 0, 106.1);
    const fresh = connectedSetup();
    run(fresh.adapter, fresh.state, 1);
    expectSameBuffer(p.array.slice(0, geometry.drawRange.count * 3),
      fresh.geometry.getAttribute("position").array.slice(0, fresh.geometry.drawRange.count * 3));
    adapter.dispose();
    expect(adapter.group.children).toHaveLength(0);
  });
});

describe("Three inundation adapter", () => {
  it("uses supplied measured ground for wet cells and omits missing ground", () => {
    const supplied = createDioramaInundation(() => 17);
    const missing = createDioramaInundation(() => null);
    adapters.push(supplied, missing);
    run(supplied);
    run(missing);
    const geometry = (supplied.group.children[0] as THREE.Mesh).geometry;
    expect(geometry.drawRange.count).toBeGreaterThan(0);
    const positions = geometry.getAttribute("position");
    for (let i = 0; i < geometry.drawRange.count; i++)
      expect(positions.getY(i)).toBeGreaterThanOrEqual(17.18 - 1e-5);
    expect((missing.group.children[0] as THREE.Mesh).geometry.drawRange.count).toBe(0);
    expect(missing.group.visible).toBe(false);
  });
  it("does not start for rain/high river alone, zero water, absent sites or inactive phases", () => {
    for (const state of [
      createInitialFloodState(),
      {
        ...wetState(),
        overflowMeters: 0,
        floodDepthMeters: 0,
        riverLevelMeters: 8,
        rainfallIntensity: 1,
      },
      { ...wetState(), overflowSites: [] },
      { ...wetState(), overflowSites: [{ ...candidate, intensity: 0 }] },
      { ...wetState(), phase: "preparation" as const },
    ]) {
      const { adapter, geometry } = setup();
      run(adapter, state);
      expect(adapter.group.visible).toBe(false);
      expect(geometry.drawRange.count).toBe(0);
    }
  });

  it("matches the real field's wet-cell count and max depth, spreading beyond the breach", () => {
    const { adapter, geometry } = setup();
    const state = wetState();
    const seed = {
      ...state.overflowSites[0]!,
      bankElevationMeters: getCandidateBankElevationMeters(candidate),
    };
    let firstCount = 0;
    adapter.update(state, 0, 0);
    for (let i = 0; i < 600; i++) {
      adapter.update({ ...state, disasterElapsedSeconds: (i + 1) / 10 }, 0.1, (i + 1) / 10);
      const site = advanceInundationField([seed], 1.2, 0.1, i * 100).sites[0]!;
      expect(geometry.drawRange.count / 12).toBe(site.floodedCellCount);
      if (i === 0) firstCount = geometry.drawRange.count;
      if (i === 599) {
        const position = geometry.getAttribute("position");
        const depths = Array.from(
          { length: geometry.drawRange.count },
          (_, index) =>
            position.getY(index) - groundY(position.getX(index), position.getZ(index)) - 0.18,
        );
        expect(Math.max(...depths)).toBeCloseTo(site.maxDepthMeters, 3);
        expect(Math.min(...depths)).toBeGreaterThanOrEqual(0.0399);
        expect(Math.max(...depths) - Math.min(...depths)).toBeGreaterThan(0.1);
      }
    }
    expect(adapter.object3D).toBe(adapter.group);
    expect(adapter.group.visible).toBe(true);
    expect(geometry.drawRange.count).toBeGreaterThan(firstCount);
    const p = geometry.getAttribute("position");
    const origin = geoToWorld(seed.longitude, seed.latitude);
    const heading = (seed.outflowHeadingDegrees * Math.PI) / 180;
    const distances = Array.from(
      { length: geometry.drawRange.count },
      (_, i) =>
        (p.getX(i) - origin.x) * Math.sin(heading) - (p.getZ(i) - origin.z) * Math.cos(heading),
    );
    expect(Math.max(...distances)).toBeGreaterThan(80);
    const townVertices = Array.from({ length: geometry.drawRange.count }, (_, i) => i).filter(
      (i) => Math.abs(p.getX(i) - riverX(p.getZ(i))) > 127,
    );
    expect(townVertices.length).toBeGreaterThan(18);
    // Shoreline smoothing contracts exposed corners; it never widens a cell edge.
    for (let i = 0; i < geometry.drawRange.count; i += 12) {
      const edge = Math.hypot(p.getX(i + 2) - p.getX(i + 1), p.getZ(i + 2) - p.getZ(i + 1));
      expect(edge).toBeLessThanOrEqual(16.1);
      expect(edge).toBeGreaterThan(5);
    }
    expect(adapter.group.children).toHaveLength(1);
  }, 20_000);

  it("hides immediately at zero water and restarts without residual wet cells", () => {
    const { adapter, geometry } = setup();
    run(adapter);
    expect(adapter.group.visible).toBe(true);
    adapter.update({ ...wetState(), overflowMeters: 0, floodDepthMeters: 0 }, 0, 11);
    expect(adapter.group.visible).toBe(false);
    expect(geometry.drawRange.count).toBe(0);
    const fresh = setup();
    adapter.update(wetState(), 0.1, 12);
    fresh.adapter.update(wetState(), 0.1, 12);
    adapter.update({ ...wetState(), disasterElapsedSeconds: 0.1 }, 0.1, 12.1);
    fresh.adapter.update({ ...wetState(), disasterElapsedSeconds: 0.1 }, 0.1, 12.1);
    expect(geometry.drawRange.count).toBeGreaterThan(0);
    expect(geometry.drawRange.count).toBe(fresh.geometry.drawRange.count);
    expectSameBuffer(geometry.getAttribute("position").array.slice(0, geometry.drawRange.count * 3),
      fresh.geometry.getAttribute("position").array.slice(0, geometry.drawRange.count * 3),
    );
  });

  it("isolates instances and resets on replay; result/review freeze the footprint", () => {
    const a = setup(),
      b = setup();
    run(a.adapter);
    b.adapter.update(createInitialFloodState(), 0.1, 1);
    const count = a.geometry.drawRange.count;
    a.adapter.update({ ...wetState(), phase: "result", disasterElapsedSeconds: 10 }, 1, 10);
    a.adapter.update({ ...wetState(), phase: "review", disasterElapsedSeconds: 10 }, 1, 11);
    expect(a.geometry.drawRange.count).toBe(count);
    a.adapter.update(wetState(), 0.1, 12);
    b.adapter.update(wetState(), 0.1, 12);
    expect(a.geometry.drawRange.count).toBe(b.geometry.drawRange.count);
  });

  it("uses simulation elapsed, caps geometry uploads at 10 Hz even with fast simulation", () => {
    const { adapter, geometry } = setup();
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    adapter.update(wetState(), 0, 0);
    for (let i = 1; i <= 100; i++)
      adapter.update({ ...wetState(), disasterElapsedSeconds: i * 0.1 }, 0.01, i * 0.01);
    expect(position.version).toBe(10);
  });

  it("freezes across paused draw loops without advancing hidden field state", () => {
    const paused = setup(),
      control = setup();
    run(paused.adapter);
    run(control.adapter);
    const position = paused.geometry.getAttribute("position") as THREE.BufferAttribute;
    const version = position.version;
    const before = position.array.slice();
    for (let frame = 1; frame <= 600; frame++) {
      paused.adapter.update({ ...wetState(), disasterElapsedSeconds: 10 }, 1 / 60, 10 + frame / 60);
    }
    expect(position.version).toBe(version);
    expectSameBuffer(position.array, before);
    const resumed = { ...wetState(), disasterElapsedSeconds: 10.1 };
    paused.adapter.update(resumed, 0.016, 20.1);
    control.adapter.update(resumed, 0, 20.1);
    expectSameBuffer(position.array, control.geometry.getAttribute("position").array);
  });

  it("catches up skipped snapshots and bounds huge gaps without a paused backlog", () => {
    const skipped = setup(),
      regular = setup(),
      capped = setup();
    for (const item of [skipped, regular, capped]) item.adapter.update(wetState(), 0, 0);
    for (let i = 1; i <= 10; i++) {
      regular.adapter.update({ ...wetState(), disasterElapsedSeconds: i / 10 }, 0, i / 10);
    }
    for (const elapsed of [0.5, 1]) {
      skipped.adapter.update({ ...wetState(), disasterElapsedSeconds: elapsed }, 0.016, elapsed);
    }
    capped.adapter.update({ ...wetState(), disasterElapsedSeconds: 60 }, 60, 60);
    const expected = regular.geometry.getAttribute("position").array;
    expectSameBuffer(skipped.geometry.getAttribute("position").array, expected);
    expectSameBuffer(capped.geometry.getAttribute("position").array, expected);
    const version = (capped.geometry.getAttribute("position") as THREE.BufferAttribute).version;
    for (let i = 1; i <= 100; i++)
      capped.adapter.update({ ...wetState(), disasterElapsedSeconds: 60 }, 1, 60 + i);
    expect((capped.geometry.getAttribute("position") as THREE.BufferAttribute).version).toBe(
      version,
    );
    expectSameBuffer(capped.geometry.getAttribute("position").array, expected);
  });

  it("anchors late mounts and rejects invalid elapsed without injecting guessed history", () => {
    const { adapter, geometry } = setup();
    adapter.update({ ...wetState(), disasterElapsedSeconds: 50 }, 50, 50);
    for (const elapsed of [50, NaN, Infinity, -1]) {
      adapter.update({ ...wetState(), disasterElapsedSeconds: elapsed }, 1, 51);
    }
    expect(geometry.drawRange.count).toBe(0);
    adapter.update({ ...wetState(), disasterElapsedSeconds: 50.1 }, 0, 52);
    expect(geometry.drawRange.count).toBeGreaterThan(0);
  });

  it("shares wet-corner heights and colors while keeping exact cell centers", () => {
    const { adapter, geometry } = setup();
    run(adapter);
    const positions = geometry.getAttribute("position");
    const colors = geometry.getAttribute("color");
    const corners = new Map<string, number[]>();
    let shared = 0,
      sloped = 0;
    for (let base = 0; base < geometry.drawRange.count; base += 12) {
      for (const offset of [1, 2, 5, 8]) {
        const i = base + offset;
        const key = `${positions.getX(i)},${positions.getZ(i)}`;
        const value = [positions.getY(i), colors.getX(i), colors.getY(i), colors.getZ(i)];
        if (corners.has(key)) {
          expect(value).toEqual(corners.get(key));
          shared++;
        }
        corners.set(key, value);
        const depth = (v: number) =>
          positions.getY(v) - groundY(positions.getX(v), positions.getZ(v));
        if (Math.abs(depth(i) - depth(base)) > 0.001) sloped++;
      }
    }
    expect(shared).toBeGreaterThan(0);
    expect(sloped).toBeGreaterThan(0);
  });

  it("removes stale sites and disposes resources exactly once", () => {
    const { adapter, geometry, mesh } = setup();
    const parent = new THREE.Group();
    parent.add(adapter.group);
    run(adapter);
    adapter.update({ ...wetState(), overflowSites: [] }, 0, 11);
    expect(adapter.group.visible).toBe(false);
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(mesh.material, "dispose");
    adapter.dispose();
    adapter.dispose();
    adapter.update(wetState(), 1, 12);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(parent.children).toHaveLength(0);
    expect(adapter.group.children).toHaveLength(0);
    expect(adapter.group.visible).toBe(false);
  });
});
