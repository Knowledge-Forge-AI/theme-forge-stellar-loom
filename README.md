# Theme Forge Stellar Loom (TFSL)

Starlight theme-builder backend, library, and CLI.

Version 0.1.0 is published on [npm](https://www.npmjs.com/package/@knowledge-forge-ai/theme-forge-stellar-loom)
and [GitHub](https://github.com/Knowledge-Forge-AI/theme-forge-stellar-loom/releases/tag/v0.1.0).
Install from the registry:

```sh
npm install @knowledge-forge-ai/theme-forge-stellar-loom
```

The 0.2.0 source candidate adds Theme v2, the finite component catalog, code
presentation and local exchange verification. It has not been published.
Install the exact candidate archive for local qualification; registry examples
refer to the release once available. No hosted npm provenance is claimed.

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
