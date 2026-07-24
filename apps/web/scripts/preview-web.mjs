/**
 * vite preview をビルド成果物ディレクトリに向けて起動する。
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
  console.error(`[preview-web] missing ${path.join(outDir, "index.html")}. Run pnpm build first.`);
  process.exit(1);
}

const result = spawnSync(
  "pnpm",
  ["exec", "vite", "preview", "--outDir", outDir, "--host", "127.0.0.1", "--port", "4173"],
  {
    cwd: webRoot,
    stdio: "inherit",
    env: { ...process.env, CIVILCRAFT_OUT_DIR: outDir },
    shell: process.platform === "win32",
  },
);
process.exit(result.status ?? 1);
