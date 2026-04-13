/**
 * Browse-derived **preference signals** for Maton + ClawHub API Gateway (OpenClaw/Hermes agents use this to
 * proactively suggest which OAuth connections to add or refresh). Connector ids are *hints* — validate against
 * Maton’s catalog / ctrl.maton.ai before any automation.
 */
export const MATON_BROWSE_PLAN_VERSION = "1.0" as const;

/** Minimal site shape from heuristic clustering (keeps this module free of intent-cluster imports). */
export interface MatonPlanSiteInput {
  rank: number;
  origin: string;
  siteUrl: string;
  functions: { resourceUrl: string }[];
}

export interface MatonServiceHint {
  /** Heuristic id (e.g. `github`, `notion`); must be aligned with Maton’s connector registry. */
  matonConnectorHint: string;
  /** Why this was suggested (hostname / path rule). */
  matchedRule: string;
}

export interface MatonOriginSuggestion {
  rank: number;
  origin: string;
  siteUrl: string;
  matonHints: MatonServiceHint[];
  /** Representative URLs from clustered “functions” (query-bearing history). */
  resourceUrls: string[];
}

export interface MatonBrowseDerivedPlan {
  schemaVersion: typeof MATON_BROWSE_PLAN_VERSION;
  source: "maton-browse-plan-chrome-extension";
  /** Intended consumer: extended ClawHub API Gateway skill + Maton workspace. */
  skillTarget: "clawhub:byungkyu/api-gateway";
  matonProductUrl: "https://www.maton.ai/";
  generatedAt: string;
  /** History window label for this export (e.g. `7d`, `30d`) — helps the agent reason about recency. */
  capturePreset?: string;
  suggestions: MatonOriginSuggestion[];
}

const HOST_RULES: ReadonlyArray<{ test: (host: string) => boolean; hints: MatonServiceHint[] }> = [
  {
    test: (h) => h.includes("github.com") || h.endsWith(".github.io"),
    hints: [
      { matonConnectorHint: "github", matchedRule: "hostname: github" },
    ],
  },
  {
    test: (h) => h.includes("google.") || h === "gmail.com" || h.includes("googleapis.com"),
    hints: [{ matonConnectorHint: "google_workspace", matchedRule: "hostname: google workspace family" }],
  },
  {
    test: (h) => h.includes("notion.so"),
    hints: [{ matonConnectorHint: "notion", matchedRule: "hostname: notion" }],
  },
  {
    test: (h) => h.includes("slack.com"),
    hints: [{ matonConnectorHint: "slack", matchedRule: "hostname: slack" }],
  },
  {
    test: (h) => h.includes("airtable.com"),
    hints: [{ matonConnectorHint: "airtable", matchedRule: "hostname: airtable" }],
  },
  {
    test: (h) => h.includes("hubspot.com"),
    hints: [{ matonConnectorHint: "hubspot", matchedRule: "hostname: hubspot" }],
  },
  {
    test: (h) => h.includes("linear.app"),
    hints: [{ matonConnectorHint: "linear", matchedRule: "hostname: linear" }],
  },
  {
    test: (h) => h.includes("figma.com"),
    hints: [{ matonConnectorHint: "figma", matchedRule: "hostname: figma" }],
  },
  {
    test: (h) => h.includes("atlassian.net") || h.includes("jira.com") || h.includes("confluence"),
    hints: [{ matonConnectorHint: "atlassian", matchedRule: "hostname: atlassian/jira" }],
  },
  {
    test: (h) => h.includes("microsoft.com") || h.includes("office.com") || h.includes("live.com"),
    hints: [{ matonConnectorHint: "microsoft_365", matchedRule: "hostname: microsoft" }],
  },
  {
    test: (h) => h.includes("dropbox.com"),
    hints: [{ matonConnectorHint: "dropbox", matchedRule: "hostname: dropbox" }],
  },
  {
    test: (h) => h.includes("salesforce.com"),
    hints: [{ matonConnectorHint: "salesforce", matchedRule: "hostname: salesforce" }],
  },
];

function hostnameFromOrigin(origin: string): string {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function hintsForHost(host: string): MatonServiceHint[] {
  if (!host) return [];
  for (const rule of HOST_RULES) {
    if (rule.test(host)) {
      return rule.hints.map((h) => ({ ...h }));
    }
  }
  return [];
}

/** Build a Maton-oriented plan from the same clustered sites used for review / download. */
export function buildMatonBrowseDerivedPlan(
  sites: MatonPlanSiteInput[],
  generatedAt: string,
  capturePreset?: string,
): MatonBrowseDerivedPlan {
  const suggestions: MatonOriginSuggestion[] = sites.map((s) => {
    const host = hostnameFromOrigin(s.origin);
    const matonHints = hintsForHost(host);
    const resourceUrls = s.functions.map((f) => f.resourceUrl).filter(Boolean);
    return {
      rank: s.rank,
      origin: s.origin,
      siteUrl: s.siteUrl,
      matonHints,
      resourceUrls,
    };
  });

  return {
    schemaVersion: MATON_BROWSE_PLAN_VERSION,
    source: "maton-browse-plan-chrome-extension",
    skillTarget: "clawhub:byungkyu/api-gateway",
    matonProductUrl: "https://www.maton.ai/",
    generatedAt,
    ...(capturePreset ? { capturePreset } : {}),
    suggestions,
  };
}
