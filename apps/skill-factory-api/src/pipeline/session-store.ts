import type { CaptureSession } from "@skill-factory/shared";

/** MVP: in-memory Phase 1 sessions (see `mvp-pipeline-context` for phases 2–6). */
const sessions = new Map<string, CaptureSession>();

export function putCaptureSession(session: CaptureSession): void {
  sessions.set(session.id, structuredClone(session));
}

export function getCaptureSession(id: string): CaptureSession | undefined {
  const s = sessions.get(id);
  return s ? structuredClone(s) : undefined;
}

export function captureSessionCount(): number {
  return sessions.size;
}
