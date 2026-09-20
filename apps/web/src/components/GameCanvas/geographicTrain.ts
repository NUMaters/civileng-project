import * as THREE from "three";
import { koriyamaGeoToLocal, type KoriyamaGeodata } from "./koriyamaGeodata";

type Ground = (x: number, z: number) => number | null;
type Point = { x: number; y: number; z: number; distance: number };
type TrainTrack = { sourceId: string; points: Point[]; length: number };

/** Select a continuous source track, never connect gaps or invent a spline through buildings. */
export function selectGeographicTrainTrack(data: KoriyamaGeodata, ground: Ground): TrainTrack | null {
  let best: TrainTrack | null = null;
  for (const feature of data.features) {
    if (feature.properties.kind !== "rail" || feature.properties.railway !== "rail" ||
      feature.properties.name !== "JR東北本線" || feature.properties.bridge || feature.properties.tunnel ||
      feature.geometry.type !== "MultiLineString") continue;
    for (const line of feature.geometry.coordinates) {
      let run: Point[] = [];
      const finish = () => {
        const length = run.at(-1)?.distance ?? 0;
        if (length > 200 && (!best || length > best.length)) best = { sourceId: feature.id, points: run, length };
        run = [];
      };
      for (const coordinates of line) {
        const p = koriyamaGeoToLocal(coordinates), y = ground(p.x, p.z);
        if (y === null || !Number.isFinite(y)) { finish(); continue; }
        const previous = run.at(-1);
        const distance = previous ? previous.distance + Math.hypot(p.x - previous.x, p.z - previous.z) : 0;
        if (!previous || distance > previous.distance) run.push({ ...p, y, distance });
      }
      finish();
    }
  }
  return best;
}

export function sampleTrainTrack(points: Point[], distance: number) {
  if (distance < 0 || distance > (points.at(-1)?.distance ?? -1)) return null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    if (distance > b.distance) continue;
    const t = (distance - a.distance) / (b.distance - a.distance);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t, heading: Math.atan2(b.x - a.x, b.z - a.z) };
  }
  return null;
}

/** Illustrative local commuter train; not a real-time service, surveyed vehicle or timetable. */
export function createGeographicTrain(data: KoriyamaGeodata, ground: Ground) {
  const group = new THREE.Group();
  group.name = "geographic-commuter-train";
  const track = selectGeographicTrainTrack(data, ground);
  group.userData = { sourceId: track?.sourceId ?? null,
    provenance: "OSM JR東北本線 path; DEM-aligned illustrative vehicle; no live position/timetable", cars: 3 };
  const cars: THREE.Group[] = [];
  if (track) {
    const body = new THREE.BoxGeometry(2.8, 2.6, 18);
    const stripe = new THREE.BoxGeometry(2.84, 0.32, 18.05);
    const windows = new THREE.BoxGeometry(2.85, 0.75, 1.3);
    const roof = new THREE.BoxGeometry(2.5, 0.24, 17.6);
    const materials = {
      body: new THREE.MeshStandardMaterial({ color: "#e6f1f3", roughness: 0.55 }),
      stripe: new THREE.MeshStandardMaterial({ color: "#32b888", roughness: 0.6 }),
      windows: new THREE.MeshStandardMaterial({ color: "#173f58", roughness: 0.28 }),
      roof: new THREE.MeshStandardMaterial({ color: "#869da9", roughness: 0.75 }),
    };
    for (let i = 0; i < 3; i++) {
      const car = new THREE.Group();
      const shell = new THREE.Mesh(body, materials.body); shell.position.y = 1.7;
      const belt = new THREE.Mesh(stripe, materials.stripe); belt.position.y = 1.2;
      const top = new THREE.Mesh(roof, materials.roof); top.position.y = 3.12;
      car.add(shell, belt, top);
      const glazing = new THREE.InstancedMesh(windows, materials.windows, 7);
      const matrix = new THREE.Matrix4();
      for (let j = 0; j < 7; j++)
        glazing.setMatrixAt(j, matrix.makeTranslation(0, 2.1, -7 + j * 2.3));
      glazing.instanceMatrix.needsUpdate = true;
      glazing.computeBoundingSphere();
      car.add(glazing);
      // Dynamic cars do not invalidate the expensive static-city shadow map.
      car.traverse(object => { object.castShadow = false; object.receiveShadow = true; });
      group.add(car); cars.push(car);
    }
  }
  return { group, track, update(elapsedSeconds: number) {
    if (!track || !Number.isFinite(elapsedSeconds)) return;
    const head = ((Math.max(0, elapsedSeconds) * 12 + track.length * 0.45) % (track.length + 65));
    cars.forEach((car, i) => {
      const distance = head - i * 19.5;
      const point = sampleTrainTrack(track.points, distance);
      const height = point ? ground(point.x, point.z) : null;
      car.visible = point !== null && height !== null && Number.isFinite(height);
      if (point && car.visible) {
        const front = sampleTrainTrack(track.points, Math.min(track.length, distance + 7))!;
        const back = sampleTrainTrack(track.points, Math.max(0, distance - 7))!;
        car.position.set(point.x, height! + 0.14, point.z);
        car.rotation.y = Math.atan2(front.x - back.x, front.z - back.z);
      }
    });
  } };
}
