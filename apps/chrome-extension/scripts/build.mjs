import * as esbuild from "esbuild";
import { mkdir, cp, rm, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { writeExtensionIcons } from "./gen-icons.mjs";

const WEBSTORE_MAX_DESCRIPTION = 132;

async function assertManifestDescriptionForWebStore(manifestPath) {
  const raw = await readFile(manifestPath, "utf8");
  const man = JSON.parse(raw);
  const desc = typeof man.description === "string" ? man.description : "";
  if (desc.length > WEBSTORE_MAX_DESCRIPTION) {
    throw new Error(
      `manifest.json description is ${desc.length} characters (Chrome Web Store max ${WEBSTORE_MAX_DESCRIPTION}). Shorten src/manifest.json and rebuild.`,
    );
  }
}

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = path.join(root, "dist");

const buildId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await writeExtensionIcons(path.join(dist, "icons"));
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
await assertManifestDescriptionForWebStore(path.join(dist, "manifest.json"));
await cp(path.join(root, "src/popup.html"), path.join(dist, "popup.html"));
await cp(path.join(root, "src/review.html"), path.join(dist, "review.html"));

console.log("chrome-extension → dist/ (icons in dist/icons; load unpacked or zip for Web Store)");
