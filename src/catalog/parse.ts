import { assertUniqueJsonKeys } from "../code/json.js";
import { validateThemeCatalog } from "./validator.js";
import { ValidationErrorV2 } from "../v2/validator.js";
import type { ThemeSpecificationCatalog } from "./types.js";

/**
 * Bounded JSON transport entry point for catalog themes.
 * Enforces 1 MiB limit, UTF-8 decoding, duplicate key rejection, and full catalog validation.
 */
export function parseThemeCatalog(
  input: string | Uint8Array
): ThemeSpecificationCatalog {
  const bytes =
    typeof input === "string"
      ? Buffer.byteLength(input, "utf8")
      : input.byteLength;

  if (bytes > 1024 * 1024) {
    throw new ValidationErrorV2(
      "Theme catalog input exceeds 1 MiB limit",
      "root",
      "OVERSIZED_INPUT"
    );
  }

  const text =
    typeof input === "string"
      ? input
      : new TextDecoder("utf-8", { fatal: true }).decode(input);

  assertUniqueJsonKeys(text);
  const parsed = JSON.parse(text);
  return validateThemeCatalog(parsed);
}
