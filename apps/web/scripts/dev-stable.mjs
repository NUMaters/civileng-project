#!/usr/bin/env node
/**
 * iCloud Documents 配下でも落ちにくい開発サーバー。
 * - ファイル監視オフ（HMR なし）
 * - キャッシュはホーム配下（iCloud 外）
 * - 落ちたら自動再起動
 * - PID ロックで二重起動を防ぐ
 *
 * 使い方: pnpm dev / pnpm --filter @civilcraft/web dev
 * 停止:   pnpm --filter @civilcraft/web stop:dev
 */
import { createServer } from "vite";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withEsbuildEnv } from "./resolve-esbuild-path.mjs";

const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheRoot = path.join(homedir(), ".cache", "civilcraft");
const pidPath = path.join(cacheRoot, "vite-dev.pid");
const readyPath = path.join(cacheRoot, "vite-dev.ready");
const PORT = Number(process.env.CIVILCRAFT_WEB_PORT ?? 5173);
const HOST = process.env.CIVILCRAFT_WEB_HOST ?? "0.0.0.0";

mkdirSync(cacheRoot, { recursive: true });

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid() {
  try {
    const raw = readFileSync(pidPath, "utf8").trim();
    return Number.parseInt(raw, 10);
  } catch {
    return NaN;
  }
}

async function portResponds() {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/__civilcraft_health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function claimLock() {
  const existing = readPid();
  if (isPidAlive(existing) && existing !== process.pid) {
    log(`already running (pid ${existing}). exit.`);
    process.exit(0);
  }
  writeFileSync(pidPath, `${process.pid}\n`);
  writeFileSync(readyPath, "");
}

function releaseLock() {
  const existing = readPid();
  if (existing === process.pid && existsSync(pidPath)) {
    unlinkSync(pidPath);
  }
  if (existsSync(readyPath)) {
    try {
      unlinkSync(readyPath);
    } catch {
      // ignore
    }
  }
}

process.title = "civilcraft-web-dev";
Object.assign(process.env, withEsbuildEnv(process.env));
process.env.CIVILCRAFT_DEV_STABLE = "1";

let stopping = false;
let childServer = null;
let restartCount = 0;

async function startOnce() {
  log(`starting vite on ${HOST}:${PORT} (restart #${restartCount})`);
  const server = await createServer({
    configFile: path.join(webRoot, "vite.config.ts"),
    root: webRoot,
    cacheDir: path.join(cacheRoot, "vite"),
    optimizeDeps: {
      noDiscovery: true,
      include: [
        "cesium",
        "mersenne-twister",
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-dev-runtime",
        "react/jsx-runtime",
      ],
      entries: ["index.html", "src/main.tsx"],
    },
    server: {
      host: HOST,
      port: PORT,
      strictPort: true,
      watch: null,
      hmr: false,
      warmup: {
        clientFiles: [],
      },
    },
    plugins: [
      {
        name: "civilcraft-health",
        configureServer(viteServer) {
          viteServer.middlewares.use((req, res, next) => {
            if ((req.url ?? "").split("?")[0] === "/__civilcraft_health") {
              res.statusCode = 200;
              res.setHeader("Content-Type", "application/json");
              res.end(
                JSON.stringify({
                  ok: true,
                  pid: process.pid,
                  uptimeSec: Math.round(process.uptime()),
                }),
              );
              return;
            }
            next();
          });
        },
      },
    ],
  });

  await server.listen();
  server.printUrls();
  writeFileSync(readyPath, `ok pid=${process.pid}\n`);
  log("listening");
  childServer = server;

  // Vite が内部エラーで黙って止まるケースに備え、連続失敗時だけ再起動する。
  let failStreak = 0;
  const healthTimer = setInterval(() => {
    void (async () => {
      if (stopping) {
        return;
      }
      const ok = await portResponds();
      if (ok) {
        failStreak = 0;
        return;
      }
      failStreak += 1;
      log(`health miss ${failStreak}/3`);
      if (failStreak < 3) {
        return;
      }
      log("health check failed — restarting");
      clearInterval(healthTimer);
      try {
        await server.close();
      } catch {
        // ignore
      }
      childServer = null;
    })();
  }, 10_000);

  return await new Promise((resolve) => {
    const onClose = () => {
      clearInterval(healthTimer);
      resolve("closed");
    };
    // httpServer が閉じたら再起動ループへ
    const httpServer = server.httpServer;
    if (httpServer) {
      httpServer.once("close", onClose);
    } else {
      // fallback: never auto-resolve unless we closed
      setTimeout(() => undefined, 0);
    }
  });
}

async function main() {
  claimLock();
  log(`supervisor start pid=${process.pid}`);

  const shutdown = async (signal) => {
    if (stopping) {
      return;
    }
    stopping = true;
    log(`shutdown (${signal})`);
    try {
      if (childServer) {
        await childServer.close();
      }
    } catch {
      // ignore
    }
    releaseLock();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGHUP", () => {
    // 端末切断では落とさない（安定稼働優先）
    log("ignored SIGHUP");
  });

  while (!stopping) {
    try {
      await startOnce();
    } catch (error) {
      log(`vite error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    }
    if (stopping) {
      break;
    }
    restartCount += 1;
    const waitMs = Math.min(15_000, 800 * restartCount);
    log(`restarting in ${waitMs}ms…`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  releaseLock();
}

// 既に応答できるサーバーがいれば二重起動しない
if (await portResponds()) {
  log(`port ${PORT} already healthy — leave it running`);
  process.exit(0);
}

await main();
