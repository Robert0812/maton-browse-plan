import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const apiMdPath = join(pkgRoot, "api.md");
/** Optional user-provided keys (same format as shell exports). Not committed to git. */
const downloadsOpenAiPath = join(homedir(), "Downloads", "OpenAI-API.md");

/** Parses `KEY=value` or `export KEY=value`; `#` starts a comment line. */
function parseEnvFile(content: string): { apiKey?: string; baseUrl?: string } {
  let apiKey: string | undefined;
  let baseUrl: string | undefined;
  const text = content.replace(/^\uFEFF/, "");
  for (const line of text.split(/\r?\n/)) {
    let t = line.trim();
    if (!t || t.startsWith("#")) continue;
    if (t.startsWith("export ")) t = t.slice(7).trim();
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    v = v.replace(/^["']|["']$/g, "").trim();
    if (k === "OPENAI_API_KEY" && v) apiKey = v;
    if (k === "OPENAI_BASE_URL" && v) baseUrl = v;
  }
  return { apiKey, baseUrl };
}

function loadFromOptionalFile(path: string): { apiKey?: string; baseUrl?: string } {
  if (!existsSync(path)) return {};
  try {
    return parseEnvFile(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

/**
 * OpenAI-compatible chat URL config.
 *
 * **Precedence (first non-empty `OPENAI_API_KEY` wins):**
 * 1. `~/Downloads/OpenAI-API.md` — personal dev keys (avoids stale keys stuck in shell `export OPENAI_API_KEY=…`)
 * 2. `apps/skill-factory-api/api.md` — project-local (gitignored)
 * 3. `process.env` — CI / explicit
 *
 * Base URL: taken from the same winning row when present; otherwise first non-empty among
 * Downloads → api.md → env → OpenAI default.
 */
export function loadOpenAiCompatConfig(): { apiKey?: string; baseUrl: string; source?: string } {
  const fromPkg = loadFromOptionalFile(apiMdPath);
  const fromDownloads = loadFromOptionalFile(downloadsOpenAiPath);

  const envKey = process.env.OPENAI_API_KEY?.trim();
  const envBase = process.env.OPENAI_BASE_URL?.trim();

  let apiKey: string | undefined;
  let pickedBase: string | undefined;
  let source: string | undefined;

  if (fromDownloads.apiKey) {
    apiKey = fromDownloads.apiKey;
    pickedBase = fromDownloads.baseUrl;
    source = downloadsOpenAiPath;
  } else if (fromPkg.apiKey) {
    apiKey = fromPkg.apiKey;
    pickedBase = fromPkg.baseUrl;
    source = apiMdPath;
  } else if (envKey) {
    apiKey = envKey;
    pickedBase = envBase;
    source = "env";
  }

  const baseUrl = (
    pickedBase ||
    fromDownloads.baseUrl ||
    fromPkg.baseUrl ||
    envBase ||
    "https://api.openai.com/v1"
  ).replace(/\/$/, "");

  return { apiKey: apiKey || undefined, baseUrl, source };
}

/** Short label for logs (no secrets). */
export function describeOpenAiKeySource(source: string | undefined): string {
  if (!source) return "none";
  if (source === "env") return "env:OPENAI_API_KEY";
  if (source === downloadsOpenAiPath) return "~/Downloads/OpenAI-API.md";
  if (source === apiMdPath) return "apps/skill-factory-api/api.md";
  return basename(source);
}

export function openAiChatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl}/chat/completions`;
}
