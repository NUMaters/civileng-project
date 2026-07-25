import {
  CallbackProperty,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  CornerType,
  HeightReference,
  Viewer,
} from "cesium";
import {
  ABUKUMA_RIVER_CENTERLINE,
  NEAR_OVERFLOW_FLOODPLAIN_HALF_WIDTH_M,
} from "./abukumaRiverGeometry";

const FILL_ENTITY_ID = "floodplain-near-overflow-fill";
const EDGE_ENTITY_ID = "floodplain-near-overflow-edge";
/** 表示幅・透明度を目標へ寄せる速さ。 */
const VISUAL_LERP_RATE = 2.1;

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

  const fillColor = Color.fromCssColorString("#1a88b5").withAlpha(0.01);
  const edgeColor = Color.fromCssColorString("#7ec8e8").withAlpha(0.01);

  const fillEntity = viewer.entities.add({
    id: FILL_ENTITY_ID,
    show: false,
    corridor: {
      positions: centerlinePositions,
      width: new CallbackProperty(() => displayedWidth, false),
      height: 0.03,
      heightReference: HeightReference.RELATIVE_TO_GROUND,
      material: new ColorMaterialProperty(
        new CallbackProperty(() => Color.clone(fillColor), false),
      ),
      outline: false,
      cornerType: CornerType.ROUNDED,
    },
  });

  const edgeEntity = viewer.entities.add({
    id: EDGE_ENTITY_ID,
    show: false,
    corridor: {
      positions: centerlinePositions,
      width: new CallbackProperty(() => displayedWidth + 14, false),
      height: 0.05,
      heightReference: HeightReference.RELATIVE_TO_GROUND,
      material: new ColorMaterialProperty(
        new CallbackProperty(() => Color.clone(edgeColor), false),
      ),
      outline: false,
      cornerType: CornerType.ROUNDED,
    },
  });

  const applyColors = (fill: number, overflow: number) => {
    // 増水〜氾濫で岸沿いの冠水帯がはっきり見えるよう、不透明度を強めに取る。
    const alpha = Math.max(0, 0.12 + fill * 0.42 + Math.min(0.28, overflow * 0.2));
    // 立ち上がりは水色、越水時は濁った氾濫水へ寄せる。
    Color.lerp(
      Color.fromCssColorString("#3ab0d4"),
      Color.fromCssColorString("#184858"),
      Math.min(1, fill * 0.7 + overflow * 1.15),
      fillColor,
    );
    fillColor.alpha = alpha;
    edgeColor.red = 0.72;
    edgeColor.green = 0.94;
    edgeColor.blue = 1;
    edgeColor.alpha = 0.16 + fill * 0.34 + Math.min(0.18, overflow * 0.14);
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
      Math.abs(nextFill - displayedFill) > 0.001 ||
      Math.abs(nextWidth - displayedWidth) > 0.15 ||
      Math.abs(nextOverflow - displayedOverflow) > 0.001;

    displayedFill = nextFill;
    displayedWidth = nextWidth;
    displayedOverflow = nextOverflow;

    // show の二値切替ではなく、透明度でフェードイン／アウトする。
    const visible = displayedFill > 0.004;
    if (fillEntity.show !== visible || edgeEntity.show !== visible) {
      fillEntity.show = visible;
      edgeEntity.show = visible;
    }

    if (changed || visible) {
      applyColors(displayedFill, displayedOverflow);
      viewer.scene.requestRender();
    }
  });

  return {
    setTarget: (input) => {
      // 河道沿いの広域水色帯は「街が浸水」に見えるため描画しない。
      // 浸水表現は決壊地点の overflow / inundation 可視化に限定する。
      void input;
      targetFill = 0;
      targetOverflow = 0;
      targetWidth = 0;
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
