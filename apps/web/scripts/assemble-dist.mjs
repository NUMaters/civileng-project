/**
 * iCloud 上の dist を /tmp へ再構成（Cesium 静的ファイルを含む完全な Pages 成果物）。
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.env.CIVILCRAFT_OUT_DIR ?? "/tmp/civilcraft-web-dist";
const cesiumSource = path.join(webRoot, "node_modules", "cesium", "Build", "Cesium");
const cesiumFolders = ["Assets", "Workers", "Widgets", "ThirdParty"];
const slimFiles = ["_redirects", "_headers", "manifest.webmanifest"];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const distSrc = path.join(webRoot, "dist");
if (!existsSync(path.join(distSrc, "index.html"))) {
  console.error(`[assemble-dist] missing ${distSrc}/index.html — run build first`);
  process.exit(1);
}

cpSync(path.join(distSrc, "index.html"), path.join(outDir, "index.html"));
cpSync(path.join(distSrc, "assets"), path.join(outDir, "assets"), { recursive: true });

const cesiumOut = path.join(outDir, "cesiumStatic");
mkdirSync(cesiumOut, { recursive: true });
for (const folder of cesiumFolders) {
  const from = path.join(cesiumSource, folder);
  if (!existsSync(from)) {
    console.error(`[assemble-dist] missing Cesium folder: ${from}`);
    process.exit(1);
  }
  cpSync(from, path.join(cesiumOut, folder), { recursive: true });
  console.log(`[assemble-dist] copied ${folder}`);
}

for (const name of slimFiles) {
  const from = path.join(webRoot, "public", name);
  if (existsSync(from)) {
    cpSync(from, path.join(outDir, name));
  }
}
const iconsFrom = path.join(webRoot, "public", "icons");
if (existsSync(iconsFrom)) {
  cpSync(iconsFrom, path.join(outDir, "icons"), { recursive: true });
}

console.log(`[assemble-dist] ready → ${outDir}`);
