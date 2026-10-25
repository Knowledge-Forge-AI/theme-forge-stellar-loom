import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

export type LegalFilePath = "COMMERCIAL-LICENSE.md" | "LICENSE" | "NOTICE";

export interface LegalProfileRow {
  readonly path: LegalFilePath;
  readonly bytes: number;
  readonly sha256: string;
}

export interface LegalConstantsModule {
  readonly AGPL_3_LICENSE_TEXT: string;
  readonly FIRST_PARTY_NOTICE_TEXT: string;
  readonly COMMERCIAL_LICENSE_TEXT: string;
}

export const LEGAL_FILE_PATHS: readonly LegalFilePath[] = Object.freeze([
  "COMMERCIAL-LICENSE.md",
  "LICENSE",
  "NOTICE",
]);

export const HISTORICAL_CONTACT = "lair001@gmail.com";
export const CURRENT_CONTACT = "sam.lair@knowledge-forge.ai";

export const HISTORICAL_LEGAL_PROFILE: Readonly<Record<LegalFilePath, LegalProfileRow>> = Object.freeze({
  "COMMERCIAL-LICENSE.md": Object.freeze({
    path: "COMMERCIAL-LICENSE.md",
    bytes: 932,
    sha256: "a81bcda7ec57a5c09f1cc6d05de420db7a0053b9496f1762065e083a60e5ede2",
  }),
  LICENSE: Object.freeze({
    path: "LICENSE",
    bytes: 34460,
    sha256: "62eef07fc3ad238dd889ff98cf9ed87b3ef0f421579b6945f87ec37c608afb62",
  }),
  NOTICE: Object.freeze({
    path: "NOTICE",
    bytes: 598,
    sha256: "e711709e69f5f8fc65c55ff3b3e47c390ed8f60890eb38cf999d95c2494b5d17",
  }),
});

const DOGFOOD_MANIFEST_SHA256 = "3cc8b29615e82ad21445ee604c52b04066ebeebb948206e58375086a56a08e6f";
const DOGFOOD_MANIFEST_BYTES = 588241;
const HEX64_RE = /^[a-f0-9]{64}$/;
const fixturesRoot = new URL("./fixtures/", import.meta.url);

function sha256Hex(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

function isLegalFilePath(value: string): value is LegalFilePath {
  return (LEGAL_FILE_PATHS as readonly string[]).includes(value);
}

function toProfileMap(
  profile:
    | Readonly<Record<LegalFilePath, LegalProfileRow>>
    | readonly { readonly path: string; readonly bytes: number; readonly sha256: string }[]
): Readonly<Record<LegalFilePath, LegalProfileRow>> {
  const map = new Map<LegalFilePath, LegalProfileRow>();
  const rows = Array.isArray(profile)
    ? profile
    : Object.keys(profile).map((key) => (profile as Record<string, LegalProfileRow>)[key]!);

  if (rows.length !== LEGAL_FILE_PATHS.length) {
    throw new Error(`Legal profile must have exactly ${LEGAL_FILE_PATHS.length} rows`);
  }
  for (const row of rows) {
    if (
      row === null ||
      typeof row !== "object" ||
      typeof row.path !== "string" ||
      !isLegalFilePath(row.path) ||
      typeof row.bytes !== "number" ||
      !Number.isInteger(row.bytes) ||
      row.bytes <= 0 ||
      typeof row.sha256 !== "string" ||
      !HEX64_RE.test(row.sha256)
    ) {
      throw new Error(`Malformed legal profile row for '${String((row as { path?: unknown })?.path)}'`);
    }
    if (map.has(row.path)) {
      throw new Error(`Duplicate legal profile row for '${row.path}'`);
    }
    map.set(row.path, { path: row.path, bytes: row.bytes, sha256: row.sha256 });
  }
  for (const required of LEGAL_FILE_PATHS) {
    if (!map.has(required)) {
      throw new Error(`Missing legal profile row for '${required}'`);
    }
  }
  return {
    "COMMERCIAL-LICENSE.md": map.get("COMMERCIAL-LICENSE.md")!,
    LICENSE: map.get("LICENSE")!,
    NOTICE: map.get("NOTICE")!,
  };
}

function toFileMap(
  filesInput:
    | ReadonlyMap<string, string | Uint8Array>
    | readonly (readonly [string, unknown])[]
    | Readonly<Record<string, string | Uint8Array>>
): Map<string, string | Uint8Array> {
  const result = new Map<string, string | Uint8Array>();
  if (filesInput instanceof Map) {
    for (const [k, v] of filesInput.entries()) {
      result.set(k, v);
    }
    return result;
  }
  if (Array.isArray(filesInput)) {
    for (const entry of filesInput) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") {
        throw new Error("Invalid file tuple entry");
      }
      const [path, content] = entry;
      if (typeof content === "string" || content instanceof Uint8Array) {
        result.set(path, content);
      }
    }
    return result;
  }
  if (filesInput !== null && typeof filesInput === "object") {
    for (const [k, v] of Object.entries(filesInput)) {
      if (typeof v === "string" || v instanceof Uint8Array) {
        result.set(k, v);
      }
    }
    return result;
  }
  throw new Error("Unsupported files collection for legal profile check");
}

export function assertLegalProfileConsistency(
  filesInput:
    | ReadonlyMap<string, string | Uint8Array>
    | readonly (readonly [string, unknown])[]
    | Readonly<Record<string, string | Uint8Array>>,
  provenanceRowsInput: readonly {
    readonly path: string;
    readonly size?: number;
    readonly bytes?: number;
    readonly byteLength?: number;
    readonly sha256: string;
  }[],
  expectedProfile:
    | Readonly<Record<LegalFilePath, LegalProfileRow>>
    | readonly { readonly path: string; readonly bytes: number; readonly sha256: string }[],
  expectedContact?: string
): void {
  if (!Array.isArray(provenanceRowsInput)) {
    throw new Error("Provenance rows must be an array");
  }
  const profileMap = toProfileMap(expectedProfile);
  const files = toFileMap(filesInput);

  for (const legalPath of LEGAL_FILE_PATHS) {
    const expectedRow = profileMap[legalPath];
    const content = files.get(legalPath);
    if (content === undefined) {
      throw new Error(`Missing emitted legal file '${legalPath}'`);
    }
    const actualBytes = Buffer.byteLength(content);
    const actualSha256 = sha256Hex(content);
    if (actualBytes !== expectedRow.bytes || actualSha256 !== expectedRow.sha256) {
      throw new Error(
        `Legal file '${legalPath}' mismatch: got ${actualBytes}/${actualSha256}, expected ${expectedRow.bytes}/${expectedRow.sha256}`
      );
    }

    const text = typeof content === "string" ? content : Buffer.from(content).toString("utf8");
    if (expectedContact !== undefined && (legalPath === "NOTICE" || legalPath === "COMMERCIAL-LICENSE.md")) {
      if (!text.includes(expectedContact)) {
        throw new Error(`Legal file '${legalPath}' is missing expected contact '${expectedContact}'`);
      }
      const forbiddenContact =
        expectedContact === CURRENT_CONTACT
          ? HISTORICAL_CONTACT
          : expectedContact === HISTORICAL_CONTACT
            ? CURRENT_CONTACT
            : undefined;
      if (forbiddenContact !== undefined && text.includes(forbiddenContact)) {
        throw new Error(`Legal file '${legalPath}' contains mixed/forbidden contact '${forbiddenContact}'`);
      }
    }

    const matchingRows = provenanceRowsInput.filter(
      (row) => row !== null && typeof row === "object" && row.path === legalPath
    );
    if (matchingRows.length !== 1) {
      throw new Error(`Expected exactly 1 provenance row for '${legalPath}', found ${matchingRows.length}`);
    }
    const provRow = matchingRows[0]!;
    const provSize = provRow.size ?? provRow.bytes ?? provRow.byteLength;
    if (typeof provSize !== "number" || !Number.isInteger(provSize)) {
      throw new Error(`Provenance row for '${legalPath}' has invalid size`);
    }
    if (provSize !== actualBytes || provRow.sha256 !== actualSha256) {
      throw new Error(
        `Provenance row for '${legalPath}' (${provSize}/${provRow.sha256}) disagrees with emitted file (${actualBytes}/${actualSha256})`
      );
    }
  }
}

export function assertHistoricalLegalRecord(recordFiles: unknown, label = "record"): void {
  if (Array.isArray(recordFiles)) {
    if (recordFiles.length === 0) {
      throw new Error(`Empty historical record array in ${label}`);
    }
    const first = recordFiles[0];
    if (Array.isArray(first)) {
      const tupleEntries = recordFiles as readonly (readonly [string, unknown])[];
      const fileMap = toFileMap(tupleEntries);
      const provenanceRaw = fileMap.get("provenance.json");
      if (typeof provenanceRaw !== "string") {
        throw new Error(`Missing string provenance.json in tuple record ${label}`);
      }
      const provenance = JSON.parse(provenanceRaw) as {
        files?: { path: string; size?: number; sha256: string }[];
      };
      if (!Array.isArray(provenance.files)) {
        throw new Error(`Malformed provenance.json files in tuple record ${label}`);
      }
      assertLegalProfileConsistency(
        fileMap,
        provenance.files,
        HISTORICAL_LEGAL_PROFILE,
        HISTORICAL_CONTACT
      );
      return;
    }

    for (const legalPath of LEGAL_FILE_PATHS) {
      const expected = HISTORICAL_LEGAL_PROFILE[legalPath];
      const matches = recordFiles.filter(
        (item): item is { path: string; sha256: string; bytes?: number; byteLength?: number; size?: number } =>
          item !== null && typeof item === "object" && (item as { path?: unknown }).path === legalPath
      );
      if (matches.length !== 1) {
        throw new Error(`Expected 1 '${legalPath}' row in ${label}, found ${matches.length}`);
      }
      const row = matches[0]!;
      const actualBytes = row.bytes ?? row.byteLength ?? row.size;
      if (actualBytes !== expected.bytes || row.sha256 !== expected.sha256) {
        throw new Error(
          `Historical record '${label}' mismatch on '${legalPath}': got ${String(actualBytes)}/${String(row.sha256)}`
        );
      }
    }
    return;
  }

  if (recordFiles !== null && typeof recordFiles === "object") {
    const recordObj = recordFiles as Record<string, unknown>;
    for (const legalPath of LEGAL_FILE_PATHS) {
      const expected = HISTORICAL_LEGAL_PROFILE[legalPath];
      if (!Object.hasOwn(recordObj, legalPath)) {
        throw new Error(`Missing '${legalPath}' in historical packageFiles record ${label}`);
      }
      const entry = recordObj[legalPath];
      if (entry === null || typeof entry !== "object") {
        throw new Error(`Malformed '${legalPath}' entry in ${label}`);
      }
      const meta = entry as { sha256?: unknown; byteLength?: unknown; bytes?: unknown; size?: unknown };
      const actualBytes = meta.byteLength ?? meta.bytes ?? meta.size;
      if (actualBytes !== expected.bytes || meta.sha256 !== expected.sha256) {
        throw new Error(
          `Historical packageFiles '${label}' mismatch on '${legalPath}': got ${String(actualBytes)}/${String(meta.sha256)}`
        );
      }
    }
    return;
  }

  throw new Error(`Unsupported historical record shape in ${label}`);
}

function validateCurrentLegalModuleExports(original: unknown): LegalConstantsModule {
  if (original === null || typeof original !== "object" || Array.isArray(original)) {
    throw new Error("Original legal.ts module export must be an object");
  }
  const keys = Object.keys(original).sort();
  if (
    keys.length !== 3 ||
    keys[0] !== "AGPL_3_LICENSE_TEXT" ||
    keys[1] !== "COMMERCIAL_LICENSE_TEXT" ||
    keys[2] !== "FIRST_PARTY_NOTICE_TEXT"
  ) {
    throw new Error(`Unexpected export keys on legal.ts: ${keys.join(", ")}`);
  }
  const mod = original as Record<string, unknown>;
  if (
    typeof mod.AGPL_3_LICENSE_TEXT !== "string" ||
    typeof mod.FIRST_PARTY_NOTICE_TEXT !== "string" ||
    typeof mod.COMMERCIAL_LICENSE_TEXT !== "string"
  ) {
    throw new Error("All legal.ts exports must be strings");
  }
  const licenseBytes = Buffer.byteLength(mod.AGPL_3_LICENSE_TEXT, "utf8");
  const licenseSha = sha256Hex(mod.AGPL_3_LICENSE_TEXT);
  if (
    licenseBytes !== HISTORICAL_LEGAL_PROFILE.LICENSE.bytes ||
    licenseSha !== HISTORICAL_LEGAL_PROFILE.LICENSE.sha256
  ) {
    throw new Error("AGPL_3_LICENSE_TEXT must remain unchanged across the contact transition");
  }
  if (
    !mod.FIRST_PARTY_NOTICE_TEXT.includes(CURRENT_CONTACT) ||
    mod.FIRST_PARTY_NOTICE_TEXT.includes(HISTORICAL_CONTACT) ||
    !mod.COMMERCIAL_LICENSE_TEXT.includes(CURRENT_CONTACT) ||
    mod.COMMERCIAL_LICENSE_TEXT.includes(HISTORICAL_CONTACT)
  ) {
    throw new Error("Production legal.ts must retain the current maintained contact");
  }
  return {
    AGPL_3_LICENSE_TEXT: mod.AGPL_3_LICENSE_TEXT,
    FIRST_PARTY_NOTICE_TEXT: mod.FIRST_PARTY_NOTICE_TEXT,
    COMMERCIAL_LICENSE_TEXT: mod.COMMERCIAL_LICENSE_TEXT,
  };
}

export function historicalLegalModule(original: unknown): LegalConstantsModule {
  const currentMod = validateCurrentLegalModuleExports(original);

  // 1. Validate v1-baseline manifest and both example fixture directories
  const v1ManifestUrl = new URL("v1-baseline/manifest.json", fixturesRoot);
  const v1Manifest = JSON.parse(readFileSync(v1ManifestUrl, "utf8")) as {
    examples?: Record<string, { packageFiles?: Record<string, { sha256: string; byteLength: number }> }>;
  };
  const v1Examples = ["stellar-cyan", "amber-forge"] as const;
  let anchoredFiles: Map<LegalFilePath, string> | undefined;

  for (const example of v1Examples) {
    const pkgFilesMeta = v1Manifest.examples?.[example]?.packageFiles;
    assertHistoricalLegalRecord(pkgFilesMeta, `v1-baseline/${example}/packageFiles`);

    const pkgMap = new Map<string, string>();
    const currentExampleLegal = new Map<LegalFilePath, string>();
    for (const legalPath of LEGAL_FILE_PATHS) {
      const content = readFileSync(new URL(`v1-baseline/${example}/package/${legalPath}`, fixturesRoot), "utf8");
      pkgMap.set(legalPath, content);
      currentExampleLegal.set(legalPath, content);
    }
    const provRaw = readFileSync(new URL(`v1-baseline/${example}/package/provenance.json`, fixturesRoot), "utf8");
    const prov = JSON.parse(provRaw) as { files: { path: string; size: number; sha256: string }[] };
    assertLegalProfileConsistency(pkgMap, prov.files, HISTORICAL_LEGAL_PROFILE, HISTORICAL_CONTACT);

    if (!anchoredFiles) {
      anchoredFiles = currentExampleLegal;
    } else {
      for (const legalPath of LEGAL_FILE_PATHS) {
        if (anchoredFiles.get(legalPath) !== currentExampleLegal.get(legalPath)) {
          throw new Error(`v1-baseline legal file '${legalPath}' differs between stellar-cyan and amber-forge`);
        }
      }
    }
  }

  const licenseText = anchoredFiles!.get("LICENSE")!;
  const noticeText = anchoredFiles!.get("NOTICE")!;
  const commercialText = anchoredFiles!.get("COMMERCIAL-LICENSE.md")!;

  if (licenseText !== currentMod.AGPL_3_LICENSE_TEXT) {
    throw new Error("Historical LICENSE fixture bytes must equal current AGPL_3_LICENSE_TEXT");
  }

  // 2. Validate catalog-dogfood-baseline manifest and all 10 records
  const dogfoodRaw = readFileSync(new URL("catalog-dogfood-baseline/manifest.json", fixturesRoot));
  if (
    dogfoodRaw.byteLength !== DOGFOOD_MANIFEST_BYTES ||
    sha256Hex(dogfoodRaw) !== DOGFOOD_MANIFEST_SHA256
  ) {
    throw new Error("catalog-dogfood-baseline/manifest.json preimage pin mismatch");
  }
  const dogfood = JSON.parse(dogfoodRaw.toString("utf8")) as {
    records?: { name: string; accent: string; files: unknown }[];
  };
  if (!Array.isArray(dogfood.records) || dogfood.records.length !== 10) {
    throw new Error("Expected 10 records in catalog-dogfood-baseline/manifest.json");
  }
  for (const record of dogfood.records) {
    assertHistoricalLegalRecord(record.files, `catalog-dogfood/${record.name}/${record.accent}`);
  }

  // 3. Validate all 10 code-catalog-baseline records
  const codeCatalogDir = new URL("code-catalog-baseline/", fixturesRoot);
  const codeCatalogNames = readdirSync(codeCatalogDir).sort();
  if (codeCatalogNames.length !== 10) {
    throw new Error(`Expected 10 code-catalog-baseline fixtures, found ${codeCatalogNames.length}`);
  }
  for (const name of codeCatalogNames) {
    const parsed = JSON.parse(readFileSync(new URL(name, codeCatalogDir), "utf8")) as { files?: unknown };
    assertHistoricalLegalRecord(parsed.files, `code-catalog-baseline/${name}`);
  }

  // 4. Validate all 10 package-bearing core-code-baseline records
  const coreCodeDir = new URL("core-code-baseline/", fixturesRoot);
  const coreCodeNames = readdirSync(coreCodeDir).sort();
  let corePackageCount = 0;
  for (const name of coreCodeNames) {
    const parsed = JSON.parse(readFileSync(new URL(name, coreCodeDir), "utf8")) as {
      styles?: unknown;
      files?: unknown;
    };
    if (parsed.styles) {
      continue;
    }
    corePackageCount += 1;
    assertHistoricalLegalRecord(parsed.files, `core-code-baseline/${name}`);
  }
  if (corePackageCount !== 10) {
    throw new Error(`Expected 10 package records in core-code-baseline, found ${corePackageCount}`);
  }

  return Object.freeze({
    AGPL_3_LICENSE_TEXT: licenseText,
    FIRST_PARTY_NOTICE_TEXT: noticeText,
    COMMERCIAL_LICENSE_TEXT: commercialText,
  });
}
