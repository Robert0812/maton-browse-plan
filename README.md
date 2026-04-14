# maton-browse-plan

Capture **Chrome history + live visits**, cluster top origins, and export **`matonPlan`** JSON so an agent using the **ClawHub API Gateway** skill ([byungkyu/api-gateway](https://clawhub.ai/byungkyu/api-gateway)) can prioritize **Maton** ([maton.ai](https://www.maton.ai/)) OAuth connections and API calls from real browsing—without the old Skill Factory LLM harness pipeline.

## Layout

| Path | Role |
|------|------|
| `apps/chrome-extension` | MV3 extension: history import, live capture, **Review** page, download `{ events, matonPlan, … }`. |
| `skills/maton-browse-plan` | **Extended ClawHub skill**: `SKILL.md` + `maton-plan.schema.json` for agents. |
| `apps/mcp-skill-host` | Optional stdio MCP host (`@maton-browse-plan/mcp-skill-host`). |

## Quick start

```bash
npm install
npm run build
```

### Chrome extension (Chrome Web Store or development)

**Install from the store (recommended):** [**Maton API Plan — browsing capture**](https://chromewebstore.google.com/detail/dgecpbbjdgiindogaboidejihbmkhnai) on the Chrome Web Store. Extension ID **`dgecpbbjdgiindogaboidejihbmkhnai`** (stable for all store installs).

**Development (Load unpacked)** — For contributors: Node **≥ 20**, **Google Chrome** (or Chromium), and this repository. Build from the repo root:

```bash
npm install
npm run build --workspace=@maton-browse-plan/chrome-extension
```

The loadable folder is **`apps/chrome-extension/dist`**. In Chrome: `chrome://extensions` → **Developer mode** → **Load unpacked** → select that **`dist`** directory.

**After install:** Pin the extension if useful. Chrome may prompt for **history** and **tabs** (and related access) for capture — allow these or ranking/export will be incomplete. The relay only talks to **localhost** (see extension docs).

**Publishing / updates on the Chrome Web Store:** See **`apps/chrome-extension/docs/WEBSTORE.md`**. From `apps/chrome-extension`, run **`npm run package:webstore`** for the upload zip.

**Handing data to an agent:** Use **Review → Download** JSON, **or** run the local relay (`npm run relay` from the repo root by default) and pair the extension’s relay settings with **`GET /latest`** on the relay base URL (see `skills/maton-browse-plan/SKILL.md`).

**Optional — relay start/stop from the popup:** Build the native host (`npm run build --workspace=@maton-browse-plan/maton-native-host`), then from the repo root run **`EXTENSION_ID=dgecpbbjdgiindogaboidejihbmkhnai npm run install-native-host`** for the **Web Store** build (or **`EXTENSION_ID=<id>`** from `chrome://extensions` for an unpacked dev build). Restart the browser. The install script registers the native host for **Chrome, Chromium, Brave, Edge, Arc, and Canary** (macOS/Windows/Linux); set `NATIVE_MSG_ONLY=chrome` if you only want Google Chrome. If the popup says **access to the native messaging host is forbidden**, the ID in `allowed_origins` does not match that install—reinstall with the correct ID. Otherwise keep **`npm run relay`** running in a terminal and use manual relay settings.

### ClawHub skill

Copy or publish `skills/maton-browse-plan/` beside the base API Gateway skill; set **`MATON_API_KEY`** per Maton docs. The skill tells OpenClaw/Hermes (or similar) to treat **`matonPlan`** as browsing **preferences**, compare against Maton connections, and **periodically prompt** the user to add or update OAuth links — not to auto-connect silently. **`SKILL.md` leads with Chrome Web Store install** (and optional build-from-source). If the host shows a “What’s New” panel that only quotes YAML metadata, use the markdown body—not that panel—as the source of truth for setup.

## Privacy

Sanitize traces in the extension before sharing exports; exclude sensitive origins in the Review table.
