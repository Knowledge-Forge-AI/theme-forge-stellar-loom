import type { ThemeDescriptor, ThemeSpecification } from "../types.js";

export const COMPILER_PACKAGE = "@knowledge-forge-ai/theme-forge-stellar-loom";
export { COMPILER_VERSION } from "../v2/types.js";
import { COMPILER_VERSION } from "../v2/types.js";


export function generateThemeDescriptor(params: {
  spec: ThemeSpecification;
  inputDigest: string;
  outputDigest: string;
  cssFile?: string;
}): ThemeDescriptor {
  return {
    schema: "tfsl.theme-descriptor-v1",
    schemaVersion: 1,
    themeSchemaVersion: params.spec.schemaVersion,
    themeName: params.spec.name,
    themeVersion: params.spec.version,
    adapter: params.spec.adapter,
    inputDigest: params.inputDigest,
    outputDigest: params.outputDigest,
    cssFile: params.cssFile ?? "theme.css",
    provenance: {
      categories: [
        "user-authored-data",
        "generated-syntax",
        "first-party-expression",
      ],
      compiler: COMPILER_PACKAGE,
      compilerVersion: COMPILER_VERSION,
    },
  };
}
