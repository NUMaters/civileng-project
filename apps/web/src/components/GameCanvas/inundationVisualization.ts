import {
  CallbackProperty,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  HeightReference,
  Math as CesiumMath,
  PolygonHierarchy,
  PolylineGlowMaterialProperty,
  Viewer,
  type Entity,
} from "cesium";
import {
  advanceInundationField,
  resetInundationField,
  type InundationBand,
  type InundationFieldSnapshot,
  type InundationFlowSample,
  type InundationSeed,
} from "../../features/disaster/services/inundationField";
import type { OverflowSite } from "../../features/disaster/services/floodSimulation";
import {
  getCandidateBankElevationMeters,
  listOverflowCandidates,
} from "../../features/disaster/services/overflowBankSites";

const BAND_PREFIX = "inundation-band-";
const FLOW_PREFIX = "inundation-flow-";
const VISUAL_LERP_RATE = 2.2;
const FLOW_STREAK_LENGTH_M = 38;
/** 高さ場の計算は 10fps。描画側の補間で連続感を保つ。 */
const FIELD_UPDATE_INTERVAL_SECONDS = 0.1;
/** 流線位置は 15fps。水の移動として十分滑らかで、座標生成を大幅に減らせる。 */
const FLOW_POSITION_UPDATE_INTERVAL_MS = 1000 / 15;
/** 終盤でも画面を埋めすぎない流線数。3本/決壊地点程度の密度を維持する。 */
const MAX_FLOW_VISUALS = 24;

type BandVisual = {
  entity: Entity;
  siteId: string;
  bandIndex: number;
  alpha: number;
  targetAlpha: number;
  hierarchy: PolygonHierarchy;
  color: Color;
};

type FlowVisual = {
  entity: Entity;
  phase: number;
  alpha: number;
  targetAlpha: number;
  width: number;
  targetWidth: number;
  sample: InundationFlowSample;
  positions: ConstantProperty;
  color: Color;
};

type InundationController = {
  setTarget: (
    sites: readonly OverflowSite[],
    floodDepthMeters: number,
    active: boolean,
  ) => void;
  destroy: () => void;
};

const controllers = new WeakMap<Viewer, InundationController>();

/**
 * 高さ場に基づく浸水ポリゴンと流向ストリークを描く。
 * 決壊楕円だけでは出せない「低地へ流れ広がる」様子を補う。
 */
export function syncInundationVisualization(
  viewer: Viewer,
  sites: readonly OverflowSite[],
  floodDepthMeters: number,
  active: boolean,
): void {
  let controller = controllers.get(viewer);
  if (controller === undefined) {
    controller = createInundationController(viewer);
    controllers.set(viewer, controller);
  }
  controller.setTarget(sites, floodDepthMeters, active);
}

export function destroyInundationVisualization(viewer: Viewer): void {
  const controller = controllers.get(viewer);
  if (controller === undefined) {
    return;
  }
  controller.destroy();
  controllers.delete(viewer);
}

function createInundationController(viewer: Viewer): InundationController {
  const bands = new Map<string, BandVisual>();
  const flows: FlowVisual[] = [];
  let lastFrameAt = performance.now();
  let lastAdvanceAt = performance.now();
  let lastFlowPositionAt = 0;
  let activeTarget = false;
  let floodDepthMeters = 0;
  let seeds: InundationSeed[] = [];
  let snapshot: InundationFieldSnapshot = { sites: [], updatedAtMs: 0 };

  const removePreUpdate = viewer.scene.preUpdate.addEventListener(() => {
    if (viewer.isDestroyed()) {
      return;
    }
    const now = performance.now();
    const deltaSeconds = Math.min(0.05, Math.max(0.001, (now - lastFrameAt) / 1000));
    lastFrameAt = now;
    const alpha = 1 - Math.exp(-VISUAL_LERP_RATE * deltaSeconds);
    let changed = false;

    if (activeTarget && seeds.length > 0) {
      const sinceAdvance = (now - lastAdvanceAt) / 1000;
      if (sinceAdvance >= FIELD_UPDATE_INTERVAL_SECONDS) {
        snapshot = advanceInundationField(seeds, floodDepthMeters, sinceAdvance, now);
        lastAdvanceAt = now;
        applySnapshot(viewer, snapshot, bands, flows);
        changed = true;
      }
    } else if (bands.size > 0 || flows.length > 0) {
      for (const visual of bands.values()) {
        visual.targetAlpha = 0;
      }
      for (const flow of flows) {
        flow.targetAlpha = 0;
      }
    }

    for (const [key, visual] of [...bands.entries()]) {
      visual.alpha = lerp(visual.alpha, visual.targetAlpha, alpha);
      visual.color.alpha = visual.alpha;
      if (visual.targetAlpha <= 0.01 && visual.alpha <= 0.01) {
        viewer.entities.remove(visual.entity);
        bands.delete(key);
        changed = true;
      } else {
        changed = true;
      }
    }

    for (let index = flows.length - 1; index >= 0; index -= 1) {
      const flow = flows[index]!;
      flow.alpha = lerp(flow.alpha, flow.targetAlpha, alpha);
      flow.width = lerp(flow.width, flow.targetWidth, alpha);
      flow.phase = (flow.phase + deltaSeconds * (0.55 + flow.sample.speed * 0.65)) % 1;
      flow.color.alpha = flow.alpha;
      if (flow.targetAlpha <= 0.01 && flow.alpha <= 0.01) {
        viewer.entities.remove(flow.entity);
        flows.splice(index, 1);
        changed = true;
      } else {
        changed = true;
      }
    }


    if (now - lastFlowPositionAt >= FLOW_POSITION_UPDATE_INTERVAL_MS) {
      lastFlowPositionAt = now;
      for (const flow of flows) {
        flow.positions.setValue(flowSegment(flow));
      }
    }

    if (changed) {
      viewer.scene.requestRender();
    }
  });

  return {
    setTarget: (nextSites, nextFloodDepth, active) => {
      if (viewer.isDestroyed()) {
        return;
      }
      activeTarget = active && nextSites.length > 0 && nextFloodDepth > 0.02;
      floodDepthMeters = nextFloodDepth;
      seeds = activeTarget ? toSeeds(nextSites) : [];
      if (!activeTarget) {
        resetInundationField();
        for (const visual of bands.values()) {
          visual.targetAlpha = 0;
        }
        for (const flow of flows) {
          flow.targetAlpha = 0;
        }
      }
      viewer.scene.requestRender();
    },
    destroy: () => {
      removePreUpdate();
      resetInundationField();
      if (!viewer.isDestroyed()) {
        for (const visual of bands.values()) {
          viewer.entities.remove(visual.entity);
        }
        for (const flow of flows) {
          viewer.entities.remove(flow.entity);
        }
      }
      bands.clear();
      flows.length = 0;
    },
  };
}

function applySnapshot(
  viewer: Viewer,
  snapshot: InundationFieldSnapshot,
  bands: Map<string, BandVisual>,
  flows: FlowVisual[],
): void {
  const liveKeys = new Set<string>();

  for (const site of snapshot.sites) {
    site.bands.forEach((band, bandIndex) => {
      const key = `${site.siteId}-${bandIndex}`;
      liveKeys.add(key);
      const color = depthBandColor(band);
      const hierarchy = ringToHierarchy(band.ring);
      let visual = bands.get(key);
      if (visual === undefined) {
        visual = createBandVisual(viewer, key, site.siteId, bandIndex, hierarchy, color);
        bands.set(key, visual);
      } else {
        visual.hierarchy = hierarchy;
      }
      visual.targetAlpha = color.alpha;
    });
  }

  for (const [key, visual] of bands) {
    if (!liveKeys.has(key)) {
      visual.targetAlpha = 0;
    }
  }

  const desiredFlows = selectRepresentativeFlows(snapshot, MAX_FLOW_VISUALS);
  while (flows.length < desiredFlows.length) {
    const sample = desiredFlows[flows.length]!;
    flows.push(createFlowVisual(viewer, flows.length, sample));
  }
  while (flows.length > desiredFlows.length) {
    const removed = flows.pop();
    if (removed !== undefined) {
      viewer.entities.remove(removed.entity);
    }
  }
  for (let index = 0; index < desiredFlows.length; index += 1) {
    const sample = desiredFlows[index]!;
    const flow = flows[index]!;
    flow.sample = sample;
    flow.targetAlpha = Math.min(0.85, 0.28 + sample.depthMeters * 0.35 + sample.speed * 0.12);
    flow.targetWidth = 2.5 + sample.depthMeters * 3.5 + sample.speed * 1.2;
  }
}

function createBandVisual(
  viewer: Viewer,
  key: string,
  siteId: string,
  bandIndex: number,
  hierarchy: PolygonHierarchy,
  color: Color,
): BandVisual {
  const visual: BandVisual = {
    entity: undefined as unknown as Entity,
    siteId,
    bandIndex,
    alpha: 0,
    targetAlpha: color.alpha,
    hierarchy,
    color: depthBandColorByIndex(bandIndex).withAlpha(0),
  };
  visual.entity = viewer.entities.add({
    id: `${BAND_PREFIX}${key}`,
    polygon: {
      hierarchy: new CallbackProperty(() => visual.hierarchy, false),
      height: 0.06 + bandIndex * 0.04,
      heightReference: HeightReference.RELATIVE_TO_GROUND,
      material: new ColorMaterialProperty(
        new CallbackProperty(() => visual.color, false),
      ),
      outline: false,
      perPositionHeight: false,
    },
  });
  return visual;
}

function createFlowVisual(viewer: Viewer, index: number, sample: InundationFlowSample): FlowVisual {
  const visual: FlowVisual = {
    entity: undefined as unknown as Entity,
    // 見た目の位相のみ。セキュリティ用途ではないので決定論的ハッシュを使う。
    phase: visualUnit(index * 19.17 + sample.longitude * 1_000 + sample.latitude * 1_000),
    alpha: 0,
    targetAlpha: 0.4,
    width: 3,
    targetWidth: 3,
    sample,
    positions: undefined as unknown as ConstantProperty,
    color: FLOW_COLOR.withAlpha(0),
  };
  visual.positions = new ConstantProperty(flowSegment(visual));
  visual.entity = viewer.entities.add({
    id: `${FLOW_PREFIX}${index}`,
    polyline: {
      positions: visual.positions,
      width: new CallbackProperty(() => Math.max(1, visual.width), false),
      clampToGround: true,
      material: new PolylineGlowMaterialProperty({
        glowPower: 0.22,
        color: new CallbackProperty(() => visual.color, false),
      }),
    },
  });
  return visual;
}

/** 各決壊地点から均等に選び、単純な先頭切り捨てで表現が偏るのを防ぐ。 */
function selectRepresentativeFlows(
  snapshot: InundationFieldSnapshot,
  limit: number,
): InundationFlowSample[] {
  const queues = snapshot.sites.map((site) => [...site.flows]);
  const selected: InundationFlowSample[] = [];
  let cursor = 0;
  while (selected.length < limit && queues.some((queue) => queue.length > 0)) {
    const queue = queues[cursor % Math.max(1, queues.length)];
    const sample = queue?.shift();
    if (sample !== undefined) {
      selected.push(sample);
    }
    cursor += 1;
  }
  return selected;
}

function flowSegment(visual: FlowVisual): Cartesian3[] {
  const heading = CesiumMath.toRadians(visual.sample.headingDegrees);
  const travel = FLOW_STREAK_LENGTH_M;
  const phaseShift = visual.phase * travel * 0.85;
  const start = offsetLonLat(
    visual.sample.longitude,
    visual.sample.latitude,
    Math.sin(heading) * (phaseShift - travel * 0.35),
    Math.cos(heading) * (phaseShift - travel * 0.35),
  );
  const end = offsetLonLat(
    visual.sample.longitude,
    visual.sample.latitude,
    Math.sin(heading) * (phaseShift + travel * 0.35),
    Math.cos(heading) * (phaseShift + travel * 0.35),
  );
  return Cartesian3.fromDegreesArray([
    start.longitude,
    start.latitude,
    end.longitude,
    end.latitude,
  ]);
}

function toSeeds(sites: readonly OverflowSite[]): InundationSeed[] {
  const candidates = listOverflowCandidates();
  return sites.map((site) => {
    const candidate = candidates.find((item) => item.id === site.id);
    const bankElevationMeters =
      candidate !== undefined ? getCandidateBankElevationMeters(candidate) : 19;
    return {
      id: site.id,
      longitude: site.longitude,
      latitude: site.latitude,
      outflowHeadingDegrees: site.outflowHeadingDegrees,
      intensity: site.intensity,
      bankElevationMeters,
    };
  });
}

function ringToHierarchy(
  ring: ReadonlyArray<{ longitude: number; latitude: number }>,
): PolygonHierarchy {
  const degrees: number[] = [];
  for (const point of ring) {
    degrees.push(point.longitude, point.latitude);
  }
  return new PolygonHierarchy(Cartesian3.fromDegreesArray(degrees));
}

function depthBandColor(band: InundationBand): Color {
  if (band.minDepthMeters >= 1.0) {
    return Color.fromCssColorString("#0a4f7a").withAlpha(0.68);
  }
  if (band.minDepthMeters >= 0.5) {
    return Color.fromCssColorString("#1274a8").withAlpha(0.55);
  }
  if (band.minDepthMeters >= 0.2) {
    return Color.fromCssColorString("#1c9ccc").withAlpha(0.44);
  }
  return Color.fromCssColorString("#5ec8e8").withAlpha(0.32);
}

function depthBandColorByIndex(bandIndex: number): Color {
  return DEPTH_BAND_COLORS[Math.min(DEPTH_BAND_COLORS.length - 1, bandIndex)]!;
}

const FLOW_COLOR = Color.fromCssColorString("#b8f4ff");
const DEPTH_BAND_COLORS = ["#5ec8e8", "#1c9ccc", "#1274a8", "#0a4f7a"].map((color) =>
  Color.fromCssColorString(color),
);

function offsetLonLat(
  longitude: number,
  latitude: number,
  east: number,
  north: number,
): { longitude: number; latitude: number } {
  const metersPerDegreeLat = 110_540;
  const metersPerDegreeLon = 111_320 * Math.cos(CesiumMath.toRadians(latitude));
  return {
    longitude: longitude + east / metersPerDegreeLon,
    latitude: latitude + north / metersPerDegreeLat,
  };
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

/** 0..1 の決定論的な擬似乱数（可視化の位相用。暗号用途ではない）。 */
function visualUnit(seed: number): number {
  const x = Math.sin(seed) * 43_758.545_312_3;
  return x - Math.floor(x);
}
