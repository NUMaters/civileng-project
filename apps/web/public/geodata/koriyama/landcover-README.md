# Bounded mapped landcover and tree points

Bounds: west 140.370, south 37.351, east 140.398, north 37.379.
Source: OpenStreetMap via https://overpass-api.de/api/interpreter.
Attribution: © OpenStreetMap contributors; ODbL-1.0.
License: https://www.openstreetmap.org/copyright.

`landcover.geojson` stores clipped MultiPolygons and original mapped tree Points.
`landcover-metadata.json` records the exact query, retrieval and OSM snapshot timestamps,
counts, skipped objects, limitations, and SHA-256 of output and compressed source.
`landcover-source.osm.json.gz` is the sanitized source snapshot, not a live feed.
Contributor user names, account IDs and changesets are excluded; tags are allowlisted.

## Reproduce

Run from the repository root with Node.js 22+ and polygon-clipping 0.15.7:

```sh
npm install --prefix /tmp/civilcraft-geodata-tools --no-package-lock --ignore-scripts polygon-clipping@0.15.7
node apps/web/scripts/fetch-koriyama-landcover.mjs --clipper /tmp/civilcraft-geodata-tools/node_modules/polygon-clipping
```

The default replays the committed snapshot without network access, retaining its timestamps.
Append `--refresh` to explicitly fetch a new bounded snapshot (45-second server query,
60-second client timeout, 16 MiB response limit). `--source /path/to/overpass.json`
imports a raw response for the same query, sanitizing it before persistence.

## Geometry and evidence boundaries

Original coordinates are not simplified or rounded. Polygon clipping inserts only
bounding-box intersection coordinates. Split/reversed relation members are stitched;
inner rings are assigned to their containing outer ring, preserving holes and islands.
Malformed/unclosed or nested unsupported relations are reported in metadata, never
closed with an invented edge. Successfully represented same-category member ways
are omitted to avoid duplicate relation/member geometry.

This snapshot contains 281 features: 234 mapped trees, 12 pitches, 20 parks,
14 landuse=grass areas and 1 natural=grassland area. No holes or skipped objects
occurred in this response; absence of forest/scrub/meadow/farmland/orchard/garden
features is absence of matching mapped data, not proof those landcovers do not exist.

Only tree points are evidence for individual mapped tree positions. Never scatter
trees inside park polygons and present those positions as surveyed. Park and sports
centre boundaries can include buildings and paving; pitches may have artificial/bare
surfaces. Preserve source category and surface tags. Overlapping categories remain
overlapping, not a complete exclusive partition. Tree dimensions and species tags
are unverified; there is no canopy model or elevation in this dataset.

An Overpass bbox may miss an enclosing polygon whose boundary has no matching bbox
nodes. Mapping completeness, survey dates, and current real-world condition are unknown.
Local conversion uses the existing Koriyama origin, east +X / north -Z in metres;
Y=0 is merely the local datum. Terrain must come from a separate elevation source.

## Imagery canopy envelopes

`imagery-canopy-observations.json` also contains three additional conservative
riverbank-side canopy-core envelopes. They were visually interpreted from the
GSI `seamlessphoto` view at
https://maps.gsi.go.jp/#18/37.360206/140.378269/&ls=seamlessphoto&disp=1&vs=c1g1j0h0k0l0u0t0z0r0s0m0f1.
The reference tile is z18/x233294/y101705, with its top-left at screen pixel
(1066, 367) and 256 px tile size; the displayed layer period was 2022-07 to
2022-09. The three envelopes are inferred screen-polygons for the south,
middle, and north bank-side cores after subtracting that tile origin. They
exclude broad grass and dark river shadows and are not surveyed boundaries or
individual-tree observations. The displayed period is a view label; the
acquisition date for each patch is unverified. The original four campus patch
records and their existing source URL remain unchanged.

### Riverbank detail prototype (illustrative, not a new observation)

Only `riverbank-middle-canopy-core` and `riverbank-north-canopy-core` opt into
`illustrativeProfile: riverbank-detail-v1`: 4.5 m deterministic sampling spacing
and 1.8–2.6 m crown clearance radii, instead of the default 6 m / 2.3–3.5 m.
This is an artistic resolution choice inside the existing narrow envelopes,
not a measured tree size, density, species, height, or individual-tree inventory.
The decorative rounded-crown reference image supplies style guidance only;
geographic evidence remains the GSI view linked above. No polygons or source
coordinates changed. Height range remains illustrative 6–9 m. Explicit renderer
options override profiles for reproducible baseline comparisons.

Radius-only trials were insufficient: retaining the 6 m lattice with 1.8–2.6 m
radii increased the three-core count from 8 to 13 but plan coverage only 1.2%.
The finer profile was also tested in the south core, where coverage fell 7.6%;
that core retains its original profile and exact generated records. The four
campus patches and individual imagery-tree observations/renderer remain unchanged.

The actual-data regression compares default vs opt-in profiles with the bundled
DEM and building/road/rail/water/OSM-tree exclusions, plus all 34 explicit imagery
crowns (including the seven withheld individuals). Whole circular crowns still
must fit the polygon including holes, clear every exclusion and accepted crown,
and have valid DEM at their centre and eight edge points. The single-pass lattice
has no relocation, retry filling, boundary expansion or changed generation caps.

Plan footprint is computed from the actual crown mesh's horizontal triangle
projections, summed only for disjoint accepted crowns. It is a rendered coverage
metric, NOT a survey of foliage, 3D leaf surface area or continuous woodland:

- South: 79.51 → 79.51 m² in a 402.88 m² envelope (unchanged).
- Middle: 53.30 → 80.07 m² in a 459.03 m² envelope.
- North: 39.30 → 66.04 m² in a 313.17 m² envelope.
- Combined: 172.11 → 225.62 m², about 14.65% → 19.20% of the three envelopes.

Canopy-only budgets: 66 → 73 rendered crowns (riverbank 8 → 15; campus 58 fixed),
409 → 448 evaluated cells, 594 → 657 DEM samples, 25,344 → 28,032 instanced
triangles, and 9,240 → 10,220 bytes of instance matrix/color arrays. Tests cap
the result at ten mesh batches (baseline eight); these are resource/work counts,
not device frame-time measurements. The separately rendered 27 imagery trees are
unchanged (combined illustrative/imagery tree count 93 → 100, excluding OSM trees).
Visual acceptance and mobile frame-time comparison remain with the main reviewer;
more instances alone are not acceptance evidence.
