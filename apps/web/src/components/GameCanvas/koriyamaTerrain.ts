/** Pure GSI ground sampler; no network, renderer, geoid approximation or synthetic fill. */
export const KORIYAMA_TERRAIN_DATUM_M = 230;
export interface KoriyamaTerrainMetadata {
  schemaVersion: number;
  bounds: readonly number[];
  zoom: number;
  width: number;
  height: number;
  pixelOrigin: readonly number[];
  noData: number;
  localDatumM: number;
}
export interface KoriyamaTerrain {
  metadata: KoriyamaTerrainMetadata;
  elevationsCm: Int32Array;
  quality: Uint8Array;
}
export type TerrainSample = {
  elevationM: number; localY: number;
  quality: "dem5a" | "fallback-dem5b" | "fallback-dem10b";
} | { elevationM: null; localY: null; quality: "noData" | "outside-coverage" | "invalid-coordinate" };

export function decodeKoriyamaTerrain(buffer: ArrayBuffer, metadata: KoriyamaTerrainMetadata): KoriyamaTerrain {
  const { width, height, zoom, bounds, pixelOrigin, localDatumM } = metadata;
  if (metadata.schemaVersion !== 1 || !Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 ||
    !Number.isInteger(zoom) || zoom < 0 || zoom > 22 || bounds.length !== 4 || !bounds.every(Number.isFinite) ||
    bounds[0]! >= bounds[2]! || bounds[1]! >= bounds[3]! || bounds[1]! <= -85 || bounds[3]! >= 85 ||
    pixelOrigin.length !== 2 || !pixelOrigin.every(Number.isInteger) || !Number.isFinite(localDatumM) ||
    metadata.noData !== -2147483648 || buffer.byteLength !== width * height * 5) throw new Error("Invalid terrain metadata/buffer");
  const view = new DataView(buffer), elevationsCm = new Int32Array(width * height), quality = new Uint8Array(width * height);
  for (let i = 0; i < elevationsCm.length; i++) {
    elevationsCm[i] = view.getInt32(i * 5, true); quality[i] = view.getUint8(i * 5 + 4);
    if (quality[i]! > 3 || (quality[i] === 0) !== (elevationsCm[i] === metadata.noData)) throw new Error("Invalid terrain quality/noData");
  }
  return { metadata, elevationsCm, quality };
}

/** One Three.js unit = one metre. This fixed display origin is NOT a datum conversion. */
export function groundElevationToLocalY(elevationM: number, datumM = KORIYAMA_TERRAIN_DATUM_M): number {
  if (!Number.isFinite(elevationM) || !Number.isFinite(datumM)) throw new Error("Non-finite elevation/datum");
  return elevationM - datumM;
}

export function sampleKoriyamaTerrain(terrain: KoriyamaTerrain, longitude: number, latitude: number): TerrainSample {
  const missing = (quality: "noData" | "outside-coverage" | "invalid-coordinate"): TerrainSample => ({ elevationM: null, localY: null, quality });
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return missing("invalid-coordinate");
  const m = terrain.metadata, [west, south, east, north] = m.bounds;
  if (longitude < west! || longitude > east! || latitude < south! || latitude > north!) return missing("outside-coverage");
  const world = 256 * 2 ** m.zoom;
  let x = (longitude + 180) / 360 * world - .5 - m.pixelOrigin[0]!;
  let y = (1 - Math.asinh(Math.tan(latitude * Math.PI / 180)) / Math.PI) / 2 * world - .5 - m.pixelOrigin[1]!;
  // Suppress floating-point noise at exact sample centres, without moving ordinary queries.
  if (Math.abs(x - Math.round(x)) < 1e-8) x = Math.round(x);
  if (Math.abs(y - Math.round(y)) < 1e-8) y = Math.round(y);
  if (x < 0 || y < 0 || x > m.width - 1 || y > m.height - 1) return missing("noData");
  const x0 = Math.min(Math.floor(x), m.width - 2), y0 = Math.min(Math.floor(y), m.height - 2);
  const dx = x - x0, dy = y - y0;
  const weights = [(1-dx)*(1-dy), dx*(1-dy), (1-dx)*dy, dx*dy];
  const indices = [y0*m.width+x0, y0*m.width+x0+1, (y0+1)*m.width+x0, (y0+1)*m.width+x0+1];
  let elevationM = 0, worstQuality = 1;
  for (let n = 0; n < 4; n++) {
    if (weights[n] === 0) continue;
    const i = indices[n]!, q = terrain.quality[i]!, h = terrain.elevationsCm[i]!;
    if (!q || h === m.noData) return missing("noData");
    worstQuality = Math.max(worstQuality, q); elevationM += h / 100 * weights[n]!;
  }
  return { elevationM, localY: groundElevationToLocalY(elevationM, m.localDatumM),
    quality: worstQuality === 1 ? "dem5a" : worstQuality === 2 ? "fallback-dem5b" : "fallback-dem10b" };
}
