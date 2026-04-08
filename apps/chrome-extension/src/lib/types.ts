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

export type CapturePreset = "1h" | "24h" | "7d" | "30d" | "custom";

export interface CapturePayload {
  preset: CapturePreset;
  events: TraceEvent[];
  exportedAt: string;
}
