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
  expect(cached.supports.length).toBeGreaterThan(14);
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

const FACILITY_MODEL_IDS = ["levee", "retention-basin", "drainage-pump", "revetment", "channel-dredging"];

it.each(FACILITY_MODEL_IDS)("matches projected convex-hull extrema for %s across headings and pitches", structureId => {
  const model = createDioramaFacility(structureId), envelope = cacheFacilityLabelEnvelope(model);
  const camera = new T.PerspectiveCamera(43, 390 / 700, 1, 6000);
  model.position.set(14, 3, -10);
  model.scale.setScalar(1.05);
  const target = model.position.clone().add(new T.Vector3(0, 11.5, 0));
  const point = new T.Vector3(), projected = body(), matrix = new T.Matrix4();
  for (const heading of [0, 90, 140]) for (const direction of [new T.Vector3(70, 130, 145), new T.Vector3(70, 220, 80)]) {
    model.rotation.y = -T.MathUtils.degToRad(heading);
    model.updateWorldMatrix(true, true);
    camera.position.copy(target).add(direction);
    camera.lookAt(target); camera.updateMatrixWorld(true);
    const viewProjection = new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    matrix.multiplyMatrices(viewProjection, model.matrixWorld);
    expect(projectFacilityBody(envelope, matrix, 390, 700, projected, point)).toBe(true);
    const actual = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
    const scratch = new T.Vector3(), objectClip = new T.Matrix4();
    model.traverse(object => {
      if (!(object instanceof T.Mesh)) return;
      const positions = object.geometry.getAttribute("position");
      objectClip.multiplyMatrices(viewProjection, object.matrixWorld);
      for (let i = 0; i < positions.count; i++) {
        scratch.fromBufferAttribute(positions, i).applyMatrix4(objectClip);
        const x = (scratch.x * 0.5 + 0.5) * 390, y = (-scratch.y * 0.5 + 0.5) * 700;
        actual.left = Math.min(actual.left, x); actual.right = Math.max(actual.right, x);
        actual.top = Math.min(actual.top, y); actual.bottom = Math.max(actual.bottom, y);
      }
    });
    expect(projected.left).toBeCloseTo(actual.left, 5);
    expect(projected.right).toBeCloseTo(actual.right, 5);
    expect(projected.top).toBeCloseTo(actual.top, 5);
    expect(projected.bottom).toBeCloseTo(actual.bottom, 5);
  }
  disposeDioramaObject(model);
});

it("keeps static hull projection work within the bounded label budget", () => {
  const models = FACILITY_MODEL_IDS.map(createDioramaFacility);
  try {
    const envelopes = models.map(cacheFacilityLabelEnvelope);
    const boundaryCounts = envelopes.map(envelope => envelope.supports.length);
    const sourcePointCounts = envelopes.map(envelope => envelope.sourcePointCount);
    const uniquePointCounts = envelopes.map(envelope => envelope.uniquePointCount);
    expect(boundaryCounts.every(count => count > 14 && count < 1024)).toBe(true);
    expect(uniquePointCounts.every((count, i) => count <= sourcePointCounts[i]!)).toBe(true);
    expect(boundaryCounts.reduce((sum, count) => sum + count, 0)).toBeLessThan(4096);
    console.info("facility label convex-hull budget", {
      models: envelopes.length, sourcePointCounts, uniquePointCounts, boundaryCounts,
      totalSourcePoints: sourcePointCounts.reduce((sum, count) => sum + count, 0),
      totalUniquePoints: uniquePointCounts.reduce((sum, count) => sum + count, 0),
      totalBoundaryVertices: boundaryCounts.reduce((sum, count) => sum + count, 0),
    });
  } finally {
    models.forEach(disposeDioramaObject);
  }
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
