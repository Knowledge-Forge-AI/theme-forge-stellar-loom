import { qualifiedSourceDigest } from "./recovery-source-qualification.js";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  compileThemeV2,
  canonicalizeThemeV2,
  validateThemeV2,
  ValidationErrorV2,
  CATALOG_IDENTITY,
  CATALOG_DIGEST,
  COMPILER_SEMANTIC,
  COMPILER_PRODUCER,
  COMPILER_VERSION,
  COLOR_ROLES,
  STYLE_FILES,
  computeCatalogDigest,
  verifyCatalogDigest,
  STARLIGHT_CORE_CATALOG_V1,
  type ThemeSpecificationV2,
} from "../src/v2/index.js";
import {
  validateThemeSpecification,
  compileTheme,
  canonicalizeSpecification,
} from "../src/index.js";
import { validateThemeSpecification as validateV1 } from "../src/schema/validator.js";

describe("core contract boundary regressions", () => {
  const fixture = () => JSON.parse(readFileSync(resolve(__dirname, "../examples/loom-black-core.theme.json"), "utf8"));
  it("binds actual compiler expression source into the pinned catalog", () => {
    for (const [path, digest] of Object.entries(STARLIGHT_CORE_CATALOG_V1.sourceSha256)) {
      const source = readFileSync(resolve(__dirname, "../src", path));
      expect(createHash("sha256").update(source).digest("hex"), path).toBe(qualifiedSourceDigest(path, digest));
    }
  });
  it("requires every role in every mode and rejects prototype variant lookups", () => {
    for (const mode of ["light", "dark"]) for (const role of COLOR_ROLES) {
      const input = fixture(); delete input.accentVariants[input.defaultAccent][mode][role];
      expect(() => validateThemeV2(input)).toThrow();
    }
    for (const id of ["__proto__", "constructor", "toString"]) {
      const input = fixture(); input.defaultAccent = id;
      expect(() => validateThemeV2(input)).toThrow();
      expect(() => compileThemeV2(fixture(), { accent: id })).toThrow();
    }
  });
  it("rejects unused alias cycles, hidden fields and unsafe font strings", () => {
    const input = fixture(); const set = Object.keys(input.tokenSets)[0]!;
    input.tokenSets[set].unused = { alias: "unused" };
    expect(() => validateThemeV2(input)).toThrow(/alias/);
    const hidden = fixture(); Object.defineProperty(hidden, "hidden", { value: true });
    expect(() => validateThemeV2(hidden)).toThrow();
    const symbols = fixture(); symbols[Symbol("hidden")] = true;
    expect(() => validateThemeV2(symbols)).toThrow();
    const font = { id: "original", family: "Original", style: "normal", weight: "100 900", format: "woff2", sha256: "a".repeat(64), license: "original", notice: "original-v1" };
    for (const patch of [{ family: "x' , serif" }, { notice: "https://example.invalid" }, { weight: "900 100" }, { weight: "000 999" }]) {
      expect(() => validateThemeV2({ ...fixture(), fonts: [{ ...font, ...patch }] })).toThrow();
    }
  });
  it("applies bounded layout, spacing, border and typography roles", () => {
    const a = fixture(); const b = fixture(); b.layoutPreset = "compact";
    b.surfaces.borderStyle = "dashed"; b.surfaces.focusOffset = 4;
    const compiled = compileThemeV2(b);
    expect(compiled.outputDigest).not.toBe(compileThemeV2(a).outputDigest);
    expect(compiled.css).toContain("--tfsl-border-style: dashed");
    expect(compiled.css).toContain("--tfsl-focus-offset: 4px");
    expect(compiled.css).toContain("--tfsl-space-section:");
    expect(compiled.css).toContain("font-family: var(--tfsl-font-ui)");
    expect(compiled.css).toContain("font-family: var(--tfsl-font-code)");
  });
});

const blackCoreJson = JSON.parse(
  readFileSync(resolve(__dirname, "../examples/loom-black-core.theme.json"), "utf8")
);
const flexokiCoreJson = JSON.parse(
  readFileSync(resolve(__dirname, "../examples/loom-flexoki-core.theme.json"), "utf8")
);
const celestiaCoreJson = JSON.parse(
  readFileSync(resolve(__dirname, "../examples/loom-celestia-core.theme.json"), "utf8")
);

describe("TFSB61B-core v2 domain & compiler", () => {
  describe("Catalog Identity & Pinned Digest", () => {
    it("pins catalog identity, adapter, and deterministic digest", () => {
      expect(CATALOG_IDENTITY).toBe("tfsl.starlight-core-catalog-v1");
      expect(STARLIGHT_CORE_CATALOG_V1.catalogIdentity).toBe("tfsl.starlight-core-catalog-v1");
      expect(STARLIGHT_CORE_CATALOG_V1.adapter).toBe("starlight-v0.42");
      expect(verifyCatalogDigest()).toBe(true);
      expect(computeCatalogDigest()).toBe(CATALOG_DIGEST);
      expect(CATALOG_DIGEST).toBe("d45f945d3323244c5b6d2908799c968d5d1d223e945b8aed0a0ce96b76f32953");
    });

    it("binds approved expressions, role mappings, font stacks, layouts, and layer order in catalog", () => {
      expect(STARLIGHT_CORE_CATALOG_V1.approvedExpressions.pageTitleFrameTemplate).toContain("tfsl-page-title-frame");
      expect(STARLIGHT_CORE_CATALOG_V1.sourceSha256["v2/compiler.ts"]).toMatch(/^[a-f0-9]{64}$/);
      expect(STARLIGHT_CORE_CATALOG_V1.layers).toEqual([
        "starlight",
        "tfsl",
        "tfsl.tokens",
        "tfsl.base",
        "tfsl.accent",
        "tfsl.overrides",
      ]);
      expect(STARLIGHT_CORE_CATALOG_V1.approvedLayouts.standard.contentWidth).toBe(1152);
      expect(STARLIGHT_CORE_CATALOG_V1.approvedLayouts.compact.contentWidth).toBe(960);
      expect(STARLIGHT_CORE_CATALOG_V1.approvedLayouts.wide.contentWidth).toBe(1440);
    });

    it("pins compiler semantic identity and non-spoofable provenance", () => {
      expect(COMPILER_SEMANTIC).toBe("tfsl.theme-compiler-v2-core-1");
      expect(COMPILER_PRODUCER).toBe("@knowledge-forge-ai/theme-forge-stellar-loom");
      expect(COMPILER_VERSION).toBe("0.2.0");

      const comp = compileThemeV2(blackCoreJson);
      expect(comp.descriptor.compilerSemantic).toBe("tfsl.theme-compiler-v2-core-1");
      expect(comp.descriptor.provenance.semantic).toBe("tfsl.theme-compiler-v2-core-1");
      expect(comp.descriptor.provenance.compiler).toBe("@knowledge-forge-ai/theme-forge-stellar-loom");
      expect(comp.descriptor.provenance.compilerVersion).toBe("0.2.0");
      expect(comp.descriptor.catalogIdentity).toBe("tfsl.starlight-core-catalog-v1");
      expect(comp.descriptor.catalogDigest).toBe(CATALOG_DIGEST);

      // Rejects spoofable options parameters
      expect(() =>
        compileThemeV2(blackCoreJson, { producer: "evil-spoof", compilerVersion: "9.9.9" } as any)
      ).toThrow(ValidationErrorV2);
      expect(() =>
        compileThemeV2(blackCoreJson, { catalogId: "spoofed-catalog" } as any)
      ).toThrow(ValidationErrorV2);
    });
  });

  describe("Example Theme Fixtures and Literal Output Digest Pins", () => {
    it("compiles loom-black-core with literal pinned input and output digests", () => {
      const comp = compileThemeV2(blackCoreJson);
      expect(comp.specification.name).toBe("loom-black-core");
      expect(comp.inputDigest).toBe("9ce60cbf5d205c404928dd8f5c5d4949a6cb37e9676c0f04d270cb5ba13814dd");
      expect(comp.outputDigest).toBe("2dcf3b1dff57d80658561c593fd4f077e272791df4471750e99cee9022e53505");
      expect(comp.descriptor.inventoryDigest).toBe("22fb7d2c713164a786c023f99d6cfc23dcedb1a965789363c95e152613efb57a");
      expect(comp.descriptor.schema).toBe("tfsl.theme-descriptor-v2");
      expect(comp.descriptor.schemaVersion).toBe(2);
      expect(comp.descriptor.selectedAccent).toBe("default");

      // Verify pageTitle frame override in overrides.css
      expect(comp.styles.get("styles/overrides.css")).toContain(".tfsl-page-title-frame");
      expect(comp.styles.get("styles/overrides.css")).toContain("border-left: 4px solid var(--sl-color-accent)");
    });

    it("compiles loom-flexoki-core with 8 distinct accents and literal default digest", () => {
      expect(Object.keys(flexokiCoreJson.accentVariants)).toHaveLength(8);
      const expectedAccents = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "magenta"];
      expect(Object.keys(flexokiCoreJson.accentVariants).sort()).toEqual(expectedAccents.sort());
      expect(flexokiCoreJson.defaultAccent).toBe("blue");

      // Default accent (blue)
      const defaultComp = compileThemeV2(flexokiCoreJson);
      expect(defaultComp.specification.name).toBe("loom-flexoki-core");
      expect(defaultComp.inputDigest).toBe("6dcc5154c5f16a6edeeed30f6371d2a2c0d59e8d328ac2dcdf2e961fb0b9fcb4");
      expect(defaultComp.outputDigest).toBe("50f78aad91d592328ce1a37ff7901d8e4f57e7e6527fa463795d5ff963fbef0f");
      expect(defaultComp.descriptor.inventoryDigest).toBe("55336aba3533a09fff9d702b6ad1349b40446c568e02f27fa3000fd0dd45c179");
      expect(defaultComp.descriptor.selectedAccent).toBe("blue");

      // Test all 8 accents compile with distinctive output digests
      const digests = new Set<string>();
      for (const accent of expectedAccents) {
        const comp = compileThemeV2(flexokiCoreJson, { accent });
        expect(comp.descriptor.selectedAccent).toBe(accent);
        expect(comp.styles.get("styles/accent.css")).toContain(`--tfsl-color-accent-base:`);
        digests.add(comp.outputDigest);
      }
      expect(digests.size).toBe(8);

      // Unknown accent fails closed
      expect(() => compileThemeV2(flexokiCoreJson, { accent: "neon-lime" })).toThrow(ValidationErrorV2);
    });

    it("compiles loom-celestia-core with package-local font and ordinal font-00 filename", () => {
      const comp = compileThemeV2(celestiaCoreJson);
      expect(comp.specification.name).toBe("loom-celestia-core");
      expect(comp.inputDigest).toBe("6354fe083d978b83283c0bf650be0a2a8c9cfee907292481b2be01a6229b249d");
      expect(comp.outputDigest).toBe("8711845cfb994fb2df78bfa030127ae4153cfc917c1222d99ed0a1bd7a88c468");
      expect(comp.descriptor.inventoryDigest).toBe("3a4c252d1e4f24cb7dc52ffa8a36ce27dc9027c3720b562e37345ab8576c9b55");

      // Ordinal font filename in @font-face rule in tokens.css
      const tokensCss = comp.styles.get("styles/tokens.css")!;
      expect(tokensCss).toContain("@font-face");
      expect(tokensCss).toContain("fonts/font-00.woff2");
      expect(tokensCss).toContain("font-family: 'Celestia Sans'");
      expect(tokensCss).toContain("--tfsl-font-body: 'Celestia Sans'");
      expect(tokensCss).toContain("--sl-content-width: 960px");
      expect(tokensCss).toContain("--sl-sidebar-width: 240px");
    });
  });

  describe("Fixed Styles Family and Layer Architecture", () => {
    it("emits exactly five stylesheet family members matching STYLE_FILES", () => {
      const comp = compileThemeV2(blackCoreJson);
      expect(comp.styles.size).toBe(5);
      expect(Array.from(comp.styles.keys())).toEqual([...STYLE_FILES]);
      for (const file of STYLE_FILES) {
        expect(comp.styles.get(file)).toBeDefined();
        expect(comp.styles.get(file)!.length).toBeGreaterThan(0);
      }
    });

    it("preserves layer order in styles/layers.css and concatenated css", () => {
      const comp = compileThemeV2(blackCoreJson);
      const layersCss = comp.styles.get("styles/layers.css")!;
      expect(layersCss).toContain("@layer starlight, tfsl;");
      expect(layersCss).toContain("@layer tfsl.tokens, tfsl.base, tfsl.accent, tfsl.overrides;");

      // Ordered concatenation: layers.css first, then tokens, base, accent, overrides
      const lines = comp.css.split("\n");
      const layersIndex = comp.css.indexOf("@layer starlight, tfsl;");
      const tokensIndex = comp.css.indexOf("@layer tfsl.tokens {");
      const baseIndex = comp.css.indexOf("@layer tfsl.base {");
      const accentIndex = comp.css.indexOf("@layer tfsl.accent {");
      const overridesIndex = comp.css.indexOf("@layer tfsl.overrides {");

      expect(layersIndex).toBeGreaterThanOrEqual(0);
      expect(tokensIndex).toBeGreaterThan(layersIndex);
      expect(baseIndex).toBeGreaterThan(tokensIndex);
      expect(accentIndex).toBeGreaterThan(baseIndex);
      expect(overridesIndex).toBeGreaterThan(accentIndex);
    });

    it("declares explicit responsive heading behavior in base.css", () => {
      const comp = compileThemeV2(blackCoreJson);
      const baseCss = comp.styles.get("styles/base.css")!;
      expect(baseCss).toContain(".sl-markdown-content :is(h1, h2, h3, h4, h5, h6)");
      expect(baseCss).toContain(".sl-markdown-content h1 {");
      expect(baseCss).toContain("font-size: var(--sl-text-h1);");
      expect(baseCss).toContain("@media (min-width: 50rem)");
      expect(baseCss).toContain("calc(var(--sl-text-h1) * 1.15)");
      expect(baseCss).toContain("@media (min-width: 72rem)");
      expect(baseCss).toContain("calc(var(--sl-text-h1) * 1.25)");
    });
  });

  describe("Complete 22 Color Roles and Token Resolution", () => {
    it("defines and validates exactly 22 color roles", () => {
      expect(COLOR_ROLES).toHaveLength(22);
      expect(COLOR_ROLES).toEqual([
        "page",
        "navigation",
        "header",
        "sidebar",
        "raised",
        "panel",
        "card",
        "inline-code",
        "code",
        "body",
        "secondary",
        "muted",
        "inverted",
        "link",
        "hairline",
        "border",
        "focus",
        "selection-background",
        "selection-text",
        "accent-base",
        "accent-low",
        "accent-high",
      ]);
    });

    it("resolves token aliases recursively without mutating original tokens", () => {
      const specWithAliases: ThemeSpecificationV2 = {
        name: "test-alias-theme",
        version: "1.0.0",
        schemaVersion: "tfsl.theme-v2",
        adapter: "starlight-v0.42",
        tokenSets: {
          core: {
            "c-white": "#ffffff",
            "c-black": "#000000",
            "c-blue": "#0055ff",
            "c-alias-1": { alias: "c-blue" },
            "c-alias-2": { alias: "c-alias-1" },
            "c-value-obj": { value: "#123456" },
          },
        },
        accentVariants: {
          default: {
            tokenSet: "core",
            dark: {} as any,
            light: {} as any,
          },
        },
        defaultAccent: "default",
        typography: {
          body: { font: "system-sans", size: 16, lineHeight: 1.5 },
          heading: { font: "system-sans", size: 24, lineHeight: 1.2 },
          ui: { font: "system-sans", size: 14, lineHeight: 1.4 },
          code: { font: "system-mono", size: 14, lineHeight: 1.4 },
        },
        surfaces: {
          spacing: 4,
          radii: 4,
          border: 1,
          focus: 2,
          content: 1000,
          sidebar: 250,
        },
        layoutPreset: "standard",
        components: { pageTitle: "consumer-default" },
        codePresentation: "consumer-default",
        fonts: [],
      };

      for (const role of COLOR_ROLES) {
        specWithAliases.accentVariants.default.dark[role] = "c-black";
        specWithAliases.accentVariants.default.light[role] = "c-white";
      }
      specWithAliases.accentVariants.default.dark["accent-base"] = "c-alias-2";
      specWithAliases.accentVariants.default.light["accent-base"] = "c-value-obj";

      const comp = compileThemeV2(specWithAliases);
      expect(comp.styles.get("styles/accent.css")).toContain("--tfsl-color-accent-base: #0055ff;");
      expect(comp.styles.get("styles/accent.css")).toContain("--tfsl-color-accent-base: #123456;");
    });
  });

  describe("Strict Validation & Security Hardening", () => {
    it("rejects non-plain objects", () => {
      class CustomSpec {}
      const instance = new CustomSpec();
      expect(() => validateThemeV2(instance)).toThrow(ValidationErrorV2);
      expect(() => validateThemeV2(instance)).toThrow(/INVALID_PROTOTYPE/);
    });

    it("rejects prototype pollution attempts in identifiers and properties", () => {
      const malicious = JSON.parse(JSON.stringify(blackCoreJson));
      malicious.__proto__.polluted = "yes";
      expect(() => validateThemeV2(malicious)).not.toThrow(); // JSON.parse doesn't pollute Object.prototype directly
      delete (Object.prototype as any).polluted;

      const badProperty = JSON.parse(JSON.stringify(blackCoreJson));
      badProperty.tokenSets["constructor"] = { "a": "#123456" };
      expect(() => validateThemeV2(badProperty)).toThrow(/FORBIDDEN_PROPERTY/);

      const badToken = JSON.parse(JSON.stringify(blackCoreJson));
      Object.defineProperty(badToken.tokenSets["black-tokens"], "__proto__", {
        value: "#123456",
        enumerable: true,
        configurable: true,
      });
      expect(() => validateThemeV2(badToken)).toThrow(/FORBIDDEN_PROPERTY/);
    });

    it("rejects accessor properties (getters/setters)", () => {
      const badObj = JSON.parse(JSON.stringify(blackCoreJson));
      Object.defineProperty(badObj, "surfaces", {
        get() {
          return blackCoreJson.surfaces;
        },
        enumerable: true,
        configurable: true,
      });
      expect(() => validateThemeV2(badObj)).toThrow(ValidationErrorV2);
      expect(() => validateThemeV2(badObj)).toThrow(/ACCESSOR_FORBIDDEN/);
    });

    it("detects cyclic token alias chains", () => {
      const bad = JSON.parse(JSON.stringify(blackCoreJson));
      bad.tokenSets["black-tokens"]["cycle-a"] = { alias: "cycle-b" };
      bad.tokenSets["black-tokens"]["cycle-b"] = { alias: "cycle-a" };
      bad.accentVariants.default.dark.page = "cycle-a";

      expect(() => validateThemeV2(bad)).toThrow(ValidationErrorV2);
      expect(() => validateThemeV2(bad)).toThrow(/TOKEN_ALIAS_CYCLE/);
    });

    it("rejects self-referencing token alias", () => {
      const bad = JSON.parse(JSON.stringify(blackCoreJson));
      bad.tokenSets["black-tokens"]["self-ref"] = { alias: "self-ref" };
      bad.accentVariants.default.dark.page = "self-ref";

      expect(() => validateThemeV2(bad)).toThrow(ValidationErrorV2);
      expect(() => validateThemeV2(bad)).toThrow(/TOKEN_ALIAS_CYCLE/);
    });

    it("rejects unknown token references in variants", () => {
      const bad = JSON.parse(JSON.stringify(blackCoreJson));
      bad.accentVariants.default.dark.page = "nonexistent-token";

      expect(() => validateThemeV2(bad)).toThrow(ValidationErrorV2);
      expect(() => validateThemeV2(bad)).toThrow(/TOKEN_NOT_FOUND/);
    });

    it("rejects missing color roles in variant light or dark maps", () => {
      for (const role of COLOR_ROLES) {
        const bad = JSON.parse(JSON.stringify(blackCoreJson));
        delete bad.accentVariants.default.light[role];
        expect(() => validateThemeV2(bad)).toThrow(ValidationErrorV2);
      }
    });

    it("rejects extra/unknown color roles in variant maps", () => {
      const bad = JSON.parse(JSON.stringify(blackCoreJson));
      bad.accentVariants.default.dark["arbitrary-role"] = "bg-page-dark";
      expect(() => validateThemeV2(bad)).toThrow(ValidationErrorV2);
    });

    it("rejects CSS injection and dangerous patterns in string fields", () => {
      const dangerousStrings = [
        "url('https://malicious.com/leak')",
        "<script>alert(1)</script>",
        "@import 'evil.css';",
        "expression(alert(1))",
        "red; color: blue",
        "/* injection comment */",
      ];

      for (const str of dangerousStrings) {
        const bad = JSON.parse(JSON.stringify(blackCoreJson));
        bad.typography.body.font = str;
        expect(() => validateThemeV2(bad)).toThrow(ValidationErrorV2);
      }
    });

    it("enforces schema bounds on tokenSets, entries, variants, and fonts", () => {
      // > 16 token sets
      const tooManySets = JSON.parse(JSON.stringify(blackCoreJson));
      for (let i = 0; i < 17; i++) {
        tooManySets.tokenSets[`set-${i}`] = { "token-1": "#112233" };
      }
      expect(() => validateThemeV2(tooManySets)).toThrow(/TOKEN_SETS_BOUNDS/);

      // > 128 entries in one set
      const tooManyEntries = JSON.parse(JSON.stringify(blackCoreJson));
      const bigSet: Record<string, string> = {};
      for (let i = 0; i < 129; i++) {
        bigSet[`entry-${i}`] = "#112233";
      }
      tooManyEntries.tokenSets["black-tokens"] = bigSet;
      expect(() => validateThemeV2(tooManyEntries)).toThrow(/TOKEN_SET_ENTRIES_BOUNDS/);

      // > 16 accent variants
      const tooManyVariants = JSON.parse(JSON.stringify(blackCoreJson));
      for (let i = 0; i < 17; i++) {
        tooManyVariants.accentVariants[`var-${i}`] = blackCoreJson.accentVariants.default;
      }
      expect(() => validateThemeV2(tooManyVariants)).toThrow(/ACCENT_VARIANTS_BOUNDS/);

      // > 16 fonts
      const tooManyFonts = JSON.parse(JSON.stringify(blackCoreJson));
      tooManyFonts.fonts = [];
      for (let i = 0; i < 17; i++) {
        tooManyFonts.fonts.push({
          id: `font-${i}`,
          family: `Family ${i}`,
          style: "normal",
          weight: 400,
          format: "woff2",
          sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          license: "OFL-1.1",
          notice: "Notice",
        });
      }
      expect(() => validateThemeV2(tooManyFonts)).toThrow(/FONTS_BOUNDS/);
    });

    it("rejects path traversal or separators in font metadata", () => {
      const badPathInFont = JSON.parse(JSON.stringify(celestiaCoreJson));
      badPathInFont.fonts[0].family = "../evil/font";
      expect(() => validateThemeV2(badPathInFont)).toThrow(/forbidden path/);

      const badLicense = JSON.parse(JSON.stringify(celestiaCoreJson));
      badLicense.fonts[0].license = "/etc/passwd";
      expect(() => validateThemeV2(badLicense)).toThrow(/license identity/);
    });

    it("rejects invalid font format and invalid sha256", () => {
      const badFormat = JSON.parse(JSON.stringify(celestiaCoreJson));
      badFormat.fonts[0].format = "ttf";
      expect(() => validateThemeV2(badFormat)).toThrow(/INVALID_FONT_FORMAT/);

      const badSha = JSON.parse(JSON.stringify(celestiaCoreJson));
      badSha.fonts[0].sha256 = "not-a-valid-sha256";
      expect(() => validateThemeV2(badSha)).toThrow(/INVALID_SHA256/);
    });

    it("rejects unknown font IDs in typography", () => {
      const badFont = JSON.parse(JSON.stringify(blackCoreJson));
      badFont.typography.body.font = "unregistered-font";
      expect(() => validateThemeV2(badFont)).toThrow(/UNKNOWN_FONT_ID/);
    });

    it("rejects out of range typography sizes and line heights", () => {
      const badSize = JSON.parse(JSON.stringify(blackCoreJson));
      badSize.typography.body.size = 2; // too small
      expect(() => validateThemeV2(badSize)).toThrow(/INVALID_FONT_SIZE/);

      const badLineHeight = JSON.parse(JSON.stringify(blackCoreJson));
      badLineHeight.typography.body.lineHeight = 10; // too large
      expect(() => validateThemeV2(badLineHeight)).toThrow(/INVALID_LINE_HEIGHT/);
    });

    it("refuses strictContrast in core gate", () => {
      expect(() => compileThemeV2(blackCoreJson, { strictContrast: true })).toThrow(
        /strict contrast qualification is not implemented/
      );
    });
  });

  describe("Determinism and Canonicalization", () => {
    it("produces identical inputDigest and outputDigest across multiple compilation runs", () => {
      const run1 = compileThemeV2(blackCoreJson);
      const run2 = compileThemeV2(blackCoreJson);
      expect(run1.inputDigest).toBe(run2.inputDigest);
      expect(run1.outputDigest).toBe(run2.outputDigest);
      expect(run1.css).toBe(run2.css);
    });

    it("canonicalization deep-sorts maps and rejects URL schema metadata", () => {
      const original = canonicalizeThemeV2(blackCoreJson);
      const reordered = { ...blackCoreJson, tokenSets: Object.fromEntries(Object.entries(blackCoreJson.tokenSets).reverse()) };
      expect(canonicalizeThemeV2(reordered).inputDigest).toBe(original.inputDigest);
      expect(() => canonicalizeThemeV2({ ...blackCoreJson, $schema: "https://example.invalid/schema" })).toThrow(/UNKNOWN_KEY/);
    });;
  });

  describe("Preserves Existing V1 Untouched", () => {
    const v1Spec = {
      name: "v1-test",
      version: "1.0.0",
      schemaVersion: "tfsl.theme-v1",
      adapter: "starlight-v0.42",
      colors: {
        dark: {
          accent: { base: "#00d2ff", low: "#082b40", high: "#b8f2ff" },
          neutrals: {
            bg: "#090e17",
            bgNav: "#0d1522",
            bgSidebar: "#090e17",
            bgInlineCode: "#131d2e",
            bgAccent: "#00d2ff",
            text: "#e6f1ff",
            textAccent: "#00d2ff",
            textInvert: "#090e17",
            hairline: "#1c2b42",
            hairlineLight: "#2c4263",
            hairlineShade: "#0a101b",
          },
          grays: {
            gray1: "#e6f1ff",
            gray2: "#c4d7ed",
            gray3: "#8ea5c4",
            gray4: "#546b8a",
            gray5: "#2c4263",
            gray6: "#162438",
            gray7: "#0d1522",
          },
        },
        light: {
          accent: { base: "#0077aa", low: "#e0f6ff", high: "#004d70" },
          neutrals: {
            bg: "#f5f9fc",
            bgNav: "#ffffff",
            bgSidebar: "#f5f9fc",
            bgInlineCode: "#e8f1f8",
            bgAccent: "#0077aa",
            text: "#0d1522",
            textAccent: "#0077aa",
            textInvert: "#ffffff",
            hairline: "#d2dfed",
            hairlineLight: "#e6f0fa",
            hairlineShade: "#b8ccdf",
          },
          grays: {
            gray1: "#0d1522",
            gray2: "#24354d",
            gray3: "#4b6280",
            gray4: "#7b94b2",
            gray5: "#b0c5dd",
            gray6: "#d8e4f0",
            gray7: "#edf3f9",
          },
        },
      },
      typography: {
        bodyFont: "system-sans",
        codeFont: "system-mono",
      },
      layout: {
        contentWidth: "45rem",
        sidebarWidth: "18.75rem",
      },
    };

    it("ensures v1 validateThemeSpecification still functions as before", () => {
      const validated = validateThemeSpecification(v1Spec);
      expect(validated.schemaVersion).toBe("tfsl.theme-v1");

      const compiled = compileTheme(v1Spec);
      expect(compiled.descriptor.schema).toBe("tfsl.theme-descriptor-v1");
      expect(compiled.descriptor.schemaVersion).toBe(1);
    });

    it("v1 rejects v2 schemaVersion", () => {
      expect(() =>
        validateV1({ ...v1Spec, schemaVersion: "tfsl.theme-v2" } as any)
      ).toThrow(/Unsupported schemaVersion/);
    });
  });
});
