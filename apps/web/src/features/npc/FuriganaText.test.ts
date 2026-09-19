import { expect, it } from "vitest";
import rawCatalog from "@civilcraft/game-data/npc/npc-catalog.json";
import { FuriganaText } from "./FuriganaText";

it("adds ruby to every kanji in the NPC catalog while leaving katakana untouched", () => {
  const rendered = FuriganaText({
    enabled: true,
    text: `${JSON.stringify(rawCatalog)} 洪水ハザードマップで堤防を学ぶ。`,
  });
  const parts = Array.isArray(rendered) ? rendered : [rendered];
  const plainText = parts.filter((item): item is string => typeof item === "string").join("");

  expect(plainText).not.toMatch(/[\u3400-\u9fff]/u);
  expect(plainText).toContain("ハザードマップ");
});
