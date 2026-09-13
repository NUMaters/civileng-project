import {
  BoxGraphics,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Cesium3DTileset,
  CesiumTerrainProvider,
  Color,
  ColorMaterialProperty,
  Credit,
  CustomHeightmapTerrainProvider,
  CustomShader,
  CylinderGraphics,
  DirectionalLight,
  EllipsoidTerrainProvider,
  HeadingPitchRange,
  HeadingPitchRoll,
  ImageryLayer,
  Ion,
  LightingModel,
  Math as CesiumMath,
  Matrix4,
  sampleTerrainMostDetailed,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  ShadowMode,
  Transforms,
  UrlTemplateImageryProvider,
  Viewer,
  WebMercatorTilingScheme,
} from "cesium";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  RotationControls,
  type GeoPosition,
  type PlacedStructure,
  type StructureDefinition,
} from "../../features/construction";
import {
  applyOverflowTerrainElevations,
  listOverflowCandidates,
} from "../../features/disaster/services/overflowBankSites";
import { ABUKUMA_RIVER_CENTERLINE } from "./abukumaRiverGeometry";
import {
  destroyNearOverflowFloodplain,
  syncNearOverflowFloodplain,
} from "./nearOverflowFloodplain";
import {
  destroyInundationVisualization,
  syncInundationVisualization,
} from "./inundationVisualization";
import {
  clearLegacyFloodZones,
  destroyOverflowVisualization,
  syncOverflowVisualization,
} from "./overflowVisualization";
import { createPlaceableZone } from "./placeableZone";
import { syncProtectionVisualization, clearProtectionVisualization } from "./protectionVisualization";
import { nearestPointOnPolyline, resolvePlaceablePosition } from "./riverPlacement";
import { createRiverWaterSurface, type RiverWaterSurfaceController } from "./riverWaterSurface";
import { createStructureMaterial } from "./structureMaterials";
import { getStructureFootprintMeters, getStructureModelParts } from "./structureModels";
import {
  calculateStructureInfluences,
  type OverflowSite,
  type ProtectedBankSite,
  type StructureInfluence,
} from "../../features/disaster/services/floodSimulation";
import { resolveRainDrama } from "../../features/disaster/services/rainDrama";

const DRAG_GHOST_ENTITY_PREFIX = "drag-ghost";
const DRAG_GHOST_PLACEMENT_ID = "cursor";

// Avoid Cesium Ion default basemap requests (we use GSI / PLATEAU tiles).
Ion.defaultAccessToken = "";

/**
 * カメラ移動を許可する範囲（工学部〜阿武隈川の見える区間）。
 * 施設配置はこの内側かつ阿武隈川の河道・河岸コリドー上に限る。
 */
const PLAY_AREA = {
  west: 140.365,
  south: 37.347,
  east: 140.398,
  north: 37.388,
} as const;

/**
 * 画面中央の注視点が川から離れられる上限。
 * 配置帯より広く取り、全体俯瞰しやすくしつつ「川が画面外」を防ぐ。
 */
const CAMERA_FOCUS_MAX_DISTANCE_FROM_RIVER_M = 950;

/** ズーム距離（地表〜カメラ）。俯瞰で区間全体が見えるよう上限を緩める。 */
const CAMERA_MIN_ZOOM_DISTANCE_M = 180;
const CAMERA_MAX_ZOOM_DISTANCE_M = 9_500;

/** 初期スポーン。日本大学工学部周辺の阿武隈川河道上。河川が画面中央に見える斜め俯瞰。 */
const INITIAL_VIEW = {
  longitude: 140.3837,
  latitude: 37.3655,
  headingDegrees: 8,
  pitchDegrees: -40,
  range: 1_100,
} as const;

const GSI_DEM_MAX_LEVEL = 14;
const TERRAIN_HEIGHTMAP_SIZE = 32;
/**
 * 郡山周辺の概算ジオイド高 N（m）。
 * 地理院 DEM は正標高 H、Cesium / PLATEAU は楕円体高 h = H + N。
 */
const KORIYAMA_GEOID_UNDULATION_METERS = 39.5;
/**
 * 郡山市テクスチャ付き建築物（公式 3D Tiles ZIP の bldg_texture）。
 * `pnpm --filter @civilcraft/web fetch:plateau` で public へ展開する。
 * ※ PLATEAU VIEW の lod2-texture API はテクスチャ無しデータに解決されるため使わない。
 */
const PLATEAU_BUILDINGS_TEXTURE_URL = "/plateau/koriyama-bldg-texture/tileset.json";
/** API フォールバック（テクスチャ無し LOD1）。 */
const PLATEAU_BUILDINGS_LOD1_URL =
  "https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/07203-bldg-lod1-latest/tileset.json";
/** 写真付き建物は高負荷なため明示指定時のみ使用。LOD1でも実際の建物形状・高さは維持する。 */
const HIGH_DETAIL_BUILDINGS = import.meta.env.VITE_HIGH_DETAIL_BUILDINGS === "true";
/** ジオイド補正済み楕円体高の quantized-mesh（PLATEAU 建物と高さが揃う）。 */
const PLATEAU_TERRAIN_URL = "https://tile.plateauview.mlit.go.jp/terrain/";
/** 開発時はWebGLの同一オリジン制約を満たす地理院タイルプロキシを使う。 */
const GSI_SEAMLESS_PHOTO_URL = import.meta.env.DEV
  ? "/gsi-tiles/seamlessphoto/{z}/{x}/{y}.jpg"
  : "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg";
/** 施設ドラッグ移設を開始する画面移動量（CSS px）。 */
const MOVE_START_MOVE_PX = 14;
/** モデルを直接拾えなくても中心付近なら選択できる半径（CSS px）。 */
const PLACEMENT_PICK_RADIUS_PX = 72;
/** 仮配置の矢印キー微調整量（m）。 */
const NUDGE_METERS = 2.5;
/** 地形高が取れないとき・NaN のときのフォールバック標高（楕円体高 m）。 */
const FALLBACK_GROUND_HEIGHT_M = 18;

export type DragGhostStatus = {
  /** ポインタが地図キャンバス上にある。 */
  overMap: boolean;
  /** 河道・河岸の配置可能域上にある。 */
  placeable: boolean;
};

export type CesiumGameMapHandle = {
  tryDropStructure: (structureId: string, clientX: number, clientY: number) => boolean;
  /** ドラッグ中に設置予定モデルをカーソル下の地表へ追従表示する。 */
  updateDragGhost: (structureId: string, clientX: number, clientY: number) => DragGhostStatus;
  /** ドラッグ終了時にゴーストモデルを消す。 */
  clearDragGhost: () => void;
};

type CesiumGameMapProps = {
  placements: PlacedStructure[];
  structures: StructureDefinition[];
  selectedPlacementId: string | null;
  onDropPlace: (structureId: string, position: GeoPosition, headingDegrees: number) => void;
  onRotatePlacement: (placementId: string, headingDegrees: number) => void;
  /** 仮配置の位置微調整（確定前）。 */
  onMovePendingPlacement: (placementId: string, position: GeoPosition) => void;
  onSelectPlacement: (placementId: string | null) => void;
  onInvalidPosition: (message: string) => void;
  /** 仮配置の確定（施設上のチェック）。 */
  onConfirmPendingPlacement?: () => void;
  /** 仮配置のキャンセル（施設上の ×）。 */
  onCancelPendingPlacement?: () => void;
  /** カメラ操作終了時の画面中央注視点（プレイヤー移動の Phase 1 同期用）。 */
  onCameraFocusChange?: (position: GeoPosition) => void;
  floodState?: {
    active: boolean;
    /** 地図マーカー表示の切替用。idle では決壊・設置ガイドを出さない。 */
    phase: "idle" | "preparation" | "disaster" | "result" | "review";
    rainfallIntensity: number;
    riverLevelMeters: number;
    overflowMeters: number;
    floodDepthMeters: number;
    floodedAreaPercent: number;
    floodplainFillRatio: number;
    floodplainHalfWidthMeters: number;
    overflowLevelMeters?: number;
    overflowSites: OverflowSite[];
    protectedBankSites: ProtectedBankSite[];
    structureInfluences: StructureInfluence[];
    /** 0〜1。施設の治水で水面を穏やかに見せる。 */
    mitigationCalm: number;
  };
  /**
   * 毎フレームの最新洪水状態。指定時は本川・氾濫原の目標値を React 再描画より高頻度で更新する。
   */
  getLatestFloodState?: () => {
    phase: string;
    rainfallIntensity: number;
    riverLevelMeters: number;
    overflowMeters: number;
    floodDepthMeters: number;
    floodedAreaPercent: number;
    damagePercent: number;
    overflowLevelMeters: number;
    overflowSites: OverflowSite[];
    mitigation: {
      overflowPrevention: number;
      waterLevelReduction: number;
      channelCapacityIncrease: number;
    };
  };
  /** 結果プレビュー中など、川周辺へのカメラ拘束を外して自由に見回せる。 */
  freeCameraLook?: boolean;
  /**
   * ロビーへ戻ったあと地図を破棄せず裏に残すとき false。
   * 再表示時に resize / requestRender して真っ黒キャンバスを防ぐ。
   */
  mapActive?: boolean;
};

export const CesiumGameMap = forwardRef<CesiumGameMapHandle, CesiumGameMapProps>(
  function CesiumGameMap(
    {
      placements,
      structures,
      selectedPlacementId,
      onDropPlace,
      onRotatePlacement,
      onMovePendingPlacement,
      onSelectPlacement,
      onInvalidPosition,
      onConfirmPendingPlacement,
      onCancelPendingPlacement,
      onCameraFocusChange,
      floodState,
      getLatestFloodState,
      freeCameraLook = false,
      mapActive = true,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<Viewer | null>(null);
    const buildingTilesetRef = useRef<Cesium3DTileset | null>(null);
    const riverWaterRef = useRef<RiverWaterSurfaceController | null>(null);
    const placeableZoneRef = useRef<{ destroy: () => void } | null>(null);
    const floodStateRef = useRef(floodState);
    const getLatestFloodStateRef = useRef(getLatestFloodState);
    const freeCameraLookRef = useRef(freeCameraLook);
    const mapActiveRef = useRef(mapActive);
    const labelElementRefs = useRef(new Map<string, HTMLDivElement>());
    const orientationHudRef = useRef<HTMLDivElement | null>(null);
    const confirmHudRef = useRef<HTMLDivElement | null>(null);
    const placementsRef = useRef(placements);
    const structuresRef = useRef(structures);
    const onDropPlaceRef = useRef(onDropPlace);
    const onRotatePlacementRef = useRef(onRotatePlacement);
    const onMovePendingPlacementRef = useRef(onMovePendingPlacement);
    const onSelectPlacementRef = useRef(onSelectPlacement);
    const onInvalidPositionRef = useRef(onInvalidPosition);
    const onCameraFocusChangeRef = useRef(onCameraFocusChange);
    const selectedPlacementIdRef = useRef(selectedPlacementId);
    const dragGhostRafRef = useRef(0);
    const dragGhostLastKeyRef = useRef("");
    /** ドラッグ中カーソル位置の影響圏（仮配置確定前）。 */
    const dragGhostInfluenceRef = useRef<StructureInfluence | null>(null);
    /** 施設モデルの描画指紋（同一なら再生成をスキップし、向きスライダーを滑らかにする）。 */
    const placementVisualKeyRef = useRef(new Map<string, string>());
    floodStateRef.current = floodState;
    const [mapError, setMapError] = useState<string | null>(null);
    const [isMapReady, setIsMapReady] = useState(false);
    const [visibilityEpoch, setVisibilityEpoch] = useState(0);

    const facilityLabels = useMemo(
      () =>
        placements
          // 仮配置は施設上の ✓／× と向きスライダーだけで足りるのでラベルを出さない。
          .filter((placement) => placement.preview !== true)
          .map((placement) => {
            const displayName =
              structures.find(({ id }) => id === placement.structureId)?.displayName ?? "施設";
            return {
              id: placement.id,
              kind: "facility" as const,
              text: displayName,
              selected: placement.id === selectedPlacementId,
              preview: false,
              longitude: placement.position.longitude,
              latitude: placement.position.latitude,
              height:
                placement.position.height +
                getStructureFootprintMeters(placement.structureId).height +
                12,
            };
          }),
      [placements, selectedPlacementId, structures],
    );

    /** 向き変更は仮配置中のみ。確定後はスライダーを出さない。 */
    const orientationTarget = useMemo(
      () => placements.find((placement) => placement.preview === true) ?? null,
      [placements],
    );

    // 決壊はオレンジ楕円・浸水プルームだけで示し、地点名ラベルは出さない。
    const mapLabels = facilityLabels;

    useEffect(() => {
      placementsRef.current = placements;
      structuresRef.current = structures;
      onDropPlaceRef.current = onDropPlace;
      onRotatePlacementRef.current = onRotatePlacement;
      onMovePendingPlacementRef.current = onMovePendingPlacement;
      onSelectPlacementRef.current = onSelectPlacement;
      onInvalidPositionRef.current = onInvalidPosition;
      onCameraFocusChangeRef.current = onCameraFocusChange;
      selectedPlacementIdRef.current = selectedPlacementId;
      floodStateRef.current = floodState;
      getLatestFloodStateRef.current = getLatestFloodState;
      freeCameraLookRef.current = freeCameraLook;
      mapActiveRef.current = mapActive;
    }, [
      floodState,
      freeCameraLook,
      getLatestFloodState,
      mapActive,
      onCameraFocusChange,
      onDropPlace,
      onInvalidPosition,
      onMovePendingPlacement,
      onRotatePlacement,
      onSelectPlacement,
      placements,
      selectedPlacementId,
      structures,
    ]);

    useEffect(() => {
      if (!mapActive) {
        return;
      }
      const viewer = viewerRef.current;
      if (viewer === null || viewer.isDestroyed()) {
        return;
      }
      const resizeViewer = () => {
        if (viewer.isDestroyed()) {
          return;
        }
        viewer.resize();
        viewer.scene.requestRender();
      };
      // ロビーから戻った直後やモバイルのツールバー伸縮で寸法がずれる。
      resizeViewer();
      const retry = window.setTimeout(resizeViewer, 120);
      window.visualViewport?.addEventListener("resize", resizeViewer);
      window.addEventListener("orientationchange", resizeViewer);
      return () => {
        window.clearTimeout(retry);
        window.visualViewport?.removeEventListener("resize", resizeViewer);
        window.removeEventListener("orientationchange", resizeViewer);
      };
    }, [mapActive]);

    useImperativeHandle(ref, () => ({
      tryDropStructure: (structureId: string, clientX: number, clientY: number) => {
        const viewer = viewerRef.current;
        clearDragGhostEntities(viewer);
        if (viewer === null || viewer.isDestroyed()) {
          return false;
        }
        const canvas = viewer.scene.canvas;
        const rect = canvas.getBoundingClientRect();
        const screen = new Cartesian2(clientX - rect.left, clientY - rect.top);
        if (screen.x < 0 || screen.y < 0 || screen.x > rect.width || screen.y > rect.height) {
          onInvalidPositionRef.current("マップへドロップ");
          return false;
        }

        const picked = pickPlacementPosition(viewer, screen);
        if (picked === undefined) {
          onInvalidPositionRef.current("もう一度ドロップ");
          return false;
        }
        if (!isInsidePlayArea(picked)) {
          onInvalidPositionRef.current("プレイ範囲外");
          return false;
        }
        const placeable = resolvePlaceablePosition(picked);
        if (placeable === undefined) {
          onInvalidPositionRef.current("配置帯の上だけ");
          return false;
        }

        const headingDegrees = CesiumMath.toDegrees(viewer.camera.heading);
        onDropPlaceRef.current(structureId, placeable, headingDegrees);
        return true;
      },
      updateDragGhost: (structureId: string, clientX: number, clientY: number) => {
        const viewer = viewerRef.current;
        if (viewer === null || viewer.isDestroyed()) {
          return { overMap: false, placeable: false };
        }
        const canvas = viewer.scene.canvas;
        const rect = canvas.getBoundingClientRect();
        const screen = new Cartesian2(clientX - rect.left, clientY - rect.top);
        if (screen.x < 0 || screen.y < 0 || screen.x > rect.width || screen.y > rect.height) {
          clearDragGhostEntities(viewer);
          dragGhostLastKeyRef.current = "";
          dragGhostInfluenceRef.current = null;
          refreshProtectionWithDragGhost(viewer, floodStateRef.current, null, mapActiveRef.current);
          return { overMap: false, placeable: false };
        }

        const picked = pickPlacementPosition(viewer, screen);
        if (picked === undefined) {
          clearDragGhostEntities(viewer);
          dragGhostLastKeyRef.current = "";
          dragGhostInfluenceRef.current = null;
          refreshProtectionWithDragGhost(viewer, floodStateRef.current, null, mapActiveRef.current);
          return { overMap: true, placeable: false };
        }

        const resolved = resolvePlaceablePosition(picked);
        const placeable = resolved !== undefined && isInsidePlayArea(resolved);
        // 配置可能域内はスナップせずポインタ直下。域外でもゴーストはカーソル位置に出す。
        const position = resolved ?? picked;
        const headingDegrees = CesiumMath.toDegrees(viewer.camera.heading);
        // 約 0.1 m 単位で追従（粗すぎる量子化だと「決まったマス」に感じる）。
        const key = [
          structureId,
          placeable ? "1" : "0",
          position.longitude.toFixed(6),
          position.latitude.toFixed(6),
          Math.round(headingDegrees),
        ].join("|");
        if (key === dragGhostLastKeyRef.current) {
          return { overMap: true, placeable };
        }
        dragGhostLastKeyRef.current = key;

        if (dragGhostRafRef.current !== 0) {
          window.cancelAnimationFrame(dragGhostRafRef.current);
        }
        dragGhostRafRef.current = window.requestAnimationFrame(() => {
          dragGhostRafRef.current = 0;
          const activeViewer = viewerRef.current;
          if (activeViewer === null || activeViewer.isDestroyed()) {
            return;
          }
          clearDragGhostEntities(activeViewer);
          const ghost: PlacedStructure = {
            id: DRAG_GHOST_PLACEMENT_ID,
            structureId,
            position,
            headingDegrees,
            preview: true,
          };
          try {
            // 堤防など多パーツ施設は毎フレーム全再生成すると描画例外で白画面になるため簡易体で追従する。
            addDragGhostSilhouette(activeViewer, ghost, !placeable);
          } catch (error) {
            console.error("Failed to render drag ghost model", structureId, error);
            addFallbackStructureMarker(activeViewer, ghost, false, true, {
              entityIdPrefix: DRAG_GHOST_ENTITY_PREFIX,
              invalid: !placeable,
            });
          }
          // 設置前から影響圏を見せ、置き場判断を助ける。
          const influence = calculateStructureInfluences([ghost])[0] ?? null;
          dragGhostInfluenceRef.current = influence;
          refreshProtectionWithDragGhost(
            activeViewer,
            floodStateRef.current,
            influence,
            mapActiveRef.current,
          );
          activeViewer.scene.requestRender();
        });

        return { overMap: true, placeable };
      },
      clearDragGhost: () => {
        if (dragGhostRafRef.current !== 0) {
          window.cancelAnimationFrame(dragGhostRafRef.current);
          dragGhostRafRef.current = 0;
        }
        dragGhostLastKeyRef.current = "";
        dragGhostInfluenceRef.current = null;
        clearDragGhostEntities(viewerRef.current);
        refreshProtectionWithDragGhost(
          viewerRef.current,
          floodStateRef.current,
          null,
          mapActiveRef.current,
        );
        viewerRef.current?.scene.requestRender();
      },
    }));

    useEffect(() => {
      const container = containerRef.current;
      if (container === null) {
        return;
      }
      if (document.hidden) {
        const activateWhenVisible = () => {
          if (!document.hidden) {
            setVisibilityEpoch((current) => current + 1);
          }
        };
        document.addEventListener("visibilitychange", activateWhenVisible);
        return () => {
          document.removeEventListener("visibilitychange", activateWhenVisible);
        };
      }

      let disposed = false;
      let eventHandler: ScreenSpaceEventHandler | null = null;
      let viewer: Viewer | null = null;
      let removeCameraMoveEnd: (() => void) | undefined;
      let handleVisibilityChange: (() => void) | undefined;
      let removeContextLost: (() => void) | undefined;
      let waterRenderFrame = 0;

      try {
        // React StrictMode remounts effects; clear leftover Cesium DOM first.
        container.replaceChildren();

        const gsiBaseLayer = createGsiPhotoImageryLayer();
        viewer = new Viewer(container, {
          animation: false,
          baseLayer: gsiBaseLayer,
          baseLayerPicker: false,
          fullscreenButton: false,
          geocoder: false,
          homeButton: false,
          infoBox: false,
          navigationHelpButton: false,
          maximumRenderTimeChange: Number.POSITIVE_INFINITY,
          requestRenderMode: true,
          scene3DOnly: true,
          sceneModePicker: false,
          selectionIndicator: false,
          timeline: false,
          // Sun lighting + shadows make the aerial photo look like night.
          shadows: false,
          // Temporary flat terrain until PLATEAU-Terrain (or GSI+geoid fallback) loads.
          terrainProvider: new EllipsoidTerrainProvider(),
          // Skip Cesium Ion credit / default world imagery path.
          creditContainer: document.createElement("div"),
        });

        if (disposed) {
          viewer.destroy();
          return;
        }

        viewerRef.current = viewer;
        const mapViewer = viewer;

        const groundTint = Color.fromCssColorString("#c5d4c4");
        mapViewer.scene.backgroundColor = Color.fromCssColorString("#9ec6e0");
        mapViewer.scene.globe.baseColor = groundTint;
        mapViewer.scene.globe.undergroundColor = groundTint;
        mapViewer.scene.globe.enableLighting = false;
        mapViewer.scene.globe.dynamicAtmosphereLighting = false;
        mapViewer.scene.globe.translucency.enabled = false;
        mapViewer.scene.globe.depthTestAgainstTerrain = false;
        mapViewer.scene.globe.show = true;
        mapViewer.scene.globe.maximumScreenSpaceError = 4;
        mapViewer.scene.fog.enabled = false;
        mapViewer.scene.highDynamicRange = false;
        mapViewer.resolutionScale = window.devicePixelRatio > 1.5 ? 0.85 : 1;
        if (mapViewer.scene.skyAtmosphere !== undefined) {
          mapViewer.scene.skyAtmosphere.show = true;
        }
        handleVisibilityChange = () => {
          const visible = !document.hidden;
          mapViewer.scene.globe.show = visible;
          if (buildingTilesetRef.current !== null) {
            buildingTilesetRef.current.show = visible;
          }
          if (visible) {
            mapViewer.scene.requestRender();
          }
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        // 真上寄りの光＋強めの照度（影は Viewer.shadows=false）
        mapViewer.scene.light = new DirectionalLight({
          direction: new Cartesian3(0.15, 0.35, -0.92),
          intensity: 2.2,
        });
        tuneImageryLayer(gsiBaseLayer);
        mapViewer.scene.screenSpaceCameraController.enableTilt =
          typeof window !== "undefined" ? window.matchMedia("(min-width: 768px)").matches : true;
        mapViewer.scene.screenSpaceCameraController.enableLook = false;
        mapViewer.scene.screenSpaceCameraController.minimumZoomDistance =
          CAMERA_MIN_ZOOM_DISTANCE_M;
        mapViewer.scene.screenSpaceCameraController.maximumZoomDistance =
          CAMERA_MAX_ZOOM_DISTANCE_M;
        // 境界で入力とクランプが喧嘩してガクガクしないよう、慣性が残らない程度に抑える
        mapViewer.scene.screenSpaceCameraController.inertiaSpin = 0.5;
        mapViewer.scene.screenSpaceCameraController.inertiaTranslate = 0.5;
        mapViewer.scene.screenSpaceCameraController.inertiaZoom = 0.4;
        mapViewer.scene.globe.tileLoadProgressEvent.addEventListener((queuedTileCount) => {
          if (queuedTileCount === 0) {
            setIsMapReady(true);
            // 地形詳細が揃った時点で施設高度を再評価し、地中への埋没を防ぐ。
            for (const placement of placementsRef.current) {
              applyPlacementHeading(
                mapViewer,
                placement,
                placement.id === selectedPlacementIdRef.current,
                placement.preview === true,
              );
            }
            mapViewer.scene.requestRender();
          }
        });

        void loadAlignedTerrain(mapViewer, () => disposed)
          .then(() => {
            if (disposed || mapViewer.isDestroyed()) {
              return;
            }
            return sampleOverflowBankElevations(mapViewer);
          })
          .catch((error: unknown) => {
            console.warn("Terrain failed to load", error);
          });

        void loadPlateauBuildings(
          mapViewer,
          () => disposed,
          (tileset) => {
            buildingTilesetRef.current = tileset;
            tileset.show = !document.hidden;
          },
        ).catch((error: unknown) => {
          console.warn("PLATEAU buildings failed to load", error);
        });

        mapViewer.camera.lookAt(
          Cartesian3.fromDegrees(INITIAL_VIEW.longitude, INITIAL_VIEW.latitude),
          new HeadingPitchRange(
            CesiumMath.toRadians(INITIAL_VIEW.headingDegrees),
            CesiumMath.toRadians(INITIAL_VIEW.pitchDegrees),
            INITIAL_VIEW.range,
          ),
        );
        // lookAt のロックを解除し、以降は自由にパン／ズームできるようにする。
        mapViewer.camera.lookAtTransform(Matrix4.IDENTITY);
        // タイル完了を待たず UI を出し、真っ黒のまま固まるのを防ぐ。
        mapViewer.resize();
        mapViewer.scene.requestRender();
        setIsMapReady(true);

        const canvas = mapViewer.scene.canvas;
        const onContextLost = (event: Event) => {
          event.preventDefault();
          setMapError("描画コンテキストが失われました。ページを再読み込みしてください。");
        };
        canvas.addEventListener("webglcontextlost", onContextLost, false);
        removeContextLost = () => {
          canvas.removeEventListener("webglcontextlost", onContextLost, false);
        };

        // 水面の Water マテリアル／流向ストリークは毎フレーム更新が必要なので描画を継続する。
        // 最新水位もここで渡し、React の間引き更新だけでは増水が階段状に見えないようにする。
        let lastVisualKey = "";
        let lastStormKey = "";
        const clearSky = Color.fromCssColorString("#9ec6e0");
        const stormSky = Color.fromCssColorString("#4a6170");
        const keepWaterAnimating = () => {
          if (disposed || mapViewer.isDestroyed()) {
            return;
          }
          if (!document.hidden && mapActiveRef.current) {
            const latest = getLatestFloodStateRef.current?.();
            if (latest !== undefined) {
              const active =
                latest.phase === "disaster" ||
                latest.phase === "result" ||
                latest.phase === "review";
              const mitigationCalm = Math.min(
                1,
                latest.mitigation.overflowPrevention * 0.65 +
                  latest.mitigation.waterLevelReduction * 0.5 +
                  latest.mitigation.channelCapacityIncrease * 0.2,
              );
              riverWaterRef.current?.setHydraulics({
                riverLevelMeters: latest.riverLevelMeters,
                rainfallIntensity: latest.rainfallIntensity,
                overflowMeters: latest.overflowMeters,
                activeFlood: active,
                mitigationCalm,
              });

              const drama = resolveRainDrama({
                phase: latest.phase,
                rainfallIntensity: latest.rainfallIntensity,
                overflowMeters: latest.overflowMeters,
                floodDepthMeters: latest.floodDepthMeters,
                damagePercent: latest.damagePercent,
              });
              const stormKey = drama.toFixed(2);
              if (stormKey !== lastStormKey) {
                lastStormKey = stormKey;
                Color.lerp(clearSky, stormSky, drama, mapViewer.scene.backgroundColor);
                if (mapViewer.scene.skyAtmosphere !== undefined) {
                  mapViewer.scene.skyAtmosphere.hueShift = -0.04 * drama;
                  mapViewer.scene.skyAtmosphere.saturationShift = -0.3 * drama;
                  mapViewer.scene.skyAtmosphere.brightnessShift = -0.42 * drama;
                }
                mapViewer.scene.fog.enabled = drama > 0.12;
                mapViewer.scene.fog.density = 0.00015 + drama * 0.00135;
                mapViewer.scene.fog.minimumBrightness = Math.max(0.08, 0.35 - drama * 0.22);
                if (mapViewer.scene.light instanceof DirectionalLight) {
                  mapViewer.scene.light.intensity = 2.2 - drama * 1.15;
                }
              }

              // 氾濫原・越水は目標の変化時だけ更新（描画側で補間する）。
              const visualKey = [
                active ? 1 : 0,
                latest.riverLevelMeters.toFixed(3),
                latest.overflowMeters.toFixed(3),
                latest.floodDepthMeters.toFixed(3),
                latest.floodedAreaPercent.toFixed(2),
                latest.overflowSites
                  .map((site) => `${site.id}:${site.intensity.toFixed(3)}`)
                  .join(","),
              ].join("|");
              if (visualKey !== lastVisualKey) {
                lastVisualKey = visualKey;
                syncNearOverflowFloodplain(mapViewer, {
                  active,
                  riverLevelMeters: latest.riverLevelMeters,
                  overflowMeters: latest.overflowMeters,
                  overflowLevelMeters: latest.overflowLevelMeters,
                });
                syncOverflowVisualization(
                  mapViewer,
                  active ? latest.overflowSites : [],
                  active ? latest.floodDepthMeters : 0,
                  active ? latest.floodedAreaPercent : 0,
                );
                syncInundationVisualization(
                  mapViewer,
                  active ? latest.overflowSites : [],
                  active ? latest.floodDepthMeters : 0,
                  active,
                );
              }
            }
            mapViewer.scene.requestRender();
          }
          waterRenderFrame = window.requestAnimationFrame(keepWaterAnimating);
        };
        waterRenderFrame = window.requestAnimationFrame(keepWaterAnimating);

        // 配置帯は準備／災害中かつ mapActive のときだけ出す（初期化時点では作らない）。
        placeableZoneRef.current?.destroy();
        placeableZoneRef.current = null;
        syncPlaceableZoneForPhase(mapViewer, placeableZoneRef, floodStateRef.current, mapActiveRef.current);

        void createRiverWaterSurface(mapViewer)
          .then((controller) => {
            if (disposed || mapViewer.isDestroyed()) {
              controller.destroy();
              return;
            }
            riverWaterRef.current?.destroy();
            riverWaterRef.current = controller;
            const currentFlood = floodStateRef.current;
            controller.setHydraulics({
              riverLevelMeters: currentFlood?.riverLevelMeters ?? 2.2,
              rainfallIntensity: currentFlood?.rainfallIntensity ?? 0,
              overflowMeters: currentFlood?.overflowMeters ?? 0,
              activeFlood: currentFlood?.active === true,
              mitigationCalm: currentFlood?.mitigationCalm ?? 0,
            });
          })
          .catch((error: unknown) => {
            console.warn("River water surface failed to load", error);
          });

        // カメラ「位置」ではなく「見ている地点」を川周辺に制限する（俯瞰時のガクガク防止）
        const settleCamera = () => {
          if (mapViewer.isDestroyed()) {
            return;
          }
          if (!freeCameraLookRef.current) {
            constrainCameraFocusNearRiver(mapViewer);
          }
          const focus = pickGroundFocus(mapViewer);
          if (focus === undefined) {
            return;
          }
          const cartographic = Cartographic.fromCartesian(focus);
          onCameraFocusChangeRef.current?.({
            longitude: CesiumMath.toDegrees(cartographic.longitude),
            latitude: CesiumMath.toDegrees(cartographic.latitude),
            height: cartographic.height,
          });
        };
        removeCameraMoveEnd = mapViewer.camera.moveEnd.addEventListener(settleCamera);

        // 仮配置の選択・地図ドラッグ移設。向きは手前のスライダーでライブ調整する。
        eventHandler = new ScreenSpaceEventHandler(canvas);
        type MoveSession = {
          placementId: string;
          startPosition: GeoPosition;
          headingDegrees: number;
          active: boolean;
          livePosition: GeoPosition;
          placeable: boolean;
        };
        let pointerDown: Cartesian2 | undefined;
        let moveSession: MoveSession | undefined;

        const liveUpdatePending = (placement: PlacedStructure, invalid = false) => {
          for (const entity of [...mapViewer.entities.values]) {
            if (
              entity.id === `placement-${placement.id}` ||
              entity.id.startsWith(`placement-${placement.id}-`)
            ) {
              mapViewer.entities.remove(entity);
            }
          }
          try {
            addCivilEngineeringModel(mapViewer, placement, true, true, { invalid });
          } catch (error) {
            console.error("Failed to live-update pending placement", placement.structureId, error);
            addFallbackStructureMarker(mapViewer, placement, true, true, { invalid });
          }
          mapViewer.scene.requestRender();
        };

        eventHandler.setInputAction((event: { position: Cartesian2 }) => {
          pointerDown = Cartesian2.clone(event.position);
          const pickedId = pickPlacementIdAtScreen(
            mapViewer,
            event.position,
            placementsRef.current,
            PLACEMENT_PICK_RADIUS_PX,
          );
          if (pickedId === undefined) {
            moveSession = undefined;
            return;
          }
          const placement = placementsRef.current.find(({ id }) => id === pickedId);
          if (placement === undefined) {
            moveSession = undefined;
            return;
          }
          onSelectPlacementRef.current(pickedId);
          // 確定済みは移設不可。選択のみ。
          if (placement.preview !== true) {
            moveSession = undefined;
            canvas.style.cursor = "";
            return;
          }
          // 仮配置を掴んだ瞬間からカメラを止め、パンと移設の競合を防ぐ。
          mapViewer.scene.screenSpaceCameraController.enableInputs = false;
          canvas.style.cursor = "move";
          moveSession = {
            placementId: pickedId,
            startPosition: { ...placement.position },
            headingDegrees: placement.headingDegrees,
            active: false,
            livePosition: { ...placement.position },
            placeable: true,
          };
        }, ScreenSpaceEventType.LEFT_DOWN);

        eventHandler.setInputAction((event: { endPosition: Cartesian2 }) => {
          if (pointerDown === undefined || moveSession === undefined) {
            return;
          }
          const distance = Cartesian2.distance(pointerDown, event.endPosition);
          if (!moveSession.active && distance > MOVE_START_MOVE_PX) {
            moveSession.active = true;
          }
          if (!moveSession.active) {
            return;
          }
          const picked = pickPlacementPosition(mapViewer, event.endPosition);
          if (picked === undefined) {
            return;
          }
          const placeable = resolvePlaceablePosition(picked);
          const nextPosition = placeable ?? picked;
          moveSession.livePosition = nextPosition;
          moveSession.placeable = placeable !== undefined;
          const base = placementsRef.current.find(({ id }) => id === moveSession!.placementId);
          if (base === undefined) {
            return;
          }
          liveUpdatePending(
            {
              ...base,
              headingDegrees: moveSession.headingDegrees,
              position: nextPosition,
            },
            placeable === undefined,
          );
        }, ScreenSpaceEventType.MOUSE_MOVE);

        eventHandler.setInputAction((event: { position: Cartesian2 }) => {
          const session = moveSession;
          const down = pointerDown;
          pointerDown = undefined;
          moveSession = undefined;
          mapViewer.scene.screenSpaceCameraController.enableInputs = true;
          canvas.style.cursor = "";

          if (session?.active === true) {
            const target = placementsRef.current.find(({ id }) => id === session.placementId);
            if (target?.preview === true) {
              if (session.placeable) {
                onMovePendingPlacementRef.current(session.placementId, session.livePosition);
              } else {
                liveUpdatePending({
                  ...target,
                  position: session.startPosition,
                  headingDegrees: session.headingDegrees,
                });
                onInvalidPositionRef.current("帯の内側へ");
              }
            }
            return;
          }

          if (down === undefined) {
            return;
          }
          if (Cartesian2.distance(down, event.position) > MOVE_START_MOVE_PX) {
            return;
          }
          const pickedId = pickPlacementIdAtScreen(
            mapViewer,
            event.position,
            placementsRef.current,
            PLACEMENT_PICK_RADIUS_PX,
          );
          // 短タップは選択／解除のみ。配置はドックからのドラッグ＆ドロップに限定し誤設置を防ぐ。
          if (pickedId !== undefined) {
            onSelectPlacementRef.current(pickedId);
            return;
          }
          onSelectPlacementRef.current(null);
        }, ScreenSpaceEventType.LEFT_UP);

        // Show UI even if tiles are slow; Worker load failures surface as errors.
        window.setTimeout(() => {
          if (!disposed) {
            setIsMapReady(true);
          }
        }, 1_500);
      } catch (error) {
        const message = error instanceof Error ? error.message : "地図の初期化に失敗しました";
        setMapError(message);
      }

      return () => {
        disposed = true;
        window.cancelAnimationFrame(waterRenderFrame);
        eventHandler?.destroy();
        removeCameraMoveEnd?.();
        if (handleVisibilityChange !== undefined) {
          document.removeEventListener("visibilitychange", handleVisibilityChange);
        }
        removeContextLost?.();
        riverWaterRef.current?.destroy();
        riverWaterRef.current = null;
        placeableZoneRef.current?.destroy();
        placeableZoneRef.current = null;
        if (dragGhostRafRef.current !== 0) {
          window.cancelAnimationFrame(dragGhostRafRef.current);
          dragGhostRafRef.current = 0;
        }
        clearDragGhostEntities(viewer);
        if (viewer != null && !viewer.isDestroyed()) {
          destroyNearOverflowFloodplain(viewer);
          destroyOverflowVisualization(viewer);
          destroyInundationVisualization(viewer);
        }
        viewerRef.current = null;
        buildingTilesetRef.current = null;
        viewer?.destroy();
      };
    }, [visibilityEpoch]);

    useEffect(() => {
      const viewer = viewerRef.current;
      if (viewer === null || viewer.isDestroyed()) {
        return;
      }

      const nextIds = new Set(placements.map((placement) => placement.id));
      for (const entity of [...viewer.entities.values]) {
        if (!entity.id.startsWith("placement-")) {
          continue;
        }
        const placementId = matchPlacementId(entity.id, placements);
        if (placementId === undefined || !nextIds.has(placementId)) {
          viewer.entities.remove(entity);
        }
      }
      for (const id of [...placementVisualKeyRef.current.keys()]) {
        if (!nextIds.has(id)) {
          placementVisualKeyRef.current.delete(id);
        }
      }

      let changed = false;
      for (const placement of placements) {
        const selected = placement.id === selectedPlacementId;
        const key = placementVisualKey(placement, selected);
        if (placementVisualKeyRef.current.get(placement.id) === key) {
          continue;
        }
        applyPlacementHeading(viewer, placement, selected, placement.preview === true);
        placementVisualKeyRef.current.set(placement.id, key);
        changed = true;
      }
      if (changed) {
        viewer.scene.requestRender();
      }
    }, [placements, selectedPlacementId, structures]);

    useEffect(() => {
      const viewer = viewerRef.current;
      if (viewer === null || viewer.isDestroyed()) {
        return;
      }

      // ロビー裏表示・未開始時は決壊／弱点／影響圏／配置帯をすべて消す。
      if (!mapActive || floodState?.phase === "idle" || floodState === undefined) {
        clearProtectionVisualization(viewer);
        dragGhostInfluenceRef.current = null;
        syncOverflowVisualization(viewer, [], 0, 0);
        syncInundationVisualization(viewer, [], 0, false);
        syncNearOverflowFloodplain(viewer, {
          active: false,
          riverLevelMeters: 2.2,
          overflowMeters: 0,
        });
        placeableZoneRef.current?.destroy();
        placeableZoneRef.current = null;
        clearLegacyFloodZones(viewer);
        viewer.scene.requestRender();
        return;
      }

      syncPlaceableZoneForPhase(viewer, placeableZoneRef, floodState, mapActive);

      const sites = floodState.active === true ? (floodState.overflowSites ?? []) : [];
      refreshProtectionWithDragGhost(viewer, floodState, dragGhostInfluenceRef.current, mapActive);
      syncNearOverflowFloodplain(viewer, {
        active: floodState.active === true,
        riverLevelMeters: floodState.riverLevelMeters ?? 2.2,
        overflowMeters: floodState.overflowMeters ?? 0,
        overflowLevelMeters: floodState.overflowLevelMeters,
      });
      syncOverflowVisualization(
        viewer,
        sites,
        floodState.floodDepthMeters ?? 0,
        floodState.floodedAreaPercent ?? 0,
      );
      syncInundationVisualization(
        viewer,
        sites,
        floodState.floodDepthMeters ?? 0,
        floodState.active === true,
      );
      // 旧・無関係な固定浸水ゾーンは使わない（決壊地点からの浸水のみ）。
      clearLegacyFloodZones(viewer);
      viewer.scene.requestRender();
    }, [
      mapActive,
      floodState?.active,
      floodState?.phase,
      floodState?.floodDepthMeters,
      floodState?.floodedAreaPercent,
      floodState?.overflowLevelMeters,
      floodState?.overflowMeters,
      floodState?.overflowSites,
      floodState?.protectedBankSites,
      floodState?.riverLevelMeters,
      floodState?.structureInfluences,
    ]);

    useEffect(() => {
      riverWaterRef.current?.setHydraulics({
        riverLevelMeters: floodState?.riverLevelMeters ?? 2.2,
        rainfallIntensity: floodState?.rainfallIntensity ?? 0,
        overflowMeters: floodState?.overflowMeters ?? 0,
        activeFlood: floodState?.active === true,
        mitigationCalm: floodState?.mitigationCalm ?? 0,
      });
    }, [
      floodState?.active,
      floodState?.mitigationCalm,
      floodState?.overflowMeters,
      floodState?.rainfallIntensity,
      floodState?.riverLevelMeters,
    ]);

    // Cesium LabelGraphics は日本語が低解像度ラスタになりやすいため、HTML オーバーレイで描画する。
    useEffect(() => {
      const viewer = viewerRef.current;
      if (viewer === null || viewer.isDestroyed() || !isMapReady) {
        return;
      }

      const syncOverlayPositions = () => {
        if (viewer.isDestroyed()) {
          return;
        }
        const facilityLabelAnchors: ScreenLabelAnchor[] = [];
        for (const label of mapLabels) {
          const element = labelElementRefs.current.get(`${label.kind}-${label.id}`);
          if (element === undefined) {
            continue;
          }
          const screen = viewer.scene.cartesianToCanvasCoordinates(
            Cartesian3.fromDegrees(label.longitude, label.latitude, label.height),
          );
          facilityLabelAnchors.push({ element, screen, selected: label.selected });
        }
        applyDeclutteredScreenLabelPositions(facilityLabelAnchors);

        const target = orientationTarget;
        if (target !== null) {
          const screenBelow = viewer.scene.cartesianToCanvasCoordinates(
            Cartesian3.fromDegrees(
              target.position.longitude,
              target.position.latitude,
              target.position.height + 6,
            ),
          );
          const screenAbove = viewer.scene.cartesianToCanvasCoordinates(
            Cartesian3.fromDegrees(
              target.position.longitude,
              target.position.latitude,
              target.position.height + 18,
            ),
          );
          const hud = orientationHudRef.current;
          if (hud !== null) {
            // 施設の右下にスライダーを置き、モデル本体のドラッグ移設と重なりにくくする。
            applyScreenHudPosition(hud, screenBelow, 72, 18, "below");
          }
          const confirmHud = confirmHudRef.current;
          if (confirmHud !== null) {
            // 施設の上に確定／キャンセルをさりげなく置く。
            applyScreenHudPosition(confirmHud, screenAbove, 0, -12, "above");
          }
        }
      };

      syncOverlayPositions();
      const removeListener = viewer.scene.postRender.addEventListener(syncOverlayPositions);
      viewer.scene.requestRender();
      return () => {
        removeListener();
      };
    }, [isMapReady, mapLabels, orientationTarget, visibilityEpoch]);

    // 仮配置中は矢印キーで位置を微調整（河道・河岸内のみ）。
    useEffect(() => {
      if (orientationTarget === null || orientationTarget.preview !== true) {
        return;
      }
      const onKeyDown = (event: KeyboardEvent) => {
        if (
          event.key !== "ArrowUp" &&
          event.key !== "ArrowDown" &&
          event.key !== "ArrowLeft" &&
          event.key !== "ArrowRight"
        ) {
          return;
        }
        const target = event.target;
        if (
          target instanceof HTMLElement &&
          (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
        ) {
          return;
        }
        event.preventDefault();
        const east =
          event.key === "ArrowRight" ? NUDGE_METERS : event.key === "ArrowLeft" ? -NUDGE_METERS : 0;
        const north =
          event.key === "ArrowUp" ? NUDGE_METERS : event.key === "ArrowDown" ? -NUDGE_METERS : 0;
        const nudged = offsetLonLatMeters(
          orientationTarget.position.longitude,
          orientationTarget.position.latitude,
          east,
          north,
          0,
        );
        const candidate: GeoPosition = {
          longitude: nudged.longitude,
          latitude: nudged.latitude,
          height: orientationTarget.position.height,
        };
        const placeable = resolvePlaceablePosition(candidate);
        if (placeable === undefined) {
          onInvalidPositionRef.current("帯の中で調整");
          return;
        }
        const viewer = viewerRef.current;
        if (viewer !== null && !viewer.isDestroyed()) {
          applyPlacementHeading(viewer, { ...orientationTarget, position: placeable }, true, true);
          viewer.scene.requestRender();
        }
        onMovePendingPlacementRef.current(orientationTarget.id, placeable);
      };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, [orientationTarget]);

    const setLabelElementRef = (id: string, element: HTMLDivElement | null) => {
      if (element === null) {
        labelElementRefs.current.delete(id);
        return;
      }
      labelElementRefs.current.set(id, element);
    };

    return (
      <div className="cesium-game-map">
        <div className="cesium-game-map__canvas" ref={containerRef} />
        <div className="cesium-game-map__labels" aria-hidden="true">
          {mapLabels.map((label) => (
            <div
              key={`${label.kind}-${label.id}`}
              ref={(element) => {
                setLabelElementRef(`${label.kind}-${label.id}`, element);
              }}
              className={`cesium-map-label${label.selected ? " is-selected" : ""}${label.preview ? " is-preview" : ""}`}
            >
              {label.text}
            </div>
          ))}
        </div>
        {orientationTarget !== null ? (
          <>
            <div
              ref={confirmHudRef}
              className="cesium-confirm-hud"
              role="group"
              aria-label="仮配置の確定"
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
            >
              <button
                type="button"
                className="cesium-confirm-hud__cancel"
                aria-label="キャンセル"
                title="キャンセル（Esc）"
                onClick={() => onCancelPendingPlacement?.()}
              >
                <span aria-hidden="true">×</span>
              </button>
              <button
                type="button"
                className="cesium-confirm-hud__confirm"
                aria-label="確定して配置"
                title="確定（Enter）"
                onClick={() => onConfirmPendingPlacement?.()}
              >
                <span aria-hidden="true">✓</span>
              </button>
            </div>
            <div
              ref={orientationHudRef}
              className={`cesium-orientation-hud${orientationTarget.preview === true ? " is-preview" : ""}`}
            >
              <RotationControls
                floating
                headingDegrees={orientationTarget.headingDegrees}
                onLiveChange={(headingDegrees) => {
                  // スライダー操作中に施設モデル／影響圏を即回転（手を離す前に向きが分かる）。
                  applyLivePlacementHeading(
                    viewerRef.current,
                    placementsRef,
                    placementVisualKeyRef,
                    orientationTarget.id,
                    headingDegrees,
                    selectedPlacementIdRef.current,
                    floodStateRef.current,
                    dragGhostInfluenceRef.current,
                    mapActiveRef.current,
                  );
                  onRotatePlacement(orientationTarget.id, headingDegrees);
                }}
                onChange={(headingDegrees) =>
                  onRotatePlacement(orientationTarget.id, headingDegrees)
                }
              />
            </div>
          </>
        ) : null}
        {!isMapReady && mapError === null ? (
          <div className="cesium-game-map__status" role="status">
            地図を読み込み中…
          </div>
        ) : null}
        {mapError !== null ? (
          <div className="cesium-game-map__status cesium-game-map__status--error" role="alert">
            {mapError}
          </div>
        ) : null}
      </div>
    );
  },
);

type ScreenLabelAnchor = {
  element: HTMLDivElement;
  screen: Cartesian2 | undefined;
  selected: boolean;
};

function applyDeclutteredScreenLabelPositions(anchors: ScreenLabelAnchor[]): void {
  const visible = anchors
    .filter(({ screen }) => screen !== undefined)
    .map(({ element, screen, selected }) => ({
      element,
      selected,
      x: screen!.x,
      y: screen!.y,
      width: Math.max(element.offsetWidth, 58),
      height: Math.max(element.offsetHeight, 24),
    }))
    .sort((left, right) => left.y - right.y);
  const hidden = anchors.filter(({ screen }) => screen === undefined);
  for (const { element } of hidden) {
    element.style.visibility = "hidden";
  }

  const parent = visible[0]?.element.offsetParent as HTMLElement | null;
  const viewWidth = parent?.clientWidth ?? window.innerWidth;
  const viewHeight = parent?.clientHeight ?? window.innerHeight;
  const placed: Array<{ x: number; y: number; width: number; height: number }> = [];
  const pad = 8;

  for (const label of visible) {
    const halfWidth = label.width / 2;
    const x = clampNumber(label.x, pad + halfWidth, viewWidth - pad - halfWidth);
    const baseY = clampNumber(label.y - 26, pad + label.height, viewHeight - pad);
    let y = baseY;
    let attempt = 0;

    while (
      attempt < 8 &&
      placed.some((other) => boxesOverlap(x, y, label.width, label.height, other))
    ) {
      attempt += 1;
      const direction = label.selected || attempt % 2 === 1 ? -1 : 1;
      const row = Math.ceil(attempt / 2);
      y = clampNumber(
        baseY + direction * row * (label.height + 5),
        pad + label.height,
        viewHeight - pad,
      );
    }

    placed.push({ x, y, width: label.width, height: label.height });
    applyScreenLabelPosition(label.element, new Cartesian2(x, y), 0, 0);
  }
}

function boxesOverlap(
  x: number,
  y: number,
  width: number,
  height: number,
  other: { x: number; y: number; width: number; height: number },
): boolean {
  const gap = 5;
  return (
    Math.abs(x - other.x) * 2 < width + other.width + gap &&
    Math.abs(y - other.y) * 2 < height + other.height + gap
  );
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function applyScreenLabelPosition(
  element: HTMLDivElement,
  screen: Cartesian2 | undefined,
  offsetX: number,
  offsetY: number,
): void {
  if (screen === undefined) {
    element.style.visibility = "hidden";
    return;
  }
  element.style.visibility = "visible";
  element.style.transform = `translate(${screen.x + offsetX}px, ${screen.y + offsetY}px) translate(-50%, -100%)`;
}

/** 施設の手前など、アンカー点の下に UI を置く。画面端・ドック帯でははみ出さないようクランプする。 */
function applyScreenHudPosition(
  element: HTMLDivElement,
  screen: Cartesian2 | undefined,
  offsetX: number,
  offsetY: number,
  anchor: "below" | "above" = "below",
): void {
  if (screen === undefined) {
    element.style.visibility = "hidden";
    return;
  }
  element.style.visibility = "visible";
  const parent = element.offsetParent as HTMLElement | null;
  const viewWidth = parent?.clientWidth ?? window.innerWidth;
  const viewHeight = parent?.clientHeight ?? window.innerHeight;
  const safeTop = readSafeAreaInset("top");
  const safeBottom = readSafeAreaInset("bottom");
  const dockClearance = estimateDockClearancePx();
  const padX = 12;
  const padTop = 12 + safeTop;
  const padBottom = 12 + safeBottom + dockClearance;
  const halfWidth = Math.max(element.offsetWidth, 120) / 2;
  const height = Math.max(element.offsetHeight, 44);
  let x = screen.x + offsetX;
  let y = screen.y + offsetY;
  x = Math.min(viewWidth - padX - halfWidth, Math.max(padX + halfWidth, x));
  if (anchor === "above") {
    y = Math.min(viewHeight - padBottom, Math.max(padTop + height, y));
  } else {
    y = Math.min(viewHeight - padBottom - height, Math.max(padTop, y));
  }
  const anchorTransform = anchor === "above" ? "translate(-50%, -100%)" : "translate(-50%, 0)";
  element.style.transform = `translate(${x}px, ${y}px) ${anchorTransform}`;
}

function readSafeAreaInset(edge: "top" | "bottom" | "left" | "right"): number {
  if (typeof document === "undefined") {
    return 0;
  }
  const probe = document.createElement("div");
  probe.style.cssText = `position:fixed;visibility:hidden;pointer-events:none;padding-${edge}:env(safe-area-inset-${edge}, 0px);`;
  document.body.appendChild(probe);
  const value = Number.parseFloat(getComputedStyle(probe).getPropertyValue(`padding-${edge}`));
  probe.remove();
  return Number.isFinite(value) ? value : 0;
}

/** 下部建設ドックが覆う概算高さ。仮配置 HUD がドック下に沈まないようにする。 */
function estimateDockClearancePx(): number {
  if (typeof document === "undefined") {
    return 120;
  }
  const dock = document.querySelector(".construction-menu");
  if (!(dock instanceof HTMLElement) || dock.offsetParent === null) {
    return 24;
  }
  return Math.min(Math.max(dock.offsetHeight + 16, 96), 220);
}

async function loadAlignedTerrain(viewer: Viewer, isDisposed: () => boolean): Promise<void> {
  try {
    const provider = await CesiumTerrainProvider.fromUrl(PLATEAU_TERRAIN_URL, {
      // 地表ライティングを無効化しているため法線は取得せず、通信量と展開負荷を抑える。
      requestVertexNormals: false,
    });
    if (isDisposed() || viewer.isDestroyed()) {
      return;
    }
    viewer.terrainProvider = provider;
    viewer.scene.requestRender();
  } catch (error) {
    console.warn("PLATEAU-Terrain unavailable, falling back to GSI DEM + geoid", error);
    if (isDisposed() || viewer.isDestroyed()) {
      return;
    }
    viewer.terrainProvider = createGsiTerrainProvider();
    viewer.scene.requestRender();
  }
}

/**
 * 弱点候補の地形標高を DEM から取得し、低い岸ほど越水しやすいようシミュレーションへ渡す。
 */
async function sampleOverflowBankElevations(viewer: Viewer): Promise<void> {
  const candidates = listOverflowCandidates();
  if (candidates.length === 0) {
    return;
  }
  const cartographics = candidates.map((candidate) =>
    Cartographic.fromDegrees(candidate.longitude, candidate.latitude),
  );
  try {
    const sampled = await sampleTerrainMostDetailed(viewer.terrainProvider, cartographics);
    applyOverflowTerrainElevations(
      sampled.map((position, index) => ({
        id: candidates[index]?.id ?? `unknown-${index}`,
        heightMeters: position.height,
      })),
    );
    viewer.scene.requestRender();
  } catch (error) {
    console.warn("Overflow bank elevation sampling failed", error);
  }
}

async function loadPlateauBuildings(
  viewer: Viewer,
  isDisposed: () => boolean,
  onActiveTileset: (tileset: Cesium3DTileset) => void,
): Promise<Cesium3DTileset | null> {
  if (HIGH_DETAIL_BUILDINGS) {
    try {
      const textured = await loadBuildingTileset(viewer, PLATEAU_BUILDINGS_TEXTURE_URL, {
        isDisposed,
        maximumScreenSpaceError: 12,
        balanceBuildingAppearance: true,
      });
      if (textured !== null) {
        onActiveTileset(textured);
        return textured;
      }
    } catch (error) {
      console.warn(
        "Local textured PLATEAU buildings missing. Run: pnpm --filter @civilcraft/web fetch:plateau",
        error,
      );
    }
  }

  const lod1 = await loadBuildingTileset(viewer, PLATEAU_BUILDINGS_LOD1_URL, {
    isDisposed,
    maximumScreenSpaceError: 16,
    balanceBuildingAppearance: false,
  });
  if (lod1 !== null) {
    onActiveTileset(lod1);
  }
  return lod1;
}

async function loadBuildingTileset(
  viewer: Viewer,
  url: string,
  options: {
    isDisposed: () => boolean;
    maximumScreenSpaceError?: number;
    balanceBuildingAppearance?: boolean;
  },
): Promise<Cesium3DTileset | null> {
  const tileset = await Cesium3DTileset.fromUrl(url, {
    dynamicScreenSpaceError: true,
    foveatedScreenSpaceError: true,
    immediatelyLoadDesiredLevelOfDetail: false,
    maximumScreenSpaceError: options.maximumScreenSpaceError ?? 8,
    skipLevelOfDetail: true,
  });

  if (options.isDisposed() || viewer.isDestroyed()) {
    tileset.destroy();
    return null;
  }

  tileset.show = true;
  tileset.shadows = ShadowMode.DISABLED;
  // 施設配置の地表ピックを建物が邪魔しないようにする
  tileset.enableCollision = false;
  if (options.balanceBuildingAppearance === true) {
    tileset.customShader = createBuildingAppearanceShader();
  }
  // テクスチャを単色で潰さない（style は付けない）
  viewer.scene.primitives.add(tileset);
  viewer.scene.requestRender();
  return tileset;
}

/** 写真テクスチャを軽量な UNLIT 表示にし、ピクセル単位の陰影計算を避ける。 */
function createBuildingAppearanceShader(): CustomShader {
  return new CustomShader({
    lightingModel: LightingModel.UNLIT,
    fragmentShaderText: `
      void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material)
      {
        vec3 c = material.diffuse;
        float maxc = max(c.r, max(c.g, c.b));
        float minc = min(c.r, min(c.g, c.b));
        float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
        bool paleSurface = (maxc - minc) < 0.16 && luma > 0.62;
        if (paleSurface) {
          vec3 n = normalize(fsInput.attributes.normalEC);
          float lit = clamp(dot(n, normalize(vec3(0.2, 0.45, 0.87))), 0.0, 1.0);
          material.diffuse = vec3(0.56, 0.57, 0.56) * (0.48 + 0.48 * lit);
        } else {
          material.diffuse = min(c * 1.08, vec3(1.0));
        }
      }
    `,
  });
}

function createGsiPhotoImageryLayer(): ImageryLayer {
  const provider = new UrlTemplateImageryProvider({
    url: GSI_SEAMLESS_PHOTO_URL,
    maximumLevel: 18,
    credit: new Credit(
      '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
    ),
  });
  return new ImageryLayer(provider);
}

function tuneImageryLayer(layer: ImageryLayer): void {
  layer.show = true;
  layer.alpha = 1;
  layer.brightness = 1.12;
  layer.contrast = 1.04;
  layer.saturation = 1.06;
  layer.gamma = 1;
}

function createGsiTerrainProvider(): CustomHeightmapTerrainProvider {
  return new CustomHeightmapTerrainProvider({
    width: TERRAIN_HEIGHTMAP_SIZE,
    height: TERRAIN_HEIGHTMAP_SIZE,
    tilingScheme: new WebMercatorTilingScheme(),
    credit: new Credit(
      '<a href="https://maps.gsi.go.jp/development/demtile.html" target="_blank" rel="noopener">国土地理院 標高タイル</a>',
    ),
    callback: (x, y, level) => loadGsiHeightmap(x, y, level),
  });
}

const demImageCache = new Map<string, Promise<ImageData | null>>();

async function loadGsiHeightmap(x: number, y: number, level: number): Promise<Float32Array> {
  const sourceLevel = Math.min(level, GSI_DEM_MAX_LEVEL);
  const levelDifference = level - sourceLevel;
  const subdivision = 2 ** levelDifference;
  const sourceX = Math.floor(x / subdivision);
  const sourceY = Math.floor(y / subdivision);
  const childX = x - sourceX * subdivision;
  const childY = y - sourceY * subdivision;
  const imageData = await loadDemImage(sourceX, sourceY, sourceLevel);
  const heights = new Float32Array(TERRAIN_HEIGHTMAP_SIZE * TERRAIN_HEIGHTMAP_SIZE);

  if (imageData === null) {
    return heights;
  }

  for (let row = 0; row < TERRAIN_HEIGHTMAP_SIZE; row += 1) {
    for (let column = 0; column < TERRAIN_HEIGHTMAP_SIZE; column += 1) {
      const relativeX = column / (TERRAIN_HEIGHTMAP_SIZE - 1);
      const relativeY = row / (TERRAIN_HEIGHTMAP_SIZE - 1);
      const pixelX = Math.min(255, Math.floor(((childX + relativeX) / subdivision) * 256));
      const pixelY = Math.min(255, Math.floor(((childY + relativeY) / subdivision) * 256));
      const pixelIndex = (pixelY * 256 + pixelX) * 4;
      const orthometric = decodeGsiElevation(
        imageData.data[pixelIndex],
        imageData.data[pixelIndex + 1],
        imageData.data[pixelIndex + 2],
      );
      // Cesium は楕円体高を要求する。正標高のまま渡すと地形が低くなり建物が浮く。
      heights[row * TERRAIN_HEIGHTMAP_SIZE + column] =
        orthometric + KORIYAMA_GEOID_UNDULATION_METERS;
    }
  }

  return heights;
}

function loadDemImage(x: number, y: number, level: number): Promise<ImageData | null> {
  const key = `${level}/${x}/${y}`;
  const cached = demImageCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const request = fetch(`https://cyberjapandata.gsi.go.jp/xyz/dem_png/${key}.png`)
    .then(async (response) => {
      if (!response.ok) {
        return null;
      }
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context === null) {
        bitmap.close();
        return null;
      }
      context.drawImage(bitmap, 0, 0, 256, 256);
      bitmap.close();
      return context.getImageData(0, 0, 256, 256);
    })
    .catch(() => null);

  demImageCache.set(key, request);
  if (demImageCache.size > 128) {
    const oldestKey = demImageCache.keys().next().value as string | undefined;
    if (oldestKey !== undefined) {
      demImageCache.delete(oldestKey);
    }
  }
  return request;
}

function decodeGsiElevation(red: number, green: number, blue: number): number {
  const encoded = red * 65_536 + green * 256 + blue;
  if (encoded === 8_388_608) {
    return 0;
  }
  return encoded < 8_388_608 ? encoded * 0.01 : (encoded - 16_777_216) * 0.01;
}

function isInsidePlayArea(position: GeoPosition): boolean {
  return (
    position.longitude >= PLAY_AREA.west &&
    position.longitude <= PLAY_AREA.east &&
    position.latitude >= PLAY_AREA.south &&
    position.latitude <= PLAY_AREA.north
  );
}

/**
 * カメラ本体ではなく画面中央の注視点を川周辺に戻す。
 * 斜め俯瞰ではカメラ位置がプレイ矩形の外に出るのが正常なので、位置クランプはしない。
 */
function constrainCameraFocusNearRiver(viewer: Viewer): void {
  const focus = pickGroundFocus(viewer);
  if (focus === undefined) {
    return;
  }

  const cartographic = Cartographic.fromCartesian(focus);
  const longitude = CesiumMath.toDegrees(cartographic.longitude);
  const latitude = CesiumMath.toDegrees(cartographic.latitude);
  const nearest = nearestPointOnPolyline(longitude, latitude, ABUKUMA_RIVER_CENTERLINE);

  if (nearest.distanceMeters <= CAMERA_FOCUS_MAX_DISTANCE_FROM_RIVER_M) {
    return;
  }

  const ratio = CAMERA_FOCUS_MAX_DISTANCE_FROM_RIVER_M / nearest.distanceMeters;
  const nextLongitude = nearest.longitude + (longitude - nearest.longitude) * ratio;
  const nextLatitude = nearest.latitude + (latitude - nearest.latitude) * ratio;
  const nextFocus = Cartesian3.fromDegrees(
    nextLongitude,
    nextLatitude,
    Math.max(0, cartographic.height),
  );
  const delta = Cartesian3.subtract(nextFocus, focus, new Cartesian3());
  viewer.camera.position = Cartesian3.add(viewer.camera.positionWC, delta, new Cartesian3());
}

function pickGroundFocus(viewer: Viewer): Cartesian3 | undefined {
  const canvas = viewer.scene.canvas;
  const center = new Cartesian2(canvas.clientWidth * 0.5, canvas.clientHeight * 0.5);
  const ray = viewer.camera.getPickRay(center);
  if (ray !== undefined) {
    const ground = viewer.scene.globe.pick(ray, viewer.scene);
    if (ground !== undefined) {
      return ground;
    }
  }
  return viewer.camera.pickEllipsoid(center, viewer.scene.globe.ellipsoid) ?? undefined;
}

/**
 * 施設配置用の地表座標を取得する。
 * 建物 3D Tiles 上のタップでも lon/lat を取り、可能な限り地形高へ落とす。
 */
function pickPlacementPosition(
  viewer: Viewer,
  windowPosition: Cartesian2,
): GeoPosition | undefined {
  const scene = viewer.scene;
  const ray = viewer.camera.getPickRay(windowPosition);
  if (ray !== undefined) {
    const ground = scene.globe.pick(ray, scene);
    if (ground !== undefined) {
      return cartesianToGeoPosition(ground);
    }
  }

  // 建物などで globe.pick が取れないとき: 深度バッファから位置を取り、地形高へ補正
  if (scene.pickPositionSupported) {
    scene.render();
    const picked = scene.pickPosition(windowPosition);
    if (picked !== undefined) {
      const cartographic = Cartographic.fromCartesian(picked);
      const terrainHeight = scene.globe.getHeight(cartographic);
      const height =
        typeof terrainHeight === "number" && Number.isFinite(terrainHeight)
          ? terrainHeight
          : Number.isFinite(cartographic.height)
            ? cartographic.height
            : FALLBACK_GROUND_HEIGHT_M;
      return {
        longitude: CesiumMath.toDegrees(cartographic.longitude),
        latitude: CesiumMath.toDegrees(cartographic.latitude),
        height,
      };
    }
  }

  const ellipsoidHit = viewer.camera.pickEllipsoid(windowPosition, scene.globe.ellipsoid);
  if (ellipsoidHit !== undefined) {
    return cartesianToGeoPosition(ellipsoidHit);
  }

  return undefined;
}

function cartesianToGeoPosition(cartesian: Cartesian3): GeoPosition {
  const cartographic = Cartographic.fromCartesian(cartesian);
  const height = cartographic.height;
  return {
    longitude: CesiumMath.toDegrees(cartographic.longitude),
    latitude: CesiumMath.toDegrees(cartographic.latitude),
    height: Number.isFinite(height) ? height : FALLBACK_GROUND_HEIGHT_M,
  };
}

function pickPlacementIdAtScreen(
  viewer: Viewer,
  screenPosition: Cartesian2,
  placements: readonly PlacedStructure[],
  radiusPx = PLACEMENT_PICK_RADIUS_PX,
): string | undefined {
  const picked = viewer.scene.drillPick(screenPosition, 12);
  for (const item of picked) {
    const entity = (item as { id?: { id?: string } }).id;
    const entityId = entity?.id;
    if (typeof entityId !== "string") {
      continue;
    }
    const placementId = matchPlacementId(entityId, placements);
    if (placementId !== undefined) {
      return placementId;
    }
  }

  // モデルが小さく拾えない場合でも、画面上の中心近くなら選択できるようにする。
  let nearestId: string | undefined;
  let nearestDistance = radiusPx;
  for (const placement of placements) {
    const cartesian = Cartesian3.fromDegrees(
      placement.position.longitude,
      placement.position.latitude,
    );
    const canvasPoint = viewer.scene.cartesianToCanvasCoordinates(cartesian);
    if (canvasPoint === undefined) {
      continue;
    }
    const distance = Cartesian2.distance(screenPosition, canvasPoint);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestId = placement.id;
    }
  }
  return nearestId;
}

function matchPlacementId(
  entityId: string,
  placements: readonly PlacedStructure[],
): string | undefined {
  if (!entityId.startsWith("placement-")) {
    return undefined;
  }
  const matches = placements
    .map(({ id }) => id)
    .filter((id) => entityId === `placement-${id}` || entityId.startsWith(`placement-${id}-`))
    .sort((left, right) => right.length - left.length);
  return matches[0];
}

type StructureModelOptions = {
  entityIdPrefix?: string;
  /** 配置不可位置（ドラッグ中の市街地など）。 */
  invalid?: boolean;
  showHeadingCue?: boolean;
};

function placementVisualKey(placement: PlacedStructure, selected: boolean): string {
  return [
    placement.structureId,
    placement.preview === true ? "1" : "0",
    selected ? "1" : "0",
    Math.round(placement.headingDegrees),
    placement.position.longitude.toFixed(6),
    placement.position.latitude.toFixed(6),
    Math.round(placement.position.height * 10),
  ].join("|");
}

/**
 * 向きスライダー操作中に、React の再描画を待たず施設モデルと影響圏を即時更新する。
 */
function applyLivePlacementHeading(
  viewer: Viewer | null,
  placementsRef: { current: PlacedStructure[] },
  visualKeyRef: { current: Map<string, string> },
  placementId: string,
  headingDegrees: number,
  selectedPlacementId: string | null,
  floodState:
    | {
        active: boolean;
        phase?: "idle" | "preparation" | "disaster" | "result" | "review";
        structureInfluences: StructureInfluence[];
        protectedBankSites: ProtectedBankSite[];
      }
    | null
    | undefined,
  dragInfluence: StructureInfluence | null,
  mapActive: boolean,
): void {
  if (viewer === null || viewer.isDestroyed()) {
    return;
  }
  const current = placementsRef.current.find((placement) => placement.id === placementId);
  if (current === undefined) {
    return;
  }
  const next: PlacedStructure = {
    ...current,
    headingDegrees,
  };
  placementsRef.current = placementsRef.current.map((placement) =>
    placement.id === placementId ? next : placement,
  );
  const selected = placementId === selectedPlacementId || next.preview === true;
  applyPlacementHeading(viewer, next, selected, next.preview === true);
  visualKeyRef.current.set(placementId, placementVisualKey(next, selected));

  const influences = calculateStructureInfluences(placementsRef.current);
  refreshProtectionWithDragGhost(
    viewer,
    {
      active: floodState?.active === true,
      phase: floodState?.phase,
      structureInfluences: influences,
      protectedBankSites: floodState?.protectedBankSites ?? [],
    },
    dragInfluence,
    mapActive,
  );
  viewer.scene.requestRender();
}

function applyPlacementHeading(
  viewer: Viewer,
  placement: PlacedStructure,
  selected: boolean,
  preview = false,
): void {
  for (const entity of [...viewer.entities.values]) {
    if (
      entity.id === `placement-${placement.id}` ||
      entity.id.startsWith(`placement-${placement.id}-`)
    ) {
      viewer.entities.remove(entity);
    }
  }
  try {
    addCivilEngineeringModel(viewer, placement, selected, preview);
  } catch (error) {
    console.error("Failed to update structure heading model", placement.structureId, error);
    addFallbackStructureMarker(viewer, placement, selected, preview);
  }
}

function refreshProtectionWithDragGhost(
  viewer: Viewer | null,
  floodState:
    | {
        active: boolean;
        phase?: "idle" | "preparation" | "disaster" | "result" | "review";
        structureInfluences: StructureInfluence[];
        protectedBankSites: ProtectedBankSite[];
      }
    | null
    | undefined,
  dragInfluence: StructureInfluence | null = null,
  mapActive = true,
): void {
  if (viewer === null || viewer.isDestroyed()) {
    return;
  }
  const phase = floodState?.phase ?? "idle";
  const playable = mapActive && (phase === "preparation" || phase === "disaster");
  if (!playable) {
    clearProtectionVisualization(viewer);
    return;
  }

  const base = floodState?.structureInfluences ?? [];
  const influences = dragInfluence
    ? [...base.filter((item) => item.placementId !== dragInfluence.placementId), dragInfluence]
    : base;
  // 弱点マーカーは配置中（確定／仮／ドラッグ）だけ。未配置の常時表示は決壊と紛らわしい。
  const showWeaknessTargets = influences.length > 0;
  syncProtectionVisualization(viewer, influences, floodState?.protectedBankSites ?? [], {
    showBankSites: floodState?.active === true,
    showWeaknessTargets,
  });
}

function syncPlaceableZoneForPhase(
  viewer: Viewer,
  placeableZoneRef: { current: { destroy: () => void } | null },
  floodState:
    | {
        phase?: "idle" | "preparation" | "disaster" | "result" | "review";
      }
    | null
    | undefined,
  mapActive: boolean,
): void {
  const phase = floodState?.phase ?? "idle";
  const shouldShow = mapActive && (phase === "preparation" || phase === "disaster");
  if (!shouldShow) {
    placeableZoneRef.current?.destroy();
    placeableZoneRef.current = null;
    return;
  }
  if (placeableZoneRef.current === null) {
    placeableZoneRef.current = createPlaceableZone(viewer);
  }
}

function clearDragGhostEntities(viewer: Viewer | null): void {
  if (viewer === null || viewer.isDestroyed()) {
    return;
  }
  for (const entity of [...viewer.entities.values]) {
    if (entity.id.startsWith(`${DRAG_GHOST_ENTITY_PREFIX}-`)) {
      viewer.entities.remove(entity);
    }
  }
}

function resolveGroundHeightMeters(viewer: Viewer, placement: PlacedStructure): number {
  const sampled = viewer.scene.globe.getHeight(
    Cartographic.fromDegrees(placement.position.longitude, placement.position.latitude),
  );
  if (typeof sampled === "number" && Number.isFinite(sampled)) {
    return Math.max(0, sampled);
  }
  const stored = placement.position.height;
  if (typeof stored === "number" && Number.isFinite(stored)) {
    return Math.max(0, stored);
  }
  return FALLBACK_GROUND_HEIGHT_M;
}

function addFallbackStructureMarker(
  viewer: Viewer,
  placement: PlacedStructure,
  selected: boolean,
  preview = false,
  options: StructureModelOptions = {},
): void {
  const prefix = options.entityIdPrefix ?? "placement";
  const invalid = options.invalid === true;
  const groundHeight = resolveGroundHeightMeters(viewer, placement);
  const color = Color.fromCssColorString(
    invalid ? "#ef6b4a" : preview ? "#5ec8ff" : selected ? "#f0b429" : "#58d5a1",
  ).withAlpha(preview || invalid ? 0.55 : 0.85);
  viewer.entities.add({
    id: `${prefix}-${placement.id}`,
    position: Cartesian3.fromDegrees(
      placement.position.longitude,
      placement.position.latitude,
      groundHeight + 4,
    ),
    box: new BoxGraphics({
      dimensions: new Cartesian3(22, 22, 8),
      material: color,
      outline: true,
      outlineColor: Color.WHITE.withAlpha(0.7),
      outlineWidth: 1,
      shadows: ShadowMode.DISABLED,
    }),
  });
}

/**
 * ドラッグ中の軽量シルエット。堤防のような多層モデルを毎フレーム組むと WebGL / Cesium が落ちるため。
 */
function addDragGhostSilhouette(
  viewer: Viewer,
  placement: PlacedStructure,
  invalid: boolean,
): void {
  const prefix = DRAG_GHOST_ENTITY_PREFIX;
  const groundHeight = resolveGroundHeightMeters(viewer, placement);
  const heading = CesiumMath.toRadians(
    Number.isFinite(placement.headingDegrees) ? placement.headingDegrees : 0,
  );
  const footprint = getStructureFootprintMeters(placement.structureId);
  const fill = Color.fromCssColorString(invalid ? "#ef6b4a" : "#5ec8ff").withAlpha(
    invalid ? 0.35 : 0.42,
  );
  const outline = Color.fromCssColorString(invalid ? "#ffb0a0" : "#9fe4ff").withAlpha(0.9);

  viewer.entities.add({
    id: `${prefix}-${placement.id}-marker`,
    position: Cartesian3.fromDegrees(
      placement.position.longitude,
      placement.position.latitude,
      groundHeight + 0.1,
    ),
    ellipse: {
      semiMajorAxis: Math.max(footprint.length, footprint.width) * 0.35,
      semiMinorAxis: Math.max(footprint.length, footprint.width) * 0.35,
      material: fill.withAlpha(invalid ? 0.16 : 0.2),
      outline: true,
      outlineColor: outline,
      outlineWidth: 1,
    },
  });

  const bodyHeight = Math.min(Math.max(footprint.height, 4), 14);
  viewer.entities.add({
    id: `${prefix}-${placement.id}`,
    position: Cartesian3.fromDegrees(
      placement.position.longitude,
      placement.position.latitude,
      groundHeight + bodyHeight * 0.5,
    ),
    orientation: Transforms.headingPitchRollQuaternion(
      Cartesian3.fromDegrees(
        placement.position.longitude,
        placement.position.latitude,
        groundHeight,
      ),
      new HeadingPitchRoll(heading, 0, 0),
    ),
    box: new BoxGraphics({
      dimensions: new Cartesian3(
        Math.min(footprint.length, 100),
        Math.min(footprint.width, 48),
        bodyHeight,
      ),
      material: fill,
      outline: true,
      outlineColor: outline,
      outlineWidth: 1,
      shadows: ShadowMode.DISABLED,
    }),
  });

  const tip = offsetLonLatMeters(
    placement.position.longitude,
    placement.position.latitude,
    0,
    Math.min(footprint.length * 0.45, 48),
    heading,
  );
  viewer.entities.add({
    id: `${prefix}-${placement.id}-heading`,
    polyline: {
      positions: Cartesian3.fromDegreesArrayHeights([
        placement.position.longitude,
        placement.position.latitude,
        groundHeight + bodyHeight + 0.8,
        tip.longitude,
        tip.latitude,
        groundHeight + bodyHeight + 0.8,
      ]),
      width: 4,
      material: outline,
      clampToGround: false,
    },
  });
}

function addCivilEngineeringModel(
  viewer: Viewer,
  placement: PlacedStructure,
  selected: boolean,
  preview = false,
  options: StructureModelOptions = {},
): void {
  const prefix = options.entityIdPrefix ?? "placement";
  const invalid = options.invalid === true;
  const showHeadingCue = options.showHeadingCue ?? preview;
  const heading = CesiumMath.toRadians(
    Number.isFinite(placement.headingDegrees) ? placement.headingDegrees : 0,
  );
  const parts = getStructureModelParts(placement.structureId);
  const outlineColor = invalid
    ? Color.fromCssColorString("#ff8b6b")
    : preview
      ? Color.fromCssColorString("#7ad8ff")
      : selected
        ? Color.fromCssColorString("#f0b429")
        : Color.WHITE.withAlpha(0.35);
  // 非同期で地形プロバイダーが切り替わっても埋没しないよう、配置時の地表高を絶対標高にする。
  const groundHeight = resolveGroundHeightMeters(viewer, placement);

  const markerRadius = selected || preview || invalid ? 36 : 18;
  viewer.entities.add({
    id: `${prefix}-${placement.id}-marker`,
    position: Cartesian3.fromDegrees(
      placement.position.longitude,
      placement.position.latitude,
      groundHeight + 0.12,
    ),
    ellipse: {
      semiMajorAxis: markerRadius,
      semiMinorAxis: markerRadius,
      material: Color.fromCssColorString(
        invalid ? "#ef6b4a" : preview ? "#5ec8ff" : selected ? "#f0b429" : "#58d5a1",
      ).withAlpha(invalid ? 0.22 : preview ? 0.28 : selected ? 0.24 : 0.1),
      outline: selected || preview || invalid,
      outlineColor,
      // WebGL1 環境では outlineWidth>1 が例外になることがある。
      outlineWidth: 1,
    },
  });

  // 仮配置中（または明示指定時）のみ向き矢印を示す。確定後は向き固定。
  if (showHeadingCue) {
    const tip = offsetLonLatMeters(
      placement.position.longitude,
      placement.position.latitude,
      0,
      52,
      heading,
    );
    const arrowColor = Color.fromCssColorString(
      invalid ? "#ffb0a0" : preview ? "#9fe4ff" : "#ffd56a",
    ).withAlpha(0.95);
    viewer.entities.add({
      id: `${prefix}-${placement.id}-heading`,
      polyline: {
        positions: Cartesian3.fromDegreesArrayHeights([
          placement.position.longitude,
          placement.position.latitude,
          groundHeight + 1.4,
          tip.longitude,
          tip.latitude,
          groundHeight + 1.4,
        ]),
        width: 6,
        material: arrowColor,
        clampToGround: false,
      },
    });
    viewer.entities.add({
      id: `${prefix}-${placement.id}-heading-tip`,
      position: Cartesian3.fromDegrees(tip.longitude, tip.latitude, groundHeight + 2.4),
      orientation: Transforms.headingPitchRollQuaternion(
        Cartesian3.fromDegrees(tip.longitude, tip.latitude, groundHeight),
        new HeadingPitchRoll(heading, -CesiumMath.PI_OVER_TWO, 0),
      ),
      cylinder: new CylinderGraphics({
        length: 10,
        topRadius: 0.15,
        bottomRadius: 4.5,
        material: arrowColor,
        outline: false,
        shadows: ShadowMode.DISABLED,
      }),
    });
  }

  for (const [index, part] of parts.entries()) {
    const { longitude, latitude } = offsetLonLatMeters(
      placement.position.longitude,
      placement.position.latitude,
      part.offsetEast ?? 0,
      part.offsetNorth ?? 0,
      heading,
    );
    const position = Cartesian3.fromDegrees(longitude, latitude, groundHeight + part.centerHeight);
    const isPrimaryPart = index === 0;
    const orientation = Transforms.headingPitchRollQuaternion(
      Cartesian3.fromDegrees(longitude, latitude, groundHeight),
      new HeadingPitchRoll(heading, 0, 0),
    );
    const isCylinder = part.kind === "cylinder";
    // ImageMaterial（キャンバス procedural）は堤防など多パーツで描画例外→白画面になりやすい。
    // 見た目の識別色は solid ColorMaterial で十分出せる。
    let material;
    try {
      material = createStructureMaterial(part.material, {
        preview: preview || invalid,
        accentHex: invalid ? "#ef6b4a" : part.accentHex,
        repeatX: part.repeatX,
        repeatY: part.repeatY,
        solidOnly: true,
      });
    } catch (error) {
      console.warn("Structure material failed", part.material, error);
      material = new ColorMaterialProperty(
        Color.fromCssColorString(invalid ? "#ef6b4a" : "#9aa3a8").withAlpha(0.7),
      );
    }
    const showOutline = selected || preview || invalid;
    const entityId = isPrimaryPart
      ? `${prefix}-${placement.id}`
      : `${prefix}-${placement.id}-part-${part.id}`;

    try {
      if (isCylinder) {
        viewer.entities.add({
          id: entityId,
          position,
          orientation,
          cylinder: new CylinderGraphics({
            length: Math.max(part.dimensions?.height ?? 1, 1.2),
            topRadius: part.radius ?? 10,
            bottomRadius: part.radius ?? 10,
            material,
            outline: showOutline,
            outlineColor,
            outlineWidth: 1,
            shadows: ShadowMode.DISABLED,
          }),
        });
        continue;
      }

      if (part.dimensions === undefined) {
        continue;
      }

      viewer.entities.add({
        id: entityId,
        position,
        orientation,
        box: new BoxGraphics({
          dimensions: new Cartesian3(
            part.dimensions.length,
            part.dimensions.width,
            Math.max(part.dimensions.height, 0.8),
          ),
          material,
          outline: showOutline,
          outlineColor,
          outlineWidth: 1,
          shadows: ShadowMode.DISABLED,
        }),
      });
    } catch (error) {
      console.warn("Skipped structure part", placement.structureId, part.id, error);
    }
  }

  const footprint = getStructureFootprintMeters(placement.structureId);
  const beaconColor = Color.fromCssColorString(
    invalid ? "#ef6b4a" : selected ? "#f0b429" : preview ? "#5ec8ff" : "#48d597",
  ).withAlpha(preview || invalid ? 0.72 : 0.88);
  viewer.entities.add({
    id: `${prefix}-${placement.id}-beacon`,
    position: Cartesian3.fromDegrees(
      placement.position.longitude,
      placement.position.latitude,
      groundHeight + footprint.height + 6,
    ),
    cylinder: new CylinderGraphics({
      length: 12,
      topRadius: 0.75,
      bottomRadius: 0.75,
      material: beaconColor,
      outline: true,
      outlineColor: Color.WHITE.withAlpha(0.58),
      outlineWidth: 1,
      shadows: ShadowMode.DISABLED,
    }),
  });
}

/** 施設パーツの東西南北オフセット（m）を経度緯度へ変換する。 */
function offsetLonLatMeters(
  longitude: number,
  latitude: number,
  offsetEast: number,
  offsetNorth: number,
  heading: number,
): { longitude: number; latitude: number } {
  const rotatedEast = offsetEast * Math.cos(heading) - offsetNorth * Math.sin(heading);
  const rotatedNorth = offsetEast * Math.sin(heading) + offsetNorth * Math.cos(heading);
  const metersPerDegreeLat = 110_540;
  const metersPerDegreeLon = 111_320 * Math.cos(CesiumMath.toRadians(latitude));
  return {
    longitude: longitude + rotatedEast / metersPerDegreeLon,
    latitude: latitude + rotatedNorth / metersPerDegreeLat,
  };
}
