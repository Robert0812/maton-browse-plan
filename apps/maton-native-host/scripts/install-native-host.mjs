#!/usr/bin/env node
/**
 * Registers the native messaging host with Chrome/Chromium so the extension can start/stop the relay.
 *
 * Usage:
 *   node apps/maton-native-host/scripts/install-native-host.mjs <extension-id>
 *   EXTENSION_ID=abcd npm run install-native-host   (from repo root)
 *
 * Find the id on chrome://extensions (Developer mode) for this unpacked extension.
 */
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeNativeWrappers } from "./write-native-wrappers.mjs";

const extensionId = (process.env.EXTENSION_ID || process.argv[2] || "").trim();

if (!extensionId || extensionId.length < 8) {
  console.error(
    "Usage: node install-native-host.mjs <chrome-extension-id>\n" +
      "Get the id from chrome://extensions (Developer mode) for Maton API plan.",
  );
  process.exit(1);
}

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const distDir = path.join(repoRoot, "apps/maton-native-host/dist");
const isWin = process.platform === "win32";
const wrapperName = isWin ? "run-native-host.cmd" : "run-native-host.sh";
const wrapperPath = path.join(distDir, wrapperName);

await writeNativeWrappers(distDir);

function chromeNativeHostsDir() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library/Application Support/Google/Chrome/NativeMessagingHosts");
  }
  if (isWin) {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData/Local");
    return path.join(local, "Google/Chrome/User Data/NativeMessagingHosts");
  }
  return path.join(os.homedir(), ".config/google-chrome/NativeMessagingHosts");
}

const HOST_NAME = "com.maton.browse_relay";
const manifest = {
  name: HOST_NAME,
  description: "Starts and stops maton-local-relay for the Maton browse extension",
  path: wrapperPath,
  type: "stdio",
  allowed_origins: [`chrome-extension://${extensionId}/`],
};

const dir = chromeNativeHostsDir();
const outFile = path.join(dir, `${HOST_NAME}.json`);

await mkdir(dir, { recursive: true });
await writeFile(outFile, JSON.stringify(manifest, null, 2), "utf8");

console.error(`Wrote ${outFile}`);
console.error(`Wrapper: ${wrapperPath}`);
console.error(`Node (embedded in wrapper): ${process.execPath}`);
console.error("Restart Chrome if it was running. Reload the extension, then use Start relay in the popup.");
