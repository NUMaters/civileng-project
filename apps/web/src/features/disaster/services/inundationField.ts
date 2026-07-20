/**
 * 教育用の簡易浅水（高さ場）モデル。
 * 決壊点から標高差と流向バイアスで水を拡散し、水深バンド／流向を返す。
 * 真の流体ソルバではなく、Cesium 上で「溢れが低地へ流れる」感を出す近似。
 */

export type InundationSeed = {
  id: string;
  longitude: number;
  latitude: number;
  outflowHeadingDegrees: number;
  intensity: number;
  /** 岸標高（m）。低いほど広がりやすい。 */
  bankElevationMeters: number;
};

export type InundationFlowSample = {
  longitude: number;
  latitude: number;
  headingDegrees: number;
  speed: number;
  depthMeters: number;
};

export type InundationBand = {
  /** バンド下限水深（m）。 */
  minDepthMeters: number;
  /** 外周リング（閉じていなくても可）。lon/lat 交互ではないオブジェクト配列。 */
  ring: ReadonlyArray<{ longitude: number; latitude: number }>;
  meanDepthMeters: number;
};

export type InundationSiteField = {
  siteId: string;
  bands: InundationBand[];
  flows: InundationFlowSample[];
  floodedCellCount: number;
  maxDepthMeters: number;
};

export type InundationFieldSnapshot = {
  sites: InundationSiteField[];
  updatedAtMs: number;
};

const CELL_SIZE_M = 22;
const COLS = 36;
const ROWS = 28;
/** 1 ステップあたりの移流係数（無次元に近い経験値）。 */
const CONDUCTIVITY = 1.85;
/** 決壊点への注入（m/s 相当）。 */
const INJECT_RATE = 0.55;
const MIN_WET_DEPTH = 0.04;
const BAND_THRESHOLDS = [0.08, 0.25, 0.55, 1.1] as const;

type SiteGrid = {
  seed: InundationSeed;
  originLon: number;
  originLat: number;
  /** グリッド東方向の絶対方位（rad）。流出方向に揃える。 */
  eastHeading: number;
  ground: Float32Array;
  depth: Float32Array;
};

const siteGrids = new Map<string, SiteGrid>();

/**
 * 決壊サイト群から高さ場を進め、描画用の水深バンドと流向サンプルを返す。
 */
export function advanceInundationField(
  seeds: readonly InundationSeed[],
  floodDepthMeters: number,
  deltaSeconds: number,
  nowMs = performance.now(),
): InundationFieldSnapshot {
  const dt = Math.min(0.12, Math.max(0.008, deltaSeconds));
  const activeIds = new Set(seeds.map((seed) => seed.id));

  for (const id of [...siteGrids.keys()]) {
    if (!activeIds.has(id)) {
      siteGrids.delete(id);
    }
  }

  const sites: InundationSiteField[] = [];
  for (const seed of seeds) {
    if (seed.intensity < 0.04 && floodDepthMeters < 0.05) {
      siteGrids.delete(seed.id);
      continue;
    }
    let grid = siteGrids.get(seed.id);
    if (grid === undefined) {
      grid = createSiteGrid(seed);
      siteGrids.set(seed.id, grid);
    } else {
      grid.seed = seed;
    }

    stepSiteGrid(grid, floodDepthMeters, dt);
    sites.push(buildSiteField(grid));
  }

  return { sites, updatedAtMs: nowMs };
}

/** テスト／リセット用。 */
export function resetInundationField(): void {
  siteGrids.clear();
}

function createSiteGrid(seed: InundationSeed): SiteGrid {
  const heading = (seed.outflowHeadingDegrees * Math.PI) / 180;
  // グリッド原点を決壊点から少し内陸へずらし、川側より市街地側を広く取る。
  const origin = offsetMeters(
    seed.longitude,
    seed.latitude,
    Math.sin(heading) * (CELL_SIZE_M * (ROWS * 0.18)),
    Math.cos(heading) * (CELL_SIZE_M * (ROWS * 0.18)),
  );
  const ground = new Float32Array(COLS * ROWS);
  const depth = new Float32Array(COLS * ROWS);

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const { inland, lateral } = cellLocalMeters(col, row);
      // 谷地形: 流軸沿いは緩やか、横断方向は両岸が上がる。低岸ほど盆地が深い。
      const bankBias = (seed.bankElevationMeters - 19) * 0.35;
      const valley = (lateral * lateral) / (2 * (CELL_SIZE_M * 9) ** 2) * 3.2;
      const inlandSlope = inland * 0.0018 + Math.max(0, inland - 180) * 0.0024;
      const pocket =
        inland > 40 && inland < 220
          ? -0.55 * Math.exp(-((inland - 120) ** 2) / (2 * 55 ** 2))
          : 0;
      ground[row * COLS + col] = seed.bankElevationMeters + bankBias + valley + inlandSlope + pocket;
    }
  }

  return {
    seed,
    originLon: origin.longitude,
    originLat: origin.latitude,
    eastHeading: heading,
    ground,
    depth,
  };
}

function stepSiteGrid(grid: SiteGrid, floodDepthMeters: number, dt: number): void {
  const { seed, ground, depth } = grid;
  const inject =
    (INJECT_RATE * seed.intensity * (0.35 + floodDepthMeters) + floodDepthMeters * 0.08) * dt;

  // 決壊セル近傍へ注入
  const seedCell = worldToCell(grid, seed.longitude, seed.latitude);
  if (seedCell !== undefined) {
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const col = seedCell.col + dc;
        const row = seedCell.row + dr;
        if (col < 0 || col >= COLS || row < 0 || row >= ROWS) {
          continue;
        }
        const weight = dr === 0 && dc === 0 ? 1 : 0.35;
        depth[row * COLS + col] += inject * weight;
      }
    }
  }

  const next = new Float32Array(depth);
  const heading = (seed.outflowHeadingDegrees * Math.PI) / 180;

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const index = row * COLS + col;
      const h = depth[index]!;
      if (h < MIN_WET_DEPTH * 0.5) {
        continue;
      }
      const surface = ground[index]! + h;
      const neighbors: Array<{ ni: number; bias: number }> = [];
      if (col > 0) {
        neighbors.push({ ni: index - 1, bias: lateralBias(grid, col - 1, row, heading) });
      }
      if (col < COLS - 1) {
        neighbors.push({ ni: index + 1, bias: lateralBias(grid, col + 1, row, heading) });
      }
      if (row > 0) {
        neighbors.push({ ni: index - COLS, bias: lateralBias(grid, col, row - 1, heading) });
      }
      if (row < ROWS - 1) {
        neighbors.push({ ni: index + COLS, bias: lateralBias(grid, col, row + 1, heading) });
      }

      let outflow = 0;
      const fluxes: number[] = [];
      for (const neighbor of neighbors) {
        const nSurface = ground[neighbor.ni]! + depth[neighbor.ni]!;
        const head = surface - nSurface;
        if (head <= 0) {
          fluxes.push(0);
          continue;
        }
        const flux = Math.min(h * 0.22, head * CONDUCTIVITY * neighbor.bias * dt);
        fluxes.push(flux);
        outflow += flux;
      }
      const scale = outflow > h * 0.85 && outflow > 0 ? (h * 0.85) / outflow : 1;
      for (let i = 0; i < neighbors.length; i += 1) {
        const flux = fluxes[i]! * scale;
        if (flux <= 0) {
          continue;
        }
        next[index]! -= flux;
        next[neighbors[i]!.ni]! += flux;
      }
    }
  }

  // 浅い水の蒸発・減衰（教育用。浸水が無限に広がらないようにする）
  const drain = 0.012 * dt * (1.15 - Math.min(1, seed.intensity));
  for (let i = 0; i < next.length; i += 1) {
    depth[i] = Math.max(0, next[i]! - drain);
  }
}

function lateralBias(grid: SiteGrid, col: number, row: number, heading: number): number {
  const { inland, lateral } = cellLocalMeters(col, row);
  // 流出方向（inland 正）への流れを優遇し、横断方向への広がりは弱める。
  const along = 0.75 + 0.55 * Math.max(0, Math.tanh(inland / 80));
  const cross = 1 / (1 + (Math.abs(lateral) / (CELL_SIZE_M * 6)) ** 2);
  // 流向ベクトルとの整合（セル中心の絶対方位は eastHeading＝流出）
  void grid;
  void heading;
  return along * (0.55 + 0.45 * cross);
}

function buildSiteField(grid: SiteGrid): InundationSiteField {
  const { depth, seed } = grid;
  let maxDepth = 0;
  let wet = 0;
  for (let i = 0; i < depth.length; i += 1) {
    const value = depth[i]!;
    if (value >= MIN_WET_DEPTH) {
      wet += 1;
      maxDepth = Math.max(maxDepth, value);
    }
  }

  const bands: InundationBand[] = [];
  for (let bandIndex = 0; bandIndex < BAND_THRESHOLDS.length; bandIndex += 1) {
    const minDepth = BAND_THRESHOLDS[bandIndex]!;
    const nextMin = BAND_THRESHOLDS[bandIndex + 1];
    const ring = extractBandRing(grid, minDepth, nextMin);
    if (ring.length < 3) {
      continue;
    }
    let sum = 0;
    let count = 0;
    for (let i = 0; i < depth.length; i += 1) {
      const value = depth[i]!;
      if (value >= minDepth && (nextMin === undefined || value < nextMin)) {
        sum += value;
        count += 1;
      }
    }
    bands.push({
      minDepthMeters: minDepth,
      ring,
      meanDepthMeters: count > 0 ? sum / count : minDepth,
    });
  }

  return {
    siteId: seed.id,
    bands,
    flows: sampleFlows(grid),
    floodedCellCount: wet,
    maxDepthMeters: maxDepth,
  };
}

/**
 * 水深以上のセル外縁を角度ソートした簡易輪郭にする（凸包に近い扇状リング）。
 */
function extractBandRing(
  grid: SiteGrid,
  minDepth: number,
  maxDepth: number | undefined,
): Array<{ longitude: number; latitude: number }> {
  const points: Array<{ longitude: number; latitude: number; angle: number }> = [];
  const seedLon = grid.seed.longitude;
  const seedLat = grid.seed.latitude;

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const depth = grid.depth[row * COLS + col]!;
      if (depth < minDepth) {
        continue;
      }
      if (maxDepth !== undefined && depth >= maxDepth) {
        continue;
      }
      // 外周セルのみ（4近傍に閾値未満がある）
      const edge =
        col === 0 ||
        col === COLS - 1 ||
        row === 0 ||
        row === ROWS - 1 ||
        grid.depth[row * COLS + col - 1]! < minDepth ||
        grid.depth[row * COLS + col + 1]! < minDepth ||
        grid.depth[(row - 1) * COLS + col]! < minDepth ||
        grid.depth[(row + 1) * COLS + col]! < minDepth;
      if (!edge) {
        continue;
      }
      const world = cellToWorld(grid, col, row);
      const angle = Math.atan2(world.longitude - seedLon, world.latitude - seedLat);
      points.push({ ...world, angle });
    }
  }

  if (points.length < 3) {
    return [];
  }

  points.sort((a, b) => a.angle - b.angle);
  // 間引き（最大 28 点）
  const step = Math.max(1, Math.floor(points.length / 28));
  const ring = points.filter((_, index) => index % step === 0).map(({ longitude, latitude }) => ({
    longitude,
    latitude,
  }));
  if (ring[0] !== undefined) {
    ring.push({ ...ring[0] });
  }
  return ring;
}

function sampleFlows(grid: SiteGrid): InundationFlowSample[] {
  const samples: InundationFlowSample[] = [];
  const heading0 = grid.seed.outflowHeadingDegrees;
  for (let row = 2; row < ROWS - 2; row += 3) {
    for (let col = 2; col < COLS - 2; col += 3) {
      const index = row * COLS + col;
      const d = grid.depth[index]!;
      if (d < MIN_WET_DEPTH) {
        continue;
      }
      const surface = grid.ground[index]! + d;
      const e = grid.ground[index + 1]! + grid.depth[index + 1]!;
      const w = grid.ground[index - 1]! + grid.depth[index - 1]!;
      const n = grid.ground[index - COLS]! + grid.depth[index - COLS]!;
      const s = grid.ground[index + COLS]! + grid.depth[index + COLS]!;
      // 格子は流出方向が +row 側。勾配の下り方向へ流す。
      const dEast = (e - w) * 0.5;
      const dNorth = (n - s) * 0.5;
      const localEast = -dEast;
      const localNorth = -dNorth;
      const absHeading = absoluteHeadingFromLocal(grid.eastHeading, localEast, localNorth);
      const speed = Math.min(2.5, Math.hypot(localEast, localNorth) * 4 + d * 0.6);
      const world = cellToWorld(grid, col, row);
      samples.push({
        longitude: world.longitude,
        latitude: world.latitude,
        headingDegrees: Number.isFinite(absHeading) ? absHeading : heading0,
        speed,
        depthMeters: d,
      });
    }
  }
  return samples.slice(0, 48);
}

function cellLocalMeters(col: number, row: number): { inland: number; lateral: number } {
  const inland = (row - (ROWS - 1) * 0.2) * CELL_SIZE_M;
  const lateral = (col - (COLS - 1) * 0.5) * CELL_SIZE_M;
  return { inland, lateral };
}

function cellToWorld(
  grid: SiteGrid,
  col: number,
  row: number,
): { longitude: number; latitude: number } {
  const { inland, lateral } = cellLocalMeters(col, row);
  const heading = grid.eastHeading;
  // inland = 流出方向、lateral = 右向き横断
  const east = Math.sin(heading) * inland + Math.cos(heading) * lateral;
  const north = Math.cos(heading) * inland - Math.sin(heading) * lateral;
  return offsetMeters(grid.originLon, grid.originLat, east, north);
}

function worldToCell(
  grid: SiteGrid,
  longitude: number,
  latitude: number,
): { col: number; row: number } | undefined {
  const metersPerDegreeLat = 110_540;
  const metersPerDegreeLon = 111_320 * Math.cos((grid.originLat * Math.PI) / 180);
  const east = (longitude - grid.originLon) * metersPerDegreeLon;
  const north = (latitude - grid.originLat) * metersPerDegreeLat;
  const heading = grid.eastHeading;
  const inland = east * Math.sin(heading) + north * Math.cos(heading);
  const lateral = east * Math.cos(heading) - north * Math.sin(heading);
  const col = Math.round(lateral / CELL_SIZE_M + (COLS - 1) * 0.5);
  const row = Math.round(inland / CELL_SIZE_M + (ROWS - 1) * 0.2);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) {
    return undefined;
  }
  return { col, row };
}

function absoluteHeadingFromLocal(
  gridHeading: number,
  localEast: number,
  localNorth: number,
): number {
  if (Math.hypot(localEast, localNorth) < 1e-6) {
    return ((gridHeading * 180) / Math.PI + 360) % 360;
  }
  const absEast = Math.sin(gridHeading) * localNorth + Math.cos(gridHeading) * localEast;
  const absNorth = Math.cos(gridHeading) * localNorth - Math.sin(gridHeading) * localEast;
  const deg = (Math.atan2(absEast, absNorth) * 180) / Math.PI;
  return (deg + 360) % 360;
}

function offsetMeters(
  longitude: number,
  latitude: number,
  east: number,
  north: number,
): { longitude: number; latitude: number } {
  const metersPerDegreeLat = 110_540;
  const metersPerDegreeLon = 111_320 * Math.cos((latitude * Math.PI) / 180);
  return {
    longitude: longitude + east / metersPerDegreeLon,
    latitude: latitude + north / metersPerDegreeLat,
  };
}
