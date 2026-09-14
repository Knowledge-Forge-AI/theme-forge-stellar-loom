import { qualifiedSourceDigest } from "./recovery-source-qualification.js";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { STARLIGHT_CODE_CATALOG_V1 } from "../src/code/index.js";
import { generateThemePackageCode } from "../src/generator/code-emitter.js";
import { createThemeCodeCandidate, verifyThemeCodeCandidate, verifyThemeCandidateCompatible } from "../src/design-exchange-code/index.js";

describe("code qualification evidence", () => {
  it("binds the actual qualified behavior sources", () => {
    for (const [path, digest] of Object.entries(STARLIGHT_CODE_CATALOG_V1.sourceSha256)) {
      expect(createHash("sha256").update(readFileSync(new URL(`../src/${path}`, import.meta.url))).digest("hex"), path).toBe(qualifiedSourceDigest(path, digest));
    }
  });
  it("exchange reproduces every member of the public generated package", () => {
    const theme = JSON.parse(readFileSync(new URL("../examples/loom-black-code.theme.json", import.meta.url), "utf8"));
    const metadata = { name: "loom-code-evidence", version: "0.1.0" };
    const generated = generateThemePackageCode({ themeSpec: theme, metadata });
    const packet = createThemeCodeCandidate(theme, { metadata });
    expect(packet.outputInventory).toEqual([...generated.files].map(([id, bytes]) => ({ id, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` })));
    expect(verifyThemeCodeCandidate(packet).valid).toBe(true);
    expect(verifyThemeCandidateCompatible(packet).valid).toBe(true);
  });
  it("rejects packet tuple and array getters without executing them", () => {
    for (const verify of [verifyThemeCodeCandidate, verifyThemeCandidateCompatible]) {
      let calls = 0;
      const input = Object.defineProperty({}, "semanticCompiler", { enumerable: true, get() { calls++; return "tfsl.theme-compiler-v2-code-1"; } });
      expect(verify(input as any).valid).toBe(false);
      expect(calls).toBe(0);
    }
  });
});
