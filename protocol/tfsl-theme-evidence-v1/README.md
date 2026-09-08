# TFSL theme evidence protocol v1

This folder defines the portable, file-based human-agent design exchange used
by Theme Forge Stellar Loom (TFSL) and Nebular Fusion Theme Lab. It is not an
arbitrary execution protocol and grants no package installation, process,
network, provider, model, authorship, or licensing authority.

The three closed packet schemas are `tfsl.theme-brief`, `tfsl.theme-candidate`,
and `tfsl.theme-review`, each at `schemaVersion: 1`. Supporting visual evidence
uses `tfsl.theme-visual-evidence` at `schemaVersion: 1`. Packet files use
`.tfsl-brief.json`, `.tfsl-candidate.json`, or `.tfsl-review.json`. Imported
bytes must be strict UTF-8 without BOM or duplicate keys and must already equal
canonical UTF-8-key-sorted two-space JSON with one final LF.

All strings are strict UTF-8 and NFC. Single-line text rejects NUL, CR, LF,
other C0 controls, and DEL. Designated multiline text permits LF only. General
IDs are 1..128 UTF-8 bytes and match `^[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*$`.

Exact array and text limits are: 16,777,216 encoded bytes per packet;
8,388,608 aggregate decoded visual bytes; 6,291,456 bytes per PNG; 0..8 visual
records per packet; 1..8 candidates per review; 0..128 annotations. Other plain
text is field-bounded and never exceeds 4,096 UTF-8 bytes; annotation comments
never exceed 2,048 bytes. Visual dimensions must be within 16..1024 pixels.

The self-digests exclude only their own digest field and hash the canonical
packet projection after these exact domain bases:

```text
tfsl.theme-brief-v1\n
tfsl.theme-candidate-v1\n
tfsl.theme-review-v1\n
tfsl.theme-visual-evidence-v1\n
```

Digests prove internal integrity only. Author and claim fields are self-asserted
provenance; they do not authenticate a sender, determine copyright ownership,
or establish a license conclusion.

`inventory.json`, JSON Schemas, canonical examples, and shared negative cases
are maintained package assets included in the packed distribution.

`createThemeReview` constructs a schema-valid, integrity-bound packet. Its
`brief` input accepts either a brief packet or a digest string; creation alone
does not establish that the referenced brief or candidates exist. Before
hydration or use, call `validateThemeReviewLinks` with the actual brief and
candidate packets (or the owning batch review-validation operation). That
separate check establishes context and visual-evidence links. Passing a brief
packet to the creator does not replace this complete link validation.
