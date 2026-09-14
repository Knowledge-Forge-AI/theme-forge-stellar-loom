import type { ContrastDiagnostic } from "../types.js";

export type SchemaVersionV2 = "tfsl.theme-v2";
export type AdapterIdV2 = "starlight-v0.42";

export const CATALOG_IDENTITY = "tfsl.starlight-core-catalog-v1" as const;
export const CATALOG_DIGEST = "d45f945d3323244c5b6d2908799c968d5d1d223e945b8aed0a0ce96b76f32953" as const;

export const COMPILER_SEMANTIC = "tfsl.theme-compiler-v2-core-1" as const;
export const COMPILER_PRODUCER = "@knowledge-forge-ai/theme-forge-stellar-loom" as const;
import { readFileSync } from "node:fs";
/** Exact local package provenance; never a semantic compatibility gate. */
export const COMPILER_VERSION: string = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;

export const COLOR_ROLES = [
  "page",
  "navigation",
  "header",
  "sidebar",
  "raised",
  "panel",
  "card",
  "inline-code",
  "code",
  "body",
  "secondary",
  "muted",
  "inverted",
  "link",
  "hairline",
  "border",
  "focus",
  "selection-background",
  "selection-text",
  "accent-base",
  "accent-low",
  "accent-high",
] as const;

export type ColorRole = (typeof COLOR_ROLES)[number];

export const SYSTEM_FONT_IDS = [
  "system-sans",
  "system-serif",
  "system-mono",
  "system-code",
  "system-ui",
] as const;

export type SystemFontId = (typeof SYSTEM_FONT_IDS)[number];

export type TokenValueObject = { value: string };
export type TokenAliasObject = { alias: string };
export type TokenDefinition = string | TokenValueObject | TokenAliasObject;

export type TokenSet = Record<string, TokenDefinition>;
export type TokenSets = Record<string, TokenSet>;

export interface AccentVariantDefinition {
  tokenSet: string;
  light: Record<ColorRole, string>;
  dark: Record<ColorRole, string>;
}

export interface TypographyRoleV2 {
  font: string;
  size: number;
  lineHeight: number;
}

export interface TypographyV2 {
  body: TypographyRoleV2;
  heading: TypographyRoleV2;
  ui: TypographyRoleV2;
  code: TypographyRoleV2;
}

export interface SurfacesV2 {
  borderStyle?: "solid" | "dashed" | "dotted";
  focusOffset?: number;
  spacing: number;
  radii: number;
  border: number;
  focus: number;
  content: number;
  sidebar: number;
}

export type LayoutPreset = "standard" | "compact" | "wide";

export type PageTitleOption = "consumer-default" | "page-title-frame";

export interface ComponentsV2 {
  pageTitle: PageTitleOption;
}

export type CodePresentationV2 = "consumer-default";

export interface FontDeclarationV2 {
  id: string;
  family: string;
  style: "normal" | "italic" | "oblique";
  weight: number | string;
  format: "woff" | "woff2";
  sha256: string;
  license: string;
  notice: string;
}

export interface ThemeSpecificationV2 {
  name: string;
  version: string;
  schemaVersion: SchemaVersionV2;
  adapter: AdapterIdV2;
  tokenSets: TokenSets;
  accentVariants: Record<string, AccentVariantDefinition>;
  defaultAccent: string;
  typography: TypographyV2;
  surfaces: SurfacesV2;
  layoutPreset: LayoutPreset;
  components: ComponentsV2;
  codePresentation: CodePresentationV2;
  fonts: FontDeclarationV2[];
}

export type ProvenanceCategory =
  | "user-authored-data"
  | "generated-syntax"
  | "first-party-expression";

export interface ThemeDescriptorV2 {
  schema: "tfsl.theme-descriptor-v2";
  schemaVersion: 2;
  themeSchemaVersion: SchemaVersionV2;
  themeName: string;
  themeVersion: string;
  adapter: AdapterIdV2;
  selectedAccent: string;
  accent?: string | undefined;
  inputDigest: string;
  outputDigest: string;
  inventoryDigest: string;
  catalogIdentity: typeof CATALOG_IDENTITY;
  catalogDigest: string;
  catalog: {
    identity: typeof CATALOG_IDENTITY;
    digest: string;
  };
  compilerSemantic: typeof COMPILER_SEMANTIC;
  provenance: {
    categories: ProvenanceCategory[];
    semantic: typeof COMPILER_SEMANTIC;
    compiler: typeof COMPILER_PRODUCER;
    compilerVersion: typeof COMPILER_VERSION;
  };
}

export type DiagnosticSeverity = "info" | "warning";

export type CompilerDiagnosticV2 = ContrastDiagnostic;

export interface CompileThemeV2Options {
  accent?: string | undefined;
  strictContrast?: boolean | undefined;
}

export const STYLE_FILES = [
  "styles/layers.css",
  "styles/tokens.css",
  "styles/base.css",
  "styles/accent.css",
  "styles/overrides.css",
] as const;

export type StyleFileName = (typeof STYLE_FILES)[number];

export interface CompilationResultV2 {
  specification: ThemeSpecificationV2;
  css: string;
  styles: Map<string, string>;
  descriptor: ThemeDescriptorV2;
  inputDigest: string;
  outputDigest: string;
  diagnostics: CompilerDiagnosticV2[];
}
