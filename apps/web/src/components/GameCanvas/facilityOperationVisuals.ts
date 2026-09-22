import * as THREE from "three";
import { BASIN_PORTS, basinInletHeight, PUMP_JET_LENGTH, PUMP_PORTS } from "./facilityVisualPorts";

/** Facility-local metres, +Y up. Add group to the actual facility, not the map.
 * The caller supplies normalized simulation activity and simulation elapsed seconds;
 * previews skip update. No wall clock, accumulated deltas, or simulation dependencies.
 * The basin model is dry by default. Activity is illustrative, not a measured flow.
 * Resources are owned by this group; dispose with disposeDioramaObject(group).
 */
export function createFacilityOperationVisuals(structureId: string): {
  group: THREE.Group;
  update(activity: number, elapsed: number, reducedMotion?: boolean, operationActivity?: number, storedFraction?: number): void;
} {
  const group = new THREE.Group();
  group.name = `facility-operation:${structureId}`;
  group.visible = false;
  const supported = ["drainage-pump", "retention-basin", "levee", "revetment", "channel-dredging"].includes(structureId);
  if (!supported) return { group, update: () => { group.visible = false; } };

  const material = new THREE.MeshBasicMaterial({
    color: 0x56d9f2, transparent: true, opacity: 0.8,
    depthWrite: false, side: THREE.DoubleSide,
  });
  // A narrow water streak with a tapered downstream end, not a badge or marker.
  const streak = new THREE.BufferGeometry();
  streak.setAttribute("position", new THREE.Float32BufferAttribute([
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.2,
    0, 0, 0.5, -0.5, 0, 0.2,
  ], 3));
  streak.setIndex([0, 1, 2, 0, 2, 4, 4, 2, 3]);
  const count = structureId === "drainage-pump" ? 9 : structureId === "retention-basin" ? 3 : 12;
  const flow = new THREE.InstancedMesh(streak, material, count);
  flow.name = "directional-water-flow";
  flow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Tiny bounded batches: avoid stale instance bounds and per-frame bound allocations.
  flow.frustumCulled = false;
  group.add(flow);
  const transform = new THREE.Object3D();
  let jets: THREE.InstancedMesh | undefined;
  let water: THREE.Mesh | undefined;
  let runningLights: THREE.InstancedMesh | undefined;
  let runningMaterial: THREE.MeshBasicMaterial | undefined;

  if (structureId === "drainage-pump") {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.05, 1),
      new THREE.Vector3(0, -0.3, 2), new THREE.Vector3(0, -1.2, PUMP_JET_LENGTH),
    ]);
    jets = new THREE.InstancedMesh(new THREE.TubeGeometry(curve, 16, 0.65, 6, false), material, 3);
    jets.name = "three-outlet-jets";
    jets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    jets.frustumCulled = false;
    group.add(jets);
    // Equipment lamps sit on the upper front/rear walls, within the body's
    // silhouette. They show operation without inventing water on a dry site.
    runningMaterial = new THREE.MeshBasicMaterial({ color: "#83ffe0", transparent: true, opacity: 0.9 });
    const lampGeometry = new THREE.BoxGeometry(2, 2, 0.08);
    lampGeometry.clearGroups();
    runningLights = new THREE.InstancedMesh(lampGeometry, runningMaterial, 6);
    runningLights.name = "pump-running-lamps";
    for (let i = 0; i < 6; i++) {
      transform.position.set((i % 3 - 1) * 3, 20, i < 3 ? -1.36 : 11.05);
      transform.rotation.set(0, 0, 0); transform.scale.set(1, 1, 1); transform.updateMatrix();
      runningLights.setMatrixAt(i, transform.matrix);
    }
    group.add(runningLights);
  } else if (structureId === "retention-basin") {
    const shape = new THREE.Shape();
    shape.moveTo(-24, -22);
    shape.lineTo(24, -22);
    shape.quadraticCurveTo(32, -22, 32, -14);
    shape.lineTo(32, 14);
    shape.quadraticCurveTo(32, 22, 24, 22);
    shape.lineTo(-24, 22);
    shape.quadraticCurveTo(-32, 22, -32, 14);
    shape.lineTo(-32, -14);
    shape.quadraticCurveTo(-32, -22, -24, -22);
    water = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8).rotateX(-Math.PI / 2), material);
    water.name = "basin-fill";
    group.add(water);
  }

  function update(activity: number, elapsed: number, reducedMotion = false, operationActivity = activity, storedFraction = activity): void {
    const amount = Number.isFinite(activity) ? THREE.MathUtils.clamp(activity, 0, 1) : 0;
    // Storage belongs to simulation state, not instantaneous inlet flow. Legacy
    // callers may omit it, but the live map always supplies accumulated storage.
    const stored = Number.isFinite(storedFraction) ? THREE.MathUtils.clamp(storedFraction, 0, 1) : 0;
    const operating = Number.isFinite(operationActivity) ? THREE.MathUtils.clamp(operationActivity, 0, 1) : 0;
    group.visible = amount > 0 || Boolean(water && stored > 0) || Boolean(runningLights && operating > 0);
    flow.visible = amount > 0;
    if (jets) jets.visible = amount > 0;
    if (runningLights && runningMaterial) {
      runningLights.visible = operating > 0;
      const clock = reducedMotion || !Number.isFinite(elapsed) ? 0 : ((elapsed % 8) + 8) % 8;
      // Gentle breathing, never an alert flash. Reduced motion keeps a steady lamp.
      runningMaterial.opacity = 0.65 + operating * 0.2 + (reducedMotion ? 0 : Math.sin(clock * Math.PI / 2) * 0.06);
    }
    if (!group.visible) return;
    // Modulo before multiplication also keeps extreme finite times safe.
    const time = reducedMotion || !Number.isFinite(elapsed) ? 0 : ((elapsed % 8) + 8) % 8;
    material.opacity = 0.45 + amount * 0.4;
    if (water) {
      water.visible = stored > 0;
      water.position.y = 0.26 + 3.94 * stored;
    }
    if (jets) {
      for (let i = 0; i < 3; i++) {
        transform.position.fromArray(PUMP_PORTS[i].mouth);
        const direction = PUMP_PORTS[i].direction;
        transform.rotation.set(0, Math.atan2(direction[0], direction[2]), 0);
        transform.scale.set(0.4 + amount * 0.6, 1, 0.4 + amount * 0.6);
        transform.updateMatrix();
        jets.setMatrixAt(i, transform.matrix);
      }
      jets.instanceMatrix.needsUpdate = true;
    }
    for (let i = 0; i < count; i++) {
      const phase = (time / 8 + (i % 3) / 3) % 1;
      const lane = Math.floor(i / 3);
      transform.rotation.set(0, 0, 0);
      transform.scale.set(0.7 + amount * 0.6, 1, 3);
      switch (structureId) {
        case "drainage-pump": {
          const distance = 0.5 + phase * (PUMP_JET_LENGTH - 1);
          const [x, y, z] = PUMP_PORTS[lane].mouth;
          const direction = PUMP_PORTS[lane].direction;
          transform.position.set(x + direction[0] * distance * (0.4 + amount * 0.6),
            y + 0.1 - 0.075 * distance * distance, z + direction[2] * distance * (0.4 + amount * 0.6));
          transform.rotation.y = Math.atan2(direction[0], direction[2]);
          transform.scale.set(0.5, 1, 0.6);
          break;
        }
        case "retention-basin": {
          const z = BASIN_PORTS.outerZ + 1 + phase * (BASIN_PORTS.poolZ - BASIN_PORTS.outerZ - 2);
          const poolHeight = 0.26 + 3.94 * stored;
          transform.position.set((i - 1) * 3, basinInletHeight(z, poolHeight), z);
          // Tilt the whole short streak onto the descending chute, never through it.
          const slope = (basinInletHeight(z + 0.1, poolHeight) - basinInletHeight(z - 0.1, poolHeight)) / 0.2;
          transform.rotation.x = -Math.atan(slope);
          transform.scale.z = 1;
          break;
        }
        case "levee": {
          // Keep flow at the toe, not high on a potentially dry embankment.
          // The local slope satisfies y + z = 20; activity is not flood depth.
          const y = 2.3 + amount * (0.2 + lane * 0.25);
          transform.position.set(-42 + phase * 84, y, 20 - y + 0.2);
          transform.rotation.set(Math.PI / 4, Math.PI / 2, 0);
          transform.scale.set(0.55, 1, 7);
          break;
        }
        case "revetment":
          // Forward of masonry and toe stones; river side only, parallel to wall.
          transform.position.set(-35 + phase * 70, 2.4 + lane * 0.25, 11 + lane * 0.35);
          transform.rotation.y = Math.PI / 2;
          transform.scale.set(0.55, 1, 6);
          break;
        case "channel-dredging":
          // Along the channel on either side of the 78x38 work barge.
          transform.position.set(-45 + phase * 90, 1.2, lane < 2 ? -27 + lane * 4 : 23 + (lane - 2) * 4);
          transform.rotation.y = Math.PI / 2;
          transform.scale.set(1.2, 1, 9);
          break;
      }
      transform.updateMatrix();
      flow.setMatrixAt(i, transform.matrix);
    }
    flow.instanceMatrix.needsUpdate = true;
  }
  return { group, update };
}
