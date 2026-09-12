#!/usr/bin/env node
// @ts-check

/**
 * smoke-dogfood.mjs
 *
 * Dedicated qualification harness for Stellar Loom Dogfood Envelopes (TFSB62B).
 * Composes first-party core/code/catalog fixtures into loom-black/flexoki/celestia manifests.
 * Exercises:
 *  - Fresh pack of Loom twice with deterministic member/tarball identity retention
 *  - Fresh disposable tool consumer with npm install --ignore-scripts
 *  - Dynamic ESM import of installed package by file URL from package exports
 *  - Verification and validation of first-party composed dogfood envelopes:
 *      loom-black, loom-flexoki, loom-celestia
 *  - Deterministic package generation across independent directories (two runs byte-for-byte identical)
 *  - Generation and evaluation of all eight Flexoki accents (red, orange, yellow, green, cyan, blue, purple, magenta)
 *  - Clean installation into a copy of consumer-fixture with original lock retention
 *  - Pinned runtime identity: Node 22, Astro 7.3.1, Starlight 0.42.0, Expressive Code 0.44.2, Shiki 4.4.3, Playwright 1.62.1
 *  - Static Astro builds across comprehensive scenario matrix
 *  - Offline Playwright Chromium CDP assertions:
 *      All 3 envelopes across light / dark modes and 390 / 768 / 1440 viewports (18 combinations)
 *      All 8 Flexoki accents evaluated in light and dark modes on both content palette and code presentation
 *      Actual public search result navigation using built Pagefind index
 *      Language switching via starlight-lang-select and route transition
 *      Notices, default alternative, and legal license/notice files
 *      Mobile table of contents (TOC) and site-title responsive rendering
 *      Consumer Expressive Code controls: false (standard markdown pre), leaf style overrides, and array replacement
 *      Retained catalog assertions:
 *        Font CDP Platform Glyphs (Source Code Pro glyphCount > 0) and corrupted font negative test
 *        Print media (@media print) coherent light colors across light and dark initial modes
 *        Sidebar-less widths (--sl-content-width: 72rem) without horizontal overflow
 *        Theme switch and reload persistence via starlight-theme-select
 *        All 5 Hero layouts (centered, media-top, media-left, media-right, banner) and precedence
 *        3 Pagination variants (plain, card, compact)
 *        4 Sidebar modes (nested, tabs roving keyboard navigation, select dropdown, active-only fallback)
 *        PageTitle copy modes (url, title, none) with keyboard Enter stub
 *        Consumer CSS override and PageTitle component override precedence
 *        Single h1 _top and unique IDs across all elements
 *        Representative cards, asides, badges, tables, tabs, file trees
 *        Zero external runtime requests (asserted offline isolation)
 *  - Explicit negative deferred scenarios:
 *      Layout slots: Black relocated header controls, custom PageFrame, TwoColumnContent remain public defaults
 *      Code tabs: tabs: 'deferred' preserved; no false working code tabs
 *      Virtual data: fixed package JSON emitted; generic virtual modules deferred
 *      Provider provenance: local static font files with known sha256; remote provider registries deferred
 *      Rejected internal execution: arbitrary script injection and unsafe prototypes rejected by validator
 *  - Structured JSON receipt recording versions, lock digests, inventories, tarball digests, and browser observations.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOOM_ROOT = resolve(__dirname, "..");
const FIXTURE_SRC = resolve(LOOM_ROOT, "fixture");
const CONSUMER_FIXTURE_SRC = resolve(LOOM_ROOT, "consumer-fixture");
const FONT_FIXTURE_SRC = resolve(LOOM_ROOT, "test/fixtures/catalog-font");
const DOGFOOD_FIXTURES_SRC = resolve(LOOM_ROOT, "test/fixtures/dogfood-envelopes");

const EXPECTED_VERSIONS = {
  astro: "7.3.1",
  starlight: "0.42.0",
  expressiveCode: "0.44.2",
  shiki: "4.4.3",
  playwright: "1.62.1",
};

const EXPECTED_LOCK_DIGEST = "7c3c03ea0b02f2af883e411ba4500d7ef2951a7bd599e452d3bb91e23a8c9bbf";

const EXPECTED_FONT = {
  family: "Source Code Pro",
  id: "source-code-pro",
  format: "woff2",
  weight: 400,
  style: "normal",
  sha256: "8badfe75c98da1e8315a52619f177def4618350f7b3e496baf5b8894da2c2ac0",
  licenseSha256: "67f54ca75bed5827c712f2d87a168c6e97d56fbd2312eea5de510adda74aaedd",
  noticeSlug: "source-code-pro-ofl",
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

const VIEWPORTS = [390, 768, 1440];
const MODES = ["dark", "light"];
const ENVELOPES = ["loom-black", "loom-flexoki", "loom-celestia"];
const HERO_LAYOUTS = ["centered", "media-top", "media-left", "media-right", "banner"];
const PAGINATION_VARIANTS = ["plain", "card", "compact"];
const SIDEBAR_MODES = ["nested", "tabs", "select", "active-only"];
const PAGETITLE_COPY_MODES = ["none", "title", "url"];
const LAYOUT_MODES = ["standard", "compact"];

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
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
  return null;
}

function colorMatches(actual, expectedHex) {
  if (!actual || !expectedHex) return false;
  const a = parseColor(actual);
  const e = parseColor(expectedHex);
  if (!a || !e) return false;
  return a[0] === e[0] && a[1] === e[1] && a[2] === e[2];
}

function paletteFor(spec, accent, mode) {
  const variant = spec.accentVariants[accent];
  if (!variant) throw new Error(`Accent '${accent}' not found in spec ${spec.name}`);
  const tokens = spec.tokenSets[variant.tokenSet];
  return Object.fromEntries(
    Object.entries(variant[mode]).map(([role, name]) => {
      let value = tokens[name];
      for (let i = 0; typeof value === "object" && value && i < 16; i++) {
        value = tokens[value.alias];
      }
      if (typeof value !== "string") {
        throw new Error(`Token resolution failed for role ${role} -> ${name}`);
      }
      return [role, value];
    })
  );
}

function startStaticServer(rootDir, port = 0, base = "") {
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
      if (base && pathname.startsWith(base + "/")) pathname = pathname.slice(base.length);
      if (pathname.endsWith("/")) {
        pathname += "index.html";
      } else if (!extname(pathname)) {
        pathname += "/index.html";
      }

      const filePath = resolve(rootDir, pathname.replace(/^\//, ""));
      if (filePath !== resolve(rootDir) && !filePath.startsWith(resolve(rootDir) + "/")) {
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
    } else if (arg === "--skip-browser") {
      args.skipBrowser = true;
    } else if (arg === "--json") {
      args.json = true;
    }
  }

  return args;
}

export async function runDogfoodSmoke() {
  const cliArgs = parseCliArgs();
  const startTime = new Date().toISOString();

  console.log("=== Stellar Loom Dogfood Envelopes (TFSB62B) Smoke Qualification ===");

  const workDir = cliArgs.workDir;
  if (!workDir) {
    throw new Error(
      "Missing required work directory. Provide --work-dir <absent-path>."
    );
  }
  await mkdir(workDir);
  console.log(`1. Using work directory: ${workDir}`);

  const evidenceDir = join(workDir, "evidence");
  await mkdir(evidenceDir, { recursive: true });

  const receipt = {
    schema: "tfsb62b-dogfood-qualification-v1",
    phase: "TFSB62B",
    status: "pending",
    timestamp: startTime,
    runtimeVersions: {
      node: process.version,
      stellarLoom: null,
      astro: null,
      starlight: null,
      expressiveCode: null,
      shiki: null,
      playwright: null,
      browser: null,
    },
    coverage: {
      envelopes: [...ENVELOPES],
      flexokiAccents: [...FLEXOKI_ACCENTS],
      viewports: [...VIEWPORTS],
      modes: [...MODES],
      heroLayouts: [...HERO_LAYOUTS],
      paginationVariants: [...PAGINATION_VARIANTS],
      sidebarModes: [...SIDEBAR_MODES],
      pageTitleCopyModes: [...PAGETITLE_COPY_MODES],
      layouts: [...LAYOUT_MODES],
      features: [
        "pairwise-390-768-1440-light-dark",
        "all-eight-flexoki-accents-code-palette",
        "public-search-result-navigation-built-index",
        "language-switching",
        "notices-default-alternative",
        "mobile-toc-and-site-title",
        "consumer-expressive-code-false",
        "consumer-leaf-overrides",
        "consumer-array-overrides",
        "font-cdp-platform-glyphs",
        "font-corrupted-negative-test",
        "print-media-coherence",
        "sidebar-less-content-width",
        "theme-persistence",
        "hero-all-layouts-and-precedence",
        "pagination-variants",
        "sidebar-all-modes-and-keyboard",
        "pagetitle-copy-modes",
        "consumer-component-override",
        "consumer-css-override",
        "negative-deferred-layout-slots",
        "negative-deferred-code-tabs",
        "negative-deferred-virtual-data",
        "negative-deferred-provider-provenance",
        "negative-rejected-internal-execution",
      ],
    },
    originalLockDigest: null,
    postInstallLockDigest: null,
    loomTarball: null,
    packDeterminism: null,
    manifestVerification: null,
    compiledThemes: [],
    deferredScenarios: {},
    browserObservations: null,
    evidenceGaps: [],
    checks: {},
  };

  // Node 22 qualification check: major must be exactly 22
  const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
  if (nodeMajor !== 22) {
    throw new Error(`Node major version must be exactly 22; current version is ${process.version}`);
  }
  console.log(`   ✓ Node version qualified: exactly major 22 (${process.version})`);

  // Verify catalog font fixture presence and sha256
  const fontFile = join(FONT_FIXTURE_SRC, "source-code-pro.woff2");
  const licenseFile = join(FONT_FIXTURE_SRC, "LICENSE.txt");
  if (!existsSync(fontFile) || !existsSync(licenseFile)) {
    throw new Error(`Catalog font fixture missing at ${FONT_FIXTURE_SRC}`);
  }
  const fontBytes = await readFile(fontFile);
  const actualFontSha = sha256(fontBytes);
  const actualLicenseSha = sha256(await readFile(licenseFile));
  if (actualFontSha !== EXPECTED_FONT.sha256) {
    throw new Error(`Font sha256 mismatch! Expected ${EXPECTED_FONT.sha256}, got ${actualFontSha}`);
  }
  if (actualLicenseSha !== EXPECTED_FONT.licenseSha256) {
    throw new Error(`Font license sha256 mismatch! Expected ${EXPECTED_FONT.licenseSha256}, got ${actualLicenseSha}`);
  }
  console.log(`   ✓ Confirmed local Source Code Pro font bytes and license SHA-256.`);

  // Materialize font resources map
  const fontResources = new Map([[EXPECTED_FONT.id, new Uint8Array(fontBytes)]]);

  // -------------------------------------------------------------
  // Step 1: Initial Build Check via build-catalog-evidence.mjs or dist
  // -------------------------------------------------------------
  console.log("2. Checking qualification build availability...");
  const distEntryPath = join(LOOM_ROOT, "dist/index-catalog.js");
  let distAvailable = existsSync(distEntryPath);

  {
    const buildEvidenceScript = join(LOOM_ROOT, "tools/build-catalog-evidence.mjs");
    let buildProc;
    if (existsSync(buildEvidenceScript)) {
      buildProc = spawnSync("node", ["tools/build-catalog-evidence.mjs"], {
        cwd: LOOM_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else {
      throw new Error("Required catalog evidence builder missing");
    }
    distAvailable = existsSync(distEntryPath);
    if (buildProc.status !== 0 || !distAvailable) {
      console.warn("   Notice: Initial qualification build failed.");
      receipt.status = "blocked";
      receipt.completed = new Date().toISOString();
      receipt.blockedReason = "Catalog qualification build failed";
      receipt.buildError = `${buildProc.stdout || ""}\n${buildProc.stderr || ""}`.trim();
      receipt.evidenceGaps.push(`dist/index-catalog.js missing or build failed (exit ${buildProc.status})`);

      const sanitizedReceipt = { ...receipt };
      delete sanitizedReceipt.workDir;
      const receiptJson = JSON.stringify(sanitizedReceipt, null, 2);
      await writeFile(join(evidenceDir, "receipt.json"), receiptJson, "utf8");
      await writeFile(join(workDir, "receipt.json"), receiptJson, "utf8");
      if (cliArgs.json) {
        process.stdout.write(receiptJson + "\n");
      }
      return sanitizedReceipt;
    }
  }
  console.log("   ✓ Verified build output availability at dist/index-catalog.js");

  // -------------------------------------------------------------
  // Step 2: Pack Loom Twice & Verify Tarball Determinism
  // -------------------------------------------------------------
  console.log("3. Packaging Loom twice to verify tarball determinism and member hygiene...");
  const loomPackDir1 = join(workDir, "loom-pack-run1");
  const loomPackDir2 = join(workDir, "loom-pack-run2");
  await mkdir(loomPackDir1, { recursive: true });
  await mkdir(loomPackDir2, { recursive: true });

  const packOut1 = execFileSync("npm", ["pack", "--json", "--pack-destination", loomPackDir1], {
    cwd: LOOM_ROOT,
    encoding: "utf8",
  });
  const packOut2 = execFileSync("npm", ["pack", "--json", "--pack-destination", loomPackDir2], {
    cwd: LOOM_ROOT,
    encoding: "utf8",
  });

  const parsedPack1 = JSON.parse(packOut1)[0];
  const parsedPack2 = JSON.parse(packOut2)[0];

  const tarballPath1 = join(loomPackDir1, parsedPack1.filename);
  const tarballPath2 = join(loomPackDir2, parsedPack2.filename);

  const bytes1 = await readFile(tarballPath1);
  const bytes2 = await readFile(tarballPath2);

  const digest1 = sha256(bytes1);
  const digest2 = sha256(bytes2);

  if (digest1 !== digest2) {
    throw new Error(`Pack determinism failure: Pack 1 SHA-256 (${digest1}) !== Pack 2 SHA-256 (${digest2})`);
  }

  // Compare full package member inventory
  const inv1 = (parsedPack1.files || []).map((f) => ({ path: f.path, size: f.size, mode: f.mode })).sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const inv2 = (parsedPack2.files || []).map((f) => ({ path: f.path, size: f.size, mode: f.mode })).sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  if (JSON.stringify(inv1) !== JSON.stringify(inv2)) {
    throw new Error("Loom package member inventories differ between pack runs");
  }

  console.log(`   ✓ Loom packed deterministically: ${parsedPack1.filename} (${bytes1.byteLength} bytes, SHA-256: ${digest1.slice(0, 16)}...)`);
  receipt.loomTarball = {
    filename: parsedPack1.filename,
    size: bytes1.byteLength,
    sha256: digest1,
    memberCount: inv1.length,
  };
  receipt.packDeterminism = {
    runsIdentical: true,
    memberCount: inv1.length,
  };

  const primaryTarballPath = tarballPath1;

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
        name: "smoke-dogfood-tool-consumer",
        version: "1.0.0",
        private: true,
        type: "module",
      },
      null,
      2
    ),
    "utf8"
  );

  execFileSync("npm", ["install", "--ignore-scripts", primaryTarballPath], {
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

  console.log("5. Resolving package exports and dynamically importing catalog domain...");
  const pkgExportImport = installedLoomPkg.exports?.["."]?.import;
  if (!pkgExportImport) {
    throw new Error("Installed package.json missing exports['.']['import'] mapping");
  }

  const installedEntryUrl = pathToFileURL(join(installedLoomRoot, pkgExportImport)).href;
  const loom = await import(installedEntryUrl);

  const requiredCatalogExports = [
    "compileThemeCatalog",
    "generateThemePackageCatalog",
    "writeThemePackage",
    "isThemeCatalog",
    "validateThemeCatalog",
  ];

  const missingExports = requiredCatalogExports.filter((exp) => loom[exp] === undefined);
  if (missingExports.length > 0) {
    console.warn(`   Notice: Installed package missing required exports: ${missingExports.join(", ")}`);
    receipt.status = "blocked";
    receipt.completed = new Date().toISOString();
    receipt.blockedReason = `Installed package missing required exports: ${missingExports.join(", ")}`;
    receipt.evidenceGaps.push(`Missing exports: ${missingExports.join(", ")}`);

    const sanitizedReceipt = { ...receipt };
    delete sanitizedReceipt.workDir;
    const receiptJson = JSON.stringify(sanitizedReceipt, null, 2);
    await writeFile(join(evidenceDir, "receipt.json"), receiptJson, "utf8");
    await writeFile(join(workDir, "receipt.json"), receiptJson, "utf8");
    if (cliArgs.json) {
      process.stdout.write(receiptJson + "\n");
    }
    return sanitizedReceipt;
  }
  console.log(`   ✓ Verified installed library exports from package exports: ${requiredCatalogExports.join(", ")}`);

  // -------------------------------------------------------------
  // Step 4: Verify Dogfood Envelope Manifest and Composed Fixtures
  // -------------------------------------------------------------
  console.log("6. Verifying dogfood envelope fixtures and clean-room composition...");
  const dogfoodManifestPath = join(DOGFOOD_FIXTURES_SRC, "manifest.json");
  const blackFixture = join(DOGFOOD_FIXTURES_SRC, "loom-black.json");
  const flexokiFixture = join(DOGFOOD_FIXTURES_SRC, "loom-flexoki.json");
  const celestiaFixture = join(DOGFOOD_FIXTURES_SRC, "loom-celestia.json");

  for (const f of [dogfoodManifestPath, blackFixture, flexokiFixture, celestiaFixture]) {
    if (!existsSync(f)) {
      throw new Error(`Dogfood fixture missing: ${f}`);
    }
  }

  const manifestData = JSON.parse(await readFile(dogfoodManifestPath, "utf8"));
  receipt.manifestVerification = {
    schema: manifestData.schema,
    envelopeCount: manifestData.envelopes?.length ?? 0,
    tier2DeferredDispositions: manifestData.tier2DeferredDispositions ?? [],
  };

  const blackSpec = JSON.parse(await readFile(blackFixture, "utf8"));
  const flexokiSpec = JSON.parse(await readFile(flexokiFixture, "utf8"));
  const celestiaSpec = JSON.parse(await readFile(celestiaFixture, "utf8"));

  // Validate all 3 envelope specifications using installed validator
  for (const [name, spec] of [
    ["loom-black", blackSpec],
    ["loom-flexoki", flexokiSpec],
    ["loom-celestia", celestiaSpec],
  ]) {
    const validated = loom.validateThemeCatalog(spec);
    if (!validated) throw new Error(`Validation failed for ${name}`);
    if (spec.codePresentation?.tabs !== "deferred") {
      throw new Error(`Specification ${name} must preserve mandatory historical deferred sentinel for code tabs`);
    }
  }

  // Verify Celestia font and OFL license notice alignment
  if (!celestiaSpec.fonts || celestiaSpec.fonts.length === 0) {
    throw new Error("Celestia catalog specification must declare local font");
  }
  const declaredFont = celestiaSpec.fonts[0];
  if (declaredFont.id !== EXPECTED_FONT.id || declaredFont.notice !== EXPECTED_FONT.noticeSlug) {
    throw new Error(`Celestia font metadata mismatch: expected ${EXPECTED_FONT.id}/${EXPECTED_FONT.noticeSlug}, got ${declaredFont.id}/${declaredFont.notice}`);
  }
  const licenseNotice = celestiaSpec.catalog.fontLicenses.find((l) => l.id === EXPECTED_FONT.noticeSlug);
  if (!licenseNotice || !licenseNotice.text.includes("Copyright 2010, 2012 Adobe Systems Incorporated")) {
    throw new Error("Celestia fontLicenses missing full upstream OFL notice text matching notice id");
  }
  console.log("   ✓ Dogfood envelopes validated with exact schema, code tabs deferred sentinel, and font license notice bindings.");

  // -------------------------------------------------------------
  // Step 5: Generate Theme Packages Across Independent Directories & Verify Determinism
  // -------------------------------------------------------------
  console.log("7. Generating theme packages twice for all envelopes & 8 Flexoki accents to verify determinism...");

  const activeOnlySpec = JSON.parse(JSON.stringify(blackSpec));
  activeOnlySpec.name = "loom-active-only-dogfood";
  activeOnlySpec.catalog.sidebar.mode = "active-only";

  const themeList = [
    {
      id: "loom-black",
      spec: blackSpec,
      accent: "default",
      packageName: "@smoke/starlight-theme-loom-black-dogfood",
    },
    ...FLEXOKI_ACCENTS.map((accent) => ({
      id: `loom-flexoki-${accent}`,
      spec: flexokiSpec,
      accent,
      packageName: `@smoke/starlight-theme-loom-flexoki-dogfood-${accent}`,
    })),
    {
      id: "loom-celestia",
      spec: celestiaSpec,
      accent: "default",
      packageName: "@smoke/starlight-theme-loom-celestia-dogfood",
    },
    {
      id: "loom-active-only",
      spec: activeOnlySpec,
      accent: "default",
      packageName: "@smoke/starlight-theme-loom-active-only-dogfood",
    },
  ];

  const packageTarballs = {};

  for (const themeInfo of themeList) {
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
      metadata,
      accent: themeInfo.accent,
      fontResources: new Map((themeInfo.spec.fonts || []).map((font) => [font.id, fontResources.get(font.id)])),
    };

    const res1 = loom.generateThemePackageCatalog(genOpts);
    const res2 = loom.generateThemePackageCatalog(genOpts);
    const packet = loom.createThemeCatalogCandidate(themeInfo.spec, {metadata,accent:themeInfo.accent,fontResources:genOpts.fontResources,tarballDigest:'sha256:'+receipt.loomTarball.sha256});
    if (!loom.verifyThemeCatalogCandidate(packet,{fontResources:genOpts.fontResources}).valid) throw new Error('Installed candidate verification failed');
    await writeFile(join(evidenceDir,themeInfo.id+'.candidate.json'),loom.serializeThemeCatalogCandidate(packet));

    await loom.writeThemePackage(res1, runDir1);
    await loom.writeThemePackage(res2, runDir2);

    // Verify byte-for-byte directory determinism
    const files1 = (await readdir(runDir1, { recursive: true })).sort();
    const files2 = (await readdir(runDir2, { recursive: true })).sort();
    if (JSON.stringify(files1) !== JSON.stringify(files2)) {
      throw new Error(`Determinism failure: File inventories differ for ${themeInfo.id}`);
    }

    for (const file of files1) {
      const p1 = join(runDir1, file);
      const p2 = join(runDir2, file);
      const s1 = await stat(p1);
      if (s1.isFile()) {
        const b1 = await readFile(p1);
        const b2 = await readFile(p2);
        if (sha256(b1) !== sha256(b2)) {
          throw new Error(`Determinism failure: Byte mismatch in '${file}' for ${themeInfo.id}`);
        }
      }
    }

    // Pack run 1 into external pack destination
    const packExtDir1 = join(workDir, `pack-${themeInfo.id}-run1`);
    const packExtDir2 = join(workDir, `pack-${themeInfo.id}-run2`);
    await mkdir(packExtDir1, { recursive: true });
    await mkdir(packExtDir2, { recursive: true });

    const packOut1 = execFileSync("npm", ["pack", "--json", "--pack-destination", packExtDir1], {
      cwd: runDir1,
      encoding: "utf8",
    });
    const packOut2 = execFileSync("npm", ["pack", "--json", "--pack-destination", packExtDir2], {
      cwd: runDir2,
      encoding: "utf8",
    });

    const parsed1 = JSON.parse(packOut1)[0];
    const parsed2 = JSON.parse(packOut2)[0];

    const tPath1 = join(packExtDir1, parsed1.filename);
    const tPath2 = join(packExtDir2, parsed2.filename);

    const tBytes1 = await readFile(tPath1);
    const tBytes2 = await readFile(tPath2);

    const tSha1 = sha256(tBytes1);
    const tSha2 = sha256(tBytes2);

    if (tSha1 !== tSha2) {
      throw new Error(`Pack determinism failure for ${themeInfo.id}: run 1 (${tSha1}) !== run 2 (${tSha2})`);
    }

    const tInv1 = (parsed1.files || []).map((f) => ({ path: f.path, size: f.size })).sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
    const tInv2 = (parsed2.files || []).map((f) => ({ path: f.path, size: f.size })).sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
    if (JSON.stringify(tInv1) !== JSON.stringify(tInv2)) {
      throw new Error(`Package member inventory mismatch between runs for ${themeInfo.id}`);
    }

    packageTarballs[themeInfo.id] = {
      path: tPath1,
      filename: parsed1.filename,
      size: tBytes1.byteLength,
      sha256: tSha1,
      packageName: themeInfo.packageName,
      inputDigest:res1.themeInputDigest,
      outputDigest:res1.cssOutputDigest,
      semantic:res1.descriptor.compilerSemantic,
      catalogIdentity:res1.descriptor.catalogIdentity,
      catalogDigest:res1.descriptor.catalogDigest,
      executableDigest:packet.producer.executableDigest,
      candidateDigest:packet.candidateDigest,
      memberCount: tInv1.length,
    };

    receipt.compiledThemes.push({
      id: themeInfo.id,
      name: themeInfo.spec.name,
      packageName: themeInfo.packageName,
      inputDigest:res1.themeInputDigest,
      outputDigest:res1.cssOutputDigest,
      semantic:res1.descriptor.compilerSemantic,
      catalogIdentity:res1.descriptor.catalogIdentity,
      catalogDigest:res1.descriptor.catalogDigest,
      executableDigest:packet.producer.executableDigest,
      candidateDigest:packet.candidateDigest,
      tarball: {
        filename: parsed1.filename,
        size: tBytes1.byteLength,
        sha256: tSha1,
        memberCount: tInv1.length,
      },
    });

    console.log(`   ✓ ${themeInfo.id} generated deterministically and packed twice identically (${parsed1.filename})`);
  }

  // -------------------------------------------------------------
  // Step 6: Build Scratch Consumer with Lock Retention & Readback Versions
  // -------------------------------------------------------------
  console.log("8. Building scratch consumer by copying consumer-fixture with locked dependencies...");
  const consumerDir = join(workDir, "fixture-consumer");
  await mkdir(consumerDir, { recursive: true });

  const originalLockPath = join(CONSUMER_FIXTURE_SRC, "package-lock.json");
  if (!existsSync(originalLockPath)) {
    throw new Error(`Consumer lockfile missing at ${originalLockPath}`);
  }
  const originalLockBytes = await readFile(originalLockPath);
  const originalLockDigest = sha256(originalLockBytes);
  receipt.originalLockDigest = originalLockDigest;

  if (originalLockDigest !== EXPECTED_LOCK_DIGEST) {
    throw new Error(`Consumer package-lock.json digest mismatch! Expected ${EXPECTED_LOCK_DIGEST}, got ${originalLockDigest}`);
  }
  console.log(`   ✓ Validated known consumer lock digest: ${originalLockDigest.slice(0, 16)}...`);

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

  // Copy catalog documentation, consumer override component, and consumer CSS
  const destCatalogDocs = join(consumerDir, "src/content/docs/catalog");
  await mkdir(destCatalogDocs, { recursive: true });
  await cp(join(FIXTURE_SRC, "src/content/docs/catalog"), destCatalogDocs, { recursive: true });

  // Add rich Expressive Code block with text markers ({2} ins={3} del={4}) into catalog index.mdx
  const catalogIndexPath = join(destCatalogDocs, "index.mdx");
  let catalogIndexContent = await readFile(catalogIndexPath, "utf8");
  if (!catalogIndexContent.includes("ins={3}")) {
    const codeBlockSnippet = `
### Expressive Code Demonstration with Markers

\`\`\`typescript title="example.ts" {2} ins={3} del={4}
import { readFile } from "node:fs";
// Keyword, string, comment, and function tokens
import { compileThemeCatalog } from "@knowledge-forge-ai/theme-forge-stellar-loom";
const markedLine = "This line is marked";
const insertedLine = "This line was inserted";
const deletedLine = "This line was deleted";
function computeLongResultWithNoBreaksToVerifyHorizontalOverflowContainmentWithinCodeFrame(): string {
  return "abcdefghijklmnopqrstuvwxyz_0123456789_abcdefghijklmnopqrstuvwxyz_0123456789_abcdefghijklmnopqrstuvwxyz";
}
\`\`\`
`;
    catalogIndexContent += "\n" + codeBlockSnippet;
    await writeFile(catalogIndexPath, catalogIndexContent, "utf8");
  }

  // Setup French locale documentation for language switching verification
  const destFrDocs = join(consumerDir, "src/content/docs/fr/catalog");
  await mkdir(destFrDocs, { recursive: true });
  await cp(destCatalogDocs, destFrDocs, { recursive: true });
  await writeFile(join(destCatalogDocs, "fallback-only.mdx"), '---\ntitle: Fallback notice probe\n---\n\nOriginal fallback content for the public notice qualification.\n');
  await writeFile(
    join(consumerDir, "src/content/docs/fr/index.mdx"),
    `---
title: Documentation d'Accueil
description: Page d'accueil en français pour la qualification dogfood.
---

Bienvenue sur la documentation francophone de Theme Forge Stellar Loom.
`,
    "utf8"
  );

  const destComponents = join(consumerDir, "src/components");
  await mkdir(destComponents, { recursive: true });
  await cp(
    join(FIXTURE_SRC, "src/components/CatalogConsumerPageTitle.astro"),
    join(destComponents, "CatalogConsumerPageTitle.astro")
  );

  const destStyles = join(consumerDir, "src/styles");
  await mkdir(destStyles, { recursive: true });
  await cp(
    join(FIXTURE_SRC, "src/styles/catalog-consumer.css"),
    join(destStyles, "catalog-consumer.css")
  );

  console.log("9. Running npm ci --ignore-scripts in scratch consumer...");
  execFileSync("npm", ["ci", "--ignore-scripts"], {
    cwd: consumerDir,
    stdio: "ignore",
  });

  console.log("10. Installing generated theme tarballs into scratch consumer (--no-save --package-lock=false)...");
  const tarballsToInstall = Object.values(packageTarballs).map((t) => t.path);
  execFileSync(
    "npm",
    ["install", "--ignore-scripts", "--no-save", "--package-lock=false", ...tarballsToInstall],
    {
      cwd: consumerDir,
      stdio: "ignore",
    }
  );

  const postInstallLock = await readFile(join(consumerDir, "package-lock.json"));
  const postInstallLockDigest = sha256(postInstallLock);
  receipt.postInstallLockDigest = postInstallLockDigest;
  if (postInstallLockDigest !== originalLockDigest) {
    throw new Error("Consumer package-lock.json was altered during theme installation!");
  }
  console.log("   ✓ Consumer package-lock.json digest preserved exactly across installation.");

  // Read back actual installed runtime versions from node_modules
  async function readInstalledVersion(pkgRelativePath) {
    const pkgPath = join(consumerDir, "node_modules", pkgRelativePath, "package.json");
    if (!existsSync(pkgPath)) {
      throw new Error(`Installed package.json missing at ${pkgPath}`);
    }
    const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    return pkg.version;
  }

  const actualAstro = await readInstalledVersion("astro");
  const actualStarlight = await readInstalledVersion("@astrojs/starlight");
  const actualExpressiveCode = await readInstalledVersion("@expressive-code/core");
  const actualShiki = await readInstalledVersion("shiki");
  const actualPlaywright = JSON.parse(
    await readFile(join(LOOM_ROOT, "node_modules/@playwright/test/package.json"), "utf8")
  ).version;

  receipt.runtimeVersions.astro = actualAstro;
  receipt.runtimeVersions.starlight = actualStarlight;
  receipt.runtimeVersions.expressiveCode = actualExpressiveCode;
  receipt.runtimeVersions.shiki = actualShiki;
  receipt.runtimeVersions.playwright = actualPlaywright;

  for (const [k, expected] of Object.entries(EXPECTED_VERSIONS)) {
    const actual = receipt.runtimeVersions[k];
    if (actual !== expected) {
      throw new Error(`Pinned runtime version mismatch for ${k}: expected ${expected}, got readback ${actual}`);
    }
  }
  console.log(
    `   ✓ Read back and validated pinned versions: Astro ${actualAstro}, Starlight ${actualStarlight}, Expressive Code ${actualExpressiveCode}, Shiki ${actualShiki}, Playwright ${actualPlaywright}`
  );

  // -------------------------------------------------------------
  // Step 7: Configure Astro Scenarios & Build
  // -------------------------------------------------------------
  console.log("11. Writing consumer Astro configuration with scenarios supporting dogfood envelope matrix...");

  const astroConfigContent = `import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

const scenario = process.env.CATALOG_SCENARIO || "black-dogfood";
const outDir = process.env.ASTRO_OUT_DIR || "./dist";

const plugins = [];
const components = {};
const customCss = [];
let expressiveCodeConfig = undefined;
let locales = undefined;
let defaultLocale = undefined;

const packages = {
  "black-dogfood": "@smoke/starlight-theme-loom-black-dogfood",
  "flexoki-cyan": "@smoke/starlight-theme-loom-flexoki-dogfood-cyan",
  "flexoki-red": "@smoke/starlight-theme-loom-flexoki-dogfood-red",
  "flexoki-orange": "@smoke/starlight-theme-loom-flexoki-dogfood-orange",
  "flexoki-yellow": "@smoke/starlight-theme-loom-flexoki-dogfood-yellow",
  "flexoki-green": "@smoke/starlight-theme-loom-flexoki-dogfood-green",
  "flexoki-blue": "@smoke/starlight-theme-loom-flexoki-dogfood-blue",
  "flexoki-purple": "@smoke/starlight-theme-loom-flexoki-dogfood-purple",
  "flexoki-magenta": "@smoke/starlight-theme-loom-flexoki-dogfood-magenta",
  "celestia-dogfood": "@smoke/starlight-theme-loom-celestia-dogfood",
  "active-only-dogfood": "@smoke/starlight-theme-loom-active-only-dogfood",
  "consumer-override": "@smoke/starlight-theme-loom-black-dogfood",
  "consumer-css": "@smoke/starlight-theme-loom-black-dogfood",
  "base-catalog": "@smoke/starlight-theme-loom-black-dogfood",
  "false-ec": "@smoke/starlight-theme-loom-black-dogfood",
  "consumer-leaf": "@smoke/starlight-theme-loom-black-dogfood",
  "consumer-arrays": "@smoke/starlight-theme-loom-black-dogfood",
  "lang-switch": "@smoke/starlight-theme-loom-celestia-dogfood",
  "notice-flexoki": "@smoke/starlight-theme-loom-flexoki-dogfood-cyan",
  "absent": null,
};

if (scenario === "consumer-override") {
  const { default: themePlugin } = await import(packages["consumer-override"]);
  plugins.push(themePlugin());
  components.PageTitle = "./src/components/CatalogConsumerPageTitle.astro";
} else if (scenario === "consumer-css") {
  const { default: themePlugin } = await import(packages["consumer-css"]);
  plugins.push(themePlugin());
  customCss.push("./src/styles/catalog-consumer.css");
} else if (scenario === "false-ec") {
  expressiveCodeConfig = false;
  const { default: themePlugin } = await import(packages["false-ec"]);
  plugins.push(themePlugin());
} else if (scenario === "consumer-leaf") {
  expressiveCodeConfig = {
    styleOverrides: {
      frames: { terminalBackground: "#123456", editorBackground: "#123456" },
      textMarkers: { markBackground: "#345678" },
    },
  };
  const { default: themePlugin } = await import(packages["consumer-leaf"]);
  plugins.push(themePlugin());
} else if (scenario === "consumer-arrays") {
  expressiveCodeConfig = {
    themes: ["github-light"],
  };
  const { default: themePlugin } = await import(packages["consumer-arrays"]);
  plugins.push(themePlugin());
} else if (scenario === "lang-switch" || scenario === "notice-flexoki") {
  const { default: themePlugin } = await import(packages[scenario]);
  plugins.push(themePlugin());
  defaultLocale = "root";
  locales = {
    root: { label: "English", lang: "en" },
    fr: { label: "Français", lang: "fr" },
  };
} else if (scenario !== "absent") {
  const pkgName = packages[scenario];
  if (pkgName) {
    const { default: themePlugin } = await import(pkgName);
    plugins.push(themePlugin());
  }
}

export default defineConfig({
  base: scenario === "base-catalog" ? "/guide/" : "/",
  outDir,
  integrations: [
    starlight({
      title: "Dogfood Envelope Documentation",
      social: [{icon:'github',label:'Project repository',href:'https://example.invalid/project'}],
      plugins,
      components,
      customCss,
      expressiveCode: expressiveCodeConfig,
      locales,
      defaultLocale,
      sidebar: [
        {
          label: "Catalog Core",
          items: [
            { label: "Overview", slug: "catalog" },
            {
              label: "Nested Hierarchy",
              items: [
                { label: "Nested Sidebar", slug: "catalog/sidebar-nested" },
              ],
            },
          ],
        },
        {
          label: "Hero Layouts",
          items: [
            { label: "Centered", slug: "catalog/hero-centered" },
            { label: "Media Top", slug: "catalog/hero-media-top" },
            { label: "Media Left", slug: "catalog/hero-media-left" },
            { label: "Media Right", slug: "catalog/hero-media-right" },
            { label: "Banner", slug: "catalog/hero-banner" },
          ],
        },
        {
          label: "Full Width",
          items: [
            { label: "Sidebar-less", slug: "catalog/sidebar-less" },
          ],
        },
      ],
    }),
  ],
});
`;
  await writeFile(join(consumerDir, "astro.config.mjs"), astroConfigContent, "utf8");

  console.log("12. Building scratch consumer across dogfood scenario matrix...");
  const scenarios = [
    { name: "notice-flexoki", outDir: join(consumerDir, "dist/notice-flexoki") },
    { name: "black-dogfood", outDir: join(consumerDir, "dist/black-dogfood") },
    { name: "flexoki-cyan", outDir: join(consumerDir, "dist/flexoki-cyan") },
    { name: "flexoki-red", outDir: join(consumerDir, "dist/flexoki-red") },
    { name: "flexoki-orange", outDir: join(consumerDir, "dist/flexoki-orange") },
    { name: "flexoki-yellow", outDir: join(consumerDir, "dist/flexoki-yellow") },
    { name: "flexoki-green", outDir: join(consumerDir, "dist/flexoki-green") },
    { name: "flexoki-blue", outDir: join(consumerDir, "dist/flexoki-blue") },
    { name: "flexoki-purple", outDir: join(consumerDir, "dist/flexoki-purple") },
    { name: "flexoki-magenta", outDir: join(consumerDir, "dist/flexoki-magenta") },
    { name: "celestia-dogfood", outDir: join(consumerDir, "dist/celestia-dogfood") },
    { name: "active-only-dogfood", outDir: join(consumerDir, "dist/active-only-dogfood") },
    { name: "consumer-override", outDir: join(consumerDir, "dist/consumer-override") },
    { name: "consumer-css", outDir: join(consumerDir, "dist/consumer-css") },
    { name: "base-catalog", outDir: join(consumerDir, "dist/base-catalog") },
    { name: "false-ec", outDir: join(consumerDir, "dist/false-ec") },
    { name: "consumer-leaf", outDir: join(consumerDir, "dist/consumer-leaf") },
    { name: "consumer-arrays", outDir: join(consumerDir, "dist/consumer-arrays") },
    { name: "lang-switch", outDir: join(consumerDir, "dist/lang-switch") },
  ];

  for (const sc of scenarios) {
    const buildProc = spawnSync("npx", ["astro", "build"], {
      cwd: consumerDir,
      env: {
        ...process.env,
        CATALOG_SCENARIO: sc.name,
        ASTRO_OUT_DIR: sc.outDir,
      },
      stdio: "pipe",
      encoding: "utf8",
    });

    if (buildProc.status !== 0) {
      console.error(buildProc.stderr);
      throw new Error(`Astro build failed for scenario '${sc.name}' (exit ${buildProc.status})`);
    }

    if (!existsSync(join(sc.outDir, "catalog/index.html"))) {
      throw new Error(`Astro build succeeded for scenario '${sc.name}' but catalog/index.html is missing`);
    }
    console.log(`   ✓ Scenario '${sc.name}' built successfully.`);
  }

  // -------------------------------------------------------------
  // Step 8: Playwright Offline Live Browser Verification
  // -------------------------------------------------------------
  if (cliArgs.skipBrowser) {
    console.log("13. Skipping browser verification (--skip-browser passed).");
    receipt.status = "incomplete-browser-skipped";
    await writeFile(join(evidenceDir, "receipt.json"), JSON.stringify(receipt, null, 2), "utf8");
    return receipt;
  }

  console.log("13. Launching Playwright Chromium for offline DOM, CSSOM & CDP verification...");
  const playwright = await import("@playwright/test");
  const chromium = playwright.chromium || playwright.default?.chromium;
  const browser = await chromium.launch({ headless: true });
  receipt.runtimeVersions.browser = browser.version();

  const browserObservations = {
    chromiumVersion: browser.version(),
    externalRequestsRejected: 0,
    scenarios: {},
  };

  const pageErrors = [];
  async function createOfflinePage() {
    const page = await browser.newPage();
    page.on("pageerror", (err) => {
      pageErrors.push(String(err));
    });

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

    return page;
  }

  async function capture(page, id, observations) {
    const file = `focused-${id}.png`;
    const bytes = await page.screenshot({ path: join(evidenceDir, file), fullPage: true });
    browserObservations.scenarios[id] = {
      ...observations,
      screenshot: { file, sha256: sha256(bytes) },
      viewport: page.viewportSize(),
      mode: await page.locator("html").getAttribute("data-theme"),
    };
  }

  let screenIndex = 0;

  try {
    // -------------------------------------------------------------
    // Part A: All Three Envelopes x Light & Dark Modes x 390/768/1440 Viewports (18 combinations)
    // -------------------------------------------------------------
    console.log("14. Executing all three envelopes across light/dark modes and 390 / 768 / 1440 viewports (18 combinations)...");

    const matrixScenarios = [];
    for (const env of [
      { theme: "black-dogfood", id: "loom-black", spec: blackSpec, defaultAccent: "default" },
      { theme: "flexoki-cyan", id: "loom-flexoki", spec: flexokiSpec, defaultAccent: "cyan" },
      { theme: "celestia-dogfood", id: "loom-celestia", spec: celestiaSpec, defaultAccent: "default" },
    ]) {
      for (const mode of MODES) {
        for (const width of VIEWPORTS) {
          const height = width === 390 ? 800 : width === 768 ? 1024 : 900;
          matrixScenarios.push({
            envId: env.id,
            theme: env.theme,
            spec: env.spec,
            accent: env.defaultAccent,
            mode,
            width,
            height,
            name: `${env.id}-${mode}-${width}`,
          });
        }
      }
    }

    for (const sc of matrixScenarios) {
      const server = await startStaticServer(join(consumerDir, `dist/${sc.theme}`), 0);
      try {
        const page = await createOfflinePage();
        await page.setViewportSize({ width: sc.width, height: sc.height });
        await page.goto(`http://127.0.0.1:${server.port}/catalog/`);

        await page.evaluate((m) => {
          document.documentElement.dataset.theme = m;
        }, sc.mode);

        const obs = await page.evaluate(() => {
          const h1s = Array.from(document.querySelectorAll("h1"));
          const singleH1 = h1s.length === 1;
          const h1Id = h1s[0]?.id || "";

          const allElementsWithId = Array.from(document.querySelectorAll("[id]"));
          const allIds = allElementsWithId.map((el) => el.id);
          const uniqueIds = new Set(allIds).size === allIds.length;

          const hasHorizontalOverflow =
            document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;

          const hasCards = document.querySelectorAll(".sl-markdown-content .card").length > 0;
          const hasAsides = document.querySelectorAll(".sl-markdown-content .starlight-aside").length > 0;
          const hasBadges = document.querySelectorAll(".sl-markdown-content .sl-badge").length > 0;
          const hasTables = document.querySelectorAll(".sl-markdown-content table").length > 0;
          const hasTabs = document.querySelectorAll(".sl-markdown-content starlight-tabs [role='tablist']").length > 0;
          const hasFileTree = document.querySelectorAll(".sl-markdown-content starlight-file-tree").length > 0;
          const hasFalseWorkingCodeTabs =
            document.querySelectorAll(".tfsl-code-tabs, [data-code-tabs='working']").length > 0;

          const style = (selector, property) => {
            const el = document.querySelector(selector);
            return el ? getComputedStyle(el)[property] : null;
          };
          const contentStyles = {
            page: style("body", "backgroundColor"),
            body: style("body", "color"),
            card: style(".sl-markdown-content .card", "backgroundColor"),
            panel: style(".sl-markdown-content blockquote", "backgroundColor"),
            raised: style("#catalog-detail", "backgroundColor"),
            muted: style("#catalog-muted", "color"),
          };

          return {
            contentStyles,
            typography:{bodySize:getComputedStyle(document.body).fontSize,bodyLineHeight:getComputedStyle(document.body).lineHeight,bodyFont:getComputedStyle(document.body).fontFamily,codeSize:style('.expressive-code pre','fontSize')},
            spacing:getComputedStyle(document.documentElement).getPropertyValue('--tfsl-spacing').trim(),
            documentTitle: document.title,
            siteTitleHref: document.querySelector("a.site-title")?.getAttribute("href"),
            singleH1,
            h1Id,
            uniqueIds,
            hasHorizontalOverflow,
            hasCards,
            hasAsides,
            hasBadges,
            hasTables,
            hasTabs,
            hasFileTree,
            hasFalseWorkingCodeTabs,
          };
        });

        const expectedPalette = paletteFor(sc.spec, sc.accent, sc.mode);
        if(obs.typography.bodySize!==sc.spec.typography.body.size+'px'||Math.abs(parseFloat(obs.typography.bodyLineHeight)-sc.spec.typography.body.size*sc.spec.typography.body.lineHeight)>0.1||obs.spacing!==sc.spec.surfaces.spacing+'px') throw new Error('Integrated typography/spacing mismatch');
        for (const [role, actual] of Object.entries(obs.contentStyles)) {
          if (!colorMatches(actual, expectedPalette[role])) {
            throw new Error(`Content role ${role} in ${sc.name}: expected ${expectedPalette[role]}, got ${actual}`);
          }
        }

        if (!obs.singleH1) throw new Error(`Page does not have exactly one h1 in scenario ${sc.name}`);
        if(obs.documentTitle!=='Catalog Verification Overview | Dogfood Envelope Documentation'||obs.siteTitleHref!=='/') throw new Error('Default Head/SiteTitle binding failed');
        if (obs.h1Id !== "_top") throw new Error(`h1 does not have id='_top' in scenario ${sc.name} (got '${obs.h1Id}')`);
        if (!obs.uniqueIds) throw new Error(`Duplicate element IDs detected in scenario ${sc.name}`);
        if (obs.hasHorizontalOverflow) throw new Error(`Horizontal overflow detected in scenario ${sc.name}`);
        if (!obs.hasCards || !obs.hasAsides || !obs.hasBadges || !obs.hasTables || !obs.hasTabs || !obs.hasFileTree) {
          throw new Error(`Missing representative components in scenario ${sc.name}`);
        }
        if (obs.hasFalseWorkingCodeTabs) {
          throw new Error(`False working code tabs detected in scenario ${sc.name}; working code tabs must remain deferred`);
        }
        const code = await page.evaluate(() => {
          const block=[...document.querySelectorAll('.expressive-code')].at(-1);
          const frame=block.querySelector('figure.frame');
          const keyword=[...block.querySelectorAll('.ec-line span')].find(el=>el.textContent.trim()==='import');
          return {
            frameClass:frame?.className,
            headerVisible:!!frame?.querySelector('.header') && getComputedStyle(frame.querySelector('.header')).display!=='none',
            codeBackground:getComputedStyle(document.querySelector('.expressive-code pre')).backgroundColor,
            keywordColor:keyword ? getComputedStyle(keyword).color : null,
            marks:['mark','ins','del'].map(kind=>document.querySelectorAll('.expressive-code .'+kind).length),
            chromeOverflow:[...document.querySelectorAll('.expressive-code .frame,.expressive-code .header')].some(el=>el.getBoundingClientRect().right>innerWidth+1),
          };
        });
        if (code.marks.some(n=>n===0)||code.chromeOverflow) throw new Error('Missing code mark states or overflowing chrome: '+JSON.stringify(code));
        if (!colorMatches(code.codeBackground,expectedPalette.code)) throw new Error('Integrated code background mismatch');
        const frame=sc.spec.codePresentation.frame;
        if (frame==='terminal'&&!code.frameClass.includes('is-terminal')) throw new Error('Terminal frame absent');
        if (frame==='plain'&&code.headerVisible) throw new Error('Plain frame header visible');
        if (frame==='editor'&&(!code.headerVisible||code.frameClass.includes('is-terminal'))) throw new Error('Editor frame absent');
        const keywordRule=sc.spec.codePresentation.syntaxTheme[sc.mode].rules.find(rule=>rule.scopes.includes('keyword'));
        if(!colorMatches(code.keywordColor,keywordRule.foreground)) throw new Error('Integrated syntax keyword mismatch: '+JSON.stringify(code));
        obs.code=code;

        // Starlight 0.42 mobile navigation toggle check (< 800px)
        const menuVisible = await page.locator("button[popovertarget='starlight__sidebar']").isVisible();
        if (menuVisible !== (sc.width < 800)) {
          throw new Error(`Mobile toggle visibility mismatch: ${sc.name}`);
        }

        if (sc.width < 800) {
          await page.keyboard.press("Tab");
          const focusInfo = await page.evaluate(() => {
            const active = document.activeElement;
            if (!active) return null;
            const cs = window.getComputedStyle(active);
            return {
              tag: active.tagName,
              outlineStyle: cs.outlineStyle,
              outlineWidth: cs.outlineWidth,
            };
          });
          if (!focusInfo || focusInfo.outlineStyle === "none" || parseFloat(focusInfo.outlineWidth) < 1) {
            throw new Error(`Mobile focus outline assertion failed: ${JSON.stringify(focusInfo)}`);
          }

          // Mobile open and Escape focus-return
          const menuBtn = page.locator("button[popovertarget='starlight__sidebar']");
          await menuBtn.focus();
          await page.keyboard.press("Enter");
          const isMenuOpen = await page.locator("#starlight__sidebar").evaluate((el) => el.matches(":popover-open"));
          if (!isMenuOpen) throw new Error(`Mobile menu did not open in ${sc.name}`);
          await page.keyboard.press("Escape");
          const focusReturned = await page.evaluate(() => {
            const active = document.activeElement;
            const btn = document.querySelector("button[popovertarget='starlight__sidebar']");
            return active === btn;
          });
          if (!focusReturned) {
            throw new Error(`Mobile Escape focus-return failed in ${sc.name}`);
          }
        }

        const screenName = `scenario-${sc.name}-${String(++screenIndex).padStart(3, "0")}.png`;
        const screenBytes = await page.screenshot({ path: join(evidenceDir, screenName), fullPage: true });
        const screenSha = sha256(screenBytes);

        browserObservations.scenarios[sc.name] = {
          theme: sc.theme,
          mode: sc.mode,
          viewport: sc.width,
          screenshot: { file: screenName, sha256: screenSha },
          ...obs,
        };

        await page.close();
      } finally {
        await server.close();
      }
    }
    console.log("   ✓ All three envelopes passed comprehensive light/dark and 390/768/1440 checks.");

    // -------------------------------------------------------------
    // Part B: All Eight Flexoki Accents in Light & Dark Modes (Code & Palette)
    // -------------------------------------------------------------
    console.log("15. Evaluating all eight Flexoki accents across light and dark modes on palette and code...");
    const flexokiTokenSet = flexokiSpec.tokenSets["flexoki-palette"];

    for (const accent of FLEXOKI_ACCENTS) {
      const accentServer = await startStaticServer(join(consumerDir, `dist/flexoki-${accent}`), 0);
      try {
        const page = await createOfflinePage();
        await page.setViewportSize({ width: 768, height: 1024 });
        await page.goto(`http://127.0.0.1:${accentServer.port}/catalog/`);

        for (const mode of ["dark", "light"]) {
          await page.evaluate((m) => {
            document.documentElement.dataset.theme = m;
          }, mode);

          const expectedAccentBase = flexokiTokenSet[`acc-${accent}-base-${mode}`];
          const expectedPalette = paletteFor(flexokiSpec, accent, mode);

          const accentObs = await page.evaluate(() => {
            const docEl = window.getComputedStyle(document.documentElement);
            const ecPre = document.querySelector(".expressive-code pre");
            const markEl = document.querySelector(".expressive-code mark, .expressive-code [data-mark]");

            return {
              slAccent: docEl.getPropertyValue("--sl-color-accent").trim(),
              tfslFocus: docEl.getPropertyValue("--tfsl-color-focus").trim(),
              hasEc: Boolean(ecPre),
              ecBg: ecPre ? getComputedStyle(ecPre).backgroundColor : null,
              markVariable: ecPre ? getComputedStyle(ecPre).getPropertyValue("--ec-tm-markBg").trim() : "",
              insVariable: ecPre ? getComputedStyle(ecPre).getPropertyValue("--ec-tm-insBg").trim() : "",
              delVariable: ecPre ? getComputedStyle(ecPre).getPropertyValue("--ec-tm-delBg").trim() : "",
            };
          });

          if (!colorMatches(accentObs.slAccent, expectedAccentBase)) {
            throw new Error(
              `Flexoki ${accent} mode ${mode} accent mismatch: expected ${expectedAccentBase}, got ${accentObs.slAccent}`
            );
          }

          if (!accentObs.hasEc) {
            throw new Error(`Flexoki ${accent} mode ${mode} missing Expressive Code block`);
          }

          // Verify code presentation marks
          const expectedMarks = flexokiSpec.codePresentation.marks;
          if (expectedMarks) {
            if (!colorMatches(accentObs.markVariable, expectedMarks.marked)) {
              throw new Error(`Flexoki ${accent} mode ${mode} marked color mismatch`);
            }
            if (!colorMatches(accentObs.insVariable, expectedMarks.inserted)) {
              throw new Error(`Flexoki ${accent} mode ${mode} inserted color mismatch`);
            }
            if (!colorMatches(accentObs.delVariable, expectedMarks.deleted)) {
              throw new Error(`Flexoki ${accent} mode ${mode} deleted color mismatch`);
            }
          }

          await capture(page, `flexoki-${accent}-${mode}`, accentObs);
        }
        await page.close();
      } finally {
        await accentServer.close();
      }
    }
    console.log("   ✓ All eight Flexoki accents evaluated and verified in light and dark modes on palette & code.");

    // -------------------------------------------------------------
    // Part C: Actual Public Search Result Navigation Built Index
    // -------------------------------------------------------------
    console.log("16. Verifying actual public search result navigation with built Pagefind index...");
    const searchServer = await startStaticServer(join(consumerDir, "dist/celestia-dogfood"), 0);
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${searchServer.port}/catalog/`);

      const searchButton = page.locator("button[data-open-modal], starlight-search button").first();
      const hasSearchButton = await searchButton.isVisible();
      if (!hasSearchButton) {
        throw new Error("Public Starlight search button is missing from header");
      }

      await searchButton.click();
      const dialog = page.locator("site-search dialog");
      await dialog.waitFor({ state: "visible", timeout: 5000 });

      // Check input presence
      const searchInput = page.locator(".pagefind-ui__search-input, input[type='search']").first();
      await searchInput.waitFor({state:"visible"});
      const hasInput = await searchInput.isVisible();
      if (!hasInput) {
        throw new Error("Search modal opened but Pagefind input is missing");
      }

      // Enter search term matching catalog documentation
      await searchInput.fill("Hero");
      const resultLinks = page.locator(".pagefind-ui__result-link, .pagefind-ui__result a");
      await resultLinks.first().waitFor({state:"visible"});
      const resultCount = await resultLinks.count();
      if (resultCount === 0) throw new Error("Built search returned no results");

      let navigatedHref = null;
      if (resultCount > 0) {
        const firstResult = resultLinks.first();
        navigatedHref = await firstResult.getAttribute("href");
        const target = new URL(navigatedHref, page.url()).href;
        await firstResult.click();
        await page.waitForURL(target);
      }

      // Verify Escape closes modal if still open
      if (await dialog.isVisible()) {
        await page.keyboard.press("Escape");
        const dialogClosed = !(await dialog.isVisible());
        if (!dialogClosed) throw new Error("Escape key did not close search modal");
      }

      const searchObs = {
        searchButtonPresent: true,
        dialogOpened: true,
        resultCount,
        navigatedHref,
        passed: true,
      };
      await capture(page, "search-navigation", searchObs);
      await page.close();
      console.log(`   ✓ Search index queried successfully (results found: ${resultCount}, navigated to: ${navigatedHref || "verified"}).`);
    } finally {
      await searchServer.close();
    }

    // -------------------------------------------------------------
    // Part D: Language Switching
    // -------------------------------------------------------------
    console.log("17. Verifying language switching via starlight-lang-select...");
    const langServer = await startStaticServer(join(consumerDir, "dist/lang-switch"), 0);
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${langServer.port}/catalog/`);

      const langSelect = page.locator("starlight-lang-select select").first();
      const hasLangSelect = await langSelect.isVisible();
      if (!hasLangSelect) {
        throw new Error("Missing starlight-lang-select control in lang-switch scenario");
      }

      const initialLang = await page.locator("html").getAttribute("lang");
      if (initialLang !== "en") {
        throw new Error(`Expected initial html lang='en', got '${initialLang}'`);
      }

      // Select French option and navigate
      await page.selectOption("starlight-lang-select select", { label: "Français" });
      await page.waitForURL(`http://127.0.0.1:${langServer.port}/fr/catalog/`);

      const switchedLang = await page.locator("html").getAttribute("lang");
      if (switchedLang !== "fr") {
        throw new Error(`Expected switched html lang='fr', got '${switchedLang}'`);
      }

      const langObs = {
        hasLangSelect,
        initialLang,
        switchedLang,
        passed: true,
      };
      await capture(page, "language-switching", langObs);
      await page.goto(`http://127.0.0.1:${langServer.port}/fr/catalog/fallback-only/`);
      const fallbackNotice = page.locator('main p.sl-flex').filter({hasText:'Ce contenu n’est pas encore disponible dans votre langue.'});
      if (!await fallbackNotice.isVisible()) throw new Error('Public FallbackContentNotice did not render');
      if (!await page.getByText('Original fallback content for the public notice qualification.').isVisible()) throw new Error('Fallback content missing');
      await capture(page,'public-fallback-notice',{noticeVisible:true,contentVisible:true});
      await page.close();
      console.log("   ✓ Language switching verified (en -> fr).");
    } finally {
      await langServer.close();
    }
    const flexokiNoticeServer=await startStaticServer(join(consumerDir,'dist/notice-flexoki'),0);
    try {
      const page=await createOfflinePage();
      await page.goto(`http://127.0.0.1:${flexokiNoticeServer.port}/fr/catalog/fallback-only/`);
      const notice=page.locator('main p.sl-flex').filter({hasText:'Ce contenu n’est pas encore disponible dans votre langue.'});
      if(!await notice.isVisible()||!await page.getByText('Original fallback content for the public notice qualification.').isVisible()) throw new Error('Flexoki public fallback notice failed');
      await capture(page,'flexoki-public-fallback-notice',{noticeVisible:true,contentVisible:true});
      await page.close();
    } finally { await flexokiNoticeServer.close(); }

    // -------------------------------------------------------------
    // Part E: Notices and Default Alternative
    // -------------------------------------------------------------
    console.log("18. Verifying notices, default alternatives, and package legal artifacts...");
    const noticesServer = await startStaticServer(join(consumerDir, "dist/black-dogfood"), 0);
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${noticesServer.port}/catalog/`);

      const noticeCheck = await page.evaluate(() => {
        const asides = Array.from(document.querySelectorAll(".starlight-aside"));
        const asideTypes = asides.map((a) => a.className);
        return {
          asideCount: asides.length,
          asideTypes,
        };
      });

      if (noticeCheck.asideCount < 4) {
        throw new Error(`Expected at least 4 starlight-asides (note, tip, caution, danger); found ${noticeCheck.asideCount}`);
      }

      // Verify Hero announcement on centered hero
      await page.goto(`http://127.0.0.1:${noticesServer.port}/catalog/hero-centered/`);
      const announcementCheck = await page.evaluate(() => {
        const announcement = document.querySelector(".tfsl-hero-announcement");
        return {
          found: Boolean(announcement),
          text: announcement?.textContent?.trim() || null,
        };
      });
      if (!announcementCheck.found || !announcementCheck.text?.includes("Announcing Stellar Loom Catalog")) {
        throw new Error(`Hero announcement check failed: ${JSON.stringify(announcementCheck)}`);
      }

      // Default alternative: route without announcement does not render empty announcement container
      await page.goto(`http://127.0.0.1:${noticesServer.port}/catalog/hero-media-top/`);
      const noAnnouncementCheck = await page.evaluate(() => {
        return Boolean(document.querySelector(".tfsl-hero-announcement"));
      });
      if (noAnnouncementCheck) {
        throw new Error("Default alternative failed: route without announcement rendered announcement container");
      }

      // Verify package legal notice files in generated packages
      const blackRunDir = join(workDir, "gen-loom-black-run1");
      const hasNoticeFile = existsSync(join(blackRunDir, "NOTICE"));
      const hasLicenseFile = existsSync(join(blackRunDir, "LICENSE"));
      const hasCommercialLicense = existsSync(join(blackRunDir, "COMMERCIAL-LICENSE.md"));
      if (!hasNoticeFile || !hasLicenseFile || !hasCommercialLicense) {
        throw new Error("Missing required package legal notice files in generated theme package");
      }

      await capture(page, "notices-and-alternatives", {
        noticeCheck,
        announcementCheck,
        defaultAlternativeClean: !noAnnouncementCheck,
        legalArtifacts: { hasNoticeFile, hasLicenseFile, hasCommercialLicense },
      });
      await page.close();
      console.log("   ✓ Notices, hero announcements, default alternatives, and package legal artifacts qualified.");
    } finally {
      await noticesServer.close();
    }

    // -------------------------------------------------------------
    // Part F: Mobile TOC and Site-Title
    // -------------------------------------------------------------
    console.log("19. Verifying Mobile TOC and Site-Title at mobile viewport (390px)...");
    const mobileServer = await startStaticServer(join(consumerDir, "dist/celestia-dogfood"), 0);
    try {
      const page = await createOfflinePage();
      await page.setViewportSize({ width: 390, height: 800 });
      await page.goto(`http://127.0.0.1:${mobileServer.port}/catalog/`);

      const mobileUiObs = await page.evaluate(() => {
        const siteTitle = document.querySelector("a.site-title");
        const siteTitleRect = siteTitle ? siteTitle.getBoundingClientRect() : null;
        const siteTitleText = siteTitle ? siteTitle.textContent?.trim() : null;
        const siteTitleHref = siteTitle ? siteTitle.getAttribute("href") : null;

        const mobileToc = document.querySelector("mobile-starlight-toc, nav.mobile-starlight-toc, .mobile-starlight-toc, details.right-sidebar");
        const mobileTocSummary = mobileToc ? mobileToc.querySelector("summary") : null;

        const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;

        return {
          siteTitlePresent: Boolean(siteTitle),
          siteTitleText,
          siteTitleHref,
          siteTitleWithinViewport: siteTitleRect ? siteTitleRect.right <= 391 : false,
          mobileTocPresent: Boolean(mobileToc),
          mobileTocSummaryPresent: Boolean(mobileTocSummary),
          overflow,
        };
      });

      if (!mobileUiObs.siteTitlePresent || !mobileUiObs.siteTitleWithinViewport) {
        throw new Error(`Mobile site-title check failed: ${JSON.stringify(mobileUiObs)}`);
      }
      if (mobileUiObs.overflow) {
        throw new Error("Mobile horizontal overflow detected");
      }

      // Preserved defaults require real interaction, including missing-control failure.
      const tocSummary = page.locator("mobile-starlight-toc summary, nav.mobile-starlight-toc summary, details.right-sidebar summary").first();
      if (!await tocSummary.isVisible()) throw new Error("Mobile TOC summary missing");
      if (await tocSummary.isVisible()) {
        await tocSummary.click();
        const tocLinks = page.locator("mobile-starlight-toc a, nav.mobile-starlight-toc a, details.right-sidebar a");
        const count = await tocLinks.count();
        if (count === 0) throw new Error("Mobile TOC links missing");
        if (count > 0) {
          const firstLink = tocLinks.filter({hasNotText:'Overview'}).last();
          const href = await firstLink.getAttribute('href');
          await firstLink.click();
          await page.waitForURL(new URL(href,page.url()).href);
        }
      }
      await capture(page, "mobile-toc-and-site-title", mobileUiObs);
      await page.locator('a.site-title').click();
      await page.waitForURL(`http://127.0.0.1:${mobileServer.port}/`);
      await capture(page,'site-title-navigation',{arrivedHome:true});
      await page.setViewportSize({width:1440,height:900});
      const social=page.locator('a[href="https://example.invalid/project"]').first();
      await social.focus();
      if(!await social.isVisible()||!await social.evaluate(el=>el===document.activeElement&&(el.getAttribute('aria-label')||el.textContent.trim()).includes('Project repository'))) throw new Error('Public social link inaccessible');
      await capture(page,'public-social-link',{visible:true,focusable:true,destination:'https://example.invalid/project',navigationNotExercised:true});
      await page.close();
      console.log("   ✓ Mobile TOC and Site-Title qualified at 390px viewport.");
    } finally {
      await mobileServer.close();
    }

    // -------------------------------------------------------------
    // Part G: Consumer Expressive Code Overrides (false, leaf, array)
    // -------------------------------------------------------------
    console.log("20. Verifying Consumer Expressive Code overrides (false, leaf, and array)...");

    // 1. expressiveCode: false
    const falseEcServer = await startStaticServer(join(consumerDir, "dist/false-ec"), 0);
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${falseEcServer.port}/catalog/`);
      const ecCount = await page.evaluate(() => document.querySelectorAll(".expressive-code").length);
      const preCount = await page.evaluate(() => document.querySelectorAll("pre").length);
      if (ecCount !== 0) {
        throw new Error(`Expected 0 .expressive-code elements with expressiveCode: false, got ${ecCount}`);
      }
      if (preCount === 0) {
        throw new Error("Expected standard markdown <pre> elements when expressiveCode is false");
      }
      await capture(page, "consumer-ec-false", { ecCount, preCount, passed: true });
      await page.close();
      console.log("   ✓ Consumer expressiveCode: false verified (0 .expressive-code, standard <pre> rendered).");
    } finally {
      await falseEcServer.close();
    }

    // 2. Leaf style overrides
    const leafServer = await startStaticServer(join(consumerDir, "dist/consumer-leaf"), 0);
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${leafServer.port}/catalog/`);
      const ecPreBg = await page.locator(".expressive-code pre").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      if (!colorMatches(ecPreBg, "#123456")) {
        throw new Error(`Consumer leaf style override did not win: expected #123456, got ${ecPreBg}`);
      }
      await capture(page, "consumer-ec-leaf", { ecPreBg, passed: true });
      await page.close();
      console.log("   ✓ Consumer leaf style override verified (terminal background #123456 won).");
    } finally {
      await leafServer.close();
    }

    // 3. Array replacement
    const arraysServer = await startStaticServer(join(consumerDir, "dist/consumer-arrays"), 0);
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${arraysServer.port}/catalog/`);
      const installedPlugin = (
        await import(pathToFileURL(join(consumerDir, "node_modules/@smoke/starlight-theme-loom-black-dogfood/index.js")).href)
      ).default();
      let update;
      await installedPlugin.hooks["config:setup"]({
        addRouteMiddleware() {},
        config: { expressiveCode: { themes: ["github-light"] } },
        updateConfig(v) {
          update = v;
        },
      });
      if (JSON.stringify(update.expressiveCode.themes) !== '["github-light"]') {
        throw new Error("Consumer array options were unexpectedly merged instead of replaced");
      }
      let emptyUpdate;
      await installedPlugin.hooks['config:setup']({config:{expressiveCode:{themes:[]}},addRouteMiddleware(){},updateConfig(value){emptyUpdate=value;}});
      if (JSON.stringify(emptyUpdate.expressiveCode.themes)!=='[]') throw new Error('Empty array replacement failed');
      await capture(page, "consumer-ec-arrays", { themes: update.expressiveCode.themes, passed: true });
      await page.close();
      console.log("   ✓ Consumer array replacement verified (themes: ['github-light'] replaced defaults).");
    } finally {
      await arraysServer.close();
    }

    // -------------------------------------------------------------
    // Part H: Retained Catalog Assertions
    // -------------------------------------------------------------
    console.log("21. Executing retained catalog assertions: font, print, sidebar-less, theme persistence, hero, pagination, sidebar...");

    // 1. All 5 Hero layouts and precedence
    const heroServer = await startStaticServer(join(consumerDir, "dist/black-dogfood"), 0);
    try {
      const page = await createOfflinePage();
      const heroScenarios = [
        { route: "hero-centered", expectedLayout: "centered" },
        { route: "hero-media-top", expectedLayout: "media-top", hasMedia: true },
        { route: "hero-media-left", expectedLayout: "media-left", hasMedia: true },
        { route: "hero-media-right", expectedLayout: "media-right", hasMedia: true },
        { route: "hero-banner", expectedLayout: "banner" },
      ];

      for (const hs of heroScenarios) {
        await page.goto(`http://127.0.0.1:${heroServer.port}/catalog/${hs.route}/`);
        const heroCheck = await page.evaluate((expected) => {
          const root = document.querySelector(".tfsl-hero");
          if (!root) return { found: false };
          const h1 = document.querySelector("h1");
          const singleH1 = document.querySelectorAll("h1").length === 1;
          const h1Id = h1 ? h1.id : null;
          const hasLayoutClass = root.classList.contains(`layout-${expected}`);
          const hasMedia = Boolean(root.querySelector(".tfsl-hero-media svg"));
          const actions = document.querySelectorAll(".tfsl-hero-actions a, .action-btn");
          const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
          const allIds = Array.from(document.querySelectorAll("[id]")).map((el) => el.id);
          const uniqueIds = new Set(allIds).size === allIds.length;

          return {
            found: true,
            hasLayoutClass,
            hasMedia,
            singleH1,
            h1Id,
            uniqueIds,
            hasActions: actions.length > 0,
            overflow,
          };
        }, hs.expectedLayout);

        if (!heroCheck.found || !heroCheck.hasLayoutClass || !heroCheck.singleH1 || heroCheck.h1Id !== "_top" || !heroCheck.uniqueIds) {
          throw new Error(`Hero layout failed for ${hs.route}: ${JSON.stringify(heroCheck)}`);
        }
        await capture(page, hs.route, heroCheck);
      }
      await page.close();
    } finally {
      await heroServer.close();
    }

    // Consumer base path & frontmatter precedence
    const baseServer = await startStaticServer(join(consumerDir, "dist/base-catalog"), 0, "/guide");
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${baseServer.port}/guide/catalog/hero-centered/`);
      const hrefs = await page.locator(".tfsl-hero-action-btn").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
      if (!hrefs.length || hrefs.some((href) => !href.startsWith("/guide/") && !href.startsWith("#"))) {
        throw new Error("Catalog Hero base mismatch");
      }
      await page.goto(`http://127.0.0.1:${baseServer.port}/guide/catalog/consumer-hero/`);
      if (
        (await page.locator("h1").count()) !== 1 ||
        (await page.locator("h1").textContent()) !== "Consumer frontmatter wins" ||
        (await page.locator(".tfsl-hero").count()) !== 0
      ) {
        throw new Error("Consumer frontmatter Hero precedence failed");
      }
      await capture(page, "base-and-frontmatter", { base: "/guide/", hrefs, consumerHeroWins: true });
      await page.close();
    } finally {
      await baseServer.close();
    }

    // 2. Pagination variants: plain, card, compact
    for (const [theme, expectedVariant] of [
      ["flexoki-cyan", "plain"],
      ["black-dogfood", "card"],
      ["celestia-dogfood", "compact"],
    ]) {
      const pagServer = await startStaticServer(join(consumerDir, `dist/${theme}`), 0);
      try {
        const page = await createOfflinePage();
        await page.goto(`http://127.0.0.1:${pagServer.port}/catalog/sidebar-nested/`);
        const pagCheck = await page.evaluate((expected) => {
          const nav = document.querySelector("nav.tfsl-pagination");
          if (!nav) return { found: false };
          const hasVariantClass = nav.classList.contains(`variant-${expected}`);
          const links = Array.from(nav.querySelectorAll("a"));
          const specificContainer = nav.querySelector(`.pagination-${expected}`);
          return {
            found: true,
            hasVariantClass,
            linkCount: links.length,
            hasSpecificContainer: Boolean(specificContainer),
          };
        }, expectedVariant);

        if (!pagCheck.found || !pagCheck.hasVariantClass || !pagCheck.hasSpecificContainer || pagCheck.linkCount === 0) {
          throw new Error(`Pagination check failed for ${theme} (${expectedVariant})`);
        }
        await capture(page, `pagination-${expectedVariant}`, pagCheck);
        await page.close();
      } finally {
        await pagServer.close();
      }
    }

    // 3. Nested Sidebar Hierarchy
    const nestedServer = await startStaticServer(join(consumerDir, "dist/black-dogfood"), 0);
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${nestedServer.port}/catalog/sidebar-nested/`);
      const nestedHierarchy = await page.evaluate(() => {
        const subgroup = document.querySelector(".tfsl-nav-tree .tfsl-nav-tree details");
        const sublistInner = document.querySelector(".tfsl-nav-tree .tfsl-nav-tree .tfsl-nav-tree");
        const currentLink = document.querySelector(".tfsl-nav-tree a[aria-current=page]");
        return {
          subgroupPresent: Boolean(subgroup),
          sublistInnerPresent: Boolean(sublistInner),
          currentLinkPresent: Boolean(currentLink),
        };
      });
      if (!nestedHierarchy.subgroupPresent || !nestedHierarchy.sublistInnerPresent || !nestedHierarchy.currentLinkPresent) {
        throw new Error(`Nested sidebar failed: ${JSON.stringify(nestedHierarchy)}`);
      }
      await capture(page, "sidebar-nested", nestedHierarchy);
      await page.close();
    } finally {
      await nestedServer.close();
    }

    // 4. Tabs Roving Keyboard Navigation
    const tabsServer = await startStaticServer(join(consumerDir, "dist/celestia-dogfood"), 0);
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${tabsServer.port}/catalog/`);

      const tabCount = await page.evaluate(() => document.querySelectorAll(".tfsl-roving-tablist [role='tab']").length);
      if (tabCount < 2) throw new Error(`Tabs mode requires at least 2 tabs; found ${tabCount}`);

      await page.focus(".tfsl-roving-tablist [role='tab']:first-child");
      await page.keyboard.press("ArrowRight");
      const tab1Active = await page.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll(".tfsl-roving-tablist [role='tab']"));
        return document.activeElement === tabs[1] && tabs[1].getAttribute("aria-selected") === "true";
      });
      if (!tab1Active) throw new Error("Tabs ArrowRight roving focus failed");

      await page.keyboard.press("ArrowLeft");
      const tab0Active = await page.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll(".tfsl-roving-tablist [role='tab']"));
        return document.activeElement === tabs[0];
      });
      if (!tab0Active) throw new Error("Tabs ArrowLeft roving focus failed");

      await capture(page, "sidebar-tabs-keyboard", { tabCount, rovingWorking: true });
      await page.close();
    } finally {
      await tabsServer.close();
    }

    // 5. Select Dropdown Sidebar
    const selectServer = await startStaticServer(join(consumerDir, "dist/flexoki-cyan"), 0);
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${selectServer.port}/catalog/`);
      const options = await page.evaluate(() => {
        const s = document.getElementById("tfsl-sidebar-dropdown");
        return s ? Array.from(s.querySelectorAll("option")).map((o) => o.value) : [];
      });
      if (options.length < 2) throw new Error("Select dropdown options missing");
      await page.selectOption("#tfsl-sidebar-dropdown", options[1]);
      await page.evaluate(() => document.getElementById("tfsl-sidebar-dropdown")?.dispatchEvent(new Event("change")));
      const panelVisible = await page.evaluate((opt) => {
        const p = document.getElementById("tfsl-nav-panel-" + opt);
        return p ? !p.hidden : false;
      }, options[1]);
      if (!panelVisible) throw new Error("Select dropdown change event did not reveal panel");
      await capture(page, "sidebar-select", { options, panelVisible });
      await page.close();
    } finally {
      await selectServer.close();
    }

    // 6. Active-Only Sidebar and Deterministic No-Match Fallback
    const activeOnlyServer = await startStaticServer(join(consumerDir, "dist/active-only-dogfood"), 0);
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${activeOnlyServer.port}/catalog/`);
      const groupCount = await page.evaluate(
        () => document.querySelectorAll('[data-tfsl-sidebar-mode="active-only"] .tfsl-sidebar-panel:not([hidden])').length
      );
      if (groupCount !== 1) throw new Error(`Active-only mode must render exactly 1 active panel, found ${groupCount}`);

      await page.goto(`http://127.0.0.1:${activeOnlyServer.port}/catalog/no-match/`);
      const fallback = await page.locator(".tfsl-sidebar-panel:not([hidden])").getAttribute("data-group-id");
      if (fallback !== "catalog-core") throw new Error("Active-only no-match fallback was not the first group");
      await capture(page, "active-only-no-match", { groupCount, fallback });
      await page.close();
    } finally {
      await activeOnlyServer.close();
    }

    // 7. Sidebar-less Content Width
    const widthServer = await startStaticServer(join(consumerDir, "dist/black-dogfood"), 0);
    try {
      const page = await createOfflinePage();
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`http://127.0.0.1:${widthServer.port}/catalog/sidebar-less/`);

      const widthCheck = await page.evaluate(() => {
        const sidebar = document.querySelector("nav.sidebar, .sidebar-pane");
        const sidebarVisible = sidebar && window.getComputedStyle(sidebar).display !== "none";
        const docEl = window.getComputedStyle(document.documentElement);
        const slContentWidth = docEl.getPropertyValue("--sl-content-width").trim();
        const content = document.querySelector(".sl-markdown-content")?.closest(".sl-container");

        return {
          sidebarVisible,
          slContentWidth,
          contentMaxWidth: content ? getComputedStyle(content).maxWidth : null,
          contentRenderedWidth: content ? content.getBoundingClientRect().width : null,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        };
      });

      if (widthCheck.sidebarVisible) throw new Error("Sidebar-less template must not have visible sidebar");
      if (widthCheck.overflow) throw new Error("Sidebar-less template has horizontal overflow");
      if (widthCheck.slContentWidth !== "72rem" && !widthCheck.slContentWidth.includes("1152")) {
        throw new Error(`Sidebar-less computed --sl-content-width mismatch: got '${widthCheck.slContentWidth}'`);
      }
      if (widthCheck.contentMaxWidth !== "1152px" || Math.abs(widthCheck.contentRenderedWidth - 1152) > 1) {
        throw new Error("Sidebar-less rendered content width mismatch: " + JSON.stringify(widthCheck));
      }

      await capture(page, "sidebarless-width", widthCheck);
      await page.close();
    } finally {
      await widthServer.close();
    }

    // 8. Print Media Coherence Across Themes
    for (const printTheme of ["black-dogfood", "flexoki-cyan"]) {
      const printServer = await startStaticServer(join(consumerDir, `dist/${printTheme}`), 0);
      try {
        const page = await createOfflinePage();
        await page.goto(`http://127.0.0.1:${printServer.port}/catalog/`);

        for (const initialMode of ["dark", "light"]) {
          await page.evaluate((m) => {
            document.documentElement.dataset.theme = m;
          }, initialMode);
          await page.emulateMedia({ media: "print" });

          const printObs = await page.evaluate(() => {
            const body = window.getComputedStyle(document.body);
            const docEl = window.getComputedStyle(document.documentElement);
            return {
              bgColor: body.backgroundColor,
              color: body.color,
              slBg: docEl.getPropertyValue("--sl-color-bg").trim(),
              slText: docEl.getPropertyValue("--sl-color-text").trim(),
              codeBackground: getComputedStyle(document.querySelector(".expressive-code pre")).backgroundColor,
            };
          });
          await page.emulateMedia({ media: null });

          const selected = printTheme === "black-dogfood" ? blackSpec : flexokiSpec;
          const accent = printTheme === "black-dogfood" ? "default" : "cyan";
          const light = paletteFor(selected, accent, "light");

          if (!colorMatches(printObs.bgColor, light.page)) {
            throw new Error(`Print ${printTheme}/${initialMode} bgColor mismatch`);
          }
          if (!colorMatches(printObs.color, light.body)) {
            throw new Error(`Print ${printTheme}/${initialMode} color mismatch`);
          }

          await capture(page, `print-${printTheme}-${initialMode}`, printObs);
        }
        await page.close();
      } finally {
        await printServer.close();
      }
    }

    // 9. Consumer CSS and Component Overrides
    const cssServer = await startStaticServer(join(consumerDir, "dist/consumer-css"), 0);
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${cssServer.port}/catalog/sidebar-less/`);
      const cssOverrideCheck = await page.evaluate(() => {
        const docEl = window.getComputedStyle(document.documentElement);
        return { slContentWidth: docEl.getPropertyValue("--sl-content-width").trim() };
      });
      if (cssOverrideCheck.slContentWidth !== "65rem" && !cssOverrideCheck.slContentWidth.includes("1040")) {
        throw new Error(`Consumer CSS failed to override --sl-content-width: got '${cssOverrideCheck.slContentWidth}'`);
      }
      await capture(page, "consumer-css", cssOverrideCheck);
      await page.close();
    } finally {
      await cssServer.close();
    }

    const overrideServer = await startStaticServer(join(consumerDir, "dist/consumer-override"), 0);
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${overrideServer.port}/catalog/`);
      const overrideCheck = await page.evaluate(() => {
        const root = document.querySelector("[data-catalog-consumer-page-title='true']");
        const marker = document.querySelector("[data-testid='catalog-consumer-page-title-marker'], .catalog-consumer-badge");
        const h1s = Array.from(document.querySelectorAll("h1"));
        return {
          overridePresent: Boolean(root),
          markerPresent: Boolean(marker),
          singleH1: h1s.length === 1,
          h1Id: h1s[0]?.id || null,
        };
      });
      if (!overrideCheck.overridePresent || !overrideCheck.markerPresent || !overrideCheck.singleH1 || overrideCheck.h1Id !== "_top") {
        throw new Error(`Consumer PageTitle precedence failed: ${JSON.stringify(overrideCheck)}`);
      }
      await capture(page, "consumer-component", overrideCheck);
      await page.close();
    } finally {
      await overrideServer.close();
    }

    // 10. Theme Switch & Reload Persistence
    const themeSwitchServer = await startStaticServer(join(consumerDir, "dist/black-dogfood"), 0);
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${themeSwitchServer.port}/catalog/`);

      const selectExists = await page.evaluate(() => Boolean(document.querySelector("starlight-theme-select select")));
      if (!selectExists) throw new Error("Missing public theme selection control");

      await page.selectOption("starlight-theme-select select", "light");
      await page.reload();
      const persistedLight = await page.evaluate(() => ({
        theme: document.documentElement.dataset.theme,
        storage: localStorage.getItem("starlight-theme"),
      }));
      if (persistedLight.theme !== "light" || persistedLight.storage !== "light") {
        throw new Error(`Theme persistence across reload failed: ${JSON.stringify(persistedLight)}`);
      }
      await capture(page, "theme-persistence", persistedLight);
      await page.close();
    } finally {
      await themeSwitchServer.close();
    }

    // 11. PageTitle Copy Button via Explicit Keyboard Action
    const copyServer = await startStaticServer(join(consumerDir, "dist/celestia-dogfood"), 0);
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${copyServer.port}/catalog/`);

      await page.evaluate(() => {
        window["__capturedClipboard"] = [];
        if (!navigator.clipboard) {
          Object.defineProperty(navigator, "clipboard", {
            value: { writeText: async (t) => { window["__capturedClipboard"].push(t); } },
            configurable: true,
          });
        } else {
          navigator.clipboard.writeText = async (t) => { window["__capturedClipboard"].push(t); };
        }
      });

      await page.focus(".tfsl-title-copy-btn");
      await page.keyboard.press("Enter");

      const capturedTitle = await page.evaluate(() => window["__capturedClipboard"]?.[0] || null);
      if (!capturedTitle || !capturedTitle.includes("Catalog Verification Overview")) {
        throw new Error(`Keyboard copy mode failed, got: '${capturedTitle}'`);
      }
      await capture(page, "copy-button-keyboard", { capturedTitle, passed: true });
      await page.close();
    } finally {
      await copyServer.close();
    }

    // 12. Font CDP Platform Glyphs & Corrupted Negative Test
    const fontServer = await startStaticServer(join(consumerDir, "dist/celestia-dogfood"), 0);
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${fontServer.port}/catalog/`);
      await page.evaluate(() => document.fonts.ready);

      const fontsStatus = await page.evaluate(() => document.fonts.status);
      if (fontsStatus !== "loaded") throw new Error(`document.fonts.status is '${fontsStatus}'`);

      const cdp = await page.context().newCDPSession(page);
      await cdp.send("DOM.enable");
      await cdp.send("CSS.enable");
      const rootDoc = await cdp.send("DOM.getDocument");
      const { nodeId } = await cdp.send("DOM.querySelector", {
        nodeId: rootDoc.root.nodeId,
        selector: "#catalog-font-probe",
      });
      if (!nodeId) throw new Error("Could not find font probe node for CDP");

      const cdpFonts = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
      const platformFonts = cdpFonts?.fonts ?? [];
      const customFontMatch = platformFonts.find(
        (f) => f.familyName.includes("Source Code Pro") && f.isCustomFont && f.glyphCount > 0
      );
      if (!customFontMatch) {
        throw new Error(`CDP Platform Font assertion failed: ${JSON.stringify(platformFonts)}`);
      }

      await capture(page, "real-font-use", { customFontMatch, platformFonts });

      // Corrupted font negative test
      const corruptedBytes = Buffer.from("CORRUPTED_FONT_DATA_INVALID_WOFF2_HEADER");
      const negativeServer = createServer((req, res) => {
        if (req.url === "/bad-font.woff2") {
          res.writeHead(200, { "Content-Type": "font/woff2" });
          res.end(corruptedBytes);
        } else {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`<!DOCTYPE html><html><head><style>
@font-face { font-family: "CorruptedFont"; src: url("/bad-font.woff2") format("woff2"); }
code { font-family: "CorruptedFont", monospace; }
</style></head><body><code id="bad-code">Negative Corrupt Font Probe</code></body></html>`);
        }
      });
      await new Promise((r) => negativeServer.listen(0, "127.0.0.1", r));
      const negPort = negativeServer.address().port;

      const negPage = await browser.newPage();
      await negPage.goto(`http://127.0.0.1:${negPort}/`);
      await negPage.evaluate(() => document.fonts.load('16px "CorruptedFont"')).catch(() => {});

      const fontLoadError = await negPage.evaluate(async () => {
        const fontFaces = Array.from(document.fonts);
        const badFace = fontFaces.find((f) => f.family === "CorruptedFont");
        return badFace ? badFace.status === "error" : false;
      });

      const negCdp = await negPage.context().newCDPSession(negPage);
      await negCdp.send("DOM.enable");
      await negCdp.send("CSS.enable");
      const negRoot = await negCdp.send("DOM.getDocument");
      const { nodeId: negNodeId } = await negCdp.send("DOM.querySelector", {
        nodeId: negRoot.root.nodeId,
        selector: "#bad-code",
      });
      const negFonts = await negCdp.send("CSS.getPlatformFontsForNode", { nodeId: negNodeId });
      const negPlatformFonts = negFonts?.fonts ?? [];

      const corruptedCustomGlyphsRendered = negPlatformFonts.some(
        (f) => f.familyName.includes("CorruptedFont") && f.glyphCount > 0
      );

      if (!fontLoadError || corruptedCustomGlyphsRendered) {
        throw new Error("Corrupted font unexpectedly rendered platform glyphs");
      }

      await negPage.close();
      await new Promise((done) => negativeServer.close(done));
      await page.close();
    } finally {
      await fontServer.close();
    }

    console.log("   ✓ All retained catalog assertions verified successfully.");

    // -------------------------------------------------------------
    // Part I: Explicit Negative Deferred Scenarios
    // -------------------------------------------------------------
    console.log("22. Evaluating explicit negative deferred scenarios (layout slots, code tabs, virtual data, provider provenance, rejected execution)...");

    const deferredResults = {};
    const requireRejected = (spec, id) => {
      let error;
      try { loom.validateThemeCatalog(spec); } catch (err) { error=err.message; }
      if (!error) throw new Error('Unexpectedly accepted negative fixture: '+id);
      return {rejected:true,errorMessage:error};
    };

    // 1. Layout slots: Black relocated header controls, custom PageFrame, TwoColumnContent
    {
      const invalidLayoutSpec = JSON.parse(JSON.stringify(blackSpec));
      invalidLayoutSpec.layoutSlots = { relocatedHeader: true, customTwoColumn: true };
      deferredResults.layoutSlotsRejected = {
        ...requireRejected(invalidLayoutSpec,'layout-slots'),
        disposition: "DEFER_TO_0_2_X",
      };
    }

    // 2. Code tabs: tabs: 'deferred' sentinel must be preserved
    {
      const invalidTabsSpec = JSON.parse(JSON.stringify(blackSpec));
      invalidTabsSpec.codePresentation.tabs = "working";
      deferredResults.codeTabsRejected = {
        ...requireRejected(invalidTabsSpec,'code-tabs'),
        disposition: "DEFER_TO_0_2_X",
      };
    }

    // 3. Virtual data: virtual modules deferred, fixed JSON emitted
    const blackRunDir = join(workDir, "gen-loom-black-run1");
    const hasStaticCatalogData = existsSync(join(blackRunDir, "catalog-data.json"));
    if (!hasStaticCatalogData) {
      throw new Error("Theme package missing static catalog-data.json");
    }
    deferredResults.virtualDataDeferred = {
      ...requireRejected({...blackSpec,virtualData:{module:'virtual:theme-data'}},'virtual-data'),
      usesStaticJson: true,
      virtualModulesDeferred: true,
      disposition: "DEFER_TO_0_2_X",
    };

    // 4. Provider provenance: external font provider URLs rejected
    {
      const invalidFontSpec = JSON.parse(JSON.stringify(celestiaSpec));
      invalidFontSpec.fonts[0].path = "https://fonts.googleapis.com/css2?family=Source+Code+Pro";
      deferredResults.providerProvenanceRejected = {
        ...requireRejected(invalidFontSpec,'provider-provenance'),
        disposition: "DEFER_TO_0_2_X",
      };
    }

    // 5. Rejected internal execution: script injection / unsafe objects
    {
      const evilSpec = JSON.parse(JSON.stringify(blackSpec));
      evilSpec.evilFunction = () => "unauthorized_execution";
      deferredResults.rejectedInternalExecution = {
        ...requireRejected(evilSpec,'internal-execution'),
        disposition: "REJECTED_INTERNAL_OR_UNSAFE",
      };
    }

    receipt.deferredScenarios = deferredResults;
    console.log("   ✓ All 5 explicit negative deferred scenarios confirmed rejected or deferred as required.");

    // -------------------------------------------------------------
    // Part J: Final Validation
    // -------------------------------------------------------------
    if (browserObservations.externalRequestsRejected > 0) {
      throw new Error(`Offline isolation breached: ${browserObservations.externalRequestsRejected} external requests detected`);
    }

    if (pageErrors.length > 0) {
      throw new Error(`Fatal page errors encountered: ${pageErrors.join("; ")}`);
    }

    receipt.browserObservations = browserObservations;
    receipt.status = "passed";
    receipt.completed = new Date().toISOString();
    console.log("   ✓ All dogfood envelope qualification assertions passed successfully.");
  } finally {
    await browser.close();
  }

  const sanitizedReceipt = { ...receipt };
  delete sanitizedReceipt.workDir;
  const receiptJson = JSON.stringify(sanitizedReceipt, null, 2);
  await writeFile(join(evidenceDir, "receipt.json"), receiptJson, "utf8");
  await writeFile(join(workDir, "receipt.json"), receiptJson, "utf8");

  if (cliArgs.json) {
    process.stdout.write(receiptJson + "\n");
  }

  return sanitizedReceipt;
}

// Direct execution entrypoint
const isDirectExecution = process.argv[1] && resolve(process.argv[1]) === resolve(__filename);
if (isDirectExecution) {
  runDogfoodSmoke()
    .then((receipt) => {
      if (receipt.status === "blocked") {
        console.log(`\n[SMOKE BLOCKED] ${receipt.blockedReason}`);
        process.exit(2);
      }
      if (receipt.status === "passed") {
        console.log("\n[SMOKE PASSED] All dogfood envelope qualification scenarios passed.");
        process.exit(0);
      }
      process.exit(1);
    })
    .catch((err) => {
      console.error("\nFATAL: Smoke qualification error:", err);
      process.exit(1);
    });
}
