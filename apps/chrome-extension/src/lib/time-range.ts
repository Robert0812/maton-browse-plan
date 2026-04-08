import type { CapturePreset } from "./types.js";

/** Start of window in ms since epoch for a preset ending at `now`. */
export function presetToStartMs(preset: CapturePreset, now = Date.now()): number {
  switch (preset) {
    case "1h":
      return now - 60 * 60 * 1000;
    case "24h":
      return now - 24 * 60 * 60 * 1000;
    case "7d":
      return now - 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return now - 30 * 24 * 60 * 60 * 1000;
    case "custom":
      return now - 24 * 60 * 60 * 1000;
  }
}
