# Catalog successor contract

Status: private 0.1.1 stepping implementation for the Loom 0.2 structural gate.
Qualification status is recorded in the integration evaluation. This is not a release declaration.

A `tfsl.theme-v2` document with an own `catalog` field uses
`tfsl.theme-compiler-v2-catalog-1` and `tfsl.starlight-component-catalog-v1`.
Malformed catalog input never falls back to a historical compiler. Historical core,
code and v1 documents retain their original explicit APIs and packet verification.
Package version is provenance, not semantic compatibility.

The catalog schema permits fixed Hero layouts, plain/card/compact pagination,
title/URL copy, nested/tabs/select/active-only sidebars, standard/compact layout
styling and complete selected font licenses. It accepts at most 32 Hero routes,
8 actions per Hero and 16 stable top-level sidebar group IDs. Public navigation
projection is limited to 512 nodes and depth 8. Text is escaped. Local hrefs are
root-relative or fragments; external hrefs, traversal and encoded bypasses fail.
Media is the original fixed `loom-orbit` asset. No template source, import,
callback, CSS selector, provider command or file-discovery input is accepted.

Hero route selection uses the documented Starlight route ID. Consumer frontmatter
Hero and consumer component overrides take precedence. Rendered catalog actions
honor Astro's configured base. Sidebar groups bind ordinally to explicit IDs;
ambiguous active groups and cardinality mismatches fail. Native disclosures retain
current-route expansion. Manual expansion persistence is not implemented. Link
attributes are restricted to title and aria-label; other consumer attributes and
badges are outside the generated sidebar envelope. Default mobile footer and
ThemeProvider remain public Starlight components. No private navigation modules
or internal persistence helpers are imported.

Compatibility CSS is fixed, unlayered and catalog-only. Consumer customCss follows
it; matching specificity (`:root:not([data-has-sidebar])` for width and
`:root[data-theme]` inside print) is required for ordinary consumer overrides.
Print maps the selected light palette, including content/code roles. Historical
styles and packages are not regenerated under this contract.

The `tfsl.theme-catalog-candidate` version 1 packet is candidate-only. Its closed
validator binds the exact tuple, canonical theme, metadata, selected accent,
input/output digests, complete generated file inventory, code input/tuple, selected
font and complete license digests, executable identity and optional visual/tarball
provenance. Verification reproduces inventory and local executable identity. It
never adopts a candidate. `createThemeCatalogCandidate`,
`parseThemeCatalogCandidate`, `serializeThemeCatalogCandidate` and
`verifyThemeCatalogCandidate` are explicit library APIs. The CLI provides
`exchange catalog-create` and `exchange catalog-verify`; historical exchange
commands remain historical. Batch compile/validate dispatch catalog documents;
catalog exchange uses the explicit library/CLI APIs, not historical batch exchange.

## Executable evidence

TFSB62B corrects the catalog guard without changing catalog-1 generated outputs,
schemas or the historical catalog digest. The independent runtime boundary is
`tfsl.catalog-runtime-projection-v1`: UTF-8 byte-sorted object keys, authored array
order, two-space JSON followed by LF, prefixed by that domain and LF. It excludes
`sourceQualification` and the expected-digest literal itself. The computed projection
must match the literal `f95a9b9901bb1b53a0f7847523124212e711f0794809f9ae9fc6a17d5cbd3ccd`
before compilation/generation. The full historical projection must also match its
unchanged literal digest. Neither literal is refreshed by a build.

The historical `sourceQualification` field retains the catalog-1 source evidence;
it does not authenticate current repository or installed source bytes.
`catalog-source-qualification.json` independently pins current repository sources,
including the literal carrier, and is checked by repository qualification tests.
It is outside the runtime projection, avoiding self-reference. Runtime projection
integrity, repository source qualification and executable equality are distinct.
The guard correction changes executable bytes. Historical catalog packets remain
parseable and unchanged, but verification against this corrected executable fails
with `EXECUTABLE_IDENTITY_MISMATCH`; use their original executable to verify them.
No old packet is rebound or accepted merely because its output still matches.

Run `node tools/build-catalog-evidence.mjs` before source qualification or packing
catalog exchange support. It builds the package and writes the closed, byte-ordered
`dist/catalog-build-evidence.json`. Creation and verification must execute built
JS; direct source execution is rejected. Missing, malformed, changed or additional
executable members fail closed. Source trees additionally check exact source
freshness; installed and source identities hash the same built members and manifest.
Version-only package edits do not change executable compatibility, but export/bin
routing does. Full package metadata and supplied tarball digests remain separate.
This is local executable equality, not signed producer authentication.

Working code tabs and provider execution are not supported. Historical code
`tabs: "deferred"` remains required. Fonts are confined, digest-verified WOFF/WOFF2
from an explicitly supplied inventory; complete license text is emitted in the
catalog package. The Source Code Pro fixture documents its independently verified
Rust upstream member and OFL notice.

Public references: [route data](https://starlight.astro.build/reference/route-data/),
[plugins](https://starlight.astro.build/reference/plugins/),
[component overrides](https://starlight.astro.build/reference/overrides/).
