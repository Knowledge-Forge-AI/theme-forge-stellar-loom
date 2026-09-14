import { describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, readdir, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCli } from "../src/cli.js";

const EXAMPLES_DIR = resolve(__dirname, "../examples");

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomBytes: vi.fn(actual.randomBytes) };
});

describe("TFSL CLI", () => {
  it.each(["css", "desc"])("preserves a preexisting %s temporary-name collision during compile overwrite", async (kind) => {
    const scratch = await mkdtemp(join(tmpdir(), "tfsl-stage-collision-"));
    const originalWrite = process.stdout.write;
    let output = "";
    process.stdout.write = ((chunk: any) => { output += chunk; return true; }) as any;
    try {
      const theme = join(EXAMPLES_DIR, "stellar-cyan.theme.json");
      expect(await runCli(["node", "tfsl", "compile", theme, "--out", scratch, "--json"])).toBe(0);
      const originalCss = await readFile(join(scratch, "theme.css"), "utf8");
      const tag = "0123456789abcdef";
      const collisionName = `.tfsl-tmp-${kind}-${tag}`;
      const collision = join(scratch, collisionName);
      await writeFile(collision, "operator-owned collision");
      vi.mocked(randomBytes).mockImplementationOnce(() => Buffer.from(tag, "hex"));
      output = "";
      expect(await runCli(["node", "tfsl", "compile", theme, "--out", scratch, "--overwrite", "--json"])).toBe(3);
      expect(JSON.parse(output).code).toBe("IO_STAGE_FAILURE");
      expect(await readFile(collision, "utf8")).toBe("operator-owned collision");
      expect(await readFile(join(scratch, "theme.css"), "utf8")).toBe(originalCss);
      expect((await readdir(scratch)).filter((name) => name.startsWith(".tfsl-tmp-"))).toEqual([collisionName]);
    } finally {
      vi.mocked(randomBytes).mockReset();
      process.stdout.write = originalWrite;
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it("prints help on --help or -h", async () => {
    let output = "";
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      output += chunk;
      return true;
    }) as any;

    try {
      const code1 = await runCli(["node", "tfsl", "--help"]);
      expect(code1).toBe(0);
      expect(output).toContain("Theme Forge Stellar Loom (TFSL) CLI");
      expect(output).toContain("Usage:");

      output = "";
      const code2 = await runCli(["node", "tfsl", "-h"]);
      expect(code2).toBe(0);
      expect(output).toContain("Theme Forge Stellar Loom (TFSL) CLI");
    } finally {
      process.stdout.write = origWrite;
    }
  });

  it("prints version on --version or -v", async () => {
    let output = "";
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      output += chunk;
      return true;
    }) as any;

    try {
      const code = await runCli(["node", "tfsl", "--version"]);
      expect(code).toBe(0);
      expect(output).toContain("@knowledge-forge-ai/theme-forge-stellar-loom 0.2.0");
    } finally {
      process.stdout.write = origWrite;
    }
  });

  it("strictly enforces argument parsing: rejects unknown, duplicate, missing, and surplus arguments", async () => {
    let errOutput = "";
    const origErr = process.stderr.write;
    process.stderr.write = ((chunk: any) => {
      errOutput += chunk;
      return true;
    }) as any;

    const themePath = join(EXAMPLES_DIR, "stellar-cyan.theme.json");

    try {
      // 1. Unknown option -> exit 2
      const codeUnknown = await runCli(["node", "tfsl", "validate", themePath, "--bogus-flag"]);
      expect(codeUnknown).toBe(2);
      expect(errOutput).toContain("Unknown option: '--bogus-flag'");

      // 2. Duplicate option -> exit 2
      errOutput = "";
      const codeDuplicate = await runCli([
        "node",
        "tfsl",
        "compile",
        themePath,
        "--out",
        "/tmp/dir1",
        "--out",
        "/tmp/dir2",
      ]);
      expect(codeDuplicate).toBe(2);
      expect(errOutput).toContain("Duplicate option: --out");

      // 3. Missing option value -> exit 2
      errOutput = "";
      const codeMissing = await runCli(["node", "tfsl", "compile", themePath, "--out"]);
      expect(codeMissing).toBe(2);
      expect(errOutput).toContain("Missing value for option: --out <dir>");

      // 4. Surplus operand -> exit 2
      errOutput = "";
      const codeSurplus = await runCli(["node", "tfsl", "validate", themePath, "extra-file.json"]);
      expect(codeSurplus).toBe(2);
      expect(errOutput).toContain("Unexpected surplus operand: 'extra-file.json'");
    } finally {
      process.stderr.write = origErr;
    }
  });

  it("validates a valid theme file", async () => {
    let output = "";
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      output += chunk;
      return true;
    }) as any;

    try {
      const themePath = join(EXAMPLES_DIR, "stellar-cyan.theme.json");
      const code = await runCli(["node", "tfsl", "validate", themePath]);
      expect(code).toBe(0);
      expect(output).toContain("OK: theme 'stellar-cyan' v0.1.0 is valid");
      expect(output).toContain("input digest:");
    } finally {
      process.stdout.write = origWrite;
    }
  });

  it("fails validation on invalid theme file with exit code 1", async () => {
    let errOutput = "";
    const origErr = process.stderr.write;
    process.stderr.write = ((chunk: any) => {
      errOutput += chunk;
      return true;
    }) as any;

    const tmpDir = await mkdtemp(join(tmpdir(), "tfsl-test-val-"));
    try {
      const badPath = join(tmpDir, "bad.theme.json");
      await writeFile(badPath, JSON.stringify({ name: "bad", schemaVersion: "unknown" }));
      const code = await runCli(["node", "tfsl", "validate", badPath]);
      expect(code).toBe(1);
      expect(errOutput).toContain("Validation failed");
    } finally {
      process.stderr.write = origErr;
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("supports --json mode on validate and compile without progress prose", async () => {
    let output = "";
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      output += chunk;
      return true;
    }) as any;

    const tmpDir = await mkdtemp(join(tmpdir(), "tfsl-test-json-"));
    try {
      const themePath = join(EXAMPLES_DIR, "stellar-cyan.theme.json");

      // Validate in JSON mode
      const valCode = await runCli(["node", "tfsl", "validate", themePath, "--json"]);
      expect(valCode).toBe(0);
      const valJson = JSON.parse(output);
      expect(valJson.status).toBe("success");
      expect(valJson.command).toBe("validate");
      expect(valJson.theme).toBe("stellar-cyan");
      expect(Array.isArray(valJson.diagnostics)).toBe(true);

      output = "";
      // Compile in JSON mode
      const outDir = join(tmpDir, "json-out");
      const compCode = await runCli(["node", "tfsl", "compile", themePath, "--out", outDir, "--json"]);
      expect(compCode).toBe(0);
      const compJson = JSON.parse(output);
      expect(compJson.status).toBe("success");
      expect(compJson.command).toBe("compile");
      expect(compJson.theme).toBe("stellar-cyan");
      expect(compJson.cssPath).toBe(join(outDir, "theme.css"));
      expect(compJson.descriptorPath).toBe(join(outDir, "theme.descriptor.json"));
      expect(compJson.outputDigest).toBeDefined();
    } finally {
      process.stdout.write = origWrite;
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("fails with exit code 1 under --strict-contrast when contrast threshold is not met", async () => {
    let errOutput = "";
    const origErr = process.stderr.write;
    process.stderr.write = ((chunk: any) => {
      errOutput += chunk;
      return true;
    }) as any;

    const tmpDir = await mkdtemp(join(tmpdir(), "tfsl-test-strict-"));
    try {
      const cyanContent = JSON.parse(await readFile(join(EXAMPLES_DIR, "stellar-cyan.theme.json"), "utf8"));
      // Degrade contrast
      cyanContent.colors.dark.neutrals.text = "#111822";
      const badContrastFile = join(tmpDir, "low-contrast.theme.json");
      await writeFile(badContrastFile, JSON.stringify(cyanContent));

      const code = await runCli(["node", "tfsl", "validate", badContrastFile, "--strict-contrast"]);
      expect(code).toBe(1);
      expect(errOutput).toContain("Contrast check failed (--strict-contrast enabled)");
    } finally {
      process.stderr.write = origErr;
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("compiles theme to destination directory and writes theme.css and descriptor", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "tfsl-test-compile-"));
    const outDir = join(tmpDir, "output");

    try {
      const themePath = join(EXAMPLES_DIR, "stellar-cyan.theme.json");
      const code = await runCli(["node", "tfsl", "compile", themePath, "--out", outDir]);
      expect(code).toBe(0);

      const files = await readdir(outDir);
      expect(files.sort()).toEqual(["theme.css", "theme.descriptor.json"]);

      const css = await readFile(join(outDir, "theme.css"), "utf8");
      expect(css).toContain("--sl-color-accent: #00d2ff;");
      expect(css).toContain("--sl-color-white: #e6f1ff;");
      expect(css).toContain("--sl-color-black: #090e17;");

      const desc = JSON.parse(await readFile(join(outDir, "theme.descriptor.json"), "utf8"));
      expect(desc.schema).toBe("tfsl.theme-descriptor-v1");
      expect(desc.themeName).toBe("stellar-cyan");
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("refuses to write into non-empty directory without --overwrite (exit code 3)", async () => {
    let errOutput = "";
    const origErr = process.stderr.write;
    process.stderr.write = ((chunk: any) => {
      errOutput += chunk;
      return true;
    }) as any;

    const tmpDir = await mkdtemp(join(tmpdir(), "tfsl-test-clobber-"));
    try {
      await writeFile(join(tmpDir, "unrelated.txt"), "precious data");
      const themePath = join(EXAMPLES_DIR, "stellar-cyan.theme.json");

      const code = await runCli(["node", "tfsl", "compile", themePath, "--out", tmpDir]);
      expect(code).toBe(3);
      expect(errOutput).toContain("Refusing to write into non-empty directory");

      // Verify the unrelated file was not deleted or modified
      const content = await readFile(join(tmpDir, "unrelated.txt"), "utf8");
      expect(content).toBe("precious data");
    } finally {
      process.stderr.write = origErr;
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("refuses overwrite if existing theme.css has been manually modified (exit code 3)", async () => {
    let errOutput = "";
    const origErr = process.stderr.write;
    process.stderr.write = ((chunk: any) => {
      errOutput += chunk;
      return true;
    }) as any;

    const tmpDir = await mkdtemp(join(tmpdir(), "tfsl-test-manual-edit-"));
    try {
      const themePath = join(EXAMPLES_DIR, "stellar-cyan.theme.json");

      // 1. Initial compile
      const code1 = await runCli(["node", "tfsl", "compile", themePath, "--out", tmpDir]);
      expect(code1).toBe(0);

      // 2. Tamper with generated theme.css
      await writeFile(join(tmpDir, "theme.css"), "/* user manual edit */ :root { color: red; }");

      // 3. Recompile with --overwrite: must detect digest mismatch and refuse with exit code 3!
      errOutput = "";
      const code2 = await runCli([
        "node",
        "tfsl",
        "compile",
        themePath,
        "--out",
        tmpDir,
        "--overwrite",
      ]);
      expect(code2).toBe(3);
      expect(errOutput).toContain("Refusing to overwrite manually edited theme.css");

      // Verify manual edit was preserved
      const content = await readFile(join(tmpDir, "theme.css"), "utf8");
      expect(content).toBe("/* user manual edit */ :root { color: red; }");
    } finally {
      process.stderr.write = origErr;
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("refuses overwrite if target directory or files are symbolic links (exit code 3)", async () => {
    let errOutput = "";
    const origErr = process.stderr.write;
    process.stderr.write = ((chunk: any) => {
      errOutput += chunk;
      return true;
    }) as any;

    const tmpDir = await mkdtemp(join(tmpdir(), "tfsl-test-symlink-"));
    try {
      const realTargetDir = join(tmpDir, "real-target");
      const symlinkDir = join(tmpDir, "symlink-target");
      await mkdir(realTargetDir, { recursive: true });
      await symlink(realTargetDir, symlinkDir);

      const themePath = join(EXAMPLES_DIR, "stellar-cyan.theme.json");

      // Refuse symlinked directory
      const code = await runCli(["node", "tfsl", "compile", themePath, "--out", symlinkDir]);
      expect(code).toBe(3);
      expect(errOutput).toContain("is a symbolic link. Symlinks are strictly refused");

      // Refuse traversal through symlinked directory
      const nestedSymlinkDir = join(symlinkDir, "nested-sub");
      const codeNested = await runCli(["node", "tfsl", "compile", themePath, "--out", nestedSymlinkDir]);
      expect(codeNested).toBe(3);
      expect(errOutput).toContain("traverses symbolic link");
    } finally {
      process.stderr.write = origErr;
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("refuses input/output aliasing collisions (exit code 3)", async () => {
    let errOutput = "";
    const origErr = process.stderr.write;
    process.stderr.write = ((chunk: any) => {
      errOutput += chunk;
      return true;
    }) as any;

    const tmpDir = await mkdtemp(join(tmpdir(), "tfsl-test-alias-"));
    try {
      // Create theme file named theme.css inside directory
      const themePath = join(tmpDir, "theme.css");
      const validSpec = await readFile(join(EXAMPLES_DIR, "stellar-cyan.theme.json"), "utf8");
      await writeFile(themePath, validSpec);

      const code = await runCli(["node", "tfsl", "compile", themePath, "--out", tmpDir, "--overwrite"]);
      expect(code).toBe(3);
      expect(errOutput).toContain("Refusing to overwrite input theme file");
    } finally {
      process.stderr.write = origErr;
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles null or malformed descriptor JSON in compile overwrite without crashing", async () => {
    let outJson = "";
    const origOut = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      outJson += chunk;
      return true;
    }) as any;

    const tmpDir = await mkdtemp(join(tmpdir(), "tfsl-test-null-desc-"));
    try {
      const themePath = join(EXAMPLES_DIR, "stellar-cyan.theme.json");
      const targetCss = join(tmpDir, "theme.css");
      const targetDesc = join(tmpDir, "theme.descriptor.json");

      // Write valid CSS and "null" as descriptor
      await writeFile(targetCss, "/* original */", "utf8");
      await writeFile(targetDesc, "null", "utf8");

      const code = await runCli(["node", "tfsl", "compile", themePath, "--out", tmpDir, "--overwrite", "--json"]);
      expect(code).toBe(3);
      const parsed = JSON.parse(outJson);
      expect(parsed.status).toBe("error");
      expect(parsed.code).toBe("CORRUPT_DESCRIPTOR");

      // Verify original CSS was untouched
      const cssContent = await readFile(targetCss, "utf8");
      expect(cssContent).toBe("/* original */");

      // Also test array as descriptor
      outJson = "";
      await writeFile(targetDesc, "[1, 2, 3]", "utf8");
      const codeArr = await runCli(["node", "tfsl", "compile", themePath, "--out", tmpDir, "--overwrite", "--json"]);
      expect(codeArr).toBe(3);
      const parsedArr = JSON.parse(outJson);
      expect(parsedArr.code).toBe("CORRUPT_DESCRIPTOR");
    } finally {
      process.stdout.write = origOut;
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles early filesystem errors with structured JSON exit code 3", async () => {
    let outJson = "";
    const origOut = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      outJson += chunk;
      return true;
    }) as any;

    const tmpDir = await mkdtemp(join(tmpdir(), "tfsl-test-early-fs-"));
    try {
      const themePath = join(EXAMPLES_DIR, "stellar-cyan.theme.json");
      const unreadableDir = join(tmpDir, "unreadable");
      await mkdir(unreadableDir, { recursive: true });
      const { chmod } = await import("node:fs/promises");
      await chmod(unreadableDir, 0o000);

      const code = await runCli(["node", "tfsl", "compile", themePath, "--out", unreadableDir, "--overwrite", "--json"]);
      expect(code).toBe(3);
      const parsed = JSON.parse(outJson);
      expect(parsed.status).toBe("error");
      expect(parsed.code).toBe("OUTPUT_FS_ERROR");

      // Reset permissions so cleanup succeeds
      await chmod(unreadableDir, 0o755);
    } finally {
      process.stdout.write = origOut;
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  describe("tfsl generate subcommand", () => {
    it("strictly requires --package and --out flags (exit code 2)", async () => {
      const themePath = join(EXAMPLES_DIR, "stellar-cyan.theme.json");

      const code1 = await runCli(["node", "tfsl", "generate", themePath]);
      expect(code1).toBe(2);

      const code2 = await runCli(["node", "tfsl", "generate", themePath, "--package", "pkg.json"]);
      expect(code2).toBe(2);

      const code3 = await runCli(["node", "tfsl", "generate", themePath, "--out", "out-dir"]);
      expect(code3).toBe(2);
    });

    it("rejects unknown or invalid options (exit code 2)", async () => {
      const themePath = join(EXAMPLES_DIR, "stellar-cyan.theme.json");
      const code = await runCli([
        "node",
        "tfsl",
        "generate",
        themePath,
        "--package",
        "pkg.json",
        "--out",
        "out-dir",
        "--unknown-flag",
      ]);
      expect(code).toBe(2);
    });

    it("generates theme package successfully with human and --json output (exit code 0)", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "tfsl-cli-gen-"));
      const pkgJsonPath = join(tmpDir, "package-meta.json");
      const outDir = join(tmpDir, "generated-package");

      await writeFile(
        pkgJsonPath,
        JSON.stringify({
          name: "starlight-theme-cyan-cli",
          version: "0.1.0",
          description: "Stellar Cyan Theme generated via CLI",
        }),
        "utf8"
      );

      let outJson = "";
      const origOut = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        outJson += chunk;
        return true;
      }) as any;

      try {
        const themePath = join(EXAMPLES_DIR, "stellar-cyan.theme.json");
        const code = await runCli([
          "node",
          "tfsl",
          "generate",
          themePath,
          "--package",
          pkgJsonPath,
          "--out",
          outDir,
          "--json",
        ]);

        expect(code).toBe(0);
        const parsed = JSON.parse(outJson);
        expect(parsed.status).toBe("success");
        expect(parsed.command).toBe("generate");
        expect(parsed.packageName).toBe("starlight-theme-cyan-cli");
        expect(parsed.packageVersion).toBe("0.1.0");
        expect(parsed.filesWritten).toContain("package.json");
        expect(parsed.filesWritten).toContain("index.js");
        expect(parsed.filesWritten).toContain("styles/theme.css");
        expect(parsed.filesPruned).toEqual([]);
        expect(Array.isArray(parsed.diagnostics)).toBe(true);

        const writtenPkgJson = JSON.parse(await readFile(join(outDir, "package.json"), "utf8"));
        expect(writtenPkgJson.name).toBe("starlight-theme-cyan-cli");
        expect(writtenPkgJson.peerDependencies["@astrojs/starlight"]).toBe("^0.42.0");
      } finally {
        process.stdout.write = origOut;
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("generates package with --template page-title-frame (exit code 0)", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "tfsl-cli-gen-tmpl-"));
      const pkgJsonPath = join(tmpDir, "package-meta.json");
      const outDir = join(tmpDir, "amber-package");

      await writeFile(
        pkgJsonPath,
        JSON.stringify({
          name: "starlight-theme-amber-cli",
          version: "0.1.0",
        }),
        "utf8"
      );

      try {
        const themePath = join(EXAMPLES_DIR, "amber-forge.theme.json");
        const code = await runCli([
          "node",
          "tfsl",
          "generate",
          themePath,
          "--package",
          pkgJsonPath,
          "--out",
          outDir,
          "--template",
          "page-title-frame",
        ]);

        expect(code).toBe(0);
        const componentContent = await readFile(
          join(outDir, "components/PageTitleFrame.astro"),
          "utf8"
        );
        expect(componentContent).toContain("class=\"tfsl-page-title-frame\"");
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("refuses to generate into non-empty directory (exit code 3)", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "tfsl-cli-gen-safety-"));
      const pkgJsonPath = join(tmpDir, "package-meta.json");
      const outDir = join(tmpDir, "non-empty-target");
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, "existing.txt"), "keep me", "utf8");

      await writeFile(
        pkgJsonPath,
        JSON.stringify({
          name: "starlight-theme-safety",
          version: "0.1.0",
        }),
        "utf8"
      );

      try {
        const themePath = join(EXAMPLES_DIR, "stellar-cyan.theme.json");
        const code = await runCli([
          "node",
          "tfsl",
          "generate",
          themePath,
          "--package",
          pkgJsonPath,
          "--out",
          outDir,
        ]);

        expect(code).toBe(3);
        // Existing file preserved untouched
        const existingContent = await readFile(join(outDir, "existing.txt"), "utf8");
        expect(existingContent).toBe("keep me");
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("rejects --overwrite option in generate with exit code 2 in both human and json modes", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "tfsl-cli-gen-overwrite-"));
      const pkgJsonPath = join(tmpDir, "package-meta.json");
      const outDir = join(tmpDir, "out-package");

      await writeFile(
        pkgJsonPath,
        JSON.stringify({
          name: "starlight-theme-overwrite-reject",
          version: "0.1.0",
        }),
        "utf8"
      );

      const themePath = join(EXAMPLES_DIR, "stellar-cyan.theme.json");

      // 1. Human mode
      let errOutput = "";
      const origErr = process.stderr.write;
      process.stderr.write = ((chunk: any) => {
        errOutput += chunk;
        return true;
      }) as any;

      try {
        const code = await runCli([
          "node",
          "tfsl",
          "generate",
          themePath,
          "--package",
          pkgJsonPath,
          "--out",
          outDir,
          "--overwrite",
        ]);
        expect(code).toBe(2);
        expect(errOutput).toContain("--overwrite is not supported for generate");
      } finally {
        process.stderr.write = origErr;
      }

      // 2. JSON mode
      let jsonOutput = "";
      const origOut = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        jsonOutput += chunk;
        return true;
      }) as any;

      try {
        const code = await runCli([
          "node",
          "tfsl",
          "generate",
          themePath,
          "--package",
          pkgJsonPath,
          "--out",
          outDir,
          "--overwrite",
          "--json",
        ]);
        expect(code).toBe(2);
        const parsed = JSON.parse(jsonOutput);
        expect(parsed.status).toBe("error");
        expect(parsed.command).toBe("generate");
        expect(parsed.code).toBe("INVALID_ARGUMENTS");
        expect(parsed.message).toContain("--overwrite is not supported for generate");
      } finally {
        process.stdout.write = origOut;
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("emits contrast diagnostics in --json mode and contrast warnings to stderr in human mode on generate", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "tfsl-cli-gen-diag-"));
      const pkgJsonPath = join(tmpDir, "package-meta.json");
      const lowContrastThemePath = join(tmpDir, "low-contrast.theme.json");
      const outDirJson = join(tmpDir, "out-json");
      const outDirHuman = join(tmpDir, "out-human");

      await writeFile(
        pkgJsonPath,
        JSON.stringify({
          name: "starlight-theme-diag",
          version: "0.1.0",
        }),
        "utf8"
      );

      // Construct a valid theme with low contrast
      const validTheme = JSON.parse(await readFile(join(EXAMPLES_DIR, "stellar-cyan.theme.json"), "utf8"));
      validTheme.name = "low-contrast-cli";
      validTheme.colors.dark.neutrals.text = "#111111"; // low contrast on dark bg
      validTheme.colors.dark.neutrals.bg = "#000000";
      await writeFile(lowContrastThemePath, JSON.stringify(validTheme, null, 2), "utf8");

      // Test JSON mode
      let jsonOutput = "";
      const origOut = process.stdout.write;
      process.stdout.write = ((chunk: any) => {
        jsonOutput += chunk;
        return true;
      }) as any;

      try {
        const code = await runCli([
          "node",
          "tfsl",
          "generate",
          lowContrastThemePath,
          "--package",
          pkgJsonPath,
          "--out",
          outDirJson,
          "--json",
        ]);
        expect(code).toBe(0);
        const parsed = JSON.parse(jsonOutput);
        expect(parsed.status).toBe("success");
        expect(Array.isArray(parsed.diagnostics)).toBe(true);
        expect(parsed.diagnostics.length).toBeGreaterThan(0);
        expect(parsed.diagnostics.some((d: any) => d.code === "CONTRAST_BELOW_THRESHOLD")).toBe(true);
      } finally {
        process.stdout.write = origOut;
      }

      // Test Human mode
      let errOutput = "";
      const origErr = process.stderr.write;
      process.stderr.write = ((chunk: any) => {
        errOutput += chunk;
        return true;
      }) as any;

      try {
        const code = await runCli([
          "node",
          "tfsl",
          "generate",
          lowContrastThemePath,
          "--package",
          pkgJsonPath,
          "--out",
          outDirHuman,
        ]);
        expect(code).toBe(0);
        expect(errOutput).toContain("Warning [CONTRAST_BELOW_THRESHOLD]:");
      } finally {
        process.stderr.write = origErr;
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("fails with exit code 1 under --strict-contrast on generate and writes no files", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "tfsl-cli-gen-strict-"));
      const pkgJsonPath = join(tmpDir, "package-meta.json");
      const lowContrastThemePath = join(tmpDir, "low-contrast.theme.json");
      const outDir = join(tmpDir, "out-strict");

      await writeFile(
        pkgJsonPath,
        JSON.stringify({
          name: "starlight-theme-strict",
          version: "0.1.0",
        }),
        "utf8"
      );

      const validTheme = JSON.parse(await readFile(join(EXAMPLES_DIR, "stellar-cyan.theme.json"), "utf8"));
      validTheme.name = "low-contrast-strict";
      validTheme.colors.dark.neutrals.text = "#111111";
      validTheme.colors.dark.neutrals.bg = "#000000";
      await writeFile(lowContrastThemePath, JSON.stringify(validTheme, null, 2), "utf8");

      let errOutput = "";
      const origErr = process.stderr.write;
      process.stderr.write = ((chunk: any) => {
        errOutput += chunk;
        return true;
      }) as any;

      try {
        const code = await runCli([
          "node",
          "tfsl",
          "generate",
          lowContrastThemePath,
          "--package",
          pkgJsonPath,
          "--out",
          outDir,
          "--strict-contrast",
        ]);
        expect(code).toBe(1);
        expect(errOutput).toContain("Contrast check failed (--strict-contrast enabled)");
        // No output directory or files created
        const exists = await readFile(join(outDir, "package.json")).then(() => true).catch(() => false);
        expect(exists).toBe(false);
      } finally {
        process.stderr.write = origErr;
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("rejects duplicate options, unknown options, and surplus operands in generate (exit code 2)", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "tfsl-cli-gen-opts-"));
      const pkgJsonPath = join(tmpDir, "package-meta.json");
      const outDir = join(tmpDir, "out-opts");
      const themePath = join(EXAMPLES_DIR, "stellar-cyan.theme.json");

      await writeFile(
        pkgJsonPath,
        JSON.stringify({ name: "starlight-theme-opts", version: "0.1.0" }),
        "utf8"
      );

      try {
        // Duplicate --package
        let errOutput = "";
        const origErr = process.stderr.write;
        process.stderr.write = ((chunk: any) => {
          errOutput += chunk;
          return true;
        }) as any;

        try {
          const code1 = await runCli([
            "node",
            "tfsl",
            "generate",
            themePath,
            "--package",
            pkgJsonPath,
            "--package",
            pkgJsonPath,
            "--out",
            outDir,
          ]);
          expect(code1).toBe(2);
          expect(errOutput).toContain("Duplicate option: --package");

          // Unknown option
          errOutput = "";
          const code2 = await runCli([
            "node",
            "tfsl",
            "generate",
            themePath,
            "--package",
            pkgJsonPath,
            "--out",
            outDir,
            "--unsupported-flag",
          ]);
          expect(code2).toBe(2);
          expect(errOutput).toContain("Unknown option: '--unsupported-flag'");

          // Surplus operand
          errOutput = "";
          const code3 = await runCli([
            "node",
            "tfsl",
            "generate",
            themePath,
            "extra-operand",
            "--package",
            pkgJsonPath,
            "--out",
            outDir,
          ]);
          expect(code3).toBe(2);
          expect(errOutput).toContain("Unexpected surplus operand: 'extra-operand'");
        } finally {
          process.stderr.write = origErr;
        }
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("rejects input/output collision when output directory matches theme or package path (exit code 3)", async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "tfsl-cli-gen-collision-"));
      const pkgJsonPath = join(tmpDir, "package-meta.json");
      const themePath = join(tmpDir, "theme.json");

      await writeFile(
        pkgJsonPath,
        JSON.stringify({ name: "starlight-theme-collision", version: "0.1.0" }),
        "utf8"
      );
      await writeFile(
        themePath,
        await readFile(join(EXAMPLES_DIR, "stellar-cyan.theme.json"), "utf8")
      );

      let errOutput = "";
      const origErr = process.stderr.write;
      process.stderr.write = ((chunk: any) => {
        errOutput += chunk;
        return true;
      }) as any;

      try {
        // Output directory is the same as theme.json path
        const code = await runCli([
          "node",
          "tfsl",
          "generate",
          themePath,
          "--package",
          pkgJsonPath,
          "--out",
          themePath,
        ]);
        expect(code).toBe(3);
        expect(errOutput).toContain("Refusing to overwrite input files as output destination");
      } finally {
        process.stderr.write = origErr;
        await rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
