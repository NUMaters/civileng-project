import * as THREE from "three";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createGeographicLandcover } from "./geographicLandcover";
import { createGeographicTerrain, type RenderedTerrainSurface } from "./geographicTerrain";
import { createGeographicWorld, type GeographicWorld } from "./geographicWorld";
import { isGeodataBridge, type KoriyamaGeodata } from "./koriyamaGeodata";
import { decodeKoriyamaTerrain, type KoriyamaTerrainMetadata } from "./koriyamaTerrain";
import { disposeDioramaObject } from "./disposeDioramaObject";
import { worldToGeo } from "./dioramaSpace";

function syntheticFeature(id: string, kind: "campus" | "water", rings: number[][][]): KoriyamaGeodata["features"][number] {
  return {
    type: "Feature", id, properties: { kind, version: 1, timestamp: "synthetic-test" },
    geometry: { type: "MultiPolygon", coordinates: [rings.map((ring) => ring.map(([x, z]) => {
      const point = worldToGeo(x!, z!); return [point.longitude, point.latitude] as [number, number];
    }))] },
  };
}

function syntheticLine(id: string, kind: "road" | "rail", bridge?: string) {
  const coordinates = [[0, 0], [4, 4]].map(([x, z]) => {
    const point = worldToGeo(x!, z!); return [point.longitude, point.latitude] as [number, number];
  });
  return {
    type: "Feature" as const, id, properties: { kind, version: 1, timestamp: "synthetic-test", ...(bridge ? { bridge } : {}) },
    geometry: { type: "MultiLineString" as const, coordinates: [coordinates] },
  };
}

function syntheticSurface(noDataCell = false): RenderedTerrainSurface {
  const xCoordinates = new Float32Array([0, 2, 4]), zCoordinates = new Float32Array([0, 2, 4]);
  const vertices = [[0, 4, 1], [3, 6, 5], [2, 7, 9]];
  const height = (x: number, z: number) => {
    const column = Math.min(1, Math.max(0, Math.floor(x / 2))), row = Math.min(1, Math.max(0, Math.floor(z / 2)));
    if (noDataCell && column === 1 && row === 1) return null;
    const fx = (x - xCoordinates[column]!) / 2, fz = (z - zCoordinates[row]!) / 2;
    const p00 = vertices[row]![column]!, p10 = vertices[row]![column + 1]!,
      p01 = vertices[row + 1]![column]!, p11 = vertices[row + 1]![column + 1]!;
    return fx + fz <= 1
      ? p00 * (1 - fx - fz) + p01 * fz + p10 * fx
      : p10 * (1 - fz) + p01 * (1 - fx) + p11 * (fx + fz - 1);
  };
  return {
    originX: 0, originZ: 0, maxX: 4, maxZ: 4, columns: 2, rows: 2, cellWidth: 2, cellHeight: 2,
    xCoordinates, zCoordinates, sampleRenderedGround: height,
  };
}

function xzArea(world: GeographicWorld, layer: string) {
  let area = 0;
  for (const child of world.children) {
    const mesh = child as THREE.Mesh;
    if (mesh.userData.layer !== layer) continue;
    const position = mesh.geometry.getAttribute("position");
    for (let i = 0; i + 2 < position.count; i += 3) {
      area += Math.abs((position.getX(i + 1) - position.getX(i)) * (position.getZ(i + 2) - position.getZ(i)) -
        (position.getZ(i + 1) - position.getZ(i)) * (position.getX(i + 2) - position.getX(i))) / 2;
    }
  }
  return area;
}

function disposeWorld(world: GeographicWorld) {
  const materials = new Set<THREE.Material>();
  for (const child of world.children) {
    const mesh = child as THREE.Mesh;
    mesh.geometry.dispose();
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
  }
  for (const material of materials) material.dispose();
}

it("always regresses synthetic rendered-terrain draping, holes, no-data and non-ground layers", () => {
  const source = syntheticFeature("campus-hole", "campus", [[
    [0, 0], [4, 0], [4, 4], [0, 4], [0, 0],
  ], [
    [1, 1], [1, 2], [2, 2], [2, 1], [1, 1],
  ]]);
  const surface = syntheticSurface();
  const ground = (x: number, z: number) => surface.sampleRenderedGround(x, z);
  const world = createGeographicWorld({ type: "FeatureCollection", bbox: [140, 37, 141, 38], features: [source] }, {
    localBounds: { minX: 0, minZ: 0, maxX: 4, maxZ: 4 }, groundSampler: () => 0,
    renderedTerrainSurface: surface, surfaceSampler: (x, z) => {
      const y = ground(x, z); return y === null ? null : y + 0.12;
    }, tileSize: 16,
  });
  expect(xzArea(world, "campus")).toBeCloseTo(15, 5);
  expect(world.children.some((child) => (child as THREE.Mesh).geometry.getAttribute("position").count > 0)).toBe(true);
  const positions = world.children.flatMap((child) => {
    const mesh = child as THREE.Mesh, p = mesh.geometry.getAttribute("position");
    return Array.from({ length: p.count }, (_, i) => ({ x: p.getX(i), y: p.getY(i), z: p.getZ(i) }));
  });
  expect(positions.some((p) => p.x > 1 && p.x < 2 && p.z > 1 && p.z < 2)).toBe(false);
  expect(surface.sampleRenderedGround(1.5, 0.75)).toBeCloseTo(4, 5);
  expect(positions.every((p) => Math.abs(p.y - (surface.sampleRenderedGround(p.x, p.z)! + 0.12)) < 1e-5)).toBe(true);
  disposeWorld(world);

  const noDataSurface = syntheticSurface(true);
  const noDataWorld = createGeographicWorld({ type: "FeatureCollection", bbox: [140, 37, 141, 38], features: [source] }, {
    localBounds: { minX: 0, minZ: 0, maxX: 4, maxZ: 4 }, groundSampler: () => 0,
    renderedTerrainSurface: noDataSurface, surfaceSampler: (x, z) => noDataSurface.sampleRenderedGround(x, z), tileSize: 16,
  });
  expect(xzArea(noDataWorld, "campus")).toBeLessThan(15);
  expect(xzArea(noDataWorld, "campus")).toBeGreaterThan(0);
  disposeWorld(noDataWorld);

  const nonGround = createGeographicWorld({ type: "FeatureCollection", bbox: [140, 37, 141, 38], features: [
    syntheticFeature("water", "water", [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]]),
    syntheticLine("bridge", "road", "yes"),
  ] }, {
    localBounds: { minX: 0, minZ: 0, maxX: 4, maxZ: 4 }, groundSampler: () => 0,
    renderedTerrainSurface: { ...surface, sampleRenderedGround: (x, z) => 1000 + x * 7 + z * 11 },
    surfaceSampler: (x, z, layer) => layer === "water" ? 40 + x * 0.25 + z * 0.5 : 50 + x * 0.25 + z * 0.5,
    tileSize: 16,
  });
  const waterMeshes = nonGround.children.filter((child) => (child as THREE.Mesh).userData.layer === "water") as THREE.Mesh[];
  const bridgeMeshes = nonGround.children.filter((child) => (child as THREE.Mesh).userData.layer === "bridge-road") as THREE.Mesh[];
  expect(waterMeshes).not.toHaveLength(0);
  expect(bridgeMeshes).not.toHaveLength(0);
  const assertRawSurface = (meshes: THREE.Mesh[], base: number) => {
    const heights: number[] = [];
    for (const mesh of meshes) {
      const p = mesh.geometry.getAttribute("position");
      for (let i = 0; i < p.count; i++) {
        const expected = base + p.getX(i) * 0.25 + p.getZ(i) * 0.5;
        heights.push(p.getY(i));
        expect(p.getY(i)).toBeCloseTo(expected, 5);
      }
    }
    expect(new Set(heights.map((height) => height.toFixed(5))).size).toBeGreaterThan(1);
  };
  assertRawSurface(waterMeshes, 40);
  assertRawSurface(bridgeMeshes, 50);
  disposeWorld(nonGround);
});

/** Actual before/after evidence for the rendered-terrain drape. */
it("audits raw-DEM and rendered-terrain draping on actual roads and landcover", async () => {
  const outDir = process.env.CIVILCRAFT_OUT_DIR;
  if (!outDir) { console.info("ROAD_TERRAIN_DRAPING_BEFORE_AFTER skipped: set CIVILCRAFT_OUT_DIR for the bounded audit"); return; }
  mkdirSync(outDir, { recursive: true });
  const base = new URL("../../../public/geodata/koriyama/", import.meta.url);
  const read = (name: string) => readFileSync(new URL(name, base));
  const osm = JSON.parse(read("features.geojson").toString()) as KoriyamaGeodata;
  const metadata = JSON.parse(read("terrain-metadata.json").toString()) as KoriyamaTerrainMetadata;
  const landcoverData = JSON.parse(read("landcover.geojson").toString());
  const terrain = createGeographicTerrain(decodeKoriyamaTerrain(Uint8Array.from(read("terrain.bin")).buffer, metadata));
  const roadFeatures = osm.features.filter(feature => ["road", "rail"].includes(feature.properties.kind) && !isGeodataBridge(feature));
  const sourceRoadSnapshot = JSON.stringify(roadFeatures);
  const sourceLandcoverSnapshot = JSON.stringify(landcoverData);
  const rawWorld = createGeographicWorld({ ...osm, features: roadFeatures }, {
    localBounds: terrain.bounds, groundSampler: terrain.sampleGround, surfaceGridSpacing: 12,
    surfaceSampler: (x, z) => { const y = terrain.sampleGround(x, z); return y === null ? null : y + 0.12; },
  });
  const drapedWorld = createGeographicWorld({ ...osm, features: roadFeatures }, {
    localBounds: terrain.bounds, groundSampler: terrain.sampleGround, surfaceGridSpacing: 12,
    renderedTerrainSurface: terrain.renderedSurface,
    surfaceSampler: (x, z, layer) => {
      const y = ["road", "rail", "campus"].includes(layer) ? terrain.sampleRenderedGround(x, z) : terrain.sampleGround(x, z);
      return y === null ? null : y + 0.12;
    },
  });
  const rawLandcover = createGeographicLandcover(landcoverData, { bounds: terrain.bounds, groundSampler: terrain.sampleGround });
  const drapedLandcover = createGeographicLandcover(landcoverData, {
    bounds: terrain.bounds, groundSampler: terrain.sampleGround, renderedTerrainSurface: terrain.renderedSurface,
  });
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  const terrainRecords = terrain.group.children.filter((object): object is THREE.Mesh => object instanceof THREE.Mesh).map(mesh => {
    mesh.geometry.computeBoundingBox();
    return { mesh, bounds: mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld) };
  });
  const actualMeshRaycastAt = (x: number, z: number) => {
    ray.ray.origin.set(x, 10_000, z);
    let best: THREE.Intersection | undefined;
    for (const { mesh, bounds } of terrainRecords) {
      if (x < bounds.min.x || x > bounds.max.x || z < bounds.min.z || z > bounds.max.z) continue;
      const hit = ray.intersectObject(mesh, false)[0];
      if (hit && (!best || hit.point.y > best.point.y)) best = hit;
    }
    return best?.point.y ?? null;
  };
  // This is the exact downward ray intersection height of the rendered terrain
  // triangle selected by the shared Float32 grid/diagonal evaluator. Keeping
  // this lookup on the shared surface avoids an O(samples * terrainTriangles)
  // Three.js traversal while testing the same rendered surface.
  const terrainAt = terrain.sampleRenderedGround;
  const round = (n: number | null) => n === null ? null : Math.round(n * 1e6) / 1e6;
  const auditWorld = async (root: THREE.Object3D, maxSamples = 250_000) => {
    root.updateMatrixWorld(true);
    const meshes = root.children.filter((object): object is THREE.Mesh => object instanceof THREE.Mesh && ["road", "rail"].includes(object.userData.layer));
    let candidateSamples = 0, samples = 0, noData = 0, missingTerrain = 0, buriedOver2cm = 0, under2cm = 0;
    let minimum = Infinity, maximumTerrainMinusRaw = -Infinity, sum = 0;
    const worst: { x: number; z: number; roadY: number; terrainY: number; rawY: number; delta: number; sourceIds: string[] }[] = [];
    for (const mesh of meshes) {
      const p = mesh.geometry.getAttribute("position"), end = Math.min(p.count, mesh.geometry.drawRange.start + mesh.geometry.drawRange.count);
      for (let i = mesh.geometry.drawRange.start; i + 2 < end; i += 3) {
        const a = new THREE.Vector3().fromBufferAttribute(p, i), b = new THREE.Vector3().fromBufferAttribute(p, i + 1), c = new THREE.Vector3().fromBufferAttribute(p, i + 2);
        const longest = Math.max(Math.hypot(a.x - b.x, a.z - b.z), Math.hypot(a.x - c.x, a.z - c.z), Math.hypot(b.x - c.x, b.z - c.z));
        const n = Math.max(1, Math.ceil(longest / 0.5));
        for (let u = 0; u <= n; u++) for (let v = 0; v <= n - u; v++) {
          candidateSamples++;
          if (candidateSamples % 10_000 === 0) await new Promise<void>(resolve => setImmediate(resolve));
          if (samples >= maxSamples) continue;
          const s = u / n, t = v / n, x = a.x + (b.x - a.x) * s + (c.x - a.x) * t;
          const z = a.z + (b.z - a.z) * s + (c.z - a.z) * t, roadY = a.y + (b.y - a.y) * s + (c.y - a.y) * t;
          const rawY = terrain.sampleGround(x, z);
          if (rawY === null) { noData++; continue; }
          const terrainY = terrainAt(x, z);
          if (terrainY === null) { missingTerrain++; continue; }
          const delta = roadY - terrainY;
          samples++; sum += delta; minimum = Math.min(minimum, delta); maximumTerrainMinusRaw = Math.max(maximumTerrainMinusRaw, terrainY - rawY);
          if (delta < -0.02) buriedOver2cm++;
          if (delta < 0.02) under2cm++;
          const item = { x: round(x)!, z: round(z)!, roadY: round(roadY)!, terrainY: round(terrainY)!, rawY: round(rawY)!, delta: round(delta)!,
            sourceIds: Array.isArray(mesh.userData.sourceIds) ? [...mesh.userData.sourceIds] as string[] : [] };
          if (worst.length < 5) worst.push(item);
          else { const index = worst.reduce((iWorst, candidate, iCandidate) => candidate.delta < worst[iWorst]!.delta ? iCandidate : iWorst, 0); if (delta < worst[index]!.delta) worst[index] = item; }
        }
      }
    }
    worst.sort((a, b) => a.delta - b.delta);
    return { meshes: meshes.length, candidateSamples, samples, capped: candidateSamples > maxSamples, noData, missingTerrain,
      buriedOver2cm, under2cm, buriedRate: samples ? buriedOver2cm / samples : null, minimum: Number.isFinite(minimum) ? round(minimum) : null,
      mean: samples ? round(sum / samples) : null, maximumTerrainMinusRaw: Number.isFinite(maximumTerrainMinusRaw) ? round(maximumTerrainMinusRaw) : null, worst };
  };
  const auditLandcover = (root: THREE.Object3D) => {
    root.updateMatrixWorld(true);
    let vertices = 0, buriedOver2cm = 0, missingTerrain = 0, minimum = Infinity;
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh) || object.userData.layer !== "campus") return;
      const p = object.geometry.getAttribute("position");
      for (let i = 0; i < p.count; i++) {
        const ground = terrainAt(p.getX(i), p.getZ(i));
        if (ground === null) { missingTerrain++; continue; }
        const delta = p.getY(i) - ground; vertices++; minimum = Math.min(minimum, delta); if (delta < -0.02) buriedOver2cm++;
      }
    });
    return { vertices, missingTerrain, buriedOver2cm, minimum: Number.isFinite(minimum) ? round(minimum) : null };
  };
  try {
    terrain.group.updateMatrixWorld(true);
    let raycastChecks = 0, raycastMissing = 0, raycastMismatches = 0, maxRaycastDelta = 0;
    for (let i = 0; i < 1_000; i++) {
      const x = terrain.renderedSurface.originX + (terrain.renderedSurface.maxX - terrain.renderedSurface.originX) * ((i * 37) % 997) / 996;
      const z = terrain.renderedSurface.originZ + (terrain.renderedSurface.maxZ - terrain.renderedSurface.originZ) * ((i * 61) % 991) / 990;
      const expected = terrain.sampleRenderedGround(x, z), actual = actualMeshRaycastAt(x, z);
      if (expected === null || actual === null) { raycastMissing++; continue; }
      raycastChecks++; const delta = Math.abs(expected - actual); maxRaycastDelta = Math.max(maxRaycastDelta, delta); if (delta > 1e-5) raycastMismatches++;
    }
    const before = await auditWorld(rawWorld), after = await auditWorld(drapedWorld);
    const landcoverBefore = auditLandcover(rawLandcover.group), landcoverAfter = auditLandcover(drapedLandcover.group);
    const sourceIdsBefore = rawLandcover.group.userData.surfaceSourceIds as string[];
    const sourceIdsAfter = drapedLandcover.group.userData.surfaceSourceIds as string[];
    const report = {
      thresholds: { buriedMeters: 0.02, displayLiftMeters: 0.12, denseSpacingMeters: 0.5, maxRoadSamplesPerState: 250_000 },
      grid: { originX: terrain.renderedSurface.originX, originZ: terrain.renderedSurface.originZ, maxX: terrain.renderedSurface.maxX, maxZ: terrain.renderedSurface.maxZ,
        columns: terrain.renderedSurface.columns, rows: terrain.renderedSurface.rows,
        cellWidth: terrain.renderedSurface.cellWidth, cellHeight: terrain.renderedSurface.cellHeight, roadGridOriginBefore: { x: 0, z: 0 } },
      renderedMeshRaycast: { checks: raycastChecks, missing: raycastMissing, mismatches: raycastMismatches, maxAbsDelta: round(maxRaycastDelta) },
      before, after, landcoverBefore, landcoverAfter,
      preservation: { roadSourceUnchanged: JSON.stringify(roadFeatures) === sourceRoadSnapshot, landcoverSourceUnchanged: JSON.stringify(landcoverData) === sourceLandcoverSnapshot,
        landcoverSurfaceIdsUnchanged: JSON.stringify(sourceIdsBefore) === JSON.stringify(sourceIdsAfter), polygonHoleSourceCount: landcoverData.features.filter((f: { geometry: { type: string; coordinates: unknown[][][] } }) => f.geometry.type === "MultiPolygon" && f.geometry.coordinates.some(rings => rings.length > 1)).length },
      recommendation: "Use sampleRenderedGround plus the existing display lift for ground layers; keep raw sampleGround for source data, and keep water/stage and bridge decks on their existing paths.",
    };
    const outputPath = join(outDir, "road-terrain-draping-before-after.json");
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.info("ROAD_TERRAIN_DRAPING_BEFORE_AFTER", JSON.stringify({ outputPath, ...report }, null, 2));
    expect(before.samples).toBeGreaterThan(0);
    expect(after.samples).toBeGreaterThan(0);
    expect(raycastChecks).toBeGreaterThan(0);
    expect(raycastMismatches).toBe(0);
    expect(after.buriedOver2cm).toBe(0);
    expect(after.missingTerrain).toBe(0);
    expect(landcoverAfter.buriedOver2cm).toBe(0);
    expect(JSON.stringify(roadFeatures)).toBe(sourceRoadSnapshot);
    expect(JSON.stringify(landcoverData)).toBe(sourceLandcoverSnapshot);
    expect(sourceIdsAfter).toEqual(sourceIdsBefore);
  } finally {
    disposeDioramaObject(rawWorld); disposeDioramaObject(drapedWorld);
    disposeDioramaObject(rawLandcover.group); disposeDioramaObject(drapedLandcover.group); disposeDioramaObject(terrain.group);
  }
}, 120_000);
