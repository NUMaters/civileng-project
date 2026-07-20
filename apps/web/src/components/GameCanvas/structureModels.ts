import type { StructureMaterialKind } from "./structureMaterials";

export type StructureModelPart = {
  id: string;
  kind: "box" | "cylinder";
  dimensions?: { length: number; width: number; height: number };
  radius?: number;
  offsetEast?: number;
  offsetNorth?: number;
  centerHeight: number;
  material: StructureMaterialKind;
  /** accent マテリアル用。施設ごとの識別色。 */
  accentHex?: string;
  repeatX?: number;
  repeatY?: number;
};

/**
 * 土木施設の立体パーツ定義。
 * 単色ボックスではなく、土・コンクリート・水面などの層で構成する。
 */
export function getStructureModelParts(structureId: string): StructureModelPart[] {
  const models: Record<string, StructureModelPart[]> = {
    levee: [
      {
        id: "toe",
        kind: "box",
        dimensions: { length: 96, width: 34, height: 2.2 },
        centerHeight: 1.1,
        material: "earth",
        repeatX: 4,
        repeatY: 2,
      },
      {
        id: "slope-lower",
        kind: "box",
        dimensions: { length: 92, width: 26, height: 2.8 },
        centerHeight: 3.5,
        material: "grass",
        repeatX: 5,
        repeatY: 2,
      },
      {
        id: "slope-upper",
        kind: "box",
        dimensions: { length: 88, width: 16, height: 2.6 },
        centerHeight: 6.2,
        material: "grass",
        repeatX: 4,
        repeatY: 1.5,
      },
      {
        id: "crest",
        kind: "box",
        dimensions: { length: 84, width: 8, height: 1.4 },
        centerHeight: 8.1,
        material: "asphalt",
        repeatX: 6,
        repeatY: 1,
      },
      {
        id: "shoulder",
        kind: "box",
        dimensions: { length: 84, width: 1.2, height: 0.7 },
        offsetNorth: 4.2,
        centerHeight: 8.55,
        material: "concrete",
        repeatX: 8,
        repeatY: 1,
      },
      {
        id: "marker",
        kind: "box",
        dimensions: { length: 6, width: 1.4, height: 0.35 },
        centerHeight: 8.95,
        material: "accent",
        accentHex: "#e8a72d",
      },
    ],
    "retention-basin": [
      {
        id: "outer-berm",
        kind: "cylinder",
        dimensions: { length: 0, width: 0, height: 3.2 },
        radius: 42,
        centerHeight: 1.6,
        material: "earth",
        repeatX: 6,
        repeatY: 2,
      },
      {
        id: "inner-berm",
        kind: "cylinder",
        dimensions: { length: 0, width: 0, height: 2.4 },
        radius: 36,
        centerHeight: 2.8,
        material: "grass",
        repeatX: 5,
        repeatY: 2,
      },
      {
        id: "pool",
        kind: "cylinder",
        dimensions: { length: 0, width: 0, height: 1.1 },
        radius: 30,
        centerHeight: 3.4,
        material: "water",
        repeatX: 3,
        repeatY: 3,
      },
      {
        id: "outlet-base",
        kind: "box",
        dimensions: { length: 10, width: 10, height: 3 },
        offsetEast: 30,
        centerHeight: 2.4,
        material: "concrete",
      },
      {
        id: "outlet-tower",
        kind: "box",
        dimensions: { length: 6, width: 6, height: 7 },
        offsetEast: 30,
        centerHeight: 6.5,
        material: "concrete",
      },
      {
        id: "outlet-pipe",
        kind: "cylinder",
        dimensions: { length: 0, width: 0, height: 8 },
        radius: 1.4,
        offsetEast: 24,
        centerHeight: 3.2,
        material: "metal",
      },
      {
        id: "gate",
        kind: "box",
        dimensions: { length: 3, width: 0.6, height: 4 },
        offsetEast: 30,
        offsetNorth: 4,
        centerHeight: 5.5,
        material: "accent",
        accentHex: "#2c91d1",
      },
    ],
    "drainage-pump": [
      {
        id: "pad",
        kind: "box",
        dimensions: { length: 34, width: 28, height: 1.2 },
        centerHeight: 0.6,
        material: "concrete",
        repeatX: 3,
        repeatY: 2,
      },
      {
        id: "hall",
        kind: "box",
        dimensions: { length: 24, width: 18, height: 10 },
        centerHeight: 6.2,
        material: "concrete",
        repeatX: 2,
        repeatY: 2,
      },
      {
        id: "window-band",
        kind: "box",
        dimensions: { length: 20, width: 0.6, height: 2.4 },
        offsetNorth: 9.2,
        centerHeight: 6.5,
        material: "metal",
      },
      {
        id: "roof",
        kind: "box",
        dimensions: { length: 26, width: 20, height: 1.6 },
        centerHeight: 12.2,
        material: "metal",
        repeatX: 3,
        repeatY: 2,
      },
      {
        id: "stack",
        kind: "cylinder",
        dimensions: { length: 0, width: 0, height: 9 },
        radius: 2.2,
        offsetEast: 7,
        centerHeight: 16,
        material: "concrete",
      },
      {
        id: "stack-cap",
        kind: "cylinder",
        dimensions: { length: 0, width: 0, height: 1.2 },
        radius: 2.8,
        offsetEast: 7,
        centerHeight: 21,
        material: "metal",
      },
      {
        id: "intake",
        kind: "box",
        dimensions: { length: 8, width: 16, height: 4.5 },
        offsetEast: -16,
        centerHeight: 2.8,
        material: "concrete",
      },
      {
        id: "intake-water",
        kind: "box",
        dimensions: { length: 6, width: 12, height: 1.2 },
        offsetEast: -16,
        centerHeight: 1.4,
        material: "water",
      },
      {
        id: "door",
        kind: "box",
        dimensions: { length: 0.5, width: 3.2, height: 4.5 },
        offsetNorth: -9.2,
        centerHeight: 3.5,
        material: "accent",
        accentHex: "#d9673c",
      },
    ],
    revetment: [
      {
        id: "riprap",
        kind: "box",
        dimensions: { length: 76, width: 18, height: 2.4 },
        offsetNorth: -3,
        centerHeight: 1.2,
        material: "riprap",
        repeatX: 5,
        repeatY: 2,
      },
      {
        id: "step-1",
        kind: "box",
        dimensions: { length: 72, width: 5, height: 2.2 },
        offsetNorth: 2,
        centerHeight: 2.5,
        material: "concrete",
        repeatX: 6,
        repeatY: 1,
      },
      {
        id: "step-2",
        kind: "box",
        dimensions: { length: 72, width: 5, height: 2.2 },
        offsetNorth: 5.5,
        centerHeight: 4.7,
        material: "concrete",
        repeatX: 6,
        repeatY: 1,
      },
      {
        id: "wall",
        kind: "box",
        dimensions: { length: 70, width: 3.5, height: 5.5 },
        offsetNorth: 8.5,
        centerHeight: 7.2,
        material: "concrete",
        repeatX: 5,
        repeatY: 2,
      },
      {
        id: "coping",
        kind: "box",
        dimensions: { length: 74, width: 5, height: 0.9 },
        offsetNorth: 8.5,
        centerHeight: 10.2,
        material: "concrete",
        repeatX: 7,
        repeatY: 1,
      },
      {
        id: "rail",
        kind: "box",
        dimensions: { length: 70, width: 0.35, height: 1.1 },
        offsetNorth: 10.2,
        centerHeight: 11.1,
        material: "metal",
      },
      {
        id: "badge",
        kind: "box",
        dimensions: { length: 5, width: 0.4, height: 0.5 },
        offsetNorth: 8.5,
        centerHeight: 10.8,
        material: "accent",
        accentHex: "#8b73d1",
      },
    ],
    "channel-dredging": [
      {
        id: "spoil-left",
        kind: "box",
        dimensions: { length: 100, width: 8, height: 3.2 },
        offsetNorth: 18,
        centerHeight: 1.6,
        material: "earth",
        repeatX: 5,
        repeatY: 1.5,
      },
      {
        id: "spoil-right",
        kind: "box",
        dimensions: { length: 100, width: 8, height: 3.2 },
        offsetNorth: -18,
        centerHeight: 1.6,
        material: "earth",
        repeatX: 5,
        repeatY: 1.5,
      },
      {
        id: "bench-left",
        kind: "box",
        dimensions: { length: 98, width: 5, height: 1.6 },
        offsetNorth: 11,
        centerHeight: 0.9,
        material: "grass",
      },
      {
        id: "bench-right",
        kind: "box",
        dimensions: { length: 98, width: 5, height: 1.6 },
        offsetNorth: -11,
        centerHeight: 0.9,
        material: "grass",
      },
      {
        id: "channel",
        kind: "box",
        dimensions: { length: 102, width: 18, height: 2.2 },
        centerHeight: 0.4,
        material: "water",
        repeatX: 4,
        repeatY: 1.5,
      },
      {
        id: "cut-mark",
        kind: "box",
        dimensions: { length: 14, width: 2, height: 0.4 },
        centerHeight: 2.4,
        material: "accent",
        accentHex: "#26a682",
      },
    ],
  };

  return (
    models[structureId] ?? [
      {
        id: "facility",
        kind: "box",
        dimensions: { length: 22, width: 22, height: 10 },
        centerHeight: 5,
        material: "concrete",
      },
    ]
  );
}

/** ドラッグゴースト用の外接サイズ（m）。 */
export function getStructureFootprintMeters(structureId: string): {
  length: number;
  width: number;
  height: number;
} {
  const parts = getStructureModelParts(structureId);
  let length = 22;
  let width = 22;
  let height = 8;
  for (const part of parts) {
    if (part.kind === "cylinder") {
      const diameter = (part.radius ?? 10) * 2;
      length = Math.max(length, diameter);
      width = Math.max(width, diameter);
      height = Math.max(height, part.dimensions?.height ?? part.centerHeight * 2);
      continue;
    }
    if (part.dimensions === undefined) {
      continue;
    }
    length = Math.max(length, part.dimensions.length + Math.abs(part.offsetEast ?? 0) * 2);
    width = Math.max(width, part.dimensions.width + Math.abs(part.offsetNorth ?? 0) * 2);
    height = Math.max(height, part.centerHeight + part.dimensions.height * 0.5);
  }
  return { length, width, height };
}
