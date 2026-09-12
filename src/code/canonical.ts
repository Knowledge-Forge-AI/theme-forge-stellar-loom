import { compareUtf8 } from "../design-exchange-v2/canonical.js";
import { computeSha256 } from "../v2/canonical.js";
import { validateThemeCode } from "./validator.js";
import type { ThemeSpecificationCode } from "./types.js";

export function sortCodeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCodeKeys);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort(compareUtf8).map(key => [key, sortCodeKeys((value as Record<string, unknown>)[key])]));
  return value;
}

export function canonicalizeThemeCode(input: unknown): {
  canonicalObject: ThemeSpecificationCode;
  canonicalJson: string;
  inputDigest: string;
} {
  const spec = validateThemeCode(input);
  const canonicalObject = sortCodeKeys(spec) as ThemeSpecificationCode;

  const canonicalJson = JSON.stringify(canonicalObject, null, 2) + "\n";
  const inputDigest = computeSha256(canonicalJson);

  return { canonicalObject, canonicalJson, inputDigest };
}
