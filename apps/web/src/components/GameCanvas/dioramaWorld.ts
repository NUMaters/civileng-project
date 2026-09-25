import * as THREE from "three";
import { groundY, riverX, RIVER_POINTS } from "./dioramaSpace";

const Z_MIN = -2200;
const Z_MAX = 1800;
const BANK_EXTENT = 1600;
const ROAD_OFFSET = 110;
const BRIDGES = [-400, 640];
const CREAM = "#fff1cd";
const WALLS = [CREAM, "#ffe3b0", "#e4f1f5", "#ffe2d6", "#e5efce"];
const ROOFS = ["#f47768", "#527fd0", "#50b6ce", "#edba56", "#808dd0"];
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
  const kind = random();
  const cottage = kind < 0.34;
  const apartment = kind > 0.79;
  const width = apartment ? 34 + random() * 6 : 24 + random() * 10;
  const depth = apartment ? 30 + random() * 6 : 24 + random() * 8;
  const floors = cottage ? 1 : apartment ? 4 + Math.floor(random() * 2) : 2;
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
  if (apartment) {
    // Flat roofs and a small stairwell give apartments a distinct toy silhouette.
    // Reuse box batches, so building variety adds no draw calls.
    box("trim", 0, height + 2.2, 0, width + 2, 1.4, depth + 2, roof);
    box("walls", width * 0.2, height + 4.8, depth * 0.18, 10, 4, 9, wall);
    box("trim", width * 0.2, height + 7, depth * 0.18, 11, 0.8, 10, CREAM);
    for (let floor = 1; floor < floors; floor++) {
      box("trim", 0, 1.5 + floor * 9, -depth / 2 - 0.8, width + 1, 1, 2, CREAM);
    }
  } else {
    box("roofs", 0, height + 1.9, 0, width + 5, cottage ? 8 : 11, depth + 5, roof);
    box("trim", width * 0.25, height + 7, depth * 0.18, 3, 10, 3, "#edccaa");
  }
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
  if (cottage) {
    box("plinth", -side * (width / 2 + 3), 0.5, 0, 6, 1, 9, CREAM);
    box("trim", 0, 2.3, -depth / 2 - 1.2, width * 0.65, 2, 2.5, "#e5ad7b");
    box("trim", 0, 3.5, -depth / 2 - 1.2, width * 0.6, 1.2, 2.8, "#78bc49");
  }
}

function addBankDetails(add: Add, random: () => number, side: number): void {
  const fitsBand = (
    x: number,
    z: number,
    radiusX: number,
    radiusZ: number,
    min: number,
    max: number,
  ) => {
    const zs = [
      z - radiusZ,
      z + radiusZ,
      ...RIVER_POINTS.filter((point) => Math.abs(point.z - z) < radiusZ).map((point) => point.z),
    ];
    return zs.every((sampleZ) => {
      const offset = Math.abs(x - riverX(sampleZ));
      return offset - radiusX > min && offset + radiusX < max;
    });
  };
  for (let z = -2110; z < 1740; z += 137) {
    const clusterZ = z + random() * 22;
    if (BRIDGES.some((bridge) => Math.abs(clusterZ - bridge) < 70)) continue;
    // Tiny shoreline clusters leave the sloping bank and placement strip open.
    for (let i = 0; i < 3; i++) {
      const rockZ = clusterZ + i * 4.5;
      const x = riverX(rockZ) + side * (49 + random());
      const size = 1.4 + random() * 0.6;
      if (!fitsBand(x, rockZ, size, size * 0.7, 43, 54)) continue;
      add(
        "rocks",
        new THREE.Vector3(x, groundY(x, rockZ) + 0.3, rockZ),
        new THREE.Vector3(size, size * 0.75, size * 0.7),
        ["#d8d9cf", "#b4c2cc", "#ebdfc5"][i]!,
      );
    }
    // Flowers remain by the existing tree verge, beyond the open inner bank.
    for (let i = 0; i < 5; i++) {
      const flowerZ = clusterZ + 18 + (random() - 0.5) * 7;
      const x = riverX(flowerZ) + side * (86 + random() * 3);
      if (!fitsBand(x, flowerZ, 1.3, 1.3, 83, 92)) continue;
      const y = groundY(x, flowerZ);
      add(
        "leaves",
        new THREE.Vector3(x, y + 0.5, flowerZ),
        new THREE.Vector3(1.3, 0.7, 1.3),
        "#71b84b",
      );
      add(
        "flowers",
        new THREE.Vector3(x, y + 1.3, flowerZ),
        new THREE.Vector3(0.9, 0.7, 0.9),
        i % 2 ? "#fff1a8" : "#ffadbb",
      );
    }
  }
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
    rocks: new THREE.IcosahedronGeometry(1, 0),
    flowers: sphere,
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
        "#d9d58b",
        "#97d957",
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
        const houseZ = z + (row % 2) * 29 + (side > 0 ? 13 : 0) + (random() - 0.5) * 18;
        if (BRIDGES.some((bridge) => Math.abs(houseZ - bridge) < 48)) continue;
        const offset = 163 + row * 65 + (random() - 0.5) * 14;
        // Occasional pocket gardens break up the rows without widening the town.
        if (random() < 0.16) {
          addTree(add, random, riverX(houseZ) + side * offset, houseZ, 0.85);
          continue;
        }
        // At tight bends, measure the whole lot against the road, not only its center.
        const lotZs = [
          houseZ - 22,
          houseZ + 22,
          ...RIVER_POINTS.filter((point) => Math.abs(point.z - houseZ) < 22).map(
            (point) => point.z,
          ),
        ];
        const houseX =
          side *
          Math.max(
            side * riverX(houseZ) + offset,
            ...lotZs.map((lotZ) => side * riverX(lotZ) + 158),
          );
        addHouse(add, random, houseX, houseZ, side);
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
  // Separate seed keeps decorative changes from reshuffling the town layout.
  const detailRandom = seededRandom();
  for (const side of [-1, 1]) addBankDetails(add, detailRandom, side);
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
    mesh.castShadow = !["clouds", "roadDashes", "windows", "flowers"].includes(name);
    mesh.receiveShadow = name !== "clouds";
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    world.add(mesh);
  }
  world.userData.bounds = { zMin: Z_MIN, zMax: Z_MAX, riverRelativeHalfWidth: BANK_EXTENT };
  return world;
}
