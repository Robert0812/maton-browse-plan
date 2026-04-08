import * as esbuild from "esbuild";
import { mkdir, cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = path.join(root, "dist");

const buildId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await esbuild.build({
  entryPoints: [
    path.join(root, "src/service-worker.ts"),
    path.join(root, "src/popup.ts"),
    path.join(root, "src/review.ts"),
  ],
  bundle: true,
  outdir: dist,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
});
await cp(path.join(root, "src/manifest.json"), path.join(dist, "manifest.json"));
await cp(path.join(root, "src/popup.html"), path.join(dist, "popup.html"));
await cp(path.join(root, "src/review.html"), path.join(dist, "review.html"));

console.log("chrome-extension → dist/ (load unpacked in Chrome)");
