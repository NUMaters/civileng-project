import { describe, expect, it } from "vitest";
import {
  advanceFloodSimulation,
  beginPreparation,
  createInitialFloodState,
} from "../services/floodSimulation";

/**
 * フック内の追いつき積分と同じく、長い壁時計デルタを複数ステップで進めたとき
 * 表示残り時間が実時間どおり減ることを検証する。
 */
describe("flood phase timing catch-up", () => {
  it("sums many small steps to match wall-clock elapsed", () => {
    let state = beginPreparation();
    const startRemaining = state.phaseRemainingSeconds;
    const wallDelta = 2.5;
    const step = 0.05;
    let left = wallDelta;
    while (left > 1e-9 && state.phase === "preparation") {
      const dt = Math.min(step, left);
      state = advanceFloodSimulation(state, [], dt);
      left -= dt;
    }
    expect(state.phase).toBe("preparation");
    expect(state.phaseRemainingSeconds).toBeCloseTo(startRemaining - wallDelta, 5);
  });

  it("capped single-frame delta alone would under-advance (regression context)", () => {
    const start = beginPreparation();
    const capped = advanceFloodSimulation(start, [], 0.05);
    const full = advanceFloodSimulation(start, [], 0.2);
    // 1 フレーム 200ms を 50ms に頭打ちすると、実時間の 1/4 しか進まない。
    expect(start.phaseRemainingSeconds - capped.phaseRemainingSeconds).toBeCloseTo(0.05, 5);
    expect(start.phaseRemainingSeconds - full.phaseRemainingSeconds).toBeCloseTo(0.2, 5);
    expect(full.phaseRemainingSeconds).toBeLessThan(capped.phaseRemainingSeconds);
  });

  it("idle state does not tick", () => {
    const idle = createInitialFloodState();
    const next = advanceFloodSimulation(idle, [], 5);
    expect(next.phaseRemainingSeconds).toBe(idle.phaseRemainingSeconds);
  });
});
