import type { BodyFontOption, CodeFontOption, ThemePalette, ThemeSpecification } from "../types.js";

const FONT_MAP: Record<BodyFontOption | CodeFontOption, string> = {
  "system-sans": '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  "system-serif": 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  "system-mono": 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  "system-code": 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
};

/**
 * Documented field-to-token mapping for Starlight v0.42:
 * - accent.base -> --sl-color-accent (interactive accents, link base, focus outlines)
 * - accent.low -> --sl-color-accent-low (accent backgrounds, highlights)
 * - accent.high -> --sl-color-accent-high (accent text, focus rings)
 * - neutrals.bg -> --sl-color-bg and --sl-color-black (page canvas & container backgrounds)
 * - neutrals.bgNav -> --sl-color-bg-nav (header / navbar background)
 * - neutrals.bgSidebar -> --sl-color-bg-sidebar (sidebar pane background)
 * - neutrals.bgInlineCode -> --sl-color-bg-inline-code (inline code element background)
 * - neutrals.bgAccent -> --sl-color-bg-accent (accent badges, banner backgrounds)
 * - neutrals.text -> --sl-color-text (body prose text)
 * - neutrals.textAccent -> --sl-color-text-accent (inline anchor text)
 * - neutrals.textInvert -> --sl-color-text-invert (text on high-contrast accent backgrounds)
 * - neutrals.hairline -> --sl-color-hairline (dividers, horizontal rules)
 * - neutrals.hairlineLight -> --sl-color-hairline-light (subtle card and table borders)
 * - neutrals.hairlineShade -> --sl-color-hairline-shade (navbar bottom border, shadows)
 * - grays.gray1..gray7 -> --sl-color-gray-1..7 (neutral scale)
 * - grays.gray1 -> --sl-color-white (markdown headings h1-h6, a:hover, th, summary)
 * - typography.bodyFont -> --sl-font (main prose typography stack)
 * - typography.codeFont -> --sl-font-mono (monospace / code block font stack)
 * - typography.baseFontSize -> --sl-text-body (consumed by Starlight user components like Card body clamp: clamp(var(--sl-text-sm), calc(.5rem + 1vw), var(--sl-text-body)))
 * - typography.lineHeight -> --sl-line-height (body prose line height)
 * - layout.contentWidth -> --sl-content-width (main documentation reading column max width)
 * - layout.sidebarWidth -> --sl-sidebar-width (navigation sidebar width)
 */
function renderPaletteTokens(p: ThemePalette, indent = "  "): string[] {
  return [
    `${indent}--sl-color-accent: ${p.accent.base};`,
    `${indent}--sl-color-accent-low: ${p.accent.low};`,
    `${indent}--sl-color-accent-high: ${p.accent.high};`,
    `${indent}--sl-color-white: ${p.grays.gray1};`,
    `${indent}--sl-color-black: ${p.neutrals.bg};`,
    `${indent}--sl-color-bg: ${p.neutrals.bg};`,
    `${indent}--sl-color-bg-nav: ${p.neutrals.bgNav};`,
    `${indent}--sl-color-bg-sidebar: ${p.neutrals.bgSidebar};`,
    `${indent}--sl-color-bg-inline-code: ${p.neutrals.bgInlineCode};`,
    `${indent}--sl-color-bg-accent: ${p.neutrals.bgAccent};`,
    `${indent}--sl-color-text: ${p.neutrals.text};`,
    `${indent}--sl-color-text-accent: ${p.neutrals.textAccent};`,
    `${indent}--sl-color-text-invert: ${p.neutrals.textInvert};`,
    `${indent}--sl-color-hairline: ${p.neutrals.hairline};`,
    `${indent}--sl-color-hairline-light: ${p.neutrals.hairlineLight};`,
    `${indent}--sl-color-hairline-shade: ${p.neutrals.hairlineShade};`,
    `${indent}--sl-color-gray-1: ${p.grays.gray1};`,
    `${indent}--sl-color-gray-2: ${p.grays.gray2};`,
    `${indent}--sl-color-gray-3: ${p.grays.gray3};`,
    `${indent}--sl-color-gray-4: ${p.grays.gray4};`,
    `${indent}--sl-color-gray-5: ${p.grays.gray5};`,
    `${indent}--sl-color-gray-6: ${p.grays.gray6};`,
    `${indent}--sl-color-gray-7: ${p.grays.gray7};`,
  ];
}

export function compileStarlightCss(spec: ThemeSpecification, inputDigest: string): string {
  const bodyFontStack = FONT_MAP[spec.typography.bodyFont];
  const codeFontStack = FONT_MAP[spec.typography.codeFont];

  const commonVars: string[] = [
    `  --sl-font: ${bodyFontStack};`,
    `  --sl-font-mono: ${codeFontStack};`,
    `  --sl-content-width: ${spec.layout.contentWidth};`,
    `  --sl-sidebar-width: ${spec.layout.sidebarWidth};`,
  ];

  if (spec.typography.baseFontSize) {
    commonVars.push(`  --sl-text-body: ${spec.typography.baseFontSize};`);
  }
  if (spec.typography.lineHeight !== undefined) {
    commonVars.push(`  --sl-line-height: ${spec.typography.lineHeight};`);
  }

  const darkTokens = renderPaletteTokens(spec.colors.dark, "  ");
  const lightTokens = renderPaletteTokens(spec.colors.light, "  ");

  const lines: string[] = [
    "/* Theme Forge Stellar Loom generated theme */",
    `/* Schema: ${spec.schemaVersion} | Adapter: ${spec.adapter} | Input-Digest: ${inputDigest} */`,
    "",
    ":root,",
    "::backdrop {",
    ...darkTokens,
    ...commonVars,
    "}",
    "",
    ":root[data-theme='light'],",
    "[data-theme='light'] ::backdrop {",
    ...lightTokens,
    ...commonVars,
    "}",
    "",
  ];

  return lines.join("\n");
}
