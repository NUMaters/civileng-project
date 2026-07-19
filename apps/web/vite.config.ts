import react from "@vitejs/plugin-react-swc";
import { createReadStream, cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const cesiumSource = path.resolve(webRoot, "node_modules/cesium/Build/Cesium");
const cesiumBaseUrl = "cesiumStatic";
const cesiumFolders = ["Assets", "Workers", "Widgets", "ThirdParty"] as const;

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
      const outDir = path.resolve(webRoot, "dist", cesiumBaseUrl);
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

export default defineConfig({
  define: {
    CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}`),
  },
  plugins: [react(), serveCesiumAssets(), proxyGsiTiles()],
  optimizeDeps: {
    // Cesium pulls CommonJS deps (e.g. mersenne-twister). Prebundle them so
    // Vite does not request a non-existent default ESM export at runtime.
    include: ["cesium", "mersenne-twister"],
  },
  build: {
    chunkSizeWarningLimit: 5000,
  },
  server: {
    port: 5173,
    host: true,
    strictPort: true,
    proxy: {
      // ゲームサーバー WebSocket（cmd/game GET /ws）
      "/ws": {
        target: "ws://127.0.0.1:8081",
        ws: true,
        changeOrigin: true,
      },
    },
    watch: {
      ignored: ["**/node_modules/cesium/**", "**/dist/**"],
    },
  },
  test: {
    environment: "node",
  },
});
