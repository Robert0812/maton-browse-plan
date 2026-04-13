/**
 * Chrome launches native hosts with a minimal environment; `node` is often not on PATH.
 * Wrappers must exec the same Node used to build/install (process.execPath).
 */
import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";

/** Escape path for use inside single quotes in POSIX sh. */
function shSq(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * @param {string} distDir - absolute path to apps/maton-native-host/dist
 */
export async function writeNativeWrappers(distDir) {
  const nodePath = process.execPath;

  const runSh = `#!/usr/bin/env sh
DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
exec ${shSq(nodePath)} "$DIR/host.js"
`;

  const shPath = path.join(distDir, "run-native-host.sh");
  await writeFile(shPath, runSh, "utf8");
  await chmod(shPath, 0o755);

  const runCmd = `@echo off
setlocal
"${nodePath}" "%~dp0host.js"
`;

  await writeFile(path.join(distDir, "run-native-host.cmd"), runCmd, "utf8");
}
