import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDioramaFacility } from "./dioramaFacilities";
import { createDredgingWorkCycle, createDredgingShadowRefresh, extendDredgingLabelEnvelope, DREDGING_CYCLE_SECONDS } from "./dredgingWorkCycle";
import { disposeDioramaObject } from "./disposeDioramaObject";
import { cacheFacilityLabelEnvelope, projectFacilityBody, layoutFacilityLabelOutsideBody,
  type ProjectedFacilityBody } from "./facilityModelLabelLayout";
import type { FacilityLabelLayout } from "./facilityLabelLayout";

const models: THREE.Group[] = [];
function setup() {
  const model = createDioramaFacility("channel-dredging"); models.push(model);
  const cycle = createDredgingWorkCycle(model);
  const bucket = model.getObjectByName("dredging-bucket")!;
  const soil = model.getObjectByName("dredging-bucket-soil")!;
  const falling = model.getObjectByName("dredging-falling-soil") as THREE.InstancedMesh;
  const update = (phase: number, activity = 1, reducedMotion = false) => {
    cycle.update(activity, phase * DREDGING_CYCLE_SECONDS, reducedMotion);
    model.updateMatrixWorld(true);
  };
  return { model, cycle, bucket, soil, falling, update };
}
afterEach(() => { for (const model of models.splice(0)) disposeDioramaObject(model); });
const tip = (bucket: THREE.Object3D) => bucket.localToWorld(new THREE.Vector3(13, -7.8, 0));
function snapshot(model: THREE.Group) {
  const values: unknown[] = [];
  model.traverse(object => {
    values.push(object.position.toArray(), object.rotation.toArray(), object.scale.toArray(), object.visible);
    if (object instanceof THREE.InstancedMesh) values.push(Array.from(object.instanceMatrix.array));
  });
  return values;
}

describe("articulated dredging work cycle", () => {
  it("keeps previews, idle and reduced motion in the exact original fixed pose", () => {
    const { model, update, cycle } = setup();
    const rest = snapshot(model);
    for (const phase of [0, 0.2, 0.75, 3, -4]) {
      update(phase, 0); expect(snapshot(model)).toEqual(rest);
      update(0.75);
      update(phase, 1, true); expect(snapshot(model)).toEqual(rest);
    }
    for (const activity of [-1, NaN, Infinity]) {
      cycle.update(activity, 4); expect(snapshot(model)).toEqual(rest);
    }
    cycle.update(1, NaN); expect(snapshot(model)).toEqual(rest);
  });

  it("does not upload instance matrices for repeated rest, reduced-motion or frozen-time frames", () => {
    const { model, cycle, falling } = setup();
    const writes = vi.spyOn(falling, "setMatrixAt");
    const initialVersion = falling.instanceMatrix.version;
    for (let i = 0; i < 120; i++) {
      cycle.update(0, i); cycle.update(1, i, true);
    }
    expect(writes).not.toHaveBeenCalled();
    expect(falling.instanceMatrix.version).toBe(initialVersion);
    cycle.update(1, 4);
    const activeVersion = falling.instanceMatrix.version;
    const activePose = snapshot(model);
    writes.mockClear();
    for (let i = 0; i < 120; i++) cycle.update(1, 4);
    expect(writes).not.toHaveBeenCalled();
    expect(falling.instanceMatrix.version).toBe(activeVersion);
    expect(snapshot(model)).toEqual(activePose);
    cycle.update(1, 4, true);
    expect(writes).toHaveBeenCalledTimes(12); // one transition back to rest
    const restVersion = falling.instanceMatrix.version;
    writes.mockClear();
    for (let i = 0; i < 120; i++) {
      cycle.update(1, i, true); cycle.update(0, i);
    }
    expect(writes).not.toHaveBeenCalled();
    expect(falling.instanceMatrix.version).toBe(restVersion);
    cycle.update(1, 4);
    expect(falling.instanceMatrix.version).toBeGreaterThan(restVersion);
    expect(snapshot(model)).toEqual(activePose);
  });

  it("digs below local water datum outside the pontoon, lifts, slews, dumps, then returns", () => {
    const { model, bucket, soil, falling, update } = setup();
    update(0.2);
    const digging = tip(bucket);
    expect(digging.z).toBeGreaterThan(19 + 5);
    expect(digging.y).toBeLessThan(-3);
    expect(soil.visible).toBe(false);
    update(0.32); expect(soil.visible).toBe(true);
    update(0.47);
    expect(tip(bucket).y).toBeGreaterThan(10);
    expect(tip(bucket).z).toBeGreaterThan(19);
    update(0.74);
    expect(model.getObjectByName("dredging-turret")!.rotation.y).toBe(0);
    expect(falling.visible).toBe(true);
    const matrix = new THREE.Matrix4();
    let visible = 0;
    for (let i = 0; i < falling.count; i++) {
      falling.getMatrixAt(i, matrix);
      if (!matrix.elements[0]) continue;
      const p = new THREE.Vector3().setFromMatrixPosition(matrix);
      expect(p.x).toBeGreaterThan(19); expect(p.x).toBeLessThan(33);
      expect(Math.abs(p.z)).toBeLessThan(7);
      expect(p.y).toBeGreaterThan(6.5); expect(p.y).toBeLessThan(20);
      // Soil leaves the mouth rather than passing through the scoop or its teeth.
      expect(new THREE.Raycaster(p, new THREE.Vector3(0, -1, 0), 0, 20).intersectObject(bucket, true)).toHaveLength(0);
      visible++;
    }
    expect(visible).toBeGreaterThan(5);
    update(0.84); expect(soil.visible).toBe(false); expect(falling.visible).toBe(false);
    update(1.2); expect(tip(bucket).distanceTo(digging)).toBeLessThan(1e-10);
  });

  it("keeps the bucket outside the hull while submerged and above the deck while slewing", () => {
    const { bucket, update } = setup();
    for (let i = 0; i <= 280; i++) {
      update(i / 280);
      // Conservative bounds of the original scoop (including teeth).
      for (const x of [-2.7, 13]) for (const y of [-8.6, 2.7]) for (const z of [-5.5, 5.5]) {
        const p = bucket.localToWorld(new THREE.Vector3(x, y, z));
        if (p.y < 5 && p.y > -4) expect(p.x > 39 || p.x < -39 || Math.abs(p.z) > 19).toBe(true);
      }
    }
  });

  it("is independent of frame history, periodic and smooth at all phase boundaries", () => {
    const a = setup(), b = setup();
    for (const phase of [0.78, 12.32, -0.26, 0.2, 0.74, 0, 0.94]) {
      a.update(phase); b.update(phase);
      expect(snapshot(a.model)).toEqual(snapshot(b.model));
      a.update(4.8); a.update(phase);
      expect(snapshot(a.model)).toEqual(snapshot(b.model));
    }
    for (const phase of [0, 0.2, 0.32, 0.47, 0.62, 0.7, 0.83, 0.94, 1]) {
      a.update(phase - 0.00001); const before = tip(a.bucket);
      a.update(phase + 0.00001);
      expect(tip(a.bucket).distanceTo(before)).toBeLessThan(0.001);
    }
  });

  it("keeps falling soil attached to placed model coordinates and moves it downward", () => {
    const a = setup(), b = setup();
    b.model.position.set(130, 4, -240); b.model.rotation.y = 0.8;
    a.update(0.71); b.update(0.71);
    const matrix = new THREE.Matrix4();
    a.falling.getMatrixAt(0, matrix);
    const early = new THREE.Vector3().setFromMatrixPosition(matrix);
    const expected = tip(a.bucket).applyMatrix4(b.model.matrixWorld);
    expect(tip(b.bucket).distanceTo(expected)).toBeLessThan(1e-10);
    expect(b.falling.instanceMatrix.array).toEqual(a.falling.instanceMatrix.array);
    a.update(0.75); a.falling.getMatrixAt(0, matrix);
    const late = new THREE.Vector3().setFromMatrixPosition(matrix);
    expect(late.y).toBeLessThan(early.y);
    expect(late.x).toBe(early.x); expect(late.z).toBe(early.z);
  });

  it("reuses geometry and instance buffers and disposes all owned resources by traversal", () => {
    const { model, update, falling } = setup();
    const resources = new Set<THREE.BufferGeometry | THREE.Material>();
    model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      resources.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) resources.add(material);
    });
    const spies = [...resources].map(resource => vi.spyOn(resource, "dispose"));
    const instanceBuffer = falling.instanceMatrix.array;
    for (let i = 0; i < 500; i++) update(i / 100);
    expect(falling.instanceMatrix.array).toBe(instanceBuffer);
    model.traverse(object => {
      if (object instanceof THREE.Mesh) expect(resources.has(object.geometry)).toBe(true);
    });
    const instancesDisposed = vi.spyOn(falling, "dispose");
    disposeDioramaObject(model); models.splice(models.indexOf(model), 1);
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(instancesDisposed).toHaveBeenCalledTimes(1);
  });

  it("rejects models without the required joints", () => {
    expect(() => createDredgingWorkCycle(new THREE.Group())).toThrow("articulated");
  });

  it("only invalidates shadows for changed casting joints, not a paused clock or falling soil", () => {
    const { cycle } = setup();
    expect(cycle.update(0, 0)).toBe(false);
    expect(cycle.update(1, 3)).toBe(true);
    expect(cycle.update(1, 3)).toBe(false);
    expect(cycle.update(1, 0.72 * DREDGING_CYCLE_SECONDS)).toBe(true);
    expect(cycle.update(1, 0.76 * DREDGING_CYCLE_SECONDS)).toBe(false);
    expect(cycle.update(1, 3, true)).toBe(true);
    expect(cycle.update(1, 4, true)).toBe(false);
  });

  it("limits shared shadow refreshes and retains final pending changes across a pause", () => {
    const refresh = createDredgingShadowRefresh();
    expect(refresh(false, 0, false)).toBe(false);
    expect(refresh(true, 0, false)).toBe(true);
    for (let now = 16; now < 500; now += 16) expect(refresh(true, now, false)).toBe(false);
    expect(refresh(false, 500, false)).toBe(true);
    expect(refresh(false, 1000, false)).toBe(false);
    expect(refresh(true, 1010, true)).toBe(false); // camera/placement already requests the pass
    expect(refresh(false, 1600, false)).toBe(false);
    expect(refresh(true, 1700, false)).toBe(true);
    expect(refresh(true, 1800, false)).toBe(false); // stop/reduced-motion final pose
    expect(refresh(false, 2200, false)).toBe(true);
    expect(refresh(false, 3000, false)).toBe(false);
  });

  it("caches the full moving sweep and keeps projected labels outside it at every heading", () => {
    const { model, update } = setup();
    const envelope = extendDredgingLabelEnvelope(cacheFacilityLabelEnvelope(model));
    expect(envelope.supports).toHaveLength(8);
    const sweep = new THREE.Box3().setFromPoints([...envelope.corners]);
    const actual = new THREE.Box3();
    for (let i = 0; i <= 200; i++) {
      update(i / 200);
      actual.setFromObject(model);
      expect(sweep.containsBox(actual)).toBe(true);
    }
    const camera = new THREE.PerspectiveCamera(43, 390 / 700, 1, 6000);
    const projection = new THREE.Matrix4(), scratch = new THREE.Vector3();
    const body = {} as ProjectedFacilityBody, label = {} as FacilityLabelLayout;
    const viewport = { left: 8, right: 382, top: 8, bottom: 692 };
    let shown = 0;
    model.position.set(50, 8, -20);
    for (const heading of [0, 0.7, 1.8, 3.4, 5.1]) for (const pitch of [150, 300]) {
      model.rotation.y = heading;
      model.updateMatrixWorld(true);
      camera.position.copy(model.position).add(new THREE.Vector3(200, pitch, 300));
      camera.lookAt(model.position); camera.updateMatrixWorld(true);
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(model.matrixWorld);
      expect(projectFacilityBody(envelope, projection, 390, 700, body, scratch)).toBe(true);
      if (layoutFacilityLabelOutsideBody(body, 200, 64, 390, 700, viewport, label)) {
        expect(label.y + 64 < body.top || label.y > body.bottom).toBe(true);
        shown++;
      }
    }
    expect(shown).toBeGreaterThan(0);
  });
});
