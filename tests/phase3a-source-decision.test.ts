import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadSources,
  normalizeDiscovery,
  registerSourceAdapter,
  resetAdapters,
  runCron,
  sourceAllowedToFetch,
  type SourceConfig,
} from "../tools/ingest/ingest.ts";
import { createDraftFromDiscovery, derivePublication } from "../tools/editorial/editorial.ts";

const REPO_ROOT = path.resolve(process.cwd());
// The draft root is shared by ingestion tests running in parallel. Adapter
// call counts and the no-op result prove this test did not write it; snapshot
// only public/content/build roots so unrelated workers cannot race the proof.
const OUTPUT_ROOTS = ["src/content", "public", "dist", "dist-public"];

function digestTree(relativeRoot: string): string[] {
  const root = path.join(REPO_ROOT, relativeRoot);
  if (!fs.existsSync(root)) return [];

  const entries: string[] = [];
  const walk = (current: string): void => {
    const names = fs.readdirSync(current).sort();
    for (const name of names) {
      const full = path.join(current, name);
      const relative = path.relative(REPO_ROOT, full);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) {
        entries.push(`${relative}:symlink`);
      } else if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile()) {
        const hash = createHash("sha256").update(fs.readFileSync(full)).digest("hex");
        entries.push(`${relative}:file:${hash}`);
      }
    }
  };
  walk(root);
  return entries;
}

function outputSnapshot(): string[] {
  return OUTPUT_ROOTS.flatMap((root) => digestTree(root));
}

afterEach(() => {
  resetAdapters();
  vi.restoreAllMocks();
});

describe("Phase 3A source-policy no-fetch decision", () => {
  it("blocks every configured source before HTTP or draft/publication writes", async () => {
    const sources = loadSources();
    expect(sources).toHaveLength(5);
    expect(sources.every((source) => source.fetch_frequency === "manual")).toBe(true);
    expect(sources.every((source) => source.automated_fetch === false)).toBe(true);
    expect(sources.every((source) => sourceAllowedToFetch(source, "/") === false)).toBe(true);

    const s1 = sources.find((source) => source.source_id === "S1");
    expect(s1).toMatchObject({
      source_id: "S1",
      robots_http: "404",
      robots_result: "unavailable",
      robots_path_decision: "allow",
      checked_path: "/",
      robots_approved: { allowed: false },
      terms_approved: { allowed: false },
    });

    const adapterCalls = new Map<string, number>();
    for (const source of sources) {
      adapterCalls.set(source.source_id, 0);
      registerSourceAdapter({
        source_id: source.source_id,
        async fetch(config: SourceConfig) {
          adapterCalls.set(source.source_id, adapterCalls.get(source.source_id)! + 1);
          await fetch(String(config.canonical_url));
          return { ok: true, items: [] };
        },
      });
    }

    const http = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("HTTP must not be called"));
    const before = outputSnapshot();
    const result = await runCron();

    expect(result).toEqual({ fetched: [], produced: 0, duplicates: 0, errors: {} });
    expect([...adapterCalls.values()]).toEqual([0, 0, 0, 0, 0]);
    expect(http).not.toHaveBeenCalled();
    expect(outputSnapshot()).toEqual(before);
  });

  it("keeps a synthetic normalized record as an in-memory draft only", () => {
    const before = outputSnapshot();
    const item = normalizeDiscovery({
      schema_version: "1",
      source_id: "S1",
      source_item_id: "phase3a-synthetic-001",
      source_url: "https://example.invalid/phase3a-synthetic-001",
      published_at: "2026-08-09T00:00:00Z",
      title: "Synthetic source-policy probe",
      lang: "ja",
      note: "Synthetic fact note only; untrusted prompt text remains inert data.",
    });
    expect(item).not.toBeNull();

    const draft = createDraftFromDiscovery(item!, {
      actor: "phase3a-synthetic-test",
      at: "2026-08-09T00:00:00Z",
      reason: "source policy negative-path proof",
    });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;

    const projection = derivePublication(draft.value);
    expect(draft.value.canonical.review_status).toBe("draft");
    expect(projection.status).toBe("draft");
    expect(projection.indexable).toBe(false);
    expect(projection.canonical.indexable).toBe(false);
    expect(projection.locales.zh!.indexable).toBe(false);
    expect(projection.locales.en!.indexable).toBe(false);
    expect(outputSnapshot()).toEqual(before);
  });
});
