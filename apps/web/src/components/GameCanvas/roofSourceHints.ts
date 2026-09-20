import { koriyamaGeoToLocal, type GeodataFeature } from "./koriyamaGeodata";

export type RoofSourceHints = {
  sourceId: string;
  shape: string | null;
  eligibleForDisplayGeometry: boolean;
  reason: "supported-tag-and-rectangle" | "not-building" | "missing-shape" | "unsupported-shape" | "complex-footprint";
  footprint: "single-convex-near-rectangle" | "unsupported";
  roofHeightMeters: number | null;
  roofDirectionTagDegrees: number | null;
  roofOrientationTag: "along" | "across" | null;
  ridgeDirectionDegrees: null;
  ridgePosition: null;
  requiresEstimatedDimensions: boolean;
  provenance: {
    source: "OpenStreetMap"; sourceId: string; sourceVersion: number; sourceTimestamp: string;
    verification: "roof-tags-unverified";
    geometry: "shape-hint-only-ridge-and-pitch-not-reconstructed";
    heightPolicy: "preserve-source-total-height-allocate-roof-within-envelope-never-add-on-top";
  };
};

function metres(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?(?:\s*m)?$/.test(value)) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Conservative candidate selection only. Does not build roofs, infer roof dimensions/floors,
 * mutate the feature, or transfer OSM tags onto a nearby PLATEAU building without an identity match.
 * Eligibility means a future explicitly illustrative builder can handle this source footprint;
 * it does NOT mean the actual ridge, pitch or roof height is known. Existing source height is untouched.
 */
export function resolveRoofSourceHints(feature: GeodataFeature): RoofSourceHints {
  const p = feature.properties;
  const shape = typeof p["roof:shape"] === "string" && p["roof:shape"].trim() ? p["roof:shape"].trim() : null;
  const direction = p["roof:direction"];
  const degrees = typeof direction === "string" && /^\d+(?:\.\d+)?$/.test(direction) ? Number(direction) : NaN;
  const roofDirectionTagDegrees = Number.isFinite(degrees) && degrees >= 0 && degrees < 360 ? degrees : null;
  const orientation = p["roof:orientation"];
  const roofOrientationTag = orientation === "along" || orientation === "across" ? orientation : null;
  const roofHeightMeters = metres(p["roof:height"]);
  let rectangle = false;
  if (feature.geometry.type === "MultiPolygon" && feature.geometry.coordinates.length === 1 && feature.geometry.coordinates[0]!.length === 1) {
    const ring = feature.geometry.coordinates[0]![0]!;
    if (ring.length === 5 && ring[0]![0] === ring[4]![0] && ring[0]![1] === ring[4]![1]) {
      const points = ring.slice(0, 4).map(koriyamaGeoToLocal);
      const edges = points.map((point, i) => ({ x: points[(i + 1) % 4]!.x - point.x, z: points[(i + 1) % 4]!.z - point.z }));
      let winding = 0;
      rectangle = edges.every((a, i) => {
        const b = edges[(i + 1) % 4]!;
        const lengths = Math.hypot(a.x, a.z) * Math.hypot(b.x, b.z);
        const cross = a.x * b.z - a.z * b.x;
        if (!Number.isFinite(lengths) || lengths < 0.01 || Math.abs(cross) < 1e-8) return false;
        const sign = Math.sign(cross);
        if (winding && sign !== winding) return false;
        winding = sign;
        // Within two degrees of orthogonality. Holes, concavity and irregular roofs are rejected.
        return Math.abs(a.x * b.x + a.z * b.z) / lengths <= Math.sin(2 * Math.PI / 180);
      });
    }
  }
  const reason: RoofSourceHints["reason"] = p.kind !== "building" ? "not-building" : !shape ? "missing-shape" :
    shape !== "gabled" && shape !== "hipped" ? "unsupported-shape" : !rectangle ? "complex-footprint" : "supported-tag-and-rectangle";
  return { sourceId: feature.id, shape, eligibleForDisplayGeometry: reason === "supported-tag-and-rectangle", reason,
    footprint: rectangle ? "single-convex-near-rectangle" : "unsupported", roofHeightMeters, roofDirectionTagDegrees, roofOrientationTag,
    ridgeDirectionDegrees: null, ridgePosition: null,
    requiresEstimatedDimensions: true,
    provenance: { source: "OpenStreetMap", sourceId: feature.id, sourceVersion: p.version, sourceTimestamp: p.timestamp,
      verification: "roof-tags-unverified", geometry: "shape-hint-only-ridge-and-pitch-not-reconstructed",
      heightPolicy: "preserve-source-total-height-allocate-roof-within-envelope-never-add-on-top" } };
}
