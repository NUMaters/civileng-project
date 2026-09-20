import { readFileSync } from "node:fs";
import * as T from "three";
import { expect, it } from "vitest";
import type { FacilityLabelLayout } from "./facilityLabelLayout";
import { guidanceClearsFacilities, MAX_GUIDANCE_OBSTACLES } from "./guidanceFacilityClearance";
import { scoreGuidanceAnchor } from "./guidanceLabelLayout";
import { cacheFacilityLabelEnvelope, projectFacilityBody } from "./facilityModelLabelLayout";
import { createDioramaFacility } from "./dioramaFacilities";
import { disposeDioramaObject } from "./disposeDioramaObject";

const obstacle = { left: 308, right: 385, top: 178, bottom: 314 };
const layout = (x = 174, y = 227): FacilityLabelLayout => ({ x, y, pointerSide: "bottom",
  pointerHeight: 7, pointerBaseX: 104, pointerTipX: 104, pointerLeft: 0, pointerWidth: 208 });

it("rejects the reported 390x700 revetment/guidance overlap", () => {
  // defense5186, confirmed revetment then zoom +1: main's actual pixel rectangles.
  expect(guidanceClearsFacilities(layout(), 208, 66, [obstacle], 1)).toBe(false);
  expect(guidanceClearsFacilities(layout(40, 360), 208, 66, [obstacle], 1)).toBe(true);
});

it.each(["bottom", "top"] as const)("rejects a %s pointer crossing a model even when the card is clear", pointerSide => {
  const card = { ...layout(100, pointerSide === "bottom" ? 100 : 250), pointerSide,
    pointerBaseX: 50, pointerTipX: 150, pointerHeight: 70 };
  const body = { left: 220, right: 230, top: 180, bottom: 205 };
  expect(guidanceClearsFacilities({ ...card, pointerHeight: 0, pointerTipX: 50 }, 100, 50, [body], 1)).toBe(true);
  expect(guidanceClearsFacilities(card, 100, 50, [body], 1)).toBe(false);
});

it("keeps the existing seven-pixel model clearance margin", () => {
  const body = { left: 315, right: 350, top: 227, bottom: 293 };
  expect(guidanceClearsFacilities(layout(100, 227), 208, 66, [body], 1)).toBe(false);
  expect(guidanceClearsFacilities(layout(99, 227), 208, 66, [body], 1)).toBe(true);
});

it("chooses a clear real candidate instead of moving the blocked candidate's anchor", () => {
  const bounds = { left: 8, right: 382, top: 175, bottom: 538 };
  const candidates = [{ id: "blocked", x: 278, y: 300 }, { id: "clear", x: 110, y: 460 }];
  const scratch = layout();
  let chosen: string | undefined, best = Infinity;
  for (const candidate of candidates) {
    const score = scoreGuidanceAnchor(candidate.x, candidate.y, 0.5, 390, 700, 208, 66, bounds, scratch);
    if (score < best && guidanceClearsFacilities(scratch, 208, 66, [obstacle], 1)) {
      chosen = candidate.id; best = score;
      expect(scratch.x + scratch.pointerTipX).toBeCloseTo(candidate.x);
    }
  }
  expect(chosen).toBe("clear");
});

it("hides all-blocked candidates and allows an unchanged hint after removal/invisibility", () => {
  const pooled = [obstacle, { left: 0, right: 390, top: 0, bottom: 700 }];
  expect(guidanceClearsFacilities(layout(), 208, 66, pooled, 2)).toBe(false);
  // Pool storage is retained; only the count for this update is used.
  expect(guidanceClearsFacilities(layout(), 208, 66, pooled, 0)).toBe(true);
  expect(guidanceClearsFacilities(layout(), 208, 66, [], 0)).toBe(true);
});

it("fails closed on capacity overflow without growing obstacle storage", () => {
  const pooled = Array.from({ length: MAX_GUIDANCE_OBSTACLES }, () => ({ left: 500, right: 510, top: 0, bottom: 10 }));
  expect(guidanceClearsFacilities(layout(), 208, 66, pooled, MAX_GUIDANCE_OBSTACLES)).toBe(true);
  expect(guidanceClearsFacilities(layout(), 208, 66, pooled, MAX_GUIDANCE_OBSTACLES + 1)).toBe(false);
  expect(guidanceClearsFacilities(layout(), 208, 66, pooled, -1)).toBe(false);
});

it("reprojects cached real geometry after movement/rotation/zoom without retaining old bounds", () => {
  const model = createDioramaFacility("revetment"), envelope = cacheFacilityLabelEnvelope(model);
  const camera = new T.PerspectiveCamera(43, 390 / 700, 1, 6000);
  camera.position.set(80, 130, 180); camera.lookAt(0, 6, 0); camera.updateMatrixWorld(true);
  const clip = new T.Matrix4(), point = new T.Vector3();
  const projected = { left: 0, right: 0, top: 0, bottom: 0, topX: 0, topY: 0, bottomX: 0, bottomY: 0 };
  model.updateWorldMatrix(true, false);
  clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(model.matrixWorld);
  expect(projectFacilityBody(envelope, clip, 390, 700, projected, point)).toBe(true);
  const card = layout(projected.left, projected.top);
  expect(guidanceClearsFacilities(card, 100, 40, [projected], 1)).toBe(false);
  const oldWidth = projected.right - projected.left;
  model.rotation.y = Math.PI / 2;
  camera.zoom = 1.2; camera.updateProjectionMatrix();
  model.updateWorldMatrix(true, false);
  clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(model.matrixWorld);
  expect(projectFacilityBody(envelope, clip, 390, 700, projected, point)).toBe(true);
  expect(projected.right - projected.left).not.toBeCloseTo(oldWidth);
  model.position.x = 1000;
  model.updateWorldMatrix(true, false);
  clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(model.matrixWorld);
  const localBox = new T.Box3(envelope.corners[0].clone(), envelope.corners[7].clone());
  const frustum = new T.Frustum().setFromProjectionMatrix(clip);
  expect(frustum.intersectsBox(localBox)).toBe(false);
  // The map omits offscreen models, so no stale obstacle remains in the active prefix.
  expect(guidanceClearsFacilities(card, 100, 40, [projected], 0)).toBe(true);
  disposeDioramaObject(model);
});

it("fails closed for a visible facility crossing the near plane, rather than ignoring it", () => {
  const model = createDioramaFacility("drainage-pump"), envelope = cacheFacilityLabelEnvelope(model);
  const camera = new T.PerspectiveCamera(43, 390 / 700, 1, 6000);
  camera.position.set(0, 10, 0); camera.lookAt(0, 10, -100); camera.updateMatrixWorld(true);
  const clip = new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const box = new T.Box3(envelope.corners[0].clone(), envelope.corners[7].clone());
  expect(new T.Frustum().setFromProjectionMatrix(clip).intersectsBox(box)).toBe(true);
  const body = { left: 0, right: 0, top: 0, bottom: 0, topX: 0, topY: 0, bottomX: 0, bottomY: 0 };
  expect(projectFacilityBody(envelope, clip, 390, 700, body, new T.Vector3())).toBe(false);
  disposeDioramaObject(model);
});

it("integrates the fixed projection pool before selection without frame-time geometry/DOM reads", () => {
  const source = readFileSync(new URL("./DioramaGameMap.tsx", import.meta.url), "utf8");
  const start = source.indexOf("const hint = guidanceLabel.current;");
  const update = source.slice(start, source.indexOf("renderer.render(scene, camera)", start));
  expect(source.indexOf("const guidanceObstacles = Array.from")).toBeLessThan(source.indexOf("const draw ="));
  expect(update).toContain("let obstacleCount = 0");
  expect(update).toContain("if (!model.visible || model.userData.preview) continue");
  expect(update).toContain("labelEnvelopes.current.get(model)");
  expect(update).toContain("if (!guidanceFrustum.intersectsBox(guidanceLocalBox)) continue");
  expect(update).toContain("obstacleCount === MAX_GUIDANCE_OBSTACLES");
  expect(update).toContain("if (obstaclesReady) for (const site");
  expect(update).toContain("guidanceClearsFacilities(candidateHintLayout");
  expect(update).not.toMatch(/new T\.|Array.from|\.push\(|setFromObject|\.traverse\(|getBoundingClientRect|getComputedStyle/);
  expect(update.indexOf("projectFacilityBody(")).toBeLessThan(update.indexOf("for (const site"));
});
