/**
 * @fileoverview Stellar Loom Syntax Palette Compiler and Validator (Outcome A & E).
 *
 * Compiles a semantic syntax category palette and chrome roles into a deterministic
 * CodePresentationConfig with TextMate rules and Expressive Code style overrides.
 */

import type {
  CodePresentationConfig,
  PublicEcStyleOverrides,
} from "../code/types.js";
import type {
  ColorHex,
  SyntaxCategoryColors,
  SyntaxCategoryPalette,
  SyntaxPaletteModel,
  SyntaxTheme,
} from "./types.js";

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

export const CATEGORY_TEXTMATE_SCOPES: Readonly<Record<keyof SyntaxCategoryColors, readonly string[]>> = Object.freeze({
  keyword: Object.freeze(["keyword", "keyword.control", "storage.type", "storage.modifier"]),
  string: Object.freeze(["string", "string.quoted", "string.template"]),
  number: Object.freeze(["constant.numeric"]),
  constant: Object.freeze(["constant", "constant.language", "support.constant"]),
  function: Object.freeze(["entity.name.function", "support.function"]),
  type: Object.freeze(["entity.name.type", "entity.name.class", "support.type", "support.class"]),
  variable: Object.freeze(["variable", "variable.other", "variable.parameter"]),
  comment: Object.freeze(["comment", "punctuation.definition.comment"]),
  punctuation: Object.freeze(["punctuation", "keyword.operator"]),
  tag: Object.freeze(["entity.name.tag"]),
  attribute: Object.freeze(["entity.other.attribute-name"]),
});

export const SYNTAX_CATEGORIES = Object.freeze(Object.keys(CATEGORY_TEXTMATE_SCOPES) as Array<keyof SyntaxCategoryColors>);

function assertHex(color: unknown, label: string): ColorHex {
  if (typeof color !== "string" || !HEX_COLOR_REGEX.test(color)) {
    throw new Error(`Invalid color for ${label}: expected #rrggbb hex string, received '${String(color)}'`);
  }
  return color.toLowerCase();
}

/**
 * Validates a SyntaxCategoryPalette structure and ensures all required categories exist.
 */
export function validateSyntaxCategoryPalette(raw: unknown): SyntaxCategoryPalette {
  if (!raw || typeof raw !== "object") {
    throw new Error("Syntax category palette must be an object with light and dark properties");
  }
  const obj = raw as Record<string, unknown>;
  if (!obj.light || typeof obj.light !== "object" || !obj.dark || typeof obj.dark !== "object") {
    throw new Error("Syntax category palette must contain both light and dark category objects");
  }

  const validateMode = (modeObj: Record<string, unknown>, modeName: "light" | "dark"): SyntaxCategoryColors => {
    const result: Partial<SyntaxCategoryColors> = {};
    for (const cat of SYNTAX_CATEGORIES) {
      if (!(cat in modeObj)) {
        throw new Error(`Missing required syntax category '${cat}' in ${modeName} palette`);
      }
      result[cat] = assertHex(modeObj[cat], `${modeName}.${cat}`);
    }
    return result as SyntaxCategoryColors;
  };

  return {
    light: validateMode(obj.light as Record<string, unknown>, "light"),
    dark: validateMode(obj.dark as Record<string, unknown>, "dark"),
  };
}

/**
 * Derives TextMate syntax rules from semantic categories for light and dark modes.
 */
export function deriveSyntaxTheme(palette: SyntaxCategoryPalette): SyntaxTheme {
  const compileMode = (colors: SyntaxCategoryColors) => {
    return {
      rules: SYNTAX_CATEGORIES.map((category) => ({
        scopes: [...CATEGORY_TEXTMATE_SCOPES[category]],
        foreground: colors[category],
        fontStyle: category === "comment" ? ("italic" as const) : ("normal" as const),
      })),
    };
  };

  return {
    light: compileMode(palette.light),
    dark: compileMode(palette.dark),
  };
}

/**
 * Default accessible diff indicators derived from standard accessible palettes.
 */
const DEFAULT_DIFF_MARKERS = Object.freeze({
  light: {
    marked: "#ad8301",
    inserted: "#367e3a",
    deleted: "#b93838",
    markedBackground: "#fdf6e2",
    insertedBackground: "#e8f7e9",
    deletedBackground: "#fde8e8",
  },
  dark: {
    marked: "#d0a215",
    inserted: "#58a55c",
    deleted: "#d95f5f",
    markedBackground: "#362a0e",
    insertedBackground: "#182d1a",
    deletedBackground: "#381c1c",
  },
});

/**
 * Compiles a SyntaxPaletteModel into a valid CodePresentationConfig.
 */
export function compileSyntaxPalette(model: SyntaxPaletteModel): CodePresentationConfig {
  const validatedPalette = validateSyntaxCategoryPalette(model.syntax);
  const syntaxTheme = deriveSyntaxTheme(validatedPalette);

  const lightDiff = {
    marked: model.diffs?.light?.marked ? assertHex(model.diffs.light.marked, "diffs.light.marked") : DEFAULT_DIFF_MARKERS.light.marked,
    inserted: model.diffs?.light?.inserted ? assertHex(model.diffs.light.inserted, "diffs.light.inserted") : DEFAULT_DIFF_MARKERS.light.inserted,
    deleted: model.diffs?.light?.deleted ? assertHex(model.diffs.light.deleted, "diffs.light.deleted") : DEFAULT_DIFF_MARKERS.light.deleted,
  };

  const darkDiff = {
    marked: model.diffs?.dark?.marked ? assertHex(model.diffs.dark.marked, "diffs.dark.marked") : DEFAULT_DIFF_MARKERS.dark.marked,
    inserted: model.diffs?.dark?.inserted ? assertHex(model.diffs.dark.inserted, "diffs.dark.inserted") : DEFAULT_DIFF_MARKERS.dark.inserted,
    deleted: model.diffs?.dark?.deleted ? assertHex(model.diffs.dark.deleted, "diffs.dark.deleted") : DEFAULT_DIFF_MARKERS.dark.deleted,
  };

  return {
    mode: "expressive-code",
    syntaxTheme,
    frame: model.frame || "editor",
    marks: {
      marked: { dark: darkDiff.marked, light: lightDiff.marked },
      inserted: { dark: darkDiff.inserted, light: lightDiff.inserted },
      deleted: { dark: darkDiff.deleted, light: lightDiff.deleted },
    },
    copy: model.copy || "standard",
    tabs: "deferred",
  };
}

/**
 * Derives Expressive Code style overrides for tabs, chrome, and diff markers.
 * Strictly uses valid @expressive-code 0.44.2 settings.
 */
export function deriveExpressiveCodeStyleOverrides(
  model: SyntaxPaletteModel,
  baseOverrides: PublicEcStyleOverrides
): PublicEcStyleOverrides {
  const overrides: PublicEcStyleOverrides = JSON.parse(JSON.stringify(baseOverrides));

  // 1. Editor Tabs & Frames (plugin-frames 0.44.2)
  if (model.chrome) {
    const light = model.chrome.light;
    const dark = model.chrome.dark;

    const checkPairedChromeRole = (roleName: string, darkVal?: string, lightVal?: string) => {
      if ((darkVal && !lightVal) || (!darkVal && lightVal)) {
        throw new Error(
          `[SYNTAX_PALETTE_VALIDATION_ERROR] Chrome role '${roleName}' must be defined in both dark and light modes, but was only defined in ${darkVal ? "dark" : "light"}.`
        );
      }
    };

    checkPairedChromeRole("background", dark?.background, light?.background);
    checkPairedChromeRole("foreground", dark?.foreground, light?.foreground);
    checkPairedChromeRole("border", dark?.border, light?.border);
    checkPairedChromeRole("tabBarBackground", dark?.tabBarBackground, light?.tabBarBackground);
    checkPairedChromeRole("tabBarBorder", dark?.tabBarBorder, light?.tabBarBorder);
    checkPairedChromeRole("activeTabBackground", dark?.activeTabBackground, light?.activeTabBackground);
    checkPairedChromeRole("activeTabForeground", dark?.activeTabForeground, light?.activeTabForeground);
    checkPairedChromeRole("activeTabBorder", dark?.activeTabBorder, light?.activeTabBorder);
    checkPairedChromeRole("activeTabIndicator", dark?.activeTabIndicator, light?.activeTabIndicator);
    checkPairedChromeRole("focus", dark?.focus, light?.focus);
    checkPairedChromeRole("terminalTitlebarBackground", dark?.terminalTitlebarBackground, light?.terminalTitlebarBackground);
    checkPairedChromeRole("terminalTitlebarForeground", dark?.terminalTitlebarForeground, light?.terminalTitlebarForeground);
    checkPairedChromeRole("copyButtonForeground", dark?.copyButtonForeground, light?.copyButtonForeground);
    checkPairedChromeRole("copyButtonBorder", dark?.copyButtonBorder, light?.copyButtonBorder);
    checkPairedChromeRole("tooltipSuccessBackground", dark?.tooltipSuccessBackground, light?.tooltipSuccessBackground);
    checkPairedChromeRole("tooltipSuccessForeground", dark?.tooltipSuccessForeground, light?.tooltipSuccessForeground);

    if (dark?.background && light?.background) {
      const dbg = assertHex(dark.background, "chrome.dark.background");
      const lbg = assertHex(light.background, "chrome.light.background");
      overrides.codeBackground = [dbg, lbg];
      overrides.frames.editorBackground = [dbg, lbg];
      overrides.frames.terminalBackground = [dbg, lbg];
    }
    if (dark?.foreground && light?.foreground) {
      overrides.codeForeground = [
        assertHex(dark.foreground, "chrome.dark.foreground"),
        assertHex(light.foreground, "chrome.light.foreground"),
      ];
    }
    if (dark?.border && light?.border) {
      const db = assertHex(dark.border, "chrome.dark.border");
      const lb = assertHex(light.border, "chrome.light.border");
      overrides.borderColor = [db, lb];
      overrides.frames.editorTabBarBorderColor = [db, lb];
      overrides.frames.editorTabBarBorderBottomColor = [db, lb];
      overrides.frames.editorActiveTabBorderColor = [db, lb];
    }
    if (dark?.tabBarBackground && light?.tabBarBackground) {
      overrides.frames.editorTabBarBackground = [
        assertHex(dark.tabBarBackground, "chrome.dark.tabBarBackground"),
        assertHex(light.tabBarBackground, "chrome.light.tabBarBackground"),
      ];
    }
    if (dark?.tabBarBorder && light?.tabBarBorder) {
      const dtb = assertHex(dark.tabBarBorder, "chrome.dark.tabBarBorder");
      const ltb = assertHex(light.tabBarBorder, "chrome.light.tabBarBorder");
      overrides.frames.editorTabBarBorderColor = [dtb, ltb];
      overrides.frames.editorTabBarBorderBottomColor = [dtb, ltb];
    }
    if (dark?.activeTabBackground && light?.activeTabBackground) {
      overrides.frames.editorActiveTabBackground = [
        assertHex(dark.activeTabBackground, "chrome.dark.activeTabBackground"),
        assertHex(light.activeTabBackground, "chrome.light.activeTabBackground"),
      ];
    }
    if (dark?.activeTabForeground && light?.activeTabForeground) {
      overrides.frames.editorActiveTabForeground = [
        assertHex(dark.activeTabForeground, "chrome.dark.activeTabForeground"),
        assertHex(light.activeTabForeground, "chrome.light.activeTabForeground"),
      ];
    }
    if (dark?.activeTabBorder && light?.activeTabBorder) {
      overrides.frames.editorActiveTabBorderColor = [
        assertHex(dark.activeTabBorder, "chrome.dark.activeTabBorder"),
        assertHex(light.activeTabBorder, "chrome.light.activeTabBorder"),
      ];
    }
    if (dark?.focus && light?.focus) {
      overrides.focusBorder = [
        assertHex(dark.focus, "chrome.dark.focus"),
        assertHex(light.focus, "chrome.light.focus"),
      ];
    }
    if (dark?.terminalTitlebarBackground && light?.terminalTitlebarBackground) {
      overrides.frames.terminalTitlebarBackground = [
        assertHex(dark.terminalTitlebarBackground, "chrome.dark.terminalTitlebarBackground"),
        assertHex(light.terminalTitlebarBackground, "chrome.light.terminalTitlebarBackground"),
      ];
    }
    if (dark?.terminalTitlebarForeground && light?.terminalTitlebarForeground) {
      overrides.frames.terminalTitlebarForeground = [
        assertHex(dark.terminalTitlebarForeground, "chrome.dark.terminalTitlebarForeground"),
        assertHex(light.terminalTitlebarForeground, "chrome.light.terminalTitlebarForeground"),
      ];
    }
    if (dark?.copyButtonForeground && light?.copyButtonForeground) {
      overrides.frames.inlineButtonForeground = [
        assertHex(dark.copyButtonForeground, "chrome.dark.copyButtonForeground"),
        assertHex(light.copyButtonForeground, "chrome.light.copyButtonForeground"),
      ];
    }
    if (dark?.copyButtonBorder && light?.copyButtonBorder) {
      overrides.frames.inlineButtonBorder = [
        assertHex(dark.copyButtonBorder, "chrome.dark.copyButtonBorder"),
        assertHex(light.copyButtonBorder, "chrome.light.copyButtonBorder"),
      ];
    }
    if (dark?.tooltipSuccessBackground && light?.tooltipSuccessBackground) {
      overrides.frames.tooltipSuccessBackground = [
        assertHex(dark.tooltipSuccessBackground, "chrome.dark.tooltipSuccessBackground"),
        assertHex(light.tooltipSuccessBackground, "chrome.light.tooltipSuccessBackground"),
      ];
    }
    if (dark?.tooltipSuccessForeground && light?.tooltipSuccessForeground) {
      overrides.frames.tooltipSuccessForeground = [
        assertHex(dark.tooltipSuccessForeground, "chrome.dark.tooltipSuccessForeground"),
        assertHex(light.tooltipSuccessForeground, "chrome.light.tooltipSuccessForeground"),
      ];
    }
  }

  // 2. Active Tab Indicator styling (plugin-frames settings)
  if (model.tabs?.activeIndicator) {
    const indicatorType = model.tabs.activeIndicator;
    // Map indicator into valid Expressive Code settings
    overrides.frames.editorActiveTabIndicatorHeight = "2px";
    const indicatorColor: [string, string] | undefined =
      model.chrome?.dark?.activeTabIndicator && model.chrome?.light?.activeTabIndicator
        ? [
            assertHex(model.chrome.dark.activeTabIndicator, "chrome.dark.activeTabIndicator"),
            assertHex(model.chrome.light.activeTabIndicator, "chrome.light.activeTabIndicator"),
          ]
        : overrides.focusBorder
          ? [overrides.focusBorder[0], overrides.focusBorder[1]]
          : undefined;

    if (indicatorType === "top") {
      overrides.frames.editorActiveTabIndicatorTopColor = indicatorColor ? [...indicatorColor] : undefined;
    } else if (indicatorType === "bottom" || indicatorType === "accent" || indicatorType === "border") {
      overrides.frames.editorActiveTabIndicatorBottomColor = indicatorColor ? [...indicatorColor] : undefined;
    }
  }

  // 3. Diff Markers (plugin-text-markers 0.44.2)
  if (model.diffs) {
    const light = model.diffs.light;
    const dark = model.diffs.dark;

    const checkPairedDiffRole = (roleName: string, darkVal?: string, lightVal?: string) => {
      if ((darkVal && !lightVal) || (!darkVal && lightVal)) {
        throw new Error(
          `[SYNTAX_PALETTE_VALIDATION_ERROR] Diff role '${roleName}' must be defined in both dark and light modes, but was only defined in ${darkVal ? "dark" : "light"}.`
        );
      }
    };

    checkPairedDiffRole("inserted", dark?.inserted, light?.inserted);
    checkPairedDiffRole("deleted", dark?.deleted, light?.deleted);
    checkPairedDiffRole("marked", dark?.marked, light?.marked);
    checkPairedDiffRole("insertedBackground", dark?.insertedBackground, light?.insertedBackground);
    checkPairedDiffRole("deletedBackground", dark?.deletedBackground, light?.deletedBackground);
    checkPairedDiffRole("markedBackground", dark?.markedBackground, light?.markedBackground);

    if (dark?.inserted && light?.inserted) {
      overrides.textMarkers.insBorderColor = [dark.inserted, light.inserted];
      overrides.textMarkers.insDiffIndicatorColor = [dark.inserted, light.inserted];
    }
    if (dark?.deleted && light?.deleted) {
      overrides.textMarkers.delBorderColor = [dark.deleted, light.deleted];
      overrides.textMarkers.delDiffIndicatorColor = [dark.deleted, light.deleted];
    }
    if (dark?.marked && light?.marked) {
      overrides.textMarkers.markBorderColor = [dark.marked, light.marked];
    }
    if (dark?.insertedBackground && light?.insertedBackground) {
      overrides.textMarkers.insBackground = [dark.insertedBackground, light.insertedBackground];
    }
    if (dark?.deletedBackground && light?.deletedBackground) {
      overrides.textMarkers.delBackground = [dark.deletedBackground, light.deletedBackground];
    }
    if (dark?.markedBackground && light?.markedBackground) {
      overrides.textMarkers.markBackground = [dark.markedBackground, light.markedBackground];
    }
  }

  return overrides;
}
