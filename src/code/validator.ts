import {
  ValidationErrorV2,
  assertExactKeys,
  assertPlainObject,
  assertNoDangerousPatterns,
  validateThemeV2,
} from "../v2/validator.js";
import type {
  CodeCopy,
  CodeFontStyle,
  CodeFrame,
  CodeMarks,
  CodePresentationConfig,
  MarkColor,
  SyntaxRule,
  SyntaxTheme,
  SyntaxThemeMode,
  ThemeSpecificationCode,
} from "./types.js";

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const RESTRICTED_DOTTED_SCOPE_REGEX = /^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)*$/;
const ALLOWED_FONT_STYLES = new Set(["normal", "italic", "bold", "underline"]);
const ALLOWED_FRAMES = new Set(["plain", "editor", "terminal"]);
const ALLOWED_COPY = new Set(["standard", "minimal"]);

const FORBIDDEN_PROPERTY_NAMES = new Set(["__proto__", "prototype", "constructor"]);

/**
 * Validates input against getters, prototypes, functions, excessive depth,
 * and dangerous patterns BEFORE serialization or processing.
 */
export function assertSafePreSerialization(value: unknown, maxBytes = 1024 * 1024): void {
  const ancestors = new Set<object>();
  let nodes = 0;
  let bytes = 0;
  function visit(val: unknown, depth: number): void {
    if (++nodes > 100000 || depth > 20) throw new ValidationErrorV2("Data complexity limit exceeded", "root", "MAX_DEPTH_EXCEEDED");
    if (typeof val === "string") {
      bytes += Buffer.byteLength(val, "utf8");
      if (bytes > maxBytes) throw new ValidationErrorV2("Data exceeds 1 MiB", "root", "OVERSIZED_INPUT");
      return;
    }
    if (val === null || typeof val === "boolean" || (typeof val === "number" && Number.isFinite(val))) return;
    if (typeof val !== "object") throw new ValidationErrorV2("Only JSON data is accepted", "root", "FORBIDDEN_VALUE");
    if (ancestors.has(val)) throw new ValidationErrorV2("Circular data", "root", "CIRCULAR_REFERENCE");
    const array = Array.isArray(val);
    const proto = Object.getPrototypeOf(val);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw new ValidationErrorV2("Invalid prototype", "root", "INVALID_PROTOTYPE");
    if (Object.getOwnPropertySymbols(val).length) throw new ValidationErrorV2("Symbol keys forbidden", "root", "FORBIDDEN_SYMBOL");
    const keys = Object.getOwnPropertyNames(val);
    if (keys.length > 20000 || (array && val.length > 20000)) throw new ValidationErrorV2("Collection limit exceeded", "root", "OVERSIZED_INPUT");
    if (array && keys.length !== val.length + 1) throw new ValidationErrorV2("Sparse or extended arrays forbidden", "root", "INVALID_ARRAY");
    ancestors.add(val);
    for (const key of keys) {
      if (array && key === "length") continue;
      if (FORBIDDEN_PROPERTY_NAMES.has(key) || (array && !/^(0|[1-9][0-9]*)$/.test(key))) throw new ValidationErrorV2("Unexpected property", "root", "FORBIDDEN_PROPERTY");
      bytes += Buffer.byteLength(key, "utf8");
      if (bytes > maxBytes) throw new ValidationErrorV2("Data exceeds 1 MiB", "root", "OVERSIZED_INPUT");
      const descriptor = Object.getOwnPropertyDescriptor(val, key)!;
      if (!descriptor.enumerable || !("value" in descriptor)) throw new ValidationErrorV2("Accessors and hidden properties forbidden", "root", "ACCESSOR_FORBIDDEN");
      visit(descriptor.value, depth + 1);
    }
    ancestors.delete(val);
  }
  visit(value, 0);
}

function validateHexColor(val: unknown, path: string): string {
  if (typeof val !== "string") {
    throw new ValidationErrorV2("Expected hex color string (#rrggbb)", path, "INVALID_TYPE");
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

function validateMarkColor(val: unknown, path: string): MarkColor {
  if (typeof val === "string") {
    return validateHexColor(val, path);
  }
  if (typeof val === "object" && val !== null && !Array.isArray(val)) {
    const obj = assertPlainObject(val, path);
    assertExactKeys(obj, ["dark", "light"], path);
    return {
      dark: validateHexColor(obj.dark, `${path}.dark`),
      light: validateHexColor(obj.light, `${path}.light`),
    };
  }
  throw new ValidationErrorV2(
    `Expected canonical hex string or paired { light, dark } object for mark color at '${path}'`,
    path,
    "INVALID_MARK_COLOR"
  );
}

function validateCodePresentation(
  raw: unknown,
  path = "root.codePresentation"
): CodePresentationConfig {
  const cp = assertPlainObject(raw, path);
  assertExactKeys(
    cp,
    ["copy", "frame", "marks", "mode", "syntaxTheme", "tabs"],
    path
  );

  for (const key of ["copy", "frame", "marks", "mode", "syntaxTheme", "tabs"] as const) {
    if (!(key in cp)) {
      throw new ValidationErrorV2(
        `Missing required field '${key}'`,
        `${path}.${key}`,
        "MISSING_FIELD"
      );
    }
  }

  // 1. mode
  if (cp.mode !== "expressive-code") {
    throw new ValidationErrorV2(
      `Invalid code presentation mode '${String(cp.mode)}'. Expected 'expressive-code'`,
      `${path}.mode`,
      "INVALID_MODE"
    );
  }

  // 2. frame
  if (typeof cp.frame !== "string" || !ALLOWED_FRAMES.has(cp.frame)) {
    throw new ValidationErrorV2(
      `Invalid frame '${String(cp.frame)}'. Expected 'plain', 'editor', or 'terminal'`,
      `${path}.frame`,
      "INVALID_FRAME"
    );
  }
  const frame = cp.frame as CodeFrame;

  // 3. copy
  if (typeof cp.copy !== "string" || !ALLOWED_COPY.has(cp.copy)) {
    throw new ValidationErrorV2(
      `Invalid copy option '${String(cp.copy)}'. Expected 'standard' or 'minimal'`,
      `${path}.copy`,
      "INVALID_COPY"
    );
  }
  const copy = cp.copy as CodeCopy;

  // 4. tabs
  if (cp.tabs !== "deferred") {
    throw new ValidationErrorV2(
      `Invalid tabs option '${String(cp.tabs)}'. Expected 'deferred'`,
      `${path}.tabs`,
      "INVALID_TABS"
    );
  }
  const tabs = cp.tabs as "deferred";

  // 5. marks
  const marksObj = assertPlainObject(cp.marks, `${path}.marks`);
  assertExactKeys(marksObj, ["deleted", "inserted", "marked"], `${path}.marks`);
  for (const key of ["deleted", "inserted", "marked"] as const) {
    if (!(key in marksObj)) {
      throw new ValidationErrorV2(
        `Missing required field '${key}'`,
        `${path}.marks.${key}`,
        "MISSING_FIELD"
      );
    }
  }
  const marks: CodeMarks = {
    marked: validateMarkColor(marksObj.marked, `${path}.marks.marked`),
    inserted: validateMarkColor(marksObj.inserted, `${path}.marks.inserted`),
    deleted: validateMarkColor(marksObj.deleted, `${path}.marks.deleted`),
  };

  // 6. syntaxTheme
  if (!("syntaxTheme" in cp) || cp.syntaxTheme === undefined || cp.syntaxTheme === null) {
    throw new ValidationErrorV2(
      "Missing required syntaxTheme in codePresentation",
      `${path}.syntaxTheme`,
      "SYNTAX_REQUIRED"
    );
  }
  const st = assertPlainObject(cp.syntaxTheme, `${path}.syntaxTheme`);
  assertExactKeys(st, ["dark", "light"], `${path}.syntaxTheme`);

  // Max total syntax JSON UTF-8: 256 KiB (262,144 bytes)
  const lightRules = assertPlainObject(st.light, `${path}.syntaxTheme.light`).rules;
  const darkRules = assertPlainObject(st.dark, `${path}.syntaxTheme.dark`).rules;
  if (!Array.isArray(lightRules) || !Array.isArray(darkRules)) throw new ValidationErrorV2("Expected rules arrays", path, "INVALID_TYPE");
  if (lightRules.length + darkRules.length > 512) throw new ValidationErrorV2("Total syntax rules exceeds 512", path, "TOO_MANY_RULES");
  const syntaxJson = JSON.stringify(st);
  const syntaxByteLength = Buffer.byteLength(syntaxJson, "utf8");
  if (syntaxByteLength > 256 * 1024) {
    throw new ValidationErrorV2(
      `Total syntax JSON size (${syntaxByteLength} bytes) exceeds maximum limit of 256 KiB`,
      `${path}.syntaxTheme`,
      "SYNTAX_OVERSIZED"
    );
  }

  const validateSyntaxMode = (modeRaw: unknown, modeName: "light" | "dark"): SyntaxThemeMode => {
    const modeObj = assertPlainObject(modeRaw, `${path}.syntaxTheme.${modeName}`);
    assertExactKeys(modeObj, ["rules"], `${path}.syntaxTheme.${modeName}`);

    if (!Array.isArray(modeObj.rules)) {
      throw new ValidationErrorV2(
        `Expected array of rules in syntaxTheme.${modeName}`,
        `${path}.syntaxTheme.${modeName}.rules`,
        "INVALID_TYPE"
      );
    }

    if (modeObj.rules.length === 0) {
      throw new ValidationErrorV2(
        `Syntax theme '${modeName}' rules array cannot be empty`,
        `${path}.syntaxTheme.${modeName}.rules`,
        "EMPTY_RULES"
      );
    }

    const validatedRules: SyntaxRule[] = [];
    for (let rIdx = 0; rIdx < modeObj.rules.length; rIdx++) {
      const ruleRaw = modeObj.rules[rIdx];
      const rulePath = `${path}.syntaxTheme.${modeName}.rules[${rIdx}]`;
      const ruleObj = assertPlainObject(ruleRaw, rulePath);
      assertExactKeys(
        ruleObj,
        ["background", "fontStyle", "foreground", "scopes"],
        rulePath
      );

      if (!("scopes" in ruleObj) || !Array.isArray(ruleObj.scopes)) {
        throw new ValidationErrorV2(
          "Rule requires a 'scopes' array",
          `${rulePath}.scopes`,
          "INVALID_SCOPES"
        );
      }

      if (ruleObj.scopes.length < 1 || ruleObj.scopes.length > 32) {
        throw new ValidationErrorV2(
          `Rule scopes count (${ruleObj.scopes.length}) must be between 1 and 32`,
          `${rulePath}.scopes`,
          ruleObj.scopes.length < 1 ? "EMPTY_SCOPES" : "TOO_MANY_SCOPES"
        );
      }

      const validatedScopes: string[] = [];
      for (let sIdx = 0; sIdx < ruleObj.scopes.length; sIdx++) {
        const scope = ruleObj.scopes[sIdx];
        const scopePath = `${rulePath}.scopes[${sIdx}]`;
        if (typeof scope !== "string") {
          throw new ValidationErrorV2(
            "Scope must be a string",
            scopePath,
            "INVALID_TYPE"
          );
        }
        assertNoDangerousPatterns(scope, scopePath);

        const scopeBytes = Buffer.byteLength(scope, "utf8");
        if (scopeBytes < 1 || scopeBytes > 128) {
          throw new ValidationErrorV2(
            `Scope string byte length (${scopeBytes}) must be between 1 and 128 bytes`,
            scopePath,
            scopeBytes < 1 ? "INVALID_SCOPE" : "SCOPE_OVERSIZED"
          );
        }

        if (!RESTRICTED_DOTTED_SCOPE_REGEX.test(scope)) {
          throw new ValidationErrorV2(
            `Invalid scope identifier '${scope}'. Scopes must be restricted dotted scope strings (e.g. comment.line)`,
            scopePath,
            "INVALID_SCOPE"
          );
        }

        validatedScopes.push(scope);
      }

      if (!("foreground" in ruleObj)) {
        throw new ValidationErrorV2(
          "Rule requires a 'foreground' color",
          `${rulePath}.foreground`,
          "MISSING_FIELD"
        );
      }
      const foreground = validateHexColor(ruleObj.foreground, `${rulePath}.foreground`);

      let background: string | undefined;
      if ("background" in ruleObj && ruleObj.background !== undefined) {
        background = validateHexColor(ruleObj.background, `${rulePath}.background`);
      }

      let fontStyle: CodeFontStyle | undefined;
      if ("fontStyle" in ruleObj && ruleObj.fontStyle !== undefined) {
        if (typeof ruleObj.fontStyle !== "string" || !ALLOWED_FONT_STYLES.has(ruleObj.fontStyle)) {
          throw new ValidationErrorV2(
            `Invalid fontStyle '${String(ruleObj.fontStyle)}'. Expected 'normal', 'italic', 'bold', or 'underline'`,
            `${rulePath}.fontStyle`,
            "INVALID_FONT_STYLE"
          );
        }
        fontStyle = ruleObj.fontStyle as CodeFontStyle;
      }

      validatedRules.push({
        scopes: validatedScopes,
        foreground,
        ...(background !== undefined ? { background } : {}),
        ...(fontStyle !== undefined ? { fontStyle } : {}),
      });
    }

    return { rules: validatedRules };
  };

  const lightMode = validateSyntaxMode(st.light, "light");
  const darkMode = validateSyntaxMode(st.dark, "dark");

  const totalRules = lightMode.rules.length + darkMode.rules.length;
  if (totalRules > 512) {
    throw new ValidationErrorV2(
      `Total syntax rules count across light and dark (${totalRules}) exceeds maximum limit of 512`,
      `${path}.syntaxTheme`,
      "TOO_MANY_RULES"
    );
  }

  const syntaxTheme: SyntaxTheme = {
    light: lightMode,
    dark: darkMode,
  };

  return {
    mode: "expressive-code",
    syntaxTheme,
    frame,
    marks,
    copy,
    tabs,
  };
}

/**
 * Validates a theme specification containing the TFSB61B code domain envelope.
 * Rejects prototype pollution, accessors, functions, depth, and oversize before serialization,
 * validates the closed codePresentation envelope, and reuses core validator via sentinel replacement.
 */
export function validateThemeCode(input: unknown): ThemeSpecificationCode {
  // 1. Safety scan before any serialization or delegation
  assertSafePreSerialization(input);

  const root = assertPlainObject(input, "root");

  // Check overall raw size before deep processing
  const rawJson = JSON.stringify(input);
  if (Buffer.byteLength(rawJson, "utf8") > 1024 * 1024) {
    throw new ValidationErrorV2(
      "Theme specification total size exceeds maximum limit of 1 MiB",
      "root",
      "OVERSIZED_INPUT"
    );
  }

  // 2. Validate closed codePresentation object
  if (!("codePresentation" in root)) {
    throw new ValidationErrorV2(
      "Missing required field 'codePresentation'",
      "root.codePresentation",
      "MISSING_FIELD"
    );
  }

  const validatedCodePresentation = validateCodePresentation(
    root.codePresentation,
    "root.codePresentation"
  );

  // 3. Delegate core validation using safe copy replacing codePresentation with "consumer-default" sentinel
  const coreCopy: Record<string, unknown> = {
    ...root,
    codePresentation: "consumer-default",
  };

  const validatedCore = validateThemeV2(coreCopy);

  // 4. Return valid ThemeSpecificationCode with validated codePresentation
  return {
    ...validatedCore,
    codePresentation: validatedCodePresentation,
  };
}

/**
 * Type guard testing whether input is a valid ThemeSpecificationCode.
 */
export function isThemeCode(input: unknown): input is ThemeSpecificationCode {
  if (!input || typeof input !== "object") return false;
  const field = Object.getOwnPropertyDescriptor(input, "codePresentation");
  return !!field && "value" in field && field.value !== "consumer-default";
}
