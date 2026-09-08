import { MAX_PACKET_BYTES } from "./constants.js";
import {
  type ThemeExchangePacket,
  type ThemeExchangePacketKind,
  ThemeExchangeValidationError,
} from "./types.js";
import {
  canonicalJson,
  isCanonicalJson,
  assertNoDuplicateKeys,
  assertTreeNfcAndControls,
} from "./canonical.js";
import { validateThemeExchangePacket } from "./validator.js";

const decoder = new TextDecoder("utf-8", { fatal: true });

export function parseThemeExchangePacket(
  input: string | Uint8Array,
  expectedKind?: ThemeExchangePacketKind
): ThemeExchangePacket {
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
      throw new ThemeExchangeValidationError("Invalid UTF-8 encoding in packet", "INVALID_UTF8");
    }
  }

  if (byteLen > MAX_PACKET_BYTES) {
    throw new ThemeExchangeValidationError(
      `Packet size ${byteLen} bytes exceeds maximum limit of ${MAX_PACKET_BYTES} bytes`,
      "PACKET_TOO_LARGE"
    );
  }

  // BOM check
  if (rawText.charCodeAt(0) === 0xfeff) {
    throw new ThemeExchangeValidationError("Packet contains illegal UTF-8 byte order mark (BOM)", "ILLEGAL_BOM");
  }

  // Check duplicate keys
  assertNoDuplicateKeys(rawText);

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err: any) {
    throw new ThemeExchangeValidationError(`Failed to parse packet as JSON: ${err.message}`, "JSON_PARSE_ERROR");
  }

  // Verify canonical representation
  if (!isCanonicalJson(rawText)) {
    throw new ThemeExchangeValidationError(
      "Imported bytes must be canonical UTF-8-key-sorted two-space JSON with one final LF",
      "NON_CANONICAL_JSON"
    );
  }

  // Verify NFC and no prohibited control characters across tree
  assertTreeNfcAndControls(parsed);

  // Validate schema, bounds, and self-digest
  const packet = validateThemeExchangePacket(parsed);

  if (expectedKind) {
    const actualKind: ThemeExchangePacketKind =
      packet.schema === "tfsl.theme-brief"
        ? "brief"
        : packet.schema === "tfsl.theme-candidate"
        ? "candidate"
        : "review";
    if (actualKind !== expectedKind) {
      throw new ThemeExchangeValidationError(
        `Expected packet kind '${expectedKind}' but got '${actualKind}'`,
        "KIND_MISMATCH"
      );
    }
  }

  return packet;
}

export function serializeThemeExchangePacket(packet: ThemeExchangePacket): string {
  // Re-validate packet before serialization
  validateThemeExchangePacket(packet);
  return canonicalJson(packet);
}
