import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewModeBar } from "./FloodResultPanel";

const css = readFileSync(new URL("./review-mode.css", import.meta.url), "utf8");
const block = (selector: string) => css.split(`${selector} {`).slice(1).map(part => part.split("}")[0]).join(";");
const property = (selector: string, name: string) => {
  const value = [...block(selector).matchAll(new RegExp(`(?:^|;)\\s*${name}:\\s*(#[0-9a-f]+)\\s*;`, "gi"))].at(-1)?.[1];
  if (!value) throw new Error(`Missing ${name} in ${selector}`);
  return value;
};
function luminance(hex: string) {
  const full = hex.length === 4 ? hex.slice(1).split("").map(c => c + c).join("") : hex.slice(1);
  const channels = [0, 2, 4].map(i => {
    const s = parseInt(full.slice(i, i + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

describe("bright review controls", () => {
  it.each([".review-mode-legend", ".game-shell .review-mode-bar",
    ".game-shell .review-mode-bar__badge.is-clear", ".game-shell .review-mode-bar__badge.is-failure",
    ".game-shell .review-mode-bar__ghost", ".game-shell .review-mode-bar__primary"])("keeps text contrast above 4.5 on opaque %s", selector => {
    const a = luminance(property(selector, "color")), b = luminance(property(selector, "background"));
    expect((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps mobile safe areas, a keyboard focus outline, and minimum action targets", () => {
    expect(css).toContain("env(safe-area-inset-top)");
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(css).toContain("min-height: 44px");
    expect(block(".game-shell .review-mode-bar button:focus-visible")).toContain("outline: 3px solid #123c64");
  });
  it.each([true, false])("retains both actions and textual outcome when clear=%s", isClear => {
    const markup = renderToStaticMarkup(<ReviewModeBar isClear={isClear} score={1234} onShowResult={() => {}} onStartNewGame={() => {}} />);
    expect(markup).toContain(isClear ? "成功" : "失敗");
    expect(markup).toContain("1,234");
    expect(markup.match(/<button/g)).toHaveLength(2);
    expect(markup).toContain("結果を見る"); expect(markup).toContain("メニューへ");
  });
});
