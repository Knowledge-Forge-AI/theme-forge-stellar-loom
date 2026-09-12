import { readFileSync } from "node:fs";
import { expect } from "vitest";

// Exact repository qualification amendments do not rewrite semantic catalog pins.
export function qualifiedSourceDigest(path: string, historical: string): string {
  const qualification = JSON.parse(readFileSync(new URL("../protocol/catalog-source-qualification.json", import.meta.url), "utf8"));
  const amendments = qualification.recoverySourceAmendment.sources;
  expect(Object.keys(amendments).sort()).toEqual(["cli-v2.ts", "design-exchange-catalog/executable.ts", "font-resources.ts"]);
  if (!Object.hasOwn(amendments, path)) return historical;
  const amendment = amendments[path];
  expect(amendment.historicalSha256, path).toBe(historical);
  expect(qualification.sources.find((row: {path: string}) => row.path === `src/${path}`)?.sha256).toBe(amendment.qualifiedSha256);
  return amendment.qualifiedSha256;
}
