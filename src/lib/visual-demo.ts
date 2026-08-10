import fs from "node:fs";
import path from "node:path";

import { ContentPackageError, getContentRoot, readContentPackageManifest, readEmbeddedPackageFile } from "./content.ts";
import { embeddedPackage } from "./embedded-package.ts";
import { validateFile } from "../../tools/schema/validate.ts";
import { runtimeEnv } from "./runtime-config.ts";

export type VisualLocale = "en" | "ja" | "zh";

export interface VisualLocaleText {
  en: string;
  ja: string;
  zh: string;
}

export interface EncyclopediaEntry {
  id: string;
  name: VisualLocaleText;
  role: VisualLocaleText;
  note: VisualLocaleText;
  tags: string[];
}

export interface SongLiveEntry {
  id: string;
  year: number;
  kind: "song" | "live";
  date: string;
  title: VisualLocaleText;
  venue: VisualLocaleText;
  note: VisualLocaleText;
}

export interface AnniversaryEntry {
  id: string;
  year: number;
  label: VisualLocaleText;
  note: VisualLocaleText;
}

export interface VisualCatalog {
  mode: "empty" | "demo";
  notice: VisualLocaleText;
  encyclopedia: EncyclopediaEntry[];
  songsLive: SongLiveEntry[];
  anniversaries: AnniversaryEntry[];
}

const EMPTY_NOTICE: VisualLocaleText = {
  en: "Coming soon — no reviewed current content is available yet.",
  ja: "準備中 — 現在公開できる確認済みコンテンツはありません。",
  zh: "即将开放 — 目前没有可公开的已审核内容。",
};

function emptyVisualCatalog(): VisualCatalog {
  return {
    mode: "empty",
    notice: EMPTY_NOTICE,
    encyclopedia: [],
    songsLive: [],
    anniversaries: [],
  };
}

function readVisualCatalogFile(filePath: string): VisualCatalog {
  if (!fs.existsSync(filePath)) {
    throw new ContentPackageError("visual_catalog_missing", "declared visual catalog is missing");
  }
  if (fs.lstatSync(filePath).isSymbolicLink() || !fs.statSync(filePath).isFile()) {
    throw new ContentPackageError("visual_catalog_invalid", "declared visual catalog must be a regular file");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    throw new ContentPackageError("visual_catalog_invalid", "visual catalog is not valid JSON");
  }
  const checked = validateFile("visual-catalog.schema.json", raw);
  if (!checked.valid) {
    throw new ContentPackageError("visual_catalog_invalid", "visual catalog failed schema validation");
  }
  const catalog = raw as {
    notice: VisualLocaleText;
    encyclopedia: EncyclopediaEntry[];
    songs_live: SongLiveEntry[];
    anniversaries: AnniversaryEntry[];
  };
  return {
    mode: "demo",
    notice: catalog.notice,
    encyclopedia: catalog.encyclopedia,
    songsLive: catalog.songs_live,
    anniversaries: catalog.anniversaries,
  };
}

function readEmbeddedVisualCatalog(relativePath: string): VisualCatalog {
  let raw: unknown;
  try {
    raw = JSON.parse(readEmbeddedPackageFile(relativePath));
  } catch (error) {
    if (error instanceof ContentPackageError) throw error;
    throw new ContentPackageError("visual_catalog_invalid", "visual catalog is not valid JSON");
  }
  const checked = validateFile("visual-catalog.schema.json", raw);
  if (!checked.valid) throw new ContentPackageError("visual_catalog_invalid", "visual catalog failed schema validation");
  const catalog = raw as {
    notice: VisualLocaleText;
    encyclopedia: EncyclopediaEntry[];
    songs_live: SongLiveEntry[];
    anniversaries: AnniversaryEntry[];
  };
  return {
    mode: "demo",
    notice: catalog.notice,
    encyclopedia: catalog.encyclopedia,
    songsLive: catalog.songs_live,
    anniversaries: catalog.anniversaries,
  };
}

/** Load only an explicit test/dev catalog declared by the validated package manifest. */
export function loadVisualCatalog(): VisualCatalog {
  const root = getContentRoot();
  const manifest = readContentPackageManifest();
  if (!manifest.visual_catalog) return emptyVisualCatalog();
  const mode = runtimeEnv("MOMOKO_CONTENT_PACKAGE_MODE");
  if (mode !== "test" && mode !== "dev") {
    throw new ContentPackageError(
      "visual_catalog_mode_required",
      "visual catalog requires an explicit test or dev content package mode",
    );
  }
  return embeddedPackage.enabled
    ? readEmbeddedVisualCatalog(manifest.visual_catalog)
    : readVisualCatalogFile(path.join(root, manifest.visual_catalog));
}
