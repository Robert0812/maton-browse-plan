/**
 * Writes toolbar / store PNG icons (solid brand color). Run from build; requires pngjs.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PNG } from "pngjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = path.join(root, "src", "icons");

/** Toolbar / listing green (matches live badge). */
const BG = { r: 0x15, g: 0x80, b: 0x3d, a: 0xff };
/** Subtle highlight bar (simple “signal” motif). */
const BAR = { r: 0xf0, g: 0xfd, b: 0xf4, a: 0xff };

const SIZES = [16, 32, 48, 128];

function fillPng(size) {
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (size * y + x) << 2;
      png.data[i] = BG.r;
      png.data[i + 1] = BG.g;
      png.data[i + 2] = BG.b;
      png.data[i + 3] = BG.a;
    }
  }
  const barH = Math.max(2, Math.round(size * 0.12));
  const y0 = Math.floor((size - barH) / 2);
  const margin = Math.floor(size * 0.22);
  for (let y = y0; y < y0 + barH; y++) {
    for (let x = margin; x < size - margin; x++) {
      const i = (size * y + x) << 2;
      png.data[i] = BAR.r;
      png.data[i + 1] = BAR.g;
      png.data[i + 2] = BAR.b;
      png.data[i + 3] = BAR.a;
    }
  }
  return PNG.sync.write(png);
}

export async function writeExtensionIcons(destinationDir) {
  await mkdir(destinationDir, { recursive: true });
  for (const s of SIZES) {
    const buf = fillPng(s);
    await writeFile(path.join(destinationDir, `icon-${s}.png`), buf);
  }
}

/** CLI: `node scripts/gen-icons.mjs` writes under src/icons (optional, for design tweaks). */
const isMain = pathToFileURL(path.resolve(process.argv[1] ?? "")).href === import.meta.url;
if (isMain) {
  await writeExtensionIcons(outDir);
  console.log(`chrome-extension icons → ${outDir}`);
}
