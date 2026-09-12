export * from "./index.js";
export { runCli } from "./cli-catalog.js";
export { runBatch, processBatchRequest } from "./batch-catalog.js";
export * from "./design-exchange-catalog/index.js";
export { verifyThemeCandidateCompatible } from "./design-exchange-catalog/index.js";
export { isThemeCatalog, validateThemeCatalog, parseThemeCatalog, canonicalizeThemeCatalog, compileThemeCatalog, generateThemePackageCatalog, writeThemePackageCatalog, CATALOG_COMPILER_SEMANTIC } from "./catalog/index.js";
export { CATALOG_IDENTITY as COMPONENT_CATALOG_IDENTITY, CATALOG_DIGEST as COMPONENT_CATALOG_DIGEST } from "./catalog/index.js";
export type { ThemeSpecificationCatalog } from "./catalog/types.js";
import * as historical from "./index.js";
import * as catalog from "./catalog/index.js";
import type { CompileOptions } from "./types.js";
import type { GeneratePackageV2Options } from "./generator/v2-emitter.js";

// Even a malformed catalog field selects the strict successor validator.
export function hasCatalogField(input: unknown): boolean {
  return input !== null && typeof input === "object" && Object.hasOwn(input, "catalog");
}
export function compileTheme(input: unknown, options?: CompileOptions & { accent?: string }) {
  if (!hasCatalogField(input)) return historical.compileTheme(input, options);
  if (options?.cssFile || options?.strictContrast) throw new Error("Catalog output filenames are fixed; strict contrast is unsupported");
  return catalog.compileThemeCatalog(input, options);
}
export function validateThemeSpecification(input: unknown) {
  return hasCatalogField(input) ? catalog.validateThemeCatalog(input) : historical.validateThemeSpecification(input);
}
export function canonicalizeSpecification(input: unknown) {
  return hasCatalogField(input) ? catalog.canonicalizeThemeCatalog(input) : historical.canonicalizeSpecification(input);
}
export function generateThemePackage(options: GeneratePackageV2Options) {
  return hasCatalogField(options.themeSpec) ? catalog.generateThemePackageCatalog(options) : historical.generateThemePackage(options);
}
export const writeThemePackage = historical.writeThemePackage;
