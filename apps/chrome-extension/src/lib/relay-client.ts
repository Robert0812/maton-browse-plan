/** Local maton plan relay (see apps/maton-local-relay). */

export const DEFAULT_RELAY_BASE_URL = "http://127.0.0.1:37191";

/** Web Store build only allows relay on loopback (matches manifest host_permissions). */
export function isAllowedRelayBaseUrl(input: string): boolean {
  const raw = input.trim();
  if (!raw) return true;
  try {
    const u = new URL(raw.includes("://") ? raw : `http://${raw}`);
    const h = u.hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
  } catch {
    return false;
  }
}

/** Clipboard text: user runs this in a terminal at the repo root (extension cannot start Node itself). */
export const RELAY_START_COMMAND_SNIPPET = `cd /path/to/maton-browse-plan
npm run relay`;

const STORAGE_ENABLED = "maton_relay_enabled";
const STORAGE_BASE = "maton_relay_base_url";
const STORAGE_TOKEN = "maton_relay_token";

export interface RelaySettings {
  enabled: boolean;
  baseUrl: string;
  token: string;
}

/** TCP port for the local relay (from saved base URL, default 37191). */
export async function getRelayPortFromSettings(): Promise<number> {
  const s = await loadRelaySettings();
  const base = s.baseUrl.trim() || DEFAULT_RELAY_BASE_URL;
  try {
    const u = new URL(base.includes("://") ? base : `http://${base}`);
    if (u.port) return parseInt(u.port, 10);
  } catch {
    /* ignore */
  }
  return 37191;
}

export async function loadRelaySettings(): Promise<RelaySettings> {
  const r = await chrome.storage.local.get([STORAGE_ENABLED, STORAGE_BASE, STORAGE_TOKEN]);
  let baseUrl =
    typeof r[STORAGE_BASE] === "string" && r[STORAGE_BASE].trim().length > 0
      ? r[STORAGE_BASE].trim()
      : DEFAULT_RELAY_BASE_URL;
  if (!isAllowedRelayBaseUrl(baseUrl)) {
    baseUrl = DEFAULT_RELAY_BASE_URL;
    await chrome.storage.local.set({ [STORAGE_BASE]: baseUrl });
  }
  return {
    enabled: r[STORAGE_ENABLED] === true,
    baseUrl,
    token: typeof r[STORAGE_TOKEN] === "string" ? r[STORAGE_TOKEN] : "",
  };
}

export async function saveRelaySettings(partial: Partial<RelaySettings>): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (partial.enabled !== undefined) patch[STORAGE_ENABLED] = partial.enabled;
  if (partial.baseUrl !== undefined) {
    const t = partial.baseUrl.trim();
    patch[STORAGE_BASE] = isAllowedRelayBaseUrl(t) ? t : DEFAULT_RELAY_BASE_URL;
  }
  if (partial.token !== undefined) patch[STORAGE_TOKEN] = partial.token;
  await chrome.storage.local.set(patch);
}

function normalizeBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export async function fetchRelayHealth(baseUrl: string): Promise<{ ok: boolean; detail?: string }> {
  if (!isAllowedRelayBaseUrl(baseUrl)) {
    return { ok: false, detail: "Relay URL must be localhost or 127.0.0.1 (Web Store build)." };
  }
  const url = `${normalizeBase(baseUrl)}/health`;
  try {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const data = (await res.json()) as { ok?: boolean };
    return data.ok === true ? { ok: true } : { ok: false, detail: "unexpected body" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: msg };
  }
}

export async function postRelayIngest(
  baseUrl: string,
  token: string | undefined,
  body: unknown,
): Promise<{ ok: boolean; detail?: string }> {
  if (!isAllowedRelayBaseUrl(baseUrl)) {
    return { ok: false, detail: "Relay URL must be localhost or 127.0.0.1 (Web Store build)." };
  }
  const url = `${normalizeBase(baseUrl)}/ingest`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const t = token?.trim();
  if (t) headers.Authorization = `Bearer ${t}`;
  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, detail: text || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: msg };
  }
}
