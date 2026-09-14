import {
  ValidationErrorV2,
  assertExactKeys,
  assertPlainObject,
  assertNoDangerousPatterns,
  validateThemeV2,
} from "../v2/validator.js";
import {
  assertSafePreSerialization,
  validateThemeCode,
} from "../code/validator.js";
import { computeSha256 } from "../v2/canonical.js";
import type {
  HeroAction,
  HeroLayout,
  HeroRoute,
  CatalogHeroConfig,
  CatalogPageTitleConfig,
  CatalogPaginationConfig,
  CatalogSidebarConfig,
  CatalogFontLicense,
  ThemeCatalogConfig,
  ThemeSpecificationCatalog,
} from "./types.js";

const ID_SLUG_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
const VALID_HERO_LAYOUTS = new Set<HeroLayout>([
  "centered",
  "media-top",
  "media-left",
  "media-right",
  "banner",
]);
const VALID_PAGE_TITLE_COPY = new Set(["none", "title", "url"]);
const VALID_PAGINATION_VARIANTS = new Set(["plain", "card", "compact"]);
const VALID_SIDEBAR_MODES = new Set(["nested", "tabs", "select", "active-only"]);

/**
 * Normalizes sha256 string (stripping optional 'sha256:' prefix).
 */
function normalizeDigest(val: string): string {
  return val.startsWith("sha256:") ? val.slice(7) : val;
}

/**
 * Checks that a path or href contains no URI schemes, backslashes, double slashes,
 * or raw/encoded directory traversal sequences.
 */
function assertNoTraversalOrSchemes(val: string, path: string): void {
  // Check for schemes: :// or scheme:
  if (val.includes("://") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(val)) {
    throw new ValidationErrorV2(
      `Arbitrary URLs and schemes are forbidden at '${path}'`,
      path,
      "SCHEME_FORBIDDEN"
    );
  }

  // Check for backslashes
  if (val.includes("\\")) {
    throw new ValidationErrorV2(
      `Backslashes are forbidden in path at '${path}'`,
      path,
      "INVALID_PATH"
    );
  }

  // Check for protocol-relative //
  if (val.startsWith("//") || val.includes("//")) {
    throw new ValidationErrorV2(
      `Double slashes are forbidden in path at '${path}'`,
      path,
      "INVALID_PATH"
    );
  }

  // Check for raw traversal ..
  if (val.includes("..")) {
    throw new ValidationErrorV2(
      `Path traversal ('..') is forbidden at '${path}'`,
      path,
      "TRAVERSAL_FORBIDDEN"
    );
  }

  // Check for encoded traversal or slashes: %2e, %2f, %5c (case-insensitive)
  if (/%2e/i.test(val) || /%2f/i.test(val) || /%5c/i.test(val)) {
    throw new ValidationErrorV2(
      `Encoded path traversal or slashes are forbidden at '${path}'`,
      path,
      "ENCODED_TRAVERSAL_FORBIDDEN"
    );
  }

  // Attempt URI decode and re-verify
  try {
    let decoded = val;
    for (let i = 0; i < 4 && decoded.includes("%"); i++) decoded = decodeURIComponent(decoded);
    if (
      decoded.includes("%") || /[\x00-\x20\x7f]/.test(decoded) || decoded.startsWith("//") ||
      decoded.includes("..") ||
      decoded.includes("\\") ||
      decoded.includes("://") ||
      /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded) ||
      decoded.includes("\0")
    ) {
      throw new ValidationErrorV2(
        `Decoded path traversal or schemes are forbidden at '${path}'`,
        path,
        "TRAVERSAL_FORBIDDEN"
      );
    }
  } catch (err: any) {
    if (err instanceof ValidationErrorV2) throw err;
    throw new ValidationErrorV2(
      `Malformed URI encoding at '${path}'`,
      path,
      "MALFORMED_URI"
    );
  }
}

function validateRoute(val: unknown, path: string): string {
  if (typeof val !== "string" || val.length === 0 || val.length > 256) {
    throw new ValidationErrorV2(
      `Route at '${path}' must be a string between 1 and 256 characters`,
      path,
      "INVALID_ROUTE"
    );
  }
  if (!val.startsWith("/")) {
    throw new ValidationErrorV2(
      `Route at '${path}' must be root-relative starting with '/'`,
      path,
      "INVALID_ROUTE"
    );
  }
  assertNoDangerousPatterns(val, path);
  assertNoTraversalOrSchemes(val, path);
  return val;
}

function validateHref(val: unknown, path: string): string {
  if (typeof val !== "string" || val.length === 0 || val.length > 512) {
    throw new ValidationErrorV2(
      `Href at '${path}' must be a string between 1 and 512 characters`,
      path,
      "INVALID_HREF"
    );
  }
  if (!val.startsWith("/") && !val.startsWith("#")) {
    throw new ValidationErrorV2(
      `Href at '${path}' must be root-relative ('/') or a fragment ('#')`,
      path,
      "INVALID_HREF"
    );
  }
  assertNoDangerousPatterns(val, path);
  assertNoTraversalOrSchemes(val, path);
  return val;
}

function validateText(val: unknown, path: string, maxLen = 256): string {
  if (typeof val !== "string" || val.length === 0 || val.length > maxLen) {
    throw new ValidationErrorV2(
      `Text at '${path}' must be a non-empty string of at most ${maxLen} characters`,
      path,
      "INVALID_TEXT"
    );
  }
  assertNoDangerousPatterns(val, path);
  return val;
}

function validateHeroRoute(raw: unknown, path: string): HeroRoute {
  const obj = assertPlainObject(raw, path);
  const knownKeys = [
    "actions",
    "announcement",
    "layout",
    "media",
    "route",
    "subtitle",
    "summary",
    "title",
  ];
  assertExactKeys(
    obj,
    knownKeys.filter((k) => k in obj),
    path
  );

  if (!("route" in obj) || !("layout" in obj) || !("title" in obj) || !("actions" in obj)) {
    throw new ValidationErrorV2(
      `Hero route requires 'route', 'layout', 'title', and 'actions' at '${path}'`,
      path,
      "MISSING_FIELD"
    );
  }

  const route = validateRoute(obj.route, `${path}.route`);

  if (!VALID_HERO_LAYOUTS.has(obj.layout as HeroLayout)) {
    throw new ValidationErrorV2(
      `Field '${path}.layout' must be one of 'centered', 'media-top', 'media-left', 'media-right', 'banner'`,
      `${path}.layout`,
      "INVALID_HERO_LAYOUT"
    );
  }
  const layout = obj.layout as HeroLayout;
  const title = validateText(obj.title, `${path}.title`, 256);

  let subtitle: string | undefined;
  if ("subtitle" in obj && obj.subtitle !== undefined) {
    subtitle = validateText(obj.subtitle, `${path}.subtitle`, 512);
  }

  let summary: string | undefined;
  if ("summary" in obj && obj.summary !== undefined) {
    summary = validateText(obj.summary, `${path}.summary`, 1024);
  }

  let announcement: HeroRoute["announcement"] | undefined;
  if ("announcement" in obj && obj.announcement !== undefined) {
    if (typeof obj.announcement === "string") {
      announcement = validateText(obj.announcement, `${path}.announcement`, 256);
    } else if (typeof obj.announcement === "object" && obj.announcement !== null) {
      const annObj = assertPlainObject(obj.announcement, `${path}.announcement`);
      assertExactKeys(
        annObj,
        ["href", "text"].filter((k) => k in annObj),
        `${path}.announcement`
      );
      if (!("text" in annObj)) {
        throw new ValidationErrorV2(
          `Announcement object requires 'text' at '${path}.announcement'`,
          `${path}.announcement.text`,
          "MISSING_FIELD"
        );
      }
      const annText = validateText(annObj.text, `${path}.announcement.text`, 256);
      let annHref: string | undefined;
      if ("href" in annObj && annObj.href !== undefined) {
        annHref = validateHref(annObj.href, `${path}.announcement.href`);
      }
      announcement = annHref !== undefined ? { text: annText, href: annHref } : annText;
    } else {
      throw new ValidationErrorV2(
        `Announcement must be a string or { text, href? } object at '${path}.announcement'`,
        `${path}.announcement`,
        "INVALID_ANNOUNCEMENT"
      );
    }
  }

  if (!Array.isArray(obj.actions) || obj.actions.length === 0 || obj.actions.length > 8) {
    throw new ValidationErrorV2(
      `Actions at '${path}.actions' must be an array of 1 to 8 action items`,
      `${path}.actions`,
      "INVALID_ACTIONS"
    );
  }

  const actions: HeroAction[] = [];
  for (let j = 0; j < obj.actions.length; j++) {
    const actRaw = obj.actions[j];
    const actPath = `${path}.actions[${j}]`;
    const actObj = assertPlainObject(actRaw, actPath);
    assertExactKeys(actObj, ["href", "label"], actPath);

    if (!("label" in actObj) || !("href" in actObj)) {
      throw new ValidationErrorV2(
        `Action requires 'label' and 'href' at '${actPath}'`,
        actPath,
        "MISSING_FIELD"
      );
    }
    const label = validateText(actObj.label, `${actPath}.label`, 64);
    const href = validateHref(actObj.href, `${actPath}.href`);
    actions.push({ label, href });
  }

  let media: "loom-orbit" | undefined;
  if ("media" in obj && obj.media !== undefined) {
    if (obj.media !== "loom-orbit") {
      throw new ValidationErrorV2(
        `Field '${path}.media' must be 'loom-orbit'`,
        `${path}.media`,
        "INVALID_HERO_MEDIA"
      );
    }
    media = "loom-orbit";
  }

  return {
    route,
    layout,
    title,
    ...(subtitle !== undefined ? { subtitle } : {}),
    ...(summary !== undefined ? { summary } : {}),
    ...(announcement !== undefined ? { announcement } : {}),
    actions,
    ...(media !== undefined ? { media } : {}),
  };
}

function validateHeroConfig(raw: unknown, path: string): CatalogHeroConfig {
  const obj = assertPlainObject(raw, path);
  assertExactKeys(obj, ["routes"], path);

  if (!Array.isArray(obj.routes) || obj.routes.length === 0 || obj.routes.length > 32) {
    throw new ValidationErrorV2(
      `Field '${path}.routes' must be an array of 1 to 32 hero routes`,
      `${path}.routes`,
      "INVALID_HERO_ROUTES"
    );
  }

  const routes: HeroRoute[] = [];
  for (let i = 0; i < obj.routes.length; i++) {
    routes.push(validateHeroRoute(obj.routes[i], `${path}.routes[${i}]`));
  }

  return { routes };
}

function validatePageTitleConfig(raw: unknown, path: string): CatalogPageTitleConfig {
  const obj = assertPlainObject(raw, path);
  assertExactKeys(obj, ["copy"], path);

  if (!VALID_PAGE_TITLE_COPY.has(obj.copy as string)) {
    throw new ValidationErrorV2(
      `Field '${path}.copy' must be 'none', 'title', or 'url'`,
      `${path}.copy`,
      "INVALID_PAGETITLE_COPY"
    );
  }

  return { copy: obj.copy as "none" | "title" | "url" };
}

function validatePaginationConfig(raw: unknown, path: string): CatalogPaginationConfig {
  const obj = assertPlainObject(raw, path);
  assertExactKeys(obj, ["variant"], path);

  if (!VALID_PAGINATION_VARIANTS.has(obj.variant as string)) {
    throw new ValidationErrorV2(
      `Field '${path}.variant' must be 'plain', 'card', or 'compact'`,
      `${path}.variant`,
      "INVALID_PAGINATION_VARIANT"
    );
  }

  return { variant: obj.variant as "plain" | "card" | "compact" };
}

function validateSidebarConfig(raw: unknown, path: string): CatalogSidebarConfig {
  const obj = assertPlainObject(raw, path);
  assertExactKeys(obj, ["groupIds", "mode"], path);

  if (!VALID_SIDEBAR_MODES.has(obj.mode as string)) {
    throw new ValidationErrorV2(
      `Field '${path}.mode' must be 'nested', 'tabs', 'select', or 'active-only'`,
      `${path}.mode`,
      "INVALID_SIDEBAR_MODE"
    );
  }

  if (!Array.isArray(obj.groupIds) || obj.groupIds.length === 0 || obj.groupIds.length > 16) {
    throw new ValidationErrorV2(
      `Field '${path}.groupIds' must be an array of 1 to 16 group IDs`,
      `${path}.groupIds`,
      "INVALID_SIDEBAR_GROUPS"
    );
  }

  const groupIds: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < obj.groupIds.length; i++) {
    const id = obj.groupIds[i];
    const idPath = `${path}.groupIds[${i}]`;
    if (typeof id !== "string" || !ID_SLUG_REGEX.test(id) || id.length > 64) {
      throw new ValidationErrorV2(
        `Group ID at '${idPath}' must be a kebab-case slug of at most 64 characters`,
        idPath,
        "INVALID_ID"
      );
    }
    if (seen.has(id)) {
      throw new ValidationErrorV2(
        `Duplicate group ID '${id}' at '${idPath}'`,
        idPath,
        "DUPLICATE_GROUP_ID"
      );
    }
    seen.add(id);
    groupIds.push(id);
  }

  return {
    mode: obj.mode as "nested" | "tabs" | "select" | "active-only",
    groupIds,
  };
}

function validateFontLicenses(raw: unknown, path: string): CatalogFontLicense[] {
  if (!Array.isArray(raw)) {
    throw new ValidationErrorV2(
      `Field '${path}' must be an array of font licenses`,
      path,
      "INVALID_FONT_LICENSES"
    );
  }

  if (raw.length > 8) {
    throw new ValidationErrorV2(
      `Field '${path}' exceeds maximum limit of 8 font licenses`,
      path,
      "TOO_MANY_FONT_LICENSES"
    );
  }

  const licenses: CatalogFontLicense[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const licPath = `${path}[${i}]`;
    const obj = assertPlainObject(raw[i], licPath);
    assertExactKeys(obj, ["id", "sha256", "text"], licPath);

    if (typeof obj.id !== "string" || !ID_SLUG_REGEX.test(obj.id) || obj.id.length > 64) {
      throw new ValidationErrorV2(
        `Font license ID at '${licPath}.id' must be a kebab-case slug of at most 64 characters`,
        `${licPath}.id`,
        "INVALID_ID"
      );
    }
    if (seenIds.has(obj.id)) {
      throw new ValidationErrorV2(
        `Duplicate font license ID '${obj.id}' at '${licPath}.id'`,
        `${licPath}.id`,
        "DUPLICATE_LICENSE_ID"
      );
    }
    seenIds.add(obj.id);

    if (typeof obj.text !== "string" || obj.text.length === 0 || Buffer.byteLength(obj.text, "utf8") > 65536) {
      throw new ValidationErrorV2(
        `Font license text at '${licPath}.text' must be a non-empty string of at most 64 KiB`,
        `${licPath}.text`,
        "INVALID_LICENSE_TEXT"
      );
    }

    if (typeof obj.sha256 !== "string") {
      throw new ValidationErrorV2(
        `Font license sha256 at '${licPath}.sha256' must be a string`,
        `${licPath}.sha256`,
        "INVALID_DIGEST"
      );
    }

    const normalizedHash = normalizeDigest(obj.sha256);
    const expectedHash = computeSha256(obj.text);
    if (normalizedHash !== expectedHash) {
      throw new ValidationErrorV2(
        `Font license sha256 mismatch at '${licPath}.sha256': declared '${normalizedHash}', computed '${expectedHash}'`,
        `${licPath}.sha256`,
        "LICENSE_HASH_MISMATCH"
      );
    }

    licenses.push({
      id: obj.id,
      text: obj.text,
      sha256: expectedHash,
    });
  }

  return licenses;
}

export function validateCatalogConfig(raw: unknown, path = "root.catalog"): ThemeCatalogConfig {
  const obj = assertPlainObject(raw, path);
  assertExactKeys(
    obj,
    ["fontLicenses", "hero", "layout", "pageTitle", "pagination", "sidebar"],
    path
  );

  if (obj.layout !== "standard" && obj.layout !== "compact") {
    throw new ValidationErrorV2(
      `Field '${path}.layout' must be 'standard' or 'compact'`,
      `${path}.layout`,
      "INVALID_LAYOUT"
    );
  }
  const layout = obj.layout as "standard" | "compact";

  const hero = validateHeroConfig(obj.hero, `${path}.hero`);
  const pageTitle = validatePageTitleConfig(obj.pageTitle, `${path}.pageTitle`);
  const pagination = validatePaginationConfig(obj.pagination, `${path}.pagination`);
  const sidebar = validateSidebarConfig(obj.sidebar, `${path}.sidebar`);
  const fontLicenses = validateFontLicenses(obj.fontLicenses, `${path}.fontLicenses`);

  return {
    hero,
    pageTitle,
    pagination,
    sidebar,
    layout,
    fontLicenses,
  };
}

/**
 * Validates a complete theme specification with the TFSB61B catalog envelope.
 * Fully validates catalog fields, enforces WOFF/WOFF2 font license requirements,
 * lowers by removing catalog, and verifies against core/code contracts.
 */
export function validateThemeCatalog(input: unknown): ThemeSpecificationCatalog {
  // 1. Safe preflight checking: prototypes, functions, getters/setters, depth, 1 MiB limit
  assertSafePreSerialization(input);

  const root = assertPlainObject(input, "root");

  // Check overall size
  const rawJson = JSON.stringify(input);
  if (Buffer.byteLength(rawJson, "utf8") > 1024 * 1024) {
    throw new ValidationErrorV2(
      "Theme specification total size exceeds maximum limit of 1 MiB",
      "root",
      "OVERSIZED_INPUT"
    );
  }

  if (root.schemaVersion !== "tfsl.theme-v2") {
    throw new ValidationErrorV2(
      `Theme must have schemaVersion 'tfsl.theme-v2' (got: ${JSON.stringify(root.schemaVersion)})`,
      "root.schemaVersion",
      "INVALID_SCHEMA_VERSION"
    );
  }

  // 2. Validate required catalog field
  if (!Object.prototype.hasOwnProperty.call(root, "catalog")) {
    throw new ValidationErrorV2(
      "Missing required field 'catalog'",
      "root.catalog",
      "MISSING_FIELD"
    );
  }

  const validatedCatalog = validateCatalogConfig(root.catalog, "root.catalog");

  // 3. Cross-validate font license requirement and WOFF/WOFF2 format
  if (Array.isArray(root.fonts)) {
    const licensesById = new Map(validatedCatalog.fontLicenses.map((l) => [l.id, l]));
    for (let i = 0; i < root.fonts.length; i++) {
      const font = root.fonts[i];
      const fontPath = `root.fonts[${i}]`;
      if (font && typeof font === "object") {
        if (font.format !== "woff" && font.format !== "woff2") {
          throw new ValidationErrorV2(
            `Font '${font.id || i}' format must be 'woff' or 'woff2' (got: ${JSON.stringify(font.format)})`,
            `${fontPath}.format`,
            "INVALID_FONT_FORMAT"
          );
        }
        if (typeof font.notice === "string") {
          if (!licensesById.has(font.notice)) {
            throw new ValidationErrorV2(
              `Font '${font.id}' (notice: '${font.notice}') requires matching license in catalog.fontLicenses`,
              "root.catalog.fontLicenses",
              "MISSING_FONT_LICENSE"
            );
          }
        }
      }
    }
  }

  // 4. Lower only after full catalog validation: remove catalog for core/code validation
  const lowered: Record<string, unknown> = { ...root };
  delete lowered.catalog;

  const isCode =
    Boolean(lowered.codePresentation) &&
    typeof lowered.codePresentation === "object" &&
    (lowered.codePresentation as any).mode === "expressive-code";

  if (isCode) {
    const validatedCode = validateThemeCode(lowered);
    // Retain code tabs deferred sentinel
    if (validatedCode.codePresentation.tabs !== "deferred") {
      throw new ValidationErrorV2(
        `Code tabs must retain 'deferred' sentinel`,
        "root.codePresentation.tabs",
        "INVALID_TABS_SENTINEL"
      );
    }
    return {
      ...validatedCode,
      catalog: validatedCatalog,
    } as ThemeSpecificationCatalog;
  } else {
    // If codePresentation is not provided, ensure sentinel default
    if (!lowered.codePresentation) {
      lowered.codePresentation = "consumer-default";
    }
    const validatedCore = validateThemeV2(lowered);
    return {
      ...validatedCore,
      catalog: validatedCatalog,
    } as ThemeSpecificationCatalog;
  }
}

/**
 * Fast, safe own-property preflight type guard for catalog themes.
 */
export function isThemeCatalog(input: unknown): input is ThemeSpecificationCatalog {
  if (!input || typeof input !== "object") return false;
  const desc = Object.getOwnPropertyDescriptor(input, "catalog");
  return (
    !!desc &&
    desc.value !== null &&
    typeof desc.value === "object" &&
    (input as any).schemaVersion === "tfsl.theme-v2"
  );
}
export { assertSafePreSerialization };
