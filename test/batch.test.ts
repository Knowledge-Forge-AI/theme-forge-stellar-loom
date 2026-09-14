import { currentExchangeFixture } from "./current-exchange-fixture.js";
import { describe, expect, it } from "vitest";
import { processBatchRequest } from "../src/batch.js";
import { compileTheme } from "../src/compiler/index.js";
import { analyzeThemeContrast } from "../src/compiler/contrast.js";
import { STELLAR_CYAN_EXAMPLE, AMBER_FORGE_EXAMPLE } from "../src/examples.js";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

describe("TFSL Batch Adapter", () => {
  it("accepts the host opaque wire and rejects duplicate packet keys before decoding", () => {
    const fixture = currentExchangeFixture;
    const brief = fixture("brief.tfsl-brief.json");
    const candidate = fixture("candidate-a.tfsl-candidate.json");
    const verified = processBatchRequest(JSON.parse(JSON.stringify({
      action: "exchange-candidate-verify", brief, candidate, opaquePackets: true,
    })));
    expect(verified.valid).toBe(true);
    expect(verified.compiledCss).toBe(compileTheme(JSON.parse(candidate).theme).css);
    const parsed = processBatchRequest({ action: "exchange-packet-parse", packetJson: candidate, opaquePackets: true });
    expect(parsed.packet).toBeUndefined();
    expect(parsed.canonicalJson).toBe(candidate);
    const duplicate = candidate.replace("{", '{"schema":"tfsl.theme-candidate",');
    const rejected = processBatchRequest(JSON.parse(JSON.stringify({
      action: "exchange-candidate-verify", brief, candidate: duplicate, opaquePackets: true,
    })));
    expect(rejected.valid).toBe(false);
    expect(rejected.compiledCss).toBeUndefined();
    expect(rejected.error?.code).not.toBe("INTERNAL_ERROR");
  });
  it("processes 'example' action for stellar-cyan with bit-for-bit compiler agreement", () => {
    const directResult = compileTheme(STELLAR_CYAN_EXAMPLE);
    const directDiagnostics = analyzeThemeContrast(STELLAR_CYAN_EXAMPLE);

    const batchResult = processBatchRequest({
      action: "example",
      exampleName: "stellar-cyan",
      uiRevision: 42,
    });

    expect(batchResult.status).toBe("success");
    expect(batchResult.valid).toBe(true);
    expect(batchResult.uiRevision).toBe(42);
    expect(batchResult.exampleName).toBe("stellar-cyan");
    expect(batchResult.compiledCss).toBe(directResult.css);
    expect(batchResult.descriptor).toEqual(directResult.descriptor);
    expect(batchResult.diagnostics).toEqual(directDiagnostics);
    expect(batchResult.specification?.name).toBe("stellar-cyan");
  });

  it("processes 'example' action for amber-forge with bit-for-bit compiler agreement", () => {
    const directResult = compileTheme(AMBER_FORGE_EXAMPLE);
    const directDiagnostics = analyzeThemeContrast(AMBER_FORGE_EXAMPLE);

    const batchResult = processBatchRequest({
      action: "example",
      exampleName: "amber-forge",
      uiRevision: 101,
    });

    expect(batchResult.status).toBe("success");
    expect(batchResult.valid).toBe(true);
    expect(batchResult.uiRevision).toBe(101);
    expect(batchResult.exampleName).toBe("amber-forge");
    expect(batchResult.compiledCss).toBe(directResult.css);
    expect(batchResult.descriptor).toEqual(directResult.descriptor);
    expect(batchResult.diagnostics).toEqual(directDiagnostics);
    expect(batchResult.specification?.name).toBe("amber-forge");
  });

  it("rejects unknown example names with actionable error", () => {
    const batchResult = processBatchRequest({
      action: "example",
      exampleName: "non-existent-theme",
    });

    expect(batchResult.status).toBe("error");
    expect(batchResult.valid).toBe(false);
    expect(batchResult.error?.code).toBe("UNKNOWN_EXAMPLE");
    expect(batchResult.error?.message).toContain("Unknown example name");
  });

  it("processes 'compile' action for a valid specification", () => {
    const spec = JSON.parse(JSON.stringify(STELLAR_CYAN_EXAMPLE));
    spec.colors.dark.accent.base = "#123456";

    const directResult = compileTheme(spec);
    const directDiagnostics = analyzeThemeContrast(spec);

    const batchResult = processBatchRequest({
      action: "compile",
      specification: spec,
      uiRevision: 5,
    });

    expect(batchResult.status).toBe("success");
    expect(batchResult.valid).toBe(true);
    expect(batchResult.uiRevision).toBe(5);
    expect(batchResult.compiledCss).toBe(directResult.css);
    expect(batchResult.descriptor).toEqual(directResult.descriptor);
    expect(batchResult.diagnostics).toEqual(directDiagnostics);
  });

  it("enforces strict-contrast option when requested", () => {
    const spec = JSON.parse(JSON.stringify(STELLAR_CYAN_EXAMPLE));
    // Set poor contrast color
    spec.colors.dark.neutrals.text = "#0a0a0a"; // very dark text on dark bg -> fails contrast

    // Without strict contrast -> compiles with warnings
    const normalResult = processBatchRequest({
      action: "compile",
      specification: spec,
      options: { strictContrast: false },
    });
    expect(normalResult.status).toBe("success");
    expect(normalResult.valid).toBe(true);
    expect(normalResult.diagnostics.some((d) => d.severity === "warning")).toBe(true);

    // With strict contrast -> fails with STRICT_CONTRAST_VIOLATION
    const strictResult = processBatchRequest({
      action: "compile",
      specification: spec,
      options: { strictContrast: true },
    });
    expect(strictResult.status).toBe("error");
    expect(strictResult.valid).toBe(false);
    expect(strictResult.error?.code).toBe("STRICT_CONTRAST_VIOLATION");
    expect(strictResult.diagnostics.some((d) => d.severity === "warning")).toBe(true);
  });

  it("handles schema validation errors with fieldPath", () => {
    const spec = JSON.parse(JSON.stringify(STELLAR_CYAN_EXAMPLE));
    spec.colors.dark.accent.base = "not-a-color";

    const batchResult = processBatchRequest({
      action: "compile",
      specification: spec,
    });

    expect(batchResult.status).toBe("error");
    expect(batchResult.valid).toBe(false);
    expect(batchResult.error?.code).toBe("INVALID_FORMAT");
    expect(batchResult.error?.fieldPath).toBe("root.colors.dark.accent.base");
  });

  it("rejects prototype pollution in specification", () => {
    const maliciousJson = JSON.parse('{"name":"bad","version":"0.1.0","schemaVersion":"tfsl.theme-v1","adapter":"starlight-v0.42","__proto__":{"polluted":true},"colors":{}}');

    const batchResult = processBatchRequest({
      action: "compile",
      specification: maliciousJson,
    });

    expect(batchResult.status).toBe("error");
    expect(batchResult.valid).toBe(false);
  });

  it("processes 'validate' action without compiling CSS", () => {
    const batchResult = processBatchRequest({
      action: "validate",
      specification: STELLAR_CYAN_EXAMPLE,
    });

    expect(batchResult.status).toBe("success");
    expect(batchResult.valid).toBe(true);
    expect(batchResult.compiledCss).toBeUndefined();
    expect(batchResult.diagnostics.length).toBeGreaterThan(0);
  });

  it("rejects unknown actions", () => {
    const batchResult = processBatchRequest({
      action: "destroy" as any,
    });

    expect(batchResult.status).toBe("error");
    expect(batchResult.valid).toBe(false);
    expect(batchResult.error?.code).toBe("UNKNOWN_ACTION");
  });

  it("runs end-to-end via CLI batch binary over stdin/stdout", async () => {
    const batchBinPath = resolve(__dirname, "../bin/tfsl-batch.js");

    const runProcess = (input: string): Promise<{ code: number | null; stdout: string; stderr: string }> => {
      return new Promise((resolvePromise) => {
        const proc = spawn(process.execPath, [batchBinPath], {
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });
        proc.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });

        proc.on("close", (code) => {
          resolvePromise({ code, stdout, stderr });
        });

        proc.stdin.write(input);
        proc.stdin.end();
      });
    };

    // 1. Valid example request
    const res1 = await runProcess(JSON.stringify({
      action: "example",
      exampleName: "stellar-cyan",
      uiRevision: 1,
    }));
    expect(res1.code).toBe(0);
    const parsed1 = JSON.parse(res1.stdout);
    expect(parsed1.status).toBe("success");
    expect(parsed1.valid).toBe(true);
    expect(parsed1.compiledCss).toContain("--sl-color-accent");

    // 2. Malformed JSON on stdin
    const res2 = await runProcess("{ broken json");
    expect(res2.code).toBe(1);
    const parsed2 = JSON.parse(res2.stdout);
    expect(parsed2.status).toBe("error");
    expect(parsed2.error?.code).toBe("INVALID_JSON");

    // 3. Empty input on stdin
    const res3 = await runProcess("");
    expect(res3.code).toBe(1);
    const parsed3 = JSON.parse(res3.stdout);
    expect(parsed3.status).toBe("error");
    expect(parsed3.error?.code).toBe("EMPTY_INPUT");
  });

  describe("Design Exchange Batch Actions & Error Hardening", () => {
    const loadJson = (filename: string) => JSON.parse(currentExchangeFixture(filename));

    it("returns structured error for malformed briefInput without dereference errors", () => {
      // Missing briefId
      const res1 = processBatchRequest({
        action: "exchange-brief-create",
        briefInput: {
          title: "Test Brief",
          goal: "A test goal",
          baselineTheme: STELLAR_CYAN_EXAMPLE,
        } as any,
      });
      expect(res1.status).toBe("error");
      expect(res1.valid).toBe(false);
      expect(res1.error?.code).toBe("MISSING_REQUIRED_FIELD");
      expect(res1.error?.fieldPath).toBe("briefId");

      // Missing title
      const res2 = processBatchRequest({
        action: "exchange-brief-create",
        briefInput: {
          briefId: "test-brief",
          goal: "A test goal",
          baselineTheme: STELLAR_CYAN_EXAMPLE,
        } as any,
      });
      expect(res2.status).toBe("error");
      expect(res2.valid).toBe(false);
      expect(res2.error?.code).toBe("MISSING_REQUIRED_FIELD");
      expect(res2.error?.fieldPath).toBe("title");

      // Missing baselineTheme
      const res3 = processBatchRequest({
        action: "exchange-brief-create",
        briefInput: {
          briefId: "test-brief",
          title: "Test Brief",
          goal: "A test goal",
        } as any,
      });
      expect(res3.status).toBe("error");
      expect(res3.valid).toBe(false);
      expect(res3.error?.code).toBe("MISSING_REQUIRED_FIELD");
      expect(res3.error?.fieldPath).toBe("baselineTheme");

      // Missing briefInput completely
      const res4 = processBatchRequest({
        action: "exchange-brief-create",
      });
      expect(res4.status).toBe("error");
      expect(res4.valid).toBe(false);
      expect(res4.error?.code).toBe("INVALID_REQUEST");
    });

    it("returns structured error for malformed reviewInput without dereference errors", () => {
      // Missing reviewId
      const res1 = processBatchRequest({
        action: "exchange-review-create",
        reviewInput: {
          brief: "sha256:78e5c95a29fb970ce9eb876c74b5f3cbd6c5be184ace560fae049d7e0e252888",
          candidateDigests: ["sha256:87ca505a52d1459ce84eef4041aa8f499f004f8abaa5512490468223b09d1da5"],
          dispositions: [],
          overallDisposition: { kind: "no-decision" },
          summary: "Summary",
        } as any,
      });
      expect(res1.status).toBe("error");
      expect(res1.valid).toBe(false);
      expect(res1.error?.code).toBe("MISSING_REQUIRED_FIELD");
      expect(res1.error?.fieldPath).toBe("reviewId");

      // Missing brief completely
      const res2 = processBatchRequest({
        action: "exchange-review-create",
        reviewInput: {
          reviewId: "test-review",
          candidateDigests: ["sha256:87ca505a52d1459ce84eef4041aa8f499f004f8abaa5512490468223b09d1da5"],
          dispositions: [],
          overallDisposition: { kind: "no-decision" },
          summary: "Summary",
        } as any,
      });
      expect(res2.status).toBe("error");
      expect(res2.valid).toBe(false);
      expect(res2.error?.code).toBe("MISSING_REQUIRED_FIELD");
      expect(res2.error?.fieldPath).toBe("brief");

      // Missing candidateDigests completely (does NOT throw TypeError: input.candidateDigests is not iterable)
      const res3 = processBatchRequest({
        action: "exchange-review-create",
        reviewInput: {
          reviewId: "test-review",
          brief: "sha256:78e5c95a29fb970ce9eb876c74b5f3cbd6c5be184ace560fae049d7e0e252888",
          dispositions: [],
          overallDisposition: { kind: "no-decision" },
          summary: "Summary",
        } as any,
      });
      expect(res3.status).toBe("error");
      expect(res3.valid).toBe(false);
      expect(res3.error?.code).toBe("MISSING_REQUIRED_FIELD");
      expect(res3.error?.fieldPath).toBe("candidateDigests");

      // Empty object as reviewInput
      const res4 = processBatchRequest({
        action: "exchange-review-create",
        reviewInput: {} as any,
      });
      expect(res4.status).toBe("error");
      expect(res4.valid).toBe(false);
      expect(res4.error?.code).toBe("MISSING_REQUIRED_FIELD");

      // Omitted reviewInput
      const res5 = processBatchRequest({
        action: "exchange-review-create",
      });
      expect(res5.status).toBe("error");
      expect(res5.valid).toBe(false);
      expect(res5.error?.code).toBe("INVALID_REQUEST");
    });

    it("successfully creates review when brief is supplied directly", () => {
      const candA = loadJson("candidate-a.tfsl-candidate.json");
      const res = processBatchRequest({
        action: "exchange-review-create",
        reviewInput: {
          reviewId: "test-review-digest",
          brief: candA.briefDigest,
          candidateDigests: [candA.candidateDigest],
          dispositions: [
            {
              candidateDigest: candA.candidateDigest,
              disposition: "approved",
              comment: "Approved via brief input",
            },
          ],
          overallDisposition: {
            kind: "approved",
            candidateDigest: candA.candidateDigest,
          },
          summary: "Review created with brief directly",
        },
      });

      expect(res.status).toBe("success");
      expect(res.valid).toBe(true);
      expect(res.packet?.schema).toBe("tfsl.theme-review");
      expect(res.digest).toBeDefined();
    });

    it("returns canonicalJson in exchange-packet-parse", () => {
      const briefRaw = currentExchangeFixture("brief.tfsl-brief.json");
      const res = processBatchRequest({
        action: "exchange-packet-parse",
        packetJson: briefRaw,
      });
      expect(res.status).toBe("success");
      expect(res.valid).toBe(true);
      expect(res.canonicalJson).toBe(briefRaw);
    });

    it("requires complete brief context in batch candidate-verify and review-validate", () => {
      const candA = loadJson("candidate-a.tfsl-candidate.json");
      const review = loadJson("review.tfsl-review.json");

      // candidate-verify missing brief
      const resCand = processBatchRequest({
        action: "exchange-candidate-verify",
        candidate: candA,
      });
      expect(resCand.status).toBe("error");
      expect(resCand.valid).toBe(false);
      expect(resCand.error?.code).toBe("INVALID_REQUEST");
      expect(resCand.error?.fieldPath).toBe("brief");

      // review-validate missing brief
      const resRev = processBatchRequest({
        action: "exchange-review-validate",
        review,
        candidates: [candA],
      });
      expect(resRev.status).toBe("error");
      expect(resRev.valid).toBe(false);
      expect(resRev.error?.code).toBe("INVALID_REQUEST");
      expect(resRev.error?.fieldPath).toBe("brief");
    });

    it("executes candidate verification once and compiles CSS with options including strictContrast", () => {
      const brief = loadJson("brief.tfsl-brief.json");
      const candA = loadJson("candidate-a.tfsl-candidate.json");

      // 1. Valid candidate verification produces compiledCss and descriptor in single pass
      const resValid = processBatchRequest({
        action: "exchange-candidate-verify",
        candidate: candA,
        brief,
      });
      expect(resValid.status).toBe("success");
      expect(resValid.valid).toBe(true);
      expect(resValid.compiledCss).toBeDefined();
      expect(resValid.compiledCss).toContain("--sl-color-accent");
      expect(resValid.descriptor).toBeDefined();
      expect(resValid.candidateVerification?.compiledCss).toBeUndefined();
      expect(resValid.candidateVerification?.descriptor).toBeUndefined();

      // 2. Candidate verification with strictContrast: true on compliant theme passes
      const resStrictPass = processBatchRequest({
        action: "exchange-candidate-verify",
        candidate: candA,
        brief,
        options: { strictContrast: true },
      });
      expect(resStrictPass.status).toBe("success");
      expect(resStrictPass.valid).toBe(true);
      expect(resStrictPass.compiledCss).toBeDefined();

      // 3. Candidate verification with strictContrast: true on non-compliant theme fails
      const candPoorContrast = JSON.parse(JSON.stringify(candA));
      candPoorContrast.theme.colors.dark.neutrals.text = "#050505"; // poor contrast on dark bg
      const resStrictFail = processBatchRequest({
        action: "exchange-candidate-verify",
        candidate: candPoorContrast,
        brief,
        options: { strictContrast: true },
      });
      expect(resStrictFail.status).toBe("error");
      expect(resStrictFail.valid).toBe(false);
      expect(resStrictFail.error?.code).toBe("STRICT_CONTRAST_VIOLATION");
      expect(resStrictFail.diagnostics.some((d) => d.severity === "warning" || d.disposition === "warn")).toBe(true);

      // 4. Candidate verification detects mismatched brief binding
      const candWrongBrief = JSON.parse(JSON.stringify(candA));
      candWrongBrief.briefDigest = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
      const resWrongBrief = processBatchRequest({
        action: "exchange-candidate-verify",
        candidate: candWrongBrief,
        brief,
      });
      expect(resWrongBrief.status).toBe("error");
      expect(resWrongBrief.valid).toBe(false);
      expect(resWrongBrief.candidateVerification?.errors.some((e) => e.includes("briefDigest"))).toBe(true);

      // 5. Candidate verification detects constraint violations against brief
      const candDisallowedEdit = JSON.parse(JSON.stringify(candA));
      candDisallowedEdit.theme.layout.sidebarWidth = "99rem"; // sidebarWidth not in brief.allowedFields
      const resDisallowed = processBatchRequest({
        action: "exchange-candidate-verify",
        candidate: candDisallowedEdit,
        brief,
      });
      expect(resDisallowed.status).toBe("error");
      expect(resDisallowed.valid).toBe(false);
      expect(resDisallowed.candidateVerification?.constraintViolations.length).toBeGreaterThan(0);
    });

    it("executes review link validation and detects duplicate, missing, stale, and visual issues", () => {
      const brief = loadJson("brief.tfsl-brief.json");
      const candA = loadJson("candidate-a.tfsl-candidate.json");
      const candB = loadJson("candidate-b.tfsl-candidate.json");
      const review = loadJson("review.tfsl-review.json");

      // 1. Valid review links against actual candidates and brief passes
      const resValid = processBatchRequest({
        action: "exchange-review-validate",
        review,
        candidates: [candA, candB],
        brief,
      });
      expect(resValid.status).toBe("success");
      expect(resValid.valid).toBe(true);
      expect(resValid.reviewValidation?.candidateMatches).toBe(true);
      expect(resValid.reviewValidation?.dispositionMatches).toBe(true);

      // 2. Duplicate candidate in context fails
      const resDupe = processBatchRequest({
        action: "exchange-review-validate",
        review,
        candidates: [candA, candA],
        brief,
      });
      expect(resDupe.status).toBe("error");
      expect(resDupe.valid).toBe(false);
      expect(resDupe.reviewValidation?.errors.some((e) => e.includes("Duplicate candidate"))).toBe(true);

      // 3. Missing candidate referenced by review fails
      const resMissing = processBatchRequest({
        action: "exchange-review-validate",
        review,
        candidates: [candA], // candB is missing
        brief,
      });
      expect(resMissing.status).toBe("error");
      expect(resMissing.valid).toBe(false);
      expect(resMissing.reviewValidation?.candidateMatches).toBe(false);

      // 4. Stale candidate bound to different brief fails
      const staleCand = JSON.parse(JSON.stringify(candB));
      staleCand.briefDigest = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
      const resStale = processBatchRequest({
        action: "exchange-review-validate",
        review,
        candidates: [candA, staleCand],
        brief,
      });
      expect(resStale.status).toBe("error");
      expect(resStale.valid).toBe(false);
      expect(resStale.reviewValidation?.errors.some((e) => e.includes("which does not match review briefDigest"))).toBe(true);

      // 5. Visual annotation targeting absent visual record fails
      const candWithAbsentVisual = JSON.parse(JSON.stringify(candA));
      candWithAbsentVisual.visualEvidence = [
        {
          schema: "tfsl.theme-visual-evidence",
          schemaVersion: 1,
          presence: "absent",
          reason: "Screenshot unavailable in headless environment",
          evidenceDigest: review.annotations[1].target.evidenceDigest,
        },
      ];
      const resAbsentVisual = processBatchRequest({
        action: "exchange-review-validate",
        review,
        candidates: [candWithAbsentVisual, candB],
        brief,
      });
      expect(resAbsentVisual.status).toBe("error");
      expect(resAbsentVisual.valid).toBe(false);
      expect(resAbsentVisual.reviewValidation?.annotationErrors.some((e) => e.includes("require 'included'"))).toBe(true);
    });
  });
});
