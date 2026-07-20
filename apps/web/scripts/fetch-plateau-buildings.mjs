/**
 * 郡山市のテクスチャ付き建築物 3D Tiles を公式 ZIP から取得する。
 * PLATEAU VIEW の `07203-bldg-lod2-texture-latest` は実体がテクスチャ無しのため使わない。
 */
import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, "..");
const outDir = join(webRoot, "public", "plateau", "koriyama-bldg-texture");
const tilesetPath = join(outDir, "tileset.json");
const cacheZip = join(webRoot, ".cache", "07203_koriyama-shi_2020_3Dtiles_etc_1_op.zip");
const extractRoot = join(webRoot, ".cache", "plateau-extract");
const ZIP_URL =
  "https://gic-plateau.s3.ap-northeast-1.amazonaws.com/2020/07203_koriyama-shi_2020_3Dtiles_etc_1_op.zip";
const ZIP_INNER_PREFIX =
  "07203_koriyama-shi_2020_3Dtiles_etc_1_op/01_building/07203_koriyama-shi_2020_bldg_texture/";

if (existsSync(tilesetPath) && !process.argv.includes("--force")) {
  console.log(`Already present: ${tilesetPath}`);
  process.exit(0);
}

mkdirSync(dirname(cacheZip), { recursive: true });

if (!existsSync(cacheZip) || process.argv.includes("--force")) {
  console.log("Downloading Koriyama textured 3D Tiles zip (~390MB)...");
  const response = await fetch(ZIP_URL);
  if (!response.ok || response.body === null) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(cacheZip));
  console.log(`Saved ${cacheZip}`);
}

console.log("Extracting bldg_texture ...");
rmSync(outDir, { recursive: true, force: true });
rmSync(extractRoot, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
mkdirSync(extractRoot, { recursive: true });

execFileSync(
  "unzip",
  ["-o", cacheZip, `${ZIP_INNER_PREFIX}*`, "-d", extractRoot],
  { stdio: "inherit" },
);

const extracted = join(
  extractRoot,
  "07203_koriyama-shi_2020_3Dtiles_etc_1_op",
  "01_building",
  "07203_koriyama-shi_2020_bldg_texture",
);

execFileSync("cp", ["-R", `${extracted}/.`, outDir], { stdio: "inherit" });
rmSync(extractRoot, { recursive: true, force: true });

if (!existsSync(tilesetPath)) {
  throw new Error(`Extraction failed; missing ${tilesetPath}`);
}

console.log(`Ready: ${tilesetPath}`);
