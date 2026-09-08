import { createHash } from "node:crypto";
import { validateThemeSpecification } from "../schema/validator.js";
import type { ThemeSpecification } from "../types.js";

function sortKeysDeep(val: unknown): unknown {
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

export function canonicalizeSpecification(input: unknown): {

  canonicalObject: ThemeSpecification;
  canonicalJson: string;
  inputDigest: string;
} {
  const spec = validateThemeSpecification(input);
  const canonicalObject = sortKeysDeep(spec) as ThemeSpecification;

  // For semantic hashing, exclude non-executing tooling metadata ($schema)
  // so editor metadata references do not mutate the theme's cryptographic digest.
  const semanticPayload: Record<string, unknown> = { ...canonicalObject };
  delete semanticPayload.$schema;
  const sortedSemantic = sortKeysDeep(semanticPayload);
  const canonicalJson = JSON.stringify(sortedSemantic, null, 2) + "\n";
  const inputDigest = createHash("sha256").update(canonicalJson, "utf8").digest("hex");

  return { canonicalObject, canonicalJson, inputDigest };
}


export function computeSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
