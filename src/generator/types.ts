import type { CompilerDiagnostic, ThemeDescriptor, ThemeSpecification } from "../types.js";

export type ApprovedTemplateId = "page-title-frame";

export const APPROVED_TEMPLATES: readonly ApprovedTemplateId[] = [
  "page-title-frame",
] as const;

export interface PackageMetadata {
  name: string;
  version: string;
  description?: string | undefined;
  author?: string | undefined;
  license?: string | undefined;
  template?: ApprovedTemplateId | undefined;
}

export interface GeneratePackageOptions {
  themeSpec: unknown;
  metadata: unknown;
  template?: string | undefined;
  strictContrast?: boolean | undefined;
}

export type PackageProvenanceCategory =
  | "user-authored-data"
  | "generated-syntax"
  | "first-party-expression"
  | "legal-notice"
  | "generated-metadata";

export interface PackageFileRecord {
  path: string;
  size: number;
  sha256: string;
  category: PackageProvenanceCategory;
}

export interface PackageProvenance {
  schema: "tfsl.package-provenance-v1";
  schemaVersion: 1;
  packageName: string;
  packageVersion: string;
  generator: string;
  generatorVersion: string;
  themeName: string;
  themeVersion: string;
  themeInputDigest: string;
  cssOutputDigest: string;
  template?: ApprovedTemplateId | undefined;
  files: PackageFileRecord[];
  licensingNotice: string;
}

export interface GeneratePackageResult {
  metadata: PackageMetadata;
  themeSpec: ThemeSpecification;
  themeCanonicalJson: string;
  themeInputDigest: string;
  cssContent: string;
  cssOutputDigest: string;
  descriptor: ThemeDescriptor;
  provenance: PackageProvenance;
  files: Map<string, string>;
  diagnostics: CompilerDiagnostic[];
}

export interface WritePackageOptions {
  /**
   * Overwrite is forbidden for package generation.
   * If provided and truthy, writeThemePackage rejects with an error.
   */
  overwrite?: boolean | undefined;
}

export interface WritePackageResult {
  outDir: string;
  filesWritten: string[];
  /**
   * @deprecated Reserved for backward compatibility; always empty because theme
   * package generation requires an absent or empty destination and never prunes files.
   */
  filesPruned: string[];
  result: GeneratePackageResult;
}
