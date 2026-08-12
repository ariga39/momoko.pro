// @ts-check
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import cloudflare from "@astrojs/cloudflare";
import { defineConfig } from "astro/config";

const CONTENT_ROOT_ENV = "MOMOKO_CONTENT_PACKAGE_ROOT";
const CONTENT_MODE_ENV = "MOMOKO_CONTENT_PACKAGE_MODE";

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function selectedContentPackage() {
  const explicit = process.env[CONTENT_ROOT_ENV];
  const mode = process.env[CONTENT_MODE_ENV];
  const preview = process.env.MOMOKO_CONTENT_PACKAGE_PREVIEW === "1";
  const publicBuild = process.env.PUBLIC_BUILD === "1";
  if (publicBuild && (explicit !== undefined || mode !== undefined || preview)) {
    throw new Error("public build cannot use a content override");
  }
  if (preview && explicit === undefined) {
    throw new Error("content package preview requires an explicit content package");
  }
  if (explicit !== undefined) {
    if (!explicit.trim()) throw new Error(`${CONTENT_ROOT_ENV} is empty`);
    if (mode !== "test" && mode !== "dev") throw new Error(`${CONTENT_MODE_ENV} must be explicitly set to test or dev`);
    if (path.isAbsolute(explicit)) throw new Error("content package root must be a relative repository path");
  } else if (mode !== undefined) {
    throw new Error(`${CONTENT_MODE_ENV} requires an explicit ${CONTENT_ROOT_ENV}`);
  }
  const relativeRoot = explicit ?? "content";
  const root = path.resolve(process.cwd(), relativeRoot);
  const allowed = explicit
    ? path.resolve(process.cwd(), mode === "test" ? "tests/fixtures/content-package" : "content-dev")
    : path.resolve(process.cwd(), "content");
  if (explicit && !isInside(root, allowed)) throw new Error("content package is outside its allowed root");
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error("content package directory is missing");
  const allFiles = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error("content package contains a symlink");
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) allFiles[path.relative(root, full).split(path.sep).join("/")] = fs.readFileSync(full, "utf8");
      else throw new Error("content package contains an unsupported entry");
    }
  };
  walk(root);
  const packageManifest = JSON.parse(allFiles["package.json"] ?? "null");
  if (!packageManifest || typeof packageManifest !== "object") {
    throw new Error("content package package.json is not valid JSON");
  }
  const allowedTopLevel = new Set(["package.json", "news", "retractions", "encyclopedia"]);
  if (packageManifest.visual_catalog === "visual-catalog.json") allowedTopLevel.add("visual-catalog.json");
  for (const relativePath of Object.keys(allFiles)) {
    const [topLevel] = relativePath.split("/");
    if (!allowedTopLevel.has(topLevel)) throw new Error("unsupported content package entry");
    if (topLevel === "retractions" && !relativePath.endsWith(".json")) {
      throw new Error("unsupported retraction entry");
    }
    if (topLevel === "news" && !/\/content\.(ja|zh|en)\.md$|\/editorial-history\.json$/.test(relativePath)) {
      if (relativePath.endsWith("/index.md")) {
        throw new Error(`legacy index.md is not allowed (use content.<lang>.md): ${relativePath}`);
      }
      throw new Error("unsupported news entry");
    }
    if (topLevel === "encyclopedia" && !/\/content\.(ja|zh|en)\.md$|\/editorial-history\.json$/.test(relativePath)) {
      if (relativePath.endsWith("/index.md")) {
        throw new Error(`legacy index.md is not allowed (use content.<lang>.md): ${relativePath}`);
      }
      throw new Error("unsupported encyclopedia entry");
    }
  }

  // A server bundle must not carry draft, stale, or retracted editorial
  // bytes. The package manifest is still embedded, but only the current
  // reviewed item directories are copied into the worker module. The normal
  // filesystem loader keeps the complete package available to explicit local
  // review/test runs.
  const activeRetractions = new Set();
  for (const [relativePath, text] of Object.entries(allFiles)) {
    if (!relativePath.startsWith("retractions/")) continue;
    const record = JSON.parse(text);
    if ((record?.status === "requested" || record?.status === "active") && typeof record.content_path === "string") {
      activeRetractions.add(record.content_path);
    }
  }
  if (preview) return { explicit: true, relativeRoot, mode: mode ?? null, files: allFiles };

  const files = { "package.json": allFiles["package.json"] };
  if (packageManifest.visual_catalog === "visual-catalog.json" && allFiles["visual-catalog.json"] !== undefined) {
    files["visual-catalog.json"] = allFiles["visual-catalog.json"];
  }
  const reviewedDirectories = new Set();
  for (const [relativePath, text] of Object.entries(allFiles)) {
    if (!relativePath.startsWith("news/") && !relativePath.startsWith("encyclopedia/")) continue;
    if (relativePath.endsWith("/index.md")) {
      throw new Error(`legacy index.md is not allowed (use content.<lang>.md): ${relativePath}`);
    }
    const base = relativePath.slice(relativePath.lastIndexOf("/") + 1);
    if (!/^content\.(ja|zh|en)\.md$/.test(base)) continue;
    const frontmatter = text.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/)?.[1] ?? "";
    const reviewStatus = frontmatter.match(/^review_status:\s*([^\n#]+)/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
    const isCanonical = frontmatter.match(/^is_canonical:\s*([^\n#]+)/m)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
    const contentPath = `content/${relativePath}`;
    if (reviewStatus === "reviewed" && isCanonical === "true" && !activeRetractions.has(contentPath)) {
      reviewedDirectories.add(path.posix.dirname(relativePath));
    }
  }
  for (const [relativePath, text] of Object.entries(allFiles)) {
    if (relativePath.startsWith("news/") || relativePath.startsWith("encyclopedia/")) {
      const directory = path.posix.dirname(relativePath);
      if (reviewedDirectories.has(directory)) files[relativePath] = text;
    }
  }
  return { explicit: explicit !== undefined, relativeRoot, mode: mode ?? null, files };
}

const contentPackage = selectedContentPackage();

function embeddedPackagePlugin() {
  return {
    name: "momoko-embedded-content-package",
    load(id) {
      if (!id.replaceAll("\\", "/").endsWith("/src/lib/embedded-package.ts")) return undefined;
      return `export const embeddedPackage = ${JSON.stringify({ enabled: true, ...contentPackage })};`;
    },
  };
}

// Git-canonical content with server rendering on Cloudflare Pages Functions.
// Astro i18n routing and the Paraglide UI catalog remain separate from editorial content.
export default defineConfig({
  site: "https://momoko.pro",
  output: "server",
  adapter: cloudflare(),
  trailingSlash: "ignore",
  i18n: {
    locales: ["ja", "zh", "en"],
    defaultLocale: "ja",
    // Every locale is URL-prefixed (including the default), per Astro official
    // i18n routing docs; the root "/" and legacy "/search" negotiation live in
    // src/middleware.ts (context.redirect), since redirectToDefaultLocale is
    // disabled to keep the custom cookie/Accept-Language negotiation.
    routing: {
      prefixDefaultLocale: true,
      redirectToDefaultLocale: false,
    },
  },
  build: {
    // 内容 hash 文件名 → 资产 immutable（§6.3 cache 失效契约）。
    assets: "_assets",
  },
  vite: {
    plugins: [
      {
        name: "paraglide-compile",
        buildStart() {
          execSync(
            "npx @inlang/paraglide-js compile --project ./project.inlang --outdir ./src/paraglide",
            { stdio: "inherit", cwd: process.cwd() },
          );
        },
      },
      embeddedPackagePlugin(),
    ],
  },
});
