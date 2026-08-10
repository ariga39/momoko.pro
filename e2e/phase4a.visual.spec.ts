import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
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

let visualServer: Server | undefined;
let visualBaseUrl = "";

function contentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".txt": "text/plain; charset=utf-8",
    }[extension] ?? "application/octet-stream"
  );
}

function startStaticServer(root: string): Promise<{ server: Server; url: string }> {
  const absoluteRoot = path.resolve(root);
  const server = createServer((request, response) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const relative = pathname.endsWith("/") ? `${pathname.slice(1)}index.html` : pathname.slice(1);
    const candidate = path.resolve(absoluteRoot, relative || "index.html");
    if (candidate !== absoluteRoot && !candidate.startsWith(`${absoluteRoot}${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }
    const filePath = fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()
      ? path.join(candidate, "index.html")
      : candidate;
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": contentType(filePath) });
    fs.createReadStream(filePath).pipe(response);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("visual test server did not expose an address"));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}` });
    });
  });
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

test.beforeAll(async () => {
  fs.rmSync(VISUAL_ROOT, { recursive: true, force: true });
  const env = { ...process.env };
  delete env.PUBLIC_BUILD;
  delete env.MOMOKO_CONTENT_PACKAGE_PREVIEW;
  env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
  env.MOMOKO_CONTENT_PACKAGE_ROOT = "tests/fixtures/content-package/visual-demo";
  execFileSync("pnpm", ["exec", "astro", "build", "--outDir", VISUAL_OUTPUT], {
    cwd: REPO_ROOT,
    env,
    stdio: "pipe",
  });
  const started = await startStaticServer(VISUAL_ROOT);
  visualServer = started.server;
  visualBaseUrl = started.url;
});

test.afterAll(async () => {
  if (visualServer) {
    await new Promise<void>((resolve) => visualServer?.close(() => resolve()));
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
    transitionDuration: getComputedStyle(document.querySelector(".nav-link") as Element).transitionDuration,
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
    await page.goto(demoUrl(`/${item.lang}/`), { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
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
