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

function riverGeometry(width = 44, y = 0.4) {
  const vertices: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (let i = 0; i <= 320; i++) {
    const z = -2400 + i * 15;
    vertices.push(riverX(z) - width, y, z, riverX(z) + width, y, z);
    uvs.push(0, z, 1, z);
    if (i < 320) {
      const n = i * 2;
      indices.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createWater() {
  const material = new T.ShaderMaterial({
    uniforms: { time: { value: 0 }, storm: { value: 0 } },
    vertexShader: `varying vec3 p; varying vec2 riverUv; uniform float time; void main(){p=position; riverUv=uv; vec3 v=position; v.y+=sin(v.z*.035-time)*.13; gl_Position=projectionMatrix*modelViewMatrix*vec4(v,1.);}`,
    fragmentShader: `varying vec3 p; varying vec2 riverUv; uniform float time; uniform float storm;
    void main(){
      // Local +Z is downstream (south). Negative time advects crests downstream.
      float flow=p.z-time*18.;
      float a=sin(flow*.12+sin(riverUv.x*13.+flow*.017)*1.6);
      float b=sin(flow*.047-riverUv.x*9.);
      float edge=pow(abs(riverUv.x*2.-1.),5.);
      float foam=smoothstep(.94,.995,a)*smoothstep(.35,.85,sin(riverUv.x*29.+flow*.021));
      float shore=smoothstep(.94,1.,abs(riverUv.x*2.-1.))*(.4+.25*sin(flow*.2));
      vec3 deep=mix(vec3(.005,.29,.61),vec3(.07,.25,.29),storm*.75);
      vec3 shallow=mix(vec3(.025,.72,.84),vec3(.14,.40,.38),storm*.65);
      vec3 color=mix(deep,shallow,.15+.7*edge+.09*b);
      color+=vec3(.03,.07,.09)*pow(max(0.,b),8.);
      color=mix(color,vec3(.83,.98,1.),clamp(foam*.48+shore*.65,0.,.8));
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
        const site = initialDioramaFocus();
        const focus = geoToWorld(site.longitude, site.latitude);
        controls.target.set(riverX(focus.z), 0, focus.z);
        const downstream = new T.Vector3(
          riverX(focus.z + 80) - riverX(focus.z - 80),
          0,
          160,
        ).normalize();
        camera.position
          .copy(controls.target)
          .addScaledVector(downstream, 730)
          .add(new T.Vector3(downstream.z * 160, 510, -downstream.x * 160));
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
            240,
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
                groundY(position.x, position.z) + 12,
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
          model.rotation.y = -T.MathUtils.degToRad(placement.headingDegrees);
          model.userData.targetRotation = model.rotation.y;
          model.userData.popStarted = -Infinity;
        }
        const point = geoToWorld(placement.position.longitude, placement.position.latitude);
        model.userData.groundHeight = groundY(point.x, point.z) + 0.5;
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
          {props.placements.map((p, index) => (
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
          ))}
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
        ) : null}
      </div>
    );
  },
);
