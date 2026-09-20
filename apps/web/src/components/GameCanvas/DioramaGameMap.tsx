import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { CesiumGameMapHandle, CesiumGameMapProps } from "./CesiumGameMap";
import type { PlacedStructure } from "../../features/construction";
import { calculateStructureInfluences } from "../../features/disaster/services/floodSimulation";
import { suggestedStructureHeading } from "../../features/disaster/services/hydraulicPlacement";
import { resolvePlaceablePosition } from "./riverPlacement";
import { geoToWorld, groundY, intersectDioramaSurface, riverX, worldToGeo } from "./dioramaSpace";
import { createDioramaWorld } from "./dioramaWorld";
import { createDioramaFacility } from "./dioramaFacilities";
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

function riverGeometry(width = 44, y = 0.4) {
  const vertices: number[] = [],
    indices: number[] = [];
  for (let i = 0; i <= 320; i++) {
    const z = -2400 + i * 15;
    vertices.push(riverX(z) - width, y, z, riverX(z) + width, y, z);
    if (i < 320) {
      const n = i * 2;
      indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createWater() {
  const material = new T.ShaderMaterial({
    uniforms: { time: { value: 0 }, storm: { value: 0 } },
    vertexShader: `varying vec3 p; uniform float time; void main(){p=position; vec3 v=position; v.y+=sin(v.z*.035-time)*.13; gl_Position=projectionMatrix*modelViewMatrix*vec4(v,1.);}`,
    fragmentShader: `varying vec3 p; uniform float time; uniform float storm;
    void main(){
      float a=sin(p.z*.17+sin(p.x*.08)*2.8+time*1.5);
      float b=sin(p.z*.06-p.x*.045+time*.8);
      float foam=smoothstep(.92,.99,a)*smoothstep(.3,.8,sin(p.x*.32+p.z*.016));
      vec3 deep=mix(vec3(.003,.20,.50),vec3(.07,.25,.29),storm);
      vec3 shallow=vec3(.015,.53,.85);
      vec3 color=mix(deep,shallow,.37+.15*b);
      color=mix(color,vec3(.83,.98,1.),foam*.43);
      gl_FragColor=vec4(color,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  });
  return new T.Mesh(riverGeometry(), material);
}

function createFloodGeometry() {
  const positions: number[] = [],
    indices: number[] = [];
  for (const side of [-1, 1])
    for (let i = 0; i <= 320; i++) {
      const z = -2400 + i * 15,
        x = riverX(z) + side * 44,
        n = positions.length / 3;
      positions.push(x, 0.25, z, x, 0.25, z);
      if (i < 320) indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
    }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
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
};

/** Local, meter-scaled Abukuma diorama. Game rules remain in geographic coordinates. */
export const DioramaGameMap = forwardRef<CesiumGameMapHandle, CesiumGameMapProps>(
  function DioramaGameMap(props, ref) {
    const host = useRef<HTMLDivElement>(null);
    const runtime = useRef<Runtime | null>(null);
    const latest = useRef(props);
    latest.current = props;
    const [ready, setReady] = useState(false);
    const [error, setError] = useState("");
    const labels = useRef(new Map<string, HTMLDivElement>());
    const pending = props.placements.find((p) => p.preview);
    const influences = useMemo(
      () => calculateStructureInfluences(props.placements),
      [props.placements],
    );
    const influence = pending ? influences[props.placements.indexOf(pending)] : undefined;

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
          r.ghost.position.set(point.x, groundY(point.x, point.z) + 1, point.z);
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
      if (!container) return;
      let renderer: T.WebGLRenderer;
      try {
        renderer = new T.WebGLRenderer({
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        });
      } catch {
        setError("3D描画を開始できません。ブラウザーを再読み込みしてください。");
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
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
        controls.target.set(riverX(0), 0, -80);
        camera.position.set(riverX(0) + 160, 510, 650);
        controls.update();
      };
      reset();
      scene.add(createDioramaWorld());
      const water = createWater();
      scene.add(water);
      const floodGeometry = createFloodGeometry();
      const floodPositions = floodGeometry.getAttribute("position") as T.BufferAttribute;
      const floodTargets = new Float32Array(floodPositions.count);
      for (let i = 0; i < floodTargets.length; i++) floodTargets[i] = floodPositions.getX(i);
      const flood = new T.Mesh(
        floodGeometry,
        new T.MeshStandardMaterial({
          color: "#45bedb",
          transparent: true,
          opacity: 0.58,
          roughness: 0.3,
          depthWrite: false,
          side: T.DoubleSide,
        }),
      );
      flood.visible = false;
      scene.add(flood);
      const raycaster = new T.Raycaster(),
        cursor = new T.Vector2();
      const pick = (x: number, y: number) => {
        const rect = renderer.domElement.getBoundingClientRect();
        if (x < rect.left || y < rect.top || x > rect.right || y > rect.bottom) return null;
        cursor.set(((x - rect.left) / rect.width) * 2 - 1, 1 - ((y - rect.top) / rect.height) * 2);
        raycaster.setFromCamera(cursor, camera);
        return intersectDioramaSurface(raycaster.ray.origin, raycaster.ray.direction);
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
      };
      runtime.current = r;
      let moving: { id: string; pointerId: number; original: PlacedStructure["position"] } | null =
        null;
      const pointerDown = (event: PointerEvent) => {
        if (moving || !pick(event.clientX, event.clientY)) return;
        const intersections = raycaster.intersectObjects([...r.models.values()], true);
        const hit = intersections[0]?.object;
        let node: T.Object3D | null = hit ?? null;
        while (node && !node.userData.placementId) node = node.parent;
        const id = node?.userData.placementId as string | undefined;
        if (id) {
          latest.current.onSelectPlacement(id);
          const placement = latest.current.placements.find((p) => p.id === id);
          if (placement?.preview) {
            moving = { id, pointerId: event.pointerId, original: { ...placement.position } };
            controls.enabled = false;
            renderer.domElement.setPointerCapture(event.pointerId);
          }
        }
      };
      const pointerMove = (event: PointerEvent) => {
        if (!moving || moving.pointerId !== event.pointerId) return;
        const point = pick(event.clientX, event.clientY);
        if (!point) return;
        const geo = resolvePlaceablePosition(worldToGeo(point.x, point.z));
        if (geo) latest.current.onMovePendingPlacement(moving.id, geo);
      };
      const pointerUp = (event: PointerEvent) => {
        if (!moving || moving.pointerId !== event.pointerId) return;
        if (event.type !== "pointerup") {
          latest.current.onMovePendingPlacement(moving.id, moving.original);
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
        time = 0,
        lastFlood = 0;
      const draw = (now: number) => {
        frame = requestAnimationFrame(draw);
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (document.hidden || latest.current.mapActive === false) return;
        time += dt;
        controls.update();
        const z = T.MathUtils.clamp(controls.target.z, -1800, 1400);
        const x = T.MathUtils.clamp(controls.target.x, riverX(z) - 500, riverX(z) + 500);
        const correction = new T.Vector3(x - controls.target.x, 0, z - controls.target.z);
        controls.target.add(correction);
        camera.position.add(correction);
        const state = latest.current.getLatestFloodState?.();
        water.material.uniforms.time!.value = time;
        water.material.uniforms.storm!.value = state?.rainfallIntensity ?? 0;
        if (now - lastFlood > 100) {
          lastFlood = now;
          const sites = state?.overflowSites ?? [];
          flood.visible = sites.length > 0 && (state?.floodDepthMeters ?? 0) > 0.01;
          if (flood.visible) {
            const buffer = floodPositions;
            for (let i = 0; i < buffer.count; i++) {
              const vz = buffer.getZ(i),
                side = i < 642 ? -1 : 1;
              let spread = 0;
              for (const site of sites) {
                const p = geoToWorld(site.longitude, site.latitude);
                const direction =
                  Math.sin((site.outflowHeadingDegrees * Math.PI) / 180) >= 0 ? 1 : -1;
                if (direction === side)
                  spread = Math.max(
                    spread,
                    site.intensity *
                      Math.exp(-Math.pow((vz - p.z) / 190, 2)) *
                      Math.min(180, (state?.floodDepthMeters ?? 0) * 100),
                  );
              }
              const floodX = riverX(vz) + side * (44 + (i % 2 === 0 ? 0 : spread));
              floodTargets[i] = floodX;
            }
          }
        }
        if (flood.visible) {
          // Hydraulic targets update at 10 Hz; the visible water edge moves every frame.
          const blend = 1 - Math.exp(-dt * 9);
          for (let i = 0; i < floodPositions.count; i++) {
            const current = floodPositions.getX(i);
            const next = current + (floodTargets[i]! - current) * blend;
            floodPositions.setX(i, next);
            floodPositions.setY(i, groundY(next, floodPositions.getZ(i)) + 0.25);
          }
          floodPositions.needsUpdate = true;
          floodGeometry.computeVertexNormals();
          floodGeometry.computeBoundingSphere();
        }
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
        disposeObject(scene);
        renderer.dispose();
        renderer.domElement.remove();
        runtime.current = null;
        latest.current.onReadyChange?.(false);
      };
    }, []);

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
        }
        const point = geoToWorld(placement.position.longitude, placement.position.latitude);
        model.position.set(point.x, groundY(point.x, point.z) + 0.5, point.z);
        model.rotation.y = -T.MathUtils.degToRad(placement.headingDegrees);
      }
      r.renderer.shadowMap.needsUpdate = true;
    }, [props.placements, ready]);

    const labelFor = (p: PlacedStructure) =>
      props.structures.find((s) => s.id === p.structureId)?.displayName ?? "施設";
    return (
      <div className="diorama-game-map" data-3d-buildings={ready ? "ready" : "loading"}>
        <div className="diorama-game-map__canvas" ref={host} />
        <div className="diorama-labels" aria-hidden="true">
          {props.placements.map((p, index) => (
            <div
              className={`diorama-label${p.preview ? " is-preview" : ""}`}
              data-tone={influences[index]?.coverageTone ?? "warn"}
              key={p.id}
              ref={(el) => {
                if (el) labels.current.set(p.id, el);
                else labels.current.delete(p.id);
              }}
            >
              <strong>{labelFor(p)}</strong>
              <small>
                {p.preview ? "位置を調整中" : (influences[index]?.coverageHint ?? "建設済み")}
              </small>
            </div>
          ))}
        </div>
        {pending ? (
          <div className="cesium-pending-panel" role="region" aria-label="仮配置操作">
            <div className="cesium-pending-panel__topline">
              <div className="cesium-pending-panel__summary">
                <span className="cesium-pending-panel__eyebrow">建設プレビュー</span>
                <strong>{labelFor(pending)}</strong>
                <span>施設をドラッグして調整</span>
              </div>
              <div className="cesium-confirm-hud" role="group" aria-label="仮配置の確定">
                <button
                  className="cesium-confirm-hud__cancel"
                  aria-label="キャンセル"
                  onClick={props.onCancelPendingPlacement}
                >
                  戻す
                </button>
                <button
                  className="cesium-confirm-hud__confirm"
                  aria-label="確定して配置"
                  onClick={props.onConfirmPendingPlacement}
                >
                  ✓ 配置する
                </button>
              </div>
            </div>
            <p className={`river-placement-feedback is-${influence?.coverageTone ?? "warn"}`}>
              <strong>{influence?.coverageHint ?? "川や河岸で効果を確認"}</strong>
              <span>
                配置有効率 {Math.round((influence?.effectiveness ?? 0) * 100)}% ·{" "}
                {influence?.coveredSiteIds.length ?? 0}地点をカバー
              </span>
            </p>
            <label className="diorama-rotation">
              向き <output>{Math.round(pending.headingDegrees)}°</output>
              <input
                aria-label="向きスライダー"
                type="range"
                min="0"
                max="359"
                value={pending.headingDegrees}
                onChange={(e) => props.onRotatePlacement(pending.id, Number(e.target.value))}
              />
            </label>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="diorama-error">
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);
