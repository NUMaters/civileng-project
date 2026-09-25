/** Bounded OSM vegetation/landcover snapshot. Offline replay is the default; --refresh opts into network. */
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";

export const bounds = [140.370, 37.351, 140.398, 37.379];
export const endpoint = "https://overpass-api.de/api/interpreter";
const bbox = [bounds[1], bounds[0], bounds[3], bounds[2]].join(",");
const selections = ['[landuse~"^(grass|forest|meadow|recreation_ground|farmland|orchard|allotments)$"]',
  '[natural~"^(wood|scrub|grassland)$"]', '[leisure~"^(park|garden|pitch|sports_centre)$"]'];
export const query = `[out:json][timeout:45];(${selections.flatMap((s) => [`way${s}(${bbox});`, `relation[type=multipolygon]${s}(${bbox});`]).join("")}node[natural=tree](${bbox}););out meta geom;`;
const keepTags = ["name", "name:ja", "type", "landuse", "natural", "leisure", "sport", "surface", "source", "source:date",
  "leaf_type", "leaf_cycle", "species", "species:ja", "genus", "height", "circumference", "denotation", "access", "fixme"];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (a, b) => a?.[0] === b?.[0] && a?.[1] === b?.[1];
const points = (geometry) => (geometry ?? []).map(({ lon, lat }) => {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error("missing-source-coordinate");
  return [lon, lat];
});
export function sanitizeSnapshot(raw, fetchedAt = new Date().toISOString()) {
  if (raw.remark || !Array.isArray(raw.elements) || !raw.osm3s?.timestamp_osm_base) throw new Error(`Incomplete Overpass response: ${raw.remark ?? "missing elements/timestamp"}`);
  return { query, endpoint, fetchedAt, timestamp: raw.osm3s.timestamp_osm_base,
    elements: raw.elements.map(({ type, id, version, timestamp, tags = {}, lon, lat, geometry, members }) => ({
      type, id, version, timestamp,
      tags: Object.fromEntries(keepTags.filter((k) => tags[k] !== undefined).map((k) => [k, tags[k]])),
      ...(type === "node" ? { lon, lat } : {}),
      ...(geometry ? { geometry: geometry.map(({ lon, lat }) => ({ lon, lat })) } : {}),
      ...(members ? { members: members.map(({ type, ref, role, geometry }) => ({ type, ref, role,
        ...(geometry ? { geometry: geometry.map(({ lon, lat }) => ({ lon, lat })) } : {}) })) } : {}),
    })) };
}
function stitch(members, role) {
  const pending = members.filter((m) => m.type === "way" && (m.role || "outer") === role).map((m) => points(m.geometry));
  if (pending.some((p) => p.length < 2)) throw new Error("missing-relation-member-geometry");
  const rings = [];
  while (pending.length) {
    const ring = pending.shift();
    while (!same(ring[0], ring.at(-1))) {
      const i = pending.findIndex((p) => same(ring.at(-1), p[0]) || same(ring.at(-1), p.at(-1)));
      if (i < 0) throw new Error("unclosed-relation-ring");
      const next = pending.splice(i, 1)[0];
      if (!same(ring.at(-1), next[0])) next.reverse();
      ring.push(...next.slice(1));
    }
    if (ring.length < 4) throw new Error("short-relation-ring");
    rings.push(ring);
  }
  return rings;
}
function contains(ring, p) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
const area = (ring) => Math.abs(ring.slice(1).reduce((sum, p, i) => sum + ring[i][0] * p[1] - p[0] * ring[i][1], 0));
function category(tags) {
  if (tags.natural === "tree") return "tree";
  if (["grass", "forest", "meadow", "recreation_ground", "farmland", "orchard", "allotments"].includes(tags.landuse)) return `landuse:${tags.landuse}`;
  if (["wood", "scrub", "grassland"].includes(tags.natural)) return `natural:${tags.natural}`;
  if (["park", "garden", "pitch", "sports_centre"].includes(tags.leisure)) return `leisure:${tags.leisure}`;
  return null;
}
export function convertLandcover(source, clipper) {
  const box = [[[bounds[0], bounds[1]], [bounds[2], bounds[1]], [bounds[2], bounds[3]], [bounds[0], bounds[3]], [bounds[0], bounds[1]]]];
  const features = [], skipped = [], duplicates = new Set();
  // Relations first: suppress member-way duplicates only after successful relation conversion.
  const ordered = [...source.elements].sort((a, b) => Number(b.type === "relation") - Number(a.type === "relation"));
  for (const e of ordered) {
    const tags = e.tags ?? {}, kind = category(tags), id = `${e.type}/${e.id}`;
    if (!kind || (e.type === "way" && duplicates.has(`${kind}:${e.id}`))) continue;
    try {
      let geometry;
      if (kind === "tree") {
        if (e.type !== "node" || !Number.isFinite(e.lon) || !Number.isFinite(e.lat)) throw new Error("invalid-tree-point");
        if (e.lon < bounds[0] || e.lon > bounds[2] || e.lat < bounds[1] || e.lat > bounds[3]) continue;
        geometry = { type: "Point", coordinates: [e.lon, e.lat] };
      } else {
        let polygons;
        if (e.type === "relation") {
          if ((e.members ?? []).some((m) => m.type === "relation")) throw new Error("nested-relation-unsupported");
          const outers = stitch(e.members ?? [], "outer"), inners = stitch(e.members ?? [], "inner");
          if (!outers.length) throw new Error("no-relation-outer");
          polygons = outers.map((r) => [r]);
          for (const hole of inners) {
            const owners = outers.map((ring, i) => ({ i, ring })).filter(({ ring }) => contains(ring, hole[0])).sort((a, b) => area(a.ring) - area(b.ring));
            if (!owners.length) throw new Error("orphan-relation-inner");
            polygons[owners[0].i].push(hole);
          }
          polygons = clipper.union(...polygons);
        } else {
          const ring = points(e.geometry);
          if (ring.length < 4 || !same(ring[0], ring.at(-1))) throw new Error("unclosed-area");
          polygons = [[ring]];
        }
        const clipped = clipper.intersection(polygons, box);
        if (!clipped.length) continue;
        geometry = { type: "MultiPolygon", coordinates: clipped };
      }
      features.push({ type: "Feature", id, properties: { kind: kind === "tree" ? "tree" : "landcover", category: kind,
        version: e.version, timestamp: e.timestamp, ...tags }, geometry });
      if (e.type === "relation") for (const m of e.members ?? []) if (m.type === "way") duplicates.add(`${kind}:${m.ref}`);
    } catch (error) { skipped.push({ id, reason: error.message }); }
  }
  features.sort((a, b) => a.id.localeCompare(b.id, "en"));
  return { collection: { type: "FeatureCollection", bbox: bounds, features }, skipped };
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  if (!option("--clipper")) throw new Error("Pass --clipper /path/to/node_modules/polygon-clipping (0.15.7)");
  const require = createRequire(import.meta.url), clipperPath = resolve(option("--clipper"));
  if (require(resolve(clipperPath, "package.json")).version !== "0.15.7") throw new Error("Expected polygon-clipping 0.15.7");
  const clipper = require(clipperPath);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../public/geodata/koriyama");
  const sourcePath = resolve(root, "landcover-source.osm.json.gz"), maxBytes = 16 * 1024 * 1024;
  let source;
  if (args.includes("--refresh") || option("--source")) {
    let bytes;
    if (option("--source")) bytes = await readFile(option("--source"));
    else {
      const response = await fetch(endpoint, { method: "POST", headers: { "User-Agent": "CivilCraft-Landcover/1.0" },
        body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
      const chunks = []; let length = 0;
      for await (const chunk of response.body) { length += chunk.length; if (length > maxBytes) throw new Error("Response exceeds 16 MiB"); chunks.push(chunk); }
      bytes = Buffer.concat(chunks);
    }
    if (bytes.length > maxBytes) throw new Error("Source exceeds 16 MiB");
    source = sanitizeSnapshot(JSON.parse(bytes));
  } else source = JSON.parse(gunzipSync(await readFile(sourcePath), { maxOutputLength: maxBytes }));
  if (source.query !== query) throw new Error("Snapshot query differs; use --refresh explicitly");
  const { collection, skipped } = convertLandcover(source, clipper);
  const json = JSON.stringify(collection) + "\n", sourceBytes = gzipSync(JSON.stringify(source), { level: 9 });
  const counts = {};
  for (const f of collection.features) counts[f.properties.category] = (counts[f.properties.category] ?? 0) + 1;
  const metadata = { schemaVersion: 1, bounds, origin: { longitude: 140.3837, latitude: 37.3655 },
    source: "OpenStreetMap", query, endpoint, fetchedAt: source.fetchedAt, osmTimestamp: source.timestamp,
    license: "ODbL-1.0", attribution: "© OpenStreetMap contributors", licenseUrl: "https://www.openstreetmap.org/copyright",
    conversion: "polygon-clipping 0.15.7; exact source coordinates except inserted bounding-box intersections; relation holes retained",
    privacy: "Contributor user/uid/changeset omitted; tags allowlisted; no contributor accounts in snapshot",
    counts, features: collection.features.length, polygonFeatures: collection.features.filter((f) => f.geometry.type === "MultiPolygon").length,
    mappedTreePoints: collection.features.filter((f) => f.geometry.type === "Point").length,
    holes: collection.features.reduce((n, f) => n + (f.geometry.type === "MultiPolygon" ? f.geometry.coordinates.reduce((s, p) => s + p.length - 1, 0) : 0), 0),
    skipped, dataSha256: hash(json), sourceSha256: hash(sourceBytes),
    limitations: ["OSM mapping completeness and survey dates unknown; no invented tree points", "Park/sports_centre polygons are facility extents, not proof of continuous vegetation", "Pitch surfaces may be artificial or bare; preserve surface/sport tags", "No canopy geometry or verified tree height; tags unverified", "Overlapping categories retained, not a mutually exclusive landcover partition", "BBox selects ways with nodes and related members; enclosing polygons with no matching bbox nodes may be absent", "No DEM or elevations"] };
  await mkdir(root, { recursive: true });
  await writeFile(sourcePath, sourceBytes);
  await writeFile(resolve(root, "landcover.geojson"), json);
  await writeFile(resolve(root, "landcover-metadata.json"), JSON.stringify(metadata, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ counts, features: metadata.features, holes: metadata.holes, skipped, bytes: Buffer.byteLength(json) }) + "\n");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
