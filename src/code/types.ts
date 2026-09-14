import type {
  ThemeSpecificationV2,
  SchemaVersionV2,
  AdapterIdV2,
  ProvenanceCategory,
  ColorRole,
  CompilerDiagnosticV2,
} from "../v2/types.js";

export const CODE_CATALOG_IDENTITY = "tfsl.starlight-code-catalog-v1" as const;
export const CODE_CATALOG_DIGEST = "a56cd99c26ce6e015854338eee63fd850121cf2c86af7cbe992cf39b4b58f34b" as const;
export const CODE_COMPILER_SEMANTIC = "tfsl.theme-compiler-v2-code-1" as const;

export type CodeFontStyle = "normal" | "italic" | "bold" | "underline";

export interface SyntaxRule {
  scopes: string[];
  foreground: string;
  background?: string | undefined;
  fontStyle?: CodeFontStyle | undefined;
}

export interface SyntaxThemeMode {
  rules: SyntaxRule[];
}

export interface SyntaxTheme {
  light: SyntaxThemeMode;
  dark: SyntaxThemeMode;
}

export type CodeFrame = "plain" | "editor" | "terminal";
export type CodeCopy = "standard" | "minimal";
export type CodeTabs = "deferred";

export type ColorHex = string;

export interface PairedColorHex {
  light: ColorHex;
  dark: ColorHex;
}

export type MarkColor = ColorHex | PairedColorHex;

export interface CodeMarks {
  marked: MarkColor;
  inserted: MarkColor;
  deleted: MarkColor;
}

export interface CodePresentationConfig {
  mode: "expressive-code";
  syntaxTheme: SyntaxTheme;
  frame: CodeFrame;
  marks: CodeMarks;
  copy: CodeCopy;
  tabs: CodeTabs;
}

export interface ThemeSpecificationCode extends Omit<ThemeSpecificationV2, "codePresentation"> {
  codePresentation: CodePresentationConfig;
}

export interface ThemeDescriptorCode {
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
  catalogIdentity: typeof CODE_CATALOG_IDENTITY;
  catalogDigest: string;
  catalog: {
    identity: typeof CODE_CATALOG_IDENTITY;
    digest: string;
  };
  compilerSemantic: typeof CODE_COMPILER_SEMANTIC;
  provenance: {
    categories: ProvenanceCategory[];
    semantic: typeof CODE_COMPILER_SEMANTIC;
    compiler: string;
    compilerVersion: string;
  };
}

export const CODE_STYLE_FILES = [
  "styles/layers.css",
  "styles/tokens.css",
  "styles/base.css",
  "styles/accent.css",
  "styles/overrides.css",
  "styles/code.css",
] as const;

export type CodeStyleFileName = (typeof CODE_STYLE_FILES)[number];

export interface CompilationResultCode {
  specification: ThemeSpecificationCode;
  css: string;
  styles: Map<string, string>;
  descriptor: ThemeDescriptorCode;
  inputDigest: string;
  outputDigest: string;
  diagnostics: CompilerDiagnosticV2[];
}

export interface CompileThemeCodeOptions {
  accent?: string | undefined;
  strictContrast?: boolean | undefined;
}

export interface PublicEcTokenColorSetting {
  foreground?: string | undefined;
  background?: string | undefined;
  fontStyle?: string | undefined;
}

export interface PublicEcTokenColorRule {
  scope: string[];
  settings: PublicEcTokenColorSetting;
}

export interface PublicEcTheme {
  name: string;
  type: "light" | "dark";
  bg: string;
  fg: string;
  tokenColors: PublicEcTokenColorRule[];
}

export interface PublicEcFramesStyleOverrides {
  editorBackground: [string, string];
  editorActiveTabBackground: [string, string];
  editorActiveTabForeground: [string, string];
  editorActiveTabBorderColor: [string, string];
  editorTabBarBackground: [string, string];
  editorTabBarBorderColor: [string, string];
  editorTabBarBorderBottomColor: [string, string];
  editorTabBorderRadius: string;
  terminalBackground: [string, string];
  terminalTitlebarBackground: [string, string];
  terminalTitlebarForeground: [string, string];
  terminalTitlebarBorderBottomColor: [string, string];
  inlineButtonForeground: [string, string];
  inlineButtonBorder: [string, string];
  inlineButtonBorderOpacity: string;
  inlineButtonBackgroundIdleOpacity: string;
  tooltipSuccessBackground: [string, string];
  tooltipSuccessForeground: [string, string];
}

export interface PublicEcTextMarkersStyleOverrides {
  markBackground: [string, string];
  markBorderColor: [string, string];
  insBackground: [string, string];
  insBorderColor: [string, string];
  insDiffIndicatorColor: [string, string];
  delBackground: [string, string];
  delBorderColor: [string, string];
  delDiffIndicatorColor: [string, string];
}

export interface PublicEcStyleOverrides {
  codeFontFamily: string;
  codeFontSize: string;
  codeLineHeight: string;
  borderRadius: string;
  borderWidth: string;
  borderColor: [string, string];
  focusBorder: [string, string];
  codeBackground: [string, string];
  codeForeground: [string, string];
  frames: PublicEcFramesStyleOverrides;
  textMarkers: PublicEcTextMarkersStyleOverrides;
}

export interface PublicExpressiveCodeConfig {
  themes: PublicEcTheme[];
  useStarlightUiThemeColors: false;
  defaultProps: {
    frame: "none" | "code" | "terminal";
  };
  styleOverrides: PublicEcStyleOverrides;
}
