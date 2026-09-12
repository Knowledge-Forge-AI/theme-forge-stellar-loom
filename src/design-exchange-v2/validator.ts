import {
  SCHEMA_THEME_CANDIDATE_V2,
  THEME_EXCHANGE_V2_SCHEMA_VERSION,
  SEMANTIC_COMPILER_V2,
  ADAPTER_V2,
  CATALOG_V2,
  MAX_PACKET_BYTES,
  MAX_GENERAL_TEXT_BYTES,
  MAX_VISUAL_RECORDS,
  ID_REGEX,
  DIGEST_REGEX,
  normalizeDigest,
} from "./constants.js";
import {
  CATALOG_DIGEST,
  STYLE_FILES,
  validateThemeV2,
  canonicalizeThemeV2,
} from "../v2/index.js";
import {
  type ThemeCandidateV2Packet,
  type ThemeVisualRecordV2,
  ThemeExchangeV2ValidationError,
} from "./types.js";
import {
  assertNfcAndControls,
  assertTreeNfcAndControls,
  assertNoPathsInPacket,
  computePacketDigestV2,
  compareUtf8,
} from "./canonical.js";

const encoder = new TextEncoder();

export function assertObject(value: unknown, fieldPath: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ThemeExchangeV2ValidationError(`Expected object at '${fieldPath}'`, "SCHEMA_ERROR", fieldPath);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new ThemeExchangeV2ValidationError(`Expected plain object at '${fieldPath}'`, "SCHEMA_ERROR", fieldPath);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || !descriptor.enumerable || descriptor.get || descriptor.set) throw new ThemeExchangeV2ValidationError("Only enumerable data properties accepted", "SCHEMA_ERROR", fieldPath);
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
      throw new ThemeExchangeV2ValidationError(
        `Unknown field '${key}' in object at '${fieldPath}'`,
        "UNKNOWN_FIELD",
        fieldPath ? `${fieldPath}.${key}` : key
      );
    }
  }
  for (const req of required) {
    if (!Object.hasOwn(obj, req) || obj[req] === undefined) {
      throw new ThemeExchangeV2ValidationError(
        `Missing required field '${req}' in object at '${fieldPath}'`,
        "MISSING_REQUIRED_FIELD",
        fieldPath ? `${fieldPath}.${req}` : req
      );
    }
  }
}

export function assertId(value: unknown, fieldPath: string): string {
  if (typeof value !== "string") {
    throw new ThemeExchangeV2ValidationError(`Expected string ID at '${fieldPath}'`, "SCHEMA_ERROR", fieldPath);
  }
  assertNfcAndControls(value, fieldPath, false);
  const bytes = encoder.encode(value).byteLength;
  if (bytes < 1 || bytes > 128) {
    throw new ThemeExchangeV2ValidationError(`ID at '${fieldPath}' exceeds length bounds (1..128 bytes)`, "BOUNDS_ERROR", fieldPath);
  }
  if (!ID_REGEX.test(value)) {
    throw new ThemeExchangeV2ValidationError(`ID at '${fieldPath}' must match ${ID_REGEX.source}`, "SCHEMA_ERROR", fieldPath);
  }
  return value;
}

export function assertDigest(value: unknown, fieldPath: string): string {
  if (typeof value !== "string" || !DIGEST_REGEX.test(value)) {
    throw new ThemeExchangeV2ValidationError(`Expected SHA-256 digest at '${fieldPath}'`, "INVALID_DIGEST", fieldPath);
  }
  return value;
}

export function assertText(value: unknown, maxBytes: number, fieldPath: string, multiline = false): string {
  if (typeof value !== "string") {
    throw new ThemeExchangeV2ValidationError(`Expected string at '${fieldPath}'`, "SCHEMA_ERROR", fieldPath);
  }
  assertNfcAndControls(value, fieldPath, multiline);
  const bytes = encoder.encode(value).byteLength;
  if (bytes < 1 || bytes > maxBytes) {
    throw new ThemeExchangeV2ValidationError(`Text at '${fieldPath}' length ${bytes} outside bounds [1..${maxBytes}] bytes`, "BOUNDS_ERROR", fieldPath);
  }
  return value;
}

export function validateVisualEvidenceArrayV2(raw: unknown, maxRecords = MAX_VISUAL_RECORDS, fieldPath = "visualEvidence"): ThemeVisualRecordV2[] {
  if (!Array.isArray(raw)) {
    throw new ThemeExchangeV2ValidationError(`Expected array at '${fieldPath}'`, "SCHEMA_ERROR", fieldPath);
  }
  if (raw.length > maxRecords) {
    throw new ThemeExchangeV2ValidationError(`visualEvidence array exceeds maximum count of ${maxRecords}`, "BOUNDS_ERROR", fieldPath);
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
      throw new ThemeExchangeV2ValidationError(`Duplicate visual record evidenceDigest '${evidenceDigest}'`, "DUPLICATE_ELEMENTS", `${fieldPath}[${i}]`);
    }
    seenDigests.add(evidenceDigest);
    records.push(item as unknown as ThemeVisualRecordV2);
  }
  return records;
}

export function validateThemeCandidateV2(raw: unknown): ThemeCandidateV2Packet {
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

  if (obj.schema !== SCHEMA_THEME_CANDIDATE_V2) {
    throw new ThemeExchangeV2ValidationError(`Expected schema '${SCHEMA_THEME_CANDIDATE_V2}' at 'schema'`, "SCHEMA_ERROR", "schema");
  }

  if (obj.schemaVersion !== THEME_EXCHANGE_V2_SCHEMA_VERSION) {
    throw new ThemeExchangeV2ValidationError(
      `Expected schemaVersion ${THEME_EXCHANGE_V2_SCHEMA_VERSION} at 'schemaVersion'`,
      "SCHEMA_ERROR",
      "schemaVersion"
    );
  }

  assertId(obj.candidateId, "candidateId");

  if (obj.semanticCompiler !== SEMANTIC_COMPILER_V2) {
    throw new ThemeExchangeV2ValidationError(
      `Unsupported semanticCompiler '${obj.semanticCompiler}', expected '${SEMANTIC_COMPILER_V2}'`,
      "UNSUPPORTED_SEMANTIC_COMPILER",
      "semanticCompiler"
    );
  }

  if (obj.adapter !== ADAPTER_V2) {
    throw new ThemeExchangeV2ValidationError(
      `Unsupported adapter '${obj.adapter}', expected '${ADAPTER_V2}'`,
      "UNSUPPORTED_ADAPTER",
      "adapter"
    );
  }

  if (obj.catalog !== CATALOG_V2) {
    throw new ThemeExchangeV2ValidationError(
      `Unsupported catalog '${obj.catalog}', expected '${CATALOG_V2}'`,
      "UNSUPPORTED_CATALOG",
      "catalog"
    );
  }

  const catalogDigest = assertDigest(obj.catalogDigest, "catalogDigest");
  if (normalizeDigest(catalogDigest) !== CATALOG_DIGEST) {
    throw new ThemeExchangeV2ValidationError(
      `catalogDigest mismatch: expected 'sha256:${CATALOG_DIGEST}' but got '${catalogDigest}'`,
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
  const outputDigest = assertDigest(obj.outputDigest, "outputDigest");

  // Output inventory validation (5 files matching STYLE_FILES)
  if (!Array.isArray(obj.outputInventory)) {
    throw new ThemeExchangeV2ValidationError("outputInventory must be an array", "SCHEMA_ERROR", "outputInventory");
  }
  if (obj.outputInventory.length !== STYLE_FILES.length) {
    throw new ThemeExchangeV2ValidationError(
      `outputInventory must contain exactly ${STYLE_FILES.length} entries, got ${obj.outputInventory.length}`,
      "INVENTORY_COUNT_MISMATCH",
      "outputInventory"
    );
  }
  const seenInventoryIds = new Set<string>();


  for (let i = 0; i < obj.outputInventory.length; i++) {
    const item = assertObject(obj.outputInventory[i], `outputInventory[${i}]`);
    assertExactKeys(item, ["id", "digest"], [], `outputInventory[${i}]`);
    if (typeof item.id !== "string" || !item.id) {
      throw new ThemeExchangeV2ValidationError(`Invalid output inventory id at 'outputInventory[${i}].id'`, "SCHEMA_ERROR", `outputInventory[${i}].id`);
    }
    if (seenInventoryIds.has(item.id)) {
      throw new ThemeExchangeV2ValidationError(`Duplicate output inventory id '${item.id}'`, "DUPLICATE_ELEMENTS", `outputInventory[${i}].id`);
    }
    seenInventoryIds.add(item.id);
    assertDigest(item.digest, `outputInventory[${i}].digest`);

    if (item.id !== STYLE_FILES[i]) {
      throw new ThemeExchangeV2ValidationError("outputInventory must preserve fixed stylesheet order", "UNSORTED_ARRAY", "outputInventory");
    }
  }

  // State must be 'candidate' only (never adopted)
  if (obj.state !== "candidate") {
    throw new ThemeExchangeV2ValidationError(
      `Candidate state must be 'candidate' (never adopted), got '${obj.state}'`,
      "INVALID_STATE",
      "state"
    );
  }

  // Validate theme using shared v2 validator
  const theme = validateThemeV2(obj.theme);
  const canonical = canonicalizeThemeV2(theme);
  if (normalizeDigest(inputDigest) !== canonical.inputDigest) {
    throw new ThemeExchangeV2ValidationError(
      `inputDigest mismatch: expected sha256:${canonical.inputDigest} but got ${inputDigest}`,
      "DIGEST_MISMATCH",
      "inputDigest"
    );
  }

  if (obj.selectedAccent !== undefined) {
    const rawAccent = obj.selectedAccent;
    if (typeof rawAccent !== "string") {
      throw new ThemeExchangeV2ValidationError(
        "selectedAccent must be a string",
        "SCHEMA_ERROR",
        "selectedAccent"
      );
    }
    const selectedAccent = assertId(rawAccent, "selectedAccent");
    if (!Object.hasOwn(theme.accentVariants, selectedAccent)) {
      throw new ThemeExchangeV2ValidationError(
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
  const computed = computePacketDigestV2(obj as any);
  if (computed !== candidateDigest) {
    throw new ThemeExchangeV2ValidationError(
      `candidateDigest mismatch: expected ${computed} but got ${candidateDigest}`,
      "DIGEST_MISMATCH",
      "candidateDigest"
    );
  }

  return obj as unknown as ThemeCandidateV2Packet;
}
