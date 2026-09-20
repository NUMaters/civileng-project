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
