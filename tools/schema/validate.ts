import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import matter from "gray-matter";

export const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SCHEMAS = path.join(REPO_ROOT, "schemas");
const CONFIG = path.join(REPO_ROOT, "config");

const ajv = new Ajv2020({ allErrors: false, strict: false });
addFormats(ajv);

function loadSchema(name: string): Record<string, unknown> {
  const doc = JSON.parse(fs.readFileSync(path.join(SCHEMAS, name), "utf-8"));
  if (doc.$id) ajv.addSchema(doc as object, doc.$id);
  // Cross-file $refs use the basename (e.g. "source.schema.json#/$defs/...").
  // Register under the basename so relative refs resolve, mirroring the
  // Python registry in tools/schema/validate_schemas.py.
  ajv.addSchema(doc as object, name);
  return doc;
}

const schemaFiles = fs
  .readdirSync(SCHEMAS)
  .filter((f) => f.endsWith(".schema.json"))
  .sort();

// Register ALL schemas first (both $id and basename keys) so cross-file $refs
// resolve regardless of compile order; then compile each validator.
const schemaDocs = new Map<string, Record<string, unknown>>();
for (const f of schemaFiles) {
  schemaDocs.set(f, loadSchema(f));
}

const loaded = new Map<string, ValidateFunction>();
for (const f of schemaFiles) {
  loaded.set(f, ajv.compile(schemaDocs.get(f)!));
}

export function validateFile(
  schemaFile: string,
  instance: unknown,
): { valid: boolean; errors?: string } {
  const validate = loaded.get(schemaFile);
  if (!validate) throw new Error(`schema not loaded: ${schemaFile}`);
  const ok = validate(instance);
  return ok ? { valid: true } : { valid: false, errors: JSON.stringify(validate.errors) };
}

export function validateSources(): { valid: boolean; errors?: string } {
  const instance = JSON.parse(fs.readFileSync(path.join(CONFIG, "sources.json"), "utf-8"));
  return validateFile("source.schema.json", instance);
}

export interface FrontmatterDoc {
  path: string;
  data: Record<string, unknown>;
}

export function collectContentFiles(contentRoot = path.join(REPO_ROOT, "content")): FrontmatterDoc[] {
  const root = path.resolve(contentRoot);
  const out: FrontmatterDoc[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        const { data, content } = matter(fs.readFileSync(full, "utf-8"));
        // body is the markdown content; the schemas model the parsed object.
        out.push({
          path: path.relative(REPO_ROOT, full),
          data: { ...(data as Record<string, unknown>), body: content.trim() },
        });
      }
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}

/** index.md → content.schema.json; content.<lang>.md → locale.schema.json. */
export function schemaForContentFile(file: FrontmatterDoc): string {
  const base = path.basename(file.path);
  return /^content\.(ja|zh|en)\.md$/.test(base) ? "locale.schema.json" : "content.schema.json";
}

export function validateContentFile(file: FrontmatterDoc): { valid: boolean; errors?: string } {
  return validateFile(schemaForContentFile(file), file.data);
}
