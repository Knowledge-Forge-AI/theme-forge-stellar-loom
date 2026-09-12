import {
  COLOR_ROLES,
  type ColorRole,
} from "../v2/types.js";
import { resolveToken, ValidationErrorV2 } from "../v2/validator.js";
import { validateThemeCode } from "./validator.js";
import type {
  CodeFrame,
  MarkColor,
  PublicEcFramesStyleOverrides,
  PublicEcStyleOverrides,
  PublicEcTextMarkersStyleOverrides,
  PublicEcTheme,
  PublicEcTokenColorRule,
  PublicExpressiveCodeConfig,
  ThemeSpecificationCode,
} from "./types.js";

const FRAME_MAP: Record<CodeFrame, "none" | "code" | "terminal"> = {
  plain: "none",
  editor: "code",
  terminal: "terminal",
};

function toColorPair(mark: MarkColor): [string, string] {
  if (typeof mark === "string") {
    return [mark, mark];
  }
  return [mark.dark, mark.light];
}

/**
 * Converts a ThemeSpecificationCode into public Expressive Code configuration.
 * Produces explicit plain light/dark themes with tokenColors, useStarlightUiThemeColors: false,
 * mapped defaultProps.frame (none/code/terminal), and frames/textMarkers style overrides
 * populated from theme tokens and roles.
 */
export function createCodeDefaults(
  spec: ThemeSpecificationCode | unknown,
  accent?: string | { accent?: string }
): PublicExpressiveCodeConfig {
  const codeSpec = validateThemeCode(spec);

  const activeAccent =
    (typeof accent === "string" ? accent : accent?.accent) ??
    codeSpec.defaultAccent;

  if (!Object.hasOwn(codeSpec.accentVariants, activeAccent)) {
    throw new ValidationErrorV2(
      `Unknown accent variant '${activeAccent}'`,
      "accent",
      "UNKNOWN_ACCENT"
    );
  }

  const variant = codeSpec.accentVariants[activeAccent]!;
  const resolvedLight: Record<ColorRole, string> = {} as any;
  const resolvedDark: Record<ColorRole, string> = {} as any;

  for (const role of COLOR_ROLES) {
    resolvedLight[role] = resolveToken(
      codeSpec.tokenSets,
      variant.tokenSet,
      variant.light[role]!,
      activeAccent,
      role,
      "light"
    );
    resolvedDark[role] = resolveToken(
      codeSpec.tokenSets,
      variant.tokenSet,
      variant.dark[role]!,
      activeAccent,
      role,
      "dark"
    );
  }

  // 1. Explicit plain light/dark themes with tokenColors from rules
  const darkTokenColors: PublicEcTokenColorRule[] =
    codeSpec.codePresentation.syntaxTheme.dark.rules.map((rule) => ({
      scope: [...rule.scopes],
      settings: {
        foreground: rule.foreground,
        ...(rule.background !== undefined ? { background: rule.background } : {}),
        ...(rule.fontStyle !== undefined ? { fontStyle: rule.fontStyle === "normal" ? "" : rule.fontStyle } : {}),
      },
    }));

  const lightTokenColors: PublicEcTokenColorRule[] =
    codeSpec.codePresentation.syntaxTheme.light.rules.map((rule) => ({
      scope: [...rule.scopes],
      settings: {
        foreground: rule.foreground,
        ...(rule.background !== undefined ? { background: rule.background } : {}),
        ...(rule.fontStyle !== undefined ? { fontStyle: rule.fontStyle === "normal" ? "" : rule.fontStyle } : {}),
      },
    }));

  const darkTheme: PublicEcTheme = {
    name: `${codeSpec.name}-dark`,
    type: "dark",
    bg: resolvedDark.code,
    fg: resolvedDark.body,
    tokenColors: darkTokenColors,
  };

  const lightTheme: PublicEcTheme = {
    name: `${codeSpec.name}-light`,
    type: "light",
    bg: resolvedLight.code,
    fg: resolvedLight.body,
    tokenColors: lightTokenColors,
  };

  const themes = [darkTheme, lightTheme];

  // 2. defaultProps.frame: plain -> none, editor -> code, terminal -> terminal
  const defaultProps = {
    frame: FRAME_MAP[codeSpec.codePresentation.frame],
  };

  // 3. styleOverrides: frames and textMarkers leaves
  const [markedDark, markedLight] = toColorPair(codeSpec.codePresentation.marks.marked);
  const [insDark, insLight] = toColorPair(codeSpec.codePresentation.marks.inserted);
  const [delDark, delLight] = toColorPair(codeSpec.codePresentation.marks.deleted);

  const isMinimalCopy = codeSpec.codePresentation.copy === "minimal";

  const frames: PublicEcFramesStyleOverrides = {
    editorBackground: [resolvedDark.code, resolvedLight.code],
    editorActiveTabBackground: [resolvedDark.code, resolvedLight.code],
    editorActiveTabForeground: [resolvedDark.body, resolvedLight.body],
    editorActiveTabBorderColor: [resolvedDark.border, resolvedLight.border],
    editorTabBarBackground: [resolvedDark.raised, resolvedLight.raised],
    editorTabBarBorderColor: [resolvedDark.border, resolvedLight.border],
    editorTabBarBorderBottomColor: [resolvedDark.border, resolvedLight.border],
    editorTabBorderRadius: `${codeSpec.surfaces.radii}px`,
    terminalBackground: [resolvedDark.code, resolvedLight.code],
    terminalTitlebarBackground: [resolvedDark.raised, resolvedLight.raised],
    terminalTitlebarForeground: [resolvedDark.secondary, resolvedLight.secondary],
    terminalTitlebarBorderBottomColor: [resolvedDark.border, resolvedLight.border],
    inlineButtonForeground: [resolvedDark.secondary, resolvedLight.secondary],
    inlineButtonBorder: [resolvedDark.border, resolvedLight.border],
    inlineButtonBorderOpacity: isMinimalCopy ? "0" : "0.4",
    inlineButtonBackgroundIdleOpacity: "0",
    tooltipSuccessBackground: [
      resolvedDark["accent-base"],
      resolvedLight["accent-base"],
    ],
    tooltipSuccessForeground: [
      resolvedDark.inverted,
      resolvedLight.inverted,
    ],
  };

  const textMarkers: PublicEcTextMarkersStyleOverrides = {
    markBackground: [markedDark, markedLight],
    markBorderColor: [markedDark, markedLight],
    insBackground: [insDark, insLight],
    insBorderColor: [insDark, insLight],
    insDiffIndicatorColor: [insDark, insLight],
    delBackground: [delDark, delLight],
    delBorderColor: [delDark, delLight],
    delDiffIndicatorColor: [delDark, delLight],
  };

  const styleOverrides: PublicEcStyleOverrides = {
    codeFontFamily: "var(--tfsl-font-code)",
    codeFontSize: `${codeSpec.typography.code.size}px`,
    codeLineHeight: String(codeSpec.typography.code.lineHeight),
    borderRadius: `${codeSpec.surfaces.radii}px`,
    borderWidth: `${codeSpec.surfaces.border}px`,
    borderColor: [resolvedDark.border, resolvedLight.border],
    focusBorder: [resolvedDark.focus, resolvedLight.focus],
    codeBackground: [resolvedDark.code, resolvedLight.code],
    codeForeground: [resolvedDark.body, resolvedLight.body],
    frames,
    textMarkers,
  };

  return {
    themes,
    useStarlightUiThemeColors: false,
    defaultProps,
    styleOverrides,
  };
}
