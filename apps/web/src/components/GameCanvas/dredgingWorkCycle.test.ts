import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDioramaFacility } from "./dioramaFacilities";
import { createDredgingWorkCycle, DREDGING_CYCLE_SECONDS } from "./dredgingWorkCycle";
import { disposeDioramaObject } from "./disposeDioramaObject";

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
});
