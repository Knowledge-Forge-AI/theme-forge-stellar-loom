import {
  COLOR_ROLES,
  SYSTEM_FONT_IDS,
  type AccentVariantDefinition,
  type AdapterIdV2,
  type ColorRole,
  type ComponentsV2,
  type FontDeclarationV2,
  type LayoutPreset,
  type PageTitleOption,
  type SchemaVersionV2,
  type SurfacesV2,
  type ThemeSpecificationV2,
  type TokenDefinition,
  type TokenSets,
  type TypographyRoleV2,
  type TypographyV2,
} from "./types.js";

export class ValidationErrorV2 extends Error {
  constructor(
    message: string,
    public readonly fieldPath?: string,
    public readonly code: string = "VALIDATION_ERROR"
  ) {
    super(`[${code}] ${message}${fieldPath ? ` at '${fieldPath}'` : ""}`);
    this.name = "ValidationErrorV2";
  }
}

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const THEME_NAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const SAFE_LOWERCASE_ID_REGEX = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const SHA256_HEX_REGEX = /^[0-9a-fA-F]{64}$/;

const FORBIDDEN_ID_NAMES = new Set(["constructor", "__proto__", "prototype"]);
const FORBIDDEN_PROPERTY_NAMES = new Set(["__proto__", "prototype", "constructor"]);

const FORBIDDEN_CONTENT_PATTERNS = [
  /url\s*\(/i,
  /@import/i,
  /<script/i,
  /expression\s*\(/i,
  /[;{}]/,
  /\/\*/,
  /\*\//,
];

export function assertNoDangerousPatterns(val: string, path: string): void {
  for (const pattern of FORBIDDEN_CONTENT_PATTERNS) {
    if (pattern.test(val)) {
      throw new ValidationErrorV2(
        `Forbidden or executable content pattern detected`,
        path,
        "DANGEROUS_CONTENT"
      );
    }
  }
}

export function assertPlainObject(val: unknown, path: string): Record<string, unknown> {
  if (typeof val !== "object" || val === null || Array.isArray(val)) {
    throw new ValidationErrorV2(`Expected plain object`, path, "INVALID_TYPE");
  }
  const proto = Object.getPrototypeOf(val);
  if (proto !== Object.prototype && proto !== null) {
    throw new ValidationErrorV2(
      `Expected plain data object with standard Object prototype, got custom prototype`,
      path,
      "INVALID_PROTOTYPE"
    );
  }
  for (const key of Object.getOwnPropertyNames(val)) {
    if (FORBIDDEN_PROPERTY_NAMES.has(key)) {
      throw new ValidationErrorV2(
        `Forbidden property name '${key}' detected`,
        `${path}.${key}`,
        "FORBIDDEN_PROPERTY"
      );
    }
    const desc = Object.getOwnPropertyDescriptor(val, key);
    if (desc && !desc.enumerable) throw new ValidationErrorV2("Non-enumerable data forbidden", path);
    if (desc && (desc.get !== undefined || desc.set !== undefined)) {
      throw new ValidationErrorV2(
        `Accessors (getters/setters) are forbidden on theme specifications`,
        `${path}.${key}`,
        "ACCESSOR_FORBIDDEN"
      );
    }
  }
  return val as Record<string, unknown>;
}

export function assertExactKeys(
  obj: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string
): void {
  const actualKeys = Object.getOwnPropertyNames(obj);
  if (Object.getOwnPropertySymbols(obj).length) throw new ValidationErrorV2("Symbol keys forbidden", path);
  for (const key of actualKeys) {
    if (!allowedKeys.includes(key)) {
      throw new ValidationErrorV2(`Unknown key '${key}'`, path, "UNKNOWN_KEY");
    }
  }
}

function validateSafeId(id: unknown, path: string, entity = "identifier"): string {
  if (typeof id !== "string") {
    throw new ValidationErrorV2(`Expected string for ${entity}`, path, "INVALID_TYPE");
  }
  assertNoDangerousPatterns(id, path);
  if (!SAFE_LOWERCASE_ID_REGEX.test(id) || FORBIDDEN_ID_NAMES.has(id.toLowerCase())) {
    throw new ValidationErrorV2(
      `Invalid ${entity} '${id}'. Must be lowercase alphanumeric with hyphens/underscores (1-64 chars), not constructor/proto/prototype`,
      path,
      "INVALID_IDENTIFIER"
    );
  }
  return id;
}

function validateColor(val: unknown, path: string): string {
  if (typeof val !== "string") {
    throw new ValidationErrorV2(`Expected hex color string (#rrggbb)`, path, "INVALID_TYPE");
  }
  assertNoDangerousPatterns(val, path);
  if (!HEX_COLOR_REGEX.test(val)) {
    throw new ValidationErrorV2(
      `Invalid hex color '${val}', must match #rrggbb`,
      path,
      "INVALID_COLOR_FORMAT"
    );
  }
  return val.toLowerCase();
}

export function resolveToken(
  tokenSets: TokenSets,
  tokenSetId: string,
  tokenId: string,
  variantId: string,
  role: string,
  mode: string
): string {
  const set = Object.hasOwn(tokenSets, tokenSetId) ? tokenSets[tokenSetId] : undefined;
  if (!set) {
    throw new ValidationErrorV2(
      `Token set '${tokenSetId}' not found for variant '${variantId}'`,
      `root.accentVariants.${variantId}.tokenSet`,
      "TOKEN_SET_NOT_FOUND"
    );
  }

  const visited = new Set<string>();
  let currentId = tokenId;
  const chain: string[] = [];

  while (true) {
    if (visited.has(currentId)) {
      throw new ValidationErrorV2(
        `Cyclic token alias detected: ${[...chain, currentId].join(" -> ")}`,
        `root.accentVariants.${variantId}.${mode}.${role}`,
        "TOKEN_ALIAS_CYCLE"
      );
    }
    visited.add(currentId);
    chain.push(currentId);

    const entry = Object.hasOwn(set, currentId) ? set[currentId] : undefined;
    if (entry === undefined) {
      throw new ValidationErrorV2(
        `Token '${currentId}' not found in token set '${tokenSetId}' for role '${role}' in variant '${variantId}' (${mode})`,
        `root.accentVariants.${variantId}.${mode}.${role}`,
        "TOKEN_NOT_FOUND"
      );
    }

    if (typeof entry === "string") {
      return entry; // hex color
    }
    if (typeof entry === "object" && entry !== null) {
      if ("value" in entry && typeof entry.value === "string") {
        return entry.value;
      }
      if ("alias" in entry && typeof entry.alias === "string") {
        currentId = entry.alias;
        if (chain.length > 32) {
          throw new ValidationErrorV2(
            `Token alias chain exceeded max depth (32)`,
            `root.accentVariants.${variantId}.${mode}.${role}`,
            "TOKEN_ALIAS_DEPTH_EXCEEDED"
          );
        }
        continue;
      }
    }
    throw new ValidationErrorV2(
      `Invalid token definition for '${currentId}' in set '${tokenSetId}'`,
      `root.tokenSets.${tokenSetId}.${currentId}`,
      "INVALID_TOKEN_DEFINITION"
    );
  }
}

export function validateThemeV2(input: unknown): ThemeSpecificationV2 {
  const root = assertPlainObject(input, "root");

  const allowedRootKeys = [
    "name",
    "version",
    "schemaVersion",
    "adapter",
    "tokenSets",
    "accentVariants",
    "defaultAccent",
    "typography",
    "surfaces",
    "layoutPreset",
    "components",
    "codePresentation",
    "fonts",
  ];
  assertExactKeys(root, allowedRootKeys, "root");

  // 1. Validate name
  if (typeof root.name !== "string" || !THEME_NAME_REGEX.test(root.name)) {
    throw new ValidationErrorV2(
      `Invalid theme name '${String(root.name)}'. Must match ^[a-zA-Z0-9_-]{1,64}$`,
      "root.name",
      "INVALID_NAME"
    );
  }

  // 2. Validate version
  if (typeof root.version !== "string" || !SEMVER_REGEX.test(root.version)) {
    throw new ValidationErrorV2(
      `Invalid SemVer version '${String(root.version)}'`,
      "root.version",
      "INVALID_VERSION"
    );
  }

  // 3. Validate schemaVersion
  if (root.schemaVersion !== "tfsl.theme-v2") {
    throw new ValidationErrorV2(
      `Unsupported schemaVersion '${String(root.schemaVersion)}'. Expected 'tfsl.theme-v2'`,
      "root.schemaVersion",
      "UNSUPPORTED_SCHEMA_VERSION"
    );
  }

  // 4. Validate adapter
  if (root.adapter !== "starlight-v0.42") {
    throw new ValidationErrorV2(
      `Unsupported adapter '${String(root.adapter)}'. Expected 'starlight-v0.42'`,
      "root.adapter",
      "UNSUPPORTED_ADAPTER"
    );
  }

  // 5. Validate tokenSets
  const tokenSetsObj = assertPlainObject(root.tokenSets, "root.tokenSets");
  const setKeys = Object.keys(tokenSetsObj);
  if (setKeys.length === 0 || setKeys.length > 16) {
    throw new ValidationErrorV2(
      `tokenSets must have between 1 and 16 entries, got ${setKeys.length}`,
      "root.tokenSets",
      "TOKEN_SETS_BOUNDS"
    );
  }

  const validatedTokenSets: TokenSets = {};
  for (const setId of setKeys) {
    const validSetId = validateSafeId(setId, `root.tokenSets.${setId}`, "token set ID");
    const setObj = assertPlainObject(tokenSetsObj[setId], `root.tokenSets.${setId}`);
    const tokenKeys = Object.keys(setObj);
    if (tokenKeys.length === 0 || tokenKeys.length > 128) {
      throw new ValidationErrorV2(
        `Token set '${setId}' must have between 1 and 128 entries, got ${tokenKeys.length}`,
        `root.tokenSets.${setId}`,
        "TOKEN_SET_ENTRIES_BOUNDS"
      );
    }
    validatedTokenSets[validSetId] = {};
    for (const tokenId of tokenKeys) {
      const validTokenId = validateSafeId(
        tokenId,
        `root.tokenSets.${setId}.${tokenId}`,
        "token ID"
      );
      const entryVal = setObj[tokenId];
      if (typeof entryVal === "string") {
        validatedTokenSets[validSetId][validTokenId] = validateColor(
          entryVal,
          `root.tokenSets.${setId}.${tokenId}`
        );
      } else if (typeof entryVal === "object" && entryVal !== null) {
        const entryObj = assertPlainObject(
          entryVal,
          `root.tokenSets.${setId}.${tokenId}`
        );
        const entryKeys = Object.keys(entryObj);
        if (entryKeys.includes("value") && !entryKeys.includes("alias")) {
          assertExactKeys(entryObj, ["value"], `root.tokenSets.${setId}.${tokenId}`);
          validatedTokenSets[validSetId][validTokenId] = {
            value: validateColor(
              entryObj.value,
              `root.tokenSets.${setId}.${tokenId}.value`
            ),
          };
        } else if (entryKeys.includes("alias") && !entryKeys.includes("value")) {
          assertExactKeys(entryObj, ["alias"], `root.tokenSets.${setId}.${tokenId}`);
          validatedTokenSets[validSetId][validTokenId] = {
            alias: validateSafeId(
              entryObj.alias,
              `root.tokenSets.${setId}.${tokenId}.alias`,
              "token alias"
            ),
          };
        } else {
          throw new ValidationErrorV2(
            `Token entry '${tokenId}' must define either 'value' or 'alias'`,
            `root.tokenSets.${setId}.${tokenId}`,
            "INVALID_TOKEN_SHAPE"
          );
        }
      } else {
        throw new ValidationErrorV2(
          `Token entry '${tokenId}' must be a hex string or an object with 'value' or 'alias'`,
          `root.tokenSets.${setId}.${tokenId}`,
          "INVALID_TOKEN_TYPE"
        );
      }
    }
  }

  for (const [setId, entries] of Object.entries(validatedTokenSets)) {
    for (const tokenId of Object.keys(entries)) resolveToken(validatedTokenSets, setId, tokenId, "all", "all", "all");
  }

  // 6. Validate fonts (needed early for typography validation)
  if (!Array.isArray(root.fonts)) {
    throw new ValidationErrorV2(
      `Expected array for root.fonts`,
      "root.fonts",
      "INVALID_TYPE"
    );
  }
  if (root.fonts.length > 8) {
    throw new ValidationErrorV2(
      `fonts array exceeds maximum bound of 8 entries (got ${root.fonts.length})`,
      "root.fonts",
      "FONTS_BOUNDS"
    );
  }
  const validatedFonts: FontDeclarationV2[] = [];
  const seenFontIds = new Set<string>();
  for (let i = 0; i < root.fonts.length; i++) {
    const fontObj = assertPlainObject(root.fonts[i], `root.fonts[${i}]`);
    assertExactKeys(
      fontObj,
      ["id", "family", "style", "weight", "format", "sha256", "license", "notice"],
      `root.fonts[${i}]`
    );

    const fontId = validateSafeId(fontObj.id, `root.fonts[${i}].id`, "font ID");
    if (seenFontIds.has(fontId)) {
      throw new ValidationErrorV2(
        `Duplicate font ID '${fontId}'`,
        `root.fonts[${i}].id`,
        "DUPLICATE_FONT_ID"
      );
    }
    seenFontIds.add(fontId);

    if (typeof fontObj.family !== "string" || fontObj.family.trim().length === 0 || fontObj.family.length > 64) {
      throw new ValidationErrorV2(
        `Invalid font family name (1-64 chars)`,
        `root.fonts[${i}].family`,
        "INVALID_FONT_FAMILY"
      );
    }
    assertNoDangerousPatterns(fontObj.family, `root.fonts[${i}].family`);
    if (!/^[A-Za-z][A-Za-z0-9 -]{0,63}$/.test(fontObj.family)) {
      throw new ValidationErrorV2(
        `Font family contains forbidden path or separator characters`,
        `root.fonts[${i}].family`,
        "INVALID_FONT_FAMILY"
      );
    }

    if (!["normal", "italic", "oblique"].includes(fontObj.style as string)) {
      throw new ValidationErrorV2(
        `Invalid font style '${String(fontObj.style)}'. Allowed: normal, italic, oblique`,
        `root.fonts[${i}].style`,
        "INVALID_FONT_STYLE"
      );
    }

    let weightVal: number | string;
    if (typeof fontObj.weight === "number") {
      if (!Number.isFinite(fontObj.weight) || !Number.isInteger(fontObj.weight) || fontObj.weight < 100 || fontObj.weight > 900) {
        throw new ValidationErrorV2(
          `Font weight number must be between 100 and 900`,
          `root.fonts[${i}].weight`,
          "INVALID_FONT_WEIGHT"
        );
      }
      weightVal = fontObj.weight;
    } else if (typeof fontObj.weight === "string") {
      assertNoDangerousPatterns(fontObj.weight, `root.fonts[${i}].weight`);
      if (!/^\d{3}( \d{3})?$/.test(fontObj.weight)) {
        throw new ValidationErrorV2(
          `Font weight string must be numeric or range (e.g. '400' or '100 900')`,
          `root.fonts[${i}].weight`,
          "INVALID_FONT_WEIGHT"
        );
      }
      const range = fontObj.weight.split(" ").map(Number);
      if (range.some(n => n < 100 || n > 900) || (range.length === 2 && range[0]! > range[1]!)) throw new ValidationErrorV2("Invalid font weight range", `root.fonts[${i}].weight`);
      weightVal = fontObj.weight;
    } else {
      throw new ValidationErrorV2(
        `Font weight must be a number or string`,
        `root.fonts[${i}].weight`,
        "INVALID_TYPE"
      );
    }

    if (!["woff", "woff2"].includes(fontObj.format as string)) {
      throw new ValidationErrorV2(
        `Invalid font format '${String(fontObj.format)}'. Allowed: woff, woff2`,
        `root.fonts[${i}].format`,
        "INVALID_FONT_FORMAT"
      );
    }

    if (typeof fontObj.sha256 !== "string" || !SHA256_HEX_REGEX.test(fontObj.sha256)) {
      throw new ValidationErrorV2(
        `Invalid font sha256 '${String(fontObj.sha256)}', must be 64-character hex`,
        `root.fonts[${i}].sha256`,
        "INVALID_SHA256"
      );
    }

    if (typeof fontObj.license !== "string" || fontObj.license.trim().length === 0 || fontObj.license.length > 128) {
      throw new ValidationErrorV2(
        `Font license must be non-empty string <= 128 chars`,
        `root.fonts[${i}].license`,
        "INVALID_FONT_LICENSE"
      );
    }
    assertNoDangerousPatterns(fontObj.license, `root.fonts[${i}].license`);
    if (!/^[A-Za-z][A-Za-z0-9.+-]{0,127}$/.test(fontObj.license)) throw new ValidationErrorV2("Font license must be a logical license identity", `root.fonts[${i}].license`);
    if (/[/\\;{}]/.test(fontObj.license)) {
      throw new ValidationErrorV2(
        `Font license contains forbidden path characters`,
        `root.fonts[${i}].license`,
        "INVALID_FONT_LICENSE"
      );
    }

    if (typeof fontObj.notice !== "string" || fontObj.notice.trim().length === 0 || fontObj.notice.length > 256) {
      throw new ValidationErrorV2(
        `Font notice must be non-empty string <= 256 chars`,
        `root.fonts[${i}].notice`,
        "INVALID_FONT_NOTICE"
      );
    }
    assertNoDangerousPatterns(fontObj.notice, `root.fonts[${i}].notice`);
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(fontObj.notice)) throw new ValidationErrorV2("Font notice must be a closed logical identity", `root.fonts[${i}].notice`);
    if (/[;{}]/.test(fontObj.notice)) {
      throw new ValidationErrorV2(
        `Font notice contains forbidden characters`,
        `root.fonts[${i}].notice`,
        "INVALID_FONT_NOTICE"
      );
    }

    validatedFonts.push({
      id: fontId,
      family: fontObj.family,
      style: fontObj.style as "normal" | "italic" | "oblique",
      weight: weightVal,
      format: fontObj.format as "woff" | "woff2",
      sha256: fontObj.sha256.toLowerCase(),
      license: fontObj.license,
      notice: fontObj.notice,
    });
  }

  // 7. Validate accentVariants
  const variantsObj = assertPlainObject(root.accentVariants, "root.accentVariants");
  const variantKeys = Object.keys(variantsObj);
  if (variantKeys.length === 0 || variantKeys.length > 16) {
    throw new ValidationErrorV2(
      `accentVariants must have between 1 and 16 entries, got ${variantKeys.length}`,
      "root.accentVariants",
      "ACCENT_VARIANTS_BOUNDS"
    );
  }

  const validatedVariants: Record<string, AccentVariantDefinition> = {};
  for (const variantId of variantKeys) {
    const validVariantId = validateSafeId(
      variantId,
      `root.accentVariants.${variantId}`,
      "variant ID"
    );
    const variantObj = assertPlainObject(
      variantsObj[variantId],
      `root.accentVariants.${variantId}`
    );
    assertExactKeys(
      variantObj,
      ["tokenSet", "light", "dark"],
      `root.accentVariants.${variantId}`
    );

    if (typeof variantObj.tokenSet !== "string") {
      throw new ValidationErrorV2(
        `variant tokenSet must be a string`,
        `root.accentVariants.${variantId}.tokenSet`,
        "INVALID_TYPE"
      );
    }
    if (!(Object.hasOwn(validatedTokenSets, variantObj.tokenSet))) {
      throw new ValidationErrorV2(
        `Token set '${variantObj.tokenSet}' not found in tokenSets`,
        `root.accentVariants.${variantId}.tokenSet`,
        "TOKEN_SET_NOT_FOUND"
      );
    }

    const lightObj = assertPlainObject(
      variantObj.light,
      `root.accentVariants.${variantId}.light`
    );
    const darkObj = assertPlainObject(
      variantObj.dark,
      `root.accentVariants.${variantId}.dark`
    );

    // Validate completeness of 22 color roles
    assertExactKeys(
      lightObj,
      COLOR_ROLES,
      `root.accentVariants.${variantId}.light`
    );
    assertExactKeys(
      darkObj,
      COLOR_ROLES,
      `root.accentVariants.${variantId}.dark`
    );

    const validatedLight: Partial<Record<ColorRole, string>> = {};
    const validatedDark: Partial<Record<ColorRole, string>> = {};

    for (const role of COLOR_ROLES) {
      if (!(Object.hasOwn(lightObj, role))) {
        throw new ValidationErrorV2(
          `Missing required color role '${role}' in variant '${variantId}' light`,
          `root.accentVariants.${variantId}.light.${role}`,
          "MISSING_COLOR_ROLE"
        );
      }
      if (!(Object.hasOwn(darkObj, role))) {
        throw new ValidationErrorV2(
          `Missing required color role '${role}' in variant '${variantId}' dark`,
          `root.accentVariants.${variantId}.dark.${role}`,
          "MISSING_COLOR_ROLE"
        );
      }

      const lightTokenId = validateSafeId(
        lightObj[role],
        `root.accentVariants.${variantId}.light.${role}`,
        "token ID"
      );
      const darkTokenId = validateSafeId(
        darkObj[role],
        `root.accentVariants.${variantId}.dark.${role}`,
        "token ID"
      );

      // Verify token resolves and detects cycles
      resolveToken(
        validatedTokenSets,
        variantObj.tokenSet,
        lightTokenId,
        variantId,
        role,
        "light"
      );
      resolveToken(
        validatedTokenSets,
        variantObj.tokenSet,
        darkTokenId,
        variantId,
        role,
        "dark"
      );

      validatedLight[role] = lightTokenId;
      validatedDark[role] = darkTokenId;
    }

    validatedVariants[validVariantId] = {
      tokenSet: variantObj.tokenSet,
      light: validatedLight as Record<ColorRole, string>,
      dark: validatedDark as Record<ColorRole, string>,
    };
  }

  // 8. Validate defaultAccent
  if (typeof root.defaultAccent !== "string") {
    throw new ValidationErrorV2(
      `defaultAccent must be a string`,
      "root.defaultAccent",
      "INVALID_TYPE"
    );
  }
  if (!(Object.hasOwn(validatedVariants, root.defaultAccent))) {
    throw new ValidationErrorV2(
      `defaultAccent '${root.defaultAccent}' does not exist in accentVariants`,
      "root.defaultAccent",
      "DEFAULT_ACCENT_NOT_FOUND"
    );
  }

  // 9. Validate typography
  const typographyObj = assertPlainObject(root.typography, "root.typography");
  assertExactKeys(
    typographyObj,
    ["body", "heading", "ui", "code"],
    "root.typography"
  );

  const validatedTypography: Partial<TypographyV2> = {};
  for (const role of ["body", "heading", "ui", "code"] as const) {
    const roleObj = assertPlainObject(
      typographyObj[role],
      `root.typography.${role}`
    );
    assertExactKeys(roleObj, ["font", "size", "lineHeight"], `root.typography.${role}`);

    if (typeof roleObj.font !== "string") {
      throw new ValidationErrorV2(
        `Expected string font for typography.${role}`,
        `root.typography.${role}.font`,
        "INVALID_TYPE"
      );
    }
    assertNoDangerousPatterns(roleObj.font, `root.typography.${role}.font`);
    const isSystemFont = SYSTEM_FONT_IDS.includes(roleObj.font as any);
    const isLogicalFont = seenFontIds.has(roleObj.font);
    if (!isSystemFont && !isLogicalFont) {
      throw new ValidationErrorV2(
        `Unknown font ID '${roleObj.font}'. Allowed: ${SYSTEM_FONT_IDS.join(", ")} or declared in fonts array`,
        `root.typography.${role}.font`,
        "UNKNOWN_FONT_ID"
      );
    }

    if (
      typeof roleObj.size !== "number" ||
      !Number.isFinite(roleObj.size) ||
      roleObj.size < 8 ||
      roleObj.size > 96
    ) {
      throw new ValidationErrorV2(
        `Invalid font size '${String(roleObj.size)}'. Expected number between 8 and 96`,
        `root.typography.${role}.size`,
        "INVALID_FONT_SIZE"
      );
    }

    if (
      typeof roleObj.lineHeight !== "number" ||
      !Number.isFinite(roleObj.lineHeight) ||
      roleObj.lineHeight < 1 ||
      roleObj.lineHeight > 2.5
    ) {
      throw new ValidationErrorV2(
        `Invalid font lineHeight '${String(roleObj.lineHeight)}'. Expected number between 1 and 2.5`,
        `root.typography.${role}.lineHeight`,
        "INVALID_LINE_HEIGHT"
      );
    }

    validatedTypography[role] = {
      font: roleObj.font,
      size: roleObj.size,
      lineHeight: roleObj.lineHeight,
    };
  }

  // 10. Validate surfaces
  const surfacesObj = assertPlainObject(root.surfaces, "root.surfaces");
  assertExactKeys(
    surfacesObj,
    ["spacing", "radii", "border", "focus", "content", "sidebar", "borderStyle", "focusOffset"],
    "root.surfaces"
  );

  const validateSurfaceNumber = (key: string, min: number, max: number): number => {
    const val = surfacesObj[key];
    if (typeof val !== "number" || !Number.isFinite(val) || val < min || val > max) {
      throw new ValidationErrorV2(
        `Invalid surfaces.${key} '${String(val)}'. Expected number between ${min} and ${max}`,
        `root.surfaces.${key}`,
        "INVALID_SURFACE_VALUE"
      );
    }
    return val;
  };

  if (surfacesObj.borderStyle !== undefined && !["solid", "dashed", "dotted"].includes(surfacesObj.borderStyle as string)) throw new ValidationErrorV2("Unknown border style", "root.surfaces.borderStyle");
  const validatedSurfaces: SurfacesV2 = {
    borderStyle: (surfacesObj.borderStyle ?? "solid") as "solid" | "dashed" | "dotted",
    focusOffset: surfacesObj.focusOffset === undefined ? 2 : validateSurfaceNumber("focusOffset", 0, 16),
    spacing: validateSurfaceNumber("spacing", 0, 32),
    radii: validateSurfaceNumber("radii", 0, 64),
    border: validateSurfaceNumber("border", 0, 8),
    focus: validateSurfaceNumber("focus", 1, 8),
    content: validateSurfaceNumber("content", 320, 3840),
    sidebar: validateSurfaceNumber("sidebar", 120, 960),
  };

  // 11. Validate layoutPreset
  if (typeof root.layoutPreset !== "string" || !["standard", "compact", "wide"].includes(root.layoutPreset)) {
    throw new ValidationErrorV2(
      `Invalid layoutPreset '${String(root.layoutPreset)}'. Allowed: standard, compact, wide`,
      "root.layoutPreset",
      "INVALID_LAYOUT_PRESET"
    );
  }

  // 12. Validate components
  const componentsObj = assertPlainObject(root.components, "root.components");
  assertExactKeys(componentsObj, ["pageTitle"], "root.components");
  if (!["consumer-default", "page-title-frame"].includes(componentsObj.pageTitle as string)) {
    throw new ValidationErrorV2(
      `Invalid components.pageTitle '${String(componentsObj.pageTitle)}'. Allowed: consumer-default, page-title-frame`,
      "root.components.pageTitle",
      "INVALID_COMPONENT_OPTION"
    );
  }

  // 13. Validate codePresentation
  if (root.codePresentation !== "consumer-default") {
    throw new ValidationErrorV2(
      `Invalid codePresentation '${String(root.codePresentation)}'. Expected 'consumer-default'`,
      "root.codePresentation",
      "INVALID_CODE_PRESENTATION"
    );
  }

  const result: ThemeSpecificationV2 = {
    name: root.name,
    version: root.version,
    schemaVersion: root.schemaVersion as SchemaVersionV2,
    adapter: root.adapter as AdapterIdV2,
    tokenSets: validatedTokenSets,
    accentVariants: validatedVariants,
    defaultAccent: root.defaultAccent,
    typography: validatedTypography as TypographyV2,
    surfaces: validatedSurfaces,
    layoutPreset: root.layoutPreset as LayoutPreset,
    components: {
      pageTitle: componentsObj.pageTitle as PageTitleOption,
    },
    codePresentation: "consumer-default",
    fonts: validatedFonts,
  };



  return result;
}
