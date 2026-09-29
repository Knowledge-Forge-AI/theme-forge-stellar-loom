# Loom and Solar source distribution

This is the next-release source/package contract. It does not change historical
release claims or assign a release version. Each product ships one portable npm
payload for Node 22 or later. Required systems are `aarch64-darwin`,
`aarch64-linux` and `x86_64-linux`; Intel macOS npm use is not removed.

## Build the public source

Use the product's public source archive, which includes its lock, TypeScript
sources, legal files, examples, qualification tools and standalone flake. Extract
into an empty directory. No Git metadata, monorepo sibling, global npm package,
publication token or signing credential is required.

Acquire locked development dependencies with `npm ci --ignore-scripts`. Build
and test in a disposable executor, separately from dependency acquisition:

```sh
npm run typecheck
# Solar Sail
npm run build
# Stellar Loom: this compiles TypeScript AND binds the catalog inventory
node tools/build-catalog-evidence.mjs
npm test
npm pack --ignore-scripts --json --pack-destination /absolute/artifact-directory
```

Choose the build command for the product. Plain Loom `npm run build` alone does
not prepare a distributable catalog. Preserve `dist/catalog-build-evidence.json`
and the regular `bin/tfsl.js` and `bin/tfsl-batch.js` members byte-for-byte.
The public composition intentionally excludes private Design Director modules.
Do not package a private monorepo build as the public artifact.

Install the exact tarball into a clean prefix with `npm install --ignore-scripts
--no-audit --no-fund --prefix <prefix> <tarball>`. Run the public
`tools/qualify-installed.mjs` with explicit absolute `--package-root`, `--node`
and fresh `--work-dir` arguments. The root is the installed scoped package,
not its source tree. Run outside the source with empty user state and no network.
Loom checks real batch framing, installed protocol and catalog workflows. Solar
checks its CLI and installed main export, including library-only paired v2.

## First-party Nix

The flake in each public source archive imports only that archive's inputs. It
compiles TypeScript with the npm lock and uses store-resolved Node. It exposes
packages and installed-output checks on all three required systems. From the
extracted source use `nix build .` and, on a qualified native executor,
`nix flake check`. Build completion and installed runtime qualification are
separate evidence. Never weaken daemon security settings to obtain a pass.

After a qualifying release publishes these files, replace `vX.Y.Z` below with
its immutable release tag:

```sh
nix profile install github:Knowledge-Forge-AI/theme-forge-stellar-loom/vX.Y.Z#theme-forge-stellar-loom
nix run github:Knowledge-Forge-AI/theme-forge-stellar-loom/vX.Y.Z#tfsl -- --help
nix run github:Knowledge-Forge-AI/theme-forge-stellar-loom/vX.Y.Z#tfsl-batch --
nix profile install github:Knowledge-Forge-AI/theme-forge-solar-sail/vX.Y.Z#theme-forge-solar-sail
nix run github:Knowledge-Forge-AI/theme-forge-solar-sail/vX.Y.Z#tfss -- --help
```

`tfsl-batch` reads one framed JSON request through EOF; it is not an interactive
persistent server. The templates in the private development tree are composition
inputs; evaluate the composed public tree, not an uncomposed template directory.

## Homebrew

```sh
brew install Knowledge-Forge-AI/tap/theme-forge-stellar-loom
brew install Knowledge-Forge-AI/tap/theme-forge-solar-sail
```

Formula candidates consume the ordinary npm tarball with Homebrew-provided Node.
Third-party taps contain executable Ruby and are a separate trust decision from
Homebrew/core review. Inspect the tap and pinned artifact hash before trusting it;
follow the trust interaction supported by the installed Homebrew version. No
host-wide trust, quarantine or security bypass is required by these CLI packages.
Linux ARM64/AMD64 installation and Node availability require executor evidence.

Existing Formula URLs and hashes continue to describe published versions. A local
candidate substitution is test-only and must record its own hash. Current package
versions are not newly assigned releases: same-version candidate tarballs may
differ from registry bytes and must not overwrite those references.

## Release layout and authentication

`release-layout.json` defines the next release's source archive/reference, single
npm payload, checksums, maintained Syft/SPDX/CycloneDX and provenance receipts.
The existing public CI generates package and supply-chain evidence. Preserve
those artifacts when assembling a release and bind them to the exact source,
packed bytes and platform/channel matrix. The layout authorizes no publication.
Version assignment and release signing/provenance remain separately authorized.

A computed checksum establishes consistency only. Authentication additionally
requires an approved immutable release/tag and trusted provenance identity. Reject
mismatched package name, version, archive hash or compiler-resource inventory.
Do not download a compiler at first launch or resolve an ambient global CLI.
