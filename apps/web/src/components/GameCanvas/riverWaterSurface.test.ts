import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Event, GroundPrimitive, Resource, type Viewer } from "cesium";
import { ABUKUMA_RIVER_CENTERLINE } from "./abukumaRiverGeometry";
import { createRiverWaterSurface } from "./riverWaterSurface";
import {
  advanceRiverFlow,
  hydraulicsToWaterStyle,
  riverTextureFrame,
  smoothWaterStyle,
} from "./riverWaterSurfaceMath";

vi.mock("./cesiumPerformance", () => ({
  getCesiumRenderProfile: () => ({ waterFrameIntervalMs: 1000 / 12, waterUseNormalMap: false }),
}));

const normal = {
  riverLevelMeters: 2.2,
  rainfallIntensity: 0,
  overflowMeters: 0,
  activeFlood: false,
};
const flood = {
  riverLevelMeters: 6.6,
  rainfallIntensity: 1,
  overflowMeters: 3,
  activeFlood: true,
};

describe("water hydraulic and flow math", () => {
  it("advects the actual Abukuma centerline south to north, without reversing it", () => {
    const frame = riverTextureFrame(
      { west: 2.44, east: 2.45, south: 0.65, north: 0.66 },
      ABUKUMA_RIVER_CENTERLINE,
    );
    expect(frame.north).toBeGreaterThan(0);
    expect(Math.hypot(frame.east, frame.north)).toBeCloseTo(1);
    expect(frame.widthMeters).toBeLessThan(frame.heightMeters);
    const offset = { x: 0, y: 0 };
    advanceRiverFlow(offset, frame, 2, 10);
    expect(offset.y).toBeGreaterThan(0);
    expect(Math.hypot(offset.x, offset.y)).toBeCloseTo(20);
  });

  it("travels the same distance and smooths equally at mobile and desktop rates", () => {
    const start = hydraulicsToWaterStyle(normal);
    const end = hydraulicsToWaterStyle(flood);
    const results = [12, 30, 60].map((hz) => {
      let style = start;
      const offset = { x: 0, y: 0 };
      for (let index = 0; index < hz * 2; index++) {
        style = smoothWaterStyle(style, end, 1 / hz);
        advanceRiverFlow(offset, { east: 0, north: 1 }, 1.5, 1 / hz);
      }
      expect(offset.y).toBeCloseTo(3);
      return style;
    });
    for (const result of results) {
      expect(result.speed).toBeCloseTo(results[0]!.speed, 10);
      expect(result.amplitude).toBeCloseTo(results[0]!.amplitude, 10);
    }
  });

  it("increases speed, turbidity and waves during a flood, with bounded mitigation", () => {
    const base = hydraulicsToWaterStyle(normal);
    const high = hydraulicsToWaterStyle(flood);
    const calm = hydraulicsToWaterStyle({ ...flood, mitigationCalm: 1 });
    expect(high.speed).toBeGreaterThan(base.speed);
    expect(high.amplitude).toBeGreaterThan(base.amplitude);
    expect(high.muddy).toBeGreaterThan(base.muddy);
    expect(calm.speed).toBeLessThan(high.speed);
    expect(calm.amplitude).toBeLessThan(high.amplitude);
    expect(hydraulicsToWaterStyle({ ...normal, activeFlood: true })).toEqual(base);
    for (const value of [NaN, Infinity, -Infinity, -100, 1e12]) {
      const style = hydraulicsToWaterStyle({
        riverLevelMeters: value,
        rainfallIntensity: value,
        overflowMeters: value,
        mitigationCalm: value,
        activeFlood: true,
      });
      expect(Object.values(style).every(Number.isFinite)).toBe(true);
      expect(style.speed).toBeGreaterThan(0);
      expect(style.speed).toBeLessThanOrEqual(3.7);
      expect(style.muddy).toBeGreaterThanOrEqual(0);
      expect(style.muddy).toBeLessThanOrEqual(1);
    }
  });
});

describe("stable water controller with actual Cesium geometry/material", () => {
  let now: number;
  beforeEach(() => {
    // Material checks browser texture types during construction; no WebGL here.
    for (const name of [
      "HTMLCanvasElement",
      "HTMLImageElement",
      "ImageBitmap",
      "OffscreenCanvas",
    ]) {
      vi.stubGlobal(name, class {});
    }
    now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(GroundPrimitive, "initializeTerrainHeights").mockResolvedValue(undefined);
    vi.spyOn(Resource.prototype, "fetchImage").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function fakeViewer() {
    const preUpdate = new Event();
    const viewer = {
      isDestroyed: vi.fn(() => false),
      entities: { add: vi.fn(), remove: vi.fn() },
      scene: {
        preUpdate,
        groundPrimitives: { add: vi.fn(), remove: vi.fn() },
        requestRender: vi.fn(),
      },
    };
    return viewer;
  }

  it("keeps one geometry and moves Water on mobile while hydraulics change", async () => {
    const viewer = fakeViewer();
    const controller = await createRiverWaterSurface(viewer as unknown as Viewer);
    const primitive = viewer.scene.groundPrimitives.add.mock.calls[0]![0] as GroundPrimitive;
    const geometry = primitive.geometryInstances;
    const material = primitive.appearance!.material;
    expect(material.materials.riverWater!.type).toBe("Water");
    expect(material.materials.riverWater!.uniforms.animationSpeed).toBe(0);
    // Fabric expands the Water submaterial call AFTER our transformed ST.
    expect(material.shaderSource).toMatch(/surface = czm_getMaterial_\d+\(materialInput\)/);
    expect(material.shaderSource).toMatch(
      /movingMeters = materialInput\.st \* textureMeters_\d+ - flowMeters_\d+;[\s\S]*materialInput\.st = movingMeters[\s\S]*surface = czm_getMaterial_\d+\(materialInput\)/,
    );
    expect(material.shaderSource).not.toContain("return riverWater;");
    expect(material.shaderSource).toContain("czm_getWaterNoise(normalMap_");
    controller.setHydraulics(flood);
    for (let index = 0; index < 120; index++) {
      now += 100;
      viewer.scene.preUpdate.raiseEvent();
    }
    expect(material.uniforms.flowMeters.y).toBeGreaterThan(0);
    expect(material.materials.riverWater!.uniforms.amplitude).toBeGreaterThan(0.22);
    expect(material.materials.riverWater!.uniforms.amplitude).toBeLessThanOrEqual(0.5);
    expect(primitive.geometryInstances).toBe(geometry);
    expect(viewer.scene.groundPrimitives.add).toHaveBeenCalledTimes(1);
    expect(viewer.entities.add).not.toHaveBeenCalled();
    expect(viewer.scene.requestRender.mock.calls.length).toBeGreaterThan(120);
    controller.destroy();
    controller.destroy();
    expect(viewer.scene.preUpdate.numberOfListeners).toBe(0);
    expect(viewer.scene.groundPrimitives.remove).toHaveBeenCalledTimes(1);
    expect(primitive.isDestroyed()).toBe(true);
    expect(material.isDestroyed()).toBe(true);
    const requests = viewer.scene.requestRender.mock.calls.length;
    controller.setHydraulics(normal);
    viewer.scene.preUpdate.raiseEvent();
    expect(viewer.scene.requestRender).toHaveBeenCalledTimes(requests);
  });

  it("does not allocate after viewer destruction during terrain initialization", async () => {
    const viewer = fakeViewer();
    viewer.isDestroyed.mockReturnValue(true);
    const controller = await createRiverWaterSurface(viewer as unknown as Viewer);
    controller.setHydraulics(flood);
    controller.destroy();
    expect(viewer.scene.groundPrimitives.add).not.toHaveBeenCalled();
    expect(viewer.scene.preUpdate.numberOfListeners).toBe(0);
  });

  it("releases the material even if the viewer already destroyed its primitive", async () => {
    const viewer = fakeViewer();
    const controller = await createRiverWaterSurface(viewer as unknown as Viewer);
    const primitive = viewer.scene.groundPrimitives.add.mock.calls[0]![0] as GroundPrimitive;
    const material = primitive.appearance!.material;
    primitive.destroy();
    viewer.isDestroyed.mockReturnValue(true);
    controller.destroy();
    expect(material.isDestroyed()).toBe(true);
    expect(viewer.scene.preUpdate.numberOfListeners).toBe(0);
    expect(viewer.scene.groundPrimitives.remove).not.toHaveBeenCalled();
  });
});
