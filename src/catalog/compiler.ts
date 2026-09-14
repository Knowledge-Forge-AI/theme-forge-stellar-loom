import { computeSha256 } from "../v2/canonical.js";
import { compileThemeV2 } from "../v2/compiler.js";
import { compileThemeCode } from "../code/compiler.js";
import { COMPILER_PRODUCER, COMPILER_VERSION } from "../v2/types.js";
import {
  CATALOG_COMPILER_SEMANTIC,
  CATALOG_IDENTITY,
  type CompilationResultCatalog,
  type CompileThemeCatalogOptions,
  type ThemeDescriptorCatalog,
  type ThemeSpecificationCatalog,
} from "./types.js";
import { canonicalizeThemeCatalog } from "./canonical.js";
import { CATALOG_DIGEST, verifyCatalogDigest } from "./catalog.js";
import { emitCompatCss } from "./templates/compat-css.js";

/**
 * Compiles a theme specification within the TFSB61B catalog envelope.
 * Canonicalizes input, lowers to core or code compiler, appends unlayered compat.css,
 * builds comprehensive descriptor with catalog identity, and computes digests.
 */
export function compileThemeCatalog(
  input: unknown,
  options?: CompileThemeCatalogOptions
): CompilationResultCatalog {
  if (!verifyCatalogDigest()) {
    throw new Error("Catalog expression digest mismatch; new catalog evidence required");
  }

  if (options?.strictContrast) {
    throw new Error(
      "V2 strict contrast qualification is not implemented; refusing to ignore the requested check"
    );
  }

  const { canonicalObject, inputDigest } = canonicalizeThemeCatalog(input);
  const spec = canonicalObject;

  // Lower by removing catalog property for core/code execution
  const { catalog, ...lowered } = spec;

  const isCode =
    Boolean(lowered.codePresentation) &&
    typeof lowered.codePresentation === "object" &&
    (lowered.codePresentation as any).mode === "expressive-code";

  const baseResult = isCode
    ? compileThemeCode(lowered as any, options)
    : compileThemeV2(lowered as any, options);

  // Generate unlayered compat CSS
  const compatCss = emitCompatCss(spec, baseResult.descriptor.selectedAccent);

  const styles = new Map<string, string>();
  for (const [k, v] of baseResult.styles) {
    styles.set(k, v);
  }
  styles.set("styles/compat.css", compatCss);

  const styleFiles = [
    "styles/layers.css",
    "styles/tokens.css",
    "styles/base.css",
    "styles/accent.css",
    "styles/overrides.css",
    ...(isCode ? ["styles/code.css"] : []),
    "styles/compat.css",
  ];

  const css = styleFiles.map((f) => styles.get(f)!).join("\n\n") + "\n";
  const outputDigest = computeSha256(css);

  const inventoryDigest = computeSha256(
    "tfsl.styles-inventory-v2\n" +
      JSON.stringify(
        [...styles].map(([path, content]) => ({
          path,
          sha256: computeSha256(content),
          size: Buffer.byteLength(content),
        }))
      )
  );

  const descriptor: ThemeDescriptorCatalog = {
    schema: "tfsl.theme-descriptor-v2",
    schemaVersion: 2,
    themeSchemaVersion: spec.schemaVersion,
    themeName: spec.name,
    themeVersion: spec.version,
    adapter: spec.adapter,
    selectedAccent: baseResult.descriptor.selectedAccent,
    accent: baseResult.descriptor.accent,
    inputDigest,
    outputDigest,
    inventoryDigest,
    catalogIdentity: CATALOG_IDENTITY,
    catalogDigest: CATALOG_DIGEST,
    catalog: {
      identity: CATALOG_IDENTITY,
      digest: CATALOG_DIGEST,
    },
    compilerSemantic: CATALOG_COMPILER_SEMANTIC,
    provenance: {
      categories: [
        "user-authored-data",
        "generated-syntax",
        "first-party-expression",
      ],
      semantic: CATALOG_COMPILER_SEMANTIC,
      compiler: COMPILER_PRODUCER,
      compilerVersion: COMPILER_VERSION,
    },
  };

  return {
    specification: spec,
    css,
    styles,
    descriptor,
    inputDigest,
    outputDigest,
    diagnostics: baseResult.diagnostics,
  };
}
