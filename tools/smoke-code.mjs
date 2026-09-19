#!/usr/bin/env node
// @ts-check

/**
 * smoke-code.mjs
 *
 * Qualification smoke tool for Theme Forge Stellar Loom Code Presentation (61B-code).
 * Exercises:
 *  - Fresh pack of Loom with member/tarball identity retention
 *  - Fresh disposable consumer with npm install --ignore-scripts
 *  - Dynamic ESM import of installed package by file URL
 *  - Code domain public exports: compileThemeCode, generateThemePackageCode, writeThemePackage
 *  - Library theme generation for loom-black-code, loom-flexoki-code, and loom-celestia-code
 *  - Deterministic generation across independent directories (two runs byte-for-byte identical)
 *  - Package member hygiene and fixed code stylesheet family (layers, tokens, base, accent, overrides, code)
 *  - Clean installation into a copy of consumer-fixture with original lock retention
 *  - Pinned runtime identity: Node 22, Astro 7.3.1, Starlight 0.42.0, Expressive Code 0.44.2, Shiki 4.4.3, Playwright 1.62.1
 *  - Static Astro builds across scenario matrix:
 *      3 fixtures x 2 modes x 3 viewports (390, 768, 1440)
 *      All 8 Flexoki accents x 2 modes at 768
 *      False EC control (normal Markdown without Expressive Code)
 *      Consumer leaf Expressive Code option precedence
 *      Consumer array Expressive Code replacement
 *      Consumer unlayered custom CSS overrides
 *      Consumer PageTitle component override precedence
 *  - Offline Playwright Chromium assertions:
 *      Computed frame backgrounds (verifying core pre layer issue is avoided)
 *      Marks (marked, inserted, deleted) computed colors
 *      Copy button behavior and visible keyboard focus outline
 *      No page/chrome horizontal overflow
 *      Sidebar-bearing recorded
 *      Explicit verification that ec.config.mjs is outside Loom contract
 *      Zero external runtime requests (offline serving)
 *  - Structured JSON receipt recording versions, lock digests, inventories, tarball digests, and browser observations.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import {
  cp,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
  symlink,
} from "node:fs/promises";
import { basename, dirname, extname, join, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOOM_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(LOOM_ROOT, "../..");
const SOLAR_SAIL_ROOT = resolve(LOOM_ROOT, "../solar-sail");
const CONSUMER_FIXTURE_SRC = resolve(LOOM_ROOT, "consumer-fixture");

const EXPECTED_VERSIONS = {
  astro: "7.3.1",
  starlight: "0.42.0",
  expressiveCode: "0.44.2",
  shiki: "4.4.3",
  playwright: "1.62.1",
};

const FLEXOKI_ACCENTS = [
  "red",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "purple",
  "magenta",
];

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function oklab2rgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  function toSrgb(c) {
    const clamped = Math.max(0, Math.min(1, c));
    return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * (clamped ** (1 / 2.4)) - 0.055;
  }

  return [Math.round(toSrgb(r) * 255), Math.round(toSrgb(g) * 255), Math.round(toSrgb(bl) * 255)];
}

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
  const oklabMatch = s.match(/oklab\(\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)/);
  if (oklabMatch) {
    return oklab2rgb(parseFloat(oklabMatch[1]), parseFloat(oklabMatch[2]), parseFloat(oklabMatch[3]));
  }
  return null;
}

function colorMatches(actual, expectedHex, tolerance = 0) {
  if (!actual || !expectedHex) return false;
  const a = parseColor(actual);
  const e = parseColor(expectedHex);
  if (!a || !e) return false;
  return (
    Math.abs(a[0] - e[0]) <= tolerance &&
    Math.abs(a[1] - e[1]) <= tolerance &&
    Math.abs(a[2] - e[2]) <= tolerance
  );
}

function isTransparent(colorStr) {
  if (!colorStr) return true;
  const s = colorStr.trim().toLowerCase();
  if (s === "transparent") return true;
  const match = s.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*0(?:\.0+)?\s*\)/);
  return Boolean(match);
}

/**
 * WCAG 2.1 relative luminance calculation.
 * @param {number[]} rgb
 * @returns {number}
 */
function getRelativeLuminance(rgb) {
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((val) => {
    const s = val / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2.1 contrast ratio calculation.
 * Expressive Code enforces minSyntaxHighlightingColorContrast (default 5.5:1).
 * @param {string | number[]} colorA
 * @param {string | number[]} colorB
 * @returns {number}
 */
function calculateContrastRatio(colorA, colorB) {
  const rgbA = typeof colorA === "string" ? parseColor(colorA) : colorA;
  const rgbB = typeof colorB === "string" ? parseColor(colorB) : colorB;
  if (!rgbA || !rgbB) return 1;
  const l1 = getRelativeLuminance(rgbA);
  const l2 = getRelativeLuminance(rgbB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function startStaticServer(rootDir, port = 0) {
  const MIME_TYPES = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
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

function parseCliArgs() {
  const rawArgs = process.argv.slice(2);
  const args = {
    workDir: null,
    packedLoom: null,
    skipBrowser: false,
    json: false,
    outbox: null,
  };

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === "--work-dir" && i + 1 < rawArgs.length) {
      args.workDir = resolve(rawArgs[++i]);
    } else if (arg.startsWith("--work-dir=")) {
      args.workDir = resolve(arg.slice("--work-dir=".length));
    } else if ((arg === "--packed-loom" || arg === "--packed-tfsl") && i + 1 < rawArgs.length) {
      args.packedLoom = resolve(rawArgs[++i]);
    } else if (arg.startsWith("--packed-loom=")) {
      args.packedLoom = resolve(arg.slice("--packed-loom=".length));
    } else if (arg === "--outbox" && i + 1 < rawArgs.length) {
      args.outbox = resolve(rawArgs[++i]);
    } else if (arg.startsWith("--outbox=")) {
      args.outbox = resolve(arg.slice("--outbox=".length));
    } else if (arg === "--skip-browser") {
      args.skipBrowser = true;
    } else if (arg === "--json") {
      args.json = true;
    }
  }

  return args;
}

export async function runCodeSmoke() {
  const cliArgs = parseCliArgs();
  const startTime = new Date().toISOString();

  console.log("=== Stellar Loom Code Presentation (61B-code) Smoke Qualification ===");

  // Determine work directory (F7, F8)
  const { THEME_FORGE_SCRATCH_ROOT } = await import(pathToFileURL(join(REPO_ROOT, "tools/scratch/scratch-contract.mjs")).href);
  const baseDir = process.env.SCRATCH_BASE_DIR || THEME_FORGE_SCRATCH_ROOT;
  let scratchScope = null;
  let workDir = cliArgs.workDir;
  if (!workDir) {
    const { allocateScratch } = await import(pathToFileURL(join(REPO_ROOT, "tools/scratch/scratch-manager.mjs")).href);
    scratchScope = allocateScratch({
      phase: "smoke-code",
      runId: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      baseDir,
      budgetBytes: 1024 * 1024 * 1024, // 1 GiB budget for Astro build outputs
    });
    workDir = scratchScope.path;
  }
  await mkdir(workDir, { recursive: true });
  console.log(`1. Using work directory: ${workDir}`);

  try {
    const evidenceDir = join(workDir, "evidence");
    await mkdir(evidenceDir, { recursive: true });

    const DEFAULT_MANDATORY_CHECKS = {
      tarballIdentityRetained: false,
      codeDomainExportsVerified: false,
      catalogDomainExportsVerified: false,
      fixturesDeterministicAcrossRuns: false,
      codeStyleFilesVerified: false,
      consumerLockRetained: false,
      browserMatrixVerified: false,
      flexokiAll8AccentsVerified: false,
      flexokiPairedCandidateVerified: false,
      typescriptPackageCompilationVerified: false,
      packageJsTsParity: false,
      tabsPresentationVerified: false,
      tabsPresentAndDistinct: false,
      syntaxTokensVerified: false,
      contrastNormalizationVerified: false,
      computedFrameBackgroundsVerified: false,
      marksVerified: false,
      copyBehaviorKeyboardFocusVerified: false,
      copyFeedbackTooltipVerified: false,
      chromeRolesVerified: false,
      noStyleLeakageVerified: false,
      falseEcControlVerified: false,
      consumerLeafPrecedenceVerified: false,
      consumerArraysPrecedenceVerified: false,
      customCssBeatsLayersVerified: false,
      pageTitlePrecedenceVerified: false,
      noHorizontalOverflow: false,
      sidebarBearingRecorded: false,
      ecConfigMjsOutsideContract: false,
      zeroExternalRequests: false,
      bookChromeVerified: false,
      solarSailPairedConsumerVerified: false,
      evidenceRetentionVerified: false,
      evidencePromotionSuccess: false,
      scratchCloseoutSuccess: false,
    };

    let gitInfo = { commit: "unknown", tree: "unknown" };
    try {
      gitInfo.commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
      gitInfo.tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    } catch {}

    const receipt = {
      status: "pending",
      timestamp: startTime,
      workDir,
      git: gitInfo,
      runtimeVersions: {
        node: process.version,
        stellarLoom: null,
        astro: EXPECTED_VERSIONS.astro,
        starlight: EXPECTED_VERSIONS.starlight,
        expressiveCode: EXPECTED_VERSIONS.expressiveCode,
        shiki: EXPECTED_VERSIONS.shiki,
        playwright: EXPECTED_VERSIONS.playwright,
        browser: null,
      },
      originalLockDigest: null,
      loomTarball: null,
      cliValidation: {},
      compiledThemes: [],
      ecConfigMjsOutsideContract: true,
      browserObservations: null,
      checks: { ...DEFAULT_MANDATORY_CHECKS },
    };

    // Explicit verification: ec.config.mjs must be outside Loom contract
    const loomEcConfig = join(LOOM_ROOT, "ec.config.mjs");
    const consumerEcConfig = join(CONSUMER_FIXTURE_SRC, "ec.config.mjs");
    if (existsSync(loomEcConfig) || existsSync(consumerEcConfig)) {
      throw new Error("ec.config.mjs must NOT exist inside Loom or consumer fixture; configuration is via Starlight plugin/options");
    }
    receipt.ecConfigMjsOutsideContract = true;
    console.log("   ✓ Verified ec.config.mjs is outside Loom contract explicitly.");

    // -------------------------------------------------------------
    // Step 1: Compiler Build Qualification
    // -------------------------------------------------------------
    console.log("2. Checking compiler build availability...");
    const distEntryPath = join(LOOM_ROOT, "dist/index.js");
    let distAvailable = existsSync(distEntryPath);

    if (!distAvailable) {
      spawnSync("npm", ["run", "build"], {
        cwd: SOLAR_SAIL_ROOT,
        encoding: "utf8",
      });
      const buildProc = spawnSync("npm", ["run", "build"], {
        cwd: LOOM_ROOT,
        encoding: "utf8",
      });

      distAvailable = existsSync(distEntryPath);

      if (buildProc.status !== 0 || !distAvailable) {
        console.warn("   Notice: Compiler build failed or incomplete in current checkout.");
        receipt.status = "blocked";
        receipt.completed = new Date().toISOString();
        receipt.blockedReason = "Compiler build failed; sibling worker code domain/emitter delivery pending integration";
        receipt.buildError = buildProc.stderr || buildProc.stdout;

        const receiptJson = JSON.stringify(receipt, null, 2);
        await writeFile(join(evidenceDir, "receipt.json"), receiptJson, "utf8");
        await writeFile(join(workDir, "receipt.json"), receiptJson, "utf8");
        if (cliArgs.json) {
          process.stdout.write(receiptJson + "\n");
        }
        return receipt;
      }
    }

  // -------------------------------------------------------------
  // Step 2: Pack Loom & Verify Tarball Identity
  // -------------------------------------------------------------
  console.log("3. Packaging Loom into isolated pack directory...");
  let tarballPath;
  let packMetadata;

  if (cliArgs.packedLoom && existsSync(cliArgs.packedLoom)) {
    tarballPath = cliArgs.packedLoom;
    console.log(`   Using pre-packed tarball: ${tarballPath}`);
  } else {
    const packDir = join(workDir, "loom-pack");
    await mkdir(packDir, { recursive: true });
    const packOutput = execFileSync("npm", ["pack", "--json", "--pack-destination", packDir], {
      cwd: LOOM_ROOT,
      encoding: "utf8",
    });
    const parsedPack = JSON.parse(packOutput);
    packMetadata = parsedPack[0];
    tarballPath = join(packDir, packMetadata.filename);
  }

  const tarballBytes = await readFile(tarballPath);
  const tarballDigest = sha256(tarballBytes);
  console.log(`   Packed tarball: ${basename(tarballPath)} (${tarballBytes.byteLength} bytes, SHA-256: ${tarballDigest.slice(0, 16)}...)`);

  receipt.loomTarball = {
    path: tarballPath,
    filename: basename(tarballPath),
    size: tarballBytes.byteLength,
    sha256: tarballDigest,
    membersCount: packMetadata?.files?.length ?? null,
  };

  // -------------------------------------------------------------
  // Step 3: Fresh Tool Consumer & Dynamic ESM Import
  // -------------------------------------------------------------
  console.log("4. Installing packed Loom into fresh tool consumer...");
  const toolConsumerDir = join(workDir, "tool-consumer");
  await mkdir(toolConsumerDir, { recursive: true });

  await writeFile(
    join(toolConsumerDir, "package.json"),
    JSON.stringify(
      {
        name: "smoke-code-tool-consumer",
        version: "1.0.0",
        private: true,
        type: "module",
      },
      null,
      2
    ),
    "utf8"
  );

  const toolInstallArgs = ["install", "--ignore-scripts", "--no-audit", "--no-fund"];
  if (process.env.CI || process.env.OFFLINE) {
    toolInstallArgs.push("--offline");
  }
  execFileSync("npm", [...toolInstallArgs, tarballPath], {
    cwd: toolConsumerDir,
    stdio: "ignore",
  });

  const installedLoomRoot = join(
    toolConsumerDir,
    "node_modules/@knowledge-forge-ai/theme-forge-stellar-loom"
  );
  if (!existsSync(installedLoomRoot)) {
    throw new Error(`Installed Loom not found at expected path: ${installedLoomRoot}`);
  }

  const installedLoomPkg = JSON.parse(
    await readFile(join(installedLoomRoot, "package.json"), "utf8")
  );
  receipt.runtimeVersions.stellarLoom = installedLoomPkg.version;
  console.log(`   ✓ Installed @knowledge-forge-ai/theme-forge-stellar-loom v${installedLoomPkg.version}`);

  console.log("5. Importing installed package via file URL...");
  const installedEntryUrl = pathToFileURL(join(installedLoomRoot, "dist/index-catalog.js")).href;
  const loom = await import(installedEntryUrl);

  const requiredCodeExports = [
    "compileThemeCode",
    "generateThemePackageCode",
    "writeThemePackage",
    "compileThemeCatalog",
    "generateThemePackageCatalog",
    "writeThemePackageCatalog",
    "compileSyntaxPalette",
  ];

  const missingExports = requiredCodeExports.filter((exp) => loom[exp] === undefined);
  if (missingExports.length > 0) {
    console.warn(`   Notice: Installed package missing code domain exports: ${missingExports.join(", ")}`);
    receipt.status = "blocked";
    receipt.completed = new Date().toISOString();
    receipt.blockedReason = `Installed package missing pending code domain exports: ${missingExports.join(", ")}. Sibling worker code domain/emitter integration pending.`;
    const receiptJson = JSON.stringify(receipt, null, 2);
    await writeFile(join(evidenceDir, "receipt.json"), receiptJson, "utf8");
    await writeFile(join(workDir, "receipt.json"), receiptJson, "utf8");
    if (cliArgs.json) {
      process.stdout.write(receiptJson + "\n");
    }
    return receipt;
  }
  console.log(`   ✓ Verified installed library exports: ${requiredCodeExports.join(", ")}`);

  // -------------------------------------------------------------
  // Step 4: Verify Installed Code Presentation Fixtures
  // -------------------------------------------------------------
  console.log("6. Verifying installed first-party code fixtures...");
  const blackFixture = join(installedLoomRoot, "examples/loom-black-code.theme.json");
  const flexokiFixture = join(installedLoomRoot, "examples/loom-flexoki-code.theme.json");
  const celestiaFixture = join(installedLoomRoot, "examples/loom-celestia-code.theme.json");

  for (const f of [blackFixture, flexokiFixture, celestiaFixture]) {
    if (!existsSync(f)) {
      throw new Error(`Installed code fixture missing: ${f}`);
    }
  }

  const blackSpec = JSON.parse(await readFile(blackFixture, "utf8"));
  const flexokiSpec = JSON.parse(await readFile(flexokiFixture, "utf8"));
  const celestiaSpec = JSON.parse(await readFile(celestiaFixture, "utf8"));

  // Validate fixtures using library validate if available
  if (typeof loom.validateThemeCode === "function") {
    for (const [name, spec] of [
      ["black-code", blackSpec],
      ["flexoki-code", flexokiSpec],
      ["celestia-code", celestiaSpec],
    ]) {
      const valResult = loom.validateThemeCode(spec);
      if (valResult.errors && valResult.errors.length > 0) {
        throw new Error(`Validation failed for ${name}: ${JSON.stringify(valResult.errors)}`);
      }
    }
    console.log("   ✓ All 3 code fixtures passed validateThemeCode.");
  }

  console.log("6b. Loading Flexoki paired profile candidate from Solar Sail...");
  const solarSailDist = await import(pathToFileURL(join(SOLAR_SAIL_ROOT, "dist/index.js")).href);
  const flexokiProfilePath = join(SOLAR_SAIL_ROOT, "examples/flexoki.profile.json");
  const flexokiCatalogPath = join(installedLoomRoot, "examples/loom-flexoki-catalog.json");
  if (!existsSync(flexokiProfilePath) || !existsSync(flexokiCatalogPath)) {
    throw new Error("Missing flexoki.profile.json or loom-flexoki-catalog.json");
  }
  const flexokiProfileRaw = await readFile(flexokiProfilePath, "utf8");
  const flexokiProfileDigest = createHash("sha256").update(flexokiProfileRaw).digest("hex");
  console.log(`    Flexoki paired profile SHA-256 digest: ${flexokiProfileDigest}`);
  const flexokiProfile = JSON.parse(flexokiProfileRaw);
  const flexokiBaseCatalog = JSON.parse(await readFile(flexokiCatalogPath, "utf8"));
  const flexokiSyntaxModel = solarSailDist.mapProfileToSyntaxPalette(flexokiProfile);
  const flexokiMappedLoom = solarSailDist.mapProfileToStellarLoom(flexokiProfile, flexokiBaseCatalog);

  // -------------------------------------------------------------
  // Step 5: Library Generation & Determinism Across Runs
  // -------------------------------------------------------------
  console.log("7. Generating code theme packages and verifying determinism across runs...");

  const generatedThemes = [
    {
      id: "loom-black-code",
      spec: blackSpec,
      accent: "default",
      packageName: "@smoke/starlight-theme-loom-black-code",
    },
    ...FLEXOKI_ACCENTS.map((accent) => ({
      id: `loom-flexoki-code-${accent}`,
      spec: flexokiSpec,
      accent,
      packageName: `@smoke/starlight-theme-loom-flexoki-code-${accent}`,
    })),
    {
      id: "loom-celestia-code",
      spec: celestiaSpec,
      accent: "default",
      packageName: "@smoke/starlight-theme-loom-celestia-code",
    },
    {
      id: "loom-flexoki-paired",
      spec: flexokiMappedLoom,
      syntaxPalette: flexokiSyntaxModel,
      accent: "cyan",
      packageName: "@smoke/starlight-theme-loom-flexoki-paired",
      isCatalog: true,
      bookChrome: true,
    },
  ];

  const packageTarballs = {};

  for (const themeInfo of generatedThemes) {
    const runDir1 = join(workDir, `gen-${themeInfo.id}-run1`);
    const runDir2 = join(workDir, `gen-${themeInfo.id}-run2`);
    await mkdir(runDir1, { recursive: true });
    await mkdir(runDir2, { recursive: true });

    const metadata = {
      name: themeInfo.packageName,
      version: "0.1.0",
      description: `Smoke qualification package for ${themeInfo.id}`,
    };

    const genOpts = {
      themeSpec: themeInfo.spec,
      ...(themeInfo.syntaxPalette ? { syntaxPalette: themeInfo.syntaxPalette } : {}),
      metadata,
      accent: themeInfo.accent,
      ...(themeInfo.bookChrome ? { bookChrome: true } : {}),
    };

    const res1 = themeInfo.isCatalog
      ? loom.generateThemePackageCatalog(genOpts)
      : loom.generateThemePackageCode(genOpts);
    const res2 = themeInfo.isCatalog
      ? loom.generateThemePackageCatalog(genOpts)
      : loom.generateThemePackageCode(genOpts);

    if (themeInfo.isCatalog) {
      await loom.writeThemePackageCatalog(res1, runDir1);
      await loom.writeThemePackageCatalog(res2, runDir2);
    } else {
      await loom.writeThemePackage(res1, runDir1);
      await loom.writeThemePackage(res2, runDir2);
    }

    // Verify expected code style files
    const EXPECTED_CODE_STYLE_FILES = [
      "styles/layers.css",
      "styles/tokens.css",
      "styles/base.css",
      "styles/accent.css",
      "styles/overrides.css",
      "styles/code.css",
      ...(themeInfo.isCatalog ? ["styles/tabs.css", "styles/compat.css"] : []),
      ...(themeInfo.bookChrome ? ["styles/book.css"] : []),
    ];
    for (const styleFile of EXPECTED_CODE_STYLE_FILES) {
      if (!existsSync(join(runDir1, styleFile))) {
        throw new Error(`Generated package ${themeInfo.id} missing expected style file: ${styleFile}`);
      }
    }

    // Verify byte-for-byte determinism
    const entries1 = await readdir(runDir1, { recursive: true, withFileTypes: true });
    entries1.sort((a, b) => {
      const relA = relative(runDir1, join(a.parentPath, a.name));
      const relB = relative(runDir1, join(b.parentPath, b.name));
      return relA.localeCompare(relB);
    });
    const files1 = entries1.map((e) => relative(runDir1, join(e.parentPath, e.name)));

    const entries2 = await readdir(runDir2, { recursive: true, withFileTypes: true });
    entries2.sort((a, b) => {
      const relA = relative(runDir2, join(a.parentPath, a.name));
      const relB = relative(runDir2, join(b.parentPath, b.name));
      return relA.localeCompare(relB);
    });
    const files2 = entries2.map((e) => relative(runDir2, join(e.parentPath, e.name)));

    if (JSON.stringify(files1) !== JSON.stringify(files2)) {
      throw new Error(`Determinism failure: File inventories differ for ${themeInfo.id}`);
    }

    for (const entry of entries1) {
      if (entry.isFile()) {
        const file = relative(runDir1, join(entry.parentPath, entry.name));
        const p1 = join(runDir1, file);
        const p2 = join(runDir2, file);
        const b1 = await readFile(p1);
        const b2 = await readFile(p2);
        if (sha256(b1) !== sha256(b2)) {
          throw new Error(`Determinism failure: Byte mismatch in '${file}' for ${themeInfo.id}`);
        }
      }
    }

    // Pack generated package
    const packOut = execFileSync("npm", ["pack", "--json"], {
      cwd: runDir1,
      encoding: "utf8",
    });
    const packParsed = JSON.parse(packOut)[0];
    const generatedTarballPath = join(runDir1, packParsed.filename);
    const genTarballBytes = await readFile(generatedTarballPath);
    const genTarballSha = sha256(genTarballBytes);

    packageTarballs[themeInfo.id] = {
      path: generatedTarballPath,
      filename: packParsed.filename,
      size: genTarballBytes.byteLength,
      sha256: genTarballSha,
      packageName: themeInfo.packageName,
    };

    let ecDefaultsSha256 = null;
    if (existsSync(join(runDir1, "index.js"))) {
      const idxJs = await readFile(join(runDir1, "index.js"), "utf8");
      const match = idxJs.match(/const ecDefaults = (\{.*?\});/s);
      if (match) {
        ecDefaultsSha256 = sha256(match[1]);
      }
    }

    receipt.compiledThemes.push({
      id: themeInfo.id,
      name: themeInfo.spec.name,
      packageName: themeInfo.packageName,
      accent: themeInfo.accent,
      tarball: {
        filename: packParsed.filename,
        size: genTarballBytes.byteLength,
        sha256: genTarballSha,
      },
      expressiveCodeConfigDigest: ecDefaultsSha256,
      themeOutputDigest: res1.cssOutputDigest || null,
    });

    console.log(`   ✓ ${themeInfo.id} generated deterministically and packed (${packParsed.filename})`);
  }

  // TS Package Mode Generation and Build Verification (Finding F9)
  console.log("7b. Verifying TypeScript package generation, compilation (tsc), and ecDefaults byte-identity...");
  const tsRunDir = join(workDir, "gen-loom-flexoki-paired-ts");
  const tsRes = loom.generateThemePackageCatalog({
    themeSpec: flexokiMappedLoom,
    syntaxPalette: flexokiSyntaxModel,
    metadata: {
      name: "@smoke/starlight-theme-loom-flexoki-paired-ts",
      version: "0.1.0",
      description: "TypeScript smoke package",
    },
    accent: "cyan",
    language: "typescript",
    bookChrome: true,
  });
  await loom.writeThemePackageCatalog(tsRes, tsRunDir);

  if (!existsSync(join(tsRunDir, "src/index.ts")) || !existsSync(join(tsRunDir, "tsconfig.json"))) {
    throw new Error("TS package missing src/index.ts or tsconfig.json");
  }
  if (!existsSync(join(tsRunDir, "styles/book.css"))) {
    throw new Error("TS package missing styles/book.css with bookChrome enabled");
  }
  if (existsSync(join(tsRunDir, "index.js"))) {
    throw new Error("TS package must not emit index.js at root");
  }

  const fixtureNodeModules = join(CONSUMER_FIXTURE_SRC, "node_modules");
  if (existsSync(fixtureNodeModules)) {
    try {
      await symlink(fixtureNodeModules, join(tsRunDir, "node_modules"));
    } catch {
      // ignore
    }
  }

  const tscProc = spawnSync("npx", ["tsc", "-p", "tsconfig.json"], {
    cwd: tsRunDir,
    encoding: "utf8",
  });
  if (tscProc.status !== 0) {
    throw new Error(`TypeScript compilation failed for TS theme package:\n${tscProc.stderr || tscProc.stdout}`);
  }

  if (!existsSync(join(tsRunDir, "dist/index.js")) || !existsSync(join(tsRunDir, "dist/index.d.ts"))) {
    throw new Error("TypeScript compilation did not produce dist/index.js or dist/index.d.ts");
  }

  const compiledTsJs = await readFile(join(tsRunDir, "dist/index.js"), "utf8");
  if (!compiledTsJs.includes("mergeCodeConfig")) {
    throw new Error("Compiled TS dist/index.js is missing mergeCodeConfig helper");
  }
  const tsEcMatch = compiledTsJs.match(/const ecDefaults = (\{.*?\});/s);

  const pairedJsRunDir = join(workDir, "gen-loom-flexoki-paired-run1");
  const jsPluginContent = await readFile(join(pairedJsRunDir, "index.js"), "utf8");
  const jsEcMatch = jsPluginContent.match(/const ecDefaults = (\{.*?\});/s);
  const tsSrcContent = await readFile(join(tsRunDir, "src/index.ts"), "utf8");
  const tsSrcEcMatch = tsSrcContent.match(/const ecDefaults = (\{.*?\});/s);
  if (!jsEcMatch || !tsEcMatch || !tsSrcEcMatch) {
    throw new Error("Failed to extract ecDefaults from generated JS, TS source, or compiled TS plugin");
  }
  // Verify byte-for-byte identity of emitted ecDefaults in source before tsc
  if (jsEcMatch[1] !== tsSrcEcMatch[1]) {
    throw new Error("ecDefaults divergence between JS package index.js and TS package src/index.ts!");
  }
  // Verify semantic equality of compiled ecDefaults after tsc
  const jsEcObj = JSON.parse(jsEcMatch[1]);
  const tsEcObj = JSON.parse(tsEcMatch[1]);
  if (JSON.stringify(jsEcObj) !== JSON.stringify(tsEcObj)) {
    throw new Error("ecDefaults semantic divergence between JS package and compiled TS plugin!");
  }
  console.log("   ✓ TypeScript package mode compiled cleanly: source ecDefaults are byte-identical and compiled ecDefaults match semantically.");

  // Pack TS theme package and register for consumer installation (F1)
  const tsPackOut = execFileSync("npm", ["pack", "--json"], {
    cwd: tsRunDir,
    encoding: "utf8",
  });
  const tsPackParsed = JSON.parse(tsPackOut)[0];
  const tsTarballPath = join(tsRunDir, tsPackParsed.filename);
  const tsTarballBytes = await readFile(tsTarballPath);
  const tsTarballSha = sha256(tsTarballBytes);

  packageTarballs["loom-flexoki-paired-ts"] = {
    path: tsTarballPath,
    filename: tsPackParsed.filename,
    size: tsTarballBytes.byteLength,
    sha256: tsTarballSha,
    packageName: "@smoke/starlight-theme-loom-flexoki-paired-ts",
  };

  receipt.compiledThemes.push({
    id: "loom-flexoki-paired-ts",
    name: "flexoki-paired-ts",
    packageName: "@smoke/starlight-theme-loom-flexoki-paired-ts",
    accent: "cyan",
    tarball: {
      filename: tsPackParsed.filename,
      size: tsTarballBytes.byteLength,
      sha256: tsTarballSha,
    },
    expressiveCodeConfigDigest: sha256(tsSrcEcMatch[1]),
    themeOutputDigest: tsRes.cssOutputDigest || null,
  });
  console.log(`   ✓ TypeScript package packed (${tsPackParsed.filename}) and registered for consumer installation.`);

  // -------------------------------------------------------------
  // Step 6: Fresh Copy of consumer-fixture & Clean npm ci
  // -------------------------------------------------------------
  console.log("8. Copying consumer-fixture cleanly (excluding node_modules/dist/.astro)...");
  const consumerDir = join(workDir, "consumer-fixture-copy");
  await mkdir(consumerDir, { recursive: true });

  const originalLockPath = join(CONSUMER_FIXTURE_SRC, "package-lock.json");
  const originalLockBytes = await readFile(originalLockPath);
  const originalLockDigest = sha256(originalLockBytes);
  receipt.originalLockDigest = originalLockDigest;

  await cp(CONSUMER_FIXTURE_SRC, consumerDir, {
    recursive: true,
    filter: (source) => {
      const rel = relative(CONSUMER_FIXTURE_SRC, source);
      if (rel.startsWith("node_modules") || rel === "node_modules") return false;
      if (rel.startsWith("dist") || rel === "dist") return false;
      if (rel.startsWith(".astro") || rel === ".astro") return false;
      return true;
    },
  });

  // Write rich test markdown with syntax, marks, copy, tabs, and overflow verification code
  const indexMdxPath = join(consumerDir, "src/content/docs/index.mdx");
  const indexMdxContent = `---
title: Starlight Code Qualification
description: Real Starlight consumer page for Stellar Loom Expressive Code verification
---

import { Tabs, TabItem } from '@astrojs/starlight/components';

## Expressive Code Section

Here is a test paragraph with an [example link](https://starlight.astro.build) and \`inline-code-sample\`.

\`\`\`typescript title="example.ts" {2} ins={3} del={4}
// Keyword, string, comment, and function tokens
import { defineTheme } from "@knowledge-forge-ai/theme-forge-stellar-loom";
const markedLine = "This line is marked";
const insertedLine = "This line was inserted";
const deletedLine = "This line was deleted";
function computeLongResultWithNoBreaksToVerifyHorizontalOverflowContainmentWithinCodeFrame(): string {
  return "abcdefghijklmnopqrstuvwxyz_0123456789_abcdefghijklmnopqrstuvwxyz_0123456789_abcdefghijklmnopqrstuvwxyz";
}
\`\`\`

## Command Sequence Tabs

Package-manager tabs demonstrate presentation integration:

<Tabs>
  <TabItem label="npm">
  \`\`\`bash
  npm install @knowledge-forge-ai/starlight-theme-stellar-loom
  \`\`\`
  </TabItem>
  <TabItem label="pnpm">
  \`\`\`bash
  pnpm add @knowledge-forge-ai/starlight-theme-stellar-loom
  \`\`\`
  </TabItem>
  <TabItem label="yarn">
  \`\`\`bash
  yarn add @knowledge-forge-ai/starlight-theme-stellar-loom
  \`\`\`
  </TabItem>
</Tabs>

<div class="consumer-custom-marker">Consumer Custom CSS Marker</div>
`;
  await writeFile(indexMdxPath, indexMdxContent, "utf8");
  await writeFile(join(consumerDir, "src/content/docs/reference.mdx"), "---\ntitle: Reference\n---\n\nReference page.\n", "utf8");
  await writeFile(join(consumerDir, "src/content/docs/guide.mdx"), "---\ntitle: Guide\n---\n\nGuide page for nested chapter qualification.\n", "utf8");
  await writeFile(join(consumerDir, "src/styles/code-override.css"), ".expressive-code pre { background-color: #203040; }\n.expressive-code pre > code { font-size: 18px; }\n");

  // R2-E / F5: Style the out-of-scope marker in consumer-custom.css (author stylesheet) rather than inline style
  const consumerCustomCssPath = join(consumerDir, "src/styles/consumer-custom.css");
  let existingCustomCss = "";
  try {
    existingCustomCss = await readFile(consumerCustomCssPath, "utf8");
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== "ENOENT") throw err;
  }
  const updatedCustomCss = `${existingCustomCss}\n.consumer-custom-marker {\n  font-family: monospace;\n  background-color: rgb(26, 43, 60);\n  color: rgb(208, 225, 242);\n  border: 2px solid rgb(255, 85, 0);\n  padding: 8px;\n}\n`;
  await writeFile(consumerCustomCssPath, updatedCustomCss, "utf8");

  const copiedPkg = JSON.parse(await readFile(join(consumerDir, "package.json"), "utf8"));
  if (
    copiedPkg.dependencies["astro"] !== EXPECTED_VERSIONS.astro ||
    copiedPkg.dependencies["@astrojs/starlight"] !== EXPECTED_VERSIONS.starlight
  ) {
    throw new Error(
      `Consumer fixture pins altered! Expected astro: ${EXPECTED_VERSIONS.astro}, @astrojs/starlight: ${EXPECTED_VERSIONS.starlight}`
    );
  }
  if (existsSync(fixtureNodeModules)) {
    console.log("9. Copying pre-installed Linux node_modules from consumer fixture volume...");
    await cp(fixtureNodeModules, join(consumerDir, "node_modules"), { recursive: true });
  } else {
    console.log("9. Running npm ci --ignore-scripts in consumer fixture copy...");
    execFileSync("npm", ["ci", "--ignore-scripts"], {
      cwd: consumerDir,
      stdio: "ignore",
    });
  }

  const tarballsToInstall = Object.values(packageTarballs).map((t) => t.path);
  const consumerInstallArgs = [
    "install",
    "--ignore-scripts",
    "--no-save",
    "--legacy-peer-deps",
    "--no-audit",
    "--no-fund",
  ];
  if (process.env.CI || process.env.OFFLINE) {
    consumerInstallArgs.push("--offline");
  }
  execFileSync("npm", [...consumerInstallArgs, ...tarballsToInstall], {
    cwd: consumerDir,
    stdio: "pipe",
  });
  console.log(`   ✓ Installed ${tarballsToInstall.length} generated theme packages via genuine npm install.`);

  // Verify package-lock.json remains untouched
  const postInstallLock = await readFile(join(consumerDir, "package-lock.json"));
  if (sha256(postInstallLock) !== originalLockDigest) {
    throw new Error("package-lock.json was modified during theme package installation!");
  }
  console.log("   ✓ Consumer package-lock.json digest preserved exactly across installation.");

  // -------------------------------------------------------------
  // Step 7: Write Custom Astro Config Supporting Code Scenarios
  // -------------------------------------------------------------
  console.log("11. Writing consumer Astro configuration with code scenario dispatch...");

  const astroConfigContent = `import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

const scenario = process.env.SMOKE_SCENARIO || "black-code";
const outDir = process.env.ASTRO_OUT_DIR || "./dist";

const plugins = [];
const components = {};
let expressiveCodeConfig = undefined;

const packages = {
  "black-code": "@smoke/starlight-theme-loom-black-code",
  "flexoki-code": "@smoke/starlight-theme-loom-flexoki-code-blue",
  "celestia-code": "@smoke/starlight-theme-loom-celestia-code",
  "flexoki-paired": "@smoke/starlight-theme-loom-flexoki-paired",
  "flexoki-paired-ts": "@smoke/starlight-theme-loom-flexoki-paired-ts",
  "flexoki-red": "@smoke/starlight-theme-loom-flexoki-code-red",
  "flexoki-orange": "@smoke/starlight-theme-loom-flexoki-code-orange",
  "flexoki-yellow": "@smoke/starlight-theme-loom-flexoki-code-yellow",
  "flexoki-green": "@smoke/starlight-theme-loom-flexoki-code-green",
  "flexoki-cyan": "@smoke/starlight-theme-loom-flexoki-code-cyan",
  "flexoki-blue": "@smoke/starlight-theme-loom-flexoki-code-blue",
  "flexoki-purple": "@smoke/starlight-theme-loom-flexoki-code-purple",
  "flexoki-magenta": "@smoke/starlight-theme-loom-flexoki-code-magenta",
  "false-ec": "@smoke/starlight-theme-loom-black-code",
  "consumer-leaf": "@smoke/starlight-theme-loom-black-code",
  "consumer-arrays": "@smoke/starlight-theme-loom-black-code",
  "custom-css": "@smoke/starlight-theme-loom-black-code",
  "page-title-precedence": "@smoke/starlight-theme-loom-black-code",
  "absent": null,
};

if (scenario === "false-ec") {
  expressiveCodeConfig = false;
  const { default: themePlugin } = await import(packages["false-ec"]);
  plugins.push(themePlugin());
} else if (scenario === "consumer-leaf") {
  expressiveCodeConfig = {
    styleOverrides: { frames: { terminalBackground: "#123456", editorBackground: "#123456" }, textMarkers: { markBackground: "#345678" } },
  };
  const { default: themePlugin } = await import(packages["consumer-leaf"]);
  plugins.push(themePlugin());
} else if (scenario === "consumer-arrays") {
  expressiveCodeConfig = {
    themes: ["github-light"],
  };
  const { default: themePlugin } = await import(packages["consumer-arrays"]);
  plugins.push(themePlugin());
} else if (scenario === "page-title-precedence") {
  const { default: themePlugin } = await import(packages["page-title-precedence"]);
  plugins.push(themePlugin());
  components.PageTitle = "./src/components/ConsumerPageTitle.astro";
} else if (scenario !== "absent") {
  const pkgName = packages[scenario];
  if (!pkgName) throw new Error("Unknown smoke scenario: " + scenario);
  const { default: themePlugin } = await import(pkgName);
  plugins.push(themePlugin());
}

export default defineConfig({
  outDir,
  integrations: [
    starlight({
      title: "Consumer Code Documentation",
      plugins,
      expressiveCode: expressiveCodeConfig,
      components,
      customCss: ["./src/styles/consumer-custom.css", ...(scenario === "custom-css" ? ["./src/styles/code-override.css"] : [])],
      sidebar: (scenario === "flexoki-paired" || scenario === "flexoki-paired-ts") ? [
        {
          label: "Catalog Core",
          items: [
            { label: "Overview", slug: "index" },
            {
              label: "Deep Topics",
              items: [{ label: "Guide", slug: "guide" }],
            },
          ],
        },
        {
          label: "Catalog Heroes",
          items: [{ label: "Guide Alternate", slug: "guide" }],
        },
        {
          label: "Catalog Width",
          items: [{ label: "Reference", slug: "reference" }],
        },
      ] : [
        {
          label: "Guides",
          items: [{ label: "Overview", slug: "index" }],
        },
      ],
    }),
  ],
});
`;
  await writeFile(join(consumerDir, "astro.config.mjs"), astroConfigContent, "utf8");

  // -------------------------------------------------------------
  // Step 8: Build Consumer Scenarios via Astro
  // -------------------------------------------------------------
  console.log("12. Building consumer fixture across code qualification scenarios...");

  const scenarios = [
    { name: "black-code", outDir: join(consumerDir, "dist/black-code") },
    { name: "flexoki-code", outDir: join(consumerDir, "dist/flexoki-code") },
    { name: "celestia-code", outDir: join(consumerDir, "dist/celestia-code") },
    { name: "flexoki-paired", outDir: join(consumerDir, "dist/flexoki-paired") },
    { name: "flexoki-paired-ts", outDir: join(consumerDir, "dist/flexoki-paired-ts") },
    ...FLEXOKI_ACCENTS.map((accent) => ({
      name: `flexoki-${accent}`,
      outDir: join(consumerDir, `dist/flexoki-${accent}`),
    })),
    { name: "false-ec", outDir: join(consumerDir, "dist/false-ec") },
    { name: "consumer-leaf", outDir: join(consumerDir, "dist/consumer-leaf") },
    { name: "consumer-arrays", outDir: join(consumerDir, "dist/consumer-arrays") },
    { name: "custom-css", outDir: join(consumerDir, "dist/custom-css") },
    { name: "page-title-precedence", outDir: join(consumerDir, "dist/page-title-precedence") },
    { name: "absent", outDir: join(consumerDir, "dist/absent") },
  ];

  for (const sc of scenarios) {
    const buildProc = spawnSync("npx", ["astro", "build"], {
      cwd: consumerDir,
      env: {
        ...process.env,
        SMOKE_SCENARIO: sc.name,
        ASTRO_OUT_DIR: sc.outDir,
      },
      stdio: "pipe",
      encoding: "utf8",
    });

    if (buildProc.status !== 0) {
      console.error(buildProc.stderr);
      throw new Error(`Astro build failed for scenario '${sc.name}' (exit ${buildProc.status})`);
    }

    if (!existsSync(join(sc.outDir, "index.html"))) {
      throw new Error(`Astro build succeeded for scenario '${sc.name}' but index.html is missing`);
    }
    console.log(`   ✓ Scenario '${sc.name}' built successfully.`);
  }

  // -------------------------------------------------------------
  // Step 9: Playwright Offline Browser Verification
  // -------------------------------------------------------------
  if (cliArgs.skipBrowser) {
    console.log("13. Skipping browser verification (--skip-browser passed).");
    receipt.status = "incomplete-browser-skipped";
    await writeFile(join(evidenceDir, "receipt.json"), JSON.stringify(receipt, null, 2), "utf8");
    return receipt;
  }

  console.log("13. Launching Playwright Chromium for offline live DOM & CSSOM verification...");
  const playwright = await import("@playwright/test");
  const chromium = playwright.chromium || playwright.default?.chromium;
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  receipt.runtimeVersions.browser = browser.version();

  const browserObservations = {
    chromiumVersion: browser.version(),
    externalRequestsRejected: 0,
    scenarios: {},
  };

  const originalNewPage = browser.newPage.bind(browser);
  browser.newPage = async (...args) => {
    const page = await originalNewPage(...args);
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
        browserObservations.externalRequestsRejected++;
      }
    });
    return page;
  };

  const viewports = [
    { name: "mobile", width: 390, height: 800 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1440, height: 900 },
  ];
  const modes = ["dark", "light"];
  let screenNumber = 0;

  try {
    // 1. Check Starlight baseline (absent scenario)
    const absentServer = await startStaticServer(join(consumerDir, "dist/absent"), 0);
    let starlightDefaultDarkBg = null;
    let starlightDefaultLightBg = null;
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${absentServer.port}/`);
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
      });
      starlightDefaultDarkBg = await page.evaluate(
        () => window.getComputedStyle(document.body).backgroundColor
      );
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "light";
      });
      starlightDefaultLightBg = await page.evaluate(
        () => window.getComputedStyle(document.body).backgroundColor
      );
      await page.close();
    } finally {
      await absentServer.close();
    }

    // Helper to evaluate a scenario page
    const evaluateScenarioPage = async (serverPort, expectedValues) => {
      const page = await browser.newPage();
      const records = [];

      await page.route("**/*", (route) => {
        const reqUrl = route.request().url();
        const urlObj = new URL(reqUrl);
        if (urlObj.hostname === "127.0.0.1" || urlObj.hostname === "localhost") {
          route.continue();
        } else {
          browserObservations.externalRequestsRejected++;
          route.abort("blockedbyclient");
        }
      });

      await page.goto(`http://127.0.0.1:${serverPort}/`);

      for (const mode of modes) {
        for (const vp of (expectedValues.viewports || viewports)) {
          await page.setViewportSize({ width: vp.width, height: vp.height });
          await page.evaluate((m) => {
            document.documentElement.dataset.theme = m;
          }, mode);

          const obs = await page.evaluate(() => {
            const body = window.getComputedStyle(document.body);
            const docEl = window.getComputedStyle(document.documentElement);
            const ecBlock = document.querySelector(".expressive-code");
            const ecPre = ecBlock ? ecBlock.querySelector("pre") : null;
            const ecFigure = ecBlock ? ecBlock.querySelector("figure.frame") : null;
            const preStyle = ecPre ? window.getComputedStyle(ecPre) : null;
            const figureStyle = ecFigure ? window.getComputedStyle(ecFigure) : null;

            // Frame background
            const computedCodeBg = preStyle ? preStyle.backgroundColor : null;
            const computedFrameBg = figureStyle ? figureStyle.backgroundColor : null;

            // Marks check
            const markEl = document.querySelector(".expressive-code .mark, .expressive-code mark, .expressive-code [data-mark]");
            const insEl = document.querySelector(".expressive-code .ins, .expressive-code ins, .expressive-code [data-ins]");
            const delEl = document.querySelector(".expressive-code .del, .expressive-code del, .expressive-code [data-del]");

            const markStyle = markEl ? window.getComputedStyle(markEl) : null;
            const insStyle = insEl ? window.getComputedStyle(insEl) : null;
            const delStyle = delEl ? window.getComputedStyle(delEl) : null;

            // Copy button check
            const copyBtn = document.querySelector(".expressive-code .copy button, .expressive-code button[data-code]");

            // Horizontal overflow check
            const hasHorizontalOverflow =
              document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;

            // Sidebar bearing
            const sidebar = document.querySelector(".sidebar-pane, nav.sidebar, [aria-label='Main'], .tfsl-sidebar-container");

            // Book chrome elements (Outcomes B, C, E, F)
            const bookChromeEl = document.querySelector(".tfsl-book-chrome, [data-tfsl-book-chrome='true']");
            const bookNavArrows = document.querySelector(".tfsl-book-nav-arrows");
            const bookNavArrow = document.querySelector(".tfsl-book-nav-arrow");
            const bookNavPrev = document.querySelector(".tfsl-book-nav-prev");
            const bookNavNext = document.querySelector(".tfsl-book-nav-next");
            const chapterActive = document.querySelector("[data-tfsl-chapter-active='true']");

            // Starlight Tabs checks (F4)
            const tabsEl = document.querySelector("starlight-tabs");
            const tabList = tabsEl ? [...tabsEl.querySelectorAll('[role="tab"]')] : [];
            let activeTabBorder = null;
            let inactiveTabBorder = null;
            let activeTabBorderVar = null;
            let inactiveTabBorderVar = null;
            let activeTabBoxShadow = null;
            let tablistBorderBottom = null;
            if (tabsEl) {
              const tablistEl = tabsEl.querySelector('[role="tablist"]');
              if (tablistEl) {
                tablistBorderBottom = window.getComputedStyle(tablistEl).borderBottom;
              }
              for (const tab of tabList) {
                const isSelected = tab.getAttribute("aria-selected") === "true";
                const cs = window.getComputedStyle(tab);
                if (isSelected) {
                  activeTabBorder = cs.borderBottomColor;
                  activeTabBorderVar = cs.getPropertyValue("--sl-tab-color-border").trim();
                  activeTabBoxShadow = cs.boxShadow;
                } else {
                  inactiveTabBorder = cs.borderBottomColor;
                  inactiveTabBorderVar = cs.getPropertyValue("--sl-tab-color-border").trim();
                }
              }
            }

            // Chrome roles checks (F2, F3, F4)
            const headerEl = ecBlock ? ecBlock.querySelector(".header") : null;
            const headerStyle = headerEl ? window.getComputedStyle(headerEl) : null;
            const headerBeforeStyle = headerEl ? window.getComputedStyle(headerEl, "::before") : null;
            const titleEl = ecBlock ? ecBlock.querySelector(".title") : null;
            const titleStyle = titleEl ? window.getComputedStyle(titleEl) : null;
            const titleAfterStyle = titleEl ? window.getComputedStyle(titleEl, "::after") : null;
            const copyBtnStyle = copyBtn ? window.getComputedStyle(copyBtn) : null;
            const copyBtnAfterStyle = copyBtn ? window.getComputedStyle(copyBtn, "::after") : null;
            const copyBtnBeforeStyle = copyBtn ? window.getComputedStyle(copyBtn, "::before") : null;

            // In Expressive Code's implementation:
            // - The copy button icon foreground color is rendered via the ::after pseudo-element's
            //   backgroundColor combined with mask-image (SVG icon mask). The button has no text content.
            // - The copy button border is rendered via the ::before pseudo-element's border.
            // - The editor active tab indicator bottom line is rendered via the .title::after pseudo-element.
            // - The editor tab bar border is rendered via the .header::before pseudo-element.
            const isNonTransparent = (c) => Boolean(c && c !== "transparent" && c !== "rgba(0, 0, 0, 0)");
            const tabBarBorder = headerBeforeStyle
              ? (headerBeforeStyle.borderTopColor || headerBeforeStyle.borderColor)
              : null;
            const activeTabIndicator = titleAfterStyle
              ? titleAfterStyle.borderBottomColor
              : null;
            const copyBtnFg = (copyBtnAfterStyle && isNonTransparent(copyBtnAfterStyle.backgroundColor))
              ? copyBtnAfterStyle.backgroundColor
              : (copyBtnStyle ? copyBtnStyle.color : null);
            const copyBtnBorder = (copyBtnBeforeStyle && isNonTransparent(copyBtnBeforeStyle.borderColor))
              ? copyBtnBeforeStyle.borderColor
              : (copyBtnStyle ? copyBtnStyle.borderColor : null);

            // Style leakage check (F5)
            const markerEl = document.querySelector(".consumer-custom-marker");
            const markerStyle = markerEl ? window.getComputedStyle(markerEl) : null;

            // Syntax Tokens checks (F5)
            const tokenSpans = [...document.querySelectorAll(".expressive-code pre code span")];
            const tokens = tokenSpans.map((s) => ({
              text: s.textContent ? s.textContent.trim() : "",
              color: window.getComputedStyle(s).color,
            }));

            return {
              bodyBg: body.backgroundColor,
              accentColor: docEl.getPropertyValue("--sl-color-accent").trim(),
              tfslFocusColor: docEl.getPropertyValue("--tfsl-color-focus").trim(),
              slHairline: docEl.getPropertyValue("--sl-color-hairline").trim(),
              hasEc: Boolean(ecBlock),
              computedCodeBg,
              computedFrameBg,
              hasMark: Boolean(markEl),
              markBg: markStyle ? markStyle.backgroundColor : null,
              hasIns: Boolean(insEl),
              insBg: insStyle ? insStyle.backgroundColor : null,
              hasDel: Boolean(delEl),
              delBg: delStyle ? delStyle.backgroundColor : null,
              hasCopyButton: Boolean(copyBtn),
              hasSidebar: Boolean(sidebar),
              hasHorizontalOverflow,
              chromeOverflow: [...document.querySelectorAll(".expressive-code .frame, .expressive-code .header")].some(el => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1),
              frameClass: ecFigure?.className,
              frameHeaderVisible: ecFigure ? getComputedStyle(ecFigure.querySelector(".header")).display !== "none" : false,
              markVariable: ecPre ? getComputedStyle(ecPre).getPropertyValue("--ec-tm-markBg").trim() : "",
              insVariable: ecPre ? getComputedStyle(ecPre).getPropertyValue("--ec-tm-insBg").trim() : "",
              delVariable: ecPre ? getComputedStyle(ecPre).getPropertyValue("--ec-tm-delBg").trim() : "",
              hasTabs: Boolean(tabsEl),
              activeTabBorder,
              inactiveTabBorder,
              activeTabBorderVar,
              inactiveTabBorderVar,
              activeTabBoxShadow,
              tablistBorderBottom,
              chromeRoles: {
                headerBg: headerStyle ? headerStyle.backgroundColor : null,
                tabBarBorder,
                titleBg: titleStyle ? titleStyle.backgroundColor : null,
                titleFg: titleStyle ? titleStyle.color : null,
                activeTabIndicator,
                copyBtnFg,
                copyBtnBorder,
              },
              leakage: {
                markerFont: markerStyle ? markerStyle.fontFamily : null,
                markerBg: markerStyle ? markerStyle.backgroundColor : null,
                markerColor: markerStyle ? markerStyle.color : null,
                markerBorder: markerStyle ? (markerStyle.borderTopColor || markerStyle.borderColor) : null,
              },
              tokens,
              hasBookChrome: Boolean(bookChromeEl),
              hasBookNavArrows: Boolean(bookNavArrows || bookNavArrow),
              hasChapterActive: Boolean(chapterActive),
              chapterActiveFontWeight: chapterActive ? window.getComputedStyle(chapterActive).fontWeight : null,
              hasNestedNavGroup: Boolean(document.querySelector(".tfsl-nav-tree details summary")),
              bookNavPrev: Boolean(bookNavPrev),
              bookNavNext: Boolean(bookNavNext),
            };
          });

          if (!obs.hasEc || !obs.hasSidebar || !obs.hasMark || !obs.hasIns || !obs.hasDel || !obs.hasCopyButton) throw new Error(`Missing code controls/states: ${JSON.stringify(obs)}`);
          if (obs.chromeOverflow) throw new Error("Frame chrome overflows viewport");
          if (expectedValues.frame === "terminal" && !obs.frameClass.includes("is-terminal")) throw new Error("Terminal frame absent");
          if (expectedValues.frame === "plain" && obs.frameHeaderVisible) throw new Error("Plain frame has visible header");
          if (expectedValues.frame === "editor" && (!obs.frameHeaderVisible || obs.frameClass.includes("is-terminal"))) throw new Error("Editor frame absent");
          for (const [field,key] of [["markVariable","marked"],["insVariable","inserted"],["delVariable","deleted"]]) {
            const expectedMark = expectedValues.marks?.[mode]?.[key] || expectedValues.marks?.[key];
            if (expectedMark && !colorMatches(obs[field], expectedMark)) throw new Error(`Marker ${key} color mismatch: ${obs[field]} != ${expectedMark}`);
          }
          if (expectedValues.isPairedCandidate) {
            // R2-D: Derive token and chrome expectations from generated model intent
            const syntaxModel = expectedValues.syntaxModel || flexokiSyntaxModel;
            const expectedKw = syntaxModel.syntax[mode].keyword;
            const expectedStr = syntaxModel.syntax[mode].string;
            const expectedCmt = syntaxModel.syntax[mode].comment;
            const expectedEditorBg = syntaxModel.chrome[mode].background;
            const expectedTabBarBg = syntaxModel.chrome[mode].tabBarBackground || expectedEditorBg;
            const expectedTabBarBorder = syntaxModel.chrome[mode].tabBarBorder || syntaxModel.chrome[mode].border;
            const expectedActiveTabBg = syntaxModel.chrome[mode].activeTabBackground || expectedEditorBg;
            const expectedActiveTabFg = syntaxModel.chrome[mode].activeTabForeground || syntaxModel.chrome[mode].foreground;
            const expectedActiveTabIndicator = syntaxModel.chrome[mode].activeTabIndicator || syntaxModel.chrome[mode].focus;
            const expectedInactiveTabBorder = syntaxModel.chrome[mode].border;
            const expectedFocusBorder = syntaxModel.chrome[mode].focus;
            const expectedCopyBtnFg = syntaxModel.chrome[mode].copyButtonForeground || syntaxModel.chrome[mode].foreground;
            const expectedCopyBtnBorder = syntaxModel.chrome[mode].copyButtonBorder || syntaxModel.chrome[mode].border;

            if (!obs.hasTabs) throw new Error("Starlight <Tabs> element absent in flexoki-paired");
            if (!obs.inactiveTabBorderVar) {
              throw new Error("Inactive tab border variable --sl-tab-color-border is empty or inert!");
            }
            if (!obs.activeTabBorderVar) {
              throw new Error("Active tab border variable --sl-tab-color-border is empty or inert!");
            }
            if (!colorMatches(obs.activeTabBorderVar, expectedActiveTabIndicator, 5)) {
              throw new Error(`Active tab border variable mismatch: ${obs.activeTabBorderVar} != expected ${expectedActiveTabIndicator}`);
            }
            if (obs.activeTabBorderVar === obs.inactiveTabBorderVar) {
              throw new Error("Active tab border variable did not override inactive tab border variable!");
            }
            if (obs.activeTabBorder === obs.inactiveTabBorder) {
              throw new Error("Active tab border variable did not override inactive tab border variable!");
            }
            if (!obs.tablistBorderBottom || !obs.tablistBorderBottom.includes("2px")) {
              throw new Error(`Tablist bottom border not styled by styles/tabs.css: ${obs.tablistBorderBottom}`);
            }

            if (expectedValues.bookChrome) {
              if (!obs.hasBookChrome) throw new Error("Book chrome layout element [data-tfsl-book-chrome='true'] or .tfsl-book-chrome absent in paired candidate");
              if (!obs.hasBookNavArrows) throw new Error("Book chrome nav arrows absent in paired candidate");
              if (!obs.hasChapterActive) throw new Error("Book chrome active chapter marker [data-tfsl-chapter-active='true'] absent in paired candidate");
              if (!obs.hasNestedNavGroup) throw new Error("Nested navigation group absent in book chrome sidebar");
              if (obs.chapterActiveFontWeight !== "600" && obs.chapterActiveFontWeight !== "700") {
                throw new Error(`Active chapter indicator styling not applied by styles/book.css: fontWeight ${obs.chapterActiveFontWeight}`);
              }
            }

            const kwToken = obs.tokens.find((t) => t.text === "function" || t.text === "return");
            const strToken = obs.tokens.find((t) => t.text.includes("abcdefghijklmnopqrstuvwxyz") || t.text.includes("This line was deleted"));
            const cmtToken = obs.tokens.find((t) => t.text.includes("Keyword, string, comment") || t.text.includes("//"));

            if (!kwToken) throw new Error("Keyword token ('function' or 'return') not found in code block");
            if (!strToken) throw new Error("String token not found in code block");
            if (!cmtToken) throw new Error("Comment token not found in code block");

            // Expressive Code contracts minSyntaxHighlightingColorContrast (default 5.5:1)
            // against codeBg at render time. For tokens where raw contrast is < 5.5,
            // Expressive Code darkens (on light) or lightens (on dark) to reach >= 5.5:1.
            const tokenVerifications = [];
            for (const [tokenObj, expectedHex, roleName] of [
              [kwToken, expectedKw, "keyword"],
              [strToken, expectedStr, "string"],
              [cmtToken, expectedCmt, "comment"],
            ]) {
              const reqContrast = calculateContrastRatio(expectedHex, expectedEditorBg);
              const obsContrast = calculateContrastRatio(tokenObj.color, obs.computedCodeBg || expectedEditorBg);
              if (reqContrast >= 5.5) {
                if (!colorMatches(tokenObj.color, expectedHex, 2)) {
                  throw new Error(`${roleName} token color mismatch: observed ${tokenObj.color} != expected ${expectedHex} (contrast ${reqContrast.toFixed(2)}:1 >= 5.5:1)`);
                }
                tokenVerifications.push({ role: roleName, requested: expectedHex, observed: tokenObj.color, reqContrast, obsContrast, normalized: false });
              } else {
                // Expressive code contrast normalization (F7: assert strict >= 5.5 contract)
                if (obsContrast < 5.5) {
                  throw new Error(`${roleName} token contrast normalization failed: observed contrast ${obsContrast.toFixed(2)}:1 < minimum 5.5:1 (requested ${expectedHex} had ${reqContrast.toFixed(2)}:1)`);
                }
                const reqLum = getRelativeLuminance(parseColor(expectedHex));
                const obsLum = getRelativeLuminance(parseColor(tokenObj.color));
                const bgLum = getRelativeLuminance(parseColor(expectedEditorBg));
                if (bgLum > 0.5 && obsLum > reqLum + 0.05) {
                  throw new Error(`${roleName} token luminance increased on light background instead of darkening`);
                }
                if (bgLum <= 0.5 && obsLum < reqLum - 0.05) {
                  throw new Error(`${roleName} token luminance decreased on dark background instead of lightening`);
                }
                tokenVerifications.push({ role: roleName, requested: expectedHex, observed: tokenObj.color, reqContrast, obsContrast, normalized: true });
              }
            }
            obs.tokenVerifications = tokenVerifications;

            // R2-E / F2 / F3 / F4: Non-vacuous Chrome roles validation
            if (!obs.computedCodeBg || isTransparent(obs.computedCodeBg)) {
              throw new Error(`Editor code background is missing or transparent: ${obs.computedCodeBg}`);
            }
            if (!colorMatches(obs.computedCodeBg, expectedEditorBg, 2)) {
              throw new Error(`Editor code background mismatch: ${obs.computedCodeBg} != ${expectedEditorBg}`);
            }
            if (obs.computedFrameBg && !isTransparent(obs.computedFrameBg) && !colorMatches(obs.computedFrameBg, expectedEditorBg, 2)) {
              throw new Error(`Editor frame background mismatch: ${obs.computedFrameBg} != ${expectedEditorBg}`);
            }
            if (!obs.chromeRoles.titleBg || isTransparent(obs.chromeRoles.titleBg)) {
              throw new Error(`Active tab title background is missing or transparent: ${obs.chromeRoles.titleBg}`);
            }
            if (!colorMatches(obs.chromeRoles.titleBg, expectedActiveTabBg, 2)) {
              throw new Error(`Active tab background mismatch: ${obs.chromeRoles.titleBg} != ${expectedActiveTabBg}`);
            }
            if (!obs.chromeRoles.titleFg || isTransparent(obs.chromeRoles.titleFg)) {
              throw new Error(`Active tab title foreground is missing or transparent: ${obs.chromeRoles.titleFg}`);
            }
            if (!colorMatches(obs.chromeRoles.titleFg, expectedActiveTabFg, 10)) {
              throw new Error(`Active tab foreground mismatch: ${obs.chromeRoles.titleFg} != ${expectedActiveTabFg}`);
            }
            if (!obs.chromeRoles.copyBtnFg || isTransparent(obs.chromeRoles.copyBtnFg)) {
              throw new Error(`Copy button foreground is missing or transparent: ${obs.chromeRoles.copyBtnFg}`);
            }
            if (!colorMatches(obs.chromeRoles.copyBtnFg, expectedCopyBtnFg, 10)) {
              throw new Error(`Copy button foreground mismatch: ${obs.chromeRoles.copyBtnFg} != ${expectedCopyBtnFg}`);
            }
            if (!obs.chromeRoles.copyBtnBorder || isTransparent(obs.chromeRoles.copyBtnBorder)) {
              throw new Error(`Copy button border is missing or transparent: ${obs.chromeRoles.copyBtnBorder}`);
            }
            if (!colorMatches(obs.chromeRoles.copyBtnBorder, expectedCopyBtnBorder, 10)) {
              throw new Error(`Copy button border mismatch: ${obs.chromeRoles.copyBtnBorder} != ${expectedCopyBtnBorder}`);
            }
            if (!obs.chromeRoles.tabBarBorder || isTransparent(obs.chromeRoles.tabBarBorder)) {
              throw new Error(`Tab bar border is missing or transparent: ${obs.chromeRoles.tabBarBorder}`);
            }
            if (!colorMatches(obs.chromeRoles.tabBarBorder, expectedTabBarBorder, 10)) {
              throw new Error(`Tab bar border mismatch: ${obs.chromeRoles.tabBarBorder} != ${expectedTabBarBorder}`);
            }
            if (!obs.chromeRoles.activeTabIndicator || isTransparent(obs.chromeRoles.activeTabIndicator)) {
              throw new Error(`Active tab indicator is missing or transparent: ${obs.chromeRoles.activeTabIndicator}`);
            }
            if (!colorMatches(obs.chromeRoles.activeTabIndicator, expectedActiveTabIndicator, 10)) {
              throw new Error(`Active tab indicator mismatch: ${obs.chromeRoles.activeTabIndicator} != ${expectedActiveTabIndicator}`);
            }

            // R2-E / F5: Non-vacuous style leakage validation against consumer stylesheet
            if (!obs.leakage.markerBg || obs.leakage.markerBg !== "rgb(26, 43, 60)") {
              throw new Error(`Consumer custom marker background altered by theme leakage: ${obs.leakage.markerBg}`);
            }
            if (!obs.leakage.markerColor || obs.leakage.markerColor !== "rgb(208, 225, 242)") {
              throw new Error(`Consumer custom marker text color altered by theme leakage: ${obs.leakage.markerColor}`);
            }
            if (!obs.leakage.markerBorder || !obs.leakage.markerBorder.includes("rgb(255, 85, 0)")) {
              throw new Error(`Consumer custom marker border altered by theme leakage: ${obs.leakage.markerBorder}`);
            }
            if (!obs.leakage.markerFont || !obs.leakage.markerFont.toLowerCase().includes("monospace")) {
              throw new Error(`Consumer custom marker font altered by theme leakage: ${obs.leakage.markerFont}`);
            }
            if (obs.computedCodeBg && colorMatches(obs.leakage.markerBg, obs.computedCodeBg)) {
              throw new Error("Code background leaked onto consumer custom marker element");
            }
          }
          // Test keyboard visible focus on copy button if present
          let copyFocusStyle = null;
          let copyFeedback = null;
          if (obs.hasCopyButton) {
            await page.keyboard.press("Tab");
            await page.locator(".expressive-code .copy button, .expressive-code button").first().focus();
            copyFocusStyle = await page.evaluate(() => {
              const el = document.activeElement;
              if (!el) return null;
              const cs = window.getComputedStyle(el);
              return {
                tagName: el.tagName,
                outlineColor: cs.outlineColor,
                outlineWidth: cs.outlineWidth,
                outlineStyle: cs.outlineStyle,
              };
            });

            if (!copyFocusStyle || parseFloat(copyFocusStyle.outlineWidth) < 1 || copyFocusStyle.outlineStyle === "none") throw new Error("Copy control lacks keyboard-visible focus");
            if (expectedValues.isPairedCandidate && copyFocusStyle.outlineColor) {
              const syntaxModel = expectedValues.syntaxModel || flexokiSyntaxModel;
              const expectedFocusBorder = syntaxModel.chrome[mode].focus;
              if (!colorMatches(copyFocusStyle.outlineColor, expectedFocusBorder, 5)) {
                throw new Error(`Copy focus outline color mismatch: ${copyFocusStyle.outlineColor} != ${expectedFocusBorder}`);
              }
            }

            await page.evaluate(() => {
              document.querySelectorAll(".feedback").forEach((el) => el.remove());
              window.__copied = null;
              Object.defineProperty(navigator, "clipboard", {
                configurable: true,
                value: { writeText: async (text) => { window.__copied = text; } },
              });
            });
            await page.keyboard.press("Enter");
            await page.waitForFunction(() => typeof window.__copied === "string");
            const copied = await page.evaluate(() => window.__copied);
            if (!copied.includes("markedLine")) throw new Error("Keyboard copy did not copy original sample");

            // R2-E: Query feedback tooltip element (.feedback) created upon successful copy
            await page.waitForFunction(
              () => {
                const fb = document.querySelector(".expressive-code .copy [aria-live] .feedback, .expressive-code .copy .feedback");
                return fb && fb.textContent && fb.textContent.includes("Copied!");
              },
              { timeout: 3000 }
            ).catch(() => null);

            copyFeedback = await page.evaluate(() => {
              const fb = document.querySelector(".expressive-code .copy [aria-live] .feedback, .expressive-code .copy .feedback");
              if (!fb) return null;
              const cs = window.getComputedStyle(fb);
              return {
                text: fb.textContent ? fb.textContent.trim() : "",
                backgroundColor: cs.backgroundColor,
                color: cs.color,
                className: fb.className,
              };
            });

            if (expectedValues.isPairedCandidate) {
              if (!copyFeedback || !copyFeedback.text.includes("Copied!")) {
                throw new Error("Copy feedback tooltip not displayed on successful keyboard copy");
              }
            }
          }
          // Assertions
          if (obs.hasHorizontalOverflow) {
            throw new Error(`Horizontal overflow detected at width ${vp.width} in ${mode} mode`);
          }

          // Core pre layer check: code background must match theme code background, not Starlight default
          if (expectedValues.codeBg && obs.computedCodeBg) {
            const expBg = expectedValues.codeBg[mode];
            if (expBg && !colorMatches(obs.computedCodeBg, expBg)) {
              throw new Error(`Code bg ${obs.computedCodeBg} != ${expBg}`);
            }
          }

          let screenInfo = null;
          if (expectedValues.isPairedCandidate && vp.width === 1440) {
            const prefix = expectedValues.scenarioPrefix || "flexoki-paired";
            const screenName = `code-${prefix}-${mode}.png`;
            const screenBytes = await page.screenshot({ path: join(evidenceDir, screenName), fullPage: true });
            screenInfo = { file: screenName, sha256: sha256(screenBytes) };
          }
          records.push({
            screenshot: screenInfo,
            mode,
            width: vp.width,
            ...obs,
            copyFocusStyle,
            copyFeedback,
          });
        }
      }

      if (expectedValues.bookChrome) {
        await page.goto(`http://127.0.0.1:${serverPort}/`);
        await page.keyboard.press("ArrowRight");
        await page.waitForTimeout(200);
        const navigatedUrl = page.url();
        if (!navigatedUrl.includes("/guide")) {
          throw new Error(`Keyboard shortcut ArrowRight navigation failed: url was ${navigatedUrl}`);
        }
        await page.keyboard.press("ArrowLeft");
        await page.waitForTimeout(200);
        const backUrl = page.url();
        if (backUrl.includes("/guide")) {
          throw new Error(`Keyboard shortcut ArrowLeft navigation failed: url was ${backUrl}`);
        }
        for (const r of records) {
          r.bookChromeVerified = true;
          r.keyboardNavVerified = true;
        }
      }

      await page.close();
      return records;
    };

    // 2. Browser Matrix: 3 Fixtures x 2 Modes x 3 Viewports
    console.log("14. Evaluating 3 Fixtures x 2 Modes x 3 Viewports...");

    // Fixture 1: Black Code
    const blackServer = await startStaticServer(join(consumerDir, "dist/black-code"), 0);
    try {
      const records = await evaluateScenarioPage(blackServer.port, {
        codeBg: { dark: "#090a0d", light: "#f1f5f9" }, frame: "terminal", marks: blackSpec.codePresentation.marks,
      });
      browserObservations.scenarios["black-code"] = records;
      console.log("   ✓ Black code scenario passed (terminal frame, marks, copy focus, no overflow).");
    } finally {
      await blackServer.close();
    }

    // Fixture 2: Flexoki Code (default blue)
    const flexokiServer = await startStaticServer(join(consumerDir, "dist/flexoki-code"), 0);
    try {
      const records = await evaluateScenarioPage(flexokiServer.port, {
        codeBg: { dark: "#11100f", light: "#f3efe4" }, frame: "editor", marks: flexokiSpec.codePresentation.marks,
      });
      browserObservations.scenarios["flexoki-code"] = records;
      console.log("   ✓ Flexoki code scenario passed (editor frame, marks, copy focus, no overflow).");
    } finally {
      await flexokiServer.close();
    }

    // Fixture 3: Celestia Code
    const celestiaServer = await startStaticServer(join(consumerDir, "dist/celestia-code"), 0);
    try {
      const records = await evaluateScenarioPage(celestiaServer.port, {
        codeBg: { dark: "#07060f", light: "#f0eef9" }, frame: "plain", marks: celestiaSpec.codePresentation.marks,
      });
      browserObservations.scenarios["celestia-code"] = records;
      console.log("   ✓ Celestia code scenario passed (plain frame, minimal copy, marks, no overflow).");
    } finally {
      await celestiaServer.close();
    }

    // Fixture 4: Flexoki Paired Candidate (F6)
    const flexokiPairedServer = await startStaticServer(join(consumerDir, "dist/flexoki-paired"), 0);
    try {
      const records = await evaluateScenarioPage(flexokiPairedServer.port, {
        codeBg: {
          dark: flexokiSyntaxModel.chrome.dark.background,
          light: flexokiSyntaxModel.chrome.light.background,
        },
        frame: "editor",
        syntaxModel: flexokiSyntaxModel,
        marks: {
          dark: {
            marked: flexokiSyntaxModel.diffs.dark.markedBackground,
            inserted: flexokiSyntaxModel.diffs.dark.insertedBackground,
            deleted: flexokiSyntaxModel.diffs.dark.deletedBackground,
          },
          light: {
            marked: flexokiSyntaxModel.diffs.light.markedBackground,
            inserted: flexokiSyntaxModel.diffs.light.insertedBackground,
            deleted: flexokiSyntaxModel.diffs.light.deletedBackground,
          },
        },
        isPairedCandidate: true,
        bookChrome: true,
        scenarioPrefix: "flexoki-paired",
      });
      browserObservations.scenarios["flexoki-paired"] = records;
      console.log("   ✓ Flexoki paired candidate scenario passed (syntax tokens, tabs, editor frame, marks, copy focus, book chrome, no overflow).");
    } finally {
      await flexokiPairedServer.close();
    }

    // Fixture 4b: Flexoki Paired TypeScript Package Mode (F1, F6, F8)
    const flexokiPairedTsServer = await startStaticServer(join(consumerDir, "dist/flexoki-paired-ts"), 0);
    try {
      const records = await evaluateScenarioPage(flexokiPairedTsServer.port, {
        codeBg: {
          dark: flexokiSyntaxModel.chrome.dark.background,
          light: flexokiSyntaxModel.chrome.light.background,
        },
        frame: "editor",
        syntaxModel: flexokiSyntaxModel,
        marks: {
          dark: {
            marked: flexokiSyntaxModel.diffs.dark.markedBackground,
            inserted: flexokiSyntaxModel.diffs.dark.insertedBackground,
            deleted: flexokiSyntaxModel.diffs.dark.deletedBackground,
          },
          light: {
            marked: flexokiSyntaxModel.diffs.light.markedBackground,
            inserted: flexokiSyntaxModel.diffs.light.insertedBackground,
            deleted: flexokiSyntaxModel.diffs.light.deletedBackground,
          },
        },
        isPairedCandidate: true,
        bookChrome: true,
        scenarioPrefix: "flexoki-paired-ts",
      });
      browserObservations.scenarios["flexoki-paired-ts"] = records;
      console.log("   ✓ Flexoki paired TS package scenario passed (full parity with JS package in real consumer).");
    } finally {
      await flexokiPairedTsServer.close();
    }

    // 3. All 8 Flexoki Accents x 2 Modes at 768
    console.log("15. Evaluating All 8 Flexoki Accents x 2 Modes at 768px tablet viewport...");
    const flexokiTokenSet = flexokiSpec.tokenSets["flexoki-palette"];
    for (const accent of FLEXOKI_ACCENTS) {
      const server = await startStaticServer(join(consumerDir, `dist/flexoki-${accent}`), 0);
      try {
        const expectedDarkAccent = flexokiTokenSet[`acc-${accent}-base-dark`];
        const expectedLightAccent = flexokiTokenSet[`acc-${accent}-base-light`];
        const records = await evaluateScenarioPage(server.port, {
          viewports: [{ name: "tablet", width: 768, height: 1024 }],
          codeBg: { dark: "#11100f", light: "#f3efe4" }, frame: "editor", marks: flexokiSpec.codePresentation.marks,
        });

        // Verify accent base color
        for (const r of records) {
          const expected = r.mode === "dark" ? expectedDarkAccent : expectedLightAccent;
          if (!colorMatches(r.accentColor, expected)) {
            throw new Error(`Flexoki ${accent} ${r.mode}: ${r.accentColor} != ${expected}`);
          }
        }
        browserObservations.scenarios[`flexoki-${accent}`] = records;
      } finally {
        await server.close();
      }
    }
    console.log("   ✓ All 8 Flexoki accents evaluated at 768px in dark and light modes.");

    // 4. False EC Control (normal Markdown without Expressive Code)
    console.log("16. Evaluating False EC Control scenario...");
    const falseEcServer = await startStaticServer(join(consumerDir, "dist/false-ec"), 0);
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${falseEcServer.port}/`);
      const ecCount = await page.evaluate(() => document.querySelectorAll(".expressive-code").length);
      const preCount = await page.evaluate(() => document.querySelectorAll("pre").length);
      if (ecCount !== 0) {
        throw new Error(`Expected 0 .expressive-code elements with expressiveCode: false, got ${ecCount}`);
      }
      if (preCount === 0) {
        throw new Error("Expected standard markdown <pre> element to be rendered when expressiveCode is false");
      }
      browserObservations.scenarios["false-ec"] = { ecCount, preCount, passed: true };
      await page.close();
      console.log("   ✓ False EC control passed (renders normal markdown <pre><code>, zero .expressive-code).");
    } finally {
      await falseEcServer.close();
    }

    // 5. Consumer Leaf Precedence
    console.log("17. Evaluating Consumer Leaf Precedence scenario...");
    const leafServer = await startStaticServer(join(consumerDir, "dist/consumer-leaf"), 0);
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${leafServer.port}/`);
      const ecCount = await page.evaluate(() => document.querySelectorAll(".expressive-code").length);
      if (ecCount === 0) {
        throw new Error("Expected .expressive-code elements in consumer-leaf scenario");
      }
      const background = await page.locator(".expressive-code pre").first().evaluate(el => getComputedStyle(el).backgroundColor);
      if (!colorMatches(background, "#123456")) throw new Error(`Consumer frame leaf did not win: ${background}`);
      browserObservations.scenarios["consumer-leaf"] = { ecCount, background, passed: true };
      await page.close();
      console.log("   ✓ Consumer leaf precedence passed.");
    } finally {
      await leafServer.close();
    }

    // 6. Consumer Arrays Replacement
    console.log("18. Evaluating Consumer Arrays Replacement scenario...");
    const arraysServer = await startStaticServer(join(consumerDir, "dist/consumer-arrays"), 0);
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${arraysServer.port}/`);
      const ecCount = await page.evaluate(() => document.querySelectorAll(".expressive-code").length);
      if (ecCount === 0) throw new Error("Consumer array control missing code");
      const themeCount = await page.locator(".expressive-code").first().evaluate(el => getComputedStyle(el).getPropertyValue("--ec-theme-id").trim());
      const installedPlugin = (await import(pathToFileURL(join(consumerDir, "node_modules/@smoke/starlight-theme-loom-black-code/index.js")).href)).default();
      let update;
      installedPlugin.hooks["config:setup"]({config:{expressiveCode:{themes:["github-light"]}},updateConfig(v){update=v;}});
      if (JSON.stringify(update.expressiveCode.themes) !== '["github-light"]') throw new Error("Installed consumer arrays were merged");
      browserObservations.scenarios["consumer-arrays"] = { ecCount, themeCount, themes: update.expressiveCode.themes, passed: true };
      await page.close();
      console.log("   ✓ Consumer arrays replacement passed.");
    } finally {
      await arraysServer.close();
    }

    // 7. Custom CSS Overrides
    console.log("19. Evaluating Custom CSS scenario...");
    const customCssServer = await startStaticServer(join(consumerDir, "dist/custom-css"), 0);
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${customCssServer.port}/`);
      const hairline = await page.evaluate(() =>
        window.getComputedStyle(document.documentElement).getPropertyValue("--sl-color-hairline").trim()
      );
      if (!colorMatches(hairline, "#e11d48")) {
        throw new Error(`Custom CSS hairline mismatch: ${hairline}`);
      }
      const codeStyle = await page.locator(".expressive-code pre").first().evaluate(el => ({ background: getComputedStyle(el).backgroundColor, fontSize: getComputedStyle(el.querySelector("code")).fontSize }));
      if (!colorMatches(codeStyle.background, "#203040") || codeStyle.fontSize !== "18px") throw new Error(`Consumer code CSS failed: ${JSON.stringify(codeStyle)}`);
      browserObservations.scenarios["custom-css"] = { hairline, codeStyle, passed: true };
      await page.close();
      console.log("   ✓ Custom CSS overrides evaluated.");
    } finally {
      await customCssServer.close();
    }

    // 8. PageTitle Component Precedence
    console.log("20. Evaluating PageTitle Component Precedence scenario...");
    const titleServer = await startStaticServer(join(consumerDir, "dist/page-title-precedence"), 0);
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${titleServer.port}/`);
      const overrideObs = await page.evaluate(() => {
        const frame = document.querySelectorAll(".tfsl-page-title-frame");
        const consumerOverride = document.querySelectorAll("[data-test-override='consumer-owned']");
        const h1s = document.querySelectorAll("h1");
        return {
          frameCount: frame.length,
          consumerOverrideCount: consumerOverride.length,
          h1Count: h1s.length,
        };
      });
      if (overrideObs.frameCount !== 0) {
        throw new Error("Consumer PageTitle override mode still contains .tfsl-page-title-frame!");
      }
      if (overrideObs.consumerOverrideCount !== 1) {
        throw new Error("Consumer PageTitle override component was not rendered!");
      }
      browserObservations.scenarios["page-title-precedence"] = overrideObs;
      await page.close();
      console.log("   ✓ Consumer PageTitle precedence passed.");
    } finally {
      await titleServer.close();
    }

    // 9. Solar Sail Paired Consumer Fixture Verification (Outcomes E & F)
    console.log("21. Evaluating Solar Sail Flexoki Paired Consumer Fixture (Vite + React + Tailwind v4 + shadcn)...");
    const ssSpec = solarSailDist.mapProfileToSolarSail(flexokiProfile);
    const ssThemeDir = join(workDir, "solar-sail-flexoki-pkg");
    const ssPkgRes = solarSailDist.generateThemePackage({
      themeSpec: ssSpec,
      metadata: {
        name: "@knowledge-forge-ai/app-theme-forge-console",
        version: "0.1.0",
        description: "Solar Sail Flexoki paired consumer theme",
      },
      language: "typescript",
    });
    await solarSailDist.writePackageFiles(ssPkgRes.files, ssThemeDir);
    const tscBin = existsSync(resolve(REPO_ROOT, "node_modules/typescript/bin/tsc"))
      ? resolve(REPO_ROOT, "node_modules/typescript/bin/tsc")
      : (existsSync(join(fixtureNodeModules, "typescript/bin/tsc")) ? join(fixtureNodeModules, "typescript/bin/tsc") : "tsc");
    execFileSync(process.execPath, [tscBin, "-p", "tsconfig.json"], { cwd: ssThemeDir, stdio: "pipe" });
    const ssPackRaw = execFileSync("npm", ["pack", "--json"], { cwd: ssThemeDir, encoding: "utf8" });
    const ssTarballPath = join(ssThemeDir, JSON.parse(ssPackRaw)[0].filename);

    const ssConsumerDir = join(workDir, "solar-sail-consumer");
    const SS_CONSUMER_FIXTURE_SRC = resolve(SOLAR_SAIL_ROOT, "consumer-fixture");
    await cp(SS_CONSUMER_FIXTURE_SRC, ssConsumerDir, {
      recursive: true,
      filter: (src) => !["node_modules", "dist"].includes(basename(src)),
    });
    const ssFixtureNodeModules = join(SS_CONSUMER_FIXTURE_SRC, "node_modules");
    if (existsSync(ssFixtureNodeModules)) {
      await cp(ssFixtureNodeModules, join(ssConsumerDir, "node_modules"), { recursive: true });
    }
    const targetDir = join(ssConsumerDir, "node_modules/@knowledge-forge-ai/app-theme-forge-console");
    await rm(targetDir, { recursive: true, force: true });
    await mkdir(targetDir, { recursive: true });
    execFileSync("tar", ["-xzf", ssTarballPath, "-C", targetDir, "--strip-components=1"]);

    const ssViteBuild = spawnSync("npm", ["run", "build"], {
      cwd: ssConsumerDir,
      stdio: "pipe",
      encoding: "utf8",
    });
    if (ssViteBuild.status !== 0) {
      throw new Error(`Solar Sail consumer fixture build failed:\n${ssViteBuild.stderr || ssViteBuild.stdout}`);
    }

    const ssServer = await startStaticServer(join(ssConsumerDir, "dist"), 0);
    const ssObservations = {
      viewports: {},
      passed: false,
    };

    try {
      const ssPage = await browser.newPage();
      await ssPage.route("**/*", (route) => {
        const reqUrl = route.request().url();
        const urlObj = new URL(reqUrl);
        if (urlObj.hostname === "127.0.0.1" || urlObj.hostname === "localhost") {
          route.continue();
        } else {
          browserObservations.externalRequestsRejected++;
          route.abort("blockedbyclient");
        }
      });

      await ssPage.goto(`http://127.0.0.1:${ssServer.port}/`);

      const ssViewports = [
        { name: "desktop-wide", width: 1440, height: 900 },
        { name: "desktop", width: 1280, height: 800 },
        { name: "mobile", width: 390, height: 844 },
      ];

      const expectedLightBtn = "rgb(36, 131, 123)"; // #24837b
      const expectedDarkBtn = "rgb(58, 169, 159)";  // #3aa99f
      const expectedLightBg = "rgb(255, 252, 240)"; // #fffcf0
      const expectedDarkBg = "rgb(16, 15, 15)";     // #100f0f

      for (const vp of ssViewports) {
        await ssPage.setViewportSize({ width: vp.width, height: vp.height });

        // Ensure Light Mode
        const isCurrentlyDark = await ssPage.evaluate(() => document.documentElement.classList.contains("dark"));
        if (isCurrentlyDark) {
          await ssPage.click("#theme-toggle-btn");
          await ssPage.mouse.move(0, 0);
          await ssPage.waitForFunction(() => !document.documentElement.classList.contains("dark"));
          await ssPage.waitForTimeout(200);
        } else {
          await ssPage.mouse.move(0, 0);
          await ssPage.waitForTimeout(50);
        }

        // --- LIGHT MODE ---
        const lightObs = await ssPage.evaluate(() => {
          const btn = document.getElementById("theme-toggle-btn");
          const secBtn = document.getElementById("action-btn");
          const card = document.getElementById("test-card");
          const input = document.getElementById("test-input");
          const main = document.querySelector("main");
          const body = document.body;
          const overrideMarker = document.getElementById("override-marker");
          const tokenOverrideBtn = document.getElementById("override-token-btn");
          const specMarker = document.getElementById("theme-spec-marker");
          const hasOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
          return {
            btnBg: btn ? window.getComputedStyle(btn).backgroundColor : null,
            btnColor: btn ? window.getComputedStyle(btn).color : null,
            secBtnBg: secBtn ? window.getComputedStyle(secBtn).backgroundColor : null,
            cardBg: card ? window.getComputedStyle(card).backgroundColor : null,
            cardRadius: card ? window.getComputedStyle(card).borderRadius : null,
            inputBorder: input ? window.getComputedStyle(input).borderColor : null,
            mainBg: main ? window.getComputedStyle(main).backgroundColor : null,
            bodyBg: body ? window.getComputedStyle(body).backgroundColor : null,
            overrideMarkerBg: overrideMarker ? window.getComputedStyle(overrideMarker).backgroundColor : null,
            tokenOverrideBtnBg: tokenOverrideBtn ? window.getComputedStyle(tokenOverrideBtn).backgroundColor : null,
            themeName: specMarker ? specMarker.getAttribute("data-theme-name") : null,
            hasHorizontalOverflow: hasOverflow,
          };
        });

        if (!colorMatches(lightObs.btnBg, "#24837b", 5)) {
          throw new Error(`Solar Sail light primary button color mismatch: observed ${lightObs.btnBg} != expected #24837b`);
        }
        if (!colorMatches(lightObs.secBtnBg, "#e6e4d9", 5)) {
          throw new Error(`Solar Sail light secondary button color mismatch: observed ${lightObs.secBtnBg} != expected #e6e4d9`);
        }
        if (!colorMatches(lightObs.cardBg, "#f2f0e5", 5)) {
          throw new Error(`Solar Sail light card surface color mismatch: observed ${lightObs.cardBg} != expected #f2f0e5`);
        }
        if (!colorMatches(lightObs.inputBorder, "#cecdc3", 5)) {
          throw new Error(`Solar Sail light input border color mismatch: observed ${lightObs.inputBorder} != expected #cecdc3`);
        }
        if (!colorMatches(lightObs.mainBg, "#fffcf0", 5) && !colorMatches(lightObs.bodyBg, "#fffcf0", 5)) {
          throw new Error(`Solar Sail light background color mismatch: observed main=${lightObs.mainBg}, body=${lightObs.bodyBg} != expected #fffcf0`);
        }
        if (lightObs.hasHorizontalOverflow) {
          throw new Error(`Solar Sail light mode horizontal overflow detected at ${vp.width}x${vp.height}`);
        }
        if (!colorMatches(lightObs.overrideMarkerBg, "#e11d48", 5)) {
          throw new Error(`Solar Sail custom override marker mismatch: ${lightObs.overrideMarkerBg}`);
        }
        if (!colorMatches(lightObs.tokenOverrideBtnBg, "#9333ea", 5)) {
          throw new Error(`Solar Sail token cascade precedence mismatch: ${lightObs.tokenOverrideBtnBg}`);
        }

        const lightScreenshotPath = join(evidenceDir, `solar-sail-flexoki-light-${vp.name}.png`);
        await ssPage.screenshot({ path: lightScreenshotPath, fullPage: false });

        // --- DARK MODE ---
        await ssPage.click("#theme-toggle-btn");
        await ssPage.mouse.move(0, 0);
        await ssPage.waitForFunction(() => document.documentElement.classList.contains("dark"));
        await ssPage.waitForTimeout(200);

        const darkObs = await ssPage.evaluate(() => {
          const btn = document.getElementById("theme-toggle-btn");
          const secBtn = document.getElementById("action-btn");
          const card = document.getElementById("test-card");
          const input = document.getElementById("test-input");
          const main = document.querySelector("main");
          const body = document.body;
          const hasOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
          return {
            btnBg: btn ? window.getComputedStyle(btn).backgroundColor : null,
            btnColor: btn ? window.getComputedStyle(btn).color : null,
            secBtnBg: secBtn ? window.getComputedStyle(secBtn).backgroundColor : null,
            cardBg: card ? window.getComputedStyle(card).backgroundColor : null,
            inputBorder: input ? window.getComputedStyle(input).borderColor : null,
            mainBg: main ? window.getComputedStyle(main).backgroundColor : null,
            bodyBg: body ? window.getComputedStyle(body).backgroundColor : null,
            hasHorizontalOverflow: hasOverflow,
          };
        });

        if (!colorMatches(darkObs.btnBg, "#3aa99f", 5)) {
          throw new Error(`Solar Sail dark primary button color mismatch: observed ${darkObs.btnBg} != expected #3aa99f`);
        }
        if (!colorMatches(darkObs.secBtnBg, "#282726", 5)) {
          throw new Error(`Solar Sail dark secondary button color mismatch: observed ${darkObs.secBtnBg} != expected #282726`);
        }
        if (!colorMatches(darkObs.cardBg, "#1c1b1a", 5)) {
          throw new Error(`Solar Sail dark card surface color mismatch: observed ${darkObs.cardBg} != expected #1c1b1a`);
        }
        if (!colorMatches(darkObs.inputBorder, "#343331", 5)) {
          throw new Error(`Solar Sail dark input border color mismatch: observed ${darkObs.inputBorder} != expected #343331`);
        }
        if (!colorMatches(darkObs.mainBg, "#100f0f", 5) && !colorMatches(darkObs.bodyBg, "#100f0f", 5)) {
          throw new Error(`Solar Sail dark background color mismatch: observed main=${darkObs.mainBg}, body=${darkObs.bodyBg} != expected #100f0f`);
        }
        if (darkObs.hasHorizontalOverflow) {
          throw new Error(`Solar Sail dark mode horizontal overflow detected at ${vp.width}x${vp.height}`);
        }

        const darkScreenshotPath = join(evidenceDir, `solar-sail-flexoki-dark-${vp.name}.png`);
        await ssPage.screenshot({ path: darkScreenshotPath, fullPage: false });

        // Toggle back to light mode for next viewport iteration
        await ssPage.click("#theme-toggle-btn");
        await ssPage.mouse.move(0, 0);
        await ssPage.waitForFunction(() => !document.documentElement.classList.contains("dark"));
        await ssPage.waitForTimeout(200);

        ssObservations.viewports[vp.name] = { light: lightObs, dark: darkObs };
      }

      await ssPage.close();
      ssObservations.passed = true;
      browserObservations.solarSailPairedConsumer = ssObservations;
      console.log("   ✓ Solar Sail Flexoki consumer fixture verified (light/dark primary colors, cascade precedence, viewports, zero overflow).");
    } finally {
      await ssServer.close();
    }

    if (browserObservations.externalRequestsRejected !== 0) {
      throw new Error(`Observed ${browserObservations.externalRequestsRejected} rejected external network requests.`);
    }

    receipt.browserObservations = browserObservations;
  } finally {
    await browser.close();
  }

  // -------------------------------------------------------------
  // Step 10: Final Receipt Generation & Output
  // -------------------------------------------------------------
  receipt.completed = new Date().toISOString();

  // Evaluate JS vs TS parity across flexoki-paired and flexoki-paired-ts scenarios
  const jsRecords = browserObservations.scenarios["flexoki-paired"] || [];
  const tsRecords = browserObservations.scenarios["flexoki-paired-ts"] || [];
  let packageJsTsParity = jsRecords.length > 0 && jsRecords.length === tsRecords.length;
  if (packageJsTsParity) {
    for (let i = 0; i < jsRecords.length; i++) {
      const jsR = jsRecords[i];
      const tsR = tsRecords[i];
      if (
        jsR.mode !== tsR.mode ||
        jsR.width !== tsR.width ||
        jsR.computedCodeBg !== tsR.computedCodeBg ||
        jsR.computedFrameBg !== tsR.computedFrameBg ||
        jsR.tokens.length !== tsR.tokens.length ||
        jsR.hasMark !== tsR.hasMark ||
        jsR.hasIns !== tsR.hasIns ||
        jsR.hasDel !== tsR.hasDel ||
        jsR.hasCopyButton !== tsR.hasCopyButton ||
        jsR.hasHorizontalOverflow !== tsR.hasHorizontalOverflow ||
        jsR.activeTabBorderVar !== tsR.activeTabBorderVar ||
        jsR.inactiveTabBorderVar !== tsR.inactiveTabBorderVar ||
        jsR.hasBookChrome !== tsR.hasBookChrome ||
        jsR.hasBookNavArrows !== tsR.hasBookNavArrows ||
        jsR.hasChapterActive !== tsR.hasChapterActive ||
        jsR.chromeRoles?.titleBg !== tsR.chromeRoles?.titleBg ||
        jsR.chromeRoles?.titleFg !== tsR.chromeRoles?.titleFg ||
        jsR.chromeRoles?.copyBtnFg !== tsR.chromeRoles?.copyBtnFg ||
        jsR.chromeRoles?.copyBtnBorder !== tsR.chromeRoles?.copyBtnBorder ||
        jsR.chromeRoles?.tabBarBorder !== tsR.chromeRoles?.tabBarBorder ||
        jsR.chromeRoles?.activeTabIndicator !== tsR.chromeRoles?.activeTabIndicator
      ) {
        packageJsTsParity = false;
        break;
      }
    }
  }

  const tabsPresentAndDistinct = Boolean(
    browserObservations.scenarios["flexoki-paired"]?.every(
      (r) =>
        r.hasTabs &&
        r.activeTabBorderVar &&
        r.inactiveTabBorderVar &&
        r.activeTabBorderVar !== r.inactiveTabBorderVar &&
        r.tablistBorderBottom
    )
  );

  const copyFeedbackTooltipVerified = Boolean(
    browserObservations.scenarios["flexoki-paired"]?.every(
      (r) => r.copyFeedback && r.copyFeedback.text.includes("Copied!")
    ) &&
    browserObservations.scenarios["flexoki-paired-ts"]?.every(
      (r) => r.copyFeedback && r.copyFeedback.text.includes("Copied!")
    )
  );

  const contrastNormalizationVerified = Boolean(
    browserObservations.scenarios["flexoki-paired"]?.every(
      (r) =>
        Array.isArray(r.tokenVerifications) &&
        r.tokenVerifications.length === 3 &&
        r.tokenVerifications.every(
          (v) => (v.normalized ? v.obsContrast >= 5.5 : v.obsContrast >= 5.5)
        )
    ) &&
    browserObservations.scenarios["flexoki-paired-ts"]?.every(
      (r) =>
        Array.isArray(r.tokenVerifications) &&
        r.tokenVerifications.length === 3 &&
        r.tokenVerifications.every(
          (v) => (v.normalized ? v.obsContrast >= 5.5 : v.obsContrast >= 5.5)
        )
    )
  );

  const chromeRolesVerified = Boolean(
    browserObservations.scenarios["flexoki-paired"]?.every(
      (r) =>
        r.chromeRoles?.titleBg && !isTransparent(r.chromeRoles.titleBg) &&
        r.chromeRoles?.titleFg && !isTransparent(r.chromeRoles.titleFg) &&
        r.chromeRoles?.copyBtnFg && !isTransparent(r.chromeRoles.copyBtnFg) &&
        r.chromeRoles?.copyBtnBorder && !isTransparent(r.chromeRoles.copyBtnBorder) &&
        r.chromeRoles?.tabBarBorder && !isTransparent(r.chromeRoles.tabBarBorder) &&
        r.chromeRoles?.activeTabIndicator && !isTransparent(r.chromeRoles.activeTabIndicator)
    ) &&
    browserObservations.scenarios["flexoki-paired-ts"]?.every(
      (r) =>
        r.chromeRoles?.titleBg && !isTransparent(r.chromeRoles.titleBg) &&
        r.chromeRoles?.titleFg && !isTransparent(r.chromeRoles.titleFg) &&
        r.chromeRoles?.copyBtnFg && !isTransparent(r.chromeRoles.copyBtnFg) &&
        r.chromeRoles?.copyBtnBorder && !isTransparent(r.chromeRoles.copyBtnBorder) &&
        r.chromeRoles?.tabBarBorder && !isTransparent(r.chromeRoles.tabBarBorder) &&
        r.chromeRoles?.activeTabIndicator && !isTransparent(r.chromeRoles.activeTabIndicator)
    )
  );

  const noStyleLeakageVerified = Boolean(
    browserObservations.scenarios["flexoki-paired"]?.every(
      (r) =>
        r.leakage?.markerBg === "rgb(26, 43, 60)" &&
        r.leakage?.markerColor === "rgb(208, 225, 242)" &&
        r.leakage?.markerBorder?.includes("rgb(255, 85, 0)") &&
        r.leakage?.markerFont?.toLowerCase().includes("monospace") &&
        r.leakage?.markerBg !== r.computedCodeBg
    ) &&
    browserObservations.scenarios["flexoki-paired-ts"]?.every(
      (r) =>
        r.leakage?.markerBg === "rgb(26, 43, 60)" &&
        r.leakage?.markerColor === "rgb(208, 225, 242)" &&
        r.leakage?.markerBorder?.includes("rgb(255, 85, 0)") &&
        r.leakage?.markerFont?.toLowerCase().includes("monospace") &&
        r.leakage?.markerBg !== r.computedCodeBg
    )
  );

  const bookChromeVerified = Boolean(
    browserObservations.scenarios["flexoki-paired"]?.every(
      (r) => r.hasBookChrome && r.hasBookNavArrows && r.hasChapterActive && r.keyboardNavVerified
    ) &&
    browserObservations.scenarios["flexoki-paired-ts"]?.every(
      (r) => r.hasBookChrome && r.hasBookNavArrows && r.hasChapterActive && r.keyboardNavVerified
    )
  );

  const solarSailPairedConsumerVerified = Boolean(
    browserObservations.solarSailPairedConsumer?.passed
  );

  // Evidence files inventory
  const evidenceDirEntries = await readdir(evidenceDir, { withFileTypes: true });
  const evidenceFiles = [];
  for (const entry of evidenceDirEntries) {
    if (entry.isFile() && entry.name !== "receipt.json" && entry.name !== "evidence-manifest.json") {
      const filePath = join(evidenceDir, entry.name);
      const fileBytes = await readFile(filePath);
      evidenceFiles.push({
        name: entry.name,
        size: fileBytes.length,
        sha256: sha256(fileBytes),
      });
    }
  }
  receipt.evidenceFiles = evidenceFiles;
  const evidenceRetentionVerified = evidenceFiles.length > 0;

  // Promotion handling (F1, F2 namespaced)
  const defaultPromoDir = (process.env.SCRATCH_BASE_DIR || THEME_FORGE_SCRATCH_ROOT)
    ? join(process.env.SCRATCH_BASE_DIR || THEME_FORGE_SCRATCH_ROOT, "_outbox", `smoke-code-${Date.now()}`)
    : null;
  let promoTargetRaw = cliArgs.outbox;
  if (!promoTargetRaw && process.env.EVIDENCE_OUT) {
    promoTargetRaw = join(process.env.EVIDENCE_OUT, "stellar-loom");
  } else if (promoTargetRaw && process.env.EVIDENCE_OUT && resolve(promoTargetRaw) === resolve(process.env.EVIDENCE_OUT)) {
    // Prevent flat overwrite if caller passed EVIDENCE_OUT root directly
    promoTargetRaw = join(process.env.EVIDENCE_OUT, "stellar-loom");
  }
  if (!promoTargetRaw) {
    promoTargetRaw = defaultPromoDir;
  }
  let evidencePromotionSuccess = false;
  let promoTarget = null;
  if (promoTargetRaw) {
    promoTarget = promoTargetRaw.startsWith("~/")
      ? join(process.env.HOME || "", promoTargetRaw.slice(2))
      : resolve(promoTargetRaw);
    try {
      await mkdir(promoTarget, { recursive: true });
      const promotedList = [];
      for (const ef of evidenceFiles) {
        const src = join(evidenceDir, ef.name);
        const dst = join(promoTarget, ef.name);
        await copyFile(src, dst);
        const dstBytes = await readFile(dst);
        const dstHash = sha256(dstBytes);
        if (dstHash !== ef.sha256) {
          throw new Error(`Hash mismatch after promoting ${ef.name}: ${dstHash} != ${ef.sha256}`);
        }
        promotedList.push({ name: ef.name, size: dstBytes.length, sha256: dstHash });
      }
      receipt.promotedEvidence = {
        target: promoTarget,
        fileCount: promotedList.length,
        files: promotedList,
      };
      evidencePromotionSuccess = promotedList.length > 0;
    } catch (err) {
      console.error("Evidence promotion failed:", err);
      evidencePromotionSuccess = false;
    }
  }

  // Genuine scratch closeout check before recording receipt (F1, F9)
  const scratchManaged = Boolean(scratchScope);
  const scratchCloseoutRequired = Boolean(scratchScope);
  let scratchCloseoutSuccess = null;
  if (scratchManaged) {
    try {
      scratchScope.close();
      scratchCloseoutSuccess = !existsSync(workDir);
    } catch (err) {
      console.error("Scratch scope close failed:", err);
      scratchCloseoutSuccess = false;
    }
  }

  receipt.scratchLifecycle = {
    managed: scratchManaged,
    closeoutRequired: scratchCloseoutRequired,
    closeoutSucceeded: scratchCloseoutSuccess,
  };
  const scratchCloseoutCheckPassed = scratchCloseoutRequired
    ? scratchCloseoutSuccess === true
    : scratchCloseoutSuccess === null;

  receipt.checks = {
    tarballIdentityRetained: Boolean(receipt.loomTarball?.sha256),
    codeDomainExportsVerified: true,
    catalogDomainExportsVerified: true,
    fixturesDeterministicAcrossRuns: receipt.compiledThemes.length >= 12,
    codeStyleFilesVerified: true,
    consumerLockRetained: Boolean(receipt.originalLockDigest),
    browserMatrixVerified: Boolean(receipt.browserObservations),
    flexokiAll8AccentsVerified: Boolean(browserObservations.scenarios["flexoki-blue"]),
    flexokiPairedCandidateVerified: Boolean(browserObservations.scenarios["flexoki-paired"]),
    typescriptPackageCompilationVerified: Boolean(browserObservations.scenarios["flexoki-paired-ts"]),
    packageJsTsParity,
    tabsPresentationVerified: Boolean(browserObservations.scenarios["flexoki-paired"]?.every((r) => r.activeTabBorderVar && r.inactiveTabBorderVar && r.activeTabBorderVar !== r.inactiveTabBorderVar)),
    tabsPresentAndDistinct,
    syntaxTokensVerified: Boolean(browserObservations.scenarios["flexoki-paired"]?.every((r) => r.tokens && r.tokens.length > 0)),
    contrastNormalizationVerified,
    computedFrameBackgroundsVerified: Boolean(browserObservations.scenarios["flexoki-paired"]?.every((r) => r.computedCodeBg)),
    marksVerified: Boolean(browserObservations.scenarios["flexoki-paired"]?.every((r) => r.hasMark && r.hasIns && r.hasDel)),
    copyBehaviorKeyboardFocusVerified: Boolean(browserObservations.scenarios["flexoki-paired"]?.every((r) => r.copyFocusStyle)),
    copyFeedbackTooltipVerified,
    chromeRolesVerified,
    noStyleLeakageVerified,
    falseEcControlVerified: Boolean(browserObservations.scenarios["false-ec"]),
    consumerLeafPrecedenceVerified: Boolean(browserObservations.scenarios["consumer-leaf"]),
    consumerArraysPrecedenceVerified: Boolean(browserObservations.scenarios["consumer-arrays"]),
    customCssBeatsLayersVerified: Boolean(browserObservations.scenarios["custom-css"]),
    pageTitlePrecedenceVerified: Boolean(browserObservations.scenarios["page-title-precedence"]),
    noHorizontalOverflow: Boolean(browserObservations.scenarios["flexoki-paired"]?.every((r) => !r.hasHorizontalOverflow)),
    sidebarBearingRecorded: Boolean(browserObservations.scenarios["flexoki-paired"]?.every((r) => r.hasSidebar)),
    ecConfigMjsOutsideContract: receipt.ecConfigMjsOutsideContract === true,
    zeroExternalRequests: browserObservations.externalRequestsRejected === 0,
    bookChromeVerified,
    solarSailPairedConsumerVerified,
    evidenceRetentionVerified,
    evidencePromotionSuccess,
    scratchCloseoutSuccess: scratchCloseoutCheckPassed,
  };

  const MANDATORY_CHECKS = Object.keys(receipt.checks);
  receipt.status = MANDATORY_CHECKS.every((k) => receipt.checks[k] === true) ? "pass" : "fail";

  const receiptJson = JSON.stringify(receipt, null, 2) + "\n";
  const manifest = {
    schema: "tfsb.evidence-manifest-v1",
    timestamp: new Date().toISOString(),
    fileCount: evidenceFiles.length + 1,
    files: [
      {
        path: "receipt.json",
        size: Buffer.byteLength(receiptJson),
        sha256: sha256(receiptJson),
      },
      ...evidenceFiles.map((f) => ({
        path: f.name,
        size: f.size,
        sha256: f.sha256,
      })),
    ],
  };
  const manifestJson = JSON.stringify(manifest, null, 2) + "\n";

  // F1 non-circular retention verification
  let retentionVerified = false;
  let receiptVerified = false;
  let manifestVerified = false;
  let promotionRecordVerified = false;
  const destinationDir = (promoTarget && evidencePromotionSuccess)
    ? promoTarget
    : (!scratchScope ? evidenceDir : null);

  if (destinationDir) {
    const destReceiptPath = join(destinationDir, "receipt.json");
    const destManifestPath = join(destinationDir, "evidence-manifest.json");

    await writeFile(destReceiptPath, receiptJson, "utf8");
    await writeFile(destManifestPath, manifestJson, "utf8");

    const readBackReceipt = await readFile(destReceiptPath);
    const readBackManifest = await readFile(destManifestPath);
    const readBackReceiptSha = sha256(readBackReceipt);
    const readBackManifestSha = sha256(readBackManifest);

    receiptVerified = (readBackReceiptSha === sha256(receiptJson));
    manifestVerified = (readBackManifestSha === sha256(manifestJson));

    if (!receiptVerified) {
      console.error(`[RETENTION_VERIFY_FAILED] Read-back receipt digest mismatch: ${readBackReceiptSha} != ${sha256(receiptJson)}`);
    }
    if (!manifestVerified) {
      console.error(`[RETENTION_VERIFY_FAILED] Read-back manifest digest mismatch: ${readBackManifestSha} != ${sha256(manifestJson)}`);
    }

    if (receiptVerified && manifestVerified) {
      const promotionRecord = {
        schema: "tfsb.promotion-record-v1",
        producer: "stellar-loom",
        target: destinationDir,
        verifiedAt: new Date().toISOString(),
        receiptVerified: true,
        receiptSha256: readBackReceiptSha,
        manifestVerified: true,
        manifestSha256: readBackManifestSha,
        payloadFilesCount: evidenceFiles.length,
        retentionVerified: true,
      };
      const promotionRecordJson = JSON.stringify(promotionRecord, null, 2) + "\n";
      const destRecordPath = join(destinationDir, "promotion-record.json");
      await writeFile(destRecordPath, promotionRecordJson, "utf8");
      const readBackRecord = await readFile(destRecordPath, "utf8");
      const parsedRecord = JSON.parse(readBackRecord);
      promotionRecordVerified = parsedRecord.retentionVerified === true &&
        parsedRecord.receiptSha256 === readBackReceiptSha;
      retentionVerified = receiptVerified && manifestVerified && promotionRecordVerified;
    }
  }
  receipt.retentionVerified = retentionVerified;

  console.log("\n=== Qualification Receipt Summary ===");
  console.log(`Status: ${receipt.status}`);
  console.log(`Themes compiled: ${receipt.compiledThemes.map((t) => t.id).join(", ")}`);
  console.log(`Original lock digest: ${receipt.originalLockDigest}`);
  console.log(`Loom tarball digest: ${receipt.loomTarball?.sha256}`);
  console.log(`Evidence receipt written: ${promoTarget ? join(promoTarget, "receipt.json") : join(evidenceDir, "receipt.json")}`);

  // TAP 13 summary including retention assertions
  const tapAssertions = [];
  for (const key of MANDATORY_CHECKS) {
    const ok = receipt.checks[key] === true;
    let directive = "";
    if (key === "scratchCloseoutSuccess" && !scratchCloseoutRequired) {
      directive = " # SKIP explicit unmanaged work-dir";
    }
    tapAssertions.push({ ok, name: key + directive });
  }
  tapAssertions.push({
    ok: receiptVerified && manifestVerified,
    name: "receiptAndManifestPersistedAndVerified",
  });
  tapAssertions.push({
    ok: promotionRecordVerified,
    name: "promotionRecordPersistedAndVerified",
  });

  console.log(`\nTAP version 13`);
  console.log(`1..${tapAssertions.length}`);
  let passedCount = 0;
  let failedCount = 0;
  tapAssertions.forEach((assertion, idx) => {
    if (assertion.ok) passedCount++; else failedCount++;
    console.log(`${assertion.ok ? "ok" : "not ok"} ${idx + 1} - ${assertion.name}`);
  });
  console.log(`# pass ${passedCount}`);
  console.log(`# fail ${failedCount}`);
  console.log(`# total ${tapAssertions.length}`);

  if (receipt.status === "pass" && retentionVerified) {
    console.log("\n=== All Code Presentation Smoke Qualifications Passed Successfully ===");
  } else {
    console.error(`\n=== Code Presentation Smoke Qualification FAILED (${failedCount} checks failed) ===`);
  }

  if (cliArgs.json) {
    process.stdout.write(receiptJson);
  }

  return receipt;
  } finally {
    if (scratchScope && existsSync(scratchScope.path)) {
      try {
        scratchScope.close();
      } catch {}
    }
  }
}

// Execute if run directly
const isDirectExecution = process.argv[1] && resolve(process.argv[1]) === resolve(__filename);
if (isDirectExecution) {
  runCodeSmoke()
    .then((receipt) => {
      if (receipt.status === "blocked") {
        process.exit(2);
      }
      if (receipt.status !== "pass" || receipt.retentionVerified !== true) {
        console.error(`\nSmoke test finished with non-passing status: ${receipt.status}, retentionVerified: ${receipt.retentionVerified}`);
        process.exit(1);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error("\nFATAL: Smoke test failed:", err);
      process.exit(1);
    });
}
