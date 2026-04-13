import type {
  ClusteredInterestSite,
  FunctionHarnessPlan,
  GoldenPath,
  HarnessAccessPath,
  HarnessDiscoveryMatch,
  HarnessInstallerCron,
  HarnessInstallerSite,
  HarnessInstallerSpec,
  HarnessTier,
  IntentClusterResult,
} from "@skill-factory/shared";
import { randomUUID } from "node:crypto";
import {
  describeOpenAiKeySource,
  loadOpenAiCompatConfig,
  openAiChatCompletionsUrl,
} from "../config/load-openai-config.js";
import type { OriginVisitStats } from "../pipeline/visit-patterns.js";
import { formatCronHintsForLlm } from "../pipeline/visit-patterns.js";
import { capIntentClusterForExploration } from "../intent/heuristic-cluster.js";

const PATHS: HarnessAccessPath[] = ["skill", "cli", "api", "gap"];

function coercePath(x: string): HarnessAccessPath {
  const s = String(x).toLowerCase();
  return PATHS.includes(s as HarnessAccessPath) ? (s as HarnessAccessPath) : "gap";
}

function num01(x: unknown, fallback: number): number {
  const n = typeof x === "number" ? x : Number(x);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function str(x: unknown, fallback = ""): string {
  return typeof x === "string" ? x : x != null ? String(x) : fallback;
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
  const raw = fence ? fence[1]!.trim() : trimmed;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
  return JSON.parse(raw);
}

const DISCOVERY_VIA = new Set<HarnessDiscoveryMatch["discoveredVia"]>([
  "skillhub.cn",
  "clawhub.ai",
  "github.com",
  "opencli",
  "site_api_docs",
]);

function parseDiscoveryMatches(raw: unknown): HarnessDiscoveryMatch[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: HarnessDiscoveryMatch[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const title = str(r.title).trim();
    const url = str(r.url).trim();
    const via = str(r.discoveredVia).trim() as HarnessDiscoveryMatch["discoveredVia"];
    if (!title || !url || !DISCOVERY_VIA.has(via)) continue;
    out.push({ title, url, discoveredVia: via });
  }
  return out.length ? out : undefined;
}

function parseApiDocMatches(raw: unknown): Array<{ title: string; url: string }> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Array<{ title: string; url: string }> = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const title = str(r.title).trim();
    const url = str(r.url).trim();
    if (!title || !url) continue;
    out.push({ title, url });
  }
  return out.length ? out : undefined;
}

function parsePlan(raw: unknown, site: ClusteredInterestSite, fnFallback?: { name: string; resourceUrl: string }): FunctionHarnessPlan | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const functionName = str(o.functionName, fnFallback?.name ?? "function");
  const resourceUrl = str(o.resourceUrl, fnFallback?.resourceUrl ?? site.siteUrl);
  const instructionalPrompt = str(o.instructionalPrompt, "Complete the user task using the recommended path.");
  return {
    functionName,
    resourceUrl,
    coverable: Boolean(o.coverable),
    recommendedPath: coercePath(str(o.recommendedPath, "gap")),
    reliability: num01(o.reliability, 0.5),
    efficiency: num01(o.efficiency, 0.5),
    costNote: str(o.costNote, "unknown"),
    skillhubSearch: o.skillhubSearch != null ? str(o.skillhubSearch) : undefined,
    clawhubSearch: o.clawhubSearch != null ? str(o.clawhubSearch) : undefined,
    skillMatches: parseDiscoveryMatches(o.skillMatches),
    cliMatches: parseDiscoveryMatches(o.cliMatches),
    apiDocMatches: parseApiDocMatches(o.apiDocMatches),
    cliHint: o.cliHint != null ? str(o.cliHint) : undefined,
    apiHint: o.apiHint != null ? str(o.apiHint) : undefined,
    instructionalPrompt,
  };
}

function parseCron(raw: unknown): HarnessInstallerCron | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const origin = str(o.origin);
  const cronExpression = str(o.cronExpression);
  if (!origin || !cronExpression) return null;
  return {
    origin,
    rationale: str(o.rationale, ""),
    cronExpression,
    scheduleSummary: str(o.scheduleSummary, cronExpression),
  };
}

function parseHarnessJson(raw: unknown, cluster: IntentClusterResult): HarnessInstallerSpec | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const nested = o.harness && typeof o.harness === "object" ? (o.harness as Record<string, unknown>) : null;
  const sitesIn = Array.isArray(o.sites)
    ? o.sites
    : Array.isArray(nested?.sites)
      ? nested!.sites
      : [];
  const sites: HarnessInstallerSite[] = [];

  for (let i = 0; i < cluster.sites.length; i++) {
    const site = cluster.sites[i]!;
    const row = sitesIn[i] as Record<string, unknown> | undefined;
    const planRaws = row && Array.isArray(row.plans) ? row.plans : [];
    const plans: FunctionHarnessPlan[] = [];
    if (planRaws.length) {
      for (let j = 0; j < planRaws.length; j++) {
        const fn = site.functions[j];
        const p = parsePlan(planRaws[j], site, fn ? { name: fn.name, resourceUrl: fn.resourceUrl } : undefined);
        if (p) plans.push(p);
      }
    } else {
      for (const fn of site.functions) {
        plans.push({
          functionName: fn.name,
          resourceUrl: fn.resourceUrl,
          coverable: false,
          recommendedPath: "gap",
          reliability: 0.3,
          efficiency: 0.3,
          costNote: "unresolved",
          instructionalPrompt: `Use ${fn.resourceUrl} — refine with skill/CLI/API discovery.`,
        });
      }
    }
    const setupSteps = row && Array.isArray(row.setupSteps) ? row.setupSteps.map((x) => str(x)) : [];
    sites.push({
      origin: str(row?.origin, site.origin),
      rank: typeof row?.rank === "number" ? row.rank : site.rank,
      setupSteps,
      plans: plans.length ? plans : [],
    });
  }

  const cronIn = Array.isArray(o.cronSuggestions) ? o.cronSuggestions : [];
  const cronSuggestions = cronIn.map(parseCron).filter(Boolean) as HarnessInstallerCron[];

  const generatedAt = new Date().toISOString();
  return {
    generatedAt,
    sites,
    cronSuggestions,
  };
}

/** Minimal JSON for LLM: only top origins and sub-function anchors (no stats, captions, or long descriptions). */
function clusterJsonForLlmDiscovery(cluster: IntentClusterResult): string {
  return JSON.stringify(
    {
      originsToSearch: cluster.sites.map((s) => ({
        rank: s.rank,
        origin: s.origin,
        subFunctions: s.functions.map((f) => ({
          name: f.name,
          resourceUrl: f.resourceUrl,
        })),
      })),
    },
    null,
    2,
  );
}

function buildUserPrompt(goal: string, cluster: IntentClusterResult, cronHints: string): string {
  return [
    "You are designing a harness installer for an AI agent.",
    "You MUST plan ONLY for the origins and subFunctions listed in the JSON below — do not add skills, CLIs, or APIs for any other domain.",
    "Treat these URLs as discovery/research surfaces — do NOT paste them alone as the only matches; list concrete pages/repos/docs you infer would help for each origin/subFunction:",
    "- Skills: https://skillhub.cn and https://clawhub.ai",
    "- CLIs/repos: https://github.com/ and the OpenCLI catalog https://github.com/jackwener/opencli",
    "- APIs: official public docs for the site/origin when they exist.",
    "",
    "For each site and each interested function, decide if it can be covered via public skill, CLI, or free API.",
    "Pick the optimal path by estimating reliability, efficiency, and cost (qualitative).",
    "Include instructional prompts the agent can follow.",
    "",
    "For EVERY plan, fill skillMatches and/or cliMatches and/or apiDocMatches with SPECIFIC items (title + url + discoveredVia).",
    "Examples of good URLs: a skill listing page, a GitHub repo, a package README, an API reference path — not only the catalog homepages above.",
    "discoveredVia must be one of: skillhub.cn | clawhub.ai | github.com | opencli | site_api_docs.",
    "",
    "Also propose cron schedules for periodic refresh/automation tied to those paths.",
    "Base timing on visit frequency (use the visit stats below). Use standard 5-field cron syntax.",
    "",
    `User goal (may be empty): ${goal || "(none)"}`,
    "",
    "Top origins and sub-functions to search (only these):",
    clusterJsonForLlmDiscovery(cluster),
    "",
    "Cron timing hints (~visits per day per origin, same order as above — use only to choose schedule; do NOT copy into output JSON):",
    cronHints,
    "",
    "Respond with a single JSON object ONLY (no markdown). Top-level keys: \"sites\" and \"cronSuggestions\". The server will add generatedAt — omit it. Schema:",
    `{`,
    `  "sites": [`,
    `    {`,
    `      "origin": string,`,
    `      "rank": number,`,
    `      "setupSteps": string[],`,
    `      "plans": [`,
    `        {`,
    `          "functionName": string,`,
    `          "resourceUrl": string,`,
    `          "coverable": boolean,`,
    `          "recommendedPath": "skill"|"cli"|"api"|"gap",`,
    `          "reliability": number,`,
    `          "efficiency": number,`,
    `          "costNote": string,`,
    `          "skillMatches"?: [{ "title": string, "url": string, "discoveredVia": "skillhub.cn"|"clawhub.ai"|"github.com"|"opencli"|"site_api_docs" }],`,
    `          "cliMatches"?: [{ "title": string, "url": string, "discoveredVia": "skillhub.cn"|"clawhub.ai"|"github.com"|"opencli"|"site_api_docs" }],`,
    `          "apiDocMatches"?: [{ "title": string, "url": string }],`,
    `          "skillhubSearch"?: string,`,
    `          "clawhubSearch"?: string,`,
    `          "cliHint"?: string,`,
    `          "apiHint"?: string,`,
    `          "instructionalPrompt": string`,
    `        }`,
    `      ]`,
    `    }`,
    `  ],`,
    `  "cronSuggestions": [`,
    `    { "origin": string, "rationale": string, "cronExpression": string, "scheduleSummary": string }`,
    `  ]`,
    `}`,
    "",
    "Return one site object per Phase 3 site in the SAME ORDER as input. Return one plan per function in SAME ORDER.",
    "Do not include summary, interestStats, systemPromptSnippet, memorySnippet, or discoveryNote in the output.",
  ].join("\n");
}

export async function generateHarnessInstallerSpec(input: {
  goal: string;
  cluster: IntentClusterResult;
  visitStats: OriginVisitStats[];
  model?: string;
}): Promise<{ spec: HarnessInstallerSpec | null; error?: string }> {
  const { apiKey, baseUrl, source } = loadOpenAiCompatConfig();
  if (!apiKey) {
    return {
      spec: null,
      error:
        "No OPENAI_API_KEY — add ~/Downloads/OpenAI-API.md or apps/skill-factory-api/api.md or env (see api.md.example).",
    };
  }

  const cluster = capIntentClusterForExploration(input.cluster);
  const originOrder = cluster.sites.map((s) => s.origin);
  const rank = new Map(originOrder.map((o, i) => [o, i]));
  const visitStats = input.visitStats
    .filter((v) => rank.has(v.origin))
    .sort((a, b) => (rank.get(a.origin) ?? 0) - (rank.get(b.origin) ?? 0));

  const model = input.model ?? process.env.OPENAI_MODEL?.trim() ?? "gpt-4o-mini";
  const cronHints = formatCronHintsForLlm(visitStats);
  const userContent = buildUserPrompt(input.goal, cluster, cronHints);

  const url = openAiChatCompletionsUrl(baseUrl);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You output valid JSON only matching the user's schema: only sites and cronSuggestions at the top level (no systemPrompt, memory, discoveryNote, or capture statistics). Prefer documented tools and APIs. When recommendedPath is skill, cli, or api, populate the corresponding match arrays with concrete title+url items.",
        },
        { role: "user", content: userContent },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const t = await res.text();
    const src = describeOpenAiKeySource(source);
    let hint = ` (key source: ${src})`;
    if (res.status === 401 || t.includes("额度") || t.toLowerCase().includes("quota")) {
      hint +=
        " If quota is OK elsewhere, a stale shell OPENAI_API_KEY may have been used before — we now prefer ~/Downloads/OpenAI-API.md over env. Run `unset OPENAI_API_KEY` in the API terminal or fix Downloads file, restart API, send again.";
    }
    return { spec: null, error: `LLM HTTP ${res.status}: ${t.slice(0, 500)}${hint}` };
  }

  const body = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = body.choices?.[0]?.message?.content;
  if (!text) return { spec: null, error: "Empty LLM response" };

  try {
    const raw = extractJsonObject(text);
    const spec = parseHarnessJson(raw, cluster);
    if (!spec) return { spec: null, error: "Could not parse harness JSON" };
    return { spec };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { spec: null, error: `JSON parse: ${msg}` };
  }
}

function tierForPath(p: HarnessAccessPath): HarnessTier {
  if (p === "api") return "P0_parametric";
  return "P1_scripted";
}

/** Map installer spec to golden paths for Phase 5 export compatibility. */
export function goldenPathsFromHarness(spec: HarnessInstallerSpec): GoldenPath[] {
  const paths: GoldenPath[] = [];
  for (const site of spec.sites) {
    for (const plan of site.plans) {
      paths.push({
        id: randomUUID(),
        goalId: plan.functionName,
        skillId: `harness-${site.origin.replace(/[^\w.-]+/g, "_")}-${plan.recommendedPath}`,
        stabilityScore: plan.reliability,
        steps: [
          {
            tier: tierForPath(plan.recommendedPath),
            description: plan.instructionalPrompt.slice(0, 280),
            spec: {
              harnessInstaller: {
                origin: site.origin,
                rank: site.rank,
                recommendedPath: plan.recommendedPath,
                resourceUrl: plan.resourceUrl,
                coverable: plan.coverable,
                skillMatches: plan.skillMatches,
                cliMatches: plan.cliMatches,
                apiDocMatches: plan.apiDocMatches,
                skillhubSearch: plan.skillhubSearch,
                clawhubSearch: plan.clawhubSearch,
                cliHint: plan.cliHint,
                apiHint: plan.apiHint,
                efficiency: plan.efficiency,
                costNote: plan.costNote,
              },
            },
          },
        ],
        provenance: { discoveredAt: spec.generatedAt, sourceTier: tierForPath(plan.recommendedPath) },
      });
    }
  }
  return paths;
}
