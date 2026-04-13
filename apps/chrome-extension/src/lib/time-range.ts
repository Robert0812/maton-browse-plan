import type { CapturePreset, RelayRefreshPreset } from "./types.js";

/** Start of window in ms since epoch for a preset ending at `now`. */
export function presetToStartMs(preset: CapturePreset, now = Date.now()): number {
  switch (preset) {
    case "1h":
      return now - 60 * 60 * 1000;
    case "24h":
      return now - 24 * 60 * 60 * 1000;
    case "3d":
      return now - 3 * 24 * 60 * 60 * 1000;
    case "7d":
      return now - 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return now - 30 * 24 * 60 * 60 * 1000;
    case "custom":
      return now - 24 * 60 * 60 * 1000;
  }
}

/** Chrome `alarms` period (minutes); minimum 1 in MV3. */
export function relayRefreshPresetToPeriodMinutes(preset: RelayRefreshPreset): number {
  switch (preset) {
    case "30m":
      return 30;
    case "1h":
      return 60;
    case "3h":
      return 180;
    case "6h":
      return 360;
    case "12h":
      return 720;
    case "24h":
      return 1440;
  }
}

export function relayRefreshPresetToPeriodMs(preset: RelayRefreshPreset): number {
  return relayRefreshPresetToPeriodMinutes(preset) * 60 * 1000;
}
