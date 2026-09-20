/** Bounded OSM extract. See public/geodata/koriyama/README.md for reproduction. */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../public/geodata/koriyama");
const sourcePath = resolve(root, "source.osm.json.gz");
const bounds = [140.356, 37.346, 140.407, 37.387]; // west, south, east, north
const bbox = [bounds[1], bounds[0], bounds[3], bounds[2]].join(",");
const selectors = [
  "way[building]",
  "way[highway]",
  "way[railway]",
  "way[waterway]",
  "way[natural=water]",
  "relation[type=multipolygon][natural=water]",
  "relation[type=multipolygon][building]",
  "way[amenity=university]",
];
const query = `[out:json][timeout:55];(${selectors.map((s) => `${s}(${bbox});`).join("")});out meta geom;`;
const endpoint = "https://overpass-api.de/api/interpreter";
const maxBytes = 32 * 1024 * 1024;
if (!args.includes("--clipper"))
  throw new Error("Pass --clipper /path/to/node_modules/polygon-clipping (version 0.15.7)");
const require = createRequire(import.meta.url);
const clipper = require(resolve(option("--clipper")));
const clipBox = [
  [
    [bounds[0], bounds[1]],
    [bounds[2], bounds[1]],
    [bounds[2], bounds[3]],
    [bounds[0], bounds[3]],
    [bounds[0], bounds[1]],
  ],
];
await mkdir(root, { recursive: true });

let source;
let existingSourceBytes;
if (args.includes("--refresh") || args.includes("--source")) {
  let bytes;
  if (args.includes("--source")) bytes = await readFile(option("--source"));
  else {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "User-Agent": "CivilCraft-Geodata/1.0" },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(70000),
    });
    if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > maxBytes) throw new Error("Overpass response exceeds 32 MiB budget");
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks);
  }
  if (bytes.length > maxBytes) throw new Error("Source exceeds 32 MiB budget");
  const raw = JSON.parse(bytes);
  if (raw.remark || !raw.elements?.length || !raw.osm3s?.timestamp_osm_base) {
    throw new Error(`Incomplete Overpass response: ${raw.remark ?? "missing elements/timestamp"}`);
  }
  // Drop contributor account details, retain object versions and source geometry.
  source = {
    query,
    endpoint,
    fetchedAt: new Date().toISOString(),
    timestamp: raw.osm3s.timestamp_osm_base,
    elements: raw.elements.map(({ type, id, version, timestamp, tags, geometry, members }) => ({
      type,
      id,
      version,
      timestamp,
      tags,
      geometry,
      ...(members
        ? {
            members: members.map(({ type, ref, role, geometry }) => ({
              type,
              ref,
              role,
              geometry,
            })),
          }
        : {}),
    })),
  };
} else {
  existingSourceBytes = await readFile(sourcePath);
  source = JSON.parse(gunzipSync(existingSourceBytes));
}
if (source.query !== query) throw new Error("Snapshot query differs; refresh explicitly");

const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const points = (geometry) =>
  (geometry ?? []).map(({ lon, lat }) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat))
      throw new Error("Missing source coordinate");
    return [lon, lat];
  });
function stitch(members, role) {
  const pending = members
    .filter((m) => m.type === "way" && (m.role || "outer") === role)
    .map((m) => points(m.geometry));
  const rings = [];
  while (pending.length) {
    const ring = pending.shift();
    while (!same(ring[0], ring.at(-1))) {
      const index = pending.findIndex(
        (p) => same(ring.at(-1), p[0]) || same(ring.at(-1), p.at(-1)),
      );
      if (index < 0) throw new Error("Unclosed relation ring; refusing fabricated boundary");
      const next = pending.splice(index, 1)[0];
      if (!same(ring.at(-1), next[0])) next.reverse();
      ring.push(...next.slice(1));
    }
    rings.push(ring);
  }
  return rings;
}
// Liang-Barsky: retain true line shape, inserting only exact boundary intersections.
function clipLines(line) {
  const parts = [];
  let current = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      b = line[i];
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    let low = 0,
      high = 1,
      valid = true;
    for (const [p, q] of [
      [-dx, a[0] - bounds[0]],
      [dx, bounds[2] - a[0]],
      [-dy, a[1] - bounds[1]],
      [dy, bounds[3] - a[1]],
    ]) {
      if (p === 0) {
        if (q < 0) valid = false;
        continue;
      }
      if (p < 0) low = Math.max(low, q / p);
      else high = Math.min(high, q / p);
    }
    if (!valid || low >= high) {
      if (current.length) parts.push(current);
      current = [];
      continue;
    }
    const start = [a[0] + low * dx, a[1] + low * dy];
    const end = [a[0] + high * dx, a[1] + high * dy];
    if (current.length && same(current.at(-1), start)) current.push(end);
    else {
      if (current.length) parts.push(current);
      current = [start, end];
    }
  }
  if (current.length) parts.push(current);
  return parts;
}
const kindOf = (t) =>
  t.building && t.building !== "no"
    ? "building"
    : t.highway
      ? "road"
      : t.railway
        ? "rail"
        : t.waterway
          ? "waterway"
          : t.natural === "water"
            ? "water"
            : t.amenity === "university"
              ? "campus"
              : null;
const keepTags = [
  "name",
  "name:ja",
  "building",
  "building:levels",
  "height",
  "min_height",
  "roof:height",
  "roof:shape",
  "roof:direction",
  "roof:orientation",
  "roof:angle",
  "roof:levels",
  "roof:material",
  "roof:colour",
  "highway",
  "railway",
  "waterway",
  "water",
  "bridge",
  "bridge:name",
  "tunnel",
  "layer",
  "width",
  "lanes",
  "surface",
  "source",
  "source:date",
  "amenity",
  "fixme",
];
const relationMembers = new Set(
  source.elements
    .filter((e) => e.type === "relation")
    .flatMap((e) => e.members.map((m) => `${kindOf(e.tags)}:${m.ref}`)),
);
const features = [];
const skipped = [];
for (const element of source.elements) {
  const tags = element.tags ?? {},
    kind = kindOf(tags);
  if (!kind || (element.type === "way" && relationMembers.has(`${kind}:${element.id}`))) continue;
  const id = `${element.type}/${element.id}`;
  let geometry;
  if (["building", "water", "campus"].includes(kind)) {
    let polygons;
    if (element.type === "relation") {
      const outer = stitch(element.members, "outer"),
        inner = stitch(element.members, "inner");
      polygons = clipper.union(...outer.map((ring) => [ring]));
      if (inner.length) polygons = clipper.difference(polygons, ...inner.map((ring) => [ring]));
    } else {
      const ring = points(element.geometry);
      if (ring.length < 4 || !same(ring[0], ring.at(-1))) {
        skipped.push({ id, reason: "unclosed-area" });
        continue;
      }
      polygons = [[ring]];
    }
    const clipped = clipper.intersection(polygons, clipBox);
    if (!clipped.length) continue;
    geometry = { type: "MultiPolygon", coordinates: clipped };
  } else {
    const clipped = clipLines(points(element.geometry));
    if (!clipped.length) continue;
    geometry = { type: "MultiLineString", coordinates: clipped };
  }
  features.push({
    type: "Feature",
    id,
    properties: {
      kind,
      version: element.version,
      timestamp: element.timestamp,
      ...Object.fromEntries(
        keepTags.filter((key) => tags[key] !== undefined).map((key) => [key, tags[key]]),
      ),
    },
    geometry,
  });
}
features.sort((a, b) => a.id.localeCompare(b.id, "en"));
const collection = { type: "FeatureCollection", bbox: bounds, features };
const json =
  JSON.stringify(collection, (_key, value) =>
    typeof value === "number" && !Number.isInteger(value) ? Math.round(value * 1e7) / 1e7 : value,
  ) + "\n";
const sourceBytes = existingSourceBytes ?? gzipSync(JSON.stringify(source), { level: 9 });
const counts = Object.fromEntries(
  ["building", "road", "rail", "waterway", "water", "campus"].map((kind) => [
    kind,
    features.filter((f) => f.properties.kind === kind).length,
  ]),
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const metadata = {
  schemaVersion: 1,
  bounds,
  origin: { longitude: 140.3837, latitude: 37.3655 },
  source: "OpenStreetMap",
  endpoint: source.endpoint,
  query: source.query,
  fetchedAt: source.fetchedAt,
  osmTimestamp: source.timestamp,
  license: "ODbL-1.0",
  attribution: "© OpenStreetMap contributors",
  licenseUrl: "https://www.openstreetmap.org/copyright",
  counts,
  roofShapeCounts: features.reduce((counts, feature) => {
    const shape = feature.properties["roof:shape"];
    if (shape) counts[shape] = (counts[shape] ?? 0) + 1;
    return counts;
  }, {}),
  roofHints: "OSM roof tags are source-attributed but unverified. Shape alone does not establish roof rise, ridge position/direction or pitch; never add guessed roof height to source building height.",
  bridgeSegments: features.filter((f) => f.properties.bridge && f.properties.bridge !== "no")
    .length,
  elevation: "none; all coordinates are 2D; no DEM or measured terrain",
  skipped,
  dataSha256: hash(json),
  sourceSha256: hash(sourceBytes),
};
// Offline replay never rewrites the bundled source snapshot.
if (!existingSourceBytes) await writeFile(sourcePath, sourceBytes);
await writeFile(resolve(root, "features.geojson"), json);
await writeFile(resolve(root, "metadata.json"), JSON.stringify(metadata, null, 2) + "\n");
process.stdout.write(
  JSON.stringify({
    counts,
    bytes: Buffer.byteLength(json),
    sourceBytes: sourceBytes.length,
    skipped,
  }) + "\n",
);
