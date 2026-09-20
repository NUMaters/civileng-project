import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInitialFloodState,
  type FloodSimulationState,
} from "../../features/disaster/services/floodSimulation";
import {
  advanceInundationField,
  resetInundationField,
} from "../../features/disaster/services/inundationField";
import {
  getCandidateBankElevationMeters,
  listOverflowCandidates,
} from "../../features/disaster/services/overflowBankSites";
import { createDioramaInundation, type DioramaInundation } from "./dioramaInundation";
import { geoToWorld, groundY, riverX } from "./dioramaSpace";

const adapters: DioramaInundation[] = [];
const candidate = listOverflowCandidates().find((site) => site.id === "campus-core")!;
function wetState(): FloodSimulationState {
  return {
    ...createInitialFloodState(),
    phase: "disaster",
    overflowMeters: 1,
    floodDepthMeters: 1.2,
    overflowSites: [{ ...candidate, intensity: 0.9 }],
  };
}
function setup() {
  const adapter = createDioramaInundation();
  adapters.push(adapter);
  const mesh = adapter.group.children[0] as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshBasicMaterial
  >;
  return { adapter, mesh, geometry: mesh.geometry };
}
function run(adapter: DioramaInundation, state = wetState(), count = 100) {
  adapter.update(state, 0, 0);
  for (let i = 0; i < count; i++)
    adapter.update({ ...state, disasterElapsedSeconds: (i + 1) / 10 }, 0.1, (i + 1) / 10);
}
afterEach(() => {
  adapters.splice(0).forEach((adapter) => adapter.dispose());
  resetInundationField();
});

describe("Three inundation adapter", () => {
  it("uses supplied measured ground for wet cells and omits missing ground", () => {
    const supplied = createDioramaInundation(() => 17);
    const missing = createDioramaInundation(() => null);
    adapters.push(supplied, missing);
    run(supplied);
    run(missing);
    const geometry = (supplied.group.children[0] as THREE.Mesh).geometry;
    expect(geometry.drawRange.count).toBeGreaterThan(0);
    const positions = geometry.getAttribute("position");
    for (let i = 0; i < geometry.drawRange.count; i++)
      expect(positions.getY(i)).toBeGreaterThanOrEqual(17.18 - 1e-5);
    expect((missing.group.children[0] as THREE.Mesh).geometry.drawRange.count).toBe(0);
    expect(missing.group.visible).toBe(false);
  });
  it("does not start for rain/high river alone, zero water, absent sites or inactive phases", () => {
    for (const state of [
      createInitialFloodState(),
      {
        ...wetState(),
        overflowMeters: 0,
        floodDepthMeters: 0,
        riverLevelMeters: 8,
        rainfallIntensity: 1,
      },
      { ...wetState(), overflowSites: [] },
      { ...wetState(), overflowSites: [{ ...candidate, intensity: 0 }] },
      { ...wetState(), phase: "preparation" as const },
    ]) {
      const { adapter, geometry } = setup();
      run(adapter, state);
      expect(adapter.group.visible).toBe(false);
      expect(geometry.drawRange.count).toBe(0);
    }
  });

  it("matches the real field's wet-cell count and max depth, spreading beyond the breach", () => {
    const { adapter, geometry } = setup();
    const state = wetState();
    const seed = {
      ...state.overflowSites[0]!,
      bankElevationMeters: getCandidateBankElevationMeters(candidate),
    };
    let firstCount = 0;
    adapter.update(state, 0, 0);
    for (let i = 0; i < 600; i++) {
      adapter.update({ ...state, disasterElapsedSeconds: (i + 1) / 10 }, 0.1, (i + 1) / 10);
      const site = advanceInundationField([seed], 1.2, 0.1, i * 100).sites[0]!;
      expect(geometry.drawRange.count / 12).toBe(site.floodedCellCount);
      if (i === 0) firstCount = geometry.drawRange.count;
      if (i === 599) {
        const position = geometry.getAttribute("position");
        const depths = Array.from(
          { length: geometry.drawRange.count },
          (_, index) =>
            position.getY(index) - groundY(position.getX(index), position.getZ(index)) - 0.18,
        );
        expect(Math.max(...depths)).toBeCloseTo(site.maxDepthMeters, 3);
        expect(Math.min(...depths)).toBeGreaterThanOrEqual(0.0399);
        expect(Math.max(...depths) - Math.min(...depths)).toBeGreaterThan(0.1);
      }
    }
    expect(adapter.object3D).toBe(adapter.group);
    expect(adapter.group.visible).toBe(true);
    expect(geometry.drawRange.count).toBeGreaterThan(firstCount);
    const p = geometry.getAttribute("position");
    const origin = geoToWorld(seed.longitude, seed.latitude);
    const heading = (seed.outflowHeadingDegrees * Math.PI) / 180;
    const distances = Array.from(
      { length: geometry.drawRange.count },
      (_, i) =>
        (p.getX(i) - origin.x) * Math.sin(heading) - (p.getZ(i) - origin.z) * Math.cos(heading),
    );
    expect(Math.max(...distances)).toBeGreaterThan(80);
    const townVertices = Array.from({ length: geometry.drawRange.count }, (_, i) => i).filter(
      (i) => Math.abs(p.getX(i) - riverX(p.getZ(i))) > 127,
    );
    expect(townVertices.length).toBeGreaterThan(18);
    // Shoreline smoothing contracts exposed corners; it never widens a cell edge.
    for (let i = 0; i < geometry.drawRange.count; i += 12) {
      const edge = Math.hypot(p.getX(i + 2) - p.getX(i + 1), p.getZ(i + 2) - p.getZ(i + 1));
      expect(edge).toBeLessThanOrEqual(16.1);
      expect(edge).toBeGreaterThan(5);
    }
    expect(adapter.group.children).toHaveLength(1);
  }, 20_000);

  it("hides immediately at zero water and restarts without residual wet cells", () => {
    const { adapter, geometry } = setup();
    run(adapter);
    expect(adapter.group.visible).toBe(true);
    adapter.update({ ...wetState(), overflowMeters: 0, floodDepthMeters: 0 }, 0, 11);
    expect(adapter.group.visible).toBe(false);
    expect(geometry.drawRange.count).toBe(0);
    const fresh = setup();
    adapter.update(wetState(), 0.1, 12);
    fresh.adapter.update(wetState(), 0.1, 12);
    adapter.update({ ...wetState(), disasterElapsedSeconds: 0.1 }, 0.1, 12.1);
    fresh.adapter.update({ ...wetState(), disasterElapsedSeconds: 0.1 }, 0.1, 12.1);
    expect(geometry.drawRange.count).toBeGreaterThan(0);
    expect(geometry.drawRange.count).toBe(fresh.geometry.drawRange.count);
    expect(geometry.getAttribute("position").array.slice(0, geometry.drawRange.count * 3)).toEqual(
      fresh.geometry.getAttribute("position").array.slice(0, geometry.drawRange.count * 3),
    );
  });

  it("isolates instances and resets on replay; result/review freeze the footprint", () => {
    const a = setup(),
      b = setup();
    run(a.adapter);
    b.adapter.update(createInitialFloodState(), 0.1, 1);
    const count = a.geometry.drawRange.count;
    a.adapter.update({ ...wetState(), phase: "result", disasterElapsedSeconds: 10 }, 1, 10);
    a.adapter.update({ ...wetState(), phase: "review", disasterElapsedSeconds: 10 }, 1, 11);
    expect(a.geometry.drawRange.count).toBe(count);
    a.adapter.update(wetState(), 0.1, 12);
    b.adapter.update(wetState(), 0.1, 12);
    expect(a.geometry.drawRange.count).toBe(b.geometry.drawRange.count);
  });

  it("uses simulation elapsed, caps geometry uploads at 10 Hz even with fast simulation", () => {
    const { adapter, geometry } = setup();
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    adapter.update(wetState(), 0, 0);
    for (let i = 1; i <= 100; i++)
      adapter.update({ ...wetState(), disasterElapsedSeconds: i * 0.1 }, 0.01, i * 0.01);
    expect(position.version).toBe(10);
  });

  it("freezes across paused draw loops without advancing hidden field state", () => {
    const paused = setup(),
      control = setup();
    run(paused.adapter);
    run(control.adapter);
    const position = paused.geometry.getAttribute("position") as THREE.BufferAttribute;
    const version = position.version;
    const before = position.array.slice();
    for (let frame = 1; frame <= 600; frame++) {
      paused.adapter.update({ ...wetState(), disasterElapsedSeconds: 10 }, 1 / 60, 10 + frame / 60);
    }
    expect(position.version).toBe(version);
    expect(position.array).toEqual(before);
    const resumed = { ...wetState(), disasterElapsedSeconds: 10.1 };
    paused.adapter.update(resumed, 0.016, 20.1);
    control.adapter.update(resumed, 0, 20.1);
    expect(position.array).toEqual(control.geometry.getAttribute("position").array);
  });

  it("catches up skipped snapshots and bounds huge gaps without a paused backlog", () => {
    const skipped = setup(),
      regular = setup(),
      capped = setup();
    for (const item of [skipped, regular, capped]) item.adapter.update(wetState(), 0, 0);
    for (let i = 1; i <= 10; i++) {
      regular.adapter.update({ ...wetState(), disasterElapsedSeconds: i / 10 }, 0, i / 10);
    }
    for (const elapsed of [0.5, 1]) {
      skipped.adapter.update({ ...wetState(), disasterElapsedSeconds: elapsed }, 0.016, elapsed);
    }
    capped.adapter.update({ ...wetState(), disasterElapsedSeconds: 60 }, 60, 60);
    const expected = regular.geometry.getAttribute("position").array;
    expect(skipped.geometry.getAttribute("position").array).toEqual(expected);
    expect(capped.geometry.getAttribute("position").array).toEqual(expected);
    const version = (capped.geometry.getAttribute("position") as THREE.BufferAttribute).version;
    for (let i = 1; i <= 100; i++)
      capped.adapter.update({ ...wetState(), disasterElapsedSeconds: 60 }, 1, 60 + i);
    expect((capped.geometry.getAttribute("position") as THREE.BufferAttribute).version).toBe(
      version,
    );
    expect(capped.geometry.getAttribute("position").array).toEqual(expected);
  });

  it("anchors late mounts and rejects invalid elapsed without injecting guessed history", () => {
    const { adapter, geometry } = setup();
    adapter.update({ ...wetState(), disasterElapsedSeconds: 50 }, 50, 50);
    for (const elapsed of [50, NaN, Infinity, -1]) {
      adapter.update({ ...wetState(), disasterElapsedSeconds: elapsed }, 1, 51);
    }
    expect(geometry.drawRange.count).toBe(0);
    adapter.update({ ...wetState(), disasterElapsedSeconds: 50.1 }, 0, 52);
    expect(geometry.drawRange.count).toBeGreaterThan(0);
  });

  it("shares wet-corner heights and colors while keeping exact cell centers", () => {
    const { adapter, geometry } = setup();
    run(adapter);
    const positions = geometry.getAttribute("position");
    const colors = geometry.getAttribute("color");
    const corners = new Map<string, number[]>();
    let shared = 0,
      sloped = 0;
    for (let base = 0; base < geometry.drawRange.count; base += 12) {
      for (const offset of [1, 2, 5, 8]) {
        const i = base + offset;
        const key = `${positions.getX(i)},${positions.getZ(i)}`;
        const value = [positions.getY(i), colors.getX(i), colors.getY(i), colors.getZ(i)];
        if (corners.has(key)) {
          expect(value).toEqual(corners.get(key));
          shared++;
        }
        corners.set(key, value);
        const depth = (v: number) =>
          positions.getY(v) - groundY(positions.getX(v), positions.getZ(v));
        if (Math.abs(depth(i) - depth(base)) > 0.001) sloped++;
      }
    }
    expect(shared).toBeGreaterThan(0);
    expect(sloped).toBeGreaterThan(0);
  });

  it("removes stale sites and disposes resources exactly once", () => {
    const { adapter, geometry, mesh } = setup();
    const parent = new THREE.Group();
    parent.add(adapter.group);
    run(adapter);
    adapter.update({ ...wetState(), overflowSites: [] }, 0, 11);
    expect(adapter.group.visible).toBe(false);
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(mesh.material, "dispose");
    adapter.dispose();
    adapter.dispose();
    adapter.update(wetState(), 1, 12);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(parent.children).toHaveLength(0);
    expect(adapter.group.children).toHaveLength(0);
    expect(adapter.group.visible).toBe(false);
  });
});
