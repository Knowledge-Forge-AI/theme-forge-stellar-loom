import { qualifiedSourceDigest } from "./recovery-source-qualification.js";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  STARLIGHT_CORE_CATALOG_V1,
  verifyCatalogDigest,
  computeCatalogDigest,
  CATALOG_DIGEST,
  CATALOG_IDENTITY as CORE_CATALOG_IDENTITY,
  COMPILER_SEMANTIC as CORE_COMPILER_SEMANTIC,
  compileThemeV2,
  canonicalizeThemeV2,
} from "../src/v2/index.js";
import {
  validateThemeCode,
  canonicalizeThemeCode,
  compileThemeCode,
  isThemeCode,
  createCodeDefaults,
  CODE_CATALOG_IDENTITY,
  CODE_CATALOG_DIGEST,
  CODE_COMPILER_SEMANTIC,
  STARLIGHT_CODE_CATALOG_V1,
  computeCodeCatalogDigest,
  verifyCodeCatalogDigest,
  CODE_CSS_EXPRESSION,
  CODE_STYLE_FILES,
  ValidationErrorV2,
  type ThemeSpecificationCode,
  type CodePresentationConfig,
} from "../src/code/index.js";

function getBlackCoreJson(): any {
  return JSON.parse(
    readFileSync(resolve(__dirname, "../examples/loom-black-core.theme.json"), "utf8")
  );
}

function getFlexokiCoreJson(): any {
  return JSON.parse(
    readFileSync(resolve(__dirname, "../examples/loom-flexoki-core.theme.json"), "utf8")
  );
}

function getCelestiaCoreJson(): any {
  return JSON.parse(
    readFileSync(resolve(__dirname, "../examples/loom-celestia-core.theme.json"), "utf8")
  );
}

function createValidCodePresentation(): CodePresentationConfig {
  return {
    mode: "expressive-code",
    syntaxTheme: {
      light: {
        rules: [
          {
            scopes: ["comment", "punctuation.definition.comment"],
            foreground: "#64748b",
            fontStyle: "italic",
          },
          {
            scopes: ["keyword", "storage.type"],
            foreground: "#ea580c",
            fontStyle: "bold",
          },
          {
            scopes: ["string", "string.quoted"],
            foreground: "#16a34a",
          },
        ],
      },
      dark: {
        rules: [
          {
            scopes: ["comment", "punctuation.definition.comment"],
            foreground: "#8a92a6",
            fontStyle: "italic",
          },
          {
            scopes: ["keyword", "storage.type"],
            foreground: "#f97316",
            fontStyle: "bold",
          },
          {
            scopes: ["string", "string.quoted"],
            foreground: "#4ade80",
          },
        ],
      },
    },
    frame: "editor",
    marks: {
      marked: "#3b82f6",
      inserted: "#22c55e",
      deleted: "#ef4444",
    },
    copy: "standard",
    tabs: "deferred",
  };
}

function createValidCodeSpec(): ThemeSpecificationCode {
  const base = getBlackCoreJson();
  return {
    ...base,
    codePresentation: createValidCodePresentation(),
  };
}

describe("TFSB61B Code Domain & Expressive Code Compiler", () => {
  describe("Core Pin Invariance & Isolation", () => {
    it("preserves unchanged core catalog identity, digest, and verification", () => {
      expect(CORE_CATALOG_IDENTITY).toBe("tfsl.starlight-core-catalog-v1");
      expect(CORE_COMPILER_SEMANTIC).toBe("tfsl.theme-compiler-v2-core-1");
      expect(verifyCatalogDigest()).toBe(true);
      expect(computeCatalogDigest()).toBe(CATALOG_DIGEST);
    });

    it("binds core source to historical pins or exact qualified security amendments", () => {
      for (const [path, digest] of Object.entries(STARLIGHT_CORE_CATALOG_V1.sourceSha256)) {
        const source = readFileSync(resolve(__dirname, "../src", path));
        const hash = createHash("sha256").update(source).digest("hex");
        expect(hash, `Core file '${path}' sha256 changed`).toBe(qualifiedSourceDigest(path, digest));
      }
    });

    it("preserves exact core compilation output for black, flexoki, and celestia", () => {
      const black = compileThemeV2(getBlackCoreJson());
      expect(black.outputDigest).toBe("2dcf3b1dff57d80658561c593fd4f077e272791df4471750e99cee9022e53505");

      const flexoki = compileThemeV2(getFlexokiCoreJson());
      expect(flexoki.outputDigest).toBe("50f78aad91d592328ce1a37ff7901d8e4f57e7e6527fa463795d5ff963fbef0f");

      const celestia = compileThemeV2(getCelestiaCoreJson());
      expect(celestia.outputDigest).toBe("8711845cfb994fb2df78bfa030127ae4153cfc917c1222d99ed0a1bd7a88c468");
    });
  });

  describe("Code Catalog Identity & Digest", () => {
    it("pins code catalog identity, compiler semantic, and deterministic digest", () => {
      expect(CODE_CATALOG_IDENTITY).toBe("tfsl.starlight-code-catalog-v1");
      expect(CODE_COMPILER_SEMANTIC).toBe("tfsl.theme-compiler-v2-code-1");
      expect(STARLIGHT_CODE_CATALOG_V1.catalogIdentity).toBe(CODE_CATALOG_IDENTITY);
      expect(STARLIGHT_CODE_CATALOG_V1.adapter).toBe("starlight-v0.42");
      expect(verifyCodeCatalogDigest()).toBe(true);
      expect(computeCodeCatalogDigest()).toBe(CODE_CATALOG_DIGEST);
      expect(CODE_CATALOG_DIGEST).toMatch(/^[a-f0-9]{64}$/);
    });

    it("binds the sixth fixed style and exact stylesheet inventory in the code catalog", () => {
      expect(CODE_STYLE_FILES).toEqual([
        "styles/layers.css",
        "styles/tokens.css",
        "styles/base.css",
        "styles/accent.css",
        "styles/overrides.css",
        "styles/code.css",
      ]);
      expect(STARLIGHT_CODE_CATALOG_V1.styleInventory).toEqual([...CODE_STYLE_FILES]);
    });

    it("binds approved expressions and mappings into the code catalog", () => {
      expect(STARLIGHT_CODE_CATALOG_V1.approvedExpressions.codeCss).toBe(CODE_CSS_EXPRESSION);
      expect(CODE_CSS_EXPRESSION).toContain("@layer tfsl.overrides");
      expect(CODE_CSS_EXPRESSION).toContain("background-color: var(--code-background, var(--ec-codeBg));");
      expect(STARLIGHT_CODE_CATALOG_V1.approvedMappings.frames).toEqual({
        plain: "none",
        editor: "code",
        terminal: "terminal",
      });
      expect(STARLIGHT_CODE_CATALOG_V1.approvedMappings.copy).toEqual(["standard", "minimal"]);
      expect(STARLIGHT_CODE_CATALOG_V1.approvedMappings.tabs).toBe("deferred");
      expect(STARLIGHT_CODE_CATALOG_V1.approvedMappings.lineNumbers).toBe("deferred");
      expect(STARLIGHT_CODE_CATALOG_V1.approvedMappings.focused).toBe("deferred");
    });
  });

  describe("Pre-Serialization Safety & Authority Verification", () => {
    it("rejects accessors (getters/setters) anywhere on the input", () => {
      const specWithGetter = createValidCodeSpec();
      Object.defineProperty(specWithGetter, "spoofedProp", {
        get() {
          return "malicious";
        },
        enumerable: true,
      });
      expect(() => validateThemeCode(specWithGetter)).toThrow(ValidationErrorV2);
      expect(() => validateThemeCode(specWithGetter)).toThrow(/ACCESSOR_FORBIDDEN/);

      const specWithNestedGetter = createValidCodeSpec();
      Object.defineProperty(specWithNestedGetter.codePresentation, "nestedGetter", {
        get() {
          return "malicious";
        },
        enumerable: true,
      });
      expect(() => validateThemeCode(specWithNestedGetter)).toThrow(/ACCESSOR_FORBIDDEN/);
    });

    it("rejects custom prototypes and non-plain objects", () => {
      class MaliciousTheme {}
      const instance = Object.assign(new MaliciousTheme(), createValidCodeSpec());
      expect(() => validateThemeCode(instance)).toThrow(/INVALID_PROTOTYPE/);

      const specWithCustomChild = createValidCodeSpec();
      class CustomPresentation {}
      specWithCustomChild.codePresentation = Object.assign(
        new CustomPresentation(),
        createValidCodePresentation()
      );
      expect(() => validateThemeCode(specWithCustomChild)).toThrow(/INVALID_PROTOTYPE/);
    });

    it("rejects forbidden property names (__proto__, prototype, constructor)", () => {
      const specProto = createValidCodeSpec();
      Object.defineProperty(specProto.codePresentation, "prototype", {
        value: {},
        enumerable: true,
        configurable: true,
      });
      expect(() => validateThemeCode(specProto)).toThrow(/FORBIDDEN_PROPERTY/);

      const specCtor = createValidCodeSpec();
      Object.defineProperty(specCtor.codePresentation, "constructor", {
        value: {},
        enumerable: true,
        configurable: true,
      });
      expect(() => validateThemeCode(specCtor)).toThrow(/FORBIDDEN_PROPERTY/);
    });

    it("rejects functions and symbol properties", () => {
      const specWithFn = createValidCodeSpec();
      (specWithFn as any).executeCode = () => "evil";
      expect(() => validateThemeCode(specWithFn)).toThrow(/FORBIDDEN_VALUE/);

      const specWithSymbol = createValidCodeSpec();
      (specWithSymbol as any)[Symbol("forbidden")] = "secret";
      expect(() => validateThemeCode(specWithSymbol)).toThrow(/FORBIDDEN_SYMBOL/);
    });

    it("detects and rejects circular references", () => {
      const spec = createValidCodeSpec();
      (spec as any).self = spec;
      expect(() => validateThemeCode(spec)).toThrow(/CIRCULAR_REFERENCE|MAX_DEPTH_EXCEEDED/);
    });

    it("rejects object nesting depth exceeding limit of 20", () => {
      let deep: any = { value: "leaf" };
      for (let i = 0; i < 25; i++) {
        deep = { child: deep };
      }
      const spec = createValidCodeSpec();
      (spec.codePresentation.syntaxTheme.light.rules[0] as any).deep = deep;
      expect(() => validateThemeCode(spec)).toThrow(/MAX_DEPTH_EXCEEDED/);
    });

    it("rejects non-enumerable properties", () => {
      const spec = createValidCodeSpec();
      Object.defineProperty(spec, "hidden", {
        value: "secret",
        enumerable: false,
      });
      expect(() => validateThemeCode(spec)).toThrow(/ACCESSOR_FORBIDDEN/);
    });
  });

  describe("Syntax Theme Exact Limits and Validation", () => {
    it("requires syntaxTheme to be present", () => {
      const spec = createValidCodeSpec();
      delete (spec.codePresentation as any).syntaxTheme;
      expect(() => validateThemeCode(spec)).toThrow(ValidationErrorV2);
      expect(() => validateThemeCode(spec)).toThrow(/MISSING_FIELD/);
    });

    it("enforces 256 KiB maximum limit for syntaxTheme JSON", () => {
      const spec = createValidCodeSpec();
      // Generate large number of rules with long scope strings just exceeding 256 KiB
      const bigRules: any[] = [];
      for (let i = 0; i < 200; i++) {
        bigRules.push({
          scopes: [
            `source.very.long.qualified.identifier.section.number.${i}.submodule.deep.component`,
            `punctuation.definition.very.long.qualified.identifier.part.${i}.item`,
            `variable.language.this.parameter.declaration.specifier.${i}.entry`,
          ],
          foreground: "#123456",
          background: "#abcdef",
          fontStyle: "italic",
        });
      }
      spec.codePresentation.syntaxTheme.light.rules = bigRules;
      spec.codePresentation.syntaxTheme.dark.rules = bigRules;

      const size = Buffer.byteLength(JSON.stringify(spec.codePresentation.syntaxTheme), "utf8");
      if (size <= 256 * 1024) {
        // Add more until it exceeds
        while (Buffer.byteLength(JSON.stringify(spec.codePresentation.syntaxTheme), "utf8") <= 256 * 1024) {
          spec.codePresentation.syntaxTheme.light.rules.push({
            scopes: [`scope.padding.string.to.exceed.byte.limit.target.boundary.${spec.codePresentation.syntaxTheme.light.rules.length}`],
            foreground: "#112233",
          });
        }
      }
      expect(() => validateThemeCode(spec)).toThrow(/SYNTAX_OVERSIZED|TOO_MANY_RULES/);
    });

    it("enforces maximum total 512 rules across light and dark", () => {
      const spec = createValidCodeSpec();
      // Create 256 rules for light, 256 rules for dark = 512 rules (valid)
      const r256: any[] = [];
      for (let i = 0; i < 256; i++) {
        r256.push({ scopes: [`scope.r${i}`], foreground: "#000000" });
      }
      spec.codePresentation.syntaxTheme.light.rules = [...r256];
      spec.codePresentation.syntaxTheme.dark.rules = [...r256];
      expect(isThemeCode(spec)).toBe(true);

      // 513 rules fails
      spec.codePresentation.syntaxTheme.dark.rules.push({
        scopes: ["scope.extra"],
        foreground: "#ffffff",
      });
      expect(() => validateThemeCode(spec)).toThrow(/TOO_MANY_RULES/);
    });

    it("rejects empty rules array in light or dark", () => {
      const spec1 = createValidCodeSpec();
      spec1.codePresentation.syntaxTheme.light.rules = [];
      expect(() => validateThemeCode(spec1)).toThrow(/EMPTY_RULES/);

      const spec2 = createValidCodeSpec();
      spec2.codePresentation.syntaxTheme.dark.rules = [];
      expect(() => validateThemeCode(spec2)).toThrow(/EMPTY_RULES/);
    });

    it("enforces 1..32 scopes per rule", () => {
      const specZeroScopes = createValidCodeSpec();
      specZeroScopes.codePresentation.syntaxTheme.light.rules[0]!.scopes = [];
      expect(() => validateThemeCode(specZeroScopes)).toThrow(/EMPTY_SCOPES/);

      const spec32Scopes = createValidCodeSpec();
      const s32 = Array.from({ length: 32 }, (_, i) => `scope.item${i}`);
      spec32Scopes.codePresentation.syntaxTheme.light.rules[0]!.scopes = s32;
      expect(isThemeCode(spec32Scopes)).toBe(true);

      const spec33Scopes = createValidCodeSpec();
      const s33 = Array.from({ length: 33 }, (_, i) => `scope.item${i}`);
      spec33Scopes.codePresentation.syntaxTheme.light.rules[0]!.scopes = s33;
      expect(() => validateThemeCode(spec33Scopes)).toThrow(/TOO_MANY_SCOPES/);
    });

    it("enforces 1..128 bytes limit per scope string", () => {
      const spec = createValidCodeSpec();
      const scope128 = "a".repeat(128);
      spec.codePresentation.syntaxTheme.light.rules[0]!.scopes = [scope128];
      expect(isThemeCode(spec)).toBe(true);

      const scope129 = "a".repeat(129);
      spec.codePresentation.syntaxTheme.light.rules[0]!.scopes = [scope129];
      expect(() => validateThemeCode(spec)).toThrow(/SCOPE_OVERSIZED/);

      spec.codePresentation.syntaxTheme.light.rules[0]!.scopes = [""];
      expect(() => validateThemeCode(spec)).toThrow(/INVALID_SCOPE/);
    });

    it("enforces restricted dotted scope strings and rejects unsafe patterns", () => {
      const spec = createValidCodeSpec();

      // Valid dotted scopes
      const validScopes = [
        "comment",
        "comment.line",
        "comment.line.double-slash",
        "source.js",
        "storage.type_decl",
        "variable.parameter-name",
      ];
      spec.codePresentation.syntaxTheme.light.rules[0]!.scopes = validScopes;
      expect(isThemeCode(spec)).toBe(true);

      // Invalid scopes
      const invalidCases = [
        ".leading.dot",
        "trailing.dot.",
        "empty..segment",
        "has space in scope",
        "has<script>tag",
        "url(http://evil.invalid)",
        "scope;with;semi",
        "has$symbol",
        "punctuation/slash",
      ];
      for (const invalid of invalidCases) {
        const testSpec = createValidCodeSpec();
        testSpec.codePresentation.syntaxTheme.light.rules[0]!.scopes = [invalid];
        expect(
          () => validateThemeCode(testSpec),
          `Expected rejection of invalid scope '${invalid}'`
        ).toThrow(ValidationErrorV2);
      }
    });

    it("preserves rule and scope ordering during validation and canonicalization", () => {
      const spec = createValidCodeSpec();
      spec.codePresentation.syntaxTheme.light.rules = [
        { scopes: ["zebra.first", "alpha.second"], foreground: "#111111" },
        { scopes: ["beta.rule", "gamma.rule"], foreground: "#222222" },
      ];

      const canon = canonicalizeThemeCode(spec);
      const lightRules = canon.canonicalObject.codePresentation.syntaxTheme.light.rules;
      expect(lightRules[0]!.scopes).toEqual(["zebra.first", "alpha.second"]);
      expect(lightRules[1]!.scopes).toEqual(["beta.rule", "gamma.rule"]);
      expect(lightRules[0]!.foreground).toBe("#111111");
      expect(lightRules[1]!.foreground).toBe("#222222");
    });

    it("enforces canonical hex colors and closed fontStyle enum", () => {
      const spec = createValidCodeSpec();

      // Uppercase hex normalized to lowercase
      spec.codePresentation.syntaxTheme.light.rules[0]!.foreground = "#AABBCC";
      const validated = validateThemeCode(spec);
      expect(validated.codePresentation.syntaxTheme.light.rules[0]!.foreground).toBe("#aabbcc");

      // Invalid colors
      const invalidColors = ["#fff", "rgb(0,0,0)", "red", "hsl(0, 0%, 0%)", "#12345678", "blue"];
      for (const col of invalidColors) {
        const s = createValidCodeSpec();
        s.codePresentation.syntaxTheme.light.rules[0]!.foreground = col;
        expect(() => validateThemeCode(s), `Should reject color '${col}'`).toThrow(/INVALID_COLOR_FORMAT/);
      }

      // Valid font styles
      for (const style of ["normal", "italic", "bold", "underline"] as const) {
        const s = createValidCodeSpec();
        s.codePresentation.syntaxTheme.light.rules[0]!.fontStyle = style;
        expect(isThemeCode(s)).toBe(true);
      }

      // Invalid font styles
      for (const style of ["oblique", "strikethrough", "none", "italic bold"]) {
        const s = createValidCodeSpec();
        (s.codePresentation.syntaxTheme.light.rules[0] as any).fontStyle = style;
        expect(() => validateThemeCode(s), `Should reject fontStyle '${style}'`).toThrow(/INVALID_FONT_STYLE/);
      }
    });
  });

  describe("Code Presentation Closed Shape Validation", () => {
    it("validates closed frame options: plain, editor, terminal", () => {
      for (const frame of ["plain", "editor", "terminal"] as const) {
        const s = createValidCodeSpec();
        s.codePresentation.frame = frame;
        expect(isThemeCode(s)).toBe(true);
      }
      for (const frame of ["none", "auto", "code", "window", "custom"]) {
        const s = createValidCodeSpec();
        (s.codePresentation as any).frame = frame;
        expect(() => validateThemeCode(s)).toThrow(/INVALID_FRAME/);
      }
    });

    it("validates closed copy options: standard, minimal", () => {
      for (const copy of ["standard", "minimal"] as const) {
        const s = createValidCodeSpec();
        s.codePresentation.copy = copy;
        expect(isThemeCode(s)).toBe(true);
      }
      for (const copy of ["none", "full", "custom", "disabled"]) {
        const s = createValidCodeSpec();
        (s.codePresentation as any).copy = copy;
        expect(() => validateThemeCode(s)).toThrow(/INVALID_COPY/);
      }
    });

    it("validates closed tabs option: deferred only", () => {
      const s = createValidCodeSpec();
      s.codePresentation.tabs = "deferred";
      expect(isThemeCode(s)).toBe(true);

      for (const tabs of ["enabled", "auto", "catalog", "none"]) {
        const sBad = createValidCodeSpec();
        (sBad.codePresentation as any).tabs = tabs;
        expect(() => validateThemeCode(sBad)).toThrow(/INVALID_TABS/);
      }
    });

    it("validates mode: expressive-code only", () => {
      const s = createValidCodeSpec();
      (s.codePresentation as any).mode = "shiki";
      expect(() => validateThemeCode(s)).toThrow(/INVALID_MODE/);
    });

    it("validates marks with either canonical hex or paired { light, dark }", () => {
      const sHex = createValidCodeSpec();
      sHex.codePresentation.marks = {
        marked: "#112233",
        inserted: "#223344",
        deleted: "#334455",
      };
      expect(isThemeCode(sHex)).toBe(true);

      const sPaired = createValidCodeSpec();
      sPaired.codePresentation.marks = {
        marked: { light: "#111111", dark: "#222222" },
        inserted: { light: "#333333", dark: "#444444" },
        deleted: { light: "#555555", dark: "#666666" },
      };
      expect(isThemeCode(sPaired)).toBe(true);

      const sBad = createValidCodeSpec();
      (sBad.codePresentation.marks as any).marked = "#fff";
      expect(() => validateThemeCode(sBad)).toThrow(/INVALID_COLOR_FORMAT/);
    });

    it("rejects unknown keys on codePresentation and sub-objects", () => {
      const s = createValidCodeSpec();
      (s.codePresentation as any).extraProp = true;
      expect(() => validateThemeCode(s)).toThrow(/UNKNOWN_KEY/);

      const sMarks = createValidCodeSpec();
      (sMarks.codePresentation.marks as any).extraMark = "#112233";
      expect(() => validateThemeCode(sMarks)).toThrow(/UNKNOWN_KEY/);
    });
  });

  describe("Compilation Composition & Sixth File Emission", () => {
    it("compiles code spec and produces exactly six stylesheet files including styles/code.css", () => {
      const spec = createValidCodeSpec();
      const res = compileThemeCode(spec);

      expect(res.styles.size).toBe(6);
      expect(Array.from(res.styles.keys())).toEqual([
        "styles/layers.css",
        "styles/tokens.css",
        "styles/base.css",
        "styles/accent.css",
        "styles/overrides.css",
        "styles/code.css",
      ]);

      const codeCss = res.styles.get("styles/code.css");
      expect(codeCss).toBeDefined();
      expect(codeCss).toContain("@layer tfsl.overrides");
      expect(codeCss).toContain(".sl-markdown-content .expressive-code pre");
      expect(codeCss).toContain("background-color: var(--code-background, var(--ec-codeBg));");

      // Verify concatenated css ends with code.css
      expect(res.css).toContain(codeCss!);
      expect(res.outputDigest).toBe(createHash("sha256").update(res.css).digest("hex"));
    });

    it("constructs successor descriptor with code catalog identity and compiler semantic", () => {
      const spec = createValidCodeSpec();
      const res = compileThemeCode(spec);

      expect(res.descriptor.schema).toBe("tfsl.theme-descriptor-v2");
      expect(res.descriptor.schemaVersion).toBe(2);
      expect(res.descriptor.catalogIdentity).toBe("tfsl.starlight-code-catalog-v1");
      expect(res.descriptor.catalogDigest).toBe(CODE_CATALOG_DIGEST);
      expect(res.descriptor.catalog.identity).toBe("tfsl.starlight-code-catalog-v1");
      expect(res.descriptor.catalog.digest).toBe(CODE_CATALOG_DIGEST);
      expect(res.descriptor.compilerSemantic).toBe("tfsl.theme-compiler-v2-code-1");
      expect(res.descriptor.provenance.semantic).toBe("tfsl.theme-compiler-v2-code-1");
      expect(res.descriptor.inputDigest).toBe(res.inputDigest);
      expect(res.descriptor.outputDigest).toBe(res.outputDigest);
    });

    it("respects accent selection and rejects unknown accents", () => {
      const base = getFlexokiCoreJson();
      const flexokiCode: ThemeSpecificationCode = {
        ...base,
        codePresentation: createValidCodePresentation(),
      };

      const resGreen = compileThemeCode(flexokiCode, { accent: "green" });
      expect(resGreen.descriptor.selectedAccent).toBe("green");

      const resPurple = compileThemeCode(flexokiCode, { accent: "purple" });
      expect(resPurple.descriptor.selectedAccent).toBe("purple");
      expect(resGreen.outputDigest).not.toBe(resPurple.outputDigest);

      expect(() => compileThemeCode(flexokiCode, { accent: "neon-cyan" })).toThrow(/UNKNOWN_ACCENT/);
    });

    it("rejects options parameter spoofing", () => {
      const spec = createValidCodeSpec();
      expect(() =>
        compileThemeCode(spec, { spoofed: "invalid" } as any)
      ).toThrow(ValidationErrorV2);
      expect(() =>
        compileThemeCode(spec, { strictContrast: true })
      ).toThrow(/strict contrast/);
    });
  });

  describe("Config Conversion: createCodeDefaults", () => {
    it("generates public Expressive Code configuration matching installed declarations", () => {
      const spec = createValidCodeSpec();
      const config = createCodeDefaults(spec);

      // 1. Explicit light and dark themes with tokenColors
      expect(config.themes).toHaveLength(2);
      const dark = config.themes.find((t) => t.type === "dark")!;
      const light = config.themes.find((t) => t.type === "light")!;
      expect(dark).toBeDefined();
      expect(light).toBeDefined();
      expect(dark.name).toBe("loom-black-core-dark");
      expect(light.name).toBe("loom-black-core-light");

      expect(dark.tokenColors).toHaveLength(3);
      expect(dark.tokenColors[0]!.scope).toEqual(["comment", "punctuation.definition.comment"]);
      expect(dark.tokenColors[0]!.settings.foreground).toBe("#8a92a6");
      expect(dark.tokenColors[0]!.settings.fontStyle).toBe("italic");

      // 2. useStarlightUiThemeColors: false
      expect(config.useStarlightUiThemeColors).toBe(false);

      // 3. defaultProps.frame: editor -> code
      expect(config.defaultProps.frame).toBe("code");

      // 4. styleOverrides: frames and textMarkers leaves
      const frames = config.styleOverrides.frames;
      expect(frames.editorBackground).toEqual(["#090a0d", "#f1f5f9"]);
      expect(frames.editorTabBorderRadius).toBe("8px");
      expect(frames.inlineButtonBorderOpacity).toBe("0.4"); // standard copy
      expect(frames.inlineButtonBackgroundIdleOpacity).toBe("0");
      expect(frames.tooltipSuccessBackground).toEqual(["#f97316", "#ea580c"]);

      const textMarkers = config.styleOverrides.textMarkers;
      expect(textMarkers.markBackground).toEqual(["#3b82f6", "#3b82f6"]);
      expect(textMarkers.insBackground).toEqual(["#22c55e", "#22c55e"]);
      expect(textMarkers.delBackground).toEqual(["#ef4444", "#ef4444"]);

      // 5. Root styleOverrides
      expect(config.styleOverrides.borderRadius).toBe("8px");
      expect(config.styleOverrides.borderWidth).toBe("1px");
    });

    it("correctly maps frame types: plain -> none, editor -> code, terminal -> terminal", () => {
      const specPlain = createValidCodeSpec();
      specPlain.codePresentation.frame = "plain";
      expect(createCodeDefaults(specPlain).defaultProps.frame).toBe("none");

      const specEditor = createValidCodeSpec();
      specEditor.codePresentation.frame = "editor";
      expect(createCodeDefaults(specEditor).defaultProps.frame).toBe("code");

      const specTerminal = createValidCodeSpec();
      specTerminal.codePresentation.frame = "terminal";
      expect(createCodeDefaults(specTerminal).defaultProps.frame).toBe("terminal");
    });

    it("correctly handles copy minimal vs standard in frames styleOverrides", () => {
      const specMin = createValidCodeSpec();
      specMin.codePresentation.copy = "minimal";
      expect(createCodeDefaults(specMin).styleOverrides.frames.inlineButtonBorderOpacity).toBe("0");

      const specStd = createValidCodeSpec();
      specStd.codePresentation.copy = "standard";
      expect(createCodeDefaults(specStd).styleOverrides.frames.inlineButtonBorderOpacity).toBe("0.4");
    });

    it("correctly unpacks paired light/dark marks in textMarkers styleOverrides", () => {
      const spec = createValidCodeSpec();
      spec.codePresentation.marks = {
        marked: { light: "#111111", dark: "#222222" },
        inserted: { light: "#333333", dark: "#444444" },
        deleted: { light: "#555555", dark: "#666666" },
      };

      const config = createCodeDefaults(spec);
      expect(config.styleOverrides.textMarkers.markBackground).toEqual(["#222222", "#111111"]);
      expect(config.styleOverrides.textMarkers.insBackground).toEqual(["#444444", "#333333"]);
      expect(config.styleOverrides.textMarkers.delBackground).toEqual(["#666666", "#555555"]);
    });

    it("resolves active accent when passed explicitly to createCodeDefaults", () => {
      const flexokiCode: ThemeSpecificationCode = {
        ...getFlexokiCoreJson(),
        codePresentation: createValidCodePresentation(),
      };

      const defConfig = createCodeDefaults(flexokiCode); // defaultAccent = blue
      const orangeConfig = createCodeDefaults(flexokiCode, { accent: "orange" });

      expect(defConfig.styleOverrides.frames.tooltipSuccessBackground).not.toEqual(
        orangeConfig.styleOverrides.frames.tooltipSuccessBackground
      );
    });
  });
});
