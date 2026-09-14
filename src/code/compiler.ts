import {
  COMPILER_PRODUCER,
  COMPILER_VERSION,
  type ThemeSpecificationV2,
} from "../v2/types.js";
import { compileThemeV2 } from "../v2/compiler.js";
import { computeSha256 } from "../v2/canonical.js";
import { assertExactKeys, assertPlainObject } from "../v2/validator.js";
import {
  CODE_CATALOG_DIGEST,
  CODE_CSS_EXPRESSION,
  verifyCodeCatalogDigest,
} from "./catalog.js";
import { canonicalizeThemeCode } from "./canonical.js";
import {
  CODE_CATALOG_IDENTITY,
  CODE_COMPILER_SEMANTIC,
  CODE_STYLE_FILES,
  type CompilationResultCode,
  type CompileThemeCodeOptions,
  type ThemeDescriptorCode,
} from "./types.js";

/**
 * Compiles a theme specification with TFSB61B code domain envelope.
 * Composes unchanged core compiler using sentinel, outputs sixth fixed style
 * styles/code.css to override EC pre background in tfsl.overrides, and constructs
 * successor descriptor referencing tfsl.starlight-code-catalog-v1.
 */
export function compileThemeCode(
  input: unknown,
  options?: CompileThemeCodeOptions
): CompilationResultCode {
  if (!verifyCodeCatalogDigest()) {
    throw new Error("Catalog expression digest mismatch; new catalog evidence required");
  }

  if (options !== undefined) {
    assertPlainObject(options as unknown, "options");
    assertExactKeys(options as Record<string, unknown>, ["accent", "strictContrast"], "options");
  }

  if (options?.strictContrast) {
    throw new Error("V2 strict contrast qualification is not implemented; refusing to ignore the requested check");
  }

  const { canonicalObject, inputDigest } = canonicalizeThemeCode(input);

  // Compose unchanged core compile using sentinel "consumer-default"
  const coreSpec: ThemeSpecificationV2 = {
    ...canonicalObject,
    codePresentation: "consumer-default",
  };

  const coreResult = compileThemeV2(coreSpec, options);

  // Sixth fixed style to fix Expressive Code pre background in tfsl.overrides
  const codeCss = CODE_CSS_EXPRESSION;

  const styles = new Map<string, string>();
  for (const file of CODE_STYLE_FILES) {
    if (file === "styles/code.css") {
      styles.set(file, codeCss);
    } else {
      const existing = coreResult.styles.get(file);
      if (existing !== undefined) {
        styles.set(file, existing);
      }
    }
  }

  const css = [
    styles.get("styles/layers.css")!,
    styles.get("styles/tokens.css")!,
    styles.get("styles/base.css")!,
    styles.get("styles/accent.css")!,
    styles.get("styles/overrides.css")!,
    styles.get("styles/code.css")!,
  ].join("\n\n") + "\n";

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

  const descriptor: ThemeDescriptorCode = {
    schema: "tfsl.theme-descriptor-v2",
    schemaVersion: 2,
    themeSchemaVersion: canonicalObject.schemaVersion,
    themeName: canonicalObject.name,
    themeVersion: canonicalObject.version,
    adapter: canonicalObject.adapter,
    selectedAccent: coreResult.descriptor.selectedAccent,
    accent: coreResult.descriptor.accent,
    inputDigest,
    outputDigest,
    inventoryDigest,
    catalogIdentity: CODE_CATALOG_IDENTITY,
    catalogDigest: CODE_CATALOG_DIGEST,
    catalog: {
      identity: CODE_CATALOG_IDENTITY,
      digest: CODE_CATALOG_DIGEST,
    },
    compilerSemantic: CODE_COMPILER_SEMANTIC,
    provenance: {
      categories: [
        "user-authored-data",
        "generated-syntax",
        "first-party-expression",
      ],
      semantic: CODE_COMPILER_SEMANTIC,
      compiler: COMPILER_PRODUCER,
      compilerVersion: COMPILER_VERSION,
    },
  };

  return {
    specification: canonicalObject,
    css,
    styles,
    descriptor,
    inputDigest,
    outputDigest,
    diagnostics: coreResult.diagnostics,
  };
}
