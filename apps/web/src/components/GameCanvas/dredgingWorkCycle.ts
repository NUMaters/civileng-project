import * as THREE from "three";
import type { FacilityLabelEnvelope } from "./facilityModelLabelLayout";

const BOOM_REST = Math.atan2(18, 12);
const STICK_REST = Math.atan2(-17, 16);
const BOOM_LENGTH = Math.hypot(12, 18);
const STICK_LENGTH = Math.hypot(16, 17);
const DUMP_PITCH = -0.85;
export const DREDGING_CYCLE_SECONDS = 14;

// Time, turret yaw, absolute boom/stick pitch, absolute bucket pitch.
// Lift fully clear of the deck before slewing; the dig takes place beyond +Z=19.
const POSES = [
  [0, -Math.PI / 2, 0.95, -0.75, 0],
  [0.20, -Math.PI / 2, 0.1, -1.1, -0.15],
  [0.32, -Math.PI / 2, 0.2, -1, 0.65],
  [0.47, -Math.PI / 2, 1.1, -0.35, 0.3],
  [0.62, 0, 1.1, -0.35, 0.3],
  [0.70, 0, 1.1, -0.35, DUMP_PITCH],
  [0.83, 0, 1.1, -0.35, DUMP_PITCH],
  [0.94, -Math.PI / 2, 1.1, -0.35, 0.3],
  [1, -Math.PI / 2, 0.95, -0.75, 0],
] as const;
const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const ramp = (t: number, start: number, end: number) => ease(Math.max(0, Math.min(1, (t - start) / (end - start))));

/** Creation-time, model-local sweep bound; never sample geometry in the render loop.
 * Wrist radius <= 7 + hypot(12,18)*cos(.1) + hypot(16,17)*cos(.35).
 * Adding 16m encloses all scoop/soil vertices for every joint pitch. Y follows
 * the same length bounds over boom [.1,1.1] and stick [-1.1,-.35]. The static
 * pontoon and rotating cab fit inside this box too. Expand if the rig changes.
 */
export function extendDredgingLabelEnvelope(envelope: FacilityLabelEnvelope): FacilityLabelEnvelope {
  const box = new THREE.Box3(new THREE.Vector3(-39, -22, -19), new THREE.Vector3(55, 41, 67));
  for (const corner of envelope.corners) box.expandByPoint(corner);
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) {
    for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
  }
  // Synthetic sweep supports deliberately replace the static convex hull.
  return { ...envelope, corners, supports: corners };
}

/** One gate shared by all dredgers: at most two additional full shadow passes/s.
 * Pending changes survive a paused simulation until the final pose is rendered.
 * Existing camera/placement invalidations also satisfy the pending refresh.
 */
export function createDredgingShadowRefresh() {
  let pending = false, last = -Infinity;
  return (changed: boolean, nowMs: number, alreadyRequested: boolean): boolean => {
    pending ||= changed;
    if (alreadyRequested) { pending = false; last = nowMs; return false; }
    if (!pending || nowMs - last < 500) return false;
    pending = false; last = nowMs; return true;
  };
}

/** Rest transforms reproduce the original toy model exactly. Resources belong to this model. */
export function createDredgingWorkRig() {
  const turret = new THREE.Group(); turret.name = "dredging-turret"; turret.position.set(-12, 10, 0);
  const boom = new THREE.Group(); boom.name = "dredging-boom"; boom.position.set(7, 3, 0);
  const stick = new THREE.Group(); stick.name = "dredging-stick"; stick.position.set(12, 18, 0);
  const bucket = new THREE.Group(); bucket.name = "dredging-bucket"; bucket.position.set(16, -17, 0);
  turret.add(boom); boom.add(stick); stick.add(bucket);
  const soil = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), new THREE.MeshStandardMaterial({ color: 0x80603c, roughness: 1 }));
  soil.name = "dredging-bucket-soil";
  soil.position.set(5, -5.4, 0); soil.scale.set(3.6, 1.2, 3.7); soil.visible = false;
  bucket.add(soil);
  const falling = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.7, 0),
    new THREE.MeshStandardMaterial({ color: 0x80603c, roughness: 1 }), 12);
  falling.name = "dredging-falling-soil"; falling.visible = false;
  falling.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Animation changes the instances: avoid stale bounds causing disappearing soil.
  falling.frustumCulled = false;
  const matrix = new THREE.Matrix4().makeTranslation(28, 8, 0);
  for (let i = 0; i < falling.count; i++) falling.setMatrixAt(i, matrix);
  return { turret, boom, stick, bucket, soil, falling };
}

/**
 * Bind once to createDioramaFacility("channel-dredging"), then call update with
 * absolute elapsed seconds (not dt). No integration, timers or per-frame allocations.
 * activity <= 0 and reducedMotion restore the original thumbnail/rest pose.
 * The model owns all resources: disposeDioramaObject(model) also disposes the rig.
 * Soil is illustrative operation feedback, not a measured excavation volume.
 */
export function createDredgingWorkCycle(model: THREE.Group) {
  const turret = model.getObjectByName("dredging-turret");
  const boom = model.getObjectByName("dredging-boom");
  const stick = model.getObjectByName("dredging-stick");
  const bucket = model.getObjectByName("dredging-bucket");
  const soil = model.getObjectByName("dredging-bucket-soil");
  const falling = model.getObjectByName("dredging-falling-soil") as THREE.InstancedMesh | undefined;
  if (!turret || !boom || !stick || !bucket || !soil || !falling?.isInstancedMesh) {
    throw new Error("Dredging work cycle requires an articulated channel-dredging model");
  }
  const matrix = new THREE.Matrix4();
  // Bind once to the newly-created rest pose. Only transitions reset instances;
  // a paused clock or repeated preview/reduced-motion frame needs no GPU upload.
  let resting = true, lastPhase = NaN, lastEngagement = NaN;
  return {
    // Return true only when shadow-casting joints actually change pose.
    update(activity: number, elapsed: number, reducedMotion = false): boolean {
      const active = Number.isFinite(activity) && activity > 0 && Number.isFinite(elapsed) && !reducedMotion;
      if (!active) {
        if (resting) return false;
        resting = true; lastPhase = lastEngagement = NaN;
        const changed = turret.rotation.y !== 0 || boom.rotation.z !== 0 || stick.rotation.z !== 0 || bucket.rotation.z !== 0;
        turret.rotation.y = boom.rotation.z = stick.rotation.z = bucket.rotation.z = 0;
        soil.visible = falling.visible = false;
        soil.scale.set(3.6, 1.2, 3.7);
        matrix.makeTranslation(28, 8, 0);
        for (let i = 0; i < falling.count; i++) falling.setMatrixAt(i, matrix);
        falling.instanceMatrix.needsUpdate = true;
        return changed;
      }
      const t = ((elapsed % DREDGING_CYCLE_SECONDS) + DREDGING_CYCLE_SECONDS) % DREDGING_CYCLE_SECONDS / DREDGING_CYCLE_SECONDS;
      // Normalize the low-activity startup band. Normal working activity retains
      // full reach; crossing 0.01 only makes a small movement, never a pose jump.
      const engagement = Math.min(1, activity / 0.2);
      if (!resting && t === lastPhase && engagement === lastEngagement) return false;
      resting = false; lastPhase = t; lastEngagement = engagement;
      let index = 0;
      while (index < POSES.length - 2 && t > POSES[index + 1]![0]) index++;
      const a = POSES[index]!, b = POSES[index + 1]!;
      const u = ease((t - a[0]) / (b[0] - a[0]));
      const prepare = ease(Math.min(1, engagement * 2));
      const work = ease(Math.max(0, engagement * 2 - 1));
      // First lift/turn above the deck, then reach the cycle pose. Blending
      // directly toward a submerged pose would cut through the pontoon.
      const yaw = (a[1] + (b[1] - a[1]) * u) * prepare;
      const boomPitch = BOOM_REST + (1.1 - BOOM_REST) * prepare + (a[2] + (b[2] - a[2]) * u - 1.1) * work;
      const stickPitch = STICK_REST + (-0.35 - STICK_REST) * prepare + (a[3] + (b[3] - a[3]) * u + 0.35) * work;
      const bucketPitch = 0.3 * prepare + (a[4] + (b[4] - a[4]) * u - 0.3) * work;
      const changed = turret.rotation.y !== yaw || boom.rotation.z !== boomPitch - BOOM_REST ||
        stick.rotation.z !== stickPitch - boomPitch - (STICK_REST - BOOM_REST) ||
        bucket.rotation.z !== bucketPitch - stickPitch + STICK_REST;
      turret.rotation.y = yaw;
      boom.rotation.z = boomPitch - BOOM_REST;
      stick.rotation.z = stickPitch - boomPitch - (STICK_REST - BOOM_REST);
      bucket.rotation.z = bucketPitch - stickPitch + STICK_REST;
      const load = ramp(t, 0.23, 0.32) * (1 - ramp(t, 0.70, 0.77)) * work;
      soil.visible = load > 0;
      soil.scale.set(3.6 * work, 1.2 * load, 3.7 * work);
      falling.visible = work > 0 && t >= 0.70 && t < 0.83;
      // At discharge yaw is zero. Follow the blended mouth instead of spawning
      // soil at the full-cycle mouth while the arm is only partially engaged.
      const releaseX = -5 + BOOM_LENGTH * Math.cos(boomPitch) + STICK_LENGTH * Math.cos(stickPitch)
        + 13.7 * Math.cos(bucketPitch) + 5.5 * Math.sin(bucketPitch);
      const releaseY = 13 + BOOM_LENGTH * Math.sin(boomPitch) + STICK_LENGTH * Math.sin(stickPitch)
        + 13.7 * Math.sin(bucketPitch) - 5.5 * Math.cos(bucketPitch);
      // Fixed staggered clods fall only while the bucket is over the spoil pile.
      // All positions are model-local, so placement/heading need no special handling.
      for (let i = 0; i < falling.count; i++) {
        const progress = (t - 0.70 - i * 0.005) / 0.075;
        const visible = progress >= 0 && progress < 1;
        const p = Math.max(0, Math.min(1, progress));
        const scale = visible ? (1 - ramp(p, 0.8, 1)) * work : 0;
        matrix.makeScale(scale, scale, scale);
        matrix.setPosition(releaseX + Math.sin(i * 2.4) * 0.6,
          releaseY + (6.5 - releaseY) * p * p, Math.cos(i * 2.4) * 2.8);
        falling.setMatrixAt(i, matrix);
      }
      falling.instanceMatrix.needsUpdate = true;
      return changed;
    },
  };
}
