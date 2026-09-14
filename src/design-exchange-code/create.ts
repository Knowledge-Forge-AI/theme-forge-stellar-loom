import { createHash } from "node:crypto";
import {
  SCHEMA_THEME_CANDIDATE,
  THEME_EXCHANGE_CODE_SCHEMA_VERSION,
  SEMANTIC_COMPILER_CODE,
  ADAPTER_CODE,
  CATALOG_CODE,
  CATALOG_CODE_DIGEST,
  RUNTIME_CODE_DEFAULT,
} from "./constants.js";
import {
  COMPILER_PRODUCER,
  COMPILER_VERSION,
  ValidationErrorV2,
} from "../v2/index.js";
import {
  validateThemeCode,
  type CompilationResultCode,
  type ThemeSpecificationCode,
  type CompileThemeCodeOptions,
} from "../code/index.js";
import { compileThemeCode as safeCompileThemeCode } from "../code/compiler.js";
import { validatePackageMetadata } from "../generator/metadata.js";
import type { PackageMetadata } from "../generator/types.js";
import {
  type ThemeCodeCandidatePacket,
  type CreateThemeCodeCandidateOptions,
  type ThemeCodeOutputInventoryEntry,
  ThemeExchangeCodeValidationError,
} from "./types.js";
import {
  computePacketDigestCode,
  computeSyntaxDigest,
  computeExecutableIdentityDigestCode,
  computeProducerPackageDigest,
  assertNoPathsInPacket,
  compareUtf8,
} from "./canonical.js";
import { generatePackageCode } from "./package-generator.js";
import { validateThemeCodeCandidate } from "./validator.js";

export function createThemeCodeCandidate(
  themeInput: unknown,
  options?: CreateThemeCodeCandidateOptions
): ThemeCodeCandidatePacket {
  if (!themeInput || typeof themeInput !== "object" || Array.isArray(themeInput)) {
    throw new ThemeExchangeCodeValidationError("Expected theme object for candidate creation", "INVALID_REQUEST", "theme");
  }

  // Validate theme specification using code domain validator
  let theme: ThemeSpecificationCode;
  try {
    theme = validateThemeCode(themeInput);
  } catch (err) {
    if (err instanceof ValidationErrorV2) {
      throw new ThemeExchangeCodeValidationError(err.message, err.code, err.fieldPath);
    }
    throw err;
  }

  // Validate package metadata
  let metadata: PackageMetadata;
  if (options?.metadata !== undefined) {
    try {
      metadata = validatePackageMetadata(options.metadata);
    } catch (err: any) {
      throw new ThemeExchangeCodeValidationError(err.message || String(err), "INVALID_METADATA", "metadata");
    }
  } else {
    metadata = {
      name: `starlight-theme-${theme.name}`,
      version: theme.version || "0.1.0",
      description: `${theme.name} Starlight theme`,
    };
  }

  const cleanMetadata: PackageMetadata = {
    name: metadata.name,
    version: metadata.version,
  };
  if (metadata.description !== undefined) cleanMetadata.description = metadata.description;
  if (metadata.author !== undefined) cleanMetadata.author = metadata.author;
  if (metadata.license !== undefined) cleanMetadata.license = metadata.license;
  if (metadata.template !== undefined) cleanMetadata.template = metadata.template;

  // Validate font resources
  const resources = options?.fontResources ?? new Map<string, Uint8Array>();
  if (resources.size !== theme.fonts.length) {
    throw new ThemeExchangeCodeValidationError("Missing or unselected font resources", "FONT_RESOURCES_REQUIRED");
  }
  let total = 0;
  for (const font of theme.fonts) {
    const bytes = resources.get(font.id);
    if (!(bytes instanceof Uint8Array)) {
      throw new ThemeExchangeCodeValidationError("Missing font resource", "FONT_RESOURCES_REQUIRED");
    }
    total += bytes.byteLength;
    if (
      !bytes.byteLength ||
      bytes.byteLength > 4194304 ||
      total > 16777216 ||
      createHash("sha256").update(bytes).digest("hex") !== font.sha256
    ) {
      throw new ThemeExchangeCodeValidationError("Font resource size or digest mismatch", "FONT_DIGEST_MISMATCH");
    }
  }

  // Compile theme using code domain compiler
  const activeAccent = options?.selectedAccent ?? options?.accent;
  const compileOptions: CompileThemeCodeOptions = {};
  if (activeAccent !== undefined) {
    compileOptions.accent = activeAccent;
  }
  let compileResult: CompilationResultCode;
  try {
    compileResult = safeCompileThemeCode(theme, compileOptions);
  } catch (err) {
    if (err instanceof ValidationErrorV2) {
      throw new ThemeExchangeCodeValidationError(err.message, err.code, err.fieldPath);
    }
    throw err;
  }

  // Generate full package to obtain member inventory (config/helper/theme/package)
  const packageResult = generatePackageCode({
    themeSpec: theme,
    metadata: cleanMetadata,
    accent: activeAccent,
    fontResources: options?.fontResources,
  });

  // Build ordered output inventory across entire package, including generated provenance
  const inventoryEntries: ThemeCodeOutputInventoryEntry[] = [];
  for (const [id, content] of packageResult.files.entries()) {
    const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    inventoryEntries.push({ id, digest });
  }
  inventoryEntries.sort((a, b) => compareUtf8(a.id, b.id));

  const candidateId = options?.candidateId ?? "candidate-1";
  const rationale = options?.rationale ?? "Theme code candidate v2";

  const producer = {
    package: COMPILER_PRODUCER,
    version: COMPILER_VERSION,
    executableDigest: computeExecutableIdentityDigestCode(),
    packageDigest: computeProducerPackageDigest(),
  };

  // Strip $schema for a path-free candidate packet
  const themeSpec: any = { ...compileResult.specification };
  delete themeSpec.$schema;

  const syntaxDigest = computeSyntaxDigest(theme.codePresentation.syntaxTheme);
  const runtime = options?.runtime ?? RUNTIME_CODE_DEFAULT;

  const draft: any = {
    schema: SCHEMA_THEME_CANDIDATE,
    schemaVersion: THEME_EXCHANGE_CODE_SCHEMA_VERSION,
    candidateId,
    semanticCompiler: SEMANTIC_COMPILER_CODE,
    adapter: ADAPTER_CODE,
    catalog: CATALOG_CODE,
    catalogDigest: CATALOG_CODE_DIGEST,
    producer,
    inputDigest: `sha256:${compileResult.inputDigest}`,
    themeDigest: `sha256:${compileResult.inputDigest}`,
    syntaxDigest,
    runtime,
    metadata: cleanMetadata,
    outputDigest: `sha256:${compileResult.outputDigest}`,
    outputInventory: inventoryEntries,
    state: "candidate", // state candidate only (never adopted)
    theme: themeSpec,
    rationale,
  };

  if (activeAccent !== undefined) {
    draft.selectedAccent = activeAccent;
  }
  if (options?.visualSha !== undefined) {
    draft.visualSha = options.visualSha;
  }
  if (options?.visualEvidence !== undefined) {
    draft.visualEvidence = [...options.visualEvidence];
  }
  if (options?.originV1 !== undefined) {
    draft.originV1 = { ...options.originV1 };
  }
  if (options?.claimedProvenance !== undefined) {
    draft.claimedProvenance = { ...options.claimedProvenance };
  }

  assertNoPathsInPacket(draft, "candidate");

  const candidateDigest = computePacketDigestCode(draft);
  draft.candidateDigest = candidateDigest;

  return validateThemeCodeCandidate(draft);
}
