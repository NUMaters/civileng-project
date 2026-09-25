import { Color, ColorMaterialProperty, type MaterialProperty } from "cesium";

export type StructureMaterialKind =
  "earth" | "grass" | "concrete" | "asphalt" | "riprap" | "water" | "metal" | "accent";

// Broad, muted tones avoid repeating grain and baked highlights shimmering at a distance.
const COLOR_BY_KIND: Record<StructureMaterialKind, string> = {
  earth: "#8b8069",
  grass: "#64804b",
  concrete: "#c2c1b6",
  asphalt: "#606665",
  riprap: "#888d87",
  water: "#267d9f",
  metal: "#647378",
  accent: "#9b8967",
};

/** Opaque parts, including previews, retain depth and hide interior intersections.
 * Placement/invalid cues belong to the renderer's outline and ground marker.
 */
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
  return new ColorMaterialProperty(Color.fromCssColorString(hex).withAlpha(1));
}
