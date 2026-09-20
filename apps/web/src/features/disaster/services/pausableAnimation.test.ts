import { describe, expect, it } from "vitest";
import { createPausableAnimation } from "./pausableAnimation";

function harness() {
  let now = 100, id = 0;
  const pending = new Map<number, (time: number) => void>();
  const cancelled: number[] = [];
  return {
    pending, cancelled,
    clock: {
      now: () => now,
      request: (callback: (time: number) => void) => { const key = id++; pending.set(key, callback); return key; },
      cancel: (key: number) => { cancelled.push(key); pending.delete(key); },
    },
    advance(time: number) { now = time; },
    frame(time: number) {
      now = time;
      const callbacks = [...pending.values()]; pending.clear();
      callbacks.forEach(callback => callback(time));
    },
  };
}

describe("pausable animation", () => {
  it("retains the caller's rain state, removes RAF work and excludes paused time", () => {
    const h = harness(), times: number[] = [];
    let drama = 0.8;
    const loop = createPausableAnimation(time => { times.push(time); drama += 0.01; }, h.clock);
    h.frame(116);
    h.advance(120); loop.setPaused(true);
    expect(h.pending.size).toBe(0);
    h.frame(50_120);
    expect(times).toEqual([116]);
    expect(drama).toBeCloseTo(0.81);
    loop.setPaused(false);
    h.frame(50_136);
    expect(times).toEqual([116, 136]);
    expect(drama).toBeCloseTo(0.82);
    loop.dispose();
    expect(h.pending.size).toBe(0);
  });

  it("handles initial pause and repeated pause/resume without duplicate callbacks", () => {
    const h = harness(), times: number[] = [];
    const loop = createPausableAnimation(time => times.push(time), h.clock, true);
    expect(h.pending.size).toBe(0);
    h.advance(1100); loop.setPaused(false); loop.setPaused(false);
    expect(h.pending.size).toBe(1);
    h.frame(1116);
    h.advance(1120); loop.setPaused(true); loop.setPaused(true);
    h.advance(2120); loop.setPaused(false);
    h.frame(2136);
    expect(times).toEqual([116, 136]);
    loop.dispose();
  });

  it("cancels even RAF id zero and rejects stale callbacks after resume or disposal", () => {
    const h = harness(), times: number[] = [];
    const loop = createPausableAnimation(time => times.push(time), h.clock);
    const stale = h.pending.get(0)!;
    loop.setPaused(true);
    expect(h.cancelled).toEqual([0]);
    h.advance(200); loop.setPaused(false);
    stale(216);
    expect(times).toEqual([]);
    expect(h.pending.size).toBe(1);
    const staleAfterDispose = [...h.pending.values()][0]!;
    loop.dispose(); staleAfterDispose(232); loop.setPaused(false);
    expect(times).toEqual([]);
    expect(h.pending.size).toBe(0);
  });
});
