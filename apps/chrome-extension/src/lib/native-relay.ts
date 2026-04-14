/** Chrome native messaging host — see apps/maton-native-host (install script required). */
export const NATIVE_RELAY_HOST_NAME = "com.maton.browse_relay";

/** Prevents the popup from hanging if Chrome or the host never responds. */
const NATIVE_MESSAGE_TIMEOUT_MS = 15_000;

export interface NativeRelayResponse {
  ok?: boolean;
  error?: string;
  detail?: string;
  running?: boolean;
  healthy?: boolean;
  pid?: number;
  port?: number;
  already?: boolean;
  stopped?: boolean;
  message?: string;
  /** GET /health works but PID was not tracked by the native helper */
  adopted?: boolean;
  killedPids?: number[];
}

function send(cmd: string, payload: Record<string, unknown> = {}): Promise<NativeRelayResponse> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`Native messaging timed out after ${NATIVE_MESSAGE_TIMEOUT_MS / 1000}s`));
    }, NATIVE_MESSAGE_TIMEOUT_MS);

    chrome.runtime.sendNativeMessage(NATIVE_RELAY_HOST_NAME, { cmd, ...payload }, (response: NativeRelayResponse) => {
      window.clearTimeout(timer);
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response ?? {});
    });
  });
}

export async function nativeRelayStart(port: number, token?: string): Promise<NativeRelayResponse> {
  return send("start", { port, ...(token ? { token } : {}) });
}

export async function nativeRelayStop(port: number): Promise<NativeRelayResponse> {
  return send("stop", { port });
}

export async function nativeRelayStatus(port: number): Promise<NativeRelayResponse> {
  return send("status", { port });
}

export function formatNativeRelayError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/forbidden/i.test(msg)) {
    return (
      `${msg} — Re-run install-native-host with the exact Extension ID from chrome://extensions ` +
      `(it changes if you load a different folder). The installer must target the browser you use ` +
      `(Chrome vs Brave vs Edge, etc.); from the repo root: EXTENSION_ID=<id> npm run install-native-host`
    );
  }
  return msg;
}
