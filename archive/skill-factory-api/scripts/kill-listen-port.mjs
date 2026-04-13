#!/usr/bin/env node
/**
 * Free TCP listen port (macOS/Linux: lsof). Usage: node scripts/kill-listen-port.mjs [port]
 * Default port 8787 or process.env.PORT.
 */
import { execSync } from "node:child_process";

const port = process.argv[2] ?? process.env.PORT ?? "8787";

if (process.platform === "win32") {
  console.error(`[kill-listen-port] On Windows, run: netstat -ano | findstr :${port}
  then: taskkill /PID <pid> /F`);
  process.exit(0);
}

try {
  const out = execSync(`lsof -t -iTCP:${port} -sTCP:LISTEN`, { encoding: "utf8" }).trim();
  const pids = [...new Set(out.split(/\s+/).filter(Boolean))];
  for (const p of pids) {
    process.kill(Number(p), "SIGTERM");
    console.error(`[kill-listen-port] sent SIGTERM to PID ${p} (port ${port})`);
  }
  if (pids.length === 0) {
    console.error(`[kill-listen-port] no process listening on ${port}`);
  }
} catch {
  console.error(`[kill-listen-port] no listener on ${port} (or lsof unavailable)`);
}
