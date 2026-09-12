import { isThemeCode, compileThemeCode, validateThemeCode, canonicalizeThemeCode, type ThemeSpecificationCode } from "./code/index.js";
import { compileTheme as compileV1, canonicalizeSpecification as canonicalV1 } from "./compiler/index.js";
import { validateThemeSpecification as validateV1 } from "./schema/validator.js";
import type { ThemeSpecification, CompileOptions, CompilationResult } from "./types.js";
import { compileThemeV2, canonicalizeThemeV2, validateThemeV2, type ThemeSpecificationV2 } from "./v2/index.js";

export function isThemeV2(input: unknown): input is ThemeSpecificationV2 {
  return !!input && typeof input === "object" && Object.getOwnPropertyDescriptor(input, "schemaVersion")?.value === "tfsl.theme-v2";
}
export function compileTheme(input: ThemeSpecificationCode, options?: CompileOptions & { accent?: string }): ReturnType<typeof compileThemeCode>;
export function compileTheme(input: ThemeSpecificationV2, options?: CompileOptions & { accent?: string }): ReturnType<typeof compileThemeV2>;
export function compileTheme(input: ThemeSpecification, options?: CompileOptions): CompilationResult;
export function compileTheme(input: unknown, options?: CompileOptions & { accent?: string }): CompilationResult | ReturnType<typeof compileThemeV2> | ReturnType<typeof compileThemeCode>;
export function compileTheme(input: unknown, options?: CompileOptions & { accent?: string }) {
  if (!isThemeV2(input)) return compileV1(input, options);
  if (options?.strictContrast) throw new Error("V2 strict contrast is unsupported in core");
  if (options?.cssFile) throw new Error("V2 stylesheet filenames are fixed");
  return (isThemeCode(input) ? compileThemeCode : compileThemeV2)(input, options?.accent === undefined ? undefined : { accent: options.accent });
}
export function validateThemeSpecification(input: ThemeSpecificationCode): ThemeSpecificationCode;
export function validateThemeSpecification(input: ThemeSpecification): ThemeSpecification;
export function validateThemeSpecification(input: ThemeSpecificationV2): ThemeSpecificationV2;
export function validateThemeSpecification(input: unknown): ThemeSpecification | ThemeSpecificationV2 | ThemeSpecificationCode;
export function validateThemeSpecification(input: unknown) { return isThemeV2(input) ? (isThemeCode(input) ? validateThemeCode(input) : validateThemeV2(input)) : validateV1(input); }
export function canonicalizeSpecification(input: ThemeSpecificationCode): ReturnType<typeof canonicalizeThemeCode>;
export function canonicalizeSpecification(input: ThemeSpecification): ReturnType<typeof canonicalV1>;
export function canonicalizeSpecification(input: ThemeSpecificationV2): ReturnType<typeof canonicalizeThemeV2>;
export function canonicalizeSpecification(input: unknown): ReturnType<typeof canonicalV1> | ReturnType<typeof canonicalizeThemeV2> | ReturnType<typeof canonicalizeThemeCode>;
export function canonicalizeSpecification(input: unknown) { return isThemeV2(input) ? (isThemeCode(input) ? canonicalizeThemeCode(input) : canonicalizeThemeV2(input)) : canonicalV1(input); }
