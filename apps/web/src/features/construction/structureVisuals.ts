import {
  getHazardKindLabel,
  type HazardKind,
} from "@civilcraft/game-data/types";

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

/** 配置トースト・影響圏説明用の短い効果ラベル。 */
export function getStructureEffectLabel(structureId: string): string {
  switch (structureId) {
    case "levee":
      return "溢れ止め";
    case "revetment":
      return "岸固め";
    case "retention-basin":
      return "水位カット";
    case "drainage-pump":
      return "内水排出";
    case "channel-dredging":
      return "川通し強化";
    default:
      return "治水効果";
  }
}

/** 影響圏の形が何を意味するか（配置判断用）。 */
export function getStructureZoneMeaning(structureId: string): string {
  switch (structureId) {
    case "levee":
      return "帯＝堤沿いの溢れを抑える範囲";
    case "revetment":
      return "帯＝護岸が固める岸の範囲";
    case "retention-basin":
      return "楕円＝水位を削る貯留の範囲";
    case "drainage-pump":
      return "扇＝排水が届く市街地方向";
    case "channel-dredging":
      return "帯＝掘削で水通しが良くなる範囲";
    default:
      return "色付きの範囲内の弱点に効く";
  }
}

export function getHazardLabel(kind: HazardKind): string {
  return getHazardKindLabel(kind);
}

/** 弱点マーカー色（種別ごと）。 */
export function getHazardMarkerColor(kind: HazardKind): { fill: string; outline: string } {
  switch (kind) {
    case "overtopping":
      return { fill: "#ff6b4a", outline: "#ffd0c4" };
    case "erosion":
      return { fill: "#e0a03a", outline: "#ffe2a8" };
    case "inlandPonding":
      return { fill: "#4aa3e0", outline: "#b8e0ff" };
    case "capacityShortage":
      return { fill: "#6bc4a0", outline: "#c8f0de" };
    default:
      return { fill: "#ff8b6b", outline: "#ffd0c4" };
  }
}
