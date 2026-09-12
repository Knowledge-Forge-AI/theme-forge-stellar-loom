import {
  SCHEMA_THEME_CANDIDATE,
  SCHEMA_THEME_CODE_CANDIDATE,
  THEME_EXCHANGE_CODE_SCHEMA_VERSION,
  SEMANTIC_COMPILER_CODE,
  ADAPTER_CODE,
  CATALOG_CODE,
  CATALOG_CODE_DIGEST,
  RUNTIME_CODE_DEFAULT,
  RUNTIME_EXPRESSIVE_CODE,
  RUNTIME_SHIKI,
  MAX_PACKET_BYTES,
  MAX_GENERAL_TEXT_BYTES,
  MAX_VISUAL_RECORDS,
  ID_REGEX,
  DIGEST_REGEX,
  normalizeDigest,
} from "./constants.js";
import {
  validateThemeCode,
  canonicalizeThemeCode,
  CODE_CATALOG_DIGEST,
  assertSafePreSerialization,
} from "../code/index.js";
import { validatePackageMetadata } from "../generator/metadata.js";
import {
  type ThemeCodeCandidatePacket,
  type ThemeCodeRuntime,
  type ThemeVisualRecordV2,
  ThemeExchangeCodeValidationError,
} from "./types.js";
import {
  assertNfcAndControls,
  assertTreeNfcAndControls,
  assertNoPathsInPacket,
  computeSyntaxDigest,
  computePacketDigestCode,
  compareUtf8,
} from "./canonical.js";

const encoder = new TextEncoder();

export function assertObject(value: unknown, fieldPath: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ThemeExchangeCodeValidationError(`Expected object at '${fieldPath}'`, "SCHEMA_ERROR", fieldPath);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new ThemeExchangeCodeValidationError(`Expected plain object at '${fieldPath}'`, "SCHEMA_ERROR", fieldPath);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new ThemeExchangeCodeValidationError("Symbol keys forbidden in exchange objects", "SCHEMA_ERROR", fieldPath);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || descriptor.get || descriptor.set) {
      throw new ThemeExchangeCodeValidationError("Only enumerable data properties accepted; accessors forbidden", "SCHEMA_ERROR", fieldPath);
    }
  }
  return value as Record<string, unknown>;
}

export function assertExactKeys(
  obj: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
  fieldPath: string
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new ThemeExchangeCodeValidationError(
        `Unknown field '${key}' in object at '${fieldPath}'`,
        "UNKNOWN_FIELD",
        fieldPath ? `${fieldPath}.${key}` : key
      );
    }
  }
  for (const req of required) {
    if (!Object.hasOwn(obj, req) || obj[req] === undefined) {
      throw new ThemeExchangeCodeValidationError(
        `Missing required field '${req}' in object at '${fieldPath}'`,
        "MISSING_REQUIRED_FIELD",
        fieldPath ? `${fieldPath}.${req}` : req
      );
    }
  }
}

export function assertId(value: unknown, fieldPath: string): string {
  if (typeof value !== "string") {
    throw new ThemeExchangeCodeValidationError(`Expected string ID at '${fieldPath}'`, "SCHEMA_ERROR", fieldPath);
  }
  assertNfcAndControls(value, fieldPath, false);
  const bytes = encoder.encode(value).byteLength;
  if (bytes < 1 || bytes > 128) {
    throw new ThemeExchangeCodeValidationError(`ID at '${fieldPath}' exceeds length bounds (1..128 bytes)`, "BOUNDS_ERROR", fieldPath);
  }
  if (!ID_REGEX.test(value)) {
    throw new ThemeExchangeCodeValidationError(`ID at '${fieldPath}' must match ${ID_REGEX.source}`, "SCHEMA_ERROR", fieldPath);
  }
  return value;
}

export function assertDigest(value: unknown, fieldPath: string): string {
  if (typeof value !== "string" || !DIGEST_REGEX.test(value)) {
    throw new ThemeExchangeCodeValidationError(`Expected SHA-256 digest at '${fieldPath}'`, "INVALID_DIGEST", fieldPath);
  }
  return value;
}

export function assertText(value: unknown, maxBytes: number, fieldPath: string, multiline = false): string {
  if (typeof value !== "string") {
    throw new ThemeExchangeCodeValidationError(`Expected string at '${fieldPath}'`, "SCHEMA_ERROR", fieldPath);
  }
  assertNfcAndControls(value, fieldPath, multiline);
  const bytes = encoder.encode(value).byteLength;
  if (bytes < 1 || bytes > maxBytes) {
    throw new ThemeExchangeCodeValidationError(`Text at '${fieldPath}' length ${bytes} outside bounds [1..${maxBytes}] bytes`, "BOUNDS_ERROR", fieldPath);
  }
  return value;
}

export function validateVisualEvidenceArrayV2(
  raw: unknown,
  maxRecords = MAX_VISUAL_RECORDS,
  fieldPath = "visualEvidence"
): ThemeVisualRecordV2[] {
  if (!Array.isArray(raw)) {
    throw new ThemeExchangeCodeValidationError(`Expected array at '${fieldPath}'`, "SCHEMA_ERROR", fieldPath);
  }
  if (raw.length > maxRecords) {
    throw new ThemeExchangeCodeValidationError(`visualEvidence array exceeds maximum count of ${maxRecords}`, "BOUNDS_ERROR", fieldPath);
  }
  const records: ThemeVisualRecordV2[] = [];
  const seenDigests = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const item = assertObject(raw[i], `${fieldPath}[${i}]`);
    assertExactKeys(
      item,
      ["schema", "schemaVersion", "presence", "evidenceDigest"],
      ["reason", "pngDigest", "bytesBase64", "byteCount", "width", "height", "mode", "viewport", "themeDigest", "fixtureId"],
      `${fieldPath}[${i}]`
    );
    const evidenceDigest = assertDigest(item.evidenceDigest, `${fieldPath}[${i}].evidenceDigest`);
    if (seenDigests.has(evidenceDigest)) {
      throw new ThemeExchangeCodeValidationError(`Duplicate visual record evidenceDigest '${evidenceDigest}'`, "DUPLICATE_ELEMENTS", `${fieldPath}[${i}]`);
    }
    seenDigests.add(evidenceDigest);
    records.push(item as unknown as ThemeVisualRecordV2);
  }
  return records;
}

export function validateRuntime(raw: unknown, fieldPath = "runtime"): ThemeCodeRuntime {
  if (typeof raw === "string") {
    if (raw !== RUNTIME_CODE_DEFAULT) {
      throw new ThemeExchangeCodeValidationError(
        `Unsupported runtime string '${raw}'; expected '${RUNTIME_CODE_DEFAULT}'`,
        "UNSUPPORTED_RUNTIME",
        fieldPath
      );
    }
    return raw;
  }
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = assertObject(raw, fieldPath);
    assertExactKeys(obj, ["expressiveCode", "shiki"], ["label"], fieldPath);
    if (obj.expressiveCode !== RUNTIME_EXPRESSIVE_CODE) {
      throw new ThemeExchangeCodeValidationError(
        `Unsupported expressiveCode runtime version '${String(obj.expressiveCode)}'; expected '${RUNTIME_EXPRESSIVE_CODE}'`,
        "UNSUPPORTED_RUNTIME",
        `${fieldPath}.expressiveCode`
      );
    }
    if (obj.shiki !== RUNTIME_SHIKI) {
      throw new ThemeExchangeCodeValidationError(
        `Unsupported shiki runtime version '${String(obj.shiki)}'; expected '${RUNTIME_SHIKI}'`,
        "UNSUPPORTED_RUNTIME",
        `${fieldPath}.shiki`
      );
    }
    return obj as unknown as ThemeCodeRuntime;
  }
  throw new ThemeExchangeCodeValidationError(`Expected string or object at '${fieldPath}'`, "SCHEMA_ERROR", fieldPath);
}

export function assertNoAccessorsOrFunctions(value: unknown, _path = "candidate"): void {
  try { assertSafePreSerialization(value, MAX_PACKET_BYTES); }
  catch (error) { throw new ThemeExchangeCodeValidationError((error as Error).message, "UNSAFE_DATA"); }
}

export function validateThemeCodeCandidate(raw: unknown): ThemeCodeCandidatePacket {
  // Pre-serialization safety scan: reject getters, setters, prototypes, functions, symbols
  assertNoAccessorsOrFunctions(raw, "candidate");

  const obj = assertObject(raw, "candidate");
  assertExactKeys(
    obj,
    [
      "schema",
      "schemaVersion",
      "candidateId",
      "semanticCompiler",
      "adapter",
      "catalog",
      "catalogDigest",
      "producer",
      "inputDigest",
      "themeDigest",
      "syntaxDigest",
      "runtime",
      "metadata",
      "outputDigest",
      "outputInventory",
      "state",
      "theme",
      "rationale",
      "candidateDigest",
    ],
    ["selectedAccent", "visualSha", "visualEvidence", "originV1", "claimedProvenance"],
    "candidate"
  );

  if (obj.schema !== SCHEMA_THEME_CANDIDATE && obj.schema !== SCHEMA_THEME_CODE_CANDIDATE) {
    throw new ThemeExchangeCodeValidationError(
      `Expected schema '${SCHEMA_THEME_CANDIDATE}' or '${SCHEMA_THEME_CODE_CANDIDATE}' at 'schema'`,
      "SCHEMA_ERROR",
      "schema"
    );
  }

  if (obj.schemaVersion !== THEME_EXCHANGE_CODE_SCHEMA_VERSION) {
    throw new ThemeExchangeCodeValidationError(
      `Expected schemaVersion ${THEME_EXCHANGE_CODE_SCHEMA_VERSION} at 'schemaVersion'`,
      "SCHEMA_ERROR",
      "schemaVersion"
    );
  }

  assertId(obj.candidateId, "candidateId");

  if (obj.semanticCompiler !== SEMANTIC_COMPILER_CODE) {
    throw new ThemeExchangeCodeValidationError(
      `Unsupported semanticCompiler '${String(obj.semanticCompiler)}', expected '${SEMANTIC_COMPILER_CODE}'`,
      "UNSUPPORTED_SEMANTIC_COMPILER",
      "semanticCompiler"
    );
  }

  if (obj.adapter !== ADAPTER_CODE) {
    throw new ThemeExchangeCodeValidationError(
      `Unsupported adapter '${String(obj.adapter)}', expected '${ADAPTER_CODE}'`,
      "UNSUPPORTED_ADAPTER",
      "adapter"
    );
  }

  if (obj.catalog !== CATALOG_CODE) {
    throw new ThemeExchangeCodeValidationError(
      `Unsupported catalog '${String(obj.catalog)}', expected '${CATALOG_CODE}'`,
      "UNSUPPORTED_CATALOG",
      "catalog"
    );
  }

  const catalogDigest = assertDigest(obj.catalogDigest, "catalogDigest");
  if (normalizeDigest(catalogDigest) !== normalizeDigest(CODE_CATALOG_DIGEST)) {
    throw new ThemeExchangeCodeValidationError(
      `catalogDigest mismatch: expected '${CATALOG_CODE_DIGEST}' but got '${catalogDigest}'`,
      "CATALOG_DIGEST_MISMATCH",
      "catalogDigest"
    );
  }

  // Producer validation
  const producer = assertObject(obj.producer, "producer");
  assertExactKeys(producer, ["package", "version", "executableDigest", "packageDigest"], [], "producer");
  assertText(producer.package, 128, "producer.package", false);
  assertText(producer.version, 64, "producer.version", false);
  assertDigest(producer.executableDigest, "producer.executableDigest");
  assertDigest(producer.packageDigest, "producer.packageDigest");

  const inputDigest = assertDigest(obj.inputDigest, "inputDigest");
  const themeDigest = assertDigest(obj.themeDigest, "themeDigest");
  const syntaxDigest = assertDigest(obj.syntaxDigest, "syntaxDigest");
  const outputDigest = assertDigest(obj.outputDigest, "outputDigest");

  validateRuntime(obj.runtime, "runtime");
  validatePackageMetadata(obj.metadata);

  // Output inventory validation: full member inventory
  if (!Array.isArray(obj.outputInventory)) {
    throw new ThemeExchangeCodeValidationError("outputInventory must be an array", "SCHEMA_ERROR", "outputInventory");
  }
  if (obj.outputInventory.length < 5) {
    throw new ThemeExchangeCodeValidationError(
      `outputInventory must contain generated member entries, got ${obj.outputInventory.length}`,
      "INVENTORY_COUNT_MISMATCH",
      "outputInventory"
    );
  }
  const seenInventoryIds = new Set<string>();

  for (let i = 0; i < obj.outputInventory.length; i++) {
    const item = assertObject(obj.outputInventory[i], `outputInventory[${i}]`);
    assertExactKeys(item, ["id", "digest"], [], `outputInventory[${i}]`);
    if (typeof item.id !== "string" || !item.id) {
      throw new ThemeExchangeCodeValidationError(`Invalid output inventory id at 'outputInventory[${i}].id'`, "SCHEMA_ERROR", `outputInventory[${i}].id`);
    }
    if (seenInventoryIds.has(item.id)) {
      throw new ThemeExchangeCodeValidationError(`Duplicate output inventory id '${item.id}'`, "DUPLICATE_ELEMENTS", `outputInventory[${i}].id`);
    }
    seenInventoryIds.add(item.id);
    assertDigest(item.digest, `outputInventory[${i}].digest`);

    if (i > 0) {
      const prevId = (obj.outputInventory[i - 1] as Record<string, unknown>).id as string;
      if (compareUtf8(prevId, item.id) >= 0) {
        throw new ThemeExchangeCodeValidationError("outputInventory must be sorted by id", "UNSORTED_ARRAY", "outputInventory");
      }
    }
  }

  // State must be 'candidate' only (never adopted)
  if (obj.state !== "candidate") {
    throw new ThemeExchangeCodeValidationError(
      `Candidate state must be 'candidate' (never adopted), got '${String(obj.state)}'`,
      "INVALID_STATE",
      "state"
    );
  }

  // Validate theme using code domain validator
  const theme = validateThemeCode(obj.theme);
  const canonical = canonicalizeThemeCode(theme);

  if (normalizeDigest(inputDigest) !== canonical.inputDigest) {
    throw new ThemeExchangeCodeValidationError(
      `inputDigest mismatch: expected sha256:${canonical.inputDigest} but got ${inputDigest}`,
      "DIGEST_MISMATCH",
      "inputDigest"
    );
  }

  if (normalizeDigest(themeDigest) !== canonical.inputDigest) {
    throw new ThemeExchangeCodeValidationError(
      `themeDigest mismatch: expected sha256:${canonical.inputDigest} but got ${themeDigest}`,
      "DIGEST_MISMATCH",
      "themeDigest"
    );
  }

  const expectedSyntaxDigest = computeSyntaxDigest(theme.codePresentation.syntaxTheme);
  if (syntaxDigest !== expectedSyntaxDigest) {
    throw new ThemeExchangeCodeValidationError(
      `syntaxDigest mismatch: expected ${expectedSyntaxDigest} but got ${syntaxDigest}`,
      "DIGEST_MISMATCH",
      "syntaxDigest"
    );
  }

  if (obj.selectedAccent !== undefined) {
    const rawAccent = obj.selectedAccent;
    if (typeof rawAccent !== "string") {
      throw new ThemeExchangeCodeValidationError(
        "selectedAccent must be a string",
        "SCHEMA_ERROR",
        "selectedAccent"
      );
    }
    const selectedAccent = assertId(rawAccent, "selectedAccent");
    if (!Object.hasOwn(theme.accentVariants, selectedAccent)) {
      throw new ThemeExchangeCodeValidationError(
        `selectedAccent '${selectedAccent}' not declared in theme accentVariants`,
        "UNKNOWN_ACCENT_VARIANT",
        "selectedAccent"
      );
    }
  }

  assertText(obj.rationale, MAX_GENERAL_TEXT_BYTES, "rationale", true);

  if (obj.visualSha !== undefined) {
    assertDigest(obj.visualSha, "visualSha");
  }

  if (obj.visualEvidence !== undefined) {
    validateVisualEvidenceArrayV2(obj.visualEvidence, MAX_VISUAL_RECORDS, "visualEvidence");
  }

  if (obj.originV1 !== undefined) {
    const origin = assertObject(obj.originV1, "originV1");
    assertExactKeys(origin, ["packetDigest", "byteDigest"], [], "originV1");
    assertDigest(origin.packetDigest, "originV1.packetDigest");
    assertDigest(origin.byteDigest, "originV1.byteDigest");
  }

  if (obj.claimedProvenance !== undefined) {
    const prov = assertObject(obj.claimedProvenance, "claimedProvenance");
    assertExactKeys(prov, [], ["author", "toolName", "toolVersion", "timestamp"], "claimedProvenance");
    if (prov.author !== undefined) assertText(prov.author, 256, "claimedProvenance.author", false);
    if (prov.toolName !== undefined) assertText(prov.toolName, 256, "claimedProvenance.toolName", false);
    if (prov.toolVersion !== undefined) assertText(prov.toolVersion, 128, "claimedProvenance.toolVersion", false);
    if (prov.timestamp !== undefined) assertText(prov.timestamp, 64, "claimedProvenance.timestamp", false);
  }

  // Ensure no filesystem paths anywhere in packet
  assertNoPathsInPacket(obj, "candidate");

  // Ensure NFC & controls
  assertTreeNfcAndControls(obj);

  // Self-digest check
  const candidateDigest = assertDigest(obj.candidateDigest, "candidateDigest");
  const computed = computePacketDigestCode(obj as any);
  if (computed !== candidateDigest) {
    throw new ThemeExchangeCodeValidationError(
      `candidateDigest mismatch: expected ${computed} but got ${candidateDigest}`,
      "DIGEST_MISMATCH",
      "candidateDigest"
    );
  }

  return obj as unknown as ThemeCodeCandidatePacket;
}
