import {
  BoxGraphics,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Cesium3DTileset,
  CesiumTerrainProvider,
  Color,
  Credit,
  CustomHeightmapTerrainProvider,
  CustomShader,
  CylinderGraphics,
  DirectionalLight,
  EllipsoidTerrainProvider,
  HeadingPitchRange,
  HeadingPitchRoll,
  HeightReference,
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
  clearLegacyFloodZones,
  getBreachDisplayName,
  syncOverflowVisualization,
} from "./overflowVisualization";
import { createPlaceableZone } from "./placeableZone";
import { syncProtectionVisualization } from "./protectionVisualization";
import {
  nearestPointOnPolyline,
  resolvePlaceablePosition,
} from "./riverPlacement";
import {
  createRiverWaterSurface,
  type RiverWaterSurfaceController,
} from "./riverWaterSurface";
import { createStructureMaterial } from "./structureMaterials";
import { getStructureModelParts } from "./structureModels";
import type {
  OverflowSite,
  ProtectedBankSite,
  StructureInfluence,
} from "../../features/disaster/services/floodSimulation";

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
/** 施設回転ドラッグを開始する画面移動量（CSS px）。 */
const ROTATE_START_MOVE_PX = 8;
/** 左右ドラッグ 1px あたりの回転角（度）。タッチでも扱いやすい感度。 */
const ROTATE_DEGREES_PER_PX = 0.55;
/** モデルを直接拾えなくても中心付近なら選択できる半径（CSS px）。 */
const PLACEMENT_PICK_RADIUS_PX = 64;
/** 回転終了時に揃える角度刻み（度）。 */
const ROTATE_SNAP_DEGREES = 5;

export type CesiumGameMapHandle = {
  tryDropStructure: (structureId: string, clientX: number, clientY: number) => boolean;
};

type CesiumGameMapProps = {
  placements: PlacedStructure[];
  structures: StructureDefinition[];
  selectedPlacementId: string | null;
  onDropPlace: (structureId: string, position: GeoPosition, headingDegrees: number) => void;
  onRotatePlacement: (placementId: string, headingDegrees: number) => void;
  onSelectPlacement: (placementId: string | null) => void;
  onInvalidPosition: (message: string) => void;
  /** カメラ操作終了時の画面中央注視点（プレイヤー移動の Phase 1 同期用）。 */
  onCameraFocusChange?: (position: GeoPosition) => void;
  floodState?: {
    active: boolean;
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
};

export const CesiumGameMap = forwardRef<CesiumGameMapHandle, CesiumGameMapProps>(
  function CesiumGameMap(
    {
      placements,
      structures,
      selectedPlacementId,
      onDropPlace,
      onRotatePlacement,
      onSelectPlacement,
      onInvalidPosition,
      onCameraFocusChange,
      floodState,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<Viewer | null>(null);
    const buildingTilesetRef = useRef<Cesium3DTileset | null>(null);
    const riverWaterRef = useRef<RiverWaterSurfaceController | null>(null);
    const placeableZoneRef = useRef<{ destroy: () => void } | null>(null);
    const floodStateRef = useRef(floodState);
    const labelElementRefs = useRef(new Map<string, HTMLDivElement>());
    const orientationHudRef = useRef<HTMLDivElement | null>(null);
    const placementsRef = useRef(placements);
    const structuresRef = useRef(structures);
    const onDropPlaceRef = useRef(onDropPlace);
    const onRotatePlacementRef = useRef(onRotatePlacement);
    const onSelectPlacementRef = useRef(onSelectPlacement);
    const onInvalidPositionRef = useRef(onInvalidPosition);
    const onCameraFocusChangeRef = useRef(onCameraFocusChange);
    const selectedPlacementIdRef = useRef(selectedPlacementId);
    const [mapError, setMapError] = useState<string | null>(null);
    const [isMapReady, setIsMapReady] = useState(false);
    const [visibilityEpoch, setVisibilityEpoch] = useState(0);

    const facilityLabels = useMemo(
      () =>
        placements.map((placement) => {
          const displayName =
            structures.find(({ id }) => id === placement.structureId)?.displayName ?? "施設";
          const preview = placement.preview === true;
          return {
            id: placement.id,
            kind: "facility" as const,
            text: preview ? `${displayName}（仮）` : displayName,
            selected: placement.id === selectedPlacementId,
            preview,
            longitude: placement.position.longitude,
            latitude: placement.position.latitude,
            height: placement.position.height,
          };
        }),
      [placements, selectedPlacementId, structures],
    );

    /** 仮配置または選択中の施設。その手前に向きスライダーを追従表示する。 */
    const orientationTarget = useMemo(() => {
      const preview = placements.find((placement) => placement.preview === true);
      if (preview !== undefined) {
        return preview;
      }
      if (selectedPlacementId === null) {
        return null;
      }
      return placements.find((placement) => placement.id === selectedPlacementId) ?? null;
    }, [placements, selectedPlacementId]);

    const breachLabels = useMemo(() => {
      if (floodState?.active !== true) {
        return [];
      }
      return (floodState.overflowSites ?? []).map((site) => ({
        id: site.id,
        kind: "breach" as const,
        text: getBreachDisplayName(site.id),
        selected: false,
        preview: false,
        longitude: site.longitude,
        latitude: site.latitude,
        height: 2,
      }));
    }, [floodState?.active, floodState?.overflowSites]);

    const mapLabels = useMemo(
      () => [...facilityLabels, ...breachLabels],
      [breachLabels, facilityLabels],
    );

    useEffect(() => {
      placementsRef.current = placements;
      structuresRef.current = structures;
      onDropPlaceRef.current = onDropPlace;
      onRotatePlacementRef.current = onRotatePlacement;
      onSelectPlacementRef.current = onSelectPlacement;
      onInvalidPositionRef.current = onInvalidPosition;
      onCameraFocusChangeRef.current = onCameraFocusChange;
      selectedPlacementIdRef.current = selectedPlacementId;
      floodStateRef.current = floodState;
    }, [
      floodState,
      onCameraFocusChange,
      onDropPlace,
      onInvalidPosition,
      onRotatePlacement,
      onSelectPlacement,
      placements,
      selectedPlacementId,
      structures,
    ]);

    useImperativeHandle(ref, () => ({
      tryDropStructure: (structureId: string, clientX: number, clientY: number) => {
        const viewer = viewerRef.current;
        if (viewer === null || viewer.isDestroyed()) {
          return false;
        }
        const canvas = viewer.scene.canvas;
        const rect = canvas.getBoundingClientRect();
        const screen = new Cartesian2(clientX - rect.left, clientY - rect.top);
        if (screen.x < 0 || screen.y < 0 || screen.x > rect.width || screen.y > rect.height) {
          onInvalidPositionRef.current("地図の上にドロップしてください");
          return false;
        }

        const picked = pickPlacementPosition(viewer, screen);
        if (picked === undefined) {
          onInvalidPositionRef.current("地表を取得できませんでした");
          return false;
        }
        if (!isInsidePlayArea(picked)) {
          onInvalidPositionRef.current("プレイ範囲外です。阿武隈川周辺に戻してください");
          return false;
        }
        const placeable = resolvePlaceablePosition(picked);
        if (placeable === undefined) {
          onInvalidPositionRef.current(
            "阿武隈川の河道または河岸（薄い青い帯）に置いてください。市街地には置けません",
          );
          return false;
        }

        const headingDegrees = CesiumMath.toDegrees(viewer.camera.heading);
        onDropPlaceRef.current(structureId, placeable, headingDegrees);
        return true;
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
        mapViewer.scene.screenSpaceCameraController.enableTilt = true;
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

        // 水面の Water マテリアル／流向ストリークは毎フレーム更新が必要なので描画を継続する。
        const keepWaterAnimating = () => {
          if (disposed || mapViewer.isDestroyed()) {
            return;
          }
          if (!document.hidden) {
            mapViewer.scene.requestRender();
          }
          waterRenderFrame = window.requestAnimationFrame(keepWaterAnimating);
        };
        waterRenderFrame = window.requestAnimationFrame(keepWaterAnimating);

        placeableZoneRef.current?.destroy();
        placeableZoneRef.current = createPlaceableZone(mapViewer);

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
          constrainCameraFocusNearRiver(mapViewer);
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

        // 設置済み施設の選択・左右ドラッグ回転（配置自体はドックからのドロップ）
        const canvas = mapViewer.scene.canvas;
        eventHandler = new ScreenSpaceEventHandler(canvas);
        type RotateSession = {
          placementId: string;
          startX: number;
          startHeadingDegrees: number;
          active: boolean;
          liveHeadingDegrees: number;
        };
        let pointerDown: Cartesian2 | undefined;
        let rotateSession: RotateSession | undefined;

        const liveRotate = (headingDegrees: number, placementId: string) => {
          const placement = placementsRef.current.find(({ id }) => id === placementId);
          if (placement === undefined) {
            return;
          }
          applyPlacementHeading(
            mapViewer,
            { ...placement, headingDegrees },
            true,
            placement.preview === true,
          );
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
            rotateSession = undefined;
            return;
          }
          const placement = placementsRef.current.find(({ id }) => id === pickedId);
          if (placement === undefined) {
            rotateSession = undefined;
            return;
          }
          onSelectPlacementRef.current(pickedId);
          canvas.style.cursor = "ew-resize";
          rotateSession = {
            placementId: pickedId,
            startX: event.position.x,
            startHeadingDegrees: placement.headingDegrees,
            active: false,
            liveHeadingDegrees: placement.headingDegrees,
          };
        }, ScreenSpaceEventType.LEFT_DOWN);

        eventHandler.setInputAction((event: { endPosition: Cartesian2 }) => {
          if (pointerDown === undefined || rotateSession === undefined) {
            return;
          }
          const distance = Cartesian2.distance(pointerDown, event.endPosition);
          if (!rotateSession.active && distance > ROTATE_START_MOVE_PX) {
            rotateSession.active = true;
            mapViewer.scene.screenSpaceCameraController.enableInputs = false;
          }
          if (!rotateSession.active) {
            return;
          }
          // 右へドラッグ＝時計回り。円周ドラッグより指先で安定する。
          const deltaX = event.endPosition.x - rotateSession.startX;
          const nextHeading = rotateSession.startHeadingDegrees + deltaX * ROTATE_DEGREES_PER_PX;
          rotateSession.liveHeadingDegrees = nextHeading;
          liveRotate(nextHeading, rotateSession.placementId);
        }, ScreenSpaceEventType.MOUSE_MOVE);

        eventHandler.setInputAction((event: { position: Cartesian2 }) => {
          const session = rotateSession;
          const down = pointerDown;
          pointerDown = undefined;
          rotateSession = undefined;
          mapViewer.scene.screenSpaceCameraController.enableInputs = true;
          canvas.style.cursor = "";

          if (session?.active === true) {
            const deltaX = event.position.x - session.startX;
            const rawHeading = session.startHeadingDegrees + deltaX * ROTATE_DEGREES_PER_PX;
            const snapped =
              Math.round(rawHeading / ROTATE_SNAP_DEGREES) * ROTATE_SNAP_DEGREES;
            onRotatePlacementRef.current(session.placementId, snapped);
            return;
          }

          if (down === undefined) {
            return;
          }
          if (Cartesian2.distance(down, event.position) > ROTATE_START_MOVE_PX) {
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
        riverWaterRef.current?.destroy();
        riverWaterRef.current = null;
        placeableZoneRef.current?.destroy();
        placeableZoneRef.current = null;
        if (viewer != null && !viewer.isDestroyed()) {
          destroyNearOverflowFloodplain(viewer);
        }
        viewerRef.current = null;
        buildingTilesetRef.current = null;
        viewer?.destroy();
      };
    }, [visibilityEpoch]);

    useEffect(() => {
      const viewer = viewerRef.current;
      if (viewer === null) {
        return;
      }

      for (const entity of [...viewer.entities.values]) {
        if (entity.id.startsWith("placement-")) {
          viewer.entities.remove(entity);
        }
      }

      for (const placement of placements) {
        addCivilEngineeringModel(
          viewer,
          placement,
          placement.id === selectedPlacementId,
          placement.preview === true,
        );
      }
      viewer.scene.requestRender();
    }, [placements, selectedPlacementId, structures]);

    useEffect(() => {
      const viewer = viewerRef.current;
      if (viewer === null || viewer.isDestroyed()) {
        return;
      }

      const sites =
        floodState?.active === true ? (floodState.overflowSites ?? []) : [];
      syncProtectionVisualization(
        viewer,
        floodState?.structureInfluences ?? [],
        floodState?.protectedBankSites ?? [],
        { showBankSites: floodState?.active === true },
      );
      syncNearOverflowFloodplain(viewer, {
        active: floodState?.active === true,
        riverLevelMeters: floodState?.riverLevelMeters ?? 2.2,
        overflowMeters: floodState?.overflowMeters ?? 0,
        overflowLevelMeters: floodState?.overflowLevelMeters,
      });
      syncOverflowVisualization(
        viewer,
        sites,
        floodState?.floodDepthMeters ?? 0,
        floodState?.floodedAreaPercent ?? 0,
      );
      // 旧・無関係な固定浸水ゾーンは使わない（決壊地点からの浸水のみ）。
      clearLegacyFloodZones(viewer);
      viewer.scene.requestRender();
    }, [
      floodState?.active,
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
        for (const label of mapLabels) {
          const element = labelElementRefs.current.get(`${label.kind}-${label.id}`);
          if (element === undefined) {
            continue;
          }
          const screen = viewer.scene.cartesianToCanvasCoordinates(
            Cartesian3.fromDegrees(
              label.longitude,
              label.latitude,
              label.height + (label.kind === "breach" ? 14 : 8),
            ),
          );
          applyScreenLabelPosition(element, screen, 0, label.kind === "breach" ? -36 : -28);
        }

        const hud = orientationHudRef.current;
        const target = orientationTarget;
        if (hud !== null && target !== null) {
          const screen = viewer.scene.cartesianToCanvasCoordinates(
            Cartesian3.fromDegrees(
              target.position.longitude,
              target.position.latitude,
              target.position.height + 6,
            ),
          );
          // 施設の手前（画面下側）にスライダーを置く。
          applyScreenHudPosition(hud, screen, 0, 28);
        }
      };

      syncOverlayPositions();
      const removeListener = viewer.scene.postRender.addEventListener(syncOverlayPositions);
      viewer.scene.requestRender();
      return () => {
        removeListener();
      };
    }, [isMapReady, mapLabels, orientationTarget, visibilityEpoch]);

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
              className={`cesium-map-label${label.selected ? " is-selected" : ""}${label.preview ? " is-preview" : ""}${label.kind === "breach" ? " is-breach" : ""}`}
            >
              {label.text}
            </div>
          ))}
        </div>
        {orientationTarget !== null ? (
          <div
            ref={orientationHudRef}
            className={`cesium-orientation-hud${orientationTarget.preview === true ? " is-preview" : ""}`}
          >
            <RotationControls
              floating
              headingDegrees={orientationTarget.headingDegrees}
              onChange={(headingDegrees) =>
                onRotatePlacement(orientationTarget.id, headingDegrees)
              }
            />
          </div>
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

/** 施設の手前など、アンカー点の下に UI を置く。 */
function applyScreenHudPosition(
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
  element.style.transform = `translate(${screen.x + offsetX}px, ${screen.y + offsetY}px) translate(-50%, 0)`;
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
      return {
        longitude: CesiumMath.toDegrees(cartographic.longitude),
        latitude: CesiumMath.toDegrees(cartographic.latitude),
        height: terrainHeight ?? cartographic.height,
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
  return {
    longitude: CesiumMath.toDegrees(cartographic.longitude),
    latitude: CesiumMath.toDegrees(cartographic.latitude),
    height: cartographic.height,
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
  addCivilEngineeringModel(viewer, placement, selected, preview);
}

function addCivilEngineeringModel(
  viewer: Viewer,
  placement: PlacedStructure,
  selected: boolean,
  preview = false,
): void {
  const heading = CesiumMath.toRadians(placement.headingDegrees);
  const parts = getStructureModelParts(placement.structureId);
  const outlineColor = preview
    ? Color.fromCssColorString("#7ad8ff")
    : selected
      ? Color.fromCssColorString("#f0b429")
      : Color.WHITE.withAlpha(0.35);
  // 非同期で地形プロバイダーが切り替わっても埋没しないよう、配置時の地表高を絶対標高にする。
  const groundHeight = Math.max(
    0,
    viewer.scene.globe.getHeight(
      Cartographic.fromDegrees(placement.position.longitude, placement.position.latitude),
    ) ?? placement.position.height,
  );

  const markerRadius = selected || preview ? 36 : 18;
  viewer.entities.add({
    id: `placement-${placement.id}-marker`,
    position: Cartesian3.fromDegrees(
      placement.position.longitude,
      placement.position.latitude,
      groundHeight + 0.12,
    ),
    ellipse: {
      semiMajorAxis: markerRadius,
      semiMinorAxis: markerRadius,
      material: Color.fromCssColorString(
        preview ? "#5ec8ff" : selected ? "#f0b429" : "#58d5a1",
      ).withAlpha(preview ? 0.28 : selected ? 0.24 : 0.1),
      outline: selected || preview,
      outlineColor,
    },
  });

  // 選択中・仮配置中は向きを矢印で示す（操作の手がかり）。
  if (selected || preview) {
    const tip = offsetLonLatMeters(
      placement.position.longitude,
      placement.position.latitude,
      0,
      52,
      heading,
    );
    const arrowColor = Color.fromCssColorString(preview ? "#9fe4ff" : "#ffd56a").withAlpha(0.95);
    viewer.entities.add({
      id: `placement-${placement.id}-heading`,
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
      id: `placement-${placement.id}-heading-tip`,
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
    const material = createStructureMaterial(part.material, {
      preview,
      accentHex: part.accentHex,
      repeatX: part.repeatX,
      repeatY: part.repeatY,
    });
    const showOutline = selected || preview;
    const outlineWidth = selected || preview ? 2 : 0;

    if (part.kind === "cylinder") {
      viewer.entities.add({
        id: isPrimaryPart ? `placement-${placement.id}` : `placement-${placement.id}-${part.id}`,
        position,
        orientation,
        cylinder: new CylinderGraphics({
          length: Math.max(part.dimensions?.height ?? 1, 1.2),
          topRadius: part.radius ?? 10,
          bottomRadius: part.radius ?? 10,
          material,
          outline: showOutline,
          outlineColor,
          outlineWidth,
          shadows: ShadowMode.DISABLED,
        }),
      });
      continue;
    }

    if (part.dimensions === undefined) {
      continue;
    }

    viewer.entities.add({
      id: isPrimaryPart ? `placement-${placement.id}` : `placement-${placement.id}-${part.id}`,
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
        outlineWidth,
        shadows: ShadowMode.DISABLED,
      }),
    });
  }
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

