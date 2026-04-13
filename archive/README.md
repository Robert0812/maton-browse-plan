# Archived: Skill Factory API & harness LLM pipeline

This folder holds the previous **six-phase HTTP API** (`skill-factory-api`), **`@skill-factory/shared`**, and **`mcp-harness-sync`** (MCP tool that polled `GET /v1/sync/harness-installer`).

The product direction moved to **Maton + ClawHub API Gateway** with browse-derived `matonPlan` JSON from the Chrome extension (`skills/clawhub-api-gateway-browse` at repo root). The archived code is kept for reference; it is **not** part of the active workspace.

To run the old API locally (optional):

```bash
cd archive/skill-factory-api
npm install
npm run build && npm start
```

Restore from `archive/` only if you need the harness installer or pipeline phases again.
