#!/usr/bin/env node
// @ts-check
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOOM_ROOT = resolve(__dirname, "..");
const FIXTURES_DIR = resolve(LOOM_ROOT, "test/fixtures/v1-baseline");
const HEX64_RE = /^[a-f0-9]{64}$/;

export const HISTORICAL_PRODUCER_VERSION = "0.1.1";
export const HISTORICAL_CONTACT = "lair001@gmail.com";
export const CURRENT_CONTACT = "sam.lair@knowledge-forge.ai";

export const LEGAL_PATHS = Object.freeze(
  /** @type {const} */ (["COMMERCIAL-LICENSE.md", "LICENSE", "NOTICE"])
);

export const HISTORICAL_LEGAL_ROWS = Object.freeze({
  "COMMERCIAL-LICENSE.md": Object.freeze({
    path: "COMMERCIAL-LICENSE.md",
    bytes: 932,
    sha256: "a81bcda7ec57a5c09f1cc6d05de420db7a0053b9496f1762065e083a60e5ede2",
  }),
  LICENSE: Object.freeze({
    path: "LICENSE",
    bytes: 34460,
    sha256: "62eef07fc3ad238dd889ff98cf9ed87b3ef0f421579b6945f87ec37c608afb62",
  }),
  NOTICE: Object.freeze({
    path: "NOTICE",
    bytes: 598,
    sha256: "e711709e69f5f8fc65c55ff3b3e47c390ed8f60890eb38cf999d95c2494b5d17",
  }),
});

/** @param {string | Uint8Array} content */
function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Validate the saved baseline manifest and retained legal fixture buffers for both examples,
 * returning the frozen UTF-8 legal text map for in-memory comparison projection.
 *
 * @param {any} savedManifest
 * @param {string} compilerPackage
 * @param {Record<string, Record<string, Uint8Array>>} legalByExample
 * @returns {Readonly<{ "COMMERCIAL-LICENSE.md": string; LICENSE: string; NOTICE: string }>}
 */
export function assertRetainedLegal(savedManifest, compilerPackage, legalByExample) {
  if (!savedManifest || typeof savedManifest !== "object" || !savedManifest.baselineSource) {
    throw new Error("Malformed saved baseline manifest");
  }
  if (savedManifest.baselineSource.package !== compilerPackage) {
    throw new Error("Saved baseline manifest package mismatch");
  }
  if (savedManifest.baselineSource.version !== HISTORICAL_PRODUCER_VERSION) {
    throw new Error("Saved baseline manifest version mismatch");
  }

  const examples = /** @type {const} */ (["stellar-cyan", "amber-forge"]);
  for (const example of examples) {
    const manifestPkgFiles = savedManifest.examples?.[example]?.packageFiles;
    const exampleLegal = legalByExample?.[example];
    if (
      !manifestPkgFiles ||
      typeof manifestPkgFiles !== "object" ||
      !exampleLegal ||
      typeof exampleLegal !== "object"
    ) {
      throw new Error(`Missing retained baseline legal records for ${example}`);
    }
    const keys = Object.keys(exampleLegal).sort();
    if (
      keys.length !== LEGAL_PATHS.length ||
      keys.some((k, idx) => k !== LEGAL_PATHS[idx])
    ) {
      throw new Error(`Unexpected retained legal file set for ${example}`);
    }
    for (const legalPath of LEGAL_PATHS) {
      if (!(exampleLegal[legalPath] instanceof Uint8Array)) {
        throw new Error(`Retained legal fixture for ${example}/${legalPath} must be a Buffer`);
      }
    }
  }

  for (const legalPath of LEGAL_PATHS) {
    const cyanRaw = legalByExample["stellar-cyan"][legalPath];
    const amberRaw = legalByExample["amber-forge"][legalPath];
    const cyanBuf = Buffer.from(cyanRaw.buffer, cyanRaw.byteOffset, cyanRaw.byteLength);
    const amberBuf = Buffer.from(amberRaw.buffer, amberRaw.byteOffset, amberRaw.byteLength);
    if (!cyanBuf.equals(amberBuf)) {
      throw new Error(
        `Retained legal fixture '${legalPath}' differs between stellar-cyan and amber-forge`
      );
    }
  }

  /** @type {Record<string, Record<string, string>>} */
  const decodedByExample = {
    "stellar-cyan": {},
    "amber-forge": {},
  };

  for (const example of examples) {
    const manifestPkgFiles = savedManifest.examples[example].packageFiles;
    const exampleLegal = legalByExample[example];
    for (const legalPath of LEGAL_PATHS) {
      const expectedPin = HISTORICAL_LEGAL_ROWS[legalPath];
      const manifestRow = manifestPkgFiles[legalPath];
      if (
        !manifestRow ||
        typeof manifestRow !== "object" ||
        manifestRow.byteLength !== expectedPin.bytes ||
        manifestRow.sha256 !== expectedPin.sha256
      ) {
        throw new Error(`Saved baseline manifest legal row mismatch for ${example}/${legalPath}`);
      }

      const raw = exampleLegal[legalPath];
      const buf = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
      if (buf.byteLength !== expectedPin.bytes || sha256(buf) !== expectedPin.sha256) {
        throw new Error(`Retained legal fixture byte/hash mismatch for ${example}/${legalPath}`);
      }

      const text = buf.toString("utf8");
      if (!Buffer.from(text, "utf8").equals(buf)) {
        throw new Error(`Retained legal fixture invalid UTF-8 in ${example}/${legalPath}`);
      }

      if (legalPath === "NOTICE" || legalPath === "COMMERCIAL-LICENSE.md") {
        const historicalCount = text.split(HISTORICAL_CONTACT).length - 1;
        if (historicalCount !== 1) {
          throw new Error(
            `Retained legal fixture ${example}/${legalPath} must contain historical contact exactly once`
          );
        }
        if (text.includes(CURRENT_CONTACT)) {
          throw new Error(
            `Retained legal fixture ${example}/${legalPath} contains current contact`
          );
        }
      }

      decodedByExample[example][legalPath] = text;
    }
  }

  return Object.freeze({
    "COMMERCIAL-LICENSE.md": decodedByExample["stellar-cyan"]["COMMERCIAL-LICENSE.md"],
    LICENSE: decodedByExample["stellar-cyan"].LICENSE,
    NOTICE: decodedByExample["stellar-cyan"].NOTICE,
  });
}

/**
 * Clone a compilation descriptor and project only provenance.compilerVersion.
 *
 * @param {any} descriptor
 * @param {{ compilerPackage: string; currentVersion: string; historicalVersion?: string }} options
 */
export function projectHistoricalDescriptor(
  descriptor,
  { compilerPackage, currentVersion, historicalVersion = HISTORICAL_PRODUCER_VERSION }
) {
  if (
    !descriptor ||
    typeof descriptor !== "object" ||
    !descriptor.provenance ||
    typeof descriptor.provenance !== "object" ||
    descriptor.provenance.compiler !== compilerPackage ||
    descriptor.provenance.compilerVersion !== currentVersion
  ) {
    throw new Error("Current descriptor producer mismatch");
  }
  if (typeof historicalVersion !== "string" || historicalVersion.length === 0) {
    throw new Error("Historical producer version is required");
  }
  const clone = structuredClone(descriptor);
  clone.provenance.compilerVersion = historicalVersion;
  return clone;
}

/**
 * Validate all current package files and provenance rows, then return a new Map
 * projecting only the approved release metadata and contact-bearing legal files.
 *
 * @param {{
 *   files: Map<string, string>;
 *   compilerPackage: string;
 *   currentVersion: string;
 *   historicalVersion?: string;
 *   retainedLegal: Readonly<{ "COMMERCIAL-LICENSE.md": string; LICENSE: string; NOTICE: string }>;
 * }} options
 * @returns {Map<string, string>}
 */
export function projectHistoricalPackageFiles({
  files,
  compilerPackage,
  currentVersion,
  historicalVersion = HISTORICAL_PRODUCER_VERSION,
  retainedLegal,
}) {
  if (!(files instanceof Map)) {
    throw new Error("Generated package files must be a Map");
  }
  for (const [k, v] of files.entries()) {
    if (typeof k !== "string" || typeof v !== "string") {
      throw new Error(`Generated package file entry '${String(k)}' must be a string`);
    }
  }
  for (const legalPath of LEGAL_PATHS) {
    const expectedPin = HISTORICAL_LEGAL_ROWS[legalPath];
    const content = retainedLegal?.[legalPath];
    if (
      typeof content !== "string" ||
      Buffer.byteLength(content, "utf8") !== expectedPin.bytes ||
      sha256(content) !== expectedPin.sha256
    ) {
      throw new Error(`Invalid retained legal content for '${legalPath}'`);
    }
  }

  // 1. Validate current provenance against current bytes before any projection
  const provenanceRaw = files.get("provenance.json");
  if (typeof provenanceRaw !== "string") {
    throw new Error("Missing provenance.json in generated package");
  }
  let provenance;
  try {
    provenance = JSON.parse(provenanceRaw);
  } catch {
    throw new Error("Malformed provenance.json in generated package");
  }
  if (
    !provenance ||
    typeof provenance !== "object" ||
    Array.isArray(provenance) ||
    JSON.stringify(provenance, null, 2) + "\n" !== provenanceRaw
  ) {
    throw new Error("Non-canonical provenance.json serialization");
  }
  if (provenance.generator !== compilerPackage || provenance.generatorVersion !== currentVersion) {
    throw new Error("Current package producer mismatch");
  }
  if (!Array.isArray(provenance.files)) {
    throw new Error("Malformed provenance.json files array");
  }

  /** @type {Set<string>} */
  const seenRowPaths = new Set();
  for (const row of provenance.files) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("Malformed provenance row entry");
    }
    const rowKeys = Object.keys(row).sort();
    if (
      rowKeys.length !== 4 ||
      rowKeys[0] !== "category" ||
      rowKeys[1] !== "path" ||
      rowKeys[2] !== "sha256" ||
      rowKeys[3] !== "size"
    ) {
      throw new Error(`Malformed provenance row keys for '${String(row.path)}'`);
    }
    if (
      typeof row.path !== "string" ||
      row.path.length === 0 ||
      typeof row.size !== "number" ||
      !Number.isInteger(row.size) ||
      row.size < 0 ||
      typeof row.sha256 !== "string" ||
      !HEX64_RE.test(row.sha256) ||
      typeof row.category !== "string" ||
      row.category.length === 0
    ) {
      throw new Error(`Malformed provenance row fields for '${String(row.path)}'`);
    }
    if (row.path === "provenance.json") {
      throw new Error("Unexpected provenance.json self-row in provenance");
    }
    if (seenRowPaths.has(row.path)) {
      throw new Error(`Duplicate provenance row for '${row.path}'`);
    }
    seenRowPaths.add(row.path);

    if (!files.has(row.path)) {
      throw new Error(`Unknown provenance row path '${row.path}'`);
    }

    const isLegalPath = /** @type {readonly string[]} */ (LEGAL_PATHS).includes(row.path);
    if (isLegalPath && row.category !== "legal-notice") {
      throw new Error(`Expected legal-notice category for '${row.path}'`);
    }
    if (!isLegalPath && row.category === "legal-notice") {
      throw new Error(`Unexpected legal-notice category on non-legal path '${row.path}'`);
    }

    const currentContent = /** @type {string} */ (files.get(row.path));
    const actualSize = Buffer.byteLength(currentContent, "utf8");
    const actualSha = sha256(currentContent);
    if (row.size !== actualSize || row.sha256 !== actualSha) {
      throw new Error(
        `Current provenance row mismatch for '${row.path}': row has ${row.size}/${row.sha256}, actual is ${actualSize}/${actualSha}`
      );
    }
  }

  for (const filePath of files.keys()) {
    if (filePath === "provenance.json") continue;
    if (!seenRowPaths.has(filePath)) {
      throw new Error(`Missing provenance row for emitted file '${filePath}'`);
    }
  }

  // 2. Validate legal boundary on current files
  for (const legalPath of LEGAL_PATHS) {
    if (!files.has(legalPath)) {
      throw new Error(`Missing legal file '${legalPath}' in generated package`);
    }
  }
  const currentLicense = /** @type {string} */ (files.get("LICENSE"));
  if (currentLicense !== retainedLegal.LICENSE) {
    throw new Error("Current LICENSE bytes diverged from retained AGPL fixture");
  }

  const contactPaths = /** @type {const} */ (["NOTICE", "COMMERCIAL-LICENSE.md"]);
  for (const contactPath of contactPaths) {
    const currentText = /** @type {string} */ (files.get(contactPath));
    if (currentText.includes(HISTORICAL_CONTACT)) {
      throw new Error(`Current legal file '${contactPath}' contains mixed/historical contact`);
    }
    const currentContactOccurrences = currentText.split(CURRENT_CONTACT).length - 1;
    if (currentContactOccurrences === 0) {
      throw new Error(`Current legal file '${contactPath}' is missing current maintained contact`);
    }
    if (currentContactOccurrences !== 1) {
      throw new Error(
        `Current legal file '${contactPath}' contains ${currentContactOccurrences} occurrences of current contact; expected 1`
      );
    }
    const projectedContactText = currentText.split(CURRENT_CONTACT).join(HISTORICAL_CONTACT);
    if (projectedContactText !== retainedLegal[contactPath]) {
      throw new Error(
        `Non-contact byte drift in '${contactPath}' after single contact substitution`
      );
    }
  }

  // 3. Project theme.descriptor.json
  const descriptorRaw = files.get("theme.descriptor.json");
  if (typeof descriptorRaw !== "string") {
    throw new Error("Missing theme.descriptor.json in generated package");
  }
  let parsedDescriptor;
  try {
    parsedDescriptor = JSON.parse(descriptorRaw);
  } catch {
    throw new Error("Malformed theme.descriptor.json in generated package");
  }
  if (
    !parsedDescriptor ||
    typeof parsedDescriptor !== "object" ||
    Array.isArray(parsedDescriptor) ||
    JSON.stringify(parsedDescriptor, null, 2) + "\n" !== descriptorRaw
  ) {
    throw new Error("Non-canonical theme.descriptor.json serialization");
  }
  const projectedDescriptorObj = projectHistoricalDescriptor(parsedDescriptor, {
    compilerPackage,
    currentVersion,
    historicalVersion,
  });
  const projectedDescriptorRaw = JSON.stringify(projectedDescriptorObj, null, 2) + "\n";

  // 4. Project README.md producer sentence once
  const readmeRaw = files.get("README.md");
  if (typeof readmeRaw !== "string") {
    throw new Error("Missing README.md in generated package");
  }
  const currentSentence = `Generated by \`${compilerPackage}\` (${currentVersion}).`;
  const historicalSentence = `Generated by \`${compilerPackage}\` (${historicalVersion}).`;
  const sentenceParts = readmeRaw.split(currentSentence);
  if (sentenceParts.length - 1 !== 1) {
    throw new Error(`Expected README producer sentence once, found ${sentenceParts.length - 1}`);
  }
  const projectedReadme = sentenceParts.join(historicalSentence);

  // 5. Project provenance.json (only generatorVersion and the four approved row digests)
  const projectedProvenance = structuredClone(provenance);
  projectedProvenance.generatorVersion = historicalVersion;
  for (const row of projectedProvenance.files) {
    if (row.path === "COMMERCIAL-LICENSE.md" || row.path === "NOTICE") {
      const contactPath = /** @type {"COMMERCIAL-LICENSE.md" | "NOTICE"} */ (row.path);
      const content = retainedLegal[contactPath];
      const expectedPin = HISTORICAL_LEGAL_ROWS[contactPath];
      row.size = Buffer.byteLength(content, "utf8");
      row.sha256 = sha256(content);
      if (row.size !== expectedPin.bytes || row.sha256 !== expectedPin.sha256) {
        throw new Error(`Projected contact row mismatch for '${contactPath}'`);
      }
    } else if (row.path === "README.md") {
      row.size = Buffer.byteLength(projectedReadme, "utf8");
      row.sha256 = sha256(projectedReadme);
    } else if (row.path === "theme.descriptor.json") {
      row.size = Buffer.byteLength(projectedDescriptorRaw, "utf8");
      row.sha256 = sha256(projectedDescriptorRaw);
    }
  }
  const projectedProvenanceRaw = JSON.stringify(projectedProvenance, null, 2) + "\n";

  // 6. Build output map preserving original key order without mutating input
  /** @type {Map<string, string>} */
  const projectedFiles = new Map();
  for (const [filePath, currentContent] of files.entries()) {
    if (filePath === "COMMERCIAL-LICENSE.md") {
      projectedFiles.set(filePath, retainedLegal["COMMERCIAL-LICENSE.md"]);
    } else if (filePath === "NOTICE") {
      projectedFiles.set(filePath, retainedLegal.NOTICE);
    } else if (filePath === "theme.descriptor.json") {
      projectedFiles.set(filePath, projectedDescriptorRaw);
    } else if (filePath === "README.md") {
      projectedFiles.set(filePath, projectedReadme);
    } else if (filePath === "provenance.json") {
      projectedFiles.set(filePath, projectedProvenanceRaw);
    } else {
      projectedFiles.set(filePath, currentContent);
    }
  }

  // 7. Post-check projected rows against projected map
  for (const row of projectedProvenance.files) {
    const content = /** @type {string} */ (projectedFiles.get(row.path));
    if (
      row.size !== Buffer.byteLength(content, "utf8") ||
      row.sha256 !== sha256(content)
    ) {
      throw new Error(`Post-projection provenance row mismatch for '${row.path}'`);
    }
  }

  return projectedFiles;
}

async function main() {
  const args = process.argv.slice(2);
  const isCheckMode = args.includes("--check");
  const manifestPath = join(FIXTURES_DIR, "manifest.json");
  if (!isCheckMode && existsSync(manifestPath)) {
    throw new Error("Historical v1 fixtures are immutable; use --check");
  }

  // Dynamically import compiled loom
  const loom = await import("../dist/index.js");
  const {
    compileTheme,
    canonicalizeSpecification,
    generateThemePackage,
    emitPageTitleFrameComponent,
    COMPILER_PACKAGE,
    COMPILER_VERSION,
  } = loom;

  const cyanSpecRaw = JSON.parse(readFileSync(resolve(LOOM_ROOT, "examples/stellar-cyan.theme.json"), "utf8"));
  const amberSpecRaw = JSON.parse(readFileSync(resolve(LOOM_ROOT, "examples/amber-forge.theme.json"), "utf8"));

  // 1. Stellar Cyan Baseline
  const cyanCanonical = canonicalizeSpecification(cyanSpecRaw);
  const cyanCompilation = compileTheme(cyanSpecRaw, { cssFile: "styles/theme.css" });
  const cyanPkgMeta = {
    name: "starlight-theme-stellar-cyan",
    version: "0.1.0",
    description: "Stellar Cyan Starlight theme plugin",
    author: "The Knowledge Forge Authors",
  };
  const cyanPkg = generateThemePackage({
    themeSpec: cyanSpecRaw,
    metadata: cyanPkgMeta,
  });

  // 2. Amber Forge Baseline
  const amberCanonical = canonicalizeSpecification(amberSpecRaw);
  const amberCompilation = compileTheme(amberSpecRaw, { cssFile: "styles/theme.css" });
  const amberPkgMeta = {
    name: "starlight-theme-amber-forge",
    version: "0.1.0",
    description: "Amber Forge Starlight theme plugin with page title frame",
    template: "page-title-frame",
  };
  const amberPkg = generateThemePackage({
    themeSpec: amberSpecRaw,
    metadata: amberPkgMeta,
  });

  // 3. PageTitle Frame component
  const pageTitleFrameAstro = emitPageTitleFrameComponent();

  // In check mode, construct a separate in-memory historical comparison projection
  // without mutating the live compilation or generated package results.
  let savedManifest = null;
  let comparisonVersion = COMPILER_VERSION;
  let cyanDescriptor = cyanCompilation.descriptor;
  let amberDescriptor = amberCompilation.descriptor;
  let cyanFiles = cyanPkg.files;
  let amberFiles = amberPkg.files;

  if (isCheckMode) {
    console.log("Checking v1 baseline fixtures against current source...");
    if (!existsSync(manifestPath)) {
      throw new Error(`Baseline manifest missing at ${manifestPath}. Run freeze script without --check first.`);
    }
    savedManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const retainedLegal = assertRetainedLegal(savedManifest, COMPILER_PACKAGE, {
      "stellar-cyan": {
        "COMMERCIAL-LICENSE.md": readFileSync(
          join(FIXTURES_DIR, "stellar-cyan/package/COMMERCIAL-LICENSE.md")
        ),
        LICENSE: readFileSync(join(FIXTURES_DIR, "stellar-cyan/package/LICENSE")),
        NOTICE: readFileSync(join(FIXTURES_DIR, "stellar-cyan/package/NOTICE")),
      },
      "amber-forge": {
        "COMMERCIAL-LICENSE.md": readFileSync(
          join(FIXTURES_DIR, "amber-forge/package/COMMERCIAL-LICENSE.md")
        ),
        LICENSE: readFileSync(join(FIXTURES_DIR, "amber-forge/package/LICENSE")),
        NOTICE: readFileSync(join(FIXTURES_DIR, "amber-forge/package/NOTICE")),
      },
    });
    comparisonVersion = savedManifest.baselineSource.version;
    cyanDescriptor = projectHistoricalDescriptor(cyanCompilation.descriptor, {
      compilerPackage: COMPILER_PACKAGE,
      currentVersion: COMPILER_VERSION,
      historicalVersion: comparisonVersion,
    });
    amberDescriptor = projectHistoricalDescriptor(amberCompilation.descriptor, {
      compilerPackage: COMPILER_PACKAGE,
      currentVersion: COMPILER_VERSION,
      historicalVersion: comparisonVersion,
    });
    cyanFiles = projectHistoricalPackageFiles({
      files: cyanPkg.files,
      compilerPackage: COMPILER_PACKAGE,
      currentVersion: COMPILER_VERSION,
      historicalVersion: comparisonVersion,
      retainedLegal,
    });
    amberFiles = projectHistoricalPackageFiles({
      files: amberPkg.files,
      compilerPackage: COMPILER_PACKAGE,
      currentVersion: COMPILER_VERSION,
      historicalVersion: comparisonVersion,
      retainedLegal,
    });
    if (cyanFiles.get("theme.descriptor.json") !== JSON.stringify(cyanDescriptor, null, 2) + "\n") {
      throw new Error("Projected stellar-cyan package descriptor disagrees with compilation descriptor");
    }
    if (amberFiles.get("theme.descriptor.json") !== JSON.stringify(amberDescriptor, null, 2) + "\n") {
      throw new Error("Projected amber-forge package descriptor disagrees with compilation descriptor");
    }
  }

  // Baseline manifest data
  const manifest = {
    baselineSource: {
      package: COMPILER_PACKAGE,
      version: comparisonVersion,
      contract: "ADR0026 / TFSB58 historical compiler gate",
      baselineCommit: "f22ff31b86c8a75933dfada22390daadb0d0a21a",
      governingDocuments: [
        "docs/decisions/0026-stellar-loom-expanded-theme-envelope.md",
        "docs/evaluations/tfsb58-post-release-truth-patch.md",
        "docs/releases/tfsb57-public-releases.json",
      ],
      retainedArtifactAvailability: {
        envVar: "TFSB_DOCUMENTATION_PATCH_INPUTS",
        isProvided: Boolean(process.env.TFSB_DOCUMENTATION_PATCH_INPUTS),
        registryFetchRequired: false,
      },
    },
    pageTitleFrame: {
      templateId: "page-title-frame",
      sha256: sha256(pageTitleFrameAstro),
      byteLength: Buffer.byteLength(pageTitleFrameAstro, "utf8"),
      relativeTargetPath: "components/PageTitleFrame.astro",
    },
    examples: {
      "stellar-cyan": {
        inputDigest: cyanCanonical.inputDigest,
        canonicalJsonSha256: sha256(cyanCanonical.canonicalJson),
        outputDigest: cyanCompilation.outputDigest,
        cssSha256: sha256(cyanCompilation.css),
        cssByteLength: Buffer.byteLength(cyanCompilation.css, "utf8"),
        descriptorSha256: sha256(JSON.stringify(cyanDescriptor, null, 2) + "\n"),
        descriptor: cyanDescriptor,
        diagnosticsCount: cyanCompilation.diagnostics.length,
        diagnostics: cyanCompilation.diagnostics,
        packageMetadata: cyanPkgMeta,
        packageFileCount: cyanFiles.size,
        packageFiles: Object.fromEntries(
          [...cyanFiles.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => [
            path,
            {
              sha256: sha256(content),
              byteLength: Buffer.byteLength(content, "utf8"),
            },
          ])
        ),
      },
      "amber-forge": {
        inputDigest: amberCanonical.inputDigest,
        canonicalJsonSha256: sha256(amberCanonical.canonicalJson),
        outputDigest: amberCompilation.outputDigest,
        cssSha256: sha256(amberCompilation.css),
        cssByteLength: Buffer.byteLength(amberCompilation.css, "utf8"),
        descriptorSha256: sha256(JSON.stringify(amberDescriptor, null, 2) + "\n"),
        descriptor: amberDescriptor,
        diagnosticsCount: amberCompilation.diagnostics.length,
        diagnostics: amberCompilation.diagnostics,
        packageMetadata: amberPkgMeta,
        packageFileCount: amberFiles.size,
        packageFiles: Object.fromEntries(
          [...amberFiles.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, content]) => [
            path,
            {
              sha256: sha256(content),
              byteLength: Buffer.byteLength(content, "utf8"),
            },
          ])
        ),
      },
    },
  };

  if (isCheckMode) {
    const currentManifestJson = JSON.stringify(manifest, null, 2);
    const savedManifestJson = JSON.stringify(savedManifest, null, 2);

    if (currentManifestJson !== savedManifestJson) {
      throw new Error("Frozen baseline manifest mismatch!");
    }

    // Verify literal files
    const literalChecks = [
      {
        path: join(FIXTURES_DIR, "page-title/PageTitleFrame.astro"),
        expected: pageTitleFrameAstro,
      },
      {
        path: join(FIXTURES_DIR, "stellar-cyan/canonical.json"),
        expected: cyanCanonical.canonicalJson,
      },
      {
        path: join(FIXTURES_DIR, "stellar-cyan/theme.css"),
        expected: cyanCompilation.css,
      },
      {
        path: join(FIXTURES_DIR, "stellar-cyan/theme.descriptor.json"),
        expected: JSON.stringify(cyanDescriptor, null, 2) + "\n",
      },
      {
        path: join(FIXTURES_DIR, "amber-forge/canonical.json"),
        expected: amberCanonical.canonicalJson,
      },
      {
        path: join(FIXTURES_DIR, "amber-forge/theme.css"),
        expected: amberCompilation.css,
      },
      {
        path: join(FIXTURES_DIR, "amber-forge/theme.descriptor.json"),
        expected: JSON.stringify(amberDescriptor, null, 2) + "\n",
      },
    ];

    for (const [relPath, content] of cyanFiles) {
      literalChecks.push({
        path: join(FIXTURES_DIR, "stellar-cyan/package", relPath),
        expected: content,
      });
    }

    for (const [relPath, content] of amberFiles) {
      literalChecks.push({
        path: join(FIXTURES_DIR, "amber-forge/package", relPath),
        expected: content,
      });
    }

    for (const check of literalChecks) {
      if (!existsSync(check.path)) {
        throw new Error(`Missing baseline file: ${check.path}`);
      }
      const actual = readFileSync(check.path, "utf8");
      if (actual !== check.expected) {
        throw new Error(`Literal byte mismatch in baseline file: ${check.path}`);
      }
    }

    console.log("All v1 baseline fixtures match current source exactly.");
    return;
  }

  // Write mode: emit all fixtures
  console.log(`Writing v1 baseline fixtures into ${FIXTURES_DIR}...`);
  mkdirSync(join(FIXTURES_DIR, "page-title"), { recursive: true });
  mkdirSync(join(FIXTURES_DIR, "stellar-cyan/package/styles"), { recursive: true });
  mkdirSync(join(FIXTURES_DIR, "amber-forge/package/styles"), { recursive: true });
  mkdirSync(join(FIXTURES_DIR, "amber-forge/package/components"), { recursive: true });

  writeFileSync(join(FIXTURES_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  writeFileSync(join(FIXTURES_DIR, "page-title/PageTitleFrame.astro"), pageTitleFrameAstro, "utf8");

  // Stellar cyan
  writeFileSync(join(FIXTURES_DIR, "stellar-cyan/canonical.json"), cyanCanonical.canonicalJson, "utf8");
  writeFileSync(join(FIXTURES_DIR, "stellar-cyan/theme.css"), cyanCompilation.css, "utf8");
  writeFileSync(join(FIXTURES_DIR, "stellar-cyan/theme.descriptor.json"), JSON.stringify(cyanCompilation.descriptor, null, 2) + "\n", "utf8");
  for (const [relPath, content] of cyanPkg.files) {
    const fullPath = join(FIXTURES_DIR, "stellar-cyan/package", relPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, "utf8");
  }

  // Amber forge
  writeFileSync(join(FIXTURES_DIR, "amber-forge/canonical.json"), amberCanonical.canonicalJson, "utf8");
  writeFileSync(join(FIXTURES_DIR, "amber-forge/theme.css"), amberCompilation.css, "utf8");
  writeFileSync(join(FIXTURES_DIR, "amber-forge/theme.descriptor.json"), JSON.stringify(amberCompilation.descriptor, null, 2) + "\n", "utf8");
  for (const [relPath, content] of amberPkg.files) {
    const fullPath = join(FIXTURES_DIR, "amber-forge/package", relPath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, "utf8");
  }

  console.log("Successfully wrote v1 baseline fixtures:");
  console.log(`- Stellar Cyan: inputDigest=${cyanCanonical.inputDigest}, outputDigest=${cyanCompilation.outputDigest}`);
  console.log(`- Amber Forge: inputDigest=${amberCanonical.inputDigest}, outputDigest=${amberCompilation.outputDigest}`);
  console.log(`- PageTitleFrame: sha256=${sha256(pageTitleFrameAstro)}`);
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  main().catch((err) => {
    console.error("Failed to freeze v1 baseline:", err);
    process.exit(1);
  });
}
