export const EVENTS_LIVE_KEY = "sf_events_live_v0";
export const EVENTS_HISTORY_KEY = "sf_events_history_v0";
/** Pre–split storage; migrated once into live/history keys. */
export const LEGACY_EVENTS_KEY = "sf_capture_v0";

/** User-chosen history window for top-site ranking + relay payload (`CapturePreset`). */
export const SF_CAPTURE_PRESET_KEY = "sf_capture_preset";
/** While true, relay alarm may run and UI shows accumulation status. */
export const SF_RELAY_SESSION_ACTIVE_KEY = "sf_relay_session_active";
export const SF_LAST_RELAY_PUSH_AT_KEY = "sf_last_relay_push_at";
export const SF_RELAY_REFRESH_PRESET_KEY = "sf_relay_refresh_preset";
/** Last successful relay ingest metrics (merged rows, relay port). */
export const SF_LAST_INGEST_STATS_KEY = "sf_last_ingest_stats";

export const MATON_RELAY_REFRESH_ALARM = "maton_relay_refresh";
