import {
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

const FLOW_STREAK_COUNT = 10;
const FLOW_STREAK_SEGMENT_POINTS = 4;
/** 平常時の流向周期（秒）。短いほど速く見える。 */
const BASE_FLOW_PERIOD_SECONDS = 10;
const RIVER_VOLUME_ENTITY_ID = "river-volume-body";
const INITIAL_RIVER_LEVEL_METERS = 2.2;

export type RiverHydraulics = {
  riverLevelMeters: number;
  rainfallIntensity: number;
  /** 計画高水位超過分（m）。水量の膨らみ表現に使う。 */
  overflowMeters: number;
  /** 災害フェーズ中は流れを強める。 */
  activeFlood: boolean;
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
};

/**
 * 阿武隈川の水面を Cesium Water マテリアルで描き、流向ストリークを流す。
 * `requestRenderMode` 利用時は呼び出し側で毎フレーム `requestRender` すること。
 */
export async function createRiverWaterSurface(
  viewer: Viewer,
): Promise<RiverWaterSurfaceController> {
  await GroundPrimitive.initializeTerrainHeights();
  if (viewer.isDestroyed()) {
    return noopController();
  }

  const centerlineDegrees = flattenCenterline();
  const samples = buildFlowSamples();
  const totalLength = samples[samples.length - 1]?.distance ?? 1;

  let widthMeters = 96;
  const waterMaterial = Material.fromType("Water", {
    baseWaterColor: Color.fromCssColorString("#1a7eb8").withAlpha(0.72),
    blendColor: Color.fromCssColorString("#0b3d5c").withAlpha(0.35),
    normalMap: WATER_NORMAL_MAP_URL,
    frequency: 900,
    animationSpeed: 0.018,
    amplitude: 2.4,
    specularIntensity: 0.55,
    fadeFactor: 0.9,
  });

  let waterPrimitive = createWaterPrimitive(centerlineDegrees, widthMeters, waterMaterial);
  viewer.scene.groundPrimitives.add(waterPrimitive);

  // 水位上昇を立体の水量帯として見せる（GroundPrimitive は厚みを持たないため Entity で補う）。
  const volumeEntity = viewer.entities.add({
    id: RIVER_VOLUME_ENTITY_ID,
    corridor: {
      positions: Cartesian3.fromDegreesArray(centerlineDegrees),
      width: widthMeters * 0.92,
      // height + extrudedHeight で水量の厚みを表現する
      height: 0.05,
      extrudedHeight: 0.35,
      heightReference: HeightReference.RELATIVE_TO_GROUND,
      extrudedHeightReference: HeightReference.RELATIVE_TO_GROUND,
      material: Color.fromCssColorString("#1280b8").withAlpha(0.38),
      outline: false,
      cornerType: CornerType.ROUNDED,
    },
  });

  const streaks = createFlowStreaks(viewer);
  let flowPeriodSeconds = BASE_FLOW_PERIOD_SECONDS;
  const startedAt = performance.now();

  const removePreUpdate = viewer.scene.preUpdate.addEventListener(() => {
    if (viewer.isDestroyed()) {
      return;
    }
    const elapsedSeconds = (performance.now() - startedAt) / 1000;
    for (const streak of streaks) {
      const head = (streak.phase + elapsedSeconds / flowPeriodSeconds) % 1;
      if (streak.entity.polyline !== undefined) {
        streak.entity.polyline.positions = new ConstantProperty(
          sampleArcWindow(samples, totalLength, head, 85),
        );
      }
    }
  });

  const setHydraulics = (hydraulics: RiverHydraulics) => {
    if (viewer.isDestroyed()) {
      return;
    }
    const levelRise = Math.max(0, hydraulics.riverLevelMeters - INITIAL_RIVER_LEVEL_METERS);
    const levelRatio = Math.min(1, levelRise / 4.4);
    const rain = Math.min(1, Math.max(0, hydraulics.rainfallIntensity));
    const overflow = Math.max(0, hydraulics.overflowMeters);
    const nextWidth =
      78 + levelRatio * 58 + overflow * 18 + (hydraulics.activeFlood ? 10 : 0);

    waterMaterial.uniforms.animationSpeed =
      0.014 +
      levelRatio * 0.02 +
      rain * 0.018 +
      overflow * 0.015 +
      (hydraulics.activeFlood ? 0.012 : 0);
    waterMaterial.uniforms.amplitude = 2.1 + levelRatio * 2.4 + rain * 1.4 + overflow * 1.8;
    waterMaterial.uniforms.baseWaterColor = Color.fromCssColorString(
      overflow > 0.35 ? "#0c4f7a" : levelRatio > 0.65 ? "#0f5f96" : levelRatio > 0.3 ? "#1784bc" : "#1f96c9",
    ).withAlpha(0.62 + levelRatio * 0.2 + Math.min(0.15, overflow * 0.12));
    waterMaterial.uniforms.blendColor = Color.fromCssColorString("#06263d").withAlpha(
      0.28 + rain * 0.12 + Math.min(0.18, overflow * 0.1),
    );
    waterMaterial.uniforms.specularIntensity = 0.45 + levelRatio * 0.2 + overflow * 0.1;
    flowPeriodSeconds = Math.max(
      3.8,
      BASE_FLOW_PERIOD_SECONDS -
        levelRatio * 3 -
        rain * 2.5 -
        overflow * 2 -
        (hydraulics.activeFlood ? 2 : 0),
    );

    for (const streak of streaks) {
      if (streak.entity.polyline !== undefined) {
        streak.entity.polyline.width = new ConstantProperty(
          5 + levelRatio * 5 + overflow * 3 + (hydraulics.activeFlood ? 3 : 0),
        );
      }
    }

    // 水位に応じて水量帯を膨らませる（押し出し高さ＝増水の視認性）
    if (volumeEntity.corridor !== undefined) {
      volumeEntity.corridor.width = new ConstantProperty(nextWidth * 0.94);
      volumeEntity.corridor.height = new ConstantProperty(0.05);
      volumeEntity.corridor.extrudedHeight = new ConstantProperty(
        0.3 + levelRise * 0.55 + overflow * 0.75,
      );
      volumeEntity.corridor.material = new ColorMaterialProperty(
        Color.fromCssColorString(overflow > 0.2 ? "#0d6fa8" : "#1280b8").withAlpha(
          0.32 + levelRatio * 0.28 + Math.min(0.2, overflow * 0.15),
        ),
      );
    }

    if (Math.abs(nextWidth - widthMeters) > 1.5) {
      widthMeters = nextWidth;
      viewer.scene.groundPrimitives.remove(waterPrimitive);
      if (!waterPrimitive.isDestroyed()) {
        waterPrimitive.destroy();
      }
      waterPrimitive = createWaterPrimitive(centerlineDegrees, widthMeters, waterMaterial);
      viewer.scene.groundPrimitives.add(waterPrimitive);
    }
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
  for (let index = 0; index < FLOW_STREAK_COUNT; index += 1) {
    const phase = index / FLOW_STREAK_COUNT;
    const entity = viewer.entities.add({
      id: `river-flow-streak-${index}`,
      polyline: {
        positions: Cartesian3.fromDegreesArray([
          ABUKUMA_RIVER_CENTERLINE[0]!.lon,
          ABUKUMA_RIVER_CENTERLINE[0]!.lat,
          ABUKUMA_RIVER_CENTERLINE[1]!.lon,
          ABUKUMA_RIVER_CENTERLINE[1]!.lat,
        ]),
        width: 7,
        clampToGround: true,
        material: new PolylineGlowMaterialProperty({
          glowPower: 0.22,
          taperPower: 0.35,
          color: Color.fromCssColorString("#d7f4ff").withAlpha(0.55),
        }),
      },
    });
    streaks.push({ entity, phase });
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

function buildFlowSamples(): FlowSample[] {
  const samples: FlowSample[] = [];
  let distance = 0;
  let previous: { lon: number; lat: number } | undefined;
  for (const point of ABUKUMA_RIVER_CENTERLINE) {
    if (previous !== undefined) {
      distance += haversineMeters(previous.lat, previous.lon, point.lat, point.lon);
    }
    samples.push({ lon: point.lon, lat: point.lat, distance });
    previous = point;
  }
  return samples;
}

function sampleArcWindow(
  samples: FlowSample[],
  totalLength: number,
  headNormalized: number,
  windowMeters: number,
): Cartesian3[] {
  const headDistance = headNormalized * totalLength;
  const startDistance = Math.max(0, headDistance - windowMeters);
  const positions: number[] = [];
  for (let index = 0; index < FLOW_STREAK_SEGMENT_POINTS; index += 1) {
    const t = index / (FLOW_STREAK_SEGMENT_POINTS - 1);
    const distance = startDistance + (headDistance - startDistance) * t;
    const point = interpolateAlongSamples(samples, distance);
    positions.push(point.lon, point.lat);
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
