// Historical output regression: keep the original producer metadata explicit.
// Current release provenance and installed equality are qualified separately.
import { vi } from "vitest";
vi.mock("../src/v2/types.js", async (original) => ({
  ...await original<typeof import("../src/v2/types.js")>(),
  COMPILER_VERSION: "0.1.1",
}));
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { type ThemeSpecificationV2, compileTheme, generateThemePackage } from "../src/index.js";
import { verifyThemeCandidateV2 } from "../src/design-exchange-v2/index.js";

const root = new URL("./fixtures/core-code-baseline/", import.meta.url);
describe("literal accepted core preservation across code dispatch", () => {
  for (const name of readdirSync(root)) it(name, () => {
    const baseline = JSON.parse(readFileSync(new URL(name, root), "utf8"));
    if (baseline.styles) {
      const compiled = compileTheme(baseline.spec as ThemeSpecificationV2);
      expect([...compiled.styles]).toEqual(baseline.styles);
      expect(compiled.descriptor).toEqual(baseline.descriptor);
      return;
    }
    const resources = baseline.fontBytes
      ? new Map([[baseline.spec.fonts[0].id, Buffer.from(baseline.fontBytes, "base64")]])
      : new Map<string, Uint8Array>();
    const result = generateThemePackage({ themeSpec: baseline.spec, metadata: baseline.metadata, accent: baseline.accent, fontResources: resources });
    expect([...result.files].map(([path, content]) => [path, typeof content === "string" ? content : { base64: Buffer.from(content).toString("base64") }])).toEqual(baseline.files);
    expect(verifyThemeCandidateV2(baseline.packet, { fontResources: resources }).valid).toBe(true);
  });
});
