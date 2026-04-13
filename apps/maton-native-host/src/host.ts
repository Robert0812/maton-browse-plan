/**
 * Chrome native messaging host: start/stop the maton-local-relay process (detached) and track PID.
 * One Chrome message → one host process → one JSON reply → exit.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const STATE_PATH = path.join(os.homedir(), ".maton-browse-relay.state.json");

interface State {
  pid: number;
  port: number;
  startedAt: string;
}

interface NativeRequest {
  cmd?: string;
  /** Chrome JSON may deserialize as number or string. */
  port?: number | string;
  token?: string;
}

function relayScriptPath(): string {
  return path.join(__dirname, "..", "..", "maton-local-relay", "dist", "index.js");
}

/** Find PIDs with a TCP listener on `port` (for stopping an "adopted" relay). */
function pidsListeningOnPort(port: number): number[] {
  if (process.platform === "win32") {
    try {
      const out = execFileSync("netstat", ["-ano"], { encoding: "utf8", windowsHide: true });
      const pids = new Set<number>();
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes("LISTENING")) continue;
        if (!line.includes(`:${port}`)) continue;
        const parts = line.trim().split(/\s+/);
        const last = parts[parts.length - 1];
        const pid = parseInt(last, 10);
        if (!Number.isNaN(pid)) pids.add(pid);
      }
      return [...pids];
    } catch {
      return [];
    }
  }
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
    });
    return [
      ...new Set(
        out
          .trim()
          .split(/\n/)
          .filter(Boolean)
          .map((s) => parseInt(s, 10))
          .filter((n) => !Number.isNaN(n)),
      ),
    ];
  } catch {
    return [];
  }
}

function readState(): State | null {
  try {
    if (!existsSync(STATE_PATH)) return null;
    const raw = readFileSync(STATE_PATH, "utf8");
    const s = JSON.parse(raw) as State;
    if (typeof s.pid !== "number" || typeof s.port !== "number") return null;
    return s;
  } catch {
    return null;
  }
}

function writeState(s: State): void {
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2), "utf8");
}

function clearState(): void {
  try {
    if (existsSync(STATE_PATH)) unlinkSync(STATE_PATH);
  } catch {
    /* ignore */
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function httpHealth(port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Chrome sends one message as: 4-byte little-endian length + UTF-8 JSON.
 * It does not always close stdin promptly; waiting for `end` can hang forever.
 */
function readExactStdin(n: number, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let got = 0;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("stdin_read_timeout"));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timer);
      process.stdin.removeListener("readable", onReadable);
      process.stdin.removeListener("end", onEnd);
      process.stdin.removeListener("error", onErr);
    }

    function onErr(err: Error): void {
      cleanup();
      reject(err);
    }

    function onEnd(): void {
      cleanup();
      if (got < n) reject(new Error("unexpected_eof"));
    }

    function onReadable(): void {
      try {
        while (got < n) {
          const chunk = process.stdin.read(n - got);
          if (chunk === null) break;
          chunks.push(chunk);
          got += chunk.length;
        }
        if (got >= n) {
          cleanup();
          resolve(Buffer.concat(chunks).subarray(0, n));
        }
      } catch (e) {
        cleanup();
        reject(e);
      }
    }

    process.stdin.on("readable", onReadable);
    process.stdin.on("end", onEnd);
    process.stdin.on("error", onErr);
    process.stdin.resume();
    onReadable();
  });
}

async function readChromeMessage(): Promise<NativeRequest> {
  const header = await readExactStdin(4, 30_000);
  const len = header.readUInt32LE(0);
  if (len > 4 * 1024 * 1024) {
    throw new Error("message_too_large");
  }
  if (len === 0) {
    return {};
  }
  const body = await readExactStdin(len, 30_000);
  try {
    return JSON.parse(body.toString("utf8")) as NativeRequest;
  } catch {
    throw new Error("invalid_json");
  }
}

function sendResponse(obj: unknown): void {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

function defaultPort(req: NativeRequest): number {
  const n = req.port;
  if (typeof n === "number" && Number.isFinite(n) && n > 0 && n < 65536) return Math.floor(n);
  if (typeof n === "string" && n.trim() !== "") {
    const p = parseInt(n, 10);
    if (Number.isFinite(p) && p > 0 && p < 65536) return p;
  }
  return 37191;
}

async function waitForRelayHealth(port: number, pid: number, maxMs: number): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) return false;
    if (await httpHealth(port, 400)) return true;
    await new Promise((r) => setTimeout(r, 80));
  }
  return httpHealth(port, 1200);
}

async function handleStart(req: NativeRequest): Promise<void> {
  const port = defaultPort(req);
  const relayJs = relayScriptPath();
  if (!existsSync(relayJs)) {
    sendResponse({
      ok: false,
      error: "relay_not_built",
      detail: `Missing ${relayJs}. Run npm run build in the repo.`,
    });
    return;
  }

  let state = readState();
  if (state && state.port !== port) {
    clearState();
    state = null;
  }

  if (state && isPidAlive(state.pid)) {
    const healthy = await httpHealth(state.port);
    if (healthy) {
      sendResponse({
        ok: true,
        running: true,
        pid: state.pid,
        port: state.port,
        already: true,
        healthy: true,
      });
      return;
    }
    clearState();
  } else if (state && !isPidAlive(state.pid)) {
    clearState();
  }

  if (await httpHealth(port)) {
    sendResponse({
      ok: true,
      running: true,
      port,
      adopted: true,
      healthy: true,
      message: "GET /health already responds on this port (relay may have been started outside the extension).",
    });
    return;
  }

  const token = typeof req.token === "string" ? req.token.trim() : "";
  const env = {
    ...process.env,
    MATON_RELAY_PORT: String(port),
    MATON_RELAY_HOST: "127.0.0.1",
    ...(token ? { MATON_RELAY_TOKEN: token } : {}),
  };

  const child = spawn(process.execPath, [relayJs], {
    detached: true,
    stdio: "ignore",
    env,
  });
  child.unref();

  const pid = child.pid;
  if (pid == null) {
    sendResponse({ ok: false, error: "spawn_failed" });
    return;
  }

  const healthy = await waitForRelayHealth(port, pid, 12_000);
  if (!isPidAlive(pid)) {
    sendResponse({
      ok: false,
      error: "relay_exited",
      detail:
        "Relay process exited before listening. Port may be in use, or run: npm run build (maton-local-relay).",
    });
    return;
  }
  if (!healthy) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* ignore */
    }
    sendResponse({
      ok: false,
      error: "relay_not_healthy",
      detail: `Timed out waiting for http://127.0.0.1:${port}/health (another process may hold the port).`,
    });
    return;
  }

  writeState({ pid, port, startedAt: new Date().toISOString() });
  sendResponse({
    ok: true,
    running: true,
    pid,
    port,
    healthy: true,
  });
}

async function handleStop(req: NativeRequest): Promise<void> {
  const port = defaultPort(req);
  let state = readState();
  if (state && state.port !== port) {
    state = null;
  }

  if (state && isPidAlive(state.pid)) {
    try {
      process.kill(state.pid, "SIGTERM");
    } catch {
      /* ignore */
    }
    clearState();
    await new Promise((r) => setTimeout(r, 250));
    const still = await httpHealth(port, 800);
    sendResponse({
      ok: true,
      stopped: !still,
      pid: state.pid,
      port,
      message: still
        ? "Sent SIGTERM; relay may still be shutting down — try Stop again in a moment."
        : "Stopped.",
    });
    return;
  }

  if (state && !isPidAlive(state.pid)) {
    clearState();
  }

  if (!(await httpHealth(port))) {
    sendResponse({ ok: true, stopped: false, message: "not_running" });
    return;
  }

  const pids = pidsListeningOnPort(port);
  if (pids.length === 0) {
    sendResponse({
      ok: false,
      error: "stop_no_listener_pid",
      detail:
        "GET /health works but no listening PID was found (install `lsof` on macOS/Linux, or stop `npm run relay` in the terminal).",
    });
    return;
  }

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* ignore */
    }
  }
  clearState();

  await new Promise((r) => setTimeout(r, 450));
  const stillUp = await httpHealth(port, 2500);
  sendResponse({
    ok: true,
    stopped: !stillUp,
    port,
    killedPids: pids,
    message: stillUp
      ? "Sent SIGTERM to the listener process(es); relay may still be stopping — try again or close the terminal tab."
      : "Stopped.",
  });
}

async function handleStatus(req: NativeRequest): Promise<void> {
  const port = defaultPort(req);
  const state = readState();
  const stateMatchesPort = state != null && state.port === port;

  if (stateMatchesPort && isPidAlive(state!.pid)) {
    const healthy = await httpHealth(state!.port);
    sendResponse({
      ok: true,
      running: true,
      pid: state!.pid,
      port: state!.port,
      healthy,
    });
    return;
  }

  if (stateMatchesPort && state != null && !isPidAlive(state.pid)) {
    clearState();
  }

  if (await httpHealth(port)) {
    sendResponse({
      ok: true,
      running: true,
      port,
      healthy: true,
      adopted: true,
      message: "Relay answers on this port but was not started by the extension (or PID state was cleared).",
    });
    return;
  }

  sendResponse({ ok: true, running: false });
}

async function main(): Promise<void> {
  let req: NativeRequest;
  try {
    req = await readChromeMessage();
  } catch (e) {
    sendResponse({
      ok: false,
      error: "invalid_message",
      detail: e instanceof Error ? e.message : String(e),
    });
    return;
  }
  const cmd = req.cmd;
  try {
    if (cmd === "start") await handleStart(req);
    else if (cmd === "stop") await handleStop(req);
    else if (cmd === "status") await handleStatus(req);
    else sendResponse({ ok: false, error: "unknown_cmd", cmd });
  } catch (e) {
    sendResponse({
      ok: false,
      error: "handler_exception",
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

main()
  .then(() => {
    setImmediate(() => process.exit(0));
  })
  .catch((e) => {
    try {
      sendResponse({
        ok: false,
        error: "fatal",
        detail: e instanceof Error ? e.message : String(e),
      });
    } catch {
      /* ignore */
    }
    setImmediate(() => process.exit(1));
  });
