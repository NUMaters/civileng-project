/**
 * 本番ビルド用ラッパ（plateau 除外は vite 側 publicDir=false で実施）。
 */
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withEsbuildEnv } from "./resolve-esbuild-path.mjs";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir =
  process.env.CIVILCRAFT_OUT_DIR ??
  (process.env.CI === "true"
    ? path.join(webRoot, "dist")
    : path.join(homedir(), ".cache", "civilcraft", "web-dist"));

console.log(
  `[build-web] outDir=${outDir} includePlateau=${process.env.CIVILCRAFT_INCLUDE_PLATEAU === "1"}`,
);

const buildEnv = withEsbuildEnv({ ...process.env, CIVILCRAFT_OUT_DIR: outDir });

if (process.env.CIVILCRAFT_SKIP_TSC !== "1") {
  const tsc = spawnSync("pnpm", ["exec", "tsc", "--noEmit"], {
    cwd: webRoot,
    stdio: "inherit",
    env: buildEnv,
    shell: process.platform === "win32",
  });
  if (tsc.status !== 0) {
    process.exit(tsc.status ?? 1);
  }
}

const vite = spawnSync("pnpm", ["exec", "vite", "build"], {
  cwd: webRoot,
  stdio: "inherit",
  env: buildEnv,
  shell: process.platform === "win32",
});
if (vite.status !== 0) {
  process.exit(vite.status ?? 1);
}

const prepare = spawnSync("node", ["./scripts/pages-prepare.mjs"], {
  cwd: webRoot,
  stdio: "inherit",
  env: buildEnv,
});
if (prepare.status !== 0) {
  process.exit(prepare.status ?? 1);
}

console.log(`[build-web] done → ${outDir}`);
