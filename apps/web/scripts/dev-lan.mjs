import { createServer } from "vite";
import { writeFileSync } from "node:fs";

console.log("[dev-lan] starting");
const server = await createServer({
  configFile: "./vite.config.ts",
  optimizeDeps: {
    // cesium の事前バンドルは初回起動を遅く／止めることがあるので空にする
    noDiscovery: true,
    include: [],
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    watch: null,
  },
});
console.log("[dev-lan] created");
await server.listen();
server.printUrls();
writeFileSync("/tmp/civilcraft-vite.ready", "ok\n");
console.log("[dev-lan] listening");
