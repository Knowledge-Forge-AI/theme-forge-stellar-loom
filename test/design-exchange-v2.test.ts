import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  createThemeCandidateV2,
  parseThemeExchangeV2,
  serializeThemeExchangeV2,
  verifyThemeCandidateV2,
  importThemeV1ToV2,
  computePacketDigestV2,
  canonicalJson,
  ThemeExchangeV2ValidationError,
  CATALOG_V2_DIGEST,
  SEMANTIC_COMPILER_V2,
  ADAPTER_V2,
  CATALOG_V2,
  type ThemeCandidateV2Packet,
} from "../src/design-exchange-v2/index.js";
import {
  CATALOG_DIGEST,
  CATALOG_IDENTITY,
  COMPILER_SEMANTIC,
  COMPILER_PRODUCER,
  COMPILER_VERSION,
  STYLE_FILES,
  compileThemeV2,
} from "../src/v2/index.js";

const blackCoreJson = JSON.parse(
  readFileSync(resolve(__dirname, "../examples/loom-black-core.theme.json"), "utf8")
);
const flexokiCoreJson = JSON.parse(
  readFileSync(resolve(__dirname, "../examples/loom-flexoki-core.theme.json"), "utf8")
);
const celestiaCoreJson = JSON.parse(
  readFileSync(resolve(__dirname, "../examples/loom-celestia-core.theme.json"), "utf8")
);
const v1CandidateAJson = readFileSync(
  resolve(__dirname, "../protocol/tfsl-theme-evidence-v1/examples/candidate-a.tfsl-candidate.json"),
  "utf8"
);

describe("TFSL Design Exchange v2", () => {
  describe("Single Shared v2 Domain / Compiler / Catalog Integration", () => {
    it("binds to shared catalog digest and semantic compiler constants", () => {
      expect(CATALOG_V2).toBe(CATALOG_IDENTITY);
      expect(CATALOG_V2).toBe("tfsl.starlight-core-catalog-v1");
      expect(CATALOG_V2_DIGEST).toBe(`sha256:${CATALOG_DIGEST}`);
      expect(SEMANTIC_COMPILER_V2).toBe(COMPILER_SEMANTIC);
      expect(SEMANTIC_COMPILER_V2).toBe("tfsl.theme-compiler-v2-core-1");
      expect(ADAPTER_V2).toBe("starlight-v0.42");
    });

    it("creates a closed v2 candidate packet with exact output inventory and digests", () => {
      const candidate = createThemeCandidateV2(blackCoreJson, {
        candidateId: "black-core-candidate",
        rationale: "Initial candidate packet for loom-black-core",
      });

      expect(candidate.schema).toBe("tfsl.theme-candidate");
      expect(candidate.schemaVersion).toBe(2);
      expect(candidate.candidateId).toBe("black-core-candidate");
      expect(candidate.state).toBe("candidate");
      expect(candidate.semanticCompiler).toBe("tfsl.theme-compiler-v2-core-1");
      expect(candidate.adapter).toBe("starlight-v0.42");
      expect(candidate.catalog).toBe("tfsl.starlight-core-catalog-v1");
      expect(candidate.catalogDigest).toBe(`sha256:${CATALOG_DIGEST}`);

      // Check producer
      expect(candidate.producer.package).toBe(COMPILER_PRODUCER);
      expect(candidate.producer.version).toBe(COMPILER_VERSION);
      expect(candidate.producer.executableDigest).toMatch(/^sha256:[0-9a-f]{64}$/);

      // Verify digests match local compileThemeV2
      const cleanBlack = { ...blackCoreJson };
      delete cleanBlack.$schema;
      const compileRes = compileThemeV2(cleanBlack);
      expect(candidate.inputDigest).toBe(`sha256:${compileRes.inputDigest}`);
      expect(candidate.outputDigest).toBe(`sha256:${compileRes.outputDigest}`);

      // Verify outputInventory contains all 5 style files sorted by id
      expect(candidate.outputInventory).toHaveLength(STYLE_FILES.length);
      const inventoryIds = candidate.outputInventory.map((i) => i.id);
      expect(inventoryIds).toEqual([...STYLE_FILES]);
      for (const entry of candidate.outputInventory) {
        expect(entry.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
        const expectedFileDigest = `sha256:${createHash("sha256").update(compileRes.styles.get(entry.id)!, "utf8").digest("hex")}`;
        expect(entry.digest).toBe(expectedFileDigest);
      }

      // Self-digest check
      expect(candidate.candidateDigest).toBe(computePacketDigestV2(candidate));
    });

    it("supports selectedAccent for multi-accent theme specifications", () => {
      const candidate = createThemeCandidateV2(flexokiCoreJson, {
        candidateId: "flexoki-green-candidate",
        selectedAccent: "green",
        rationale: "Flexoki theme with green accent",
      });

      expect(candidate.selectedAccent).toBe("green");
      const cleanFlexoki = { ...flexokiCoreJson };
      delete cleanFlexoki.$schema;
      const compileRes = compileThemeV2(cleanFlexoki, { accent: "green" });
      expect(candidate.inputDigest).toBe(`sha256:${compileRes.inputDigest}`);
      expect(candidate.outputDigest).toBe(`sha256:${compileRes.outputDigest}`);
    });

    it("rejects unknown selectedAccent", () => {
      expect(() =>
        createThemeCandidateV2(blackCoreJson, { selectedAccent: "neon-pink" })
      ).toThrow(ThemeExchangeV2ValidationError);
    });

    it("rejects filesystem paths and traversal in candidate packets", () => {
      expect(() =>
        createThemeCandidateV2({
          ...blackCoreJson,
          name: "../traversal-theme",
        })
      ).toThrow();

      const candidate = createThemeCandidateV2(blackCoreJson);
      const badPacket = JSON.parse(JSON.stringify(candidate));
      badPacket.rationale = "/Users/private-user/secret/path";
      badPacket.candidateDigest = computePacketDigestV2(badPacket);
      expect(() => parseThemeExchangeV2(canonicalJson(badPacket))).toThrow(
        /PATH_FORBIDDEN/
      );
    });
  });

  describe("Serialization & Parsing (Serde)", () => {
    it("round-trips canonically formatted packets", () => {
      const candidate = createThemeCandidateV2(blackCoreJson);
      const serialized = serializeThemeExchangeV2(candidate);

      expect(serialized.endsWith("\n")).toBe(true);
      expect(!serialized.endsWith("\n\n")).toBe(true);
      expect(!serialized.includes("\r")).toBe(true);

      const parsed = parseThemeExchangeV2(serialized);
      expect(parsed).toEqual(candidate);
    });

    it("rejects non-canonical formatting (e.g. unindented or missing trailing newline)", () => {
      const candidate = createThemeCandidateV2(blackCoreJson);
      const minified = JSON.stringify(candidate);
      expect(() => parseThemeExchangeV2(minified)).toThrow(/NON_CANONICAL_JSON/);

      const noNewline = serializeThemeExchangeV2(candidate).trimEnd();
      expect(() => parseThemeExchangeV2(noNewline)).toThrow(/NON_CANONICAL_JSON/);
    });

    it("rejects UTF-8 BOM", () => {
      const candidate = createThemeCandidateV2(blackCoreJson);
      const serialized = "\ufeff" + serializeThemeExchangeV2(candidate);
      expect(() => parseThemeExchangeV2(serialized)).toThrow(/ILLEGAL_BOM/);
    });

    it("rejects duplicate JSON keys", () => {
      const candidate = createThemeCandidateV2(blackCoreJson);
      const serialized = serializeThemeExchangeV2(candidate);
      const dup = serialized.replace('"candidateId":', '"candidateId": "dup", "candidateId":');
      expect(() => parseThemeExchangeV2(dup)).toThrow(/DUPLICATE_KEY/);
    });

    it("rejects self-digest mismatch", () => {
      const candidate = createThemeCandidateV2(blackCoreJson);
      const tampered = {
        ...candidate,
        candidateDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      };
      expect(() => parseThemeExchangeV2(canonicalJson(tampered))).toThrow(
        /DIGEST_MISMATCH/
      );
    });
  });

  describe("Verification (verifyThemeCandidateV2)", () => {
    it("successfully verifies an authentic candidate packet", () => {
      const candidate = createThemeCandidateV2(blackCoreJson);
      const result = verifyThemeCandidateV2(candidate);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.candidateId).toBe(candidate.candidateId);
      expect(result.candidateDigest).toBe(candidate.candidateDigest);
      expect(result.inputDigest).toBe(candidate.inputDigest);
      expect(result.outputDigest).toBe(candidate.outputDigest);
      expect(result.descriptor?.catalogIdentity).toBe(CATALOG_IDENTITY);
      expect(result.descriptor?.catalogDigest).toBe(CATALOG_DIGEST);
      expect(result.compiledCss).toBeDefined();
      expect(result.styles?.size).toBe(5);
    });

    it("rejects unknown future semantic compiler", () => {
      const candidate = createThemeCandidateV2(blackCoreJson);
      const modified: any = {
        ...candidate,
        semanticCompiler: "tfsl.theme-compiler-v3-future",
      };
      modified.candidateDigest = computePacketDigestV2(modified);

      const result = verifyThemeCandidateV2(modified);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => /Unsupported semantic/.test(e))).toBe(true);
    });

    it("rejects unknown catalog or mismatched catalogDigest", () => {
      const candidate = createThemeCandidateV2(blackCoreJson);
      const modified: any = {
        ...candidate,
        catalogDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      };
      modified.candidateDigest = computePacketDigestV2(modified);

      const result = verifyThemeCandidateV2(modified);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Catalog digest mismatch") || e.includes("catalogDigest mismatch"))).toBe(true);
    });

    it("rejects tampered outputDigest", () => {
      const candidate = createThemeCandidateV2(blackCoreJson);
      const modified: any = {
        ...candidate,
        outputDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      };
      modified.candidateDigest = computePacketDigestV2(modified);

      const result = verifyThemeCandidateV2(modified);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("outputDigest mismatch"))).toBe(true);
    });

    it("rejects tampered output inventory entry", () => {
      const candidate = createThemeCandidateV2(blackCoreJson);
      const modified: any = {
        ...candidate,
        outputInventory: candidate.outputInventory.map((item) =>
          item.id === "styles/accent.css"
            ? { ...item, digest: "sha256:3333333333333333333333333333333333333333333333333333333333333333" }
            : item
        ),
      };
      modified.candidateDigest = computePacketDigestV2(modified);

      const result = verifyThemeCandidateV2(modified);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("tamper detected"))).toBe(true);
    });

    it("rejects state other than candidate (never adopted)", () => {
      const candidate = createThemeCandidateV2(blackCoreJson);
      const modified: any = {
        ...candidate,
        state: "adopted",
      };
      modified.candidateDigest = computePacketDigestV2(modified);

      const result = verifyThemeCandidateV2(modified);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Candidate state must be 'candidate'"))).toBe(true);
    });
  });

  describe("Producer Version Compatibility & Non-Gating Invariants", () => {
    it("accepts a foreign producer packet with differing package version if output matches", () => {
      // Create authentic candidate
      const candidate = createThemeCandidateV2(blackCoreJson);

      // Simulate packet produced by foreign / patched producer version
      const foreignPacket: any = {
        ...candidate,
        producer: {
          ...candidate.producer,
          version: "9.9.9",
        },
      };
      // Recompute packet self-digest (not spoofable constructor param)
      foreignPacket.candidateDigest = computePacketDigestV2(foreignPacket);

      const result = verifyThemeCandidateV2(foreignPacket);
      // Package version difference is NOT an acceptance gate!
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes("differs from local compiler version"))).toBe(true);
    });

    it("fails verification if foreign producer packet changes output", () => {
      const candidate = createThemeCandidateV2(blackCoreJson);

      // Simulate a foreign packet where theme specification produces different output than claimed
      const foreignPacket: any = {
        ...candidate,
        producer: {
          ...candidate.producer,
          version: "9.9.9",
        },
        theme: {
          ...candidate.theme,
          tokenSets: {
            ...candidate.theme.tokenSets,
            "black-tokens": {
              ...candidate.theme.tokenSets["black-tokens"],
              "bg-page-dark": "#ff0000", // Tampered color!
            },
          },
        },
      };
      // Recompute packet digest
      foreignPacket.candidateDigest = computePacketDigestV2(foreignPacket);

      const result = verifyThemeCandidateV2(foreignPacket);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("inputDigest mismatch") || e.includes("outputDigest mismatch"))).toBe(true);
    });
  });

  describe("Font Resource Verification", () => {
    it("fails verification if declared fonts are missing resources", () => {
      const candidate = createThemeCandidateV2(celestiaCoreJson, { fontResources: new Map([["celestia-sans", new Uint8Array(Buffer.from("TFSL original non-rendering font pipeline fixture v1\x00\xff", "latin1"))]]) });
      expect(candidate.theme.fonts).toHaveLength(1);

      // Verify without font resources map
      const result = verifyThemeCandidateV2(candidate);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Font verification failed"))).toBe(true);
    });

    it("fails verification if font resource digest does not match declared sha256", () => {
      const candidate = createThemeCandidateV2(celestiaCoreJson, { fontResources: new Map([["celestia-sans", new Uint8Array(Buffer.from("TFSL original non-rendering font pipeline fixture v1\x00\xff", "latin1"))]]) });
      const fontResources = new Map<string, Uint8Array>();
      fontResources.set("celestia-sans", new Uint8Array([1, 2, 3, 4]));

      const result = verifyThemeCandidateV2(candidate, { fontResources });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Font verification failed: digest mismatch"))).toBe(true);
    });

    it("succeeds when font resource bytes match declared sha256", () => {
      // Construct dummy font bytes matching declared sha256
      const declaredSha = celestiaCoreJson.fonts[0].sha256;
      // We can construct a matching dummy font buffer or test with dummy font declaration
      const dummyFontBytes = new Uint8Array([10, 20, 30, 40]);
      const dummySha = createHash("sha256").update(dummyFontBytes).digest("hex");

      const themeWithDummyFont = {
        ...blackCoreJson,
        fonts: [
          {
            id: "custom-font",
            family: "CustomFont",
            style: "normal",
            weight: 400,
            format: "woff2",
            sha256: dummySha,
            license: "OFL-1.1",
            notice: "notice-custom-font",
          },
        ],
        typography: {
          ...blackCoreJson.typography,
          body: { font: "custom-font", size: 16, lineHeight: 1.6 },
        },
      };

      const fontResources = new Map<string, Uint8Array>();
      fontResources.set("custom-font", dummyFontBytes);

      const candidate = createThemeCandidateV2(themeWithDummyFont, { fontResources });
      const result = verifyThemeCandidateV2(candidate, { fontResources });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("Historical V1 -> V2 Import (importThemeV1ToV2)", () => {
    it("records lossy mapping and creates a distinct ID without inheriting claims", () => {
      const original = JSON.parse(v1CandidateAJson);
      const rebound = importThemeV1ToV2(v1CandidateAJson);
      expect(rebound.candidateId).not.toBe(original.candidateId);
      expect(rebound.candidateId).toMatch(/^v2-import-/);
      expect(rebound.claimedProvenance).toBeUndefined();
      expect(rebound.rationale).toContain(JSON.stringify(original.theme.layout));
      expect(rebound.rationale).toContain("Lossy core mapping");
      expect(rebound.state).toBe("candidate");
      expect(verifyThemeCandidateV2(rebound).valid).toBe(true);
    });
    it("imports candidate-a.tfsl-candidate.json, maps palette to 22 roles, strips $schema, and produces unadopted candidate", () => {
      const candidateV2 = importThemeV1ToV2(v1CandidateAJson, {
        candidateId: "imported-candidate-a",
        rationale: "Imported historical candidate-a into v2",
      });

      // 1. Valid closed v2 candidate
      expect(candidateV2.schema).toBe("tfsl.theme-candidate");
      expect(candidateV2.schemaVersion).toBe(2);
      expect(candidateV2.candidateId).toBe("imported-candidate-a");
      expect(candidateV2.state).toBe("candidate");

      // 2. Strips $schema
      expect((candidateV2.theme as any).$schema).toBeUndefined();

      // 3. Finite maps all 22 role refs for both dark and light
      expect(candidateV2.theme.accentVariants.default).toBeDefined();
      const darkRoles = Object.keys(candidateV2.theme.accentVariants.default.dark);
      const lightRoles = Object.keys(candidateV2.theme.accentVariants.default.light);
      expect(darkRoles).toHaveLength(22);
      expect(lightRoles).toHaveLength(22);

      // 4. Links originV1 packetDigest and byteDigest
      expect(candidateV2.originV1).toBeDefined();
      expect(candidateV2.originV1?.packetDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(candidateV2.originV1?.byteDigest).toMatch(/^sha256:[0-9a-f]{64}$/);

      // 5. Fresh local compile outputInventory
      expect(candidateV2.outputInventory).toHaveLength(5);

      // 6. Candidate self-digest
      expect(candidateV2.candidateDigest).toBe(computePacketDigestV2(candidateV2));

      // 7. Verify candidate with verifyThemeCandidateV2
      const verifyRes = verifyThemeCandidateV2(candidateV2);
      expect(verifyRes.valid).toBe(true);
      expect(verifyRes.errors).toHaveLength(0);
    });
  });

  describe("Protocol Fixtures Validation", () => {
    it("verifies new candidates and unchanged historical protocol fixtures", () => {
      const candA = createThemeCandidateV2(blackCoreJson, {
        candidateId: "loom-black-candidate-a",
        rationale: "Core black theme candidate v2",
      });
      const candB = createThemeCandidateV2(flexokiCoreJson, {
        candidateId: "loom-flexoki-candidate-b",
        selectedAccent: "blue",
        rationale: "Flexoki multi-accent candidate v2",
      });

      const jsonA = serializeThemeExchangeV2(candA);
      const jsonB = serializeThemeExchangeV2(candB);

      const examplesDir = resolve(__dirname, "../protocol/tfsl-theme-evidence-v2/examples");
      expect(verifyThemeCandidateV2(parseThemeExchangeV2(jsonA)).valid).toBe(true);
      expect(verifyThemeCandidateV2(parseThemeExchangeV2(jsonB)).valid).toBe(true);

      // Verify written fixtures can be read, parsed, and verified
      const readA = parseThemeExchangeV2(readFileSync(resolve(examplesDir, "candidate-a.tfsl-candidate-v2.json"), "utf8"));
      const readB = parseThemeExchangeV2(readFileSync(resolve(examplesDir, "candidate-b.tfsl-candidate-v2.json"), "utf8"));

      expect(verifyThemeCandidateV2(readA).valid).toBe(true);
      expect(verifyThemeCandidateV2(readB).valid).toBe(true);
    });
  });
});
