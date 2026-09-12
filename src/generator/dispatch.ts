import { isThemeCode } from "../code/index.js";
import { generateThemePackageCode, type GeneratePackageCodeResult } from "./code-emitter.js";
import { generateThemePackage as generateV1 } from "./emitter.js";
import { writeThemePackage as writeV1 } from "./writer.js";
import { generateThemePackageV2, type GeneratePackageV2Options, type GeneratePackageV2Result } from "./v2-emitter.js";
import { writeV2Files } from "./v2-writer.js";
import type { GeneratePackageOptions, GeneratePackageResult, WritePackageOptions, WritePackageResult } from "./types.js";
import type { ThemeSpecificationV2 } from "../v2/index.js";
import { isThemeV2 } from "../public-api.js";

export function generateThemePackage(options: GeneratePackageV2Options & { themeSpec: ThemeSpecificationV2 }): GeneratePackageV2Result;
export function generateThemePackage(options: GeneratePackageOptions): GeneratePackageResult;
export function generateThemePackage(options: GeneratePackageV2Options): GeneratePackageResult | GeneratePackageV2Result | GeneratePackageCodeResult;
export function generateThemePackage(options: GeneratePackageV2Options) {
  return isThemeV2(options.themeSpec) ? (isThemeCode(options.themeSpec) ? generateThemePackageCode(options) : generateThemePackageV2(options)) : generateV1(options);
}
export function writeThemePackage(result: GeneratePackageCodeResult, outDir: string, options?: WritePackageOptions): Promise<{ outDir: string; filesWritten: string[]; filesPruned: string[]; result: GeneratePackageCodeResult }>;
export function writeThemePackage(result: GeneratePackageResult, outDir: string, options?: WritePackageOptions): Promise<WritePackageResult>;
export function writeThemePackage(result: GeneratePackageV2Result, outDir: string, options?: WritePackageOptions): Promise<{ outDir: string; filesWritten: string[]; filesPruned: string[]; result: GeneratePackageV2Result }>;
export function writeThemePackage(result: GeneratePackageResult | GeneratePackageV2Result | GeneratePackageCodeResult, outDir: string, options?: WritePackageOptions): Promise<{ outDir: string; filesWritten: string[]; filesPruned: string[]; result: GeneratePackageResult | GeneratePackageV2Result | GeneratePackageCodeResult }>;
export async function writeThemePackage(result: GeneratePackageResult | GeneratePackageV2Result | GeneratePackageCodeResult, outDir: string, options?: WritePackageOptions): Promise<{ outDir: string; filesWritten: string[]; filesPruned: string[]; result: any }> {
  if (result.provenance.schema === "tfsl.package-provenance-v1") return writeV1(result as GeneratePackageResult, outDir, options);
  const filesWritten = await writeV2Files(result.files, outDir, options);
  return { outDir, filesWritten, filesPruned: [], result };
}
