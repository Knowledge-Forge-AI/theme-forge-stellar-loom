# TFSL Theme Evidence Protocol v2

This directory contains the protocol specification, schema definitions, and canonical examples for Theme Forge Stellar Loom Design Exchange Candidate Packets (v2).

## Protocol Overview

The v2 design exchange protocol formalizes candidate exchange packets for themes targeting Starlight v0.42. It binds:
1. **Shared Compiler Semantic:** `tfsl.theme-compiler-v2-core-1`
2. **Shared Catalog:** `tfsl.starlight-core-catalog-v1` with pinned digest `c94809b7ef40ba0302a2935245507a4fa22022cd8dfcc1fd3ba65c80edcd88c8`
3. **Producer Identity:** Separate package version provenance from executable behavior digest binding module behavior
4. **Exact Output Inventory:** Ordered list of all 5 emitted CSS stylesheets with individual sha256 digests
5. **State:** Closed `candidate` state only (review and adoption are decoupled and never carried in candidate packets)

## Schemas

- [`candidate.schema.json`](./candidate.schema.json): Closed JSON Schema draft 2020-12 definition for `tfsl.theme-candidate` v2 packets.

## Examples

- [`examples/candidate-a.tfsl-candidate-v2.json`](./examples/candidate-a.tfsl-candidate-v2.json): Authentic canonical candidate packet derived from `loom-black-core`.
- [`examples/candidate-b.tfsl-candidate-v2.json`](./examples/candidate-b.tfsl-candidate-v2.json): Authentic canonical candidate packet derived from `loom-flexoki-core`.

The producer `packageDigest` binds package.json and the sorted dist/bin executable
member inventory. It is not an npm tarball digest; packaging receipts bind the
archive separately. `executableDigest` binds the observed compiler module and
semantic/catalog identities. Producer claims have no signature/authentication
status; verification independently recompiles and compares output.

Inventory order is layers, tokens, base, accent, overrides and cannot be sorted
lexicographically. The packet self-digest covers this order, selected accent, input,
output, resource declarations and producer provenance. `candidateDigest` excludes
only itself. Visual evidence remains optional and does not imply adoption.

The JSON Schema checks structure. Runtime validation additionally checks complete
alias resolution, prototype-safe data, ordered font weight ranges and referenced
IDs. Core supports only candidate evidence; automatic adoption is unavailable.
Explicit import validates a historical v1 candidate, maps its finite palette and
layout roles, links original packet and serialized-byte digests, and compiles a
fresh v2 candidate. No old review/adoption state is inherited.

CLI: `tfsl exchange v2-create theme.json --out candidate.json`,
`tfsl exchange v2-verify candidate.json`, and
`tfsl exchange v1-import historical.json --out rebound.json`.
