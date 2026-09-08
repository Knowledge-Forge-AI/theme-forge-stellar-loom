import { canonicalizeSpecification, computeSha256 } from "./canonical.js";
import { generateThemeDescriptor } from "./descriptor.js";
import { compileStarlightCss } from "../adapters/starlight-v0-42.js";
import { analyzeThemeContrast, ContrastError } from "./contrast.js";
import type { CompilationResult, CompileOptions, ThemeSpecification } from "../types.js";

export function compileTheme(input: unknown, options?: CompileOptions): CompilationResult {
  const { canonicalObject, inputDigest } = canonicalizeSpecification(input);

  let css: string;
  switch (canonicalObject.adapter) {
    case "starlight-v0.42":
      css = compileStarlightCss(canonicalObject, inputDigest);
      break;
    default:
      throw new Error(`Unsupported adapter: ${(canonicalObject as ThemeSpecification).adapter}`);
  }

  const outputDigest = computeSha256(css);
  const descriptor = generateThemeDescriptor({
    spec: canonicalObject,
    inputDigest,
    outputDigest,
    cssFile: options?.cssFile ?? "theme.css",
  });

  const diagnostics = analyzeThemeContrast(canonicalObject);

  if (options?.strictContrast) {
    const warnings = diagnostics.filter((d) => d.disposition === "warn");
    if (warnings.length > 0) {
      throw new ContrastError(
        `Contrast check failed for ${warnings.length} color pair(s) under --strict-contrast`,
        warnings
      );
    }
  }

  return {
    specification: canonicalObject,
    css,
    descriptor,
    inputDigest,
    outputDigest,
    diagnostics,
  };
}

export { canonicalizeSpecification, computeSha256 } from "./canonical.js";
export {
  generateThemeDescriptor,
  COMPILER_PACKAGE,
  COMPILER_VERSION,
} from "./descriptor.js";
export {
  analyzeThemeContrast,
  calculateContrastRatio,
  calculateRelativeLuminance,
  ContrastError,
} from "./contrast.js";
