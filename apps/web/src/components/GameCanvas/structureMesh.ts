import type { StructureModelPart } from "./structureModels";

const cache = new Map<string, string>();

/** A small, cached glTF retains actual slopes/open basins and lets Cesium update only its pose. */
export function structureMeshUri(part: StructureModelPart, rgba: number[]): string {
  if (!part.mesh) throw new Error("Missing structure mesh");
  const key = JSON.stringify([part.mesh, rgba]);
  const cached = cache.get(key);
  if (cached) return cached;
  const { positions, indices } = part.mesh;
  const vertices: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.slice(i, i + 3).map((index) => positions[index]!);
    const u = b!.map((v, j) => v - a![j]!);
    const v = c!.map((n, j) => n - a![j]!);
    const n = [
      u[1]! * v[2]! - u[2]! * v[1]!,
      u[2]! * v[0]! - u[0]! * v[2]!,
      u[0]! * v[1]! - u[1]! * v[0]!,
    ];
    const length = Math.hypot(...n) || 1;
    for (const p of [a!, b!, c!]) {
      vertices.push(...p);
      normals.push(...n.map((value) => value / length));
    }
  }
  const bytes = new Uint8Array(new Float32Array([...vertices, ...normals]).buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const count = vertices.length / 3;
  const min = [0, 1, 2].map((axis) => Math.min(...positions.map((p) => p[axis]!)));
  const max = [0, 1, 2].map((axis) => Math.max(...positions.map((p) => p[axis]!)));
  const gltf = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    // Input geometry is Z-up; glTF uses Y-up. Cesium restores it to the local ENU frame.
    nodes: [{ mesh: 0, rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] }],
    buffers: [
      { byteLength: bytes.length, uri: `data:application/octet-stream;base64,${btoa(binary)}` },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: vertices.length * 4, target: 34962 },
      { buffer: 0, byteOffset: vertices.length * 4, byteLength: normals.length * 4, target: 34962 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5126, count, type: "VEC3" },
    ],
    materials: [
      {
        pbrMetallicRoughness: { baseColorFactor: rgba, metallicFactor: 0, roughnessFactor: 0.85 },
        alphaMode: rgba[3]! < 1 ? "BLEND" : "OPAQUE",
        doubleSided: true,
      },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0, mode: 4 }] }],
  };
  const uri = `data:model/gltf+json;charset=utf-8,${encodeURIComponent(JSON.stringify(gltf))}`;
  if (cache.size > 64) cache.clear();
  cache.set(key, uri);
  return uri;
}
