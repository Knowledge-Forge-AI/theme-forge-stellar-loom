import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DIGEST_DOMAIN_CANDIDATE_CODE,
  DIGEST_DOMAIN_SYNTAX_CODE,
  DIGEST_DOMAIN_EXECUTABLE_CODE,
  SEMANTIC_COMPILER_CODE,
  MAX_PACKET_BYTES,
} from "./constants.js";
import {
  CODE_CATALOG_DIGEST,
  computeCodeCatalogDigest,
} from "../code/index.js";
import { computeProducerPackageDigest } from "../design-exchange-v2/canonical.js";
import {
  type ThemeCodeCandidatePacket,
  ThemeExchangeCodeValidationError,
} from "./types.js";

const encoder = new TextEncoder();

export function compareUtf8(a: string, b: string): number {
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  const minLen = Math.min(bufA.length, bufB.length);
  for (let i = 0; i < minLen; i++) {
    const byteA = bufA[i] ?? 0;
    const byteB = bufB[i] ?? 0;
    if (byteA !== byteB) {
      return byteA - byteB;
    }
  }
  return bufA.length - bufB.length;
}

/**
 * Recursively sort all object keys by UTF-8 bytes (codepoints)
 */
export function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === "object") {
    const sortedEntries = Object.entries(value)
      .sort(([a], [b]) => compareUtf8(a, b))
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
 * Check if raw text matches exact canonical JSON format without BOM
 */
export function isCanonicalJson(rawText: string): boolean {
  if (rawText.charCodeAt(0) === 0xfeff) return false;
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
    throw new ThemeExchangeCodeValidationError(
      `String at '${fieldPath}' is not in Unicode NFC normalization`,
      "NON_NFC_TEXT",
      fieldPath
    );
  }
  const regex = multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/ : /[\u0000-\u001F\u007F]/;
  if (regex.test(text)) {
    throw new ThemeExchangeCodeValidationError(
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
    assertNfcAndControls(
      value,
      path,
      path.includes("rationale") || path.includes("comment") || path.includes("summary") || path.includes("description")
    );
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
import { assertUniqueJsonKeys as checkDuplicateKeys } from "../code/json.js";
export function assertNoDuplicateKeys(raw: string): void {
  try { checkDuplicateKeys(raw); } catch (error) { throw new ThemeExchangeCodeValidationError((error as Error).message, "DUPLICATE_KEY"); }
}

/**
 * Enforce that no filesystem paths or arbitrary URLs are present in packet
 */
export function assertNoPathsInPacket(value: unknown, path = ""): void {
  if (typeof value === "string") {
    // Allow standard scoped package names like @scope/pkg
    const isPackageName = /^@[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(value);
    // Allow standard relative inventory member identifiers in outputInventory
    const isOutputInventoryId = path.includes("outputInventory") && (
      value.startsWith("styles/") ||
      value.startsWith("fonts/") ||
      value.startsWith("components/") ||
      ["index.js", "index.d.ts", "package.json", "provenance.json", "theme.json", "theme.descriptor.json", "README.md", "LICENSE", "NOTICE", "COMMERCIAL-LICENSE.md"].includes(value)
    );

    if (!isPackageName && !isOutputInventoryId) {
      const isPathLike =
        value.startsWith("/") ||
        value.startsWith("\\") ||
        value.startsWith("./") ||
        value.startsWith(".\\") ||
        value.includes("../") ||
        value.includes("..\\") ||
        /(?:^|\s)(?:\/|[a-zA-Z]:[/\\]|\.\/|\.\.\/)/.test(value) ||
        /(?:^|\s|\/)(?:Users|home|tmp|var|etc|usr|private)[/\\]/i.test(value) ||
        /^[a-zA-Z]:[/\\]/.test(value) ||
        /^(https?|file|ftp):\/\//i.test(value) ||
        (/\.(ttf|otf|woff|woff2|eot|css|json|map|js|ts)$/i.test(value) && (value.includes("/") || value.includes("\\")));

      if (isPathLike) {
        throw new ThemeExchangeCodeValidationError(
          `String at '${path}' contains prohibited path or URL reference: '${value}'`,
          "PATH_FORBIDDEN",
          path
        );
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPathsInPacket(item, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    // Check forbidden path-like keys
    for (const key of Object.keys(value)) {
      if (["path", "filePath", "src", "url", "file"].includes(key)) {
        throw new ThemeExchangeCodeValidationError(
          `Forbidden path key '${key}' found at '${path ? `${path}.${key}` : key}'`,
          "PATH_FORBIDDEN",
          path ? `${path}.${key}` : key
        );
      }
    }
    for (const [key, child] of Object.entries(value)) {
      assertNoPathsInPacket(child, path ? `${path}.${key}` : key);
    }
  }
}

/**
 * Compute SHA-256 digest of syntax configuration
 */
export function computeSyntaxDigest(syntaxTheme: unknown): string {
  const canonical = canonicalJson(syntaxTheme);
  const hash = createHash("sha256")
    .update(DIGEST_DOMAIN_SYNTAX_CODE, "utf8")
    .update(canonical, "utf8")
    .digest("hex");
  return `sha256:${hash}`;
}

/**
 * Compute SHA-256 digest of candidate packet canonical projection excluding candidateDigest
 */
export function computePacketDigestCode(packet: ThemeCodeCandidatePacket | Record<string, unknown>): string {
  const projection = Object.fromEntries(
    Object.entries(packet).filter(([key]) => key !== "candidateDigest")
  );
  const canonical = canonicalJson(projection);
  const hash = createHash("sha256")
    .update(DIGEST_DOMAIN_CANDIDATE_CODE, "utf8")
    .update(canonical, "utf8")
    .digest("hex");
  return `sha256:${hash}`;
}

/**
 * Compute executable identity digest binding actual code compiler behavior and code catalog
 */
export function computeExecutableIdentityDigestCode(): string {
  const hash = createHash("sha256").update(DIGEST_DOMAIN_EXECUTABLE_CODE, "utf8");
  hash.update(`semantic:${SEMANTIC_COMPILER_CODE}\n`);
  hash.update(`catalog:${CODE_CATALOG_DIGEST}\n`);
  try {
    const candidates = [
      new URL("../code/compiler.ts", import.meta.url),
      new URL("../code/compiler.js", import.meta.url),
    ];
    let foundBytes: Buffer | null = null;
    for (const url of candidates) {
      const filePath = fileURLToPath(url);
      if (existsSync(filePath)) {
        foundBytes = readFileSync(filePath);
        break;
      }
    }
    if (foundBytes) {
      hash.update(foundBytes);
    } else {
      hash.update(computeCodeCatalogDigest());
    }
  } catch {
    hash.update(computeCodeCatalogDigest());
  }
  return `sha256:${hash.digest("hex")}`;
}

export { computeProducerPackageDigest };
