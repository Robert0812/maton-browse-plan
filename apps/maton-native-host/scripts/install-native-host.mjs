#!/usr/bin/env node
/**
 * Registers the native messaging host with Chrome/Chromium so the extension can start/stop the relay.
 *
 * Usage:
 *   node apps/maton-native-host/scripts/install-native-host.mjs <extension-id>
 *   EXTENSION_ID=abcd npm run install-native-host   (from repo root)
 *
 * Find the id on chrome://extensions (Developer mode) for this unpacked extension.
 *
 * By default (macOS/Linux/Windows) the same manifest is written to every known Chromium-based
 * browser NativeMessagingHosts directory so "Access … forbidden" does not happen when you use
 * Brave, Edge, Chromium, etc. Set NATIVE_MSG_ONLY=chrome to only install for Google Chrome.
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

/** @returns {string[]} */
function chromeNativeHostsDirs() {
  const home = os.homedir();
  const onlyChrome = process.env.NATIVE_MSG_ONLY?.trim().toLowerCase() === "chrome";

  if (process.platform === "darwin") {
    const sup = path.join(home, "Library/Application Support");
    const all = [
      path.join(sup, "Google/Chrome/NativeMessagingHosts"),
      path.join(sup, "Google/Chrome Canary/NativeMessagingHosts"),
      path.join(sup, "Chromium/NativeMessagingHosts"),
      path.join(sup, "BraveSoftware/Brave-Browser/NativeMessagingHosts"),
      path.join(sup, "Microsoft Edge/NativeMessagingHosts"),
      path.join(sup, "Arc/User Data/NativeMessagingHosts"),
    ];
    return onlyChrome ? [all[0]] : all;
  }

  if (isWin) {
    const local = process.env.LOCALAPPDATA || path.join(home, "AppData/Local");
    const all = [
      path.join(local, "Google/Chrome/User Data/NativeMessagingHosts"),
      path.join(local, "Google/Chrome SxS/User Data/NativeMessagingHosts"),
      path.join(local, "Chromium/User Data/NativeMessagingHosts"),
      path.join(local, "BraveSoftware/Brave-Browser/User Data/NativeMessagingHosts"),
      path.join(local, "Microsoft/Edge/User Data/NativeMessagingHosts"),
    ];
    return onlyChrome ? [all[0]] : all;
  }

  const all = [
    path.join(home, ".config/google-chrome/NativeMessagingHosts"),
    path.join(home, ".config/chromium/NativeMessagingHosts"),
    path.join(home, ".config/BraveSoftware/Brave-Browser/NativeMessagingHosts"),
    path.join(home, ".config/microsoft-edge/NativeMessagingHosts"),
  ];
  return onlyChrome ? [all[0]] : all;
}

const HOST_NAME = "com.maton.browse_relay";
const manifest = {
  name: HOST_NAME,
  description: "Starts and stops maton-local-relay for the Maton browse extension",
  path: wrapperPath,
  type: "stdio",
  allowed_origins: [`chrome-extension://${extensionId}/`],
};

const dirs = chromeNativeHostsDirs();
for (const dir of dirs) {
  const outFile = path.join(dir, `${HOST_NAME}.json`);
  await mkdir(dir, { recursive: true });
  await writeFile(outFile, JSON.stringify(manifest, null, 2), "utf8");
  console.error(`Wrote ${outFile}`);
}

console.error(`Wrapper: ${wrapperPath}`);
console.error(`Node (embedded in wrapper): ${process.execPath}`);
console.error(
  "Restart the browser if it was running. Reload the extension, then use Start relay in the popup.",
);
console.error(
  `If the popup still says access is forbidden, confirm EXTENSION_ID matches this extension on chrome://extensions (id changes if you load a different unpacked folder).`,
);
