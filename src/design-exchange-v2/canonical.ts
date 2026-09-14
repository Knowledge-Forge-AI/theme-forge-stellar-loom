import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DIGEST_DOMAIN_CANDIDATE_V2,
  DIGEST_DOMAIN_EXECUTABLE_V2,
  SEMANTIC_COMPILER_V2,
  MAX_PACKET_BYTES,
} from "./constants.js";
import { CATALOG_DIGEST, computeCatalogDigest, STYLE_FILES } from "../v2/index.js";
import {
  type ThemeCandidateV2Packet,
  ThemeExchangeV2ValidationError,
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
    throw new ThemeExchangeV2ValidationError(
      `String at '${fieldPath}' is not in Unicode NFC normalization`,
      "NON_NFC_TEXT",
      fieldPath
    );
  }
  const regex = multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/ : /[\u0000-\u001F\u007F]/;
  if (regex.test(text)) {
    throw new ThemeExchangeV2ValidationError(
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
    assertNfcAndControls(value, path, path.includes("rationale") || path.includes("comment") || path.includes("summary"));
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
    throw new ThemeExchangeV2ValidationError("Packet exceeds maximum byte limit", "PACKET_TOO_LARGE");
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
        let j = i + 1;
        while (j < len && (jsonText[j] === " " || jsonText[j] === "\t" || jsonText[j] === "\n" || jsonText[j] === "\r")) {
          j++;
        }
        if (j < len && jsonText[j] === ":") {
          if (stack.length > 0) {
            const currentScope = stack[stack.length - 1]!;
            if (currentScope.has(currentString)) {
              throw new ThemeExchangeV2ValidationError(
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
 * Enforce that no filesystem paths or arbitrary URLs are present in packet
 */
export function assertNoPathsInPacket(value: unknown, path = ""): void {
  if (typeof value === "string") {
    // Check if value looks like a filesystem path or URL
    // Allow standard scoped package names like @scope/pkg
    const isPackageName = /^@[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(value);
    // Allow standard stylesheet identifiers in outputInventory
    const isOutputInventoryId = path.includes("outputInventory") && (STYLE_FILES as readonly string[]).includes(value);
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
        throw new ThemeExchangeV2ValidationError(
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
        throw new ThemeExchangeV2ValidationError(
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
 * Compute SHA-256 digest of candidate packet canonical projection excluding candidateDigest
 */
export function computePacketDigestV2(packet: ThemeCandidateV2Packet | Record<string, unknown>): string {
  const projection = Object.fromEntries(
    Object.entries(packet).filter(([key]) => key !== "candidateDigest")
  );
  const canonical = canonicalJson(projection);
  const hash = createHash("sha256")
    .update(DIGEST_DOMAIN_CANDIDATE_V2, "utf8")
    .update(canonical, "utf8")
    .digest("hex");
  return `sha256:${hash}`;
}

/**
 * Compute executable identity digest binding actual compiler behavior and catalog
 */
export function computeExecutableIdentityDigest(): string {
  const hash = createHash("sha256").update(DIGEST_DOMAIN_EXECUTABLE_V2, "utf8");
  hash.update(`semantic:${SEMANTIC_COMPILER_V2}\n`);
  hash.update(`catalog:${CATALOG_DIGEST}\n`);
  try {
    const candidates = [
      new URL("../v2/compiler.ts", import.meta.url),
      new URL("../v2/compiler.js", import.meta.url),
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
      hash.update(computeCatalogDigest());
    }
  } catch {
    hash.update(computeCatalogDigest());
  }
  return `sha256:${hash.digest("hex")}`;
}

/** Digest of the installed producer package metadata and executable dist/bin inventory.
 * Excludes source, examples and packets; a tarball digest is an external receipt.
 */
export function computeProducerPackageDigest(): string {
  const root = new URL("../../", import.meta.url);
  const records: { path: string; sha256: string }[] = [];
  const visit = (name: string): void => {
    for (const entry of readdirSync(new URL(name + "/", root), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("Producer inventory must not contain symlinks");
      const path = name + "/" + entry.name;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) records.push({ path, sha256: createHash("sha256").update(readFileSync(new URL(path, root))).digest("hex") });
    }
  };
  for (const name of ["dist", "bin"]) visit(name);
  records.push({ path: "package.json", sha256: createHash("sha256").update(readFileSync(new URL("package.json", root))).digest("hex") });
  records.sort((a, b) => compareUtf8(a.path, b.path));
  return "sha256:" + createHash("sha256").update("tfsl.producer-package-inventory-v2\n" + JSON.stringify(records)).digest("hex");
}
