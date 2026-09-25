# Koriyama ground terrain

Bounded GSI DEM-derived ground elevations for `[140.370, 37.351, 140.398, 37.379]`
(west, south, east, north), matching the PLATEAU building extent. These are real
DEM elevations, not the existing synthetic valley. Renderer integration is separate.

## Reproduce

From repository root, Node 22+ (built-in modules only):

```sh
node apps/web/scripts/fetch-koriyama-terrain.mjs
node apps/web/scripts/fetch-koriyama-terrain.mjs --offline
cd apps/web && pnpm exec vitest run src/components/GameCanvas/koriyamaTerrain.test.ts
```

The script uses the included immutable `terrain-source-*.png` files and their
SHA-256 sidecars first. Offline mode never makes network requests. Missing caches
are fetched only from bounded tiles, with a 4 MiB total response-body budget,
500 KB per response and 20 second request timeout. HTTP 404s are recorded;
other HTTP/network errors abort rather than silently degrade. Remove/move only
these terrain source caches yourself if deliberately obtaining a new snapshot.
Running the script regenerates only `terrain.bin` and `terrain-metadata.json`.
Runtime needs those two files only; source PNGs are reproducibility artifacts.

## Source, date, resolution and rights

- [GSI tile catalogue](https://maps.gsi.go.jp/development/ichiran.html),
  [encoding](https://maps.gsi.go.jp/development/demtile.html).
  PNG rather than text: text tiles stopped updating in October 2024.
- DEM5A (nominal 5 m) preferred, then DEM5B (5 m), then DEM10B (10 m).
  Fallback happens per missing pixel, preserving all valid higher-quality pixels.
  These source DEMs are already smoothed/interpolated by GSI; they are not point
  surveys at every requested position. No output claims centimetre accuracy.
- Zoom 14 Web Mercator raster, approximately 7.59 m ground spacing at the centre;
  exact spacing is in metadata. 328 columns × 413 rows includes a sample halo.
  The sampler deliberately rejects positions outside the requested bounds.
- Source capture: individual UTC `retrievedAt` and HTTP `lastModified` fields in
  metadata. Neither is the survey/acquisition date, which is unknown.
- [GSI content terms](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html)
  apply (PDL1.0, with the GSI terms and any applicable statutory constraints).
  Display a linked attribution and processing statement:
  **地理院タイル（国土地理院）標高タイルを加工して作成**.

## Height reference and integration API

Values are GSI orthometric ground height **H in metres**, in the Japanese national
mean-sea-level height system (Tokyo Peil mainland reference), **not ellipsoid h**.
Tile payloads do not identify the vertical datum realization/epoch. GSI announced
the 2024 height revision rollout in its
[January 2026 update](https://maps.gsi.go.jp/pn/meeting_partners/data/20260128/1-2.pdf),
but this snapshot's individual epoch was not independently verified. Do not assume
absolute-height agreement with the 2020 PLATEAU models, or add the existing
Cesium provider's approximate 39.5 m geoid offset to this Three.js ground.

```ts
import {
  decodeKoriyamaTerrain, sampleKoriyamaTerrain,
} from './koriyamaTerrain';

// Fetch/cache once in the integrating caller; check both HTTP responses first.
const terrain = decodeKoriyamaTerrain(binaryArrayBuffer, metadata);
const sample = sampleKoriyamaTerrain(terrain, longitude, latitude);
if (sample.elevationM !== null) {
  mesh.position.y = sample.localY;
  // Preserve sample.quality for inspection: dem5a / fallback-dem5b / fallback-dem10b.
} else {
  // Explicitly handle noData / outside-coverage / invalid-coordinate.
  // Do not substitute zero or synthetic ground and call it measured.
}
```

`groundElevationToLocalY(H)` is **H − 230 m**: fixed display datum, one Three.js
unit per metre, positive Y upward, no exaggeration. It does not depend on the
sample minimum or loaded extent. Horizontal coordinates may use the existing
`geoToWorld` (east +X, north −Z). All ground, building bases and water levels must
share this display datum. Relative building heights may be added to sampled
ground, but that is a ground-alignment choice, not proof of original PLATEAU
absolute elevation compatibility. A water level specified as H converts by the
same subtraction; a water *depth* must first be added to its ground H.

DEM gives terrain, not bridge deck or building roof elevations. Do not drape a
bridge deck to this grid. River surface/bottom values are not reliable bathymetry;
submerged ground, sharp embankments and sub-grid structures need separate data.
This dataset alone is not a validated hydraulic simulation.

## Binary and interpolation contract

`terrain.bin`: row-major north-to-south, west-to-east; each sample is 5 bytes:
signed int32 **little-endian centimetres**, then uint8 quality (0 missing, 1 DEM5A,
2 DEM5B fallback, 3 DEM10B fallback). Missing elevation is -2147483648, never 0.
Zero and negative valid heights remain valid. Metadata records counts and hashes.

`pixelOrigin` is the global integer pixel index of the first stored sample;
sample centres are at global index + 0.5. The sampler transforms lon/lat to
Mercator pixels, subtracts 0.5, and performs bilinear interpolation. Any missing
nonzero-weight neighbour makes the result noData; weights are never renormalized
around holes. The worst contributing quality is returned. Exact sample centres
ignore zero-weight neighbours. Tiny floating-point errors at centres are snapped.
Outside coverage is rejected, not clamped or extrapolated.
