/** Extract bounded actual LOD1 footprints and height evidence, never the full-city ZIP. */
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Cartesian3, Cartographic, Math as CesiumMath } from "cesium";

const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
if (!args.includes("--tools"))
  throw new Error("Pass --tools /tmp/civilcraft-geodata-tools/node_modules");
const require = createRequire(import.meta.url);
const clipping = require(resolve(option("--tools"), "polygon-clipping"));
const draco = await require(resolve(option("--tools"), "draco3d")).createDecoderModule();
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cache = resolve(webRoot, ".cache/koriyama-geodata-plateau");
const out = resolve(webRoot, "public/geodata/koriyama");
await mkdir(cache, { recursive: true });
await mkdir(out, { recursive: true });
const bounds = [140.37, 37.351, 140.398, 37.379];
const box = [
  [
    [bounds[0], bounds[1]],
    [bounds[2], bounds[1]],
    [bounds[2], bounds[3]],
    [bounds[0], bounds[3]],
    [bounds[0], bounds[1]],
  ],
];
const rootUrl =
  "https://assets.cms.plateau.reearth.io/assets/f0/d3db95-842d-45d8-8548-47d684c5a554/07203_koriyama-shi_city_2020_citygml_9_op_bldg_3dtiles_lod1/tileset.json";
const catalogUrl =
  "https://www.geospatial.jp/ckan/api/3/action/package_show?id=plateau-07203-koriyama-shi-2020";
const budget = 100 * 1024 * 1024;
let downloaded = 0;
const hash = (data) => createHash("sha256").update(data).digest("hex");
async function load(url, file) {
  const path = resolve(cache, file);
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const chunks = [];
  for await (const chunk of response.body) {
    downloaded += chunk.length;
    if (downloaded > budget) throw new Error("100 MiB download budget exceeded");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  await writeFile(path, bytes);
  return bytes;
}
const rootBytes = await load(rootUrl, "tileset.json");
const root = JSON.parse(rootBytes);
const catalogBytes = await load(catalogUrl, "catalog.json");
const catalog = JSON.parse(catalogBytes).result;
if (!catalog?.license_id) throw new Error("Dataset license unavailable");
const intersects = (r) =>
  r[2] >= bounds[0] && r[0] <= bounds[2] && r[3] >= bounds[1] && r[1] <= bounds[3];
const selected = [];
function visit(node) {
  if (!node.boundingVolume?.region) throw new Error("Unsupported non-region tile bounds");
  if (!intersects(node.boundingVolume.region.slice(0, 4).map(CesiumMath.toDegrees))) return;
  if (node.children?.length) {
    node.children.forEach(visit);
    return;
  }
  if (node.content) selected.push(node.content.uri);
}
visit(root.root);
const features = new Map();
const tileSources = [];
const readTypes = {
  BYTE: [1, "readInt8"],
  UNSIGNED_BYTE: [1, "readUInt8"],
  SHORT: [2, "readInt16LE"],
  UNSIGNED_SHORT: [2, "readUInt16LE"],
  INT: [4, "readInt32LE"],
  UNSIGNED_INT: [4, "readUInt32LE"],
  FLOAT: [4, "readFloatLE"],
  DOUBLE: [8, "readDoubleLE"],
};
function batchValue(table, binary, key, index) {
  const field = table[key];
  if (Array.isArray(field)) return field[index];
  if (field && typeof field === "object" && "byteOffset" in field) {
    const type = readTypes[field.componentType];
    if (!type || field.type !== "SCALAR") throw new Error(`Unsupported batch accessor: ${key}`);
    return binary[type[1]](field.byteOffset + index * type[0]);
  }
  return null;
}
function decodeTile(bytes, uri) {
  if (bytes.toString("ascii", 0, 4) !== "b3dm") throw new Error(`Not b3dm: ${uri}`);
  const [fj, fb, bj, bb] = [12, 16, 20, 24].map((offset) => bytes.readUInt32LE(offset));
  const featureTable = JSON.parse(bytes.subarray(28, 28 + fj));
  if (featureTable.RTC_CENTER) throw new Error("Unexpected b3dm RTC_CENTER");
  const batchStart = 28 + fj + fb;
  const table = JSON.parse(bytes.subarray(batchStart, batchStart + bj));
  const binary = bytes.subarray(batchStart + bj, batchStart + bj + bb);
  const value = (key, i) => batchValue(table, binary, key, i);
  const glbStart = batchStart + bj + bb;
  const jsonLength = bytes.readUInt32LE(glbStart + 12);
  const gltf = JSON.parse(bytes.subarray(glbStart + 20, glbStart + 20 + jsonLength));
  if (gltf.nodes.some((n) => n.matrix || n.translation || n.rotation || n.scale))
    throw new Error("Unexpected node transform");
  const center = gltf.extensions?.CESIUM_RTC?.center;
  if (!center) throw new Error("Missing CESIUM_RTC");
  const glbBinary = bytes.subarray(glbStart + 20 + jsonLength + 8);
  const triangles = new Map();
  const candidates = new Set();
  for (let i = 0; i < featureTable.BATCH_LENGTH; i++) {
    if (intersects([value("_xmin", i), value("_ymin", i), value("_xmax", i), value("_ymax", i)]))
      candidates.add(i);
  }
  for (const meshData of gltf.meshes)
    for (const primitive of meshData.primitives) {
      const compression = primitive.extensions?.KHR_draco_mesh_compression;
      if (!compression || primitive.mode !== 4) throw new Error("Expected Draco triangle mesh");
      const view = gltf.bufferViews[compression.bufferView];
      const raw = glbBinary.subarray(
        view.byteOffset ?? 0,
        (view.byteOffset ?? 0) + view.byteLength,
      );
      const decoder = new draco.Decoder(),
        buffer = new draco.DecoderBuffer(),
        mesh = new draco.Mesh();
      const positions = new draco.DracoFloat32Array(),
        ids = new draco.DracoFloat32Array(),
        face = new draco.DracoInt32Array();
      try {
        buffer.Init(new Int8Array(raw), raw.length);
        if (!decoder.DecodeBufferToMesh(buffer, mesh).ok()) throw new Error("Draco decode failed");
        decoder.GetAttributeFloatForAllPoints(
          mesh,
          decoder.GetAttributeByUniqueId(mesh, compression.attributes.POSITION),
          positions,
        );
        decoder.GetAttributeFloatForAllPoints(
          mesh,
          decoder.GetAttributeByUniqueId(mesh, compression.attributes._BATCHID),
          ids,
        );
        const geos = new Map();
        function geo(index) {
          if (geos.has(index)) return geos.get(index);
          // glTF Y-up -> 3D Tiles Z-up, then CESIUM_RTC ECEF translation.
          const point = Cartographic.fromCartesian(
            new Cartesian3(
              center[0] + positions.GetValue(index * 3),
              center[1] - positions.GetValue(index * 3 + 2),
              center[2] + positions.GetValue(index * 3 + 1),
            ),
          );
          // Snap to ~1 cm before planar union to avoid floating-point sliver rings.
          const result = [
            CesiumMath.toDegrees(point.longitude),
            CesiumMath.toDegrees(point.latitude),
          ].map((coordinate) => Math.round(coordinate * 1e7) / 1e7);
          const batch = ids.GetValue(index),
            tolerance = 0.00002;
          if (
            result[0] < value("_xmin", batch) - tolerance ||
            result[0] > value("_xmax", batch) + tolerance ||
            result[1] < value("_ymin", batch) - tolerance ||
            result[1] > value("_ymax", batch) + tolerance
          ) {
            throw new Error("Decoded coordinate disagrees with source building bounds");
          }
          geos.set(index, result);
          return result;
        }
        for (let f = 0; f < mesh.num_faces(); f++) {
          decoder.GetFaceFromMesh(mesh, f, face);
          const indices = [face.GetValue(0), face.GetValue(1), face.GetValue(2)];
          const batch = ids.GetValue(indices[0]);
          if (!candidates.has(batch)) continue;
          if (indices.some((i) => ids.GetValue(i) !== batch))
            throw new Error("Triangle crosses building IDs");
          const [a, b, c] = indices.map(geo);
          const area =
            Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) * 0.5;
          // Ignore projected vertical walls (<~0.01 m²); union roof/base faces, preserving concavity.
          if (area < 1e-12) continue;
          if (!triangles.has(batch)) triangles.set(batch, []);
          triangles.get(batch).push([[a, b, c, a]]);
        }
      } finally {
        [face, ids, positions, mesh, buffer, decoder].forEach((object) => draco.destroy(object));
      }
    }
  for (const [i, faces] of triangles) {
    const geometry = clipping.intersection(clipping.union(...faces), box);
    if (!geometry.length) continue;
    const id = value("gml_id", i);
    if (!id) throw new Error("Missing source building ID");
    const height = value("bldg:measuredHeight", i);
    const properties = {
      kind: "building",
      source: "PLATEAU",
      datasetYear: 2020,
      tile: uri,
      buildingId: value("uro:BuildingIDAttribute_uro:buildingID", i),
      name: value("gml:name", i),
      usage: value("bldg:usage", i),
      surveyYear: value("uro:BuildingDetailAttribute_uro:surveyYear", i),
      createdAt: value("core:creationDate", i),
      heightMeters: Number.isFinite(height) && height > 0 ? height : null,
      heightSource:
        Number.isFinite(height) && height > 0 ? "plateau-bldg:measuredHeight" : "unknown",
      heightMethod:
        "CityGML bldg:measuredHeight attribute; acquisition method not separately specified",
      modelHeightMeters: value("_zmax", i) - value("_zmin", i),
      modelHeightSource: "plateau-lod1-z-bounds",
      modelHeightMethod: value("uro:lod1HeightType", i),
      geometrySource: value("uro:geometrySrcDescLod1", i),
      footprintMethod: "union-of-projected-lod1-mesh-triangles",
      sourceCenter: [value("_x", i), value("_y", i)],
      sourceBounds: [value("_xmin", i), value("_ymin", i), value("_xmax", i), value("_ymax", i)],
      sourceZMin: value("_zmin", i),
      sourceZMax: value("_zmax", i),
      elevationDatum: "source _z bounds; datum not independently verified; not terrain",
    };
    if (features.has(id)) throw new Error(`Duplicate leaf building: ${id}`);
    features.set(id, {
      type: "Feature",
      id,
      properties,
      geometry: { type: "MultiPolygon", coordinates: geometry },
    });
  }
}
for (const [index, uri] of selected.entries()) {
  const url = new URL(uri, rootUrl).href;
  const bytes = await load(url, uri.replaceAll("/", "_"));
  tileSources.push({ uri, url, bytes: bytes.length, sha256: hash(bytes) });
  decodeTile(bytes, uri);
  process.stdout.write(
    `${index + 1}/${selected.length} tiles; ${features.size} buildings; ${downloaded} downloaded bytes\n`,
  );
}
const collection = {
  type: "FeatureCollection",
  bbox: bounds,
  features: [...features.values()].sort((a, b) => a.id.localeCompare(b.id, "en")),
};
const json =
  JSON.stringify(collection, (_key, value) =>
    typeof value === "number" && !Number.isInteger(value) ? Math.round(value * 1e7) / 1e7 : value,
  ) + "\n";
const methods = {};
for (const f of collection.features)
  methods[f.properties.modelHeightMethod ?? "unknown"] =
    (methods[f.properties.modelHeightMethod ?? "unknown"] ?? 0) + 1;
const metadata = {
  schemaVersion: 1,
  bounds,
  dataset: "PLATEAU Koriyama 2020 LOD1, CityGML v9 distribution",
  sourceCapturedAt: (await stat(resolve(cache, "tileset.json"))).mtime.toISOString(),
  reuseLicense: "CC-BY-4.0",
  licensePolicyUrl: "https://www.mlit.go.jp/plateau/site-policy/",
  rootUrl,
  rootSha256: hash(rootBytes),
  catalogUrl,
  catalogSha256: hash(catalogBytes),
  licenseId: catalog.license_id,
  licenseTitle: catalog.license_title,
  licenseUrl: catalog.license_url,
  attribution: "3D都市モデル（Project PLATEAU）郡山市（2020年度）を加工して作成",
  buildingCount: features.size,
  withHeightCount: collection.features.filter((f) => f.properties.heightMeters !== null).length,
  lod1HeightMethods: methods,
  tileSources,
  dataSha256: hash(json),
  elevation:
    "No DEM; source building Z bounds retained separately; adapter uses arbitrary flat datum",
  precision:
    "LOD1 representative height from source, not a surveyed exact roof or current building guarantee",
};
await writeFile(resolve(out, "plateau-buildings.geojson"), json);
await writeFile(resolve(out, "plateau-metadata.json"), JSON.stringify(metadata, null, 2) + "\n");
process.stdout.write(
  JSON.stringify({
    buildings: features.size,
    bytes: Buffer.byteLength(json),
    downloaded,
    lod1HeightMethods: methods,
  }) + "\n",
);
