#!/usr/bin/env node
import http from "node:http";

const VERSION = "0.1.0";
const PORT = Number(process.env.MATON_RELAY_PORT || 37191);
const HOST = process.env.MATON_RELAY_HOST || "127.0.0.1";
const TOKEN = (process.env.MATON_RELAY_TOKEN || "").trim();

type Stored = { receivedAt: string; body: unknown };
let latest: Stored | null = null;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...cors,
  });
  res.end(payload);
}

function unauthorized(req: http.IncomingMessage): boolean {
  if (!TOKEN) return false;
  const h = req.headers.authorization;
  return h !== `Bearer ${TOKEN}`;
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { ...cors });
    res.end();
    return;
  }

  const host = req.headers.host ?? `localhost:${PORT}`;
  let pathname = "/";
  try {
    pathname = new URL(req.url ?? "/", `http://${host}`).pathname;
  } catch {
    json(res, 400, { ok: false, error: "bad_request" });
    return;
  }

  if (req.method === "GET" && pathname === "/health") {
    json(res, 200, { ok: true, service: "maton-local-relay", version: VERSION });
    return;
  }

  if (req.method === "GET" && pathname === "/latest") {
    if (unauthorized(req)) {
      json(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    if (!latest) {
      json(res, 404, { ok: false, error: "no_data" });
      return;
    }
    json(res, 200, { ok: true, receivedAt: latest.receivedAt, body: latest.body });
    return;
  }

  if (req.method === "POST" && pathname === "/ingest") {
    if (unauthorized(req)) {
      json(res, 401, { ok: false, error: "unauthorized" });
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let parsed: unknown;
      try {
        parsed = raw.length ? JSON.parse(raw) : {};
      } catch {
        json(res, 400, { ok: false, error: "invalid_json" });
        return;
      }
      const receivedAt = new Date().toISOString();
      latest = { receivedAt, body: parsed };
      json(res, 200, { ok: true, receivedAt });
    });
    return;
  }

  json(res, 404, { ok: false, error: "not_found" });
});

server.on("error", (err: NodeJS.ErrnoException) => {
  console.error(`[maton-local-relay] listen error: ${err.code ?? ""} ${err.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.error(
    `[maton-local-relay] http://${HOST}:${PORT}  (POST /ingest, GET /latest, GET /health)${
      TOKEN ? "  [token required for ingest/latest]" : ""
    }`,
  );
});
