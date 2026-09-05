import react from "@vitejs/plugin-react-swc";
import { createReadStream, cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const cesiumSource = path.resolve(webRoot, "node_modules/cesium/Build/Cesium");
const cesiumBaseUrl = "cesiumStatic";
const cesiumFolders = ["Assets", "Workers", "Widgets", "ThirdParty"] as const;
/** iCloud Documents 外に置き、キャッシュ読み書きでのハングを避ける。 */
const viteCacheDir = path.join(homedir(), ".cache", "civilcraft", "vite");
/**
 * ビルド出力先。
 * - CI / 明示指定: CIVILCRAFT_OUT_DIR または相対 dist
 * - ローカル（iCloud Documents 配下）: ~/.cache/civilcraft/web-dist へ逃がす
 */
const viteOutDir =
  process.env.CIVILCRAFT_OUT_DIR ??
  (process.env.CI === "true"
    ? path.resolve(webRoot, "dist")
    : path.join(homedir(), ".cache", "civilcraft", "web-dist"));
const includePlateauPublic = process.env.CIVILCRAFT_INCLUDE_PLATEAU === "1";
const stableDev = process.env.CIVILCRAFT_DEV_STABLE === "1";

const MIME: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".wasm": "application/wasm",
};

function sendFile(res: ServerResponse, filePath: string): void {
  const ext = path.extname(filePath);
  res.statusCode = 200;
  res.setHeader("Content-Type", MIME[ext] ?? "application/octet-stream");
  res.setHeader("Cache-Control", "no-cache");
  createReadStream(filePath).pipe(res);
}

function serveCesiumAssets(): Plugin {
  const prefix = `/${cesiumBaseUrl}/`;

  return {
    name: "civilcraft-serve-cesium",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next) => {
        const url = req.url ?? "";
        if (!url.startsWith(prefix)) {
          next();
          return;
        }

        const relativePath = decodeURIComponent(
          url.slice(prefix.length).split("?")[0] ?? "",
        );
        if (relativePath === "" || relativePath.includes("..")) {
          res.statusCode = 400;
          res.end("bad path");
          return;
        }

        const filePath = path.resolve(cesiumSource, relativePath);
        if (
          !filePath.startsWith(cesiumSource + path.sep) ||
          !existsSync(filePath) ||
          !statSync(filePath).isFile()
        ) {
          res.statusCode = 404;
          res.end(`not found: ${relativePath}`);
          return;
        }

        sendFile(res, filePath);
      });
    },
    closeBundle() {
      const outDir = path.resolve(viteOutDir, cesiumBaseUrl);
      rmSync(outDir, { recursive: true, force: true });
      mkdirSync(outDir, { recursive: true });
      for (const folder of cesiumFolders) {
        const from = path.join(cesiumSource, folder);
        if (!existsSync(from)) {
          throw new Error(`Missing Cesium folder: ${from}`);
        }
        cpSync(from, path.join(outDir, folder), { recursive: true });
      }
    },
  };
}

/** 本番では plateau を除く public だけを成果物へ載せる。 */
function copySlimPublicAssets(): Plugin {
  const slimFiles = ["_redirects", "_headers", "manifest.webmanifest"] as const;
  return {
    name: "civilcraft-copy-slim-public",
    apply: "build",
    closeBundle() {
      if (includePlateauPublic) {
        return;
      }
      mkdirSync(viteOutDir, { recursive: true });
      for (const name of slimFiles) {
        const from = path.join(webRoot, "public", name);
        if (existsSync(from)) {
          cpSync(from, path.join(viteOutDir, name));
        }
      }
      const iconsFrom = path.join(webRoot, "public", "icons");
      if (existsSync(iconsFrom)) {
        cpSync(iconsFrom, path.join(viteOutDir, "icons"), { recursive: true });
      }
    },
  };
}

function attachGsiTileProxy(
  middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void },
): void {
  middlewares.use((req: IncomingMessage, res: ServerResponse, next) => {
    const url = req.url ?? "";
    if (!url.startsWith("/gsi-tiles/")) {
      next();
      return;
    }

    const relativePath = decodeURIComponent(url.slice("/gsi-tiles".length).split("?")[0] ?? "");
    if (relativePath === "" || relativePath.includes("..")) {
      res.statusCode = 400;
      res.end("bad path");
      return;
    }

    const target = `https://cyberjapandata.gsi.go.jp/xyz${relativePath}`;
    void fetch(target)
      .then(async (upstream) => {
        if (!upstream.ok) {
          res.statusCode = upstream.status;
          res.end(`gsi upstream ${upstream.status}`);
          return;
        }
        const buffer = Buffer.from(await upstream.arrayBuffer());
        res.statusCode = 200;
        res.setHeader(
          "Content-Type",
          upstream.headers.get("content-type") ?? "image/jpeg",
        );
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.end(buffer);
      })
      .catch((error: unknown) => {
        res.statusCode = 502;
        res.end(error instanceof Error ? error.message : "gsi proxy failed");
      });
  });
}

/** 地理院タイルを同一オリジンで返す（SPA フォールバックで HTML が混入するのを防ぐ）。 */
function proxyGsiTiles(): Plugin {
  return {
    name: "civilcraft-proxy-gsi",
    enforce: "pre",
    configureServer(server) {
      attachGsiTileProxy(server.middlewares);
    },
    configurePreviewServer(server) {
      attachGsiTileProxy(server.middlewares);
    },
  };
}

export default defineConfig(({ command }) => ({
  define: {
    CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}`),
  },
  cacheDir: viteCacheDir,
  // 開発時はアイコン等をそのまま配信する。ビルド時だけ巨大な plateau を除外し、
  // copySlimPublicAssets で必要な公開ファイルだけを成果物へ入れる。
  publicDir: command === "serve" || includePlateauPublic ? "public" : false,
  plugins: [react(), serveCesiumAssets(), copySlimPublicAssets(), proxyGsiTiles()],
  optimizeDeps: {
    // Cesium pulls CommonJS deps (e.g. mersenne-twister). Prebundle them so
    // Vite does not request a non-existent default ESM export at runtime.
    include: [
      "cesium",
      "mersenne-twister",
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-dev-runtime",
      "react/jsx-runtime",
    ],
    // iCloud Drive 上の巨大 node_modules クロールで起動が止まるのを防ぐ
    noDiscovery: true,
    entries: ["index.html", "src/main.tsx"],
  },
  build: {
    outDir: viteOutDir,
    emptyOutDir: true,
    chunkSizeWarningLimit: 5000,
  },
  server: {
    port: 5173,
    // 同一 LAN / テザリングのスマホからも届くよう全インターフェースで待ち受ける
    host: "0.0.0.0",
    strictPort: true,
    fs: {
      allow: [path.resolve(webRoot, "../..")],
    },
    // 安定起動（dev-stable）では HMR / 監視を切り、iCloud 起因の停止を防ぐ
    ...(stableDev
      ? { hmr: false, watch: null }
      : {
          watch: {
            // Documents/iCloud 配下の巨大ツリー監視で起動・HMR が止まるのを防ぐ
            ignored: ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/.cache/**"],
          },
        }),
    proxy: {
      // ゲームサーバー WebSocket（cmd/game GET /ws）
      "/ws": {
        target: "ws://127.0.0.1:8081",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "node",
  },
}));
