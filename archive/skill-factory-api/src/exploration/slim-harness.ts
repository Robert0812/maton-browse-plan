import type { HarnessInstallerCron, HarnessInstallerSite, HarnessInstallerSpec } from "@skill-factory/shared";

/** Meta lines that belong in pipeline logs, not in the agent-facing installer payload. */
const SETUP_STEP_NOISE =
  /phase\s*4|re-?run\s+send|full\s+pipeline|heuristic\s+installer|llm\s+not|openai_api_key.*skill\s+factory|the\s+model\s+should\s+search\s+skillhub|clawhub|jackwener\/opencli|discovery\/research\s+surfaces/i;

/**
 * Final trim before sync: drop noisy setup lines and empty cron rationales.
 */
export function slimHarnessForPublish(h: HarnessInstallerSpec): HarnessInstallerSpec {
  const sites: HarnessInstallerSite[] = h.sites.map((site) => ({
    origin: site.origin,
    rank: site.rank,
    setupSteps: slimSetupSteps(site.setupSteps),
    plans: site.plans,
  }));

  const cronSuggestions: HarnessInstallerCron[] = h.cronSuggestions.map((c) => ({
    ...c,
    rationale: "",
  }));

  return {
    generatedAt: h.generatedAt,
    sites,
    cronSuggestions,
  };
}

function slimSetupSteps(steps: string[]): string[] {
  const filtered = steps.filter((s) => !SETUP_STEP_NOISE.test(s));
  if (filtered.length > 0) return filtered;
  if (steps.length > 0) return [steps[0]!];
  return [];
}
