import type { CaptureSession } from "@skill-factory/shared";
import { randomUUID } from "node:crypto";
import { normalizeTraceEvents, normalizeWindow, summarizeIngestion } from "../capture-ingest.js";
import { putCaptureSession } from "../session-store.js";

export interface PhaseCaptureResult {
  session: CaptureSession;
  droppedInvalid: number;
  persisted: "memory";
  note: string;
}

/**
 * Phase 1 — ingest extension batch; session is keyed for later phases via `session.id`.
 */
export async function phaseCapture(input: Record<string, unknown>): Promise<PhaseCaptureResult> {
  const userId = typeof input.userId === "string" && input.userId.trim() ? input.userId.trim() : "chrome-extension";
  const window = normalizeWindow(input.window);
  const { events, droppedInvalid } = normalizeTraceEvents(input.events);

  const clientExportedAt =
    typeof input.exportedAt === "string" && input.exportedAt.trim() ? input.exportedAt.trim() : undefined;

  const ingestion = summarizeIngestion(events, droppedInvalid);

  const session: CaptureSession = {
    id: randomUUID(),
    userId,
    startedAt: new Date().toISOString(),
    window,
    events,
    ...(clientExportedAt ? { clientExportedAt } : {}),
    ingestion,
  };

  putCaptureSession(session);

  console.log(
    `[phase:capture] session=${session.id} rows=${events.length} droppedInvalid=${droppedInvalid} userId=${userId}`,
  );

  return {
    session,
    droppedInvalid,
    persisted: "memory",
    note: "MVP: session stored in memory; use session.id for phases 2–6.",
  };
}
