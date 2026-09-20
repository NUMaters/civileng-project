import * as THREE from "three";
import type { FloodSimulationState } from "../../features/disaster/services/floodSimulation";
import type { InundationSeed } from "../../features/disaster/services/inundationField";
import {
  getCandidateBankElevationMeters,
  listOverflowCandidates,
} from "../../features/disaster/services/overflowBankSites";
import { geoToWorld, groundY } from "./dioramaSpace";

export type DioramaInundation = {
  group: THREE.Group;
  object3D: THREE.Group;
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

type Grid = {
  seed: InundationSeed;
  longitude: number;
  latitude: number;
  ground: Float32Array;
  depth: Float32Array;
  next: Float32Array;
};

/**
 * Isolated cell-level adaptation of inundationField.ts's educational height field.
 * That module exposes only angle-sorted rings (which can bridge dry cells) and sparse
 * flow samples, and owns a global grid. Keeping the same 16 m grid/injection/flux
 * here avoids both invented wet polygons and resets affecting a Cesium viewer.
 * Neither the synthetic valley below nor dioramaSpace.groundY is a measured DEM;
 * these depths illustrate propagation, not building damage or real flood forecasts.
 */
export function createDioramaInundation(sampleGround: (x: number, z: number) => number | null = groundY): DioramaInundation {
  const group = new THREE.Group();
  group.name = "diorama-inundation";
  group.visible = false;
  const grids = new Map<string, Grid>();
  // One reusable buffer/draw call, bounded independently of frame rate and site count.
  const capacity = MAX_SITES * COLS * ROWS * 12 * 3;
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

  function reset(): void {
    grids.clear();
    accumulator = 0;
    geometryDirty = false;
    lastGeometryTime = -Infinity;
    geometry.setDrawRange(0, 0);
    group.visible = false;
  }

  function rebuild(): void {
    let vertex = 0;
    for (const grid of grids.values()) {
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const depth = grid.depth[row * COLS + col]!;
          if (depth < WET) continue;
          // Render cell footprints, never a hull enclosing unwetted neighbors.
          const samples = [
            { col, row, depth },
            ...[
              [-0.5, -0.5],
              [0.5, -0.5],
              [0.5, 0.5],
              [-0.5, 0.5],
            ].map(([dc, dr]) => shoreCorner(grid, col + dc!, row + dr!)),
          ].map((sample) => {
            const p = point(grid, sample.col, sample.row);
            return { ...geoToWorld(p.longitude, p.latitude), depth: sample.depth };
          });
          const ground = samples.map(p => sampleGround(p.x, p.z));
          if (ground.some(y => y === null)) continue;
          // Shared shoreline corners soften the staircase without extending
          // into dry cells. The center retains the field's actual cell depth.
          for (const index of [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1]) {
            const p = samples[index]!;
            color.copy(shallow).lerp(deep, Math.min(1, p.depth / 1.5));
            // Ground-conforming educational surface: depth is meters, no circular
            // effects or artificially expanded footprint. Lift clears road decals.
            positions.setXYZ(vertex, p.x, ground[index]! + 0.18 + p.depth, p.z);
            colors.setXYZ(vertex, color.r, color.g, color.b);
            vertex++;
          }
        }
      }
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
  }

  return {
    group,
    object3D: group,
    update(state, dt, time) {
      if (disposed) return;
      void dt;
      const elapsed = state.disasterElapsedSeconds;
      if (!Number.isFinite(elapsed) || elapsed < 0 || !Number.isFinite(time)) return;
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
      // Never leave a removed site's water visible until the next geometry tick.
      if (removed) {
        group.visible = false;
        geometryDirty = true;
      }
      // Freeze the final footprint during result/review. Do not keep injecting water.
      if (state.phase !== "disaster") return;
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
          if (
            !grid ||
            grid.seed.longitude !== seed.longitude ||
            grid.seed.latitude !== seed.latitude ||
            grid.seed.outflowHeadingDegrees !== seed.outflowHeadingDegrees
          ) {
            grid = createGrid(seed);
            grids.set(seed.id, grid);
          }
          grid.seed = seed;
          for (let step = 0; step < steps; step++) {
            advanceGrid(grid, Math.max(0, state.floodDepthMeters));
          }
        }
        geometryDirty = true;
      }
      if (geometryDirty && time - lastGeometryTime + 1e-9 >= STEP) {
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

/** Average only adjacent wet cells. No dry-cell triangles or outward dilation. */
function shoreCorner(grid: Grid, col: number, row: number) {
  let sum = 0;
  let count = 0;
  let columnSum = 0;
  let rowSum = 0;
  for (const r of [Math.floor(row), Math.ceil(row)]) {
    for (const c of [Math.floor(col), Math.ceil(col)]) {
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
      const depth = grid.depth[r * COLS + c]!;
      if (depth < WET) continue;
      sum += depth;
      count++;
      columnSum += c;
      rowSum += r;
    }
  }
  const inset = count === 1 ? 0.65 : count === 2 ? 0.25 : count === 3 ? 0.12 : 0;
  return {
    col: count ? col + (columnSum / count - col) * inset : col,
    row: count ? row + (rowSum / count - row) * inset : row,
    depth: count > 0 ? sum / count : 0,
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
  for (let dr = -1; dr <= 1; dr++) {
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
      if (h < WET * 0.5) continue;
      const neighbors = [
        [col - 1, row],
        [col + 1, row],
        [col, row - 1],
        [col, row + 1],
      ].filter(([c, r]) => c! >= 0 && c! < COLS && r! >= 0 && r! < ROWS);
      const fluxes = neighbors.map(([c, r]) => {
        const ni = r! * COLS + c!;
        const inland = (r! - (ROWS - 1) * 0.2) * CELL;
        const lateral = (c! - (COLS - 1) * 0.5) * CELL;
        const bias =
          (0.75 + 0.55 * Math.max(0, Math.tanh(inland / 80))) *
          (0.55 + 0.45 / (1 + (Math.abs(lateral) / (CELL * 6)) ** 2));
        return Math.max(
          0,
          Math.min(h * 0.22, (ground[index]! + h - ground[ni]! - depth[ni]!) * 1.55 * bias * STEP),
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
}
