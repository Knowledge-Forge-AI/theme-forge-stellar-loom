import { validateThemeSpecification } from "../schema/validator.js";
import { canonicalizeSpecification } from "../compiler/index.js";
import { validatePackageMetadata } from "../generator/metadata.js";
import {
  SCHEMA_THEME_BRIEF,
  SCHEMA_THEME_CANDIDATE,
  SCHEMA_THEME_REVIEW,
  SCHEMA_THEME_VISUAL_EVIDENCE,
  THEME_EXCHANGE_SCHEMA_VERSION,
  MAX_CANDIDATES,
  MAX_VISUAL_RECORDS,
  MAX_ANNOTATIONS,
  MAX_GENERAL_TEXT_BYTES,
  MAX_ANNOTATION_COMMENT_BYTES,
  MAX_AGGREGATE_VISUAL_BYTES,
  ID_REGEX,
  DIGEST_REGEX,
} from "./constants.js";
import {
  type ThemeBriefPacket,
  type ThemeCandidatePacket,
  type ThemeReviewPacket,
  type ThemeVisualRecord,
  type ThemeAnnotation,
  type ThemeExchangePacket,
  ThemeExchangeValidationError,
} from "./types.js";
import {
  assertNfcAndControls,
  computePacketDigest,
  computeVisualEvidenceDigest,
} from "./canonical.js";
import { validatePngBase64 } from "./png.js";
import { isValidLeafField } from "./leaf-fields.js";

const encoder = new TextEncoder();

export function compareUtf8(a: string, b: string): number {
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  const minLen = Math.min(bufA.length, bufB.length);
  for (let i = 0; i < minLen; i++) {
    if (bufA[i] !== bufB[i]) {
      return (bufA[i] ?? 0) - (bufB[i] ?? 0);
    }
  }
  return bufA.length - bufB.length;
}

export function assertSortedUnique(items: readonly string[], fieldPath: string): void {
  const sorted = [...items].sort(compareUtf8);
  if (new Set(items).size !== items.length) {
    throw new ThemeExchangeValidationError(`Array at '${fieldPath}' contains duplicate elements`, "DUPLICATE_ELEMENTS", fieldPath);
  }
  for (let i = 0; i < items.length; i++) {
    if (items[i] !== sorted[i]) {
      throw new ThemeExchangeValidationError(`Array at '${fieldPath}' is not sorted by UTF-8 bytes`, "UNSORTED_ARRAY", fieldPath);
    }
  }
}

export function assertObject(value: unknown, fieldPath: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ThemeExchangeValidationError(`Expected object at '${fieldPath}'`, "SCHEMA_ERROR", fieldPath);
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new ThemeExchangeValidationError(`Expected plain object at '${fieldPath}'`, "SCHEMA_ERROR", fieldPath);
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
      throw new ThemeExchangeValidationError(
        `Unknown field '${key}' in object at '${fieldPath}'`,
        "UNKNOWN_FIELD",
        fieldPath ? `${fieldPath}.${key}` : key
      );
    }
  }
  for (const req of required) {
    if (!Object.hasOwn(obj, req) || obj[req] === undefined) {
      throw new ThemeExchangeValidationError(
        `Missing required field '${req}' in object at '${fieldPath}'`,
        "MISSING_REQUIRED_FIELD",
        fieldPath ? `${fieldPath}.${req}` : req
      );
    }
  }
}

export function assertId(value: unknown, fieldPath: string): string {
  if (typeof value !== "string") {
    throw new ThemeExchangeValidationError(`Expected string ID at '${fieldPath}'`, "SCHEMA_ERROR", fieldPath);
  }
  assertNfcAndControls(value, fieldPath, false);
  const bytes = encoder.encode(value).byteLength;
  if (bytes < 1 || bytes > 128) {
    throw new ThemeExchangeValidationError(`ID at '${fieldPath}' exceeds length bounds (1..128 bytes)`, "BOUNDS_ERROR", fieldPath);
  }
  if (!ID_REGEX.test(value)) {
    throw new ThemeExchangeValidationError(`ID at '${fieldPath}' must match ${ID_REGEX.source}`, "SCHEMA_ERROR", fieldPath);
  }
  return value;
}

export function assertDigest(value: unknown, fieldPath: string): string {
  if (typeof value !== "string" || !DIGEST_REGEX.test(value)) {
    throw new ThemeExchangeValidationError(`Expected SHA-256 digest at '${fieldPath}'`, "INVALID_DIGEST", fieldPath);
  }
  return value;
}

export function assertText(value: unknown, maxBytes: number, fieldPath: string, multiline = false): string {
  if (typeof value !== "string") {
    throw new ThemeExchangeValidationError(`Expected string at '${fieldPath}'`, "SCHEMA_ERROR", fieldPath);
  }
  assertNfcAndControls(value, fieldPath, multiline);
  const bytes = encoder.encode(value).byteLength;
  if (bytes < 1 || bytes > maxBytes) {
    throw new ThemeExchangeValidationError(`Text at '${fieldPath}' length ${bytes} outside bounds [1..${maxBytes}] bytes`, "BOUNDS_ERROR", fieldPath);
  }
  return value;
}

export function assertInteger(value: unknown, min: number, max: number, fieldPath: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new ThemeExchangeValidationError(`Integer at '${fieldPath}' outside bounds [${min}..${max}]`, "BOUNDS_ERROR", fieldPath);
  }
  return value as number;
}

export function validateVisualRecord(raw: unknown, fieldPath = "visualEvidence"): ThemeVisualRecord {
  const obj = assertObject(raw, fieldPath);
  assertExactKeys(
    obj,
    ["schema", "schemaVersion", "presence", "evidenceDigest"],
    ["reason", "pngDigest", "bytesBase64", "byteCount", "width", "height", "mode", "viewport", "themeDigest", "fixtureId"],
    fieldPath
  );

  if (obj.schema !== SCHEMA_THEME_VISUAL_EVIDENCE) {
    throw new ThemeExchangeValidationError(`Expected schema '${SCHEMA_THEME_VISUAL_EVIDENCE}' at '${fieldPath}.schema'`, "SCHEMA_ERROR", `${fieldPath}.schema`);
  }
  if (obj.schemaVersion !== THEME_EXCHANGE_SCHEMA_VERSION) {
    throw new ThemeExchangeValidationError(`Expected schemaVersion 1 at '${fieldPath}.schemaVersion'`, "SCHEMA_ERROR", `${fieldPath}.schemaVersion`);
  }

  const presence = obj.presence;
  if (presence !== "included" && presence !== "absent" && presence !== "unavailable") {
    throw new ThemeExchangeValidationError(`Invalid presence '${presence}' at '${fieldPath}.presence'`, "SCHEMA_ERROR", `${fieldPath}.presence`);
  }

  const evidenceDigest = assertDigest(obj.evidenceDigest, `${fieldPath}.evidenceDigest`);

  if (presence === "absent" || presence === "unavailable") {
    if (typeof obj.reason !== "string" || !obj.reason.trim()) {
      throw new ThemeExchangeValidationError(`Reason required when visual record is '${presence}' at '${fieldPath}.reason'`, "MISSING_REQUIRED_FIELD", `${fieldPath}.reason`);
    }
    assertText(obj.reason, 512, `${fieldPath}.reason`, false);
    const computed = computeVisualEvidenceDigest(obj as any);
    if (computed !== evidenceDigest) {
      throw new ThemeExchangeValidationError(`evidenceDigest mismatch at '${fieldPath}': expected ${computed} but got ${evidenceDigest}`, "DIGEST_MISMATCH", `${fieldPath}.evidenceDigest`);
    }
    return obj as unknown as ThemeVisualRecord;
  }

  // Presence === "included"
  assertExactKeys(
    obj,
    ["schema", "schemaVersion", "presence", "pngDigest", "bytesBase64", "byteCount", "width", "height", "mode", "viewport", "themeDigest", "fixtureId", "evidenceDigest"],
    ["reason"],
    fieldPath
  );

  const mode = obj.mode;
  if (mode !== "dark" && mode !== "light") {
    throw new ThemeExchangeValidationError(`Invalid mode '${mode}' at '${fieldPath}.mode'`, "SCHEMA_ERROR", `${fieldPath}.mode`);
  }

  const viewport = obj.viewport;
  if (viewport !== "desktop" && viewport !== "mobile") {
    throw new ThemeExchangeValidationError(`Invalid viewport '${viewport}' at '${fieldPath}.viewport'`, "SCHEMA_ERROR", `${fieldPath}.viewport`);
  }

  assertDigest(obj.themeDigest, `${fieldPath}.themeDigest`);
  assertId(obj.fixtureId, `${fieldPath}.fixtureId`);

  const pngValidation = validatePngBase64(obj.bytesBase64 as string);
  if (obj.pngDigest !== pngValidation.pngDigest) {
    throw new ThemeExchangeValidationError(`pngDigest mismatch at '${fieldPath}.pngDigest': expected ${pngValidation.pngDigest} but got ${obj.pngDigest}`, "DIGEST_MISMATCH", `${fieldPath}.pngDigest`);
  }
  if (obj.byteCount !== pngValidation.byteCount) {
    throw new ThemeExchangeValidationError(`byteCount mismatch at '${fieldPath}.byteCount': expected ${pngValidation.byteCount} but got ${obj.byteCount}`, "BOUNDS_ERROR", `${fieldPath}.byteCount`);
  }
  if (obj.width !== pngValidation.width) {
    throw new ThemeExchangeValidationError(`width mismatch at '${fieldPath}.width': expected ${pngValidation.width} but got ${obj.width}`, "BOUNDS_ERROR", `${fieldPath}.width`);
  }
  if (obj.height !== pngValidation.height) {
    throw new ThemeExchangeValidationError(`height mismatch at '${fieldPath}.height': expected ${pngValidation.height} but got ${obj.height}`, "BOUNDS_ERROR", `${fieldPath}.height`);
  }

  const computed = computeVisualEvidenceDigest(obj as any);
  if (computed !== evidenceDigest) {
    throw new ThemeExchangeValidationError(`evidenceDigest mismatch at '${fieldPath}': expected ${computed} but got ${evidenceDigest}`, "DIGEST_MISMATCH", `${fieldPath}.evidenceDigest`);
  }

  return obj as unknown as ThemeVisualRecord;
}

export function validateVisualEvidenceArray(raw: unknown, maxRecords = MAX_VISUAL_RECORDS, fieldPath = "visualEvidence"): ThemeVisualRecord[] {
  if (!Array.isArray(raw)) {
    throw new ThemeExchangeValidationError(`Expected array at '${fieldPath}'`, "SCHEMA_ERROR", fieldPath);
  }
  if (raw.length > maxRecords) {
    throw new ThemeExchangeValidationError(`visualEvidence array exceeds maximum count of ${maxRecords}`, "BOUNDS_ERROR", fieldPath);
  }

  let totalDecodedBytes = 0;
  const records: ThemeVisualRecord[] = [];
  const seenDigests = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const record = validateVisualRecord(raw[i], `${fieldPath}[${i}]`);
    if (seenDigests.has(record.evidenceDigest)) {
      throw new ThemeExchangeValidationError(`Duplicate visual record evidenceDigest '${record.evidenceDigest}'`, "DUPLICATE_ELEMENTS", `${fieldPath}[${i}]`);
    }
    seenDigests.add(record.evidenceDigest);
    if (record.presence === "included" && record.byteCount) {
      totalDecodedBytes += record.byteCount;
    }
    records.push(record);
  }

  if (totalDecodedBytes > MAX_AGGREGATE_VISUAL_BYTES) {
    throw new ThemeExchangeValidationError(
      `Aggregate visual bytes ${totalDecodedBytes} exceeds maximum of ${MAX_AGGREGATE_VISUAL_BYTES} bytes`,
      "IMAGE_TOO_LARGE",
      fieldPath
    );
  }

  return records;
}

export function validateThemeAnnotation(raw: unknown, fieldPath: string): ThemeAnnotation {
  const obj = assertObject(raw, fieldPath);
  assertExactKeys(
    obj,
    ["annotationId", "candidateDigest", "target", "category", "severity", "comment"],
    [],
    fieldPath
  );

  assertId(obj.annotationId, `${fieldPath}.annotationId`);
  assertDigest(obj.candidateDigest, `${fieldPath}.candidateDigest`);

  const category = obj.category;
  const validCategories = ["contrast", "color", "typography", "layout", "brand-fit", "accessibility", "other"];
  if (typeof category !== "string" || !validCategories.includes(category)) {
    throw new ThemeExchangeValidationError(`Invalid category '${category}' at '${fieldPath}.category'`, "SCHEMA_ERROR", `${fieldPath}.category`);
  }

  const severity = obj.severity;
  const validSeverities = ["note", "minor", "substantive", "blocking"];
  if (typeof severity !== "string" || !validSeverities.includes(severity)) {
    throw new ThemeExchangeValidationError(`Invalid severity '${severity}' at '${fieldPath}.severity'`, "SCHEMA_ERROR", `${fieldPath}.severity`);
  }

  assertText(obj.comment, MAX_ANNOTATION_COMMENT_BYTES, `${fieldPath}.comment`, true);

  const targetObj = assertObject(obj.target, `${fieldPath}.target`);
  const targetKind = targetObj.kind;

  if (targetKind === "field") {
    assertExactKeys(targetObj, ["kind", "fieldPath"], ["mode"], `${fieldPath}.target`);
    const targetFieldPath = assertText(targetObj.fieldPath, 128, `${fieldPath}.target.fieldPath`, false);
    if (!isValidLeafField(targetFieldPath)) {
      throw new ThemeExchangeValidationError(`Field path '${targetFieldPath}' is not a valid theme leaf field`, "INVALID_FIELD_PATH", `${fieldPath}.target.fieldPath`);
    }
    if (targetObj.mode !== undefined) {
      if (targetObj.mode !== "dark" && targetObj.mode !== "light") {
        throw new ThemeExchangeValidationError(`Invalid mode '${targetObj.mode}' at '${fieldPath}.target.mode'`, "SCHEMA_ERROR", `${fieldPath}.target.mode`);
      }
    }
  } else if (targetKind === "visual") {
    assertExactKeys(targetObj, ["kind", "evidenceDigest", "pngDigest", "region"], [], `${fieldPath}.target`);
    assertDigest(targetObj.evidenceDigest, `${fieldPath}.target.evidenceDigest`);
    assertDigest(targetObj.pngDigest, `${fieldPath}.target.pngDigest`);
    if (!Array.isArray(targetObj.region) || targetObj.region.length !== 4) {
      throw new ThemeExchangeValidationError(`Expected 4-element region array at '${fieldPath}.target.region'`, "SCHEMA_ERROR", `${fieldPath}.target.region`);
    }
    const [x1, y1, x2, y2] = targetObj.region;
    assertInteger(x1, 0, 1000000, `${fieldPath}.target.region[0]`);
    assertInteger(y1, 0, 1000000, `${fieldPath}.target.region[1]`);
    assertInteger(x2, 0, 1000000, `${fieldPath}.target.region[2]`);
    assertInteger(y2, 0, 1000000, `${fieldPath}.target.region[3]`);
    if (x1 >= x2 || y1 >= y2) {
      throw new ThemeExchangeValidationError(`Region bounds must satisfy x1 < x2 and y1 < y2 at '${fieldPath}.target.region'`, "BOUNDS_ERROR", `${fieldPath}.target.region`);
    }
  } else {
    throw new ThemeExchangeValidationError(`Unknown annotation target kind '${targetKind}' at '${fieldPath}.target.kind'`, "SCHEMA_ERROR", `${fieldPath}.target.kind`);
  }

  return obj as unknown as ThemeAnnotation;
}

export function validateThemeBrief(raw: unknown): ThemeBriefPacket {
  const obj = assertObject(raw, "brief");
  assertExactKeys(
    obj,
    [
      "schema",
      "schemaVersion",
      "briefId",
      "title",
      "goal",
      "baselineTheme",
      "themeDigest",
      "compilerVersion",
      "adapter",
      "allowedFields",
      "allowedModes",
      "approvedTemplates",
      "acceptanceCriteria",
      "prohibitedChanges",
      "visualEvidence",
      "briefDigest",
    ],
    ["metadata"],
    "brief"
  );

  if (obj.schema !== SCHEMA_THEME_BRIEF) {
    throw new ThemeExchangeValidationError(`Expected schema '${SCHEMA_THEME_BRIEF}'`, "SCHEMA_ERROR", "schema");
  }
  if (obj.schemaVersion !== THEME_EXCHANGE_SCHEMA_VERSION) {
    throw new ThemeExchangeValidationError("Expected schemaVersion 1", "SCHEMA_ERROR", "schemaVersion");
  }

  assertId(obj.briefId, "briefId");
  assertText(obj.title, 128, "title", false);
  assertText(obj.goal, MAX_GENERAL_TEXT_BYTES, "goal", true);

  const baselineTheme = validateThemeSpecification(obj.baselineTheme);
  const canonicalBaseline = canonicalizeSpecification(baselineTheme);
  const expectedThemeDigest = `sha256:${canonicalBaseline.inputDigest}`;
  if (obj.themeDigest !== expectedThemeDigest) {
    throw new ThemeExchangeValidationError(`themeDigest mismatch: expected ${expectedThemeDigest} but got ${obj.themeDigest}`, "DIGEST_MISMATCH", "themeDigest");
  }

  assertText(obj.compilerVersion, 64, "compilerVersion", false);
  assertText(obj.adapter, 64, "adapter", false);

  if (!Array.isArray(obj.allowedFields)) {
    throw new ThemeExchangeValidationError("allowedFields must be an array", "SCHEMA_ERROR", "allowedFields");
  }
  for (const field of obj.allowedFields) {
    if (typeof field !== "string" || !isValidLeafField(field)) {
      throw new ThemeExchangeValidationError(`Invalid field in allowedFields: '${field}'`, "INVALID_FIELD_PATH", "allowedFields");
    }
  }
  assertSortedUnique(obj.allowedFields as string[], "allowedFields");

  if (!Array.isArray(obj.allowedModes)) {
    throw new ThemeExchangeValidationError("allowedModes must be an array", "SCHEMA_ERROR", "allowedModes");
  }
  for (const mode of obj.allowedModes) {
    if (mode !== "dark" && mode !== "light") {
      throw new ThemeExchangeValidationError(`Invalid mode in allowedModes: '${mode}'`, "SCHEMA_ERROR", "allowedModes");
    }
  }
  assertSortedUnique(obj.allowedModes as string[], "allowedModes");

  if (!Array.isArray(obj.approvedTemplates)) {
    throw new ThemeExchangeValidationError("approvedTemplates must be an array", "SCHEMA_ERROR", "approvedTemplates");
  }
  for (const t of obj.approvedTemplates) {
    assertId(t, "approvedTemplates");
  }
  assertSortedUnique(obj.approvedTemplates as string[], "approvedTemplates");

  if (!Array.isArray(obj.acceptanceCriteria)) {
    throw new ThemeExchangeValidationError("acceptanceCriteria must be an array", "SCHEMA_ERROR", "acceptanceCriteria");
  }
  if (obj.acceptanceCriteria.length > 64) {
    throw new ThemeExchangeValidationError("acceptanceCriteria exceeds 64 items", "BOUNDS_ERROR", "acceptanceCriteria");
  }
  for (let i = 0; i < obj.acceptanceCriteria.length; i++) {
    assertText(obj.acceptanceCriteria[i], 512, `acceptanceCriteria[${i}]`, false);
  }

  if (!Array.isArray(obj.prohibitedChanges)) {
    throw new ThemeExchangeValidationError("prohibitedChanges must be an array", "SCHEMA_ERROR", "prohibitedChanges");
  }
  if (obj.prohibitedChanges.length > 64) {
    throw new ThemeExchangeValidationError("prohibitedChanges exceeds 64 items", "BOUNDS_ERROR", "prohibitedChanges");
  }
  for (let i = 0; i < obj.prohibitedChanges.length; i++) {
    assertText(obj.prohibitedChanges[i], 512, `prohibitedChanges[${i}]`, false);
  }

  validateVisualEvidenceArray(obj.visualEvidence, MAX_VISUAL_RECORDS, "visualEvidence");

  if (obj.metadata !== undefined) {
    const meta = assertObject(obj.metadata, "metadata");
    assertExactKeys(meta, [], ["author", "timestamp"], "metadata");
    if (meta.author !== undefined) assertText(meta.author, 256, "metadata.author", false);
    if (meta.timestamp !== undefined) assertText(meta.timestamp, 64, "metadata.timestamp", false);
  }

  const briefDigest = assertDigest(obj.briefDigest, "briefDigest");
  const computed = computePacketDigest(obj as any);
  if (computed !== briefDigest) {
    throw new ThemeExchangeValidationError(`briefDigest mismatch: expected ${computed} but got ${briefDigest}`, "DIGEST_MISMATCH", "briefDigest");
  }

  return obj as unknown as ThemeBriefPacket;
}

export function validateThemeCandidate(raw: unknown): ThemeCandidatePacket {
  const obj = assertObject(raw, "candidate");
  assertExactKeys(
    obj,
    [
      "schema",
      "schemaVersion",
      "candidateId",
      "briefDigest",
      "theme",
      "themeDigest",
      "rationale",
      "visualEvidence",
      "candidateDigest",
    ],
    ["packageMetadata", "claimedProvenance", "claimedDiagnostics", "claimedCssDigest"],
    "candidate"
  );

  if (obj.schema !== SCHEMA_THEME_CANDIDATE) {
    throw new ThemeExchangeValidationError(`Expected schema '${SCHEMA_THEME_CANDIDATE}'`, "SCHEMA_ERROR", "schema");
  }
  if (obj.schemaVersion !== THEME_EXCHANGE_SCHEMA_VERSION) {
    throw new ThemeExchangeValidationError("Expected schemaVersion 1", "SCHEMA_ERROR", "schemaVersion");
  }

  assertId(obj.candidateId, "candidateId");
  assertDigest(obj.briefDigest, "briefDigest");

  const theme = validateThemeSpecification(obj.theme);
  const canonicalTheme = canonicalizeSpecification(theme);
  const expectedThemeDigest = `sha256:${canonicalTheme.inputDigest}`;
  if (obj.themeDigest !== expectedThemeDigest) {
    throw new ThemeExchangeValidationError(`themeDigest mismatch: expected ${expectedThemeDigest} but got ${obj.themeDigest}`, "DIGEST_MISMATCH", "themeDigest");
  }

  assertText(obj.rationale, MAX_GENERAL_TEXT_BYTES, "rationale", true);

  if (obj.packageMetadata !== undefined) {
    validatePackageMetadata(obj.packageMetadata);
  }

  if (obj.claimedProvenance !== undefined) {
    const prov = assertObject(obj.claimedProvenance, "claimedProvenance");
    assertExactKeys(prov, [], ["author", "toolName", "toolVersion", "timestamp"], "claimedProvenance");
    if (prov.author !== undefined) assertText(prov.author, 256, "claimedProvenance.author", false);
    if (prov.toolName !== undefined) assertText(prov.toolName, 256, "claimedProvenance.toolName", false);
    if (prov.toolVersion !== undefined) assertText(prov.toolVersion, 128, "claimedProvenance.toolVersion", false);
    if (prov.timestamp !== undefined) assertText(prov.timestamp, 64, "claimedProvenance.timestamp", false);
  }

  if (obj.claimedCssDigest !== undefined) {
    assertDigest(obj.claimedCssDigest, "claimedCssDigest");
  }

  if (obj.claimedDiagnostics !== undefined) {
    if (!Array.isArray(obj.claimedDiagnostics)) {
      throw new ThemeExchangeValidationError("claimedDiagnostics must be an array", "SCHEMA_ERROR", "claimedDiagnostics");
    }
  }

  validateVisualEvidenceArray(obj.visualEvidence, MAX_VISUAL_RECORDS, "visualEvidence");

  const candidateDigest = assertDigest(obj.candidateDigest, "candidateDigest");
  const computed = computePacketDigest(obj as any);
  if (computed !== candidateDigest) {
    throw new ThemeExchangeValidationError(`candidateDigest mismatch: expected ${computed} but got ${candidateDigest}`, "DIGEST_MISMATCH", "candidateDigest");
  }

  return obj as unknown as ThemeCandidatePacket;
}

export function validateThemeReview(raw: unknown): ThemeReviewPacket {
  const obj = assertObject(raw, "review");
  assertExactKeys(
    obj,
    [
      "schema",
      "schemaVersion",
      "reviewId",
      "briefDigest",
      "candidateDigests",
      "dispositions",
      "annotations",
      "overallDisposition",
      "summary",
      "reviewDigest",
    ],
    [],
    "review"
  );

  if (obj.schema !== SCHEMA_THEME_REVIEW) {
    throw new ThemeExchangeValidationError(`Expected schema '${SCHEMA_THEME_REVIEW}'`, "SCHEMA_ERROR", "schema");
  }
  if (obj.schemaVersion !== THEME_EXCHANGE_SCHEMA_VERSION) {
    throw new ThemeExchangeValidationError("Expected schemaVersion 1", "SCHEMA_ERROR", "schemaVersion");
  }

  assertId(obj.reviewId, "reviewId");
  assertDigest(obj.briefDigest, "briefDigest");

  if (!Array.isArray(obj.candidateDigests) || obj.candidateDigests.length < 1 || obj.candidateDigests.length > MAX_CANDIDATES) {
    throw new ThemeExchangeValidationError(`candidateDigests must contain 1..${MAX_CANDIDATES} items`, "BOUNDS_ERROR", "candidateDigests");
  }
  for (const d of obj.candidateDigests) {
    assertDigest(d, "candidateDigests");
  }
  assertSortedUnique(obj.candidateDigests as string[], "candidateDigests");

  const candidateSet = new Set(obj.candidateDigests as string[]);

  if (!Array.isArray(obj.dispositions) || obj.dispositions.length !== obj.candidateDigests.length) {
    throw new ThemeExchangeValidationError("dispositions array length must match candidateDigests", "SCHEMA_ERROR", "dispositions");
  }

  const validDispositions = ["unreviewed", "preferred", "approved", "rejected", "needs-revision", "deferred"];
  const seenDisps = new Set<string>();
  let preferredOrApprovedCount = 0;

  for (let i = 0; i < obj.dispositions.length; i++) {
    const disp = assertObject(obj.dispositions[i], `dispositions[${i}]`);
    assertExactKeys(disp, ["candidateDigest", "disposition"], ["comment"], `dispositions[${i}]`);
    const cDigest = assertDigest(disp.candidateDigest, `dispositions[${i}].candidateDigest`);
    if (!candidateSet.has(cDigest)) {
      throw new ThemeExchangeValidationError(`Disposition references unknown candidateDigest '${cDigest}'`, "UNKNOWN_REFERENCE", `dispositions[${i}].candidateDigest`);
    }
    if (seenDisps.has(cDigest)) {
      throw new ThemeExchangeValidationError(`Duplicate disposition for candidateDigest '${cDigest}'`, "DUPLICATE_ELEMENTS", `dispositions[${i}]`);
    }
    seenDisps.add(cDigest);

    const val = disp.disposition;
    if (typeof val !== "string" || !validDispositions.includes(val)) {
      throw new ThemeExchangeValidationError(`Invalid disposition value '${val}'`, "SCHEMA_ERROR", `dispositions[${i}].disposition`);
    }
    if (val === "preferred" || val === "approved") {
      preferredOrApprovedCount++;
    }
    if (disp.comment !== undefined) {
      assertText(disp.comment, MAX_ANNOTATION_COMMENT_BYTES, `dispositions[${i}].comment`, true);
    }
  }

  // Must be sorted by candidateDigest matching candidateDigests
  for (let i = 0; i < obj.dispositions.length; i++) {
    if (obj.dispositions[i].candidateDigest !== obj.candidateDigests[i]) {
      throw new ThemeExchangeValidationError("dispositions array must be sorted matching candidateDigests", "ORDERING_ERROR", "dispositions");
    }
  }

  if (preferredOrApprovedCount > 1) {
    throw new ThemeExchangeValidationError("At most one candidate may be marked 'preferred' or 'approved'", "CONSTRAINT_ERROR", "dispositions");
  }

  // Validate overallDisposition
  const overall = assertObject(obj.overallDisposition, "overallDisposition");
  const overallKind = overall.kind;
  const validOverallKinds = ["no-decision", "rejected-all", "preferred", "approved", "needs-revision"];
  if (typeof overallKind !== "string" || !validOverallKinds.includes(overallKind)) {
    throw new ThemeExchangeValidationError(`Invalid overallDisposition kind '${overallKind}'`, "SCHEMA_ERROR", "overallDisposition.kind");
  }

  if (overallKind === "no-decision") {
    assertExactKeys(overall, ["kind"], [], "overallDisposition");
    if (preferredOrApprovedCount > 0) {
      throw new ThemeExchangeValidationError("overallDisposition cannot be 'no-decision' when a candidate is preferred or approved", "CONSTRAINT_ERROR", "overallDisposition");
    }
  } else if (overallKind === "rejected-all") {
    assertExactKeys(overall, ["kind"], [], "overallDisposition");
    const allRejected = obj.dispositions.every((d: any) => d.disposition === "rejected");
    if (!allRejected) {
      throw new ThemeExchangeValidationError("overallDisposition 'rejected-all' requires all candidates to be rejected", "CONSTRAINT_ERROR", "overallDisposition");
    }
  } else {
    // "preferred" | "approved" | "needs-revision"
    assertExactKeys(overall, ["kind", "candidateDigest"], [], "overallDisposition");
    const targetCandidate = assertDigest(overall.candidateDigest, "overallDisposition.candidateDigest");
    if (!candidateSet.has(targetCandidate)) {
      throw new ThemeExchangeValidationError(`overallDisposition candidateDigest '${targetCandidate}' not in candidateDigests`, "UNKNOWN_REFERENCE", "overallDisposition.candidateDigest");
    }
    const matchingDisp = obj.dispositions.find((d: any) => d.candidateDigest === targetCandidate);
    if (!matchingDisp || matchingDisp.disposition !== overallKind) {
      throw new ThemeExchangeValidationError(
        `overallDisposition '${overallKind}' requires candidate '${targetCandidate}' to have matching disposition '${overallKind}' (got '${matchingDisp?.disposition}')`,
        "CONSTRAINT_ERROR",
        "overallDisposition"
      );
    }
  }

  // Validate annotations
  if (!Array.isArray(obj.annotations)) {
    throw new ThemeExchangeValidationError("annotations must be an array", "SCHEMA_ERROR", "annotations");
  }
  if (obj.annotations.length > MAX_ANNOTATIONS) {
    throw new ThemeExchangeValidationError(`annotations array exceeds maximum count of ${MAX_ANNOTATIONS}`, "BOUNDS_ERROR", "annotations");
  }
  const annotationIds = new Set<string>();
  for (let i = 0; i < obj.annotations.length; i++) {
    const ann = validateThemeAnnotation(obj.annotations[i], `annotations[${i}]`);
    if (annotationIds.has(ann.annotationId)) {
      throw new ThemeExchangeValidationError(`Duplicate annotationId '${ann.annotationId}'`, "DUPLICATE_ELEMENTS", `annotations[${i}].annotationId`);
    }
    annotationIds.add(ann.annotationId);
    if (!candidateSet.has(ann.candidateDigest)) {
      throw new ThemeExchangeValidationError(`Annotation '${ann.annotationId}' references unknown candidate '${ann.candidateDigest}'`, "UNKNOWN_REFERENCE", `annotations[${i}].candidateDigest`);
    }
  }
  assertSortedUnique([...annotationIds], "annotations.annotationId");

  assertText(obj.summary, MAX_GENERAL_TEXT_BYTES, "summary", true);

  const reviewDigest = assertDigest(obj.reviewDigest, "reviewDigest");
  const computed = computePacketDigest(obj as any);
  if (computed !== reviewDigest) {
    throw new ThemeExchangeValidationError(`reviewDigest mismatch: expected ${computed} but got ${reviewDigest}`, "DIGEST_MISMATCH", "reviewDigest");
  }

  return obj as unknown as ThemeReviewPacket;
}

export function validateThemeExchangePacket(raw: unknown): ThemeExchangePacket {
  const obj = assertObject(raw, "packet");
  const schema = obj.schema;
  if (schema === SCHEMA_THEME_BRIEF) {
    return validateThemeBrief(raw);
  }
  if (schema === SCHEMA_THEME_CANDIDATE) {
    return validateThemeCandidate(raw);
  }
  if (schema === SCHEMA_THEME_REVIEW) {
    return validateThemeReview(raw);
  }
  throw new ThemeExchangeValidationError(`Unknown exchange packet schema: '${schema}'`, "UNKNOWN_SCHEMA", "schema");
}
