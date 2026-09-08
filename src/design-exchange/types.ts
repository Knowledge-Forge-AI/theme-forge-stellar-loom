import type { ThemeSpecification, ThemeDescriptor, ContrastDiagnostic } from "../types.js";
import type { PackageMetadata } from "../generator/types.js";

export type ThemeExchangePacketKind = "brief" | "candidate" | "review";

export interface ThemeVisualRecord {
  readonly schema: "tfsl.theme-visual-evidence";
  readonly schemaVersion: 1;
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

export type ThemeAnnotationTarget =
  | { readonly kind: "field"; readonly fieldPath: string; readonly mode?: "dark" | "light" | undefined }
  | { readonly kind: "visual"; readonly evidenceDigest: string; readonly pngDigest: string; readonly region: readonly [number, number, number, number] };

export type ThemeAnnotationCategory = "contrast" | "color" | "typography" | "layout" | "brand-fit" | "accessibility" | "other";
export type ThemeAnnotationSeverity = "note" | "minor" | "substantive" | "blocking";

export interface ThemeAnnotation {
  readonly annotationId: string;
  readonly candidateDigest: string;
  readonly target: ThemeAnnotationTarget;
  readonly category: ThemeAnnotationCategory;
  readonly severity: ThemeAnnotationSeverity;
  readonly comment: string;
}

export type ThemeCandidateDisposition = "unreviewed" | "preferred" | "approved" | "rejected" | "needs-revision" | "deferred";

export type ThemeReviewOverallDisposition =
  | { readonly kind: "no-decision" }
  | { readonly kind: "rejected-all" }
  | { readonly kind: "preferred" | "approved" | "needs-revision"; readonly candidateDigest: string };

export interface ThemeBriefPacket {
  readonly schema: "tfsl.theme-brief";
  readonly schemaVersion: 1;
  readonly briefId: string;
  readonly title: string;
  readonly goal: string;
  readonly baselineTheme: ThemeSpecification;
  readonly themeDigest: string;
  readonly compilerVersion: string;
  readonly adapter: string;
  readonly allowedFields: readonly string[];
  readonly allowedModes: readonly ("dark" | "light")[];
  readonly approvedTemplates: readonly string[];
  readonly acceptanceCriteria: readonly string[];
  readonly prohibitedChanges: readonly string[];
  readonly visualEvidence: readonly ThemeVisualRecord[];
  readonly metadata?: {
    readonly author?: string | undefined;
    readonly timestamp?: string | undefined;
  } | undefined;
  readonly briefDigest: string;
}

export interface ThemeCandidatePacket {
  readonly schema: "tfsl.theme-candidate";
  readonly schemaVersion: 1;
  readonly candidateId: string;
  readonly briefDigest: string;
  readonly theme: ThemeSpecification;
  readonly themeDigest: string;
  readonly rationale: string;
  readonly packageMetadata?: PackageMetadata | undefined;
  readonly claimedProvenance?: {
    readonly author?: string | undefined;
    readonly toolName?: string | undefined;
    readonly toolVersion?: string | undefined;
    readonly timestamp?: string | undefined;
  } | undefined;
  readonly claimedDiagnostics?: readonly ContrastDiagnostic[] | undefined;
  readonly claimedCssDigest?: string | undefined;
  readonly visualEvidence: readonly ThemeVisualRecord[];
  readonly candidateDigest: string;
}

export interface ThemeReviewPacket {
  readonly schema: "tfsl.theme-review";
  readonly schemaVersion: 1;
  readonly reviewId: string;
  readonly briefDigest: string;
  readonly candidateDigests: readonly string[];
  readonly dispositions: readonly {
    readonly candidateDigest: string;
    readonly disposition: ThemeCandidateDisposition;
    readonly comment?: string | undefined;
  }[];
  readonly annotations: readonly ThemeAnnotation[];
  readonly overallDisposition: ThemeReviewOverallDisposition;
  readonly summary: string;
  readonly reviewDigest: string;
}

export type ThemeExchangePacket = ThemeBriefPacket | ThemeCandidatePacket | ThemeReviewPacket;

export interface ThemeBriefCreateInput {
  readonly briefId: string;
  readonly title: string;
  readonly goal: string;
  readonly baselineTheme: ThemeSpecification;
  readonly allowedFields?: readonly string[] | undefined;
  readonly allowedModes?: readonly ("dark" | "light")[] | undefined;
  readonly approvedTemplates?: readonly string[] | undefined;
  readonly acceptanceCriteria?: readonly string[] | undefined;
  readonly prohibitedChanges?: readonly string[] | undefined;
  readonly visualEvidence?: readonly ThemeVisualRecord[] | undefined;
  readonly metadata?: {
    readonly author?: string | undefined;
    readonly timestamp?: string | undefined;
  } | undefined;
  readonly adapter?: string | undefined;
}

export interface ThemeCandidateCreateInput {
  readonly candidateId: string;
  readonly brief: ThemeBriefPacket | string;
  readonly theme: ThemeSpecification;
  readonly rationale: string;
  readonly packageMetadata?: PackageMetadata | undefined;
  readonly claimedProvenance?: {
    readonly author?: string | undefined;
    readonly toolName?: string | undefined;
    readonly toolVersion?: string | undefined;
    readonly timestamp?: string | undefined;
  } | undefined;
  readonly claimedDiagnostics?: readonly ContrastDiagnostic[] | undefined;
  readonly claimedCssDigest?: string | undefined;
  readonly visualEvidence?: readonly ThemeVisualRecord[] | undefined;
}

export interface ThemeReviewCreateInput {
  readonly reviewId: string;
  readonly brief: ThemeBriefPacket | string;
  readonly candidateDigests: readonly string[];
  readonly dispositions: readonly {
    readonly candidateDigest: string;
    readonly disposition: ThemeCandidateDisposition;
    readonly comment?: string | undefined;
  }[];
  readonly annotations?: readonly ThemeAnnotation[] | undefined;
  readonly overallDisposition: ThemeReviewOverallDisposition;
  readonly summary: string;
}

export interface ThemeCandidateVerificationResult {
  readonly valid: boolean;
  readonly candidateId: string;
  readonly candidateDigest: string;
  readonly briefDigest: string;
  readonly themeDigest: string;
  readonly computedCssDigest?: string | undefined;
  readonly compiledCss?: string | undefined;
  readonly descriptor?: ThemeDescriptor | undefined;
  readonly diagnostics: readonly ContrastDiagnostic[];
  readonly constraintViolations: readonly string[];
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface ThemeReviewValidationResult {
  readonly valid: boolean;
  readonly reviewId: string;
  readonly reviewDigest: string;
  readonly briefDigest: string;
  readonly candidateMatches: boolean;
  readonly dispositionMatches: boolean;
  readonly annotationErrors: readonly string[];
  readonly errors: readonly string[];
}

export interface ThemeExchangeInspection {
  readonly kind: ThemeExchangePacketKind;
  readonly schema: string;
  readonly schemaVersion: number;
  readonly digest: string;
  readonly publicId: string;
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly summary: Record<string, unknown>;
}

export class ThemeExchangeError extends Error {
  readonly code: string;
  constructor(message: string, code = "THEME_EXCHANGE_ERROR") {
    super(message);
    this.name = "ThemeExchangeError";
    this.code = code;
  }
}

export class ThemeExchangeValidationError extends ThemeExchangeError {
  readonly fieldPath?: string | undefined;
  constructor(message: string, code = "VALIDATION_ERROR", fieldPath?: string | undefined) {
    super(message, code);
    this.name = "ThemeExchangeValidationError";
    this.fieldPath = fieldPath;
  }
}
