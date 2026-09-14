import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  createThemeCodeCandidate,
  verifyThemeCodeCandidate,
  verifyThemeCandidateCompatible,
  parseThemeCodeCandidate,
  serializeThemeCodeCandidate,
  computePacketDigestCode,
  computeSyntaxDigest,
  canonicalJson,
  ThemeExchangeCodeValidationError,
  SEMANTIC_COMPILER_CODE,
  ADAPTER_CODE,
  CATALOG_CODE,
  CATALOG_CODE_DIGEST,
  RUNTIME_CODE_DEFAULT,
  type ThemeCodeCandidatePacket,
} from "../src/design-exchange-code/index.js";
import {
  createThemeCandidateV2,
  verifyThemeCandidateV2,
  SEMANTIC_COMPILER_V2,
  CATALOG_V2,
  ADAPTER_V2,
} from "../src/design-exchange-v2/index.js";
import {
  CODE_CATALOG_DIGEST,
  CODE_CATALOG_IDENTITY,
  CODE_COMPILER_SEMANTIC,
  validateThemeCode,
  compileThemeCode,
} from "../src/code/index.js";
import { COMPILER_PRODUCER, COMPILER_VERSION } from "../src/v2/index.js";

const blackCoreJson = JSON.parse(
  readFileSync(resolve(__dirname, "../examples/loom-black-core.theme.json"), "utf8")
);
const flexokiCoreJson = JSON.parse(
  readFileSync(resolve(__dirname, "../examples/loom-flexoki-core.theme.json"), "utf8")
);

const sampleCodePresentation = {
  mode: "expressive-code" as const,
  syntaxTheme: {
    light: {
      rules: [
        {
          scopes: ["keyword", "storage.type"],
          foreground: "#24292e",
        },
        {
          scopes: ["string", "string.quoted"],
          foreground: "#032f62",
        },
      ],
    },
    dark: {
      rules: [
        {
          scopes: ["keyword", "storage.type"],
          foreground: "#ff7b72",
        },
        {
          scopes: ["string", "string.quoted"],
          foreground: "#a5d6ff",
        },
      ],
    },
  },
  frame: "editor" as const,
  marks: {
    marked: "#3b82f6",
    inserted: "#22c55e",
    deleted: "#ef4444",
  },
  copy: "standard" as const,
  tabs: "deferred" as const,
};

function createValidCodeTheme(base: any = blackCoreJson) {
  const clean = { ...base };
  delete clean.$schema;
  return {
    ...clean,
    codePresentation: sampleCodePresentation,
  };
}

describe("TFSL Design Exchange Code (61B-code)", () => {
  describe("Tuple and Domain Alignment", () => {
    it("binds to shared code catalog and semantic compiler constants", () => {
      expect(CATALOG_CODE).toBe(CODE_CATALOG_IDENTITY);
      expect(CATALOG_CODE).toBe("tfsl.starlight-code-catalog-v1");
      expect(CATALOG_CODE_DIGEST).toBe(`sha256:${CODE_CATALOG_DIGEST}`);
      expect(SEMANTIC_COMPILER_CODE).toBe(CODE_COMPILER_SEMANTIC);
      expect(SEMANTIC_COMPILER_CODE).toBe("tfsl.theme-compiler-v2-code-1");
      expect(ADAPTER_CODE).toBe("starlight-v0.42");
    });
  });

  describe("Deterministic Candidate Creation and Full Verification", () => {
    it("creates a closed code candidate packet with exact inventory, digests, and runtime", () => {
      const theme = createValidCodeTheme(blackCoreJson);
      const metadata = {
        name: "starlight-theme-black-code",
        version: "0.2.0",
        description: "Black code Starlight theme",
      };

      const candidate = createThemeCodeCandidate(theme, {
        candidateId: "black-code-candidate",
        metadata,
        rationale: "Initial code candidate for loom-black-code",
      });

      expect(candidate.schema).toBe("tfsl.theme-candidate");
      expect(candidate.schemaVersion).toBe(2);
      expect(candidate.candidateId).toBe("black-code-candidate");
      expect(candidate.semanticCompiler).toBe("tfsl.theme-compiler-v2-code-1");
      expect(candidate.adapter).toBe("starlight-v0.42");
      expect(candidate.catalog).toBe("tfsl.starlight-code-catalog-v1");
      expect(candidate.catalogDigest).toBe(`sha256:${CODE_CATALOG_DIGEST}`);
      expect(candidate.runtime).toBe("EC0.44.2 Shiki4.4.3");
      expect(candidate.state).toBe("candidate");

      // Producer check
      expect(candidate.producer.package).toBe(COMPILER_PRODUCER);
      expect(candidate.producer.version).toBe(COMPILER_VERSION);
      expect(candidate.producer.executableDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(candidate.producer.packageDigest).toMatch(/^sha256:[0-9a-f]{64}$/);

      // Metadata check
      expect(candidate.metadata.name).toBe("starlight-theme-black-code");
      expect(candidate.metadata.version).toBe("0.2.0");

      // Digests check
      const compileRes = compileThemeCode(theme);
      expect(candidate.inputDigest).toBe(`sha256:${compileRes.inputDigest}`);
      expect(candidate.themeDigest).toBe(`sha256:${compileRes.inputDigest}`);
      expect(candidate.outputDigest).toBe(`sha256:${compileRes.outputDigest}`);
      expect(candidate.syntaxDigest).toBe(computeSyntaxDigest(theme.codePresentation.syntaxTheme));

      // Output inventory contains entire member inventory including config, helper, theme, package
      const inventoryIds = candidate.outputInventory.map((item) => item.id);
      expect(inventoryIds).toContain("index.js");
      expect(inventoryIds).toContain("index.d.ts");
      expect(inventoryIds).toContain("package.json");
      expect(inventoryIds).toContain("theme.json");
      expect(inventoryIds).toContain("theme.descriptor.json");
      expect(inventoryIds).toContain("styles/code.css");
      expect(inventoryIds).toContain("styles/layers.css");
      expect(inventoryIds).toContain("README.md");
      expect(inventoryIds).toContain("LICENSE");
      expect(inventoryIds).toContain("NOTICE");
      expect(inventoryIds).toContain("COMMERCIAL-LICENSE.md");

      // Provenance must be excluded from inventory (noncircle justification)
      expect(inventoryIds).toContain("provenance.json");

      // Self-digest check
      expect(candidate.candidateDigest).toBe(computePacketDigestCode(candidate));

      // Verify the candidate passes verification
      const verifyResult = verifyThemeCodeCandidate(candidate);
      expect(verifyResult.valid).toBe(true);
      expect(verifyResult.errors).toEqual([]);
      expect(verifyResult.candidateId).toBe("black-code-candidate");
      expect(verifyResult.candidateDigest).toBe(candidate.candidateDigest);
      expect(verifyResult.inputDigest).toBe(candidate.inputDigest);
      expect(verifyResult.themeDigest).toBe(candidate.themeDigest);
      expect(verifyResult.syntaxDigest).toBe(candidate.syntaxDigest);
      expect(verifyResult.outputDigest).toBe(candidate.outputDigest);
    });

    it("is strictly deterministic: repeated create produces identical bytes and digests", () => {
      const theme = createValidCodeTheme(flexokiCoreJson);
      const metadata = {
        name: "starlight-theme-flexoki-code",
        version: "0.2.0",
      };

      const candidate1 = createThemeCodeCandidate(theme, {
        candidateId: "flexoki-code-1",
        metadata,
        accent: "green",
        rationale: "Flexoki code candidate green accent",
      });

      const candidate2 = createThemeCodeCandidate(theme, {
        candidateId: "flexoki-code-1",
        metadata,
        accent: "green",
        rationale: "Flexoki code candidate green accent",
      });

      expect(candidate1.candidateDigest).toBe(candidate2.candidateDigest);
      expect(serializeThemeCodeCandidate(candidate1)).toBe(serializeThemeCodeCandidate(candidate2));
    });
  });

  describe("Tuple Substitution and Core Rejection", () => {
    it("fails when a core candidate packet is passed to verifyThemeCodeCandidate", () => {
      const coreCandidate = createThemeCandidateV2(blackCoreJson, {
        candidateId: "core-candidate-test",
        rationale: "Core candidate",
      });

      // Passing core packet to code verifier must fail
      const result = verifyThemeCodeCandidate(coreCandidate as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Core theme candidate tuple cannot be verified by verifyThemeCodeCandidate"))).toBe(true);
    });

    it("fails when a code candidate packet is passed to verifyThemeCandidateV2", () => {
      const theme = createValidCodeTheme(blackCoreJson);
      const codeCandidate = createThemeCodeCandidate(theme);

      // Passing code packet to core v2 verifier must fail
      const result = verifyThemeCandidateV2(codeCandidate as any);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.includes("Unsupported semantic compiler") ||
            e.includes("Unsupported catalog") ||
            e.includes("outputInventory count mismatch") ||
            e.includes("Unknown field")
        )
      ).toBe(true);
    });

    it("fails on mixed tuple: core compiler with code catalog", () => {
      const theme = createValidCodeTheme(blackCoreJson);
      const candidate = createThemeCodeCandidate(theme);

      const mixed = {
        ...candidate,
        semanticCompiler: SEMANTIC_COMPILER_V2,
        catalog: CATALOG_CODE,
      };
      (mixed as any).candidateDigest = computePacketDigestCode(mixed as any);

      const result = verifyThemeCodeCandidate(mixed as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Mixed tuple detected") || e.includes("Unsupported semantic compiler"))).toBe(true);
    });

    it("fails on mixed tuple: code compiler with core catalog", () => {
      const theme = createValidCodeTheme(blackCoreJson);
      const candidate = createThemeCodeCandidate(theme);

      const mixed = {
        ...candidate,
        semanticCompiler: SEMANTIC_COMPILER_CODE,
        catalog: CATALOG_V2,
      };
      (mixed as any).candidateDigest = computePacketDigestCode(mixed as any);

      const result = verifyThemeCodeCandidate(mixed as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Mixed tuple detected") || e.includes("Unsupported catalog"))).toBe(true);
    });

    it("fails on unknown tuple components", () => {
      const theme = createValidCodeTheme(blackCoreJson);
      const candidate = createThemeCodeCandidate(theme);

      const unknownCompiler = {
        ...candidate,
        semanticCompiler: "tfsl.theme-compiler-v9-unknown" as any,
      };
      (unknownCompiler as any).candidateDigest = computePacketDigestCode(unknownCompiler as any);

      const result = verifyThemeCodeCandidate(unknownCompiler as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Unsupported semantic compiler") || e.includes("Candidate validation error"))).toBe(true);
    });
  });

  describe("Tamper Detection", () => {
    it("detects configuration / helper tamper: modifying index.js digest in outputInventory", () => {
      const theme = createValidCodeTheme(blackCoreJson);
      const candidate = createThemeCodeCandidate(theme);

      const tamperedInventory = candidate.outputInventory.map((item) => {
        if (item.id === "index.js") {
          return { id: item.id, digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000" };
        }
        return item;
      });

      const tamperedPacket: ThemeCodeCandidatePacket = {
        ...candidate,
        outputInventory: tamperedInventory,
      };
      (tamperedPacket as any).candidateDigest = computePacketDigestCode(tamperedPacket);

      const result = verifyThemeCodeCandidate(tamperedPacket);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("tamper detected") && e.includes("index.js"))).toBe(true);
    });

    it("detects syntax tamper: modifying syntaxTheme rules foreground color", () => {
      const theme = createValidCodeTheme(blackCoreJson);
      const candidate = createThemeCodeCandidate(theme);

      const tamperedTheme = JSON.parse(JSON.stringify(candidate.theme));
      tamperedTheme.codePresentation.syntaxTheme.light.rules[0].foreground = "#123456";

      const tamperedPacket: ThemeCodeCandidatePacket = {
        ...candidate,
        theme: tamperedTheme,
      };
      (tamperedPacket as any).candidateDigest = computePacketDigestCode(tamperedPacket);

      const result = verifyThemeCodeCandidate(tamperedPacket);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.includes("inputDigest mismatch") ||
            e.includes("themeDigest mismatch") ||
            e.includes("syntaxDigest mismatch") ||
            e.includes("tamper detected")
        )
      ).toBe(true);
    });

    it("detects inventory tamper: modifying package.json digest in outputInventory", () => {
      const theme = createValidCodeTheme(blackCoreJson);
      const candidate = createThemeCodeCandidate(theme);

      const tamperedInventory = candidate.outputInventory.map((item) => {
        if (item.id === "package.json") {
          return { id: item.id, digest: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" };
        }
        return item;
      });

      const tamperedPacket: ThemeCodeCandidatePacket = {
        ...candidate,
        outputInventory: tamperedInventory,
      };
      (tamperedPacket as any).candidateDigest = computePacketDigestCode(tamperedPacket);

      const result = verifyThemeCodeCandidate(tamperedPacket);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("tamper detected") && e.includes("package.json"))).toBe(true);
    });

    it("detects inventory tamper: removing an item from outputInventory", () => {
      const theme = createValidCodeTheme(blackCoreJson);
      const candidate = createThemeCodeCandidate(theme);

      const tamperedInventory = candidate.outputInventory.filter((item) => item.id !== "styles/code.css");
      const tamperedPacket: ThemeCodeCandidatePacket = {
        ...candidate,
        outputInventory: tamperedInventory,
      };
      (tamperedPacket as any).candidateDigest = computePacketDigestCode(tamperedPacket);

      const result = verifyThemeCodeCandidate(tamperedPacket);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("outputInventory count mismatch"))).toBe(true);
    });

    it("detects candidate self-digest tampering", () => {
      const theme = createValidCodeTheme(blackCoreJson);
      const candidate = createThemeCodeCandidate(theme);

      const tamperedPacket: ThemeCodeCandidatePacket = {
        ...candidate,
        candidateDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
      };

      const result = verifyThemeCodeCandidate(tamperedPacket);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Candidate validation error") || e.includes("candidateDigest mismatch"))).toBe(true);
    });
  });

  describe("Security, Accessors, and Path Restrictions", () => {
    it("rejects packets with accessor (getter) properties", () => {
      const theme = createValidCodeTheme(blackCoreJson);
      const candidate = createThemeCodeCandidate(theme);

      const tampered = { ...candidate };
      Object.defineProperty(tampered, "evilAccessor", {
        get() {
          return "evil";
        },
        enumerable: true,
        configurable: true,
      });

      expect(() => verifyThemeCodeCandidate(tampered as any)).not.toThrow();
      const result = verifyThemeCodeCandidate(tampered as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.toLowerCase().includes("unsafe") || e.toLowerCase().includes("accessors forbidden") || e.includes("SCHEMA_ERROR"))).toBe(true);
    });

    it("rejects packets containing forbidden filesystem paths or external URLs", () => {
      const theme = createValidCodeTheme(blackCoreJson);
      const candidate = createThemeCodeCandidate(theme);

      const tampered = {
        ...candidate,
        rationale: "File located at /Users/private-user/secret.txt",
      };
      (tampered as any).candidateDigest = computePacketDigestCode(tampered as any);

      const result = verifyThemeCodeCandidate(tampered as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("prohibited path") || e.includes("PATH_FORBIDDEN"))).toBe(true);
    });

    it("rejects state other than candidate (no auto adoption)", () => {
      const theme = createValidCodeTheme(blackCoreJson);
      const candidate = createThemeCodeCandidate(theme);

      const adoptedPacket = {
        ...candidate,
        state: "adopted",
      };
      (adoptedPacket as any).candidateDigest = computePacketDigestCode(adoptedPacket as any);

      const result = verifyThemeCodeCandidate(adoptedPacket as any);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Candidate state must be 'candidate'"))).toBe(true);
    });
  });

  describe("Compatibility Wrapper: verifyThemeCandidateCompatible", () => {
    it("routes exact core tuple packet to original verifyThemeCandidateV2", () => {
      const coreCandidate = createThemeCandidateV2(blackCoreJson, {
        candidateId: "core-compat-test",
        rationale: "Testing core compatibility routing",
      });

      const result = verifyThemeCandidateCompatible(coreCandidate);
      expect(result.valid).toBe(true);
      expect(result.candidateId).toBe("core-compat-test");
      expect(result.errors).toEqual([]);
    });

    it("routes exact code tuple packet to verifyThemeCodeCandidate", () => {
      const theme = createValidCodeTheme(blackCoreJson);
      const codeCandidate = createThemeCodeCandidate(theme, {
        candidateId: "code-compat-test",
        rationale: "Testing code compatibility routing",
      });

      const result = verifyThemeCandidateCompatible(codeCandidate);
      expect(result.valid).toBe(true);
      expect(result.candidateId).toBe("code-compat-test");
      expect(result.errors).toEqual([]);
    });

    it("fails closed on mixed tuples in verifyThemeCandidateCompatible", () => {
      const theme = createValidCodeTheme(blackCoreJson);
      const codeCandidate = createThemeCodeCandidate(theme);

      const mixed = {
        ...codeCandidate,
        semanticCompiler: SEMANTIC_COMPILER_V2,
        catalog: CATALOG_CODE,
      };

      const result = verifyThemeCandidateCompatible(mixed);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Mixed tuple detected"))).toBe(true);
    });

    it("fails closed on unknown tuples in verifyThemeCandidateCompatible", () => {
      const unknownPacket = {
        schema: "tfsl.theme-candidate",
        schemaVersion: 2,
        candidateId: "unknown-test",
        semanticCompiler: "tfsl.unknown-compiler",
        catalog: "tfsl.unknown-catalog",
        adapter: "unknown-adapter",
      };

      const result = verifyThemeCandidateCompatible(unknownPacket);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Unsupported or unknown candidate tuple"))).toBe(true);
    });
  });

  describe("Parsing and Serialization (serde)", () => {
    it("serializes to canonical two-space JSON and parses back identically", () => {
      const theme = createValidCodeTheme(blackCoreJson);
      const candidate = createThemeCodeCandidate(theme, {
        candidateId: "serde-test-candidate",
        rationale: "Testing serialization and parsing",
      });

      const serialized = serializeThemeCodeCandidate(candidate);
      expect(serialized.endsWith("\n")).toBe(true);
      expect(serialized).not.toContain("\r");

      const parsed = parseThemeCodeCandidate(serialized);
      expect(parsed.candidateId).toBe(candidate.candidateId);
      expect(parsed.candidateDigest).toBe(candidate.candidateDigest);
      expect(parsed.syntaxDigest).toBe(candidate.syntaxDigest);
      expect(parsed.outputInventory).toEqual(candidate.outputInventory);
    });

    it("rejects non-canonical JSON with duplicate keys or non-standard formatting", () => {
      const duplicateKeyJson = `{\n  "schema": "tfsl.theme-candidate",\n  "schema": "tfsl.theme-candidate"\n}\n`;
      expect(() => parseThemeCodeCandidate(duplicateKeyJson)).toThrow(ThemeExchangeCodeValidationError);
    });
  });
});
