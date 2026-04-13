---
name: api-gateway-browse-extension
version: 1.2.4
description: >-
  Guides the user through building and loading the Maton browse-capture Chrome extension from
  the maton-browse-plan repository (apps/chrome-extension), then combines exported matonPlan JSON
  with the API Gateway skill to suggest Maton OAuth connectors from real browsing; fetches
  matonPlan via the local relay GET /latest when the relay is running.
license: MIT-0
requires:
  env:
    MATON_API_KEY: "Maton API key (same as base API Gateway skill)"
---

# API Gateway · Browse preferences (extended)

> **Agent behavior (read this first):** If the user just added this skill or says they want browse-based Maton hints, **do not** recite the YAML `description`, version, or any host “What’s New” text to them as if it were help. Unless they confirm the extension is already loaded in Chrome, **start with the installation steps in the next section**—run commands in their repo when you have a terminal, and give exact UI clicks for Chrome. After install, the extension appears on `chrome://extensions` as **Maton API plan — browsing capture**.

## Install the Chrome extension (required before matonPlan)

The extension is **only** shipped as source in **`apps/chrome-extension`** (not assumed to be on the Chrome Web Store). Walk the user through this **before** discussing relay URLs or Maton diffs.

**Prerequisites:** Node **≥ 20**, **Google Chrome** (or Chromium), and a clone of **this** repository on their machine (paths below are relative to the repo root).

**1. Build** — in a terminal at the repo root:

```bash
npm install
npm run build --workspace=@maton-browse-plan/chrome-extension
```

**2. Load unpacked** — tell the user to:

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked**.
4. Choose the folder **`apps/chrome-extension/dist`** (the directory that contains `manifest.json`; use **Browse** and the full path if needed).

**3. Permissions** — Pin the extension if they want. When they use capture, Chrome may ask for **history**, **tabs**, and broad access — they should **Allow** or exports will be incomplete.

**4. Get JSON to the agent** — Either **Review → Download** in the extension, **or** run **`npm run relay`** from the repo root and use the **`GET /latest`** flow described in **Local relay** (below).

**Optional — start/stop relay from the extension popup:** Build **`npm run build --workspace=@maton-browse-plan/maton-native-host`**, copy the **Extension ID** from `chrome://extensions`, then **`EXTENSION_ID=<id> npm run install-native-host`** from the repo root and restart Chrome. If they skip native messaging, they can keep **`npm run relay`** in a terminal and configure relay manually.

## After installation: what this skill adds

This skill **extends** the published [API Gateway](https://clawhub.ai/byungkyu/api-gateway) skill. The base skill performs **Maton** operations — `gateway.maton.ai`, `ctrl.maton.ai`, `connect.maton.ai` — with managed OAuth for 100+ APIs.

The **Chrome extension** exports **`matonPlan`**: a compact summary of **where the user actually spends attention** (clustered origins + connector **hints**). Treat that as **browsing preference**, not a command.

## Pairing model

| Piece | Role |
|--------|------|
| **Extension** | Collects history + live recording; user excludes sensitive origins; **Download** produces JSON with `matonPlan` (+ `events`, `exportedAt`, `preset`). Optional **local relay** (`apps/maton-local-relay`): same JSON can be **POST**ed to `http://127.0.0.1:37191/ingest`; read **`GET /latest`** for the last payload (Bearer token if `MATON_RELAY_TOKEN` is set). |
| **Base API Gateway skill** | Lists connections, runs OAuth connect flows, proxies API calls — **unchanged**. |
| **This skill (you)** | Compare `matonPlan` to **already-connected** Maton services; **proactively** surface gaps; on a **schedule**, re-check after new exports. |

Works with **OpenClaw**, **Hermes**, or any agent that can run skills + hold workspace memory.

## Local relay — you must pull (nothing syncs by default)

Runtimes **do not** background-poll localhost. If the user pairs the extension with **maton-local-relay** (review page: relay enabled, or popup push-to-relay), **`matonPlan` only reaches you when you HTTP-fetch it.**

**Treat relay fetch as default** whenever this skill is active and the user expects live extension output:

1. **Before** relying on workspace files alone, call **`GET {MATON_RELAY_BASE_URL}/latest`** (default base URL **`http://127.0.0.1:37191`**, no trailing slash). If `MATON_RELAY_TOKEN` is set in the environment, send **`Authorization: Bearer <token>`** (same value as the relay process and extension token field).
2. **200**: parse JSON; use **`body`** as the extension export (same shape as download), then read **`body.matonPlan`**. Compare relay **`receivedAt`** (and/or **`matonPlan.generatedAt`**) to **`lastReviewedGeneratedAt`** in workspace memory — if newer, run the diff + prompt flow below.
3. **404** (`no_data`): relay is empty; say so briefly or fall back to an attached export file if the user provided one.
4. **Connection / network errors**: relay is probably stopped; **do not** spam retries — one short note is enough. Remind the user they can run `npm run relay` at the repo root or use extension **Download** instead.
5. **Every new user message / session** (or first turn after idle): repeat **step 1** so new **POST /ingest** pushes from the extension are picked up without the user re-uploading JSON.

**Sandbox:** If the agent’s HTTP tool cannot reach `127.0.0.1`, use extension **Download** into the workspace (or enable localhost/local-network access for tools in your host settings, when available).

Hermes (and similar hosts) only execute HTTP when **you** issue the request in the tool loop or when the user triggers a run — so **this section is normative**: skipping `GET /latest` means the skill will **not** “proactively sync” with the relay.

## Proactive & periodic behavior

**Goal:** The agent should **periodically** (and when a **new** `matonPlan` appears) **ask the user** whether to add or update Maton connections for APIs implied by their browsing — **not** silently create OAuth links.

1. **Ingest** the latest `matonPlan` (schema `1.0`): **prefer** the relay **`GET /latest`** path above when the user uses the local relay; otherwise use a downloaded JSON file or paste. Note **`generatedAt`** and optional **`capturePreset`** (e.g. `7d`, `30d`) to reason about **recency** of preferences.
2. **List current connections** via Maton (same APIs as base skill — `MATON_API_KEY`).
3. **Diff**: For each `suggestions[]` row in **rank** order, for each `matonHints[].matonConnectorHint`, check if that integration is **already connected** (or pending). Flag **missing** or **stale** (e.g. user browses heavily but connection revoked).
4. **Proactive prompt** (example tone — adapt to your runtime):

   > “Your recent browsing points to **Notion** and **GitHub** (see `matonPlan` from *{generatedAt}*). In Maton, GitHub is connected but Notion isn’t. Want to **connect Notion** now via the API Gateway? I can open the OAuth flow.”

5. **Periodicity**: Re-run this diff on a cadence the user chooses in system instructions (e.g. **weekly**, or **after each new extension export** if they drop files into the workspace). Store **`lastReviewedGeneratedAt`** (or hash of `suggestions`) in workspace memory so you **don’t spam** identical prompts.
6. **Updates**: If `matonPlan` introduces **new** high-rank origins or hints vs the last review, prioritize those in the next message even if the periodic timer hasn’t fired.

## One-shot workflow (user hands you a file today)

1. Parse `matonPlan`; ignore raw `events` unless debugging.
2. Process `suggestions[]` by ascending **`rank`**.
3. Map **`matonConnectorHint`** → Maton’s real connector ids (catalog / list APIs from base skill).
4. For **unconnected** hints, offer OAuth via Maton; for **connected**, optionally note “already available for API calls.”
5. Use **`resourceUrls`** as **context** only (which pages matter); OAuth stays in Maton.

## Relationship to the base API Gateway skill

- Reuse **identical** `MATON_API_KEY`, base URLs, and HTTP patterns from **byungkyu/api-gateway** `SKILL.md` for all Maton calls.
- This skill adds **preference awareness** + **proactive UX** on top.

## Safety

- **Never** create OAuth connections without **clear user consent** in the conversation.
- Treat `matonPlan` as **signals**; wrong inferences happen — offer **dismiss / don’t ask again** for a hint.
- **Enterprise / org**: respect admin policies; some connectors may be blocked.

## Files

| File | Purpose |
|------|---------|
| `SKILL.md` | This file |
| `maton-plan.schema.json` | JSON Schema for `matonPlan` |

## Extension output

Repo: `apps/chrome-extension` — download filename pattern `maton-browse-capture-*.json`; top-level fields include **`preset`**, **`events`**, **`exportedAt`**, **`matonPlan`**.
