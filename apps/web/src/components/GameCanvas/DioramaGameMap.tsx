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
import { createGeographicWaterMaterial, riverFlowCoordinates } from "./geographicWater";
import { createCameraFocusNotifier } from "./cameraFocusNotification";
import { createGeographicBridges } from "./geographicBridges";
import { createGeographicTrain } from "./geographicTrain";
import { loadKoriyamaScene, type KoriyamaSceneData } from "./loadKoriyamaScene";
import { createDioramaInundation } from "./dioramaInundation";
import { createDioramaFacility } from "./dioramaFacilities";
import { getDioramaGuidance, initialDioramaFocus } from "./dioramaGuidance";
import { FACILITY_TAP_SLOP, facilityPopScale, nextFacilityHeading } from "./facilityTap";
import "./diorama.css";

function disposeObject(root: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>();
  const materials = new Set<T.Material>();
  root.traverse((object) => {
    const mesh = object as T.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (object instanceof T.InstancedMesh) object.dispose();
    if (mesh.material)
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        materials.add(material);
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}

type Runtime = {
  renderer: T.WebGLRenderer;
  scene: T.Scene;
  camera: T.PerspectiveCamera;
  controls: OrbitControls;
  models: Map<string, T.Group>;
  ghost: T.Group | null;
  ghostType: string | null;
  pick: (x: number, y: number) => { x: number; z: number } | null;
  reset: () => void;
  ground: (x: number, z: number) => number | null;
};

/** Local, meter-scaled Abukuma diorama. Game rules remain in geographic coordinates. */
export const DioramaGameMap = forwardRef<CesiumGameMapHandle, CesiumGameMapProps>(
  function DioramaGameMap(props, ref) {
    const host = useRef<HTMLDivElement>(null);
    const runtime = useRef<Runtime | null>(null);
    const latest = useRef(props);
    latest.current = props;
    const [ready, setReady] = useState(false);
    const [selectedLabelId, setSelectedLabelId] = useState<string | null>(null);
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
      const world = createGeographicWorld({ ...geography.osm,
        features: geography.osm.features.filter(feature => !bridges.sourceIds.has(feature.id)),
      }, {
        plateau: geography.plateau,
        localBounds: terrain.bounds,
        groundSampler: terrain.sampleGround,
        surfaceGridSpacing: 12,
        // Missing building heights remain explicitly provisional in source metadata.
        provisionalBuildingHeight: 6,
        surfaceSampler: (x, z, layer) => {
          const ground = terrain.sampleGround(x, z);
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
        setError("3D描画を開始できません。ブラウザーを再読み込みしてください。");
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFShadowMap;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = true;
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1;
      container.appendChild(renderer.domElement);
      const scene = new T.Scene();
      scene.background = new T.Color("#87d6f5");
      scene.fog = new T.Fog("#b6e6ef", 1700, 3700);
      scene.add(new T.HemisphereLight("#d5f5ff", "#7e9d60", 1.2));
      const sun = new T.DirectionalLight("#fff5da", 2.4);
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
      scene.add(sun);
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
      const reset = () => {
        const site = initialDioramaFocus();
        const focus = geoToWorld(site.longitude, site.latitude);
        controls.target.set(riverX(focus.z), terrain.sampleGround(riverX(focus.z), focus.z) ?? 0, focus.z);
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
      scene.add(terrain.group, world, bridges.group, train.group);
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
      const inundation = createDioramaInundation(terrain.sampleGround);
      scene.add(inundation.group);
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
        ghost: null,
        ghostType: null,
        pick,
        reset,
        ground: terrain.sampleGround,
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
      const resize = () => {
        const { width, height } = container.getBoundingClientRect();
        renderer.setSize(width, height);
        camera.aspect = width / Math.max(1, height);
        camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(container);
      resize();
      let frame = 0,
        last = performance.now(),
        time = 0;
      const notifyCameraFocus = createCameraFocusNotifier((x, z) => {
        latest.current.onCameraFocusChange?.(worldToGeo(x, z));
      });
      const draw = (now: number) => {
        frame = requestAnimationFrame(draw);
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (document.hidden || latest.current.mapActive === false) return;
        time += dt;
        train.update(time);
        controls.update();
        const z = T.MathUtils.clamp(controls.target.z, terrain.bounds.minZ + 150, terrain.bounds.maxZ - 150);
        const x = T.MathUtils.clamp(controls.target.x, terrain.bounds.minX + 150, terrain.bounds.maxX - 150);
        const correction = new T.Vector3(x - controls.target.x, 0, z - controls.target.z);
        controls.target.add(correction);
        camera.position.add(correction);
        notifyCameraFocus(controls.target.x, controls.target.z, now);
        for (const model of r.models.values()) {
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
        const state = latest.current.getLatestFloodState?.();
        waterMaterial.uniforms.time!.value = time;
        waterMaterial.uniforms.storm!.value = state?.rainfallIntensity ?? 0;
        if (state) inundation.update(state, dt, time);
        for (const [id, element] of labels.current) {
          const model = r.models.get(id);
          if (!model) {
            element.style.display = "none";
            continue;
          }
          const point = model.position
            .clone()
            .add(new T.Vector3(0, 35, 0))
            .project(camera);
          const visible =
            point.z < 1 && point.z > -1 && Math.abs(point.x) < 1.1 && Math.abs(point.y) < 1.1;
          element.style.display = visible ? "" : "none";
          if (visible)
            element.style.transform = `translate(${(point.x * 0.5 + 0.5) * container.clientWidth}px,${(-point.y * 0.5 + 0.5) * container.clientHeight}px) translate(-50%,-100%)`;
        }
        const actions = placementActions.current;
        const preview = latest.current.placements.find((placement) => placement.preview);
        const previewModel = preview ? r.models.get(preview.id) : undefined;
        if (actions && previewModel) {
          const point = previewModel.position.clone().project(camera);
          actions.style.display = point.z > -1 && point.z < 1 ? "flex" : "none";
          const px = T.MathUtils.clamp(
            (point.x * 0.5 + 0.5) * container.clientWidth,
            60,
            container.clientWidth - 60,
          );
          const py = T.MathUtils.clamp(
            (-point.y * 0.5 + 0.5) * container.clientHeight + 32,
            160,
            container.clientHeight - 90,
          );
          actions.style.transform = `translate(${px}px,${py}px) translateX(-50%)`;
        }
        const hint = guidanceLabel.current;
        if (hint) {
          let chosen: {
            site: (typeof guidanceSites.current)[number];
            x: number;
            y: number;
            score: number;
          } | null = null;
          const preparing = !state || state.phase === "preparation" || state.phase === "idle";
          if (preparing && !latest.current.placements.some((placement) => placement.preview)) {
            for (const site of guidanceSites.current) {
              const position = geoToWorld(site.longitude, site.latitude);
              const projected = new T.Vector3(
                position.x,
                (terrain.sampleGround(position.x, position.z) ?? 0) + 12,
                position.z,
              ).project(camera);
              const px = (projected.x * 0.5 + 0.5) * container.clientWidth;
              const py = (-projected.y * 0.5 + 0.5) * container.clientHeight;
              // Keep a single hint in the playable area, clear of the HUD and construction dock.
              if (
                projected.z < -1 ||
                projected.z > 1 ||
                px < 90 ||
                px > container.clientWidth - 90 ||
                py < 290 ||
                py > container.clientHeight - 240
              )
                continue;
              const score =
                Math.abs(py - container.clientHeight * 0.48) +
                Math.abs(px - container.clientWidth * 0.5) * 0.4;
              if (!chosen || score < chosen.score) chosen = { site, x: px, y: py, score };
            }
          }
          hint.style.display = chosen ? "" : "none";
          if (chosen) {
            hint.style.transform = `translate(${chosen.x}px,${chosen.y}px) translate(-50%,-100%)`;
            const title = hint.querySelector("strong");
            const advice = hint.querySelector("small");
            if (title && title.textContent !== chosen.site.title)
              title.textContent = chosen.site.title;
            if (advice && advice.textContent !== chosen.site.advice)
              advice.textContent = chosen.site.advice;
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
        renderer.domElement.removeEventListener("pointerdown", pointerDown);
        renderer.domElement.removeEventListener("pointermove", pointerMove);
        renderer.domElement.removeEventListener("pointerup", pointerUp);
        renderer.domElement.removeEventListener("pointercancel", pointerUp);
        renderer.domElement.removeEventListener("lostpointercapture", pointerUp);
        controls.dispose();
        scene.remove(inundation.group);
        inundation.dispose();
        disposeObject(scene);
        if (!world.waterMeshes.length) waterMaterial.dispose();
        renderer.dispose();
        renderer.domElement.remove();
        runtime.current = null;
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
        }
      }
      for (const placement of props.placements) {
        let model = r.models.get(placement.id);
        if (!model) {
          model = createDioramaFacility(placement.structureId);
          model.userData.placementId = placement.id;
          r.models.set(placement.id, model);
          r.scene.add(model);
          model.rotation.y = -T.MathUtils.degToRad(placement.headingDegrees);
          model.userData.targetRotation = model.rotation.y;
          model.userData.popStarted = -Infinity;
        }
        const point = geoToWorld(placement.position.longitude, placement.position.latitude);
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
            style={{ display: "none" }}
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
                if (el) labels.current.set(p.id, el);
                else labels.current.delete(p.id);
              }}
            >
              <strong>{labelFor(p)}</strong>
              <small>{influences[index]?.coverageHint ?? "タップで回転"}</small>
              {(influences[index]?.adverseSiteIds.length ?? 0) > 0 ? (
                <small>相性注意 {influences[index]!.adverseSiteIds.length}地点</small>
              ) : null}
            </div>
          ) : null)}
        </div>
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
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
          <a href="https://www.geospatial.jp/ckan/dataset/plateau-07203-koriyama-shi-2020" target="_blank" rel="noreferrer">PLATEAU 郡山市（2020年度）を加工</a>
          <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル（国土地理院）標高タイルを加工</a>
          <p>建物はLOD1形状。未収録の高さ・橋の高さは仮表現です。列車は実際の運行情報ではありません。浸水はゲーム用で、実際の災害予測ではありません。</p>
        </details>
      </div>
    );
  },
);
