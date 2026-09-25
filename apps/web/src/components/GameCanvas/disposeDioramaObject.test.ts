import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { disposeDioramaObject } from "./disposeDioramaObject";

afterEach(() => vi.restoreAllMocks());

describe("disposeDioramaObject", () => {
  it("disposes shared geometry/materials exactly once including duplicate material-array entries", () => {
    const root = new THREE.Group(), nested = new THREE.Group();
    const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial(), other = new THREE.MeshBasicMaterial();
    const geometryDispose = vi.spyOn(geometry, "dispose"), materialDispose = vi.spyOn(material, "dispose"), otherDispose = vi.spyOn(other, "dispose");
    root.add(new THREE.Mesh(geometry, material), nested);
    nested.add(new THREE.Mesh(geometry, [material, other, material]));
    disposeDioramaObject(root);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(otherDispose).toHaveBeenCalledTimes(1);
    expect(nested.parent).toBe(root);
    expect(nested.children).toHaveLength(1);
  });

  it("disposes each InstancedMesh while sharing its geometry and material", () => {
    const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial(), root = new THREE.Group();
    const a = new THREE.InstancedMesh(geometry, material, 2), b = new THREE.InstancedMesh(geometry, material, 3);
    root.add(a, b);
    const ad = vi.spyOn(a, "dispose"), bd = vi.spyOn(b, "dispose");
    const gd = vi.spyOn(geometry, "dispose"), md = vi.spyOn(material, "dispose");
    disposeDioramaObject(root);
    for (const spy of [ad, bd, gd, md]) expect(spy).toHaveBeenCalledTimes(1);
  });

  it("releases DirectionalLight shadow.map and mapPass through the light's own dispose method", () => {
    const light = new THREE.DirectionalLight();
    light.shadow.map = new THREE.WebGLRenderTarget(8, 8);
    light.shadow.mapPass = new THREE.WebGLRenderTarget(8, 8);
    const ld = vi.spyOn(light, "dispose"), sd = vi.spyOn(light.shadow, "dispose");
    const mapDispose = vi.spyOn(light.shadow.map, "dispose"), passDispose = vi.spyOn(light.shadow.mapPass, "dispose");
    // Root is itself a Light; no renderer or WebGL context needed.
    disposeDioramaObject(light);
    for (const spy of [ld, sd, mapDispose, passDispose]) expect(spy).toHaveBeenCalledTimes(1);
  });

  it("also disposes other Light subclasses, including lights with unallocated shadows", () => {
    const root = new THREE.Scene();
    const lights = [new THREE.AmbientLight(), new THREE.HemisphereLight(), new THREE.PointLight(), new THREE.SpotLight()];
    root.add(...lights);
    const spies = lights.map((light) => vi.spyOn(light, "dispose"));
    disposeDioramaObject(root);
    spies.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
  });

  it("does not dispose externally owned material/background/environment textures", () => {
    const texture = new THREE.Texture(), root = new THREE.Scene();
    const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial({ map: texture, normalMap: texture });
    root.background = texture; root.environment = texture;
    root.add(new THREE.Mesh(geometry, material));
    const td = vi.spyOn(texture, "dispose"), md = vi.spyOn(material, "dispose");
    disposeDioramaObject(root);
    expect(md).toHaveBeenCalledTimes(1);
    expect(td).not.toHaveBeenCalled();
    expect(root.background).toBe(texture); expect(root.environment).toBe(texture);
    texture.dispose();
  });
});
