import { currentExchangeFixture } from "./current-exchange-fixture.js";
import { describe, expect, it } from "vitest";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  sortJson,
  canonicalJson,
  isCanonicalJson,
  assertNoDuplicateKeys,
  assertNfcAndControls,
  validatePngBuffer,
  validatePngBase64,
  computePacketDigest,
  computeVisualEvidenceDigest,
  createThemeBrief,
  createThemeCandidate,
  createThemeReview,
  verifyThemeCandidate,
  validateThemeReviewLinks,
  validateThemeExchangePacket,
  parseThemeExchangePacket,
  serializeThemeExchangePacket,
  inspectThemeExchangePacket,
  ThemeExchangeValidationError,
  STELLAR_CYAN_EXAMPLE,
  AMBER_FORGE_EXAMPLE,
} from "../src/index.js";
import { processBatchRequest } from "../src/batch.js";
import { runCli } from "../src/cli.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROTOCOL_DIR = resolve(__dirname, "../protocol/tfsl-theme-evidence-v1");
const EXAMPLES_DIR = resolve(PROTOCOL_DIR, "examples");

describe("TFSL Design Exchange", () => {
  describe("Canonical JSON & Encoding", () => {
    it("sorts keys recursively by UTF-8 bytes and adds final LF", () => {
      const obj = { z: 1, a: 2, m: { y: 10, b: 20 } };
      const canonical = canonicalJson(obj);
      expect(canonical).toBe('{\n  "a": 2,\n  "m": {\n    "b": 20,\n    "y": 10\n  },\n  "z": 1\n}\n');
      expect(isCanonicalJson(canonical)).toBe(true);
    });

    it("rejects non-canonical JSON with CRLF, missing LF, or wrong indentation", () => {
      expect(isCanonicalJson('{"a": 1}\n')).toBe(false);
      expect(isCanonicalJson('{\n  "a": 1\r\n}\r\n')).toBe(false);
      expect(isCanonicalJson('{\n  "a": 1\n}')).toBe(false);
      expect(isCanonicalJson('\ufeff{\n  "a": 1\n}\n')).toBe(false);
    });

    it("detects duplicate keys in JSON", () => {
      const dupeJson = '{\n  "a": 1,\n  "a": 2\n}';
      expect(() => assertNoDuplicateKeys(dupeJson)).toThrow(ThemeExchangeValidationError);
    });

    it("enforces NFC normalization and control character bans", () => {
      const nfd = "e\u0301";
      expect(() => assertNfcAndControls(nfd, "test")).toThrow(ThemeExchangeValidationError);
      expect(() => assertNfcAndControls("hello\x00world", "test")).toThrow(ThemeExchangeValidationError);
      expect(() => assertNfcAndControls("hello\rworld", "test")).toThrow(ThemeExchangeValidationError);
      expect(() => assertNfcAndControls("line1\nline2", "test", false)).toThrow(ThemeExchangeValidationError);
      expect(() => assertNfcAndControls("line1\nline2", "test", true)).not.toThrow();
    });
  });

  describe("PNG Validation", () => {
    it("validates signature, dimensions, and base64 canonical encoding", () => {
      const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      const ihdrChunk = Buffer.alloc(25);
      ihdrChunk.writeUInt32BE(13, 0);
      ihdrChunk.write("IHDR", 4, "ascii");
      ihdrChunk.writeUInt32BE(32, 8);
      ihdrChunk.writeUInt32BE(32, 12);
      ihdrChunk[16] = 8;
      ihdrChunk[17] = 6;
      ihdrChunk[18] = 0;
      ihdrChunk[19] = 0;
      ihdrChunk[20] = 0;
      ihdrChunk.writeUInt32BE(0, 21);
      const buf = Buffer.concat([sig, ihdrChunk]);

      const res = validatePngBuffer(buf);
      expect(res.width).toBe(32);
      expect(res.height).toBe(32);
      expect(res.pngDigest).toMatch(/^sha256:[a-f0-9]{64}$/);

      const b64 = buf.toString("base64");
      const resB64 = validatePngBase64(b64);
      expect(resB64.width).toBe(32);
    });

    it("rejects PNG with dimensions outside 16..1024 or invalid signature", () => {
      const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      const ihdrChunk = Buffer.alloc(25);
      ihdrChunk.writeUInt32BE(13, 0);
      ihdrChunk.write("IHDR", 4, "ascii");
      ihdrChunk.writeUInt32BE(8, 8);
      ihdrChunk.writeUInt32BE(32, 12);
      const buf = Buffer.concat([sig, ihdrChunk]);

      expect(() => validatePngBuffer(buf)).toThrow(ThemeExchangeValidationError);

      const badSigBuf = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
      expect(() => validatePngBuffer(badSigBuf)).toThrow(ThemeExchangeValidationError);
    });
  });

  describe("Protocol Fixtures Validation", () => {
    it("validates canonical brief.tfsl-brief.json fixture", () => {
      const file = resolve(EXAMPLES_DIR, "brief.tfsl-brief.json");
      const raw = readFileSync(file, "utf8");
      expect(isCanonicalJson(raw)).toBe(true);

      const packet = parseThemeExchangePacket(raw);
      expect(packet.schema).toBe("tfsl.theme-brief");
      expect(validateThemeExchangePacket(packet).schema).toBe("tfsl.theme-brief");

      const inspection = inspectThemeExchangePacket(packet);
      expect(inspection.valid).toBe(true);
      expect(inspection.digest).toBe(packet.briefDigest);
    });

    it("validates canonical candidate-a and candidate-b fixtures", () => {
      const briefFile = resolve(EXAMPLES_DIR, "brief.tfsl-brief.json");
      const briefPacket = parseThemeExchangePacket(readFileSync(briefFile, "utf8"));

      for (const candName of ["candidate-a.tfsl-candidate.json", "candidate-b.tfsl-candidate.json"]) {
        const file = resolve(EXAMPLES_DIR, candName);
        const raw = readFileSync(file, "utf8");
        expect(isCanonicalJson(raw)).toBe(true);

        const packet = parseThemeExchangePacket(raw);
        expect(packet.schema).toBe("tfsl.theme-candidate");
        expect(validateThemeExchangePacket(packet).schema).toBe("tfsl.theme-candidate");

        const verifyRes = verifyThemeCandidate(packet as any, briefPacket as any);
        expect(verifyRes.valid).toBe(false);
        expect(verifyRes.errors).toEqual(["Brief compilerVersion '0.1.0' differs from local compiler version '0.2.0'"]);

        const inspection = inspectThemeExchangePacket(packet);
        expect(inspection.valid).toBe(true);
      }
    });

    it("validates canonical review.tfsl-review.json fixture", () => {
      const briefFile = resolve(EXAMPLES_DIR, "brief.tfsl-brief.json");
      const briefPacket = parseThemeExchangePacket(readFileSync(briefFile, "utf8"));
      const candA = parseThemeExchangePacket(readFileSync(resolve(EXAMPLES_DIR, "candidate-a.tfsl-candidate.json"), "utf8"));
      const candB = parseThemeExchangePacket(readFileSync(resolve(EXAMPLES_DIR, "candidate-b.tfsl-candidate.json"), "utf8"));

      const reviewFile = resolve(EXAMPLES_DIR, "review.tfsl-review.json");
      const raw = readFileSync(reviewFile, "utf8");
      expect(isCanonicalJson(raw)).toBe(true);

      const packet = parseThemeExchangePacket(raw);
      expect(packet.schema).toBe("tfsl.theme-review");
      expect(validateThemeExchangePacket(packet).schema).toBe("tfsl.theme-review");

      const linkRes = validateThemeReviewLinks(packet as any, [candA as any, candB as any], briefPacket as any);
      expect(linkRes.valid).toBe(false);
      expect(linkRes.errors).toEqual(["Brief compilerVersion '0.1.0' differs from local compiler version '0.2.0'"]);
    });

    it("fails all cases in negative-corpus.json", () => {
      const negFile = resolve(PROTOCOL_DIR, "negative-corpus.json");
      const corpus = JSON.parse(readFileSync(negFile, "utf8"));
      const cases = corpus.cases ?? corpus;
      expect(cases.length).toBeGreaterThanOrEqual(15);

      for (const item of cases) {
        let threw = false;
        try {
          if (item.raw) {
            parseThemeExchangePacket(item.raw);
          } else if (item.packet) {
            validateThemeExchangePacket(item.packet);
          } else if (typeof item.data === "string") {
            parseThemeExchangePacket(item.data);
          } else {
            validateThemeExchangePacket(item);
          }
        } catch {
          threw = true;
        }
        expect(threw, `Negative corpus item ${item.id} was expected to fail validation`).toBe(true);
      }
    });
  });

  describe("Batch Adapter Actions", () => {
    it("executes exchange actions through processBatchRequest", () => {
      const briefReq = {
        action: "exchange-brief-create",
        briefInput: {
          briefId: "test-brief-batch",
          title: "Batch Brief",
          goal: "Test batch integration",
          baselineTheme: STELLAR_CYAN_EXAMPLE,
        },
      };
      const briefRes = processBatchRequest(briefReq as any);
      expect(briefRes.status).toBe("success");
      expect(briefRes.packet?.schema).toBe("tfsl.theme-brief");

      const rawSerialized = briefRes.canonicalJson!;
      const parseRes = processBatchRequest({
        action: "exchange-packet-parse",
        packetJson: rawSerialized,
      });
      expect(parseRes.status).toBe("success");
      expect(parseRes.packet?.schema).toBe("tfsl.theme-brief");

      const candReq = {
        action: "exchange-candidate-verify",
        candidate: {
          schema: "tfsl.theme-candidate",
          schemaVersion: 1,
          candidateId: "cand-batch-1",
          briefDigest: (briefRes.packet as any).briefDigest,
          theme: STELLAR_CYAN_EXAMPLE,
          themeDigest: (briefRes.packet as any).themeDigest,
          rationale: "Batch candidate verify",
          visualEvidence: [],
          candidateDigest: "",
        },
        brief: briefRes.packet,
      };
      const computedCandDigest = computePacketDigest(candReq.candidate as any);
      (candReq.candidate as any).candidateDigest = computedCandDigest;

      const candRes = processBatchRequest(candReq as any);
      expect(candRes.status).toBe("success");
      expect(candRes.candidateVerification?.valid).toBe(true);
    });
  });

  describe("Direct API Red/Green Validations & Edge Cases", () => {
    it.each([
      ["category", "palette", /Invalid category/],
      ["category", "branding", /Invalid category/],
      ["severity", "warning", /Invalid severity/],
      ["severity", "blocker", /Invalid severity/],
      ["severity", "praise", /Invalid severity/],
      ["disposition", "accepted", /Invalid disposition value/],
      ["overall", "unreviewed", /Invalid overallDisposition kind/],
      ["overall", "rejected", /Invalid overallDisposition kind/],
      ["overall", "deferred", /Invalid overallDisposition kind/],
    ])("rejects unsupported review %s values", (field, value, message) => {
      const packet = JSON.parse(readFileSync(resolve(EXAMPLES_DIR, "review.tfsl-review.json"), "utf8"));
      if (field === "overall") packet.overallDisposition.kind = value;
      else if (field === "disposition") packet.dispositions[0].disposition = value;
      else packet.annotations[0][field as string] = value;
      // Keep integrity valid so this must fail at the enum's schema boundary.
      packet.reviewDigest = computePacketDigest(packet);
      expect(() => validateThemeExchangePacket(packet)).toThrowError(message as RegExp);
    });

    it("createThemeBrief strictly validates required fields and types without TypeError", () => {
      // null input
      expect(() => createThemeBrief(null as any)).toThrow(ThemeExchangeValidationError);
      // missing briefId
      expect(() => createThemeBrief({ title: "T", goal: "G", baselineTheme: STELLAR_CYAN_EXAMPLE } as any))
        .toThrowError(/Missing required field 'briefId'/);
      // missing title
      expect(() => createThemeBrief({ briefId: "b1", goal: "G", baselineTheme: STELLAR_CYAN_EXAMPLE } as any))
        .toThrowError(/Missing required field 'title'/);
      // missing baselineTheme
      expect(() => createThemeBrief({ briefId: "b1", title: "T", goal: "G" } as any))
        .toThrowError(/Missing required field 'baselineTheme'/);
    });

    it("createThemeCandidate strictly validates required fields and requires brief", () => {
      // missing candidateId
      expect(() => createThemeCandidate({ theme: STELLAR_CYAN_EXAMPLE, rationale: "R" } as any))
        .toThrowError(/Missing required field 'candidateId'/);
      // missing brief
      expect(() => createThemeCandidate({ candidateId: "c1", theme: STELLAR_CYAN_EXAMPLE, rationale: "R" } as any))
        .toThrowError(/Missing required field 'brief'/);
      // valid creation with brief string
      const cand = createThemeCandidate({
        candidateId: "cand-direct-1",
        brief: "sha256:78e5c95a29fb970ce9eb876c74b5f3cbd6c5be184ace560fae049d7e0e252888",
        theme: STELLAR_CYAN_EXAMPLE,
        rationale: "Direct candidate with brief",
        claimedProvenance: {
          author: "Human-Designer",
        },
      });
      expect(cand.schema).toBe("tfsl.theme-candidate");
      expect(cand.candidateDigest).toBeDefined();
    });

    it("createThemeReview strictly validates required fields and requires brief", () => {
      // missing reviewId
      expect(() => createThemeReview({ candidateDigests: [], dispositions: [] } as any))
        .toThrowError(/Missing required field 'reviewId'/);
      // missing brief - does NOT throw TypeError
      expect(() => createThemeReview({ reviewId: "r1", candidateDigests: [], dispositions: [] } as any))
        .toThrowError(/Missing required field 'brief'/);
      // missing candidateDigests - does NOT throw TypeError
      expect(() => createThemeReview({ reviewId: "r1", brief: "sha256:78e5c95a29fb970ce9eb876c74b5f3cbd6c5be184ace560fae049d7e0e252888" } as any))
        .toThrowError(/Missing required field 'candidateDigests'/);
      // missing dispositions - does NOT throw TypeError
      expect(() => createThemeReview({ reviewId: "r1", brief: "sha256:78e5c95a29fb970ce9eb876c74b5f3cbd6c5be184ace560fae049d7e0e252888", candidateDigests: ["sha256:87ca505a52d1459ce84eef4041aa8f499f004f8abaa5512490468223b09d1da5"] } as any))
        .toThrowError(/Missing required field 'dispositions'/);

      // Successful creation with brief string
      const candDigest = "sha256:87ca505a52d1459ce84eef4041aa8f499f004f8abaa5512490468223b09d1da5";
      const review = createThemeReview({
        reviewId: "r-direct-1",
        brief: "sha256:78e5c95a29fb970ce9eb876c74b5f3cbd6c5be184ace560fae049d7e0e252888",
        candidateDigests: [candDigest],
        dispositions: [{ candidateDigest: candDigest, disposition: "approved" }],
        overallDisposition: { kind: "approved", candidateDigest: candDigest },
        summary: "Direct review creation works cleanly",
      });
      expect(review.schema).toBe("tfsl.theme-review");
      expect(review.reviewDigest).toBeDefined();
    });

    it("verifyThemeCandidate executes single compile and respects strictContrast option", () => {
      const brief = parseThemeExchangePacket(currentExchangeFixture("brief.tfsl-brief.json"));
      const candA = parseThemeExchangePacket(currentExchangeFixture("candidate-a.tfsl-candidate.json"));

      // 1. Pass with strictContrast: true on compliant theme
      const resPass = verifyThemeCandidate(candA as any, brief as any, { strictContrast: true });
      expect(resPass.valid).toBe(true);
      expect(resPass.compiledCss).toBeDefined();
      expect(resPass.descriptor).toBeDefined();
      expect(resPass.errors).toEqual([]);

      // 2. Fail with strictContrast: true on theme with contrast warning
      const failingTheme = JSON.parse(JSON.stringify((candA as any).theme));
      failingTheme.colors.dark.neutrals.text = "#050505"; // very dark text on dark background
      const candFail = { ...(candA as any), theme: failingTheme };
      const resFail = verifyThemeCandidate(candFail as any, brief as any, { strictContrast: true });
      expect(resFail.valid).toBe(false);
      expect(resFail.compiledCss).toBeUndefined();
      expect(resFail.themeDigest).toBe("");
      expect(resFail.errors.some((e) => e.includes("strict-contrast") || e.includes("Contrast"))).toBe(true);
    });

    it("verifyThemeCandidate validates candidate+brief binding constraints", () => {
      const brief = parseThemeExchangePacket(readFileSync(resolve(EXAMPLES_DIR, "brief.tfsl-brief.json"), "utf8"));
      const candA = parseThemeExchangePacket(readFileSync(resolve(EXAMPLES_DIR, "candidate-a.tfsl-candidate.json"), "utf8"));

      // Mismatched adapter
      const candBadAdapter = JSON.parse(JSON.stringify(candA));
      candBadAdapter.theme.adapter = "unknown-adapter" as any;
      const resAdapter = verifyThemeCandidate(candBadAdapter, brief as any);
      expect(resAdapter.valid).toBe(false);
      expect(resAdapter.errors.some((e) => e.includes("adapter"))).toBe(true);

      // Template not in approvedTemplates
      const candBadTmpl = JSON.parse(JSON.stringify(candA));
      candBadTmpl.packageMetadata = {
        name: "test-pkg",
        version: "0.1.0",
        template: "unapproved-template",
      };
      const resTmpl = verifyThemeCandidate(candBadTmpl, brief as any);
      expect(resTmpl.valid).toBe(false);
      expect(resTmpl.errors.some((e) => e.includes("approvedTemplates"))).toBe(true);

      // CompilerVersion mismatch on brief invalidates required context
      const briefBadVersion = { ...(brief as any), compilerVersion: "0.0.0-legacy" };
      const resVersion = verifyThemeCandidate(candA as any, briefBadVersion as any);
      expect(resVersion.valid).toBe(false);
      expect(resVersion.errors.some((e) => e.includes("compilerVersion"))).toBe(true);
    });

    it("validateThemeReviewLinks validates duplicate, missing, stale, and visual annotation bindings", () => {
      const brief = parseThemeExchangePacket(readFileSync(resolve(EXAMPLES_DIR, "brief.tfsl-brief.json"), "utf8"));
      const candA = parseThemeExchangePacket(readFileSync(resolve(EXAMPLES_DIR, "candidate-a.tfsl-candidate.json"), "utf8"));
      const candB = parseThemeExchangePacket(readFileSync(resolve(EXAMPLES_DIR, "candidate-b.tfsl-candidate.json"), "utf8"));
      const review = parseThemeExchangePacket(readFileSync(resolve(EXAMPLES_DIR, "review.tfsl-review.json"), "utf8"));

      // 1. Field annotation referencing non-existent field
      const badReview = JSON.parse(JSON.stringify(review));
      badReview.annotations.push({
        annotationId: "ann-ghost-field",
        candidateDigest: (candA as any).candidateDigest,
        category: "typography",
        severity: "minor",
        comment: "Field does not exist",
        target: {
          kind: "field",
          fieldPath: "typography.nonExistentFont",
        },
      });
      const resBadField = validateThemeReviewLinks(badReview, [candA as any, candB as any], brief as any);
      expect(resBadField.valid).toBe(false);
      expect(resBadField.annotationErrors.some((e) => e.includes("does not exist"))).toBe(true);

      // 2. Field annotation with mode mismatch (light mode declared for dark field)
      const modeMismatchReview = JSON.parse(JSON.stringify(review));
      modeMismatchReview.annotations[0].target.mode = "light"; // colors.dark.accent.base is dark mode
      const resModeMismatch = validateThemeReviewLinks(modeMismatchReview, [candA as any, candB as any], brief as any);
      expect(resModeMismatch.valid).toBe(false);
      expect(resModeMismatch.annotationErrors.some((e) => e.includes("mode"))).toBe(true);

      // 3. Visual annotation with region coordinates inverted or out of bounds
      const badRegionReview = JSON.parse(JSON.stringify(review));
      badRegionReview.annotations[1].target.region = [500000, 500000, 100000, 100000]; // x1 > x2
      const resBadRegion = validateThemeReviewLinks(badRegionReview, [candA as any, candB as any], brief as any);
      expect(resBadRegion.valid).toBe(false);
      expect(resBadRegion.annotationErrors.some((e) => e.includes("region"))).toBe(true);

      // 4. Candidate with corrupted candidateDigest or evidence fails validateThemeCandidate
      const badCandDigest = JSON.parse(JSON.stringify(candA));
      badCandDigest.candidateDigest = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
      const resBadCand = validateThemeReviewLinks(review as any, [badCandDigest, candB as any], brief as any);
      expect(resBadCand.valid).toBe(false);
      expect(resBadCand.errors.some((e) => e.includes("candidateDigest mismatch") || e.includes("validation error"))).toBe(true);

      // 5. Malformed nested review returns invalid safely without post-validation dereferencing
      const malformedReview = { schema: "tfsl.theme-review", reviewId: "broken-review" } as any;
      const resMalformed = validateThemeReviewLinks(malformedReview, [candA as any, candB as any], brief as any);
      expect(resMalformed.valid).toBe(false);
      expect(resMalformed.errors.length).toBeGreaterThan(0);

      // 6. Candidates context bounded to 8 candidates
      const nineCands = Array(9).fill(candA);
      const resBounded = validateThemeReviewLinks(review as any, nineCands, brief as any);
      expect(resBounded.valid).toBe(false);
      expect(resBounded.errors.some((e) => e.includes("exceeds maximum bound of 8"))).toBe(true);

      // 7. Duplicate candidate context rejected
      const dupeCands = [candA as any, candA as any];
      const resDupeContext = validateThemeReviewLinks(review as any, dupeCands, brief as any);
      expect(resDupeContext.valid).toBe(false);
      expect(resDupeContext.errors.some((e) => e.includes("Duplicate candidate"))).toBe(true);
    });
  });

  describe("CLI Subcommands", () => {
    const tmpDir = resolve(__dirname, "../tmp-cli-test");
    const briefOut = resolve(tmpDir, "cli-test.tfsl-brief.json");
    const candOut = resolve(tmpDir, "cli-test.tfsl-candidate.json");
    const reviewOut = resolve(tmpDir, "cli-test.tfsl-review.json");
    const baselineThemePath = resolve(tmpDir, "theme.json");

    it("runs complete CLI exchange lifecycle and enforces absent-only writes", async () => {
      rmSync(tmpDir, { recursive: true, force: true });
      const { mkdirSync, writeFileSync } = await import("node:fs");
      mkdirSync(tmpDir, { recursive: true });
      writeFileSync(baselineThemePath, JSON.stringify(STELLAR_CYAN_EXAMPLE, null, 2), "utf8");

      const briefCode = await runCli([
        "node",
        "tfsl",
        "exchange",
        "brief",
        "--name",
        "cli-test-brief",
        "--theme",
        baselineThemePath,
        "--out",
        briefOut,
        "--goal",
        "Modernize theme contrast and typography",
        "--allowed-modes",
        "both",
        "--json",
      ]);
      expect(briefCode).toBe(0);
      expect(existsSync(briefOut)).toBe(true);

      const dupeCode = await runCli([
        "node",
        "tfsl",
        "exchange",
        "brief",
        "--name",
        "cli-test-brief",
        "--theme",
        baselineThemePath,
        "--out",
        briefOut,
      ]);
      expect(dupeCode).toBe(3);

      const overwriteCode = await runCli([
        "node",
        "tfsl",
        "exchange",
        "brief",
        "--name",
        "cli-test-brief",
        "--theme",
        baselineThemePath,
        "--out",
        briefOut,
        "--overwrite",
      ]);
      expect(overwriteCode).toBe(2);

      const candCode = await runCli([
        "node",
        "tfsl",
        "exchange",
        "candidate",
        "--brief",
        briefOut,
        "--theme",
        baselineThemePath,
        "--out",
        candOut,
        "--name",
        "candidate-1",
        "--label",
        "Candidate 1",
        "--rationale",
        "Initial candidate test",
      ]);
      expect(candCode).toBe(0);
      expect(existsSync(candOut)).toBe(true);

      const revCode = await runCli([
        "node",
        "tfsl",
        "exchange",
        "review",
        "--brief",
        briefOut,
        "--candidate",
        candOut,
        "--out",
        reviewOut,
        "--summary",
        "Human review completed",
      ]);
      expect(revCode).toBe(0);
      expect(existsSync(reviewOut)).toBe(true);

      const valCandCode = await runCli([
        "node",
        "tfsl",
        "exchange",
        "validate",
        candOut,
        "--brief",
        briefOut,
      ]);
      expect(valCandCode).toBe(0);

      const inspectCode = await runCli([
        "node",
        "tfsl",
        "exchange",
        "inspect",
        candOut,
        "--json",
      ]);
      expect(inspectCode).toBe(0);

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
