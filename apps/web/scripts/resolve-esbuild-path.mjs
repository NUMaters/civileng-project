/**
 * pnpm 配下の esbuild 実行ファイルを解決し、子プロセス env に渡す。
 * iCloud / サンドボックスで esbuild サービスが落ちる場合の回避用。
 */
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function findInPnpmStore(nodeModulesDir) {
  const pnpmDir = path.join(nodeModulesDir, ".pnpm");
  if (!existsSync(pnpmDir)) {
    return undefined;
  }
  for (const entry of readdirSync(pnpmDir)) {
    if (!entry.startsWith("esbuild@")) {
      continue;
    }
    const candidate = path.join(pnpmDir, entry, "node_modules", "esbuild", "bin", "esbuild");
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function resolveEsbuildBinaryPath() {
  let dir = webRoot;
  for (let depth = 0; depth < 8; depth += 1) {
    const direct = path.join(dir, "node_modules", "esbuild", "bin", "esbuild");
    if (existsSync(direct)) {
      return direct;
    }
    const fromPnpm = findInPnpmStore(path.join(dir, "node_modules"));
    if (fromPnpm !== undefined) {
      return fromPnpm;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  try {
    const require = createRequire(path.join(webRoot, "package.json"));
    const pkgPath = require.resolve("esbuild/package.json");
    const candidate = path.join(path.dirname(pkgPath), "bin", "esbuild");
    if (existsSync(candidate)) {
      return candidate;
    }
  } catch {
    // fall through
  }
  return undefined;
}

/** spawn / createServer 用の env（既存の ESBUILD_BINARY_PATH を尊重）。 */
export function withEsbuildEnv(baseEnv = process.env) {
  const binary = baseEnv.ESBUILD_BINARY_PATH ?? resolveEsbuildBinaryPath();
  if (binary === undefined || binary === "") {
    return { ...baseEnv };
  }
  return { ...baseEnv, ESBUILD_BINARY_PATH: binary };
}
