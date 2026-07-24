/**
 * Cloudflare Pages 向けに dist を整える（ビルド後フック用）。
 * Vite が public/_redirects / _headers をコピー済みか確認し、欠ければ補完する。
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir =
  process.env.CIVILCRAFT_OUT_DIR ??
  (process.env.CI === "true"
    ? path.resolve(webRoot, "dist")
    : path.join(homedir(), ".cache", "civilcraft", "web-dist"));
const publicDir = path.resolve(webRoot, "public");

mkdirSync(distDir, { recursive: true });

function ensureCopied(name, fallback) {
  const dest = path.join(distDir, name);
  const src = path.join(publicDir, name);
  if (existsSync(dest)) {
    return;
  }
  if (existsSync(src)) {
    copyFileSync(src, dest);
    console.log(`[pages-prepare] copied ${name}`);
    return;
  }
  writeFileSync(dest, fallback);
  console.log(`[pages-prepare] wrote fallback ${name}`);
}

ensureCopied("_redirects", "/*    /index.html   200\n");
ensureCopied(
  "_headers",
  `/cesiumStatic/*
  Cache-Control: public, max-age=31536000, immutable
`,
);

console.log("[pages-prepare] ready", distDir);
