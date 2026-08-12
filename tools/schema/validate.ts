import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import matter from "gray-matter";
import { runtimeEnv } from "../../src/lib/runtime-config.ts";

import anniversarySchema from "../../schemas/anniversary.schema.json" with { type: "json" };
import contentPackageSchema from "../../schemas/content-package.schema.json" with { type: "json" };
import contentSchema from "../../schemas/content.schema.json" with { type: "json" };
import discoveryRecordSchema from "../../schemas/discovery-record.schema.json" with { type: "json" };
import encyclopediaProfileSchema from "../../schemas/encyclopedia-profile.schema.json" with { type: "json" };
import encyclopediaProfileLocaleSchema from "../../schemas/encyclopedia-profile-locale.schema.json" with { type: "json" };
import localeSchema from "../../schemas/locale.schema.json" with { type: "json" };
import manifestSchema from "../../schemas/manifest.schema.json" with { type: "json" };
import retractionSchema from "../../schemas/retraction.schema.json" with { type: "json" };
import singlePageItemSchema from "../../schemas/single-page-item.schema.json" with { type: "json" };
import singlePageProfileSchema from "../../schemas/single-page-profile.schema.json" with { type: "json" };
import sourceSchema from "../../schemas/source.schema.json" with { type: "json" };
import visualCatalogSchema from "../../schemas/visual-catalog.schema.json" with { type: "json" };

function resolveRepositoryRoot(): string {
  const explicit = runtimeEnv("MOMOKO_REPO_ROOT");
  if (explicit && path.isAbsolute(explicit)) return explicit;
  try {
    return path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
  } catch {
    return typeof process.cwd === "function" ? process.cwd() : "/";
  }
}

export const REPO_ROOT = resolveRepositoryRoot();
const CONFIG = path.join(REPO_ROOT, "config");

const schemaDocs = new Map<string, Record<string, unknown>>([
  ["anniversary.schema.json", anniversarySchema as Record<string, unknown>],
  ["content-package.schema.json", contentPackageSchema as Record<string, unknown>],
  ["content.schema.json", contentSchema as Record<string, unknown>],
  ["discovery-record.schema.json", discoveryRecordSchema as Record<string, unknown>],
  ["encyclopedia-profile.schema.json", encyclopediaProfileSchema as Record<string, unknown>],
  ["encyclopedia-profile-locale.schema.json", encyclopediaProfileLocaleSchema as Record<string, unknown>],
  ["locale.schema.json", localeSchema as Record<string, unknown>],
  ["manifest.schema.json", manifestSchema as Record<string, unknown>],
  ["retraction.schema.json", retractionSchema as Record<string, unknown>],
  ["single-page-item.schema.json", singlePageItemSchema as Record<string, unknown>],
  ["single-page-profile.schema.json", singlePageProfileSchema as Record<string, unknown>],
  ["source.schema.json", sourceSchema as Record<string, unknown>],
  ["visual-catalog.schema.json", visualCatalogSchema as Record<string, unknown>],
]);

type Schema = Record<string, unknown>;

function pointerGet(value: unknown, pointer: string): unknown {
  let current = value;
  for (const part of pointer.replace(/^\//, "").split("/")) {
    if (!part) continue;
    if (!current || typeof current !== "object") return undefined;
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function fallbackFormat(format: string, value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  if (format === "date") return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  if (format === "date-time") return !Number.isNaN(Date.parse(value)) && /T\d{2}:\d{2}/.test(value);
  if (format === "uri") {
    try {
      const parsed = new URL(value);
      return Boolean(parsed.protocol && parsed.hostname);
    } catch {
      return false;
    }
  }
  return true;
}

function fallbackTypeMatches(type: unknown, value: unknown): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some((candidate) => {
    switch (candidate) {
      case "object": return value !== null && typeof value === "object" && !Array.isArray(value);
      case "array": return Array.isArray(value);
      case "string": return typeof value === "string";
      case "integer": return typeof value === "number" && Number.isInteger(value);
      case "number": return typeof value === "number" && Number.isFinite(value);
      case "boolean": return typeof value === "boolean";
      case "null": return value === null;
      default: return true;
    }
  });
}

function fallbackSchemaValid(schemaFile: string, instance: unknown): { valid: boolean; errors?: string } {
  const root = schemaDocs.get(schemaFile);
  if (!root) return { valid: false, errors: "schema_not_loaded" };
  const errors: string[] = [];

  const visit = (value: unknown, schema: Schema, currentRoot: Schema, pathName: string): boolean => {
    if (typeof schema.$ref === "string") {
      const [refFile, fragment = ""] = schema.$ref.split("#", 2);
      const referencedRoot = refFile ? schemaDocs.get(refFile) : currentRoot;
      const referenced = referencedRoot && (fragment ? pointerGet(referencedRoot, fragment) : referencedRoot);
      return referenced && typeof referenced === "object"
        ? visit(value, referenced as Schema, referencedRoot as Schema, pathName)
        : false;
    }
    if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
      errors.push(`${pathName}: const`);
      return false;
    }
    if (Array.isArray(schema.enum) && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
      errors.push(`${pathName}: enum`);
      return false;
    }
    if (schema.type !== undefined && !fallbackTypeMatches(schema.type, value)) {
      errors.push(`${pathName}: type`);
      return false;
    }
    if (typeof schema.format === "string" && !fallbackFormat(schema.format, value)) {
      errors.push(`${pathName}: format`);
      return false;
    }
    if (typeof value === "string") {
      if (typeof schema.minLength === "number" && value.length < schema.minLength) errors.push(`${pathName}: minLength`);
      if (typeof schema.maxLength === "number" && value.length > schema.maxLength) errors.push(`${pathName}: maxLength`);
      if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) errors.push(`${pathName}: pattern`);
    }
    if (typeof value === "number") {
      if (typeof schema.minimum === "number" && value < schema.minimum) errors.push(`${pathName}: minimum`);
      if (typeof schema.maximum === "number" && value > schema.maximum) errors.push(`${pathName}: maximum`);
    }
    if (Array.isArray(value)) {
      if (typeof schema.minItems === "number" && value.length < schema.minItems) errors.push(`${pathName}: minItems`);
      if (schema.uniqueItems === true) {
        const unique = new Set(value.map((item) => JSON.stringify(item)));
        if (unique.size !== value.length) errors.push(`${pathName}: uniqueItems`);
      }
      if (schema.items && typeof schema.items === "object") {
        value.forEach((item, index) => visit(item, schema.items as Schema, currentRoot, `${pathName}/${index}`));
      }
    }
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      if (Array.isArray(schema.required)) {
        for (const key of schema.required) {
          if (typeof key === "string" && !(key in record)) errors.push(`${pathName}: required`);
        }
      }
      const properties = schema.properties && typeof schema.properties === "object" ? schema.properties as Record<string, Schema> : {};
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(record)) if (!(key in properties)) errors.push(`${pathName}: additionalProperties`);
      }
      for (const [key, child] of Object.entries(properties)) {
        if (key in record) visit(record[key], child, currentRoot, `${pathName}/${key}`);
      }
    }
    if (Array.isArray(schema.allOf)) {
      for (const child of schema.allOf) if (child && typeof child === "object") visit(value, child as Schema, currentRoot, pathName);
    }
    if (schema.if && typeof schema.if === "object") {
      const before = errors.length;
      visit(value, schema.if as Schema, currentRoot, pathName);
      const condition = errors.length === before;
      errors.length = before;
      const branch = condition ? schema.then : schema.else;
      if (branch && typeof branch === "object") visit(value, branch as Schema, currentRoot, pathName);
    }
    if (schema.not && typeof schema.not === "object") {
      const before = errors.length;
      visit(value, schema.not as Schema, currentRoot, pathName);
      const matched = errors.length === before;
      errors.length = before;
      if (matched) errors.push(`${pathName}: not`);
    }
    return true;
  };

  visit(instance, root, root, "$");
  return errors.length === 0 ? { valid: true } : { valid: false, errors: errors[0] ?? "schema_invalid" };
}

export function validateFile(
  schemaFile: string,
  instance: unknown,
): { valid: boolean; errors?: string } {
  return fallbackSchemaValid(schemaFile, instance);
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

/** is_canonical=true → content.schema.json; is_canonical=false → locale.schema.json. */
export function schemaForContentFile(file: FrontmatterDoc): string {
  const data = file.data as Record<string, unknown>;
  if (data.is_canonical === true) return "content.schema.json";
  if (data.is_canonical === false) return "locale.schema.json";
  throw new Error(`content file must declare is_canonical (true|false): ${file.path}`);
}

export function validateContentFile(file: FrontmatterDoc): { valid: boolean; errors?: string } {
  return validateFile(schemaForContentFile(file), file.data);
}
