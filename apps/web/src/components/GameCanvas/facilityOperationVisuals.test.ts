import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createFacilityOperationVisuals } from "./facilityOperationVisuals";
import { disposeDioramaObject } from "./disposeDioramaObject";
import { BASIN_PORTS, PUMP_PORTS } from "./facilityVisualPorts";

const ids = ["drainage-pump", "retention-basin", "levee", "revetment", "channel-dredging"];
it("retains basin water independently of inlet activity and restores stored snapshots", () => {
  const v = createFacilityOperationVisuals("retention-basin");
  const water = v.group.getObjectByName("basin-fill")!;
  v.update(0.8, 10, false, 0.8, 0.6);
  const height = water.position.y;
  v.update(0, 12, false, 0, 0.6);
  expect(v.group.visible).toBe(true);
  expect(water.visible).toBe(true);
  expect(water.position.y).toBe(height);
  expect(v.group.getObjectByName("directional-water-flow")!.visible).toBe(false);
  v.update(0, 3, false, 0, 0.2);
  expect(water.position.y).toBeLessThan(height);
  v.update(0, 0, false, 0, 0);
  expect(v.group.visible).toBe(false);
  disposeDioramaObject(v.group);
});
it("shows preventive pump operation on its equipment panel without emitting water", () => {
  const v = createFacilityOperationVisuals("drainage-pump");
  v.update(0, 1, false, 0.6);
  expect(v.group.visible).toBe(true);
  expect(v.group.getObjectByName("three-outlet-jets")!.visible).toBe(false);
  expect(v.group.getObjectByName("directional-water-flow")!.visible).toBe(false);
  const lamps = v.group.getObjectByName("pump-running-lamps") as THREE.InstancedMesh;
  expect(lamps.visible).toBe(true);
  for (const p of vertices(lamps)) {
    expect(Math.abs(p.x)).toBeLessThanOrEqual(4);
    expect(p.y).toBeGreaterThanOrEqual(19);
    expect(p.y).toBeLessThanOrEqual(21);
    expect((p.z < -1.3 && p.z > -1.5) || (p.z > 11 && p.z < 11.1)).toBe(true);
  }
  v.update(0, 1, true, 0.6);
  const frozen = snapshot(v.group);
  v.update(0, 4, true, 0.6);
  expect(snapshot(v.group)).toEqual(frozen);
  v.update(0, 4, false, 0);
  expect(v.group.visible).toBe(false);
  disposeDioramaObject(v.group);
});
function meshes(group: THREE.Group): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  group.traverse(object => { if (object instanceof THREE.Mesh) result.push(object); });
  return result;
}
function snapshot(group: THREE.Group) {
  group.updateWorldMatrix(true, true);
  return meshes(group).map(mesh => ({
    matrix: mesh.matrixWorld.elements.slice(),
    instances: mesh instanceof THREE.InstancedMesh ? Array.from(mesh.instanceMatrix.array) : [],
    opacity: (mesh.material as THREE.Material).opacity,
  }));
}
function vertices(mesh: THREE.Mesh) {
  const result: THREE.Vector3[] = [];
  const matrix = new THREE.Matrix4();
  mesh.updateMatrix();
  for (let instance = 0; instance < (mesh instanceof THREE.InstancedMesh ? mesh.count : 1); instance++) {
    if (mesh instanceof THREE.InstancedMesh) mesh.getMatrixAt(instance, matrix);
    else matrix.copy(mesh.matrix);
    const position = mesh.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) result.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(matrix));
  }
  return result;
}

describe.each(ids)("facility operation: %s", id => {
  it("starts hidden for previews and hides inactive/invalid activity", () => {
    const visual = createFacilityOperationVisuals(id);
    expect(visual.group.visible).toBe(false);
    for (const activity of [0, -1, NaN, Infinity, -Infinity]) {
      visual.update(1, 2);
      expect(visual.group.visible).toBe(true);
      visual.update(activity, 2);
      expect(visual.group.visible).toBe(false);
    }
    disposeDioramaObject(visual.group);
  });

  it("uses authoritative time, freezes exactly and can rewind", () => {
    const a = createFacilityOperationVisuals(id), b = createFacilityOperationVisuals(id);
    a.update(0.7, 2);
    const initial = snapshot(a.group);
    for (let i = 0; i < 10; i++) a.update(0.7, 2);
    expect(snapshot(a.group)).toEqual(initial);
    a.update(0.7, 3);
    expect(snapshot(a.group)).not.toEqual(initial);
    a.update(0.7, 2);
    b.update(0.7, 2);
    expect(snapshot(a.group)).toEqual(initial);
    expect(snapshot(b.group)).toEqual(initial);
    disposeDioramaObject(a.group); disposeDioramaObject(b.group);
  });

  it("keeps reduced motion static but still responds to activity", () => {
    const v = createFacilityOperationVisuals(id);
    v.update(0.4, 1, true);
    const initial = snapshot(v.group);
    v.update(0.4, 700, true);
    expect(snapshot(v.group)).toEqual(initial);
    v.update(1, 700, true);
    expect(snapshot(v.group)).not.toEqual(initial);
    expect(v.group.visible).toBe(true);
    disposeDioramaObject(v.group);
  });

  it("inherits placement/heading and keeps all transforms finite", () => {
    const v = createFacilityOperationVisuals(id), parent = new THREE.Group();
    parent.position.set(10, 5, -20); parent.rotation.y = Math.PI / 2;
    parent.add(v.group);
    for (const time of [0, -10, NaN, Infinity, -Infinity, Number.MAX_VALUE]) {
      v.update(1, time);
      for (const state of snapshot(v.group)) expect([...state.matrix, ...state.instances].every(Number.isFinite)).toBe(true);
    }
    expect(new THREE.Vector3(0, 0, 1).applyMatrix4(v.group.matrixWorld).toArray()).toEqual([11, 5, -20]);
    expect(v.group.position.toArray()).toEqual([0, 0, 0]);
    disposeDioramaObject(v.group);
  });

  it("bounds draw calls, retains buffers and releases all owned resources once", () => {
    const v = createFacilityOperationVisuals(id);
    const all = meshes(v.group);
    expect(all.length).toBe(id === "drainage-pump" ? 3 : id === "retention-basin" ? 2 : 1);
    const geometries = all.map(m => m.geometry);
    const buffers = all.map(m => m.geometry.getAttribute("position").array);
    const instances = all.filter(m => m instanceof THREE.InstancedMesh);
    const instanceBuffers = instances.map(m => m.instanceMatrix.array);
    for (let i = 0; i < 100; i++) v.update(i / 99, i / 10);
    all.forEach((m, i) => {
      expect(m.geometry).toBe(geometries[i]);
      expect(m.geometry.getAttribute("position").array).toBe(buffers[i]);
      expect(m.geometry.groups).toHaveLength(0);
    });
    instances.forEach((m, i) => expect(m.instanceMatrix.array).toBe(instanceBuffers[i]));
    const resources = [...new Set([...geometries, ...all.map(m => m.material as THREE.Material), ...instances])];
    const spies = resources.map(resource => vi.spyOn(resource, "dispose"));
    const other = createFacilityOperationVisuals(id);
    expect(meshes(other.group).every(m => !geometries.includes(m.geometry) && !all.some(a => a.material === m.material))).toBe(true);
    disposeDioramaObject(v.group);
    spies.forEach(spy => { expect(spy).toHaveBeenCalledTimes(1); spy.mockRestore(); });
    disposeDioramaObject(other.group);
  });
});

it("leaves unknown facilities empty and inactive", () => {
  const v = createFacilityOperationVisuals("unknown");
  v.update(1, 10);
  expect(v.group.visible).toBe(false);
  expect(v.group.children).toHaveLength(0);
});

it("anchors short pump jets at shared mouths facing local north", () => {
  const v = createFacilityOperationVisuals("drainage-pump");
  v.update(1, 0);
  const jets = v.group.getObjectByName("three-outlet-jets") as THREE.InstancedMesh;
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 3; i++) {
    jets.getMatrixAt(i, matrix);
    const origin = new THREE.Vector3().setFromMatrixPosition(matrix);
    expect(origin.toArray()).toEqual(PUMP_PORTS[i].mouth);
    const direction = new THREE.Vector3(0, 0, 1).transformDirection(matrix);
    expect(direction.z).toBeCloseTo(-1);
  }
  expect(vertices(jets).every(p => p.z > -18 && p.z < -12.9 && p.y > 2)).toBe(true);
  disposeDioramaObject(v.group);
});

it("fills to 4.2 with inlet crossing the low berm, and never invents outlet flow", () => {
  const v = createFacilityOperationVisuals("retention-basin");
  const water = v.group.getObjectByName("basin-fill")!;
  for (const amount of [0.001, 0.1, 0.5, 1, 2]) {
    v.update(amount, 3);
    expect(water.position.y).toBeCloseTo(0.26 + Math.min(amount, 1) * 3.94);
    expect(water.position.y).toBeGreaterThan(0.2);
    for (const p of vertices(water as THREE.Mesh)) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(32.001);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(22.001);
    }
    const inlet = vertices(v.group.getObjectByName("directional-water-flow") as THREE.Mesh);
    expect(inlet.some(p => p.z < -24)).toBe(true);
    expect(inlet.every(p => Math.abs(p.x) < BASIN_PORTS.inletHalfWidth && p.z >= -36 && p.z <= -19)).toBe(true);
    expect(v.group.children.map(child => child.name).sort()).toEqual(["basin-fill", "directional-water-flow"]);
  }
  disposeDioramaObject(v.group);
});

it.each(["levee", "revetment"])("keeps %s ribbons thin, directional and exclusively on the river face", id => {
  const v = createFacilityOperationVisuals(id);
  v.update(1, 3);
  const flow = meshes(v.group)[0] as THREE.InstancedMesh;
  for (const p of vertices(flow)) {
    expect(p.z).toBeGreaterThan(0);
    if (id === "levee") {
      expect(p.y + p.z).toBeCloseTo(20.2, 4);
      expect(p.y).toBeLessThan(3.5);
      expect(p.y).toBeGreaterThan(2);
    }
    else expect(p.z).toBeGreaterThan(10);
  }
  const matrix = new THREE.Matrix4(); flow.getMatrixAt(0, matrix);
  const direction = new THREE.Vector3(0, 0, 1).transformDirection(matrix);
  expect(direction.x).toBeCloseTo(1);
  if (id === "levee") {
    const activeHeight = new THREE.Vector3().setFromMatrixPosition(matrix).y;
    v.update(0.1, 3);
    flow.getMatrixAt(0, matrix);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).y).toBeLessThan(activeHeight);
  }
  disposeDioramaObject(v.group);
});

it("moves dredging flow across the work area alongside the barge", () => {
  const v = createFacilityOperationVisuals("channel-dredging");
  v.update(1, 0);
  const points = vertices(meshes(v.group)[0]!);
  expect(points.some(p => p.x < -39)).toBe(true);
  expect(points.some(p => p.x > 10)).toBe(true);
  expect(points.every(p => Math.abs(p.z) > 19 && p.y > 2 && p.y < 2.3)).toBe(true);
  const flow = meshes(v.group)[0]! as THREE.InstancedMesh;
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < flow.count; i++) {
    flow.getMatrixAt(i, matrix);
    expect(matrix.elements[13]).toBeCloseTo(2.15);
  }
  disposeDioramaObject(v.group);
});
