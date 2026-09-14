import { MAX_PACKET_BYTES } from "./constants.js";
import {
  type ThemeCodeCandidatePacket,
  ThemeExchangeCodeValidationError,
} from "./types.js";
import {
  canonicalJson,
  isCanonicalJson,
  assertNoDuplicateKeys,
  assertTreeNfcAndControls,
} from "./canonical.js";
import { validateThemeCodeCandidate } from "./validator.js";

const decoder = new TextDecoder("utf-8", { fatal: true });

export function parseThemeCodeCandidate(input: string | Uint8Array): ThemeCodeCandidatePacket {
  let rawText: string;
  let byteLen: number;

  if (typeof input === "string") {
    byteLen = Buffer.byteLength(input, "utf8");
    rawText = input;
  } else {
    byteLen = input.byteLength;
    if (byteLen > MAX_PACKET_BYTES) throw new ThemeExchangeCodeValidationError("Packet exceeds byte limit", "PACKET_TOO_LARGE");
    try {
      rawText = decoder.decode(input);
    } catch {
      throw new ThemeExchangeCodeValidationError("Invalid UTF-8 encoding in packet", "INVALID_UTF8");
    }
  }

  if (byteLen > MAX_PACKET_BYTES) {
    throw new ThemeExchangeCodeValidationError(
      `Packet size ${byteLen} bytes exceeds maximum limit of ${MAX_PACKET_BYTES} bytes`,
      "PACKET_TOO_LARGE"
    );
  }

  // BOM check
  if (rawText.charCodeAt(0) === 0xfeff) {
    throw new ThemeExchangeCodeValidationError("Packet contains illegal UTF-8 byte order mark (BOM)", "ILLEGAL_BOM");
  }

  // Check duplicate keys
  assertNoDuplicateKeys(rawText);

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err: any) {
    throw new ThemeExchangeCodeValidationError(`Failed to parse packet as JSON: ${err.message}`, "JSON_PARSE_ERROR");
  }

  validateThemeCodeCandidate(parsed);

  // Verify canonical representation
  if (!isCanonicalJson(rawText)) {
    throw new ThemeExchangeCodeValidationError(
      "Imported bytes must be canonical UTF-8-key-sorted two-space JSON with one final LF",
      "NON_CANONICAL_JSON"
    );
  }

  // Verify NFC and controls
  assertTreeNfcAndControls(parsed);

  // Validate schema, closed fields, and self-digest against own closed validator
  return validateThemeCodeCandidate(parsed);
}

export function serializeThemeCodeCandidate(packet: ThemeCodeCandidatePacket): string {
  // Validate packet before serialization
  validateThemeCodeCandidate(packet);
  return canonicalJson(packet);
}
