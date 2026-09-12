#!/usr/bin/env node
// @ts-check

/**
 * smoke-catalog.mjs
 *
 * Qualification smoke tool for Theme Forge Stellar Loom Catalog & Component Presentation (61B-catalog).
 * Exercises:
 *  - Fresh pack of Loom twice with deterministic member/tarball identity retention
 *  - Fresh disposable tool consumer with npm install --ignore-scripts
 *  - Dynamic ESM import of installed package by file URL
 *  - Catalog domain exports qualification (compileThemeCatalog, generateThemePackageCatalog, etc.)
 *  - Verification of first-party catalog examples: loom-black-catalog, loom-flexoki-catalog, loom-celestia-catalog
 *  - Exact catalog schema: hero (5 layouts), pagination (3 variants), sidebar (4 modes), pageTitle (3 copy modes), layout (2 modes), fontLicenses
 *  - Deterministic package generation across independent directories (two runs byte-for-byte identical)
 *  - Clean installation into a copy of fixture with original lock retention
 *  - Pinned runtime identity: Node 22, Astro 7.3.1, Starlight 0.42.0, Expressive Code 0.44.2, Shiki 4.4.3, Playwright 1.62.1
 *  - Static Astro builds across scenario matrix
 *  - Offline Playwright Chromium CDP assertions:
 *      Pairwise 390 / 768 / 1440 viewports x light / dark modes
 *      All 5 Hero layouts: centered, media-top, media-left, media-right, banner
 *      3 Pagination variants: plain, card, compact
 *      4 Sidebar modes: nested, tabs, select, active-only
 *      Current route / nested / no-match navigation
 *      Mobile keyboard navigation and visible focus outline
 *      Light-dark switch and persistence
 *      Sidebar-less widths (template: splash) without horizontal overflow
 *      Print media (@media print) coherent colors and readable code
 *      Consumer later CSS matching specificity override
 *      Consumer PageTitle component override precedence
 *      Single h1 _top and unique IDs across all elements
 *      Representative cards, asides, badges, tables, tabs, file trees
 *      No horizontal overflow at any tested viewport
 *      Zero external runtime requests (asserted offline isolation)
 *      No false working code tabs (deferred tabs preserved)
 *      Font CDP CSS.getPlatformFontsForNode: family Source Code Pro, custom glyphs > 0, document.fonts loaded
 *      Font corrupted / missing negative test
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
  const tokens = spec.tokenSets[variant.tokenSet];
  return Object.fromEntries(Object.entries(variant[mode]).map(([role, name]) => {
    let value = tokens[name];
    for (let i=0; typeof value === "object" && i<16; i++) value = tokens[value.alias];
    if (typeof value !== "string") throw new Error("Fixture token resolution failed");
    return [role,value];
  }));
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

export async function runCatalogSmoke() {
  const cliArgs = parseCliArgs();
  const startTime = new Date().toISOString();

  console.log("=== Stellar Loom Catalog & Component Presentation (61B-catalog) Smoke Qualification ===");

  // Enforce explicit fresh work directory
  if (!cliArgs.workDir) {
    throw new Error(
      "Missing required CLI argument: --work-dir <path>. Explicit work directory is mandatory; default or ambient scratch directories are not permitted."
    );
  }
  const workDir = cliArgs.workDir;
  await mkdir(workDir, { recursive: true });
  console.log(`1. Using explicit work directory: ${workDir}`);

  const evidenceDir = join(workDir, "evidence");
  await mkdir(evidenceDir, { recursive: true });

  const receipt = {
    schema: "tfsb61b-catalog-qualification-v1",
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
      heroLayouts: [...HERO_LAYOUTS],
      paginationVariants: [...PAGINATION_VARIANTS],
      sidebarModes: [...SIDEBAR_MODES],
      pageTitleCopyModes: [...PAGETITLE_COPY_MODES],
      layouts: [...LAYOUT_MODES],
      viewports: [390, 768, 1440],
      modes: ["dark", "light"],
      themes: ["black-catalog", "flexoki-catalog", "celestia-catalog", "active-only-catalog"],
    },
    originalLockDigest: null,
    postInstallLockDigest: null,
    loomTarball: null,
    packDeterminism: null,
    compiledThemes: [],
    installedCatalogExamples: [],
    fontVerification: {
      expected: EXPECTED_FONT,
      cdpUseProof: null,
      corruptedNegativeTest: null,
    },
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
  // Step 1: Initial Build Check via build-catalog-evidence.mjs
  // -------------------------------------------------------------
  console.log("2. Invoking tools/build-catalog-evidence.mjs for initial qualification build...");
  const buildEvidenceScript = join(LOOM_ROOT, "tools/build-catalog-evidence.mjs");
  let buildProc;
  if (existsSync(buildEvidenceScript)) {
    buildProc = spawnSync("node", ["tools/build-catalog-evidence.mjs"], {
      cwd: LOOM_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } else {
    buildProc = spawnSync("npm", ["run", "build"], {
      cwd: LOOM_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  const loomPkgJson = JSON.parse(await readFile(join(LOOM_ROOT, "package.json"), "utf8"));
  const primaryExportSubpath = loomPkgJson.exports?.["."]?.import || "./dist/index-catalog.js";
  const distEntryPath = join(LOOM_ROOT, primaryExportSubpath);
  const distAvailable = existsSync(distEntryPath);

  if (buildProc.status !== 0 || !distAvailable) {
    console.warn("   Notice: Catalog qualification build failed.");
    receipt.status = "blocked";
    receipt.completed = new Date().toISOString();
    receipt.blockedReason = "Catalog qualification build failed";
    receipt.buildError = `${buildProc.stdout || ""}\n${buildProc.stderr || ""}`.trim();
    receipt.evidenceGaps.push(`${primaryExportSubpath} missing or build failed (exit ${buildProc.status})`);

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
  console.log(`   ✓ Initial catalog build passed and bound primary export: ${primaryExportSubpath}`);

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
        name: "smoke-catalog-tool-consumer",
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
  ];

  const missingExports = requiredCatalogExports.filter((exp) => loom[exp] === undefined);
  if (missingExports.length > 0) {
    console.warn(`   Notice: Installed package missing catalog domain exports: ${missingExports.join(", ")}`);
    receipt.status = "blocked";
    receipt.completed = new Date().toISOString();
    receipt.blockedReason = `Installed package missing pending catalog domain exports: ${missingExports.join(", ")}. Sibling runtime worker delivery of src/catalog/index.ts pending integration.`;
    receipt.evidenceGaps.push(`Missing exports: ${missingExports.join(", ")}`);

    // Record verified examples and font data even in blocked state
    receipt.installedCatalogExamples = [
      "loom-black-catalog.json",
      "loom-flexoki-catalog.json",
      "loom-celestia-catalog.json",
    ];

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
  // Step 4: Verify Installed First-Party Catalog Examples
  // -------------------------------------------------------------
  console.log("6. Verifying installed catalog example specifications...");
  const blackFixture = join(installedLoomRoot, "examples/loom-black-catalog.json");
  const flexokiFixture = join(installedLoomRoot, "examples/loom-flexoki-catalog.json");
  const celestiaFixture = join(installedLoomRoot, "examples/loom-celestia-catalog.json");

  for (const f of [blackFixture, flexokiFixture, celestiaFixture]) {
    if (!existsSync(f)) {
      throw new Error(`Installed catalog fixture missing: ${f}`);
    }
  }

  const blackSpec = JSON.parse(await readFile(blackFixture, "utf8"));
  const flexokiSpec = JSON.parse(await readFile(flexokiFixture, "utf8"));
  const celestiaSpec = JSON.parse(await readFile(celestiaFixture, "utf8"));

  // Assert schema structure
  for (const [name, spec] of [
    ["black-catalog", blackSpec],
    ["flexoki-catalog", flexokiSpec],
    ["celestia-catalog", celestiaSpec],
  ]) {
    if (!spec.catalog) throw new Error(`Missing catalog object in ${name}`);
    if (!spec.catalog.hero || !Array.isArray(spec.catalog.hero.routes)) {
      throw new Error(`Invalid hero routes in ${name}`);
    }
    if (!spec.catalog.pageTitle || !PAGETITLE_COPY_MODES.includes(spec.catalog.pageTitle.copy)) {
      throw new Error(`Invalid pageTitle copy in ${name}`);
    }
    if (!spec.catalog.pagination || !PAGINATION_VARIANTS.includes(spec.catalog.pagination.variant)) {
      throw new Error(`Invalid pagination variant in ${name}`);
    }
    if (!spec.catalog.sidebar || !SIDEBAR_MODES.includes(spec.catalog.sidebar.mode) || !Array.isArray(spec.catalog.sidebar.groupIds)) {
      throw new Error(`Invalid sidebar mode/groupIds in ${name}`);
    }
    if (!LAYOUT_MODES.includes(spec.catalog.layout)) {
      throw new Error(`Invalid layout preset in ${name}`);
    }
    if (!Array.isArray(spec.catalog.fontLicenses)) {
      throw new Error(`Invalid fontLicenses in ${name}`);
    }
    if (spec.codePresentation?.tabs !== "deferred") {
      throw new Error(`Specification ${name} must preserve mandatory historical deferred sentinel for code tabs (codePresentation.tabs: 'deferred')`);
    }
    receipt.installedCatalogExamples.push({
      id: name,
      name: spec.name,
      layout: spec.catalog.layout,
      pagination: spec.catalog.pagination.variant,
      sidebar: spec.catalog.sidebar.mode,
      pageTitleCopy: spec.catalog.pageTitle.copy,
      heroRoutesCount: spec.catalog.hero.routes.length,
      fontLicensesCount: spec.catalog.fontLicenses.length,
    });
  }
  // Verify Celestia font and license alignment
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
  if (celestiaSpec.typography?.code?.font !== EXPECTED_FONT.id) {
    throw new Error(`Celestia typography.code.font must bind '${EXPECTED_FONT.id}', got '${celestiaSpec.typography?.code?.font}'`);
  }
  console.log("   ✓ All 3 catalog fixtures validated against exact schema and font license notice bindings.");

  // Create extra active-only spec variant
  const activeOnlySpec = JSON.parse(JSON.stringify(blackSpec));
  activeOnlySpec.name = "loom-active-only-catalog";
  activeOnlySpec.catalog.sidebar.mode = "active-only";

  // -------------------------------------------------------------
  // Step 5: Generate Theme Packages Twice & Pack Twice Across External Dirs
  // -------------------------------------------------------------
  console.log("7. Generating catalog theme packages twice with fontResources and verifying tarball determinism...");

  const themeList = [
    {
      id: "loom-black-catalog",
      spec: blackSpec,
      accent: "default",
      packageName: "@smoke/starlight-theme-loom-black-catalog",
    },
    {
      id: "loom-flexoki-catalog",
      spec: flexokiSpec,
      accent: "cyan",
      packageName: "@smoke/starlight-theme-loom-flexoki-catalog",
    },
    {
      id: "loom-celestia-catalog",
      spec: celestiaSpec,
      accent: "default",
      packageName: "@smoke/starlight-theme-loom-celestia-catalog",
    },
    {
      id: "loom-active-only-catalog",
      spec: activeOnlySpec,
      accent: "default",
      packageName: "@smoke/starlight-theme-loom-active-only-catalog",
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
      fontResources: new Map(themeInfo.spec.fonts.map(font => [font.id, fontResources.get(font.id)])),
    };

    const res1 = loom.generateThemePackageCatalog(genOpts);
    const res2 = loom.generateThemePackageCatalog(genOpts);

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
      memberCount: tInv1.length,
    };

    receipt.compiledThemes.push({
      id: themeInfo.id,
      name: themeInfo.spec.name,
      packageName: themeInfo.packageName,
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
  const actualPlaywright = JSON.parse(await readFile(join(LOOM_ROOT, "node_modules/@playwright/test/package.json"), "utf8")).version;

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
  console.log(`   ✓ Read back and validated pinned versions: Astro ${actualAstro}, Starlight ${actualStarlight}, Expressive Code ${actualExpressiveCode}, Shiki ${actualShiki}, Playwright ${actualPlaywright}`);

  // -------------------------------------------------------------
  // Step 7: Configure Astro Scenarios & Build
  // -------------------------------------------------------------
  console.log("11. Writing consumer Astro configuration with nested sidebar hierarchy...");

  const astroConfigContent = `import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

const scenario = process.env.CATALOG_SCENARIO || "black-catalog";
const outDir = process.env.ASTRO_OUT_DIR || "./dist";

const plugins = [];
const components = {};
const customCss = [];

const packages = {
  "black-catalog": "@smoke/starlight-theme-loom-black-catalog",
  "flexoki-catalog": "@smoke/starlight-theme-loom-flexoki-catalog",
  "celestia-catalog": "@smoke/starlight-theme-loom-celestia-catalog",
  "active-only-catalog": "@smoke/starlight-theme-loom-active-only-catalog",
  "consumer-override": "@smoke/starlight-theme-loom-black-catalog",
  "consumer-css": "@smoke/starlight-theme-loom-black-catalog",
  "base-catalog": "@smoke/starlight-theme-loom-black-catalog",
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
      title: "Catalog Qualification Documentation",
      plugins,
      components,
      customCss,
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

  console.log("12. Building scratch consumer across catalog scenarios...");
  const scenarios = [
    { name: "black-catalog", outDir: join(consumerDir, "dist/black-catalog") },
    { name: "flexoki-catalog", outDir: join(consumerDir, "dist/flexoki-catalog") },
    { name: "celestia-catalog", outDir: join(consumerDir, "dist/celestia-catalog") },
    { name: "active-only-catalog", outDir: join(consumerDir, "dist/active-only-catalog") },
    { name: "consumer-override", outDir: join(consumerDir, "dist/consumer-override") },
    { name: "consumer-css", outDir: join(consumerDir, "dist/consumer-css") },
    { name: "base-catalog", outDir: join(consumerDir, "dist/base-catalog") },
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
    const bytes = await page.screenshot({path:join(evidenceDir,file),fullPage:true});
    browserObservations.scenarios[id] = { ...observations, screenshot:{file,sha256:sha256(bytes)}, viewport:page.viewportSize(), mode:await page.locator("html").getAttribute("data-theme") };
  }

  let screenIndex = 0;

  try {
    // -------------------------------------------------------------
    // Part A: Pairwise Scenario Matrix Across Themes, Viewports & Modes
    // -------------------------------------------------------------
    console.log("14. Executing pairwise scenario matrix across themes, viewports (390/768/1440), and modes (dark/light)...");

    const pairwiseScenarios = [
      { theme: "black-catalog", mode: "dark", width: 390, height: 800, name: "black-dark-390" },
      { theme: "black-catalog", mode: "light", width: 1440, height: 900, name: "black-light-1440" },
      { theme: "flexoki-catalog", mode: "light", width: 390, height: 800, name: "flexoki-light-390" },
      { theme: "flexoki-catalog", mode: "dark", width: 768, height: 1024, name: "flexoki-dark-768" },
      { theme: "celestia-catalog", mode: "dark", width: 1440, height: 900, name: "celestia-dark-1440" },
      { theme: "celestia-catalog", mode: "light", width: 768, height: 1024, name: "celestia-light-768" },
      { theme: "active-only-catalog", mode: "dark", width: 768, height: 1024, name: "active-only-dark-768" },
      { theme: "active-only-catalog", mode: "light", width: 1440, height: 900, name: "active-only-light-1440" },
    ];

    for (const sc of pairwiseScenarios) {
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

          const style = (selector, property) => { const el=document.querySelector(selector); return el ? getComputedStyle(el)[property] : null; };
          const contentStyles = {
            page: style("body","backgroundColor"), body: style("body","color"),
            card: style(".sl-markdown-content .card","backgroundColor"),
            panel: style(".sl-markdown-content blockquote","backgroundColor"),
            raised: style("#catalog-detail","backgroundColor"), muted: style("#catalog-muted","color"),
          };
          return {
            contentStyles,
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

        const fixture = sc.theme === "flexoki-catalog" ? flexokiSpec : sc.theme === "celestia-catalog" ? celestiaSpec : blackSpec;
        const expectedPalette = paletteFor(fixture, sc.theme === "flexoki-catalog" ? "cyan" : "default", sc.mode);
        for (const [role, actual] of Object.entries(obs.contentStyles)) {
          if (!colorMatches(actual, expectedPalette[role])) throw new Error(`Content role ${role} in ${sc.name}: expected ${expectedPalette[role]}, got ${actual}`);
        }

        if (!obs.documentTitle.includes("Catalog Verification Overview") || obs.siteTitleHref !== "/") throw new Error(`Public Head/SiteTitle default failed in ${sc.name}`);
        if (!obs.singleH1) throw new Error(`Page does not have exactly one h1 in scenario ${sc.name}`);
        if (obs.h1Id !== "_top") throw new Error(`h1 does not have id='_top' in scenario ${sc.name} (got '${obs.h1Id}')`);
        if (!obs.uniqueIds) throw new Error(`Duplicate element IDs detected in scenario ${sc.name}`);
        if (obs.hasHorizontalOverflow) throw new Error(`Horizontal overflow detected in scenario ${sc.name}`);
        if (!obs.hasCards || !obs.hasAsides || !obs.hasBadges || !obs.hasTables || !obs.hasTabs || !obs.hasFileTree) {
          throw new Error(`Missing representative components in scenario ${sc.name}`);
        }
        if (obs.hasFalseWorkingCodeTabs) {
          throw new Error(`False working code tabs detected in scenario ${sc.name}; working code tabs must remain deferred`);
        }

        // Starlight 0.42 switches mobile navigation at 50rem (800px).
        const menuVisible = await page.locator("button[popovertarget='starlight__sidebar']").isVisible();
        if (menuVisible !== (sc.width < 800)) throw new Error("Mobile toggle visibility mismatch: " + sc.name);
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
          const menuInfo = await page.evaluate(() => {
            const btn = document.querySelector("button[popovertarget='starlight__sidebar']");
            return btn ? { found: true, id: btn.id || null, tag: btn.tagName } : { found: false };
          });
          if (!menuInfo.found) throw new Error("Missing public mobile menu toggle");
          if (menuInfo.found) {
            await page.focus("button[popovertarget='starlight__sidebar']");
            await page.keyboard.press("Enter");
            if (!await page.locator("#starlight__sidebar").evaluate(el => el.matches(":popover-open"))) throw new Error("Mobile menu did not open");
            await page.keyboard.press("Escape");
            const focusReturned = await page.evaluate(() => {
              const active = document.activeElement;
              const btn = document.querySelector("button[popovertarget='starlight__sidebar']");
              return active === btn;
            });
            if (!focusReturned) {
              throw new Error(`Mobile Escape focus-return failed: activeElement is not the menu toggle button`);
            }
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

    const baseServer = await startStaticServer(join(consumerDir, "dist/base-catalog"), 0, "/guide");
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${baseServer.port}/guide/catalog/hero-centered/`);
      const hrefs = await page.locator(".tfsl-hero-action-btn").evaluateAll(els => els.map(el => el.getAttribute("href")));
      if (!hrefs.length || hrefs.some(href => !href.startsWith("/guide/") && !href.startsWith("#"))) throw new Error("Catalog Hero base mismatch");
      await page.goto(`http://127.0.0.1:${baseServer.port}/guide/catalog/consumer-hero/`);
      if (await page.locator("h1").count() !== 1 || await page.locator("h1").textContent() !== "Consumer frontmatter wins" || await page.locator(".tfsl-hero").count()) throw new Error("Consumer frontmatter Hero precedence failed");
      browserObservations.scenarios["base-and-frontmatter"] = {base:"/guide/", hrefs, consumerHeroWins:true};
      await page.close();
    } finally { await baseServer.close(); }

    // -------------------------------------------------------------
    // Part B: All 5 Hero Layouts & Actual Layout Attribute
    // -------------------------------------------------------------
    console.log("15. Verifying all 5 Hero layouts and actual layout attribute...");
    const heroServer = await startStaticServer(join(consumerDir, "dist/black-catalog"), 0);
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

        if (!heroCheck.found || !heroCheck.hasLayoutClass) {
          throw new Error(`Hero layout attribute failed for ${hs.route}: expected layout-${hs.expectedLayout}, check: ${JSON.stringify(heroCheck)}`);
        }
        if (!heroCheck.singleH1 || heroCheck.h1Id !== "_top") {
          throw new Error(`Hero page ${hs.route} must have single h1 with id='_top'`);
        }
        if (!heroCheck.uniqueIds) {
          throw new Error(`Duplicate IDs found on hero page ${hs.route}`);
        }
        if (hs.hasMedia && !heroCheck.hasMedia) {
          throw new Error(`Hero media missing for layout ${hs.expectedLayout}`);
        }
        if (heroCheck.overflow || !heroCheck.hasActions) {
          throw new Error(`Hero overflow or missing action on ${hs.route}`);
        }
        await capture(page, hs.route, heroCheck);
      }
      await page.close();
    } finally {
      await heroServer.close();
    }

    // -------------------------------------------------------------
    // Part C: 3 Pagination Variants (Plain, Card, Compact)
    // -------------------------------------------------------------
    console.log("16. Verifying 3 Pagination variants (plain, card, compact)...");
    for (const [theme, expectedVariant] of [
      ["flexoki-catalog", "plain"],
      ["black-catalog", "card"],
      ["celestia-catalog", "compact"],
    ]) {
      const server = await startStaticServer(join(consumerDir, `dist/${theme}`), 0);
      try {
        const page = await createOfflinePage();
        await page.goto(`http://127.0.0.1:${server.port}/catalog/sidebar-nested/`);
        const pagCheck = await page.evaluate((expected) => {
          const nav = document.querySelector("nav.tfsl-pagination");
          if (!nav) return { found: false };
          const hasVariantClass = nav.classList.contains(`variant-${expected}`);
          const links = Array.from(nav.querySelectorAll("a"));
          const linkLabels = links.map((a) => a.textContent?.trim() || "");
          const specificContainer = nav.querySelector(`.pagination-${expected}`);
          return {
            found: true,
            hasVariantClass,
            linkCount: links.length,
            linkLabels,
            hasSpecificContainer: Boolean(specificContainer),
          };
        }, expectedVariant);

        if (!pagCheck.found || !pagCheck.hasVariantClass || !pagCheck.hasSpecificContainer) {
          throw new Error(`Pagination check failed for ${theme} (${expectedVariant}): ${JSON.stringify(pagCheck)}`);
        }
        if (pagCheck.linkCount === 0) {
          throw new Error(`Pagination for ${theme} must render links`);
        }
        await capture(page, `pagination-${expectedVariant}`, pagCheck);
        await page.close();
      } finally {
        await server.close();
      }
    }

    // -------------------------------------------------------------
    // Part D: Nested Sidebar with Actual Nested Group (.sidebar-subgroup)
    // -------------------------------------------------------------
    console.log("17. Verifying nested sidebar hierarchy with actual subgroup elements...");
    const nestedServer = await startStaticServer(join(consumerDir, "dist/black-catalog"), 0);
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
          currentHref: currentLink ? currentLink.getAttribute("href") : null,
        };
      });

      if (!nestedHierarchy.subgroupPresent || !nestedHierarchy.sublistInnerPresent) {
        throw new Error(`Nested sidebar failed: actual subgroup not present: ${JSON.stringify(nestedHierarchy)}`);
      }
      if (!nestedHierarchy.currentLinkPresent) {
        throw new Error(`Nested sidebar current link highlight missing`);
      }
      await capture(page, "sidebar-nested", nestedHierarchy);
      await page.close();
    } finally {
      await nestedServer.close();
    }

    // -------------------------------------------------------------
    // Part E: Tabs Roving Keyboard Navigation & Panel Focus
    // -------------------------------------------------------------
    console.log("18. Verifying tabs roving keyboard navigation (Arrow/Home/End) and hidden-panel state...");
    const tabsServer = await startStaticServer(join(consumerDir, "dist/celestia-catalog"), 0);
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${tabsServer.port}/catalog/`);

      const tabCount = await page.evaluate(() => {
        const tabs = document.querySelectorAll(".tfsl-roving-tablist [role='tab']");
        return tabs.length;
      });

      if (tabCount < 2) {
        throw new Error(`Tabs mode requires at least 2 tabs; found ${tabCount}`);
      }

      await page.focus(".tfsl-roving-tablist [role='tab']:first-child");

      let state0 = await page.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll(".tfsl-roving-tablist [role='tab']"));
        const panels = Array.from(document.querySelectorAll(".tfsl-tab-panel"));
        return {
          tab0Selected: tabs[0].getAttribute("aria-selected") === "true",
          tab0TabIndex: tabs[0].getAttribute("tabindex"),
          panel0Hidden: panels[0].hidden,
          panel1Hidden: panels[1].hidden,
        };
      });
      if (!state0.tab0Selected || state0.panel0Hidden || !state0.panel1Hidden) {
        throw new Error(`Initial tabs state invalid: ${JSON.stringify(state0)}`);
      }

      await page.keyboard.press("ArrowRight");
      let state1 = await page.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll(".tfsl-roving-tablist [role='tab']"));
        const panels = Array.from(document.querySelectorAll(".tfsl-tab-panel"));
        const active = document.activeElement;
        return {
          isTab1ActiveElement: active === tabs[1],
          tab1Selected: tabs[1].getAttribute("aria-selected") === "true",
          panel0Hidden: panels[0].hidden,
          panel1Hidden: panels[1].hidden,
        };
      });
      if (!state1.isTab1ActiveElement || !state1.tab1Selected || !state1.panel0Hidden || state1.panel1Hidden) {
        throw new Error(`ArrowRight navigation failed: ${JSON.stringify(state1)}`);
      }

      await page.keyboard.press("ArrowLeft");
      let stateLeft = await page.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll(".tfsl-roving-tablist [role='tab']"));
        return document.activeElement === tabs[0];
      });
      if (!stateLeft) throw new Error("ArrowLeft navigation failed");

      await page.keyboard.press("End");
      let stateEnd = await page.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll(".tfsl-roving-tablist [role='tab']"));
        return document.activeElement === tabs[tabs.length - 1];
      });
      if (!stateEnd) throw new Error("End key navigation failed");

      await page.keyboard.press("Home");
      let stateHome = await page.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll(".tfsl-roving-tablist [role='tab']"));
        return document.activeElement === tabs[0];
      });
      if (!stateHome) throw new Error("Home key navigation failed");
      await capture(page,"sidebar-tabs-keyboard",{state0,state1,stateLeft,stateEnd,stateHome});

      await page.close();
    } finally {
      await tabsServer.close();
    }

    // -------------------------------------------------------------
    // Part F: Select Dropdown Navigation
    // -------------------------------------------------------------
    console.log("19. Verifying select dropdown sidebar and visible current group switching...");
    const selectServer = await startStaticServer(join(consumerDir, "dist/flexoki-catalog"), 0);
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${selectServer.port}/catalog/`);

      const selectCheck = await page.evaluate(() => {
        const select = document.getElementById("tfsl-sidebar-dropdown");
        if (!select) return { found: false };
        const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);
        return { found: true, selectedValue: select.value, options };
      });

      if (!selectCheck.found || selectCheck.options.length < 2) {
        throw new Error(`Select dropdown sidebar failed: ${JSON.stringify(selectCheck)}`);
      }

      const targetOption = selectCheck.options[1];
      await page.selectOption("#tfsl-sidebar-dropdown", targetOption);
      await page.evaluate(() => {
        const s = document.getElementById("tfsl-sidebar-dropdown");
        s?.dispatchEvent(new Event("change"));
      });

      const panelCheck = await page.evaluate((opt) => {
        const targetPanel = document.getElementById("tfsl-nav-panel-" + opt);
        return targetPanel ? { visible: !targetPanel.hidden } : { visible: false };
      }, targetOption);

      if (!panelCheck.visible) {
        throw new Error(`Select change event did not make target panel visible: ${targetOption}`);
      }
      await capture(page,"sidebar-select",{selectCheck,panelCheck});
      await page.close();
    } finally {
      await selectServer.close();
    }

    // -------------------------------------------------------------
    // Part G: Active-Only Matching & Deterministic Fallback
    // -------------------------------------------------------------
    console.log("20. Verifying active-only matching and deterministic fallback...");
    const activeOnlyServer = await startStaticServer(join(consumerDir, "dist/active-only-catalog"), 0);
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${activeOnlyServer.port}/catalog/`);

      const activeMatch = await page.evaluate(() => {
        const nav = document.querySelector('[data-tfsl-sidebar-mode="active-only"]');
        if (!nav) return { found: false };
        const groups = nav.querySelectorAll(".tfsl-sidebar-panel:not([hidden])");
        return {
          found: true,
          groupCount: groups.length,
          headerText: groups[0]?.querySelector("p")?.textContent?.trim() || null,
        };
      });

      if (!activeMatch.found || activeMatch.groupCount !== 1) {
        throw new Error(`Active-only sidebar must render exactly 1 active group; found ${activeMatch.groupCount}`);
      }
      await page.goto(`http://127.0.0.1:${activeOnlyServer.port}/catalog/no-match/`);
      const fallback = await page.locator(".tfsl-sidebar-panel:not([hidden])").getAttribute("data-group-id");
      if (fallback !== "catalog-core") throw new Error("No-match sidebar fallback was not the first group");
      await capture(page,"active-only-no-match",{activeMatch,fallback});
      await page.close();
    } finally {
      await activeOnlyServer.close();
    }

    // -------------------------------------------------------------
    // Part H: Sidebar-less Precise Computed Width Against Spec Min Cap
    // -------------------------------------------------------------
    console.log("21. Verifying sidebar-less precise computed --sl-content-width against spec min cap at desktop (1440px)...");
    const widthServer = await startStaticServer(join(consumerDir, "dist/black-catalog"), 0);
    try {
      const page = await createOfflinePage();
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`http://127.0.0.1:${widthServer.port}/catalog/sidebar-less/`);

      const widthCheck = await page.evaluate(() => {
        const sidebar = document.querySelector("nav.sidebar, .sidebar-pane");
        const sidebarVisible = sidebar && window.getComputedStyle(sidebar).display !== "none";
        const docEl = window.getComputedStyle(document.documentElement);
        const slContentWidth = docEl.getPropertyValue("--sl-content-width").trim();
        const mainPane = document.querySelector(".main-pane");
        const mainPaneStyle = mainPane ? window.getComputedStyle(mainPane) : null;
        const content = document.querySelector(".sl-markdown-content")?.closest(".sl-container");

        return {
          sidebarVisible,
          slContentWidth,
          mainPaneMaxWidth: mainPaneStyle ? mainPaneStyle.maxWidth : null,
          contentMaxWidth: content ? getComputedStyle(content).maxWidth : null,
          contentRenderedWidth: content ? content.getBoundingClientRect().width : null,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        };
      });

      if (widthCheck.sidebarVisible) {
        throw new Error("Sidebar-less template must not have visible sidebar");
      }
      if (widthCheck.overflow) {
        throw new Error("Sidebar-less template has horizontal overflow");
      }
      if (widthCheck.slContentWidth !== "72rem" && !widthCheck.slContentWidth.includes("1152")) {
        throw new Error(`Sidebar-less computed --sl-content-width mismatch: expected '72rem' or '1152px', got '${widthCheck.slContentWidth}'`);
      }
      if (widthCheck.contentMaxWidth !== "1152px" || Math.abs(widthCheck.contentRenderedWidth - 1152) > 1) {
        throw new Error("Sidebar-less rendered content width mismatch: " + JSON.stringify(widthCheck));
      }
      // A later plain :root rule loses to the documented compatibility specificity.
      const lowSpecificity = await page.addStyleTag({ content: ":root { --sl-content-width: 80rem; }" });
      const lowerSpecificityWidth = await page.locator(".sl-markdown-content").evaluate(el => el.closest(".sl-container").getBoundingClientRect().width);
      if (Math.abs(lowerSpecificityWidth - 1152) > 1) throw new Error("Lower-specificity consumer control unexpectedly won");
      await lowSpecificity.evaluate(el => el.remove());
      await capture(page,"sidebarless-width",{...widthCheck, lowerSpecificityWidth});
      await page.close();
    } finally {
      await widthServer.close();
    }

    // -------------------------------------------------------------
    // Part I: Print Media Coherence Starting From Both Light & Dark Modes Across Themes
    // -------------------------------------------------------------
    console.log("22. Verifying print media coherent light palette starting from both dark and light modes across both themes...");
    for (const printTheme of ["black-catalog", "flexoki-catalog"]) {
      const printServer = await startStaticServer(join(consumerDir, `dist/${printTheme}`), 0);
      try {
        const page = await createOfflinePage();
        await page.goto(`http://127.0.0.1:${printServer.port}/catalog/`);

        for (const initialMode of ["dark", "light"]) {
          await page.evaluate((m) => { document.documentElement.dataset.theme = m; }, initialMode);
          await page.emulateMedia({ media: "print" });
          const printObs = await page.evaluate(() => {
            const body = window.getComputedStyle(document.body);
            const docEl = window.getComputedStyle(document.documentElement);
            const code = document.querySelector("code, pre");
            const codeStyle = code ? window.getComputedStyle(code) : null;

            return {
              bgColor: body.backgroundColor,
              color: body.color,
              codeColor: codeStyle ? codeStyle.color : null,
              codeBackground: getComputedStyle(document.querySelector(".expressive-code pre")).backgroundColor,
              cardBackground: getComputedStyle(document.querySelector(".sl-markdown-content .card")).backgroundColor,
              panelBackground: getComputedStyle(document.querySelector(".sl-markdown-content blockquote")).backgroundColor,
              slBg: docEl.getPropertyValue("--sl-color-bg").trim(),
              slText: docEl.getPropertyValue("--sl-color-text").trim(),
              slBgSidebar: docEl.getPropertyValue("--sl-color-bg-sidebar").trim(),
              slBgNav: docEl.getPropertyValue("--sl-color-bg-nav").trim(),
              slHairline: docEl.getPropertyValue("--sl-color-hairline").trim(),
              slBorder: docEl.getPropertyValue("--sl-color-border").trim(),
              slGray1: docEl.getPropertyValue("--sl-color-gray-1").trim(),
            };
          });
          await page.emulateMedia({ media: null });

          const selected = printTheme === "black-catalog" ? blackSpec : flexokiSpec;
          const accent = printTheme === "black-catalog" ? "default" : "cyan";
          const light = paletteFor(selected, accent, "light");
          const expected = { bgColor: light.page, color: light.body, slBg: light.page, slText: light.body, slBgSidebar: light.sidebar, slBgNav: light.header, slHairline: light.hairline, cardBackground: light.card, panelBackground: light.panel, codeBackground: light.code };
          for (const [field, value] of Object.entries(expected)) {
            if (!value || !colorMatches(printObs[field], value)) throw new Error(`Print ${printTheme}/${initialMode} ${field}: expected ${value}, got ${printObs[field]}`);
          }
          await page.emulateMedia({media:"print"});
          await capture(page,`print-${printTheme}-${initialMode}`,printObs);
          await page.emulateMedia({media:null});
        }
        await page.close();
      } finally {
        await printServer.close();
      }
    }

    // -------------------------------------------------------------
    // Part J: Consumer CSS Override (Same Compat Selectors, No !important)
    // -------------------------------------------------------------
    console.log("23. Verifying consumer CSS override using same compat selectors without !important...");
    const cssServer = await startStaticServer(join(consumerDir, "dist/consumer-css"), 0);
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${cssServer.port}/catalog/sidebar-less/`);

      const cssOverrideCheck = await page.evaluate(() => {
        const docEl = window.getComputedStyle(document.documentElement);
        const slContentWidth = docEl.getPropertyValue("--sl-content-width").trim();
        return { slContentWidth };
      });

      if (cssOverrideCheck.slContentWidth !== "65rem" && !cssOverrideCheck.slContentWidth.includes("1040")) {
        throw new Error(`Consumer CSS failed to override --sl-content-width: expected '65rem', got '${cssOverrideCheck.slContentWidth}'`);
      }

      await page.emulateMedia({ media: "print" });
      const consumerPrint = await page.evaluate(() => {
        const body = window.getComputedStyle(document.body);
        return {
          bgColor: body.backgroundColor,
          color: body.color,
        };
      });
      await page.emulateMedia({ media: null });

      if (!consumerPrint.bgColor.includes("254, 254, 254") && !colorMatches(consumerPrint.bgColor, "#fefefe")) {
        throw new Error(`Consumer print CSS override failed: expected #fefefe, got ${consumerPrint.bgColor}`);
      }
      await capture(page,"consumer-css",{cssOverrideCheck,consumerPrint});
      await page.close();
    } finally {
      await cssServer.close();
    }

    // -------------------------------------------------------------
    // Part K: Consumer PageTitle Precedence
    // -------------------------------------------------------------
    console.log("24. Verifying Consumer PageTitle component override precedence...");
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
      await capture(page,"consumer-component",overrideCheck);
      await page.close();
    } finally {
      await overrideServer.close();
    }

    // -------------------------------------------------------------
    // Part L: Theme Switch via Actual Public Control & Reload Persistence
    // -------------------------------------------------------------
    console.log("25. Verifying light/dark theme switch via actual public control and reload persistence...");
    const themeSwitchServer = await startStaticServer(join(consumerDir, "dist/black-catalog"), 0);
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${themeSwitchServer.port}/catalog/`);

      const selectExists = await page.evaluate(() => {
        return Boolean(document.querySelector("starlight-theme-select select"));
      });

      if (!selectExists) throw new Error("Missing public theme selection control");
      if (selectExists) {
        await page.selectOption("starlight-theme-select select", "light");
        const lightState = await page.evaluate(() => ({
          theme: document.documentElement.dataset.theme,
          storage: localStorage.getItem("starlight-theme"),
        }));
        if (lightState.theme !== "light" || lightState.storage !== "light") {
          throw new Error(`Public theme switch to 'light' failed: ${JSON.stringify(lightState)}`);
        }

        await page.reload();
        const persistedLight = await page.evaluate(() => ({
          theme: document.documentElement.dataset.theme,
          storage: localStorage.getItem("starlight-theme"),
        }));
        if (persistedLight.theme !== "light" || persistedLight.storage !== "light") {
          throw new Error(`Theme persistence across reload failed: ${JSON.stringify(persistedLight)}`);
        }

        await page.selectOption("starlight-theme-select select", "dark");
        const darkState = await page.evaluate(() => ({
          theme: document.documentElement.dataset.theme,
          storage: localStorage.getItem("starlight-theme"),
        }));
        if (darkState.theme !== "dark" || darkState.storage !== "dark") {
          throw new Error(`Public theme switch to 'dark' failed: ${JSON.stringify(darkState)}`);
        }
        await capture(page,"theme-provider-switch",{lightState,persistedLight,darkState});
      }
      await page.close();
    } finally {
      await themeSwitchServer.close();
    }

    // -------------------------------------------------------------
    // Part M: Copy via Explicit Keyboard Action & Stubbed Navigator Capture
    // -------------------------------------------------------------
    console.log("26. Verifying PageTitle copy button via explicit keyboard user action and navigator clipboard stub...");
    // Celestia: copy mode 'title'
    const copyServerTitle = await startStaticServer(join(consumerDir, "dist/celestia-catalog"), 0);
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${copyServerTitle.port}/catalog/`);

      await page.evaluate(() => {
        window["__capturedClipboard"] = [];
        if (!navigator.clipboard) {
          Object.defineProperty(navigator, "clipboard", {
            value: { writeText: async (t) => { window["__capturedClipboard"].push(t); } },
            configurable: true,
          });
        } else {
          navigator.clipboard.writeText = async (t) => {
            window["__capturedClipboard"].push(t);
          };
        }
      });

      await page.focus(".tfsl-title-copy-btn");
      await page.keyboard.press("Enter");

      const capturedTitle = await page.evaluate(() => window["__capturedClipboard"]?.[0] || null);
      if (!capturedTitle || !capturedTitle.includes("Catalog Verification Overview")) {
        throw new Error(`Keyboard copy mode 'title' failed: expected title containing 'Catalog Verification Overview', got '${capturedTitle}'`);
      }
      await page.close();
    } finally {
      await copyServerTitle.close();
    }

    // Black: copy mode 'url'
    const copyServerUrl = await startStaticServer(join(consumerDir, "dist/black-catalog"), 0);
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${copyServerUrl.port}/catalog/`);

      await page.evaluate(() => {
        window["__capturedClipboard"] = [];
        if (!navigator.clipboard) {
          Object.defineProperty(navigator, "clipboard", {
            value: { writeText: async (t) => { window["__capturedClipboard"].push(t); } },
            configurable: true,
          });
        } else {
          navigator.clipboard.writeText = async (t) => {
            window["__capturedClipboard"].push(t);
          };
        }
      });

      await page.focus(".tfsl-title-copy-btn");
      await page.keyboard.press("Enter");

      const capturedUrl = await page.evaluate(() => window["__capturedClipboard"]?.[0] || null);
      if (!capturedUrl || !capturedUrl.includes("/catalog/")) {
        throw new Error(`Keyboard copy mode 'url' failed: expected URL containing '/catalog/', got '${capturedUrl}'`);
      }
      await page.close();
    } finally {
      await copyServerUrl.close();
    }

    // Flexoki: copy mode 'none'
    const copyServerNone = await startStaticServer(join(consumerDir, "dist/flexoki-catalog"), 0);
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${copyServerNone.port}/catalog/`);
      const btnExists = await page.evaluate(() => Boolean(document.querySelector(".tfsl-title-copy-btn")));
      if (btnExists) {
        throw new Error("PageTitle with copy: 'none' must not render copy button");
      }
      await page.close();
    } finally {
      await copyServerNone.close();
    }

    // -------------------------------------------------------------
    // Part N: Font CDP Platform Glyphs & Corrupted Negative Test
    // -------------------------------------------------------------
    console.log("27. Verifying Font CDP Platform Glyphs (Source Code Pro glyphCount > 0) & Negative Error...");
    const fontServer = await startStaticServer(join(consumerDir, "dist/celestia-catalog"), 0);
    try {
      const page = await createOfflinePage();
      await page.goto(`http://127.0.0.1:${fontServer.port}/catalog/`);
      await page.evaluate(() => document.fonts.ready);

      const fontsStatus = await page.evaluate(() => document.fonts.status);
      if (fontsStatus !== "loaded") {
        throw new Error(`document.fonts.status is '${fontsStatus}', expected 'loaded'`);
      }

      const cdp = await page.context().newCDPSession(page);
      await cdp.send("DOM.enable");
      await cdp.send("CSS.enable");
      const rootDoc = await cdp.send("DOM.getDocument");
      const { nodeId } = await cdp.send("DOM.querySelector", {
        nodeId: rootDoc.root.nodeId,
        selector: "#catalog-font-probe",
      });

      if (!nodeId) {
        throw new Error("Could not find <code> node for CDP font platform verification");
      }

      const cdpFonts = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
      const platformFonts = cdpFonts?.fonts ?? [];

      const customFontMatch = platformFonts.find(
        (f) => f.familyName.includes("Source Code Pro") && f.isCustomFont && f.glyphCount > 0
      );

      if (!customFontMatch) {
        throw new Error(
          `CDP Platform Font assertion failed: expected Source Code Pro with glyphCount > 0, got: ${JSON.stringify(platformFonts)}`
        );
      }

      receipt.fontVerification.cdpUseProof = {
        nodeId,
        platformFonts,
        customFontMatch,
        documentFontsStatus: fontsStatus,
      };
      console.log(`   ✓ CDP confirmed Source Code Pro used on <code> (${customFontMatch.glyphCount} platform glyphs)`);
      await capture(page,"real-font-use",receipt.fontVerification.cdpUseProof);

      // Negative test: Corrupted font file
      const corruptedBytes = Buffer.from("CORRUPTED_FONT_DATA_INVALID_WOFF2_HEADER_FAIL");
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
        throw new Error("Corrupted font unexpectedly rendered platform glyphs!");
      }

      receipt.fontVerification.corruptedNegativeTest = {
        fontLoadError,
        rejected: true,
        fallbackFonts: negPlatformFonts,
      };
      console.log(`   ✓ Corrupted font negative test confirmed: FontFace error and zero custom glyphs rendered.`);

      await negPage.close();
      await new Promise((done) => negativeServer.close(done));
      await page.close();
    } finally {
      await fontServer.close();
    }

    // -------------------------------------------------------------
    // Part O: Final Validations
    // -------------------------------------------------------------
    if (browserObservations.externalRequestsRejected > 0) {
      throw new Error(`Offline isolation breached: ${browserObservations.externalRequestsRejected} external requests detected`);
    }

    if (pageErrors.length > 0) {
      throw new Error(`Fatal page errors encountered during qualification: ${pageErrors.join("; ")}`);
    }

    receipt.browserObservations = browserObservations;
    receipt.status = "passed";
    receipt.completed = new Date().toISOString();
    console.log("   ✓ All catalog qualification assertions passed successfully.");
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

// Direct execution
const isDirectExecution = process.argv[1] && resolve(process.argv[1]) === resolve(__filename);
if (isDirectExecution) {
  runCatalogSmoke()
    .then((receipt) => {
      if (receipt.status === "blocked") {
        console.log(`\n[SMOKE BLOCKED] ${receipt.blockedReason}`);
        process.exit(2);
      }
      if (receipt.status === "passed") {
        console.log("\n[SMOKE PASSED] All catalog qualification scenarios passed.");
        process.exit(0);
      }
      process.exit(1);
    })
    .catch((err) => {
      console.error("\nFATAL: Smoke qualification error:", err);
      process.exit(1);
    });
}
