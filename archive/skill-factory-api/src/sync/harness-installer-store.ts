import type { HarnessInstallerSpec } from "@skill-factory/shared";
import { createHash } from "node:crypto";
import { slimHarnessForPublish } from "../exploration/slim-harness.js";

export interface PublishedHarnessEntry {
  userId: string;
  harness: HarnessInstallerSpec;
  updatedAt: string;
  etag: string;
}

const byUser = new Map<string, PublishedHarnessEntry>();

function makeEtag(harness: HarnessInstallerSpec, updatedAt: string): string {
  const h = createHash("sha256");
  h.update(updatedAt);
  h.update(JSON.stringify(harness));
  return `"${h.digest("hex").slice(0, 32)}"`;
}

export function publishHarnessInstaller(userId: string, harness: HarnessInstallerSpec): PublishedHarnessEntry {
  const uid = userId.trim() || "chrome-extension";
  const updatedAt = new Date().toISOString();
  const slim = slimHarnessForPublish(harness);
  const etag = makeEtag(slim, updatedAt);
  const entry: PublishedHarnessEntry = { userId: uid, harness: slim, updatedAt, etag };
  byUser.set(uid, entry);
  return entry;
}

export function getPublishedHarness(userId: string): PublishedHarnessEntry | undefined {
  const uid = userId.trim() || "chrome-extension";
  return byUser.get(uid);
}
