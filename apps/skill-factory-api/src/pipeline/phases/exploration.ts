import type { GoldenPath } from "@skill-factory/shared";
import { searchTrajectories } from "../../engine/hierarchical-search.js";
import { getCaptureSession } from "../session-store.js";
import { getMvpContext } from "../mvp-pipeline-context.js";

/**
 * Phase 4 — exploration (harness trajectory candidates).
 *
 * **Role (MVP):** Turn a natural-language `goal` plus session context into zero or more `GoldenPath`
 * stubs by calling `searchTrajectories`. This is not real browser automation yet; it verifies wiring
 * from capture → gate → exploration and produces stable JSON for `export`.
 *
 * **Request body (typical fields):**
 * - `goal` (string) — Task description. If empty/whitespace after trim, `paths` is always `[]`
 *   (the engine does not invent a goal).
 * - `sessionId` (string, optional but recommended) — Same id as `capture` → `session.id`. When set:
 *   fills in allowlist and trace hints from prior phases when the client omits them.
 * - `allowlist` (string[], optional) — Hosts/origins (or suffix/pattern strings) allowed for this
 *   search. Resolution order when `sessionId` is set and `allowlist` is omitted or empty:
 *   1) Phase 2 **`permission_gate`** result stored in MVP context (`gate.allowlist`), if non-empty;
 *   2) else Phase 1 **`ingestion.uniqueOrigins`** for this session.
 * - `traceHints` (object, optional) — Passed through to `searchTrajectories`. If `sessionId` is set,
 *   **`ingestion.uniqueOrigins`** from capture are merged into `traceHints.origins` as a set union
 *   with any `traceHints.origins` already sent by the client (strings deduped).
 *
 * **Engine behavior (`hierarchical-search`):**
 * - If `goal` is non-empty and both `allowlist` and `traceHints.origins` are non-empty, at least one
 *   hint origin must “match” an allowlist entry (equality, subdomain suffix, or substring — see
 *   `searchTrajectories`) or the result is `[]` (MVP guard so exploration stays tied to allowed hosts).
 * - Otherwise tries harness tiers in order **P0_parametric → P1_scripted → P2_visual** and returns
 *   the **first** successful stub as a **single-element** `paths` array (placeholder steps/spec only).
 *
 * **Response:** `{ paths, note }` — `paths` is what Phase 5 `export` should consume as `input.paths`.
 */
export async function phaseExploration(
  input: Record<string, unknown>,
): Promise<{ paths: GoldenPath[]; note: string }> {
  const goal = String(input.goal ?? "");
  const sessionId = typeof input.sessionId === "string" ? input.sessionId.trim() : "";

  let allowlist = Array.isArray(input.allowlist) ? (input.allowlist as unknown[]).map(String) : [];
  if (sessionId && allowlist.length === 0) {
    const ctx = getMvpContext(sessionId);
    if (ctx?.gate?.allowlist?.length) allowlist = [...ctx.gate.allowlist];
    else {
      const cap = getCaptureSession(sessionId);
      allowlist = [...(cap?.ingestion?.uniqueOrigins ?? [])];
    }
  }

  let traceHints: unknown = input.traceHints;
  if (sessionId) {
    const session = getCaptureSession(sessionId);
    const fromCapture = session?.ingestion?.uniqueOrigins;
    if (fromCapture?.length) {
      const hintsObj =
        typeof traceHints === "object" && traceHints !== null && !Array.isArray(traceHints)
          ? { ...(traceHints as Record<string, unknown>) }
          : {};
      const prev = Array.isArray(hintsObj.origins)
        ? (hintsObj.origins as unknown[]).map((x) => String(x))
        : [];
      hintsObj.origins = [...new Set([...prev, ...fromCapture])];
      traceHints = hintsObj;
    }
  }

  const paths = await searchTrajectories({ goal, allowlist, traceHints });
  return {
    paths,
    note: "MVP: deterministic stub paths; pass goal + sessionId to tie to capture.",
  };
}
