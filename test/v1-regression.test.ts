// Re-execute immutable v1 fixtures under their recorded producer version.
// Current release provenance is checked separately without this test-only override.
vi.mock("../src/v2/types.js", async (original) => ({
  ...await original<typeof import("../src/v2/types.js")>(),
  COMPILER_VERSION: "0.1.1",
}));
import { describe, expect, it, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  compileTheme,
  canonicalizeSpecification,
  generateThemePackage,
  emitPageTitleFrameComponent,
  processBatchRequest,
  STELLAR_CYAN_EXAMPLE,
  AMBER_FORGE_EXAMPLE,
  COMPILER_VERSION,
  COMPILER_PACKAGE,
} from "../src/index.js";

const TFSL_ROOT = resolve(import.meta.dirname, "..");
const FIXTURES_DIR = join(TFSL_ROOT, "test/fixtures/v1-baseline");
const MANIFEST_PATH = join(FIXTURES_DIR, "manifest.json");

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

describe("V1 Baseline Freeze and Regression Tests (TFSB61B-core)", () => {
  // Read literal manifest
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));

  describe("Baseline Source Identification and Contract Provenance", () => {
    it("identifies compiler package, historical version 0.1.1, and ADR0026 / TFSB58 contract", () => {
      expect(COMPILER_PACKAGE).toBe("@knowledge-forge-ai/theme-forge-stellar-loom");
      expect(COMPILER_VERSION).toBe("0.1.1");
      expect(manifest.baselineSource.package).toBe("@knowledge-forge-ai/theme-forge-stellar-loom");
      expect(manifest.baselineSource.version).toBe("0.1.1");
      expect(manifest.baselineSource.contract).toContain("ADR0026");
      expect(manifest.baselineSource.contract).toContain("TFSB58");
    });

  });

  describe("Stellar Cyan Literal Baseline Regression", () => {
    const cyanFixtureDir = join(FIXTURES_DIR, "stellar-cyan");
    const literalCanonicalJson = readFileSync(join(cyanFixtureDir, "canonical.json"), "utf8");
    const literalCss = readFileSync(join(cyanFixtureDir, "theme.css"), "utf8");
    const literalDescriptor = JSON.parse(readFileSync(join(cyanFixtureDir, "theme.descriptor.json"), "utf8"));

    it("matches literal frozen inputDigest and canonical JSON", () => {
      const { canonicalJson, inputDigest } = canonicalizeSpecification(STELLAR_CYAN_EXAMPLE);

      expect(inputDigest).toBe(manifest.examples["stellar-cyan"].inputDigest);
      expect(inputDigest).toBe("c134e96bcc1e68e10e17f6fbeb070f07015019ac1b656bd5a6e6039475509156");
      expect(canonicalJson).toBe(literalCanonicalJson);
      expect(sha256(canonicalJson)).toBe(manifest.examples["stellar-cyan"].canonicalJsonSha256);
    });

    it("matches literal frozen outputDigest, CSS, and descriptor", () => {
      const compilation = compileTheme(STELLAR_CYAN_EXAMPLE, { cssFile: "styles/theme.css" });

      expect(compilation.outputDigest).toBe(manifest.examples["stellar-cyan"].outputDigest);
      expect(compilation.outputDigest).toBe("e0aa688d2976a02eff54ef399eed9f4e90e725a322c47ccf470db2e1e4628011");
      expect(compilation.css).toBe(literalCss);
      expect(sha256(compilation.css)).toBe(manifest.examples["stellar-cyan"].cssSha256);
      expect(compilation.descriptor).toEqual(literalDescriptor);
      expect(compilation.descriptor.provenance.compilerVersion).toBe("0.1.1");
      expect(compilation.diagnostics.length).toBe(manifest.examples["stellar-cyan"].diagnosticsCount);
    });

    it("matches literal frozen generated package file bytes and hashes (11 files, CSS-only)", () => {
      const generated = generateThemePackage({
        themeSpec: STELLAR_CYAN_EXAMPLE,
        metadata: manifest.examples["stellar-cyan"].packageMetadata,
      });

      const pkgFixtureDir = join(cyanFixtureDir, "package");
      const expectedFiles = manifest.examples["stellar-cyan"].packageFiles;
      expect(generated.files.size).toBe(11);
      expect(generated.files.has("components/PageTitleFrame.astro")).toBe(false);

      for (const [relPath, fileMeta] of Object.entries(expectedFiles) as [string, { sha256: string; byteLength: number }][]) {
        expect(generated.files.has(relPath)).toBe(true);
        const generatedContent = generated.files.get(relPath)!;
        const literalContent = readFileSync(join(pkgFixtureDir, relPath), "utf8");

        expect(generatedContent).toBe(literalContent);
        expect(sha256(generatedContent)).toBe(fileMeta.sha256);
        expect(Buffer.byteLength(generatedContent, "utf8")).toBe(fileMeta.byteLength);
      }
    });
  });

  describe("Amber Forge Literal Baseline Regression", () => {
    const amberFixtureDir = join(FIXTURES_DIR, "amber-forge");
    const literalCanonicalJson = readFileSync(join(amberFixtureDir, "canonical.json"), "utf8");
    const literalCss = readFileSync(join(amberFixtureDir, "theme.css"), "utf8");
    const literalDescriptor = JSON.parse(readFileSync(join(amberFixtureDir, "theme.descriptor.json"), "utf8"));

    it("matches literal frozen inputDigest and canonical JSON", () => {
      const { canonicalJson, inputDigest } = canonicalizeSpecification(AMBER_FORGE_EXAMPLE);

      expect(inputDigest).toBe(manifest.examples["amber-forge"].inputDigest);
      expect(inputDigest).toBe("c8d6da44c19e5b4050fc48b2929d496bb3dcb3f6e661bb06fbe0529ebe6d170d");
      expect(canonicalJson).toBe(literalCanonicalJson);
      expect(sha256(canonicalJson)).toBe(manifest.examples["amber-forge"].canonicalJsonSha256);
    });

    it("matches literal frozen outputDigest, CSS, and descriptor", () => {
      const compilation = compileTheme(AMBER_FORGE_EXAMPLE, { cssFile: "styles/theme.css" });

      expect(compilation.outputDigest).toBe(manifest.examples["amber-forge"].outputDigest);
      expect(compilation.outputDigest).toBe("359c7715273bbbb3710c7802822b79ddf58c8ad4a9289b4e566f66c8e95cc2c0");
      expect(compilation.css).toBe(literalCss);
      expect(sha256(compilation.css)).toBe(manifest.examples["amber-forge"].cssSha256);
      expect(compilation.descriptor).toEqual(literalDescriptor);
      expect(compilation.descriptor.provenance.compilerVersion).toBe("0.1.1");
      expect(compilation.diagnostics.length).toBe(manifest.examples["amber-forge"].diagnosticsCount);
    });

    it("matches literal frozen generated package file bytes and hashes (12 files, page-title-frame template)", () => {
      const generated = generateThemePackage({
        themeSpec: AMBER_FORGE_EXAMPLE,
        metadata: manifest.examples["amber-forge"].packageMetadata,
      });

      const pkgFixtureDir = join(amberFixtureDir, "package");
      const expectedFiles = manifest.examples["amber-forge"].packageFiles;
      expect(generated.files.size).toBe(12);
      expect(generated.files.has("components/PageTitleFrame.astro")).toBe(true);

      for (const [relPath, fileMeta] of Object.entries(expectedFiles) as [string, { sha256: string; byteLength: number }][]) {
        expect(generated.files.has(relPath)).toBe(true);
        const generatedContent = generated.files.get(relPath)!;
        const literalContent = readFileSync(join(pkgFixtureDir, relPath), "utf8");

        expect(generatedContent).toBe(literalContent);
        expect(sha256(generatedContent)).toBe(fileMeta.sha256);
        expect(Buffer.byteLength(generatedContent, "utf8")).toBe(fileMeta.byteLength);
      }
    });
  });

  describe("PageTitle Frame Literal Template Regression", () => {
    const literalPageTitleFrame = readFileSync(join(FIXTURES_DIR, "page-title/PageTitleFrame.astro"), "utf8");

    it("matches literal retained PageTitleFrame.astro byte-for-byte and hash", () => {
      const emitted = emitPageTitleFrameComponent();
      expect(emitted).toBe(literalPageTitleFrame);
      expect(sha256(emitted)).toBe(manifest.pageTitleFrame.sha256);
      expect(sha256(emitted)).toBe("ec6728e2cb2fc222140348152b7cc6d70bb403683aa493e119118d50229e5745");
      expect(Buffer.byteLength(emitted, "utf8")).toBe(manifest.pageTitleFrame.byteLength);
    });

    it("verifies template isolation between CSS-only and template packages", () => {
      const cyanPkg = generateThemePackage({
        themeSpec: STELLAR_CYAN_EXAMPLE,
        metadata: manifest.examples["stellar-cyan"].packageMetadata,
      });
      const amberPkg = generateThemePackage({
        themeSpec: AMBER_FORGE_EXAMPLE,
        metadata: manifest.examples["amber-forge"].packageMetadata,
      });

      expect(cyanPkg.files.has("components/PageTitleFrame.astro")).toBe(false);
      expect(amberPkg.files.has("components/PageTitleFrame.astro")).toBe(true);
      expect(amberPkg.files.get("components/PageTitleFrame.astro")).toBe(literalPageTitleFrame);
    });
  });

  describe("CLI Execution Regression against Frozen Baseline", () => {
    const tfslBin = join(TFSL_ROOT, "bin/tfsl.js");

    it("executes CLI validate on both examples", () => {
      const cyanFile = join(TFSL_ROOT, "examples/stellar-cyan.theme.json");
      const amberFile = join(TFSL_ROOT, "examples/amber-forge.theme.json");

      const outCyan = execFileSync(process.execPath, [tfslBin, "validate", cyanFile, "--json"], {
        cwd: TFSL_ROOT,
        encoding: "utf8",
      });
      const parsedCyan = JSON.parse(outCyan);
      expect(parsedCyan.status).toBe("success");
      expect(parsedCyan.theme).toBe("stellar-cyan");

      const outAmber = execFileSync(process.execPath, [tfslBin, "validate", amberFile, "--json"], {
        cwd: TFSL_ROOT,
        encoding: "utf8",
      });
      const parsedAmber = JSON.parse(outAmber);
      expect(parsedAmber.status).toBe("success");
      expect(parsedAmber.theme).toBe("amber-forge");
    });

    it("executes CLI compile and matches frozen output digest and CSS", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "tfsl-reg-compile-"));
      try {
        const cyanFile = join(TFSL_ROOT, "examples/stellar-cyan.theme.json");
        const outCompile = execFileSync(process.execPath, [tfslBin, "compile", cyanFile, "--out", tmpDir, "--json"], {
          cwd: TFSL_ROOT,
          encoding: "utf8",
        });
        const parsed = JSON.parse(outCompile);
        expect(parsed.status).toBe("success");
        expect(parsed.outputDigest).toBe("e0aa688d2976a02eff54ef399eed9f4e90e725a322c47ccf470db2e1e4628011");

        const writtenCss = await readFile(join(tmpDir, "theme.css"), "utf8");
        const literalCss = readFileSync(join(FIXTURES_DIR, "stellar-cyan/theme.css"), "utf8");
        expect(writtenCss).toBe(literalCss);
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("executes CLI generate with template and matches frozen package files", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "tfsl-reg-gen-"));
      const metaFile = join(tmpDir, "meta.json");
      const outPkgDir = join(tmpDir, "pkg");
      try {
        await writeFile(
          metaFile,
          JSON.stringify(manifest.examples["amber-forge"].packageMetadata, null, 2),
          "utf8"
        );
        const amberFile = join(TFSL_ROOT, "examples/amber-forge.theme.json");
        const outGen = execFileSync(
          process.execPath,
          [tfslBin, "generate", amberFile, "--package", metaFile, "--out", outPkgDir, "--template", "page-title-frame", "--json"],
          { cwd: TFSL_ROOT, encoding: "utf8" }
        );
        const parsed = JSON.parse(outGen);
        expect(parsed.status).toBe("success");
        expect(parsed.filesWritten.length).toBe(12);

        const frameAstro = await readFile(join(outPkgDir, "components/PageTitleFrame.astro"), "utf8");
        const literalFrameAstro = readFileSync(join(FIXTURES_DIR, "page-title/PageTitleFrame.astro"), "utf8");
        expect(frameAstro).toBe(literalFrameAstro);
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("Batch Protocol Regression against Frozen Baseline", () => {
    const tfslBatchBin = join(TFSL_ROOT, "bin/tfsl-batch.js");

    it("processes batch example action for stellar-cyan matching frozen baseline CSS", () => {
      const input = JSON.stringify({ action: "example", exampleName: "stellar-cyan" });
      const out = execFileSync(process.execPath, [tfslBatchBin], {
        cwd: TFSL_ROOT,
        input,
        encoding: "utf8",
      });
      const parsed = JSON.parse(out);
      expect(parsed.status).toBe("success");
      expect(parsed.valid).toBe(true);
      expect(sha256(parsed.compiledCss)).toBe("e0aa688d2976a02eff54ef399eed9f4e90e725a322c47ccf470db2e1e4628011");

      const libResult = processBatchRequest({ action: "example", exampleName: "stellar-cyan" });
      expect(libResult.compiledCss).toBe(parsed.compiledCss);
    });

    it("processes batch example action for amber-forge matching frozen baseline CSS", () => {
      const input = JSON.stringify({ action: "example", exampleName: "amber-forge" });
      const out = execFileSync(process.execPath, [tfslBatchBin], {
        cwd: TFSL_ROOT,
        input,
        encoding: "utf8",
      });
      const parsed = JSON.parse(out);
      expect(parsed.status).toBe("success");
      expect(parsed.valid).toBe(true);
      expect(sha256(parsed.compiledCss)).toBe("359c7715273bbbb3710c7802822b79ddf58c8ad4a9289b4e566f66c8e95cc2c0");

      const libResult = processBatchRequest({ action: "example", exampleName: "amber-forge" });
      expect(libResult.compiledCss).toBe(parsed.compiledCss);
    });
  });

  describe("Freeze Baseline Tool Self-Check (--check)", () => {
    it("runs freeze-v1-baseline.mjs --check cleanly", () => {
      const toolScript = join(TFSL_ROOT, "tools/freeze-v1-baseline.mjs");
      const out = execFileSync(process.execPath, [toolScript, "--check"], {
        cwd: TFSL_ROOT,
        encoding: "utf8",
      });
      expect(out).toContain("All v1 baseline fixtures match current source exactly.");
    });
  });
});
