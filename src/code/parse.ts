import { assertUniqueJsonKeys as assertNoDuplicateKeys } from "./json.js";
import { validateThemeCode } from "./validator.js";

/** Bounded JSON transport entry point for code-enabled themes. */
export function parseThemeCode(input: string | Uint8Array) {
  const bytes = typeof input === "string" ? Buffer.byteLength(input, "utf8") : input.byteLength;
  if (bytes > 1024 * 1024) throw new Error("Code theme input exceeds 1 MiB");
  const text = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true }).decode(input);
  assertNoDuplicateKeys(text);
  return validateThemeCode(JSON.parse(text));
}
