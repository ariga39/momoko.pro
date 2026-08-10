/** Locale -> self-hosted font family mapping (task #25). */

export interface FontChoice {
  family: string;
  weight: number;
}

export const LOCALE_FONT: Record<string, FontChoice> = {
  zh: { family: "Noto Sans SC", weight: 400 },
  ja: { family: "Noto Sans JP", weight: 400 },
  en: { family: "Inter", weight: 400 },
};

export function localeFontFamily(lang: string): FontChoice {
  return (
    LOCALE_FONT[lang] ?? { family: "Noto Sans SC", weight: 400 }
  );
}
