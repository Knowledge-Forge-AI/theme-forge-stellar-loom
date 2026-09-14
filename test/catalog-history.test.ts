// Historical output regression: keep the original producer metadata explicit.
// Current release provenance and installed equality are qualified separately.
import { vi } from "vitest";
vi.mock("../src/v2/types.js", async (original) => ({
  ...await original<typeof import("../src/v2/types.js")>(),
  COMPILER_VERSION: "0.1.1",
}));
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { generateThemePackage } from "../src/index-catalog.js";
import { verifyThemeCandidateCompatible } from "../src/design-exchange-code/index.js";

const root = new URL("./fixtures/code-catalog-baseline/", import.meta.url);
describe("literal accepted code packages and packets across catalog dispatch", () => {
  for (const name of readdirSync(root)) it(name, () => {
    const baseline = JSON.parse(readFileSync(new URL(name, root), "utf8"));
    const result = generateThemePackage({ themeSpec: baseline.spec, metadata: baseline.metadata, accent: baseline.accent });
    expect([...result.files]).toEqual(baseline.files);
    expect(verifyThemeCandidateCompatible(baseline.packet).valid).toBe(true);
  });
});
