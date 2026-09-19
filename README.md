# Theme Forge Stellar Loom (TFSL)

Starlight theme-builder backend, library, and CLI.

Version 0.1.0 is published on [npm](https://www.npmjs.com/package/@knowledge-forge-ai/theme-forge-stellar-loom)
and [GitHub](https://github.com/Knowledge-Forge-AI/theme-forge-stellar-loom/releases/tag/v0.1.0).
Install from the registry:

```sh
npm install @knowledge-forge-ai/theme-forge-stellar-loom
```

The 0.3.0 source candidate introduces reading layout presets (`--reading-layout`), distribution-safe TypeScript emission (`--language typescript`), Expressive Code syntax styling derivation, and book-chrome navigation.

### Theme v2 and catalog

`tfsl.theme-v2` is a separate closed domain. Historical `tfsl.theme-v1` validation,
canonical bytes, generated packages and strict exchange compatibility remain supported.
Use `loom-black-core`, `loom-flexoki-core`, and `loom-celestia-core` in `examples`
as first-party capability fixtures, not reproductions of upstream designs.

The ordinary library `compileTheme`, CLI `validate`/`compile`/`generate`, and batch
`compile`/`validate` discriminate by `schemaVersion`. V2 compilation returns an
ordered `styles` map and a v2 descriptor; `css` (batch `compiledCss`) is its ordered
concatenation for display. It is not a structural browser preview. CLI compile
writes the fixed five stylesheet files and descriptor to an absent or empty
directory. V2 does not support `--overwrite`.

```sh
tfsl validate examples/loom-black-core.theme.json
tfsl compile examples/loom-black-core.theme.json --out compiled
tfsl generate examples/loom-black-core.theme.json --package metadata.json --out theme-package
```

Use `--accent <declared-id>` to select another complete light/dark variant.
The stylesheet order is `styles/layers.css`, `styles/tokens.css`,
`styles/base.css`, `styles/accent.css`, `styles/overrides.css`. The declaration
places `starlight` before `tfsl`, then orders Loom's tokens, base, accent and
overrides sublayers. Unlayered consumer custom CSS follows defaults and wins
under ordinary CSS cascade rules. Documented override selectors include `:root`,
`.sl-markdown-content a:focus-visible`, and `::selection`.

The catalog supports finite Hero, PageTitle, Pagination and Sidebar choices,
responsive navigation, and bounded syntax/frame/diff presentation. Consumer
components and supported Expressive Code values retain precedence. Catalog
specifications include a closed `catalog` object; use the catalog examples for
these capabilities. Core specifications without that object retain their
separate, smaller contract. Unknown structures fail closed.

Header/PageFrame replacements, generated code tabs, virtual data modules and
font-provider conversion remain deferred. Public Starlight search, theme,
language and supporting controls retain their normal behavior.

Font records use logical IDs, face metadata, a SHA-256 and license/notice
identities. The spec has no paths or URLs. Explicitly materialize local resources
with `materializeFontResources(root, declarations, selectedIds)` and pass the
returned map as `fontResources` to `generateThemePackageV2`. The existing CLI
uses `--font-root <selected-directory> --font-ids <comma-separated-ids>`.
Only fixed `<id>.woff` or `<id>.woff2` leaves are read: at most eight resources,
4 MiB each and 16 MiB total, rejecting symlinks, traversal and digest mismatches.
Generated font filenames are fixed ordinals. Core byte-pipeline fixtures are
explicitly non-rendering original bytes; actual font rendering and third-party
font licensing require catalog qualification. System fonts make no promise of
pixel-identical cross-OS rendering.

The legacy v1 exchange verifier requires the exact producer version: compiler
0.2.0 rejects briefs pinned to `compilerVersion: "0.1.0"` or the historical
0.1.1 development compiler. Theme v1 compilation remains supported.

V2 semantic compatibility is independent of package SemVer. Producer package
version is provenance, not a compatibility gate. Exchange v2 recompiles locally
and requires exact bound output/inventory equality; a producer patch version
cannot conceal changed output. Explicit v1 import creates a fresh unadopted v2
candidate linked to the historical packet; it never changes historical bytes.

For offline installation of the candidate:
`npm install --ignore-scripts ./knowledge-forge-ai-theme-forge-stellar-loom-0.2.0.tgz`.

[Repository](https://github.com/Knowledge-Forge-AI/theme-forge-stellar-loom) ·
[Issues](https://github.com/Knowledge-Forge-AI/theme-forge-stellar-loom/issues) ·
[License](./LICENSE).

The installed `tfsl` and `tfsl-batch` commands and public imports need no checkout.
Generated plugin compatibility is demonstrated with Astro 7.3.1 and Starlight
0.42.0. Ordinary generated packages remain private by default.

Theme Forge Stellar Loom compiles typed, versioned theme specifications into canonical, deterministic CSS custom properties and theme descriptors for Starlight documentation sites.

## Overview

- **Versioned Theme Schemas**: `tfsl.theme-v1` and `tfsl.theme-v2`
- **Adapter**: `starlight-v0.42`
- **Zero-Dependency Core**: Compiles without runtime dependencies (`node:crypto`, `node:fs/promises`, `node:path` only).
- **Deterministic**: Produces byte-identical CSS and SHA-256 digests across environments.
- **Deterministic Contrast Diagnostics**: WCAG 2.2 AA luminance and contrast ratio calculations for body text, links, and inline code across light and dark modes.
- **Safety First**: Strict validation prevents CSS injection; refuses symlink destination roots and dangling intermediate symlinks (resolving safe existing intermediate parent directories), requires empty or absent destination directories for package generation (no in-place overwrite), requires `--overwrite` for existing compilation outputs, protects manually edited CSS by verifying existing descriptor output digests, and detects input/output collisions.

## Setup and Build Prerequisites

Before running the CLI or building the fixture, compile the TypeScript source to `dist/`:

```bash
# From this standalone source package root (Node >=22)
npm ci --ignore-scripts
npm run build
npm run typecheck
npm test
npm pack --pack-destination /path/to/fresh-artifacts
```

`bin/tfsl.js` imports `../dist/cli.js`, so `npm run build` is a mandatory prerequisite for the CLI executable and fixture prebuild scripts.

## CLI Usage

```bash
# Validate a theme specification and inspect contrast diagnostics
node bin/tfsl.js validate ./examples/stellar-cyan.theme.json

# Fail validation if contrast warnings exist
node bin/tfsl.js validate ./examples/stellar-cyan.theme.json --strict-contrast

# Compile to custom CSS and descriptor
node bin/tfsl.js compile ./examples/stellar-cyan.theme.json --out ./dist/theme

# Generate an installable Starlight theme package
node bin/tfsl.js generate ./examples/stellar-cyan.theme.json --package ./pkg-meta.json --out ./dist/cyan-package

# Generate an installable package with the approved page-title-frame template
node bin/tfsl.js generate ./examples/amber-forge.theme.json --package ./pkg-meta.json --out ./dist/amber-package --template page-title-frame

# Re-compile into existing directory (verifies existing descriptor and unedited theme.css)
node bin/tfsl.js compile ./examples/stellar-cyan.theme.json --out ./dist/theme --overwrite

# Output parseable JSON diagnostics without progress prose
node bin/tfsl.js compile ./examples/stellar-cyan.theme.json --out ./dist/theme --json

# Show help
node bin/tfsl.js --help

# Show version
node bin/tfsl.js --version

# Run batch IPC runner over stdin/stdout (used by Theme Lab)
node bin/tfsl-batch.js
```

## Theme Data Contract

Theme Forge Stellar Loom accepts untrusted JSON data conforming to the `tfsl.theme-v1` specification. Top-level plain objects inherit strictly from standard `Object.prototype` or `null` to defend against prototype pollution (`INVALID_PROTOTYPE`).

### Fields & Version Grammar

- **`schemaVersion`**: Must be exactly `"tfsl.theme-v1"`.
- **`adapter`**: Must be exactly `"starlight-v0.42"`.
- **`name`**: Alphanumeric identifier (`^[a-zA-Z0-9_-]{1,64}$`).
- **`version`**: Strict SemVer 2.0.0 without leading zeroes in major/minor/patch segments (e.g. `0.1.0`), matching `^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-...)?$`.
- **`$schema`** (optional): Non-executing editor tooling metadata string; excluded from canonical semantic hashing and never dereferenced.
- **`colors`**: Object containing `dark` and `light` palettes. Each palette must specify:
  - `accent`: `base`, `low`, `high` (all 7-character `#rrggbb` hex colors).
  - `neutrals`: `bg`, `bgNav`, `bgSidebar`, `bgInlineCode`, `bgAccent`, `text`, `textAccent`, `textInvert`, `hairline`, `hairlineLight`, `hairlineShade` (all `#rrggbb`).
  - `grays`: `gray1` through `gray7` (all `#rrggbb`).
- **`typography`**:
  - `bodyFont`: `"system-sans"` | `"system-serif"` | `"system-mono"`.
  - `codeFont`: `"system-mono"` | `"system-code"`.
  - `baseFontSize` (optional): Bounded dimension string (see bounds below).
  - `lineHeight` (optional): Bounded unitless number between 1.0 and 3.0.
- **`layout`**:
  - `contentWidth`: Bounded dimension string.
  - `sidebarWidth`: Bounded dimension string.

### Per-Unit Dimension Bounds

All dimension values are strictly validated against positive finite bounds by unit:

| Role | `px` | `rem` | `em` | `ch` |
| :--- | :---: | :---: | :---: | :---: |
| **`layout.contentWidth`** | [320, 3840] | [20, 240] | [20, 240] | [30, 200] |
| **`layout.sidebarWidth`** | [160, 600] | [10, 40] | [10, 40] | [15, 60] |
| **`typography.baseFontSize`** | [10, 36] | [0.625, 2.25] | [0.625, 2.25] | [1, 4] |

Spelling is canonically normalized within each unit (e.g., `048.00rem` -> `48rem`, `019.0px` -> `19px`). Units are not conflated; unit spelling is normalized, but unit conversions are preserved for rendering context.

### Exit Codes & CLI Behavior

| Code | Category | Meaning & Edge Triggers |
| :---: | :--- | :--- |
| `0` | Success | Command completed successfully (`validate`, `compile`, `--help`, `--version`). |
| `1` | Theme Specification Error | Schema validation failure, missing or unreadable input file, or contrast threshold failure under `--strict-contrast`. |
| `2` | Syntax / Invocation Error | Unknown options, missing option arguments, duplicate options, surplus operands, specifying `--overwrite` on `generate` (which is compile-only), or `--out` with a leading hyphen. (`--help` and `--version` are handled immediately before duplicate validation). |
| `3` | Filesystem Safety or I/O Failure | Non-empty target directory without `--overwrite` (for compile), non-empty target directory (for generate), symlink target or traversal refusal, non-regular target (FIFO/socket), unmanaged manual edits to `theme.css` without matching descriptor, input/output collision, or temporary staging/publication write failure. |

## Library API

```typescript
import {
  validateTheme,              // Alias to validateThemeSpecification
  validateThemeSpecification,
  ValidationError,
  compileTheme,
  canonicalizeTheme,          // Alias to canonicalizeSpecification
  canonicalizeSpecification,
  generateThemeDescriptor,
  computeSha256,
  analyzeThemeContrast,
  calculateContrastRatio,
  calculateRelativeLuminance,
  ContrastError,
} from "@knowledge-forge-ai/theme-forge-stellar-loom";

// 1. Validate specification (throws ValidationError on invalid input)
const spec = validateTheme(inputJson);

// 2. Canonicalize specification (returns canonical object, JSON, and SHA-256 digest; excludes $schema from digest)
const { canonicalObject, canonicalJson, inputDigest } = canonicalizeTheme(spec);

// 3. Analyze contrast
const diagnostics = analyzeThemeContrast(canonicalObject);

// 4. Compile to CSS, descriptor, and diagnostics
const { css, descriptor, outputDigest, diagnostics: compDiagnostics } = compileTheme(spec, {
  strictContrast: false, // Set true to throw ContrastError on contrast warnings
});

// 5. Generate complete installable Starlight plugin package (pure in-memory)
import { generateThemePackage, writeThemePackage } from "@knowledge-forge-ai/theme-forge-stellar-loom";

const packageResult = generateThemePackage({
  themeSpec: spec,
  metadata: {
    name: "starlight-theme-stellar-cyan",
    version: "0.1.0",
    description: "Stellar Cyan Starlight theme plugin",
    template: "page-title-frame", // Optional approved override template
  },
  strictContrast: false,
});

// 6. Write package files to disk safely (requires empty or absent directory)
const writeResult = await writeThemePackage(packageResult, "./dist/my-theme-package");
```

### Package Exports

Theme Forge Stellar Loom provides explicit subpath exports:
- `.` (`@knowledge-forge-ai/theme-forge-stellar-loom`): Core compiler, validator, generator, design exchange, and contrast diagnostics.
- `./batch` (`@knowledge-forge-ai/theme-forge-stellar-loom/batch`): Batch IPC runner (`runBatch`, `processBatchRequest`).
- `./cli` (`@knowledge-forge-ai/theme-forge-stellar-loom/cli`): Programmatic CLI invocation (`runCli`, `CLI_HELP`).
- `./protocol/*`: JSON schemas, inventory, and canonical protocol example packets.

## Protocol & Schemas

Theme Forge Stellar Loom defines and ships the portable theme evidence protocol v1 under `protocol/tfsl-theme-evidence-v1/`:
- `brief.schema.json`: Schema for `tfsl.theme-brief` (version 1)
- `candidate.schema.json`: Schema for `tfsl.theme-candidate` (version 1)
- `review.schema.json`: Schema for `tfsl.theme-review` (version 1)
- `visual-evidence.schema.json`: Schema for `tfsl.theme-visual-evidence` (version 1)
- `inventory.json`: Protocol inventory manifest
- `negative-corpus.json`: Closed negative test corpus
- `examples/`: Integrity-bound canonical packet examples (`brief`, `candidate-a`, `candidate-b`, `review`)


## Generated Starlight Plugin Contract

Each emitted theme package is a small, standalone Starlight plugin conforming to the pinned `@astrojs/starlight@0.42.0` specification.

### Integration

In consumer `astro.config.mjs`:

```javascript
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import themePlugin from "starlight-theme-stellar-cyan";

export default defineConfig({
  integrations: [
    starlight({
      title: "Docs",
      plugins: [themePlugin()],
      // Consumer customCss automatically takes precedence over theme defaults:
      customCss: ["./src/styles/custom.css"],
    }),
  ],
});
```

### Cascade Precedence & Component Overrides

- **CSS Cascade**: The plugin injects `${packageName}/styles/theme.css` before any existing entries in `config.customCss`. This cascade order guarantees that consumer CSS rules take precedence over theme defaults.
- **Idempotence**: Repeated hook invocations do not duplicate stylesheet registrations.
- **Component Overrides**: If the package includes the opt-in `page-title-frame` template, it registers `components.PageTitle` only if the consumer has not already configured a custom `PageTitle` component, strictly preserving consumer overrides.

## Code Presentation & Syntax Palette Integration

Stellar Loom v0.2.0 introduces code presentation configuration and full syntax palette catalog support:

### Syntax Palette Model & Schema

The `syntaxPalette` specification allows pairing custom syntax highlighting tokens with Expressive Code chrome:
- **`syntax`**: Light and dark hex color mappings for 11 syntax roles (`keyword`, `string`, `number`, `constant`, `function`, `type`, `variable`, `comment`, `punctuation`, `tag`, `attribute`).
- **`chrome`**: Light and dark role mappings for frame surfaces:
  - `background`: Editor frame code background.
  - `foreground`: Default text / copy button foreground.
  - `border`: Editor frame and inactive tab border.
  - `focus`: Copy button focus outline and active element highlight.
  - `tabBarBackground`: Starlight tablist / header strip background.
  - `activeTabBackground`: Active tab background surface.
  - `activeTabIndicator`: Active tab bottom accent line (`--sl-tab-color-border`).
  - `copyButtonForeground`: Copy button text/icon color.
- **`tabs`**: Tabbed presentation settings (e.g. `activeIndicator: "bottom"`).
- **`frame`**: Frame style: `"editor"`, `"terminal"`, or `"plain"`.

### Starlight Tabs Presentation

When `syntaxPalette` is supplied to `generateThemePackageCatalog`:
1. **`styles/tabs.css`**: Emitted as part of the theme package and automatically included in `customCss`.
2. **Visual Differentiation**: Active tab bottom border (`--sl-tab-color-border`) maps to `chrome[mode].activeTabIndicator`, while inactive tabs use `chrome[mode].border`, ensuring distinct, accessible visual state.
3. **Tablist Bottom Border**: Distinct 2px border separating the tab strip from tab content panels.

### STTN TypeScript Authoring & Distribution Build Closure

Theme packages can be emitted in either JavaScript (default) or TypeScript:
- **CLI**: Pass `--language typescript` to `tfsl generate`.
- **Catalog API**: Set `language: "typescript"` in `generateThemePackageCatalog({ ... })`.
- **Authoring Workflow**:
  - Emits typed source files (`src/index.ts`, `src/navigation.ts`, `src/middleware.ts`) alongside `tsconfig.json`.
  - Configures `build: "tsc"` and `prepare: "tsc"` package scripts.
  - Package exports map strictly to compiled `./dist/` artifacts (`./dist/index.js`, `./dist/index.d.ts`, `./dist/navigation.js`, `./dist/navigation.d.ts`).
  - Isolated distribution build closure ensures downstream consumers run standard type-checked JavaScript without requiring TypeScript runtime compilation.
- **Parity Guarantee**: TypeScript packages match JavaScript package browser rendering and CSS output byte-for-byte in consumer builds, verified via automated CI test suites (`test/ci/terminal-nova-rc.test.ts`).

### Book Chrome Layouts

Stellar Loom supports an integrated "Book Chrome" reading layout designed for dense technical documentation, long-form manuals, and book-style guides:
- **Configuration**: Set `bookChrome: true`, `bookChrome: false`, or provide a granular `BookChromeConfig`:
  ```typescript
  interface BookChromeConfig {
    chapterNavigation?: boolean; // Sequential next/previous chapter badges (default: true)
    chapterProgress?: boolean;   // Reading progress indicator and sidebar chapter markers (default: true)
    keyboardShortcuts?: boolean; // ArrowLeft / ArrowRight navigation shortcuts (default: true)
  }
  ```
- **Granular Markup Control**:
  - `chapterNavigation`: Controls emission of next/previous chapter links and side navigation arrows (`.tfsl-book-nav-arrow`) in `components/Pagination.astro`. Arrows are hidden on compact viewports and display on viewports `>= 80rem`.
  - `chapterProgress`: Emits reading progress badges in `components/Pagination.astro` and active chapter markers (`chapterActiveFontWeight: "600"`) in `components/Sidebar.astro` and `components/SidebarTree.astro`.
  - `keyboardShortcuts`: Emits client-side arrow key navigation listeners in `components/Pagination.astro`.
- **Keyboard & A11y Collision Safety**:
  Keyboard shortcuts respect user focus and assistive workflows. Event listeners immediately bail out when:
  - An event was already handled (`e.defaultPrevented`).
  - Active element is an editable input (`<input>`, `<select>`, `<textarea>`, or `isContentEditable`).
  - Focus resides inside interactive controls: tabs/roving tablists (`[role="tab"]`, `[role="tablist"]`), code blocks (`.expressive-code`, `<pre>`, `<code>`), open `<dialog>` elements, or horizontally scrollable containers.
- **Layered Styling & Zero `!important`**:
  All book chrome rules are scoped under `@layer tfsl.overrides` and `.tfsl-book-chrome`, guaranteeing zero `!important` declarations and complete respect for consumer unlayered custom CSS.
- **Deterministic Provenance**:
  Granular and boolean `BookChromeConfig` settings are normalized into an effective configuration object in `provenance.bookChrome`, ensuring semantically equivalent options (such as `bookChrome: true` and `bookChrome: {}`) yield identical package inventory digests, while distinct effective configurations yield distinct digests.

### Flexoki Paired Profile Cross-Framework Proof

Stellar Loom and Solar Sail share a unified design profile model (`packages/solar-sail/examples/flexoki.profile.json`) conforming to `tf-paired-profile-v1`:
- **Dual-Engine Compilation**: A single JSON design profile independently compiles into:
  1. A Tailwind v4 + shadcn/ui application theme (via Solar Sail).
  2. An Astro / Starlight documentation theme (via Stellar Loom).
- **Digest Equality & Determinism**:
  Both compilers compute identical canonical SHA-256 profile digests, guaranteeing provenance alignment across disparate component architectures.
- **Change Propagation & Target Overrides**:
  - Shared profile updates (e.g. primary/accent colors) propagate symmetrically to both targets.
  - Target-specific overrides (`targetOverrides.solarSail` vs `targetOverrides.loom`) modify only the selected framework's generated output while leaving the sibling engine's output digest unchanged.
- **Paired Browser Smoke Qualification**:
  Headless browser qualification (`node packages/stellar-loom/tools/smoke-code.mjs`) verifies both engines simultaneously:
  - Tests mobile (390px), desktop (1280px), and wide (1440px) viewports with zero horizontal overflow.
  - Asserts computed token styles across light and dark modes: teal primary (`#24837b` light, `#3aa99f` dark), surface backgrounds, elevated card styling, active chapter badges, and nested sidebar group hierarchies.


### Consumer Override Precedence & Negative Controls

Emitted themes strictly adhere to consumer sovereignty:
1. **Leaf Options**: Consumer Expressive Code options (e.g. `styleOverrides.frames.editorBackground`) deep-merge over theme defaults.
2. **Array Replacement**: Consumer array properties (e.g. `themes: ["github-light"]`) replace theme defaults rather than concatenating.
3. **Unlayered Custom CSS**: Consumer `customCss` stylesheets load after theme stylesheets and reside in unlayered space, overriding `@layer tfsl` rules under standard CSS cascade semantics.
4. **PageTitle Component Precedence**: Consumer-configured `components.PageTitle` completely bypasses theme frame wrappers.
5. **False Expressive Code Control**: Setting `expressiveCode: false` completely disables Expressive Code rendering, gracefully falling back to standard Markdown `<pre><code>`.

### Expressive Code Contrast Normalization

Expressive Code enforces a default minimum syntax contrast ratio of 5.5:1 (`minSyntaxHighlightingColorContrast: 5.5`).
- When a requested syntax token already achieves >= 5.5:1 contrast against `codeBackground`, Expressive Code renders the exact specified hex color.
- When a requested token has < 5.5:1 raw contrast (such as teal `#24837b` on light cream `#fffcf0`, ~4.1:1), Expressive Code dynamically adjusts luminance (darkening on light backgrounds or lightening on dark backgrounds) to reach at least 5.5:1.
- Both requested intent and normalized observed colors are tracked and validated in qualification receipts.

### Provenance Architecture & Output Digest Boundaries

Theme Forge distinguishes between CSS compilation output and package-level runtime configuration:
- **`cssOutputDigest`**: Represents the compilation digest of purely CSS-derived theme output (`styles/tokens.css`, `styles/base.css`, `styles/layers.css`, `styles/accent.css`, `styles/overrides.css`, and `styles/tabs.css`). Because `compileSyntaxPalette` digests the CSS compilation output, changing only JavaScript/runtime chrome roles (such as `frames.inlineButtonForeground` or `editorTabBarBackground` in `ecDefaults.styleOverrides`) does not alter `cssOutputDigest`.
- **`provenance.inventoryDigest`**: Covers the comprehensive file tree of the generated theme package, including `index.js` (or `src/index.ts`), component templates, and style assets. When any runtime chrome role in `syntaxPalette.chrome` changes, `ecDefaults.styleOverrides` changes in `index.js`/`src/index.ts`, modifying `provenance.inventoryDigest` while preserving `cssOutputDigest`.
- **Paired Role Fail-Closed Invariant**: Expressive Code requires tuples `[dark, light]` for style overrides. Every chrome role must be defined symmetrically in both dark and light modes; defining a role in only one mode throws a `[SYNTAX_PALETTE_VALIDATION_ERROR]` rather than silently dropping the specification.

### Qualification Modes: Hermetic Container vs Developer-Local Smoke

Theme Forge provides two operational qualification paths:
1. **Hermetic Container Matrix** (`npm run test:portable` / `npm test` / `node tools/scratch/run-container-suite.mjs`):
   - Fully isolated, non-mutating execution inside `tfsb-node:22-noble-pw1.62.1` (built from `mcr.microsoft.com/playwright:v1.62.1-noble` with Node 22).
   - Mounts source `:ro` with disposable named volumes and anonymous volumes for package `dist/`.
   - Runs offline (`--network=none`), builds tarballs, and runs the 9-suite matrix including `stellar-loom-browser-consumer`.
   - Automatically promotes bounded qualification receipts, evidence manifests, and paired-candidate screenshots to the configured evidence outbox directory (configured via `OUTBOX_DIR` or `THEME_FORGE_OUTBOX_DIR`, defaulting to `<outbox-root>/<run-id>/qualification`).
2. **Developer-Local Smoke** (`node packages/stellar-loom/tools/smoke-code.mjs`):
   - Standalone developer runner that packs fresh tarballs, builds disposable Astro consumers, launches headless Chromium, and evaluates all mandatory browser checks with live DOM/CSSOM inspection.
   - Outputs TAP version 13 summary and writes `receipt.json` and `evidence-manifest.json`.

## Licensing

Licensed under the GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later) with separate commercial licensing available. See `LICENSE` and `COMMERCIAL-LICENSE.md`.

### Core adapter qualification limits

Core browser evidence covers screen media on sidebar-bearing documentation pages.
Starlight 0.42.0 has unlayered sidebar-less content-width and print rules which can
win over Loom layers. Sidebar-less content sizing and a coherent print palette are
not qualified here; a later adapter/catalog decision must address them.

The catalog pins output-determining source files through repository tests. Installed
packages validate catalog/template data and recompile bound exchange output; they do
not read TypeScript source or provide tamper detection. Font stacks and responsive
content caps come directly from catalog data; sidebar width remains the explicit
surface value. Token-to-selector mappings live in the pinned compiler expression.

Historical v1 import is explicitly lossy: its new candidate rationale records the
original layout and fresh core defaults. Candidate IDs are freshly derived and old
unsigned provenance claims are not inherited. Fresh verification and adoption remain
required. V2 CLI output is structured JSON, including when `--json` is omitted.

For source qualification, run `npm ci --ignore-scripts`,
`node tools/build-catalog-evidence.mjs`, `npm run typecheck`, and `npm test`.
The catalog build command emits the executable identity required by exchange
verification and packaged consumers.
