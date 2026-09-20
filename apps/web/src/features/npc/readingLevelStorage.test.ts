import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadFuriganaEnabled, saveFuriganaEnabled } from "./readingLevelStorage";

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
};

beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", storage);
});
afterEach(() => vi.unstubAllGlobals());

it("defaults to standard and restores the saved furigana setting", () => {
  expect(loadFuriganaEnabled()).toBe(false);
  saveFuriganaEnabled(true);
  expect(loadFuriganaEnabled()).toBe(true);
  saveFuriganaEnabled(false);
  expect(loadFuriganaEnabled()).toBe(false);
});

it("falls back to standard for an invalid saved value", () => {
  storage.setItem("civilcraft.npc.readingLevel", "not-json");
  expect(loadFuriganaEnabled()).toBe(false);
});
