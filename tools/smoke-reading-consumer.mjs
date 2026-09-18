#!/usr/bin/env node
/**
 * Real Starlight Documentation Consumer Qualification Harness for TFSB67-R1.
 *
 * Verifies Deliverable B:
 * 1. Generates Forge Console documentation theme in both Reading layout and Standard layout modes using TypeScript.
 * 2. Compiles generated TypeScript packages in isolation via `npm run build` (`tsc`).
 * 3. Packs generated theme packages.
 * 4. Installs packed themes into independent Astro/Starlight consumer fixtures in temporary directories.
 * 5. Builds actual Starlight documentation sites (`astro build`).
 * 6. Serves sites over local HTTP servers and performs live Playwright Chromium browser assertions:
 *    - Resolves concrete geometry: asserts .sl-container width constraint (<= 704px bound) and centering (--sl-content-margin-inline: auto).
 *    - Accurately reports mobile viewport (390x844) as an inert negative control for the reading query.
 *    - Verifies real navigation: sidebar links, TOC anchors, and pagination across multiple documentation pages.
 *    - Verifies light and dark mode presentation with computed style assertions.
 *    - Verifies consumer customCss override precedence over @layer tfsl.overrides.
 * 7. Saves visual evidence to `docs/evaluations/evidence/tfsb67-r1/`.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOOM_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(LOOM_ROOT, "../..");
const CONSUMER_FIXTURE_DIR = resolve(LOOM_ROOT, "consumer-fixture");
const EVIDENCE_DIR = resolve(REPO_ROOT, "docs/evaluations/evidence/tfsb67-r1");
const CATALOG_SPEC_PATH = resolve(LOOM_ROOT, "examples/forge-console-reading-catalog.json");

function sha256(bufOrStr) {
  return createHash("sha256").update(bufOrStr).digest("hex");
}

function startStaticServer(rootDir, port = 0) {
  const MIME_TYPES = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith("/")) {
        pathname += "index.html";
      } else if (!extname(pathname)) {
        pathname += "/index.html";
      }

      const filePath = resolve(rootDir, pathname.replace(/^\//, ""));
      if (!filePath.startsWith(resolve(rootDir))) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("403 Forbidden");
        return;
      }
      if (!existsSync(filePath)) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404 Not Found");
        return;
      }

      const ext = extname(filePath);
      const mime = MIME_TYPES[ext] || "application/octet-stream";
      const content = await readFile(filePath);
      res.writeHead(200, { "Content-Type": mime });
      res.end(content);
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("500 Internal Server Error");
    }
  });

  return new Promise((resolvePromise) => {
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolvePromise({
        port: actualPort,
        close: () =>
          new Promise((done) => {
            if (typeof server.closeAllConnections === "function") {
              server.closeAllConnections();
            }
            server.close(done);
          }),
      });
    });
  });
}

export async function runStarlightReadingQualification() {
  console.log("=== Deliverable B: Real Starlight Documentation Consumer Qualification ===");
  await mkdir(EVIDENCE_DIR, { recursive: true });

  const scratchDir = await mkdtemp(join(tmpdir(), "tfsl-starlight-reading-"));
  console.log(`1. Isolated scratch root: ${scratchDir}`);

  let browser;
  let srvReading;
  let srvStandard;
  let loomTarballPath = null;

  const result = {
    deliverable: "Deliverable B — Real Starlight Consumer",
    status: "running",
    metrics: {},
    screenshots: {},
  };

  try {
    // Step 1: Pack Stellar Loom
    console.log("2. Packing Stellar Loom engine...");
    execFileSync("node", ["tools/build-catalog-evidence.mjs"], { cwd: LOOM_ROOT, stdio: "inherit" });
    const loomPackRaw = execFileSync("npm", ["pack", "--json"], { cwd: LOOM_ROOT, encoding: "utf8" });
    const loomTarballName = JSON.parse(loomPackRaw)[0].filename;
    loomTarballPath = join(LOOM_ROOT, loomTarballName);
    console.log(`   Packed Stellar Loom: ${loomTarballName}`);

    // Install packed TFSL into scratch tool environment
    const toolEnvDir = join(scratchDir, "tool-env");
    await mkdir(toolEnvDir, { recursive: true });
    await writeFile(join(toolEnvDir, "package.json"), JSON.stringify({ private: true, type: "module" }));
    execFileSync("npm", ["install", "--ignore-scripts", "--no-save", loomTarballPath], { cwd: toolEnvDir, stdio: "pipe" });
    const installedTfslBin = join(toolEnvDir, "node_modules/@knowledge-forge-ai/theme-forge-stellar-loom/bin/tfsl.js");

    // Step 2: Generate Forge Console Documentation Themes (Reading and Standard)
    console.log("3. Generating Forge Console documentation themes in TypeScript mode...");
    const themePkgMeta = {
      name: "@knowledge-forge-ai/starlight-theme-forge-console",
      version: "0.1.0",
      description: "Forge Console Starlight documentation theme",
    };
    const metaPath = join(scratchDir, "theme-package.json");
    await writeFile(metaPath, JSON.stringify(themePkgMeta, null, 2));

    const readingThemeDir = join(scratchDir, "theme-reading-ts");
    const standardThemeDir = join(scratchDir, "theme-standard-ts");

    // Reading variant
    execFileSync(process.execPath, [
      installedTfslBin,
      "generate",
      CATALOG_SPEC_PATH,
      "--package",
      metaPath,
      "--out",
      readingThemeDir,
      "--accent",
      "cyan",
      "--reading-layout",
      "--language",
      "typescript",
      "--json",
    ]);

    // Standard variant (no-reading control)
    execFileSync(process.execPath, [
      installedTfslBin,
      "generate",
      CATALOG_SPEC_PATH,
      "--package",
      metaPath,
      "--out",
      standardThemeDir,
      "--accent",
      "cyan",
      "--language",
      "typescript",
      "--json",
    ]);

    // Verify Reading preset CSS presence
    const readingCss = await readFile(join(readingThemeDir, "styles/reading.css"), "utf8");
    if (!readingCss.includes("@layer tfsl.overrides")) throw new Error("Reading CSS missing @layer tfsl.overrides");
    if (!readingCss.includes("--sl-content-width: min(704px, 48rem);")) throw new Error("Reading CSS missing content measure rule");
    if (!readingCss.includes("--sl-content-margin-inline: auto;")) throw new Error("Reading CSS missing centering rule");

    // Standard control must NOT include reading.css
    if (existsSync(join(standardThemeDir, "styles/reading.css"))) {
      throw new Error("Standard control theme unexpectedly includes styles/reading.css");
    }

    // Step 3: TypeScript Build Closure & Source Provenance Proof (Deliverable C check for Loom, Review Finding F9)
    console.log("4. Compiling generated TypeScript themes via npm run build in isolation...");

    for (const [themeDir, name] of [[readingThemeDir, "reading"], [standardThemeDir, "standard"]]) {
      execFileSync("npm", ["install", "--ignore-scripts"], { cwd: themeDir, stdio: "pipe" });
      execFileSync("npm", ["run", "build"], { cwd: themeDir, stdio: "pipe" });

      if (!existsSync(join(themeDir, "dist/index.js")) || !existsSync(join(themeDir, "dist/index.d.ts"))) {
        throw new Error(`TypeScript compilation failed to produce dist/index.{js,d.ts} in ${name} theme`);
      }
      console.log(`   ✓ ${name} TypeScript theme successfully compiled into dist/index.js and dist/index.d.ts.`);
    }

    // Provenance rebuild check: disposable edit on readingThemeDir/src/index.ts (Review Finding F9)
    const originalLoomSource = await readFile(join(readingThemeDir, "src/index.ts"), "utf8");
    const marker = 'export const PROVENANCE_REBUILD_PROOF = "tfsb67-r1-loom-provenance-verified";';
    await writeFile(join(readingThemeDir, "src/index.ts"), originalLoomSource + "\n" + marker + "\n");
    execFileSync("npm", ["run", "build"], { cwd: readingThemeDir, stdio: "pipe" });

    const rebuiltJs = await readFile(join(readingThemeDir, "dist/index.js"), "utf8");
    if (!rebuiltJs.includes("PROVENANCE_REBUILD_PROOF")) {
      throw new Error("Disposable TypeScript rebuild did not propagate to exported dist/index.js in Loom theme");
    }
    console.log("   ✓ Loom TypeScript source provenance verified: editing src/index.ts directly updates dist/index.js via tsc.");

    // Restore clean source and rebuild
    await writeFile(join(readingThemeDir, "src/index.ts"), originalLoomSource);
    execFileSync("npm", ["run", "build"], { cwd: readingThemeDir, stdio: "pipe" });

    // Step 4: Pack Generated Themes
    console.log("5. Packing compiled generated theme packages...");
    const packReadingRaw = execFileSync("npm", ["pack", "--json"], { cwd: readingThemeDir, encoding: "utf8" });
    const readingTarballPath = join(readingThemeDir, JSON.parse(packReadingRaw)[0].filename);

    const packStandardRaw = execFileSync("npm", ["pack", "--json"], { cwd: standardThemeDir, encoding: "utf8" });
    const standardTarballPath = join(standardThemeDir, JSON.parse(packStandardRaw)[0].filename);

    // Step 5: Install and Build Real Starlight Consumer Fixtures
    console.log("6. Installing generated themes into independent Starlight consumer fixtures...");
    const readingConsumerDir = join(scratchDir, "consumer-reading");
    const standardConsumerDir = join(scratchDir, "consumer-standard");

    for (const [consumerDir, tarball, scName] of [
      [readingConsumerDir, readingTarballPath, "reading"],
      [standardConsumerDir, standardTarballPath, "standard"],
    ]) {
      await cp(CONSUMER_FIXTURE_DIR, consumerDir, {
        recursive: true,
        filter: (src) => !["node_modules", "dist", ".astro"].includes(basename(src)),
      });

      console.log(`   Running npm ci in consumer for '${scName}'...`);
      execFileSync("npm", ["ci", "--ignore-scripts"], { cwd: consumerDir, stdio: "pipe" });

      console.log(`   Installing packed theme into consumer for '${scName}'...`);
      execFileSync("npm", ["install", "--ignore-scripts", "--no-save", "--package-lock=false", tarball], {
        cwd: consumerDir,
        stdio: "pipe",
      });

      console.log(`   Building Starlight documentation for '${scName}' scenario...`);
      const buildProc = spawnSync("npm", ["exec", "--", "astro", "build"], {
        cwd: consumerDir,
        env: {
          ...process.env,
          CONSUMER_SCENARIO: scName,
          THEME_PACKAGE_NAME: themePkgMeta.name,
          ASTRO_OUT_DIR: join(consumerDir, "dist"),
        },
        stdio: "pipe",
        encoding: "utf8",
      });
      if (buildProc.status !== 0) {
        console.error(buildProc.stderr);
        throw new Error(`Astro build failed for ${scName} scenario (exit code ${buildProc.status})`);
      }
      if (!existsSync(join(consumerDir, "dist/index.html"))) {
        throw new Error(`Astro build succeeded but dist/index.html is missing in ${scName}`);
      }
      if (!existsSync(join(consumerDir, "dist/guide/index.html"))) {
        throw new Error(`Astro build succeeded but second documentation page dist/guide/index.html is missing`);
      }
      console.log(`   ✓ '${scName}' Starlight documentation built successfully (index and guide pages verified).`);
    }

    // Step 6: Playwright Headless Chromium Verification
    console.log("7. Launching Playwright Chromium for real Starlight DOM/geometry assertions...");
    srvReading = await startStaticServer(join(readingConsumerDir, "dist"));
    srvStandard = await startStaticServer(join(standardConsumerDir, "dist"));

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    const browserErrors = [];
    const consoleErrors = [];
    const failedRequests = [];

    page.on("pageerror", (err) => {
      browserErrors.push(err.message || String(err));
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });
    page.on("requestfailed", (req) => {
      failedRequests.push(`${req.method()} ${req.url()} - ${req.failure()?.errorText || "failed"}`);
    });

    // -------------------------------------------------------------
    // Test A: Reading Preset vs Standard Control (Desktop 1440x900)
    // -------------------------------------------------------------
    await page.setViewportSize({ width: 1440, height: 900 });

    // Standard Layout Control
    await page.goto(`http://127.0.0.1:${srvStandard.port}/`);
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    const standardMetrics = await page.evaluate(() => {
      const container = document.querySelector(".main-pane .sl-container") || document.querySelector(".sl-container");
      const rect = container ? container.getBoundingClientRect() : null;
      const rootStyle = window.getComputedStyle(document.documentElement);
      return {
        containerWidth: rect ? Math.round(rect.width) : 0,
        containerLeft: rect ? Math.round(rect.left) : 0,
        containerRight: rect ? Math.round(rect.right) : 0,
        slContentWidth: rootStyle.getPropertyValue("--sl-content-width").trim(),
        hasSidebar: document.querySelector("[data-has-sidebar]") !== null,
        hasToc: document.querySelector("[data-has-toc]") !== null,
      };
    });

    const standardScreenshotPath = join(EVIDENCE_DIR, "starlight-standard-desktop.png");
    await page.screenshot({ path: standardScreenshotPath });

    // Reading Preset
    await page.goto(`http://127.0.0.1:${srvReading.port}/`);
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    const readingMetrics = await page.evaluate(() => {
      const container = document.querySelector(".main-pane .sl-container") || document.querySelector(".sl-container");
      const rect = container ? container.getBoundingClientRect() : null;
      const rootStyle = window.getComputedStyle(document.documentElement);
      const mainPane = document.querySelector(".main-pane");
      return {
        containerWidth: rect ? Math.round(rect.width) : 0,
        containerLeft: rect ? Math.round(rect.left) : 0,
        containerRight: rect ? Math.round(rect.right) : 0,
        slContentWidth: rootStyle.getPropertyValue("--sl-content-width").trim(),
        marginInline: mainPane ? window.getComputedStyle(mainPane).getPropertyValue("--sl-content-margin-inline").trim() : null,
        hasSidebar: document.querySelector("[data-has-sidebar]") !== null,
        hasToc: document.querySelector("[data-has-toc]") !== null,
      };
    });

    const readingScreenshotPath = join(EVIDENCE_DIR, "starlight-reading-desktop.png");
    await page.screenshot({ path: readingScreenshotPath });

    // Evaluate dark mode styles on reading preset (Review Finding F6)
    const darkStyles = await page.evaluate(() => {
      const docEl = window.getComputedStyle(document.documentElement);
      const body = window.getComputedStyle(document.body);
      return {
        accent: docEl.getPropertyValue("--sl-color-accent").trim(),
        hairline: docEl.getPropertyValue("--sl-color-hairline").trim(),
        bodyBg: body.backgroundColor,
        bodyColor: body.color,
      };
    });

    console.log(`   Standard layout .sl-container width: ${standardMetrics.containerWidth}px (left: ${standardMetrics.containerLeft}px)`);
    console.log(`   Reading preset .sl-container width: ${readingMetrics.containerWidth}px (left: ${readingMetrics.containerLeft}px)`);
    console.log(`   Dark mode body background: ${darkStyles.bodyBg}, accent: ${darkStyles.accent} (expected cyan #69d3e4)`);

    if (!darkStyles.accent.includes("69d3e4") && !darkStyles.accent.includes("105, 211, 228")) {
      throw new Error(`Expected dark mode accent to reflect Forge Console cyan (#69d3e4), got ${darkStyles.accent}`);
    }

    // Geometric Assertions (Finding B5 & B6 & Review Finding F7)
    // In Reading preset, .sl-container is bounded by min(704px, 48rem) -> exactly 704px.
    if (readingMetrics.containerWidth > 704) {
      throw new Error(`Reading preset .sl-container width exceeds 704px constraint: got ${readingMetrics.containerWidth}px`);
    }

    // Centering: Reading preset shifts container x-offset leftward relative to uncentered standard control
    const centeringDelta = standardMetrics.containerLeft - readingMetrics.containerLeft;
    console.log(`   Centering delta: reading container left=${readingMetrics.containerLeft}px vs standard layout left=${standardMetrics.containerLeft}px (delta: ${centeringDelta}px)`);
    if (readingMetrics.containerLeft >= standardMetrics.containerLeft) {
      throw new Error(`Expected reading preset container x-offset (${readingMetrics.containerLeft}px) to be shifted leftward relative to standard layout (${standardMetrics.containerLeft}px) due to centering`);
    }

    // Centering: Reading preset overrides --sl-content-margin-inline to auto
    if (readingMetrics.marginInline !== "auto") {
      throw new Error(`Reading preset failed to set --sl-content-margin-inline: auto, got: ${readingMetrics.marginInline}`);
    }

    // Verify document structure attributes are present (Finding B8)
    if (!readingMetrics.hasSidebar || !readingMetrics.hasToc) {
      throw new Error(`Starlight attributes missing: hasSidebar=${readingMetrics.hasSidebar}, hasToc=${readingMetrics.hasToc}`);
    }

    // -------------------------------------------------------------
    // Test B: Mobile Viewport Negative Control (390x844) (Finding B7)
    // -------------------------------------------------------------
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileMetrics = await page.evaluate(() => {
      const container = document.querySelector(".main-pane .sl-container") || document.querySelector(".sl-container");
      const rect = container ? container.getBoundingClientRect() : null;
      const scrollWidth = document.documentElement.scrollWidth;
      return {
        containerWidth: rect ? Math.round(rect.width) : 0,
        scrollWidth,
        overflow: scrollWidth > 390,
      };
    });

    const mobileScreenshotPath = join(EVIDENCE_DIR, "starlight-reading-mobile.png");
    await page.screenshot({ path: mobileScreenshotPath });

    console.log(`   Mobile viewport (390x844): container width ${mobileMetrics.containerWidth}px, scrollWidth ${mobileMetrics.scrollWidth}px (overflow: ${mobileMetrics.overflow})`);
    if (mobileMetrics.overflow) {
      throw new Error(`Horizontal layout overflow on mobile viewport: scrollWidth ${mobileMetrics.scrollWidth} > 390`);
    }

    // -------------------------------------------------------------
    // Test C: Ordinary Documentation Content & Navigation (Finding B8)
    // -------------------------------------------------------------
    await page.setViewportSize({ width: 1440, height: 900 });

    // Check TOC entries
    const tocLinks = await page.locator("starlight-toc a").allTextContents();
    console.log(`   Found ${tocLinks.length} TOC links: ${tocLinks.slice(0, 3).join(", ")}...`);
    if (tocLinks.length < 2) {
      throw new Error(`Expected at least 2 TOC entries from heading structure, found ${tocLinks.length}`);
    }

    // Check pagination link to guide page
    const nextPagination = page.locator("a[rel='next']");
    const nextText = await nextPagination.textContent();
    console.log(`   Pagination link next: '${nextText?.trim()}'`);
    if (!nextText || !nextText.includes("Guide")) {
      throw new Error(`Expected pagination link to 'Guide', got '${nextText}'`);
    }

    // Navigate to guide page
    await nextPagination.click();
    await page.waitForURL(/guide/);
    const guideH1 = await page.locator("h1#_top").textContent();
    console.log(`   Navigated to secondary page: '${guideH1?.trim()}'`);
    if (!guideH1 || !guideH1.includes("Starlight Guide")) {
      throw new Error(`Failed to navigate to guide page, got h1: '${guideH1}'`);
    }

    // Navigate back to overview via sidebar
    const overviewSidebarLink = page.locator("nav.sidebar a:has-text('Overview')").first();
    await overviewSidebarLink.click();
    await page.waitForURL(/\/(#.*)?$/);

    // -------------------------------------------------------------
    // Test D: Light / Dark Mode Presentation & Custom CSS Override
    // -------------------------------------------------------------
    // Toggle Light Mode
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
    });

    const lightStyles = await page.evaluate(() => {
      const docEl = window.getComputedStyle(document.documentElement);
      const body = window.getComputedStyle(document.body);
      const marker = document.querySelector(".consumer-custom-marker");
      return {
        accent: docEl.getPropertyValue("--sl-color-accent").trim(),
        hairline: docEl.getPropertyValue("--sl-color-hairline").trim(),
        bodyBg: body.backgroundColor,
        bodyColor: body.color,
        markerBorder: marker ? window.getComputedStyle(marker).borderColor : null,
      };
    });

    const lightScreenshotPath = join(EVIDENCE_DIR, "starlight-reading-light.png");
    await page.screenshot({ path: lightScreenshotPath });

    console.log(`   Light mode accent: ${lightStyles.accent} (expected cyan #126475)`);
    console.log(`   Consumer custom CSS hairline: ${lightStyles.hairline} (expected #e11d48)`);

    if (!lightStyles.accent.includes("126475") && !lightStyles.accent.includes("18, 100, 117")) {
      throw new Error(`Expected light mode accent to reflect Forge Console cyan (#126475), got ${lightStyles.accent}`);
    }
    // Consumer customCss override precedence
    if (!lightStyles.hairline.includes("e11d48") && !lightStyles.hairline.includes("225, 29, 72")) {
      throw new Error(`Consumer customCss failed to override --sl-color-hairline: got ${lightStyles.hairline}, expected #e11d48`);
    }

    // Assert browser error and network request failure state (Review Finding F5)
    if (browserErrors.length > 0) {
      throw new Error(`Browser uncaught errors encountered: ${browserErrors.join("; ")}`);
    }
    if (failedRequests.length > 0) {
      throw new Error(`Failed network requests encountered: ${failedRequests.join("; ")}`);
    }
    console.log(`   ✓ Browser error monitoring verified: 0 uncaught errors, 0 failed requests.`);

    // Record measurements
    result.status = "passed";
    result.metrics = {
      standardContainerWidth: standardMetrics.containerWidth,
      readingContainerWidth: readingMetrics.containerWidth,
      readingMarginInline: readingMetrics.marginInline,
      centeringDelta,
      mobileScrollWidth: mobileMetrics.scrollWidth,
      mobileContainerWidth: mobileMetrics.containerWidth,
      tocEntriesCount: tocLinks.length,
      lightAccent: lightStyles.accent,
      darkAccent: darkStyles.accent,
      darkBodyBg: darkStyles.bodyBg,
      consumerHairlineOverride: lightStyles.hairline,
      browserErrorsCount: browserErrors.length,
      failedRequestsCount: failedRequests.length,
    };
    result.screenshots = {
      standardDesktop: { path: standardScreenshotPath, sha256: sha256(await readFile(standardScreenshotPath)) },
      readingDesktop: { path: readingScreenshotPath, sha256: sha256(await readFile(readingScreenshotPath)) },
      readingMobile: { path: mobileScreenshotPath, sha256: sha256(await readFile(mobileScreenshotPath)) },
      readingLight: { path: lightScreenshotPath, sha256: sha256(await readFile(lightScreenshotPath)) },
    };

    console.log("\n=== Deliverable B Starlight Reading Qualification PASSED Successfully ===");
    return result;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (srvReading) await srvReading.close().catch(() => {});
    if (srvStandard) await srvStandard.close().catch(() => {});
    if (loomTarballPath) await rm(loomTarballPath, { force: true }).catch(() => {});
    await rm(scratchDir, { recursive: true, force: true }).catch(() => {});
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runStarlightReadingQualification().then(
    (res) => {
      console.log(JSON.stringify(res, null, 2));
      process.exit(0);
    },
    (err) => {
      console.error("FATAL: Starlight Reading Qualification failed:", err);
      process.exit(1);
    }
  );
}
