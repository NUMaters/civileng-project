import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { getStructureModelParts } from "./structureModels";
import { BASIN_PORTS, PUMP_BORE_RADIUS, PUMP_PORTS } from "./facilityVisualPorts";

const COLORS = {
  grass: 0x9bd849,
  leaf: 0x49b965,
  earth: 0xc9ad76,
  stone: 0xa7afbd,
  cream: 0xfff0cf,
  blue: 0x1689e5,
  water: 0x28c7ef,
  foam: 0xc4f7ff,
  yellow: 0xffbf26,
  dark: 0x364d68,
} as const;
type Color = keyof typeof COLORS;
type Point = [number, number, number];

/**
 * Toy-scale meters: +X east, -Z north, +Y up. Origin is the footprint center
 * at ground level. Caller owns placement/heading and can dispose every mesh's
 * geometry/material by traversal: nothing is shared between returned groups.
 * Parts are baked into one opaque mesh per color (also suitable for thumbnails).
 */
export function createDioramaFacility(structureId: string): THREE.Group {
  const group = new THREE.Group();
  group.name = `diorama-facility:${structureId}`;
  group.userData.structureId = structureId;
  const sculpted = structureId === "drainage-pump" || structureId === "retention-basin";
  if (sculpted) group.userData.modelProvenance = "illustrative-player-structure; not-surveyed";
  const batches = new Map<Color, THREE.BufferGeometry[]>();
  // Per-build cache only: baked output owns its resources independently of other
  // previews/placements. Repeated windows and collars reuse construction geometry.
  const roundedBoxes = new Map<string, THREE.BufferGeometry>();
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const ball = new THREE.SphereGeometry(1, 12, 8);

  // Normalize attributes so custom prisms, tubes and rounded boxes can merge.
  function add(source: THREE.BufferGeometry, color: Color, position: Point = [0, 0, 0]) {
    const geometry = source.index ? source.toNonIndexed() : source.clone();
    for (const attribute of Object.keys(geometry.attributes)) {
      if (attribute !== "position" && attribute !== "normal") geometry.deleteAttribute(attribute);
    }
    geometry.clearGroups();
    if (!geometry.hasAttribute("normal")) geometry.computeVertexNormals();
    geometry.translate(...position);
    const batch = batches.get(color) ?? [];
    batch.push(geometry);
    batches.set(color, batch);
  }

  function box(size: Point, position: Point, color: Color, radius = 0, segments = 2) {
    if (radius) {
      const key = `${size.join(",")}/${radius}/${segments}`;
      let geometry = roundedBoxes.get(key);
      if (!geometry) {
        geometry = new RoundedBoxGeometry(...size, segments, radius);
        roundedBoxes.set(key, geometry);
      }
      add(geometry, color, position);
      return;
    }
    const geometry = cube.clone().scale(...size);
    add(geometry, color, position);
    geometry.dispose();
  }

  function sphere(size: Point, position: Point, color: Color) {
    const geometry = ball.clone().scale(...size);
    add(geometry, color, position);
    geometry.dispose();
  }

  function beam(start: Point, end: Point, width: number, depth: number, color: Color) {
    const a = new THREE.Vector3(...start);
    const b = new THREE.Vector3(...end);
    const direction = b.clone().sub(a);
    const geometry = new RoundedBoxGeometry(width, direction.length(), depth, 2, width * 0.18);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    add(geometry, color, a.add(b).multiplyScalar(0.5).toArray());
    geometry.dispose();
  }

  function tube(points: Point[], radius: number, color: Color) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    const geometry = new THREE.TubeGeometry(curve, 20, radius, 8, false);
    add(geometry, color);
    geometry.dispose();
  }

  function modelMesh(id: string, color: Color) {
    const part = getStructureModelParts(structureId).find(p => p.id === id);
    if (!part?.mesh) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(
      part.mesh.positions.flatMap(([east, north, up]) => [east, up, -north]), 3,
    ));
    geometry.setIndex(part.mesh.indices);
    add(geometry, color, [part.offsetEast ?? 0, part.centerHeight, -(part.offsetNorth ?? 0)]);
    geometry.dispose();
  }

  function tree(x: number, z: number, y: number, size = 1) {
    box([1.6 * size, 4 * size, 1.6 * size], [x, y + 2 * size, z], "earth");
    sphere([4 * size, 5 * size, 4 * size], [x, y + 7 * size, z], "leaf");
  }

  switch (structureId) {
    case "levee": {
      box([98, 2, 38], [0, 1, 0], "earth", 0.8);
      modelMesh("embankment", "grass");
      box([96, 1, 10], [0, 14.5, 0], "stone", 0.4);
      // Broad inset paving joints remain legible from the overview camera.
      for (let x = -36; x <= 36; x += 12) box([0.45, 0.1, 9.2], [x, 15.05, 0], "cream");
      break;
    }
    case "retention-basin": {
      modelMesh("berm", "grass");
      // A narrow crest inspection walk outlines the storage bowl, with a genuine
      // gap over the northern overflow. It never changes the berm or its openings.
      const walk = new THREE.Path();
      walk.moveTo(-8, 28);
      walk.lineTo(-29, 28);
      walk.quadraticCurveTo(-38, 28, -38, 19);
      walk.lineTo(-38, -19);
      walk.quadraticCurveTo(-38, -28, -29, -28);
      walk.lineTo(29, -28);
      walk.quadraticCurveTo(38, -28, 38, -19);
      walk.lineTo(38, 19);
      walk.quadraticCurveTo(38, 28, 29, 28);
      walk.lineTo(8, 28);
      const edge = walk.getPoints(5);
      const outline = new THREE.Shape([
        ...edge, ...edge.map(p => p.clone().multiplyScalar(0.965)).reverse(),
      ]);
      const paving = new THREE.ShapeGeometry(outline).rotateX(-Math.PI / 2);
      add(paving, "cream", [0, 9.025, 0]);
      paving.dispose();
      // Broad pale overflow sill distinguishes the intentional low point.
      box([BASIN_PORTS.inletHalfWidth * 2, 0.08, 7], [0, BASIN_PORTS.sillHeight + 0.04, -27.5], "cream");
      // Rounded water surface stays inside the actual open berm, below its crest.
      const pool = new THREE.Shape();
      pool.moveTo(-24, -22);
      pool.lineTo(24, -22);
      pool.quadraticCurveTo(32, -22, 32, -14);
      pool.lineTo(32, 14);
      pool.quadraticCurveTo(32, 22, 24, 22);
      pool.lineTo(-24, 22);
      pool.quadraticCurveTo(-32, 22, -32, 14);
      pool.lineTo(-32, -14);
      pool.quadraticCurveTo(-32, -22, -24, -22);
      const water = new THREE.ShapeGeometry(pool, 8).rotateX(-Math.PI / 2);
      // Opaque basin bed remains visible while the operational water is absent.
      // Without this, the underlying river is visible through an apparently full basin.
      add(water, "earth", [0, 0.2, 0]);
      water.dispose();
      // Dry field strips, not decorative standing water in the card/preview.
      for (const z of [-10, 0, 10]) box([42, 0.08, 5], [0, 0.24, z], "grass");
      // The lowered berm itself is the inlet apron; this slab is the independent
      // outlet invert. Its roof is part of the berm, leaving a genuine clear bore.
      box([BASIN_PORTS.outletOuterX - BASIN_PORTS.outletInnerX, BASIN_PORTS.outletFloor, 6],
        [38, BASIN_PORTS.outletFloor / 2, 0], "stone");
      tree(-36, -22, 8, 0.7);
      tree(35, 22, 8, 0.65);
      box([9, 6, 10], [37, 9, -2], "cream", 1.4);
      box([10, 1.4, 11], [37, 12.6, -2], "blue", 0.65);
      // Control-room glazing and raised roof crown identify the outlet works.
      box([4.8, 1.8, 0.3], [37, 10.4, -7.05], "blue", 0.14, 1);
      box([8, 0.6, 9], [37, 13.5, -2], "blue", 0.28, 1);
      break;
    }
    case "drainage-pump": {
      box([36, 2, 36], [0, 1, 0], "stone", 1);
      box([27, 14, 20], [0, 9, 5], "cream", 2);
      box([29, 1.8, 22], [0, 16.9, 5], "blue", 0.85);
      box([26, 0.65, 19], [0, 18.05, 5], "blue", 0.3, 1);
      box([15, 4, 12], [0, 19.8, 5], "cream", 1.3);
      box([17, 1.2, 14], [0, 22.4, 5], "blue", 0.5);
      box([9, 2.4, 0.4], [0, 20, -1.1], "blue", 0.15, 1);
      for (const { mouth } of PUMP_PORTS) {
        const [x, y, z] = mouth;
        box([3.8, 3.4, 0.4], [x, 12.4, -5.1], "blue", 0.15, 1);
        // Open horizontal mouth, not a jet emerging through a solid foot block.
        tube([[x, 8, -4.8], [x, 8, -8], [x, y, z + 2], mouth], 1.9, "blue");
        // Rounded annular flange, still open at the exact original mouth/bore.
        const lip = new THREE.TorusGeometry((PUMP_BORE_RADIUS + 1.9) / 2,
          (1.9 - PUMP_BORE_RADIUS) / 2, 6, 16);
        add(lip, "cream", mouth);
        lip.dispose();
        const bore = new THREE.CylinderGeometry(PUMP_BORE_RADIUS, PUMP_BORE_RADIUS, 1.5, 16, 1, true)
          .rotateX(Math.PI / 2);
        // Inward-facing lining: reverse triangles and normals without capping the hole.
        const indices = bore.index!;
        for (let i = 0; i < indices.count; i += 3) {
          const a = indices.getX(i); indices.setX(i, indices.getX(i + 1)); indices.setX(i + 1, a);
        }
        bore.computeVertexNormals();
        add(bore, "dark", [x, y, z + 0.75]);
        bore.dispose();
      }
      // Land-side sump, contained inside the existing 36x36 pad.
      box([16, 0.1, 2], [0, 2.1, 16], "dark");
      box([18, 1.4, 0.8], [0, 2.7, 17.4], "stone");
      for (const x of [-8.6, 8.6]) box([0.8, 1.4, 2.4], [x, 2.7, 16], "stone");
      // Intake bars stay on the land side, away from all three discharge jets.
      for (const x of [-6, -3, 0, 3, 6]) box([0.4, 0.25, 2], [x, 2.3, 16], "stone");
      for (const z of [10, 3]) box([0.4, 4, 4], [13.6, 11, z], "blue", 0.15, 1);
      break;
    }
    case "revetment": {
      box([80, 2, 24], [0, 1, 0], "stone", 0.8);
      box([80, 2.5, 8], [0, 3.2, -8], "grass", 0.5);
      // Staggered, bevelled stone courses give an unmistakable masonry face.
      for (let row = 0; row < 3; row++) {
        const count = row % 2 ? 9 : 8;
        for (let i = 0; i < count; i++) {
          const width = 78 / count;
          box([width - 0.45, 3.1, 7 - row], [-39 + width * (i + 0.5), 3.7 + row * 3.3, -row * 0.8], (i + row) % 3 === 0 ? "cream" : "stone", 0.4);
        }
      }
      box([80, 1.6, 6], [0, 12.7, -2], "cream", 0.5);
      for (const x of [-32, -16, 0, 16, 32]) sphere([4.2, 2.3, 3.2], [x, 3, 7], "stone");
      break;
    }
    case "channel-dredging": {
      box([78, 4, 38], [0, 2, 0], "blue", 1.8);
      box([73, 1, 34], [0, 4.5, 0], "cream", 0.45);
      for (const x of [-28, 28]) {
        for (const z of [-17, 17]) sphere([3.8, 2.2, 1.5], [x, 3, z], "dark");
      }
      for (const z of [-7, 7]) box([24, 4.5, 5], [-12, 7.2, z], "dark", 1.5);
      box([22, 5, 16], [-12, 11, 0], "yellow", 1);
      box([10, 10, 12], [-18, 18, -1], "yellow", 1);
      box([0.5, 6, 9], [-12.8, 19, -1], "blue", 0.2);
      box([7, 6, 0.5], [-18, 19, 5.1], "blue", 0.2);
      box([12, 1.5, 14], [-18, 23.7, -1], "yellow", 0.5);
      beam([-5, 13, 0], [7, 31, 0], 4.8, 5, "yellow");
      beam([7, 31, 0], [23, 14, 0], 3.7, 4, "yellow");
      beam([-4, 16, 3], [5, 28, 3], 1.1, 1.1, "stone");
      for (const p of [[-5, 13, 0], [7, 31, 0], [23, 14, 0]] as Point[]) sphere([2.7, 2.7, 3], p, "dark");
      // Open scoop: back, floor, cheeks and teeth, with its mouth facing east.
      box([2.5, 8, 11], [24, 10, 0], "dark", 0.5);
      box([10, 2, 11], [28, 6.5, 0], "dark", 0.5);
      for (const z of [-4.7, 4.7]) box([9, 6, 1.6], [28, 9, z], "dark", 0.5);
      for (const z of [-3.4, 0, 3.4]) box([4, 1.5, 1.7], [34, 6.2, z], "stone", 0.2);
      break;
    }
    default:
      box([22, 10, 22], [0, 5, 0], "cream", 1);
      box([24, 1.5, 24], [0, 10.75, 0], "blue", 0.5);
  }

  cube.dispose();
  ball.dispose();
  for (const geometry of roundedBoxes.values()) geometry.dispose();
  for (const [color, parts] of batches) {
    const geometry = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!geometry) throw new Error(`Could not merge diorama facility: ${structureId}/${color}`);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({
      color: COLORS[color],
      roughness: color === "water" ? 0.3 : sculpted && color === "blue" ? 0.38 : sculpted && color === "cream" ? 0.58 : 0.72,
      metalness: 0,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${structureId}:${color}`;
    mesh.castShadow = color !== "water" && color !== "foam";
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
