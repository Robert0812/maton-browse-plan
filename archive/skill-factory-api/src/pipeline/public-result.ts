import type { CaptureSession } from "@skill-factory/shared";

/**
 * Pipeline responses must not echo full browsing traces — sessions stay server-side for phases 2+.
 * Capture phase otherwise returns megabytes of history (including visitCount=1 rows).
 */
export function sanitizePipelineResultForClient(phase: string, result: unknown): unknown {
  if (phase !== "capture" || result === null || typeof result !== "object") {
    return result;
  }
  const r = result as Record<string, unknown>;
  const session = r.session as CaptureSession | undefined;
  if (!session || !Array.isArray(session.events)) {
    return result;
  }
  const { events, ...sessionRest } = session;
  return {
    ...r,
    session: {
      ...sessionRest,
      eventCount: events.length,
    },
  };
}
