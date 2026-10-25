import { readFileSync } from "node:fs";
import { expect } from "vitest";

const RECOVERY_AMENDMENT_KEYS = [
  "cli-v2.ts",
  "design-exchange-catalog/executable.ts",
  "font-resources.ts",
] as const;

const CONTACT_AMENDMENT_SOURCE_KEY = "src/generator/legal.ts";
const CONTACT_AMENDMENT_RELATIVE_PATH = "generator/legal.ts";
const CONTACT_PREVIOUS_QUALIFIED_SHA256 = "1f389ed0d1286e9603890f7fd9ed5f2a4fd91c2981901dfea4ae4cb3b9a9b918";
const CONTACT_QUALIFIED_SHA256 = "e71b5c1b0a98089b0d4f5ff31dac7d3280a0e47a3cd3b9b5f5d150852048db5b";
const HEX64_RE = /^[a-f0-9]{64}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Exact repository qualification amendments do not rewrite semantic catalog pins.
export function resolveQualifiedSourceDigest(qualification: unknown, path: string, historical: string): string {
  expect(typeof path).toBe("string");
  expect(path.length).toBeGreaterThan(0);
  expect(path.startsWith("src/")).toBe(false);
  expect(historical).toMatch(HEX64_RE);
  expect(isPlainObject(qualification)).toBe(true);
  const q = qualification as Record<string, unknown>;
  expect(Array.isArray(q.sources)).toBe(true);
  const sources = q.sources as { path: string; sha256: string }[];

  expect(isPlainObject(q.recoverySourceAmendment)).toBe(true);
  const recoveryAmendmentObj = q.recoverySourceAmendment as Record<string, unknown>;
  expect(isPlainObject(recoveryAmendmentObj.sources)).toBe(true);
  const amendments = recoveryAmendmentObj.sources as Record<string, { historicalSha256: string; qualifiedSha256: string }>;

  expect(isPlainObject(q.contactSourceAmendment)).toBe(true);
  const contactAmendmentObj = q.contactSourceAmendment as Record<string, unknown>;
  expect(isPlainObject(contactAmendmentObj.sources)).toBe(true);
  const contactSources = contactAmendmentObj.sources as Record<
    string,
    { previousQualifiedSha256: string; qualifiedSha256: string }
  >;

  // Cross-amendment reuse must fail closed before and alongside exact key checks.
  for (const ck of Object.keys(contactSources)) {
    const stripped = ck.startsWith("src/") ? ck.slice(4) : ck;
    expect(Object.hasOwn(amendments, ck) || Object.hasOwn(amendments, stripped)).toBe(false);
  }
  for (const rk of Object.keys(amendments)) {
    expect(Object.hasOwn(contactSources, rk) || Object.hasOwn(contactSources, `src/${rk}`)).toBe(false);
  }

  expect(Object.keys(amendments).sort()).toEqual([...RECOVERY_AMENDMENT_KEYS]);
  for (const [, row] of Object.entries(amendments)) {
    expect(isPlainObject(row)).toBe(true);
    expect(Object.keys(row).sort()).toEqual(["historicalSha256", "qualifiedSha256"]);
    expect(row.historicalSha256).toMatch(HEX64_RE);
    expect(row.qualifiedSha256).toMatch(HEX64_RE);
  }

  expect(Object.keys(contactSources)).toEqual([CONTACT_AMENDMENT_SOURCE_KEY]);
  const contactRow = contactSources[CONTACT_AMENDMENT_SOURCE_KEY];
  expect(isPlainObject(contactRow)).toBe(true);
  expect(Object.keys(contactRow!).sort()).toEqual(["previousQualifiedSha256", "qualifiedSha256"]);
  expect(contactRow!.previousQualifiedSha256).toBe(CONTACT_PREVIOUS_QUALIFIED_SHA256);
  expect(contactRow!.qualifiedSha256).toBe(CONTACT_QUALIFIED_SHA256);
  expect(sources.find((row) => row.path === CONTACT_AMENDMENT_SOURCE_KEY)?.sha256).toBe(CONTACT_QUALIFIED_SHA256);

  if (path === CONTACT_AMENDMENT_RELATIVE_PATH) {
    expect(contactRow!.previousQualifiedSha256, path).toBe(historical);
    return contactRow!.qualifiedSha256;
  }

  if (Object.hasOwn(amendments, path)) {
    const amendment = amendments[path]!;
    expect(amendment.historicalSha256, path).toBe(historical);
    expect(sources.find((row) => row.path === `src/${path}`)?.sha256).toBe(amendment.qualifiedSha256);
    return amendment.qualifiedSha256;
  }

  const sourceRow = sources.find((row) => row.path === `src/${path}`);
  expect(sourceRow, path).toBeDefined();
  expect(sourceRow?.sha256, path).toBe(historical);
  return historical;
}

export function qualifiedSourceDigest(path: string, historical: string): string {
  const qualification = JSON.parse(
    readFileSync(new URL("../protocol/catalog-source-qualification.json", import.meta.url), "utf8")
  );
  return resolveQualifiedSourceDigest(qualification, path, historical);
}
