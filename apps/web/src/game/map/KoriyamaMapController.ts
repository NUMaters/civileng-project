import {
  Cartesian3,
  Cesium3DTileset,
  CesiumTerrainProvider,
  EllipsoidTerrainProvider,
  HeadingPitchRange,
  ImageryLayer,
  Math as CesiumMath,
  Matrix4,
  UrlTemplateImageryProvider,
  Viewer,
} from "cesium";
import { getCesiumPerformanceSettings } from "./cesiumPerformance";

const BUILDINGS_URL: string =
  "https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/07203-bldg-lod1-latest/tileset.json";
const TERRAIN_URL: string = "https://tile.plateauview.mlit.go.jp/terrain";
const GSI_IMAGERY_URL: string = "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png";
const KORIYAMA_LONGITUDE: number = 140.3597;
const KORIYAMA_LATITUDE: number = 37.4003;
const CAMERA_HEADING_DEGREES: number = 20;
const CAMERA_PITCH_DEGREES: number = -35;
const CAMERA_RANGE_METERS: number = 3_200;
const MAXIMUM_ZOOM_DISTANCE_METERS: number = 25_000;
const MINIMUM_ZOOM_DISTANCE_METERS: number = 30;
const GSI_MAXIMUM_LEVEL: number = 18;
const MOBILE_QUERY: string = "(max-width: 767px), (pointer: coarse)";

export type KoriyamaMapCallbacks = {
  readonly onReady: () => void;
  readonly onTerrainFallback: () => void;
  readonly onFatalError: (error: unknown) => void;
};

export class KoriyamaMapController {
  private viewer: Viewer | undefined;
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
      this.resetCamera();

      const terrainPromise: Promise<void> = this.loadTerrain();
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

    const target: Cartesian3 = Cartesian3.fromDegrees(KORIYAMA_LONGITUDE, KORIYAMA_LATITUDE);
    this.viewer.camera.lookAt(
      target,
      new HeadingPitchRange(
        CesiumMath.toRadians(CAMERA_HEADING_DEGREES),
        CesiumMath.toRadians(CAMERA_PITCH_DEGREES),
        CAMERA_RANGE_METERS,
      ),
    );
    this.viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    this.viewer.scene.requestRender();
  }

  public destroy(): void {
    this.destroyed = true;
    if (this.viewer !== undefined && !this.viewer.isDestroyed()) {
      this.viewer.destroy();
    }
    this.viewer = undefined;
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

    viewer.scene.primitives.add(tileset);
    await this.waitForInitialTiles(tileset);
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
