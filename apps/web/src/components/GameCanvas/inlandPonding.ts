import * as THREE from "three";
import type { FloodSimulationState, OverflowSite } from "../../features/disaster/services/floodSimulation";
import { geoToWorld } from "./dioramaSpace";
import type { RenderedTerrainSurface } from "./geographicTerrain";
import { inlandTerrainTriangles } from "./inlandTerrainTriangles";
import { createInlandWaterMaterial } from "./inlandWaterMaterial";

export type InlandBounds = { minX: number; minZ: number; maxX: number; maxZ: number };
type Bounds = InlandBounds;
type State = Pick<FloodSimulationState, "disasterElapsedSeconds" | "overflowSites" | "floodDepthMeters"> & { phase: string };
/** wet/dry refer to this educational visual field, never observed demand. */
export type InlandSample = { status: "wet" | "dry" | "unknown" | "outside"; depthMeters: number | null };
const N = 32, CELL = 4, LIMIT = 4, WET = 0.04, LIFT = 0.035;
const RETIRE_PRESSURE = 0.005;
const CAPACITY = N * N * 24;
type Field = {
  source: Readonly<OverflowSite>; x: number; z: number; seedY: number;
  nodes: Float64Array; centers: Float64Array; valid: Uint8Array; connected: Uint8Array;
  queue: Int32Array; ranges: Int32Array; pressure: number;
  facets?: (Float64Array | null)[];
  geometry: THREE.BufferGeometry; positions: THREE.BufferAttribute; appearance: THREE.BufferAttribute; mesh: THREE.Mesh;
};

/** Educational pressure illustration, NOT a storage/flow solver or measured flood.
 * Four source-centred 128m squares maximum, 4m DEM cells, one draw per source.
 * Constant-head connected contours express pressure over real terrain. No river
 * inlet, synthetic bed, pump sink, scoring feedback or source relocation exists.
 * Every entire 4m cell must be certified dry by the footprint mask, including
 * thin waterways between point samples. Unknown/candidate-cap failures exclude it.
 * Terrain validity additionally checks corners, edge midpoints and centre.
 * A site's 128m domain deliberately truncates spread; area is NOT predicted damage.
 * Feed immutable geography for the lifetime; recreate after terrain/mask changes.
 */
export function createInlandPonding(options: {
  bounds: Bounds;
  /** Validate raw DEM coverage first, then return actual rendered terrain Y.
   * Example: raw(x,z) === null ? null : rendered(x,z). Never substitute raw Y
   * for a missing rendered triangle: its surface can differ by > the water lift.
   */
  sampleGround: (x: number, z: number) => number | null;
  /** Supply the real mesh grid in production to clip at its triangle boundaries. */
  renderedSurface?: RenderedTerrainSurface;
  /** Mandatory actual water mask; only positively known dry land is eligible. */
  classifyWater: (x: number, z: number) => "water" | "dry" | "unknown";
  /** Full closed local-XZ rectangle query, not another set of point samples.
   * Called once per in-bounds cell at setup; no fallback when unavailable.
   */
  classifyFootprint: (minX: number, minZ: number, maxX: number, maxZ: number) => "water" | "dry" | "unknown";
}) {
  const group = new THREE.Group();
  if (!Object.values(options.bounds).every(Number.isFinite) || options.bounds.minX >= options.bounds.maxX ||
    options.bounds.minZ >= options.bounds.maxZ) throw new Error("Invalid inland ponding bounds");
  group.name = "educational-inland-ponding";
  group.userData.provenance = { source: "existing inlandPonding pressure + DEM", surveyedFlood: false,
    assumptions: "bounded constant-head connected contours; 3s response, 12s recession; not pump physics",
    cellMeters: CELL, terrainValiditySampleMeters: 2, waterExclusion: "entire-cell footprint",
    terrainSurface: "raw-DEM-valid actual rendered surface", sourceDomainMeters: N * CELL };
  const material = createInlandWaterMaterial();
  const fields = new Map<string, Field>();
  let previous: number | undefined, pending = 0, disposed = false;
  const rejected = new Set<string>();
  const stats = { sites: 0, wetCells: 0, areaM2: 0, triangles: 0, drawCalls: 0,
    rejectedSites: 0, maxSites: LIMIT, maxCells: LIMIT * N * N,
    maxVertices: LIMIT * N * N * (options.renderedSurface ? 40 * 6 : 24), allocatedVertices: 0 };
  const inside = (x: number, z: number) => x >= options.bounds.minX && x <= options.bounds.maxX &&
    z >= options.bounds.minZ && z <= options.bounds.maxZ;
  function ground(x: number, z: number) {
    if (!inside(x, z) || options.classifyWater(x, z) !== "dry") return NaN;
    const y = options.sampleGround(x, z);
    return y !== null && Number.isFinite(y) ? y : NaN;
  }
  function clear() {
    for (const f of fields.values()) { f.geometry.dispose(); group.remove(f.mesh); }
    fields.clear(); rejected.clear(); previous = undefined; pending = 0;
    Object.assign(stats, { sites: 0, wetCells: 0, areaM2: 0, triangles: 0, drawCalls: 0, rejectedSites: 0, allocatedVertices: 0 });
  }
  function create(source: OverflowSite): Field | null {
    const origin = geoToWorld(source.longitude, source.latitude), seedY = ground(origin.x, origin.z);
    if (!Number.isFinite(seedY)) return null;
    // Seed is the exact centre of cell (16,16), not a nearest valid-cell search.
    const x = origin.x - (N / 2 + 0.5) * CELL, z = origin.z - (N / 2 + 0.5) * CELL;
    const nodes = new Float64Array((N + 1) ** 2), centers = new Float64Array(N * N);
    const valid = new Uint8Array(N * N);
    const facets = options.renderedSurface ? Array<Float64Array | null>(N * N).fill(null) : undefined;
    let capacity = facets ? 0 : CAPACITY;
    for (let r = 0; r <= N; r++) for (let c = 0; c <= N; c++) nodes[r * (N + 1) + c] = ground(x + c * CELL, z + r * CELL);
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const i = r * N + c, a = r * (N + 1) + c;
      const minX = x + c * CELL, minZ = z + r * CELL;
      centers[i] = NaN;
      if (!inside(minX, minZ) || !inside(minX + CELL, minZ + CELL) ||
        options.classifyFootprint(minX, minZ, minX + CELL, minZ + CELL) !== "dry") continue;
      centers[i] = ground(x + (c + 0.5) * CELL, z + (r + 0.5) * CELL);
      valid[i] = Number.isFinite(centers[i]) && [nodes[a], nodes[a + 1], nodes[a + N + 1], nodes[a + N + 2],
        ground(x + (c + 0.5) * CELL, z + r * CELL), ground(x + (c + 0.5) * CELL, z + (r + 1) * CELL),
        ground(x + c * CELL, z + (r + 0.5) * CELL), ground(x + (c + 1) * CELL, z + (r + 0.5) * CELL)].every(Number.isFinite) ? 1 : 0;
      if (valid[i] && facets) {
        facets[i] = inlandTerrainTriangles(options.renderedSurface!, minX, minZ, minX + CELL, minZ + CELL, options.sampleGround);
        if (!facets[i]?.length) valid[i] = 0;
        else capacity += facets[i]!.length / 9 * 6;
      }
    }
    if (!valid[N / 2 * N + N / 2]) return null;
    const geometry = new THREE.BufferGeometry();
    const positions = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3);
    const appearance = new THREE.BufferAttribute(new Float32Array(capacity * 2), 2);
    appearance.setUsage(THREE.DynamicDrawUsage); geometry.setAttribute("inlandAppearance", appearance);
    stats.allocatedVertices += capacity;
    positions.setUsage(THREE.DynamicDrawUsage); geometry.setAttribute("position", positions); geometry.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; mesh.visible = false;
    mesh.userData.source = Object.freeze({ id: source.id, longitude: source.longitude, latitude: source.latitude,
      primaryHazard: "inlandPonding", surveyedFlood: false });
    group.add(mesh);
    return { source: Object.freeze({ ...source }), x, z, seedY, nodes, centers, valid, facets,
      connected: new Uint8Array(N * N), queue: new Int32Array(N * N), ranges: new Int32Array(N * N * 2),
      pressure: 0, geometry, positions, appearance, mesh };
  }
  function rebuild(f: Field) {
    const head = f.seedY + f.pressure, cutoff = head - WET;
    f.connected.fill(0); f.ranges.fill(0);
    let tail = 0, vertex = 0;
    const seed = N / 2 * N + N / 2;
    if (f.pressure > WET) { f.connected[seed] = 1; f.queue[tail++] = seed; }
    for (let k = 0; k < tail; k++) {
      const i = f.queue[k]!, r = Math.floor(i / N), c = i % N, a = r * (N + 1) + c;
      const visit = (j: number, edgeA: number, edgeB: number) => {
        if (f.valid[j] && !f.connected[j] && f.centers[j]! < cutoff &&
          Math.min(f.nodes[edgeA]!, f.nodes[edgeB]!) < cutoff) { f.connected[j] = 1; f.queue[tail++] = j; }
      };
      if (c > 0) visit(i - 1, a, a + N + 1);
      if (c < N - 1) visit(i + 1, a + 1, a + N + 2);
      if (r > 0) visit(i - N, a, a + 1);
      if (r < N - 1) visit(i + N, a + N + 1, a + N + 2);
    }
    type Point = { x: number; z: number; y: number };
    function triangle(a: Point, b: Point, c: Point) {
      const input = [a, b, c], clipped: Point[] = [];
      for (let k = 0; k < 3; k++) {
        const p = input[k]!, q = input[(k + 1) % 3]!;
        if (p.y < cutoff) clipped.push(p);
        if ((p.y < cutoff) !== (q.y < cutoff)) {
          const t = (cutoff - p.y) / (q.y - p.y);
          clipped.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t, y: cutoff });
        }
      }
      for (let k = 1; k + 1 < clipped.length; k++) {
        const p = clipped[0]!, q = clipped[k]!, s = clipped[k + 1]!;
        stats.areaM2 += Math.abs((q.x - p.x) * (s.z - p.z) - (s.x - p.x) * (q.z - p.z)) / 2;
        for (const v of [p, q, s]) {
          f.positions.setXYZ(vertex, v.x, head + LIFT, v.z);
          const edgeDistance = Math.min(v.x - f.x, f.x + N * CELL - v.x, v.z - f.z, f.z + N * CELL - v.z);
          f.appearance.setXY(vertex, Math.max(0, head - v.y), THREE.MathUtils.clamp(edgeDistance / 16, 0, 1));
          vertex++;
        }
      }
    }
    for (let k = 0; k < tail; k++) {
      const i = f.queue[k]!, r = Math.floor(i / N), c = i % N, a = r * (N + 1) + c;
      if (f.facets) {
        const vertices = f.facets[i]!;
        f.ranges[i * 2] = vertex;
        for (let v = 0; v < vertices.length; v += 9) triangle(
          { x: vertices[v]!, y: vertices[v + 1]!, z: vertices[v + 2]! },
          { x: vertices[v + 3]!, y: vertices[v + 4]!, z: vertices[v + 5]! },
          { x: vertices[v + 6]!, y: vertices[v + 7]!, z: vertices[v + 8]! });
        f.ranges[i * 2 + 1] = vertex;
        continue;
      }
      const x = f.x + c * CELL, z = f.z + r * CELL;
      const corners = [{ x, z, y: f.nodes[a]! }, { x: x + CELL, z, y: f.nodes[a + 1]! },
        { x: x + CELL, z: z + CELL, y: f.nodes[a + N + 2]! }, { x, z: z + CELL, y: f.nodes[a + N + 1]! }];
      const center = { x: x + CELL / 2, z: z + CELL / 2, y: f.centers[i]! };
      f.ranges[i * 2] = vertex;
      for (let j = 0; j < 4; j++) triangle(center, corners[j]!, corners[(j + 1) % 4]!);
      f.ranges[i * 2 + 1] = vertex;
    }
    f.geometry.setDrawRange(0, vertex); f.positions.needsUpdate = true; f.appearance.needsUpdate = true; f.mesh.visible = vertex > 0;
    stats.wetCells += tail; stats.triangles += vertex / 3; stats.drawCalls += vertex ? 1 : 0;
  }
  return {
    group, stats,
    update(state: State) {
      if (disposed) return;
      const elapsed = state.disasterElapsedSeconds;
      if (!["disaster", "result", "review"].includes(state.phase) || !Number.isFinite(elapsed) || elapsed < 0) { clear(); return; }
      if (previous !== undefined && elapsed < previous) clear();
      const delta = previous === undefined ? 0 : elapsed - previous;
      previous = elapsed;
      if (state.phase !== "disaster" || delta === 0) return;
      pending += delta;
      if (pending + 1e-9 < 0.1) return;
      const dt = pending; pending = 0;
      const active = new Map<string, number>();
      for (const site of state.overflowSites.slice(0, 24)) {
        if (site.primaryHazard !== "inlandPonding" || !Number.isFinite(site.intensity) || site.intensity <= 0 ||
          !Number.isFinite(site.longitude) || !Number.isFinite(site.latitude)) continue;
        let f = fields.get(site.id);
        if (!f && fields.size < LIMIT && !rejected.has(site.id)) {
          f = create(site) ?? undefined;
          if (f) fields.set(site.id, f);
          else { stats.rejectedSites++; if (rejected.size < 24) rejected.add(site.id); }
        }
        if (!f || f.source.longitude !== site.longitude || f.source.latitude !== site.latitude) continue;
        active.set(site.id, Math.min(1, site.intensity));
      }
      Object.assign(stats, { sites: fields.size, wetCells: 0, areaM2: 0, triangles: 0, drawCalls: 0 });
      const depth = Number.isFinite(state.floodDepthMeters) ? Math.max(0, Math.min(2, state.floodDepthMeters)) : 0;
      for (const [id, f] of fields) {
        const intensity = active.get(id) ?? 0;
        const target = intensity * (0.25 + depth);
        // Missing source means pressure no longer supplied, NOT measured dry/no demand.
        // Retain the DEM/cache and recede smoothly; pause/result never advance it.
        f.pressure += (target - f.pressure) * (1 - Math.exp(-dt / (target > f.pressure ? 3 : 12)));
        rebuild(f);
        // Only fully receded, absent sources relinquish their slot. This is
        // visual-cache retirement, NOT a conclusion that local demand is zero.
        // A new source can take the free slot on the next bounded update.
        if (!active.has(id) && f.pressure < RETIRE_PRESSURE && f.geometry.drawRange.count === 0) {
          stats.allocatedVertices -= f.positions.count;
          f.geometry.dispose(); group.remove(f.mesh); fields.delete(id);
        }
      }
      stats.sites = fields.size;
    },
    sample(x: number, z: number): InlandSample {
      if (!Number.isFinite(x) || !Number.isFinite(z) || !inside(x, z)) return { status: "outside", depthMeters: null };
      if (!Number.isFinite(ground(x, z))) return { status: "unknown", depthMeters: null };
      let known = false;
      for (const f of fields.values()) {
        const c = Math.floor((x - f.x) / CELL), r = Math.floor((z - f.z) / CELL);
        if (c < 0 || c >= N || r < 0 || r >= N) continue;
        const i = r * N + c;
        if (!f.valid[i]) continue;
        known = true;
        for (let v = f.ranges[i * 2]!; v < f.ranges[i * 2 + 1]!; v += 3) {
          const p = f.positions;
          const ax = p.getX(v), az = p.getZ(v), bx = p.getX(v + 1), bz = p.getZ(v + 1), cx = p.getX(v + 2), cz = p.getZ(v + 2);
          const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
          if (Math.abs(det) < 1e-10) continue;
          const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
          const w = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
          if (u >= -1e-6 && w >= -1e-6 && u + w <= 1 + 1e-6) {
            const y = ground(x, z);
            if (!Number.isFinite(y)) return { status: "unknown", depthMeters: null };
            return { status: "wet", depthMeters: Math.max(0, f.seedY + f.pressure - y) };
          }
        }
      }
      return { status: known ? "dry" : "unknown", depthMeters: known ? 0 : null };
    },
    dispose() { if (!disposed) { clear(); material.dispose(); group.removeFromParent(); disposed = true; } },
  };
}
