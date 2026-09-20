import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../river-game.css", import.meta.url), "utf8");

describe("mobile tutorial coachmark layout", () => {
  it("uses the measured viewport/dock margins without inherited horizontal centering", () => {
    const start = css.indexOf(".game-shell .tutorial-coach {");
    const nextRule = css.indexOf(".game-shell .tutorial-coach {", start + 1);
    const rule = css.slice(start, nextRule);
    expect(rule).toContain("bottom: calc(158px + env(safe-area-inset-bottom));");
    expect(rule).toContain("left: 16px;");
    expect(rule).toContain("transform: none;");
    expect(rule).toContain("animation: tutorial-coach-enter 0.35s ease;");
    expect(rule).not.toContain("translateX(-50%)");

    const keyframes = css.slice(css.indexOf("@keyframes tutorial-coach-enter"), css.indexOf("@media (prefers-reduced-motion", css.indexOf("@keyframes tutorial-coach-enter")));
    expect(keyframes).toContain("transform: translateY(12px);");
    expect(keyframes).toContain("transform: none;");
  });
});
