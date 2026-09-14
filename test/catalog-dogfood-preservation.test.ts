// Historical output regression: keep the original producer metadata explicit.
// Current release provenance and installed equality are qualified separately.
import { vi } from "vitest";
vi.mock("../src/v2/types.js", async (original) => ({
  ...await original<typeof import("../src/v2/types.js")>(),
  COMPILER_VERSION: "0.1.1",
}));
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { generateThemePackageCatalog } from "../src/catalog/index.js";

const root = new URL("./fixtures/", import.meta.url);
const baseline = JSON.parse(readFileSync(new URL("catalog-dogfood-baseline/manifest.json", root), "utf8"));
describe("catalog outputs preserved across runtime guard correction", () => {
  for (const record of baseline.records) it(`${record.name}/${record.accent}`, () => {
    const fontResources = record.spec.fonts.length ? new Map([["source-code-pro", readFileSync(new URL("catalog-font/source-code-pro.woff2", root))]]) : new Map();
    const result = generateThemePackageCatalog({themeSpec: record.spec, metadata: record.metadata, accent: record.accent, fontResources});
    expect([...result.files].map(([path, bytes]) => ({path, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: Buffer.byteLength(bytes)}))).toEqual(record.files);
  });
});
