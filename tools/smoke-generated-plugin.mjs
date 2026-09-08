// @ts-check

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOOM_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(LOOM_ROOT, "../..");
const CONSUMER_FIXTURE_DIR = resolve(LOOM_ROOT, "consumer-fixture");
const TFSL_BIN = resolve(LOOM_ROOT, "bin/tfsl.js");
const EXAMPLE_CYAN = resolve(LOOM_ROOT, "examples/stellar-cyan.theme.json");
const EXAMPLE_AMBER = resolve(LOOM_ROOT, "examples/amber-forge.theme.json");

function sha256(strOrBuf) {
  return createHash("sha256").update(strOrBuf).digest("hex");
}

/**
 * Parse hex or rgb color string to [r, g, b] array.
 * @param {string | null | undefined} colorStr
 * @returns {[number, number, number] | null}
 */
function parseColor(colorStr) {
  if (!colorStr) return null;
  const s = colorStr.trim().toLowerCase();
  if (s.startsWith("#")) {
    let hex = s.slice(1);
    if (hex.length === 3) {
      hex = hex.split("").map((c) => c + c).join("");
    }
    if (hex.length === 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
  }
  const match = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (match) {
    return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
  }
  return null;
}

/**
 * Calculate relative luminance of [r, g, b].
 * @param {[number, number, number]} rgb
 * @returns {number}
 */
function relativeLuminance([r, g, b]) {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const val = c / 255;
    return val <= 0.04045 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Calculate WCAG contrast ratio between two colors.
 * @param {string | null | undefined} color1
 * @param {string | null | undefined} color2
 * @returns {number | null}
 */
function calculateContrastRatio(color1, color2) {
  const rgb1 = parseColor(color1);
  const rgb2 = parseColor(color2);
  if (!rgb1 || !rgb2) return null;
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

/**
 * Format hex color as rgb tuple string "r, g, b".
 * @param {string} hex
 * @returns {string}
 */
function hexToRgbTuple(hex) {
  const parsed = parseColor(hex);
  if (!parsed) return "";
  return `${parsed[0]}, ${parsed[1]}, ${parsed[2]}`;
}

function colorMatches(actual, hex, rgbTuple) {
  if (!actual) return false;
  const s = actual.toLowerCase();
  let shortHex = null;
  if (hex && hex.length === 7 && hex[1] === hex[2] && hex[3] === hex[4] && hex[5] === hex[6]) {
    shortHex = `#${hex[1]}${hex[3]}${hex[5]}`.toLowerCase();
  }
  return (
    (hex && s.includes(hex.toLowerCase())) ||
    (shortHex !== null && s.includes(shortHex)) ||
    (rgbTuple && s.includes(rgbTuple.toLowerCase()))
  );
}


/** Simple static HTTP server for serving Astro build directories */
function startStaticServer(rootDir, port = 0) {
  const MIME_TYPES = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".wasm": "application/wasm",
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

export async function runGeneratedPluginSmoke() {
  console.log("=== TFSB53D Starlight Plugin Generator & Consumer Smoke Qualification ===");

  const scratchDir = await mkdtemp(join(tmpdir(), "tfsl-smoke-53d-"));
  console.log(`1. Created isolated scratch directory: ${scratchDir}`);

  try {
    // -------------------------------------------------------------
    // Step 1: Package Generation & Determinism Qualification
    // -------------------------------------------------------------
    console.log("2. Generating candidate theme packages in scratch directories...");

    const cyanMetaPath = join(scratchDir, "cyan-pkg.json");
    await writeFile(
      cyanMetaPath,
      JSON.stringify({
        name: "starlight-theme-stellar-cyan",
        version: "0.1.0",
        description: "Stellar Cyan Starlight theme plugin",
        author: "The Knowledge Forge Authors",
      }),
      "utf8"
    );

    const amberMetaPath = join(scratchDir, "amber-pkg.json");
    await writeFile(
      amberMetaPath,
      JSON.stringify({
        name: "starlight-theme-amber-forge",
        version: "0.1.0",
        description: "Amber Forge Starlight theme plugin with page title frame",
        template: "page-title-frame",
      }),
      "utf8"
    );

    // Theme Lab saved format interoperability (tests JSON format compatibility with Theme Lab saved specifications, not native Save command execution)
    const savedThemePath = join(scratchDir, "theme-lab-saved.json");
    const sampleSavedSpec = {
      ...JSON.parse(await readFile(EXAMPLE_CYAN, "utf8")),
      name: "theme-lab-saved-cyan",
    };
    await writeFile(savedThemePath, JSON.stringify(sampleSavedSpec, null, 2), "utf8");

    const cyanOut1 = join(scratchDir, "cyan-package-1");
    const cyanOut2 = join(scratchDir, "cyan-package-2");
    const amberOut = join(scratchDir, "amber-package");
    const savedOut = join(scratchDir, "saved-package");

    // CLI invocation for cyanOut1
    execFileSync(process.execPath, [
      TFSL_BIN,
      "generate",
      EXAMPLE_CYAN,
      "--package",
      cyanMetaPath,
      "--out",
      cyanOut1,
      "--json",
    ]);

    // Independent CLI invocation in separate process for cyanOut2 (determinism proof)
    execFileSync(process.execPath, [
      TFSL_BIN,
      "generate",
      EXAMPLE_CYAN,
      "--package",
      cyanMetaPath,
      "--out",
      cyanOut2,
      "--json",
    ]);

    // Amber Forge with template
    execFileSync(process.execPath, [
      TFSL_BIN,
      "generate",
      EXAMPLE_AMBER,
      "--package",
      amberMetaPath,
      "--out",
      amberOut,
      "--template",
      "page-title-frame",
      "--json",
    ]);

    // Saved Theme Lab theme
    execFileSync(process.execPath, [
      TFSL_BIN,
      "generate",
      savedThemePath,
      "--package",
      cyanMetaPath,
      "--out",
      savedOut,
      "--json",
    ]);

    console.log("   Theme packages generated successfully.");

    // Verify determinism between cyanOut1 and cyanOut2 across independent directories/processes
    console.log("3. Verifying bit-for-bit byte equality across independent directories/processes...");
    const files1 = await readdir(cyanOut1, { recursive: true });
    const files2 = await readdir(cyanOut2, { recursive: true });
    if (JSON.stringify(files1.sort()) !== JSON.stringify(files2.sort())) {
      throw new Error("File lists differ between independent generation runs");
    }

    for (const f of files1) {
      const p1 = join(cyanOut1, f);
      const p2 = join(cyanOut2, f);
      const s1 = await stat(p1);
      if (s1.isFile()) {
        const b1 = await readFile(p1);
        const b2 = await readFile(p2);
        if (sha256(b1) !== sha256(b2)) {
          throw new Error(`Byte mismatch in '${f}' between independent generation runs`);
        }
      }
    }
    console.log("   Determinism verified: 100% bit-for-bit identical files across independent processes.");

    // -------------------------------------------------------------
    // Step 2: Local Packaging with npm pack
    // -------------------------------------------------------------
    console.log("4. Packing generated theme packages via npm pack...");

    const packCyanRaw = execFileSync("npm", ["pack", "--json"], {
      cwd: cyanOut1,
      encoding: "utf8",
    });
    const packCyanJson = JSON.parse(packCyanRaw);
    const cyanTarballName = packCyanJson[0].filename;
    const cyanTarballPath = join(cyanOut1, cyanTarballName);

    const packAmberRaw = execFileSync("npm", ["pack", "--json"], {
      cwd: amberOut,
      encoding: "utf8",
    });
    const packAmberJson = JSON.parse(packAmberRaw);
    const amberTarballName = packAmberJson[0].filename;
    const amberTarballPath = join(amberOut, amberTarballName);

    console.log(`   Packed ${cyanTarballName} (${packCyanJson[0].size} bytes)`);
    console.log(`   Packed ${amberTarballName} (${packAmberJson[0].size} bytes)`);

    // Verify package members from npm pack metadata
    const cyanEntryFiles = packCyanJson[0].files.map((f) => f.path);
    const amberEntryFiles = packAmberJson[0].files.map((f) => f.path);

    if (!cyanEntryFiles.includes("index.js") || !cyanEntryFiles.includes("styles/theme.css")) {
      throw new Error("Cyan package tarball is missing required runtime entry files");
    }
    if (cyanEntryFiles.includes("components/PageTitleFrame.astro")) {
      throw new Error("CSS-only package unexpectedly contains component override");
    }
    if (!amberEntryFiles.includes("components/PageTitleFrame.astro")) {
      throw new Error("Amber package with template is missing components/PageTitleFrame.astro");
    }

    // Assert hygiene: no node_modules, tests, dev scripts, or host paths in packages
    for (const f of [...cyanEntryFiles, ...amberEntryFiles]) {
      if (f.includes("node_modules") || f.includes(".test.") || f.includes(".spec.")) {
        throw new Error(`Forbidden file found in package tarball: ${f}`);
      }
    }
    console.log("   Package member inventory and isolation verified.");

    // -------------------------------------------------------------
    // Step 3: Disposable Installation into Starlight Consumer Fixture
    // -------------------------------------------------------------
    console.log("5. Installing generated tarballs into consumer fixture with scripts disabled...");

    // Verify TFSL compiler checkout is strictly absent from consumer's module resolution (both CommonJS and ESM)
    const consumerRequire = createRequire(join(CONSUMER_FIXTURE_DIR, "package.json"));
    try {
      const resolved = consumerRequire.resolve("@knowledge-forge-ai/theme-forge-stellar-loom");
      throw new Error(`TFSL compiler checkout unexpectedly resolved from consumer fixture: ${resolved}`);
    } catch (err) {
      if (err && /** @type {any} */ (err).code !== "MODULE_NOT_FOUND") {
        throw err;
      }
      console.log("   ✓ TFSL compiler checkout confirmed strictly absent from consumer CommonJS module resolution.");
    }

    const esmProbe = spawnSync(
      "node",
      ["--input-type=module", "-e", "await import('@knowledge-forge-ai/theme-forge-stellar-loom')"],
      {
        cwd: CONSUMER_FIXTURE_DIR,
        encoding: "utf8",
      }
    );
    if (esmProbe.status === 0 || !esmProbe.stderr.includes("ERR_MODULE_NOT_FOUND")) {
      throw new Error("TFSL compiler checkout was unexpectedly resolvable via ESM from consumer fixture");
    }
    console.log("   ✓ TFSL compiler checkout confirmed strictly absent from consumer ESM import resolution.");

    const installResult = spawnSync(
      "npm",
      ["install", "--ignore-scripts", "--no-save", cyanTarballPath, amberTarballPath],
      {
        cwd: CONSUMER_FIXTURE_DIR,
        stdio: "inherit",
      }
    );
    if (installResult.status !== 0) {
      throw new Error(`Failed to install generated theme tarballs into consumer fixture (exit: ${installResult.status})`);
    }
    console.log("   Tarballs installed cleanly into consumer fixture.");

    // -------------------------------------------------------------
    // Step 4: Building Consumer Documentation Under 4 Scenarios
    // -------------------------------------------------------------
    console.log("6. Building consumer fixture under 4 scenarios (cyan, amber, override, disconnected)...");

    const distCyan = join(CONSUMER_FIXTURE_DIR, "dist/cyan");
    const distAmber = join(CONSUMER_FIXTURE_DIR, "dist/amber");
    const distOverride = join(CONSUMER_FIXTURE_DIR, "dist/override");
    const distDisconnected = join(CONSUMER_FIXTURE_DIR, "dist/disconnected");

    const scenarios = [
      { name: "cyan", outDir: distCyan, env: { CONSUMER_SCENARIO: "cyan", ASTRO_OUT_DIR: distCyan } },
      { name: "amber", outDir: distAmber, env: { CONSUMER_SCENARIO: "amber", ASTRO_OUT_DIR: distAmber } },
      { name: "override", outDir: distOverride, env: { CONSUMER_SCENARIO: "consumer-override", ASTRO_OUT_DIR: distOverride } },
      { name: "disconnected", outDir: distDisconnected, env: { CONSUMER_SCENARIO: "disconnected", ASTRO_OUT_DIR: distDisconnected } },
    ];

    const buildDurations = {};
    for (const sc of scenarios) {
      const startTime = performance.now();
      const buildProc = spawnSync("npx", ["astro", "build"], {
        cwd: CONSUMER_FIXTURE_DIR,
        env: { ...process.env, ...sc.env },
        stdio: "pipe",
        encoding: "utf8",
      });
      const durationMs = Math.round(performance.now() - startTime);
      buildDurations[sc.name] = durationMs;
      if (buildProc.status !== 0) {
        console.error(buildProc.stderr);
        throw new Error(`Failed to build consumer scenario '${sc.name}' (exit code: ${buildProc.status})`);
      }
      if (!existsSync(join(sc.outDir, "index.html"))) {
        throw new Error(`Scenario '${sc.name}' build succeeded but index.html is missing`);
      }
      console.log(`   ✓ Scenario '${sc.name}' built successfully in ${durationMs}ms.`);
    }

    // -------------------------------------------------------------
    // Step 5: Playwright Headless Browser Verification
    // -------------------------------------------------------------
    console.log("7. Launching Playwright Chromium for live DOM & CSSOM verification...");

    const playwrightModule = await import("@playwright/test");
    const chromium = playwrightModule.chromium || playwrightModule.default?.chromium;
    const browser = await chromium.launch({ headless: true });

    try {
      // Start local static server on dynamic ports for each scenario
      const srvCyan = await startStaticServer(distCyan, 0);
      const srvAmber = await startStaticServer(distAmber, 0);
      const srvOverride = await startStaticServer(distOverride, 0);
      const srvDisconnected = await startStaticServer(distDisconnected, 0);

      try {
        const page = await browser.newPage();

        // -------------------------------------------------------
        // Test A: Scenario 1 (Stellar Cyan - Default CSS-Only)
        // -------------------------------------------------------
        console.log("   Testing Scenario 1: Stellar Cyan (CSS-only)...");
        await page.goto(`http://127.0.0.1:${srvCyan.port}/`);

        // Check dark mode computed styles and custom properties for Stellar Cyan
        await page.evaluate(() => {
          document.documentElement.dataset.theme = "dark";
        });
        const cyanDarkStyles = await page.evaluate(() => {
          const docEl = window.getComputedStyle(document.documentElement);
          const body = window.getComputedStyle(document.body);
          const link = document.querySelector("a[href*='starlight.astro.build']");
          const linkStyle = link ? window.getComputedStyle(link) : null;
          const code = document.querySelector(":not(pre) > code") || document.querySelector("code");
          const codeStyle = code ? window.getComputedStyle(code) : null;
          const h1 = document.querySelector("h1#_top");
          const h1Style = h1 ? window.getComputedStyle(h1) : null;

          return {
            slAccent: docEl.getPropertyValue("--sl-color-accent").trim(),
            slBg: docEl.getPropertyValue("--sl-color-bg").trim(),
            slText: docEl.getPropertyValue("--sl-color-text").trim(),
            slBgInlineCode: docEl.getPropertyValue("--sl-color-bg-inline-code").trim(),
            slWhite: docEl.getPropertyValue("--sl-color-white").trim(),
            bodyBg: body.backgroundColor,
            bodyColor: body.color,
            bodyFont: body.fontFamily,
            linkColor: linkStyle ? linkStyle.color : null,
            codeBg: codeStyle ? codeStyle.backgroundColor : null,
            codeColor: codeStyle ? codeStyle.color : null,
            codeFont: codeStyle ? codeStyle.fontFamily : null,
            h1Color: h1Style ? h1Style.color : null,
            h1FontSize: h1Style ? h1Style.fontSize : null,
            h1FontWeight: h1Style ? h1Style.fontWeight : null,
          };
        });

        // Dark mode expected-value assertions for Stellar Cyan
        if (!colorMatches(cyanDarkStyles.slAccent, "#00d2ff", "0, 210, 255")) {
          throw new Error(`Expected dark mode accent #00d2ff, got: ${cyanDarkStyles.slAccent}`);
        }
        if (!colorMatches(cyanDarkStyles.bodyBg, "#090e17", "9, 14, 23")) {
          throw new Error(`Expected dark mode body background #090e17 (9, 14, 23), got: ${cyanDarkStyles.bodyBg}`);
        }
        if (!colorMatches(cyanDarkStyles.bodyColor, "#e6f1ff", "230, 241, 255")) {
          throw new Error(`Expected dark mode body text #e6f1ff (230, 241, 255), got: ${cyanDarkStyles.bodyColor}`);
        }
        if (!colorMatches(cyanDarkStyles.linkColor, "#00d2ff", "0, 210, 255")) {
          throw new Error(`Expected dark mode link color #00d2ff (0, 210, 255), got: ${cyanDarkStyles.linkColor}`);
        }
        if (!colorMatches(cyanDarkStyles.codeBg, "#131d2e", "19, 29, 46")) {
          throw new Error(`Expected dark mode inline code bg #131d2e (19, 29, 46), got: ${cyanDarkStyles.codeBg}`);
        }
        if (!colorMatches(cyanDarkStyles.codeColor, "#e6f1ff", "230, 241, 255")) {
          throw new Error(`Expected dark mode inline code color #e6f1ff (230, 241, 255), got: ${cyanDarkStyles.codeColor}`);
        }
        if (!colorMatches(cyanDarkStyles.h1Color, "#e6f1ff", "230, 241, 255")) {
          throw new Error(`Expected dark mode heading color #e6f1ff (230, 241, 255), got: ${cyanDarkStyles.h1Color}`);
        }
        // Typography & heading sizing assertions
        if (!cyanDarkStyles.bodyFont || !cyanDarkStyles.bodyFont.toLowerCase().includes("sans-serif")) {
          throw new Error(`Expected system-sans body font stack, got: ${cyanDarkStyles.bodyFont}`);
        }
        if (!cyanDarkStyles.codeFont || !cyanDarkStyles.codeFont.toLowerCase().includes("monospace")) {
          throw new Error(`Expected system-mono code font stack, got: ${cyanDarkStyles.codeFont}`);
        }
        const cyanH1Size = parseInt(cyanDarkStyles.h1FontSize, 10);
        if (!cyanH1Size || cyanH1Size < 24) {
          throw new Error(`Expected prominent h1 font size (>= 24px), got: ${cyanDarkStyles.h1FontSize}`);
        }
        const cyanH1Weight = parseInt(cyanDarkStyles.h1FontWeight, 10);
        if (!cyanH1Weight || cyanH1Weight < 600) {
          throw new Error(`Expected bold h1 font weight (>= 600), got: ${cyanDarkStyles.h1FontWeight}`);
        }

        // Toggle to light mode
        await page.evaluate(() => {
          document.documentElement.dataset.theme = "light";
        });
        const cyanLightStyles = await page.evaluate(() => {
          const docEl = window.getComputedStyle(document.documentElement);
          const body = window.getComputedStyle(document.body);
          const link = document.querySelector("a[href*='starlight.astro.build']");
          const linkStyle = link ? window.getComputedStyle(link) : null;
          const code = document.querySelector(":not(pre) > code") || document.querySelector("code");
          const codeStyle = code ? window.getComputedStyle(code) : null;
          const h1 = document.querySelector("h1#_top");
          const h1Style = h1 ? window.getComputedStyle(h1) : null;

          return {
            slAccent: docEl.getPropertyValue("--sl-color-accent").trim(),
            slBg: docEl.getPropertyValue("--sl-color-bg").trim(),
            slText: docEl.getPropertyValue("--sl-color-text").trim(),
            slBgInlineCode: docEl.getPropertyValue("--sl-color-bg-inline-code").trim(),
            slWhite: docEl.getPropertyValue("--sl-color-white").trim(),
            slHairline: docEl.getPropertyValue("--sl-color-hairline").trim(),
            bodyBg: body.backgroundColor,
            bodyColor: body.color,
            linkColor: linkStyle ? linkStyle.color : null,
            codeBg: codeStyle ? codeStyle.backgroundColor : null,
            h1Color: h1Style ? h1Style.color : null,
          };
        });
        if (!colorMatches(cyanLightStyles.slAccent, "#0077aa", "0, 119, 170")) {
          throw new Error(`Expected light mode accent to be #0077aa, got: ${cyanLightStyles.slAccent}`);
        }
        if (!colorMatches(cyanLightStyles.bodyBg, "#f5f9fc", "245, 249, 252")) {
          throw new Error(`Expected light mode body background #f5f9fc (245, 249, 252), got: ${cyanLightStyles.bodyBg}`);
        }
        if (!colorMatches(cyanLightStyles.bodyColor, "#0d1522", "13, 21, 34")) {
          throw new Error(`Expected light mode body text #0d1522 (13, 21, 34), got: ${cyanLightStyles.bodyColor}`);
        }
        if (!colorMatches(cyanLightStyles.linkColor, "#0077aa", "0, 119, 170")) {
          throw new Error(`Expected light mode link color #0077aa (0, 119, 170), got: ${cyanLightStyles.linkColor}`);
        }
        if (!colorMatches(cyanLightStyles.codeBg, "#e8f1f8", "232, 241, 248")) {
          throw new Error(`Expected light mode inline code bg #e8f1f8 (232, 241, 248), got: ${cyanLightStyles.codeBg}`);
        }
        if (!colorMatches(cyanLightStyles.h1Color, "#0d1522", "13, 21, 34")) {
          throw new Error(`Expected light mode heading color #0d1522 (13, 21, 34), got: ${cyanLightStyles.h1Color}`);
        }
        // Verify consumer custom CSS cascade precedence in light mode
        if (!colorMatches(cyanLightStyles.slHairline, "#e11d48", "225, 29, 72")) {
          throw new Error(`Consumer custom CSS precedence failed in light mode: expected hairline #e11d48, got: ${cyanLightStyles.slHairline}`);
        }

        // Restore dark mode
        await page.evaluate(() => {
          document.documentElement.dataset.theme = "dark";
        });

        // Test responsive rendering: wide and narrow
        await page.setViewportSize({ width: 1280, height: 800 });
        const wideScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        if (wideScrollWidth > 1280) {
          throw new Error(`Horizontal overflow on desktop viewport: scrollWidth ${wideScrollWidth} > 1280`);
        }

        await page.setViewportSize({ width: 375, height: 667 });
        const narrowScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        if (narrowScrollWidth > 375) {
          throw new Error(`Horizontal overflow on mobile viewport: scrollWidth ${narrowScrollWidth} > 375`);
        }
        await page.setViewportSize({ width: 1280, height: 800 });

        // Verify default CSS-only package has NO .tfsl-page-title-frame
        const cyanFrameCount = await page.locator(".tfsl-page-title-frame").count();
        if (cyanFrameCount !== 0) {
          throw new Error(`Expected 0 .tfsl-page-title-frame elements in CSS-only package, found ${cyanFrameCount}`);
        }

        // Single semantic h1#_top intact
        const h1Count = await page.locator("h1#_top").count();
        if (h1Count !== 1) {
          throw new Error(`Expected exactly 1 h1#_top, found ${h1Count}`);
        }

        // Verify consumer custom CSS cascade precedence: --sl-color-hairline was set to #e11d48 in consumer-custom.css
        const hairlineColor = await page.evaluate(() => {
          return window.getComputedStyle(document.documentElement).getPropertyValue("--sl-color-hairline").trim();
        });
        if (!hairlineColor.includes("e11d48") && !hairlineColor.includes("225, 29, 72")) {
          throw new Error(`Consumer custom CSS precedence failed: expected hairline #e11d48, got: ${hairlineColor}`);
        }
        console.log("   ✓ Stellar Cyan CSS-only: two-mode styles, responsive viewports, and cascade precedence verified.");

        // -------------------------------------------------------
        // Test B: Scenario 2 (Amber Forge with page-title-frame)
        // -------------------------------------------------------
        console.log("   Testing Scenario 2: Amber Forge (with page-title-frame template)...");
        await page.goto(`http://127.0.0.1:${srvAmber.port}/`);

        // Dark mode styles for Amber Forge
        await page.evaluate(() => {
          document.documentElement.dataset.theme = "dark";
        });
        const amberDarkStyles = await page.evaluate(() => {
          const docEl = window.getComputedStyle(document.documentElement);
          const body = window.getComputedStyle(document.body);
          const code = document.querySelector(":not(pre) > code") || document.querySelector("code");
          const codeStyle = code ? window.getComputedStyle(code) : null;
          const h1 = document.querySelector("h1#_top");
          const h1Style = h1 ? window.getComputedStyle(h1) : null;

          return {
            slAccent: docEl.getPropertyValue("--sl-color-accent").trim(),
            slBg: docEl.getPropertyValue("--sl-color-bg").trim(),
            slText: docEl.getPropertyValue("--sl-color-text").trim(),
            slBgInlineCode: docEl.getPropertyValue("--sl-color-bg-inline-code").trim(),
            slWhite: docEl.getPropertyValue("--sl-color-white").trim(),
            bodyBg: body.backgroundColor,
            bodyColor: body.color,
            bodyFont: body.fontFamily,
            codeBg: codeStyle ? codeStyle.backgroundColor : null,
            codeColor: codeStyle ? codeStyle.color : null,
            codeFont: codeStyle ? codeStyle.fontFamily : null,
            h1Color: h1Style ? h1Style.color : null,
            h1FontSize: h1Style ? h1Style.fontSize : null,
            h1FontWeight: h1Style ? h1Style.fontWeight : null,
          };
        });

        if (!colorMatches(amberDarkStyles.slAccent, "#f59e0b", "245, 158, 11")) {
          throw new Error(`Expected Amber Forge dark accent #f59e0b, got: ${amberDarkStyles.slAccent}`);
        }
        if (!colorMatches(amberDarkStyles.bodyBg, "#181512", "24, 21, 18")) {
          throw new Error(`Expected Amber Forge dark body bg #181512 (24, 21, 18), got: ${amberDarkStyles.bodyBg}`);
        }
        if (!colorMatches(amberDarkStyles.bodyColor, "#fef3c7", "254, 243, 199")) {
          throw new Error(`Expected Amber Forge dark body text #fef3c7 (254, 243, 199), got: ${amberDarkStyles.bodyColor}`);
        }
        if (!colorMatches(amberDarkStyles.codeBg, "#2a241e", "42, 36, 30")) {
          throw new Error(`Expected Amber Forge dark inline code bg #2a241e (42, 36, 30), got: ${amberDarkStyles.codeBg}`);
        }
        if (!colorMatches(amberDarkStyles.codeColor, "#fef3c7", "254, 243, 199")) {
          throw new Error(`Expected Amber Forge dark inline code color #fef3c7 (254, 243, 199), got: ${amberDarkStyles.codeColor}`);
        }
        if (!colorMatches(amberDarkStyles.h1Color, "#fef3c7", "254, 243, 199")) {
          throw new Error(`Expected Amber Forge dark heading color #fef3c7 (254, 243, 199), got: ${amberDarkStyles.h1Color}`);
        }
        // Typography & heading sizing assertions
        if (!amberDarkStyles.bodyFont || !amberDarkStyles.bodyFont.toLowerCase().includes("serif")) {
          throw new Error(`Expected system-serif body font stack, got: ${amberDarkStyles.bodyFont}`);
        }
        if (!amberDarkStyles.codeFont || !amberDarkStyles.codeFont.toLowerCase().includes("monospace")) {
          throw new Error(`Expected system-mono code font stack, got: ${amberDarkStyles.codeFont}`);
        }
        const amberH1Size = parseInt(amberDarkStyles.h1FontSize, 10);
        if (!amberH1Size || amberH1Size < 24) {
          throw new Error(`Expected prominent h1 font size (>= 24px), got: ${amberDarkStyles.h1FontSize}`);
        }
        const amberH1Weight = parseInt(amberDarkStyles.h1FontWeight, 10);
        if (!amberH1Weight || amberH1Weight < 600) {
          throw new Error(`Expected bold h1 font weight (>= 600), got: ${amberDarkStyles.h1FontWeight}`);
        }

        // Amber Forge Light mode
        await page.evaluate(() => {
          document.documentElement.dataset.theme = "light";
        });
        const amberLightStyles = await page.evaluate(() => {
          const docEl = window.getComputedStyle(document.documentElement);
          const body = window.getComputedStyle(document.body);
          const code = document.querySelector(":not(pre) > code") || document.querySelector("code");
          const codeStyle = code ? window.getComputedStyle(code) : null;
          const h1 = document.querySelector("h1#_top");
          const h1Style = h1 ? window.getComputedStyle(h1) : null;

          return {
            slAccent: docEl.getPropertyValue("--sl-color-accent").trim(),
            slBg: docEl.getPropertyValue("--sl-color-bg").trim(),
            slText: docEl.getPropertyValue("--sl-color-text").trim(),
            slBgInlineCode: docEl.getPropertyValue("--sl-color-bg-inline-code").trim(),
            slWhite: docEl.getPropertyValue("--sl-color-white").trim(),
            bodyBg: body.backgroundColor,
            bodyColor: body.color,
            codeBg: codeStyle ? codeStyle.backgroundColor : null,
            h1Color: h1Style ? h1Style.color : null,
          };
        });

        if (!colorMatches(amberLightStyles.slAccent, "#b45309", "180, 83, 9")) {
          throw new Error(`Expected Amber Forge light accent #b45309, got: ${amberLightStyles.slAccent}`);
        }
        if (!colorMatches(amberLightStyles.bodyBg, "#fffbf5", "255, 251, 245")) {
          throw new Error(`Expected Amber Forge light body bg #fffbf5 (255, 251, 245), got: ${amberLightStyles.bodyBg}`);
        }
        if (!colorMatches(amberLightStyles.bodyColor, "#261c14", "38, 28, 20")) {
          throw new Error(`Expected Amber Forge light body text #261c14 (38, 28, 20), got: ${amberLightStyles.bodyColor}`);
        }
        if (!colorMatches(amberLightStyles.codeBg, "#f5eee1", "245, 238, 225")) {
          throw new Error(`Expected Amber Forge light inline code bg #f5eee1 (245, 238, 225), got: ${amberLightStyles.codeBg}`);
        }
        if (!colorMatches(amberLightStyles.h1Color, "#261c14", "38, 28, 20")) {
          throw new Error(`Expected Amber Forge light heading color #261c14 (38, 28, 20), got: ${amberLightStyles.h1Color}`);
        }

        // Restore dark mode
        await page.evaluate(() => {
          document.documentElement.dataset.theme = "dark";
        });

        // Verify opt-in template wrapper IS rendered
        const amberFrame = page.locator(".tfsl-page-title-frame[data-tfsl-template='page-title-frame']");
        if ((await amberFrame.count()) !== 1) {
          throw new Error("Missing .tfsl-page-title-frame wrapper in Amber Forge template output");
        }

        // Verify it wraps h1#_top and preserves route data
        const amberH1 = amberFrame.locator("h1#_top");
        if ((await amberH1.count()) !== 1) {
          throw new Error("Expected wrapper to contain single h1#_top element");
        }
        const titleText = await amberH1.textContent();
        if (!titleText || !titleText.includes("Starlight Consumer Qualification")) {
          throw new Error(`Expected route title text in wrapped h1, got: '${titleText}'`);
        }

        // Verify wrapper has left border styling
        const borderLeftWidth = await amberFrame.evaluate((el) => window.getComputedStyle(el).borderLeftWidth);
        if (borderLeftWidth !== "4px") {
          throw new Error(`Expected 4px borderLeftWidth on title frame, got: ${borderLeftWidth}`);
        }
        console.log("   ✓ Amber Forge template: opt-in wrapper rendered, heading anchor, route title preserved.");

        // -------------------------------------------------------
        // Test C: Scenario 3 (Consumer Component Override Precedence)
        // -------------------------------------------------------
        console.log("   Testing Scenario 3: Consumer component override preservation...");
        await page.goto(`http://127.0.0.1:${srvOverride.port}/`);

        // Consumer override component must be present
        const consumerOverride = page.locator("[data-test-override='consumer-owned']");
        if ((await consumerOverride.count()) !== 1) {
          throw new Error("Consumer-owned component override was not rendered");
        }

        // Opt-in wrapper must NOT replace consumer's override
        const overridePluginFrame = page.locator(".tfsl-page-title-frame");
        if ((await overridePluginFrame.count()) !== 0) {
          throw new Error("Plugin template override incorrectly superseded consumer-owned component override");
        }
        console.log("   ✓ Consumer component override strictly preserved without conflict.");

        // -------------------------------------------------------
        // Test D: Scenario 4 (Negative Control - Plugin Absent)
        // -------------------------------------------------------
        console.log("   Testing Scenario 4: Disconnected negative control (plugin absent)...");
        await page.goto(`http://127.0.0.1:${srvDisconnected.port}/`);

        const disconnectedAccent = await page.evaluate(() => {
          return window.getComputedStyle(document.documentElement).getPropertyValue("--sl-color-accent").trim();
        });
        // Default Starlight accent is purple/indigo (rgb(139, 92, 246) or #8b5cf6), distinctly NOT cyan #00d2ff or amber #f59e0b
        if (disconnectedAccent.includes("00d2ff") || disconnectedAccent.includes("f59e0b")) {
          throw new Error(`Disconnected site unexpectedly has theme accent: ${disconnectedAccent}`);
        }
        console.log(`   ✓ Negative control: baseline Starlight accent is '${disconnectedAccent}', proving plugin hook effect.`);

        // -------------------------------------------------------
        // Test E: Security & Hygiene Audit
        // -------------------------------------------------------
        console.log("8. Performing security, hygiene, and boundary inspection on emitted & built assets...");
        const dirsToAudit = [
          cyanOut1,
          cyanOut2,
          amberOut,
          savedOut,
          distCyan,
          distAmber,
          distOverride,
          distDisconnected,
        ];

        for (const targetDir of dirsToAudit) {
          const files = await readdir(targetDir, { recursive: true });
          for (const file of files) {
            const fullPath = join(targetDir, file);
            const st = await stat(fullPath);
            if (st.isFile()) {
              const content = await readFile(fullPath, "utf8");
              if (content.includes("tfsl:attempt-command")) {
                throw new Error(`Asset '${file}' in '${targetDir}' unexpectedly contains 'tfsl:attempt-command'`);
              }
              if (content.includes("__TAURI_INTERNALS__") || content.includes("__TAURI__")) {
                throw new Error(`Asset '${file}' in '${targetDir}' unexpectedly contains Tauri handles`);
              }
              if (content.includes("window.ipc")) {
                throw new Error(`Asset '${file}' in '${targetDir}' unexpectedly contains 'window.ipc'`);
              }
              if (process.env.HOME && content.includes(process.env.HOME)) {
                throw new Error(`Asset '${file}' in '${targetDir}' unexpectedly contains host home path`);
              }
            }
          }
        }
        console.log("   ✓ All emitted packages and built assets contain zero native probes, IPC bridges, or host paths.");

      } finally {
        await browser.close().catch(() => {});
        await Promise.all([
          srvCyan.close(),
          srvAmber.close(),
          srvOverride.close(),
          srvDisconnected.close(),
        ]);
      }
    } finally {
      // browser cleanup handled above
    }

    console.log("=== All Generated Plugin Smoke Qualifications PASSED Successfully ===");
    return { status: "pass" };
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
}

/**
 * @param {string} dir1
 * @param {string} dir2
 */
async function verifyDeterminism(dir1, dir2) {
  const files1 = (await readdir(dir1, { recursive: true })).sort();
  const files2 = (await readdir(dir2, { recursive: true })).sort();
  if (JSON.stringify(files1) !== JSON.stringify(files2)) {
    throw new Error(`File lists differ between independent generation runs: ${files1.join(",")} vs ${files2.join(",")}`);
  }
  for (const f of files1) {
    const p1 = join(dir1, f);
    const p2 = join(dir2, f);
    const s1 = await stat(p1);
    if (s1.isFile()) {
      const b1 = await readFile(p1);
      const b2 = await readFile(p2);
      if (sha256(b1) !== sha256(b2)) {
        throw new Error(`Byte mismatch in '${f}' between independent generation runs`);
      }
    }
  }
}

/**
 * @param {{ filename: string, files: Array<{ path: string }> }} packInfo
 * @param {boolean} hasTemplate
 */
function verifyPackageMembers(packInfo, hasTemplate) {
  const files = packInfo.files.map((f) => f.path);
  if (!files.includes("index.js") || !files.includes("styles/theme.css")) {
    throw new Error(`Package is missing required runtime entry files: ${packInfo.filename}`);
  }
  if (hasTemplate) {
    if (!files.includes("components/PageTitleFrame.astro")) {
      throw new Error(`Package with template is missing components/PageTitleFrame.astro: ${packInfo.filename}`);
    }
  } else {
    if (files.includes("components/PageTitleFrame.astro")) {
      throw new Error(`CSS-only package unexpectedly contains component override: ${packInfo.filename}`);
    }
  }
  for (const f of files) {
    if (f.includes("node_modules") || f.includes(".test.") || f.includes(".spec.")) {
      throw new Error(`Forbidden file found in package tarball: ${f}`);
    }
  }
}

/**
 * Qualify the actual native-saved artifact in the existing or parameterized consumer case.
 * Backward compatible: accepts optional metadata, packed API/CLI, and options.
 * @param {string} savedSpecificationPath
 * @param {string} verifiedThemeDigest
 * @param {{
 *   metadata?: any,
 *   packageMetadata?: any,
 *   metadataPath?: string,
 *   template?: string,
 *   tfslBin?: string,
 *   packedTfslPath?: string,
 *   workDir?: string,
 *   scenario?: string,
 *   demoOverlayDir?: string,
 * }} [options]
 */
export async function runSavedThemeConsumerSmoke(savedSpecificationPath, verifiedThemeDigest, options = {}) {
  const scratchDir = options.workDir ? resolve(options.workDir) : await mkdtemp(join(tmpdir(), "tfsl-adopted-consumer-"));
  await mkdir(scratchDir, { recursive: true });
  let tfslBin = options.tfslBin || TFSL_BIN;
  if (options.packedTfslPath) {
    const toolDir = join(scratchDir, "packed-tool");
    await mkdir(toolDir);
    await writeFile(join(toolDir, "package.json"), '{"private":true,"type":"module"}\n');
    execFileSync("npm", ["install", "--ignore-scripts", "--no-save", "--package-lock=false", resolve(options.packedTfslPath)], { cwd: toolDir, stdio: "pipe" });
    tfslBin = join(toolDir, "node_modules/@knowledge-forge-ai/theme-forge-stellar-loom/bin/tfsl.js");
  }
  const apiPath = resolve(dirname(await realpath(tfslBin)), "../dist/index.js");
  const { compileTheme, validateThemeSpecification } = await import(pathToFileURL(apiPath).href);
  const specification = validateThemeSpecification(JSON.parse(await readFile(savedSpecificationPath, "utf8")));
  const compiled = compileTheme(specification);
  if (`sha256:${compiled.descriptor.inputDigest}` !== verifiedThemeDigest) {
    throw new Error("Saved specification identity differs from locally verified candidate");
  }

  // Resolve metadata: object, string path, or default cyan
  let pkgMeta = { name: "starlight-theme-stellar-cyan", version: "0.1.0" };
  if (typeof options.metadata === "object" && options.metadata !== null) {
    pkgMeta = { ...options.metadata };
  } else if (typeof options.metadata === "string") {
    pkgMeta = JSON.parse(await readFile(options.metadata, "utf8"));
  } else if (typeof options.packageMetadata === "object" && options.packageMetadata !== null) {
    pkgMeta = { ...options.packageMetadata };
  } else if (typeof options.metadataPath === "string") {
    pkgMeta = JSON.parse(await readFile(options.metadataPath, "utf8"));
  }
  if (options.template && !pkgMeta.template) {
    pkgMeta.template = options.template;
  }

  let browser;
  let server;
  try {
    const metadata = join(scratchDir, "package-metadata.json");
    await writeFile(metadata, JSON.stringify(pkgMeta, null, 2), "utf8");
    const generated = join(scratchDir, "generated");
    const genArgs = [tfslBin, "generate", resolve(savedSpecificationPath), "--package", metadata, "--out", generated, "--json"];
    if (pkgMeta.template) {
      genArgs.push("--template", pkgMeta.template);
    }
    execFileSync(process.execPath, genArgs);
    const generatedCss = await readFile(join(generated, "styles/theme.css"), "utf8");
    if (sha256(generatedCss) !== compiled.descriptor.outputDigest) throw new Error("Generated CSS differs from verified compilation");
    const packed = JSON.parse(execFileSync("npm", ["pack", "--json"], { cwd: generated, encoding: "utf8" }));
    const consumer = join(scratchDir, "consumer");
    await cp(CONSUMER_FIXTURE_DIR, consumer, {
      recursive: true,
      filter: (source) => !["node_modules", "dist", ".astro"].includes(basename(source)),
    });
    if (options.demoOverlayDir && existsSync(options.demoOverlayDir)) {
      await cp(options.demoOverlayDir, consumer, {
        recursive: true,
        filter: (source) => !["node_modules", "package-lock.json", ".git", ".astro", "dist"].includes(basename(source)),
      });
    }
    execFileSync("npm", ["ci", "--ignore-scripts"], { cwd: consumer, stdio: "pipe" });
    execFileSync("npm", ["install", "--ignore-scripts", "--no-save", "--package-lock=false", join(generated, packed[0].filename)], { cwd: consumer, stdio: "pipe" });
    const output = join(consumer, "dist");
    const scenario = options.scenario || (pkgMeta.name === "starlight-theme-stellar-cyan" ? "cyan" : "nova");
    execFileSync("npm", ["exec", "--", "astro", "build"], {
      cwd: consumer,
      stdio: "pipe",
      env: {
        ...process.env,
        CONSUMER_SCENARIO: scenario,
        THEME_PACKAGE_NAME: pkgMeta.name,
        ASTRO_OUT_DIR: output,
      },
    });
    server = await startStaticServer(output);
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.port}/`);
    const measurements = {};
    for (const mode of ["dark", "light"]) {
      const observed = await page.evaluate((themeMode) => {
        document.documentElement.dataset.theme = themeMode;
        return {
          accent: getComputedStyle(document.documentElement).getPropertyValue("--sl-color-accent").trim(),
          headingCount: document.querySelectorAll("h1#_top").length,
          bodyBackground: getComputedStyle(document.body).backgroundColor,
          templateFrameCount: document.querySelectorAll(".tfsl-page-title-frame").length,
        };
      }, mode);
      const expected = specification.colors[mode].accent.base;
      const rgb = expected.slice(1).match(/../g).map((pair) => parseInt(pair, 16)).join(", ");
      if (!colorMatches(observed.accent, expected, rgb) || observed.headingCount !== 1) {
        throw new Error(`Saved candidate consumer style mismatch in ${mode} mode`);
      }
      if (pkgMeta.template === "page-title-frame" && observed.templateFrameCount !== 1) {
        throw new Error(`Saved candidate template frame missing in ${mode} mode`);
      }
      measurements[mode] = observed;
    }
    return {
      status: "pass",
      themeDigest: verifiedThemeDigest,
      cssDigest: compiled.descriptor.outputDigest,
      measurements,
      packageName: pkgMeta.name,
      template: pkgMeta.template || null,
      packageSha256: sha256(await readFile(join(generated, packed[0].filename))),
      packageMembers: packed[0].files.map(file => file.path),
    };
  } finally {
    if (browser) await browser.close();
    if (server) await server.close();
    if (!options.workDir) {
      await rm(scratchDir, { recursive: true, force: true });
    }
  }
}

/**
 * Terminal Nova installed consumer qualification helper.
 * Generates Forge Console & Nova Observatory candidate packages using installed packed TFSL,
 * verifies determinism and package members, installs candidate tarballs into scratch consumer fixture copies,
 * builds Astro documentation under multiple scenarios (default/template, override, disconnected),
 * qualifies rendered output in Playwright Chromium across wide/mobile viewports, dark/light modes,
 * contrast ratios, focus, reduced-motion, and nav/brand styling,
 * and outputs sanitized JSON render receipts and screenshots.
 *
 * @param {{
 *   novaRoot?: string,
 *   workDir?: string,
 *   packedTfslPath?: string,
 *   tfslBin?: string,
 *   demoOverlayDir?: string,
 * }} [options]
 */
export async function runTerminalNovaConsumerSmoke(options = {}) {
  console.log("=== TFSB54 Terminal Nova Installed Consumer Qualification ===");

  const novaRoot = resolve(options.novaRoot || join(REPO_ROOT, "themes/terminal-nova"));
  const workDir = options.workDir ? resolve(options.workDir) : await mkdtemp(join(tmpdir(), "tfsl-nova-work-"));
  await mkdir(workDir, { recursive: true });
  const screenshotsDir = join(workDir, "screenshots");
  await mkdir(screenshotsDir, { recursive: true });

  console.log(`1. Nova root: ${novaRoot}`);
  console.log(`2. Work directory: ${workDir}`);

  // Candidate specifications and metadata paths
  const candidatesDir = join(novaRoot, "candidates");
  const forgeSpecPath = join(candidatesDir, "forge-console.theme.json");
  const forgeMetaPath = join(candidatesDir, "forge-console.package.json");
  const obsSpecPath = join(candidatesDir, "nova-observatory.theme.json");
  const obsMetaPath = join(candidatesDir, "nova-observatory.package.json");

  for (const p of [forgeSpecPath, forgeMetaPath, obsSpecPath, obsMetaPath]) {
    if (!existsSync(p)) {
      throw new Error(`Required candidate file not found: ${p}`);
    }
  }

  const forgeSpec = JSON.parse(await readFile(forgeSpecPath, "utf8"));
  const forgeMeta = JSON.parse(await readFile(forgeMetaPath, "utf8"));
  const obsSpec = JSON.parse(await readFile(obsSpecPath, "utf8"));
  const obsMeta = JSON.parse(await readFile(obsMetaPath, "utf8"));

  const forgeTemplate = forgeMeta.template;
  if (forgeTemplate !== "page-title-frame" || obsMeta.template !== undefined) throw new Error("Unexpected candidate template selection");
  console.log(`3. Loaded candidate specs: '${forgeSpec.name}' (${forgeMeta.name}, template: ${forgeTemplate}) and '${obsSpec.name}' (${obsMeta.name}, CSS-only)`);

  // Explicit tool inputs fail rather than silently falling back to checkout packing.
  for (const supplied of [options.tfslBin, options.packedTfslPath]) {
    if (supplied && !existsSync(supplied)) throw new Error("Explicit TFSL tool input does not exist");
  }
  let tfslBin;
  let packedTfslTarball;
  if (options.tfslBin && existsSync(options.tfslBin)) {
    tfslBin = resolve(options.tfslBin);
    console.log(`4. Using provided TFSL CLI binary: ${tfslBin}`);
  } else {
    if (options.packedTfslPath && existsSync(options.packedTfslPath)) {
      packedTfslTarball = resolve(options.packedTfslPath);
      console.log(`4. Using provided packed TFSL tarball: ${packedTfslTarball}`);
    } else {
      console.log("4. Packing TFSL package from source checkout...");
      const packRaw = execFileSync("npm", ["pack", "--json", "--pack-destination", workDir], { cwd: LOOM_ROOT, encoding: "utf8" });
      const packInfo = JSON.parse(packRaw)[0];
      packedTfslTarball = join(workDir, packInfo.filename);
      console.log(`   Packed ${packInfo.filename} (${packInfo.size} bytes) into ${workDir}`);
    }

    // Install packed tarball into scratch tool directory
    const toolDir = join(workDir, "tfsl-installed-tool");
    await mkdir(toolDir, { recursive: true });
    await writeFile(join(toolDir, "package.json"), JSON.stringify({ name: "tfsl-tool-runner", private: true, type: "module" }));
    execFileSync("npm", ["install", "--ignore-scripts", "--no-save", "--package-lock=false", packedTfslTarball], {
      cwd: toolDir,
      stdio: "pipe",
    });
    tfslBin = join(toolDir, "node_modules/.bin/tfsl");
    console.log(`   Installed packed TFSL CLI: ${tfslBin}`);

    // Verify installed packed API
    const installedApi = await import(pathToFileURL(join(toolDir, "node_modules/@knowledge-forge-ai/theme-forge-stellar-loom/dist/index.js")).href);
    if (typeof installedApi.compileTheme !== "function" || typeof installedApi.validateThemeSpecification !== "function") {
      throw new Error("Installed packed TFSL API is missing required exports");
    }
    const validatedForge = installedApi.validateThemeSpecification(forgeSpec);
    installedApi.compileTheme(validatedForge);
    const validatedObs = installedApi.validateThemeSpecification(obsSpec);
    installedApi.compileTheme(validatedObs);
    console.log(`   ✓ Packed TFSL API verified (compiled '${validatedForge.name}' and '${validatedObs.name}')`);
  }

  // Generate packages and verify determinism
  console.log("5. Generating candidate theme packages and verifying determinism...");
  const forgeOut1 = join(workDir, "pkg-forge-console-1");
  const forgeOut2 = join(workDir, "pkg-forge-console-2");
  const obsOut1 = join(workDir, "pkg-nova-observatory-1");
  const obsOut2 = join(workDir, "pkg-nova-observatory-2");

  // Forge generation run 1
  execFileSync(process.execPath, [
    tfslBin,
    "generate",
    forgeSpecPath,
    "--package",
    forgeMetaPath,
    "--out",
    forgeOut1,
    "--template",
    forgeTemplate,
    "--json",
  ]);

  // Forge generation run 2 (independent process)
  execFileSync(process.execPath, [
    tfslBin,
    "generate",
    forgeSpecPath,
    "--package",
    forgeMetaPath,
    "--out",
    forgeOut2,
    "--template",
    forgeTemplate,
    "--json",
  ]);

  // Observatory generation run 1
  execFileSync(process.execPath, [
    tfslBin,
    "generate",
    obsSpecPath,
    "--package",
    obsMetaPath,
    "--out",
    obsOut1,
    "--json",
  ]);

  // Observatory generation run 2 (independent process)
  execFileSync(process.execPath, [
    tfslBin,
    "generate",
    obsSpecPath,
    "--package",
    obsMetaPath,
    "--out",
    obsOut2,
    "--json",
  ]);

  await verifyDeterminism(forgeOut1, forgeOut2);
  console.log("   ✓ Forge Console determinism verified (100% bit-for-bit identical across processes).");
  await verifyDeterminism(obsOut1, obsOut2);
  console.log("   ✓ Nova Observatory determinism verified (100% bit-for-bit identical across processes).");

  // Pack candidate packages via npm pack & verify members
  console.log("6. Packing candidate packages via npm pack and verifying package inventory...");
  const forgePackRaw = execFileSync("npm", ["pack", "--json"], { cwd: forgeOut1, encoding: "utf8" });
  const forgePackJson = JSON.parse(forgePackRaw)[0];
  const forgeTarballPath = join(forgeOut1, forgePackJson.filename);

  const obsPackRaw = execFileSync("npm", ["pack", "--json"], { cwd: obsOut1, encoding: "utf8" });
  const obsPackJson = JSON.parse(obsPackRaw)[0];
  const obsTarballPath = join(obsOut1, obsPackJson.filename);

  verifyPackageMembers(forgePackJson, true);
  console.log(`   ✓ ${forgePackJson.filename} members verified (template component present, no hygiene violations).`);
  verifyPackageMembers(obsPackJson, false);
  console.log(`   ✓ ${obsPackJson.filename} members verified (CSS-only, no component override, no hygiene violations).`);

  const identities = {};
  for (const [id, firstDir, secondDir, packed] of [
    ["forge-console", forgeOut1, forgeOut2, forgePackJson],
    ["nova-observatory", obsOut1, obsOut2, obsPackJson],
  ]) {
    const second = JSON.parse(execFileSync("npm", ["pack", "--json"], { cwd: secondDir, encoding: "utf8" }))[0];
    if (JSON.stringify(packed.files) !== JSON.stringify(second.files)) throw new Error(`${id}: package members differ`);
    const digest = sha256(await readFile(join(firstDir, packed.filename)));
    if (digest !== sha256(await readFile(join(secondDir, second.filename)))) throw new Error(`${id}: controlled npm pack bytes differ`);
    const provenance = JSON.parse(await readFile(join(firstDir, "provenance.json"), "utf8"));
    identities[id] = { packageSha256: digest, themeDigest: provenance.themeInputDigest, cssDigest: provenance.cssOutputDigest, packageMembersEqual: true, packBytesEqual: true };
  }

  // Build separate scratch copies of pinned consumer fixture and install tarballs
  console.log("7. Preparing separate scratch consumer fixture copies...");
  const consumerForge = join(workDir, "consumer-forge");
  const consumerObs = join(workDir, "consumer-observatory");

  const copyFixture = async (target) => {
    await cp(CONSUMER_FIXTURE_DIR, target, {
      recursive: true,
      filter: (source) => !["node_modules", "dist", ".astro"].includes(basename(source)),
    });
    const demoDir = options.demoOverlayDir || join(novaRoot, "demo");
    if (existsSync(demoDir)) {
      console.log(`   Copying demo overlay from ${demoDir} into ${target}...`);
      await cp(demoDir, target, {
        recursive: true,
        filter: (source) => !["node_modules", "package-lock.json", ".git", ".astro", "dist"].includes(basename(source)),
      });
    }
  };

  await copyFixture(consumerForge);
  await copyFixture(consumerObs);

  console.log("8. Installing dependencies via npm ci and installing candidate tarballs...");
  // Forge consumer
  execFileSync("npm", ["ci", "--ignore-scripts"], { cwd: consumerForge, stdio: "pipe" });
  execFileSync("npm", ["install", "--ignore-scripts", "--no-save", "--package-lock=false", forgeTarballPath], {
    cwd: consumerForge,
    stdio: "pipe",
  });
  console.log(`   ✓ Installed ${forgePackJson.filename} into ${consumerForge}`);

  // Observatory consumer
  execFileSync("npm", ["ci", "--ignore-scripts"], { cwd: consumerObs, stdio: "pipe" });
  execFileSync("npm", ["install", "--ignore-scripts", "--no-save", "--package-lock=false", obsTarballPath], {
    cwd: consumerObs,
    stdio: "pipe",
  });
  console.log(`   ✓ Installed ${obsPackJson.filename} into ${consumerObs}`);

  // Build Astro documentation
  console.log("9. Building Astro documentation for all candidate scenarios...");
  const distForgeDefault = join(consumerForge, "dist/default");
  const distForgeOverride = join(consumerForge, "dist/override");
  const distForgeDisconnected = join(consumerForge, "dist/disconnected");
  const distObsDefault = join(consumerObs, "dist/default");

  const buildDurations = {};

  const buildAstro = (cwd, scenario, packageName, outDir, key) => {
    const t0 = performance.now();
    const res = spawnSync("npm", ["exec", "--", "astro", "build"], {
      cwd,
      env: {
        ...process.env,
        CONSUMER_SCENARIO: scenario,
        THEME_PACKAGE_NAME: packageName,
        ASTRO_OUT_DIR: outDir,
      },
      encoding: "utf8",
    });
    const duration = Math.round(performance.now() - t0);
    buildDurations[key] = duration;
    if (res.status !== 0) {
      console.error(res.stderr);
      throw new Error(`Astro build failed for '${key}' (scenario: ${scenario}) with exit code ${res.status}`);
    }
    if (!existsSync(join(outDir, "index.html"))) {
      throw new Error(`Astro build succeeded for '${key}' but index.html is missing`);
    }
    console.log(`   ✓ Built '${key}' in ${duration}ms`);
  };

  buildAstro(consumerForge, "nova", forgeMeta.name, distForgeDefault, "forgeDefault");
  buildAstro(consumerForge, "nova-override", forgeMeta.name, distForgeOverride, "forgeOverride");
  buildAstro(consumerForge, "nova-disconnected", forgeMeta.name, distForgeDisconnected, "forgeDisconnected");
  buildAstro(consumerObs, "nova", obsMeta.name, distObsDefault, "obsDefault");
  buildAstro(consumerObs, "nova-override", obsMeta.name, join(consumerObs, "dist/override"), "obsOverride");
  buildAstro(consumerObs, "nova-disconnected", obsMeta.name, join(consumerObs, "dist/disconnected"), "obsDisconnected");

  // Browser qualification with Playwright
  console.log("10. Launching Playwright Chromium for browser qualification...");
  const playwrightModule = await import("@playwright/test");
  const chromium = playwrightModule.chromium || playwrightModule.default?.chromium;
  const browser = await chromium.launch({ headless: true });

  const servers = [];
  const screenshots = [];
  let forgeDefaultMeasurements;
  let obsDefaultMeasurements;
  let forgeDisconnectedAccent;

  try {
    const srvForgeDefault = await startStaticServer(distForgeDefault);
    servers.push(srvForgeDefault);
    const srvForgeOverride = await startStaticServer(distForgeOverride);
    servers.push(srvForgeOverride);
    const srvForgeDisconnected = await startStaticServer(distForgeDisconnected);
    servers.push(srvForgeDisconnected);
    const srvObsDefault = await startStaticServer(distObsDefault);
    servers.push(srvObsDefault);

    const page = await browser.newPage();

    // Listen for runtime externals
    const externalRequests = [];
    page.on("request", (req) => {
      try {
        const u = new URL(req.url());
        if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
          externalRequests.push(req.url());
        }
      } catch {}
    });

    // Helper to extract styles and custom properties in given mode
    const measurePageStyles = async (mode) => {
      await page.evaluate((m) => {
        document.documentElement.dataset.theme = m;
      }, mode);
      return page.evaluate(() => {
        const docEl = window.getComputedStyle(document.documentElement);
        const body = window.getComputedStyle(document.body);
        const link = document.querySelector("a[href*='starlight.astro.build']") || document.querySelector("a");
        const linkStyle = link ? window.getComputedStyle(link) : null;
        const code = document.querySelector(":not(pre) > code") || document.querySelector("code");
        const codeStyle = code ? window.getComputedStyle(code) : null;
        const h1 = document.querySelector("h1#_top") || document.querySelector("h1");
        const h1Style = h1 ? window.getComputedStyle(h1) : null;

        return {
          slAccent: docEl.getPropertyValue("--sl-color-accent").trim(),
          slBg: docEl.getPropertyValue("--sl-color-bg").trim(),
          slText: docEl.getPropertyValue("--sl-color-text").trim(),
          slBgNav: docEl.getPropertyValue("--sl-color-bg-nav").trim(),
          slBgInlineCode: docEl.getPropertyValue("--sl-color-bg-inline-code").trim(),
          slContentWidth: docEl.getPropertyValue("--sl-content-width").trim(),
          slSidebarWidth: docEl.getPropertyValue("--sl-sidebar-width").trim(),
          slLineHeight: docEl.getPropertyValue("--sl-line-height").trim(),
          bodyBg: body.backgroundColor,
          bodyColor: body.color,
          bodyFont: body.fontFamily,
          linkColor: linkStyle ? linkStyle.color : null,
          codeBg: codeStyle ? codeStyle.backgroundColor : null,
          codeColor: codeStyle ? codeStyle.color : null,
          codeFont: codeStyle ? codeStyle.fontFamily : null,
          h1Color: h1Style ? h1Style.color : null,
          h1FontSize: h1Style ? h1Style.fontSize : null,
          h1FontWeight: h1Style ? h1Style.fontWeight : null,
        };
      });
    };

    // Helper to capture a screenshot
    const captureScreenshot = async (name, pkg, mode, viewport) => {
      const filename = `${name}.png`;
      const fullPath = join(screenshotsDir, filename);
      await page.screenshot({ path: fullPath, fullPage: false });
      screenshots.push({ name, file: `screenshots/${filename}`, fullPath, package: pkg, mode, viewport });
    };

    // -------------------------------------------------------------
    // Scenario 1: Forge Console (Default / Template)
    // -------------------------------------------------------------
    console.log("   Qualifying Scenario 1: Forge Console Default & Template...");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`http://127.0.0.1:${srvForgeDefault.port}/`);

    // Dark mode
    const forgeDark = await measurePageStyles("dark");
    if (!colorMatches(forgeDark.slAccent, forgeSpec.colors.dark.accent.base, hexToRgbTuple(forgeSpec.colors.dark.accent.base))) {
      throw new Error(`Forge Console dark accent mismatch: expected ${forgeSpec.colors.dark.accent.base}, got ${forgeDark.slAccent}`);
    }
    if (!colorMatches(forgeDark.bodyBg, forgeSpec.colors.dark.neutrals.bg, hexToRgbTuple(forgeSpec.colors.dark.neutrals.bg))) {
      throw new Error(`Forge Console dark bodyBg mismatch: expected ${forgeSpec.colors.dark.neutrals.bg}, got ${forgeDark.bodyBg}`);
    }
    if (!colorMatches(forgeDark.bodyColor, forgeSpec.colors.dark.neutrals.text, hexToRgbTuple(forgeSpec.colors.dark.neutrals.text))) {
      throw new Error(`Forge Console dark bodyColor mismatch: expected ${forgeSpec.colors.dark.neutrals.text}, got ${forgeDark.bodyColor}`);
    }

    // Typography & layout assertions for Forge Console:
    // "Main expected candidate Forge: sans 44rem 17rem 1.65 title-frame"
    if (!forgeDark.bodyFont.toLowerCase().includes("sans")) {
      throw new Error(`Expected sans font stack for Forge Console, got: ${forgeDark.bodyFont}`);
    }
    if (forgeSpec.layout?.contentWidth && forgeDark.slContentWidth !== forgeSpec.layout.contentWidth) {
      throw new Error(`Forge Console content-width mismatch: expected ${forgeSpec.layout.contentWidth}, got ${forgeDark.slContentWidth}`);
    }
    if (forgeSpec.layout?.sidebarWidth && forgeDark.slSidebarWidth !== forgeSpec.layout.sidebarWidth) {
      throw new Error(`Forge Console sidebar-width mismatch: expected ${forgeSpec.layout.sidebarWidth}, got ${forgeDark.slSidebarWidth}`);
    }
    if (forgeSpec.typography?.lineHeight && Math.abs(parseFloat(forgeDark.slLineHeight) - forgeSpec.typography.lineHeight) > 0.05) {
      throw new Error(`Forge Console line-height mismatch: expected ${forgeSpec.typography.lineHeight}, got ${forgeDark.slLineHeight}`);
    }

    // Contrast check dark
    const forgeDarkContrast = calculateContrastRatio(forgeDark.bodyColor, forgeDark.bodyBg);
    if (forgeDarkContrast !== null && forgeDarkContrast < 4.5) {
      throw new Error(`Forge Console dark mode body contrast ratio ${forgeDarkContrast} is below WCAG AA 4.5:1`);
    }

    // Template verification
    const forgeFrame = page.locator(".tfsl-page-title-frame[data-tfsl-template='page-title-frame']");
    if ((await forgeFrame.count()) !== 1) {
      throw new Error("Missing .tfsl-page-title-frame wrapper in Forge Console template output");
    }
    const forgeH1 = forgeFrame.locator("h1#_top");
    if ((await forgeH1.count()) !== 1) {
      throw new Error("Expected wrapper to contain single h1#_top element");
    }
    const forgeBorderLeft = await forgeFrame.evaluate((el) => window.getComputedStyle(el).borderLeftWidth);
    if (forgeBorderLeft !== "4px") {
      throw new Error(`Expected 4px borderLeftWidth on Forge Console title frame, got: ${forgeBorderLeft}`);
    }

    // Capture desktop dark screenshot
    await captureScreenshot("forge-console-dark-desktop", forgeMeta.name, "dark", "1280x800");

    // Light mode
    const forgeLight = await measurePageStyles("light");
    if (!colorMatches(forgeLight.slAccent, forgeSpec.colors.light.accent.base, hexToRgbTuple(forgeSpec.colors.light.accent.base))) {
      throw new Error(`Forge Console light accent mismatch: expected ${forgeSpec.colors.light.accent.base}, got ${forgeLight.slAccent}`);
    }
    if (!colorMatches(forgeLight.bodyBg, forgeSpec.colors.light.neutrals.bg, hexToRgbTuple(forgeSpec.colors.light.neutrals.bg))) {
      throw new Error(`Forge Console light bodyBg mismatch: expected ${forgeSpec.colors.light.neutrals.bg}, got ${forgeLight.bodyBg}`);
    }
    if (!colorMatches(forgeLight.bodyColor, forgeSpec.colors.light.neutrals.text, hexToRgbTuple(forgeSpec.colors.light.neutrals.text))) {
      throw new Error(`Forge Console light bodyColor mismatch: expected ${forgeSpec.colors.light.neutrals.text}, got ${forgeLight.bodyColor}`);
    }

    // Contrast check light
    const forgeLightContrast = calculateContrastRatio(forgeLight.bodyColor, forgeLight.bodyBg);
    if (forgeLightContrast !== null && forgeLightContrast < 4.5) {
      throw new Error(`Forge Console light mode body contrast ratio ${forgeLightContrast} is below WCAG AA 4.5:1`);
    }

    // Capture desktop light screenshot
    await captureScreenshot("forge-console-light-desktop", forgeMeta.name, "light", "1280x800");

    // Focus indicator test
    const firstLink = page.locator("a").first();
    if ((await firstLink.count()) > 0) {
      await firstLink.focus();
    }

    // Reduced motion test
    await page.emulateMedia({ reducedMotion: "reduce" });
    const prefersReducedMotion = await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (!prefersReducedMotion) {
      throw new Error("Reduced motion media query was not matched when emulated");
    }
    await page.emulateMedia({ reducedMotion: "no-preference" });

    // Nav & Brand header check
    const siteTitle = page.locator(".site-title, a.site-title, header a").first();
    if ((await siteTitle.count()) < 1) {
      throw new Error("Missing site title brand link in header");
    }

    // Responsive viewports
    const desktopScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    if (desktopScrollWidth > 1280) {
      throw new Error(`Desktop horizontal overflow: ${desktopScrollWidth} > 1280`);
    }

    // Mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    const mobileScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    if (mobileScrollWidth > 375) {
      throw new Error(`Mobile horizontal overflow: ${mobileScrollWidth} > 375`);
    }
    await captureScreenshot("forge-console-dark-mobile", forgeMeta.name, "dark", "375x667");
    await page.setViewportSize({ width: 1280, height: 800 });

    forgeDefaultMeasurements = {
      dark: forgeDark,
      light: forgeLight,
      contrastRatios: {
        dark: forgeDarkContrast,
        light: forgeLightContrast,
      },
      wideScrollWidth: desktopScrollWidth,
      mobileScrollWidth: mobileScrollWidth,
      templateBorderLeftWidth: forgeBorderLeft,
    };
    console.log("   ✓ Forge Console styles, body contrast, layout, and template verified; interaction checks follow.");

    // -------------------------------------------------------------
    // Scenario 2: Forge Console (Consumer Component Override)
    // -------------------------------------------------------------
    console.log("   Qualifying Scenario 2: Forge Console Consumer Component Override...");
    await page.goto(`http://127.0.0.1:${srvForgeOverride.port}/`);
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });

    const overrideEl = page.locator("[data-test-override='consumer-owned']");
    if ((await overrideEl.count()) !== 1) {
      throw new Error("Consumer-owned component override was not rendered in override scenario");
    }
    const overrideHairline = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--sl-color-hairline").trim());
    if (overrideHairline !== "#e11d48") throw new Error("Consumer custom CSS lost precedence");
    const overrideFrameCount = await page.locator(".tfsl-page-title-frame").count();
    if (overrideFrameCount !== 0) {
      throw new Error("Plugin template frame incorrectly superseded consumer component override");
    }
    await captureScreenshot("forge-console-override-dark", forgeMeta.name, "dark", "1280x800");
    console.log("   ✓ Consumer component override preserved without conflict.");

    // -------------------------------------------------------------
    // Scenario 3: Forge Console (Disconnected Negative Control)
    // -------------------------------------------------------------
    console.log("   Qualifying Scenario 3: Disconnected Negative Control...");
    await page.goto(`http://127.0.0.1:${srvForgeDisconnected.port}/`);
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });

    forgeDisconnectedAccent = await page.evaluate(() => {
      return window.getComputedStyle(document.documentElement).getPropertyValue("--sl-color-accent").trim();
    });
    if (colorMatches(forgeDisconnectedAccent, forgeSpec.colors.dark.accent.base, hexToRgbTuple(forgeSpec.colors.dark.accent.base))) {
      throw new Error(`Disconnected site unexpectedly has Forge Console theme accent: ${forgeDisconnectedAccent}`);
    }
    const disconnectedFrameCount = await page.locator(".tfsl-page-title-frame").count();
    if (disconnectedFrameCount !== 0) {
      throw new Error("Disconnected site unexpectedly contains .tfsl-page-title-frame");
    }
    await captureScreenshot("forge-console-disconnected-dark", forgeMeta.name, "dark", "1280x800");
    console.log(`   ✓ Disconnected negative control verified (baseline accent: ${forgeDisconnectedAccent}).`);

    // -------------------------------------------------------------
    // Scenario 4: Nova Observatory (CSS-only, no template)
    // -------------------------------------------------------------
    console.log("   Qualifying Scenario 4: Nova Observatory (CSS-only)...");
    await page.goto(`http://127.0.0.1:${srvObsDefault.port}/`);

    // Dark mode
    const obsDark = await measurePageStyles("dark");
    if (!colorMatches(obsDark.slAccent, obsSpec.colors.dark.accent.base, hexToRgbTuple(obsSpec.colors.dark.accent.base))) {
      throw new Error(`Nova Observatory dark accent mismatch: expected ${obsSpec.colors.dark.accent.base}, got ${obsDark.slAccent}`);
    }
    if (!colorMatches(obsDark.bodyBg, obsSpec.colors.dark.neutrals.bg, hexToRgbTuple(obsSpec.colors.dark.neutrals.bg))) {
      throw new Error(`Nova Observatory dark bodyBg mismatch: expected ${obsSpec.colors.dark.neutrals.bg}, got ${obsDark.bodyBg}`);
    }
    if (!colorMatches(obsDark.bodyColor, obsSpec.colors.dark.neutrals.text, hexToRgbTuple(obsSpec.colors.dark.neutrals.text))) {
      throw new Error(`Nova Observatory dark bodyColor mismatch: expected ${obsSpec.colors.dark.neutrals.text}, got ${obsDark.bodyColor}`);
    }

    // Typography & layout assertions for Observatory:
    // "Observatory serif 48rem 19rem 1.8 no template."
    if (!obsDark.bodyFont.toLowerCase().includes("serif")) {
      throw new Error(`Expected serif font stack for Nova Observatory, got: ${obsDark.bodyFont}`);
    }
    if (obsSpec.layout?.contentWidth && obsDark.slContentWidth !== obsSpec.layout.contentWidth) {
      throw new Error(`Nova Observatory content-width mismatch: expected ${obsSpec.layout.contentWidth}, got ${obsDark.slContentWidth}`);
    }
    if (obsSpec.layout?.sidebarWidth && obsDark.slSidebarWidth !== obsSpec.layout.sidebarWidth) {
      throw new Error(`Nova Observatory sidebar-width mismatch: expected ${obsSpec.layout.sidebarWidth}, got ${obsDark.slSidebarWidth}`);
    }
    if (obsSpec.typography?.lineHeight && Math.abs(parseFloat(obsDark.slLineHeight) - obsSpec.typography.lineHeight) > 0.05) {
      throw new Error(`Nova Observatory line-height mismatch: expected ${obsSpec.typography.lineHeight}, got ${obsDark.slLineHeight}`);
    }

    // Contrast check dark
    const obsDarkContrast = calculateContrastRatio(obsDark.bodyColor, obsDark.bodyBg);
    if (obsDarkContrast !== null && obsDarkContrast < 4.5) {
      throw new Error(`Nova Observatory dark mode body contrast ratio ${obsDarkContrast} is below WCAG AA 4.5:1`);
    }

    // Verify NO template frame
    const obsFrameCount = await page.locator(".tfsl-page-title-frame").count();
    if (obsFrameCount !== 0) {
      throw new Error(`Expected 0 .tfsl-page-title-frame elements in CSS-only Observatory package, found ${obsFrameCount}`);
    }
    const obsH1Count = await page.locator("h1#_top").count();
    if (obsH1Count !== 1) {
      throw new Error(`Expected 1 h1#_top heading in Observatory docs, found ${obsH1Count}`);
    }

    await captureScreenshot("nova-observatory-dark-desktop", obsMeta.name, "dark", "1280x800");

    // Light mode
    const obsLight = await measurePageStyles("light");
    if (!colorMatches(obsLight.slAccent, obsSpec.colors.light.accent.base, hexToRgbTuple(obsSpec.colors.light.accent.base))) {
      throw new Error(`Nova Observatory light accent mismatch: expected ${obsSpec.colors.light.accent.base}, got ${obsLight.slAccent}`);
    }
    if (!colorMatches(obsLight.bodyBg, obsSpec.colors.light.neutrals.bg, hexToRgbTuple(obsSpec.colors.light.neutrals.bg))) {
      throw new Error(`Nova Observatory light bodyBg mismatch: expected ${obsSpec.colors.light.neutrals.bg}, got ${obsLight.bodyBg}`);
    }
    if (!colorMatches(obsLight.bodyColor, obsSpec.colors.light.neutrals.text, hexToRgbTuple(obsSpec.colors.light.neutrals.text))) {
      throw new Error(`Nova Observatory light bodyColor mismatch: expected ${obsSpec.colors.light.neutrals.text}, got ${obsLight.bodyColor}`);
    }
    const obsLightContrast = calculateContrastRatio(obsLight.bodyColor, obsLight.bodyBg);
    if (obsLightContrast !== null && obsLightContrast < 4.5) {
      throw new Error(`Nova Observatory light mode body contrast ratio ${obsLightContrast} is below WCAG AA 4.5:1`);
    }
    await captureScreenshot("nova-observatory-light-desktop", obsMeta.name, "light", "1280x800");

    obsDefaultMeasurements = {
      dark: obsDark,
      light: obsLight,
      contrastRatios: {
        dark: obsDarkContrast,
        light: obsLightContrast,
      },
    };
    console.log("   ✓ Nova Observatory styles, typography, layout, contrast, and CSS-only isolation verified.");

    // Verify 0 runtime externals
    if (externalRequests.length > 0) {
      throw new Error(`Runtime external network requests forbidden: ${externalRequests.join(", ")}`);
    }
    console.log("   ✓ Zero runtime external requests confirmed across all scenarios.");

  } finally {
    if (browser) await browser.close().catch(() => {});
    await Promise.all(servers.map((s) => s.close().catch(() => {})));
  }

  // Write sanitized JSON render receipt
  console.log("11. Writing sanitized JSON render receipt...");
  const receipt = {
    timestamp: new Date().toISOString(),
    status: "pass",
    novaRoot: relative(REPO_ROOT, novaRoot),
    compiler: {
      tarball: basename(packedTfslTarball || "tfsl-packed.tgz"),
      sha256: packedTfslTarball ? sha256(await readFile(packedTfslTarball)) : null,
    },
    identities,
    candidates: {
      forgeConsole: {
        specPath: relative(REPO_ROOT, forgeSpecPath),
        name: forgeMeta.name,
        version: forgeMeta.version,
        template: forgeTemplate,
        tarball: forgePackJson.filename,
        tarballSize: forgePackJson.size,
        entryFiles: forgePackJson.files.map((f) => f.path),
        determinism: "verified_bit_identical",
      },
      novaObservatory: {
        specPath: relative(REPO_ROOT, obsSpecPath),
        name: obsMeta.name,
        version: obsMeta.version,
        template: null,
        tarball: obsPackJson.filename,
        tarballSize: obsPackJson.size,
        entryFiles: obsPackJson.files.map((f) => f.path),
        determinism: "verified_bit_identical",
      },
    },
    scenarios: {
      forgeConsoleDefault: {
        scenario: "nova",
        packageName: forgeMeta.name,
        buildDurationMs: buildDurations.forgeDefault,
        measurements: forgeDefaultMeasurements,
      },
      forgeConsoleOverride: {
        scenario: "nova-override",
        packageName: forgeMeta.name,
        buildDurationMs: buildDurations.forgeOverride,
        consumerOverridePresent: true,
        templateFramePresent: false,
      },
      forgeConsoleDisconnected: {
        scenario: "nova-disconnected",
        packageName: forgeMeta.name,
        buildDurationMs: buildDurations.forgeDisconnected,
        disconnectedAccent: forgeDisconnectedAccent,
        templateFramePresent: false,
      },
      novaObservatoryDefault: {
        scenario: "nova",
        packageName: obsMeta.name,
        buildDurationMs: buildDurations.obsDefault,
        measurements: obsDefaultMeasurements,
      },
    },
    screenshots: await Promise.all(screenshots.map(async (s) => ({
      name: s.name,
      file: s.file,
      package: s.package,
      mode: s.mode,
      viewport: s.viewport,
      sha256: sha256(await readFile(s.fullPath)),
      identity: identities[s.name.startsWith("nova-observatory") ? "nova-observatory" : "forge-console"],
    }))),
  };

  receipt.interactions = await observeNovaConsumers(workDir, novaRoot);
  const receiptPath = join(workDir, "render-receipt.json");
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2), "utf8");
  console.log(`   ✓ Render receipt saved: ${receiptPath}`);
  console.log(`   ✓ Captured ${screenshots.length} screenshots under ${screenshotsDir}`);
  console.log("=== Terminal Nova Consumer Qualification PASSED Successfully ===");

  return receipt;
}

/** Observe real installed Nova builds; also callable without repeating install/build. */
export async function observeNovaConsumers(workDir, novaRoot, options = {}) {
  const playwright = await import(options.playwrightModule ?? "@playwright/test");
  const { chromium, expect } = playwright.default ?? playwright;
  const browser = await chromium.launch();
  const observations = {};
  const external = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  try {
    for (const [id, consumer] of (options.selectedOnly ? [["forge-console", "consumer-forge"]] : [["forge-console", "consumer-forge"], ["nova-observatory", "consumer-observatory"]])) {
      const spec = JSON.parse(await readFile(join(novaRoot, options.candidateDirectory ?? "candidates", `${id}.theme.json`), "utf8"));
      const server = await startStaticServer(join(workDir, consumer, "dist/default"));
      const page = await browser.newPage();
      page.on("request", (request) => {
        if (new URL(request.url()).hostname !== "127.0.0.1") external.push(request.url());
      });
      const records = [];
      try {
        for (const mode of ["dark", "light"]) {
          for (const width of [1440, 375]) {
            await page.setViewportSize({ width, height: 900 });
            await page.goto(`http://127.0.0.1:${server.port}/`);
            await page.evaluate((m) => { document.documentElement.dataset.theme = m; }, mode);
            const measurements = await page.evaluate(() => {
              const style = (selector) => getComputedStyle(document.querySelector(selector));
              const p = style(".sl-markdown-content > p");
              const inline = style(".sl-markdown-content p code");
              const block = style(".expressive-code pre");
              const link = style(".sl-markdown-content p a");
              const content = document.querySelector(".sl-markdown-content").getBoundingClientRect();
              return {
                bodyBg: getComputedStyle(document.body).backgroundColor,
                bodyText: p.color, link: link.color, inlineText: inline.color,
                inlineBg: inline.backgroundColor, codeFont: block.fontFamily,
                font: p.fontFamily, fontSize: parseFloat(p.fontSize), lineHeight: parseFloat(p.lineHeight),
                contentWidth: content.width, overflow: document.documentElement.scrollWidth > innerWidth,
                h1: document.querySelector("h1#_top")?.textContent.trim(),
              };
            });
            const palette = spec.colors[mode];
            for (const [actual, expected] of [[measurements.bodyBg, palette.neutrals.bg], [measurements.bodyText, palette.neutrals.text], [measurements.link, palette.neutrals.textAccent], [measurements.inlineBg, palette.neutrals.bgInlineCode], [measurements.inlineText, palette.neutrals.text]]) {
              assert(colorMatches(actual, expected, hexToRgbTuple(expected)), `${id} ${mode} computed color mismatch: ${actual} / ${expected}`);
            }
            assert(measurements.h1 === "Terminal Nova" && await page.locator("h1#_top").count() === 1, "Title/anchor changed");
            assert(!measurements.overflow, `${id} ${mode} ${width}: page overflow`);
            assert(measurements.contentWidth <= parseFloat(spec.layout.contentWidth) * 16 + 1, "Reading width exceeds specification");
            assert(measurements.contentWidth >= (width === 375 ? 320 : 680), "Reading column collapsed");
            assert(Math.abs(measurements.lineHeight / measurements.fontSize - spec.typography.lineHeight) < 0.01, "Actual prose line height differs");
            assert(measurements.codeFont.includes("monospace"), "Fenced code lost monospace font");
            assert(measurements.font.includes(id === "forge-console" ? "sans-serif" : "ui-serif"), "Actual prose font differs");

            // Composite actual transparent panel backgrounds before measuring adjacent pairs.
            const pairs = await page.evaluate(() => {
              const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
              const ctx = canvas.getContext("2d");
              const rgba = (color) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; };
              const blend = (fg, bg) => fg.slice(0, 3).map((v, i) => Math.round(v * fg[3] / 255 + bg[i] * (1 - fg[3] / 255)));
              const background = (el) => {
                const chain = []; for (let p = el; p; p = p.parentElement) chain.unshift(p);
                return chain.reduce((bg, p) => blend(rgba(getComputedStyle(p).backgroundColor), bg), [255, 255, 255]);
              };
              const selectors = [".sl-markdown-content > p", ".sl-markdown-content p a", ".sl-markdown-content p code", ".starlight-aside p", ".card .title", "th", "td", "#starlight__sidebar a[aria-current='page']", ".expressive-code pre code span[style]"];
              return selectors.flatMap((selector) => [...document.querySelectorAll(selector)].filter(el => el.textContent.trim() && el.getBoundingClientRect().height).map(el => {
                const bg = background(el); const fg = blend(rgba(getComputedStyle(el).color), bg);
                return { selector, foreground: `rgb(${fg.join(", ")})`, background: `rgb(${bg.join(", ")})` };
              }));
            });
            assert(pairs.some(p => p.selector.includes("expressive-code")), "Fenced syntax text not observed");
            for (const pair of pairs) {
              pair.ratio = calculateContrastRatio(pair.foreground, pair.background);
              assert(pair.ratio !== null && pair.ratio >= 4.5, `${id} ${mode} adjacent text contrast: ${JSON.stringify(pair)}`);
            }

            const link = page.locator(".sl-markdown-content p a").first();
            await link.hover();
            const hover = await link.evaluate(el => getComputedStyle(el).color);
            assert(calculateContrastRatio(hover, measurements.bodyBg) >= 4.5, "Hovered link contrast");
            await page.mouse.move(0, 0);
            await page.keyboard.press("Tab");
            await link.focus();
            const focus = await link.evaluate(el => ({ visible: el.matches(":focus-visible"), width: getComputedStyle(el).outlineWidth, style: getComputedStyle(el).outlineStyle, color: getComputedStyle(el).outlineColor }));
            assert(focus.visible && parseFloat(focus.width) >= 1 && focus.style !== "none", `Keyboard focus is not visibly outlined: ${JSON.stringify(focus)}`);
            assert(calculateContrastRatio(focus.color, measurements.bodyBg) >= 3, `${id} ${mode} ${width}: Focus ring contrast ${JSON.stringify({ focus, background: measurements.bodyBg })}`);

            await page.emulateMedia({ reducedMotion: "reduce" });
            const motion = await page.evaluate(() => ({
              scroll: getComputedStyle(document.documentElement).scrollBehavior,
              running: document.getAnimations().filter(a => a.playState === "running" && a.effect.getTiming().iterations === Infinity).length,
            }));
            assert(motion.scroll === "auto" && motion.running === 0, "Reduced-motion behavior differs");
            await page.emulateMedia({ reducedMotion: "no-preference" });

            if (width === 375) {
              const menu = page.locator("button[popovertarget='starlight__sidebar']");
              await menu.focus(); await page.keyboard.press("Enter");
              await expect(page.locator("#starlight__sidebar")).toHaveJSProperty("popover", "auto");
              assert(await page.locator("#starlight__sidebar").evaluate(el => el.matches(":popover-open")), "Keyboard menu did not open");
              await expect(page.locator("#starlight__sidebar a[href='/design/']")).toBeVisible();
              await page.keyboard.press("Escape");
              assert(!await page.locator("#starlight__sidebar").evaluate(el => el.matches(":popover-open")), "Menu did not close");
            }
            await page.locator("site-search button[data-open-modal]").focus();
            await page.keyboard.press("Enter");
            await expect(page.locator("site-search dialog")).toBeVisible();
            await page.locator(".pagefind-ui__search-input").fill("forge");
            await expect(page.locator(".pagefind-ui__result").first()).toBeVisible();
            await page.keyboard.press("Escape");
            await expect(page.locator("site-search dialog")).not.toBeVisible();
            const tabs = page.getByRole("tab");
            await tabs.first().focus(); await page.keyboard.press("ArrowRight");
            await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");

            const brand = await page.locator(".site-title img:visible").evaluate(el => {
              const box = el.getBoundingClientRect(); const title = el.closest("a");
              return { width: box.width, height: box.height, loaded: el.complete && el.naturalWidth > 0, gap: parseFloat(getComputedStyle(title).columnGap), src: el.getAttribute("src"), ratio: el.naturalWidth / el.naturalHeight };
            });
            assert(brand.loaded && brand.width >= 24 && brand.gap >= brand.width / 6, "Brand size/clear space not preserved");
            assert(Math.abs(brand.width / brand.height - brand.ratio) < 0.01, "Brand proportions changed");
            assert(brand.src.includes(`mark-on-${mode}`), "Wrong surface-specific mark");
            const uniquePairs = [...new Map(pairs.map(pair => [JSON.stringify(pair), pair])).values()];
            records.push({ mode, width, measurements, pairs: uniquePairs, hover, focus, motion, brand, keyboardMenu: width === 375, searchResults: true, keyboardTabs: true });
          }
        }
      } finally { await page.close(); await server.close(); }
      const controls = {};
      for (const variant of ["override", "disconnected"]) {
        const controlServer = await startStaticServer(join(workDir, consumer, `dist/${variant}`));
        const controlPage = await browser.newPage();
        try {
          await controlPage.goto(`http://127.0.0.1:${controlServer.port}/`);
          const modes = {};
          for (const mode of ["dark", "light"]) {
            await controlPage.evaluate(m => document.documentElement.dataset.theme = m, mode);
            const observed = await controlPage.evaluate(() => ({
              hairline: getComputedStyle(document.documentElement).getPropertyValue("--sl-color-hairline").trim(),
              background: getComputedStyle(document.body).backgroundColor,
              override: document.querySelectorAll("[data-test-override='consumer-owned']").length,
              frame: document.querySelectorAll(".tfsl-page-title-frame").length,
              h1: document.querySelectorAll("h1#_top").length,
            }));
            assert(observed.frame === 0 && observed.h1 === 1, "Control title semantics changed");
            if (variant === "override") {
              assert(observed.hairline === "#e11d48" && observed.override === 1, "Consumer CSS/component precedence failed");
              assert(colorMatches(observed.background, spec.colors[mode].neutrals.bg, hexToRgbTuple(spec.colors[mode].neutrals.bg)), "Override control lost plugin background");
            } else {
              assert(observed.override === 0 && !colorMatches(observed.background, spec.colors[mode].neutrals.bg, hexToRgbTuple(spec.colors[mode].neutrals.bg)), "Disconnected control retained theme styles");
            }
            modes[mode] = observed;
          }
          controls[variant] = modes;
        } finally { await controlPage.close(); await controlServer.close(); }
      }
      observations[id] = records;
      observations[`${id}-controls`] = controls;
    }
    assert(external.length === 0, "Unexpected runtime external requests");
    const result = { status: "pass", observations, externalRequestCount: external.length, accessibilityScope: "Observed adjacent pairs and interactions; not complete WCAG conformance" };
    await writeFile(join(workDir, "interaction-receipt.json"), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } finally { await browser.close(); }
}

/** Exercise the exact release tarball in disposable copies of its owned demo.
 * Reuses the same interaction, contrast, expected-style and negative controls.
 * @param {string} sourceRoot @param {string} packagePath @param {string} workDir
 */
export async function runReleaseNovaConsumer(sourceRoot, packagePath, workDir) {
  sourceRoot = resolve(sourceRoot); packagePath = resolve(packagePath); workDir = resolve(workDir);
  await mkdir(workDir); // Existing evidence and operator files are never pruned.
  const consumer = join(workDir, "consumer-forge");
  await cp(join(sourceRoot,"demo"), consumer, {recursive:true, filter:source => !["node_modules","dist",".astro"].includes(basename(source))});
  execFileSync("npm", ["ci","--ignore-scripts"], {cwd:consumer,stdio:"pipe"});
  execFileSync("npm", ["install","--ignore-scripts","--no-save","--package-lock=false",packagePath], {cwd:consumer,stdio:"pipe"});
  const installed = join(consumer,"node_modules/@knowledge-forge-ai/starlight-theme-terminal-nova");
  const provenance = JSON.parse(await readFile(join(installed,"provenance.json"),"utf8"));
  for (const file of provenance.files) {
    const bytes = await readFile(join(installed,file.path));
    if (sha256(bytes) !== file.sha256 || bytes.length !== file.size) throw new Error(`Installed provenance mismatch: ${file.path}`);
  }
  for (const file of ["theme.json","styles/theme.css","index.js","provenance.json","package.json"]) {
    if (sha256(await readFile(join(installed,file))) !== sha256(await readFile(join(sourceRoot,file)))) throw new Error(`Release source/package mismatch: ${file}`);
  }
  for (const [variant,scenario] of [["default","nova"],["override","nova-override"],["disconnected","nova-disconnected"]]) {
    execFileSync("npm",["exec","--","astro","build"],{cwd:consumer,stdio:"pipe",env:{...process.env,CONSUMER_SCENARIO:scenario,ASTRO_OUT_DIR:`./dist/${variant}`}});
  }
  const playwrightModule = pathToFileURL(createRequire(join(consumer,"package.json")).resolve("@playwright/test")).href;
  const observation = await observeNovaConsumers(workDir,sourceRoot,{selectedOnly:true,candidateDirectory:"release-candidate",playwrightModule});
  const receipt = {...observation,packageSha256:sha256(await readFile(packagePath)),themeDigest:provenance.themeInputDigest,cssDigest:provenance.cssOutputDigest};
  await writeFile(join(workDir,"release-consumer.json"),JSON.stringify(receipt,null,2)+"\n");
  return receipt;
}

const isDirect = process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isDirect) {
  const args = process.argv.slice(2);
  const getArg = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  let runPromise;
  if (args.includes("--release-nova-root")) {
    runPromise = runReleaseNovaConsumer(getArg("--release-nova-root"),getArg("--packed-theme"),getArg("--work-dir"));
  } else if (args.includes("--observe-nova-work-dir")) {
    runPromise = observeNovaConsumers(resolve(getArg("--observe-nova-work-dir")), resolve(getArg("--nova-root") || "themes/terminal-nova"));
  } else if (args.includes("--nova-root") || args.includes("--nova-smoke")) {
    runPromise = runTerminalNovaConsumerSmoke({
      novaRoot: getArg("--nova-root"),
      workDir: getArg("--work-dir"),
      packedTfslPath: getArg("--packed-tfsl") || getArg("--packed-cli"),
      tfslBin: getArg("--tfsl-bin"),
      demoOverlayDir: getArg("--demo-dir"),
    });
  } else if (args.includes("--saved-specification")) {
    const specPath = getArg("--saved-specification");
    const digest = getArg("--verified-theme-digest");
    const metadataArg = getArg("--package-metadata") || getArg("--metadata");
    const template = getArg("--template");
    const tfslBin = getArg("--tfsl-bin");
    const packedTfslPath = getArg("--packed-tfsl");
    const workDir = getArg("--work-dir");
    runPromise = runSavedThemeConsumerSmoke(specPath, digest, {
      metadata: metadataArg,
      template,
      tfslBin,
      packedTfslPath,
      workDir,
    });
  } else {
    runPromise = runGeneratedPluginSmoke();
  }

  runPromise
    .then((result) => {
      console.log(JSON.stringify(result));
      process.exitCode = 0;
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
