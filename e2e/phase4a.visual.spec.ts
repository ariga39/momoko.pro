import { execFileSync } from "node:child_process";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const require = createRequire(import.meta.url);
const REPO_ROOT = process.cwd();
const VISUAL_OUTPUT = "dist-visual-e2e";
const VISUAL_ROOT = path.join(REPO_ROOT, VISUAL_OUTPUT);
const AXE_SCRIPT = require.resolve("axe-core/axe.min.js");
const DEMO_DETAIL = "/news/2026/S99-visual-demo-archive-001/";
const VISUAL_PORT = 4322;

let visualWorker: ChildProcess | undefined;
let visualBaseUrl = "";

async function waitForVisualWorker(url: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${url}/manifest.json`);
      if (response.ok) return;
    } catch {
      // Wrangler is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("visual Cloudflare worker did not become ready");
}

function demoUrl(route: string): string {
  return `${visualBaseUrl}${route}`;
}

async function overflowNodes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    return [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.left < -1 || box.right > viewport + 1;
      })
      .slice(0, 8)
      .map((element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}`);
  });
}

async function axeViolations(page: Page): Promise<Array<{ id: string; impact: string | null }>> {
  await page.addScriptTag({ path: AXE_SCRIPT });
  return page.evaluate(async () => {
    const axeApi = (globalThis as typeof globalThis & {
      axe: { run: (context: Document) => Promise<{ violations: Array<{ id: string; impact: string | null }> }> };
    }).axe;
    const result = await axeApi.run(document);
    return result.violations.map(({ id, impact }) => ({ id, impact }));
  });
}

test.beforeAll("build visual worker", async () => {
  test.setTimeout(120_000);
  fs.rmSync(VISUAL_ROOT, { recursive: true, force: true });
  const env = { ...process.env };
  delete env.PUBLIC_BUILD;
  delete env.MOMOKO_CONTENT_PACKAGE_PREVIEW;
  env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
  env.MOMOKO_CONTENT_PACKAGE_ROOT = "tests/fixtures/content-package/visual-demo";
  env.MOMOKO_REPO_ROOT = REPO_ROOT;
  execFileSync("pnpm", ["exec", "astro", "build", "--outDir", VISUAL_OUTPUT], {
    cwd: REPO_ROOT,
    env,
    stdio: "pipe",
  });
  execFileSync("node", ["--experimental-strip-types", "tools/schema/postbuild.ts"], {
    cwd: REPO_ROOT,
    env: { ...env, MOMOKO_BUILD_OUT_DIR: VISUAL_OUTPUT },
    stdio: "pipe",
  });
  visualBaseUrl = `http://127.0.0.1:${VISUAL_PORT}`;
  visualWorker = spawn(
    "pnpm",
    [
      "exec",
      "wrangler",
      "dev",
      `${VISUAL_OUTPUT}/_worker.js`,
      "--assets",
      VISUAL_OUTPUT,
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(VISUAL_PORT),
      "--compatibility-date",
      "2026-08-08",
      "--compatibility-flags",
      "nodejs_compat",
      "--var",
      `MOMOKO_REPO_ROOT:${REPO_ROOT}`,
      "--var",
      "MOMOKO_CONTENT_PACKAGE_MODE:test",
      "--var",
      "MOMOKO_CONTENT_PACKAGE_ROOT:tests/fixtures/content-package/visual-demo",
    ],
    { cwd: REPO_ROOT, env, stdio: "ignore" },
  );
  await waitForVisualWorker(visualBaseUrl);
});

test.afterAll("clean visual worker", async () => {
  if (visualWorker && !visualWorker.killed) {
    visualWorker.kill("SIGTERM");
  }
  fs.rmSync(VISUAL_ROOT, { recursive: true, force: true });
});

test("native mobile menu is usable without dialog semantics and returns focus on Escape", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/zh/");
  const menu = page.locator("details[data-mobile-menu]");
  const summary = menu.locator("summary[data-menu-summary]");
  await expect(menu.locator("[role=dialog]")).toHaveCount(0);
  await summary.click();
  await expect(menu).toHaveAttribute("open", "");
  await expect(menu.locator("[data-menu-panel] a").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).not.toHaveAttribute("open", "");
  await expect(summary).toBeFocused();
});

test("URL filters enhance a complete static list and preserve no-JS truth", async ({ page, browser }) => {
  await page.goto("/zh/news/?year=2026");
  await expect(page).toHaveURL(/\/zh\/news\/\?year=2026$/);
  await expect(page.locator("#news-filter-status")).toContainText("1 results");
  await expect(page.locator("#news-archive-list [data-filter-card]")).toBeVisible();

  const noJsContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 900 } });
  const noJsPage = await noJsContext.newPage();
  await noJsPage.goto("/zh/news/?year=2026");
  await expect(noJsPage.locator("#news-archive-list [data-filter-card]")).toBeVisible();
  await noJsPage.locator("details[data-mobile-menu] summary").click();
  await expect(noJsPage.locator("[data-menu-panel] a").first()).toBeVisible();
  await noJsContext.close();

  await page.goto(demoUrl("/en/songs-live/?year=2026&type=live"));
  await expect(page.locator("#songs-filter-status")).toContainText("1 results");
  await expect(page.locator('[data-timeline-card][data-filter-year="2026"][data-filter-type="live"]')).toBeVisible();
  await expect(page.locator('[data-timeline-card][data-filter-year="2026"][data-filter-type="song"]')).toBeHidden();
});

test("representative pages have no console errors, external requests, or horizontal overflow", async ({ page }) => {
  const consoleErrors: string[] = [];
  const externalRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.hostname.endsWith("127.0.0.1") && !url.hostname.endsWith("localhost")) externalRequests.push(request.url());
  });

  for (const viewport of [320, 375, 1440]) {
    await page.setViewportSize({ width: viewport, height: 900 });
    for (const route of ["/zh/", "/zh/news/", "/zh/encyclopedia/", "/zh/songs-live/", "/search"]) {
      const beforeErrors = consoleErrors.length;
      await page.goto(route, { waitUntil: "networkidle" });
      expect(consoleErrors.slice(beforeErrors), `${viewport}${route} console`).toEqual([]);
      expect(await overflowNodes(page), `${viewport}${route} overflow`).toEqual([]);
    }
  }
  expect(externalRequests).toEqual([]);
});

test("home canvas fills the same bounded frame across the required viewport matrix", async ({ page }) => {
  const widths = [320, 375, 768, 1024, 1280, 1440, 1600, 1920, 2048];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(demoUrl("/zh/"), { waitUntil: "networkidle" });
    const metrics = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      const home = document.querySelector<HTMLElement>("[data-home-v05]");
      const layout = document.querySelector<HTMLElement>(".folio-layout");
      const chapter = document.querySelector<HTMLElement>(".folio-chapter");
      const header = document.querySelector<HTMLElement>("[data-site-header]");
      const footer = document.querySelector<HTMLElement>(".home-site-footer");
      const homeBox = home?.getBoundingClientRect();
      const layoutBox = layout?.getBoundingClientRect();
      const chapterBox = chapter?.getBoundingClientRect();
      const headerBox = header?.getBoundingClientRect();
      const footerBox = footer?.getBoundingClientRect();
      return {
        viewport,
        scrollWidth: document.documentElement.scrollWidth,
        home: homeBox ? { left: homeBox.left, right: homeBox.right, width: homeBox.width } : null,
        layout: layoutBox ? { left: layoutBox.left, right: layoutBox.right, width: layoutBox.width } : null,
        chapter: chapterBox ? { left: chapterBox.left, right: chapterBox.right, width: chapterBox.width } : null,
        header: headerBox ? { left: headerBox.left, right: headerBox.right, width: headerBox.width } : null,
        footer: footerBox ? { left: footerBox.left, right: footerBox.right, width: footerBox.width } : null,
        chapterText: chapter?.textContent?.trim() ?? "",
      };
    });
    expect(metrics.scrollWidth, `${width}px document overflow`).toBeLessThanOrEqual(metrics.viewport + 1);
    expect(metrics.home, `${width}px home frame`).not.toBeNull();
    expect(metrics.layout, `${width}px folio frame`).not.toBeNull();
    expect(metrics.chapter, `${width}px right column`).not.toBeNull();
    expect(metrics.header, `${width}px header shell`).not.toBeNull();
    expect(metrics.footer, `${width}px footer shell`).not.toBeNull();
    expect(metrics.home!.left, `${width}px home left`).toBeGreaterThanOrEqual(-1);
    expect(metrics.home!.right, `${width}px home right`).toBeLessThanOrEqual(metrics.viewport + 1);
    expect(metrics.layout!.left, `${width}px folio left`).toBeGreaterThanOrEqual(-1);
    expect(metrics.layout!.right, `${width}px folio right`).toBeLessThanOrEqual(metrics.viewport + 1);
    expect(metrics.chapter!.width, `${width}px right column width`).toBeGreaterThan(0);
    expect(metrics.chapterText, `${width}px right column content`).not.toBe("");
    expect(Math.abs(metrics.header!.left - metrics.home!.left), `${width}px header/home left`).toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.header!.right - metrics.home!.right), `${width}px header/home right`).toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.footer!.left - metrics.home!.left), `${width}px footer/home left`).toBeLessThanOrEqual(1);
    expect(Math.abs(metrics.footer!.right - metrics.home!.right), `${width}px footer/home right`).toBeLessThanOrEqual(1);
  }
});

test("200% zoom, forced colors, and reduced motion keep the shell usable", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.goto("/zh/");
  await page.evaluate(() => {
    // A doubled root size exercises the same reflow pressure as browser zoom
    // while keeping Playwright's CSS viewport/media-query boundary stable.
    document.documentElement.style.fontSize = "200%";
  });
  await expect(page.locator("main h1")).toBeVisible();
  const mediaState = await page.evaluate(() => ({
    borderWidth: getComputedStyle(document.querySelector("[data-menu-summary]") as Element).borderWidth,
    scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior,
    transitionDuration: getComputedStyle(document.querySelector(".chapter-index-link, a") as Element).transitionDuration,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    overflowNodes: [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .slice(0, 8)
      .map((element) => `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}`),
  }));
  expect(mediaState.borderWidth).toBe("2px");
  expect(mediaState.scrollBehavior).toBe("auto");
  expect(mediaState.transitionDuration).toBe("0s");
  expect(mediaState.scrollWidth, mediaState.overflowNodes.join(", ")).toBeLessThanOrEqual(mediaState.clientWidth + 1);
});

test("axe finds no violations on the demo home and dense timeline", async ({ page }) => {
  for (const route of ["/zh/", "/ja/encyclopedia/", "/en/songs-live/"]) {
    await page.goto(demoUrl(route));
    expect(await axeViolations(page), route).toEqual([]);
  }
});

test("visual baselines cover the v0.5 home and trilingual long titles", async ({ page }) => {
  const homeCases = [
    { lang: "zh", width: 320, name: "phase4a-v05-home-zh-320.png" },
    { lang: "ja", width: 375, name: "phase4a-v05-home-ja-375.png" },
    { lang: "en", width: 1440, name: "phase4a-v05-home-en-1440.png" },
  ];
  for (const item of homeCases) {
    await page.setViewportSize({ width: item.width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "none" });
    // CLS gate (task #25): install the layout-shift observer BEFORE navigation so
    // it captures the cumulative shift caused by webfont load, excluding shifts
    // with recent input. The locale-only preload must not cause layout jump.
    await page.addInitScript(() => {
      (globalThis as Record<string, unknown>)._momokoCls = 0;
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const clsEntry = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
            if (clsEntry.hadRecentInput) continue;
            (globalThis as Record<string, unknown>)._momokoCls =
              ((globalThis as Record<string, unknown>)._momokoCls as number) + clsEntry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      } catch {
        // PerformanceObserver/layout-shift unavailable: fail closed in assertion.
        (globalThis as Record<string, unknown>)._momokoClsUnsupported = true;
      }
    });
    await page.goto(demoUrl(`/${item.lang}/`), { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(100);
    const cls = await page.evaluate(() => {
      const g = globalThis as Record<string, unknown>;
      if (g._momokoClsUnsupported) return Number.NaN;
      return g._momokoCls as number;
    });
    expect(Number.isNaN(cls), `${item.width}px layout-shift observer must be supported`).toBe(false);
    expect(cls, `${item.width}px CLS must stay below 0.05 after webfont load`).toBeLessThan(0.05);
    if (item.width <= 375) {
      const colorLineCount = await page.locator(".folio-color-value").evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getClientRects().length;
      });
      expect(colorLineCount, `${item.width}px folio color must stay on one line`).toBe(1);
    }
    if (item.width === 320) {
      const factsLayout = await page.locator(".folio-spine-facts").evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        items: [...element.children].map((item) => ({
          clientWidth: item.clientWidth,
          scrollWidth: item.scrollWidth,
          valueLines: (() => {
            const value = item.querySelector("strong");
            if (!value) return 0;
            const range = document.createRange();
            range.selectNodeContents(value);
            return range.getClientRects().length;
          })(),
        })),
      }));
      expect(factsLayout.scrollWidth, "320px folio facts must not overflow internally").toBeLessThanOrEqual(
        factsLayout.clientWidth,
      );
      expect(factsLayout.items.every((item) => item.scrollWidth <= item.clientWidth)).toBe(true);
      expect(factsLayout.items.map((item) => item.valueLines)).toEqual([1, 1, 1]);
    }
    await expect(page).toHaveScreenshot(item.name, {
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      maxDiffPixelRatio: 0.002,
      scale: "css",
    });
  }

  // Human review checkpoints for the homepage contract: the selected
  // grey-blue wordmark and the chapter-only desktop masthead must remain
  // legible at the requested wide, tablet, and desktop widths.
  for (const item of [
    { width: 768, name: "phase4a-checkpoint-home-768.png" },
    { width: 1024, name: "phase4a-checkpoint-home-1024.png" },
    { width: 2048, name: "phase4a-checkpoint-home-2048.png" },
  ]) {
    await page.setViewportSize({ width: item.width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "none" });
    await page.goto(demoUrl("/en/"), { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("img.masthead-logo")).toBeVisible();
    await expect(page.locator("nav[data-nav-landmark='home-chapters']")).toBeVisible();
    if (item.width >= 1024) {
      await expect(page.locator("header nav[aria-label='Main navigation']")).toHaveCount(0);
    }
    await expect(page).toHaveScreenshot(item.name, {
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      maxDiffPixelRatio: 0.002,
      scale: "css",
    });
  }

  const cases = [
    { lang: "zh", width: 320, name: "phase4a-zh-detail-320.png" },
    { lang: "ja", width: 375, name: "phase4a-ja-detail-375.png" },
    { lang: "en", width: 375, name: "phase4a-en-detail-375.png" },
  ];
  for (const item of cases) {
    await page.setViewportSize({ width: item.width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "none" });
    await page.goto(demoUrl(`/${item.lang}${DEMO_DETAIL}`), { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(item.name, {
      animations: "disabled",
      caret: "hide",
      fullPage: true,
      maxDiffPixelRatio: 0.002,
      scale: "css",
    });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "none" });
  await page.goto(demoUrl("/en/songs-live/"), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot("phase4a-en-songs-live-1440.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
    maxDiffPixelRatio: 0.002,
    scale: "css",
  });
});

test("CLS gate is sensitive: an induced layout shift is observed and exceeds the budget", async ({ page }) => {
  // Sensitivity probe: the layout-shift observer (installed before navigation)
  // must actually record a shift. We deliberately insert a tall block above
  // the main content, then remove it, producing a layout shift that pushes the
  // cumulative CLS above the 0.05 gate. If this fails, the gate is a no-op.
  await page.setViewportSize({ width: 375, height: 900 });
  await page.addInitScript(() => {
    (globalThis as Record<string, unknown>)._momokoCls = 0;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const clsEntry = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
          if (clsEntry.hadRecentInput) continue;
          (globalThis as Record<string, unknown>)._momokoCls =
            ((globalThis as Record<string, unknown>)._momokoCls as number) + clsEntry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      (globalThis as Record<string, unknown>)._momokoClsUnsupported = true;
    }
  });
  await page.goto(demoUrl("/en/"), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  // Force a large layout shift by inserting a full-viewport tall element.
  const observed = await page.evaluate(async () => {
    const blocker = document.createElement("div");
    blocker.id = "cls-sensitive-blocker";
    blocker.style.height = "1000px";
    document.body.prepend(blocker);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    blocker.remove();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const g = globalThis as Record<string, unknown>;
    if (g._momokoClsUnsupported) return Number.NaN;
    return g._momokoCls as number;
  });
  expect(Number.isNaN(observed), "layout-shift observer must be supported").toBe(false);
  expect(observed, "sensitivity probe must observe a real layout shift").toBeGreaterThan(0.05);
});
