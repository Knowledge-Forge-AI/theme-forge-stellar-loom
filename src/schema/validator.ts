import type {
  BodyFontOption,
  CodeFontOption,
  ThemePalette,
  ThemePaletteAccent,
  ThemePaletteGrays,
  ThemePaletteNeutrals,
  ThemeSpecification,
} from "../types.js";

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly fieldPath?: string,
    public readonly code: string = "VALIDATION_ERROR"
  ) {
    super(fieldPath ? `${message} at '${fieldPath}'` : message);
    this.name = "ValidationError";
  }
}

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const THEME_NAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
// Strict SemVer 2.0.0 regex (no leading zeroes in major/minor/patch, optional prerelease and build metadata)
const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const FORBIDDEN_CONTENT_PATTERNS = [
  /url\s*\(/i,
  /@import/i,
  /<script/i,
  /expression\s*\(/i,
  /[;{}]/,
  /\/\*/,
  /\*\//,
];

function assertNoDangerousPatterns(val: string, path: string): void {
  for (const pattern of FORBIDDEN_CONTENT_PATTERNS) {
    if (pattern.test(val)) {
      throw new ValidationError(
        `Forbidden or executable content pattern detected`,
        path,
        "DANGEROUS_CONTENT"
      );
    }
  }
}

function assertPlainObject(val: unknown, path: string): Record<string, unknown> {
  if (typeof val !== "object" || val === null || Array.isArray(val)) {
    throw new ValidationError(`Expected plain object`, path, "INVALID_TYPE");
  }
  const proto = Object.getPrototypeOf(val);
  if (proto !== Object.prototype && proto !== null) {
    throw new ValidationError(
      `Expected plain data object with standard Object prototype, got custom prototype`,
      path,
      "INVALID_PROTOTYPE"
    );
  }
  return val as Record<string, unknown>;
}

function assertExactKeys(
  obj: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string
): void {
  const actualKeys = Object.keys(obj);
  for (const key of actualKeys) {
    if (!allowedKeys.includes(key)) {
      throw new ValidationError(`Unknown key '${key}'`, path, "UNKNOWN_KEY");
    }
  }
}

function validateColor(val: unknown, path: string): string {
  if (typeof val !== "string") {
    throw new ValidationError(`Expected hex color string (#rrggbb)`, path, "INVALID_TYPE");
  }
  assertNoDangerousPatterns(val, path);
  if (!HEX_COLOR_REGEX.test(val)) {
    throw new ValidationError(
      `Invalid hex color '${val}', must match #rrggbb`,
      path,
      "INVALID_FORMAT"
    );
  }
  return val.toLowerCase();
}

export type DimensionRole = "contentWidth" | "sidebarWidth" | "baseFontSize";
export type DimensionUnit = "px" | "rem" | "em" | "ch";

export interface UnitBounds {
  min: number;
  max: number;
}

export const DIMENSION_BOUNDS: Record<DimensionRole, Record<DimensionUnit, UnitBounds>> = {
  contentWidth: {
    px: { min: 320, max: 3840 },
    rem: { min: 20, max: 240 },
    em: { min: 20, max: 240 },
    ch: { min: 30, max: 200 },
  },
  sidebarWidth: {
    px: { min: 160, max: 600 },
    rem: { min: 10, max: 40 },
    em: { min: 10, max: 40 },
    ch: { min: 15, max: 60 },
  },
  baseFontSize: {
    px: { min: 10, max: 36 },
    rem: { min: 0.625, max: 2.25 },
    em: { min: 0.625, max: 2.25 },
    ch: { min: 1, max: 4 },
  },
};

const DIMENSION_REGEX = /^([0-9]+(?:\.[0-9]+)?)(px|rem|em|ch)$/i;

export function validateDimension(val: unknown, path: string, role: DimensionRole): string {
  if (typeof val !== "string") {
    throw new ValidationError(
      `Expected dimension string (e.g. '45rem', '16px')`,
      path,
      "INVALID_TYPE"
    );
  }
  assertNoDangerousPatterns(val, path);
  const match = DIMENSION_REGEX.exec(val.trim());
  if (!match) {
    throw new ValidationError(
      `Invalid dimension '${val}', must match /^[0-9]+(\\.[0-9]+)?(px|rem|em|ch)$/i`,
      path,
      "INVALID_FORMAT"
    );
  }
  const num = parseFloat(match[1]);
  const unit = match[2].toLowerCase() as DimensionUnit;

  if (!Number.isFinite(num) || num <= 0) {
    throw new ValidationError(
      `Invalid dimension '${val}', value must be a positive finite number`,
      path,
      "OUT_OF_BOUNDS"
    );
  }

  const bounds = DIMENSION_BOUNDS[role][unit];
  if (num < bounds.min || num > bounds.max) {
    throw new ValidationError(
      `Dimension '${val}' out of bounds for '${role}'. Allowed range for unit '${unit}' is [${bounds.min}, ${bounds.max}]`,
      path,
      "OUT_OF_BOUNDS"
    );
  }

  // Canonical normalization: strip leading zeros, redundant decimal formatting, lowercase unit
  const canonicalNum = num.toString();
  return `${canonicalNum}${unit}`;
}

const ALLOWED_ROOT_KEYS = [
  "$schema",
  "name",
  "version",
  "schemaVersion",
  "adapter",
  "colors",
  "typography",
  "layout",
] as const;

const ALLOWED_ACCENT_KEYS = ["base", "low", "high"] as const;

const ALLOWED_NEUTRALS_KEYS = [
  "bg",
  "bgNav",
  "bgSidebar",
  "bgInlineCode",
  "bgAccent",
  "text",
  "textAccent",
  "textInvert",
  "hairline",
  "hairlineLight",
  "hairlineShade",
] as const;

const ALLOWED_GRAYS_KEYS = [
  "gray1",
  "gray2",
  "gray3",
  "gray4",
  "gray5",
  "gray6",
  "gray7",
] as const;

function validatePalette(paletteRaw: unknown, path: string): ThemePalette {
  const obj = assertPlainObject(paletteRaw, path);
  assertExactKeys(obj, ["accent", "neutrals", "grays"], path);

  const accentObj = assertPlainObject(obj.accent, `${path}.accent`);
  assertExactKeys(accentObj, ALLOWED_ACCENT_KEYS, `${path}.accent`);
  const accent: ThemePaletteAccent = {
    base: validateColor(accentObj.base, `${path}.accent.base`),
    low: validateColor(accentObj.low, `${path}.accent.low`),
    high: validateColor(accentObj.high, `${path}.accent.high`),
  };

  const neutralsObj = assertPlainObject(obj.neutrals, `${path}.neutrals`);
  assertExactKeys(neutralsObj, ALLOWED_NEUTRALS_KEYS, `${path}.neutrals`);
  const neutrals: ThemePaletteNeutrals = {
    bg: validateColor(neutralsObj.bg, `${path}.neutrals.bg`),
    bgNav: validateColor(neutralsObj.bgNav, `${path}.neutrals.bgNav`),
    bgSidebar: validateColor(neutralsObj.bgSidebar, `${path}.neutrals.bgSidebar`),
    bgInlineCode: validateColor(neutralsObj.bgInlineCode, `${path}.neutrals.bgInlineCode`),
    bgAccent: validateColor(neutralsObj.bgAccent, `${path}.neutrals.bgAccent`),
    text: validateColor(neutralsObj.text, `${path}.neutrals.text`),
    textAccent: validateColor(neutralsObj.textAccent, `${path}.neutrals.textAccent`),
    textInvert: validateColor(neutralsObj.textInvert, `${path}.neutrals.textInvert`),
    hairline: validateColor(neutralsObj.hairline, `${path}.neutrals.hairline`),
    hairlineLight: validateColor(neutralsObj.hairlineLight, `${path}.neutrals.hairlineLight`),
    hairlineShade: validateColor(neutralsObj.hairlineShade, `${path}.neutrals.hairlineShade`),
  };

  const graysObj = assertPlainObject(obj.grays, `${path}.grays`);
  assertExactKeys(graysObj, ALLOWED_GRAYS_KEYS, `${path}.grays`);
  const grays: ThemePaletteGrays = {
    gray1: validateColor(graysObj.gray1, `${path}.grays.gray1`),
    gray2: validateColor(graysObj.gray2, `${path}.grays.gray2`),
    gray3: validateColor(graysObj.gray3, `${path}.grays.gray3`),
    gray4: validateColor(graysObj.gray4, `${path}.grays.gray4`),
    gray5: validateColor(graysObj.gray5, `${path}.grays.gray5`),
    gray6: validateColor(graysObj.gray6, `${path}.grays.gray6`),
    gray7: validateColor(graysObj.gray7, `${path}.grays.gray7`),
  };

  return { accent, neutrals, grays };
}

export function validateThemeSpecification(input: unknown): ThemeSpecification {
  const root = assertPlainObject(input, "root");
  assertExactKeys(root, ALLOWED_ROOT_KEYS, "root");

  if (root.schemaVersion !== "tfsl.theme-v1") {
    throw new ValidationError(
      `Unsupported schemaVersion '${String(root.schemaVersion)}'. Expected 'tfsl.theme-v1'`,
      "root.schemaVersion",
      "UNSUPPORTED_VERSION"
    );
  }

  if (root.adapter !== "starlight-v0.42") {
    throw new ValidationError(
      `Unsupported adapter '${String(root.adapter)}'. Expected 'starlight-v0.42'`,
      "root.adapter",
      "UNSUPPORTED_ADAPTER"
    );
  }

  if (typeof root.name !== "string" || !THEME_NAME_REGEX.test(root.name)) {
    throw new ValidationError(
      `Invalid name '${String(root.name)}'. Must be 1-64 alphanumeric characters with underscores/dashes`,
      "root.name",
      "INVALID_FORMAT"
    );
  }

  if (typeof root.version !== "string" || !SEMVER_REGEX.test(root.version)) {
    throw new ValidationError(
      `Invalid version '${String(root.version)}'. Must be valid SemVer 2.0.0 without leading zeroes (e.g. '0.1.0')`,
      "root.version",
      "INVALID_FORMAT"
    );
  }

  const colorsObj = assertPlainObject(root.colors, "root.colors");
  assertExactKeys(colorsObj, ["dark", "light"], "root.colors");
  const darkPalette = validatePalette(colorsObj.dark, "root.colors.dark");
  const lightPalette = validatePalette(colorsObj.light, "root.colors.light");

  const typographyObj = assertPlainObject(root.typography, "root.typography");
  assertExactKeys(
    typographyObj,
    ["bodyFont", "codeFont", "baseFontSize", "lineHeight"],
    "root.typography"
  );

  const validBodyFonts: BodyFontOption[] = ["system-sans", "system-serif", "system-mono"];
  if (
    typeof typographyObj.bodyFont !== "string" ||
    !validBodyFonts.includes(typographyObj.bodyFont as BodyFontOption)
  ) {
    throw new ValidationError(
      `Invalid bodyFont '${String(typographyObj.bodyFont)}'. Allowed: ${validBodyFonts.join(", ")}`,
      "root.typography.bodyFont",
      "INVALID_FORMAT"
    );
  }

  const validCodeFonts: CodeFontOption[] = ["system-mono", "system-code"];
  if (
    typeof typographyObj.codeFont !== "string" ||
    !validCodeFonts.includes(typographyObj.codeFont as CodeFontOption)
  ) {
    throw new ValidationError(
      `Invalid codeFont '${String(typographyObj.codeFont)}'. Allowed: ${validCodeFonts.join(", ")}`,
      "root.typography.codeFont",
      "INVALID_FORMAT"
    );
  }

  let baseFontSize: string | undefined;
  if (typographyObj.baseFontSize !== undefined) {
    baseFontSize = validateDimension(
      typographyObj.baseFontSize,
      "root.typography.baseFontSize",
      "baseFontSize"
    );
  }

  let lineHeight: number | undefined;
  if (typographyObj.lineHeight !== undefined) {
    if (
      typeof typographyObj.lineHeight !== "number" ||
      !Number.isFinite(typographyObj.lineHeight) ||
      typographyObj.lineHeight < 1.0 ||
      typographyObj.lineHeight > 3.0
    ) {
      throw new ValidationError(
        `Invalid lineHeight '${String(typographyObj.lineHeight)}'. Expected number between 1.0 and 3.0`,
        "root.typography.lineHeight",
        "OUT_OF_BOUNDS"
      );
    }
    lineHeight = typographyObj.lineHeight;
  }

  const layoutObj = assertPlainObject(root.layout, "root.layout");
  assertExactKeys(layoutObj, ["contentWidth", "sidebarWidth"], "root.layout");
  const contentWidth = validateDimension(
    layoutObj.contentWidth,
    "root.layout.contentWidth",
    "contentWidth"
  );
  const sidebarWidth = validateDimension(
    layoutObj.sidebarWidth,
    "root.layout.sidebarWidth",
    "sidebarWidth"
  );

  const spec: ThemeSpecification = {
    name: root.name,
    version: root.version,
    schemaVersion: "tfsl.theme-v1",
    adapter: "starlight-v0.42",
    colors: {
      dark: darkPalette,
      light: lightPalette,
    },
    typography: {
      bodyFont: typographyObj.bodyFont as BodyFontOption,
      codeFont: typographyObj.codeFont as CodeFontOption,
      ...(baseFontSize ? { baseFontSize } : {}),
      ...(lineHeight !== undefined ? { lineHeight } : {}),
    },
    layout: {
      contentWidth,
      sidebarWidth,
    },
  };

  if (root.$schema !== undefined) {
    if (typeof root.$schema !== "string") {
      throw new ValidationError(`Expected string for $schema`, "root.$schema", "INVALID_TYPE");
    }
    assertNoDangerousPatterns(root.$schema, "root.$schema");
    spec.$schema = root.$schema;
  }

  return spec;
}
