import { KORIYAMA_GEODATA_URL, type KoriyamaGeodata } from "./koriyamaGeodata";
import { KORIYAMA_PLATEAU_URL, type KoriyamaPlateauGeodata } from "./koriyamaPlateauGeodata";
import { decodeKoriyamaTerrain, type KoriyamaTerrainMetadata } from "./koriyamaTerrain";

/** Load only locally bundled source snapshots. Abort on unmount; never substitute an invented city. */
export async function loadKoriyamaScene(signal: AbortSignal) {
  const read = async (url: string) => {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`地理データを読み込めません (${response.status}): ${url}`);
    return response;
  };
  const [osm, plateau, metadata, binary] = await Promise.all([
    read(KORIYAMA_GEODATA_URL).then(r => r.json() as Promise<KoriyamaGeodata>),
    read(KORIYAMA_PLATEAU_URL).then(r => r.json() as Promise<KoriyamaPlateauGeodata>),
    read("/geodata/koriyama/terrain-metadata.json").then(r => r.json() as Promise<KoriyamaTerrainMetadata>),
    read("/geodata/koriyama/terrain.bin").then(r => r.arrayBuffer()),
  ]);
  signal.throwIfAborted();
  for (const collection of [osm, plateau]) {
    if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features) || !collection.features.length)
      throw new Error("地理データの形式を確認してください");
  }
  return { osm, plateau, terrain: decodeKoriyamaTerrain(binary, metadata) };
}
export type KoriyamaSceneData = Awaited<ReturnType<typeof loadKoriyamaScene>>;
