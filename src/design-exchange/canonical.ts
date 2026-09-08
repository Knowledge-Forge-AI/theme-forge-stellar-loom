import { createHash } from "node:crypto";
import {
  DIGEST_DOMAIN_BRIEF,
  DIGEST_DOMAIN_CANDIDATE,
  DIGEST_DOMAIN_REVIEW,
  DIGEST_DOMAIN_VISUAL,
  SCHEMA_THEME_BRIEF,
  SCHEMA_THEME_CANDIDATE,
  SCHEMA_THEME_REVIEW,
  MAX_PACKET_BYTES,
} from "./constants.js";
import {
  type ThemeExchangePacket,
  type ThemeVisualRecord,
  ThemeExchangeValidationError,
} from "./types.js";

/**
 * Recursively sort all object keys by UTF-8 bytes (codepoints)
 */
export function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === "object") {
    const sortedEntries = Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => [key, sortJson(child)]);
    return Object.fromEntries(sortedEntries);
  }
  return value;
}

/**
 * Return canonical UTF-8-key-sorted, 2-space indented JSON with a final LF
 */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

/**
 * Check if raw text or bytes matches exact canonical JSON format without BOM
 */
export function isCanonicalJson(rawText: string): boolean {
  if (rawText.charCodeAt(0) === 0xfeff) return false; // BOM
  if (!rawText.endsWith("\n") || rawText.endsWith("\n\n") || rawText.includes("\r")) return false;
  try {
    const parsed = JSON.parse(rawText);
    const reencoded = canonicalJson(parsed);
    return rawText === reencoded;
  } catch {
    return false;
  }
}

/**
 * Ensure string is in Unicode NFC normalization and contains no prohibited C0 controls or DEL
 */
export function assertNfcAndControls(text: string, fieldPath: string, multiline = false): void {
  if (text.normalize("NFC") !== text) {
    throw new ThemeExchangeValidationError(
      `String at '${fieldPath}' is not in Unicode NFC normalization`,
      "NON_NFC_TEXT",
      fieldPath
    );
  }
  // Disallow NUL, DEL (0x7F), and C0 controls (0x00-0x1F) except LF (0x0A) if multiline
  const regex = multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/ : /[\u0000-\u001F\u007F]/;
  if (regex.test(text)) {
    throw new ThemeExchangeValidationError(
      `String at '${fieldPath}' contains prohibited control characters`,
      "PROHIBITED_CONTROLS",
      fieldPath
    );
  }
}

/**
 * Recursively check all strings in an object for NFC normalization and prohibited controls
 */
export function assertTreeNfcAndControls(value: unknown, path = ""): void {
  if (typeof value === "string") {
    assertNfcAndControls(value, path, path.includes("rationale") || path.includes("goal") || path.includes("summary") || path.includes("comment") || path.includes("compiledCss"));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertTreeNfcAndControls(item, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      assertTreeNfcAndControls(child, childPath);
    }
  }
}

/**
 * Lexical scan for duplicate keys in JSON
 */
export function assertNoDuplicateKeys(jsonText: string): void {
  if (Buffer.byteLength(jsonText, "utf8") > MAX_PACKET_BYTES) {
    throw new ThemeExchangeValidationError("Packet exceeds maximum byte limit", "PACKET_TOO_LARGE");
  }

  const stack: Set<string>[] = [];
  let inString = false;
  let isEscaped = false;
  let currentString = "";
  let i = 0;
  const len = jsonText.length;

  while (i < len) {
    const char = jsonText[i];

    if (inString) {
      if (isEscaped) {
        currentString += char;
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
        currentString += char;
      } else if (char === '"') {
        inString = false;
        // String ended. Look ahead to see if this string is an object key
        let j = i + 1;
        while (j < len && (jsonText[j] === " " || jsonText[j] === "\t" || jsonText[j] === "\n" || jsonText[j] === "\r")) {
          j++;
        }
        if (j < len && jsonText[j] === ":") {
          // It's a key!
          if (stack.length > 0) {
            const currentScope = stack[stack.length - 1];
            if (currentScope.has(currentString)) {
              throw new ThemeExchangeValidationError(
                `Duplicate key '${currentString}' found in JSON object`,
                "DUPLICATE_KEY"
              );
            }
            currentScope.add(currentString);
          }
        }
        currentString = "";
      } else {
        currentString += char;
      }
    } else {
      if (char === '"') {
        inString = true;
        currentString = "";
      } else if (char === "{") {
        stack.push(new Set<string>());
      } else if (char === "}") {
        stack.pop();
      }
    }
    i++;
  }
}

/**
 * Compute SHA-256 digest of a packet's canonical projection
 */
export function computePacketDigest(packet: ThemeExchangePacket): string {
  let domain: string;
  let excludedField: string;

  if (packet.schema === SCHEMA_THEME_BRIEF) {
    domain = DIGEST_DOMAIN_BRIEF;
    excludedField = "briefDigest";
  } else if (packet.schema === SCHEMA_THEME_CANDIDATE) {
    domain = DIGEST_DOMAIN_CANDIDATE;
    excludedField = "candidateDigest";
  } else if (packet.schema === SCHEMA_THEME_REVIEW) {
    domain = DIGEST_DOMAIN_REVIEW;
    excludedField = "reviewDigest";
  } else {
    throw new ThemeExchangeValidationError(`Unknown packet schema: ${(packet as any).schema}`, "UNKNOWN_SCHEMA");
  }

  const projection = Object.fromEntries(
    Object.entries(packet).filter(([key]) => key !== excludedField)
  );

  const canonical = canonicalJson(projection);
  const hash = createHash("sha256")
    .update(domain, "utf8")
    .update(canonical, "utf8")
    .digest("hex");

  return `sha256:${hash}`;
}

/**
 * Compute SHA-256 digest of a visual record's canonical projection
 */
export function computeVisualEvidenceDigest(record: ThemeVisualRecord): string {
  const projection = Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== "evidenceDigest" && key !== "bytesBase64")
  );

  const canonical = canonicalJson(projection);
  const hash = createHash("sha256")
    .update(DIGEST_DOMAIN_VISUAL, "utf8")
    .update(canonical, "utf8")
    .digest("hex");

  return `sha256:${hash}`;
}
