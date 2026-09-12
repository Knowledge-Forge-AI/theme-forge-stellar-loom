import { MAX_PACKET_BYTES } from "./constants.js";
import {
  type ThemeCandidateV2Packet,
  ThemeExchangeV2ValidationError,
} from "./types.js";
import {
  canonicalJson,
  isCanonicalJson,
  assertNoDuplicateKeys,
  assertTreeNfcAndControls,
} from "./canonical.js";
import { validateThemeCandidateV2 } from "./validator.js";

const decoder = new TextDecoder("utf-8", { fatal: true });

export function parseThemeExchangeV2(input: string | Uint8Array): ThemeCandidateV2Packet {
  let rawText: string;
  let byteLen: number;

  if (typeof input === "string") {
    byteLen = Buffer.byteLength(input, "utf8");
    rawText = input;
  } else {
    byteLen = input.byteLength;
    try {
      rawText = decoder.decode(input);
    } catch {
      throw new ThemeExchangeV2ValidationError("Invalid UTF-8 encoding in packet", "INVALID_UTF8");
    }
  }

  if (byteLen > MAX_PACKET_BYTES) {
    throw new ThemeExchangeV2ValidationError(
      `Packet size ${byteLen} bytes exceeds maximum limit of ${MAX_PACKET_BYTES} bytes`,
      "PACKET_TOO_LARGE"
    );
  }

  // BOM check
  if (rawText.charCodeAt(0) === 0xfeff) {
    throw new ThemeExchangeV2ValidationError("Packet contains illegal UTF-8 byte order mark (BOM)", "ILLEGAL_BOM");
  }

  // Check duplicate keys
  assertNoDuplicateKeys(rawText);

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err: any) {
    throw new ThemeExchangeV2ValidationError(`Failed to parse packet as JSON: ${err.message}`, "JSON_PARSE_ERROR");
  }

  // Verify canonical representation
  if (!isCanonicalJson(rawText)) {
    throw new ThemeExchangeV2ValidationError(
      "Imported bytes must be canonical UTF-8-key-sorted two-space JSON with one final LF",
      "NON_CANONICAL_JSON"
    );
  }

  // Verify NFC and controls
  assertTreeNfcAndControls(parsed);

  // Validate schema, closed fields, and self-digest
  return validateThemeCandidateV2(parsed);
}

export function serializeThemeExchangeV2(packet: ThemeCandidateV2Packet): string {
  // Validate packet before serialization
  validateThemeCandidateV2(packet);
  return canonicalJson(packet);
}
