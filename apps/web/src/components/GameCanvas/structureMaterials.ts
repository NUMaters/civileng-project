import { Color, ColorMaterialProperty, type MaterialProperty } from "cesium";

export type StructureMaterialKind =
  "earth" | "grass" | "concrete" | "asphalt" | "riprap" | "water" | "metal" | "accent";

// Broad, muted tones avoid repeating grain and baked highlights shimmering at a distance.
const COLOR_BY_KIND: Record<StructureMaterialKind, string> = {
  earth: "#8b8069",
  grass: "#78866a",
  concrete: "#c2c1b6",
  asphalt: "#606665",
  riprap: "#888d87",
  water: "#527e89",
  metal: "#647378",
  accent: "#9b8967",
};

/** Opaque completed parts avoid translucent overlap and unnecessary blending. */
export function createStructureMaterial(
  kind: StructureMaterialKind,
  options: {
    preview?: boolean;
    accentHex?: string;
    /** Compatibility with existing consumers; no textures are sampled. */
    repeatX?: number;
    repeatY?: number;
    solidOnly?: boolean;
  } = {},
): MaterialProperty {
  const hex = kind === "accent" ? (options.accentHex ?? COLOR_BY_KIND.accent) : COLOR_BY_KIND[kind];
  return new ColorMaterialProperty(
    Color.fromCssColorString(hex).withAlpha(options.preview === true ? 0.58 : 1),
  );
}
