# WondersAgent Skill Factory

History-driven pipeline that turns a user’s **digital shadow** (browsing traces) into **standardized, self-healing MCP skills**. The goal is to move agent configuration off the user and onto an autonomous **six-phase trust pipeline**, with **P0 → P1 → P2** harness execution when UIs drift.

## Monorepo layout

| Path | Role |
|------|------|
| `apps/chrome-extension` | **Phase 1 — Capture:** MV3 extension stub (URL + dwell time in local storage). Extend with PII scrubbing before upload. |
| `apps/skill-factory-api` | **Phases 2–6** HTTP API: permission gate, intent validation, exploration, MCP export, deployment ticket stub. |
| `apps/mcp-skill-host` | **Phase 5/6 — MCP:** stdio MCP server placeholder; wire to bundles from the factory (“living skill” host). |
| `packages/shared` | Shared types: pipeline phases, harness tiers, traces, golden paths, MCP bundle shape. |

## Six-phase API (MVP)

All phases are `POST /v1/pipeline/:phase` with a JSON body. `GET /v1/pipeline` lists phase names. Phases **2–6** use in-memory `mvp-pipeline-context` keyed by `sessionId` (same id as `capture` → `session.id`); no DB or auth in MVP.

1. **`capture`** — Ingests extension batches; stores `CaptureSession` + `ingestion`; log line with `session.id`.
2. **`permission_gate`** — Saves gate to MVP context; if `allowlist` omitted and `sessionId` set, defaults to captured unique origins.
3. **`intent_validation`** — Heuristic only: **top 10 origins** by history `visitCount` + live `dwellMs`. **Interested functions** (`cluster.sites[].functions`) are filled **only** from **history** rows whose URLs include a query string (up to **3** path+query clusters per origin). If there is no query-bearing history for that origin, **`functions` is `[]`**. Extension **Send** keeps `?` on POST; **Download** still strips queries. **`candidates`** mirrors sites; MVP context stores **`intentCluster`**.
4. **`exploration`** — Runs `searchTrajectories` in `apps/skill-factory-api/src/engine/hierarchical-search.ts`.
   - **Inputs:** `goal` (required for any path; blank → `paths: []`), optional `sessionId`, `allowlist`, `traceHints`.
   - **Allowlist (when `sessionId` is set and body `allowlist` omitted):** use Phase 2 gate `allowlist` if present, else Phase 1 `ingestion.uniqueOrigins`.
   - **Hints:** capture `uniqueOrigins` are unioned into `traceHints.origins` with any client-provided origins.
   - **Guard:** if both `allowlist` and hint origins are non-empty, at least one hint origin must match an allowlist rule (`searchTrajectories`); else `paths: []`.
   - **Tiers:** tries **P0_parametric → P1_scripted → P2_visual** stub; first hit is returned as a one-element `paths` array for **`export`**.
5. **`export`** — Builds `McpSkillBundle`; optional `sessionId` stores `lastPaths` / `lastBundle` for integration.
6. **`integration`** — Demo `installUrl`; `bundleId` from body or last export for that `sessionId` (`PUBLIC_SKILL_BASE`).

## Prerequisites

- Node.js 20+

This repo uses **npm workspaces** (`workspace:*` is not used so `npm install` works out of the box). If you use **pnpm**, change the API dependency to `"@skill-factory/shared": "workspace:*"` and remove the root `workspaces` field if you prefer `pnpm-workspace.yaml` only.

## Commands

```bash
npm install
npm run build
npm run dev:factory
```

**Chrome extension:** `npm run build --workspace=@skill-factory/chrome-extension`, then Chrome → **Extensions** → **Load unpacked** → `apps/chrome-extension/dist`. Trace data persists in `chrome.storage.local` until you clear it or run a **new build**: each build injects a fresh `__BUILD_ID__`, and **unpacked** loads (no manifest `update_url`) **wipe** history/live/legacy trace storage when the service worker starts if that id changed—so **rebuild + Reload** resets counts; **Reload alone** keeps data. Published store builds (`update_url` set) never auto-wipe. **History import** replaces the history batch each run. **Harness generation** merges history + live in `review.html`. API origin: `apps/chrome-extension/src/config.ts`. **CORS** for dev POSTs.

**MCP host (stdio):** After `npm run build`, run `node apps/mcp-skill-host/dist/index.js` from your agent’s MCP config.

## Ethics and privacy (implementation notes)

- **Local sanitization:** implement redaction in the extension *before* any upload; keep blocklist domains out of the server payload.
- **User sovereignty:** exploration and execution must intersect with the permission gate allowlist; the API stubs mention this but do not enforce auth yet.

## Next implementation steps

- Persistence (sessions, bundles, golden paths) and auth for `/v1/pipeline/*`.
- Real **Phase 4:** Playwright (P1), CV / SoM fallback (P2), URL template mining (P0) from clustered traces.
- **Targeted mode:** accept `{ url, goal }` on exploration to bypass passive clustering when the user names a task explicitly.
- **Living skill URL:** host `mcp-skill-host` behind HTTPS + session routing; update trajectories server-side without changing the client MCP config.

Licensed for your product terms (add a `LICENSE` when you choose one).
