/**
 * Skill Factory backend origin (no trailing slash). Baked into the extension build — users don’t configure this in UI.
 * Override when publishing (e.g. production API hostname).
 */
export const SKILL_FACTORY_API_ORIGIN = "http://127.0.0.1:8787";

export function skillFactoryApiBase(): string {
  return SKILL_FACTORY_API_ORIGIN.replace(/\/$/, "");
}
