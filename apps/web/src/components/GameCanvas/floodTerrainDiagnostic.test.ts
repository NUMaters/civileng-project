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
  // Retain the OLD 16m-cell admission calculation as a before/after baseline.
  // This is no longer production admission; current geometry is independently raycast below.
  function admission(b: RiverBoundary) {
    const length = Math.hypot(b.right.x - b.left.x, b.right.z - b.left.z);
    const tx = (b.right.x - b.left.x) / length, tz = (b.right.z - b.left.z) / length;
    const edge = b.edge ?? [b.left, b.right], head = Math.min(...edge.map(p => p.y));
    const at = (lateral: number, inland: number) => ({ x: b.anchor.x + tx * lateral + b.inland.x * inland,
      z: b.anchor.z + tz * lateral + b.inland.z * inland });
    const gridFailures: unknown[] = [], throatFailures: unknown[] = [];
    let bed = -Infinity;
    for (const inland of [8, 16, 24]) for (const lateral of [-8, 0, 8]) {
      const p = at(lateral, inland), raw = terrain.sampleGround(p.x, p.z), land = b.isLand(p.x, p.z);
      const reasons = [raw === null || !Number.isFinite(raw) ? "nodata" : null, !land ? "receiving-cell-in-source-water" : null].filter(Boolean);
      if (reasons.length) bed = Infinity;
      else bed = Math.max(bed, raw! + 0.18);
      if (reasons.length || (raw !== null && head - raw < 0.22)) gridFailures.push({ ...p, lateral, inland, raw, head, clearance: raw === null ? null : head - raw, reasons: reasons.length ? reasons : ["receiving-cell-too-high"] });
    }
    const left = { ...at(-8, 8), y: head }, right = { ...at(8, 8), y: head };
    const receiving = (p: Point) => {
      const fraction = ((p.x - b.left.x) * tx + (p.z - b.left.z) * tz) / length;
      return { x: left.x + (right.x - left.x) * fraction, y: head, z: left.z + (right.z - left.z) * fraction };
    };
    for (let i = 1; i < edge.length; i++) {
      const a = edge[i - 1]!, c = edge[i]!, d = receiving(c), e = receiving(a);
      for (const [p, q, r] of [[a, c, d], [a, d, e]] as [Point, Point, Point][]) {
        const n = Math.ceil(Math.max(Math.hypot(p.x - q.x, p.z - q.z), Math.hypot(p.x - r.x, p.z - r.z), Math.hypot(q.x - r.x, q.z - r.z)) / 4);
        for (let u = 0; u <= n; u++) for (let v = 0; v <= n - u; v++) {
          const s = u / n, t = v / n;
          const x = p.x + (q.x - p.x) * s + (r.x - p.x) * t, z = p.z + (q.z - p.z) * s + (r.z - p.z) * t;
          const y = p.y + (q.y - p.y) * s + (r.y - p.y) * t, raw = terrain.sampleGround(x, z);
          const inland = (x - b.anchor.x) * b.inland.x + (z - b.anchor.z) * b.inland.z;
          const reasons = [raw === null || !Number.isFinite(raw) ? "throat-nodata" : null,
            raw !== null && raw + 0.18 + 0.04 > y ? "throat-too-high" : null,
            inland > 1e-5 && !b.isLand(x, z) ? "throat-in-source-water" : null].filter(Boolean);
          if (reasons.length) throatFailures.push({ x, z, y, raw, inland, clearance: raw === null ? null : y - raw, reasons });
        }
      }
    }
    const structuralFailure = edge.length < 2 || edge.length > 32 || edge.some(p => ![p.x, p.y, p.z].every(Number.isFinite) || Math.hypot(p.x - b.anchor.x, p.z - b.anchor.z) > 16) || length < 1e-4;
    return { sourceId: b.sourceId, segment: b.segmentIndex, head, bankWidth: length,
      firstFailure: structuralFailure ? "boundary-structure" : !Number.isFinite(bed) ? "receiving-cell-invalid" : head - bed < 0.04 ? "receiving-cell-too-high" : throatFailures.length ? "throat-check" : null,
      bed: Number.isFinite(bed) ? bed : "invalid", gridFailures, throatFailureCount: throatFailures.length, firstThroatFailures: throatFailures.slice(0, 3) };
  }
  try {
    let state = beginDisaster(createInitialFloodState(), { weatherSeed: DEFAULT_WEATHER_SEED });
    stage.update(state.riverLevelMeters); flood.update(state, 0, 0);
    const admissionSnapshots: unknown[] = [];
    const coverageSnapshots: unknown[] = [], updateMs: number[] = [];
    for (let step = 1; step <= 901 && state.phase === "disaster"; step++) {
      state = advanceFloodSimulation(state, [], 0.1);
      stage.update(state.riverLevelMeters);
      const started = performance.now(); flood.update(state, 0.1, step / 10); updateMs.push(performance.now() - started);
      if (step === 800 || state.phase === "result") admissionSnapshots.push({ elapsed: state.disasterElapsedSeconds,
        candidates: state.overflowSites.filter(s => s.primaryHazard === "overtopping" || s.primaryHazard === "erosion").slice(0, 24).map(site => {
          const b = resolve(site); return { id: site.id, ...(b ? admission(b) : { firstFailure: "no-boundary" }) };
        }) });
      if (step === 800 || state.phase === "result") {
        flood.group.updateMatrixWorld(true);
        const mesh = flood.group.children[0] as THREE.Mesh;
        mesh.geometry.computeBoundingSphere();
        const coverage = flood.getRenderedPatches().map(patch => {
          const b = emittedBoundaries.get(patch.id)!;
          const points = [0.5, 1, 2].map(inland => {
            const x = b.anchor.x + b.inland.x * inland, z = b.anchor.z + b.inland.z * inland;
            ray.ray.origin.set(x, 10000, z);
            const hit = ray.intersectObject(mesh, false)[0];
            return { inland, hit: Boolean(hit), raw: terrain.sampleGround(x, z), water: hit?.point.y ?? null };
          });
          expect(points.every(p => p.hit), `${patch.id} must have actual bank-attached wet geometry at ${state.disasterElapsedSeconds}s`).toBe(true);
          const lateralCoverage: { lateral: number; inland: number; hit: boolean }[] = [];
          if (patch.id === "bank-26") {
            const length = Math.hypot(b.right.x - b.left.x, b.right.z - b.left.z);
            for (const lateral of [-32, -16, 16, 32]) for (const inland of [0.5, 2, 4, 6]) {
              const x = b.anchor.x + (b.right.x - b.left.x) / length * lateral + b.inland.x * inland;
              const z = b.anchor.z + (b.right.z - b.left.z) / length * lateral + b.inland.z * inland;
              expect(b.isLand(x, z)).toBe(true);
              ray.ray.origin.set(x, 10000, z);
              const hit = ray.intersectObject(mesh, false)[0];
              expect(hit, `bank-26 old empty band at lateral=${lateral}, inland=${inland}, time=${state.disasterElapsedSeconds}`).toBeDefined();
              lateralCoverage.push({ lateral, inland, hit: Boolean(hit) });
            }
          }
          return { id: patch.id, vertexCount: patch.vertexCount, points, lateralCoverage };
        });
        expect(coverage.length).toBeGreaterThanOrEqual(3);
        coverageSnapshots.push({ elapsed: state.disasterElapsedSeconds, coverage, vertices: mesh.geometry.drawRange.count });
      }
    }
    expect(state.phase).toBe("result");
    const patches = flood.getRenderedPatches(), geometry = (flood.group.children[0] as THREE.Mesh).geometry;
    expect(patches.length).toBeGreaterThan(0);
    expect(patches.reduce((sum, p) => sum + p.vertexCount, 0)).toBe(geometry.drawRange.count);
    const positions = geometry.getAttribute("position");
    flood.group.updateMatrixWorld(true);
    const report: unknown[] = [];
    let start = 0;
    for (const patch of patches) {
      const boundary = emittedBoundaries.get(patch.id)!;
      const edge = boundary.edge ?? [boundary.left, boundary.right];
      // Source-connected cells are integrated in the mesh; there is no tail connector range.
      const nearBankPoints: Point[] = [], cellPoints: Point[] = [];
      let nearBankVertices = 0;
      const length = Math.hypot(boundary.right.x - boundary.left.x, boundary.right.z - boundary.left.z);
      const tx = (boundary.right.x - boundary.left.x) / length, tz = (boundary.right.z - boundary.left.z) / length;
      let minLateral = Infinity, maxLateral = -Infinity, minInland = Infinity, maxInland = -Infinity;
      for (let i = start; i < start + patch.vertexCount; i += 3) {
        let maxTriangleInland = -Infinity;
        for (let k = 0; k < 3; k++) {
          const dx = positions.getX(i + k) - boundary.anchor.x, dz = positions.getZ(i + k) - boundary.anchor.z;
          const inland = dx * boundary.inland.x + dz * boundary.inland.z, lateral = dx * tx + dz * tz;
          minLateral = Math.min(minLateral, lateral); maxLateral = Math.max(maxLateral, lateral);
          minInland = Math.min(minInland, inland); maxInland = Math.max(maxInland, inland);
          maxTriangleInland = Math.max(maxTriangleInland, inland);
        }
        const points = denseTriangles(positions, i, 3);
        if (maxTriangleInland <= 8.001) { nearBankPoints.push(...points); nearBankVertices += 3; }
        else cellPoints.push(...points);
      }
      const connector = inspect(nearBankPoints), cells = inspect(cellPoints);
      let uncoveredLandBelowHead = 0, stripSamples = 0;
      const stripExamples: unknown[] = [];
      for (let lateral = minLateral; lateral <= maxLateral; lateral += 4) for (const inland of [0.5, 2, 4, 6]) {
        const x = boundary.anchor.x + tx * lateral + boundary.inland.x * inland;
        const z = boundary.anchor.z + tz * lateral + boundary.inland.z * inland;
        if (!boundary.isLand(x, z)) continue;
        const raw = terrain.sampleGround(x, z), head = Math.min(...edge.map(p => p.y));
        if (raw === null) continue;
        stripSamples++;
        ray.ray.origin.set(x, 10000, z);
        if (!ray.intersectObject(flood.group.children[0]!, false).length && raw + 0.22 < head) {
          uncoveredLandBelowHead++;
          if (stripExamples.length < 3) stripExamples.push({ lateral, inland, x, z, raw, head });
        }
      }
      // Actual emitted corners at the receiving cell edge, not invented out-of-bank offsets.
      const inletCorners = [boundary.left, boundary.right];
      const waterRay = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
      let maxSeamDelta = 0, seamMisses = 0;
      const missProbeRecoveries = [0.0001, 0.001, 0.01, 0.1, 1].map(meters => ({ meters, recovered: 0 }));
      for (let i = 1; i < edge.length; i++) {
        const a = edge[i - 1]!, b = edge[i]!;
        const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25));
        for (let j = 0; j <= count; j++) {
          const t = j / count, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          waterRay.ray.origin.set(x, 10000, z);
          const hit = waterRay.intersectObjects(world.waterMeshes.filter(m => m.userData.riverStageEligible === true), false)[0];
          if (!hit) {
            seamMisses++;
            // Diagnostic inward probes only: no shoreline/production geometry is moved.
            for (const probe of missProbeRecoveries) {
              waterRay.ray.origin.set(x - boundary.inland.x * probe.meters, 10000, z - boundary.inland.z * probe.meters);
              if (waterRay.intersectObjects(world.waterMeshes.filter(m => m.userData.riverStageEligible === true), false).length) probe.recovered++;
            }
            continue;
          }
          maxSeamDelta = Math.max(maxSeamDelta, Math.abs(hit.point.y - (a.y + (b.y - a.y) * t)));
        }
      }
      report.push({ siteId: patch.id, sourceId: boundary.sourceId, sourceSegment: boundary.segmentIndex,
        bounds: patch.bounds, areaM2: round(patch.areaM2 ?? 0), vertexCount: patch.vertexCount, nearBankVertices,
        connector, cells, gridShape: { resolutionMeters: 4, minLateral, maxLateral, minInland, maxInland,
          bankFacingHalfCellBand: { stripSamples, uncoveredLandBelowHead, stripExamples } },
        actualInletCorners: inspect(inletCorners), seam: { maxVerticalDelta: round(maxSeamDelta), rayMissesOnExactSourceEdge: seamMisses, missProbeRecoveries } });
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
    console.info("LEGACY_16M_ADMISSION_SUMMARY", JSON.stringify(admissionSnapshots.map(snapshot => {
      const s = snapshot as { elapsed: number; candidates: ({ id: string } & ReturnType<typeof admission>)[] };
      return { elapsed: s.elapsed, candidates: s.candidates.map(c => ({ id: c.id, source: c.sourceId,
        firstFailure: c.firstFailure, head: c.head, bed: c.bed, headMinusBed: typeof c.bed === "number" ? c.head - c.bed : null,
        gridFailures: c.gridFailures?.length, throatFailures: c.throatFailureCount })) };
    })));
    updateMs.sort((a, b) => a - b);
    const costs = { ...flood.group.userData.floodGrid, updates: updateMs.length,
      updateMeanMs: updateMs.reduce((a, b) => a + b, 0) / updateMs.length,
      updateP95Ms: updateMs[Math.floor(updateMs.length * 0.95)], updateMaxMs: updateMs.at(-1),
      usedVertices: geometry.drawRange.count, usedGeometryBytes: geometry.drawRange.count * 3 * 4 * 2 };
    console.info("SUBCELL_COVERAGE_COSTS", JSON.stringify({ costs, coverageSnapshots }));
    console.info("FLOOD_TERRAIN_DIAGNOSTIC", JSON.stringify({
      thresholds: { buriedMeters: 0.02, existingRawSafetyClearanceMeters: 0.22, denseTriangleSpacingMeters: 0.5, sourceSeamSpacingMeters: 0.25 },
      elapsed: state.disasterElapsedSeconds, damagePercent: state.damagePercent, riverLevel: state.riverLevelMeters,
      selectedPatch: selectRenderedFloodPatch(patches)?.id, patches: report, candidateCorners, legacyAdmissionSnapshots: admissionSnapshots, costs, coverageSnapshots,
    }, null, 2));
  } finally {
    flood.dispose(); disposeDioramaObject(world); disposeDioramaObject(terrain.group); disposeDioramaObject(landcover.group);
  }
}, 120_000);
