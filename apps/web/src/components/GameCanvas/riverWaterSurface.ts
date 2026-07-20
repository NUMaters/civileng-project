import {
  CallbackProperty,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  CornerType,
  CorridorGeometry,
  EllipsoidSurfaceAppearance,
  GeometryInstance,
  GroundPrimitive,
  HeightReference,
  Material,
  PolylineGlowMaterialProperty,
  Viewer,
  type Entity,
} from "cesium";
import { ABUKUMA_RIVER_CENTERLINE } from "./abukumaRiverGeometry";

/** Cesium 同梱の水面法線。開発時は `/cesiumStatic` 経由で配信する。 */
const WATER_NORMAL_MAP_URL = "/cesiumStatic/Assets/Textures/waterNormalsSmall.jpg";

const FLOW_STREAK_COUNT = 14;
const FLOW_STREAK_SEGMENT_POINTS = 7;
/** 平常時の流向周期（秒）。短いほど速く見える。下流方向への流れ。 */
const BASE_FLOW_PERIOD_SECONDS = 8.5;
/** ストリーク長（m）。先頭が下流側。 */
const FLOW_STREAK_LENGTH_M = 120;
/** 河道横断方向に並べるレーンの半幅（m）。 */
const FLOW_LANE_HALF_SPAN_M = 22;
const RIVER_VOLUME_ENTITY_ID = "river-volume-body";
const INITIAL_RIVER_LEVEL_METERS = 2.2;
/** GroundPrimitive は再生成するとチラつくため固定幅にする。 */
const BASE_WATER_PRIMITIVE_WIDTH_M = 88;
/**
 * 表示値を目標へ寄せる速さ（1/s）。
 * 速すぎると目標の微振動が目立ち、遅すぎると遅れが段差に見えるため中庸にする。
 */
const VISUAL_LERP_RATE = 2.4;

export type RiverHydraulics = {
  riverLevelMeters: number;
  rainfallIntensity: number;
  /** 計画高水位超過分（m）。水量の膨らみ表現に使う。 */
  overflowMeters: number;
  /** 災害フェーズ中は流れを強める。 */
  activeFlood: boolean;
  /** 0〜1。施設の治水効果で波・流速を抑えて「効いている」感を出す。 */
  mitigationCalm?: number;
};

export type RiverWaterSurfaceController = {
  setHydraulics: (hydraulics: RiverHydraulics) => void;
  destroy: () => void;
};

type FlowSample = {
  lon: number;
  lat: number;
  distance: number;
};

type StreakHandle = {
  entity: Entity;
  phase: number;
  /** 中心線からの横断オフセット（m）。右岸＋／左岸−。 */
  laneOffsetMeters: number;
};

type VisualHydraulics = {
  levelRatio: number;
  rain: number;
  overflow: number;
  activeFlood: number;
  calm: number;
  widthMeters: number;
  extrudeMeters: number;
};

/**
 * 阿武隈川の水面を Cesium Water マテリアルで描き、流向ストリークを流す。
 * 水位変化は Entity の水量帯を補間して表現し、GroundPrimitive は再生成しない。
 */
export async function createRiverWaterSurface(
  viewer: Viewer,
): Promise<RiverWaterSurfaceController> {
  await GroundPrimitive.initializeTerrainHeights();
  if (viewer.isDestroyed()) {
    return noopController();
  }

  const centerlineDegrees = flattenCenterline();
  // 中心線配列は南→北なので、流向サンプルは北→南（下流）に並べ替える。
  const samples = buildDownstreamFlowSamples();
  const totalLength = samples[samples.length - 1]?.distance ?? 1;
  const centerlinePositions = Cartesian3.fromDegreesArray(centerlineDegrees);

  const waterMaterial = Material.fromType("Water", {
    baseWaterColor: Color.fromCssColorString("#1f96c9").withAlpha(0.68),
    blendColor: Color.fromCssColorString("#0b3d5c").withAlpha(0.32),
    normalMap: WATER_NORMAL_MAP_URL,
    frequency: 900,
    animationSpeed: 0.016,
    amplitude: 2.2,
    specularIntensity: 0.5,
    fadeFactor: 0.9,
  });

  // 固定幅の本川水面。幅の増減は下の水量帯 Entity で滑らかに見せる。
  const waterPrimitive = createWaterPrimitive(
    centerlineDegrees,
    BASE_WATER_PRIMITIVE_WIDTH_M,
    waterMaterial,
  );
  viewer.scene.groundPrimitives.add(waterPrimitive);

  let target = hydraulicsToVisual({
    riverLevelMeters: INITIAL_RIVER_LEVEL_METERS,
    rainfallIntensity: 0,
    overflowMeters: 0,
    activeFlood: false,
  });
  let displayed: VisualHydraulics = { ...target };
  const volumeColor = Color.fromCssColorString("#1280b8").withAlpha(0.34);

  // ConstantProperty の毎フレーム差し替えは corridor 再評価で段差に見えるため Callback で読む。
  const volumeEntity = viewer.entities.add({
    id: RIVER_VOLUME_ENTITY_ID,
    corridor: {
      positions: centerlinePositions,
      width: new CallbackProperty(() => displayed.widthMeters * 0.96, false),
      height: 0.05,
      extrudedHeight: new CallbackProperty(() => displayed.extrudeMeters, false),
      heightReference: HeightReference.RELATIVE_TO_GROUND,
      extrudedHeightReference: HeightReference.RELATIVE_TO_GROUND,
      material: new ColorMaterialProperty(
        new CallbackProperty(() => Color.clone(volumeColor), false),
      ),
      outline: false,
      cornerType: CornerType.ROUNDED,
    },
  });

  const streaks = createFlowStreaks(viewer);
  let flowPeriodSeconds = BASE_FLOW_PERIOD_SECONDS;
  const startedAt = performance.now();
  let lastFrameAt = startedAt;
  let lastStreakStyleKey = "";

  const applyDisplayed = (visual: VisualHydraulics) => {
    const { levelRatio, rain, overflow, activeFlood, calm } = visual;
    const calmFactor = 1 - calm * 0.55;

    waterMaterial.uniforms.animationSpeed =
      (0.014 + levelRatio * 0.02 + rain * 0.018 + overflow * 0.015 + activeFlood * 0.01) *
      calmFactor;
    waterMaterial.uniforms.amplitude =
      (2.1 + levelRatio * 2.4 + rain * 1.4 + overflow * 1.8) * calmFactor;
    waterMaterial.uniforms.baseWaterColor = Color.lerp(
      Color.fromCssColorString("#1f96c9"),
      Color.fromCssColorString("#0c4f7a"),
      clamp01(levelRatio * 0.75 + overflow * 0.35),
      new Color(),
    ).withAlpha(0.62 + levelRatio * 0.2 + Math.min(0.15, overflow * 0.12));
    waterMaterial.uniforms.blendColor = Color.fromCssColorString("#06263d").withAlpha(
      0.28 + rain * 0.12 + Math.min(0.18, overflow * 0.1),
    );
    waterMaterial.uniforms.specularIntensity = 0.45 + levelRatio * 0.2 + overflow * 0.1;
    flowPeriodSeconds = Math.max(
      3.8,
      (BASE_FLOW_PERIOD_SECONDS - levelRatio * 3 - rain * 2.5 - overflow * 2 - activeFlood * 1.5) *
        (1 + calm * 0.45),
    );

    Color.lerp(
      Color.fromCssColorString("#1280b8"),
      Color.fromCssColorString("#0d6fa8"),
      clamp01(overflow * 1.2),
      volumeColor,
    );
    volumeColor.alpha = 0.3 + levelRatio * 0.28 + Math.min(0.22, overflow * 0.15);

    // ストリークの見た目は細かく変えても差が小さいので間引き更新する。
    const streakStyleKey = `${(levelRatio * 20).toFixed(0)}:${(overflow * 10).toFixed(0)}:${activeFlood.toFixed(0)}`;
    if (streakStyleKey !== lastStreakStyleKey) {
      lastStreakStyleKey = streakStyleKey;
      for (const streak of streaks) {
        if (streak.entity.polyline !== undefined) {
          streak.entity.polyline.width = new ConstantProperty(
            6 + levelRatio * 5 + overflow * 3 + activeFlood * 2,
          );
          streak.entity.polyline.material = new PolylineGlowMaterialProperty({
            glowPower: 0.28 + levelRatio * 0.08,
            taperPower: 0.62,
            color: Color.fromCssColorString("#eaf8ff").withAlpha(
              0.42 + levelRatio * 0.2 + overflow * 0.12,
            ),
          });
        }
      }
    }
  };

  applyDisplayed(displayed);

  const removePreUpdate = viewer.scene.preUpdate.addEventListener(() => {
    if (viewer.isDestroyed()) {
      return;
    }
    const now = performance.now();
    const deltaSeconds = Math.min(0.05, Math.max(0.001, (now - lastFrameAt) / 1000));
    lastFrameAt = now;

    const elapsedSeconds = (now - startedAt) / 1000;
    for (const streak of streaks) {
      // 下流方向（北→南）へ進む。先頭が下流側になるようウィンドウを取る。
      const head = (streak.phase + elapsedSeconds / flowPeriodSeconds) % 1;
      if (streak.entity.polyline !== undefined) {
        streak.entity.polyline.positions = new ConstantProperty(
          sampleDownstreamArcWindow(
            samples,
            totalLength,
            head,
            FLOW_STREAK_LENGTH_M,
            streak.laneOffsetMeters,
          ),
        );
      }
    }

    const alpha = 1 - Math.exp(-VISUAL_LERP_RATE * deltaSeconds);
    const nextDisplayed: VisualHydraulics = {
      levelRatio: lerp(displayed.levelRatio, target.levelRatio, alpha),
      rain: lerp(displayed.rain, target.rain, alpha),
      overflow: lerp(displayed.overflow, target.overflow, alpha),
      activeFlood: lerp(displayed.activeFlood, target.activeFlood, alpha),
      calm: lerp(displayed.calm, target.calm, alpha),
      widthMeters: lerp(displayed.widthMeters, target.widthMeters, alpha),
      extrudeMeters: lerp(displayed.extrudeMeters, target.extrudeMeters, alpha),
    };

    const changed =
      Math.abs(nextDisplayed.widthMeters - displayed.widthMeters) > 0.05 ||
      Math.abs(nextDisplayed.extrudeMeters - displayed.extrudeMeters) > 0.01 ||
      Math.abs(nextDisplayed.levelRatio - displayed.levelRatio) > 0.002 ||
      Math.abs(nextDisplayed.rain - displayed.rain) > 0.002 ||
      Math.abs(nextDisplayed.overflow - displayed.overflow) > 0.002 ||
      Math.abs(nextDisplayed.calm - displayed.calm) > 0.002;

    displayed = nextDisplayed;
    if (changed) {
      applyDisplayed(displayed);
      viewer.scene.requestRender();
    }
  });

  const setHydraulics = (hydraulics: RiverHydraulics) => {
    if (viewer.isDestroyed()) {
      return;
    }
    target = hydraulicsToVisual(hydraulics);
    viewer.scene.requestRender();
  };

  setHydraulics({
    riverLevelMeters: INITIAL_RIVER_LEVEL_METERS,
    rainfallIntensity: 0,
    overflowMeters: 0,
    activeFlood: false,
  });

  return {
    setHydraulics,
    destroy: () => {
      removePreUpdate();
      if (!viewer.isDestroyed()) {
        viewer.scene.groundPrimitives.remove(waterPrimitive);
        viewer.entities.remove(volumeEntity);
        for (const streak of streaks) {
          viewer.entities.remove(streak.entity);
        }
      }
      if (!waterPrimitive.isDestroyed()) {
        waterPrimitive.destroy();
      }
    },
  };
}

function hydraulicsToVisual(hydraulics: RiverHydraulics): VisualHydraulics {
  const levelRise = Math.max(0, hydraulics.riverLevelMeters - INITIAL_RIVER_LEVEL_METERS);
  const levelRatio = Math.min(1, levelRise / 4.4);
  const rain = clamp01(hydraulics.rainfallIntensity);
  const overflow = Math.max(0, hydraulics.overflowMeters);
  const activeFlood = hydraulics.activeFlood ? 1 : 0;
  const calm = clamp01(hydraulics.mitigationCalm ?? 0);
  // 災害開始の瞬間に幅が跳ねないよう、activeFlood は水位比率に乗せる。
  // 幅より押し出し高さで増水を見せると、段差より連続した水位上昇に見えやすい。
  const widthMeters =
    80 +
    levelRatio * 36 * (1 - calm * 0.2) +
    overflow * 12 * (1 - calm * 0.35) +
    activeFlood * levelRatio * 6;
  const extrudeMeters =
    0.28 +
    levelRise * 0.85 * (1 - calm * 0.25) +
    overflow * 1.35 * (1 - calm * 0.3) +
    activeFlood * levelRatio * 0.22;
  return { levelRatio, rain, overflow, activeFlood, calm, widthMeters, extrudeMeters };
}

function noopController(): RiverWaterSurfaceController {
  return {
    setHydraulics: () => undefined,
    destroy: () => undefined,
  };
}

function createWaterPrimitive(
  centerlineDegrees: number[],
  widthMeters: number,
  material: Material,
): GroundPrimitive {
  return new GroundPrimitive({
    geometryInstances: new GeometryInstance({
      geometry: new CorridorGeometry({
        positions: Cartesian3.fromDegreesArray(centerlineDegrees),
        width: widthMeters,
        vertexFormat: EllipsoidSurfaceAppearance.VERTEX_FORMAT,
        cornerType: CornerType.ROUNDED,
      }),
      id: "abukuma-river-water",
    }),
    appearance: new EllipsoidSurfaceAppearance({
      material,
      aboveGround: false,
    }),
    asynchronous: true,
    interleave: true,
  });
}

function createFlowStreaks(viewer: Viewer): StreakHandle[] {
  const streaks: StreakHandle[] = [];
  const last = ABUKUMA_RIVER_CENTERLINE[ABUKUMA_RIVER_CENTERLINE.length - 1]!;
  const nearLast = ABUKUMA_RIVER_CENTERLINE[ABUKUMA_RIVER_CENTERLINE.length - 2]!;
  for (let index = 0; index < FLOW_STREAK_COUNT; index += 1) {
    const phase = index / FLOW_STREAK_COUNT;
    // レーンを横断方向に分散（中央寄りを厚く）
    const laneT = FLOW_STREAK_COUNT <= 1 ? 0 : index / (FLOW_STREAK_COUNT - 1);
    const laneOffsetMeters = (laneT * 2 - 1) * FLOW_LANE_HALF_SPAN_M;
    const entity = viewer.entities.add({
      id: `river-flow-streak-${index}`,
      polyline: {
        // 初期は上流寄り（北）から下流へ向かう短い線
        positions: Cartesian3.fromDegreesArray([
          last.lon,
          last.lat,
          nearLast.lon,
          nearLast.lat,
        ]),
        width: 7,
        clampToGround: true,
        material: new PolylineGlowMaterialProperty({
          glowPower: 0.28,
          taperPower: 0.62,
          color: Color.fromCssColorString("#eaf8ff").withAlpha(0.5),
        }),
      },
    });
    streaks.push({ entity, phase, laneOffsetMeters });
  }
  return streaks;
}

function flattenCenterline(): number[] {
  const degrees: number[] = [];
  for (const point of ABUKUMA_RIVER_CENTERLINE) {
    degrees.push(point.lon, point.lat);
  }
  return degrees;
}

/**
 * 下流方向（北→南）に沿ったサンプリング点列。
 * `ABUKUMA_RIVER_CENTERLINE` は南→北なので逆順で距離を積算する。
 */
function buildDownstreamFlowSamples(): FlowSample[] {
  const samples: FlowSample[] = [];
  let distance = 0;
  let previous: { lon: number; lat: number } | undefined;
  for (let index = ABUKUMA_RIVER_CENTERLINE.length - 1; index >= 0; index -= 1) {
    const point = ABUKUMA_RIVER_CENTERLINE[index]!;
    if (previous !== undefined) {
      distance += haversineMeters(previous.lat, previous.lon, point.lat, point.lon);
    }
    samples.push({ lon: point.lon, lat: point.lat, distance });
    previous = point;
  }
  return samples;
}

/**
 * 下流へ進むストリーク。positions の末尾が先端（下流側）になり、テーパーで矢印感を出す。
 */
function sampleDownstreamArcWindow(
  samples: FlowSample[],
  totalLength: number,
  headNormalized: number,
  windowMeters: number,
  laneOffsetMeters: number,
): Cartesian3[] {
  const headDistance = headNormalized * totalLength;
  const startDistance = Math.max(0, headDistance - windowMeters);
  const positions: number[] = [];
  for (let index = 0; index < FLOW_STREAK_SEGMENT_POINTS; index += 1) {
    const t = index / (FLOW_STREAK_SEGMENT_POINTS - 1);
    const distance = startDistance + (headDistance - startDistance) * t;
    const point = interpolateAlongSamples(samples, distance);
    const bearing = bearingAlongSamples(samples, distance);
    const offset = offsetMeters(point, bearing + Math.PI / 2, laneOffsetMeters);
    positions.push(offset.lon, offset.lat);
  }
  return Cartesian3.fromDegreesArray(positions);
}

function interpolateAlongSamples(
  samples: FlowSample[],
  distance: number,
): { lon: number; lat: number } {
  if (samples.length === 0) {
    return { lon: 0, lat: 0 };
  }
  if (distance <= 0) {
    return { lon: samples[0]!.lon, lat: samples[0]!.lat };
  }
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1]!;
    const current = samples[index]!;
    if (distance <= current.distance) {
      const span = Math.max(1e-3, current.distance - previous.distance);
      const t = (distance - previous.distance) / span;
      return {
        lon: previous.lon + (current.lon - previous.lon) * t,
        lat: previous.lat + (current.lat - previous.lat) * t,
      };
    }
  }
  const last = samples[samples.length - 1]!;
  return { lon: last.lon, lat: last.lat };
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** サンプル列上の進行方向（ラジアン。北=0、東=+π/2）。 */
function bearingAlongSamples(samples: FlowSample[], distance: number): number {
  const lookAhead = Math.min(samples[samples.length - 1]?.distance ?? distance, distance + 35);
  const from = interpolateAlongSamples(samples, Math.max(0, distance - 8));
  const to = interpolateAlongSamples(samples, lookAhead);
  const east = (to.lon - from.lon) * 111_320 * Math.cos((from.lat * Math.PI) / 180);
  const north = (to.lat - from.lat) * 110_540;
  return Math.atan2(east, north);
}

function offsetMeters(
  point: { lon: number; lat: number },
  bearingRadians: number,
  distanceMeters: number,
): { lon: number; lat: number } {
  const metersPerDegreeLat = 110_540;
  const metersPerDegreeLon = 111_320 * Math.cos((point.lat * Math.PI) / 180);
  const north = Math.cos(bearingRadians) * distanceMeters;
  const east = Math.sin(bearingRadians) * distanceMeters;
  return {
    lon: point.lon + east / metersPerDegreeLon,
    lat: point.lat + north / metersPerDegreeLat,
  };
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
