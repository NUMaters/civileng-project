import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ABUKUMA_RIVER_CENTERLINE } from "./abukumaRiverGeometry";
import { geoToWorld } from "./dioramaSpace";
import { createGeographicWaterMaterial, riverFlowCoordinates } from "./geographicWater";

describe("Abukuma water coordinates", () => {
  it("increases station northward along every source centreline vertex", () => {
    let previous = -1;
    for (const point of ABUKUMA_RIVER_CENTERLINE) {
      const p = geoToWorld(point.lon, point.lat);
      const coordinate = riverFlowCoordinates(p.x, p.z);
      expect(coordinate.along).toBeGreaterThan(previous);
      expect(coordinate.lateral).toBeCloseTo(0, 6);
      previous = coordinate.along;
    }
  });
  it("retains metres across the channel instead of clamping to an assumed width", () => {
    const p = geoToWorld(140.3843219, 37.36762);
    expect(riverFlowCoordinates(p.x + 140, p.z).lateral).toBeGreaterThan(100);
    expect(riverFlowCoordinates(p.x - 140, p.z).lateral).toBeLessThan(-100);
  });
  it("does not displace the source surface away from picking geometry", () => {
    const material = createGeographicWaterMaterial();
    expect(material.vertexShader).toContain("vec4(position,1.)");
    expect(material.vertexShader).not.toContain("sin(");
    expect(material.transparent).toBe(false);
    material.dispose();
  });
  it("shades waves without reflection textures or extra transparent passes", () => {
    const material = createGeographicWaterMaterial();
    expect(material.fragmentShader).toContain("cameraPosition-waterWorldPosition");
    expect(material.fragmentShader).toContain("length(fwidth(p))");
    expect(material.fragmentShader).not.toContain("sampler2D");
    expect(material.depthWrite).toBe(true);
    expect(Object.keys(material.uniforms)).toEqual(["time", "storm", "bodyLow", "bodyHigh", "skyTint", "foamTint", "stormTint"]);
    expect(material.uniforms.bodyHigh!.value).toEqual(new THREE.Color("#00b5dc"));
    expect(material.uniforms.bodyHigh!.value.g).toBeLessThan(181 / 255); // sRGB->linear, not double-bright literals
    expect(material.fragmentShader).toContain("clamp(storm,0.,1.)*.55");
    expect(material.fragmentShader).toContain("#include <tonemapping_fragment>");
    expect(material.fragmentShader).toContain("#include <colorspace_fragment>");
    expect(material.userData.provenance).toContain("no invented shoreline foam or bathymetry");
    expect(material.userData.provenance).toContain("not measured speed, depth");
    material.dispose();
  });
});
