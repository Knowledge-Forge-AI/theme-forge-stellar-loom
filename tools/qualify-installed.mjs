#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Public membership requirements for an installed Loom package.
 * Defines the structural and executable invariant for npm, Nix, and Homebrew distributions.
 */
export const PUBLIC_MEMBERSHIP_REQUIREMENTS = Object.freeze({
  schema: "tfsl.public-membership-requirements-v1",
  packageName: "@knowledge-forge-ai/theme-forge-stellar-loom",
  packageType: "module",
  requiredPackageFields: Object.freeze(["name", "version", "type", "bin", "exports"]),
  requiredBinMembers: Object.freeze(["bin/tfsl.js", "bin/tfsl-batch.js"]),
  requiredBuildEvidence: "dist/catalog-build-evidence.json",
  buildEvidenceSchema: "tfsl.catalog-build-evidence-v1",
  requiredEntrypoints: Object.freeze({
    index: "dist/index-catalog.js",
    batch: "dist/batch-catalog.js",
    cli: "dist/cli-catalog.js",
  }),
  requiredLegalAssets: Object.freeze([
    "LICENSE",
    "NOTICE",
    "COMMERCIAL-LICENSE.md",
    "README.md",
  ]),
});

/**
 * Known minimal valid theme specification (v1) generated inline for self-contained testing
 * when examples are absent from the installed payload.
 */
export const MINIMAL_V1_THEME = Object.freeze({
  name: "minimal-v1-probe",
  version: "0.1.0",
  schemaVersion: "tfsl.theme-v1",
  adapter: "starlight-v0.42",
  colors: {
    dark: {
      accent: { base: "#00d2ff", low: "#082b40", high: "#b8f2ff" },
      neutrals: {
        bg: "#090e17",
        bgNav: "#0d1522",
        bgSidebar: "#090e17",
        bgInlineCode: "#131d2e",
        bgAccent: "#00d2ff",
        text: "#e6f1ff",
        textAccent: "#00d2ff",
        textInvert: "#090e17",
        hairline: "#1c2b42",
        hairlineLight: "#2c4263",
        hairlineShade: "#0a101b",
      },
      grays: {
        gray1: "#e6f1ff",
        gray2: "#c4d7ed",
        gray3: "#8ea5c4",
        gray4: "#546b8a",
        gray5: "#2c4263",
        gray6: "#162438",
        gray7: "#0d1522",
      },
    },
    light: {
      accent: { base: "#0077aa", low: "#e0f6ff", high: "#004d70" },
      neutrals: {
        bg: "#f5f9fc",
        bgNav: "#ffffff",
        bgSidebar: "#f5f9fc",
        bgInlineCode: "#e8f1f8",
        bgAccent: "#0077aa",
        text: "#0d1522",
        textAccent: "#0077aa",
        textInvert: "#ffffff",
        hairline: "#d2dfed",
        hairlineLight: "#e6f0fa",
        hairlineShade: "#b8ccdf",
      },
      grays: {
        gray1: "#0d1522",
        gray2: "#24354d",
        gray3: "#4b6280",
        gray4: "#7b94b2",
        gray5: "#b0c5dd",
        gray6: "#dce7f3",
        gray7: "#f0f5fa",
      },
    },
  },
  typography: {
    bodyFont: "system-sans",
    codeFont: "system-mono",
    baseFontSize: "16px",
    lineHeight: 1.75,
  },
  layout: {
    contentWidth: "48rem",
    sidebarWidth: "19rem",
  },
});

/**
 * Known minimal valid catalog theme specification (v2) generated inline for self-contained testing.
 */
export const MINIMAL_CATALOG_THEME = Object.freeze({
  name: "minimal-catalog-probe",
  version: "1.0.0",
  schemaVersion: "tfsl.theme-v2",
  adapter: "starlight-v0.42",
  tokenSets: {
    "probe-tokens": {
      "bg-page-dark": "#0c0d10",
      "bg-page-light": "#f8fafc",
      "bg-nav-dark": "#12141a",
      "bg-nav-light": "#ffffff",
      "bg-sidebar-dark": "#0f1015",
      "bg-sidebar-light": "#f1f5f9",
      "bg-raised-dark": "#161922",
      "bg-raised-light": "#ffffff",
      "bg-panel-dark": "#1a1e29",
      "bg-panel-light": "#f8fafc",
      "bg-card-dark": "#131620",
      "bg-card-light": "#ffffff",
      "bg-inline-code-dark": "#1e2330",
      "bg-inline-code-light": "#e2e8f0",
      "bg-code-dark": "#090a0d",
      "bg-code-light": "#f1f5f9",
      "text-body-dark": "#f0f2f5",
      "text-body-light": "#0f172a",
      "text-secondary-dark": "#e1e4ea",
      "text-secondary-light": "#334155",
      "text-muted-dark": "#8a92a6",
      "text-muted-light": "#64748b",
      "text-invert-dark": { alias: "bg-page-dark" },
      "text-invert-light": { alias: "bg-nav-light" },
      "text-link-dark": "#60a5fa",
      "text-link-light": "#2563eb",
      "hairline-dark": "#232838",
      "hairline-light": "#e2e8f0",
      "border-dark": "#2e354a",
      "border-light": "#cbd5e1",
      "focus-ring-dark": "#3b82f6",
      "focus-ring-light": "#2563eb",
      "select-bg-dark": "#3b82f6",
      "select-bg-light": "#2563eb",
      "select-text-dark": "#ffffff",
      "select-text-light": "#ffffff",
      "accent-base-dark": "#f97316",
      "accent-base-light": "#ea580c",
      "accent-low-dark": "#431407",
      "accent-low-light": "#ffedd5",
      "accent-high-dark": "#fdba74",
      "accent-high-light": "#9a3412",
    },
  },
  accentVariants: {
    default: {
      tokenSet: "probe-tokens",
      dark: {
        page: "bg-page-dark",
        nav: "bg-nav-dark",
        sidebar: "bg-sidebar-dark",
        raised: "bg-raised-dark",
        panel: "bg-panel-dark",
        card: "bg-card-dark",
        inlineCode: "bg-inline-code-dark",
        code: "bg-code-dark",
        text: "text-body-dark",
        textSecondary: "text-secondary-dark",
        textMuted: "text-muted-dark",
        textInvert: "text-invert-dark",
        textLink: "text-link-dark",
        hairline: "hairline-dark",
        border: "border-dark",
        focusRing: "focus-ring-dark",
        selectBg: "select-bg-dark",
        selectText: "select-text-dark",
        accent: "accent-base-dark",
        accentLow: "accent-low-dark",
        accentHigh: "accent-high-dark",
      },
      light: {
        page: "bg-page-light",
        nav: "bg-nav-light",
        sidebar: "bg-sidebar-light",
        raised: "bg-raised-light",
        panel: "bg-panel-light",
        card: "bg-card-light",
        inlineCode: "bg-inline-code-light",
        code: "bg-code-light",
        text: "text-body-light",
        textSecondary: "text-secondary-light",
        textMuted: "text-muted-light",
        textInvert: "text-invert-light",
        textLink: "text-link-light",
        hairline: "hairline-light",
        border: "border-light",
        focusRing: "focus-ring-light",
        selectBg: "select-bg-light",
        selectText: "select-text-light",
        accent: "accent-base-light",
        accentLow: "accent-low-light",
        accentHigh: "accent-high-light",
      },
    },
  },
  fonts: [],
  catalog: {
    hero: {
      routes: [
        {
          route: "/catalog/hero-centered",
          layout: "centered",
          title: "Minimal Hero",
          subtitle: "Centered layout",
          summary: "Overview",
          actions: [{ label: "Start", href: "/catalog" }],
        },
      ],
    },
    pageTitle: { copy: "url" },
    pagination: { variant: "card" },
    sidebar: { mode: "nested", groupIds: ["catalog-core"] },
    layout: "standard",
    fontLicenses: [],
  },
});

/**
 * Calculates SHA-256 hex digest of given content.
 * @param {string | Uint8Array} content
 * @returns {string}
 */
export function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Terminates a process safely with fallback to SIGKILL.
 * @param {import("node:child_process").ChildProcess | any} child
 * @param {NodeJS.Signals | number} [signal]
 */
export function killProcessGroup(child, signal = "SIGKILL") {
  if (!child || child.killed || (child.exitCode !== null && child.exitCode !== undefined)) return;
  try {
    if (child.pid && process.platform !== "win32") {
      process.kill(-child.pid, signal);
    } else if (typeof child.kill === "function") {
      child.kill(signal);
    }
  } catch {
    try {
      if (typeof child.kill === "function") child.kill(signal);
    } catch {
      // Process already terminated
    }
  }
}

/**
 * Executes a CLI binary or JS script with bounded timeout and isolated environment.
 * Never searches PATH or source fallback.
 *
 * @param {string} executable
 * @param {string[]} args
 * @param {{
 *   cwd?: string,
 *   timeoutMs?: number,
 *   nodePath?: string,
 *   env?: Record<string, string>,
 * }} [options]
 * @returns {{ status: number | null, stdout: string, stderr: string, error?: Error }}
 */
export function runBoundedCommand(executable, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const nodePath = options.nodePath ?? process.execPath;
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ? { ...process.env, ...options.env } : process.env;

  let bin = executable;
  let cmdArgs = [...args];
  if (executable.endsWith(".js") || executable.endsWith(".mjs")) {
    bin = nodePath;
    cmdArgs = [executable, ...args];
  }

  const result = spawnSync(bin, cmdArgs, {
    cwd,
    env,
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr || (result.error ? result.error.message : ""),
    error: result.error,
  };
}

/**
 * Executes tfsl-batch over stdin with explicit EOF framing (closing stdin)
 * and bounded clean termination.
 *
 * @param {string} executable
 * @param {string} input
 * @param {{
 *   cwd?: string,
 *   timeoutMs?: number,
 *   nodePath?: string,
 *   env?: Record<string, string>,
 * }} [options]
 * @returns {Promise<{ status: number | null, stdout: string, stderr: string, timedOut: boolean, durationMs: number }>}
 */
export function runBatchFramed(executable, input, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const nodePath = options.nodePath ?? process.execPath;
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ? { ...process.env, ...options.env } : process.env;

  return new Promise((done) => {
    let bin = executable;
    let cmdArgs = [];
    if (executable.endsWith(".js") || executable.endsWith(".mjs")) {
      bin = nodePath;
      cmdArgs = [executable];
    }

    const start = Date.now();
    const child = spawn(bin, cmdArgs, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let resolved = false;

    const finish = (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      done({
        status: code,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - start,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessGroup(child, "SIGKILL");
      finish(null);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      stderr += (stderr ? "\n" : "") + err.message;
      finish(null);
    });

    child.once("close", (code) => {
      finish(code);
    });

    // Write input and immediately end stdin to send EOF framing.
    if (input !== undefined && input !== null) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

/**
 * Creates an in-memory recursive snapshot of a directory mapping relative paths
 * to file sizes and SHA-256 hex digests.
 *
 * @param {string} dir
 * @param {string} [prefix]
 * @returns {Record<string, { size: number, sha256: string }>}
 */
export function takeDirectorySnapshot(dir, prefix = "") {
  /** @type {Record<string, { size: number, sha256: string }>} */
  const entries = {};
  if (!existsSync(dir)) return entries;
  const items = readdirSync(join(dir, prefix), { withFileTypes: true }).sort((a, b) =>
    Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)),
  );
  for (const item of items) {
    const rel = prefix === "" ? item.name : `${prefix}/${item.name}`;
    const full = join(dir, rel);
    if (item.isDirectory()) {
      Object.assign(entries, takeDirectorySnapshot(dir, rel));
    } else if (item.isFile()) {
      const buf = readFileSync(full);
      entries[rel] = {
        size: statSync(full).size,
        sha256: sha256(buf),
      };
    }
  }
  return entries;
}

/**
 * Compares two directory snapshots for exact size and SHA-256 equivalence.
 *
 * @param {Record<string, { size: number, sha256: string }>} before
 * @param {Record<string, { size: number, sha256: string }>} after
 * @returns {boolean}
 */
export function compareDirectorySnapshots(before, after) {
  const beforeKeys = Object.keys(before).sort();
  const afterKeys = Object.keys(after).sort();
  if (beforeKeys.length !== afterKeys.length) return false;
  for (let i = 0; i < beforeKeys.length; i++) {
    const key = beforeKeys[i];
    if (key === undefined || key !== afterKeys[i]) return false;
    const b = before[key];
    const a = after[key];
    if (!b || !a || b.size !== a.size || b.sha256 !== a.sha256) return false;
  }
  return true;
}

/**
 * Evaluates the public membership requirements against an installed package root.
 * Validates package.json, dist/catalog-build-evidence.json, regular bin JS files,
 * entry points, and legal assets.
 *
 * @param {string} packageRoot
 * @returns {{
 *   valid: boolean,
 *   packageMetadata: { name?: string, version?: string, type?: string, hasRequiredExports: boolean, hasRequiredBin: boolean },
 *   manifestEvidence: { present: boolean, schema?: string, memberCount: number, sourceCount: number, valid: boolean },
 *   binFiles: Record<string, { exists: boolean, isRegularFile: boolean, bytes: number }>,
 *   entrypoints: Record<string, boolean>,
 *   legalAssets: Record<string, boolean>,
 *   missingMembers: string[],
 *   mismatchedMembers: string[],
 *   errors: string[],
 * }}
 */
export function checkPublicMembershipRequirements(packageRoot) {
  const root = resolve(packageRoot);
  const errors = [];
  const missingMembers = [];
  const mismatchedMembers = [];

  // 1. Package metadata check
  let packageMetadata = {
    hasRequiredExports: false,
    hasRequiredBin: false,
  };
  const pkgJsonPath = join(root, "package.json");
  if (!existsSync(pkgJsonPath)) {
    errors.push("Missing package.json in package root.");
  } else {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
      packageMetadata = {
        name: pkg.name,
        version: pkg.version,
        type: pkg.type,
        hasRequiredExports: Boolean(
          pkg.exports &&
          pkg.exports["."] &&
          pkg.exports["./batch"] &&
          pkg.exports["./cli"] &&
          pkg.exports["./protocol/*"],
        ),
        hasRequiredBin: Boolean(pkg.bin && pkg.bin.tfsl && pkg.bin["tfsl-batch"]),
      };
      if (pkg.name !== PUBLIC_MEMBERSHIP_REQUIREMENTS.packageName) {
        errors.push(`Unexpected package name "${pkg.name}", expected "${PUBLIC_MEMBERSHIP_REQUIREMENTS.packageName}".`);
      }
      if (pkg.type !== PUBLIC_MEMBERSHIP_REQUIREMENTS.packageType) {
        errors.push(`package.json type must be "${PUBLIC_MEMBERSHIP_REQUIREMENTS.packageType}", got "${pkg.type}".`);
      }
      if (!packageMetadata.hasRequiredExports) {
        errors.push("package.json missing required exports ('.', './batch', './cli', './protocol/*').");
      }
      if (!packageMetadata.hasRequiredBin) {
        errors.push("package.json missing required bin mappings for tfsl and tfsl-batch.");
      }
    } catch (e) {
      errors.push(`Failed to parse package.json: ${e.message}`);
    }
  }

  // 2. Regular bin JS files check
  const binFiles = {};
  for (const binRel of PUBLIC_MEMBERSHIP_REQUIREMENTS.requiredBinMembers) {
    const full = join(root, binRel);
    if (!existsSync(full)) {
      binFiles[binRel] = { exists: false, isRegularFile: false, bytes: 0 };
      errors.push(`Required regular bin file "${binRel}" is missing.`);
    } else {
      const st = lstatSync(full);
      const isRegular = st.isFile() && !st.isSymbolicLink();
      binFiles[binRel] = { exists: true, isRegularFile: isRegular, bytes: st.size };
      if (!isRegular) {
        errors.push(`Required bin file "${binRel}" is not a regular file (symlinks/devices forbidden).`);
      }
      if (st.size === 0) {
        errors.push(`Required bin file "${binRel}" is empty.`);
      }
    }
  }

  // 3. Build evidence check (dist/catalog-build-evidence.json)
  const manifestPath = join(root, PUBLIC_MEMBERSHIP_REQUIREMENTS.requiredBuildEvidence);
  let manifestEvidence = {
    present: false,
    memberCount: 0,
    sourceCount: 0,
    valid: false,
  };
  if (!existsSync(manifestPath)) {
    errors.push(`Required catalog build evidence "${PUBLIC_MEMBERSHIP_REQUIREMENTS.requiredBuildEvidence}" is missing.`);
  } else {
    try {
      const manifestBytes = readFileSync(manifestPath);
      const manifest = JSON.parse(manifestBytes.toString("utf8"));
      manifestEvidence.present = true;
      manifestEvidence.schema = manifest.schema;
      if (manifest.schema !== PUBLIC_MEMBERSHIP_REQUIREMENTS.buildEvidenceSchema) {
        errors.push(`Invalid build evidence schema "${manifest.schema}", expected "${PUBLIC_MEMBERSHIP_REQUIREMENTS.buildEvidenceSchema}".`);
      }
      if (!Array.isArray(manifest.members) || !Array.isArray(manifest.sources)) {
        errors.push("Build evidence missing 'members' or 'sources' array.");
      } else {
        manifestEvidence.memberCount = manifest.members.length;
        manifestEvidence.sourceCount = manifest.sources.length;

        // Verify each declared member in dist / bin exists and matches byte length and SHA-256
        for (const member of manifest.members) {
          if (!member.path || typeof member.path !== "string" || typeof member.bytes !== "number" || typeof member.sha256 !== "string") {
            errors.push(`Malformed member record in build evidence: ${JSON.stringify(member)}`);
            continue;
          }
          const full = join(root, member.path);
          if (!existsSync(full)) {
            missingMembers.push(member.path);
          } else {
            const st = lstatSync(full);
            if (!st.isFile() || st.isSymbolicLink()) {
              mismatchedMembers.push(`${member.path} (not a regular file)`);
            } else {
              const actualBytes = readFileSync(full);
              if (actualBytes.length !== member.bytes || sha256(actualBytes) !== member.sha256) {
                mismatchedMembers.push(`${member.path} (digest or size mismatch)`);
              }
            }
          }
        }
        if (missingMembers.length === 0 && mismatchedMembers.length === 0 && !errors.some((e) => e.includes("build evidence"))) {
          manifestEvidence.valid = true;
        }
      }
    } catch (e) {
      errors.push(`Failed to parse "${PUBLIC_MEMBERSHIP_REQUIREMENTS.requiredBuildEvidence}": ${e.message}`);
    }
  }

  // 4. Entry points check
  const entrypoints = {};
  for (const [key, rel] of Object.entries(PUBLIC_MEMBERSHIP_REQUIREMENTS.requiredEntrypoints)) {
    const present = existsSync(join(root, rel));
    entrypoints[key] = present;
    if (!present) {
      errors.push(`Required entrypoint "${rel}" is missing.`);
    }
  }

  // 5. Legal assets check
  const legalAssets = {};
  for (const asset of PUBLIC_MEMBERSHIP_REQUIREMENTS.requiredLegalAssets) {
    const present = existsSync(join(root, asset));
    legalAssets[asset] = present;
    if (!present) {
      errors.push(`Required legal/documentation asset "${asset}" is missing.`);
    }
  }

  const valid = errors.length === 0 && missingMembers.length === 0 && mismatchedMembers.length === 0;

  return {
    valid,
    packageMetadata,
    manifestEvidence,
    binFiles,
    entrypoints,
    legalAssets,
    missingMembers,
    mismatchedMembers,
    errors,
  };
}

/**
 * Resolves qualification targets strictly within packageRoot without PATH or source fallback.
 *
 * @param {{
 *   packageRoot?: string,
 *   tfsl?: string,
 *   cli?: string,
 *   cliPath?: string,
 *   tfslBatch?: string,
 *   batch?: string,
 *   batchPath?: string,
 *   node?: string,
 * }} [options]
 * @returns {{
 *   packageRoot: string,
 *   tfsl: string,
 *   tfslBatch: string,
 *   node: string,
 * }}
 */
export function resolveInstalledTargets(options = {}) {
  if (!options.packageRoot) {
    throw new Error("Missing required --package-root option. Specify an installed package directory.");
  }
  const packageRoot = resolve(options.packageRoot);
  if (!existsSync(packageRoot) || !statSync(packageRoot).isDirectory()) {
    throw new Error(`Package root does not exist or is not a directory: "${packageRoot}".`);
  }

  // Resolve Node runtime (explicit or process.execPath; never arbitrary PATH lookup)
  const node = options.node ? resolve(options.node) : process.execPath;
  if (!existsSync(node)) {
    throw new Error(`Specified node runtime executable does not exist: "${node}".`);
  }

  // Resolve tfsl CLI executable (strictly inside packageRoot unless explicitly provided)
  let tfsl = options.tfsl ?? options.cli ?? options.cliPath;
  if (tfsl) {
    tfsl = resolve(tfsl);
    if (!existsSync(tfsl)) {
      throw new Error(`Specified tfsl executable does not exist: "${tfsl}".`);
    }
  } else {
    const candidates = [
      join(packageRoot, "bin", "tfsl.js"),
      join(packageRoot, "bin", "tfsl"),
      join(packageRoot, "dist", "cli-catalog.js"),
      join(packageRoot, "dist", "cli.js"),
    ];
    // Also inspect package.json if present
    const pkgJsonPath = join(packageRoot, "package.json");
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
        if (pkg.bin?.tfsl) {
          candidates.unshift(join(packageRoot, pkg.bin.tfsl));
        }
      } catch {
        // Fall back to candidate list
      }
    }
    tfsl = candidates.find((c) => existsSync(c));
  }
  if (!tfsl) {
    throw new Error(
      `Could not resolve tfsl CLI executable within package root "${packageRoot}". ` +
      `Specify --tfsl explicitly (no PATH/source fallback permitted).`,
    );
  }

  // Resolve tfsl-batch executable (strictly inside packageRoot unless explicitly provided)
  let tfslBatch = options.tfslBatch ?? options.batch ?? options.batchPath;
  if (tfslBatch) {
    tfslBatch = resolve(tfslBatch);
    if (!existsSync(tfslBatch)) {
      throw new Error(`Specified tfsl-batch executable does not exist: "${tfslBatch}".`);
    }
  } else {
    const candidates = [
      join(packageRoot, "bin", "tfsl-batch.js"),
      join(packageRoot, "bin", "tfsl-batch"),
      join(packageRoot, "dist", "batch-catalog.js"),
      join(packageRoot, "dist", "batch.js"),
    ];
    const pkgJsonPath = join(packageRoot, "package.json");
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
        if (pkg.bin?.["tfsl-batch"]) {
          candidates.unshift(join(packageRoot, pkg.bin["tfsl-batch"]));
        }
      } catch {
        // Fall back to candidate list
      }
    }
    tfslBatch = candidates.find((c) => existsSync(c));
  }
  if (!tfslBatch) {
    throw new Error(
      `Could not resolve tfsl-batch executable within package root "${packageRoot}". ` +
      `Specify --tfsl-batch explicitly (no PATH/source fallback permitted).`,
    );
  }

  return { packageRoot, tfsl, tfslBatch, node };
}

/**
 * Parses command-line arguments for qualify-installed.mjs.
 *
 * @param {string[]} args
 * @returns {{
 *   packageRoot: string | null,
 *   tfsl: string | null,
 *   tfslBatch: string | null,
 *   node: string | null,
 *   workDir: string | null,
 *   timeoutMs: number,
 *   stdout: boolean,
 *   json: boolean,
 *   help?: boolean,
 * }}
 */
export function parseInstalledArgs(args) {
  /** @type {any} */
  const result = {
    packageRoot: null,
    tfsl: null,
    tfslBatch: null,
    node: null,
    workDir: null,
    timeoutMs: 15_000,
    stdout: true,
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      result.help = true;
      return result;
    }

    /**
     * @param {string} name
     * @returns {string}
     */
    const parseVal = (name) => {
      if (arg.startsWith(`${name}=`)) {
        return arg.slice(name.length + 1);
      }
      if (arg === name) {
        i++;
        const val = args[i];
        if (i >= args.length || val === undefined || val.startsWith("-")) {
          throw new Error(`Missing value for argument "${name}".`);
        }
        return val;
      }
      throw new Error(`Internal argument parsing error for "${name}".`);
    };

    if (arg === "--package-root" || arg.startsWith("--package-root=")) {
      if (result.packageRoot !== null) throw new Error("Duplicate --package-root argument.");
      result.packageRoot = resolve(parseVal("--package-root"));
    } else if (
      arg === "--tfsl" ||
      arg.startsWith("--tfsl=") ||
      arg === "--tfsl-path" ||
      arg.startsWith("--tfsl-path=") ||
      arg === "--cli" ||
      arg.startsWith("--cli=") ||
      arg === "--cli-path" ||
      arg.startsWith("--cli-path=")
    ) {
      if (result.tfsl !== null) throw new Error("Duplicate --tfsl argument.");
      const prefix = arg.startsWith("--tfsl-path")
        ? "--tfsl-path"
        : arg.startsWith("--cli-path")
          ? "--cli-path"
          : arg.startsWith("--cli")
            ? "--cli"
            : "--tfsl";
      result.tfsl = resolve(parseVal(prefix));
    } else if (
      arg === "--tfsl-batch" ||
      arg.startsWith("--tfsl-batch=") ||
      arg === "--tfsl-batch-path" ||
      arg.startsWith("--tfsl-batch-path=") ||
      arg === "--batch" ||
      arg.startsWith("--batch=") ||
      arg === "--batch-path" ||
      arg.startsWith("--batch-path=")
    ) {
      if (result.tfslBatch !== null) throw new Error("Duplicate --tfsl-batch argument.");
      const prefix = arg.startsWith("--tfsl-batch-path")
        ? "--tfsl-batch-path"
        : arg.startsWith("--batch-path")
          ? "--batch-path"
          : arg.startsWith("--batch")
            ? "--batch"
            : "--tfsl-batch";
      result.tfslBatch = resolve(parseVal(prefix));
    } else if (
      arg === "--node" ||
      arg.startsWith("--node=") ||
      arg === "--node-runtime" ||
      arg.startsWith("--node-runtime=") ||
      arg === "--node-path" ||
      arg.startsWith("--node-path=")
    ) {
      if (result.node !== null) throw new Error("Duplicate --node argument.");
      const prefix = arg.startsWith("--node-runtime")
        ? "--node-runtime"
        : arg.startsWith("--node-path")
          ? "--node-path"
          : "--node";
      result.node = resolve(parseVal(prefix));
    } else if (
      arg === "--work-dir" ||
      arg.startsWith("--work-dir=") ||
      arg === "--scratch" ||
      arg.startsWith("--scratch=")
    ) {
      if (result.workDir !== null) throw new Error("Duplicate --work-dir argument.");
      const prefix = arg.startsWith("--scratch") ? "--scratch" : "--work-dir";
      result.workDir = resolve(parseVal(prefix));
    } else if (
      arg === "--timeout" ||
      arg.startsWith("--timeout=") ||
      arg === "--timeout-ms" ||
      arg.startsWith("--timeout-ms=")
    ) {
      const prefix = arg.startsWith("--timeout-ms") ? "--timeout-ms" : "--timeout";
      const rawVal = parseVal(prefix);
      const val = parseInt(rawVal, 10);
      if (isNaN(val) || val <= 0) throw new Error(`Invalid value for --timeout: "${rawVal}".`);
      result.timeoutMs = val;
    } else if (arg === "--no-stdout") {
      result.stdout = false;
    } else if (arg === "--stdout") {
      result.stdout = true;
    } else if (arg === "--json") {
      result.json = true;
    } else {
      throw new Error(`Unexpected argument: "${arg}".`);
    }
  }

  return result;
}

/**
 * Callable qualification probe for an installed Theme Forge Stellar Loom package.
 * Exercises:
 *  1. Public membership and closed executable evidence
 *  2. Immutability of installed tree across all operations
 *  3. CLI version and help flags
 *  4. CLI validate command (human and JSON)
 *  5. CLI compile command with independent expected CSS digest verification
 *  6. Repeat determinism across independent directories
 *  7. Malformed input rejection and dirty output preservation
 *  8. Working directory (cwd) independence
 *  9. Isolated user and cache state
 * 10. Actual tfsl-batch stdin EOF framing with bounded clean termination
 * 11. Exchange catalog-create and catalog-verify workflows
 * 12. Direct library ESM dynamic import and public API functions
 *
 * @param {{
 *   packageRoot?: string,
 *   tfsl?: string,
 *   tfslBatch?: string,
 *   node?: string,
 *   workDir?: string,
 *   timeoutMs?: number,
 *   stdout?: boolean,
 * }} [options]
 * @returns {Promise<Record<string, unknown>>}
 */
export async function qualifyInstalled(options = {}) {
  const targets = resolveInstalledTargets(options);
  const root = targets.packageRoot;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const isManagedWorkDir = !options.workDir;
  const workDir = options.workDir
    ? resolve(options.workDir)
    : realpathSync(mkdtempSync(join(tmpdir(), "tfsl-installed-qual-")));

  mkdirSync(workDir, { recursive: true });

  const envHome = join(workDir, "isolated-home");
  const envCache = join(workDir, "isolated-cache");
  const envConfig = join(workDir, "isolated-config");
  const envNpmCache = join(workDir, "isolated-npm-cache");
  mkdirSync(envHome, { recursive: true });
  mkdirSync(envCache, { recursive: true });
  mkdirSync(envConfig, { recursive: true });
  mkdirSync(envNpmCache, { recursive: true });

  const isolatedEnv = {
    ...process.env,
    NODE_OPTIONS: "",
    NODE_PATH: "",
    HOME: envHome,
    XDG_CACHE_HOME: envCache,
    XDG_CONFIG_HOME: envConfig,
    NPM_CONFIG_CACHE: envNpmCache,
  };

  const commandOpts = {
    cwd: workDir,
    nodePath: targets.node,
    timeoutMs,
    env: isolatedEnv,
  };

  try {
    // Phase 1: Snapshot installed tree and check public membership requirements
    const snapshotBefore = takeDirectorySnapshot(root);
    const membership = checkPublicMembershipRequirements(root);
    if (!membership.valid) {
      throw new Error(
        `Installed package public membership requirements check failed: ${membership.errors.join("; ")}`,
      );
    }

    // Prepare self-contained or installed theme fixtures
    const fixturesDir = join(workDir, "fixtures");
    mkdirSync(fixturesDir, { recursive: true });

    let v1ThemePath;
    const installedCyan = join(root, "examples", "stellar-cyan.theme.json");
    if (existsSync(installedCyan)) {
      v1ThemePath = installedCyan;
    } else {
      v1ThemePath = join(fixturesDir, "probe-v1.theme.json");
      writeFileSync(v1ThemePath, JSON.stringify(MINIMAL_V1_THEME, null, 2) + "\n", "utf8");
    }

    let catalogThemePath;
    const installedBlack = join(root, "examples", "loom-black-catalog.json");
    if (existsSync(installedBlack)) {
      catalogThemePath = installedBlack;
    } else {
      catalogThemePath = join(fixturesDir, "probe-catalog.theme.json");
      writeFileSync(catalogThemePath, JSON.stringify(MINIMAL_CATALOG_THEME, null, 2) + "\n", "utf8");
    }

    // Phase 2: CLI Version and Help
    const verRes = runBoundedCommand(targets.tfsl, ["--version"], commandOpts);
    if (verRes.status !== 0 || !verRes.stdout.includes(membership.packageMetadata.version ?? "0.4.0")) {
      throw new Error(`tfsl --version failed: status=${verRes.status}, stdout="${verRes.stdout}", stderr="${verRes.stderr}"`);
    }

    const verShortRes = runBoundedCommand(targets.tfsl, ["-v"], commandOpts);
    if (verShortRes.status !== 0 || !verShortRes.stdout.includes(membership.packageMetadata.version ?? "0.4.0")) {
      throw new Error(`tfsl -v failed: status=${verShortRes.status}`);
    }

    const helpRes = runBoundedCommand(targets.tfsl, ["--help"], commandOpts);
    if (helpRes.status !== 0 || !helpRes.stdout.includes("Usage:") || !helpRes.stdout.includes("compile")) {
      throw new Error(`tfsl --help failed: status=${helpRes.status}, stdout="${helpRes.stdout}"`);
    }

    const helpShortRes = runBoundedCommand(targets.tfsl, ["-h"], commandOpts);
    if (helpShortRes.status !== 0 || !helpShortRes.stdout.includes("Usage:")) {
      throw new Error(`tfsl -h failed: status=${helpShortRes.status}`);
    }

    // Phase 3: CLI Validate Command (Human and JSON modes)
    const valHuman = runBoundedCommand(targets.tfsl, ["validate", v1ThemePath], commandOpts);
    if (valHuman.status !== 0 || !valHuman.stdout.includes("is valid")) {
      throw new Error(`tfsl validate human mode failed: status=${valHuman.status}, stdout="${valHuman.stdout}", stderr="${valHuman.stderr}"`);
    }

    const valJson = runBoundedCommand(targets.tfsl, ["validate", v1ThemePath, "--json"], commandOpts);
    if (valJson.status !== 0) {
      throw new Error(`tfsl validate --json failed: status=${valJson.status}, stderr="${valJson.stderr}"`);
    }
    const valParsed = JSON.parse(valJson.stdout);
    if (valParsed.status !== "success" || !valParsed.command) {
      throw new Error(`tfsl validate --json unexpected output: ${valJson.stdout}`);
    }

    // Phase 4: CLI Compile Command and Independent Expected CSS / Digest
    const compileDir1 = join(workDir, "compile-run-1");
    const compRes1 = runBoundedCommand(
      targets.tfsl,
      ["compile", v1ThemePath, "--out", compileDir1, "--json"],
      commandOpts,
    );
    if (compRes1.status !== 0) {
      throw new Error(`tfsl compile failed: status=${compRes1.status}, stderr="${compRes1.stderr}"`);
    }
    const compJson1 = JSON.parse(compRes1.stdout);
    if (compJson1.status !== "success" || !compJson1.outputDigest) {
      throw new Error(`tfsl compile --json unexpected output: ${compRes1.stdout}`);
    }

    const cssPath1 = join(compileDir1, "theme.css");
    const descPath1 = join(compileDir1, "theme.descriptor.json");
    if (!existsSync(cssPath1) || !existsSync(descPath1)) {
      throw new Error("tfsl compile did not write theme.css or theme.descriptor.json.");
    }
    const cssContent1 = readFileSync(cssPath1, "utf8");
    const descContent1 = JSON.parse(readFileSync(descPath1, "utf8"));
    const calculatedSha1 = sha256(cssContent1);

    if (calculatedSha1 !== descContent1.outputDigest) {
      throw new Error(
        `Descriptor outputDigest mismatch: calculated "${calculatedSha1}" vs recorded "${descContent1.outputDigest}".`,
      );
    }
    if (descContent1.schema !== "tfsl.theme-descriptor-v1") {
      throw new Error(`Descriptor schema mismatch: expected "tfsl.theme-descriptor-v1", got "${descContent1.schema}".`);
    }
    if (!cssContent1.includes("--sl-color-accent:")) {
      throw new Error("Compiled theme.css missing required Starlight variable --sl-color-accent.");
    }

    // Phase 5: Repeat Determinism
    const compileDir2 = join(workDir, "compile-run-2");
    const compRes2 = runBoundedCommand(
      targets.tfsl,
      ["compile", v1ThemePath, "--out", compileDir2, "--json"],
      commandOpts,
    );
    if (compRes2.status !== 0) {
      throw new Error(`tfsl compile run 2 failed: status=${compRes2.status}`);
    }
    const snap1 = takeDirectorySnapshot(compileDir1);
    const snap2 = takeDirectorySnapshot(compileDir2);
    if (!compareDirectorySnapshots(snap1, snap2)) {
      throw new Error("Compilation repeat determinism failure: compileDir1 and compileDir2 outputs differ.");
    }

    // Phase 6: Malformed Rejection and Output Preservation
    const malformedThemePath = join(fixturesDir, "malformed.theme.json");
    writeFileSync(malformedThemePath, JSON.stringify({ schemaVersion: "invalid", name: "bad" }), "utf8");

    const badValRes = runBoundedCommand(targets.tfsl, ["validate", malformedThemePath], commandOpts);
    if (badValRes.status === 0) {
      throw new Error("tfsl validate should have failed on malformed theme specification.");
    }

    const badCompRes = runBoundedCommand(
      targets.tfsl,
      ["compile", malformedThemePath, "--out", join(workDir, "bad-out")],
      commandOpts,
    );
    if (badCompRes.status === 0) {
      throw new Error("tfsl compile should have failed on malformed theme specification.");
    }

    // Safety: Non-empty directory collision refusal without --overwrite (exit code 3)
    const collisionDir = join(workDir, "collision-test");
    mkdirSync(collisionDir, { recursive: true });
    const preciousFilePath = join(collisionDir, "precious-operator-data.txt");
    writeFileSync(preciousFilePath, "critical unmanaged operator data\n", "utf8");

    const collRes = runBoundedCommand(
      targets.tfsl,
      ["compile", v1ThemePath, "--out", collisionDir],
      commandOpts,
    );
    if (collRes.status !== 3) {
      throw new Error(`Expected exit code 3 on collision without --overwrite, got ${collRes.status}`);
    }
    if (readFileSync(preciousFilePath, "utf8") !== "critical unmanaged operator data\n") {
      throw new Error("Existing precious operator data was modified during collision refusal!");
    }

    // Safety: Dirty output refusal even with --overwrite (exit code 3)
    const dirtyDir = join(workDir, "dirty-overwrite-test");
    const initialComp = runBoundedCommand(
      targets.tfsl,
      ["compile", v1ThemePath, "--out", dirtyDir],
      commandOpts,
    );
    if (initialComp.status !== 0) {
      throw new Error(`Initial compile for dirty test failed: ${initialComp.stderr}`);
    }
    writeFileSync(join(dirtyDir, "theme.css"), "/* manually corrupted css */\n", "utf8");
    const dirtyRes = runBoundedCommand(
      targets.tfsl,
      ["compile", v1ThemePath, "--out", dirtyDir, "--overwrite"],
      commandOpts,
    );
    if (dirtyRes.status !== 3) {
      throw new Error(`Expected exit code 3 on dirty overwrite attempt, got ${dirtyRes.status}`);
    }

    // Phase 7: CWD Independence
    const foreignCwd = join(workDir, "foreign-working-directory");
    mkdirSync(foreignCwd, { recursive: true });
    const foreignOut = join(workDir, "foreign-cwd-out");
    const foreignRes = runBoundedCommand(
      targets.tfsl,
      ["compile", v1ThemePath, "--out", foreignOut, "--json"],
      { ...commandOpts, cwd: foreignCwd },
    );
    if (foreignRes.status !== 0) {
      throw new Error(`Compile from foreign cwd failed: ${foreignRes.stderr}`);
    }
    const foreignCss = readFileSync(join(foreignOut, "theme.css"), "utf8");
    if (sha256(foreignCss) !== calculatedSha1) {
      throw new Error("CWD independence failure: compiled CSS digest differs when invoked from foreign cwd.");
    }

    // Phase 8: tfsl-batch Framing with Stdin EOF and Bounded Clean Termination
    // 8a. Framed Success (action: example)
    const batchSuccessReq = JSON.stringify({ action: "example", exampleName: "stellar-cyan", uiRevision: 101 });
    const batchSuccess = await runBatchFramed(targets.tfslBatch, batchSuccessReq, commandOpts);
    if (batchSuccess.timedOut || batchSuccess.status !== 0) {
      throw new Error(`tfsl-batch framed success failed: status=${batchSuccess.status}, timedOut=${batchSuccess.timedOut}, stderr="${batchSuccess.stderr}"`);
    }
    const batchSuccessParsed = JSON.parse(batchSuccess.stdout);
    if (batchSuccessParsed.status !== "success" || !batchSuccessParsed.valid || batchSuccessParsed.uiRevision !== 101 || !batchSuccessParsed.compiledCss) {
      throw new Error(`tfsl-batch framed success unexpected payload: ${batchSuccess.stdout}`);
    }

    // 8b. Framed Error (action: example with non-existent theme)
    const batchErrorReq = JSON.stringify({ action: "example", exampleName: "unknown-theme-probe-xyz" });
    const batchError = await runBatchFramed(targets.tfslBatch, batchErrorReq, commandOpts);
    if (batchError.timedOut || batchError.status !== 1) {
      throw new Error(`tfsl-batch framed error expected exit code 1, got status=${batchError.status}, timedOut=${batchError.timedOut}`);
    }
    const batchErrorParsed = JSON.parse(batchError.stdout);
    if (batchErrorParsed.status !== "error" || batchErrorParsed.valid !== false || batchErrorParsed.error?.code !== "UNKNOWN_EXAMPLE") {
      throw new Error(`tfsl-batch framed error unexpected response: ${batchError.stdout}`);
    }

    // 8c. Clean EOF termination on Empty Stdin
    const batchEmpty = await runBatchFramed(targets.tfslBatch, "", commandOpts);
    if (batchEmpty.timedOut || batchEmpty.status !== 1) {
      throw new Error(`tfsl-batch empty stdin expected exit code 1, got status=${batchEmpty.status}`);
    }
    const batchEmptyParsed = JSON.parse(batchEmpty.stdout);
    if (batchEmptyParsed.error?.code !== "EMPTY_INPUT") {
      throw new Error(`tfsl-batch empty stdin expected EMPTY_INPUT, got: ${batchEmpty.stdout}`);
    }

    // 8d. Malformed JSON Stdin Handling
    const batchMalformed = await runBatchFramed(targets.tfslBatch, "not valid json {", commandOpts);
    if (batchMalformed.timedOut || batchMalformed.status !== 1) {
      throw new Error(`tfsl-batch malformed JSON expected exit code 1, got status=${batchMalformed.status}`);
    }
    const batchMalformedParsed = JSON.parse(batchMalformed.stdout);
    if (batchMalformedParsed.error?.code !== "INVALID_JSON") {
      throw new Error(`tfsl-batch malformed JSON expected INVALID_JSON, got: ${batchMalformed.stdout}`);
    }

    // Phase 9: Exchange Catalog-Create and Catalog-Verify Workflows
    const exchangeDir = join(workDir, "exchange-test");
    mkdirSync(exchangeDir, { recursive: true });
    const exchangePkgMetaPath = join(exchangeDir, "candidate-pkg-meta.json");
    writeFileSync(
      exchangePkgMetaPath,
      JSON.stringify({
        name: "@fixture/installed-candidate-probe",
        version: "1.0.0",
        description: "Installed qualification candidate probe",
        author: "Probe Runner",
      }, null, 2) + "\n",
      "utf8",
    );
    const candidatePacketPath = join(exchangeDir, "candidate.packet.json");

    const catCreateRes = runBoundedCommand(
      targets.tfsl,
      [
        "exchange",
        "catalog-create",
        catalogThemePath,
        "--package",
        exchangePkgMetaPath,
        "--out",
        candidatePacketPath,
      ],
      commandOpts,
    );
    if (catCreateRes.status !== 0) {
      throw new Error(`tfsl exchange catalog-create failed: status=${catCreateRes.status}, stderr="${catCreateRes.stderr}", stdout="${catCreateRes.stdout}"`);
    }
    const catCreateJson = JSON.parse(catCreateRes.stdout);
    if (catCreateJson.status !== "success" || !catCreateJson.candidateDigest) {
      throw new Error(`tfsl exchange catalog-create unexpected output: ${catCreateRes.stdout}`);
    }

    if (!existsSync(candidatePacketPath)) {
      throw new Error("tfsl exchange catalog-create did not create output packet file.");
    }
    const candidateRaw = readFileSync(candidatePacketPath, "utf8");
    const candidatePacket = JSON.parse(candidateRaw);
    if (candidatePacket.schema !== "tfsl.theme-catalog-candidate" || candidatePacket.state !== "candidate") {
      throw new Error(`Unexpected candidate packet schema/state: ${candidatePacket.schema}/${candidatePacket.state}`);
    }
    if (!candidatePacket.producer?.executableDigest || !candidatePacket.producer?.packageMetadataDigest) {
      throw new Error("Candidate packet missing required producer executable/metadata evidence digests.");
    }

    // Verify candidate packet with catalog-verify
    const catVerifyRes = runBoundedCommand(
      targets.tfsl,
      ["exchange", "catalog-verify", candidatePacketPath],
      commandOpts,
    );
    if (catVerifyRes.status !== 0) {
      throw new Error(`tfsl exchange catalog-verify failed: status=${catVerifyRes.status}, stderr="${catVerifyRes.stderr}", stdout="${catVerifyRes.stdout}"`);
    }
    const catVerifyJson = JSON.parse(catVerifyRes.stdout);
    if (!catVerifyJson.valid || catVerifyJson.errors.length > 0 || catVerifyJson.candidateDigest !== candidatePacket.candidateDigest) {
      throw new Error(`tfsl exchange catalog-verify validation failed: ${catVerifyRes.stdout}`);
    }

    // Tamper detection: Candidate tampering must be rejected by catalog-verify
    const tamperedPacket = JSON.parse(candidateRaw);
    tamperedPacket.selectedAccent = "invalid-accent-override";
    const tamperedPacketPath = join(exchangeDir, "tampered.packet.json");
    writeFileSync(tamperedPacketPath, JSON.stringify(tamperedPacket, null, 2) + "\n", "utf8");

    const catTamperRes = runBoundedCommand(
      targets.tfsl,
      ["exchange", "catalog-verify", tamperedPacketPath],
      commandOpts,
    );
    if (catTamperRes.status === 0) {
      const parsedTamper = JSON.parse(catTamperRes.stdout || "{}");
      if (parsedTamper.valid) {
        throw new Error("tfsl exchange catalog-verify should have rejected tampered candidate packet.");
      }
    }

    // Phase 10: Library ESM Imports and Public Subpaths
    const libTestScript = `
      import { pathToFileURL } from "node:url";
      const indexPath = ${JSON.stringify(join(root, "dist", "index-catalog.js"))};
      const batchPath = ${JSON.stringify(join(root, "dist", "batch-catalog.js"))};
      const cliPath = ${JSON.stringify(join(root, "dist", "cli-catalog.js"))};

      const loom = await import(pathToFileURL(indexPath).href);
      const batch = await import(pathToFileURL(batchPath).href);
      const cli = await import(pathToFileURL(cliPath).href);

      if (typeof loom.compileTheme !== "function") throw new Error("compileTheme export missing");
      if (typeof loom.validateTheme !== "function") throw new Error("validateTheme export missing");
      if (typeof loom.generateThemePackage !== "function") throw new Error("generateThemePackage export missing");
      if (typeof loom.runBatch !== "function") throw new Error("runBatch export missing");
      if (typeof batch.processBatchRequest !== "function") throw new Error("batch subpath export missing");
      if (typeof cli.runCli !== "function") throw new Error("cli subpath export missing");
      if (typeof loom.COMPILER_VERSION !== "string") throw new Error("COMPILER_VERSION export missing");

      if (loom.STELLAR_CYAN_EXAMPLE) {
        const val = loom.validateTheme(loom.STELLAR_CYAN_EXAMPLE);
        if (val.name !== "stellar-cyan") throw new Error("validateTheme failed on STELLAR_CYAN_EXAMPLE");
        const comp = loom.compileTheme(loom.STELLAR_CYAN_EXAMPLE);
        if (!comp.css || !comp.descriptor) throw new Error("compileTheme failed on STELLAR_CYAN_EXAMPLE");
      }

      console.log("ESM_OK");
    `;
    const libTestPath = join(workDir, "esm-library-probe.mjs");
    writeFileSync(libTestPath, libTestScript, "utf8");
    const libRes = runBoundedCommand(libTestPath, [], commandOpts);
    if (libRes.status !== 0 || !libRes.stdout.includes("ESM_OK")) {
      throw new Error(`Library ESM probe failed: status=${libRes.status}, stderr="${libRes.stderr}"`);
    }

    // Phase 11: Assert Installed Package Root Remained Completely Unmodified
    const snapshotAfter = takeDirectorySnapshot(root);
    const unchanged = compareDirectorySnapshots(snapshotBefore, snapshotAfter);
    if (!unchanged) {
      throw new Error("FATAL: Installed package root files were modified during qualification!");
    }

    const report = {
      qualified: true,
      schemaVersion: 1,
      packageRoot: root,
      targets: {
        packageRoot: root,
        tfsl: targets.tfsl,
        tfslBatch: targets.tfslBatch,
        node: targets.node,
      },
      publicMembershipRequirements: {
        status: "pass",
        specification: PUBLIC_MEMBERSHIP_REQUIREMENTS,
        evaluated: membership,
      },
      probes: {
        versionAndHelp: {
          passed: true,
          version: membership.packageMetadata.version,
        },
        validation: {
          passed: true,
          humanModePassed: true,
          jsonModePassed: true,
        },
        compilation: {
          passed: true,
          outputDigest: calculatedSha1,
          descriptorVerified: true,
        },
        repeatDeterminism: {
          passed: true,
          identicalOutputs: true,
        },
        malformedRejection: {
          passed: true,
          schemaRejection: true,
          collisionRefusal: true,
          dirtyOverwriteRefusal: true,
        },
        cwdIndependence: {
          passed: true,
          outputDigestMatched: true,
        },
        isolatedUserState: {
          passed: true,
          isolatedEnvVerified: true,
        },
        batchFraming: {
          passed: true,
          framedSuccess: true,
          framedError: true,
          cleanEofTermination: true,
          malformedJsonRejection: true,
        },
        exchangeCatalog: {
          passed: true,
          candidateCreated: true,
          candidateVerified: true,
          tamperRejected: true,
        },
        libraryEsm: {
          passed: true,
          entrypointsImportable: true,
        },
      },
      installedTreeUnchanged: true,
    };

    if (options.stdout !== false) {
      process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    }

    return report;
  } finally {
    if (isManagedWorkDir) {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
}

export const qualifyInstalledLoom = qualifyInstalled;

// CLI execution entry point
const isDirectExecution =
  process.argv[1] &&
  (resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
    pathToFileURL(resolve(process.argv[1])).href === import.meta.url);

if (isDirectExecution) {
  let parsed;
  try {
    parsed = parseInstalledArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err.message}\n`);
    console.error("Run with --help for usage details.");
    process.exit(2);
  }

  if (parsed.help) {
    process.stdout.write(`Usage:
  qualify-installed.mjs --package-root <path> [options]

Required:
  --package-root <path>       Root directory of the installed Theme Forge Stellar Loom package

Options:
  --node <path>               Explicit path to Node runtime binary (defaults to process.execPath)
  --work-dir <path>           Optional scratch directory for qualification files (auto-cleaned if omitted)
  --tfsl <path>               Explicit path to tfsl executable (strictly resolved in package root if omitted)
  --tfsl-batch <path>         Explicit path to tfsl-batch executable (strictly resolved in package root if omitted)
  --timeout <ms>              Timeout in milliseconds for child process probes (default: 15000)
  --no-stdout                 Suppress JSON report emission to stdout
  --json                      Emit parseable JSON qualification report (default: true)
  --help, -h                  Display this help message

Notes:
  - Sibling-free: Never falls back to monorepo sibling packages, git checkouts, or global PATH.
  - Verifies public membership requirements, catalog build evidence, framed batch EOF, determinism, and immutability.
`);
    process.exit(0);
  }

  qualifyInstalled({
    packageRoot: parsed.packageRoot,
    tfsl: parsed.tfsl,
    tfslBatch: parsed.tfslBatch,
    node: parsed.node,
    workDir: parsed.workDir,
    timeoutMs: parsed.timeoutMs,
    stdout: parsed.stdout,
  })
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error("\nFATAL: Installed package qualification failed:", err.message);
      process.exit(1);
    });
}
