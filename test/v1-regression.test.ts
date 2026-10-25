// Re-execute immutable v1 fixtures under their recorded producer version.
// Current release provenance is checked separately without this test-only override.
vi.mock("../src/v2/types.js", async (original) => ({
  ...await original<typeof import("../src/v2/types.js")>(),
  COMPILER_VERSION: "0.1.1",
}));
vi.mock("../src/generator/legal.js", async (original) =>
  (await import("./historical-legal-profile.js")).historicalLegalModule(
    await original<typeof import("../src/generator/legal.js")>()
  )
);
import { describe, expect, it, vi } from "vitest";
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readdirSync } from "node:fs";
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
import {
  assertHistoricalLegalRecord,
  CURRENT_CONTACT,
  HISTORICAL_CONTACT,
  HISTORICAL_LEGAL_PROFILE,
  type LegalProfileRow,
} from "./historical-legal-profile.js";
import {
  CURRENT_CONTACT as TOOL_CURRENT_CONTACT,
  HISTORICAL_CONTACT as TOOL_HISTORICAL_CONTACT,
  HISTORICAL_LEGAL_ROWS,
  HISTORICAL_PRODUCER_VERSION,
  assertRetainedLegal,
  projectHistoricalDescriptor,
  projectHistoricalPackageFiles,
// @ts-expect-error - freeze-v1-baseline.mjs is an ES module tool without separate d.ts
} from "../tools/freeze-v1-baseline.mjs";

const TFSL_ROOT = resolve(import.meta.dirname, "..");
const FIXTURES_DIR = join(TFSL_ROOT, "test/fixtures/v1-baseline");
const MANIFEST_PATH = join(FIXTURES_DIR, "manifest.json");

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function snapshotDirectoryHashes(rootDir: string): Record<string, { bytes: number; sha256: string }> {
  const out: Record<string, { bytes: number; sha256: string }> = {};
  function walk(currentDir: string, prefix: string): void {
    const entries = readdirSync(currentDir, { withFileTypes: true }).sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0
    );
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        const fd = openSync(fullPath, "r");
        try {
          const st = fstatSync(fd);
          if (!st.isFile()) continue;
          const buf = readFileSync(fd);
          out[relPath] = { bytes: buf.byteLength, sha256: sha256(buf) };
        } finally {
          closeSync(fd);
        }
      }
    }
  }
  walk(rootDir, "");
  return out;
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
      assertHistoricalLegalRecord(expectedFiles, "stellar-cyan");
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
      assertHistoricalLegalRecord(expectedFiles, "amber-forge");
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
      const beforeSnapshot = snapshotDirectoryHashes(FIXTURES_DIR);
      expect(Object.keys(beforeSnapshot).length).toBeGreaterThan(0);
      const toolScript = join(TFSL_ROOT, "tools/freeze-v1-baseline.mjs");
      const out = execFileSync(process.execPath, [toolScript, "--check"], {
        cwd: TFSL_ROOT,
        encoding: "utf8",
      });
      expect(out).toContain("All v1 baseline fixtures match current source exactly.");
      const afterSnapshot = snapshotDirectoryHashes(FIXTURES_DIR);
      expect(afterSnapshot).toEqual(beforeSnapshot);
    });
  });

  describe("Historical Comparison Projection (in-memory --check boundary)", () => {
    const currentVersion = (
      JSON.parse(readFileSync(join(TFSL_ROOT, "package.json"), "utf8")) as { version: string }
    ).version;
    const currentLegalManifest = JSON.parse(
      readFileSync(join(TFSL_ROOT, "test/fixtures/current-legal-profile/manifest.json"), "utf8")
    ) as { legalRows: LegalProfileRow[] };

    function readRetainedLegalBuffers(): Record<
      "stellar-cyan" | "amber-forge",
      Record<"COMMERCIAL-LICENSE.md" | "LICENSE" | "NOTICE", Buffer>
    > {
      return {
        "stellar-cyan": {
          "COMMERCIAL-LICENSE.md": readFileSync(
            join(FIXTURES_DIR, "stellar-cyan/package/COMMERCIAL-LICENSE.md")
          ),
          LICENSE: readFileSync(join(FIXTURES_DIR, "stellar-cyan/package/LICENSE")),
          NOTICE: readFileSync(join(FIXTURES_DIR, "stellar-cyan/package/NOTICE")),
        },
        "amber-forge": {
          "COMMERCIAL-LICENSE.md": readFileSync(
            join(FIXTURES_DIR, "amber-forge/package/COMMERCIAL-LICENSE.md")
          ),
          LICENSE: readFileSync(join(FIXTURES_DIR, "amber-forge/package/LICENSE")),
          NOTICE: readFileSync(join(FIXTURES_DIR, "amber-forge/package/NOTICE")),
        },
      };
    }

    function retainedPackageMap(example: "stellar-cyan" | "amber-forge"): Map<string, string> {
      const pkgDir = join(FIXTURES_DIR, example, "package");
      const expectedFiles = manifest.examples[example].packageFiles as Record<
        string,
        { sha256: string; byteLength: number }
      >;
      const out = new Map<string, string>();
      for (const relPath of Object.keys(expectedFiles).sort()) {
        out.set(relPath, readFileSync(join(pkgDir, relPath), "utf8"));
      }
      return out;
    }

    function currentShapedPackageMap(
      example: "stellar-cyan" | "amber-forge",
      legalMod: {
        readonly AGPL_3_LICENSE_TEXT: string;
        readonly FIRST_PARTY_NOTICE_TEXT: string;
        readonly COMMERCIAL_LICENSE_TEXT: string;
      }
    ): Map<string, string> {
      const files = retainedPackageMap(example);
      files.set("COMMERCIAL-LICENSE.md", legalMod.COMMERCIAL_LICENSE_TEXT);
      files.set("LICENSE", legalMod.AGPL_3_LICENSE_TEXT);
      files.set("NOTICE", legalMod.FIRST_PARTY_NOTICE_TEXT);

      const descriptor = JSON.parse(files.get("theme.descriptor.json")!) as {
        provenance: { compiler: string; compilerVersion: string };
      };
      descriptor.provenance.compilerVersion = currentVersion;
      files.set("theme.descriptor.json", JSON.stringify(descriptor, null, 2) + "\n");

      const readme = files
        .get("README.md")!
        .replace(
          `Generated by \`${COMPILER_PACKAGE}\` (${HISTORICAL_PRODUCER_VERSION}).`,
          `Generated by \`${COMPILER_PACKAGE}\` (${currentVersion}).`
        );
      files.set("README.md", readme);

      const provenance = JSON.parse(files.get("provenance.json")!) as {
        generator: string;
        generatorVersion: string;
        files: { path: string; size: number; sha256: string; category: string }[];
      };
      provenance.generatorVersion = currentVersion;
      for (const row of provenance.files) {
        if (
          row.path === "COMMERCIAL-LICENSE.md" ||
          row.path === "NOTICE" ||
          row.path === "README.md" ||
          row.path === "theme.descriptor.json"
        ) {
          const updated = files.get(row.path)!;
          row.size = Buffer.byteLength(updated, "utf8");
          row.sha256 = sha256(updated);
        }
      }
      files.set("provenance.json", JSON.stringify(provenance, null, 2) + "\n");
      return files;
    }

    function withMutatedFile(
      baseFiles: ReadonlyMap<string, string>,
      relPath: string,
      content: string,
      options: { syncRow: boolean }
    ): Map<string, string> {
      const next = new Map(baseFiles);
      next.set(relPath, content);
      if (options.syncRow) {
        const provenance = JSON.parse(next.get("provenance.json")!) as {
          files: { path: string; size: number; sha256: string; category: string }[];
        };
        const row = provenance.files.find((r) => r.path === relPath);
        if (row) {
          row.size = Buffer.byteLength(content, "utf8");
          row.sha256 = sha256(content);
        }
        next.set("provenance.json", JSON.stringify(provenance, null, 2) + "\n");
      }
      return next;
    }

    it("projects current-contact packages and descriptors to retained v1 fixtures without mutating inputs", async () => {
      const actualLegal = await vi.importActual<typeof import("../src/generator/legal.js")>(
        "../src/generator/legal.js"
      );

      expect(TOOL_CURRENT_CONTACT).toBe(CURRENT_CONTACT);
      expect(TOOL_HISTORICAL_CONTACT).toBe(HISTORICAL_CONTACT);
      expect(HISTORICAL_PRODUCER_VERSION).toBe("0.1.1");
      expect(HISTORICAL_LEGAL_ROWS).toEqual(HISTORICAL_LEGAL_PROFILE);

      const actualCurrentRows: LegalProfileRow[] = [
        {
          path: "COMMERCIAL-LICENSE.md",
          bytes: Buffer.byteLength(actualLegal.COMMERCIAL_LICENSE_TEXT, "utf8"),
          sha256: sha256(actualLegal.COMMERCIAL_LICENSE_TEXT),
        },
        {
          path: "LICENSE",
          bytes: Buffer.byteLength(actualLegal.AGPL_3_LICENSE_TEXT, "utf8"),
          sha256: sha256(actualLegal.AGPL_3_LICENSE_TEXT),
        },
        {
          path: "NOTICE",
          bytes: Buffer.byteLength(actualLegal.FIRST_PARTY_NOTICE_TEXT, "utf8"),
          sha256: sha256(actualLegal.FIRST_PARTY_NOTICE_TEXT),
        },
      ];
      expect(actualCurrentRows).toEqual(currentLegalManifest.legalRows);

      const retainedLegal = assertRetainedLegal(
        manifest,
        COMPILER_PACKAGE,
        readRetainedLegalBuffers()
      );

      for (const example of ["stellar-cyan", "amber-forge"] as const) {
        const currentFiles = currentShapedPackageMap(example, actualLegal);
        const beforeEntries = [...currentFiles.entries()];
        const projected = projectHistoricalPackageFiles({
          files: currentFiles,
          compilerPackage: COMPILER_PACKAGE,
          currentVersion,
          historicalVersion: HISTORICAL_PRODUCER_VERSION,
          retainedLegal,
        });

        expect([...currentFiles.entries()]).toEqual(beforeEntries);
        expect([...projected.entries()]).toEqual([...retainedPackageMap(example).entries()]);

        for (const [relPath, content] of currentFiles.entries()) {
          if (
            relPath !== "COMMERCIAL-LICENSE.md" &&
            relPath !== "NOTICE" &&
            relPath !== "README.md" &&
            relPath !== "theme.descriptor.json" &&
            relPath !== "provenance.json"
          ) {
            expect(projected.get(relPath)).toBe(content);
          }
        }

        const currentDescriptor = structuredClone(manifest.examples[example].descriptor);
        currentDescriptor.provenance.compilerVersion = currentVersion;
        const descriptorSnapshot = structuredClone(currentDescriptor);
        const projectedDescriptor = projectHistoricalDescriptor(currentDescriptor, {
          compilerPackage: COMPILER_PACKAGE,
          currentVersion,
          historicalVersion: HISTORICAL_PRODUCER_VERSION,
        });

        expect(currentDescriptor).toEqual(descriptorSnapshot);
        expect(projectedDescriptor).toEqual(manifest.examples[example].descriptor);
      }
    });

    it("rejects extra, mixed, or missing contacts in NOTICE and COMMERCIAL-LICENSE.md", async () => {
      const actualLegal = await vi.importActual<typeof import("../src/generator/legal.js")>(
        "../src/generator/legal.js"
      );
      const retainedLegal = assertRetainedLegal(
        manifest,
        COMPILER_PACKAGE,
        readRetainedLegalBuffers()
      );
      const base = currentShapedPackageMap("stellar-cyan", actualLegal);

      for (const contactPath of ["NOTICE", "COMMERCIAL-LICENSE.md"] as const) {
        const extraContact = withMutatedFile(
          base,
          contactPath,
          base.get(contactPath)! + `\n${CURRENT_CONTACT}\n`,
          { syncRow: true }
        );
        expect(() =>
          projectHistoricalPackageFiles({
            files: extraContact,
            compilerPackage: COMPILER_PACKAGE,
            currentVersion,
            historicalVersion: HISTORICAL_PRODUCER_VERSION,
            retainedLegal,
          })
        ).toThrow(/occurrences of current contact/);

        const mixedContact = withMutatedFile(
          base,
          contactPath,
          base.get(contactPath)! + `\n${HISTORICAL_CONTACT}\n`,
          { syncRow: true }
        );
        expect(() =>
          projectHistoricalPackageFiles({
            files: mixedContact,
            compilerPackage: COMPILER_PACKAGE,
            currentVersion,
            historicalVersion: HISTORICAL_PRODUCER_VERSION,
            retainedLegal,
          })
        ).toThrow(/mixed\/historical contact/);

        const missingContact = withMutatedFile(
          base,
          contactPath,
          base.get(contactPath)!.replace(CURRENT_CONTACT, "other@example.com"),
          { syncRow: true }
        );
        expect(() =>
          projectHistoricalPackageFiles({
            files: missingContact,
            compilerPackage: COMPILER_PACKAGE,
            currentVersion,
            historicalVersion: HISTORICAL_PRODUCER_VERSION,
            retainedLegal,
          })
        ).toThrow(/missing current maintained contact/);
      }
    });

    it("rejects non-contact byte changes in NOTICE, COMMERCIAL-LICENSE.md, or LICENSE", async () => {
      const actualLegal = await vi.importActual<typeof import("../src/generator/legal.js")>(
        "../src/generator/legal.js"
      );
      const retainedLegal = assertRetainedLegal(
        manifest,
        COMPILER_PACKAGE,
        readRetainedLegalBuffers()
      );
      const base = currentShapedPackageMap("stellar-cyan", actualLegal);

      const noticeDrifted = withMutatedFile(
        base,
        "NOTICE",
        base.get("NOTICE")!.replace("Notice", "notice"),
        { syncRow: true }
      );
      expect(() =>
        projectHistoricalPackageFiles({
          files: noticeDrifted,
          compilerPackage: COMPILER_PACKAGE,
          currentVersion,
          historicalVersion: HISTORICAL_PRODUCER_VERSION,
          retainedLegal,
        })
      ).toThrow(/Non-contact byte drift in 'NOTICE'/);

      const commercialDrifted = withMutatedFile(
        base,
        "COMMERCIAL-LICENSE.md",
        base.get("COMMERCIAL-LICENSE.md")!.replace("Commercial", "commercial"),
        { syncRow: true }
      );
      expect(() =>
        projectHistoricalPackageFiles({
          files: commercialDrifted,
          compilerPackage: COMPILER_PACKAGE,
          currentVersion,
          historicalVersion: HISTORICAL_PRODUCER_VERSION,
          retainedLegal,
        })
      ).toThrow(/Non-contact byte drift in 'COMMERCIAL-LICENSE\.md'/);

      const licenseDrifted = withMutatedFile(
        base,
        "LICENSE",
        base.get("LICENSE")!.slice(0, -1) + " ",
        { syncRow: true }
      );
      expect(() =>
        projectHistoricalPackageFiles({
          files: licenseDrifted,
          compilerPackage: COMPILER_PACKAGE,
          currentVersion,
          historicalVersion: HISTORICAL_PRODUCER_VERSION,
          retainedLegal,
        })
      ).toThrow(/Current LICENSE bytes diverged/);
    });

    it("validates all current provenance rows before projection and rejects stale, duplicate, unknown, missing, or malformed rows", async () => {
      const actualLegal = await vi.importActual<typeof import("../src/generator/legal.js")>(
        "../src/generator/legal.js"
      );
      const retainedLegal = assertRetainedLegal(
        manifest,
        COMPILER_PACKAGE,
        readRetainedLegalBuffers()
      );
      const base = currentShapedPackageMap("stellar-cyan", actualLegal);

      const staleIndex = withMutatedFile(base, "index.js", base.get("index.js")! + "\n", {
        syncRow: false,
      });
      expect(() =>
        projectHistoricalPackageFiles({
          files: staleIndex,
          compilerPackage: COMPILER_PACKAGE,
          currentVersion,
          historicalVersion: HISTORICAL_PRODUCER_VERSION,
          retainedLegal,
        })
      ).toThrow(/Current provenance row mismatch for 'index\.js'/);

      const staleNoticeProv = new Map(base);
      const provStaleNotice = JSON.parse(staleNoticeProv.get("provenance.json")!);
      const noticeRow = provStaleNotice.files.find((r: { path: string }) => r.path === "NOTICE");
      noticeRow.size = HISTORICAL_LEGAL_PROFILE.NOTICE.bytes;
      noticeRow.sha256 = HISTORICAL_LEGAL_PROFILE.NOTICE.sha256;
      staleNoticeProv.set("provenance.json", JSON.stringify(provStaleNotice, null, 2) + "\n");
      expect(() =>
        projectHistoricalPackageFiles({
          files: staleNoticeProv,
          compilerPackage: COMPILER_PACKAGE,
          currentVersion,
          historicalVersion: HISTORICAL_PRODUCER_VERSION,
          retainedLegal,
        })
      ).toThrow(/Current provenance row mismatch for 'NOTICE'/);

      const dupRowMap = new Map(base);
      const provDup = JSON.parse(dupRowMap.get("provenance.json")!);
      provDup.files.push({ ...provDup.files[0] });
      dupRowMap.set("provenance.json", JSON.stringify(provDup, null, 2) + "\n");
      expect(() =>
        projectHistoricalPackageFiles({
          files: dupRowMap,
          compilerPackage: COMPILER_PACKAGE,
          currentVersion,
          historicalVersion: HISTORICAL_PRODUCER_VERSION,
          retainedLegal,
        })
      ).toThrow(/Duplicate provenance row/);

      const unknownRowMap = new Map(base);
      const provUnknown = JSON.parse(unknownRowMap.get("provenance.json")!);
      provUnknown.files.push({
        path: "extra.txt",
        size: 0,
        sha256: "0".repeat(64),
        category: "first-party-expression",
      });
      unknownRowMap.set("provenance.json", JSON.stringify(provUnknown, null, 2) + "\n");
      expect(() =>
        projectHistoricalPackageFiles({
          files: unknownRowMap,
          compilerPackage: COMPILER_PACKAGE,
          currentVersion,
          historicalVersion: HISTORICAL_PRODUCER_VERSION,
          retainedLegal,
        })
      ).toThrow(/Unknown provenance row path 'extra\.txt'/);

      const missingRowMap = new Map(base);
      const provMissing = JSON.parse(missingRowMap.get("provenance.json")!);
      provMissing.files = provMissing.files.filter((r: { path: string }) => r.path !== "index.js");
      missingRowMap.set("provenance.json", JSON.stringify(provMissing, null, 2) + "\n");
      expect(() =>
        projectHistoricalPackageFiles({
          files: missingRowMap,
          compilerPackage: COMPILER_PACKAGE,
          currentVersion,
          historicalVersion: HISTORICAL_PRODUCER_VERSION,
          retainedLegal,
        })
      ).toThrow(/Missing provenance row for emitted file 'index\.js'/);

      const extraKeyMap = new Map(base);
      const provExtraKey = JSON.parse(extraKeyMap.get("provenance.json")!);
      provExtraKey.files[0].extra = true;
      extraKeyMap.set("provenance.json", JSON.stringify(provExtraKey, null, 2) + "\n");
      expect(() =>
        projectHistoricalPackageFiles({
          files: extraKeyMap,
          compilerPackage: COMPILER_PACKAGE,
          currentVersion,
          historicalVersion: HISTORICAL_PRODUCER_VERSION,
          retainedLegal,
        })
      ).toThrow(/Malformed provenance row keys/);

      const badCatMap = new Map(base);
      const provBadCat = JSON.parse(badCatMap.get("provenance.json")!);
      const readmeRow = provBadCat.files.find((r: { path: string }) => r.path === "README.md");
      readmeRow.category = "legal-notice";
      badCatMap.set("provenance.json", JSON.stringify(provBadCat, null, 2) + "\n");
      expect(() =>
        projectHistoricalPackageFiles({
          files: badCatMap,
          compilerPackage: COMPILER_PACKAGE,
          currentVersion,
          historicalVersion: HISTORICAL_PRODUCER_VERSION,
          retainedLegal,
        })
      ).toThrow(/Unexpected legal-notice category/);

      const nonCanonicalMap = new Map(base);
      nonCanonicalMap.set("provenance.json", nonCanonicalMap.get("provenance.json")!.trimEnd());
      expect(() =>
        projectHistoricalPackageFiles({
          files: nonCanonicalMap,
          compilerPackage: COMPILER_PACKAGE,
          currentVersion,
          historicalVersion: HISTORICAL_PRODUCER_VERSION,
          retainedLegal,
        })
      ).toThrow(/Non-canonical provenance\.json serialization/);
    });

    it("rejects wrong producer, wrong current version, or malformed README producer sentence", async () => {
      const actualLegal = await vi.importActual<typeof import("../src/generator/legal.js")>(
        "../src/generator/legal.js"
      );
      const retainedLegal = assertRetainedLegal(
        manifest,
        COMPILER_PACKAGE,
        readRetainedLegalBuffers()
      );
      const base = currentShapedPackageMap("stellar-cyan", actualLegal);

      const wrongGenVerMap = new Map(base);
      const provWrongVer = JSON.parse(wrongGenVerMap.get("provenance.json")!);
      provWrongVer.generatorVersion = "0.1.1";
      wrongGenVerMap.set("provenance.json", JSON.stringify(provWrongVer, null, 2) + "\n");
      expect(() =>
        projectHistoricalPackageFiles({
          files: wrongGenVerMap,
          compilerPackage: COMPILER_PACKAGE,
          currentVersion,
          historicalVersion: HISTORICAL_PRODUCER_VERSION,
          retainedLegal,
        })
      ).toThrow(/Current package producer mismatch/);

      const wrongGenPkgMap = new Map(base);
      const provWrongPkg = JSON.parse(wrongGenPkgMap.get("provenance.json")!);
      provWrongPkg.generator = "other-pkg";
      wrongGenPkgMap.set("provenance.json", JSON.stringify(provWrongPkg, null, 2) + "\n");
      expect(() =>
        projectHistoricalPackageFiles({
          files: wrongGenPkgMap,
          compilerPackage: COMPILER_PACKAGE,
          currentVersion,
          historicalVersion: HISTORICAL_PRODUCER_VERSION,
          retainedLegal,
        })
      ).toThrow(/Current package producer mismatch/);

      const wrongDescObj = structuredClone(manifest.examples["stellar-cyan"].descriptor);
      expect(() =>
        projectHistoricalDescriptor(wrongDescObj, {
          compilerPackage: COMPILER_PACKAGE,
          currentVersion,
          historicalVersion: HISTORICAL_PRODUCER_VERSION,
        })
      ).toThrow(/Current descriptor producer mismatch/);

      const wrongDescFileMap = withMutatedFile(
        base,
        "theme.descriptor.json",
        JSON.stringify(wrongDescObj, null, 2) + "\n",
        { syncRow: true }
      );
      expect(() =>
        projectHistoricalPackageFiles({
          files: wrongDescFileMap,
          compilerPackage: COMPILER_PACKAGE,
          currentVersion,
          historicalVersion: HISTORICAL_PRODUCER_VERSION,
          retainedLegal,
        })
      ).toThrow(/Current descriptor producer mismatch/);

      const currentSentence = `Generated by \`${COMPILER_PACKAGE}\` (${currentVersion}).`;
      const noSentenceMap = withMutatedFile(
        base,
        "README.md",
        base.get("README.md")!.replace(currentSentence, "Generated by custom tool."),
        { syncRow: true }
      );
      expect(() =>
        projectHistoricalPackageFiles({
          files: noSentenceMap,
          compilerPackage: COMPILER_PACKAGE,
          currentVersion,
          historicalVersion: HISTORICAL_PRODUCER_VERSION,
          retainedLegal,
        })
      ).toThrow(/Expected README producer sentence once, found 0/);

      const dupSentenceMap = withMutatedFile(
        base,
        "README.md",
        base.get("README.md")! + `\n${currentSentence}\n`,
        { syncRow: true }
      );
      expect(() =>
        projectHistoricalPackageFiles({
          files: dupSentenceMap,
          compilerPackage: COMPILER_PACKAGE,
          currentVersion,
          historicalVersion: HISTORICAL_PRODUCER_VERSION,
          retainedLegal,
        })
      ).toThrow(/Expected README producer sentence once, found 2/);
    });

    it("validates retained baseline legal fixtures and fails closed on tampered buffers, cross-example drift, or manifest mismatch", () => {
      const tamperedBoth = readRetainedLegalBuffers();
      const driftedNotice = Buffer.from(
        tamperedBoth["stellar-cyan"].NOTICE.toString("utf8").replace("Notice", "notice"),
        "utf8"
      );
      tamperedBoth["stellar-cyan"].NOTICE = driftedNotice;
      tamperedBoth["amber-forge"].NOTICE = driftedNotice;
      expect(() => assertRetainedLegal(manifest, COMPILER_PACKAGE, tamperedBoth)).toThrow(
        /Retained legal fixture byte\/hash mismatch/
      );

      const crossExampleDrift = readRetainedLegalBuffers();
      crossExampleDrift["amber-forge"].NOTICE = driftedNotice;
      expect(() => assertRetainedLegal(manifest, COMPILER_PACKAGE, crossExampleDrift)).toThrow(
        /differs between stellar-cyan and amber-forge/
      );

      const badVerManifest = structuredClone(manifest);
      badVerManifest.baselineSource.version = "0.4.0";
      expect(() =>
        assertRetainedLegal(badVerManifest, COMPILER_PACKAGE, readRetainedLegalBuffers())
      ).toThrow(/Saved baseline manifest version mismatch/);

      const badPkgManifest = structuredClone(manifest);
      badPkgManifest.baselineSource.package = "other-pkg";
      expect(() =>
        assertRetainedLegal(badPkgManifest, COMPILER_PACKAGE, readRetainedLegalBuffers())
      ).toThrow(/Saved baseline manifest package mismatch/);

      const badRowManifest = structuredClone(manifest);
      badRowManifest.examples["stellar-cyan"].packageFiles.NOTICE.byteLength = 608;
      expect(() =>
        assertRetainedLegal(badRowManifest, COMPILER_PACKAGE, readRetainedLegalBuffers())
      ).toThrow(/Saved baseline manifest legal row mismatch/);
    });
  });
});
