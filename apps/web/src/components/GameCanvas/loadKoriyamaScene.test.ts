import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { loadKoriyamaScene } from "./loadKoriyamaScene";

const base = new URL("../../../public", import.meta.url);
afterEach(() => vi.unstubAllGlobals());
describe("bundled scene loading", () => {
  it("loads all bundled source snapshots with one cancellation signal", async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      expect(init.signal).toBe(signal);
      const bytes = readFileSync(new URL(`.${url}`, `${base.href}/`));
      return new Response(Uint8Array.from(bytes));
    });
    vi.stubGlobal("fetch", fetcher);
    const scene = await loadKoriyamaScene(signal);
    expect(fetcher).toHaveBeenCalledTimes(7);
    expect(scene.canopyPatches.map(patch => patch.id)).toEqual([
      "campus-north-grove-core", "campus-west-grove-core",
      "campus-central-grove-core", "campus-south-building-grove",
      "riverbank-south-canopy-core", "riverbank-middle-canopy-core", "riverbank-north-canopy-core",
      "riverbank-upper-confluence-grove", "riverbank-east-upper-tree-line",
      "riverbank-east-middle-grove", "riverbank-west-middle-grove",
      "riverbank-west-south-tree-line", "riverbank-east-south-tree-line",
    ]);
    expect(scene.canopyPatches.slice(4).every(patch => patch.observationView?.layer === "seamlessphoto")).toBe(true);
    expect(scene.imageryTrees).toHaveLength(91);
    expect(scene.imageryTrees[0]!.positionSource).toBe("imagery-inferred");
    expect(scene.landcover.features.filter(feature => feature.properties.kind === "tree")).toHaveLength(234);
    expect(scene.plateau.features).toHaveLength(9561);
    expect(scene.osm.features.length).toBeGreaterThan(20000);
    expect(scene.terrain.metadata.localDatumM).toBe(230);
  });
  it("surfaces HTTP failures instead of silently loading a fictional fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));
    await expect(loadKoriyamaScene(new AbortController().signal)).rejects.toThrow("503");
  });
});
