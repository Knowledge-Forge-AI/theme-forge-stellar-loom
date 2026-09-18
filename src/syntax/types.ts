/**
 * @fileoverview Types for Stellar Loom Syntax Palette Model (Outcome A & E).
 *
 * Defines explicit semantic syntax categories and code chrome roles that
 * deterministically compile into Expressive Code syntax themes and style overrides.
 */

import type {
  CodePresentationConfig,
  ColorHex,
  SyntaxTheme,
} from "../code/types.js";
export type { ColorHex, CodePresentationConfig, SyntaxTheme };

export interface SyntaxCategoryColors {
  /** Comments and docstrings */
  comment: ColorHex;
  /** String literals */
  string: ColorHex;
  /** Numeric literals */
  number: ColorHex;
  /** Language constants and built-ins */
  constant: ColorHex;
  /** Keywords and control flow statements */
  keyword: ColorHex;
  /** Function names and calls */
  function: ColorHex;
  /** Type names, classes, interfaces */
  type: ColorHex;
  /** Variable names and identifiers */
  variable: ColorHex;
  /** Operators, delimiters, punctuation */
  punctuation: ColorHex;
  /** Markup / JSX tags */
  tag: ColorHex;
  /** Markup / JSX attributes */
  attribute: ColorHex;
}

export interface SyntaxCategoryPalette {
  light: SyntaxCategoryColors;
  dark: SyntaxCategoryColors;
}

export interface CodeChromeRoleColors {
  /** Code background color */
  background: ColorHex;
  /** Default code foreground text color */
  foreground: ColorHex;
  /** Outer code frame border color */
  border: ColorHex;
  /** Focus outline border color */
  focus: ColorHex;
  /** Tab bar background */
  tabBarBackground: ColorHex;
  /** Tab bar border */
  tabBarBorder: ColorHex;
  /** Active editor tab background */
  activeTabBackground: ColorHex;
  /** Active editor tab text color */
  activeTabForeground: ColorHex;
  /** Active editor tab border */
  activeTabBorder: ColorHex;
  /** Active tab indicator line color (top or bottom) */
  activeTabIndicator?: ColorHex | undefined;
  /** Terminal chrome titlebar background */
  terminalTitlebarBackground: ColorHex;
  /** Terminal chrome titlebar foreground */
  terminalTitlebarForeground: ColorHex;
  /** Copy button foreground color */
  copyButtonForeground: ColorHex;
  /** Copy button border color */
  copyButtonBorder: ColorHex;
  /** Success tooltip background */
  tooltipSuccessBackground: ColorHex;
  /** Success tooltip foreground */
  tooltipSuccessForeground: ColorHex;
}

export interface CodeChromePalette {
  light: Partial<CodeChromeRoleColors>;
  dark: Partial<CodeChromeRoleColors>;
}

export interface CodeDiffRoleColors {
  inserted?: ColorHex | undefined;
  deleted?: ColorHex | undefined;
  marked?: ColorHex | undefined;
  insertedBackground?: ColorHex | undefined;
  deletedBackground?: ColorHex | undefined;
  markedBackground?: ColorHex | undefined;
}

export interface CodeDiffPalette {
  light: CodeDiffRoleColors;
  dark: CodeDiffRoleColors;
}

export interface SyntaxPaletteModel {
  /** Semantic syntax categories */
  syntax: SyntaxCategoryPalette;
  /** Optional chrome roles; if omitted, derived from theme surfaces/tokens */
  chrome?: Partial<CodeChromePalette> | undefined;
  /** Optional diff markers; if omitted, standard accessible diff pairs are used */
  diffs?: Partial<CodeDiffPalette> | undefined;
  /** Copy button mode */
  copy?: "standard" | "minimal" | undefined;
  /** Code frame preset */
  frame?: "editor" | "terminal" | "plain" | undefined;
  /** Tab styling indicators */
  tabs?: {
    activeIndicator?: "top" | "bottom" | "border" | "accent" | undefined;
  } | undefined;
}

