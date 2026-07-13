import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Cesium3DTileset,
  CesiumTerrainProvider,
  ClippingPolygon,
  ClippingPolygonCollection,
  EllipsoidTerrainProvider,
  HeadingPitchRange,
  ImageryLayer,
  Math as CesiumMath,
  Matrix4,
  UrlTemplateImageryProvider,
  Viewer,
} from "cesium";
import { getCesiumPerformanceSettings } from "./cesiumPerformance";
import {
  isCoordinateInPlayArea,
  loadKoriyamaRiverPlayArea,
  type GeographicCoordinate,
  type RiverPlayArea,
} from "./riverPlayArea";

const BUILDINGS_URL: string =
  "https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/07203-bldg-lod1-latest/tileset.json";
const TERRAIN_URL: string = "https://tile.plateauview.mlit.go.jp/terrain";
const GSI_IMAGERY_URL: string = "https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg";
const KORIYAMA_LONGITUDE: number = 140.3597;
const KORIYAMA_LATITUDE: number = 37.4003;
const CAMERA_HEADING_DEGREES: number = 20;
const CAMERA_PITCH_DEGREES: number = -35;
const CAMERA_RANGE_METERS: number = 3_200;
const MAXIMUM_ZOOM_DISTANCE_METERS: number = 25_000;
const MINIMUM_ZOOM_DISTANCE_METERS: number = 30;
const GSI_MAXIMUM_LEVEL: number = 18;
const MOBILE_QUERY: string = "(max-width: 767px), (pointer: coarse)";
const CAMERA_CHANGE_PERCENTAGE: number = 0.03;

type CameraState = {
  readonly position: Cartesian3;
  readonly direction: Cartesian3;
  readonly up: Cartesian3;
};

export type KoriyamaMapCallbacks = {
  readonly onReady: () => void;
  readonly onTerrainFallback: () => void;
  readonly onFatalError: (error: unknown) => void;
};

export class KoriyamaMapController {
  private viewer: Viewer | undefined;
  private playArea: RiverPlayArea | undefined;
  private lastValidCameraState: CameraState | undefined;
  private removeCameraConstraint: (() => void) | undefined;
  private readonly abortController: AbortController = new AbortController();
  private isRestoringCamera: boolean = false;
  private destroyed: boolean = false;

  public constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: KoriyamaMapCallbacks,
  ) {}

  public async initialize(): Promise<void> {
    if (!this.isWebGlAvailable()) {
      const webGlError: Error = new Error("WebGL is not available");
      this.callbacks.onFatalError(webGlError);
      throw webGlError;
    }

    try {
      this.viewer = this.createViewer();
      const terrainPromise: Promise<void> = this.loadTerrain();
      this.playArea = await loadKoriyamaRiverPlayArea(this.abortController.signal);
      this.applyGlobeClipping(this.playArea);
      this.resetCamera();
      this.installCameraConstraint();

      const buildingsPromise: Promise<void> = this.loadBuildings();
      await Promise.all([terrainPromise, buildingsPromise]);

      if (!this.destroyed && !this.viewer.isDestroyed()) {
        this.viewer.scene.requestRender();
        this.callbacks.onReady();
      }
    } catch (error: unknown) {
      if (this.destroyed) {
        return;
      }
      this.callbacks.onFatalError(error);
      throw error;
    }
  }

  public resetCamera(): void {
    if (this.viewer === undefined || this.viewer.isDestroyed()) {
      return;
    }

    const targetCoordinate: GeographicCoordinate = this.playArea?.cameraTarget ?? [
      KORIYAMA_LONGITUDE,
      KORIYAMA_LATITUDE,
    ];
    const target: Cartesian3 = Cartesian3.fromDegrees(targetCoordinate[0], targetCoordinate[1]);
    this.viewer.camera.lookAt(
      target,
      new HeadingPitchRange(
        CesiumMath.toRadians(CAMERA_HEADING_DEGREES),
        CesiumMath.toRadians(CAMERA_PITCH_DEGREES),
        CAMERA_RANGE_METERS,
      ),
    );
    this.viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    this.lastValidCameraState = this.getCameraState();
    this.viewer.scene.requestRender();
  }

  public destroy(): void {
    this.destroyed = true;
    this.abortController.abort();
    this.removeCameraConstraint?.();
    this.removeCameraConstraint = undefined;
    if (this.viewer !== undefined && !this.viewer.isDestroyed()) {
      this.viewer.destroy();
    }
    this.viewer = undefined;
    this.playArea = undefined;
    this.lastValidCameraState = undefined;
  }

  private createViewer(): Viewer {
    const baseLayer: ImageryLayer = new ImageryLayer(
      new UrlTemplateImageryProvider({
        url: GSI_IMAGERY_URL,
        maximumLevel: GSI_MAXIMUM_LEVEL,
        credit: "国土地理院",
      }),
    );
    const viewer: Viewer = new Viewer(this.container, {
      animation: false,
      timeline: false,
      geocoder: false,
      baseLayerPicker: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      homeButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      scene3DOnly: true,
      requestRenderMode: true,
      maximumRenderTimeChange: Number.POSITIVE_INFINITY,
      terrainProvider: new EllipsoidTerrainProvider(),
      baseLayer,
    });
    const isMobile: boolean = window.matchMedia(MOBILE_QUERY).matches;
    const performanceSettings = getCesiumPerformanceSettings(isMobile);

    viewer.resolutionScale = performanceSettings.resolutionScale;
    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.scene.globe.maximumScreenSpaceError = isMobile ? 4 : 2;
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = MINIMUM_ZOOM_DISTANCE_METERS;
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = MAXIMUM_ZOOM_DISTANCE_METERS;
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
    viewer.camera.percentageChanged = CAMERA_CHANGE_PERCENTAGE;

    return viewer;
  }

  private async loadTerrain(): Promise<void> {
    if (this.viewer === undefined) {
      throw new Error("Cesium viewer has not been created");
    }
    const viewer: Viewer = this.viewer;

    try {
      const terrainProvider: CesiumTerrainProvider = await CesiumTerrainProvider.fromUrl(
        TERRAIN_URL,
        {
          requestVertexNormals: false,
          requestWaterMask: false,
          credit: "PLATEAU | Mapterhorn | 国土地理院",
        },
      );

      if (!this.destroyed && !viewer.isDestroyed()) {
        viewer.terrainProvider = terrainProvider;
        viewer.scene.requestRender();
      }
    } catch (error: unknown) {
      if (this.destroyed) {
        return;
      }
      console.error("PLATEAU-Terrain の読み込みに失敗したため楕円体地形を使用します。", error);
      this.callbacks.onTerrainFallback();
    }
  }

  private async loadBuildings(): Promise<void> {
    if (this.viewer === undefined) {
      throw new Error("Cesium viewer has not been created");
    }
    const viewer: Viewer = this.viewer;

    const isMobile: boolean = window.matchMedia(MOBILE_QUERY).matches;
    const performanceSettings = getCesiumPerformanceSettings(isMobile);
    const tileset: Cesium3DTileset = await Cesium3DTileset.fromUrl(BUILDINGS_URL, {
      maximumScreenSpaceError: performanceSettings.maximumScreenSpaceError,
      dynamicScreenSpaceError: true,
      skipLevelOfDetail: true,
      baseScreenSpaceError: 1_024,
      skipScreenSpaceErrorFactor: 16,
      skipLevels: 1,
      immediatelyLoadDesiredLevelOfDetail: false,
      loadSiblings: false,
      cullWithChildrenBounds: true,
      cacheBytes: performanceSettings.cacheBytes,
    });

    if (this.destroyed || viewer.isDestroyed()) {
      tileset.destroy();
      return;
    }

    if (this.playArea !== undefined) {
      tileset.clippingPolygons = this.createClippingPolygons(this.playArea);
    }
    viewer.scene.primitives.add(tileset);
    await this.waitForInitialTiles(tileset);
  }

  private applyGlobeClipping(playArea: RiverPlayArea): void {
    if (this.viewer === undefined) {
      throw new Error("Cesium viewer has not been created");
    }
    if (!ClippingPolygonCollection.isSupported(this.viewer.scene)) {
      throw new Error("WebGL 2 clipping polygons are not supported by this browser");
    }
    this.viewer.scene.globe.clippingPolygons = this.createClippingPolygons(playArea);
    this.viewer.scene.requestRender();
  }

  private createClippingPolygons(playArea: RiverPlayArea): ClippingPolygonCollection {
    const polygons: ClippingPolygon[] = playArea.polygons.flatMap(
      (polygon: readonly (readonly GeographicCoordinate[])[]): ClippingPolygon[] => {
        const exterior: readonly GeographicCoordinate[] | undefined = polygon[0];
        if (exterior === undefined || exterior.length < 3) {
          return [];
        }
        const lastCoordinate: GeographicCoordinate | undefined = exterior.at(-1);
        const coordinates: readonly GeographicCoordinate[] =
          lastCoordinate !== undefined &&
          exterior[0][0] === lastCoordinate[0] &&
          exterior[0][1] === lastCoordinate[1]
            ? exterior.slice(0, -1)
            : exterior;
        const positions: Cartesian3[] = coordinates.map(
          (coordinate: GeographicCoordinate): Cartesian3 =>
            Cartesian3.fromDegrees(coordinate[0], coordinate[1]),
        );
        return [new ClippingPolygon({ positions })];
      },
    );
    if (polygons.length === 0) {
      throw new Error("River play area does not contain a valid clipping polygon");
    }
    return new ClippingPolygonCollection({ polygons, inverse: true });
  }

  private installCameraConstraint(): void {
    if (this.viewer === undefined || this.playArea === undefined) {
      return;
    }
    this.removeCameraConstraint?.();
    this.lastValidCameraState = this.getCameraState();
    this.removeCameraConstraint = this.viewer.camera.changed.addEventListener((): void => {
      this.enforceCameraConstraint();
    });
  }

  private enforceCameraConstraint(): void {
    if (
      this.viewer === undefined ||
      this.viewer.isDestroyed() ||
      this.playArea === undefined ||
      this.isRestoringCamera
    ) {
      return;
    }

    const target: GeographicCoordinate | undefined = this.getCameraTargetCoordinate();
    if (target === undefined || isCoordinateInPlayArea(target, this.playArea)) {
      this.lastValidCameraState = this.getCameraState();
      return;
    }

    const lastValidState: CameraState | undefined = this.lastValidCameraState;
    if (lastValidState === undefined) {
      this.resetCamera();
      return;
    }
    this.isRestoringCamera = true;
    this.viewer.camera.setView({
      destination: Cartesian3.clone(lastValidState.position),
      orientation: {
        direction: Cartesian3.clone(lastValidState.direction),
        up: Cartesian3.clone(lastValidState.up),
      },
    });
    this.viewer.scene.requestRender();
    this.isRestoringCamera = false;
  }

  private getCameraTargetCoordinate(): GeographicCoordinate | undefined {
    if (this.viewer === undefined) {
      return undefined;
    }
    const canvas: HTMLCanvasElement = this.viewer.scene.canvas;
    const screenCenter: Cartesian2 = new Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
    const surfacePosition: Cartesian3 | undefined = this.viewer.camera.pickEllipsoid(
      screenCenter,
      this.viewer.scene.globe.ellipsoid,
    );
    if (surfacePosition === undefined) {
      return undefined;
    }
    const cartographic: Cartographic = Cartographic.fromCartesian(surfacePosition);
    return [CesiumMath.toDegrees(cartographic.longitude), CesiumMath.toDegrees(cartographic.latitude)];
  }

  private getCameraState(): CameraState | undefined {
    if (this.viewer === undefined || this.viewer.isDestroyed()) {
      return undefined;
    }
    return {
      position: Cartesian3.clone(this.viewer.camera.positionWC),
      direction: Cartesian3.clone(this.viewer.camera.directionWC),
      up: Cartesian3.clone(this.viewer.camera.upWC),
    };
  }

  private waitForInitialTiles(tileset: Cesium3DTileset): Promise<void> {
    return new Promise((resolve: () => void, reject: (reason: Error) => void) => {
      const removeLoadedListener: () => void = tileset.initialTilesLoaded.addEventListener(() => {
        removeLoadedListener();
        removeFailedListener();
        resolve();
      });
      const removeFailedListener: () => void = tileset.tileFailed.addEventListener((error) => {
        removeLoadedListener();
        removeFailedListener();
        reject(new Error(`Failed to load 3D Tiles content: ${error.url}: ${error.message}`));
      });
      if (!this.destroyed) {
        this.viewer?.scene.requestRender();
      }
    });
  }

  private isWebGlAvailable(): boolean {
    try {
      const canvas: HTMLCanvasElement = document.createElement("canvas");
      return (
        canvas.getContext("webgl2") !== null ||
        canvas.getContext("webgl") !== null ||
        canvas.getContext("experimental-webgl") !== null
      );
    } catch {
      return false;
    }
  }
}
