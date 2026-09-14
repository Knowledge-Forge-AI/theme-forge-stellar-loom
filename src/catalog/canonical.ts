import { compareUtf8 } from "../design-exchange-v2/canonical.js";
import { computeSha256 } from "../v2/canonical.js";
import { validateThemeCatalog } from "./validator.js";
import type { ThemeSpecificationCatalog } from "./types.js";

/**
 * Deterministically byte-sorts all object keys using UTF-8 code point comparison.
 */
export function sortCatalogKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortCatalogKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareUtf8)
        .map((key) => [
          key,
          sortCatalogKeys((value as Record<string, unknown>)[key]),
        ])
    );
  }
  return value;
}

/**
 * Validates, sorts, and produces canonical JSON and SHA-256 digest for catalog specifications.
 */
export function canonicalizeThemeCatalog(input: unknown): {
  canonicalObject: ThemeSpecificationCatalog;
  canonicalJson: string;
  inputDigest: string;
} {
  const validated = validateThemeCatalog(input);
  const canonicalObject = sortCatalogKeys(validated) as ThemeSpecificationCatalog;
  const canonicalJson = JSON.stringify(canonicalObject, null, 2) + "\n";
  const inputDigest = computeSha256(canonicalJson);

  return { canonicalObject, canonicalJson, inputDigest };
}
