import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { REPO_ROOT } from "../tools/schema/css-tokens.ts";

const PUBLIC = path.join(REPO_ROOT, "dist-public");
const DEFAULT = path.join(REPO_ROOT, "dist");
const FIXTURE = path.join(REPO_ROOT, "dist-fixture");
const VISUAL_FIXTURE = path.join(REPO_ROOT, "dist-visual-fixture");
const DRAFT_ONLY_FIXTURE = path.join(REPO_ROOT, "dist-draft-only-fixture");
const FIXTURE_ROOT = "tests/fixtures/content-package/synthetic";
const VISUAL_FIXTURE_ROOT = "tests/fixtures/content-package/visual-demo";
const DRAFT_ONLY_ROOT = "tests/fixtures/content-package/encyclopedia-draft-only";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function productionEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.MOMOKO_CONTENT_PACKAGE_ROOT;
  delete env.MOMOKO_CONTENT_PACKAGE_MODE;
  delete env.MOMOKO_CONTENT_PACKAGE_PREVIEW;
  delete env.MOMOKO_BUILD_OUT_DIR;
  return env;
}

function fixtureEnv(): NodeJS.ProcessEnv {
  return {
    ...productionEnv(),
    MOMOKO_CONTENT_PACKAGE_MODE: "test",
    MOMOKO_CONTENT_PACKAGE_ROOT: FIXTURE_ROOT,
  };
}

function visualFixtureEnv(): NodeJS.ProcessEnv {
  return {
    ...productionEnv(),
    MOMOKO_CONTENT_PACKAGE_MODE: "test",
    MOMOKO_CONTENT_PACKAGE_ROOT: VISUAL_FIXTURE_ROOT,
  };
}

function draftOnlyFixtureEnv(): NodeJS.ProcessEnv {
  return {
    ...productionEnv(),
    MOMOKO_CONTENT_PACKAGE_MODE: "test",
    MOMOKO_CONTENT_PACKAGE_ROOT: DRAFT_ONLY_ROOT,
  };
}

function readJson(dir: string, rel: string): Json {
  return JSON.parse(fs.readFileSync(path.join(dir, rel), "utf-8")) as Json;
}

function asArray(v: Json | undefined): Json[] {
  return Array.isArray(v) ? v : [];
}

function asRecord(v: Json | undefined): Record<string, Json> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json>) : {};
}

function serverArtifactText(dir: string): string {
  const files: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  walk(dir);
  return files
    .filter((file) => /\.(?:html|json|css|js|mjs)$/.test(file))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
}

function expectServerArtifact(dir: string): void {
  expect(fs.existsSync(path.join(dir, "_worker.js", "index.js"))).toBe(true);
  expect(fs.existsSync(path.join(dir, "_routes.json"))).toBe(true);
  expect(fs.existsSync(path.join(dir, "_headers"))).toBe(true);
}

describe("production artifact boundary", () => {
  beforeAll(() => {
    for (const dir of [PUBLIC, DEFAULT, FIXTURE, VISUAL_FIXTURE, DRAFT_ONLY_FIXTURE]) fs.rmSync(dir, { recursive: true, force: true });
    execFileSync("pnpm", ["build:public"], { cwd: REPO_ROOT, env: productionEnv(), stdio: "pipe" });
    execFileSync("pnpm", ["build"], { cwd: REPO_ROOT, env: productionEnv(), stdio: "pipe" });

    // The fixture build is deliberately explicit and isolated. It proves that
    // a reviewed-current package can enter the static seam without making the
    // normal production build inherit synthetic content.
    execFileSync("pnpm", ["exec", "astro", "build", "--outDir", "dist-fixture"], {
      cwd: REPO_ROOT,
      env: fixtureEnv(),
      stdio: "pipe",
    });
    execFileSync("node", ["--experimental-strip-types", "tools/schema/postbuild.ts"], {
      cwd: REPO_ROOT,
      env: { ...fixtureEnv(), MOMOKO_BUILD_OUT_DIR: "dist-fixture" },
      stdio: "pipe",
    });
    execFileSync("pnpm", ["exec", "astro", "build", "--outDir", "dist-visual-fixture"], {
      cwd: REPO_ROOT,
      env: visualFixtureEnv(),
      stdio: "pipe",
    });
    execFileSync("node", ["--experimental-strip-types", "tools/schema/postbuild.ts"], {
      cwd: REPO_ROOT,
      env: { ...visualFixtureEnv(), MOMOKO_BUILD_OUT_DIR: "dist-visual-fixture" },
      stdio: "pipe",
    });
    // The draft-only fixture build (astro only) exercises the empty-state seam
    // without a news package, so postbuild is intentionally skipped here.
    execFileSync("pnpm", ["exec", "astro", "build", "--outDir", "dist-draft-only-fixture"], {
      cwd: REPO_ROOT,
      env: draftOnlyFixtureEnv(),
      stdio: "pipe",
    });
  });

  afterAll(() => {
    for (const dir of [PUBLIC, DEFAULT, FIXTURE, VISUAL_FIXTURE, DRAFT_ONLY_FIXTURE]) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("default production package publishes exactly the reviewed S6 trilingual bundle", () => {
    const manifest = asRecord(readJson(PUBLIC, "manifest.json"));
    const entries = asArray(manifest.entries);
    expect(entries).toHaveLength(1);
    const entry = asRecord(entries[0]);
    expect(entry.source_id).toBe("S6");
    expect(entry.source_item_id).toBe("01_18661");
    expect(entry.review_status).toBe("published");
    expect(asRecord(entry.locales).ja).toBeTruthy();
    expect(asRecord(entry.locales).zh).toBeTruthy();
    expect(asRecord(entry.locales).en).toBeTruthy();
    const search = asArray(readJson(PUBLIC, "search.json"));
    expect(search).toHaveLength(3); // ja/zh/en rows for the single S6 item
    expectServerArtifact(PUBLIC);
    expectServerArtifact(DEFAULT);
  });

  it("production output contains no synthetic/demo markers or external scripts", () => {
    execFileSync(
      "node",
      ["--experimental-strip-types", "tools/schema/public-audit.mjs", "dist-public"],
      { cwd: REPO_ROOT, env: productionEnv(), stdio: "pipe" },
    );
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) files.push(full);
      }
    };
    walk(PUBLIC);
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      expect(text).not.toMatch(/synthetic|合成夹具|demo news|fake news/i);
      expect(text).not.toMatch(/<script[^>]+src=["']https?:\/\//i);
      // Allow self-hosted /fonts/ woff2 (task #25); forbid remote CDN fonts.
      expect(text).not.toMatch(/fonts\.googleapis|fonts\.gstatic|https?:\/\/[^\s"']+\.(?:woff2?|ttf|otf)\b/i);
      if (file.endsWith(".svg")) {
        expect(path.relative(PUBLIC, file)).toBe("momoko-logo.svg");
      } else {
        expect(file).not.toMatch(/\.(?:png|jpe?g|gif|webp|mp3|wav|ogg|m4a|flac|mp4|webm)$/i);
      }
      expect(file).not.toMatch(/(?:^|[/._-])(?:crawler|cron|deploy|maintenance|research)(?:[/._-]|$)/i);
      expect(text).not.toMatch(/<(?:audio|video|source)\b/i);
      for (const match of text.matchAll(/<img\b[^>]*>/gi)) {
        expect(match[0]).toMatch(/src=["']\/momoko-logo\.svg["']/i);
      }
    }
    const logo = path.join(PUBLIC, "momoko-logo.svg");
    expect(fs.existsSync(logo)).toBe(true);
    expect(createHash("sha256").update(fs.readFileSync(logo)).digest("hex")).toBe(
      "aaa29433b3996850b1c482c4cfe19865294876751d388ee2d1437af62b99dbe7",
    );
    const logoText = fs.readFileSync(logo, "utf8");
    expect(logoText).toContain('viewBox="0 0 1200 220"');
    expect(logoText).toContain("LibreBaskerville-OFL.txt");
    expect(logoText).toContain("Nunito-OFL.txt");
    for (const attribution of ["LibreBaskerville-OFL.txt", "Nunito-OFL.txt"]) {
      const text = fs.readFileSync(path.join(PUBLIC, attribution), "utf8");
      expect(text).toContain("SIL Open Font License, Version 1.1");
    }
    expect(files.filter((file) => /rose/i.test(path.relative(PUBLIC, file)))).toHaveLength(0);
  });

  it("explicit reviewed-current fixture package alone produces one trilingual item", () => {
    const manifest = asRecord(readJson(FIXTURE, "manifest.json"));
    const entries = asArray(manifest.entries);
    expect(entries).toHaveLength(1);
    expect(asRecord(entries[0]).review_status).toBe("published");
    expect(asRecord(asRecord(entries[0]).locales).ja).toBeTruthy();
    expect(asRecord(asRecord(entries[0]).locales).zh).toBeTruthy();
    expect(asRecord(asRecord(entries[0]).locales).en).toBeTruthy();
    expectServerArtifact(FIXTURE);
    const fixtureText = serverArtifactText(FIXTURE);
    expect(fixtureText).toContain("S1-synth-2026-08-08-001");
    expect(fixtureText).not.toContain("S1-synth-2026-08-08-002");
    expect(fixtureText).not.toContain("S1-synth-2026-08-08-003");
  });

  it("embeds the entire current-reviewed encyclopedia bundle and strips draft or retracted bytes", () => {
    expectServerArtifact(FIXTURE);
    const fixtureText = serverArtifactText(FIXTURE);
    // The reviewed momoko-suou encyclopedia bundle (ja/zh/en + editorial history)
    // is embedded in full.
    expect(fixtureText).toContain("生意気？強がり？小さくて意地っぱりな妹系アイドル！");
    expect(fixtureText).toContain("逞强？小个子又倔强的妹妹系偶像！");
    expect(fixtureText).toContain("Feisty? A small, stubborn little-sister idol!");
    // Draft and actively retracted encyclopedia bundles must NOT be present.
    expect(fixtureText).not.toContain("DRAFT-PROFILE-MARKER");
    expect(fixtureText).not.toContain("RETRACTED-PROFILE-MARKER");
  });

  it("renders the published Momoko profile in the prerendered encyclopedia index HTML for ja/zh/en", () => {
    // The encyclopedia index page is statically prerendered (export const
    // prerender = true), so the production build emits user-visible HTML at
    // dist-public/<lang>/encyclopedia/index.html. Each locale must carry the
    // exact 18 fact values + their localized labels, the official source link,
    // and none of the internal editorial metadata.
    const facts18: Record<string, string[]> = {
      ja: [
        "周防桃子", "MOMOKO SUOU", "Fairy", "11歳", "11月6日", "B", "蠍座", "右", "140cm",
        "35kg", "73/53/74", "東京都", "渡部恵子", "765プロダクション", "かわいいシール集め",
        "演技や台詞の暗記", "ホットケーキ", "生意気？強がり？小さくて意地っぱりな妹系アイドル！",
      ],
      zh: [
        "周防桃子", "MOMOKO SUOU", "Fairy", "11岁", "11月6日", "B", "天蝎座", "右手", "140cm",
        "35kg", "73/53/74", "东京都", "渡部惠子", "765事务所", "收集可爱贴纸",
        "表演与记忆对白", "松饼", "傲气？逞强？娇小又倔强的妹妹系偶像！",
      ],
      en: [
        "Momoko Suou", "MOMOKO SUOU", "Fairy", "11", "November 6", "B", "Scorpio", "Right", "140cm",
        "35kg", "73/53/74", "Tokyo", "Keiko Watanabe", "765 PRO", "Collecting cute stickers",
        "Acting and memorizing lines", "Hotcakes", "Cheeky? Putting on a brave front? A petite, stubborn little-sister-style idol!",
      ],
    };
    // Localized field labels rendered as <dt> for the 18-fact list.
    const labelSets: Record<string, string[]> = {
      ja: ["名前", "ローマ字表記", "タイプ", "年齢", "誕生日", "血液型", "星座", "利き手", "身長", "体重", "スリーサイズ", "出身地", "CV", "所属", "趣味", "特技", "好きなもの", "キャッチコピー"],
      zh: ["名字", "罗马字", "类型", "年龄", "生日", "血型", "星座", "惯用手", "身高", "体重", "三围", "出身地", "配音", "所属", "兴趣", "特技", "喜欢的东西", "标语"],
      en: ["Name", "Romanized name", "Type", "Age", "Birthday", "Blood type", "Constellation", "Handedness", "Height", "Weight", "Measurements", "From", "Voice actor", "Affiliation", "Hobby", "Specialty", "Likes", "Tagline"],
    };
    const sourceLink = "https://millionlive-theaterdays.idolmaster-official.jp/idol/momoko/";
    // Internal editorial representations must never reach user-visible HTML;
    // plain UI copy (e.g. "reviewed" inside visual.archiveLede) is allowed.
    const forbidden = ["review_status", "reviewed_by", "@tsundere", "S7", "T1", "DemoNotice", "DEMO"];
    for (const lang of ["ja", "zh", "en"] as const) {
      const htmlPath = path.join(PUBLIC, lang, "encyclopedia", "index.html");
      const html = fs.readFileSync(htmlPath, "utf8");
      expect(facts18[lang]!.length, `${lang} must assert all 18 facts`).toBe(18);
      for (const literal of facts18[lang]!) {
        expect(html, `${lang} encyclopedia index must contain ${literal}`).toContain(literal);
      }
      for (const label of labelSets[lang]!) {
        expect(html, `${lang} encyclopedia index must render localized label ${label}`).toContain(label);
      }
      expect(html, `${lang} encyclopedia index must link the official source`).toContain(sourceLink);
      for (const token of forbidden) {
        expect(html, `${lang} encyclopedia index must not leak ${token}`).not.toContain(token);
      }
    }
  });

  it("renders a localized empty state (no Momoko, no DEMO) from a draft-only explicit fixture", () => {
    // A package whose only encyclopedia profile is draft (status:"empty") must
    // prerender a localized empty state per locale — and must NOT leak the
    // draft profile bytes or the DEMO catalog.
    const emptyTitle: Record<string, string> = {
      ja: "アーカイブは準備中です。",
      zh: "资料站仍在准备中。",
      en: "The archive is still being set up.",
    };
    const emptyBody: Record<string, string> = {
      ja: "人が確認した最新コンテンツパッケージはまだありません。",
      zh: "目前还没有经过人工审核的最新内容包。",
      en: "There is no reviewed current content package yet.",
    };
    for (const lang of ["ja", "zh", "en"] as const) {
      const htmlPath = path.join(DRAFT_ONLY_FIXTURE, lang, "encyclopedia", "index.html");
      const html = fs.readFileSync(htmlPath, "utf8");
      expect(html, `${lang} draft-only empty state title`).toContain(emptyTitle[lang]!);
      expect(html, `${lang} draft-only empty state body`).toContain(emptyBody[lang]!);
      // The draft profile's unique content bytes and source id must not leak;
      // the site footer's static reference to 周防桃子 is UI copy.
      expect(html, `${lang} draft-only must not leak the draft tagline`).not.toContain("生意気？強がり？小さくて意地っぱりな妹系アイドル！");
      expect(html, `${lang} draft-only must not leak the draft CV`).not.toContain("渡部恵子");
      expect(html, `${lang} draft-only must not render DEMO`).not.toContain("DEMO");
      expect(html).not.toContain("DemoNotice");
      expect(html, `${lang} draft-only must not leak S7`).not.toContain("S7");
    }
  });

  it("keeps the explicit visual DEMO artifact separate from production first-content output", () => {
    const publicManifest = asRecord(readJson(PUBLIC, "manifest.json"));
    const visualManifest = asRecord(readJson(VISUAL_FIXTURE, "manifest.json"));
    // Production now carries the real reviewed S6 item; the visual DEMO fixture
    // stays in its own artifact and never leaks into production.
    expect(asArray(publicManifest.entries)).toHaveLength(1);
    expect(asRecord(asArray(publicManifest.entries)[0]).source_id).toBe("S6");
    expect(asArray(visualManifest.entries)).toHaveLength(1);
    expect(asRecord(asArray(visualManifest.entries)[0]).source_id).toBe("S99");

    expectServerArtifact(PUBLIC);
    expectServerArtifact(VISUAL_FIXTURE);
    const publicText = serverArtifactText(PUBLIC);
    const visualText = serverArtifactText(VISUAL_FIXTURE);
    // Server output keeps route code in the worker; fixture identity is only
    // present in the explicit post-build manifest, never in public output.
    expect(publicText).not.toMatch(/S99-visual-demo-archive-001|visual-fixture-reviewer|example\.invalid/i);
    expect(visualText).toMatch(/S99-visual-demo-archive-001|example\.invalid/i);
    expect(publicText).not.toMatch(/S1-synth-2026-08-08-00[123]/i);
  });

  it("keeps security headers in the public artifact", () => {
    const h = fs.readFileSync(path.join(PUBLIC, "_headers"), "utf-8");
    expect(h).toMatch(/Content-Security-Policy/);
    expect(h).toMatch(/X-Content-Type-Options: nosniff/);
    expect(h).toMatch(/frame-ancestors 'none'/);
  });
});
