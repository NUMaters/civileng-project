#!/usr/bin/env node
/** 安定開発サーバーを停止する。 */
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const cacheRoot = path.join(homedir(), ".cache", "civilcraft");
const pidPath = path.join(cacheRoot, "vite-dev.pid");
const readyPath = path.join(cacheRoot, "vite-dev.ready");
const PORT = Number(process.env.CIVILCRAFT_WEB_PORT ?? 5173);

function readPid() {
  try {
    return Number.parseInt(readFileSync(pidPath, "utf8").trim(), 10);
  } catch {
    return NaN;
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const pid = readPid();
if (Number.isInteger(pid) && isAlive(pid)) {
  process.kill(pid, "SIGTERM");
  console.log(`[stop:dev] sent SIGTERM to ${pid}`);
} else {
  console.log("[stop:dev] no pidfile process");
}

// ポートを掴んでいる残骸も掃除
try {
  const { execSync } = await import("node:child_process");
  const out = execSync(`lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t`, {
    encoding: "utf8",
  }).trim();
  for (const line of out.split("\n").filter(Boolean)) {
    const p = Number.parseInt(line, 10);
    if (Number.isInteger(p) && p > 0) {
      try {
        process.kill(p, "SIGTERM");
        console.log(`[stop:dev] freed port ${PORT} (pid ${p})`);
      } catch {
        // ignore
      }
    }
  }
} catch {
  // no listener
}

if (existsSync(pidPath)) {
  unlinkSync(pidPath);
}
if (existsSync(readyPath)) {
  unlinkSync(readyPath);
}
