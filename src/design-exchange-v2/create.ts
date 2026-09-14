import { createHash } from "node:crypto";
import {
  SCHEMA_THEME_CANDIDATE_V2,
  THEME_EXCHANGE_V2_SCHEMA_VERSION,
  SEMANTIC_COMPILER_V2,
  ADAPTER_V2,
  CATALOG_V2,
  CATALOG_V2_DIGEST,
} from "./constants.js";
import {
  COMPILER_PRODUCER,
  COMPILER_VERSION,
  compileThemeV2,
  validateThemeV2,
  ValidationErrorV2,
  type CompilationResultV2,
  type ThemeSpecificationV2,
  type CompileThemeV2Options,
} from "../v2/index.js";
import {
  type ThemeCandidateV2Packet,
  type CreateThemeCandidateV2Options,
  type ThemeOutputInventoryEntryV2,
  ThemeExchangeV2ValidationError,
} from "./types.js";
import {
  computePacketDigestV2,
  computeExecutableIdentityDigest,
  computeProducerPackageDigest,
  compareUtf8,
  assertNoPathsInPacket,
} from "./canonical.js";
import { validateThemeCandidateV2 } from "./validator.js";

export function createThemeCandidateV2(
  themeInput: unknown,
  options?: CreateThemeCandidateV2Options
): ThemeCandidateV2Packet {
  if (!themeInput || typeof themeInput !== "object" || Array.isArray(themeInput)) {
    throw new ThemeExchangeV2ValidationError("Expected theme object for candidate creation", "INVALID_REQUEST", "theme");
  }

  // Validate theme specification using shared v2 validator
  let theme: ThemeSpecificationV2;
  try {
    theme = validateThemeV2(themeInput);
  } catch (err) {
    if (err instanceof ValidationErrorV2) {
      throw new ThemeExchangeV2ValidationError(err.message, err.code, err.fieldPath);
    }
    throw err;
  }

  const resources = options?.fontResources ?? new Map<string, Uint8Array>();
  if (resources.size !== theme.fonts.length) throw new ThemeExchangeV2ValidationError("Missing or unselected font resources", "FONT_RESOURCES_REQUIRED");
  let total = 0;
  for (const font of theme.fonts) {
    const bytes = resources.get(font.id);
    if (!(bytes instanceof Uint8Array)) throw new ThemeExchangeV2ValidationError("Missing font resource", "FONT_RESOURCES_REQUIRED");
    total += bytes.byteLength;
    if (!bytes.byteLength || bytes.byteLength > 4194304 || total > 16777216 || createHash("sha256").update(bytes).digest("hex") !== font.sha256) throw new ThemeExchangeV2ValidationError("Font resource size or digest mismatch", "FONT_DIGEST_MISMATCH");
  }

  // Compile theme using shared v2 compiler
  const compileOptions: CompileThemeV2Options = {};
  if (options?.selectedAccent !== undefined) {
    compileOptions.accent = options.selectedAccent;
  }
  let compileResult: CompilationResultV2;
  try {
    compileResult = compileThemeV2(theme, compileOptions);
  } catch (err) {
    if (err instanceof ValidationErrorV2) {
      throw new ThemeExchangeV2ValidationError(err.message, err.code, err.fieldPath);
    }
    throw err;
  }

  // Build ordered output inventory (exact 5 styles files)
  const inventoryEntries: ThemeOutputInventoryEntryV2[] = [];
  for (const [id, content] of compileResult.styles.entries()) {
    const digest = `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
    inventoryEntries.push({ id, digest });
  }

  const candidateId = options?.candidateId ?? "candidate-1";
  const rationale = options?.rationale ?? "Theme candidate v2";

  // Producer is stamped from shared COMPILER_PRODUCER / COMPILER_VERSION and executable identity
  const producer = {
    package: COMPILER_PRODUCER,
    version: COMPILER_VERSION,
    executableDigest: computeExecutableIdentityDigest(),
    packageDigest: computeProducerPackageDigest(),
  };

  // Strip $schema for a path-free candidate packet
  const themeSpec: any = { ...compileResult.specification };
  delete themeSpec.$schema;

  const draft: any = {
    schema: SCHEMA_THEME_CANDIDATE_V2,
    schemaVersion: THEME_EXCHANGE_V2_SCHEMA_VERSION,
    candidateId,
    semanticCompiler: SEMANTIC_COMPILER_V2,
    adapter: ADAPTER_V2,
    catalog: CATALOG_V2,
    catalogDigest: CATALOG_V2_DIGEST,
    producer,
    inputDigest: `sha256:${compileResult.inputDigest}`,
    outputDigest: `sha256:${compileResult.outputDigest}`,
    outputInventory: inventoryEntries,
    state: "candidate", // state candidate only (never adopted)
    theme: themeSpec,
    rationale,
  };

  if (options?.selectedAccent !== undefined) {
    draft.selectedAccent = options.selectedAccent;
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

  const candidateDigest = computePacketDigestV2(draft);
  draft.candidateDigest = candidateDigest;

  return validateThemeCandidateV2(draft);
}
