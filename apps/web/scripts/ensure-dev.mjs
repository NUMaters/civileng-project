#!/usr/bin/env node
/**
 * 開発サーバーをデタッチ起動する（端末を閉じても落ちにくい）。
 * Cursor / シェル終了後も Listen し続ける。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheRoot = path.join(homedir(), ".cache", "civilcraft");
const logPath = path.join(cacheRoot, "vite-dev.log");
const script = path.join(webRoot, "scripts", "dev-stable.mjs");

mkdirSync(cacheRoot, { recursive: true });

// 既に生きていれば何もしない
try {
  const res = await fetch("http://127.0.0.1:5173/__civilcraft_health", {
    signal: AbortSignal.timeout(1200),
  });
  if (res.ok) {
    console.log("[ensure-dev] already healthy on :5173");
    process.exit(0);
  }
} catch {
  // start below
}

if (!existsSync(script)) {
  console.error("[ensure-dev] missing", script);
  process.exit(1);
}

const out = openSync(logPath, "a");
const child = spawn(process.execPath, [script], {
  cwd: webRoot,
  detached: true,
  stdio: ["ignore", out, out],
  env: {
    ...process.env,
    CIVILCRAFT_DEV_STABLE: "1",
  },
});
child.unref();
console.log(`[ensure-dev] spawned pid=${child.pid} log=${logPath}`);

for (let i = 0; i < 40; i += 1) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const res = await fetch("http://127.0.0.1:5173/__civilcraft_health", {
      signal: AbortSignal.timeout(1000),
    });
    if (res.ok) {
      const body = await res.json();
      console.log("[ensure-dev] ready", body);
      process.exit(0);
    }
  } catch {
    // retry
  }
}

console.error("[ensure-dev] timed out waiting for :5173 — see", logPath);
process.exit(1);
