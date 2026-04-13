# Maton browse plan · Chrome extension

Capture **Chrome history + live visits**, cluster top origins, and export **`matonPlan`** JSON so an agent using the **ClawHub API Gateway** skill ([byungkyu/api-gateway](https://clawhub.ai/byungkyu/api-gateway)) can prioritize **Maton** ([maton.ai](https://www.maton.ai/)) OAuth connections and API calls from real browsing—without the old Skill Factory LLM harness pipeline.

## Layout

| Path | Role |
|------|------|
| `apps/chrome-extension` | MV3 extension: history import, live capture, **Review** page, download `{ events, matonPlan, … }`. |
| `skills/clawhub-api-gateway-browse` | **Extended ClawHub skill**: `SKILL.md` + `maton-plan.schema.json` for agents. |
| `apps/mcp-skill-host` | Optional stdio MCP host (unchanged). |
| `archive/` | **Legacy** Skill Factory HTTP API, harness sync MCP, and `@skill-factory/shared` (see `archive/README.md`). |

## Quick start

```bash
npm install
npm run build
```

### Chrome extension (Load unpacked or Web Store)

**Prerequisites:** Node **≥ 20**, **Google Chrome** (or Chromium), and this repository on disk for development builds.

**Publishing to the Chrome Web Store:** See **`apps/chrome-extension/docs/WEBSTORE.md`** for the full checklist (privacy policy URL, permission justifications, listing copy). From `apps/chrome-extension`, run **`npm run package:webstore`** to produce **`maton-browse-plan-v<version>-webstore.zip`** for upload. Host **`apps/chrome-extension/docs/PRIVACY.md`** at an **HTTPS** URL and use it in the store listing.

**Development (Load unpacked)** — The MV3 bundle is built from **source in this repo** (use this until a store listing exists).

**Build** (from the repo root):

```bash
npm install
npm run build --workspace=@skill-factory/chrome-extension
```

The loadable folder is **`apps/chrome-extension/dist`** (relative to the repo root; use its absolute path in Chrome’s folder picker).

**Load unpacked in Chrome:**

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the **`dist`** directory above (the folder that contains `manifest.json`).

**After load:** Pin the extension if useful. Chrome may prompt for **history** and **tabs** (and related access) for capture — allow these or ranking/export will be incomplete. The relay only talks to **localhost** (see extension docs).

**Handing data to an agent:** Use **Review → Download** JSON, **or** run the local relay (`npm run relay` from the repo root by default) and pair the extension’s relay settings with **`GET /latest`** on the relay base URL (see `skills/clawhub-api-gateway-browse/SKILL.md`).

**Optional — relay start/stop from the popup:** Build the native host (`npm run build --workspace=@skill-factory/maton-native-host`), copy the **Extension ID** from `chrome://extensions`, then from the repo root run `EXTENSION_ID=<id> npm run install-native-host` and restart Chrome. Otherwise keep **`npm run relay`** running in a terminal and use manual relay settings.

### ClawHub skill

Copy or publish `skills/clawhub-api-gateway-browse/` beside the base API Gateway skill; set **`MATON_API_KEY`** per Maton docs. The skill tells OpenClaw/Hermes (or similar) to treat **`matonPlan`** as browsing **preferences**, compare against Maton connections, and **periodically prompt** the user to add or update OAuth links — not to auto-connect silently. **`SKILL.md` leads with Chrome extension install steps** (build + Load unpacked). If the host shows a “What’s New” panel that only quotes YAML metadata, use the markdown body—not that panel—as the source of truth for setup.

## Privacy

Sanitize traces in the extension before sharing exports; exclude sensitive origins in the Review table.
