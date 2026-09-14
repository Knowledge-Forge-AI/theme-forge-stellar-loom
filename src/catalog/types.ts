import type {
  ThemeSpecificationV2,
  SchemaVersionV2,
  AdapterIdV2,
  ProvenanceCategory,
  CompilerDiagnosticV2,
  FontDeclarationV2,
  COMPILER_PRODUCER,
  COMPILER_VERSION,
} from "../v2/types.js";
import type {
  CodePresentationConfig,
  ThemeSpecificationCode,
} from "../code/types.js";
import type {
  PackageMetadata,
} from "../generator/types.js";
import type { GeneratePackageV2Options } from "../generator/v2-emitter.js";
import type { GeneratedFile } from "../generator/v2-writer.js";

export const CATALOG_COMPILER_SEMANTIC = "tfsl.theme-compiler-v2-catalog-1" as const;
export const CATALOG_IDENTITY = "tfsl.starlight-component-catalog-v1" as const;

export type HeroLayout =
  | "centered"
  | "media-top"
  | "media-left"
  | "media-right"
  | "banner";

export interface HeroAction {
  label: string;
  href: string;
}

export type HeroAnnouncement = string | { text: string; href?: string | undefined };

export interface HeroRoute {
  route: string;
  layout: HeroLayout;
  title: string;
  subtitle?: string | undefined;
  summary?: string | undefined;
  announcement?: HeroAnnouncement | undefined;
  actions: HeroAction[];
  media?: "loom-orbit" | undefined;
}

export interface CatalogHeroConfig {
  routes: HeroRoute[];
}

export interface CatalogPageTitleConfig {
  copy: "none" | "title" | "url";
}

export interface CatalogPaginationConfig {
  variant: "plain" | "card" | "compact";
}

export interface CatalogSidebarConfig {
  mode: "nested" | "tabs" | "select" | "active-only";
  groupIds: string[];
}

export interface CatalogFontLicense {
  id: string;
  text: string;
  sha256: string;
}

export interface ThemeCatalogConfig {
  hero: CatalogHeroConfig;
  pageTitle: CatalogPageTitleConfig;
  pagination: CatalogPaginationConfig;
  sidebar: CatalogSidebarConfig;
  layout: "standard" | "compact";
  fontLicenses: CatalogFontLicense[];
}

export interface ThemeSpecificationCatalog extends Omit<ThemeSpecificationV2, "codePresentation"> {
  catalog: ThemeCatalogConfig;
  codePresentation?: "consumer-default" | CodePresentationConfig | undefined;
}

export interface ThemeDescriptorCatalog {
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
  compilerSemantic: typeof CATALOG_COMPILER_SEMANTIC;
  provenance: {
    categories: ProvenanceCategory[];
    semantic: typeof CATALOG_COMPILER_SEMANTIC;
    compiler: typeof COMPILER_PRODUCER;
    compilerVersion: typeof COMPILER_VERSION;
  };
}

export interface CompilationResultCatalog {
  specification: ThemeSpecificationCatalog;
  css: string;
  styles: Map<string, string>;
  descriptor: ThemeDescriptorCatalog;
  inputDigest: string;
  outputDigest: string;
  diagnostics: CompilerDiagnosticV2[];
}

export interface CompileThemeCatalogOptions {
  accent?: string | undefined;
  strictContrast?: boolean | undefined;
}

export type GeneratePackageCatalogOptions = GeneratePackageV2Options;

export interface PackageProvenanceCatalog {
  schema: "tfsl.package-provenance-v2";
  producer: { package: string; version: string };
  descriptor: ThemeDescriptorCatalog;
  packageName: string;
  packageVersion: string;
  inventoryDigest: string;
  inventoryExcludes: string[];
  files: Array<{ path: string; size: number; sha256: string }>;
  fonts: FontDeclarationV2[];
  fontLicenses?: CatalogFontLicense[];
}

export interface GeneratePackageCatalogResult {
  metadata: PackageMetadata;
  themeSpec: ThemeSpecificationCatalog;
  themeCanonicalJson: string;
  themeInputDigest: string;
  cssContent: string;
  cssOutputDigest: string;
  descriptor: ThemeDescriptorCatalog;
  provenance: PackageProvenanceCatalog;
  files: Map<string, GeneratedFile>;
  diagnostics: CompilerDiagnosticV2[];
}
