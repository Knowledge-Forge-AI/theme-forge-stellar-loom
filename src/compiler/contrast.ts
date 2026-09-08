import type {
  ContrastCriterion,
  ContrastDiagnostic,
  ContrastElement,
  ContrastRole,
  ThemeSpecification,
} from "../types.js";

export class ContrastError extends Error {
  constructor(
    message: string,
    public readonly diagnostics: ContrastDiagnostic[],
    public readonly code: string = "CONTRAST_THRESHOLD_FAILED"
  ) {
    super(message);
    this.name = "ContrastError";
  }
}

/**
 * Parse 6-digit hex color (#rrggbb) to [r, g, b] in range [0, 255]
 */
export function parseHexColor(hex: string): [number, number, number] {
  const clean = hex.startsWith("#") ? hex.slice(1) : hex;
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return [r, g, b];
}

/**
 * Calculate WCAG 2.2 sRGB relative luminance.
 * L = 0.2126 * R_linear + 0.7152 * G_linear + 0.0722 * B_linear
 * where C_linear = (c / 255 <= 0.04045) ? (c / (255 * 12.92)) : (((c / 255) + 0.055) / 1.055) ^ 2.4
 */
export function calculateRelativeLuminance(r: number, g: number, b: number): number {
  const [rl, gl, bl] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/**
 * Calculate WCAG 2.2 contrast ratio between two hex colors.
 * Ratio = (L_max + 0.05) / (L_min + 0.05)
 * Returns IEEE 754 floating point number with full precision for evaluation.
 */
export function calculateContrastRatio(hex1: string, hex2: string): number {
  const [r1, g1, b1] = parseHexColor(hex1);
  const [r2, g2, b2] = parseHexColor(hex2);
  const l1 = calculateRelativeLuminance(r1, g1, b1);
  const l2 = calculateRelativeLuminance(r2, g2, b2);
  const lMax = Math.max(l1, l2);
  const lMin = Math.min(l1, l2);
  return (lMax + 0.05) / (lMin + 0.05);
}

interface PairDefinition {
  mode: "dark" | "light";
  role: ContrastRole;
  element: ContrastElement;
  getFg: (spec: ThemeSpecification) => string;
  getBg: (spec: ThemeSpecification) => string;
}

const CONTROLLED_PAIRS: readonly PairDefinition[] = [
  {
    mode: "dark",
    role: "body-text",
    element: "body",
    getFg: (s) => s.colors.dark.neutrals.text,
    getBg: (s) => s.colors.dark.neutrals.bg,
  },
  {
    mode: "dark",
    role: "inline-code-text",
    element: "inline-code",
    getFg: (s) => s.colors.dark.neutrals.text,
    getBg: (s) => s.colors.dark.neutrals.bgInlineCode,
  },
  {
    mode: "dark",
    role: "link-text",
    element: "link",
    getFg: (s) => s.colors.dark.neutrals.textAccent,
    getBg: (s) => s.colors.dark.neutrals.bg,
  },
  {
    mode: "light",
    role: "body-text",
    element: "body",
    getFg: (s) => s.colors.light.neutrals.text,
    getBg: (s) => s.colors.light.neutrals.bg,
  },
  {
    mode: "light",
    role: "inline-code-text",
    element: "inline-code",
    getFg: (s) => s.colors.light.neutrals.text,
    getBg: (s) => s.colors.light.neutrals.bgInlineCode,
  },
  {
    mode: "light",
    role: "link-text",
    element: "link",
    getFg: (s) => s.colors.light.neutrals.textAccent,
    getBg: (s) => s.colors.light.neutrals.bg,
  },
];

const AA_THRESHOLD = 4.5;
const CRITERION: ContrastCriterion = "WCAG 2.2 AA";

/**
 * Perform deterministic contrast analysis for named adjacent text/background pairs
 * controlled by the adapter in both light and dark modes.
 */
export function analyzeThemeContrast(spec: ThemeSpecification): ContrastDiagnostic[] {
  const diagnostics: ContrastDiagnostic[] = [];

  for (const pair of CONTROLLED_PAIRS) {
    const fg = pair.getFg(spec);
    const bg = pair.getBg(spec);
    const ratio = calculateContrastRatio(fg, bg);
    const passed = ratio >= AA_THRESHOLD;
    const displayRatio = `${ratio.toFixed(2)}:1`;

    diagnostics.push({
      severity: passed ? "info" : "warning",
      code: passed ? "CONTRAST_ACCEPTABLE" : "CONTRAST_BELOW_THRESHOLD",
      role: pair.role,
      mode: pair.mode,
      element: pair.element,
      foreground: fg,
      background: bg,
      ratio,
      displayRatio,
      criterion: CRITERION,
      threshold: AA_THRESHOLD,
      disposition: passed ? "pass" : "warn",
      message: passed
        ? `Contrast ratio ${displayRatio} for ${pair.role} in ${pair.mode} mode (${fg} on ${bg}) meets ${CRITERION} threshold (${AA_THRESHOLD}:1)`
        : `Contrast ratio ${displayRatio} for ${pair.role} in ${pair.mode} mode (${fg} on ${bg}) is below ${CRITERION} threshold (${AA_THRESHOLD}:1)`,
    });
  }

  // Deterministic sorting: sort by mode ("dark" then "light"), then by role lexicographically
  return diagnostics.sort((a, b) => {
    if (a.mode !== b.mode) {
      return a.mode.localeCompare(b.mode);
    }
    return a.role.localeCompare(b.role);
  });
}
