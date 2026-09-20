import { readFileSync } from "node:fs";
import * as T from "three";
import { expect, it } from "vitest";
import { layoutFacilityLabel, type FacilityLabelLayout } from "./facilityLabelLayout";
import { cacheFacilityLabelEnvelope, projectFacilityBody, layoutFacilityLabelOutsideBody,
  FACILITY_BODY_GAP, MAX_FACILITY_POINTER_LENGTH, type ProjectedFacilityBody } from "./facilityModelLabelLayout";
import { createDioramaFacility } from "./dioramaFacilities";
import { disposeDioramaObject } from "./disposeDioramaObject";

const bounds = { left: 8, right: 382, top: 175, bottom: 538 };
const layout = (): FacilityLabelLayout => ({ x: 0, y: 0, pointerSide: "bottom", pointerHeight: 0,
  pointerBaseX: 0, pointerTipX: 0, pointerLeft: 0, pointerWidth: 0 });
const body = (): ProjectedFacilityBody => ({ left: 215, right: 340, top: 220, bottom: 302,
  topX: 280, topY: 220, bottomX: 280, bottomY: 302 });

function assertClear(result: FacilityLabelLayout, model: ProjectedFacilityBody, width: number, height: number) {
  expect(result.y + height <= model.top - FACILITY_BODY_GAP || result.y >= model.bottom + FACILITY_BODY_GAP).toBe(true);
  expect(result.x).toBeGreaterThanOrEqual(bounds.left);
  expect(result.x + width).toBeLessThanOrEqual(bounds.right);
  expect(result.y).toBeGreaterThanOrEqual(bounds.top);
  expect(result.y + height).toBeLessThanOrEqual(bounds.bottom);
  const top = result.pointerSide === "bottom";
  expect(result.x + result.pointerTipX).toBeCloseTo(top ? model.topX : model.bottomX);
  expect(top ? result.y + height + result.pointerHeight : result.y - result.pointerHeight)
    .toBeCloseTo(top ? model.topY : model.bottomY);
  expect(Math.hypot(result.pointerHeight, result.pointerTipX - result.pointerBaseX)).toBeLessThanOrEqual(MAX_FACILITY_POINTER_LENGTH);
}

it("flips below the entire pump near the HUD, not into its roof/body", () => {
  const model = body(), old = layout(), next = layout();
  expect(layoutFacilityLabel(280, 213, 240, 82, bounds, old)).toBe(true);
  expect(old.pointerSide).toBe("top");
  expect(old.y).toBe(220); // Existing behavior covered y220..302 of the pump.
  expect(layoutFacilityLabelOutsideBody(model, 240, 82, 390, 700, bounds, next)).toBe(true);
  expect(next.pointerSide).toBe("top");
  expect(next.y).toBe(309);
  assertClear(next, model, 240, 82);
});

it("prefers above when it fits, including a bottom-of-map facility", () => {
  const model = { ...body(), top: 360, topY: 363, bottom: 520, bottomY: 518 }, out = layout();
  expect(layoutFacilityLabelOutsideBody(model, 240, 82, 390, 700, bounds, out)).toBe(true);
  expect(out.pointerSide).toBe("bottom");
  assertClear(out, model, 240, 82);
});

it("accepts an exact below-body fit without an extra phantom clearance band", () => {
  const model = { ...body(), bottom: 449, bottomY: 449 }, out = layout();
  expect(layoutFacilityLabelOutsideBody(model, 240, 82, 390, 700, bounds, out)).toBe(true);
  expect(out.y + 82).toBe(bounds.bottom);
  assertClear(out, model, 240, 82);
});

it("hides when neither side fits or when attachment is offscreen or would need a long triangle", () => {
  expect(layoutFacilityLabelOutsideBody({ ...body(), top: 180, topY: 180, bottom: 530, bottomY: 530 },
    240, 82, 390, 700, bounds, layout())).toBe(false);
  expect(layoutFacilityLabelOutsideBody({ ...body(), topX: -10, bottomX: 410 },
    240, 82, 390, 700, bounds, layout())).toBe(false);
  expect(layoutFacilityLabelOutsideBody({ ...body(), top: 650, topY: 650, bottom: 690, bottomY: 690 },
    240, 82, 390, 700, bounds, layout())).toBe(false);
});

it("caches a fixed 8-corner envelope and actual geometry attachment points", () => {
  const model = createDioramaFacility("drainage-pump");
  const cached = cacheFacilityLabelEnvelope(model);
  expect(cached.corners).toHaveLength(8);
  expect(cached.supports).toHaveLength(14);
  const vertices = new Set<string>();
  model.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    const positions = object.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) vertices.add(`${positions.getX(i)},${positions.getY(i)},${positions.getZ(i)}`);
  });
  for (const point of cached.supports) expect(vertices.has(point.toArray().join(","))).toBe(true);
  // Appended operation objects cannot expand an already cached static envelope.
  const effect = new T.Mesh(new T.BoxGeometry(10000, 10000, 10000), new T.MeshBasicMaterial());
  model.add(effect);
  expect(cached.corners.every(point => Math.abs(point.x) <= 18.001 && Math.abs(point.z) <= 18.001)).toBe(true);
  disposeDioramaObject(model);
});

it.each([0, 90, 140])("clears the actual projected pump at heading %s after zoom/pop transforms", heading => {
  const model = createDioramaFacility("drainage-pump"), envelope = cacheFacilityLabelEnvelope(model);
  const camera = new T.PerspectiveCamera(43, 390 / 700, 1, 6000);
  camera.setViewOffset(390, 700, -85, 70, 390, 700);
  model.position.set(14, 3, -10);
  model.rotation.y = -T.MathUtils.degToRad(heading);
  model.scale.setScalar(1.05);
  model.updateWorldMatrix(true, false);
  const target = model.position.clone().add(new T.Vector3(0, 11.5, 0));
  const point = new T.Vector3(), projected = body(), matrix = new T.Matrix4(), out = layout();
  for (const zoom of [1, 1.3]) {
    camera.position.copy(target).add(new T.Vector3(70, 130, 145).multiplyScalar(zoom));
    camera.lookAt(target); camera.updateMatrixWorld(true);
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(model.matrixWorld);
    expect(projectFacilityBody(envelope, matrix, 390, 700, projected, point)).toBe(true);
    expect(layoutFacilityLabelOutsideBody(projected, 240, 82, 390, 700, bounds, out)).toBe(true);
    assertClear(out, projected, 240, 82);
    // Conservative envelope contains every rendered static vertex at the current pose.
    model.traverse(object => {
      if (!(object instanceof T.Mesh)) return;
      const positions = object.geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(matrix);
        const x = (point.x * 0.5 + 0.5) * 390, y = (-point.y * 0.5 + 0.5) * 700;
        expect(x).toBeGreaterThanOrEqual(projected.left - 1e-6);
        expect(x).toBeLessThanOrEqual(projected.right + 1e-6);
        expect(y).toBeGreaterThanOrEqual(projected.top - 1e-6);
        expect(y).toBeLessThanOrEqual(projected.bottom + 1e-6);
      }
    });
  }
  disposeDioramaObject(model);
});

it("rejects behind-camera and near-plane-crossing envelopes", () => {
  const model = createDioramaFacility("drainage-pump"), envelope = cacheFacilityLabelEnvelope(model);
  const camera = new T.PerspectiveCamera(43, 390 / 700, 1, 6000);
  camera.position.set(0, 10, -100); camera.lookAt(0, 10, -200); camera.updateMatrixWorld(true);
  let matrix = new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  expect(projectFacilityBody(envelope, matrix, 390, 700, body(), new T.Vector3())).toBe(false);
  camera.position.set(0, 10, 0); camera.lookAt(0, 10, -100); camera.updateMatrixWorld(true);
  matrix = new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  expect(projectFacilityBody(envelope, matrix, 390, 700, body(), new T.Vector3())).toBe(false);
  disposeDioramaObject(model);
});

it("uses cached dimensions only for the chosen facility, leaving guidance generic", () => {
  const source = readFileSync(new URL("./DioramaGameMap.tsx", import.meta.url), "utf8");
  const start = source.indexOf("for (const [id, element] of labels.current)");
  const loop = source.slice(start, source.indexOf("for (const npc of latest.current.npcMarkers", start));
  expect(loop).toContain("id !== activeLabelId");
  expect(loop).toContain("labelEnvelopes.current.get(model)");
  expect(loop).toContain("model.updateWorldMatrix(true, false)");
  expect(loop).not.toMatch(/Box3|traverse|setFromObject|getBoundingClientRect|point.y \+= 35/);
  expect(source.indexOf("cacheFacilityLabelEnvelope(model)")).toBeLessThan(source.indexOf("model.add(operation.group)"));
  expect(source).toContain("scoreGuidanceAnchor(px, py, projected.z");
});
