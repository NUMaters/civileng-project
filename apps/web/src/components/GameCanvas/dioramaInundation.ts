import * as THREE from "three";
import type { FloodSimulationState } from "../../features/disaster/services/floodSimulation";
import type { InundationSeed } from "../../features/disaster/services/inundationField";
import {
  getCandidateBankElevationMeters,
  listOverflowCandidates,
} from "../../features/disaster/services/overflowBankSites";
import { geoToWorld, groundY } from "./dioramaSpace";
import type { RiverBoundary, RiverBoundaryResolver, SurfaceSampler } from "./riverBoundary";
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
const SUBCELL = 4;
const SUB_ROWS = 48;
const SUB_COLS_MAX = 58; // 56 regular columns plus the two exact source-inlet edges.
// Two triangles per cell, plus two per interior source-edge breakpoint. Each
// ordered breakpoint belongs to at most ONE column, independently of wet cells.
const SUB_VERTICES_MAX = SUB_COLS_MAX * SUB_ROWS * 6 + MAX_RIVER_EDGE_POINTS * 6;
const BANK_SHALLOW = new THREE.Color("#65edfa");
const BANK_DEEP = new THREE.Color("#009fc9");

type BankGrid = {
  columns: number;
  lateral: Float64Array;
  x: Float64Array;
  z: Float64Array;
  bed: Float32Array;
  depth: Float32Array;
  next: Float32Array;
  neighbors: Int32Array;
  connected: Uint8Array;
  queue: Int32Array;
  source: Uint8Array;
  surface: Float32Array;
  weights: Uint8Array;
  flux: Float64Array;
  edgeFirst: Uint8Array;
  edgeEnd: Uint8Array;
};

type Grid = {
  seed: InundationSeed;
  longitude: number;
  latitude: number;
  ground: Float32Array;
  depth: Float32Array;
  next: Float32Array;
  boundary?: RiverBoundary;
  bank?: BankGrid;
};

/**
 * Isolated cell-level adaptation of inundationField.ts's educational height field.
 * That module exposes only angle-sorted rings (which can bridge dry cells) and sparse
 * flow samples, and owns a global grid. Keeping the same 16 m grid/injection/flux
 * here avoids both invented wet polygons and resets affecting a Cesium viewer.
 * With a boundary resolver, a separate 4m subcell grid starts ON the source bank and
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
  const capacity = MAX_SITES * (resolveBoundary ? SUB_VERTICES_MAX : COLS * ROWS * 12) * 3;
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
  group.userData.floodGrid = { subcellMeters: resolveBoundary ? SUBCELL : CELL,
    maxSites: MAX_SITES, maxCellsPerSite: resolveBoundary ? SUB_COLS_MAX * SUB_ROWS : COLS * ROWS,
    vertexCapacity: capacity / 3, geometryBufferBytes: capacity * 4 * 2, drawCalls: 1 };
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
    let simulationBufferBytes = 0;
    const patches: RenderedFloodPatch[] = [];
    for (const grid of grids.values()) {
      simulationBufferBytes += grid.ground.byteLength + grid.depth.byteLength + grid.next.byteLength;
      const vertexStart = vertex;
      if (grid.bank) {
        const b = grid.bank;
        simulationBufferBytes += b.lateral.byteLength + b.x.byteLength + b.z.byteLength + b.bed.byteLength +
          b.depth.byteLength + b.next.byteLength + b.neighbors.byteLength + b.connected.byteLength + b.queue.byteLength +
          b.source.byteLength + b.surface.byteLength + b.weights.byteLength + b.flux.byteLength + b.edgeFirst.byteLength + b.edgeEnd.byteLength;
        vertex = emitBankGrid(grid, positions, colors, vertex);
        const patch = renderedPatch(positions, vertexStart, vertex - vertexStart, grid.seed.id);
        if (patch) patches.push(patch);
        continue;
      }
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const depth = grid.depth[row * COLS + col]!;
          if (depth < WET) continue;
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
    group.userData.floodGrid.simulationBufferBytes = simulationBufferBytes;
    group.userData.floodGrid.cachedSites = grids.size;
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
          if (resolveBoundary && (!boundary || !validBank(boundary))) { removed = grids.delete(seed.id) || removed; continue; }
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
              grid.bank = createBankGrid(boundary, sampleGround);
              if (!grid.bank) { removed = grids.delete(seed.id) || removed; continue; }
            }
            grids.set(seed.id, grid);
          }
          grid.seed = seed;
          if (boundary) {
            grid.boundary = boundary;
            // Recheck the small source footprint, not every cached terrain cell.
            // No source connection means no retained remote puddle or stale geometry.
            if (!refreshBankSource(grid, sampleGround)) {
              if (grid.bank?.depth.some(value => value > 0)) removed = true;
              grid.bank?.depth.fill(0);
              continue;
            }
          }
          for (let step = 0; step < steps; step++) {
            if (grid.bank) advanceBankGrid(grid);
            else if (!resolveBoundary) advanceGrid(grid, Math.max(0, state.floodDepthMeters));
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
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az) ||
        !Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bz) ||
        !Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)) return null;
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
  let head = Math.min(b.left.y, b.right.y);
  if (b.edge) for (const p of b.edge) head = Math.min(head, p.y);
  return head;
}

function validBank(b: RiverBoundary): boolean {
  if (b.edge && (b.edge.length < 2 || b.edge.length > MAX_RIVER_EDGE_POINTS ||
    b.edge.some(p => ![p.x, p.y, p.z].every(Number.isFinite) || Math.hypot(p.x - b.anchor.x, p.z - b.anchor.z) > CELL))) return false;
  if (![b.anchor.x, b.anchor.z, b.inland.x, b.inland.z, b.left.x, b.left.y, b.left.z,
    b.right.x, b.right.y, b.right.z].every(Number.isFinite) ||
    Math.hypot(b.right.x - b.left.x, b.right.z - b.left.z) < 1e-4 ||
    Math.hypot(b.left.x - b.anchor.x, b.left.z - b.anchor.z) > CELL ||
    Math.hypot(b.right.x - b.anchor.x, b.right.z - b.anchor.z) > CELL ||
    Math.abs(Math.hypot(b.inland.x, b.inland.z) - 1) > 1e-6) return false;
  if (b.edge) {
    const dx = b.right.x - b.left.x, dz = b.right.z - b.left.z, length = Math.hypot(dx, dz);
    let previous = -Infinity;
    for (let i = 0; i < b.edge.length; i++) {
      const p = b.edge[i]!, x = p.x - b.left.x, z = p.z - b.left.z;
      const along = (x * dx + z * dz) / length;
      // Mesh breaks must follow the same source segment, in strictly increasing
      // order. Backtracking/duplicates must not paint overlapping strips.
      if (Math.abs(x * dz - z * dx) / length > 1e-6 || along <= previous ||
          along < -1e-6 || along > length + 1e-6 ||
          (i === 0 && Math.abs(along) > 1e-6) ||
          (i === b.edge.length - 1 && Math.abs(along - length) > 1e-6)) return false;
      previous = along;
    }
  }
  return true;
}

/** Nine samples per 4m cell (2m spacing); a hole or source-water interior is
 * impermeable. This is bounded educational discretization, not a surveyed crest.
 * An exact polygon boundary is allowed, but never shifted inland for geometry.
 */
function bankCellBed(bank: BankGrid, b: RiverBoundary, col: number, row: number, sample: SurfaceSampler): number {
  const stride = bank.columns + 1, p = row * stride + col;
  let bed = -Infinity;
  for (let v = 0; v <= 2; v++) for (let u = 0; u <= 2; u++) {
    const x = bank.x[p]! + (bank.x[p + 1]! - bank.x[p]!) * u / 2 + b.inland.x * SUBCELL * v / 2;
    const z = bank.z[p]! + (bank.z[p + 1]! - bank.z[p]!) * u / 2 + b.inland.z * SUBCELL * v / 2;
    const y = sample(x, z);
    if (y === null || !Number.isFinite(y)) return Infinity;
    if (!b.isLand(x, z)) {
      // The side probe classifies a boundary; it does not move its coordinates.
      if (row !== 0 || v !== 0 || !b.isLand(x + b.inland.x * 1e-5, z + b.inland.z * 1e-5) ||
          b.isLand(x - b.inland.x * 1e-5, z - b.inland.z * 1e-5)) return Infinity;
    }
    bed = Math.max(bed, y + SURFACE_LIFT);
  }
  return bed;
}

function createBankGrid(b: RiverBoundary, sample: SurfaceSampler): BankGrid | undefined {
  if (!validBank(b)) return undefined;
  const length = Math.hypot(b.right.x - b.left.x, b.right.z - b.left.z);
  const tx = (b.right.x - b.left.x) / length, tz = (b.right.z - b.left.z) / length;
  const left = (b.left.x - b.anchor.x) * tx + (b.left.z - b.anchor.z) * tz;
  const right = (b.right.x - b.anchor.x) * tx + (b.right.z - b.anchor.z) * tz;
  const edges = Array.from({ length: 57 }, (_, i) => (i - 28) * SUBCELL);
  for (const p of [left, right]) if (!edges.some(x => Math.abs(x - p) < 1e-6)) edges.push(p);
  edges.sort((a, c) => a - c);
  const columns = edges.length - 1, cells = columns * SUB_ROWS, nodes = (columns + 1) * (SUB_ROWS + 1);
  const bank: BankGrid = { columns, lateral: Float64Array.from(edges), x: new Float64Array(nodes), z: new Float64Array(nodes),
    bed: new Float32Array(cells), depth: new Float32Array(cells), next: new Float32Array(cells),
    neighbors: new Int32Array(cells * 4), connected: new Uint8Array(cells), queue: new Int32Array(cells),
    source: new Uint8Array(cells), surface: new Float32Array(nodes), weights: new Uint8Array(nodes), flux: new Float64Array(4),
    edgeFirst: new Uint8Array(columns), edgeEnd: new Uint8Array(columns) };
  for (let row = 0; row <= SUB_ROWS; row++) for (let col = 0; col <= columns; col++) {
    const i = row * (columns + 1) + col;
    bank.x[i] = b.anchor.x + tx * edges[col]! + b.inland.x * row * SUBCELL;
    bank.z[i] = b.anchor.z + tz * edges[col]! + b.inland.z * row * SUBCELL;
  }
  for (let row = 0; row < SUB_ROWS; row++) for (let col = 0; col < columns; col++) {
    const i = row * columns + col;
    bank.bed[i] = bankCellBed(bank, b, col, row, sample);
    bank.neighbors[i * 4] = col > 0 ? i - 1 : -1;
    bank.neighbors[i * 4 + 1] = col + 1 < columns ? i + 1 : -1;
    bank.neighbors[i * 4 + 2] = row > 0 ? i - columns : -1;
    bank.neighbors[i * 4 + 3] = row + 1 < SUB_ROWS ? i + columns : -1;
    if (row === 0 && edges[col]! >= left - 1e-6 && edges[col + 1]! <= right + 1e-6) bank.source[i] = 1;
  }
  return bank;
}

function refreshBankSource(grid: Grid, sample: SurfaceSampler): boolean {
  const bank = grid.bank, b = grid.boundary!;
  if (!bank || !validBank(b)) return false;
  const head = riverHead(grid);
  let active = false;
  for (let col = 0; col < bank.columns; col++) if (bank.source[col]) {
    bank.bed[col] = bankCellBed(bank, b, col, 0, sample);
    if (head - bank.bed[col]! >= WET) active = true;
  }
  return active;
}

function advanceBankGrid(grid: Grid): void {
  const b = grid.bank!, head = riverHead(grid), size = b.depth.length;
  for (let i = 0; i < size; i++) b.depth[i] = b.source[i] ? Math.max(0, head - b.bed[i]!) : Math.min(b.depth[i]!, Math.max(0, head - b.bed[i]!));
  b.next.set(b.depth);
  // Cell-size-scaled diffusion, bounded to 85% outflow; no per-cell allocations.
  const rate = 1.55 * STEP * grid.seed.intensity * (CELL / SUBCELL) ** 2;
  for (let i = 0; i < size; i++) {
    const depth = b.depth[i]!;
    if (depth < WET * 0.5 || !Number.isFinite(b.bed[i])) continue;
    let total = 0;
    for (let k = 0; k < 4; k++) {
      const n = b.neighbors[i * 4 + k]!;
      const flux = n < 0 || !Number.isFinite(b.bed[n]) ? 0 : Math.max(0, Math.min(depth * 0.22, (b.bed[i]! + depth - b.bed[n]! - b.depth[n]!) * rate));
      b.flux[k] = flux; total += flux;
    }
    const scale = total > depth * 0.85 ? depth * 0.85 / total : 1;
    for (let k = 0; k < 4; k++) {
      const n = b.neighbors[i * 4 + k]!;
      if (n < 0) continue;
      const flux = b.flux[k]! * scale;
      b.next[i]! -= flux; b.next[n]! += flux;
    }
  }
  const drain = 0.012 * STEP * (1.15 - grid.seed.intensity);
  for (let i = 0; i < size; i++) b.depth[i] = b.source[i] ? Math.max(0, head - b.bed[i]!) : Math.min(Math.max(0, b.next[i]! - drain), Math.max(0, head - b.bed[i]!));
}

function edgeHeight(b: RiverBoundary, x: number, z: number): number {
  const edge = b.edge;
  if (!edge) {
    const length2 = (b.right.x - b.left.x) ** 2 + (b.right.z - b.left.z) ** 2;
    const t = ((x - b.left.x) * (b.right.x - b.left.x) + (z - b.left.z) * (b.right.z - b.left.z)) / length2;
    return b.left.y + (b.right.y - b.left.y) * Math.max(0, Math.min(1, t));
  }
  let nearest = Infinity, y = b.left.y;
  for (let i = 1; i < edge.length; i++) {
    const a = edge[i - 1]!, c = edge[i]!, dx = c.x - a.x, dz = c.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    const distance = (x - a.x - t * dx) ** 2 + (z - a.z - t * dz) ** 2;
    if (distance < nearest) { nearest = distance; y = a.y + (c.y - a.y) * t; }
  }
  return y;
}

function emitBankGrid(grid: Grid, positions: THREE.BufferAttribute, colors: THREE.BufferAttribute, vertex: number): number {
  const b = grid.bank!, boundary = grid.boundary!, columns = b.columns, stride = columns + 1;
  // Partition the ordered edge once. Emission below only visits this column's
  // half-open index range; no breakpoint can subdivide several source cells.
  const edge = boundary.edge;
  let edgeIndex = 0;
  const length = Math.hypot(boundary.right.x - boundary.left.x, boundary.right.z - boundary.left.z);
  const tx = (boundary.right.x - boundary.left.x) / length, tz = (boundary.right.z - boundary.left.z) / length;
  const along = (index: number) => (edge![index]!.x - boundary.anchor.x) * tx + (edge![index]!.z - boundary.anchor.z) * tz;
  for (let col = 0; col < columns; col++) {
    while (edgeIndex < (edge?.length ?? 0) && along(edgeIndex) <= b.lateral[col]! + 1e-6) edgeIndex++;
    b.edgeFirst[col] = edgeIndex;
    while (edgeIndex < (edge?.length ?? 0) && along(edgeIndex) < b.lateral[col + 1]! - 1e-6) edgeIndex++;
    b.edgeEnd[col] = edgeIndex;
  }
  b.connected.fill(0); b.surface.fill(0); b.weights.fill(0);
  let tail = 0;
  for (let i = 0; i < columns; i++) if (b.source[i] && b.depth[i]! >= WET) { b.connected[i] = 1; b.queue[tail++] = i; }
  for (let cursor = 0; cursor < tail; cursor++) {
    const i = b.queue[cursor]!;
    for (let k = 0; k < 4; k++) {
      const n = b.neighbors[i * 4 + k]!;
      if (n >= 0 && !b.connected[n] && b.depth[n]! >= WET && Number.isFinite(b.bed[n])) { b.connected[n] = 1; b.queue[tail++] = n; }
    }
    const row = Math.floor(i / columns), col = i % columns, node = row * stride + col;
    const y = b.bed[i]! + b.depth[i]!;
    for (let k = 0; k < 4; k++) {
      const n = node + (k % 2) + (k >= 2 ? stride : 0);
      b.surface[n]! += y; b.weights[n]!++;
    }
  }
  for (let i = 0; i < b.surface.length; i++) if (b.weights[i]) b.surface[i]! /= b.weights[i]!;
  for (let col = 0; col < columns; col++) if (b.source[col] && b.connected[col]) {
    b.surface[col] = edgeHeight(boundary, b.x[col]!, b.z[col]!);
    b.surface[col + 1] = edgeHeight(boundary, b.x[col + 1]!, b.z[col + 1]!);
  }
  const emit = (x: number, y: number, z: number, depth: number) => {
    if (vertex >= positions.count || vertex >= colors.count) throw new RangeError("Flood vertex capacity exceeded");
    positions.setXYZ(vertex, x, y, z);
    const t = Math.min(1, depth / 1.5);
    colors.setXYZ(vertex++, BANK_SHALLOW.r + (BANK_DEEP.r - BANK_SHALLOW.r) * t,
      BANK_SHALLOW.g + (BANK_DEEP.g - BANK_SHALLOW.g) * t, BANK_SHALLOW.b + (BANK_DEEP.b - BANK_SHALLOW.b) * t);
  };
  const emitNode = (n: number, depth: number) => emit(b.x[n]!, b.surface[n]!, b.z[n]!, depth);
  for (let cursor = 0; cursor < tail; cursor++) {
    const i = b.queue[cursor]!, row = Math.floor(i / columns), col = i % columns;
    const a = row * stride + col, c = a + 1, d = a + stride + 1, e = a + stride;
    const depth = b.depth[i]!;
    if (row === 0 && b.source[i]) {
      // Subdivide ONLY this wet cell's source edge at actual river triangle breaks.
      // There is no separate widened connector and no unsimulated 8m shore band.
      let x = b.x[a]!, z = b.z[a]!, y = edgeHeight(boundary, x, z);
      const dx = b.x[c]! - x, dz = b.z[c]! - z, length2 = dx * dx + dz * dz;
      for (let k = b.edgeFirst[col]!; k <= b.edgeEnd[col]!; k++) {
        const p = k < b.edgeEnd[col]! ? edge![k] : undefined;
        const t = p ? ((p.x - b.x[a]!) * dx + (p.z - b.z[a]!) * dz) / length2 : 1;
        const nx = p?.x ?? b.x[c]!, nz = p?.z ?? b.z[c]!, ny = p?.y ?? edgeHeight(boundary, nx, nz);
        const startT = ((x - b.x[a]!) * dx + (z - b.z[a]!) * dz) / length2;
        const lx = b.x[e]! + (b.x[d]! - b.x[e]!) * startT, lz = b.z[e]! + (b.z[d]! - b.z[e]!) * startT;
        const ly = b.surface[e]! + (b.surface[d]! - b.surface[e]!) * startT;
        const rx = b.x[e]! + (b.x[d]! - b.x[e]!) * t, rz = b.z[e]! + (b.z[d]! - b.z[e]!) * t;
        const ry = b.surface[e]! + (b.surface[d]! - b.surface[e]!) * t;
        emit(x, y, z, depth); emit(nx, ny, nz, depth); emit(rx, ry, rz, depth);
        emit(x, y, z, depth); emit(rx, ry, rz, depth); emit(lx, ly, lz, depth);
        x = nx; z = nz; y = ny;
      }
    } else {
      emitNode(a, depth); emitNode(c, depth); emitNode(d, depth);
      emitNode(a, depth); emitNode(d, depth); emitNode(e, depth);
    }
  }
  return vertex;
}
