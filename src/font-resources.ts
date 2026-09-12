import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, join, parse, resolve } from "node:path";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

/**
 * Minimal font resource declaration interface.
 * Broader v2 fonts (including family, style, weight, license, etc.) are structurally compatible.
 */
export interface FontResourceDeclaration {
  readonly id: string;
  readonly format: "woff" | "woff2";
  readonly sha256: string;
}

export class FontResourceError extends Error {
  constructor(
    message: string,
    public readonly code: string = "FONT_RESOURCE_ERROR"
  ) {
    super(message);
    this.name = "FontResourceError";
  }
}

export const MAX_FONT_DECLARATIONS = 8;
export const MAX_PER_FONT_BYTES = 4 * 1024 * 1024; // 4 MiB = 4,194,304 bytes
export const MAX_AGGREGATE_BYTES = 16 * 1024 * 1024; // 16 MiB = 16,777,216 bytes

const MAX_ID_LENGTH = 64;
const FONT_ID_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
const ALLOWED_FORMATS: ReadonlySet<string> = new Set(["woff", "woff2"]);
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/i;

const FORBIDDEN_PROTOTYPE_NAMES: ReadonlySet<string> = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "apply",
  "bind",
  "call",
  "name",
  "length",
  "caller",
  "callee",
  "arguments",
]);

function isPrototypeName(name: string): boolean {
  if (FORBIDDEN_PROTOTYPE_NAMES.has(name)) return true;
  if (name in Object.prototype) return true;
  if (name in Array.prototype) return true;
  if (name in Function.prototype) return true;
  return false;
}

export function validateFontId(id: string): void {
  if (typeof id !== "string" || id.length === 0) {
    throw new FontResourceError("Font ID must be a non-empty string", "INVALID_ID");
  }

  if (id.length > MAX_ID_LENGTH) {
    throw new FontResourceError(
      `Font ID '${id}' exceeds maximum length of ${MAX_ID_LENGTH} characters`,
      "INVALID_ID"
    );
  }

  if (isPrototypeName(id)) {
    throw new FontResourceError(
      `Font ID cannot use prototype property name '${id}'`,
      "PROTOTYPE_NAME_FORBIDDEN"
    );
  }

  if (!FONT_ID_REGEX.test(id)) {
    throw new FontResourceError(
      `Font ID '${id}' is invalid: must be bounded lowercase alphanumeric with hyphens or underscores (no uppercase, dots, slashes, or special characters)`,
      "INVALID_ID"
    );
  }
}

/**
 * Allowed system root symlink prefixes on macOS and UNIX.
 * On macOS: /var -> private/var, /tmp -> private/tmp, /etc -> private/etc.
 * Normalization via realpath is allowed ONLY for these exact system roots.
 */
const ALLOWED_SYSTEM_ROOT_SYMLINKS = ["/var", "/tmp", "/etc"];

/**
 * Validates that root is an existing directory, contains no path traversal ('..'),
 * and contains no symbolic links in any non-system ancestors or the root itself.
 * Normalization using realpath is allowed only for known exact system roots (/var, /tmp, /etc).
 * Any other symbolic link in any ancestor segment or the root itself is strictly rejected.
 */
export async function validateAndInspectRoot(root: string): Promise<string> {
  if (typeof root !== "string" || root.trim().length === 0) {
    throw new FontResourceError("Root directory path cannot be empty", "INVALID_ROOT");
  }

  // Reject traversal tokens in the raw input path
  const rawSegments = root.split(/[/\\]/);
  if (rawSegments.some((seg) => seg === "..")) {
    throw new FontResourceError(
      `Root directory path contains forbidden traversal segment '..': '${root}'`,
      "TRAVERSAL_DETECTED"
    );
  }

  let absolute = resolve(root);

  // Normalize allowed macOS system root symlink prefix if present
  for (const sysRoot of ALLOWED_SYSTEM_ROOT_SYMLINKS) {
    if (absolute === sysRoot || absolute.startsWith(sysRoot + "/")) {
      try {
        const sysStat = await lstat(sysRoot);
        if (sysStat.isSymbolicLink()) {
          const canonicalSysRoot = await realpath(sysRoot);
          absolute = canonicalSysRoot + absolute.slice(sysRoot.length);
        }
      } catch {
        // If system root cannot be statted, subsequent check will catch missing path
      }
      break;
    }
  }

  // Walk every segment from filesystem root down to target directory
  const parsed = parse(absolute);
  let current = parsed.root;
  const parts = absolute.slice(current.length).split("/").filter(Boolean);

  for (const part of parts) {
    current = join(current, part);
    let st;
    try {
      st = await lstat(current);
    } catch (err: any) {
      if (err.code === "ENOENT" || err.code === "ENOTDIR") {
        throw new FontResourceError(
          `Root directory path does not exist: '${current}'`,
          "INVALID_ROOT"
        );
      }
      throw new FontResourceError(
        `Failed to inspect path segment '${current}': ${err.message}`,
        "INVALID_ROOT"
      );
    }

    if (st.isSymbolicLink()) {
      throw new FontResourceError(
        `Symbolic link rejected in root ancestor path: '${current}'`,
        "SYMLINK_REJECTED"
      );
    }

    if (!st.isDirectory()) {
      throw new FontResourceError(
        `Path segment is not a directory: '${current}'`,
        "NOT_A_DIRECTORY"
      );
    }
  }

  // Final check on canonical destination
  let destStat;
  try {
    destStat = await lstat(current);
  } catch (err: any) {
    throw new FontResourceError(
      `Root directory does not exist: '${current}'`,
      "INVALID_ROOT"
    );
  }

  if (destStat.isSymbolicLink()) {
    throw new FontResourceError(
      `Root directory cannot be a symbolic link: '${current}'`,
      "SYMLINK_REJECTED"
    );
  }

  if (!destStat.isDirectory()) {
    throw new FontResourceError(
      `Root path is not a directory: '${current}'`,
      "NOT_A_DIRECTORY"
    );
  }

  return current;
}

/**
 * Materializes package-local font resources from an explicitly selected root directory.
 *
 * Requirements:
 * - Declarations define minimal font resources { id, format, sha256 }.
 * - selectedIds must exactly cover declarations with no duplicates, extras, or unselected entries.
 * - Maximum 8 font resources.
 * - Maximum 4 MiB per font resource, maximum 16 MiB aggregate across all resources.
 * - Leaves are strictly fixed at `${id}.${format}` directly under root (no subdirectories or traversal).
 * - Safe lowercase alphanumeric IDs with hyphens/underscores, bounded length (<= 64), excluding prototype names.
 * - No symlink following on any non-system ancestors or leaves (macOS /var,/tmp system symlink normalization
 *   allowed only for known exact roots via realpath).
 * - Validates root directory, opens leaves with O_NOFOLLOW, takes regular file stat snapshot before and after
 *   bounded reads, and rejects changed file identity or SHA-256 digest mismatch.
 * - Never executes providers or performs network fetches.
 * - Returns copied bytes (independent Uint8Array) in a ReadonlyMap mapping ID to bytes.
 */
export async function materializeFontResources(
  root: string,
  declarations: readonly FontResourceDeclaration[],
  selectedIds: readonly string[]
): Promise<ReadonlyMap<string, Uint8Array>> {
  if (!Array.isArray(declarations)) {
    throw new FontResourceError("declarations must be an array", "INVALID_DECLARATION");
  }
  if (!Array.isArray(selectedIds)) {
    throw new FontResourceError("selectedIds must be an array", "INVALID_SELECTED_IDS");
  }

  if (declarations.length > MAX_FONT_DECLARATIONS) {
    throw new FontResourceError(
      `Number of font declarations (${declarations.length}) exceeds maximum limit of ${MAX_FONT_DECLARATIONS}`,
      "TOO_MANY_FONTS"
    );
  }

  if (selectedIds.length > MAX_FONT_DECLARATIONS) {
    throw new FontResourceError(
      `Number of selected font IDs (${selectedIds.length}) exceeds maximum limit of ${MAX_FONT_DECLARATIONS}`,
      "TOO_MANY_FONTS"
    );
  }

  // 1. Validate selectedIds for valid syntax and duplicates
  const seenSelectedIds = new Set<string>();
  for (const id of selectedIds) {
    validateFontId(id);
    if (seenSelectedIds.has(id)) {
      throw new FontResourceError(
        `Duplicate font ID '${id}' found in selectedIds`,
        "DUPLICATE_ID"
      );
    }
    seenSelectedIds.add(id);
  }

  // 2. Validate declarations for valid syntax, formats, digests, and duplicates
  const declMap = new Map<string, FontResourceDeclaration>();
  for (const decl of declarations) {
    if (!decl || typeof decl !== "object") {
      throw new FontResourceError(
        "Font declaration must be a valid non-null object",
        "INVALID_DECLARATION"
      );
    }
    validateFontId(decl.id);
    if (declMap.has(decl.id)) {
      throw new FontResourceError(
        `Duplicate font declaration ID '${decl.id}'`,
        "DUPLICATE_ID"
      );
    }
    if (!ALLOWED_FORMATS.has(decl.format)) {
      throw new FontResourceError(
        `Invalid font format '${decl.format}' for font '${decl.id}': must be 'woff' or 'woff2'`,
        "INVALID_FORMAT"
      );
    }
    if (typeof decl.sha256 !== "string" || !SHA256_HEX_REGEX.test(decl.sha256)) {
      throw new FontResourceError(
        `Invalid SHA-256 digest '${decl.sha256}' for font '${decl.id}': must be 64 hexadecimal characters`,
        "INVALID_SHA256"
      );
    }
    declMap.set(decl.id, decl);
  }

  // 3. selectedIds must exactly cover declarations with no dupes, extras, or missing
  for (const declId of declMap.keys()) {
    if (!seenSelectedIds.has(declId)) {
      throw new FontResourceError(
        `Font declaration '${declId}' is unselected (not present in selectedIds)`,
        "UNSELECTED_DECLARATION"
      );
    }
  }

  for (const selectedId of seenSelectedIds) {
    if (!declMap.has(selectedId)) {
      throw new FontResourceError(
        `Selected font ID '${selectedId}' has no matching declaration in declarations`,
        "MISSING_DECLARATION"
      );
    }
  }

  // 4. Validate and canonicalize root directory
  const canonicalRoot = await validateAndInspectRoot(root);

  // 5. Materialize and verify each font resource
  const resultMap = new Map<string, Uint8Array>();
  let aggregateBytes = 0;

  for (const id of selectedIds) {
    const decl = declMap.get(id)!;
    const leafName = `${decl.id}.${decl.format}`;

    // Ensure fixed leaf name directly under root
    if (
      basename(leafName) !== leafName ||
      leafName.includes("/") ||
      leafName.includes("\\") ||
      leafName.includes("..")
    ) {
      throw new FontResourceError(
        `Path traversal detected in leaf name '${leafName}'`,
        "TRAVERSAL_DETECTED"
      );
    }

    const leafPath = join(canonicalRoot, leafName);

    // Initial inspection via lstat (reject symlinks and non-regular files before open)
    let initialStat;
    try {
      initialStat = await lstat(leafPath);
    } catch (err: any) {
      if (err.code === "ENOENT") {
        throw new FontResourceError(
          `Font file '${leafName}' not found in root directory '${root}'`,
          "MISSING_FONT_FILE"
        );
      }
      throw new FontResourceError(
        `Failed to inspect font file '${leafName}': ${err.message}`,
        "INSPECTION_FAILED"
      );
    }

    if (initialStat.isSymbolicLink()) {
      throw new FontResourceError(
        `Font file '${leafName}' is a symbolic link; symlink leaves are strictly forbidden`,
        "SYMLINK_REJECTED"
      );
    }

    if (!initialStat.isFile()) {
      throw new FontResourceError(
        `Font resource '${leafName}' is not a regular file`,
        "NOT_A_REGULAR_FILE"
      );
    }

    if (initialStat.size === 0) throw new FontResourceError("Empty font resource", "EMPTY_FONT_RESOURCE");
    if (initialStat.size > MAX_PER_FONT_BYTES) {
      throw new FontResourceError(
        `Font file '${leafName}' size (${initialStat.size} bytes) exceeds per-font maximum limit of 4 MiB (${MAX_PER_FONT_BYTES} bytes)`,
        "FONT_TOO_LARGE"
      );
    }

    if (aggregateBytes + initialStat.size > MAX_AGGREGATE_BYTES) {
      throw new FontResourceError(
        `Aggregate font size (${aggregateBytes + initialStat.size} bytes) exceeds maximum limit of 16 MiB (${MAX_AGGREGATE_BYTES} bytes)`,
        "AGGREGATE_TOO_LARGE"
      );
    }

    // Open leaf file with O_NOFOLLOW to guard against symlink replacement races
    let handle;
    try {
      handle = await open(leafPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (err: any) {
      if (err.code === "ELOOP" || err.code === "SYMLINK") {
        throw new FontResourceError(
          `Font file '${leafName}' is a symbolic link (detected via O_NOFOLLOW)`,
          "SYMLINK_REJECTED"
        );
      }
      throw new FontResourceError(
        `Failed to open font file '${leafName}': ${err.message}`,
        "OPEN_FAILED"
      );
    }

    try {
      // Stat snapshot before read
      const statBefore = await handle.stat();
      if (!statBefore.isFile()) {
        throw new FontResourceError(
          `Font resource '${leafName}' is not a regular file (stat before read)`,
          "NOT_A_REGULAR_FILE"
        );
      }
      if (statBefore.size === 0) throw new FontResourceError("Empty font resource", "EMPTY_FONT_RESOURCE");
    if (statBefore.size > MAX_PER_FONT_BYTES) {
        throw new FontResourceError(
          `Font file '${leafName}' size (${statBefore.size} bytes) exceeds per-font maximum limit of 4 MiB (${MAX_PER_FONT_BYTES} bytes)`,
          "FONT_TOO_LARGE"
        );
      }
      if (aggregateBytes + statBefore.size > MAX_AGGREGATE_BYTES) {
        throw new FontResourceError(
          `Aggregate font size (${aggregateBytes + statBefore.size} bytes) exceeds maximum limit of 16 MiB (${MAX_AGGREGATE_BYTES} bytes)`,
          "AGGREGATE_TOO_LARGE"
        );
      }

      // Check identity match against initial lstat
      if (statBefore.dev !== initialStat.dev || statBefore.ino !== initialStat.ino) {
        throw new FontResourceError(
          `Font file '${leafName}' identity changed between initial inspection and open`,
          "FILE_MODIFIED"
        );
      }

      // Bounded read into allocated buffer
      const buffer = Buffer.alloc(statBefore.size);
      let bytesRead = 0;
      while (bytesRead < statBefore.size) {
        const result = await handle.read(
          buffer,
          bytesRead,
          statBefore.size - bytesRead,
          bytesRead
        );
        if (result.bytesRead === 0) {
          throw new FontResourceError(
            `Unexpected EOF while reading font file '${leafName}' (expected ${statBefore.size} bytes, got ${bytesRead})`,
            "READ_FAILED"
          );
        }
        bytesRead += result.bytesRead;
      }

      // Probe for unexpected trailing bytes
      const probe = Buffer.alloc(1);
      const probeResult = await handle.read(probe, 0, 1, statBefore.size);
      if (probeResult.bytesRead > 0) {
        throw new FontResourceError(
          `Font file '${leafName}' grew concurrently during read`,
          "FILE_MODIFIED"
        );
      }

      // Stat snapshot after read
      const statAfter = await handle.stat();
      if (
        statAfter.dev !== statBefore.dev ||
        statAfter.ino !== statBefore.ino ||
        statAfter.size !== statBefore.size ||
        statAfter.mtimeMs !== statBefore.mtimeMs ||
        statAfter.ctimeMs !== statBefore.ctimeMs
      ) {
        throw new FontResourceError(
          `Font file '${leafName}' stat snapshot changed during reading`,
          "FILE_MODIFIED"
        );
      }

      // Digest verification
      const actualDigest = createHash("sha256").update(buffer).digest("hex");
      if (actualDigest.toLowerCase() !== decl.sha256.toLowerCase()) {
        throw new FontResourceError(
          `SHA-256 digest mismatch for font '${decl.id}': expected '${decl.sha256.toLowerCase()}', got '${actualDigest.toLowerCase()}'`,
          "DIGEST_MISMATCH"
        );
      }

      // Defensive copy: return isolated Uint8Array
      const copiedBytes = new Uint8Array(buffer.byteLength);
      copiedBytes.set(buffer);

      aggregateBytes += copiedBytes.byteLength;
      resultMap.set(decl.id, copiedBytes);
    } finally {
      await handle.close();
    }
  }

  // Prevent modifications to returned Map
  resultMap.set = () => {
    throw new TypeError("ReadonlyMap cannot be modified");
  };
  resultMap.delete = () => {
    throw new TypeError("ReadonlyMap cannot be modified");
  };
  resultMap.clear = () => {
    throw new TypeError("ReadonlyMap cannot be modified");
  };
  Object.freeze(resultMap);

  return resultMap;
}
