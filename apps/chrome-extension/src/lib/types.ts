export interface TraceEvent {
  url: string;
  origin: string;
  path: string;
  dwellMs: number;
  capturedAt: string;
  source?: "live" | "history";
  title?: string;
  visitCount?: number;
  transition?:
    | "navigation"
    | "tab_switch"
    | "tab_close"
    | "capture_stop"
    | "history_import";
}

export type CapturePreset = "1h" | "24h" | "3d" | "7d" | "30d" | "custom";

/** How often to re-rank top sites and POST to the local relay while a session is active. */
export type RelayRefreshPreset = "30m" | "1h" | "3h" | "6h" | "12h" | "24h";

/** Shown in popup when relay session is active (survives popup close). */
export interface LastIngestStats {
  eventCount: number;
  skipped: number;
  siteCount: number;
  relayPort: number;
}

export interface CapturePayload {
  preset: CapturePreset;
  events: TraceEvent[];
  exportedAt: string;
  /** Maton / ClawHub API Gateway — connector hints from clustered browsing (optional). */
  matonPlan?: import("./maton-plan.js").MatonBrowseDerivedPlan;
}
