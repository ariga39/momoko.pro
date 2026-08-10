import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

export interface TailwindColors {
  bg: string;
  surface: string;
  text: string;
  "text-secondary": string;
  accent: string;
  "accent-contrast": string;
  link: string;
  border: string;
  "folio-paper": string;
  "folio-paper-deep": string;
  "folio-navy": string;
  "folio-blue": string;
  "folio-pink-soft": string;
  "folio-pink-ink": string;
  "folio-brass-ink": string;
  "folio-brass-light": string;
}

export interface TailwindTokens {
  colors: TailwindColors;
  __raw: string;
}

/** Parse color tokens from tailwind.config.mjs into a typed key map. */
export function parseCssTokens(): TailwindTokens {
  const raw = fs.readFileSync(path.join(REPO_ROOT, "tailwind.config.mjs"), "utf-8");
  const match = raw.match(/colors:\s*\{([\s\S]*?)\n\s*\}/);
  if (!match) throw new Error("could not locate colors in tailwind.config.mjs");
  const body = match[1];
  if (!body) throw new Error("could not parse colors block");
  const rawColors: Record<string, string> = {};
  for (const m of body.matchAll(/(["']?)([\w-]+)\1:\s*["'](#[\w]+)["']/g)) {
    const key = m[2];
    const value = m[3];
    if (key && value) rawColors[key] = value;
  }
  const colors: TailwindColors = {
    bg: rawColors.bg ?? "",
    surface: rawColors.surface ?? "",
    text: rawColors.text ?? "",
    "text-secondary": rawColors["text-secondary"] ?? "",
    accent: rawColors.accent ?? "",
    "accent-contrast": rawColors["accent-contrast"] ?? "",
    link: rawColors.link ?? "",
    border: rawColors.border ?? "",
    "folio-paper": rawColors["folio-paper"] ?? "",
    "folio-paper-deep": rawColors["folio-paper-deep"] ?? "",
    "folio-navy": rawColors["folio-navy"] ?? "",
    "folio-blue": rawColors["folio-blue"] ?? "",
    "folio-pink-soft": rawColors["folio-pink-soft"] ?? "",
    "folio-pink-ink": rawColors["folio-pink-ink"] ?? "",
    "folio-brass-ink": rawColors["folio-brass-ink"] ?? "",
    "folio-brass-light": rawColors["folio-brass-light"] ?? "",
  };
  if (!colors.bg || !colors.text) {
    throw new Error("tailwind.config.mjs colors missing required bg/text tokens");
  }
  return { colors, __raw: raw };
}
