import type { GeoPoint } from "./koriyamaGeodata";

export const IMAGERY_TREE_OBSERVATIONS_URL = "/geodata/koriyama/imagery-tree-observations.json";
export type ImageryTreeObservations = {
  schemaVersion: 1;
  source: {
    referenceTile: { z: number; x: number; y: number; sizePixels: number };
    tileUrlTemplate: string;
    displayedCapturePeriod: string;
    mapUrl: string;
    attribution: string;
  };
  observations: [eastPixels: number, southPixels: number, crownRadiusPixels: number][];
  inspectionBatches?: {
    id: string;
    /** Inclusive indices into observations in this snapshot. */
    observationRange: [number, number];
    mapUrl?: string;
    displayedCapturePeriod?: string;
  }[];
};

/** One manually inspected crown, not a surveyed trunk or an automatically scattered tree. */
export type ImageryTreeCandidate = {
  id: string;
  coordinates: GeoPoint;
  crownRadiusM: number;
  positionSource: "imagery-inferred";
  imagery: {
    url: string;
    tile: { z: number; x: number; y: number };
    /** Continuous pixel coordinates from the tile's top-left EDGE; pixel centre is i+0.5. */
    pixel: { x: number; y: number };
    /** Source capture period, not download date. Null explicitly means unknown. */
    capturePeriod: { start: string; end: string } | null;
    captureDateSourceUrl?: string;
    captureDateScope: "view-label-not-per-tree-verified" | "tile-metadata" | "unknown";
    attribution: string;
    manuallyInspected: true;
  };
};
export type VegetationPoint = { x: number; z: number };
export type VegetationBounds = { minX: number; minZ: number; maxX: number; maxZ: number };
export type VegetationExclusion = {
  sourceId: string;
  kind: "building" | "road" | "rail" | "water" | "existing-tree";
  geometry:
    | { type: "polygon"; rings: readonly (readonly VegetationPoint[])[] }
    | { type: "disc"; centre: VegetationPoint; radiusM: number }
    | { type: "corridor"; points: readonly VegetationPoint[]; halfWidthM: number };
};

/** XYZ/Web Mercator, 256px tiles. This georeferences a supplied observation, not a detection. */
export function imageryPixelToGeo(tile: { z: number; x: number; y: number }, pixel: { x: number; y: number }): GeoPoint {
  const n = 2 ** tile.z;
  if (!Number.isInteger(tile.z) || tile.z < 0 || tile.z > 22 ||
      ![tile.x, tile.y].every(v => Number.isInteger(v) && v >= 0 && v < n) ||
      ![pixel.x, pixel.y].every(v => Number.isFinite(v) && v >= 0 && v <= 256)) throw new RangeError("Invalid imagery tile/pixel coordinates");
  return [(tile.x + pixel.x / 256) / n * 360 - 180,
    Math.atan(Math.sinh(Math.PI * (1 - 2 * (tile.y + pixel.y / 256) / n))) * 180 / Math.PI];
}

/** Normalizes cross-tile screenshot offsets; never treats off-tile pixels as a new observation.
 * Radius uses Web Mercator ground scale at the observed latitude, not nominal image accuracy.
 * The capture period describes the inspected VIEW, not independently verified per-tree dates.
 */
export function convertImageryTreeObservations(data: ImageryTreeObservations): ImageryTreeCandidate[] {
  const source = data.source, ref = source?.referenceTile;
  if (data.schemaVersion !== 1 || !ref || ref.sizePixels !== 256 || !Array.isArray(data.observations) ||
      typeof source.tileUrlTemplate !== "string" || !source.attribution || !source.mapUrl ||
      !/^\d{4}-\d{2}\/\d{4}-\d{2}$/.test(source.displayedCapturePeriod)) throw new RangeError("Invalid imagery observations metadata");
  imageryPixelToGeo(ref, { x: 0, y: 0 });
  const batchByIndex = new Map<number, NonNullable<ImageryTreeObservations["inspectionBatches"]>[number]>();
  for (const batch of data.inspectionBatches ?? []) {
    const [first, last] = batch.observationRange;
    if (!batch.id || !Number.isInteger(first) || !Number.isInteger(last) || first < 0 || last < first || last >= data.observations.length ||
        (batch.mapUrl !== undefined && !batch.mapUrl.startsWith("https://maps.gsi.go.jp/")) ||
        (batch.displayedCapturePeriod !== undefined && !/^\d{4}-\d{2}\/\d{4}-\d{2}$/.test(batch.displayedCapturePeriod)))
      throw new RangeError("Invalid imagery inspection batch");
    for (let i = first; i <= last; i++) {
      if (batchByIndex.has(i)) throw new RangeError("Overlapping imagery inspection batches");
      batchByIndex.set(i, batch);
    }
  }
  return data.observations.map((observation, index) => {
    if (!Array.isArray(observation) || observation.length !== 3 || !observation.every(Number.isFinite) || observation[2] <= 0)
      throw new RangeError("Invalid crown observation");
    const [east, south, radius] = observation;
    const dx = Math.floor(east / 256), dy = Math.floor(south / 256);
    const tile = { z: ref.z, x: ref.x + dx, y: ref.y + dy };
    const pixel = { x: east - dx * 256, y: south - dy * 256 };
    const coordinates = imageryPixelToGeo(tile, pixel);
    const metresPerPixel = 2 * Math.PI * 6378137 * Math.cos(coordinates[1] * Math.PI / 180) / (256 * 2 ** ref.z);
    const batch = batchByIndex.get(index);
    const [start, end] = (batch?.displayedCapturePeriod ?? source.displayedCapturePeriod).split("/") as [string, string];
    return { id: `gsi-crown/${tile.z}/${tile.x}/${tile.y}/${pixel.x}/${pixel.y}`, coordinates,
      crownRadiusM: radius * metresPerPixel, positionSource: "imagery-inferred",
      imagery: { url: source.tileUrlTemplate.replace("{z}", String(tile.z)).replace("{x}", String(tile.x)).replace("{y}", String(tile.y)),
        tile, pixel, capturePeriod: { start, end }, captureDateSourceUrl: batch?.mapUrl ?? source.mapUrl,
        captureDateScope: "view-label-not-per-tree-verified", attribution: source.attribution, manuallyInspected: true } };
  });
}
