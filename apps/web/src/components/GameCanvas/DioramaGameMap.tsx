// @refresh reset
// Renderer-owned objects must be rebuilt together when their runtime shape changes in development.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { CesiumGameMapHandle, CesiumGameMapProps } from "./CesiumGameMap";
import type { PlacedStructure } from "../../features/construction";
import { calculateStructureInfluences } from "../../features/disaster/services/floodSimulation";
import { suggestedStructureHeading } from "../../features/disaster/services/hydraulicPlacement";
import { resolvePlaceablePosition } from "./riverPlacement";
import { geoToWorld, riverX, worldToGeo } from "./dioramaSpace";
import { createGeographicWorld } from "./geographicWorld";
import { createGeographicTerrain } from "./geographicTerrain";
import { GEOGRAPHIC_LIGHTING_STYLE } from "./geographicLightingStyle";
import { createGeographicWaterMaterial, riverFlowCoordinates } from "./geographicWater";
import { createCameraFocusNotifier } from "./cameraFocusNotification";
import { createGeographicBridges } from "./geographicBridges";
import { createGeographicTrain } from "./geographicTrain";
import { followGeographicShadows } from "./geographicShadows";
import { createGeographicLandcover } from "./geographicLandcover";
import { createGeographicImageryVegetation } from "./geographicImageryVegetation";
import { createGeographicCanopy } from "./geographicCanopy";
import { createImageryVegetationExclusions } from "./imageryVegetationExclusions";
import { loadKoriyamaScene, type KoriyamaSceneData } from "./loadKoriyamaScene";
import { createDioramaInundation } from "./dioramaInundation";
import { createInlandPonding } from "./inlandPonding";
import { createRenderedWaterMask } from "./renderedWaterMask";
import { createDioramaFacility } from "./dioramaFacilities";
import { getDioramaGuidance, initialDioramaFocus, isPreferredDioramaGuidanceCandidate } from "./dioramaGuidance";
import { createGeographicGuidanceAnchors, selectGuidanceAdvice, selectGuidanceProjection } from "./geographicGuidanceAnchors";
import { FACILITY_TAP_SLOP, facilityPopScale, nextFacilityHeading } from "./facilityTap";
import "./diorama.css";
import { disposeDioramaObject as disposeObject } from "./disposeDioramaObject";
import { createFacilityOperationVisuals } from "./facilityOperationVisuals";
import { resolveFacilityActivity } from "./facilityActivity";
import { FACILITY_LABEL_MARGIN, type FacilityLabelLayout } from "./facilityLabelLayout";
import { cacheFacilityLabelEnvelope, projectFacilityBody, layoutFacilityLabelOutsideBody,
  type FacilityLabelEnvelope } from "./facilityModelLabelLayout";
import { scoreGuidanceAnchor } from "./guidanceLabelLayout";
import { guidanceClearsFacilities, MAX_GUIDANCE_OBSTACLES } from "./guidanceFacilityClearance";
import { createRiverStageController } from "./riverStage";
import { createRiverSurfaceSampler } from "./riverSurface";
import { createRiverBoundaryResolver } from "./riverBoundary";
import { frameRenderedFloodPatch, selectRenderedFloodPatch } from "./floodCameraFocus";

export type DioramaGameMapHandle = CesiumGameMapHandle & {
  focusRenderedFlood: () => void;
  returnFromFlood: () => void;
};
type DioramaGameMapProps = CesiumGameMapProps & {
  onFloodFocusChange?: (state: { available: boolean; viewing: boolean }) => void;
};

type Runtime = {
  renderer: T.WebGLRenderer;
  scene: T.Scene;
  camera: T.PerspectiveCamera;
  controls: OrbitControls;
  models: Map<string, T.Group>;
  operations: Map<string, ReturnType<typeof createFacilityOperationVisuals>>;
  ghost: T.Group | null;
  ghostType: string | null;
  pick: (x: number, y: number) => { x: number; z: number } | null;
  reset: () => void;
  ground: (x: number, z: number) => number | null;
  focusFlood: () => void;
  returnFromFlood: () => void;
};

/** Local, meter-scaled Abukuma diorama. Game rules remain in geographic coordinates. */
export const DioramaGameMap = forwardRef<DioramaGameMapHandle, DioramaGameMapProps>(
  function DioramaGameMap(props, ref) {
    const host = useRef<HTMLDivElement>(null);
    const runtime = useRef<Runtime | null>(null);
    const latest = useRef(props);
    latest.current = props;
    const [ready, setReady] = useState(false);
    const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
    const selectedFacilityLabel = useRef(selectedLabelId);
    selectedFacilityLabel.current = selectedLabelId;
    const labelEnvelopes = useRef(new WeakMap<T.Group, FacilityLabelEnvelope>());
    const [error, setError] = useState("");
    const [geography, setGeography] = useState<KoriyamaSceneData | null>(null);
    useEffect(() => {
      const controller = new AbortController();
      loadKoriyamaScene(controller.signal).then(setGeography).catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "地理データを読み込めませんでした");
      });
      return () => controller.abort();
    }, []);
    const labels = useRef(new Map<string, HTMLDivElement>());
    const labelSizes = useRef(new WeakMap<Element, { width: number; height: number }>());
    const labelSizeObserver = useRef<ResizeObserver | null>(null);
    const npcMarkers = useRef(new Map<string, HTMLButtonElement>());
    const guidanceLabel = useRef<HTMLDivElement>(null);
    const placementActions = useRef<HTMLDivElement>(null);
    const pending = props.placements.find((p) => p.preview);
    const influences = useMemo(
      () => calculateStructureInfluences(props.placements),
      [props.placements],
    );
    const guidanceSites = useRef(getDioramaGuidance(influences));
    useEffect(() => {
      guidanceSites.current = getDioramaGuidance(influences);
    }, [influences]);

    useImperativeHandle(
      ref,
      () => ({
        resetCamera: () => runtime.current?.reset(),
        focusRenderedFlood: () => runtime.current?.focusFlood(),
        returnFromFlood: () => runtime.current?.returnFromFlood(),
        focusNpc: (position) => {
          const r = runtime.current;
          if (!r) return;
          const focus = geoToWorld(position.longitude, position.latitude);
          const offset = r.camera.position.clone().sub(r.controls.target);
          r.controls.target.set(focus.x, r.ground(focus.x, focus.z) ?? 0, focus.z);
          r.camera.position.copy(r.controls.target).add(offset);
          r.controls.update();
        },
        clearDragGhost: () => {
          const r = runtime.current;
          if (r?.ghost) {
            r.scene.remove(r.ghost);
            disposeObject(r.ghost);
            r.ghost = null;
            r.ghostType = null;
          }
        },
        updateDragGhost: (id, x, y) => {
          const r = runtime.current;
          const point = r?.pick(x, y);
          if (!r || !point) return { overMap: false, placeable: false };
          const geo = worldToGeo(point.x, point.z),
            resolved = resolvePlaceablePosition(geo);
          if (r.ghostType !== id || !r.ghost) {
            if (r.ghost) {
              r.scene.remove(r.ghost);
              disposeObject(r.ghost);
            }
            r.ghost = createDioramaFacility(id);
            r.ghost.traverse((object) => {
              object.castShadow = false;
            });
            r.ghostType = id;
            r.scene.add(r.ghost);
          }
          const ground = r.ground(point.x, point.z);
          if (ground === null) return { overMap: true, placeable: false };
          r.ghost.position.set(point.x, ground + 1, point.z);
          r.ghost.rotation.y = -T.MathUtils.degToRad(suggestedStructureHeading(id, geo));
          r.ghost.scale.setScalar(0.98);
          return { overMap: true, placeable: resolved !== undefined };
        },
        tryDropStructure: (id, x, y) => {
          const r = runtime.current,
            point = r?.pick(x, y);
          if (!point) return false;
          const geo = resolvePlaceablePosition(worldToGeo(point.x, point.z));
          if (!geo) {
            latest.current.onInvalidPosition("川か河岸の近くへドラッグしてください");
            return false;
          }
          latest.current.onDropPlace(id, geo, suggestedStructureHeading(id, geo));
          return true;
        },
      }),
      [],
    );

    useEffect(() => {
      const container = host.current;
      if (!container || !geography) return;
      const terrain = createGeographicTerrain(geography.terrain);
      const bridges = createGeographicBridges(geography.osm, {
        bounds: terrain.bounds, groundSampler: terrain.sampleGround,
      });
      const train = createGeographicTrain(geography.osm, terrain.sampleGround);
      const landcover = createGeographicLandcover(geography.landcover, {
        bounds: terrain.bounds, groundSampler: terrain.sampleGround, renderedTerrainSurface: terrain.renderedSurface,
      });
      const vegetationExclusions = createImageryVegetationExclusions(geography.osm, geography.plateau, geography.landcover);
      const imageryVegetation = createGeographicImageryVegetation(geography.imageryTrees, {
        bounds: terrain.bounds, groundSampler: terrain.sampleGround,
        exclusions: vegetationExclusions,
        exclusionMode: "centre", illustrativeHeightM: 7,
      });
      const canopy = createGeographicCanopy(geography.canopyPatches, {
        bounds: terrain.bounds, groundSampler: terrain.sampleGround,
        exclusions: vegetationExclusions, observedCrowns: geography.imageryTrees,
      });
      const world = createGeographicWorld({ ...geography.osm,
        features: geography.osm.features.filter(feature => !bridges.sourceIds.has(feature.id)),
      }, {
        plateau: geography.plateau,
        localBounds: terrain.bounds,
        groundSampler: terrain.sampleGround,
        renderedTerrainSurface: terrain.renderedSurface,
        surfaceGridSpacing: 12,
        // Missing building heights remain explicitly provisional in source metadata.
        provisionalBuildingHeight: 6,
        surfaceSampler: (x, z, layer) => {
          const usesRenderedGround = layer === "road" || layer === "rail" || layer === "campus";
          const ground = usesRenderedGround ? terrain.sampleRenderedGround(x, z) : terrain.sampleGround(x, z);
          if (ground === null) return null;
          // DEM is ground, not water bathymetry or surveyed bridge decks.
          // Small surface offsets avoid z-fighting; bridge clearance is provisional.
          return ground + (layer.startsWith("bridge-") ? 3 : layer === "water" || layer === "waterway" ? 0.35 : 0.12);
        },
      });
      let renderer: T.WebGLRenderer;
      try {
        renderer = new T.WebGLRenderer({
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        });
      } catch {
        disposeObject(terrain.group);
        disposeObject(world);
        disposeObject(bridges.group);
        disposeObject(train.group);
        disposeObject(landcover.group);
        disposeObject(imageryVegetation.group);
        disposeObject(canopy.group);
        setError("3D描画を開始できません。ブラウザーを再読み込みしてください。");
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFShadowMap;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = true;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = GEOGRAPHIC_LIGHTING_STYLE.exposure;
      container.appendChild(renderer.domElement);
      const scene = new T.Scene();
      scene.background = new T.Color(GEOGRAPHIC_LIGHTING_STYLE.background);
      scene.fog = new T.Fog(GEOGRAPHIC_LIGHTING_STYLE.fog.color, GEOGRAPHIC_LIGHTING_STYLE.fog.near, GEOGRAPHIC_LIGHTING_STYLE.fog.far);
      scene.add(new T.HemisphereLight(GEOGRAPHIC_LIGHTING_STYLE.hemisphere.sky, GEOGRAPHIC_LIGHTING_STYLE.hemisphere.ground, GEOGRAPHIC_LIGHTING_STYLE.hemisphere.intensity));
      const sun = new T.DirectionalLight(GEOGRAPHIC_LIGHTING_STYLE.sun.color, GEOGRAPHIC_LIGHTING_STYLE.sun.intensity);
      sun.position.set(-360, 650, 300);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      Object.assign(sun.shadow.camera, {
        left: -500,
        right: 500,
        top: 600,
        bottom: -600,
        near: 1,
        far: 1600,
      });
      sun.shadow.bias = -0.0008;
      scene.add(sun, sun.target);
      const camera = new T.PerspectiveCamera(43, 1, 1, 6000);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.09;
      controls.minDistance = 190;
      controls.maxDistance = 1500;
      controls.maxPolarAngle = Math.PI * 0.4;
      controls.minPolarAngle = Math.PI * 0.15;
      controls.screenSpacePanning = false;
      controls.mouseButtons.LEFT = T.MOUSE.PAN;
      controls.touches.ONE = T.TOUCH.PAN;
      controls.touches.TWO = T.TOUCH.DOLLY_ROTATE;
      let floodReturnPose: { position: T.Vector3; target: T.Vector3 } | null = null;
      const reset = () => {
        floodReturnPose = null;
        controls.maxDistance = 1500;
        const site = initialDioramaFocus();
        const focus = geoToWorld(site.longitude, site.latitude);
        controls.target.set(riverX(focus.z), terrain.sampleGround(riverX(focus.z), focus.z) ?? 0, focus.z);
        followGeographicShadows(sun, controls.target, true);
        renderer.shadowMap.needsUpdate = true;
        const downstream = new T.Vector3(
          riverX(focus.z + 80) - riverX(focus.z - 80),
          0,
          160,
        ).normalize();
        camera.position
          .copy(controls.target)
          .addScaledVector(downstream, 480)
          .add(new T.Vector3(downstream.z * 105, 360, -downstream.x * 105));
        controls.update();
      };
      reset();
      scene.add(terrain.group, world, bridges.group, train.group, landcover.group, imageryVegetation.group, canopy.group);
      const waterMaterial = createGeographicWaterMaterial();
      const oldWaterMaterials = new Set<T.Material>();
      for (const mesh of world.waterMeshes) {
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) oldWaterMaterials.add(material);
        const positions = mesh.geometry.getAttribute("position");
        const uv = new Float32Array(positions.count * 2);
        for (let i = 0; i < positions.count; i++) {
          const flow = riverFlowCoordinates(positions.getX(i), positions.getZ(i));
          uv[i * 2] = flow.lateral;
          uv[i * 2 + 1] = flow.along;
        }
        mesh.geometry.setAttribute("uv", new T.BufferAttribute(uv, 2));
        mesh.material = waterMaterial;
      }
      oldWaterMaterials.forEach(material => material.dispose());
      const riverStage = createRiverStageController(world.waterMeshes);
      const sampleRiverSurface = createRiverSurfaceSampler(world.waterMeshes);
      const riverBoundary = createRiverBoundaryResolver(geography.osm, sampleRiverSurface);
      // Static geography cache: never derive pump anchors in the animation loop.
      // Hazard/readiness positions remain separate from placement action pointers.
      const guidanceAnchors = createGeographicGuidanceAnchors(getDioramaGuidance([]), geography.osm, {
        sampleGround: terrain.sampleGround, sampleRenderedGround: terrain.sampleRenderedGround,
        waterMeshes: world.waterMeshes,
      });
      const inundation = createDioramaInundation(terrain.sampleGround, riverBoundary);
      scene.add(inundation.group);
      // Static XZ union of every water mesh, including small non-stage ribbons.
      // Inland pressure remains separate from river-connected overtopping.
      const inlandWaterMask = createRenderedWaterMask(world.waterMeshes, terrain.bounds);
      const inlandPonding = createInlandPonding({
        bounds: terrain.bounds,
        renderedSurface: terrain.renderedSurface,
        sampleGround: (x, z) => terrain.sampleGround(x, z) === null ? null : terrain.sampleRenderedGround(x, z),
        classifyWater: inlandWaterMask.classify,
        classifyFootprint: inlandWaterMask.classifyFootprint,
      });
      scene.add(inlandPonding.group);
      let lastFloodFocusKey = "";
      let cachedPatches: ReturnType<typeof inundation.getRenderedPatches> | null = null;
      let cachedViewport = "";
      let cachedFraming: ReturnType<typeof frameRenderedFloodPatch> = null;
      const floodFraming = () => {
        const patches = inundation.getRenderedPatches();
        const review = latest.current.getLatestFloodState?.().phase === "review";
        const key = `${camera.aspect}/${viewportHeight}/${review}`;
        if (patches !== cachedPatches || key !== cachedViewport) {
          cachedPatches = patches;
          cachedViewport = key;
          const ratio = Math.max(0.1, 1 - 2 * Math.max(140, review ? 110 : 170) / Math.max(1, viewportHeight));
          const patch = selectRenderedFloodPatch(patches.filter(p => frameRenderedFloodPatch(p, camera.fov, camera.aspect, ratio)));
          cachedFraming = patch ? frameRenderedFloodPatch(patch, camera.fov, camera.aspect, ratio) : null;
        }
        return cachedFraming;
      };
      const focusFlood = () => {
        const framing = floodFraming();
        if (!framing) return;
        floodReturnPose ??= { position: camera.position.clone(), target: controls.target.clone() };
        // Only a user tap moves the camera. Preserve its azimuth/pitch and a return pose.
        const direction = camera.position.clone().sub(controls.target).normalize();
        controls.target.set(framing.target.x, framing.target.y, framing.target.z);
        camera.position.copy(controls.target).addScaledVector(direction, framing.distance);
        controls.update();
      };
      const returnFromFlood = () => {
        if (!floodReturnPose) return;
        camera.position.copy(floodReturnPose.position);
        controls.target.copy(floodReturnPose.target);
        floodReturnPose = null;
        controls.maxDistance = 1500;
        controls.update();
      };
      const raycaster = new T.Raycaster(),
        cursor = new T.Vector2();
      const pick = (x: number, y: number) => {
        const rect = renderer.domElement.getBoundingClientRect();
        if (x < rect.left || y < rect.top || x > rect.right || y > rect.bottom) return null;
        cursor.set(((x - rect.left) / rect.width) * 2 - 1, 1 - ((y - rect.top) / rect.height) * 2);
        raycaster.setFromCamera(cursor, camera);
        const hit = raycaster.intersectObjects([...terrain.group.children, ...world.waterMeshes], false)[0];
        return hit ? { x: hit.point.x, z: hit.point.z } : null;
      };
      const r: Runtime = {
        renderer,
        scene,
        camera,
        controls,
        models: new Map(),
        operations: new Map(),
        ghost: null,
        ghostType: null,
        pick,
        reset,
        ground: terrain.sampleGround,
        focusFlood,
        returnFromFlood,
      };
      runtime.current = r;
      let moving: {
        id: string;
        pointerId: number;
        original: PlacedStructure["position"];
        x: number;
        y: number;
        dragged: boolean;
        cancelled: boolean;
        preview: boolean;
      } | null = null;
      const pointerDown = (event: PointerEvent) => {
        if (latest.current.freeCameraLook) return;
        if (moving && moving.pointerId !== event.pointerId) moving.cancelled = true;
        if (moving || !pick(event.clientX, event.clientY)) return;
        const intersections = raycaster.intersectObjects([...r.models.values()], true);
        const hit = intersections[0]?.object;
        let node: T.Object3D | null = hit ?? null;
        while (node && !node.userData.placementId) node = node.parent;
        const id = node?.userData.placementId as string | undefined;
        setSelectedLabelId(id ?? null);
        if (id) {
          latest.current.onSelectPlacement(id);
          const placement = latest.current.placements.find((p) => p.id === id);
          if (placement) {
            moving = {
              id,
              pointerId: event.pointerId,
              original: { ...placement.position },
              x: event.clientX,
              y: event.clientY,
              dragged: false,
              cancelled: false,
              preview: placement.preview === true,
            };
            controls.enabled = false;
            renderer.domElement.setPointerCapture(event.pointerId);
          }
        }
      };
      const pointerMove = (event: PointerEvent) => {
        if (!moving || moving.pointerId !== event.pointerId) return;
        moving.dragged ||=
          Math.hypot(event.clientX - moving.x, event.clientY - moving.y) > FACILITY_TAP_SLOP;
        if (!moving.dragged || !moving.preview || moving.cancelled) return;
        const point = pick(event.clientX, event.clientY);
        if (!point) return;
        const geo = resolvePlaceablePosition(worldToGeo(point.x, point.z));
        if (geo) latest.current.onMovePendingPlacement(moving.id, geo);
      };
      const pointerUp = (event: PointerEvent) => {
        if (!moving || moving.pointerId !== event.pointerId) return;
        moving.dragged ||=
          Math.hypot(event.clientX - moving.x, event.clientY - moving.y) > FACILITY_TAP_SLOP;
        if (event.type !== "pointerup" || moving.cancelled) {
          latest.current.onMovePendingPlacement(moving.id, moving.original);
        } else if (!moving.dragged) {
          const placement = latest.current.placements.find((p) => p.id === moving!.id);
          if (placement)
            latest.current.onRotatePlacement(
              placement.id,
              nextFacilityHeading(placement.headingDegrees),
            );
        }
        moving = null;
        controls.enabled = true;
        if (renderer.domElement.hasPointerCapture(event.pointerId))
          renderer.domElement.releasePointerCapture(event.pointerId);
      };
      renderer.domElement.addEventListener("pointerdown", pointerDown);
      renderer.domElement.addEventListener("pointermove", pointerMove);
      renderer.domElement.addEventListener("pointerup", pointerUp);
      renderer.domElement.addEventListener("pointercancel", pointerUp);
      renderer.domElement.addEventListener("lostpointercapture", pointerUp);
      let viewportWidth = 1, viewportHeight = 1;
      const resize = () => {
        const { width, height } = container.getBoundingClientRect();
        viewportWidth = width;
        viewportHeight = height;
        renderer.setSize(width, height);
        camera.aspect = width / Math.max(1, height);
        camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(container);
      resize();
      // Measure only on size/overlay changes, never after transform writes in draw().
      const labelBounds = { left: 0, top: 0, right: 0, bottom: 0 };
      const shell = container.closest(".game-shell") ?? container.parentElement!;
      let hud: Element | null = null, dock: Element | null = null;
      const measureLabelBounds = () => {
        const rect = container.getBoundingClientRect();
        labelBounds.left = FACILITY_LABEL_MARGIN;
        labelBounds.right = rect.width - FACILITY_LABEL_MARGIN;
        labelBounds.top = FACILITY_LABEL_MARGIN;
        labelBounds.bottom = rect.height - FACILITY_LABEL_MARGIN;
        for (const element of [hud, dock]) {
          if (!element) continue;
          const style = getComputedStyle(element);
          if (style.display === "none" || style.visibility === "hidden") continue;
          const obstacle = element.getBoundingClientRect();
          if (obstacle.width <= 0 || obstacle.height <= 0 || obstacle.right <= rect.left || obstacle.left >= rect.right) continue;
          if (element === hud) labelBounds.top = Math.max(labelBounds.top, obstacle.bottom - rect.top + FACILITY_LABEL_MARGIN);
          else labelBounds.bottom = Math.min(labelBounds.bottom, obstacle.top - rect.top - FACILITY_LABEL_MARGIN);
        }
      };
      const boundsObserver = new ResizeObserver(measureLabelBounds);
      boundsObserver.observe(container);
      const refreshLabelObstacles = () => {
        const nextHud = shell.querySelector(".river-hud"), nextDock = shell.querySelector(".cmd-dock");
        if (hud !== nextHud) {
          if (hud) boundsObserver.unobserve(hud);
          hud = nextHud;
          if (hud) boundsObserver.observe(hud);
        }
        if (dock !== nextDock) {
          if (dock) boundsObserver.unobserve(dock);
          dock = nextDock;
          if (dock) boundsObserver.observe(dock);
        }
        measureLabelBounds();
      };
      // Direct shell changes cover HUD/dock mount/unmount and preview's hidden dock.
      // Do not observe label attributes/text: those are intentionally updated in draw().
      const shellObserver = new MutationObserver(refreshLabelObstacles);
      shellObserver.observe(shell, { childList: true, attributes: true, attributeFilter: ["class"] });
      refreshLabelObstacles();
      const sizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
          const border = entry.borderBoxSize[0];
          const size = border ? { width: border.inlineSize, height: border.blockSize } : entry.target.getBoundingClientRect();
          labelSizes.current.set(entry.target, { width: size.width, height: size.height });
        }
      });
      labelSizeObserver.current = sizeObserver;
      for (const element of labels.current.values()) sizeObserver.observe(element);
      // Keep guidance measurable even when phase/preview gates hide it.
      if (guidanceLabel.current) sizeObserver.observe(guidanceLabel.current);
      const guidanceTitle = guidanceLabel.current?.querySelector("strong");
      const guidanceAdvice = guidanceLabel.current?.querySelector("small");
      const labelLayout: FacilityLabelLayout = {
        x: 0, y: 0, pointerSide: "bottom", pointerHeight: 7, pointerBaseX: 0, pointerTipX: 0,
        pointerLeft: 0, pointerWidth: 0,
      };
      const candidateHintLayout = { ...labelLayout };
      const projectedBody = { left: 0, top: 0, right: 0, bottom: 0, topX: 0, topY: 0, bottomX: 0, bottomY: 0 };
      const labelClipMatrix = new T.Matrix4();
      const projectedBodyPoint = new T.Vector3();
      // Fixed storage: project visible placed facilities once per guidance update,
      // not once per candidate. Never allocate bodies or traverse geometry in draw().
      const guidanceObstacles = Array.from({ length: MAX_GUIDANCE_OBSTACLES }, () => ({ ...projectedBody }));
      const guidanceFrustum = new T.Frustum();
      const guidanceLocalBox = new T.Box3();
      let frame = 0,
        last = performance.now(),
        time = 0;
      const notifyCameraFocus = createCameraFocusNotifier((x, z) => {
        latest.current.onCameraFocusChange?.(worldToGeo(x, z));
      });
      // Scratch vectors are reused each frame; labels must not allocate per facility.
      const cameraCorrection = new T.Vector3();
      const projectedPoint = new T.Vector3();
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
      const draw = (now: number) => {
        frame = requestAnimationFrame(draw);
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (document.hidden || latest.current.mapActive === false) return;
        time += dt;
        train.update(time);
        controls.update();
        const margin = floodReturnPose ? 0 : 150;
        const z = T.MathUtils.clamp(controls.target.z, terrain.bounds.minZ + margin, terrain.bounds.maxZ - margin);
        const x = T.MathUtils.clamp(controls.target.x, terrain.bounds.minX + margin, terrain.bounds.maxX - margin);
        cameraCorrection.set(x - controls.target.x, 0, z - controls.target.z);
        controls.target.add(cameraCorrection);
        camera.position.add(cameraCorrection);
        notifyCameraFocus(controls.target.x, controls.target.z, now);
        if (followGeographicShadows(sun, controls.target)) renderer.shadowMap.needsUpdate = true;
        const state = latest.current.getLatestFloodState?.();
        riverStage.update(state?.riverLevelMeters ?? 2.2);
        for (const [id, model] of r.models) {
          const influence = state?.structureInfluences.find(item => item.placementId === id);
          const operation = resolveFacilityActivity(influence, state);
          r.operations.get(id)?.update(model.userData.preview ? 0 : operation.activity,
            state?.disasterElapsedSeconds ?? 0, reducedMotion.matches,
            model.userData.preview ? 0 : operation.operationActivity);
          const operationText = labels.current.get(id)?.querySelector("[data-operation]");
          if (operationText && operationText.textContent !== operation.label) operationText.textContent = operation.label;
          const delta =
            T.MathUtils.euclideanModulo(
              model.userData.targetRotation - model.rotation.y + Math.PI,
              Math.PI * 2,
            ) - Math.PI;
          model.rotation.y += delta * (1 - Math.exp(-dt * 20));
          const progress = (now - model.userData.popStarted) / 240;
          const pop = facilityPopScale(progress);
          model.scale.setScalar(pop);
          model.position.y = model.userData.groundHeight + (pop - 1) * 24;
          if (model.userData.rotationShadowDirty && Math.abs(delta) < 0.001 && progress >= 1) {
            model.rotation.y = model.userData.targetRotation;
            model.userData.rotationShadowDirty = false;
            renderer.shadowMap.needsUpdate = true;
          }
        }
        waterMaterial.uniforms.time!.value = time;
        waterMaterial.uniforms.storm!.value = state?.rainfallIntensity ?? 0;
        if (state) inundation.update(state, dt, time);
        if (state) inlandPonding.update(state);
        const available = floodFraming() !== null;
        const viewing = floodReturnPose !== null;
        const focusKey = `${available}/${viewing}`;
        if (lastFloodFocusKey !== focusKey) {
          lastFloodFocusKey = focusKey;
          latest.current.onFloodFocusChange?.({ available, viewing });
        }
        const activeLabelId = latest.current.placements.find(placement => placement.preview)?.id ?? selectedFacilityLabel.current;
        camera.updateMatrixWorld();
        for (const [id, element] of labels.current) {
          const model = r.models.get(id);
          if (!model || !model.visible || id !== activeLabelId) {
            element.style.visibility = "hidden";
            continue;
          }
          const size = labelSizes.current.get(element);
          const envelope = labelEnvelopes.current.get(model);
          // Update this transform only, not its children. Cached local geometry follows
          // placement, heading and pop scale with the cached static hull boundary.
          model.updateWorldMatrix(true, false);
          labelClipMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(model.matrixWorld);
          const visible = size !== undefined && envelope !== undefined &&
            projectFacilityBody(envelope, labelClipMatrix, viewportWidth, viewportHeight, projectedBody, projectedBodyPoint) &&
            layoutFacilityLabelOutsideBody(
              projectedBody, size.width, size.height, viewportWidth, viewportHeight,
              labelBounds, labelLayout,
            );
          // visibility preserves measurement while hidden, unlike display:none.
          element.style.visibility = visible ? "visible" : "hidden";
          if (visible) {
            element.style.transform = `translate(${labelLayout.x}px,${labelLayout.y}px)`;
            element.dataset.pointerSide = labelLayout.pointerSide;
            element.style.setProperty("--facility-pointer-height", `${labelLayout.pointerHeight}px`);
            element.style.setProperty("--facility-pointer-base-x", `${labelLayout.pointerBaseX}px`);
            element.style.setProperty("--facility-pointer-tip-x", `${labelLayout.pointerTipX}px`);
            element.style.setProperty("--facility-pointer-left", `${labelLayout.pointerLeft}px`);
            element.style.setProperty("--facility-pointer-width", `${labelLayout.pointerWidth}px`);
          }
        }
        for (const npc of latest.current.npcMarkers ?? []) {
          const element = npcMarkers.current.get(npc.id);
          if (!element) continue;
          if (latest.current.interactionLocked) {
            element.style.display = "none";
            continue;
          }
          const position = geoToWorld(npc.position.longitude, npc.position.latitude);
          const point = projectedPoint.set(
            position.x,
            (terrain.sampleGround(position.x, position.z) ?? 0) + 18,
            position.z,
          ).project(camera);
          const px = (point.x * 0.5 + 0.5) * viewportWidth;
          const py = (-point.y * 0.5 + 0.5) * viewportHeight;
          const visible =
            point.z < 1 &&
            point.z > -1 &&
            Math.abs(point.x) < 1.08 &&
            Math.abs(point.y) < 1.08 &&
            py >= 185 &&
            py <= viewportHeight - 175;
          element.style.display = visible ? "" : "none";
          if (visible)
            element.style.transform = `translate(${px}px,${py}px) translate(-50%,-100%)`;
        }
        const actions = placementActions.current;
        const preview = latest.current.placements.find((placement) => placement.preview);
        const previewModel = preview ? r.models.get(preview.id) : undefined;
        if (actions && previewModel) {
          const point = projectedPoint.copy(previewModel.position).project(camera);
          actions.style.display = point.z > -1 && point.z < 1 ? "flex" : "none";
          const px = T.MathUtils.clamp(
            (point.x * 0.5 + 0.5) * viewportWidth,
            60,
            viewportWidth - 60,
          );
          const py = T.MathUtils.clamp(
            (-point.y * 0.5 + 0.5) * viewportHeight + 32,
            160,
            viewportHeight - 90,
          );
          actions.style.transform = `translate(${px}px,${py}px) translateX(-50%)`;
        }
        const hint = guidanceLabel.current;
        if (hint) {
          let chosen: (typeof guidanceSites.current)[number] | undefined;
          let bestScore = Infinity;
          const size = labelSizes.current.get(hint);
          const preparing = !state || state.phase === "preparation" || state.phase === "idle";
          if (size && preparing && !latest.current.placements.some((placement) => placement.preview)) {
            let obstacleCount = 0;
            let obstaclesReady = true;
            for (const model of r.models.values()) {
              if (!model.visible || model.userData.preview) continue;
              const envelope = labelEnvelopes.current.get(model);
              if (!envelope || envelope.corners.length !== 8) { obstaclesReady = false; break; }
              model.updateWorldMatrix(true, false);
              labelClipMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(model.matrixWorld);
              // Local cached min/max corners suffice for frustum culling. A model
              // crossing a clip plane is uncertain, not an obstacle we may ignore.
              guidanceLocalBox.set(envelope.corners[0], envelope.corners[7]);
              guidanceFrustum.setFromProjectionMatrix(labelClipMatrix);
              if (!guidanceFrustum.intersectsBox(guidanceLocalBox)) continue;
              if (obstacleCount === MAX_GUIDANCE_OBSTACLES ||
                !projectFacilityBody(envelope, labelClipMatrix, viewportWidth, viewportHeight,
                  guidanceObstacles[obstacleCount], projectedBodyPoint)) {
                obstaclesReady = false;
                break;
              }
              obstacleCount++;
            }
            if (obstaclesReady) for (const site of guidanceSites.current) {
              const position = selectGuidanceProjection(guidanceAnchors.get(site.id), site.hasContribution);
              if (!position) continue; // No legal land anchor: hide this action hint.
              const projected = projectedPoint.set(
                position.x,
                position.groundY + 12,
                position.z,
              ).project(camera);
              const px = (projected.x * 0.5 + 0.5) * viewportWidth;
              const py = (-projected.y * 0.5 + 0.5) * viewportHeight;
              const score = scoreGuidanceAnchor(px, py, projected.z, viewportWidth, viewportHeight,
                size.width, size.height, labelBounds, candidateHintLayout);
              if (score < Infinity && guidanceClearsFacilities(candidateHintLayout, size.width, size.height,
                guidanceObstacles, obstacleCount)) {
                if (!isPreferredDioramaGuidanceCandidate(site.hasContribution, score,
                  chosen?.hasContribution, bestScore)) continue;
                chosen = site;
                bestScore = score;
                Object.assign(labelLayout, candidateHintLayout);
              }
            }
          }
          hint.style.visibility = chosen ? "visible" : "hidden";
          if (chosen) {
            hint.style.transform = `translate(${labelLayout.x}px,${labelLayout.y}px)`;
            hint.dataset.pointerSide = labelLayout.pointerSide;
            hint.style.setProperty("--facility-pointer-height", `${labelLayout.pointerHeight}px`);
            hint.style.setProperty("--facility-pointer-base-x", `${labelLayout.pointerBaseX}px`);
            hint.style.setProperty("--facility-pointer-tip-x", `${labelLayout.pointerTipX}px`);
            hint.style.setProperty("--facility-pointer-left", `${labelLayout.pointerLeft}px`);
            hint.style.setProperty("--facility-pointer-width", `${labelLayout.pointerWidth}px`);
            if (guidanceTitle && guidanceTitle.textContent !== chosen.title)
              guidanceTitle.textContent = chosen.title;
            const advice = selectGuidanceAdvice(guidanceAnchors.get(chosen.id), chosen);
            if (guidanceAdvice && guidanceAdvice.textContent !== advice)
              guidanceAdvice.textContent = advice;
          }
        }
        renderer.render(scene, camera);
      };
      frame = requestAnimationFrame(draw);
      setReady(true);
      latest.current.onReadyChange?.(true);
      return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        boundsObserver.disconnect();
        shellObserver.disconnect();
        sizeObserver.disconnect();
        if (labelSizeObserver.current === sizeObserver) labelSizeObserver.current = null;
        renderer.domElement.removeEventListener("pointerdown", pointerDown);
        renderer.domElement.removeEventListener("pointermove", pointerMove);
        renderer.domElement.removeEventListener("pointerup", pointerUp);
        renderer.domElement.removeEventListener("pointercancel", pointerUp);
        renderer.domElement.removeEventListener("lostpointercapture", pointerUp);
        controls.dispose();
        scene.remove(inundation.group);
        inundation.dispose();
        scene.remove(inlandPonding.group);
        inlandPonding.dispose();
        disposeObject(scene);
        if (!world.waterMeshes.length) waterMaterial.dispose();
        renderer.dispose();
        renderer.domElement.remove();
        runtime.current = null;
        latest.current.onFloodFocusChange?.({ available: false, viewing: false });
        latest.current.onReadyChange?.(false);
      };
    }, [geography]);

    useEffect(() => {
      const r = runtime.current;
      if (!r) return;
      const ids = new Set(props.placements.map((p) => p.id));
      for (const [id, model] of r.models) {
        if (!ids.has(id)) {
          r.scene.remove(model);
          disposeObject(model);
          r.models.delete(id);
          r.operations.delete(id);
        }
      }
      for (const placement of props.placements) {
        let model = r.models.get(placement.id);
        if (!model) {
          model = createDioramaFacility(placement.structureId);
          // Thumbnail water stays illustrative; in-play basin storage must respond to load.
          if (placement.structureId === "retention-basin") {
            for (const child of [...model.children]) {
              if (child.name === "retention-basin:water" || child.name === "retention-basin:foam") {
                model.remove(child);
                disposeObject(child);
              }
            }
          }
          labelEnvelopes.current.set(model, cacheFacilityLabelEnvelope(model));
          const operation = createFacilityOperationVisuals(placement.structureId);
          model.add(operation.group);
          r.operations.set(placement.id, operation);
          model.userData.placementId = placement.id;
          r.models.set(placement.id, model);
          r.scene.add(model);
          model.rotation.y = -T.MathUtils.degToRad(placement.headingDegrees);
          model.userData.targetRotation = model.rotation.y;
          model.userData.popStarted = -Infinity;
        }
        const point = geoToWorld(placement.position.longitude, placement.position.latitude);
        model.userData.preview = placement.preview === true;
        const ground = r.ground(point.x, point.z);
        model.visible = ground !== null;
        model.userData.groundHeight = (ground ?? 0) + 0.5;
        model.position.set(point.x, model.userData.groundHeight, point.z);
        const target = -T.MathUtils.degToRad(placement.headingDegrees);
        if (target !== model.userData.targetRotation) {
          const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          model.userData.popStarted = window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? -Infinity
            : performance.now();
          model.userData.targetRotation = target;
          model.userData.rotationShadowDirty = true;
          if (reduceMotion) model.rotation.y = target;
        }
      }
      r.renderer.shadowMap.needsUpdate = true;
    }, [props.placements, ready]);

    const labelFor = (p: PlacedStructure) =>
      props.structures.find((s) => s.id === p.structureId)?.displayName ?? "施設";
    return (
      <div className="diorama-game-map" data-3d-buildings={ready ? "ready" : "loading"}>
        <div className="diorama-game-map__canvas" ref={host} />
        <div className="diorama-labels" aria-hidden="true">
          <div
            className="diorama-label diorama-guidance"
            ref={guidanceLabel}
          >
            <strong />
            <small />
          </div>
          {props.placements.map((p, index) => p.preview || p.id === selectedLabelId ? (
            <div
              className={`diorama-label${p.preview ? " is-preview" : ""}`}
              data-heading={p.headingDegrees}
              data-tone={
                influences[index]?.adverseSiteIds.length
                  ? "warn"
                  : (influences[index]?.coverageTone ?? "warn")
              }
              key={p.id}
              ref={(el) => {
                const previous = labels.current.get(p.id);
                if (previous) labelSizeObserver.current?.unobserve(previous);
                if (el) {
                  labels.current.set(p.id, el);
                  labelSizeObserver.current?.observe(el);
                } else labels.current.delete(p.id);
              }}
            >
              <strong>{labelFor(p)}</strong>
              <small>{influences[index]?.coverageHint ?? "タップで回転"}</small>
              {!p.preview ? <small data-operation>大雨に備えて待機</small> : null}
              {(influences[index]?.adverseSiteIds.length ?? 0) > 0 ? (
                <small>相性注意 {influences[index]!.adverseSiteIds.length}地点</small>
              ) : null}
            </div>
          ) : null)}
        </div>
        {!props.interactionLocked && props.npcMarkers && props.onSelectNpc ? (
          <div className="diorama-npc-markers" aria-label="会話できる人物">
            {props.npcMarkers.map((npc) => (
              <button
                type="button"
                className={`diorama-npc-marker${npc.id === props.highlightedNpcId ? " is-highlighted" : ""}`}
                key={npc.id}
                aria-label={`${npc.locationLabel}にいる${npc.name}に話しかける`}
                onClick={() => props.onSelectNpc?.(npc.id)}
                ref={(element) => {
                  if (element) npcMarkers.current.set(npc.id, element);
                  else npcMarkers.current.delete(npc.id);
                }}
                style={{ display: "none" }}
              >
                <span className="diorama-npc-marker__avatar" aria-hidden="true">
                  {npc.kind === "experienced" ? "👷" : "🧑"}
                </span>
                <span className="diorama-npc-marker__name">{npc.name}</span>
              </button>
            ))}
          </div>
        ) : null}
        {pending ? (
          <div
            className="diorama-placement-actions"
            ref={placementActions}
            role="region"
            aria-label="仮配置操作"
          >
            <div className="diorama-confirm" role="group" aria-label="仮配置の確定">
              <button
                className="diorama-confirm__cancel"
                aria-label="キャンセル"
                onClick={props.onCancelPendingPlacement}
              >
                ×
              </button>
              <button
                className="diorama-confirm__confirm"
                aria-label="確定して配置"
                onClick={props.onConfirmPendingPlacement}
              >
                ✓
              </button>
            </div>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="diorama-error">
            {error}
          </p>
        ) : !ready ? <p role="status" className="diorama-error">阿武隈川の地形と街を読み込み中…</p> : null}
        <details className="diorama-attribution">
          <summary>地図出典</summary>
          <p>航空写真で判読した4つの樹林範囲内は、個々の木の位置・本数・密度・大きさを仮に再構成しています。実測や個別樹木の観測ではありません。</p>
          <p>一部の樹冠位置・半径は地理院タイル（画面表示の撮影期間：2022年7〜9月）から目視推定しています。各木の撮影日は未検証で、幹位置・樹高の実測ではありません。高さ・樹形は仮表現です。</p>
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
          <a href="https://www.geospatial.jp/ckan/dataset/plateau-07203-koriyama-shi-2020" target="_blank" rel="noreferrer">PLATEAU 郡山市（2020年度）を加工</a>
          <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル（国土地理院）標高タイルを加工</a>
          <p>建物はLOD1等の位置・高さを使用。屋根の形・勾配・色は一部推定したゲーム用表現です。未収録の高さ・橋面・樹木の大きさは仮表現です。列車は実際の運行情報ではありません。浸水はゲーム用で、実際の災害予測ではありません。</p>
        </details>
      </div>
    );
  },
);
