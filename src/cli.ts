import {
  readFile,
  readdir,
  mkdir,
  writeFile,
  rename,
  unlink,
  lstat,
  stat,
  realpath,
} from "node:fs/promises";
import { resolve, join, dirname, basename } from "node:path";
import { randomBytes } from "node:crypto";
import { compileTheme } from "./compiler/index.js";
import { validateThemeSpecification, ValidationError } from "./schema/validator.js";
import { canonicalizeSpecification, computeSha256 } from "./compiler/canonical.js";
import { analyzeThemeContrast, ContrastError } from "./compiler/contrast.js";
import { COMPILER_PACKAGE, COMPILER_VERSION } from "./compiler/descriptor.js";
import { generateThemePackage, writeThemePackage, FilesystemSafetyError } from "./generator/index.js";
import {
  createThemeBrief,
  createThemeCandidate,
  createThemeReview,
  verifyThemeCandidate,
  validateThemeReviewLinks,
  validateThemeExchangePacket,
  parseThemeExchangePacket,
  serializeThemeExchangePacket,
  inspectThemeExchangePacket,
  isCanonicalJson,
  validatePngBuffer,
  computeVisualEvidenceDigest,
  ThemeExchangeValidationError,
  type ThemeBriefPacket,
  type ThemeCandidatePacket,
  type ThemeReviewPacket,
  type ThemeExchangePacket,
  type ThemeVisualRecord,
} from "./design-exchange/index.js";

export const CLI_HELP = `Theme Forge Stellar Loom (TFSL) CLI

Usage:
  tfsl validate <theme.json> [--strict-contrast] [--json]
  tfsl compile <theme.json> --out <output-directory> [--overwrite] [--strict-contrast] [--json]
  tfsl generate <theme.json> --package <package-metadata.json> --out <output-directory> [--template <id>] [--strict-contrast] [--json]
  tfsl exchange <subcommand> [options]
  tfsl --help | -h
  tfsl --version | -v

Commands:
  validate <theme.json>                   Validates theme specification and checks contrast
  compile <theme.json> --out <dir>       Compiles specification to theme.css and theme.descriptor.json
  generate <theme.json> --package <pkg>  Generates installable Starlight theme package
  exchange <subcommand>                  Theme design exchange workflows (brief, candidate, review, validate, inspect)

Exchange Subcommands:
  exchange brief --name <name> --out <file> [options]
  exchange candidate --brief <file> --theme <file> --out <file> [options]
  exchange review --brief <file> --candidate <file...> --out <file> [options]
  exchange validate <packet.json> [--brief <file>] [--json]
  exchange inspect <packet.json> [--json]

Options:
  --out <dir|file>     Output directory or file (required for compile, generate, exchange brief/candidate/review)
  --package <file>     Path to package metadata JSON file (required for generate)
  --template <id>      Approved override template ID (e.g. page-title-frame)
  --overwrite          Allow replacing existing output files (compile only; generate requires an empty or absent directory; forbidden for exchange)
  --strict-contrast    Fail compilation (exit 1) if any color pair fails WCAG 2.2 AA contrast
  --json               Output parseable JSON diagnostics with no progress prose
  --help, -h           Show this help message
  --version, -v        Show version information

Exit Codes:
  0: Success
  1: Theme specification or exchange validation error
  2: Command-line syntax or argument error
  3: Output filesystem safety rejection
`;

export const EXCHANGE_HELP = `Theme Forge Stellar Loom (TFSL) Design Exchange CLI

Usage:
  tfsl exchange brief --name <name> --out <file> [options]
  tfsl exchange candidate --brief <file> --theme <file> --out <file> [options]
  tfsl exchange review --brief <file> --candidate <file...> --out <file> [options]
  tfsl exchange validate <packet.json> [--brief <file>] [--json]
  tfsl exchange inspect <packet.json> [--json]

Subcommands:
  brief       Create an immutable theme brief packet (.tfsl-brief.json)
  candidate   Create an immutable theme candidate packet (.tfsl-candidate.json)
  review      Create an immutable theme review packet (.tfsl-review.json)
  validate    Validate an exchange packet's schema, digest, and constraints
  inspect     Display summary metadata and integrity status of an exchange packet

Exchange Options:
  --name <id>                 Machine name / ID for the brief (required for brief)
  --out <file>                Destination path for generated packet (absent-only; fails if file exists)
  --brief <file>              Path to brief packet file (.tfsl-brief.json)
  --theme <file>              Path to theme specification JSON file (.json)
  --candidate <file>          Path to candidate packet file (repeatable)
  --label <label>             Short human label
  --description <desc>        Human description
  --intent <text>             High-level intent or creative goals
  --author <name>             Self-asserted author or originator
  --proposer <name>           Proposer / author for candidate
  --reviewer <name>           Reviewer name / identifier
  --review-summary <summary>  Summary notes for the review
  --review-data <file>        Path to JSON file containing candidate reviews
  --allowed-fields <f1,f2>    Comma-separated list of allowed leaf fields
  --allowed-modes <mode>      Allowed modes: both, dark, or light
  --target-theme-name <name>  Expected theme name
  --min-contrast-ratio <num>  Minimum contrast ratio requirement (float)
  --max-candidates <num>      Maximum allowed candidates (int)
  --notes <text>              Implementation notes or rationale for candidate
  --visual <file>             PNG image file to attach as visual evidence (repeatable)
  --strict-contrast           Enforce WCAG 2.2 AA contrast compliance
  --json                      Output parseable JSON output
  --help, -h                  Show this help message
`;

interface ParsedCliArgs {
  command?: string | undefined;
  filePath?: string | undefined;
  packagePath?: string | undefined;
  outDir?: string | undefined;
  template?: string | undefined;
  overwrite: boolean;
  strictContrast: boolean;
  json: boolean;
  help: boolean;
  version: boolean;
}



function parseArguments(args: string[]): { parsed?: ParsedCliArgs; error?: string } {
  const flags = new Set<string>();
  let command: string | undefined;
  let filePath: string | undefined;
  let packagePath: string | undefined;
  let outDir: string | undefined;
  let template: string | undefined;
  let overwrite = false;
  let strictContrast = false;
  let json = false;
  let help = false;
  let version = false;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      help = true;
      i++;
      continue;
    }

    if (arg === "--version" || arg === "-v") {
      version = true;
      i++;
      continue;
    }

    if (arg === "--overwrite") {
      if (flags.has("--overwrite")) {
        return { error: "Duplicate option: --overwrite" };
      }
      flags.add("--overwrite");
      overwrite = true;
      i++;
      continue;
    }

    if (arg === "--strict-contrast") {
      if (flags.has("--strict-contrast")) {
        return { error: "Duplicate option: --strict-contrast" };
      }
      flags.add("--strict-contrast");
      strictContrast = true;
      i++;
      continue;
    }

    if (arg === "--json") {
      if (flags.has("--json")) {
        return { error: "Duplicate option: --json" };
      }
      flags.add("--json");
      json = true;
      i++;
      continue;
    }

    if (arg === "--out") {
      if (flags.has("--out")) {
        return { error: "Duplicate option: --out" };
      }
      flags.add("--out");
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        return { error: "Missing value for option: --out <dir>" };
      }
      outDir = args[i + 1];
      i += 2;
      continue;
    }

    if (arg === "--package") {
      if (flags.has("--package")) {
        return { error: "Duplicate option: --package" };
      }
      flags.add("--package");
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        return { error: "Missing value for option: --package <file>" };
      }
      packagePath = args[i + 1];
      i += 2;
      continue;
    }

    if (arg === "--template") {
      if (flags.has("--template")) {
        return { error: "Duplicate option: --template" };
      }
      flags.add("--template");
      if (i + 1 >= args.length || args[i + 1].startsWith("-")) {
        return { error: "Missing value for option: --template <id>" };
      }
      template = args[i + 1];
      i += 2;
      continue;
    }

    if (arg.startsWith("-")) {
      return { error: `Unknown option: '${arg}'` };
    }

    // Positional operand
    if (!command) {
      command = arg;
    } else if (!filePath) {
      filePath = arg;
    } else {
      return { error: `Unexpected surplus operand: '${arg}'` };
    }
    i++;
  }

  return {
    parsed: {
      command,
      filePath,
      packagePath,
      outDir,
      template,
      overwrite,
      strictContrast,
      json,
      help,
      version,
    },
  };
}

async function isSameFsEntity(pathA: string, pathB: string): Promise<boolean> {
  try {
    const [realA, realB] = await Promise.all([realpath(pathA), realpath(pathB)]);
    if (realA === realB) return true;
  } catch {
    // Continue to stat check
  }

  try {
    const [statA, statB] = await Promise.all([stat(pathA), stat(pathB)]);
    return statA.dev === statB.dev && statA.ino === statB.ino;
  } catch {
    return false;
  }
}

export async function runCli(argv: string[]): Promise<number> {
  const rawArgs = argv.slice(2);

  if (rawArgs.length === 0) {
    process.stdout.write(CLI_HELP);
    return 0;
  }

  if (rawArgs[0] === "exchange") {
    return runExchangeCli(rawArgs.slice(1));
  }

  const { parsed, error: parseError } = parseArguments(rawArgs);

  if (parseError) {
    const isJson = rawArgs.includes("--json");
    if (isJson) {
      process.stdout.write(
        JSON.stringify(
          {
            status: "error",
            code: "INVALID_ARGUMENTS",
            message: parseError,
          },
          null,
          2
        ) + "\n"
      );
    } else {
      process.stderr.write(`Error: ${parseError}\nRun 'tfsl --help' for usage.\n`);
    }
    return 2;
  }

  if (!parsed) {
    return 2;
  }

  if (parsed.help) {
    process.stdout.write(CLI_HELP);
    return 0;
  }

  if (parsed.version) {
    process.stdout.write(`${COMPILER_PACKAGE} ${COMPILER_VERSION}\n`);
    return 0;
  }

  const { command, filePath, outDir, overwrite, strictContrast, json } = parsed;

  if (command !== "validate" && command !== "compile" && command !== "generate") {
    if (json) {
      process.stdout.write(
        JSON.stringify(
          {
            status: "error",
            code: "UNKNOWN_COMMAND",
            message: `Unknown command: '${command ?? ""}'`,
          },
          null,
          2
        ) + "\n"
      );
    } else {
      process.stderr.write(`Error: Unknown command '${command ?? ""}'. Run 'tfsl --help' for usage.\n`);
    }
    return 2;
  }

  if (!filePath) {
    const msg = `Missing file path operand for '${command}' command.`;
    if (json) {
      process.stdout.write(
        JSON.stringify(
          {
            status: "error",
            code: "MISSING_OPERAND",
            message: msg,
          },
          null,
          2
        ) + "\n"
      );
    } else {
      process.stderr.write(`Error: ${msg}\n`);
    }
    return 2;
  }

  if (command === "validate") {
    try {
      const absPath = resolve(process.cwd(), filePath);
      const content = await readFile(absPath, "utf8");
      const parsedJson = JSON.parse(content);

      const spec = validateThemeSpecification(parsedJson);
      const { inputDigest } = canonicalizeSpecification(spec);
      const diagnostics = analyzeThemeContrast(spec);
      const warnings = diagnostics.filter((d) => d.disposition === "warn");

      if (strictContrast && warnings.length > 0) {
        throw new ContrastError(
          `Theme contrast check failed with ${warnings.length} warning(s) under --strict-contrast`,
          warnings
        );
      }

      if (json) {
        process.stdout.write(
          JSON.stringify(
            {
              status: "success",
              command: "validate",
              theme: spec.name,
              version: spec.version,
              inputDigest,
              diagnostics,
            },
            null,
            2
          ) + "\n"
        );
      } else {
        process.stdout.write(
          `OK: theme '${spec.name}' v${spec.version} is valid (input digest: ${inputDigest})\n`
        );
        for (const d of diagnostics) {
          if (d.severity === "warning") {
            process.stderr.write(`Warning [${d.code}]: ${d.message}\n`);
          }
        }
      }
      return 0;
    } catch (err: any) {
      const isContrast = err instanceof ContrastError;
      const isValidation = err instanceof ValidationError;
      const code = err.code ?? (isContrast ? "CONTRAST_THRESHOLD_FAILED" : "VALIDATION_FAILED");

      if (json) {
        process.stdout.write(
          JSON.stringify(
            {
              status: "error",
              command: "validate",
              code,
              message: err.message,
              ...(isValidation && err.fieldPath ? { fieldPath: err.fieldPath } : {}),
              ...(isContrast ? { diagnostics: err.diagnostics } : {}),
            },
            null,
            2
          ) + "\n"
        );
      } else {
        if (isContrast) {
          process.stderr.write(`Contrast check failed (--strict-contrast enabled): ${err.message}\n`);
          for (const d of err.diagnostics) {
            process.stderr.write(`  - ${d.message}\n`);
          }
        } else {
          process.stderr.write(`Validation failed: ${err.message}\n`);
        }
      }
      return 1;
    }
  }

  if (command === "generate") {
    if (parsed.overwrite) {
      const msg = "--overwrite is not supported for generate. Theme packages must be written to an empty or absent directory.";
      if (json) {
        process.stdout.write(
          JSON.stringify(
            {
              status: "error",
              command: "generate",
              code: "INVALID_ARGUMENTS",
              message: msg,
            },
            null,
            2
          ) + "\n"
        );
      } else {
        process.stderr.write(`Error: ${msg}\n`);
      }
      return 2;
    }

    if (!parsed.packagePath) {
      const msg = "Missing required argument '--package <file>'.";
      if (json) {
        process.stdout.write(
          JSON.stringify(
            {
              status: "error",
              command: "generate",
              code: "MISSING_REQUIRED_OPTION",
              message: msg,
            },
            null,
            2
          ) + "\n"
        );
      } else {
        process.stderr.write(`Error: ${msg}\n`);
      }
      return 2;
    }

    if (!outDir) {
      const msg = "Missing required argument '--out <dir>'.";
      if (json) {
        process.stdout.write(
          JSON.stringify(
            {
              status: "error",
              command: "generate",
              code: "MISSING_REQUIRED_OPTION",
              message: msg,
            },
            null,
            2
          ) + "\n"
        );
      } else {
        process.stderr.write(`Error: ${msg}\n`);
      }
      return 2;
    }

    // Read and parse theme and metadata in memory first
    let themeSpec: unknown;
    let metadataObj: unknown;
    let absInputPath: string;
    let absPackagePath: string;

    try {
      absInputPath = resolve(process.cwd(), filePath);
      const themeContent = await readFile(absInputPath, "utf8");
      themeSpec = JSON.parse(themeContent);
    } catch (err: any) {
      const msg = `Failed to read theme specification: ${err.message}`;
      if (json) {
        process.stdout.write(
          JSON.stringify(
            {
              status: "error",
              command: "generate",
              code: "THEME_READ_ERROR",
              message: msg,
            },
            null,
            2
          ) + "\n"
        );
      } else {
        process.stderr.write(`Error: ${msg}\n`);
      }
      return 1;
    }

    try {
      absPackagePath = resolve(process.cwd(), parsed.packagePath);
      const packageContent = await readFile(absPackagePath, "utf8");
      metadataObj = JSON.parse(packageContent);
    } catch (err: any) {
      const msg = `Failed to read package metadata: ${err.message}`;
      if (json) {
        process.stdout.write(
          JSON.stringify(
            {
              status: "error",
              command: "generate",
              code: "PACKAGE_METADATA_READ_ERROR",
              message: msg,
            },
            null,
            2
          ) + "\n"
        );
      } else {
        process.stderr.write(`Error: ${msg}\n`);
      }
      return 1;
    }

    // Check input / output path collision
    const absOutDir = resolve(process.cwd(), outDir);
    if (
      absInputPath === absOutDir ||
      absPackagePath === absOutDir ||
      (await isSameFsEntity(absInputPath, absOutDir)) ||
      (await isSameFsEntity(absPackagePath, absOutDir))
    ) {
      const msg = "Refusing to overwrite input files as output destination.";
      if (json) {
        process.stdout.write(
          JSON.stringify(
            {
              status: "error",
              command: "generate",
              code: "INPUT_OUTPUT_COLLISION",
              message: msg,
            },
            null,
            2
          ) + "\n"
        );
      } else {
        process.stderr.write(`Error: ${msg}\n`);
      }
      return 3;
    }

    // Pure in-memory generation
    let generatedPackage;
    try {
      generatedPackage = generateThemePackage({
        themeSpec,
        metadata: metadataObj,
        template: parsed.template,
        strictContrast,
      });
    } catch (err: any) {
      const isContrast = err instanceof ContrastError;
      const isValidation = err instanceof ValidationError;
      const code = err.code ?? (isContrast ? "CONTRAST_THRESHOLD_FAILED" : "GENERATION_FAILED");

      if (json) {
        process.stdout.write(
          JSON.stringify(
            {
              status: "error",
              command: "generate",
              code,
              message: err.message,
              ...(isValidation && err.fieldPath ? { fieldPath: err.fieldPath } : {}),
              ...(isContrast ? { diagnostics: err.diagnostics } : {}),
            },
            null,
            2
          ) + "\n"
        );
      } else {
        if (isContrast) {
          process.stderr.write(`Contrast check failed (--strict-contrast enabled): ${err.message}\n`);
          for (const d of err.diagnostics) {
            process.stderr.write(`  - ${d.message}\n`);
          }
        } else {
          process.stderr.write(`Generation failed: ${err.message}\n`);
        }
      }
      return 1;
    }

    // Write to disk
    let writeResult;
    try {
      writeResult = await writeThemePackage(generatedPackage, absOutDir);
    } catch (err: any) {
      const isFsSafety = err instanceof FilesystemSafetyError;
      const code = err.code ?? "FILESYSTEM_SAFETY_ERROR";

      if (json) {
        process.stdout.write(
          JSON.stringify(
            {
              status: "error",
              command: "generate",
              code,
              message: err.message,
            },
            null,
            2
          ) + "\n"
        );
      } else {
        process.stderr.write(`Filesystem safety error: ${err.message}\n`);
      }
      return 3;
    }

    if (json) {
      process.stdout.write(
        JSON.stringify(
          {
            status: "success",
            command: "generate",
            packageName: generatedPackage.metadata.name,
            packageVersion: generatedPackage.metadata.version,
            themeName: generatedPackage.themeSpec.name,
            themeVersion: generatedPackage.themeSpec.version,
            outDir: absOutDir,
            template: generatedPackage.metadata.template ?? null,
            filesWritten: writeResult.filesWritten,
            filesPruned: writeResult.filesPruned,
            provenance: generatedPackage.provenance,
            diagnostics: generatedPackage.diagnostics,
          },
          null,
          2
        ) + "\n"
      );
    } else {
      process.stdout.write(
        `Generated package '${generatedPackage.metadata.name}' v${generatedPackage.metadata.version} -> ${absOutDir} (${writeResult.filesWritten.length} files)\n`
      );
      for (const d of generatedPackage.diagnostics) {
        if (d.severity === "warning") {
          process.stderr.write(`Warning [${d.code}]: ${d.message}\n`);
        }
      }
    }
    return 0;
  }

  // command === "compile"
  if (!outDir) {
    const msg = "Missing required argument '--out <dir>'.";
    if (json) {
      process.stdout.write(
        JSON.stringify(
          {
            status: "error",
            code: "MISSING_REQUIRED_OPTION",
            message: msg,
          },
          null,
          2
        ) + "\n"
      );
    } else {
      process.stderr.write(`Error: ${msg}\n`);
    }
    return 2;
  }

  // Compile in-memory first before touching filesystem
  let compileResult: ReturnType<typeof compileTheme>;
  let absInputPath: string;
  try {
    absInputPath = resolve(process.cwd(), filePath);
    const content = await readFile(absInputPath, "utf8");
    const parsedJson = JSON.parse(content);
    compileResult = compileTheme(parsedJson, { strictContrast });
  } catch (err: any) {
    const isContrast = err instanceof ContrastError;
    const isValidation = err instanceof ValidationError;
    const code = err.code ?? (isContrast ? "CONTRAST_THRESHOLD_FAILED" : "COMPILATION_FAILED");

    if (json) {
      process.stdout.write(
        JSON.stringify(
          {
            status: "error",
            command: "compile",
            code,
            message: err.message,
            ...(isValidation && err.fieldPath ? { fieldPath: err.fieldPath } : {}),
            ...(isContrast ? { diagnostics: err.diagnostics } : {}),
          },
          null,
          2
        ) + "\n"
      );
    } else {
      if (isContrast) {
        process.stderr.write(`Contrast check failed (--strict-contrast enabled): ${err.message}\n`);
        for (const d of err.diagnostics) {
          process.stderr.write(`  - ${d.message}\n`);
        }
      } else {
        process.stderr.write(`Compilation failed: ${err.message}\n`);
      }
    }
    return 1;
  }

  // Filesystem output safety boundary
  const absOutDir = resolve(process.cwd(), outDir);
  const targetCssPath = join(absOutDir, "theme.css");
  const targetDescPath = join(absOutDir, "theme.descriptor.json");

  // Refuse input/output aliasing
  if (
    absInputPath === targetCssPath ||
    absInputPath === targetDescPath ||
    absInputPath === absOutDir ||
    (await isSameFsEntity(absInputPath, targetCssPath)) ||
    (await isSameFsEntity(absInputPath, targetDescPath))
  ) {
    const msg = `Refusing to overwrite input theme file '${absInputPath}' as output destination.`;
    if (json) {
      process.stdout.write(
        JSON.stringify(
          {
            status: "error",
            command: "compile",
            code: "INPUT_OUTPUT_COLLISION",
            message: msg,
          },
          null,
          2
        ) + "\n"
      );
    } else {
      process.stderr.write(`Error: ${msg}\n`);
    }
    return 3;
  }

function emitFsError(command: string, code: string, message: string, json: boolean): number {
  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          status: "error",
          command,
          code,
          message,
        },
        null,
        2
      ) + "\n"
    );
  } else {
    process.stderr.write(`Error: ${message}\n`);
  }
  return 3;
}

  // Inspect output directory and all ancestor paths for symlinks (excluding system root symlinks on macOS)
  const SYSTEM_ROOT_SYMLINKS = new Set(["/var", "/tmp", "/etc", "/home", "/run"]);
  let checkPath = absOutDir;
  while (true) {
    if (checkPath !== absOutDir && SYSTEM_ROOT_SYMLINKS.has(checkPath)) {
      const parent = dirname(checkPath);
      if (parent === checkPath) break;
      checkPath = parent;
      continue;
    }
    try {
      const st = await lstat(checkPath);
      if (st.isSymbolicLink() && !SYSTEM_ROOT_SYMLINKS.has(checkPath)) {
        const msg =
          checkPath === absOutDir
            ? `Target output directory '${absOutDir}' is a symbolic link. Symlinks are strictly refused.`
            : `Target output directory '${absOutDir}' traverses symbolic link at '${checkPath}'. Symlinks are strictly refused.`;
        return emitFsError("compile", "SYMLINK_REFUSED", msg, json);
      }
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        const msg = `Failed to inspect output path '${checkPath}': ${err.message || String(err)}`;
        return emitFsError("compile", "OUTPUT_FS_ERROR", msg, json);
      }
    }
    const parent = dirname(checkPath);
    if (parent === checkPath) {
      break;
    }
    checkPath = parent;
  }

  let dirStat: Awaited<ReturnType<typeof lstat>> | null = null;
  try {
    dirStat = await lstat(absOutDir);
  } catch (err: any) {
    if (err.code !== "ENOENT") {
      const msg = `Failed to inspect output directory '${absOutDir}': ${err.message || String(err)}`;
      return emitFsError("compile", "OUTPUT_FS_ERROR", msg, json);
    }
  }

  if (dirStat) {

    if (!dirStat.isDirectory()) {
      const msg = `Target path '${absOutDir}' exists and is not a directory.`;
      return emitFsError("compile", "NOT_A_DIRECTORY", msg, json);
    }

    let entries: string[];
    try {
      entries = await readdir(absOutDir);
    } catch (err: any) {
      const msg = `Failed to read output directory '${absOutDir}': ${err.message || String(err)}`;
      return emitFsError("compile", "OUTPUT_FS_ERROR", msg, json);
    }

    if (entries.length > 0 && !overwrite) {
      const msg = `Refusing to write into non-empty directory '${absOutDir}' without --overwrite.`;
      return emitFsError("compile", "DIRECTORY_NOT_EMPTY", msg, json);
    }

    if (entries.length > 0 && overwrite) {
      // Check target files safety
      let cssStat: Awaited<ReturnType<typeof lstat>> | null = null;
      let descStat: Awaited<ReturnType<typeof lstat>> | null = null;

      try {
        cssStat = await lstat(targetCssPath);
      } catch (err: any) {
        if (err.code !== "ENOENT") {
          const msg = `Failed to inspect target CSS file '${targetCssPath}': ${err.message || String(err)}`;
          return emitFsError("compile", "OUTPUT_FS_ERROR", msg, json);
        }
      }

      try {
        descStat = await lstat(targetDescPath);
      } catch (err: any) {
        if (err.code !== "ENOENT") {
          const msg = `Failed to inspect target descriptor file '${targetDescPath}': ${err.message || String(err)}`;
          return emitFsError("compile", "OUTPUT_FS_ERROR", msg, json);
        }
      }

      if (cssStat && cssStat.isSymbolicLink()) {
        const msg = `Target '${targetCssPath}' is a symbolic link. Refusing overwrite.`;
        if (json) {
          process.stdout.write(
            JSON.stringify(
              {
                status: "error",
                command: "compile",
                code: "SYMLINK_REFUSED",
                message: msg,
              },
              null,
              2
            ) + "\n"
          );
        } else {
          process.stderr.write(`Error: ${msg}\n`);
        }
        return 3;
      }

      if (descStat && descStat.isSymbolicLink()) {
        const msg = `Target '${targetDescPath}' is a symbolic link. Refusing overwrite.`;
        if (json) {
          process.stdout.write(
            JSON.stringify(
              {
                status: "error",
                command: "compile",
                code: "SYMLINK_REFUSED",
                message: msg,
              },
              null,
              2
            ) + "\n"
          );
        } else {
          process.stderr.write(`Error: ${msg}\n`);
        }
        return 3;
      }

      if (cssStat && !cssStat.isFile()) {
        const msg = `Target '${targetCssPath}' is not a regular file. Refusing overwrite.`;
        if (json) {
          process.stdout.write(
            JSON.stringify(
              {
                status: "error",
                command: "compile",
                code: "NON_REGULAR_FILE",
                message: msg,
              },
              null,
              2
            ) + "\n"
          );
        } else {
          process.stderr.write(`Error: ${msg}\n`);
        }
        return 3;
      }

      if (descStat && !descStat.isFile()) {
        const msg = `Target '${targetDescPath}' is not a regular file. Refusing overwrite.`;
        if (json) {
          process.stdout.write(
            JSON.stringify(
              {
                status: "error",
                command: "compile",
                code: "NON_REGULAR_FILE",
                message: msg,
              },
              null,
              2
            ) + "\n"
          );
        } else {
          process.stderr.write(`Error: ${msg}\n`);
        }
        return 3;
      }

      // If theme.css exists, descriptor must exist and match its digest
      if (cssStat && !descStat) {
        const msg = `Existing '${targetCssPath}' has no accompanying descriptor. Refusing to overwrite unmanaged file.`;
        if (json) {
          process.stdout.write(
            JSON.stringify(
              {
                status: "error",
                command: "compile",
                code: "UNMANAGED_OUTPUT_TARGET",
                message: msg,
              },
              null,
              2
            ) + "\n"
          );
        } else {
          process.stderr.write(`Error: ${msg}\n`);
        }
        return 3;
      }

      if (descStat && !cssStat) {
        const msg = `Existing '${targetDescPath}' has no accompanying CSS file. Refusing to overwrite inconsistent state.`;
        if (json) {
          process.stdout.write(
            JSON.stringify(
              {
                status: "error",
                command: "compile",
                code: "INCONSISTENT_OUTPUT_STATE",
                message: msg,
              },
              null,
              2
            ) + "\n"
          );
        } else {
          process.stderr.write(`Error: ${msg}\n`);
        }
        return 3;
      }

      if (cssStat && descStat) {
        let existingDesc: any;
        try {
          const descContent = await readFile(targetDescPath, "utf8");
          existingDesc = JSON.parse(descContent);
        } catch {
          const msg = `Existing descriptor '${targetDescPath}' is corrupt or unparseable. Refusing overwrite.`;
          return emitFsError("compile", "CORRUPT_DESCRIPTOR", msg, json);
        }

        if (
          typeof existingDesc !== "object" ||
          existingDesc === null ||
          Array.isArray(existingDesc) ||
          typeof existingDesc.schema !== "string" ||
          typeof existingDesc.adapter !== "string" ||
          typeof existingDesc.outputDigest !== "string"
        ) {
          const msg = `Existing descriptor '${targetDescPath}' is corrupt or malformed. Refusing overwrite.`;
          return emitFsError("compile", "CORRUPT_DESCRIPTOR", msg, json);
        }

        if (
          existingDesc.schema !== "tfsl.theme-descriptor-v1" ||
          existingDesc.adapter !== compileResult.descriptor.adapter
        ) {
          const msg = `Existing descriptor belongs to schema '${existingDesc.schema}' / adapter '${existingDesc.adapter}'. Refusing overwrite.`;
          if (json) {
            process.stdout.write(
              JSON.stringify(
                {
                  status: "error",
                  command: "compile",
                  code: "FOREIGN_DESCRIPTOR",
                  message: msg,
                },
                null,
                2
              ) + "\n"
            );
          } else {
            process.stderr.write(`Error: ${msg}\n`);
          }
          return 3;
        }

        // Verify that existing theme.css has not been manually modified
        let existingCss: string;
        try {
          existingCss = await readFile(targetCssPath, "utf8");
        } catch (err: any) {
          const msg = `Failed to read existing CSS file '${targetCssPath}': ${err.message || String(err)}`;
          return emitFsError("compile", "OUTPUT_FS_ERROR", msg, json);
        }
        const existingCssDigest = computeSha256(existingCss);
        if (existingCssDigest !== existingDesc.outputDigest) {
          const msg = `Refusing to overwrite manually edited theme.css in '${absOutDir}' (content digest ${existingCssDigest} does not match descriptor ${existingDesc.outputDigest}).`;
          if (json) {
            process.stdout.write(
              JSON.stringify(
                {
                  status: "error",
                  command: "compile",
                  code: "MANUAL_EDITS_DETECTED",
                  message: msg,
                },
                null,
                2
              ) + "\n"
            );
          } else {
            process.stderr.write(`Error: ${msg}\n`);
          }
          return 3;
        }
      }
    }
  } else {
    try {
      await mkdir(absOutDir, { recursive: true });
    } catch (err: any) {
      const msg = `Failed to create output directory '${absOutDir}': ${err.message || String(err)}`;
      return emitFsError("compile", "OUTPUT_FS_ERROR", msg, json);
    }
  }

  // Staged write with unguessable temp names and honest error reporting
  const randTag = randomBytes(8).toString("hex");
  const tempCssPath = join(absOutDir, `.tfsl-tmp-css-${randTag}`);
  const tempDescPath = join(absOutDir, `.tfsl-tmp-desc-${randTag}`);

  try {
    await writeFile(tempCssPath, compileResult.css, "utf8");
    await writeFile(
      tempDescPath,
      JSON.stringify(compileResult.descriptor, null, 2) + "\n",
      "utf8"
    );
  } catch (err: any) {
    try { await unlink(tempCssPath); } catch {}
    try { await unlink(tempDescPath); } catch {}
    const msg = `Failed to stage temporary compiler outputs: ${err.message}`;
    if (json) {
      process.stdout.write(
        JSON.stringify(
          {
            status: "error",
            command: "compile",
            code: "IO_STAGE_FAILURE",
            message: msg,
          },
          null,
          2
        ) + "\n"
      );
    } else {
      process.stderr.write(`Error: ${msg}\n`);
    }
    return 3;
  }

  // Rename staging files to targets
  let cssRenamed = false;
  try {
    await rename(tempCssPath, targetCssPath);
    cssRenamed = true;
    await rename(tempDescPath, targetDescPath);
  } catch (err: any) {
    try { await unlink(tempCssPath); } catch {}
    try { await unlink(tempDescPath); } catch {}

    const msg = cssRenamed
      ? `Partial write failure: theme.css was updated but theme.descriptor.json failed to rename: ${err.message}`
      : `Failed to rename staged files to destination: ${err.message}`;

    if (json) {
      process.stdout.write(
        JSON.stringify(
          {
            status: "error",
            command: "compile",
            code: "PARTIAL_IO_FAILURE",
            message: msg,
          },
          null,
          2
        ) + "\n"
      );
    } else {
      process.stderr.write(`Error: ${msg}\n`);
    }
    return 3;
  }

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          status: "success",
          command: "compile",
          theme: compileResult.specification.name,
          version: compileResult.specification.version,
          cssPath: targetCssPath,
          descriptorPath: targetDescPath,
          inputDigest: compileResult.inputDigest,
          outputDigest: compileResult.outputDigest,
          diagnostics: compileResult.diagnostics,
        },
        null,
        2
      ) + "\n"
    );
  } else {
    process.stdout.write(
      `Compiled '${compileResult.specification.name}' v${compileResult.specification.version} -> ${targetCssPath} (CSS digest: ${compileResult.outputDigest})\n`
    );
    for (const d of compileResult.diagnostics) {
      if (d.severity === "warning") {
        process.stderr.write(`Warning [${d.code}]: ${d.message}\n`);
      }
    }
  }

  return 0;
}

async function writeAbsentPacket(filePath: string, canonicalString: string): Promise<string> {
  const absPath = resolve(process.cwd(), filePath);
  try {
    const existing = await stat(absPath);
    if (existing) {
      throw new FilesystemSafetyError(
        `Target packet file '${absPath}' already exists; exchange packets are immutable and cannot overwrite existing files.`
      );
    }
  } catch (err: any) {
    if (err instanceof FilesystemSafetyError) throw err;
    // Expected ENOENT
  }
  await mkdir(dirname(absPath), { recursive: true });
  try {
    await writeFile(absPath, canonicalString, { flag: "wx", encoding: "utf8" });
  } catch (err: any) {
    if (err.code === "EEXIST") {
      throw new FilesystemSafetyError(
        `Target packet file '${absPath}' already exists; exchange packets are immutable and cannot overwrite existing files.`
      );
    }
    throw err;
  }
  return absPath;
}

export function getPacketDigest(packet: ThemeExchangePacket): string {
  if (packet.schema === "tfsl.theme-brief") return packet.briefDigest;
  if (packet.schema === "tfsl.theme-candidate") return packet.candidateDigest;
  if (packet.schema === "tfsl.theme-review") return packet.reviewDigest;
  return "unknown";
}

export function getPacketPublicId(packet: ThemeExchangePacket): string {
  if (packet.schema === "tfsl.theme-brief") return packet.briefId;
  if (packet.schema === "tfsl.theme-candidate") return packet.candidateId;
  if (packet.schema === "tfsl.theme-review") return packet.reviewId;
  return "unknown";
}

export async function runExchangeCli(args: string[]): Promise<number> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    process.stdout.write(EXCHANGE_HELP);
    return 0;
  }

  const isJson = args.includes("--json");

  if (args.includes("--overwrite")) {
    const msg = "--overwrite is not permitted for exchange packets; packets are immutable and cannot overwrite existing files.";
    if (isJson) {
      process.stdout.write(
        JSON.stringify({ status: "error", code: "OVERWRITE_FORBIDDEN", message: msg }, null, 2) + "\n"
      );
    } else {
      process.stderr.write(`Error: ${msg}\n`);
    }
    return 2;
  }

  const subcommand = args[0];
  const subArgs = args.slice(1);

  if (subcommand === "brief") {
    return runExchangeBrief(subArgs, isJson);
  } else if (subcommand === "candidate") {
    return runExchangeCandidate(subArgs, isJson);
  } else if (subcommand === "review") {
    return runExchangeReview(subArgs, isJson);
  } else if (subcommand === "validate") {
    return runExchangeValidate(subArgs, isJson);
  } else if (subcommand === "inspect") {
    return runExchangeInspect(subArgs, isJson);
  } else {
    const msg = `Unknown exchange subcommand: '${subcommand}'. Run 'tfsl exchange --help' for usage.`;
    if (isJson) {
      process.stdout.write(
        JSON.stringify({ status: "error", code: "UNKNOWN_SUBCOMMAND", message: msg }, null, 2) + "\n"
      );
    } else {
      process.stderr.write(`Error: ${msg}\n`);
    }
    return 2;
  }
}

async function runExchangeBrief(subArgs: string[], isJson: boolean): Promise<number> {
  let name: string | undefined;
  let themePath: string | undefined;
  let outPath: string | undefined;
  let title: string | undefined;
  let goal: string | undefined;
  let intent: string | undefined;
  let author: string | undefined;
  let allowedFields: string | undefined;
  let allowedModes: string | undefined;
  let approvedTemplates: string | undefined;
  let acceptanceCriteria: string | undefined;
  let prohibitedChanges: string | undefined;
  const visualPaths: string[] = [];

  let i = 0;
  while (i < subArgs.length) {
    const arg = subArgs[i];
    if (arg === "--json") {
      i++;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(EXCHANGE_HELP);
      return 0;
    }
    if (arg === "--name" || arg === "--brief-id") {
      if (i + 1 >= subArgs.length || subArgs[i + 1].startsWith("-")) {
        const msg = "Missing value for option: --name <id>";
        if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "INVALID_ARGUMENTS", message: msg }, null, 2) + "\n");
        else process.stderr.write(`Error: ${msg}\n`);
        return 2;
      }
      name = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--theme" || arg === "--baseline") {
      if (i + 1 >= subArgs.length || subArgs[i + 1].startsWith("-")) {
        const msg = "Missing value for option: --theme <file>";
        if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "INVALID_ARGUMENTS", message: msg }, null, 2) + "\n");
        else process.stderr.write(`Error: ${msg}\n`);
        return 2;
      }
      themePath = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--out") {
      if (i + 1 >= subArgs.length || subArgs[i + 1].startsWith("-")) {
        const msg = "Missing value for option: --out <file>";
        if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "INVALID_ARGUMENTS", message: msg }, null, 2) + "\n");
        else process.stderr.write(`Error: ${msg}\n`);
        return 2;
      }
      outPath = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--title") {
      title = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--goal") {
      goal = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--intent") {
      intent = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--author") {
      author = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--allowed-fields") {
      allowedFields = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--allowed-modes") {
      allowedModes = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--approved-templates") {
      approvedTemplates = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--acceptance-criteria") {
      acceptanceCriteria = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--prohibited-changes") {
      prohibitedChanges = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--visual") {
      if (i + 1 >= subArgs.length || subArgs[i + 1].startsWith("-")) {
        const msg = "Missing value for option: --visual <file>";
        if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "INVALID_ARGUMENTS", message: msg }, null, 2) + "\n");
        else process.stderr.write(`Error: ${msg}\n`);
        return 2;
      }
      visualPaths.push(subArgs[i + 1]);
      i += 2;
      continue;
    }
    if (arg.startsWith("-")) {
      const msg = `Unknown option: '${arg}'`;
      if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "INVALID_ARGUMENTS", message: msg }, null, 2) + "\n");
      else process.stderr.write(`Error: ${msg}\n`);
      return 2;
    }
    const msg = `Unexpected operand: '${arg}'`;
    if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "INVALID_ARGUMENTS", message: msg }, null, 2) + "\n");
    else process.stderr.write(`Error: ${msg}\n`);
    return 2;
  }

  if (!name || !themePath || !outPath) {
    const msg = "Missing required options: --name <id>, --theme <baseline-theme.json>, and --out <file> must be specified.";
    if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "MISSING_OPERAND", message: msg }, null, 2) + "\n");
    else process.stderr.write(`Error: ${msg}\n`);
    return 2;
  }

  try {
    const themeRaw = await readFile(resolve(process.cwd(), themePath), "utf8");
    const baselineSpec = JSON.parse(themeRaw);

    const visualEvidence: ThemeVisualRecord[] = [];
    for (const vPath of visualPaths) {
      const vAbs = resolve(process.cwd(), vPath);
      const buf = await readFile(vAbs);
      const res = validatePngBuffer(buf);
      const rec: any = {
        schema: "tfsl.theme-visual-evidence",
        schemaVersion: 1,
        presence: "included",
        pngDigest: res.pngDigest,
        bytesBase64: buf.toString("base64"),
        byteCount: res.byteCount,
        width: res.width,
        height: res.height,
      };
      rec.evidenceDigest = computeVisualEvidenceDigest(rec);
      visualEvidence.push(rec);
    }

    const packet = createThemeBrief({
      briefId: name,
      title: title ?? name,
      goal: goal ?? intent ?? "Starlight theme brief",
      baselineTheme: baselineSpec,
      allowedFields: allowedFields
        ? allowedFields.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined,
      allowedModes: allowedModes === "both" ? ["dark", "light"] : allowedModes ? [allowedModes as any] : undefined,
      approvedTemplates: approvedTemplates
        ? approvedTemplates.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined,
      acceptanceCriteria: acceptanceCriteria
        ? acceptanceCriteria.split(";").map((s) => s.trim()).filter(Boolean)
        : undefined,
      prohibitedChanges: prohibitedChanges
        ? prohibitedChanges.split(";").map((s) => s.trim()).filter(Boolean)
        : undefined,
      visualEvidence: visualEvidence.length > 0 ? visualEvidence : undefined,
      metadata: author ? { author, timestamp: new Date().toISOString() } : undefined,
    });

    const serialized = serializeThemeExchangePacket(packet);
    const absOut = await writeAbsentPacket(outPath, serialized);

    if (isJson) {
      process.stdout.write(
        JSON.stringify(
          {
            status: "success",
            command: "exchange brief",
            schema: packet.schema,
            briefId: packet.briefId,
            digest: packet.briefDigest,
            outPath: absOut,
          },
          null,
          2
        ) + "\n"
      );
    } else {
      process.stdout.write(
        `Created theme brief '${packet.briefId}' -> ${outPath} (digest: ${packet.briefDigest})\n`
      );
    }
    return 0;
  } catch (err: any) {
    if (err instanceof FilesystemSafetyError) {
      const msg = err.message;
      if (isJson) {
        process.stdout.write(
          JSON.stringify({ status: "error", command: "exchange brief", code: "FILESYSTEM_SAFETY_ERROR", message: msg }, null, 2) + "\n"
        );
      } else {
        process.stderr.write(`Error [FILESYSTEM_SAFETY_ERROR]: ${msg}\n`);
      }
      return 3;
    }
    const code = err.code ?? "BRIEF_CREATION_FAILED";
    const msg = err.message ?? String(err);
    if (isJson) {
      process.stdout.write(
        JSON.stringify({ status: "error", command: "exchange brief", code, message: msg }, null, 2) + "\n"
      );
    } else {
      process.stderr.write(`Error [${code}]: ${msg}\n`);
    }
    return 1;
  }
}

async function runExchangeCandidate(subArgs: string[], isJson: boolean): Promise<number> {
  let briefPath: string | undefined;
  let themePath: string | undefined;
  let outPath: string | undefined;
  let name: string | undefined;
  let label: string | undefined;
  let rationale: string | undefined;
  let description: string | undefined;
  let proposer: string | undefined;
  let notes: string | undefined;
  const visualPaths: string[] = [];

  let i = 0;
  while (i < subArgs.length) {
    const arg = subArgs[i];
    if (arg === "--json") {
      i++;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(EXCHANGE_HELP);
      return 0;
    }
    if (arg === "--brief") {
      if (i + 1 >= subArgs.length || subArgs[i + 1].startsWith("-")) {
        const msg = "Missing value for option: --brief <file>";
        if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "INVALID_ARGUMENTS", message: msg }, null, 2) + "\n");
        else process.stderr.write(`Error: ${msg}\n`);
        return 2;
      }
      briefPath = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--theme") {
      if (i + 1 >= subArgs.length || subArgs[i + 1].startsWith("-")) {
        const msg = "Missing value for option: --theme <file>";
        if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "INVALID_ARGUMENTS", message: msg }, null, 2) + "\n");
        else process.stderr.write(`Error: ${msg}\n`);
        return 2;
      }
      themePath = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--out") {
      if (i + 1 >= subArgs.length || subArgs[i + 1].startsWith("-")) {
        const msg = "Missing value for option: --out <file>";
        if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "INVALID_ARGUMENTS", message: msg }, null, 2) + "\n");
        else process.stderr.write(`Error: ${msg}\n`);
        return 2;
      }
      outPath = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--name" || arg === "--candidate-id") {
      name = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--label") {
      label = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--rationale") {
      rationale = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--description") {
      description = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--proposer" || arg === "--author") {
      proposer = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--notes") {
      notes = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--visual") {
      if (i + 1 >= subArgs.length || subArgs[i + 1].startsWith("-")) {
        const msg = "Missing value for option: --visual <file>";
        if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "INVALID_ARGUMENTS", message: msg }, null, 2) + "\n");
        else process.stderr.write(`Error: ${msg}\n`);
        return 2;
      }
      visualPaths.push(subArgs[i + 1]);
      i += 2;
      continue;
    }
    if (arg.startsWith("-")) {
      const msg = `Unknown option: '${arg}'`;
      if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "INVALID_ARGUMENTS", message: msg }, null, 2) + "\n");
      else process.stderr.write(`Error: ${msg}\n`);
      return 2;
    }
    const msg = `Unexpected operand: '${arg}'`;
    if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "INVALID_ARGUMENTS", message: msg }, null, 2) + "\n");
    else process.stderr.write(`Error: ${msg}\n`);
    return 2;
  }

  if (!briefPath || !themePath || !outPath) {
    const msg = "Missing required options: --brief, --theme, and --out must be specified.";
    if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "MISSING_OPERAND", message: msg }, null, 2) + "\n");
    else process.stderr.write(`Error: ${msg}\n`);
    return 2;
  }

  try {
    const briefRaw = await readFile(resolve(process.cwd(), briefPath), "utf8");
    const briefPacket = parseThemeExchangePacket(briefRaw) as ThemeBriefPacket;
    if (briefPacket.schema !== "tfsl.theme-brief") {
      throw new ThemeExchangeValidationError(
        `Expected brief schema 'tfsl.theme-brief', got '${briefPacket.schema}'`,
        "INVALID_BRIEF_SCHEMA"
      );
    }

    const themeRaw = await readFile(resolve(process.cwd(), themePath), "utf8");
    const themeSpec = JSON.parse(themeRaw);

    const visualEvidence: ThemeVisualRecord[] = [];
    for (const vPath of visualPaths) {
      const vAbs = resolve(process.cwd(), vPath);
      const buf = await readFile(vAbs);
      const res = validatePngBuffer(buf);
      const rec: any = {
        schema: "tfsl.theme-visual-evidence",
        schemaVersion: 1,
        presence: "included",
        pngDigest: res.pngDigest,
        bytesBase64: buf.toString("base64"),
        byteCount: res.byteCount,
        width: res.width,
        height: res.height,
      };
      rec.evidenceDigest = computeVisualEvidenceDigest(rec);
      visualEvidence.push(rec);
    }

    const candidateId =
      name ??
      ((label ? label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") : "") ||
        "candidate-1");
    const candidateRationale = rationale ?? notes ?? description ?? "Proposed candidate theme";

    const packet = createThemeCandidate({
      candidateId,
      brief: briefPacket,
      theme: themeSpec,
      rationale: candidateRationale,
      claimedProvenance: proposer ? { author: proposer, timestamp: new Date().toISOString() } : undefined,
      visualEvidence: visualEvidence.length > 0 ? visualEvidence : undefined,
    });

    const serialized = serializeThemeExchangePacket(packet);
    const absOut = await writeAbsentPacket(outPath, serialized);

    if (isJson) {
      process.stdout.write(
        JSON.stringify(
          {
            status: "success",
            command: "exchange candidate",
            schema: packet.schema,
            candidateId: packet.candidateId,
            digest: packet.candidateDigest,
            themeDigest: packet.themeDigest,
            outPath: absOut,
          },
          null,
          2
        ) + "\n"
      );
    } else {
      process.stdout.write(
        `Created theme candidate '${packet.candidateId}' -> ${outPath} (digest: ${packet.candidateDigest}, theme digest: ${packet.themeDigest})\n`
      );
    }
    return 0;
  } catch (err: any) {
    if (err instanceof FilesystemSafetyError) {
      const msg = err.message;
      if (isJson) {
        process.stdout.write(
          JSON.stringify({ status: "error", command: "exchange candidate", code: "FILESYSTEM_SAFETY_ERROR", message: msg }, null, 2) + "\n"
        );
      } else {
        process.stderr.write(`Error [FILESYSTEM_SAFETY_ERROR]: ${msg}\n`);
      }
      return 3;
    }
    const code = err.code ?? "CANDIDATE_CREATION_FAILED";
    const msg = err.message ?? String(err);
    if (isJson) {
      process.stdout.write(
        JSON.stringify({ status: "error", command: "exchange candidate", code, message: msg }, null, 2) + "\n"
      );
    } else {
      process.stderr.write(`Error [${code}]: ${msg}\n`);
    }
    return 1;
  }
}

async function runExchangeReview(subArgs: string[], isJson: boolean): Promise<number> {
  let briefPath: string | undefined;
  const candidatePaths: string[] = [];
  let outPath: string | undefined;
  let name: string | undefined;
  let reviewer: string | undefined;
  let summary: string | undefined;
  let reviewDataPath: string | undefined;

  let i = 0;
  while (i < subArgs.length) {
    const arg = subArgs[i];
    if (arg === "--json") {
      i++;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(EXCHANGE_HELP);
      return 0;
    }
    if (arg === "--brief") {
      if (i + 1 >= subArgs.length || subArgs[i + 1].startsWith("-")) {
        const msg = "Missing value for option: --brief <file>";
        if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "INVALID_ARGUMENTS", message: msg }, null, 2) + "\n");
        else process.stderr.write(`Error: ${msg}\n`);
        return 2;
      }
      briefPath = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--candidate") {
      if (i + 1 >= subArgs.length || subArgs[i + 1].startsWith("-")) {
        const msg = "Missing value for option: --candidate <file>";
        if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "INVALID_ARGUMENTS", message: msg }, null, 2) + "\n");
        else process.stderr.write(`Error: ${msg}\n`);
        return 2;
      }
      candidatePaths.push(subArgs[i + 1]);
      i += 2;
      continue;
    }
    if (arg === "--out") {
      if (i + 1 >= subArgs.length || subArgs[i + 1].startsWith("-")) {
        const msg = "Missing value for option: --out <file>";
        if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "INVALID_ARGUMENTS", message: msg }, null, 2) + "\n");
        else process.stderr.write(`Error: ${msg}\n`);
        return 2;
      }
      outPath = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--name" || arg === "--review-id") {
      name = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--reviewer" || arg === "--author") {
      reviewer = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--summary") {
      summary = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--review-data") {
      reviewDataPath = subArgs[i + 1];
      i += 2;
      continue;
    }
    if (arg.startsWith("-")) {
      const msg = `Unknown option: '${arg}'`;
      if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "INVALID_ARGUMENTS", message: msg }, null, 2) + "\n");
      else process.stderr.write(`Error: ${msg}\n`);
      return 2;
    }
    const msg = `Unexpected operand: '${arg}'`;
    if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "INVALID_ARGUMENTS", message: msg }, null, 2) + "\n");
    else process.stderr.write(`Error: ${msg}\n`);
    return 2;
  }

  if (!briefPath || candidatePaths.length === 0 || !outPath) {
    const msg = "Missing required options: --brief, at least one --candidate, and --out must be specified.";
    if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "MISSING_OPERAND", message: msg }, null, 2) + "\n");
    else process.stderr.write(`Error: ${msg}\n`);
    return 2;
  }

  try {
    const briefRaw = await readFile(resolve(process.cwd(), briefPath), "utf8");
    const briefPacket = parseThemeExchangePacket(briefRaw) as ThemeBriefPacket;
    if (briefPacket.schema !== "tfsl.theme-brief") {
      throw new ThemeExchangeValidationError(
        `Expected brief schema 'tfsl.theme-brief', got '${briefPacket.schema}'`,
        "INVALID_BRIEF_SCHEMA"
      );
    }

    const candidatePackets: ThemeCandidatePacket[] = [];
    for (const cPath of candidatePaths) {
      const cRaw = await readFile(resolve(process.cwd(), cPath), "utf8");
      const cPacket = parseThemeExchangePacket(cRaw) as ThemeCandidatePacket;
      if (cPacket.schema !== "tfsl.theme-candidate") {
        throw new ThemeExchangeValidationError(
          `Expected candidate schema 'tfsl.theme-candidate', got '${cPacket.schema}'`,
          "INVALID_CANDIDATE_SCHEMA"
        );
      }
      candidatePackets.push(cPacket);
    }

    let candidateDigests: string[] = candidatePackets.map((c) => c.candidateDigest);
    let dispositions: { candidateDigest: string; disposition: any; comment?: string }[];
    let annotations: any[] = [];
    let overallDisposition: any = { kind: "no-decision" };

    if (reviewDataPath) {
      const rDataRaw = await readFile(resolve(process.cwd(), reviewDataPath), "utf8");
      const rData = JSON.parse(rDataRaw);
      if (Array.isArray(rData)) {
        dispositions = rData;
      } else {
        dispositions = rData.dispositions ?? [];
        if (rData.annotations) annotations = rData.annotations;
        if (rData.overallDisposition) overallDisposition = rData.overallDisposition;
        if (rData.candidateDigests) candidateDigests = rData.candidateDigests;
      }
    } else {
      dispositions = candidatePackets.map((c) => ({
        candidateDigest: c.candidateDigest,
        disposition: "deferred",
        comment: "Awaiting human review in Theme Lab.",
      }));
    }

    const packet = createThemeReview({
      reviewId: name ?? "review-1",
      brief: briefPacket,
      candidateDigests,
      dispositions,
      annotations: annotations.length > 0 ? annotations : undefined,
      overallDisposition,
      summary: summary ?? "Theme review",
    });

    const serialized = serializeThemeExchangePacket(packet);
    const absOut = await writeAbsentPacket(outPath, serialized);

    if (isJson) {
      process.stdout.write(
        JSON.stringify(
          {
            status: "success",
            command: "exchange review",
            schema: packet.schema,
            reviewId: packet.reviewId,
            digest: packet.reviewDigest,
            candidateCount: packet.candidateDigests.length,
            outPath: absOut,
          },
          null,
          2
        ) + "\n"
      );
    } else {
      process.stdout.write(
        `Created theme review with ${packet.candidateDigests.length} candidate(s) -> ${outPath} (digest: ${packet.reviewDigest})\n`
      );
    }
    return 0;
  } catch (err: any) {
    if (err instanceof FilesystemSafetyError) {
      const msg = err.message;
      if (isJson) {
        process.stdout.write(
          JSON.stringify({ status: "error", command: "exchange review", code: "FILESYSTEM_SAFETY_ERROR", message: msg }, null, 2) + "\n"
        );
      } else {
        process.stderr.write(`Error [FILESYSTEM_SAFETY_ERROR]: ${msg}\n`);
      }
      return 3;
    }
    const code = err.code ?? "REVIEW_CREATION_FAILED";
    const msg = err.message ?? String(err);
    if (isJson) {
      process.stdout.write(
        JSON.stringify({ status: "error", command: "exchange review", code, message: msg }, null, 2) + "\n"
      );
    } else {
      process.stderr.write(`Error [${code}]: ${msg}\n`);
    }
    return 1;
  }
}

async function runExchangeValidate(subArgs: string[], isJson: boolean): Promise<number> {
  let packetPath: string | undefined;
  let briefPath: string | undefined;
  const candidatePaths: string[] = [];

  for (let i = 0; i < subArgs.length; i++) {
    const arg = subArgs[i];
    if (arg === "--json") continue;
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(EXCHANGE_HELP);
      return 0;
    }
    if (arg === "--brief") {
      if (i + 1 >= subArgs.length || subArgs[i + 1].startsWith("-")) {
        const msg = "Missing value for option: --brief <file>";
        if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "INVALID_ARGUMENTS", message: msg }, null, 2) + "\n");
        else process.stderr.write(`Error: ${msg}\n`);
        return 2;
      }
      briefPath = subArgs[i + 1];
      i++;
      continue;
    }
    if (arg === "--candidate") {
      if (i + 1 >= subArgs.length || subArgs[i + 1].startsWith("-")) {
        const msg = "Missing value for option: --candidate <file>";
        if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "INVALID_ARGUMENTS", message: msg }, null, 2) + "\n");
        else process.stderr.write(`Error: ${msg}\n`);
        return 2;
      }
      candidatePaths.push(subArgs[i + 1]);
      i++;
      continue;
    }
    if (arg.startsWith("-")) {
      const msg = `Unknown option: '${arg}'`;
      if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "INVALID_ARGUMENTS", message: msg }, null, 2) + "\n");
      else process.stderr.write(`Error: ${msg}\n`);
      return 2;
    }
    if (!packetPath) {
      packetPath = arg;
    } else {
      const msg = `Unexpected surplus operand: '${arg}'`;
      if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "INVALID_ARGUMENTS", message: msg }, null, 2) + "\n");
      else process.stderr.write(`Error: ${msg}\n`);
      return 2;
    }
  }

  if (!packetPath) {
    const msg = "Missing packet file operand for 'exchange validate'.";
    if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "MISSING_OPERAND", message: msg }, null, 2) + "\n");
    else process.stderr.write(`Error: ${msg}\n`);
    return 2;
  }

  try {
    const absPath = resolve(process.cwd(), packetPath);
    const raw = await readFile(absPath, "utf8");
    if (!isCanonicalJson(raw)) {
      throw new ThemeExchangeValidationError(
        "Packet file is not formatted as canonical UTF-8-key-sorted two-space JSON with one final LF.",
        "INVALID_CANONICAL_ENCODING"
      );
    }
    const packet = parseThemeExchangePacket(raw);

    if (packet.schema === "tfsl.theme-candidate") {
      let briefObj: ThemeBriefPacket | undefined;
      if (briefPath) {
        const bRaw = await readFile(resolve(process.cwd(), briefPath), "utf8");
        const bPacket = parseThemeExchangePacket(bRaw);
        if (bPacket.schema !== "tfsl.theme-brief") {
          throw new ThemeExchangeValidationError(
            `Expected brief packet schema 'tfsl.theme-brief', got '${bPacket.schema}'`,
            "INVALID_BRIEF_SCHEMA"
          );
        }
        briefObj = bPacket;
      }
      const verifyRes = verifyThemeCandidate(packet, briefObj);
      if (!verifyRes.valid) {
        throw new ThemeExchangeValidationError(verifyRes.errors.join("; "), "CANDIDATE_VERIFICATION_FAILED");
      }
    } else if (packet.schema === "tfsl.theme-review") {
      validateThemeExchangePacket(packet);
      let briefObj: ThemeBriefPacket | undefined;
      if (briefPath) {
        const bRaw = await readFile(resolve(process.cwd(), briefPath), "utf8");
        const bPacket = parseThemeExchangePacket(bRaw);
        if (bPacket.schema !== "tfsl.theme-brief") {
          throw new ThemeExchangeValidationError("Expected brief schema", "INVALID_BRIEF_SCHEMA");
        }
        briefObj = bPacket;
      }
      if (candidatePaths.length > 0) {
        const candidatePackets: ThemeCandidatePacket[] = [];
        for (const cPath of candidatePaths) {
          const cRaw = await readFile(resolve(process.cwd(), cPath), "utf8");
          const cPacket = parseThemeExchangePacket(cRaw) as ThemeCandidatePacket;
          candidatePackets.push(cPacket);
        }
        const linkRes = validateThemeReviewLinks(packet, candidatePackets, briefObj);
        if (!linkRes.valid) {
          throw new ThemeExchangeValidationError(linkRes.errors.join("; "), "REVIEW_VALIDATION_FAILED");
        }
      }
    } else if (packet.schema === "tfsl.theme-brief") {
      validateThemeExchangePacket(packet);
    }

    const digest = getPacketDigest(packet);

    if (isJson) {
      process.stdout.write(
        JSON.stringify(
          {
            status: "success",
            command: "exchange validate",
            schema: packet.schema,
            digest,
            valid: true,
          },
          null,
          2
        ) + "\n"
      );
    } else {
      process.stdout.write(`OK: packet '${packet.schema}' is valid (digest: ${digest})\n`);
    }
    return 0;
  } catch (err: any) {
    const code = err.code ?? "VALIDATION_FAILED";
    const msg = err.message ?? String(err);
    if (isJson) {
      process.stdout.write(
        JSON.stringify(
          {
            status: "error",
            command: "exchange validate",
            code,
            message: msg,
          },
          null,
          2
        ) + "\n"
      );
    } else {
      process.stderr.write(`Error [${code}]: ${msg}\n`);
    }
    return 1;
  }
}

async function runExchangeInspect(subArgs: string[], isJson: boolean): Promise<number> {
  let packetPath: string | undefined;

  for (let i = 0; i < subArgs.length; i++) {
    const arg = subArgs[i];
    if (arg === "--json") continue;
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(EXCHANGE_HELP);
      return 0;
    }
    if (arg.startsWith("-")) {
      const msg = `Unknown option: '${arg}'`;
      if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "INVALID_ARGUMENTS", message: msg }, null, 2) + "\n");
      else process.stderr.write(`Error: ${msg}\n`);
      return 2;
    }
    if (!packetPath) {
      packetPath = arg;
    } else {
      const msg = `Unexpected surplus operand: '${arg}'`;
      if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "INVALID_ARGUMENTS", message: msg }, null, 2) + "\n");
      else process.stderr.write(`Error: ${msg}\n`);
      return 2;
    }
  }

  if (!packetPath) {
    const msg = "Missing packet file operand for 'exchange inspect'.";
    if (isJson) process.stdout.write(JSON.stringify({ status: "error", code: "MISSING_OPERAND", message: msg }, null, 2) + "\n");
    else process.stderr.write(`Error: ${msg}\n`);
    return 2;
  }

  try {
    const absPath = resolve(process.cwd(), packetPath);
    const raw = await readFile(absPath, "utf8");
    const packet = parseThemeExchangePacket(raw);
    const inspection = inspectThemeExchangePacket(packet);

    if (isJson) {
      process.stdout.write(
        JSON.stringify(
          {
            status: "success",
            command: "exchange inspect",
            inspection,
          },
          null,
          2
        ) + "\n"
      );
    } else {
      process.stdout.write(
        `Theme Exchange Packet Inspection:\n` +
          `  Kind:            ${inspection.kind}\n` +
          `  Schema:          ${inspection.schema} (v${inspection.schemaVersion})\n` +
          `  Digest:          ${inspection.digest}\n` +
          `  Public ID:       ${inspection.publicId}\n` +
          `  Valid:           ${inspection.valid}\n`
      );
      if (inspection.errors.length > 0) {
        process.stdout.write(`  Errors:          ${inspection.errors.join("; ")}\n`);
      }
      for (const [k, v] of Object.entries(inspection.summary)) {
        process.stdout.write(`  ${k}: ${JSON.stringify(v)}\n`);
      }
    }
    return 0;
  } catch (err: any) {
    const code = err.code ?? "INSPECT_FAILED";
    const msg = err.message ?? String(err);
    if (isJson) {
      process.stdout.write(
        JSON.stringify(
          {
            status: "error",
            command: "exchange inspect",
            code,
            message: msg,
          },
          null,
          2
        ) + "\n"
      );
    } else {
      process.stderr.write(`Error [${code}]: ${msg}\n`);
    }
    return 1;
  }
}
