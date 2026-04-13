/**
 * Builds a .zip with manifest.json at the root (Chrome Web Store upload format).
 * Excludes *.map source maps to reduce size.
 */
import archiver from "archiver";
import { createWriteStream } from "node:fs";
import { access, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = path.join(root, "dist");

try {
  await access(dist);
} catch {
  throw new Error("Run `npm run build` first (missing dist/).");
}

const man = JSON.parse(await readFile(path.join(dist, "manifest.json"), "utf8"));
const desc = typeof man.description === "string" ? man.description : "";
const WEBSTORE_MAX_DESCRIPTION = 132;
if (desc.length > WEBSTORE_MAX_DESCRIPTION) {
  throw new Error(
    `dist/manifest.json description is ${desc.length} chars (max ${WEBSTORE_MAX_DESCRIPTION}). ` +
      "Run `npm run build` so dist/ matches src/manifest.json, or shorten the description.",
  );
}
const outZip = path.join(root, `maton-browse-plan-v${man.version}-webstore.zip`);
await rm(outZip, { force: true });

const output = createWriteStream(outZip);
const archive = archiver("zip", { zlib: { level: 9 } });

await new Promise((resolve, reject) => {
  output.on("close", resolve);
  archive.on("error", reject);
  archive.pipe(output);
  archive.glob("**/*", { cwd: dist, ignore: ["**/*.map"] });
  void archive.finalize();
});

const { size } = await stat(outZip);
console.log(`Wrote ${outZip} (${size} bytes)`);
