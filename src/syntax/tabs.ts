/**
 * @fileoverview Starlight & Expressive Code Tab Presentation Support (Outcome C).
 *
 * Implements high-value presentation hooks for:
 *  - Starlight <Tabs> and package-manager command tabs
 *  - Expressive Code file-name / editor title tabs
 *  - Active tab indicators and tab bar borders
 *
 * Architectural Boundary Record:
 * Starlight 0.42.0 and Expressive Code 0.44.2 do not support markdown-native
 * multi-tab code blocks (e.g. ```js tab="A" ... ```py tab="B"). Multi-tab command
 * sequences in Starlight are officially authored using <Tabs> and <TabItem>
 * components or starlight-package-managers. Expressive Code provides single-file
 * title tabs via frame title attributes (e.g. title="package.json").
 *
 * This implementation styles both surfaces coherently under @layer tfsl.overrides
 * without !important, ensuring starlight.components < tfsl.overrides < consumer CSS.
 */

export const CODE_TABS_CSS = `/* Theme Forge Stellar Loom - Code & Package-Manager Tabs Integration */
@layer tfsl.overrides {
  starlight-tabs {
    --tfsl-tab-color-active: var(--tfsl-color-accent-base, var(--sl-color-text-accent));
    margin-block: 1.5rem;
  }
  starlight-tabs [role="tablist"] {
    border-bottom: 2px solid var(--tfsl-color-border, var(--sl-color-gray-5));
  }
  starlight-tabs .tab > [role="tab"] {
    --sl-tab-color-border: var(--tfsl-color-border, var(--sl-color-gray-5));
    border-radius: var(--tfsl-radius, 4px) var(--tfsl-radius, 4px) 0 0;
    transition: color 0.15s ease, box-shadow 0.15s ease;
  }
  starlight-tabs .tab [role="tab"][aria-selected="true"] {
    --sl-tab-color-border: var(--tfsl-tab-color-active);
    color: var(--tfsl-color-body, var(--sl-color-white));
  }
  starlight-tabs [role="tabpanel"] .expressive-code {
    margin-top: 0.5rem;
  }
}
`;

export interface TabsCapabilities {
  supportsCodeTitleTabs: true;
  supportsPackageManagerTabs: true;
  supportsNativeMarkdownMultiTabs: false;
  boundaryNote: string;
}

export const TABS_CAPABILITIES: TabsCapabilities = Object.freeze({
  supportsCodeTitleTabs: true,
  supportsPackageManagerTabs: true,
  supportsNativeMarkdownMultiTabs: false,
  boundaryNote:
    "Starlight 0.42.0 supports tabs via <Tabs> and <TabItem> user components and Expressive Code file title frames; multi-tab code syntax without components is not exposed by Starlight. Tab indicator styles are scoped under @layer tfsl.overrides targeting .tab > [role='tab']; --tfsl-tab-color-active is a Loom-owned custom property.",
});
