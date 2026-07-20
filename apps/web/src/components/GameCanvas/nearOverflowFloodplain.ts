import {
  Cartesian3,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  CornerType,
  HeightReference,
  Viewer,
} from "cesium";
import { calculateFloodplainExtent } from "../../features/disaster/services/floodplainExtent";
import {
  ABUKUMA_RIVER_CENTERLINE,
  NEAR_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M,
} from "./abukumaRiverGeometry";

const FILL_ENTITY_ID = "floodplain-near-overflow-fill";
const EDGE_ENTITY_ID = "floodplain-near-overflow-edge";
/** 表示幅・透明度を目標へ寄せる速さ。 */
const VISUAL_LERP_RATE = 1.15;

export type NearOverflowFloodplainInput = {
  riverLevelMeters: number;
  overflowMeters: number;
  /** 施設効果込みの越水開始水位（m）。未指定時は 4.9。 */
  overflowLevelMeters?: number;
  active: boolean;
};

type FloodplainController = {
  setTarget: (input: NearOverflowFloodplainInput) => void;
  destroy: () => void;
};

const controllers = new WeakMap<Viewer, FloodplainController>();

/**
 * 氾濫原を Entity コリドーで描き、幅・透明度を毎フレーム補間する。
 * 毎秒の remove/add を避け、浸水域が自然に広がって見えるようにする。
 */
export function syncNearOverflowFloodplain(
  viewer: Viewer,
  input: NearOverflowFloodplainInput,
): void {
  let controller = controllers.get(viewer);
  if (controller === undefined) {
    controller = createFloodplainController(viewer);
    controllers.set(viewer, controller);
  }
  controller.setTarget(input);
}

export function destroyNearOverflowFloodplain(viewer: Viewer): void {
  const controller = controllers.get(viewer);
  if (controller === undefined) {
    return;
  }
  controller.destroy();
  controllers.delete(viewer);
}

export function getDefaultNearOverflowHalfWidthMeters(): number {
  return NEAR_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M;
}

function createFloodplainController(viewer: Viewer): FloodplainController {
  const centerlinePositions = Cartesian3.fromDegreesArray(flattenCenterline());

  let targetFill = 0;
  let targetWidth = NEAR_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M * 2;
  let targetOverflow = 0;
  let displayedFill = 0;
  let displayedWidth = NEAR_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M * 2;
  let displayedOverflow = 0;
  let lastFrameAt = performance.now();

  const fillEntity = viewer.entities.add({
    id: FILL_ENTITY_ID,
    show: false,
    corridor: {
      positions: centerlinePositions,
      width: displayedWidth,
      height: 0.03,
      heightReference: HeightReference.RELATIVE_TO_GROUND,
      material: Color.fromCssColorString("#1a88b5").withAlpha(0.01),
      outline: false,
      cornerType: CornerType.ROUNDED,
    },
  });

  const edgeEntity = viewer.entities.add({
    id: EDGE_ENTITY_ID,
    show: false,
    corridor: {
      positions: centerlinePositions,
      width: displayedWidth,
      height: 0.05,
      heightReference: HeightReference.RELATIVE_TO_GROUND,
      material: Color.fromCssColorString("#7ec8e8").withAlpha(0.01),
      outline: false,
      cornerType: CornerType.ROUNDED,
    },
  });

  const apply = (fill: number, width: number, overflow: number) => {
    const visible = fill > 0.02;
    fillEntity.show = visible;
    edgeEntity.show = visible;
    if (!visible || fillEntity.corridor === undefined || edgeEntity.corridor === undefined) {
      return;
    }

    const alpha = 0.05 + fill * 0.22 + Math.min(0.16, overflow * 0.1);
    const fillColor = Color.lerp(
      Color.fromCssColorString("#1a88b5"),
      Color.fromCssColorString("#0d6a96"),
      Math.min(1, overflow * 1.2),
      new Color(),
    ).withAlpha(alpha);

    fillEntity.corridor.width = new ConstantProperty(width);
    fillEntity.corridor.material = new ColorMaterialProperty(fillColor);

    // 外縁はわずかに広い半透明帯で「広がる範囲」を示す。
    edgeEntity.corridor.width = new ConstantProperty(width + 14);
    edgeEntity.corridor.material = new ColorMaterialProperty(
      Color.fromCssColorString("#7ec8e8").withAlpha(0.08 + fill * 0.18),
    );
  };

  const removePreUpdate = viewer.scene.preUpdate.addEventListener(() => {
    if (viewer.isDestroyed()) {
      return;
    }
    const now = performance.now();
    const deltaSeconds = Math.min(0.05, Math.max(0.001, (now - lastFrameAt) / 1000));
    lastFrameAt = now;
    const alpha = 1 - Math.exp(-VISUAL_LERP_RATE * deltaSeconds);

    const nextFill = lerp(displayedFill, targetFill, alpha);
    const nextWidth = lerp(displayedWidth, targetWidth, alpha);
    const nextOverflow = lerp(displayedOverflow, targetOverflow, alpha);

    const changed =
      Math.abs(nextFill - displayedFill) > 0.002 ||
      Math.abs(nextWidth - displayedWidth) > 0.4 ||
      Math.abs(nextOverflow - displayedOverflow) > 0.002;

    displayedFill = nextFill;
    displayedWidth = nextWidth;
    displayedOverflow = nextOverflow;

    if (changed || (targetFill > 0.02 && !fillEntity.show)) {
      apply(displayedFill, displayedWidth, displayedOverflow);
      viewer.scene.requestRender();
    }
  });

  return {
    setTarget: (input) => {
      if (!input.active) {
        targetFill = 0;
        targetOverflow = 0;
        viewer.scene.requestRender();
        return;
      }
      const extent = calculateFloodplainExtent({
        riverLevelMeters: input.riverLevelMeters,
        overflowMeters: input.overflowMeters,
        overflowLevelMeters: input.overflowLevelMeters,
      });
      targetFill = extent.fillRatio;
      targetWidth = extent.halfWidthMeters * 2;
      targetOverflow = Math.max(0, input.overflowMeters);
      viewer.scene.requestRender();
    },
    destroy: () => {
      removePreUpdate();
      if (!viewer.isDestroyed()) {
        viewer.entities.remove(fillEntity);
        viewer.entities.remove(edgeEntity);
      }
    },
  };
}

function flattenCenterline(): number[] {
  const degrees: number[] = [];
  for (const point of ABUKUMA_RIVER_CENTERLINE) {
    degrees.push(point.lon, point.lat);
  }
  return degrees;
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}
