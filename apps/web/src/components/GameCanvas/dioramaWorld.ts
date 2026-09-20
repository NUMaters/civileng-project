import * as THREE from "three";
import { groundY, riverX, RIVER_POINTS } from "./dioramaSpace";

const Z_MIN = -2200;
const Z_MAX = 1800;
const BANK_EXTENT = 1600;
const ROAD_OFFSET = 110;
const BRIDGES = [-400, 640];
const CREAM = "#fff1cd";
const WALLS = [CREAM, "#ffe1bc", "#deebef", "#f5e2d9", "#dce9c8"];
const ROOFS = ["#ef796c", "#658acb", "#68b4c8", "#e6b565", "#7f92c9"];
const GREENS = ["#55ad32", "#299c52", "#81c638", "#40ad67"];

type Instance = { matrix: THREE.Matrix4; color: THREE.Color };
type Batch = {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  instances: Instance[];
};
type Add = (
  name: string,
  position: THREE.Vector3,
  scale: THREE.Vector3,
  color: string,
  rotation?: THREE.Quaternion,
) => void;

function seededRandom(): () => number {
  let seed = 7319;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** Includes every centerline knot so even the bank edge follows riverX exactly. */
function longitudinalSamples(): number[] {
  const values = new Set<number>([Z_MIN, Z_MAX]);
  for (let z = Z_MIN; z <= Z_MAX; z += 25) values.add(z);
  for (const point of RIVER_POINTS) if (point.z > Z_MIN && point.z < Z_MAX) values.add(point.z);
  return [...values].sort((a, b) => a - b);
}

function ribbon(
  side: number,
  offsets: number[],
  lift: number,
  colors?: string[],
): THREE.BufferGeometry {
  const zs = longitudinalSamples();
  const positions: number[] = [];
  const vertexColors: number[] = [];
  const indices: number[] = [];
  for (const z of zs) {
    offsets.forEach((offset, column) => {
      const x = riverX(z) + side * offset;
      positions.push(x, groundY(x, z) + lift, z);
      if (colors) {
        const color = new THREE.Color(colors[column % colors.length]);
        vertexColors.push(color.r, color.g, color.b);
      }
    });
  }
  for (let row = 0; row < zs.length - 1; row++) {
    for (let column = 0; column < offsets.length - 1; column++) {
      const a = row * offsets.length + column;
      const b = a + offsets.length;
      if (side > 0) indices.push(a, b, a + 1, a + 1, b, b + 1);
      else indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (colors) geometry.setAttribute("color", new THREE.Float32BufferAttribute(vertexColors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function roofGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, 0);
  shape.lineTo(0.5, 0);
  shape.lineTo(0, 1);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, steps: 1 });
  geometry.translate(0, 0, -0.5);
  // A single material means one draw call, including the gable ends.
  geometry.clearGroups();
  return geometry;
}

function addSegment(
  add: Add,
  name: string,
  a: THREE.Vector3,
  b: THREE.Vector3,
  width: number,
  depth: number,
  color: string,
): void {
  const direction = b.clone().sub(a);
  add(
    name,
    a.clone().add(b).multiplyScalar(0.5),
    new THREE.Vector3(width, direction.length(), depth),
    color,
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()),
  );
}

function addHouse(add: Add, random: () => number, x: number, z: number, side: number): void {
  const width = 24 + random() * 15;
  const depth = 24 + random() * 12;
  const floors = random() > 0.78 ? 4 : 2 + Math.floor(random() * 2);
  const height = floors * 9;
  const y = groundY(x, z);
  const wall = WALLS[Math.floor(random() * WALLS.length)]!;
  const roof = ROOFS[Math.floor(random() * ROOFS.length)]!;
  const box = (
    name: string,
    dx: number,
    dy: number,
    dz: number,
    w: number,
    h: number,
    d: number,
    color: string,
  ) => add(name, new THREE.Vector3(x + dx, y + dy, z + dz), new THREE.Vector3(w, h, d), color);
  box("plinth", 0, 0.55, 0, width + 6, 1.1, depth + 6, "#eddfbe");
  box("walls", 0, height / 2 + 1, 0, width, height, depth, wall);
  box("trim", 0, height + 1.2, 0, width + 3, 1.4, depth + 3, CREAM);
  box("roofs", 0, height + 1.9, 0, width + 5, 10, depth + 5, roof);
  box("trim", width * 0.25, height + 7, depth * 0.18, 3, 10, 3, "#edccaa");
  for (let floor = 0; floor < floors; floor++) {
    for (const column of [-1, 0, 1]) {
      for (const face of [-1, 1]) {
        box(
          "windows",
          column * width * 0.28,
          6 + floor * 9,
          face * (depth / 2 + 0.12),
          4.6,
          5.1,
          0.35,
          "#72a9c6",
        );
        box(
          "trim",
          column * width * 0.28,
          3.3 + floor * 9,
          face * (depth / 2 + 0.45),
          5.8,
          0.7,
          1.1,
          CREAM,
        );
      }
    }
    for (const column of [-1, 1]) {
      for (const face of [-1, 1])
        box(
          "windows",
          face * (width / 2 + 0.12),
          6 + floor * 9,
          column * depth * 0.25,
          0.35,
          5.1,
          4.6,
          "#72a9c6",
        );
    }
  }
  box("doors", -side * (width / 2 + 0.2), 4.8, 0, 0.6, 7.6, 5, "#947560");
  box("trim", -side * (width / 2 + 2), 9, 0, 5, 0.9, 8, roof);
}

function addTree(add: Add, random: () => number, x: number, z: number, size = 1): void {
  const y = groundY(x, z);
  const color = GREENS[Math.floor(random() * GREENS.length)]!;
  add(
    "trunks",
    new THREE.Vector3(x, y + 6 * size, z),
    new THREE.Vector3(2.1 * size, 12 * size, 2.1 * size),
    "#a28459",
  );
  add(
    "leaves",
    new THREE.Vector3(x, y + 17 * size, z),
    new THREE.Vector3(10 * size, 14 * size, 10 * size),
    color,
  );
  add(
    "leaves",
    new THREE.Vector3(x - 4 * size, y + 14 * size, z + 2 * size),
    new THREE.Vector3(8 * size, 9 * size, 8 * size),
    color,
  );
}

function addBridges(add: Add): void {
  for (const z of BRIDGES) {
    const center = riverX(z);
    const deck = (x: number, dz = 0) =>
      new THREE.Vector3(center + x, 10 + 9 * Math.cos(((x / ROAD_OFFSET) * Math.PI) / 2), z + dz);
    for (let x = -ROAD_OFFSET; x < ROAD_OFFSET; x += 10) {
      const end = Math.min(ROAD_OFFSET, x + 10);
      addSegment(add, "bridgeDeck", deck(x), deck(end), 1.8, 24, "#f3e2be");
      for (const edge of [-11, 11]) {
        addSegment(
          add,
          "bridgeRails",
          deck(x, edge).add(new THREE.Vector3(0, 3.8, 0)),
          deck(end, edge).add(new THREE.Vector3(0, 3.8, 0)),
          0.9,
          0.9,
          CREAM,
        );
        addSegment(
          add,
          "bridgeRails",
          deck(x, edge),
          deck(x, edge).add(new THREE.Vector3(0, 3.8, 0)),
          0.7,
          0.7,
          CREAM,
        );
      }
      if (x >= -100 && end <= 100) {
        for (const edge of [-10, 10]) {
          const arch = (t: number) =>
            new THREE.Vector3(center + t, deck(t).y + 3.8 + 30 * (1 - (t / 100) ** 2), z + edge);
          addSegment(add, "bridgeArch", arch(x), arch(end), 3.2, 3.2, "#f3b62b");
          if (x % 20 === 0) addSegment(add, "bridgeRails", deck(x, edge), arch(x), 1, 1, "#f6d68b");
        }
      }
    }
    for (const x of [-90, 90]) {
      const top = deck(x).y;
      add(
        "bridgeDeck",
        new THREE.Vector3(center + x, (9 + top) / 2, z),
        new THREE.Vector3(9, top - 9, 20),
        "#e0d1b3",
      );
    }
  }
}

/**
 * Static meter-scale scenery only; camera, lighting, water and picking belong to the caller.
 * Banks: z [-2200,1800], x riverX(z) +/- [44,1600]. Dense mobile framing:
 * trees at bank offset 84, roads at 110, and housing from 150 outward.
 * This layout replaces the original continuous 100 m facility reservation.
 * Each call owns its resources. On teardown traverse meshes, dispose each distinct
 * geometry/material once, and call dispose() on InstancedMesh objects as well.
 * No textures, animation callbacks, event listeners, or module-global GPU resources.
 */
export function createDioramaWorld(): THREE.Group {
  const world = new THREE.Group();
  world.name = "diorama-world";
  const random = seededRandom();
  const standard = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0 });
  const grass = new THREE.MeshStandardMaterial({ roughness: 1, vertexColors: true });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const sphere = new THREE.SphereGeometry(1, 10, 7);
  const batches = new Map<string, Batch>();
  const geometries: Record<string, THREE.BufferGeometry> = {
    roofs: roofGeometry(),
    leaves: sphere,
    hills: sphere,
    clouds: sphere,
    trunks: new THREE.CylinderGeometry(1, 1.3, 1, 6),
  };
  const add: Add = (name, position, scale, color, rotation = new THREE.Quaternion()) => {
    let batch = batches.get(name);
    if (!batch) {
      batch = { geometry: geometries[name] ?? box, material: standard, instances: [] };
      batches.set(name, batch);
    }
    batch.instances.push({
      matrix: new THREE.Matrix4().compose(position, rotation, scale),
      color: new THREE.Color(color),
    });
  };
  const surface = (
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.MeshStandardMaterial,
  ) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.receiveShadow = true;
    world.add(mesh);
  };
  const asphalt = new THREE.MeshStandardMaterial({ color: "#929ba8", roughness: 1 });
  const pavement = new THREE.MeshStandardMaterial({ color: "#f1e4c5", roughness: 1 });
  const white = new THREE.MeshStandardMaterial({ color: "#fff5dd", roughness: 1 });
  for (const side of [-1, 1]) {
    surface(
      "continuous-green-bank",
      ribbon(side, [44, 49, 60, 70, 90, 260, 500, 900, BANK_EXTENT], 0, [
        "#c6cd77",
        "#86ce45",
        "#69bd35",
        "#78c73b",
        "#86ce45",
        "#75c23e",
        "#6abb3b",
        "#60af3b",
        "#559e40",
      ]),
      grass,
    );
    surface("road-sidewalk", ribbon(side, [ROAD_OFFSET - 17, ROAD_OFFSET + 17], 0.12), pavement);
    surface("bank-road", ribbon(side, [ROAD_OFFSET - 12, ROAD_OFFSET + 12], 0.18), asphalt);
    for (const edge of [-10.5, 10.5])
      surface(
        "road-edge-line",
        ribbon(side, [ROAD_OFFSET + edge - 0.35, ROAD_OFFSET + edge + 0.35], 0.21),
        white,
      );
    for (let z = -2150; z < 1780; z += 28) {
      if (BRIDGES.some((bridge) => Math.abs(z - bridge) < 26)) continue;
      const a = new THREE.Vector3(riverX(z) + side * ROAD_OFFSET, 9.24, z);
      const b = new THREE.Vector3(riverX(z + 11) + side * ROAD_OFFSET, 9.24, z + 11);
      addSegment(add, "roadDashes", a, b, 0.65, 0.05, "#fff7e7");
    }
    for (let z = -2090; z < 1740; z += 82) {
      if (BRIDGES.some((bridge) => Math.abs(z - bridge) < 48)) continue;
      const x = riverX(z) + side * (ROAD_OFFSET + 17);
      add("lamps", new THREE.Vector3(x, 16, z), new THREE.Vector3(0.8, 14, 0.8), "#819794");
      add(
        "lamps",
        new THREE.Vector3(x - side * 2, 23, z),
        new THREE.Vector3(5, 0.7, 0.7),
        "#819794",
      );
      add(
        "lampLights",
        new THREE.Vector3(x - side * 4, 22.7, z),
        new THREE.Vector3(2.8, 1.2, 2),
        "#fff4cb",
      );
    }
    for (let z = -2070; z < 1730; z += 73) {
      if (BRIDGES.some((bridge) => Math.abs(z - bridge) < 48)) continue;
      for (let row = 0; row < 4; row++) {
        const houseZ = z + (random() - 0.5) * 12;
        const offset = 150 + row * 65 + random() * 8;
        addHouse(add, random, riverX(houseZ) + side * offset, houseZ, side);
        const treeZ = z + 30;
        addTree(add, random, riverX(treeZ) + side * (offset + 29), treeZ, 0.75 + random() * 0.5);
      }
    }
    for (let z = -2120; z < 1760; z += 58) {
      if (BRIDGES.some((bridge) => Math.abs(z - bridge) < 45)) continue;
      addTree(add, random, riverX(z) + side * 84, z, 0.6 + random() * 0.25);
      for (const offset of [640, 760, 940]) {
        const treeZ = z + random() * 25;
        addTree(add, random, riverX(treeZ) + side * (offset + random() * 60), treeZ, 1 + random());
      }
    }
    for (let z = -1900; z < 1600; z += 450) {
      const x = riverX(z) + side * 1290;
      add(
        "hills",
        new THREE.Vector3(x, -22, z),
        new THREE.Vector3(240, 125 + random() * 70, 310),
        GREENS[Math.floor(random() * GREENS.length)]!,
      );
    }
    for (let i = 0; i < 5; i++) {
      const z = -1800 + i * 620;
      const x = riverX(z) + side * 1260;
      for (let puff = 0; puff < 4; puff++)
        add(
          "clouds",
          new THREE.Vector3(x + puff * 50, 320 + Math.sin(puff * 2) * 14, z),
          new THREE.Vector3(60, 28 + random() * 18, 36),
          "#fff9ef",
        );
    }
  }
  addBridges(add);
  for (const [name, batch] of batches) {
    const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.instances.length);
    mesh.name = name;
    batch.instances.forEach((instance, index) => {
      mesh.setMatrixAt(index, instance.matrix);
      mesh.setColorAt(index, instance.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = !["clouds", "roadDashes", "windows"].includes(name);
    mesh.receiveShadow = name !== "clouds";
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    world.add(mesh);
  }
  world.userData.bounds = { zMin: Z_MIN, zMax: Z_MAX, riverRelativeHalfWidth: BANK_EXTENT };
  return world;
}
