import { expect, it } from "vitest";
import rawCatalog from "@civilcraft/game-data/npc/npc-catalog.json";
import { FuriganaText } from "./FuriganaText";

function rubyReadings(value: ReturnType<typeof FuriganaText>): Array<[string, string]> {
  const parts = Array.isArray(value) ? value : [value];
  return parts.flatMap((part) => {
    if (typeof part !== "object" || part === null || !("props" in part)) return [];
    const children = (part as { props: { children?: unknown } }).props.children;
    if (!Array.isArray(children) || typeof children[0] !== "string") return [];
    const readingNode = children[1];
    if (
      typeof readingNode !== "object" ||
      readingNode === null ||
      !("props" in readingNode) ||
      typeof (readingNode as { props: { children?: unknown } }).props.children !== "string"
    )
      return [];
    return [[children[0], (readingNode as { props: { children: string } }).props.children]];
  });
}

it("adds ruby to approved glossary words while leaving unregistered text untouched", () => {
  const rendered = FuriganaText({
    enabled: true,
    text: `${JSON.stringify(rawCatalog)} 洪水ハザードマップで堤防を学ぶ。`,
  });
  const parts = Array.isArray(rendered) ? rendered : [rendered];
  const plainText = parts.filter((item): item is string => typeof item === "string").join("");

  expect(plainText).toContain("ハザードマップ");
});

it("leaves unregistered compounds without an inferred reading", () => {
  const rendered = FuriganaText({ enabled: true, text: "会話中の人物" });
  const parts = Array.isArray(rendered) ? rendered : [rendered];
  expect(parts.filter((item): item is string => typeof item === "string").join("")).toBe(
    "会話中の人物",
  );
});

it("keeps approved readings for NPC dialogue compounds", () => {
  const readings = rubyReadings(
    FuriganaText({ enabled: true, text: "工事を一緒にして高低を見る" }),
  );
  expect(readings).toEqual(
    expect.arrayContaining([
      ["工事", "こうじ"],
      ["一緒", "いっしょ"],
      ["高低", "こうてい"],
    ]),
  );
});
