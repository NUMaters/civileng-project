import { readFileSync } from "node:fs";
import * as T from "three";
import { describe, expect, it } from "vitest";
import { createDioramaFacility } from "./dioramaFacilities";
import { createFacilityOperationVisuals } from "./facilityOperationVisuals";
import { BASIN_PORTS, basinInletHeight, PUMP_BORE_RADIUS, PUMP_PORTS } from "./facilityVisualPorts";
import { disposeDioramaObject } from "./disposeDioramaObject";
import { getStructureModelParts } from "./structureModels";
import { configureDioramaThumbnailCamera } from "./dioramaThumbnails";

function hits(group: T.Group, start: T.Vector3, end: T.Vector3) {
  group.updateWorldMatrix(true, true);
  // Double-sided checks catch inward faces too, rather than relying on winding.
  group.traverse(object => {
    if (object instanceof T.Mesh) (object.material as T.Material).side = T.DoubleSide;
  });
  const delta = end.clone().sub(start);
  return new T.Raycaster(start, delta.clone().normalize(), 0.001, delta.length() - 0.001)
    .intersectObject(group, true);
}

describe("facility-local flow paths", () => {
  it("has a dry thumbnail, a lowered clear inlet and a separate through-berm drain", () => {
    const model = createDioramaFacility("retention-basin");
    expect(model.getObjectByName("retention-basin:water")).toBeUndefined();
    expect(model.getObjectByName("retention-basin:foam")).toBeUndefined();
    for (const x of [-5, 0, 5]) {
      expect(hits(model, new T.Vector3(x, 1.4, -36), new T.Vector3(x, 1.4, -20))).toHaveLength(0);
    }
    // Neighbouring high bank remains an actual barrier.
    expect(hits(model, new T.Vector3(10, 4, -37), new T.Vector3(10, 4, -19)).length).toBeGreaterThan(0);
    for (const z of [-2.5, 0, 2.5]) for (const y of [0.4, 1.5, 2.8]) {
      expect(hits(model, new T.Vector3(29, y, z), new T.Vector3(47, y, z))).toHaveLength(0);
    }
    expect(hits(model, new T.Vector3(38, 1, 0), new T.Vector3(38, 4, 0)).length).toBeGreaterThan(0);
    const outletHouse = getStructureModelParts("retention-basin").find(part => part.id === "outlet")!;
    expect(outletHouse.centerHeight - outletHouse.dimensions!.height / 2).toBeGreaterThan(BASIN_PORTS.outletCeiling);
    const bounds = new T.Box3().setFromObject(model);
    expect(bounds.min.x).toBeGreaterThanOrEqual(-46);
    expect(bounds.max.x).toBeLessThanOrEqual(46);
    expect(bounds.min.z).toBeGreaterThanOrEqual(-36);
    expect(bounds.max.z).toBeLessThanOrEqual(36);
    disposeDioramaObject(model);
  });

  it.each(["retention-basin", "drainage-pump"])("keeps %s in the actual static thumbnail frustum", id => {
    const model = createDioramaFacility(id);
    const camera = new T.PerspectiveCamera(32, 256 / 192, 0.1, 1000);
    configureDioramaThumbnailCamera(camera, model, id);
    model.traverse(object => {
      if (!(object instanceof T.Mesh)) return;
      const positions = object.geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        const p = new T.Vector3().fromBufferAttribute(positions, i).project(camera);
        expect(Math.abs(p.x)).toBeLessThan(1);
        expect(Math.abs(p.y)).toBeLessThan(1);
        expect(Math.abs(p.z)).toBeLessThan(1);
      }
    });
    expect(model.children.length).toBeLessThanOrEqual(6);
    disposeDioramaObject(model);
  });

  it("shows all three open pump mouths from the thumbnail camera without rotating the model", () => {
    const model = createDioramaFacility("drainage-pump");
    const camera = new T.PerspectiveCamera(32, 256 / 192, 0.1, 1000);
    configureDioramaThumbnailCamera(camera, model, "drainage-pump");
    expect(camera.position.z).toBeLessThan(0);
    expect(model.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    const screenCenters: T.Vector3[] = [];
    for (const { mouth } of PUMP_PORTS) {
      for (const dx of [-0.6, 0, 0.6]) for (const dy of [-0.6, 0, 0.6]) {
        expect(hits(model, camera.position, new T.Vector3(mouth[0] + dx, mouth[1] + dy, mouth[2]))).toHaveLength(0);
      }
      screenCenters.push(new T.Vector3(...mouth).project(camera));
    }
    // Mouth centers remain individually distinguishable in the 256px-wide card.
    for (let i = 1; i < screenCenters.length; i++) {
      expect(Math.abs(screenCenters[i].x - screenCenters[i - 1].x) * 128).toBeGreaterThan(15);
    }
    disposeDioramaObject(model);
  });

  it("keeps the animated inlet above solids and non-uphill throughout the cycle", () => {
    const model = createDioramaFacility("retention-basin");
    for (const pool of [0.224, 0.62, 2.21, 4.2]) {
      let previous = basinInletHeight(-36, pool);
      for (let z = -35.75; z <= BASIN_PORTS.poolZ; z += 0.25) {
        const y = basinInletHeight(z, pool);
        expect(y).toBeLessThanOrEqual(previous + 1e-9);
        for (const x of [-3.5, 0, 3.5]) {
          expect(hits(model, new T.Vector3(x, y, z), new T.Vector3(x, 12, z))).toHaveLength(0);
        }
        previous = y;
      }
    }
    disposeDioramaObject(model);
  });

  it("gives all pump mouths a clear bore and bounded discharge volume above the pad", () => {
    const model = createDioramaFacility("drainage-pump");
    for (const { mouth } of PUMP_PORTS) {
      const [x, y, z] = mouth;
      for (const dx of [-0.65, 0, 0.65]) for (const dy of [-0.65, 0, 0.65]) {
        expect(Math.hypot(dx, dy)).toBeLessThan(PUMP_BORE_RADIUS);
        expect(hits(model, new T.Vector3(x + dx, y + dy, z + 1),
          new T.Vector3(x + dx, y + dy, z - 4))).toHaveLength(0);
      }
    }
    const operations = createFacilityOperationVisuals("drainage-pump");
    const jets = operations.group.getObjectByName("three-outlet-jets") as T.InstancedMesh;
    const matrix = new T.Matrix4();
    for (const amount of [0.001, 0.5, 1]) {
      operations.update(amount, 2);
      for (let instance = 0; instance < jets.count; instance++) {
        jets.getMatrixAt(instance, matrix);
        const positions = jets.geometry.getAttribute("position");
        for (let i = 0; i < positions.count; i++) {
          const point = new T.Vector3().fromBufferAttribute(positions, i).applyMatrix4(matrix);
          expect(point.y).toBeGreaterThan(2);
          expect(Math.abs(point.z)).toBeLessThan(18);
          expect(hits(model, point, point.clone().add(new T.Vector3(0, 0, -0.2)))).toHaveLength(0);
        }
      }
    }
    const size = new T.Box3().setFromObject(model).getSize(new T.Vector3());
    expect(size.x).toBeLessThanOrEqual(36.001);
    expect(size.z).toBeLessThanOrEqual(36.001);
    expect(size.y).toBeLessThanOrEqual(23.001);
    disposeDioramaObject(model); disposeDioramaObject(operations.group);
  });

  it("matches the actual map parent transform, not a presumed heading convention", () => {
    const source = readFileSync(new URL("./DioramaGameMap.tsx", import.meta.url), "utf8");
    expect(source).toContain("model.rotation.y = -T.MathUtils.degToRad(placement.headingDegrees)");
    expect(source).toContain("const target = -T.MathUtils.degToRad(placement.headingDegrees)");
    const model = createDioramaFacility("drainage-pump");
    const operations = createFacilityOperationVisuals("drainage-pump");
    model.add(operations.group);
    operations.update(1, 0);
    const jets = operations.group.getObjectByName("three-outlet-jets") as T.InstancedMesh;
    for (const headingDegrees of [0, 45, 90, 180, 270]) {
      model.rotation.y = -T.MathUtils.degToRad(headingDegrees);
      model.position.set(40, 12, -70);
      model.updateWorldMatrix(true, true);
      const instance = new T.Matrix4(); jets.getMatrixAt(0, instance);
      const world = jets.matrixWorld.clone().multiply(instance);
      const direction = new T.Vector3(0, 0, 1).transformDirection(world);
      const angle = T.MathUtils.degToRad(headingDegrees);
      expect(direction.x).toBeCloseTo(Math.sin(angle));
      expect(direction.z).toBeCloseTo(-Math.cos(angle));
      const root = new T.Vector3().setFromMatrixPosition(world);
      expect(root.distanceTo(new T.Vector3(...PUMP_PORTS[0].mouth).applyMatrix4(model.matrixWorld))).toBeLessThan(1e-6);
    }
    disposeDioramaObject(model);
  });
});
