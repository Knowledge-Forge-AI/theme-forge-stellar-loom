import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateThemeSpecification, ValidationError } from "../src/schema/validator.js";

const VALID_SPEC = {
  name: "test-theme",
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
        gray6: "#dce7f3",
        gray7: "#f0f5fa",
      },
    },
  },
  typography: {
    bodyFont: "system-sans",
    codeFont: "system-mono",
    baseFontSize: "16px",
    lineHeight: 1.75,
  },
  layout: {
    contentWidth: "48rem",
    sidebarWidth: "19rem",
  },
};

describe("Theme Specification Validator", () => {
  it("accepts a valid theme specification", () => {
    const spec = validateThemeSpecification(VALID_SPEC);
    expect(spec.name).toBe("test-theme");
    expect(spec.schemaVersion).toBe("tfsl.theme-v1");
    expect(spec.adapter).toBe("starlight-v0.42");
  });

  it("accepts example theme specifications on disk", async () => {
    const cyanPath = resolve(__dirname, "../examples/stellar-cyan.theme.json");
    const cyanContent = JSON.parse(await readFile(cyanPath, "utf8"));
    const cyan = validateThemeSpecification(cyanContent);
    expect(cyan.name).toBe("stellar-cyan");

    const amberPath = resolve(__dirname, "../examples/amber-forge.theme.json");
    const amberContent = JSON.parse(await readFile(amberPath, "utf8"));
    const amber = validateThemeSpecification(amberContent);
    expect(amber.name).toBe("amber-forge");
  });

  it("rejects non-object inputs", () => {
    expect(() => validateThemeSpecification(null)).toThrow(ValidationError);
    expect(() => validateThemeSpecification("not a theme")).toThrow(ValidationError);
    expect(() => validateThemeSpecification([1, 2, 3])).toThrow(ValidationError);
  });

  it("rejects unknown root keys", () => {
    const invalid = { ...VALID_SPEC, maliciousPayload: "malicious" };
    expect(() => validateThemeSpecification(invalid)).toThrow(/Unknown key 'maliciousPayload'/);
  });

  it("rejects unknown nested keys in colors", () => {
    const invalid = JSON.parse(JSON.stringify(VALID_SPEC));
    invalid.colors.dark.accent.extraKey = "#123456";
    expect(() => validateThemeSpecification(invalid)).toThrow(/Unknown key 'extraKey'/);
  });

  it("rejects unsupported schemaVersion and adapter", () => {
    expect(() => validateThemeSpecification({ ...VALID_SPEC, schemaVersion: "tfsl.theme-v2" })).toThrow(
      /Unsupported schemaVersion/
    );
    expect(() => validateThemeSpecification({ ...VALID_SPEC, adapter: "nextjs-v1" })).toThrow(
      /Unsupported adapter/
    );
  });

  it("rejects invalid color formats and dangerous CSS injection strings", () => {
    const injectionCases = [
      "red",
      "#123",
      "#12345678",
      "#gggggg",
      "url('http://attacker.com/leak')",
      "expression(alert(1))",
      "<script>alert(1)</script>",
      "#000000; } body { display: none; } /*",
      "/* comment */ #000000",
      "#112233; color: red",
    ];

    for (const badColor of injectionCases) {
      const invalid = JSON.parse(JSON.stringify(VALID_SPEC));
      invalid.colors.dark.accent.base = badColor;
      expect(() => validateThemeSpecification(invalid)).toThrow(ValidationError);
    }
  });

  it("rejects custom prototype objects", () => {
    const customProto = Object.create({ inherited: "prop" });
    Object.assign(customProto, VALID_SPEC);

    try {
      validateThemeSpecification(customProto);
      expect.unreachable("Should have thrown ValidationError");
    } catch (err: any) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.code).toBe("INVALID_PROTOTYPE");
      expect(err.message).toContain("custom prototype");
    }
  });

  it("provides stable, structured ValidationError codes and fieldPaths", () => {
    const invalidType = { ...VALID_SPEC, colors: "not-an-object" };
    try {
      validateThemeSpecification(invalidType);
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.code).toBe("INVALID_TYPE");
      expect(err.fieldPath).toBe("root.colors");
    }

    const unknownKey = { ...VALID_SPEC, surpriseField: 123 };
    try {
      validateThemeSpecification(unknownKey);
      expect.unreachable("Should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.code).toBe("UNKNOWN_KEY");
      expect(err.fieldPath).toBe("root");
    }
  });

  it("strictly aligns SemVer validation with SemVer 2.0.0 grammar", () => {
    // Valid SemVer 2.0.0
    const validVersions = ["0.1.0", "1.0.0", "2.10.3", "1.0.0-alpha.1", "1.0.0-beta+exp.sha.5114f85"];
    for (const v of validVersions) {
      const spec = validateThemeSpecification({ ...VALID_SPEC, version: v });
      expect(spec.version).toBe(v);
    }

    // Invalid SemVer 2.0.0 (leading zeros, malformed)
    const invalidVersions = ["01.0.0", "1.02.0", "1.0.03", "v1.0.0", "1.0", "1.0.0.0"];
    for (const v of invalidVersions) {
      try {
        validateThemeSpecification({ ...VALID_SPEC, version: v });
        expect.unreachable(`Expected failure for SemVer: ${v}`);
      } catch (err: any) {
        expect(err).toBeInstanceOf(ValidationError);
        expect(err.code).toBe("INVALID_FORMAT");
        expect(err.fieldPath).toBe("root.version");
      }
    }
  });

  it("enforces finite positive unit-aware bounds on dimensions", () => {
    // Zero dimensions must be rejected
    const zeroCases = [
      { field: "contentWidth", val: "0px" },
      { field: "contentWidth", val: "0rem" },
      { field: "sidebarWidth", val: "0em" },
      { field: "sidebarWidth", val: "0ch" },
    ];
    for (const { field, val } of zeroCases) {
      const invalid = JSON.parse(JSON.stringify(VALID_SPEC));
      invalid.layout[field] = val;
      try {
        validateThemeSpecification(invalid);
        expect.unreachable(`Expected failure for zero dimension: ${val}`);
      } catch (err: any) {
        expect(err).toBeInstanceOf(ValidationError);
        expect(err.code).toBe("OUT_OF_BOUNDS");
      }
    }

    // Out of bounds cases
    const outOfBoundsCases = [
      { field: "contentWidth", val: "100px" },    // below min 320px
      { field: "contentWidth", val: "5000px" },   // above max 3840px
      { field: "contentWidth", val: "10rem" },    // below min 20rem
      { field: "contentWidth", val: "300rem" },   // above max 240rem
      { field: "sidebarWidth", val: "100px" },    // below min 160px
      { field: "sidebarWidth", val: "1000px" },   // above max 600px
      { field: "sidebarWidth", val: "5rem" },     // below min 10rem
      { field: "sidebarWidth", val: "60rem" },    // above max 40rem
    ];
    for (const { field, val } of outOfBoundsCases) {
      const invalid = JSON.parse(JSON.stringify(VALID_SPEC));
      invalid.layout[field] = val;
      try {
        validateThemeSpecification(invalid);
        expect.unreachable(`Expected failure for out of bounds: ${val}`);
      } catch (err: any) {
        expect(err).toBeInstanceOf(ValidationError);
        expect(err.code).toBe("OUT_OF_BOUNDS");
      }
    }
  });

  it("normalizes dimension number and unit spelling canonically", () => {
    const specRaw = JSON.parse(JSON.stringify(VALID_SPEC));
    specRaw.typography.baseFontSize = "16.0PX";
    specRaw.layout.contentWidth = "048.00REM";
    specRaw.layout.sidebarWidth = "19.000rem";

    const spec = validateThemeSpecification(specRaw);
    expect(spec.typography.baseFontSize).toBe("16px");
    expect(spec.layout.contentWidth).toBe("48rem");
    expect(spec.layout.sidebarWidth).toBe("19rem");
  });

  it("handles optional $schema correctly and preserves it in specification", () => {
    const withSchema = { ...VALID_SPEC, $schema: "https://example.com/schema.json" };
    const spec = validateThemeSpecification(withSchema);
    expect(spec.$schema).toBe("https://example.com/schema.json");

    // Rejects non-string $schema
    const invalidSchemaType = { ...VALID_SPEC, $schema: 12345 };
    expect(() => validateThemeSpecification(invalidSchemaType)).toThrow(ValidationError);

    // Rejects dangerous pattern in $schema
    const dangerousSchema = { ...VALID_SPEC, $schema: "expression(alert(1))" };
    expect(() => validateThemeSpecification(dangerousSchema)).toThrow(ValidationError);
  });

  it("rejects invalid dimension formats and lineHeight bounds", () => {
    const badDimensions = ["100", "45percent", "calc(100% - 20px)", "url(x)", "10px; color: red"];
    for (const badDim of badDimensions) {
      const invalid = JSON.parse(JSON.stringify(VALID_SPEC));
      invalid.layout.contentWidth = badDim;
      expect(() => validateThemeSpecification(invalid)).toThrow(ValidationError);
    }

    const invalidFont = JSON.parse(JSON.stringify(VALID_SPEC));
    invalidFont.typography.bodyFont = "comic-sans";
    expect(() => validateThemeSpecification(invalidFont)).toThrow(/Invalid bodyFont/);

    const invalidLineHeightLow = JSON.parse(JSON.stringify(VALID_SPEC));
    invalidLineHeightLow.typography.lineHeight = 0.5;
    expect(() => validateThemeSpecification(invalidLineHeightLow)).toThrow(/Invalid lineHeight/);

    const invalidLineHeightHigh = JSON.parse(JSON.stringify(VALID_SPEC));
    invalidLineHeightHigh.typography.lineHeight = 4.0;
    expect(() => validateThemeSpecification(invalidLineHeightHigh)).toThrow(/Invalid lineHeight/);
  });
});
