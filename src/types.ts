export type SchemaVersion = "tfsl.theme-v1";
export type AdapterId = "starlight-v0.42";

export interface ThemePaletteAccent {
  base: string; // #rrggbb
  low: string;
  high: string;
}

export interface ThemePaletteNeutrals {
  bg: string;
  bgNav: string;
  bgSidebar: string;
  bgInlineCode: string;
  bgAccent: string;
  text: string;
  textAccent: string;
  textInvert: string;
  hairline: string;
  hairlineLight: string;
  hairlineShade: string;
}

export interface ThemePaletteGrays {
  gray1: string;
  gray2: string;
  gray3: string;
  gray4: string;
  gray5: string;
  gray6: string;
  gray7: string;
}

export interface ThemePalette {
  accent: ThemePaletteAccent;
  neutrals: ThemePaletteNeutrals;
  grays: ThemePaletteGrays;
}

export type BodyFontOption = "system-sans" | "system-serif" | "system-mono";
export type CodeFontOption = "system-mono" | "system-code";

export interface ThemeTypography {
  bodyFont: BodyFontOption;
  codeFont: CodeFontOption;
  baseFontSize?: string; // e.g. "16px", "1rem"
  lineHeight?: number;   // e.g. 1.75
}

export interface ThemeLayout {
  contentWidth: string; // e.g. "45rem", "50rem"
  sidebarWidth: string; // e.g. "18.75rem", "20rem"
}

export interface ThemeSpecification {
  $schema?: string;
  name: string;
  version: string;
  schemaVersion: SchemaVersion;
  adapter: AdapterId;
  colors: {
    dark: ThemePalette;
    light: ThemePalette;
  };
  typography: ThemeTypography;
  layout: ThemeLayout;
}

export type ProvenanceCategory =
  | "user-authored-data"
  | "generated-syntax"
  | "first-party-expression";

export interface ThemeDescriptor {
  schema: "tfsl.theme-descriptor-v1";
  schemaVersion: 1;
  themeSchemaVersion: SchemaVersion;
  themeName: string;
  themeVersion: string;
  adapter: AdapterId;
  inputDigest: string;
  outputDigest: string;
  cssFile: string;
  provenance: {
    categories: ProvenanceCategory[];
    compiler: "@knowledge-forge-ai/theme-forge-stellar-loom";
    compilerVersion: string;
  };
}

export type DiagnosticSeverity = "info" | "warning";

export type ContrastCriterion = "WCAG 2.2 AA";

export type ContrastRole = "body-text" | "link-text" | "inline-code-text";

export type ContrastElement = "body" | "link" | "inline-code";

export interface ContrastDiagnostic {
  severity: DiagnosticSeverity;
  code: "CONTRAST_BELOW_THRESHOLD" | "CONTRAST_ACCEPTABLE";
  role: ContrastRole;
  mode: "dark" | "light";
  element: ContrastElement;
  foreground: string;
  background: string;
  ratio: number;
  displayRatio: string;
  criterion: ContrastCriterion;
  threshold: number;
  disposition: "pass" | "warn";
  message: string;
}

export type CompilerDiagnostic = ContrastDiagnostic;

export interface CompileOptions {
  strictContrast?: boolean;
  cssFile?: string;
}

export interface CompilationResult {
  specification: ThemeSpecification;
  css: string;
  descriptor: ThemeDescriptor;
  inputDigest: string;
  outputDigest: string;
  diagnostics: CompilerDiagnostic[];
}
