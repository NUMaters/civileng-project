import { readFileSync } from "node:fs";
import * as T from "three";
import { expect, it } from "vitest";
import { scoreGuidanceAnchor } from "./guidanceLabelLayout";
import type { FacilityLabelLayout } from "./facilityLabelLayout";
import { getDioramaGuidance, initialDioramaFocus } from "./dioramaGuidance";
import { geoToWorld, riverX, worldToGeo } from "./dioramaSpace";
import { decodeKoriyamaTerrain, sampleKoriyamaTerrain } from "./koriyamaTerrain";

// Main's observed 390x700 HUD bottom=167 and dock top=546, plus existing 8px margin.
const bounds = { left: 8, right: 382, top: 175, bottom: 538 };
const scratch = (): FacilityLabelLayout => ({ x: 0, y: 0, pointerSide: "bottom", pointerHeight: 0,
  pointerBaseX: 0, pointerTipX: 0, pointerLeft: 0, pointerWidth: 0 });

it.each([[280, 250], [40, 350], [350, 480], [195, 530]])("accepts real visible anchors excluded by obsolete bounds: %s,%s", (x, y) => {
  const out = scratch();
  expect(Number.isFinite(scoreGuidanceAnchor(x, y, 0.5, 390, 700, 210, 70, bounds, out))).toBe(true);
  expect(out.x).toBeGreaterThanOrEqual(bounds.left);
  expect(out.x + 210).toBeLessThanOrEqual(bounds.right);
  expect(out.y).toBeGreaterThanOrEqual(bounds.top);
  expect(out.y + 70).toBeLessThanOrEqual(bounds.bottom);
  expect(out.x + out.pointerTipX).toBeCloseTo(x);
  expect(out.pointerSide === "top" ? out.y - out.pointerHeight : out.y + 70 + out.pointerHeight).toBeCloseTo(y);
});

it.each([[-1, 350, 0], [391, 350, 0], [195, -1, 0], [195, 701, 0],
  [195, 350, -1.01], [195, 350, 1.01], [195, 160, 0], [195, 550, 0],
  [NaN, 350, 0], [195, NaN, 0], [195, 350, NaN]])("rejects offscreen, clipped or UI-obscured anchors %s,%s,%s", (x, y, depth) => {
  expect(scoreGuidanceAnchor(x, y, depth, 390, 700, 210, 70, bounds, scratch())).toBe(Infinity);
});

it("waits for measured size and declines a label that cannot fit", () => {
  expect(scoreGuidanceAnchor(195, 350, 0, 390, 700, 0, 0, bounds, scratch())).toBe(Infinity);
  expect(scoreGuidanceAnchor(195, 350, 0, 390, 700, 400, 70, bounds, scratch())).toBe(Infinity);
  expect(scoreGuidanceAnchor(195, 350, 0, 390, 700, 210, 400, bounds, scratch())).toBe(Infinity);
});

it("ranks toward the measured playable area, not the old whole-screen safe band", () => {
  const x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
  expect(scoreGuidanceAnchor(x, y, 0.5, 390, 700, 210, 70, bounds, scratch())).toBe(0);
  expect(scoreGuidanceAnchor(x + 40, y + 50, 0.5, 390, 700, 210, 70, bounds, scratch())).toBe(66);
});

it("admits a real initial-camera campus hint using the actual DEM and candidate positions", () => {
  const metadata = JSON.parse(readFileSync(new URL("../../../public/geodata/koriyama/terrain-metadata.json", import.meta.url), "utf8"));
  const bytes = readFileSync(new URL("../../../public/geodata/koriyama/terrain.bin", import.meta.url));
  const terrain = decodeKoriyamaTerrain(Uint8Array.from(bytes).buffer, metadata);
  const ground = (x: number, z: number) => {
    const geo = worldToGeo(x, z);
    return sampleKoriyamaTerrain(terrain, geo.longitude, geo.latitude).localY;
  };
  const focus = geoToWorld(initialDioramaFocus().longitude, initialDioramaFocus().latitude);
  const targetGround = ground(riverX(focus.z), focus.z);
  expect(targetGround).not.toBeNull();
  const target = new T.Vector3(riverX(focus.z), targetGround!, focus.z);
  const downstream = new T.Vector3(riverX(focus.z + 80) - riverX(focus.z - 80), 0, 160).normalize();
  const camera = new T.PerspectiveCamera(43, 390 / 700, 1, 6000);
  camera.position.copy(target).addScaledVector(downstream, 480)
    .add(new T.Vector3(downstream.z * 105, 360, -downstream.x * 105));
  camera.lookAt(target); camera.updateMatrixWorld(true);
  const eligible: { id: string; x: number; y: number; score: number }[] = [];
  for (const site of getDioramaGuidance([])) {
    const position = geoToWorld(site.longitude, site.latitude);
    const y = ground(position.x, position.z);
    if (y === null) continue;
    const projected = new T.Vector3(position.x, y + 12, position.z).project(camera);
    const px = (projected.x * 0.5 + 0.5) * 390, py = (-projected.y * 0.5 + 0.5) * 700;
    const score = scoreGuidanceAnchor(px, py, projected.z, 390, 700, 210, 70, bounds, scratch());
    if (Number.isFinite(score)) eligible.push({ id: site.id, x: px, y: py, score });
  }
  expect(eligible.some(site => site.id === "campus-core")).toBe(true);
  const chosen = eligible.sort((a, b) => a.score - b.score)[0];
  expect(chosen).toBeDefined();
  expect(chosen.id).toBe("campus-core");
  expect(chosen.y).toBeLessThan(290); // The previous fixed-band selector rejected it.
  expect(getDioramaGuidance([]).some(site => site.id === chosen.id)).toBe(true);
  // Evidence of actual projection, not an invented fallback site or anchor.
  console.info("initial mobile guidance", { eligible: eligible.map(site => site.id), chosen });
});

it("uses cached measurements, one hint and unchanged prep/preview gates in the map", () => {
  const map = readFileSync(new URL("./DioramaGameMap.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("./diorama.css", import.meta.url), "utf8");
  const start = map.indexOf("const hint = guidanceLabel.current;");
  const loop = map.slice(start, map.indexOf("renderer.render(scene, camera)", start));
  expect(map).toContain("sizeObserver.observe(guidanceLabel.current)");
  expect(loop).toContain("labelSizes.current.get(hint)");
  expect(loop).toContain('state.phase === "preparation" || state.phase === "idle"');
  expect(loop).toContain("!latest.current.placements.some((placement) => placement.preview)");
  expect(loop).toContain("score < Infinity");
  expect(loop).toContain("bestScore");
  expect(loop).toContain("isPreferredDioramaGuidanceCandidate(site.hasContribution, score");
  expect(loop).toContain("chosen?.hasContribution");
  expect(loop).toContain('hint.style.visibility = chosen ? "visible" : "hidden"');
  // Ground/water validation moved to the static geography cache; absent legal
  // projections still fail closed, without repeating terrain queries per frame.
  expect(loop).toContain("selectGuidanceProjection(guidanceAnchors.get(site.id), site.hasContribution)");
  expect(loop).toContain("if (!position) continue");
  expect(loop).not.toMatch(/createGeographicGuidanceAnchors|resolveLegalPumpGuidance|sampleGround|sampleRenderedGround/);
  expect(map.indexOf("const guidanceAnchors = createGeographicGuidanceAnchors")).toBeLessThan(map.indexOf("const hint = guidanceLabel.current"));
  expect(loop).toContain("selectGuidanceAdvice(guidanceAnchors.get(chosen.id), chosen)");
  expect(loop).not.toMatch(/getBoundingClientRect|getComputedStyle|offsetWidth|offsetHeight|py < 290|viewportHeight - 240|px < 90|hint.style.display/);
  expect(map).toContain("new T.PerspectiveCamera(43, 1, 1, 6000)");
  expect(map).toContain(".addScaledVector(downstream, 480)");
  expect(map).toContain("new T.Vector3(downstream.z * 105, 360, -downstream.x * 105)");
  expect(css).toContain(".diorama-guidance[data-pointer-side=\"top\"]:after");
  expect(css).toMatch(/\.diorama-guidance\s*\{[^}]*visibility: hidden/s);
});
