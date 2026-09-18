import { describe, expect, it } from "vitest";
import {
  CATEGORY_TEXTMATE_SCOPES,
  SYNTAX_CATEGORIES,
  validateSyntaxCategoryPalette,
  deriveSyntaxTheme,
  compileSyntaxPalette,
  deriveExpressiveCodeStyleOverrides,
  CODE_TABS_CSS,
  TABS_CAPABILITIES,
  type SyntaxCategoryPalette,
  type SyntaxPaletteModel,
} from "../src/index-catalog.js";
import type { PublicEcStyleOverrides } from "../src/code/types.js";

const VALID_PALETTE: SyntaxCategoryPalette = {
  light: {
    comment: "#6f6e69",
    string: "#24837b",
    number: "#bc5215",
    constant: "#ad8301",
    keyword: "#a02f6f",
    function: "#205ea6",
    type: "#24837b",
    variable: "#5e409d",
    punctuation: "#6f6e69",
    tag: "#a02f6f",
    attribute: "#24837b",
  },
  dark: {
    comment: "#878580",
    string: "#3aa99f",
    number: "#da702c",
    constant: "#d0a215",
    keyword: "#ce5d97",
    function: "#4385be",
    type: "#3aa99f",
    variable: "#8b7ec8",
    punctuation: "#878580",
    tag: "#ce5d97",
    attribute: "#3aa99f",
  },
};

describe("Stellar Loom Syntax Palette Model", () => {
  describe("Outcome A: TextMate Scope Mapping & Validation", () => {
    it("defines scopes for all 11 semantic categories", () => {
      expect(SYNTAX_CATEGORIES).toHaveLength(11);
      for (const cat of SYNTAX_CATEGORIES) {
        const scopes = CATEGORY_TEXTMATE_SCOPES[cat];
        expect(Array.isArray(scopes)).toBe(true);
        expect(scopes.length).toBeGreaterThan(0);
      }
    });

    it("validates valid syntax category palettes and normalizes hex", () => {
      const validated = validateSyntaxCategoryPalette(VALID_PALETTE);
      expect(validated.light.keyword).toBe("#a02f6f");
      expect(validated.dark.keyword).toBe("#ce5d97");
    });

    it("rejects invalid hex colors and missing categories", () => {
      expect(() => validateSyntaxCategoryPalette(null)).toThrow(
        "Syntax category palette must be an object"
      );

      const missingCategory = JSON.parse(JSON.stringify(VALID_PALETTE));
      delete missingCategory.light.comment;
      expect(() => validateSyntaxCategoryPalette(missingCategory)).toThrow(
        "Missing required syntax category 'comment' in light palette"
      );

      const invalidHex = JSON.parse(JSON.stringify(VALID_PALETTE));
      invalidHex.dark.string = "not-a-color";
      expect(() => validateSyntaxCategoryPalette(invalidHex)).toThrow(
        "Invalid color for dark.string: expected #rrggbb hex string"
      );
    });

    it("derives deterministic TextMate syntax rules for light and dark modes", () => {
      const syntaxTheme = deriveSyntaxTheme(VALID_PALETTE);
      expect(syntaxTheme.light.rules).toHaveLength(11);
      expect(syntaxTheme.dark.rules).toHaveLength(11);

      const lightCommentRule = syntaxTheme.light.rules.find((r) =>
        r.scopes.includes("comment")
      );
      expect(lightCommentRule?.foreground).toBe("#6f6e69");
      expect(lightCommentRule?.fontStyle).toBe("italic");

      const lightStringRule = syntaxTheme.light.rules.find((r) =>
        r.scopes.includes("string")
      );
      expect(lightStringRule?.foreground).toBe("#24837b");
      expect(lightStringRule?.fontStyle).toBe("normal");

      const darkCommentRule = syntaxTheme.dark.rules.find((r) =>
        r.scopes.includes("comment")
      );
      expect(darkCommentRule?.foreground).toBe("#878580");
      expect(darkCommentRule?.fontStyle).toBe("italic");
    });

    it("compiles SyntaxPaletteModel into CodePresentationConfig", () => {
      const model: SyntaxPaletteModel = {
        syntax: VALID_PALETTE,
        frame: "editor",
        copy: "standard",
      };
      const presentation = compileSyntaxPalette(model);
      expect(presentation.mode).toBe("expressive-code");
      expect(presentation.frame).toBe("editor");
      expect(presentation.copy).toBe("standard");
      expect(presentation.tabs).toBe("deferred");
      expect((presentation.marks.marked as any).light).toBeDefined();
      expect((presentation.marks.marked as any).dark).toBeDefined();
    });
  });

  describe("Outcome B & E: Expressive Code 0.44.2 Style Overrides & Chrome Roles", () => {
    it("maps chrome colors and diff roles into valid EC 0.44.2 settings", () => {
      const model: SyntaxPaletteModel = {
        syntax: VALID_PALETTE,
        chrome: {
          light: {
            background: "#fffcf0",
            foreground: "#100f0f",
            border: "#cecdc3",
            focus: "#24837b",
            tabBarBackground: "#f2f0e5",
            tabBarBorder: "#cecdc3",
            activeTabBackground: "#fffcf0",
            activeTabForeground: "#100f0f",
            activeTabBorder: "#cecdc3",
            terminalTitlebarBackground: "#f2f0e5",
            terminalTitlebarForeground: "#100f0f",
            copyButtonForeground: "#6f6e69",
            copyButtonBorder: "#cecdc3",
            tooltipSuccessBackground: "#24837b",
            tooltipSuccessForeground: "#ffffff",
          },
          dark: {
            background: "#100f0f",
            foreground: "#cecdc3",
            border: "#343331",
            focus: "#3aa99f",
            tabBarBackground: "#1c1b1a",
            tabBarBorder: "#343331",
            activeTabBackground: "#100f0f",
            activeTabForeground: "#cecdc3",
            activeTabBorder: "#343331",
            terminalTitlebarBackground: "#1c1b1a",
            terminalTitlebarForeground: "#cecdc3",
            copyButtonForeground: "#878580",
            copyButtonBorder: "#343331",
            tooltipSuccessBackground: "#3aa99f",
            tooltipSuccessForeground: "#100f0f",
          },
        },
        diffs: {
          light: {
            marked: "#ad8301",
            inserted: "#66800b",
            deleted: "#af3029",
            markedBackground: "#fdf8e6",
            insertedBackground: "#f2f5e8",
            deletedBackground: "#fbeeed",
          },
          dark: {
            marked: "#d0a215",
            inserted: "#879a39",
            deleted: "#d14d41",
            markedBackground: "#2b2513",
            insertedBackground: "#202414",
            deletedBackground: "#2c1716",
          },
        },
        tabs: {
          activeIndicator: "bottom",
        },
      };

      const baseOverrides = {
        codeFontFamily: "monospace",
        codeFontSize: "14px",
        codeLineHeight: "1.5",
        borderRadius: "0.25rem",
        borderWidth: "1px",
        borderColor: ["#343331", "#cecdc3"] as [string, string],
        focusBorder: ["#3aa99f", "#24837b"] as [string, string],
        codeBackground: ["#100f0f", "#fffcf0"] as [string, string],
        codeForeground: ["#cecdc3", "#100f0f"] as [string, string],
        frames: {
          editorBackground: ["#100f0f", "#fffcf0"] as [string, string],
          terminalBackground: ["#100f0f", "#fffcf0"] as [string, string],
          editorTabBarBackground: ["#1c1b1a", "#f2f0e5"] as [string, string],
          editorTabBarBorderColor: ["#343331", "#cecdc3"] as [string, string],
          editorTabBarBorderBottomColor: ["#343331", "#cecdc3"] as [string, string],
          editorActiveTabBackground: ["#100f0f", "#fffcf0"] as [string, string],
          editorActiveTabForeground: ["#cecdc3", "#100f0f"] as [string, string],
          editorActiveTabBorderColor: ["#343331", "#cecdc3"] as [string, string],
        },
        textMarkers: {
          lineMarkerAccentMargin: "0px",
          markBorderColor: ["#d0a215", "#ad8301"] as [string, string],
          insBorderColor: ["#879a39", "#66800b"] as [string, string],
          insDiffIndicatorColor: ["#879a39", "#66800b"] as [string, string],
          delBorderColor: ["#d14d41", "#af3029"] as [string, string],
          delDiffIndicatorColor: ["#d14d41", "#af3029"] as [string, string],
        },
      };

      const derived = deriveExpressiveCodeStyleOverrides(
        model,
        baseOverrides as unknown as PublicEcStyleOverrides
      );
      expect(derived.codeBackground).toEqual(["#100f0f", "#fffcf0"]);
      expect(derived.focusBorder).toEqual(["#3aa99f", "#24837b"]);
      expect(derived.frames.editorTabBarBackground).toEqual(["#1c1b1a", "#f2f0e5"]);
      expect(derived.frames.terminalTitlebarBackground).toEqual(["#1c1b1a", "#f2f0e5"]);
      expect(derived.frames.terminalTitlebarForeground).toEqual(["#cecdc3", "#100f0f"]);
      expect(derived.frames.inlineButtonForeground).toEqual(["#878580", "#6f6e69"]);
      expect(derived.frames.inlineButtonBorder).toEqual(["#343331", "#cecdc3"]);
      expect(derived.frames.tooltipSuccessBackground).toEqual(["#3aa99f", "#24837b"]);
      expect(derived.frames.tooltipSuccessForeground).toEqual(["#100f0f", "#ffffff"]);
      expect(derived.textMarkers.insBorderColor).toEqual(["#879a39", "#66800b"]);
      expect(derived.textMarkers.insBackground).toEqual(["#202414", "#f2f5e8"]);
      expect((derived.frames as any).editorActiveTabIndicatorBottomColor).toEqual([
        "#3aa99f",
        "#24837b",
      ]);

      // Compilation determinism verification (Outcome A & E)
      const presentation1 = compileSyntaxPalette(model);
      const presentation2 = compileSyntaxPalette(model);
      expect(JSON.stringify(presentation1)).toBe(JSON.stringify(presentation2));
    });
  });

  describe("Outcome C: Tabs Integration & Capabilities", () => {
    it("emits tabs CSS strictly in @layer tfsl.overrides with zero !important", () => {
      expect(CODE_TABS_CSS).toContain("@layer tfsl.overrides");
      expect(CODE_TABS_CSS).not.toContain("!important");
      expect(CODE_TABS_CSS).toContain("starlight-tabs");
      expect(CODE_TABS_CSS).toContain("[role=\"tablist\"]");
    });

    it("records precise tabs capability boundaries", () => {
      expect(TABS_CAPABILITIES.supportsCodeTitleTabs).toBe(true);
      expect(TABS_CAPABILITIES.supportsPackageManagerTabs).toBe(true);
      expect(TABS_CAPABILITIES.supportsNativeMarkdownMultiTabs).toBe(false);
      expect(TABS_CAPABILITIES.boundaryNote).toContain("Starlight 0.42.0");
    });
  });
});
