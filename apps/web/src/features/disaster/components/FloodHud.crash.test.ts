import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { FloodHud } from "./FloodHud";
import {
  beginPreparation,
  calculatePlacementEffectiveness,
  refreshPlacementEffects,
} from "../services/floodSimulation";

const IDS = [
  "levee",
  "retention-basin",
  "drainage-pump",
  "revetment",
  "channel-dredging",
] as const;

describe("FloodHud render after placement", () => {
  for (const structureId of IDS) {
    it(`renders with ${structureId} placed`, () => {
      const placement = {
        id: "p1",
        structureId,
        position: { longitude: 140.37776, latitude: 37.359853, height: 18.5 },
        headingDegrees: 130,
      };
      const state = refreshPlacementEffects(beginPreparation(), [placement]);
      const html = renderToString(
        createElement(FloodHud, {
          ...state,
          onStartGame: () => undefined,
          onStartRainNow: () => undefined,
        }),
      );
      expect(html).toContain("配備");
      expect(html).toContain("雨勢");
    });
  }

  it("NaN height でも配置効率は有限で HUD が描画できる", () => {
    const placement = {
      id: "p1",
      structureId: "retention-basin",
      position: { longitude: 140.37776, latitude: 37.359853, height: Number.NaN },
      headingDegrees: 45,
    };
    expect(Number.isFinite(calculatePlacementEffectiveness(placement))).toBe(true);
    const state = refreshPlacementEffects(beginPreparation(), [placement]);
    expect(Number.isFinite(state.mitigation.averageEffectiveness)).toBe(true);
    const html = renderToString(
      createElement(FloodHud, {
        ...state,
        onStartGame: () => undefined,
        onStartRainNow: () => undefined,
      }),
    );
    expect(html).toContain("配備");
    expect(html).toContain("雨勢");
  });
});
