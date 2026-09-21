# Koriyama / Nihon University Engineering actual geography

This directory contains separate bounded **OpenStreetMap** and **PLATEAU LOD1**
extracts, not an invented town or a surveyed-terrain dataset. They include Nihon University College of
Engineering, the Abukuma River, Eitoku Bridge (永徳橋), Miyoda Bridge (御代田橋),
nearby buildings, roads and railways. Campus identification is retained as
OSM `way/88161447`; the university's official address is
[田村町徳定字中河原1](https://www.nihon-u.ac.jp/access_map/engineering/).

## OpenStreetMap source, date, license

- Provider: [OpenStreetMap](https://www.openstreetmap.org), obtained through
  `https://overpass-api.de/api/interpreter`. Exact query is in `metadata.json`.
- OSM snapshot: **2026-09-20T13:19:21Z**. Capture/packaging time and object edit
  timestamps are recorded separately. These are not survey dates.
- Data license: **Open Data Commons Open Database License 1.0 (ODbL-1.0)**.
  These data files are not covered by the repository's software MIT license.
- Display **© OpenStreetMap contributors**, linked to
  <https://www.openstreetmap.org/copyright>, on the map. When redistributing the
  data, retain attribution, license, source snapshot and this notice. The ODbL
  applies to this adapted database; see the linked license for obligations.
- OSM source tags (including GSI/Yahoo references where present) remain in the
  snapshot. This is OSM data, not a claim of independent GSI/PLATEAU extraction.

## Files and extent

- `features.geojson`: renderable clipped geometry, WGS84 longitude/latitude.
  9,239,212 bytes uncompressed; ordinary web gzip/Brotli compression is advised.
- `source.osm.json.gz`: 1,265,409-byte reproducibility snapshot. Contains the
  original queried geometries/tags and version/timestamp, but omits contributor
  account details and unused node IDs. It is a normalized Overpass extract, not
  the original HTTP response. Full boundary-crossing source objects extend
  outside the requested box; only the renderable extract is strictly clipped.
- `metadata.json`: source query/date, SHA-256 checksums, counts and explicit
  statement that no elevation is supplied.

Bounding box `[west, south, east, north]`:
`[140.356, 37.346, 140.407, 37.387]`, approximately 4.5 × 4.5 km.

The extracted features contain 22,769 building polygons, 2,222 road ways,
158 railway ways, 38 waterway ways, 5 water areas and one university campus.
62 road/rail ways have bridge tags; **these are segments, not 62 distinct
bridges**. Bridges retain their road/rail kind and `bridge` / `bridge:name`
properties. One queried building only touched the boundary and has no area
inside it, so it is excluded. No invalid/unclosed areas were skipped.

## Reproduce without network

Node.js 22+ and polygon-clipping 0.15.7 are used. The small preprocessing
dependency is isolated outside the application; no application dependency or
lockfile changes are necessary. From the repository root:

```sh
npm install --prefix /tmp/civilcraft-geodata-tools --no-package-lock --ignore-scripts polygon-clipping@0.15.7
node apps/web/scripts/fetch-koriyama-geodata.mjs --clipper /tmp/civilcraft-geodata-tools/node_modules/polygon-clipping
pnpm --filter @civilcraft/web exec vitest run src/components/GameCanvas/koriyamaGeodata.test.ts
```

Once that dependency exists, regeneration uses only the checked-in compressed
snapshot. Output order, coordinate rounding (7 decimals), clipping and hashes
are deterministic. To intentionally replace the snapshot with current OSM:

```sh
node apps/web/scripts/fetch-koriyama-geodata.mjs --clipper /tmp/civilcraft-geodata-tools/node_modules/polygon-clipping --refresh
```

`--source /path/to/overpass-response.json` packages an already downloaded response
to the **exact metadata query**. Do not pass a response to a different query.
The fetcher limits HTTP response bytes to 32 MiB and does not fetch a city ZIP.
The successful original response was approximately 20 MB. Refresh may change
counts, geometry and hashes; update this descriptive summary when refreshing.

## Three.js integration

Import types/helpers from
`src/components/GameCanvas/koriyamaGeodata.ts` and fetch
`KORIYAMA_GEODATA_URL` (`/geodata/koriyama/features.geojson`) once, outside the
animation loop. `toLocalGeodataFeature(feature)` preserves feature identity,
tags, polygon holes and multipart lines. Coordinates match `dioramaSpace`:
origin **140.3837°E, 37.3655°N**, east +X, north −Z, metres. This is the same
local equirectangular approximation as the game, not a survey projection.

For `MultiPolygon`, each polygon contains its outer ring followed by hole rings;
pass holes to Three.Shape rather than filling islands/courtyards. Building
placement and orientation should come from the actual rings. Do not replace
them with random houses or rotate the map geometry to match a reference image.
Cull by camera/visible bounds and batch the 22k building features for mobile.

All OSM adapter points have **Y=0**, an arbitrary display datum. **There is no DEM**,
terrain model, embankment profile, bridge deck elevation or measured height
field. `taggedHeightMeters` returns null for unknown heights; all buildings in
the OSM snapshot lack a height tag. Its local adapter's `provenance` contains
`positionSource`, source ID/version/timestamp, `heightMeters`, `heightSource`
(`unknown` or `osm-height-tag-unverified`) and `elevationSource: none`.
`building:levels` is retained as a raw tag, never converted to measured metres.
Any invented extrusion height, road width, bridge
clearance, roof, material or flat terrain chosen by a renderer must be labeled
as visual approximation. `layer` is ordering information, not metres.

`isGeodataBridge` selects genuine mapped bridge segments, including rail
viaducts. Widths, names and layers are available only when tagged. Keep tunnel
and railway lifecycle tags in mind when rendering. Do not infer untagged bridges
from mere screen overlap. Multipolygon processing preserves holes, but all nine
inner rings in the queried river relation fall **outside** this bounding box,
so the clipped river has no interior rings. Waterway centerlines
are a separate layer and should not become fabricated constant-width banks.

## Coverage and validation limits

OSM is community-maintained and can be incomplete or stale. Not every polygon
is a house (`building=yes` is unspecified), and not all buildings, water banks,
bridges or construction changes are guaranteed mapped. Water and building
multipolygons are supported; route relations, coastline processing, land use,
trees, POI nodes, building parts and non-water/non-building relations are not
queried. The snapshot covers this box only. Clipping inserts mathematical
boundary intersections; it does not infer missing real-world geometry.

The existing `fetch-plateau-buildings.mjs` was inspected first. Its 2020 Koriyama
ZIP (~390 MB) and extracted tileset were present in the original checkout only
as macOS `dataless` cloud placeholders; reading the tileset failed. No full ZIP
was downloaded or restored. The OSM files must not be attributed to PLATEAU.
The subsequent bounded official LOD1 extraction below is a separate source.

Tests verify named landmarks, bounded finite coordinates, closed polygon rings,
hole-preserving adapter behavior, source checksum, unique IDs, unknown-height behavior and
alignment with the existing game coordinate adapter. They do not establish
survey accuracy or mobile rendering performance. Integrating into
`DioramaGameMap`/`dioramaWorld` is intentionally outside this data-only change.

## PLATEAU actual buildings and height provenance

`plateau-buildings.geojson` supplies **9,561** buildings with real model-derived
footprints and source height attributes in the smaller core bounding box
`[140.370, 37.351, 140.398, 37.379]`. All 9,561 have a positive
`bldg:measuredHeight`. **185** source building centers fall within the OSM campus
polygon (a spatial inclusion check, not verification of every building's
institutional ownership or name). That subset's source measured-height values
range from 2.5 to 43.6 m. It includes school-area footprints even when `name`
is absent or `usage` is unspecified. Do not invent individual school names.

Source: [3D都市モデル（Project PLATEAU）郡山市（2020年度）](https://www.geospatial.jp/ckan/dataset/plateau-07203-koriyama-shi-2020),
official LOD1 endpoint resolved from
`https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/07203-bldg-lod1-latest/tileset.json`.
The extractor pins the resolved CityGML-v9 distribution URL rather than silently
following `latest` on future runs. Source capture date is **2026-09-20**;
building-level survey years and creation dates are retained. This is a 2020
dataset, not a claim of 2026 on-site accuracy.

The CKAN API returns license ID `plateau`, with the
[PLATEAU site policy](https://www.mlit.go.jp/plateau/site-policy/) as its license
URL. That policy permits reuse under **CC BY 4.0**, which is selected for these
separate PLATEAU files. Display **3D都市モデル（Project PLATEAU）郡山市（2020年度）を加工して作成**
with the dataset link. These data files are not MIT-licensed application code.
`plateau-metadata.json` records the policy, exact tile URLs, hashes and counts.

The extractor selects only intersecting **leaf** tiles, so simplified ancestor
tiles cannot duplicate buildings. The 36 source B3DM files total **87,145,036
bytes** (about 83.1 MiB), plus a small tileset/catalog. A 100 MiB download budget
is enforced. Original tiles remain in ignored
`apps/web/.cache/koriyama-geodata-plateau`; they are not checked in. No full-city
ZIP is fetched. The two renderable GeoJSON files compress to approximately
1.2 MB each under gzip; use HTTP compression for mobile delivery.

```sh
npm install --prefix /tmp/civilcraft-geodata-tools --no-package-lock --ignore-scripts polygon-clipping@0.15.7 draco3d@1.5.7
node apps/web/scripts/fetch-koriyama-plateau-geodata.mjs --tools /tmp/civilcraft-geodata-tools/node_modules
pnpm --filter @civilcraft/web exec vitest run src/components/GameCanvas/koriyamaGeodata.test.ts src/components/GameCanvas/koriyamaPlateauGeodata.test.ts
```

The first run fetches these bounded tiles; reruns use the local cache without
network downloads. To verify reproduction, compare `dataSha256` and each
`tileSources[].sha256` with the checked-in manifest. If a publisher removes or
replaces a URL, a clean network re-extraction may no longer reproduce the
snapshot; retain the local tile cache if long-term offline extraction matters.
No alternate geometry or random building fallback is used on fetch/parse errors.

Draco mesh vertices are converted from glTF Y-up through ECEF RTC into WGS84.
Each decoded position is checked against its source building's geographic
bounds (2e-5 degree tolerance). Planar union of projected roof/base triangles
retains concave footprints; coordinates are snapped to 1e-7 degrees before
union (roughly centimetre quantization, **not** centimetre source accuracy).
Tiny projected wall triangles under roughly 0.01 m² are omitted. Footprints
are derived from the LOD1 mesh, not original surveyed cadastral outlines.

For integration, import from `koriyamaPlateauGeodata.ts`:

- `KORIYAMA_PLATEAU_URL`: `/geodata/koriyama/plateau-buildings.geojson`
- `KoriyamaPlateauGeodata`, `PlateauBuilding`, `LocalPlateauBuilding`: typed data
- `toLocalPlateauBuilding(feature)`: actual rings in existing local X/Z metres;
  preserves all source properties, uses **Y=0** as an explicitly flat datum
- `KORIYAMA_PLATEAU_ATTRIBUTION`: text and dataset link

Height fields deliberately distinguish two source quantities:

- `heightMeters` / `heightSource`: source `bldg:measuredHeight` attribute; never
  calculated from OSM levels or an arbitrary floor height. `heightMethod`
  identifies that attribute without asserting a separately undocumented survey
  method. A field named measuredHeight is not proof of exact current roof height.
- `modelHeightMeters` / `modelHeightSource`: source `_zmax - _zmin`, the vertical
  extent of the LOD1 model. `modelHeightMethod` retains `uro:lod1HeightType`:
  9,076 point-cloud median and 485 aerial-photogrammetry maximum-height records.
  **Use this field to reproduce LOD1 extrusion height.** It can differ materially
  from `heightMeters`; retain both rather than treating them as interchangeable.
- `sourceZMin` / `sourceZMax`: source building vertical bounds, preserved without
  claiming a verified vertical datum. They are **not terrain elevations**. The
  adapter does not align them to the old stylized banks.

Use PLATEAU buildings as the core building layer. Do not stack OSM buildings over
them or assign heights by arbitrary nearest-neighbor matching. OSM is a separate
fallback outside this core, with unknown heights. Rail/road/bridge XY geometry
comes from OSM; **rail elevation, bridge deck height, train dimensions and current
train positions/timetables are not provided**. A later train animation may
follow the real rail polylines but is not a real-time service depiction.
