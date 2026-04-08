/**
 * Smoke test: capture (30d-style events) → intent_validation (Phase 3).
 * Run: npm run smoke:intent --workspace=@skill-factory/api
 */
import type { TraceEvent } from "@skill-factory/shared";
import { phaseCapture } from "../src/pipeline/phases/capture.js";
import { phaseIntentValidation } from "../src/pipeline/phases/intent-validation.js";

function iso(d: Date): string {
  return d.toISOString();
}

/** Synthetic mix: high-traffic path-only sites + query-bearing searches (like real 30d history). */
function sample30dBrowsing(): TraceEvent[] {
  const now = Date.now();
  const day = 86400000;
  const h = (daysAgo: number) => iso(new Date(now - daysAgo * day));

  const events: TraceEvent[] = [];

  // Path-only history (should rank in top sites but functions: [])
  events.push({
    url: "https://github.com/org/repo",
    origin: "https://github.com",
    path: "/org/repo",
    dwellMs: 0,
    capturedAt: h(2),
    source: "history",
    visitCount: 55,
    transition: "history_import",
    title: "org/repo",
  });
  events.push({
    url: "https://news.ycombinator.com/",
    origin: "https://news.ycombinator.com",
    path: "/",
    dwellMs: 0,
    capturedAt: h(1),
    source: "history",
    visitCount: 30,
    transition: "history_import",
  });

  // Query-bearing history → should produce functions
  events.push({
    url: "https://www.google.com/search?q=skill+factory+browser+extension&hl=en",
    origin: "https://www.google.com",
    path: "/search",
    dwellMs: 0,
    capturedAt: h(3),
    source: "history",
    visitCount: 8,
    transition: "history_import",
  });
  events.push({
    url: "https://www.google.com/search?q=wondersagent+mcp",
    origin: "https://www.google.com",
    path: "/search",
    dwellMs: 0,
    capturedAt: h(5),
    source: "history",
    visitCount: 6,
    transition: "history_import",
  });
  events.push({
    url: "https://example.com/items?id=item-42&sort=date",
    origin: "https://example.com",
    path: "/items",
    dwellMs: 0,
    capturedAt: h(4),
    source: "history",
    visitCount: 12,
    transition: "history_import",
  });

  // Live row with dwell (raises origin score) but no interested functions from live
  events.push({
    url: "https://docs.cursor.com/how-to",
    origin: "https://docs.cursor.com",
    path: "/how-to",
    dwellMs: 120000,
    capturedAt: h(0.1),
    source: "live",
    transition: "navigation",
  });

  return events;
}

const captured = await phaseCapture({
  userId: "smoke-test",
  window: { preset: "30d" },
  exportedAt: new Date().toISOString(),
  events: sample30dBrowsing(),
});

const sessionId = captured.session.id;
const intent = await phaseIntentValidation({ sessionId });

console.log("--- Phase 3 intent cluster (smoke) ---\n");
console.log(`sessionId: ${sessionId}`);
console.log(JSON.stringify(intent.cluster, null, 2));
console.log("\n--- Note ---\n", intent.note);

let withFns = 0;
let emptyFns = 0;
for (const s of intent.cluster.sites) {
  if (s.functions.length) withFns += 1;
  else emptyFns += 1;
}
console.log(`\nSummary: ${intent.cluster.sites.length} sites; ${withFns} with functions; ${emptyFns} with empty functions (path-only or no query history).`);

if (withFns === 0) {
  console.error("\nFAIL: expected at least one site with query-derived functions.");
  process.exit(1);
}
console.log("\nOK: Phase 3 produced intent analysis for query-bearing history.");
