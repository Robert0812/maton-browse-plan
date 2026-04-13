# Privacy policy — Maton API plan — browsing capture (Chrome extension)

**Last updated:** 2026-04-13

This extension helps you summarize **your own** Chrome browsing into a local **`matonPlan`** JSON file (and optional raw events) so you can use **Maton** and related agent skills (for example API Gateway) with connectors that match how you actually use the web.

## Data this extension accesses

- **Chrome history** — read-only queries over a time window you choose, to rank sites you visited.
- **Tabs** — while “live” capture is on, the extension records **which URLs you focus** (title and URL) to merge with history. It does **not** inject scripts into pages you visit.
- **Local storage** — settings, captured events, and export state stay in Chrome’s extension storage on your device.

## What leaves your device

- **Nothing is sent automatically** to Maton, to the skill authors, or to analytics servers.
- **You** export data: **Download** on the Review page produces a JSON file. You choose whether to share that file with an agent, script, or other tool.
- **Optional local relay** — if you enable it, the extension can **POST** JSON to a **relay process on your machine** (default `http://127.0.0.1:37191` or another **localhost** URL you configure). That traffic stays on **loopback** unless you run separate software that forwards it elsewhere. The Web Store build only allows relay URLs on **localhost / 127.0.0.1 / ::1**.

## Native messaging

If you install the optional **native messaging host** from the same open-source repository, the extension can ask that helper to **start or stop** the local relay on your computer. No browsing content is sent over native messaging except commands related to the relay.

## Your controls

- Exclude sensitive origins in the **Review** UI where supported.
- Turn **live** capture off when you do not want tab-derived events.
- Clear or avoid exporting JSON that contains data you do not want to share.

## Contact

Host this document at a public **HTTPS** URL and enter that URL in the Chrome Web Store listing (required for extensions with sensitive permissions). For questions about this privacy policy or the extension, contact **rzhao@link.cuhk.edu.hk**.
