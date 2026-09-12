import type {
  ThemeSpecificationV2,
  ThemeDescriptorV2,
  CompilationResultV2,
  CompileThemeV2Options,
  TokenSets,
  AccentVariantDefinition,
  TypographyV2,
  SurfacesV2,
  LayoutPreset,
  ComponentsV2,
  CodePresentationV2,
  FontDeclarationV2,
  ColorRole,
  CompilerDiagnosticV2,
} from "../v2/index.js";

// Re-export shared v2 domain types
export type {
  ThemeSpecificationV2,
  ThemeDescriptorV2,
  CompilationResultV2,
  CompileThemeV2Options,
  TokenSets,
  AccentVariantDefinition,
  TypographyV2,
  SurfacesV2,
  LayoutPreset,
  ComponentsV2,
  CodePresentationV2,
  FontDeclarationV2,
  ColorRole,
  CompilerDiagnosticV2,
};

// Backwards compatibility alias for CompilationResultV2
export type ThemeCompilationResultV2 = CompilationResultV2;

export interface ThemeOutputInventoryEntryV2 {
  readonly id: string;
  readonly digest: string;
}

export interface ThemeCandidateV2Producer {
  readonly package: string;
  readonly version: string;
  readonly executableDigest: string;
  readonly packageDigest: string;
}

export interface ThemeCandidateV1Origin {
  readonly packetDigest: string;
  readonly byteDigest: string;
}

export interface ThemeCandidateV2ClaimedProvenance {
  readonly author?: string | undefined;
  readonly toolName?: string | undefined;
  readonly toolVersion?: string | undefined;
  readonly timestamp?: string | undefined;
}

export interface ThemeVisualRecordV2 {
  readonly schema: "tfsl.theme-visual-evidence";
  readonly schemaVersion: 1 | 2;
  readonly presence: "included" | "absent" | "unavailable";
  readonly reason?: string | undefined;
  readonly pngDigest?: string | undefined;
  readonly bytesBase64?: string | undefined;
  readonly byteCount?: number | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly mode?: "dark" | "light" | undefined;
  readonly viewport?: "desktop" | "mobile" | undefined;
  readonly themeDigest?: string | undefined;
  readonly fixtureId?: string | undefined;
  readonly evidenceDigest: string;
}

export interface ThemeCandidateV2Packet {
  readonly schema: "tfsl.theme-candidate";
  readonly schemaVersion: 2;
  readonly candidateId: string;
  readonly semanticCompiler: "tfsl.theme-compiler-v2-core-1";
  readonly adapter: "starlight-v0.42";
  readonly catalog: "tfsl.starlight-core-catalog-v1";
  readonly catalogDigest: string;
  readonly producer: ThemeCandidateV2Producer;
  readonly inputDigest: string;
  readonly outputDigest: string;
  readonly outputInventory: readonly ThemeOutputInventoryEntryV2[];
  readonly state: "candidate";
  readonly theme: ThemeSpecificationV2;
  readonly selectedAccent?: string | undefined;
  readonly rationale: string;
  readonly visualSha?: string | undefined;
  readonly visualEvidence?: readonly ThemeVisualRecordV2[] | undefined;
  readonly originV1?: ThemeCandidateV1Origin | undefined;
  readonly claimedProvenance?: ThemeCandidateV2ClaimedProvenance | undefined;
  readonly candidateDigest: string;
}

export interface CreateThemeCandidateV2Options {
  readonly candidateId?: string | undefined;
  readonly selectedAccent?: string | undefined;
  readonly rationale?: string | undefined;
  readonly visualSha?: string | undefined;
  readonly visualEvidence?: readonly ThemeVisualRecordV2[] | undefined;
  readonly claimedProvenance?: ThemeCandidateV2ClaimedProvenance | undefined;
  readonly fontResources?: ReadonlyMap<string, Uint8Array> | undefined;
  readonly originV1?: ThemeCandidateV1Origin | undefined;
}

export interface VerifyThemeCandidateV2Options {
  readonly strictContrast?: boolean | undefined;
  readonly fontResources?: ReadonlyMap<string, Uint8Array> | undefined;
}

export interface ImportThemeV1ToV2Options {
  readonly candidateId?: string | undefined;
  readonly selectedAccent?: string | undefined;
  readonly rationale?: string | undefined;
  readonly visualSha?: string | undefined;
  readonly visualEvidence?: readonly ThemeVisualRecordV2[] | undefined;
  readonly claimedProvenance?: ThemeCandidateV2ClaimedProvenance | undefined;
  readonly fontResources?: ReadonlyMap<string, Uint8Array> | undefined;
}

export interface ThemeCandidateV2VerificationResult {
  readonly valid: boolean;
  readonly candidateId: string;
  readonly candidateDigest: string;
  readonly inputDigest: string;
  readonly outputDigest: string;
  readonly descriptor?: ThemeDescriptorV2 | undefined;
  readonly compiledCss?: string | undefined;
  readonly styles?: ReadonlyMap<string, string> | undefined;
  readonly diagnostics: readonly CompilerDiagnosticV2[];
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export class ThemeExchangeV2Error extends Error {
  readonly code: string;
  constructor(message: string, code = "THEME_EXCHANGE_V2_ERROR") {
    super(message);
    this.name = "ThemeExchangeV2Error";
    this.code = code;
  }
}

export class ThemeExchangeV2ValidationError extends ThemeExchangeV2Error {
  readonly fieldPath?: string | undefined;
  constructor(message: string, code = "VALIDATION_ERROR", fieldPath?: string | undefined) {
    super(`[${code}] ${message}`, code);
    this.name = "ThemeExchangeV2ValidationError";
    this.fieldPath = fieldPath;
  }
}
