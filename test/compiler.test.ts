import { describe, expect, it } from "vitest";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { compileTheme } from "../src/compiler/index.js";
import { canonicalizeSpecification, computeSha256 } from "../src/compiler/canonical.js";
import { validateThemeSpecification } from "../src/schema/validator.js";


describe("Theme Compiler", () => {
  it("compiles stellar-cyan deterministically", async () => {
    const cyanPath = resolve(__dirname, "../examples/stellar-cyan.theme.json");
    const cyanContent = JSON.parse(await readFile(cyanPath, "utf8"));

    const run1 = compileTheme(cyanContent);
    const run2 = compileTheme(cyanContent);

    expect(run1.inputDigest).toBe(run2.inputDigest);
    expect(run1.outputDigest).toBe(run2.outputDigest);
    expect(run1.css).toBe(run2.css);
    expect(computeSha256(run1.css)).toBe(run1.outputDigest);
    expect(run1.descriptor.outputDigest).toBe(run1.outputDigest);
  });

  it("produces identical digest regardless of object key order or uppercase hex", () => {
    const spec1 = {
      name: "order-test",
      version: "1.0.0",
      schemaVersion: "tfsl.theme-v1",
      adapter: "starlight-v0.42",
      layout: { contentWidth: "45rem", sidebarWidth: "18rem" },
      typography: { bodyFont: "system-sans", codeFont: "system-mono" },
      colors: {
        dark: {
          accent: { base: "#00d2ff", low: "#082b40", high: "#b8f2ff" },
          neutrals: {
            bg: "#090e17", bgNav: "#0d1522", bgSidebar: "#090e17",
            bgInlineCode: "#131d2e", bgAccent: "#00d2ff", text: "#e6f1ff",
            textAccent: "#00d2ff", textInvert: "#090e17", hairline: "#1c2b42",
            hairlineLight: "#2c4263", hairlineShade: "#0a101b"
          },
          grays: {
            gray1: "#e6f1ff", gray2: "#c4d7ed", gray3: "#8ea5c4",
            gray4: "#546b8a", gray5: "#2c4263", gray6: "#162438", gray7: "#0d1522"
          }
        },
        light: {
          accent: { base: "#0077aa", low: "#e0f6ff", high: "#004d70" },
          neutrals: {
            bg: "#f5f9fc", bgNav: "#ffffff", bgSidebar: "#f5f9fc",
            bgInlineCode: "#e8f1f8", bgAccent: "#0077aa", text: "#0d1522",
            textAccent: "#0077aa", textInvert: "#ffffff", hairline: "#d2dfed",
            hairlineLight: "#e6f0fa", hairlineShade: "#b8ccdf"
          },
          grays: {
            gray1: "#0d1522", gray2: "#24354d", gray3: "#4b6280",
            gray4: "#7b94b2", gray5: "#b0c5dd", gray6: "#dce7f3", gray7: "#f0f5fa"
          }
        }
      }
    };

    // Rearrange keys and use uppercase hex
    const spec2 = {
      schemaVersion: "tfsl.theme-v1",
      adapter: "starlight-v0.42",
      version: "1.0.0",
      name: "order-test",
      colors: {
        light: {
          grays: {
            gray7: "#F0F5FA", gray6: "#DCE7F3", gray5: "#B0C5DD",
            gray4: "#7B94B2", gray3: "#4B6280", gray2: "#24354D", gray1: "#0D1522"
          },
          neutrals: {
            hairlineShade: "#B8CCDF", hairlineLight: "#E6F0FA", hairline: "#D2DFED",
            textInvert: "#FFFFFF", textAccent: "#0077AA", text: "#0D1522",
            bgAccent: "#0077AA", bgInlineCode: "#E8F1F8", bgSidebar: "#F5F9FC",
            bgNav: "#FFFFFF", bg: "#F5F9FC"
          },
          accent: { high: "#004D70", low: "#E0F6FF", base: "#0077AA" }
        },
        dark: {
          grays: {
            gray7: "#0D1522", gray6: "#162438", gray5: "#2C4263",
            gray4: "#546B8A", gray3: "#8EA5C4", gray2: "#C4D7ED", gray1: "#E6F1FF"
          },
          neutrals: {
            hairlineShade: "#0A101B", hairlineLight: "#2C4263", hairline: "#1C2B42",
            textInvert: "#090E17", textAccent: "#00D2FF", text: "#E6F1FF",
            bgAccent: "#00D2FF", bgInlineCode: "#131D2E", bgSidebar: "#090E17",
            bgNav: "#0D1522", bg: "#090E17"
          },
          accent: { high: "#B8F2FF", low: "#082B40", base: "#00D2FF" }
        }
      },
      typography: { codeFont: "system-mono", bodyFont: "system-sans" },
      layout: { sidebarWidth: "18rem", contentWidth: "45rem" }
    };

    const res1 = compileTheme(spec1);
    const res2 = compileTheme(spec2);

    expect(res1.inputDigest).toBe(res2.inputDigest);
    expect(res1.outputDigest).toBe(res2.outputDigest);
    expect(res1.css).toBe(res2.css);
  });

  it("produces distinctly different outputs for contrasting themes", async () => {
    const cyanPath = resolve(__dirname, "../examples/stellar-cyan.theme.json");
    const amberPath = resolve(__dirname, "../examples/amber-forge.theme.json");

    const cyan = compileTheme(JSON.parse(await readFile(cyanPath, "utf8")));
    const amber = compileTheme(JSON.parse(await readFile(amberPath, "utf8")));

    expect(cyan.inputDigest).not.toBe(amber.inputDigest);
    expect(cyan.outputDigest).not.toBe(amber.outputDigest);
    expect(cyan.css).not.toBe(amber.css);

    // Check specific tokens
    expect(cyan.css).toContain("--sl-color-accent: #00d2ff;");
    expect(amber.css).toContain("--sl-color-accent: #f59e0b;");
    expect(cyan.css).toContain("--sl-content-width: 48rem;");
    expect(amber.css).toContain("--sl-content-width: 52rem;");
  });

  it("includes gray ramp and hairline tokens in compiled CSS", async () => {
    const cyanPath = resolve(__dirname, "../examples/stellar-cyan.theme.json");
    const cyan = compileTheme(JSON.parse(await readFile(cyanPath, "utf8")));

    expect(cyan.css).toContain("--sl-color-hairline: #1c2b42;");
    expect(cyan.css).toContain("--sl-color-hairline-light: #2c4263;");
    expect(cyan.css).toContain("--sl-color-hairline-shade: #0a101b;");
    expect(cyan.css).toContain("--sl-color-gray-1: #e6f1ff;");
    expect(cyan.css).toContain("--sl-color-gray-6: #162438;");
    expect(cyan.css).toContain("--sl-color-gray-7: #0d1522;");
  });

  it("generates conformant theme descriptor", async () => {
    const cyanPath = resolve(__dirname, "../examples/stellar-cyan.theme.json");
    const cyan = compileTheme(JSON.parse(await readFile(cyanPath, "utf8")));

    expect(cyan.descriptor).toMatchObject({
      schema: "tfsl.theme-descriptor-v1",
      schemaVersion: 1,
      themeSchemaVersion: "tfsl.theme-v1",
      themeName: "stellar-cyan",
      themeVersion: "0.1.0",
      adapter: "starlight-v0.42",
      inputDigest: cyan.inputDigest,
      outputDigest: cyan.outputDigest,
      cssFile: "theme.css",
      provenance: {
        categories: ["user-authored-data", "generated-syntax", "first-party-expression"],
        compiler: "@knowledge-forge-ai/theme-forge-stellar-loom",
        compilerVersion: "0.2.0",
      },
    });
  });

  it("closes public property gap with --sl-color-white and --sl-color-black", async () => {
    const cyanPath = resolve(__dirname, "../examples/stellar-cyan.theme.json");
    const cyan = compileTheme(JSON.parse(await readFile(cyanPath, "utf8")));

    // Dark scope
    expect(cyan.css).toContain("--sl-color-white: #e6f1ff;");
    expect(cyan.css).toContain("--sl-color-black: #090e17;");

    // Light scope
    expect(cyan.css).toContain("--sl-color-white: #0d1522;");
    expect(cyan.css).toContain("--sl-color-black: #f5f9fc;");
  });

  it("excludes non-executing $schema metadata from canonical inputDigest computation", async () => {
    const cyanPath = resolve(__dirname, "../examples/stellar-cyan.theme.json");
    const cyanRaw = JSON.parse(await readFile(cyanPath, "utf8"));

    const runWithoutSchema = compileTheme(cyanRaw);

    const cyanWithSchema = { ...cyanRaw, $schema: "https://example.com/starlight-theme.json" };
    const runWithSchema = compileTheme(cyanWithSchema);

    // inputDigest and outputDigest must remain bit-for-bit identical
    expect(runWithSchema.inputDigest).toBe(runWithoutSchema.inputDigest);
    expect(runWithSchema.outputDigest).toBe(runWithoutSchema.outputDigest);
    expect(runWithSchema.css).toBe(runWithoutSchema.css);
    // But $schema survives in the output specification
    expect(runWithSchema.specification.$schema).toBe("https://example.com/starlight-theme.json");
  });

  it("calculates WCAG 2.2 sRGB luminance and contrast ratios accurately", async () => {
    const { calculateContrastRatio, calculateRelativeLuminance } = await import(
      "../src/compiler/contrast.js"
    );

    // Black and white: luminance 0 and 1
    expect(calculateRelativeLuminance(0, 0, 0)).toBeCloseTo(0, 5);
    expect(calculateRelativeLuminance(255, 255, 255)).toBeCloseTo(1, 5);

    // Black on white ratio is exactly 21:1
    const bwRatio = calculateContrastRatio("#000000", "#ffffff");
    expect(bwRatio).toBeCloseTo(21.0, 3);

    // Identical colors ratio is exactly 1:1
    const sameRatio = calculateContrastRatio("#123456", "#123456");
    expect(sameRatio).toBeCloseTo(1.0, 5);
  });

  it("attaches deterministic contrast diagnostics to CompilationResult", async () => {
    const cyanPath = resolve(__dirname, "../examples/stellar-cyan.theme.json");
    const cyan = compileTheme(JSON.parse(await readFile(cyanPath, "utf8")));

    expect(cyan.diagnostics).toHaveLength(6);
    // All 6 pairs in stellar-cyan meet WCAG 2.2 AA (>= 4.5:1)
    for (const d of cyan.diagnostics) {
      expect(d.disposition).toBe("pass");
      expect(d.ratio).toBeGreaterThanOrEqual(4.5);
      expect(d.criterion).toBe("WCAG 2.2 AA");
    }
  });

  it("separates structural validation from contrast checks and enforces strictContrast", async () => {
    const { ContrastError } = await import("../src/compiler/contrast.js");
    const cyanPath = resolve(__dirname, "../examples/stellar-cyan.theme.json");
    const lowContrastTheme = JSON.parse(await readFile(cyanPath, "utf8"));

    // Make dark body text low contrast: dark gray text on dark canvas
    lowContrastTheme.colors.dark.neutrals.text = "#1a2536"; // very low contrast on #090e17

    // Default compilation reports warnings without throwing
    const normalResult = compileTheme(lowContrastTheme);
    const darkBodyDiag = normalResult.diagnostics.find(
      (d) => d.mode === "dark" && d.role === "body-text"
    );
    expect(darkBodyDiag?.disposition).toBe("warn");
    expect(darkBodyDiag?.severity).toBe("warning");

    // Strict compilation throws ContrastError (not ValidationError)
    try {
      compileTheme(lowContrastTheme, { strictContrast: true });
      expect.unreachable("Should have thrown ContrastError");
    } catch (err: any) {
      expect(err).toBeInstanceOf(ContrastError);
      expect(err.code).toBe("CONTRAST_THRESHOLD_FAILED");
      expect(err.diagnostics.some((d: any) => d.disposition === "warn")).toBe(true);
    }
  });

  it("exports library aliases matching documented API", async () => {
    const { validateTheme, canonicalizeTheme, compileTheme: compile } = await import("../src/index.js");
    const cyanPath = resolve(__dirname, "../examples/stellar-cyan.theme.json");
    const cyanContent = JSON.parse(await readFile(cyanPath, "utf8"));

    const validSpec = validateTheme(cyanContent);
    const canonical = canonicalizeTheme(validSpec);
    const compiled = compile(validSpec);

    expect(validSpec.name).toBe("stellar-cyan");
    expect(canonical.canonicalObject.name).toBe("stellar-cyan");
    expect(compiled.css).toContain(":root");
  });

  it("produces bit-for-bit identical outputs across independent processes and distinct directories", async () => {
    const cliPath = resolve(__dirname, "../bin/tfsl.js");
    const cyanPath = resolve(__dirname, "../examples/stellar-cyan.theme.json");

    const tmpDir1 = await mkdtemp(join(tmpdir(), "tfsl-proc-det-1-"));
    const tmpDir2 = await mkdtemp(join(tmpdir(), "tfsl-proc-det-2-"));
    const outDir1 = join(tmpDir1, "out1");
    const outDir2 = join(tmpDir2, "out2");

    try {
      // Process 1 executed from tmpDir1
      execFileSync("node", [cliPath, "compile", cyanPath, "--out", outDir1], {
        cwd: tmpDir1,
        stdio: "ignore",
      });

      // Process 2 executed from tmpDir2
      execFileSync("node", [cliPath, "compile", cyanPath, "--out", outDir2], {
        cwd: tmpDir2,
        stdio: "ignore",
      });

      const css1 = await readFile(join(outDir1, "theme.css"), "utf8");
      const css2 = await readFile(join(outDir2, "theme.css"), "utf8");
      expect(css1).toBe(css2);

      const desc1 = await readFile(join(outDir1, "theme.descriptor.json"), "utf8");
      const desc2 = await readFile(join(outDir2, "theme.descriptor.json"), "utf8");
      expect(desc1).toBe(desc2);
    } finally {
      await rm(tmpDir1, { recursive: true, force: true });
      await rm(tmpDir2, { recursive: true, force: true });
    }
  });
});
