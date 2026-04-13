# Chrome Web Store — first publication checklist

Use this when submitting **Maton API plan — browsing capture** (`apps/chrome-extension`).

## Before you upload

1. **Developer account** — [Chrome Web Store developer program](https://chrome.google.com/webstore/devconsole); one-time registration fee (see Google’s current pricing).
2. **Privacy policy URL** — Must be **HTTPS** and publicly reachable. Host [`docs/PRIVACY.md`](PRIVACY.md) (e.g. GitHub Pages, project site, or docs host) and use that page’s URL in the listing. Replace the placeholder “Contact” section in `PRIVACY.md` with a real support link or email.
3. **Build the upload package** (from `apps/chrome-extension`):

   ```bash
   npm install
   npm run package:webstore
   ```

   This runs `npm run build` (bundles JS, generates icons, copies **`src/manifest.json` → `dist/manifest.json`**) and writes **`maton-browse-plan-v<version>-webstore.zip`** in this directory. Upload **that zip** in the Developer Dashboard (Contents: `manifest.json` at the root — do not zip the `dist` folder itself as a single nested directory).

   **If the dashboard says the description is 172 characters:** your **`dist/manifest.json` was stale** (still the old long string). The source of truth is **`src/manifest.json`**; always run **`npm run build`** or **`npm run package:webstore`** immediately before uploading — never zip an old `dist/` tree. The build fails if `description` exceeds 132 characters.

4. **Screenshots** — In the dashboard, add at least **one** screenshot (typical sizes: **1280×800** or **640×400** PNG/JPEG). Capture the **Review** table and/or the popup after a sample capture.

5. **Promotional images** — Optional: small tile, marquee, icon already provided in the zip (`icons/icon-128.png`).

## Permission justifications (for the store form)

Use short text aligned with the code:

| Permission / host | Justification |
|-------------------|----------------|
| `history` | Read recent Chrome history over a user-selected window to rank origins for `matonPlan`. |
| `tabs` | Record active-tab URL/title only while live capture is enabled; used to merge with history. |
| `storage` | Persist capture settings, events, and export state locally. |
| `alarms` | Schedule relay refresh and periodic re-ranking while a session is active. |
| `nativeMessaging` | Optional: talk to the locally installed helper to start/stop the **localhost** relay. |
| `http(s)://127.0.0.1/*`, `localhost`, `[::1]` | **Only** for optional POST/GET to the user’s **local** relay process; no remote servers. |

**Single purpose:** Help the user produce a local browsing summary (`matonPlan`) for Maton / API Gateway workflows.

## Listing copy (paste into the dashboard)

**Manifest `description`** — Chrome Web Store enforces **≤ 132 characters** for the string in `manifest.json`. Keep it in sync with this doc; current value is **128** characters.

**Short description** (same as manifest; store “short description” field if it asks for similar length):

> Turns your Chrome history & live visits into matonPlan for Maton—match OAuth connectors to real usage. Private until you export.

**Detailed description** (dashboard “detailed description” — focus on **what it does** and **why install**; paste and edit):

> **What it does**  
> Maton API plan — browsing capture looks at **your own** Chrome activity: recent **history** (you pick the time window) and, if you turn it on, **live** visits while you browse. It clusters the sites you actually spend time on and builds a compact **`matonPlan`** JSON file—ready for **Maton** and the **API Gateway** skill so your agent can see which APIs and connectors line up with your real work, not a generic guess.
>
> **Why install**  
> If you use Maton with AI agents or automation, wiring OAuth to the **wrong** tools wastes setup time. This extension gives you a **ground-truth signal** from browsing: which products you rely on, surfaced as ranked hints. You stay in control: review the table, exclude sensitive origins, then **download** JSON or (optionally) hand it to a **local relay** on your machine for tools that fetch `GET /latest`.
>
> **Privacy**  
> Nothing is sent to Maton or third parties **by default**. Data stays on your device until **you** export or push to **localhost** relay only. See the linked privacy policy for details.

After approval, add the **Web Store URL** to `skills/clawhub-api-gateway-browse/SKILL.md` and the repo README so agents can say “Install from Chrome Web Store” instead of only Load unpacked.

## Updates

- Bump **`version`** in `src/manifest.json` (semver) for each new upload.
- Re-run **`npm run package:webstore`** and upload the new zip.
- Keep `docs/PRIVACY.md` in sync if behavior or data practices change.

## Optional: `icons` in source control

Icons are generated each build into `dist/icons/`. To tweak designs, run `npm run icons` (writes under `src/icons/`, gitignored by default) and adjust `scripts/gen-icons.mjs`.
