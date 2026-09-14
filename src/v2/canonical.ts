import { createHash } from "node:crypto";
import { validateThemeV2 } from "./validator.js";
import type { ThemeSpecificationV2 } from "./types.js";

export function sortKeysDeep(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map(sortKeysDeep);
  }
  if (val !== null && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj).sort();
    for (const key of keys) {
      sorted[key] = sortKeysDeep(obj[key]);
    }
    return sorted;
  }
  return val;
}

export function computeSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function canonicalizeThemeV2(input: unknown): {
  canonicalObject: ThemeSpecificationV2;
  canonicalJson: string;
  inputDigest: string;
} {
  const spec = validateThemeV2(input);
  const canonicalObject = sortKeysDeep(spec) as ThemeSpecificationV2;

  const canonicalJson = JSON.stringify(canonicalObject, null, 2) + "\n";
  const inputDigest = computeSha256(canonicalJson);

  return { canonicalObject, canonicalJson, inputDigest };
}
