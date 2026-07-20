export type StructureTone = "amber" | "river" | "ember" | "slate" | "moss";

export type StructureVisual = {
  tone: StructureTone;
  /** 公開パス（`apps/web/public` 配下）。 */
  imageSrc: string;
  /** 画像が無いときの短いフォールバック文字。 */
  glyph: string;
};

const STRUCTURE_VISUALS: Record<string, StructureVisual> = {
  levee: {
    tone: "amber",
    imageSrc: "/icons/structures/levee.svg",
    glyph: "堤",
  },
  "retention-basin": {
    tone: "river",
    imageSrc: "/icons/structures/retention-basin.svg",
    glyph: "遊",
  },
  "drainage-pump": {
    tone: "ember",
    imageSrc: "/icons/structures/drainage-pump.svg",
    glyph: "排",
  },
  revetment: {
    tone: "slate",
    imageSrc: "/icons/structures/revetment.svg",
    glyph: "護",
  },
  "channel-dredging": {
    tone: "moss",
    imageSrc: "/icons/structures/channel-dredging.svg",
    glyph: "掘",
  },
};

const FALLBACK_VISUAL: StructureVisual = {
  tone: "moss",
  imageSrc: "/icons/structures/levee.svg",
  glyph: "工",
};

export function getStructureVisual(structureId: string): StructureVisual {
  return STRUCTURE_VISUALS[structureId] ?? FALLBACK_VISUAL;
}
