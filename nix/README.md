# Theme Forge Stellar Loom — First-Party Nix Distribution

This template targets first-party Nix distribution for Theme Forge Stellar Loom.

The private repository maintains this template under `nix/stellar-loom/flake.nix` and
`nix/stellar-loom/flake.lock`, with the derivation recipe in `nix/packages/stellar-loom.nix`.
Public composition maps the template files to the public repository root (`flake.nix` and `flake.lock`)
and maps the recipe to `nix/package.nix`.

## Declared package systems

- `aarch64-darwin`
- `aarch64-linux`
- `x86_64-linux`

## Flake Usage

```sh
# Build default package
nix build .#default

# Run CLI applications
nix run .#tfsl -- --help
nix run .#tfsl-batch -- # Supply one JSON request through stdin EOF

# Run checks
nix flake check
```

## Architecture & Catalog Integrity Decisions

1. **Pure Source Derivation**:
   TypeScript is compiled from clean source in an isolated build environment using `pkgs.buildNpmPackage` with Node 22.
   All build dependencies are locked via `npmDepsHash = "sha256-DLKVAiTQf9h3kUT4wAIVHML759NmPQ2isRUXTM+CRjw="`.

2. **Catalog Build Evidence Integrity**:
   During build, `tools/build-catalog-evidence.mjs` executes to bind compiled JavaScript outputs,
   entry scripts (`bin/tfsl.js`, `bin/tfsl-batch.js`), and source inputs into `dist/catalog-build-evidence.json`.
   Automatic shebang patching is disabled (`dontPatchShebangs = true`), and the regular entry files
   at the installed package root (`$out/lib/node_modules/@knowledge-forge-ai/theme-forge-stellar-loom/bin/tfsl.js`
   and `bin/tfsl-batch.js`) retain their exact content and cryptographic hashes.

3. **CWD-Independent Store Wrappers**:
   Wrappers are created under `$out/bin/tfsl` and `$out/bin/tfsl-batch` using `makeWrapper`.
   They invoke Nix store Node 22 with `--unset NODE_PATH --unset NODE_OPTIONS` pointing to the
   installed entry scripts without modifying package catalog members.

4. **Checks**:
   `checks.${system}.theme-forge-stellar-loom` requires the composed
   `tools/qualify-installed.mjs` and exercises the exact installed wrappers and
   package resources. Missing probes fail; help-only execution cannot qualify an
   installation. Run runtime checks on a qualified native executor. See
   [the distribution guide](../DISTRIBUTION.md) for release and platform limits.
