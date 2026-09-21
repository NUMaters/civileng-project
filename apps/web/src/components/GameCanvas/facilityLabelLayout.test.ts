import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FACILITY_LABEL_MARGIN, layoutFacilityLabel, type FacilityLabelBounds, type FacilityLabelLayout } from "./facilityLabelLayout";

const result = (): FacilityLabelLayout => ({ x: 0, y: 0, pointerSide: "bottom", pointerHeight: 0, pointerBaseX: 0, pointerTipX: 0, pointerLeft: 0, pointerWidth: 0 });
// Example measured occupied region at 390x700, not hard-coded UI heights in production.
const bounds: FacilityLabelBounds = { left: 8, right: 382, top: 220, bottom: 520 };

function assertFit(out: FacilityLabelLayout, area: FacilityLabelBounds, width: number, height: number, x: number, y: number) {
  expect(out.x).toBeGreaterThanOrEqual(area.left);
  expect(out.x + width).toBeLessThanOrEqual(area.right);
  expect(out.y).toBeGreaterThanOrEqual(area.top);
  expect(out.y + height).toBeLessThanOrEqual(area.bottom);
  expect(out.x + out.pointerTipX).toBeCloseTo(x);
  const tipY = out.pointerSide === "bottom" ? out.y + height + out.pointerHeight : out.y - out.pointerHeight;
  expect(tipY).toBeCloseTo(y);
  expect(out.pointerHeight).toBeGreaterThanOrEqual(7);
  expect(out.pointerBaseX).toBeGreaterThanOrEqual(Math.min(13, width / 2));
  expect(out.pointerBaseX).toBeLessThanOrEqual(width - Math.min(13, width / 2));
  expect(out.pointerTipX - out.pointerLeft).toBeGreaterThanOrEqual(0);
  expect(out.pointerTipX - out.pointerLeft).toBeLessThanOrEqual(out.pointerWidth);
}

describe("mobile facility label layout", () => {
  it("keeps the reported x280 pump inside a 390px viewport and moves its pointer", () => {
    const out = result();
    expect(layoutFacilityLabel(280, 400, 240, 90, bounds, out)).toBe(true);
    expect(out.x).toBe(142);
    expect(out.pointerTipX).toBe(138);
    expect(out.pointerTipX).not.toBe(120);
    assertFit(out, bounds, 240, 90, 280, 400);
  });
  it.each([0, 8, 40, 195, 280, 382, 390])("tracks the exact horizontal anchor at x%s", x => {
    const out = result();
    expect(layoutFacilityLabel(x, 400, 180, 80, bounds, out)).toBe(true);
    assertFit(out, bounds, 180, 80, x, 400);
  });
  it("flips below near the measured HUD, and stays above the measured dock", () => {
    const out = result();
    expect(layoutFacilityLabel(280, 230, 240, 100, bounds, out)).toBe(true);
    expect(out.pointerSide).toBe("top");
    assertFit(out, bounds, 240, 100, 280, 230);
    expect(layoutFacilityLabel(280, 580, 240, 100, bounds, out)).toBe(true);
    expect(out.pointerSide).toBe("bottom");
    assertFit(out, bounds, 240, 100, 280, 580);
  });
  it("uses newly measured label height after operation text wraps", () => {
    const out = result();
    for (const height of [40, 80, 120, 150]) {
      expect(layoutFacilityLabel(280, 400, 240, height, bounds, out)).toBe(true);
      assertFit(out, bounds, 240, height, 280, 400);
    }
  });
  it.each([200, 320, 390, 430, 700])("adapts to viewport width %s with measured safe area", width => {
    const area = { left: FACILITY_LABEL_MARGIN, right: width - FACILITY_LABEL_MARGIN, top: 130, bottom: 570 };
    const labelWidth = Math.min(240, width - 2 * FACILITY_LABEL_MARGIN);
    const out = result();
    expect(layoutFacilityLabel(width - 20, 350, labelWidth, 95, area, out)).toBe(true);
    assertFit(out, area, labelWidth, 95, width - 20, 350);
  });
  it("fails closed for invalid dimensions, stale oversized sizes or insufficient map space", () => {
    const out = result();
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(layoutFacilityLabel(bad, 350, 240, 95, bounds, out)).toBe(false);
      expect(layoutFacilityLabel(280, bad, 240, 95, bounds, out)).toBe(false);
      expect(layoutFacilityLabel(280, 350, bad, 95, bounds, out)).toBe(false);
      expect(layoutFacilityLabel(280, 350, 240, bad, bounds, out)).toBe(false);
    }
    expect(layoutFacilityLabel(280, 350, 0, 95, bounds, out)).toBe(false);
    expect(layoutFacilityLabel(280, 350, 400, 95, bounds, out)).toBe(false);
    expect(layoutFacilityLabel(280, 350, 240, 95, { ...bounds, bottom: 270 }, out)).toBe(false);
    expect(layoutFacilityLabel(280, 350, 240, 95, { ...bounds, top: 310, bottom: 420 }, out)).toBe(false);
  });
  it("reuses its caller-owned output across repeated camera updates", () => {
    const out = result(), same = out;
    for (let frame = 0; frame < 1000; frame++) {
      expect(layoutFacilityLabel(frame % 390, 400, 240, 95, bounds, out)).toBe(true);
      expect(out).toBe(same);
    }
  });
  it("keeps measurement outside the frame loop and labels non-interactive/aria-hidden", () => {
    const map = readFileSync(new URL("./DioramaGameMap.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("./diorama.css", import.meta.url), "utf8");
    const loop = map.slice(map.indexOf("for (const [id, element] of labels.current)"), map.indexOf("for (const npc of latest.current.npcMarkers"));
    expect(loop).toContain("labelSizes.current.get(element)");
    expect(loop).not.toMatch(/getBoundingClientRect|offsetWidth|offsetHeight|clientWidth|clientHeight|getComputedStyle/);
    expect(map).toContain('className="diorama-labels" aria-hidden="true"');
    expect(map).toContain('shell.querySelector(".river-hud")');
    expect(map).toContain('shell.querySelector(".cmd-dock")');
    for (const observer of ["boundsObserver", "shellObserver", "sizeObserver"]) expect(map).toContain(`${observer}.disconnect()`);
    expect(css).toMatch(/\.diorama-label\[data-heading\]\s*\{[^}]*pointer-events: none/s);
    expect(css).toContain("max-width: min(240px, calc(100% - 16px))");
    expect(css).toContain("overflow-wrap: anywhere");
    expect(css).toContain("var(--facility-pointer-tip-x)");
  });
});
