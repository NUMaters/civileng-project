import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const cesiumSource = join(webRoot, "node_modules", "cesium", "Build", "Cesium");
const dest = join(webRoot, "public", "cesiumStatic");
const folders = ["Assets", "Workers", "Widgets", "ThirdParty"];

if (!existsSync(join(cesiumSource, "Workers"))) {
  console.error("[copy-cesium-assets] Cesium is not installed. Run pnpm install first.");
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

for (const folder of folders) {
  cpSync(join(cesiumSource, folder), join(dest, folder), { recursive: true });
}

console.log(`[copy-cesium-assets] Copied Cesium static assets to ${dest}`);
