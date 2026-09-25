/**
 * Cloudflare Pages へ dist をデプロイする。
 * 出力先は build-web と同じ解決規則（CI=apps/web/dist、ローカル=~/.cache/...）。
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir =
  process.env.CIVILCRAFT_OUT_DIR ??
  (process.env.CI === "true"
    ? path.join(webRoot, "dist")
    : path.join(homedir(), ".cache", "civilcraft", "web-dist"));

if (!existsSync(path.join(outDir, "index.html"))) {
  console.error(`[pages-deploy] missing index.html in ${outDir}. Run pnpm build first.`);
  process.exit(1);
}

console.log(`[pages-deploy] deploying ${outDir}`);
const result = spawnSync(
  "pnpm",
  ["exec", "wrangler", "pages", "deploy", outDir, "--project-name=civilcraft"],
  {
    cwd: webRoot,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  },
);
process.exit(result.status ?? 1);
