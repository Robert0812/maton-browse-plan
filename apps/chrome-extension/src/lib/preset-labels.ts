import type { CapturePreset, RelayRefreshPreset } from "./types.js";

export function capturePresetLabel(p: CapturePreset): string {
  switch (p) {
    case "1h":
      return "1 hour";
    case "24h":
      return "24 hours";
    case "3d":
      return "3 days";
    case "7d":
      return "7 days";
    case "30d":
      return "30 days";
    case "custom":
      return "custom";
    default:
      return String(p);
  }
}

export function relayRefreshPresetLabel(p: RelayRefreshPreset): string {
  switch (p) {
    case "30m":
      return "30 minutes";
    case "1h":
      return "1 hour";
    case "3h":
      return "3 hours";
    case "6h":
      return "6 hours";
    case "12h":
      return "12 hours";
    case "24h":
      return "24 hours";
    default:
      return String(p);
  }
}
