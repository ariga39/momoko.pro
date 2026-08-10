/**
 * S6 single-page materialization driver (task #31, serika).
 *
 * Consumes ONLY the already-extracted allowlisted S6 fields (no re-fetch, no
 * raw HTML) and persists a canonical ja + zh/en AI-draft bundle through the
 * editorial seam. Re-running with the same fields is a zero-diff no-op.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

import { materializeDiscovery } from "../editorial/editorial.ts";
import {
  S6_SOURCE_ITEM_ID,
  S6_TITLE,
  S6_CANONICAL_URL,
  S6_LNG,
  buildS6BundleRecord,
  type S6PageData,
} from "./s6.ts";

export const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** The frozen allowlisted fields extracted from the single live GET. */
export function s6PageData(): S6PageData {
  return {
    source_item_id: S6_SOURCE_ITEM_ID,
    url: S6_CANONICAL_URL,
    title: S6_TITLE,
    dspdate: "2026/05/25 21:00",
    lng: S6_LNG,
    publish_status: "publish",
  };
}

export interface MaterializeS6Result {
  ok: boolean;
  changed: boolean;
  contentPath?: string;
  error?: string;
}

/**
 * Materialize the S6 bundle through the editorial seam. `root` defaults to the
 * repository root so content lands at content/news/2026/S6-01_18661/.
 */
export function materializeS6(root = REPO_ROOT): MaterializeS6Result {
  const { item, translationDrafts } = buildS6BundleRecord(s6PageData());
  const result = materializeDiscovery(item, {
    root,
    at: "2026-05-25T21:00:00+09:00",
    actor: "serika-ai-draft",
    actor_kind: "ai",
    reason: "task #31 S6 human-directed single-page sample",
    risk_tier: "T1",
    translation_drafts: translationDrafts,
  });
  if (!result.ok) {
    return { ok: false, changed: false, error: result.error.message };
  }
  return { ok: true, changed: result.changed, contentPath: result.value.content_path };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = materializeS6();
  if (!result.ok) {
    console.error(`S6 materialize failed: ${result.error}`);
    process.exit(1);
  }
  console.log(
    result.changed
      ? `S6 materialized -> ${result.contentPath}`
      : `S6 unchanged (zero-diff no-op) -> ${result.contentPath}`,
  );
}
