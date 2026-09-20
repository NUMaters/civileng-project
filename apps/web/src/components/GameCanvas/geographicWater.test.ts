import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ABUKUMA_RIVER_CENTERLINE } from "./abukumaRiverGeometry";
import { disposeDioramaObject } from "./disposeDioramaObject";
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
    expect(material.vertexShader).toContain("vec4(transformed,1.)");
    expect(material.vertexShader).not.toContain("sin(");
    expect(material.transparent).toBe(false);
    material.dispose();
  });
  it("shades waves without reflection textures or extra transparent passes", () => {
    const material = createGeographicWaterMaterial();
    expect(material.fragmentShader).toContain("cameraPosition-waterWorldPosition");
    expect(material.fragmentShader).toContain("length(fwidth(p))");
    expect(material.depthWrite).toBe(true);
    expect(material.uniforms.ambientLightColor).toBeDefined();
    expect(material.uniforms.directionalLights).toBeDefined();
    expect(material.uniforms.directionalLightShadows).toBeDefined();
    expect(material.uniforms.time).toBeDefined();
    expect(material.uniforms.storm).toBeDefined();
    expect(material.uniforms.bodyHigh!.value).toEqual(new THREE.Color("#00b5dc"));
    expect(material.uniforms.bodyHigh!.value.g).toBeLessThan(181 / 255); // sRGB->linear, not double-bright literals
    expect(material.fragmentShader).toContain("clamp(storm,0.,1.)*.55");
    expect(material.fragmentShader).toContain("#include <tonemapping_fragment>");
    expect(material.fragmentShader).toContain("#include <colorspace_fragment>");
    expect(material.lights).toBe(true);
    expect(material.vertexShader).toContain("#include <normal_pars_vertex>");
    expect(material.vertexShader).toContain("#include <shadowmap_pars_vertex>");
    expect(material.vertexShader).toContain("#ifdef USE_SHADOWMAP");
    expect(material.vertexShader).toContain("vec4 worldPosition=waterWorldPosition4;");
    expect(material.fragmentShader).toContain("#include <lights_pars_begin>");
    expect(material.fragmentShader).toContain("#include <packing>");
    expect(material.fragmentShader).toContain("#include <shadowmap_pars_fragment>");
    expect(material.fragmentShader).not.toContain("getShadowMask()");
    expect(material.fragmentShader).toContain("riverStructureShadow()");
    expect(material.fragmentShader).toContain("vec3(.55,.68,.80)");
    expect(material.fragmentShader.match(/texture\(directionalShadowMap/g)).toHaveLength(1);
    expect(material.fragmentShader).toContain("if(!receiveShadow) return 1.");
    expect(material.fragmentShader).toContain("NUM_DIR_LIGHT_SHADOWS > 0");
    expect(material.userData.provenance).toContain("no invented shoreline foam or bathymetry");
    expect(material.userData.provenance).toContain("not measured speed, depth");
    material.dispose();
  });

  it("uses transformed world normals for shadow bias and disposes as a scene-owned material", () => {
    const material = createGeographicWaterMaterial();
    const geometry = new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    const scene = new THREE.Group(); scene.add(mesh);
    let disposed = false;
    material.addEventListener("dispose", () => { disposed = true; });
    expect(material.vertexShader).toContain("#include <defaultnormal_vertex>");
    expect(material.vertexShader).toContain("vec4 waterWorldPosition4=modelMatrix*vec4(transformed,1.);");
    expect(material.vertexShader).not.toContain("#include <worldpos_vertex>");
    disposeDioramaObject(scene);
    expect(disposed).toBe(true);
  });
});
