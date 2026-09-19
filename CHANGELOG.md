# Changelog

## 0.3.0 — Unreleased candidate

- Reading layout preset: `--reading-layout` (CLI) and `readingLayout: true` (`GenerateCatalogPackageOptions`) emitting `--sl-content-margin-inline: auto` and centered content measure within `@layer tfsl.overrides`.
- Distribution-safe TypeScript package emission: `--language typescript` generating typed `src/index.ts`, `tsconfig.json`, and pre-compiled `./dist/index.js` / `./dist/index.d.ts` exports.
- Expressive Code syntax styling derivation: automatic palette mapping for code blocks, editor frames, tab bars, copy buttons, line highlights, and diff markers with zero `!important` declarations.
- Book-chrome layout presets: `.tfsl-book-chrome`, chapter navigation badges, side arrows, and horizontal-scroll-aware keyboard navigation.
- Cross-framework paired profile qualification with Theme Forge Solar Sail.
- Strictly preserves catalog-1 frozen capability digests (`HISTORICAL_CATALOG_DIGEST`, `EXPECTED_CATALOG_RUNTIME_DIGEST`).

## 0.2.0 — Released

Theme v2 adds the five-layer CSS compiler, semantic catalog identity, component
and code presentation envelopes, accents, font policy and exchange-v2 local
recompilation. Theme v1 remains supported. Invalid structural choices fail closed.
The accepted installed target is Astro 7.3.1 with Starlight 0.42.0.

## 0.1.0 — Released

The initial public release provides Theme v1, the library compiler and the `tfsl`
and `tfsl-batch` command-line interfaces. See the public `v0.1.0` release for its
immutable source and package identity.
