import { verifyCatalogDigest, STARLIGHT_CORE_CATALOG_V1 } from "./catalog.js";
import { canonicalizeThemeV2, computeSha256 } from "./canonical.js";
import {
  CATALOG_DIGEST,
  CATALOG_IDENTITY,
  COLOR_ROLES,
  COMPILER_PRODUCER,
  COMPILER_SEMANTIC,
  COMPILER_VERSION,
  type ColorRole,
  type CompilationResultV2,
  type CompileThemeV2Options,
  type CompilerDiagnosticV2,
  type ThemeDescriptorV2,
} from "./types.js";
import { assertExactKeys, assertPlainObject, resolveToken, ValidationErrorV2 } from "./validator.js";

const SYSTEM_FONT_MAP: Readonly<Record<string, string>> = STARLIGHT_CORE_CATALOG_V1.approvedStacks;

function resolveFontStack(fontId: string, specFonts: Array<{ id: string; family: string }>, isCode = false): string {
  if (Object.hasOwn(SYSTEM_FONT_MAP, fontId)) {
    return SYSTEM_FONT_MAP[fontId]!;
  }
  const matched = specFonts.find((f) => f.id === fontId);
  if (matched) {
    const fallback = isCode ? SYSTEM_FONT_MAP["system-mono"] : SYSTEM_FONT_MAP["system-sans"];
    return `'${matched.family}', ${fallback}`;
  }
  return SYSTEM_FONT_MAP[isCode ? "system-mono" : "system-sans"]!;
}

export function compileThemeV2(
  input: unknown,
  options?: CompileThemeV2Options
): CompilationResultV2 {
  if (!verifyCatalogDigest()) throw new Error("Catalog expression digest mismatch; new catalog evidence required");
  // Disallow arbitrary options/spoofing of producer or catalog parameters
  if (options !== undefined) {
    assertPlainObject(options as unknown, "options");
    assertExactKeys(options as Record<string, unknown>, ["accent", "strictContrast"], "options");
  }

  if (options?.strictContrast) {
    throw new Error("V2 strict contrast qualification is not implemented; refusing to ignore the requested check");
  }

  const { canonicalObject, inputDigest } = canonicalizeThemeV2(input);

  const activeAccent = options?.accent ?? canonicalObject.defaultAccent;
  if (!(Object.hasOwn(canonicalObject.accentVariants, activeAccent))) {
    throw new ValidationErrorV2(
      `Unknown accent variant '${activeAccent}'`,
      "options.accent",
      "UNKNOWN_ACCENT"
    );
  }

  const variant = canonicalObject.accentVariants[activeAccent]!;
  const resolvedLight: Record<ColorRole, string> = {} as any;
  const resolvedDark: Record<ColorRole, string> = {} as any;

  for (const role of COLOR_ROLES) {
    resolvedLight[role] = resolveToken(
      canonicalObject.tokenSets,
      variant.tokenSet,
      variant.light[role]!,
      activeAccent,
      role,
      "light"
    );
    resolvedDark[role] = resolveToken(
      canonicalObject.tokenSets,
      variant.tokenSet,
      variant.dark[role]!,
      activeAccent,
      role,
      "dark"
    );
  }

  // 1. styles/layers.css
  const layersCss = `/* Theme Forge Stellar Loom v2 - Layer order declaration */
@layer starlight, tfsl;
@layer tfsl.tokens, tfsl.base, tfsl.accent, tfsl.overrides;
`;

  // 2. styles/tokens.css
  const bodyFontStack = resolveFontStack(canonicalObject.typography.body.font, canonicalObject.fonts, false);
  const headingFontStack = resolveFontStack(canonicalObject.typography.heading.font, canonicalObject.fonts, false);
  const uiFontStack = resolveFontStack(canonicalObject.typography.ui.font, canonicalObject.fonts, false);
  const codeFontStack = resolveFontStack(canonicalObject.typography.code.font, canonicalObject.fonts, true);

  const fontFaceRules: string[] = [];
  if (canonicalObject.fonts.length > 0) {
    for (let i = 0; i < canonicalObject.fonts.length; i++) {
      const font = canonicalObject.fonts[i]!;
      const ordinal = String(i).padStart(2, "0");
      fontFaceRules.push(`  @font-face {
    font-family: '${font.family}';
    font-style: ${font.style};
    font-weight: ${font.weight};
    font-display: swap;
    src: url('../fonts/font-${ordinal}.${font.format}') format('${font.format}');
  }`);
    }
  }

  const headingBaseSize = canonicalObject.typography.heading.size;
  const headingSizes = {
    h1: `${headingBaseSize}px`,
    h2: `${Math.round(headingBaseSize * 0.85)}px`,
    h3: `${Math.round(headingBaseSize * 0.72)}px`,
    h4: `${Math.round(headingBaseSize * 0.64)}px`,
    h5: `${Math.round(headingBaseSize * 0.57)}px`,
    h6: `${Math.round(headingBaseSize * 0.50)}px`,
  };

  const tokensCss = `@layer tfsl.tokens {
${fontFaceRules.length > 0 ? fontFaceRules.join("\n\n") + "\n\n" : ""}  :root,
  ::backdrop {
    --sl-font: ${bodyFontStack};
    --sl-font-mono: ${codeFontStack};
    --tfsl-font-body: ${bodyFontStack};
    --tfsl-font-heading: ${headingFontStack};
    --tfsl-font-ui: ${uiFontStack};
    --tfsl-font-code: ${codeFontStack};
    --sl-text-body: ${canonicalObject.typography.body.size}px;
    --sl-line-height: ${canonicalObject.typography.body.lineHeight};
    --sl-line-height-headings: ${canonicalObject.typography.heading.lineHeight};
    --sl-text-h1: ${headingSizes.h1};
    --sl-text-h2: ${headingSizes.h2};
    --sl-text-h3: ${headingSizes.h3};
    --sl-text-h4: ${headingSizes.h4};
    --sl-text-h5: ${headingSizes.h5};
    --sl-text-h6: ${headingSizes.h6};
    --sl-content-width: ${canonicalObject.surfaces.content}px;
    --sl-sidebar-width: ${canonicalObject.surfaces.sidebar}px;
    --tfsl-spacing: ${canonicalObject.surfaces.spacing}px;
    --tfsl-space-small: ${canonicalObject.surfaces.spacing / 2}px;
    --tfsl-space-large: ${canonicalObject.surfaces.spacing * 2}px;
    --tfsl-space-section: ${canonicalObject.surfaces.spacing * 4}px;
    --tfsl-radius-small: ${canonicalObject.surfaces.radii / 2}px;
    --tfsl-border-style: ${canonicalObject.surfaces.borderStyle ?? "solid"};
    --tfsl-focus-offset: ${canonicalObject.surfaces.focusOffset ?? 2}px;
    --tfsl-radius: ${canonicalObject.surfaces.radii}px;
    --tfsl-border-width: ${canonicalObject.surfaces.border}px;
    --tfsl-focus-width: ${canonicalObject.surfaces.focus}px;

    /* Theme color roles */
    --tfsl-color-page: ${resolvedDark.page};
    --tfsl-color-navigation: ${resolvedDark.navigation};
    --tfsl-color-header: ${resolvedDark.header};
    --tfsl-color-sidebar: ${resolvedDark.sidebar};
    --tfsl-color-raised: ${resolvedDark.raised};
    --tfsl-color-panel: ${resolvedDark.panel};
    --tfsl-color-card: ${resolvedDark.card};
    --tfsl-color-inline-code: ${resolvedDark["inline-code"]};
    --tfsl-color-code: ${resolvedDark.code};
    --tfsl-color-body: ${resolvedDark.body};
    --tfsl-color-secondary: ${resolvedDark.secondary};
    --tfsl-color-muted: ${resolvedDark.muted};
    --tfsl-color-inverted: ${resolvedDark.inverted};
    --tfsl-color-link: ${resolvedDark.link};
    --tfsl-color-hairline: ${resolvedDark.hairline};
    --tfsl-color-border: ${resolvedDark.border};
    --tfsl-color-focus: ${resolvedDark.focus};
    --tfsl-color-selection-background: ${resolvedDark["selection-background"]};
    --tfsl-color-selection-text: ${resolvedDark["selection-text"]};

    /* Starlight standard token mappings */
    --sl-color-bg: var(--tfsl-color-page);
    --sl-color-bg-nav: var(--tfsl-color-header);
    --sl-color-bg-sidebar: var(--tfsl-color-sidebar);
    --sl-color-bg-inline-code: var(--tfsl-color-inline-code);
    --sl-color-text: var(--tfsl-color-body);
    --sl-color-text-accent: var(--tfsl-color-link);
    --sl-color-text-invert: var(--tfsl-color-inverted);
    --sl-color-hairline: var(--tfsl-color-hairline);
    --sl-color-hairline-light: var(--tfsl-color-border);
    --sl-color-hairline-shade: var(--tfsl-color-border);
    --sl-color-white: var(--tfsl-color-secondary);
    --sl-color-black: var(--tfsl-color-page);
  }

  :root[data-theme='light'],
  [data-theme='light'] ::backdrop {
    /* Theme color roles */
    --tfsl-color-page: ${resolvedLight.page};
    --tfsl-color-navigation: ${resolvedLight.navigation};
    --tfsl-color-header: ${resolvedLight.header};
    --tfsl-color-sidebar: ${resolvedLight.sidebar};
    --tfsl-color-raised: ${resolvedLight.raised};
    --tfsl-color-panel: ${resolvedLight.panel};
    --tfsl-color-card: ${resolvedLight.card};
    --tfsl-color-inline-code: ${resolvedLight["inline-code"]};
    --tfsl-color-code: ${resolvedLight.code};
    --tfsl-color-body: ${resolvedLight.body};
    --tfsl-color-secondary: ${resolvedLight.secondary};
    --tfsl-color-muted: ${resolvedLight.muted};
    --tfsl-color-inverted: ${resolvedLight.inverted};
    --tfsl-color-link: ${resolvedLight.link};
    --tfsl-color-hairline: ${resolvedLight.hairline};
    --tfsl-color-border: ${resolvedLight.border};
    --tfsl-color-focus: ${resolvedLight.focus};
    --tfsl-color-selection-background: ${resolvedLight["selection-background"]};
    --tfsl-color-selection-text: ${resolvedLight["selection-text"]};

    /* Starlight standard token mappings */
    --sl-color-bg: var(--tfsl-color-page);
    --sl-color-bg-nav: var(--tfsl-color-header);
    --sl-color-bg-sidebar: var(--tfsl-color-sidebar);
    --sl-color-bg-inline-code: var(--tfsl-color-inline-code);
    --sl-color-text: var(--tfsl-color-body);
    --sl-color-text-accent: var(--tfsl-color-link);
    --sl-color-text-invert: var(--tfsl-color-inverted);
    --sl-color-hairline: var(--tfsl-color-hairline);
    --sl-color-hairline-light: var(--tfsl-color-border);
    --sl-color-hairline-shade: var(--tfsl-color-border);
    --sl-color-white: var(--tfsl-color-secondary);
    --sl-color-black: var(--tfsl-color-page);
  }
}
`;

  // 3. styles/base.css
  const baseCss = `@layer tfsl.base {
  body { font-family: var(--tfsl-font-body); font-size: ${canonicalObject.typography.body.size}px; line-height: ${canonicalObject.typography.body.lineHeight}; }
  header, nav, aside, button, select, input { font-family: var(--tfsl-font-ui); font-size: ${canonicalObject.typography.ui.size}px; line-height: ${canonicalObject.typography.ui.lineHeight}; }
  code, pre { font-family: var(--tfsl-font-code); font-size: ${canonicalObject.typography.code.size}px; line-height: ${canonicalObject.typography.code.lineHeight}; }
  nav { background-color: var(--tfsl-color-navigation); }
  .sl-markdown-content pre { background-color: var(--tfsl-color-code); }
  .sl-markdown-content blockquote { background-color: var(--tfsl-color-panel); border-color: var(--tfsl-color-border); }
  .sl-markdown-content details { background-color: var(--tfsl-color-raised); border-radius: var(--tfsl-radius-small); padding: var(--tfsl-space-small); }
  .sl-markdown-content small { color: var(--tfsl-color-muted); }
  @media (min-width: 50rem) { :root { --sl-content-width: min(${canonicalObject.surfaces.content}px, ${STARLIGHT_CORE_CATALOG_V1.approvedLayouts[canonicalObject.layoutPreset].contentWidth}px); } }
  h1, .sl-markdown-content :is(h1, h2, h3, h4, h5, h6) {
    font-family: var(--tfsl-font-heading, var(--sl-font));
    line-height: var(--sl-line-height-headings, 1.2);
    color: var(--tfsl-color-secondary, var(--sl-color-white));
  }

  .sl-markdown-content h1 {
    font-size: var(--sl-text-h1);
  }

  .sl-markdown-content h2 {
    font-size: var(--sl-text-h2);
  }

  .sl-markdown-content h3 {
    font-size: var(--sl-text-h3);
  }

  .sl-markdown-content h4 {
    font-size: var(--sl-text-h4);
  }

  .sl-markdown-content h5 {
    font-size: var(--sl-text-h5);
  }

  .sl-markdown-content h6 {
    font-size: var(--sl-text-h6);
  }

  /* Responsive heading scaling across breakpoints */
  @media (min-width: 50rem) {
    .sl-markdown-content h1 {
      font-size: calc(var(--sl-text-h1) * 1.15);
    }
    .sl-markdown-content h2 {
      font-size: calc(var(--sl-text-h2) * 1.1);
    }
  }

  @media (min-width: 72rem) {
    .sl-markdown-content h1 {
      font-size: calc(var(--sl-text-h1) * 1.25);
    }
    .sl-markdown-content h2 {
      font-size: calc(var(--sl-text-h2) * 1.15);
    }
  }

  /* Card and surface styling */
  .card,
  .sl-markdown-content .card {
    background-color: var(--tfsl-color-card);
    border: var(--tfsl-border-width, 1px) var(--tfsl-border-style) var(--tfsl-color-border);
    border-radius: var(--tfsl-radius, 8px);
  }

  /* Selection styling */
  ::selection {
    background-color: var(--tfsl-color-selection-background);
    color: var(--tfsl-color-selection-text);
  }
}
`;

  // 4. styles/accent.css
  const accentCss = `@layer tfsl.accent {
  :root,
  ::backdrop {
    --tfsl-color-accent-base: ${resolvedDark["accent-base"]};
    --tfsl-color-accent-low: ${resolvedDark["accent-low"]};
    --tfsl-color-accent-high: ${resolvedDark["accent-high"]};
    --sl-color-accent: var(--tfsl-color-accent-base);
    --sl-color-accent-low: var(--tfsl-color-accent-low);
    --sl-color-accent-high: var(--tfsl-color-accent-high);
  }

  :root[data-theme='light'],
  [data-theme='light'] ::backdrop {
    --tfsl-color-accent-base: ${resolvedLight["accent-base"]};
    --tfsl-color-accent-low: ${resolvedLight["accent-low"]};
    --tfsl-color-accent-high: ${resolvedLight["accent-high"]};
    --sl-color-accent: var(--tfsl-color-accent-base);
    --sl-color-accent-low: var(--tfsl-color-accent-low);
    --sl-color-accent-high: var(--tfsl-color-accent-high);
  }
}
`;

  // 5. styles/overrides.css
  const pageTitleOverride =
    canonicalObject.components.pageTitle === "page-title-frame"
      ? `
  .tfsl-page-title-frame {
    border-left: 4px solid var(--sl-color-accent);
    padding-left: 1rem;
    margin-bottom: 1.5rem;
  }`
      : "";

  const overridesCss = `@layer tfsl.overrides {
  :focus-visible {
    outline: var(--tfsl-focus-width, 2px) solid var(--tfsl-color-focus);
    outline-offset: var(--tfsl-focus-offset);
  }

  .sl-markdown-content a:focus-visible {
    outline: var(--tfsl-focus-width, 2px) solid var(--tfsl-color-focus);
    outline-offset: var(--tfsl-focus-offset);
  }${pageTitleOverride}
}
`;

  const styles = new Map<string, string>();
  styles.set("styles/layers.css", layersCss);
  styles.set("styles/tokens.css", tokensCss);
  styles.set("styles/base.css", baseCss);
  styles.set("styles/accent.css", accentCss);
  styles.set("styles/overrides.css", overridesCss);

  const css = [layersCss, tokensCss, baseCss, accentCss, overridesCss].join("\n\n") + "\n";
  const outputDigest = computeSha256(css);

  const descriptor: ThemeDescriptorV2 = {
    schema: "tfsl.theme-descriptor-v2",
    schemaVersion: 2,
    themeSchemaVersion: canonicalObject.schemaVersion,
    themeName: canonicalObject.name,
    themeVersion: canonicalObject.version,
    adapter: canonicalObject.adapter,
    selectedAccent: activeAccent,
    accent: activeAccent,
    inputDigest,
    outputDigest,
    inventoryDigest: computeSha256("tfsl.styles-inventory-v2\n" + JSON.stringify([...styles].map(([path, content]) => ({ path, sha256: computeSha256(content), size: Buffer.byteLength(content) })))),
    catalogIdentity: CATALOG_IDENTITY,
    catalogDigest: CATALOG_DIGEST,
    catalog: {
      identity: CATALOG_IDENTITY,
      digest: CATALOG_DIGEST,
    },
    compilerSemantic: COMPILER_SEMANTIC,
    provenance: {
      categories: [
        "user-authored-data",
        "generated-syntax",
        "first-party-expression",
      ],
      semantic: COMPILER_SEMANTIC,
      compiler: COMPILER_PRODUCER,
      compilerVersion: COMPILER_VERSION,
    },
  };

  const diagnostics: CompilerDiagnosticV2[] = [];

  return {
    specification: canonicalObject,
    css,
    styles,
    descriptor,
    inputDigest,
    outputDigest,
    diagnostics,
  };
}
