import type {
  ThemeSpecificationCode,
  ThemeDescriptorCode,
  CompilationResultCode,
  CompileThemeCodeOptions,
  CODE_CATALOG_IDENTITY,
  CODE_COMPILER_SEMANTIC,
} from "../code/index.js";
import type {
  ThemeVisualRecordV2,
  ThemeCandidateV1Origin,
  ThemeCandidateV2ClaimedProvenance,
} from "../design-exchange-v2/types.js";
import type {
  PackageMetadata,
} from "../generator/types.js";
import type {
  CompilerDiagnosticV2,
  FontDeclarationV2,
  ColorRole,
} from "../v2/index.js";

export type {
  ThemeSpecificationCode,
  ThemeDescriptorCode,
  CompilationResultCode,
  CompileThemeCodeOptions,
  PackageMetadata,
  ThemeVisualRecordV2,
  ThemeCandidateV1Origin,
  ThemeCandidateV2ClaimedProvenance,
  CompilerDiagnosticV2,
  FontDeclarationV2,
  ColorRole,
};

export interface ThemeCodeOutputInventoryEntry {
  readonly id: string;
  readonly digest: string;
}

export interface ThemeCodeCandidateProducer {
  readonly package: string;
  readonly version: string;
  readonly executableDigest: string;
  readonly packageDigest: string;
}

export interface ThemeCodeRuntimeObject {
  readonly expressiveCode: string;
  readonly shiki: string;
  readonly label?: string | undefined;
}

export type ThemeCodeRuntime = string | ThemeCodeRuntimeObject;

export interface ThemeCodeCandidatePacket {
  readonly schema: "tfsl.theme-candidate" | "tfsl.theme-code-candidate";
  readonly schemaVersion: 2;
  readonly candidateId: string;
  readonly semanticCompiler: typeof CODE_COMPILER_SEMANTIC;
  readonly adapter: "starlight-v0.42";
  readonly catalog: typeof CODE_CATALOG_IDENTITY;
  readonly catalogDigest: string;
  readonly producer: ThemeCodeCandidateProducer;
  readonly inputDigest: string;
  readonly themeDigest: string;
  readonly syntaxDigest: string;
  readonly runtime: ThemeCodeRuntime;
  readonly metadata: PackageMetadata;
  readonly outputDigest: string;
  readonly outputInventory: readonly ThemeCodeOutputInventoryEntry[];
  readonly state: "candidate";
  readonly theme: ThemeSpecificationCode;
  readonly selectedAccent?: string | undefined;
  readonly rationale: string;
  readonly visualSha?: string | undefined;
  readonly visualEvidence?: readonly ThemeVisualRecordV2[] | undefined;
  readonly originV1?: ThemeCandidateV1Origin | undefined;
  readonly claimedProvenance?: ThemeCandidateV2ClaimedProvenance | undefined;
  readonly candidateDigest: string;
}

export interface CreateThemeCodeCandidateOptions {
  readonly candidateId?: string | undefined;
  readonly metadata?: unknown | undefined;
  readonly selectedAccent?: string | undefined;
  readonly accent?: string | undefined;
  readonly rationale?: string | undefined;
  readonly visualSha?: string | undefined;
  readonly visualEvidence?: readonly ThemeVisualRecordV2[] | undefined;
  readonly claimedProvenance?: ThemeCandidateV2ClaimedProvenance | undefined;
  readonly fontResources?: ReadonlyMap<string, Uint8Array> | undefined;
  readonly originV1?: ThemeCandidateV1Origin | undefined;
  readonly runtime?: ThemeCodeRuntime | undefined;
}

export interface VerifyThemeCodeCandidateOptions {
  readonly fontResources?: ReadonlyMap<string, Uint8Array> | undefined;
  readonly strictContrast?: boolean | undefined;
}

export interface ThemeCodeCandidateVerificationResult {
  readonly valid: boolean;
  readonly candidateId: string;
  readonly candidateDigest: string;
  readonly inputDigest: string;
  readonly outputDigest: string;
  readonly themeDigest: string;
  readonly syntaxDigest: string;
  readonly descriptor?: ThemeDescriptorCode | undefined;
  readonly compiledCss?: string | undefined;
  readonly styles?: ReadonlyMap<string, string> | undefined;
  readonly packageFiles?: ReadonlyMap<string, string | Uint8Array> | undefined;
  readonly diagnostics: readonly CompilerDiagnosticV2[];
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export class ThemeExchangeCodeError extends Error {
  readonly code: string;
  constructor(message: string, code = "THEME_EXCHANGE_CODE_ERROR") {
    super(message);
    this.name = "ThemeExchangeCodeError";
    this.code = code;
  }
}

export class ThemeExchangeCodeValidationError extends ThemeExchangeCodeError {
  readonly fieldPath?: string | undefined;
  constructor(message: string, code = "VALIDATION_ERROR", fieldPath?: string | undefined) {
    super(`[${code}] ${message}`, code);
    this.name = "ThemeExchangeCodeValidationError";
    this.fieldPath = fieldPath;
  }
}
