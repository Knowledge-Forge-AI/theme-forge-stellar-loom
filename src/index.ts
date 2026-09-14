export * from "./types.js";
export {
  ValidationError,
} from "./schema/validator.js";
export {
  computeSha256,
  generateThemeDescriptor,
  COMPILER_PACKAGE,
  COMPILER_VERSION,
  analyzeThemeContrast,
  calculateContrastRatio,
  calculateRelativeLuminance,
  ContrastError,
} from "./compiler/index.js";
export { runCli, CLI_HELP } from "./cli.js";
export {
  runBatch,
  processBatchRequest,
  type BatchRequest,
  type BatchResponse,
  type BatchError,
} from "./batch.js";
export { STELLAR_CYAN_EXAMPLE, AMBER_FORGE_EXAMPLE } from "./examples.js";
export * from "./generator/index.js";
export * from "./design-exchange/index.js";

export { compileTheme, canonicalizeSpecification, canonicalizeSpecification as canonicalizeTheme, validateThemeSpecification, validateThemeSpecification as validateTheme } from "./public-api.js";
export { compileThemeV2, canonicalizeThemeV2, validateThemeV2, ValidationErrorV2, COLOR_ROLES, STYLE_FILES, COMPILER_SEMANTIC, CATALOG_IDENTITY, CATALOG_DIGEST, computeCatalogDigest, verifyCatalogDigest, type ThemeSpecificationV2, type ThemeDescriptorV2, type CompilationResultV2 } from "./v2/index.js";
export * from "./font-resources.js";
export { createThemeCandidateV2, verifyThemeCandidateV2, parseThemeExchangeV2, serializeThemeExchangeV2, importThemeV1ToV2 } from "./design-exchange-v2/index.js";

export * from "./code/index.js";
export { generateThemePackageCode } from "./generator/code-emitter.js";
export { createThemeCodeCandidate, verifyThemeCodeCandidate, parseThemeCodeCandidate, serializeThemeCodeCandidate, verifyThemeCandidateCompatible } from "./design-exchange-code/index.js";
export type { ThemeCodeCandidatePacket, CreateThemeCodeCandidateOptions, ThemeCodeCandidateVerificationResult } from "./design-exchange-code/index.js";
