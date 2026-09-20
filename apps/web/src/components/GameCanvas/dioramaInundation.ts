import * as THREE from "three";
import type { FloodSimulationState } from "../../features/disaster/services/floodSimulation";
import type { InundationSeed } from "../../features/disaster/services/inundationField";
import {
  getCandidateBankElevationMeters,
  listOverflowCandidates,
} from "../../features/disaster/services/overflowBankSites";
import { geoToWorld, groundY, worldToGeo } from "./dioramaSpace";
import type { BankSurfacePoint, RiverBoundary, RiverBoundaryResolver, SurfaceSampler } from "./riverBoundary";
import { MAX_RIVER_EDGE_POINTS } from "./riverBoundary";

export type FloodPoint = Readonly<{ x: number; y: number; z: number }>;
export type RenderedFloodPatch = Readonly<{
  id: string;
  vertexCount: number;
  /** Area of emitted triangles, not a damage or forecast metric. */
  areaM2?: number;
  anchor: FloodPoint;
  bounds: Readonly<{ minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }>;
}>;
const NO_PATCHES: readonly RenderedFloodPatch[] = Object.freeze([]);

export type DioramaInundation = {
  group: THREE.Group;
  object3D: THREE.Group;
  /** Immutable geometry-upload snapshot, in the same local metre space as group. */
  getRenderedPatches: () => readonly RenderedFloodPatch[];
  /** Seconds. dt is compatibility-only; simulation elapsed drives water, time throttles uploads. */
  update: (
    state: Pick<
      FloodSimulationState,
      "disasterElapsedSeconds" | "overflowMeters" | "floodDepthMeters" | "overflowSites"
    > & { phase: string },
    dt: number,
    time: number,
  ) => void;
  dispose: () => void;
};

const CELL = 16;
const COLS = 14;
const ROWS = 12;
const WET = 0.04;
const STEP = 0.1;
// At most one simulated second per snapshot; discard older unseen history rather
// than inventing its changing breach/depth inputs or draining a backlog while paused.
const MAX_CATCHUP_STEPS = 10;
const MAX_SITES = 24;
const LAT_METERS = 110_540;
const INLET_COL = Math.floor(COLS / 2);
const SURFACE_LIFT = 0.18;

type Grid = {
  seed: InundationSeed;
  longitude: number;
  latitude: number;
  ground: Float32Array;
  depth: Float32Array;
  next: Float32Array;
  boundary?: RiverBoundary;
};

/**
 * Isolated cell-level adaptation of inundationField.ts's educational height field.
 * That module exposes only angle-sorted rings (which can bridge dry cells) and sparse
 * flow samples, and owns a global grid. Keeping the same 16 m grid/injection/flux
 * here avoids both invented wet polygons and resets affecting a Cesium viewer.
 * With a boundary resolver, the grid instead starts at a source-bank inlet and
 * uses sampled ground plus a fixed-head river reservoir. Failed resolution never
 * falls back to an inland seed. Both modes illustrate propagation, not measured
 * discharge, building damage, surveyed levee failure or real flood forecasts.
 */
export function createDioramaInundation(sampleGround: SurfaceSampler = groundY, resolveBoundary?: RiverBoundaryResolver): DioramaInundation {
  const group = new THREE.Group();
  group.name = "diorama-inundation";
  group.visible = false;
  const grids = new Map<string, Grid>();
  // One reusable buffer/draw call, bounded independently of frame rate and site count.
  const capacity = MAX_SITES * (COLS * ROWS * 12 + (MAX_RIVER_EDGE_POINTS - 1) * 6) * 3;
  const positions = new THREE.BufferAttribute(new Float32Array(capacity), 3);
  const colors = new THREE.BufferAttribute(new Float32Array(capacity), 3);
  positions.setUsage(THREE.DynamicDrawUsage);
  colors.setUsage(THREE.DynamicDrawUsage);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", positions);
  geometry.setAttribute("color", colors);
  geometry.setDrawRange(0, 0);
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "inundation-wet-cells";
  // Fixed-size buffers contain unused vertices; do not use their bounds for culling.
  mesh.frustumCulled = false;
  group.add(mesh);
  const shallow = new THREE.Color("#65edfa");
  const deep = new THREE.Color("#009fc9");
  const color = new THREE.Color();
  let accumulator = 0;
  let previousElapsed: number | undefined;
  let lastGeometryTime = -Infinity;
  let geometryDirty = false;
  let disposed = false;
  let renderedPatches: readonly RenderedFloodPatch[] = NO_PATCHES;

  function reset(): void {
    grids.clear();
    accumulator = 0;
    geometryDirty = false;
    lastGeometryTime = -Infinity;
    geometry.setDrawRange(0, 0);
    group.visible = false;
    renderedPatches = NO_PATCHES;
  }

  function rebuild(): void {
    let vertex = 0;
    const patches: RenderedFloodPatch[] = [];
    for (const grid of grids.values()) {
      if (grid.boundary && (!validConnection(grid, sampleGround) || grid.depth[INLET_COL]! < WET)) continue;
      const vertexStart = vertex;
      const connected = grid.boundary ? connectedWetCells(grid) : undefined;
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const depth = grid.depth[row * COLS + col]!;
          if (depth < WET || (connected && !connected[row * COLS + col])) continue;
          // Render cell footprints, never a hull enclosing unwetted neighbors.
          const samples = [
            { col, row, depth, surfaceY: grid.boundary ? grid.ground[row * COLS + col]! + depth : undefined },
            ...[
              [-0.5, -0.5],
              [0.5, -0.5],
              [0.5, 0.5],
              [-0.5, 0.5],
            ].map(([dc, dr]) => shoreCorner(grid, col + dc!, row + dr!)),
          ].map((sample) => {
            const p = point(grid, sample.col, sample.row);
            return { ...geoToWorld(p.longitude, p.latitude), depth: sample.depth, surfaceY: sample.surfaceY };
          });
          const ground = samples.map(p => sampleGround(p.x, p.z));
          if (ground.some(y => y === null || !Number.isFinite(y))) continue;
          // Shared shoreline corners soften the staircase without extending
          // into dry cells. The center retains the field's actual cell depth.
          for (const index of [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1]) {
            const p = samples[index]!;
            color.copy(shallow).lerp(deep, Math.min(1, p.depth / 1.5));
            // Ground-conforming educational surface: depth is meters, no circular
            // effects or artificially expanded footprint. Lift clears road decals.
            positions.setXYZ(vertex, p.x, p.surfaceY ?? ground[index]! + SURFACE_LIFT + p.depth, p.z);
            colors.setXYZ(vertex, color.r, color.g, color.b);
            vertex++;
          }
        }
      }
      if (grid.boundary) {
        // Same inlet edge vertices/heights as row zero, not a separate visual gap patch.
        for (const p of connectorTriangles(grid)) {
          color.copy(shallow).lerp(deep, Math.min(1, grid.depth[INLET_COL]! / 1.5));
          positions.setXYZ(vertex, p.x, p.y, p.z);
          colors.setXYZ(vertex++, color.r, color.g, color.b);
        }
      }
      const patch = renderedPatch(positions, vertexStart, vertex - vertexStart, grid.seed.id);
      if (patch) patches.push(patch);
    }
    geometry.setDrawRange(0, vertex);
    positions.clearUpdateRanges();
    colors.clearUpdateRanges();
    if (vertex > 0) {
      positions.addUpdateRange(0, vertex * 3);
      colors.addUpdateRange(0, vertex * 3);
      positions.needsUpdate = true;
      colors.needsUpdate = true;
    }
    group.visible = vertex > 0;
    renderedPatches = Object.freeze(patches);
  }

  return {
    group,
    object3D: group,
    getRenderedPatches: () => !disposed && group.visible && mesh.visible && geometry.drawRange.count > 0 ? renderedPatches : NO_PATCHES,
    update(state, dt, time) {
      if (disposed) return;
      void dt;
      const elapsed = state.disasterElapsedSeconds;
      if (!Number.isFinite(elapsed) || elapsed < 0 || !Number.isFinite(time)) { reset(); return; }
      const rewound = previousElapsed !== undefined && elapsed < previousElapsed;
      const delta = previousElapsed === undefined || rewound ? 0 : elapsed - previousElapsed;
      if (rewound) reset();
      previousElapsed = elapsed;
      // A renderer clock restarting does not reset the authoritative field.
      if (time < lastGeometryTime) lastGeometryTime = -Infinity;
      const eligiblePhase = ["disaster", "result", "review"].includes(state.phase);
      const hasWater =
        Number.isFinite(state.overflowMeters) &&
        Number.isFinite(state.floodDepthMeters) &&
        (state.overflowMeters > 0 || state.floodDepthMeters > 0);
      const sites = state.overflowSites
        .filter(
          (site) =>
            (site.primaryHazard === "overtopping" || site.primaryHazard === "erosion") &&
            Number.isFinite(site.intensity) &&
            site.intensity > 0 &&
            Number.isFinite(site.longitude) &&
            Number.isFinite(site.latitude) &&
            Math.abs(site.latitude) < 85 &&
            Number.isFinite(site.outflowHeadingDegrees),
        )
        .slice(0, MAX_SITES);
      if (!eligiblePhase || !hasWater || sites.length === 0) {
        reset();
        return;
      }
      const activeIds = new Set(sites.map((site) => site.id));
      let removed = false;
      for (const id of grids.keys()) {
        if (!activeIds.has(id)) {
          grids.delete(id);
          removed = true;
        }
      }
      // Removal bypasses upload throttling without hiding unrelated valid patches.
      if (removed) geometryDirty = true;
      // Freeze the final footprint during result/review. Do not keep injecting water.
      if (state.phase !== "disaster") {
        if (removed) { rebuild(); geometryDirty = false; lastGeometryTime = time; }
        return;
      }
      accumulator += Math.min(delta, STEP * MAX_CATCHUP_STEPS);
      const steps = Math.min(MAX_CATCHUP_STEPS, Math.floor((accumulator + 1e-9) / STEP));
      accumulator = Math.max(0, accumulator - steps * STEP);
      if (steps > 0) {
        const candidates = listOverflowCandidates();
        for (const site of sites) {
          const candidate = candidates.find((item) => item.id === site.id);
          const seed: InundationSeed = {
            ...site,
            intensity: Math.min(1, site.intensity),
            bankElevationMeters: candidate ? getCandidateBankElevationMeters(candidate) : 19,
          };
          let grid = grids.get(seed.id);
          const boundary = resolveBoundary?.(site);
          // An explicitly supplied resolver failing is NOT permission for a remote seed.
          if (resolveBoundary && !boundary) { removed = grids.delete(seed.id) || removed; continue; }
          if (
            !grid ||
            grid.seed.longitude !== seed.longitude ||
            grid.seed.latitude !== seed.latitude ||
            grid.seed.outflowHeadingDegrees !== seed.outflowHeadingDegrees ||
            (boundary && (!grid.boundary || boundary.sourceId !== grid.boundary.sourceId ||
              boundary.segmentIndex !== grid.boundary.segmentIndex || boundary.polygonIndex !== grid.boundary.polygonIndex ||
              boundary.anchor.x !== grid.boundary.anchor.x || boundary.anchor.z !== grid.boundary.anchor.z ||
              boundary.inland.x !== grid.boundary.inland.x || boundary.inland.z !== grid.boundary.inland.z ||
              boundary.left.x !== grid.boundary.left.x || boundary.left.z !== grid.boundary.left.z ||
              boundary.right.x !== grid.boundary.right.x || boundary.right.z !== grid.boundary.right.z))
          ) {
            grid = createGrid(seed);
            if (boundary) {
              grid.boundary = boundary;
              // Terrain/source footprint are immutable for this grid frame;
              // cache bed/masks once, while checking the live throat each update.
              sampleConnectedGround(grid, sampleGround);
            }
            grids.set(seed.id, grid);
          }
          grid.seed = seed;
          if (boundary) {
            grid.boundary = boundary;
            if (!validConnection(grid, sampleGround)) { removed = grids.delete(seed.id) || removed; continue; }
          }
          for (let step = 0; step < steps; step++) {
            advanceGrid(grid, Math.max(0, state.floodDepthMeters));
          }
        }
        geometryDirty = true;
      }
      if (geometryDirty && (removed || time - lastGeometryTime + 1e-9 >= STEP)) {
        rebuild();
        geometryDirty = false;
        lastGeometryTime = time;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      reset();
      geometry.dispose();
      material.dispose();
      group.removeFromParent();
      group.clear();
    },
  };
}

/** Read only the Float32 vertices actually uploaded, never the unused capacity. */
function renderedPatch(positions: THREE.BufferAttribute, vertexStart: number, vertexCount: number, id: string): RenderedFloodPatch | null {
  if (!vertexCount) return null;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  let surfaceArea = 0, largestArea = 0;
  let anchor: FloodPoint | undefined;
  for (let i = vertexStart; i < vertexStart + vertexCount; i += 3) {
    const ax = positions.getX(i), ay = positions.getY(i), az = positions.getZ(i);
    const bx = positions.getX(i + 1), by = positions.getY(i + 1), bz = positions.getZ(i + 1);
    const cx = positions.getX(i + 2), cy = positions.getY(i + 2), cz = positions.getZ(i + 2);
    if (![ax, ay, az, bx, by, bz, cx, cy, cz].every(Number.isFinite)) return null;
    min.x = Math.min(min.x, ax, bx, cx); max.x = Math.max(max.x, ax, bx, cx);
    min.y = Math.min(min.y, ay, by, cy); max.y = Math.max(max.y, ay, by, cy);
    min.z = Math.min(min.z, az, bz, cz); max.z = Math.max(max.z, az, bz, cz);
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    surfaceArea += area;
    if (area > largestArea) {
      largestArea = area;
      anchor = { x: (ax + bx + cx) / 3, y: (ay + by + cy) / 3, z: (az + bz + cz) / 3 };
    }
  }
  if (!anchor || !Number.isFinite(surfaceArea)) return null;
  return Object.freeze({ id, vertexCount, areaM2: surfaceArea,
    anchor: Object.freeze(anchor), bounds: Object.freeze({
      minX: min.x, minY: min.y, minZ: min.z, maxX: max.x, maxY: max.y, maxZ: max.z,
    }) });
}

/** Average only adjacent wet cells. No dry-cell triangles or outward dilation. */
function shoreCorner(grid: Grid, col: number, row: number) {
  let sum = 0;
  let count = 0;
  let columnSum = 0;
  let rowSum = 0;
  let surfaceSum = 0;
  for (const r of [Math.floor(row), Math.ceil(row)]) {
    for (const c of [Math.floor(col), Math.ceil(col)]) {
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
      const depth = grid.depth[r * COLS + c]!;
      if (depth < WET) continue;
      sum += depth;
      count++;
      columnSum += c;
      rowSum += r;
      surfaceSum += grid.ground[r * COLS + c]! + depth;
    }
  }
  const inset = grid.boundary ? 0 : count === 1 ? 0.65 : count === 2 ? 0.25 : count === 3 ? 0.12 : 0;
  return {
    col: count ? col + (columnSum / count - col) * inset : col,
    row: count ? row + (rowSum / count - row) * inset : row,
    depth: count > 0 ? sum / count : 0,
    surfaceY: grid.boundary ? (row === -0.5 && Math.abs(col - INLET_COL) === 0.5
      ? riverHead(grid) : surfaceSum / Math.max(1, count)) : undefined,
  };
}

function createGrid(seed: InundationSeed): Grid {
  const heading = (seed.outflowHeadingDegrees * Math.PI) / 180;
  const latitude = seed.latitude + (Math.cos(heading) * CELL * ROWS * 0.18) / LAT_METERS;
  const longitude =
    seed.longitude +
    (Math.sin(heading) * CELL * ROWS * 0.18) /
      (111_320 * Math.cos((seed.latitude * Math.PI) / 180));
  const ground = new Float32Array(COLS * ROWS);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const inland = (row - (ROWS - 1) * 0.2) * CELL;
      const lateral = (col - (COLS - 1) * 0.5) * CELL;
      const pocket =
        inland > 40 && inland < 220 ? -0.55 * Math.exp(-((inland - 120) ** 2) / (2 * 55 ** 2)) : 0;
      ground[row * COLS + col] =
        seed.bankElevationMeters +
        (seed.bankElevationMeters - 19) * 0.35 +
        (lateral ** 2 / (2 * (CELL * 9) ** 2)) * 3.2 +
        inland * 0.0018 +
        Math.max(0, inland - 180) * 0.0024 +
        pocket;
    }
  }
  return {
    seed,
    longitude,
    latitude,
    ground,
    depth: new Float32Array(COLS * ROWS),
    next: new Float32Array(COLS * ROWS),
  };
}

function point(grid: Grid, col: number, row: number) {
  if (grid.boundary) {
    const p = connectedPoint(grid, col, row);
    return worldToGeo(p.x, p.z);
  }
  const inland = (row - (ROWS - 1) * 0.2) * CELL;
  const lateral = (col - (COLS - 1) * 0.5) * CELL;
  const heading = (grid.seed.outflowHeadingDegrees * Math.PI) / 180;
  return {
    longitude:
      grid.longitude +
      (Math.sin(heading) * inland + Math.cos(heading) * lateral) /
        (111_320 * Math.cos((grid.latitude * Math.PI) / 180)),
    latitude:
      grid.latitude + (Math.cos(heading) * inland - Math.sin(heading) * lateral) / LAT_METERS,
  };
}

function advanceGrid(grid: Grid, floodDepth: number): void {
  const { seed, ground, depth, next } = grid;
  const head = grid.boundary ? riverHead(grid) : 0;
  const heading = (seed.outflowHeadingDegrees * Math.PI) / 180;
  const east =
    (seed.longitude - grid.longitude) * 111_320 * Math.cos((grid.latitude * Math.PI) / 180);
  const north = (seed.latitude - grid.latitude) * LAT_METERS;
  const seedCol = Math.round(
    (east * Math.cos(heading) - north * Math.sin(heading)) / CELL + (COLS - 1) * 0.5,
  );
  const seedRow = Math.round(
    (east * Math.sin(heading) + north * Math.cos(heading)) / CELL + (ROWS - 1) * 0.2,
  );
  const inject = (0.48 * seed.intensity * (0.35 + floodDepth) + floodDepth * 0.08) * STEP;
  if (grid.boundary) {
    // Educational fixed-head river reservoir. No synthetic inland injection and
    // no discharge/volume claim: intensity controls propagation, not source height.
    for (let i = 0; i < depth.length; i++) depth[i] = Math.min(depth[i]!, Math.max(0, head - ground[i]!));
    depth[INLET_COL] = Math.max(0, head - ground[INLET_COL]!);
  } else for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const row = seedRow + dr,
        col = seedCol + dc;
      if (row >= 0 && row < ROWS && col >= 0 && col < COLS) {
        depth[row * COLS + col]! += inject * (dr === 0 && dc === 0 ? 1 : 0.35);
      }
    }
  }
  next.set(depth);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const index = row * COLS + col;
      const h = depth[index]!;
      if (!Number.isFinite(ground[index])) continue;
      if (h < WET * 0.5) continue;
      const neighbors = [
        [col - 1, row],
        [col + 1, row],
        [col, row - 1],
        [col, row + 1],
      ].filter(([c, r]) => c! >= 0 && c! < COLS && r! >= 0 && r! < ROWS && Number.isFinite(ground[r! * COLS + c!]));
      const fluxes = neighbors.map(([c, r]) => {
        const ni = r! * COLS + c!;
        const inland = (r! - (ROWS - 1) * 0.2) * CELL;
        const lateral = (c! - (COLS - 1) * 0.5) * CELL;
        const bias =
          (0.75 + 0.55 * Math.max(0, Math.tanh(inland / 80))) *
          (0.55 + 0.45 / (1 + (Math.abs(lateral) / (CELL * 6)) ** 2));
        return Math.max(
          0,
          Math.min(h * 0.22, (ground[index]! + h - ground[ni]! - depth[ni]!) * 1.55 * bias * STEP * (grid.boundary ? seed.intensity : 1)),
        );
      });
      const outflow = fluxes.reduce((sum, flux) => sum + flux, 0);
      const scale = outflow > h * 0.85 ? (h * 0.85) / outflow : 1;
      neighbors.forEach(([c, r], i) => {
        const flux = fluxes[i]! * scale;
        next[index]! -= flux;
        next[r! * COLS + c!]! += flux;
      });
    }
  }
  const drain = 0.012 * STEP * (1.15 - seed.intensity);
  for (let i = 0; i < depth.length; i++) depth[i] = Math.max(0, next[i]! - drain);
  if (grid.boundary) {
    for (let i = 0; i < depth.length; i++) depth[i] = Math.min(depth[i]!, Math.max(0, head - ground[i]!));
    depth[INLET_COL] = Math.max(0, head - ground[INLET_COL]!);
  }
}

function riverHead(grid: Grid): number {
  const b = grid.boundary!;
  return Math.min(b.left.y, b.right.y, ...(b.edge ?? []).map(p => p.y));
}

function connectedWetCells(grid: Grid): Uint8Array {
  const connected = new Uint8Array(COLS * ROWS), queue = [INLET_COL];
  if (grid.depth[INLET_COL]! < WET) return connected;
  connected[INLET_COL] = 1;
  for (let k = 0; k < queue.length; k++) {
    const i = queue[k]!, col = i % COLS, row = Math.floor(i / COLS);
    for (const [c, r] of [[col - 1, row], [col + 1, row], [col, row - 1], [col, row + 1]]) {
      if (c! < 0 || c! >= COLS || r! < 0 || r! >= ROWS) continue;
      const next = r! * COLS + c!;
      if (!connected[next] && Number.isFinite(grid.ground[next]) && grid.depth[next]! >= WET) {
        connected[next] = 1; queue.push(next);
      }
    }
  }
  return connected;
}

function connectedPoint(grid: Grid, col: number, row: number) {
  const b = grid.boundary!;
  const dx = b.right.x - b.left.x, dz = b.right.z - b.left.z, length = Math.hypot(dx, dz);
  // The half-cell throat and receiving cell share the grid discretization; no
  // centerline/shoreline offset is used to locate the source bank.
  return { x: b.anchor.x + dx / length * (col - INLET_COL) * CELL + b.inland.x * (row + 1) * CELL,
    z: b.anchor.z + dz / length * (col - INLET_COL) * CELL + b.inland.z * (row + 1) * CELL };
}

function sampleConnectedGround(grid: Grid, sample: SurfaceSampler): void {
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    let bed = -Infinity;
    for (const dr of [-0.5, 0, 0.5]) for (const dc of [-0.5, 0, 0.5]) {
      const p = connectedPoint(grid, col + dc, row + dr), y = sample(p.x, p.z);
      if (y === null || !Number.isFinite(y) || !grid.boundary!.isLand(p.x, p.z)) bed = Infinity;
      else bed = Math.max(bed, y + SURFACE_LIFT);
    }
    grid.ground[row * COLS + col] = bed;
  }
}

function connectorTriangles(grid: Grid): BankSurfacePoint[] {
  const b = grid.boundary!, y = riverHead(grid);
  const left = { ...connectedPoint(grid, INLET_COL - 0.5, -0.5), y };
  const right = { ...connectedPoint(grid, INLET_COL + 0.5, -0.5), y };
  const edge = b.edge ?? [b.left, b.right], triangles: BankSurfacePoint[] = [];
  const dx = b.right.x - b.left.x, dz = b.right.z - b.left.z, length2 = dx * dx + dz * dz;
  const target = (p: BankSurfacePoint) => {
    const t = ((p.x - b.left.x) * dx + (p.z - b.left.z) * dz) / length2;
    return { x: left.x + (right.x - left.x) * t, z: left.z + (right.z - left.z) * t, y };
  };
  for (let i = 1; i < edge.length; i++) {
    const a = edge[i - 1]!, c = edge[i]!, d = target(c), e = target(a);
    triangles.push(a, c, d, a, d, e);
  }
  return triangles;
}

/** Discrete 4m-or-finer triangle checks; not proof of unsampled terrain or a
 * surveyed levee crest. A missing/blocked throat rejects injection, not just paint.
 */
function validConnection(grid: Grid, sample: SurfaceSampler): boolean {
  const b = grid.boundary!;
  if (b.edge && (b.edge.length < 2 || b.edge.length > MAX_RIVER_EDGE_POINTS ||
    b.edge.some(p => ![p.x, p.y, p.z].every(Number.isFinite) || Math.hypot(p.x - b.anchor.x, p.z - b.anchor.z) > CELL))) return false;
  if (![b.anchor.x, b.anchor.z, b.inland.x, b.inland.z, b.left.x, b.left.y, b.left.z,
    b.right.x, b.right.y, b.right.z].every(Number.isFinite) ||
    Math.hypot(b.right.x - b.left.x, b.right.z - b.left.z) < 1e-4 ||
    Math.hypot(b.left.x - b.anchor.x, b.left.z - b.anchor.z) > CELL ||
    Math.hypot(b.right.x - b.anchor.x, b.right.z - b.anchor.z) > CELL ||
    Math.abs(Math.hypot(b.inland.x, b.inland.z) - 1) > 1e-6 ||
    !Number.isFinite(grid.ground[INLET_COL]) || riverHead(grid) - grid.ground[INLET_COL]! < WET) return false;
  const triangles = connectorTriangles(grid);
  for (let i = 0; i < triangles.length; i += 3) {
    const [a, c, d] = triangles.slice(i, i + 3) as [BankSurfacePoint, BankSurfacePoint, BankSurfacePoint];
    const count = Math.ceil(Math.max(Math.hypot(a.x - c.x, a.z - c.z), Math.hypot(a.x - d.x, a.z - d.z),
      Math.hypot(c.x - d.x, c.z - d.z)) / 4);
    for (let u = 0; u <= count; u++) for (let v = 0; v <= count - u; v++) {
      const s = u / count, t = v / count;
      const x = a.x + (c.x - a.x) * s + (d.x - a.x) * t, z = a.z + (c.z - a.z) * s + (d.z - a.z) * t;
      const y = a.y + (c.y - a.y) * s + (d.y - a.y) * t, ground = sample(x, z);
      if (ground === null || !Number.isFinite(ground) || ground + SURFACE_LIFT + WET > y ||
        ((x - b.anchor.x) * b.inland.x + (z - b.anchor.z) * b.inland.z > 1e-5 && !b.isLand(x, z))) return false;
    }
  }
  return true;
}
