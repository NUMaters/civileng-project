import * as THREE from "three";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createGeographicTerrain } from "./geographicTerrain";
import { decodeKoriyamaTerrain, type KoriyamaTerrainMetadata } from "./koriyamaTerrain";
import { createGeographicWorld } from "./geographicWorld";
import { createGeographicLandcover } from "./geographicLandcover";
import type { KoriyamaLandcover } from "./koriyamaLandcover";
import type { KoriyamaGeodata } from "./koriyamaGeodata";
import { createRiverSurfaceSampler } from "./riverSurface";
import { createRiverStageController } from "./riverStage";
import { createRiverBoundaryResolver, type RiverBoundary } from "./riverBoundary";
import { createDioramaInundation } from "./dioramaInundation";
import { selectRenderedFloodPatch } from "./floodCameraFocus";
import { disposeDioramaObject } from "./disposeDioramaObject";
import { advanceFloodSimulation, beginDisaster, createInitialFloodState, DEFAULT_WEATHER_SEED } from "../../features/disaster/services/floodSimulation";

/** Read-only actual-data diagnostic. Reports discrepancies; it does not assert that
 * a known visual defect is absent, substitute terrain, or change production thresholds.
 * Run alone with CIVILCRAFT_OUT_DIR set to a unique temporary directory.
 */
it("diagnoses actual emitted flood against rendered terrain and landcover", () => {
  const read = (file: string) => readFileSync(new URL(`../../../public/geodata/koriyama/${file}`, import.meta.url));
  const osm = JSON.parse(read("features.geojson").toString()) as KoriyamaGeodata;
  const metadata = JSON.parse(read("terrain-metadata.json").toString()) as KoriyamaTerrainMetadata;
  const terrain = createGeographicTerrain(decodeKoriyamaTerrain(Uint8Array.from(read("terrain.bin")).buffer, metadata));
  const world = createGeographicWorld({ ...osm, features: osm.features.filter(f => ["water", "waterway"].includes(f.properties.kind)) }, {
    localBounds: terrain.bounds, groundSampler: terrain.sampleGround, surfaceGridSpacing: 12,
    surfaceSampler: (x, z) => { const y = terrain.sampleGround(x, z); return y === null ? null : y + 0.35; },
  });
  const landcover = createGeographicLandcover(JSON.parse(read("landcover.geojson").toString()) as KoriyamaLandcover,
    { bounds: terrain.bounds, groundSampler: terrain.sampleGround });
  const stage = createRiverStageController(world.waterMeshes);
  const resolve = createRiverBoundaryResolver(osm, createRiverSurfaceSampler(world.waterMeshes));
  const emittedBoundaries = new Map<string, RiverBoundary>();
  const flood = createDioramaInundation(terrain.sampleGround, site => {
    const b = resolve(site);
    if (b) emittedBoundaries.set(site.id, b);
    return b;
  });
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  function index(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    const records: { mesh: THREE.Mesh; bounds: THREE.Box3 }[] = [];
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return;
      object.geometry.computeBoundingBox();
      records.push({ mesh: object, bounds: object.geometry.boundingBox!.clone().applyMatrix4(object.matrixWorld) });
    });
    return (x: number, z: number) => {
      ray.ray.origin.set(x, 10000, z);
      let y: number | null = null, name: string | null = null;
      for (const record of records) {
        const b = record.bounds;
        if (x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
        const hit = ray.intersectObject(record.mesh, false)[0];
        if (hit && (y === null || hit.point.y > y)) { y = hit.point.y; name = record.mesh.name; }
      }
      return { y, name };
    };
  }
  const renderedGround = index(terrain.group);
  // Surface polygons only; crowns/trunks cannot explain a continuous green ground strip.
  const renderedCover = index(landcover.group);
  const round = (n: number | null) => n === null ? null : Math.round(n * 1e6) / 1e6;
  type Point = { x: number; y: number; z: number };
  function inspect(points: Point[]) {
    let terrainBuried = 0, coverBuried = 0, missingTerrain = 0, underSafetyClearance = 0;
    let minRaw = Infinity, minRendered = Infinity, maxTerrainMinusRaw = -Infinity;
    let worst: unknown = null, coverWorst: unknown = null, minCover = Infinity;
    for (const p of points) {
      const raw = terrain.sampleGround(p.x, p.z), ground = renderedGround(p.x, p.z), cover = renderedCover(p.x, p.z);
      if (raw !== null) minRaw = Math.min(minRaw, p.y - raw);
      if (ground.y === null) { missingTerrain++; continue; }
      const clearance = p.y - ground.y;
      if (clearance < -0.02) terrainBuried++;
      if (clearance < 0.22) underSafetyClearance++;
      if (raw !== null) maxTerrainMinusRaw = Math.max(maxTerrainMinusRaw, ground.y - raw);
      if (clearance < minRendered) {
        minRendered = clearance;
        worst = { x: round(p.x), z: round(p.z), waterY: round(p.y), rawY: round(raw), renderedY: round(ground.y),
          renderedMinusWater: round(-clearance), renderedMinusRaw: raw === null ? null : round(ground.y - raw), mesh: ground.name };
      }
      if (cover.y !== null) {
        const gap = p.y - cover.y;
        if (gap < -0.02) coverBuried++;
        if (gap < minCover) { minCover = gap; coverWorst = { x: round(p.x), z: round(p.z), waterY: round(p.y), coverY: round(cover.y), mesh: cover.name }; }
      }
    }
    return { samples: points.length, terrainBuriedOver2cm: terrainBuried, coverBuriedOver2cm: coverBuried,
      missingTerrain, under22cmClearance: underSafetyClearance, minRawClearance: round(minRaw),
      minRenderedClearance: round(minRendered), maxRenderedMinusRaw: round(maxTerrainMinusRaw), worst, coverWorst };
  }
  function denseTriangles(p: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, start: number, count: number) {
    const points: Point[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = start; i < start + count; i += 3) {
      a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
      const longest = Math.max(Math.hypot(a.x - b.x, a.z - b.z), Math.hypot(a.x - c.x, a.z - c.z), Math.hypot(b.x - c.x, b.z - c.z));
      const n = Math.max(1, Math.ceil(longest / 0.5));
      for (let u = 0; u <= n; u++) for (let v = 0; v <= n - u; v++) {
        const s = u / n, t = v / n;
        points.push({ x: a.x + (b.x - a.x) * s + (c.x - a.x) * t,
          y: a.y + (b.y - a.y) * s + (c.y - a.y) * t, z: a.z + (b.z - a.z) * s + (c.z - a.z) * t });
      }
    }
    return points;
  }
  try {
    let state = beginDisaster(createInitialFloodState(), { weatherSeed: DEFAULT_WEATHER_SEED });
    stage.update(state.riverLevelMeters); flood.update(state, 0, 0);
    for (let step = 1; step <= 901 && state.phase === "disaster"; step++) {
      state = advanceFloodSimulation(state, [], 0.1);
      stage.update(state.riverLevelMeters); flood.update(state, 0.1, step / 10);
    }
    expect(state.phase).toBe("result");
    const patches = flood.getRenderedPatches(), geometry = (flood.group.children[0] as THREE.Mesh).geometry;
    expect(patches.length).toBeGreaterThan(0);
    expect(patches.reduce((sum, p) => sum + p.vertexCount, 0)).toBe(geometry.drawRange.count);
    const positions = geometry.getAttribute("position");
    const report: unknown[] = [];
    let start = 0;
    for (const patch of patches) {
      const boundary = emittedBoundaries.get(patch.id)!;
      const edge = boundary.edge ?? [boundary.left, boundary.right];
      const connectorCount = (edge.length - 1) * 6;
      const connectorStart = start + patch.vertexCount - connectorCount;
      const connector = inspect(denseTriangles(positions, connectorStart, connectorCount));
      const cells = inspect(denseTriangles(positions, start, patch.vertexCount - connectorCount));
      // Actual emitted corners at the receiving cell edge, not invented out-of-bank offsets.
      const inletCorners = [connectorStart + 2, connectorStart + connectorCount - 1].map(i =>
        ({ x: positions.getX(i), y: positions.getY(i), z: positions.getZ(i) }));
      const waterRay = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
      let maxSeamDelta = 0, seamMisses = 0;
      for (let i = 1; i < edge.length; i++) {
        const a = edge[i - 1]!, b = edge[i]!;
        const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25));
        for (let j = 0; j <= count; j++) {
          const t = j / count, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          waterRay.ray.origin.set(x, 10000, z);
          const hit = waterRay.intersectObjects(world.waterMeshes.filter(m => m.userData.riverStageEligible === true), false)[0];
          if (!hit) { seamMisses++; continue; }
          maxSeamDelta = Math.max(maxSeamDelta, Math.abs(hit.point.y - (a.y + (b.y - a.y) * t)));
        }
      }
      report.push({ siteId: patch.id, sourceId: boundary.sourceId, sourceSegment: boundary.segmentIndex,
        bounds: patch.bounds, areaM2: round(patch.areaM2 ?? 0), vertexCount: patch.vertexCount, connectorVertices: connectorCount,
        connector, cells, actualInletCorners: inspect(inletCorners), seam: { maxVerticalDelta: round(maxSeamDelta), rayMissesOnExactSourceEdge: seamMisses } });
      start += patch.vertexCount;
    }
    const candidateCorners = state.overflowSites.filter(s => s.primaryHazard === "overtopping" || s.primaryHazard === "erosion").slice(0, 24).map(site => {
      const b = resolve(site);
      if (!b) return { id: site.id, unresolved: true };
      const length = Math.hypot(b.right.x - b.left.x, b.right.z - b.left.z), head = Math.min(...(b.edge ?? [b.left, b.right]).map(p => p.y));
      const corners = [-8, 8].map(s => ({ x: b.anchor.x + (b.right.x - b.left.x) / length * s + b.inland.x * 8,
        z: b.anchor.z + (b.right.z - b.left.z) / length * s + b.inland.z * 8, y: head }));
      return { id: site.id, sourceId: b.sourceId, emitted: patches.some(p => p.id === site.id), desiredInletCorners: inspect(corners) };
    });
    console.info("FLOOD_TERRAIN_DIAGNOSTIC", JSON.stringify({
      thresholds: { buriedMeters: 0.02, existingRawSafetyClearanceMeters: 0.22, denseTriangleSpacingMeters: 0.5, sourceSeamSpacingMeters: 0.25 },
      elapsed: state.disasterElapsedSeconds, damagePercent: state.damagePercent, riverLevel: state.riverLevelMeters,
      selectedPatch: selectRenderedFloodPatch(patches)?.id, patches: report, candidateCorners,
    }, null, 2));
  } finally {
    flood.dispose(); disposeDioramaObject(world); disposeDioramaObject(terrain.group); disposeDioramaObject(landcover.group);
  }
}, 120_000);
