import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const PROTOCOL_DIR = resolve(ROOT, "protocol/tfsl-theme-evidence-v1");
const EXAMPLES_DIR = resolve(PROTOCOL_DIR, "examples");

mkdirSync(EXAMPLES_DIR, { recursive: true });

// Import built TFSL
const {
  STELLAR_CYAN_EXAMPLE,
  createThemeBrief,
  createThemeCandidate,
  createThemeReview,
  serializeThemeExchangePacket,
  computeVisualEvidenceDigest,
  canonicalJson,
  COMPILER_VERSION,
} = await import("../dist/index.js");

// Generate a valid 64x64 RGBA PNG buffer
function createPng(width = 64, height = 64) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const payload = Buffer.concat([typeBuf, data]);
    // CRC32
    let crc = 0xffffffff;
    for (let i = 0; i < payload.length; i++) {
      let byte = payload[i];
      for (let j = 0; j < 8; j++) {
        const bit = (crc ^ byte) & 1;
        crc >>>= 1;
        if (bit) crc ^= 0xedb88320;
        byte >>>= 1;
      }
    }
    crc ^= 0xffffffff;
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([len, payload, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Raw scanlines: each scanline has 1 filter byte (0) + 4 bytes per pixel
  const scanlineLen = 1 + width * 4;
  const scanlines = Buffer.alloc(scanlineLen * height, 0);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * scanlineLen;
    scanlines[rowOffset] = 0; // filter None
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      scanlines[pxOffset] = 0;       // R
      scanlines[pxOffset + 1] = 210; // G
      scanlines[pxOffset + 2] = 255; // B
      scanlines[pxOffset + 3] = 255; // A
    }
  }

  const idatData = deflateSync(scanlines);
  const ihdrChunk = makeChunk("IHDR", ihdr);
  const idatChunk = makeChunk("IDAT", idatData);
  const iendChunk = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const samplePng = createPng(64, 64);
const samplePngBase64 = samplePng.toString("base64");
const { validatePngBase64 } = await import("../dist/index.js");
const pngMeta = validatePngBase64(samplePngBase64);

// Create visual record
const visualRecordDraft = {
  schema: "tfsl.theme-visual-evidence",
  schemaVersion: 1,
  presence: "included",
  pngDigest: pngMeta.pngDigest,
  bytesBase64: samplePngBase64,
  byteCount: pngMeta.byteCount,
  width: pngMeta.width,
  height: pngMeta.height,
  mode: "dark",
  viewport: "desktop",
  themeDigest: "sha256:63f7362edb34268d6406af95e7eccbc3ed85e6da628e14a99ddcc96895008ea9",
  fixtureId: "starlight-kitchen-sink",
};
visualRecordDraft.evidenceDigest = computeVisualEvidenceDigest(visualRecordDraft);

// 1. Create Brief
const brief = createThemeBrief({
  briefId: "starlight-cyan-modernization",
  title: "Starlight Stellar Cyan modernization brief",
  goal: "Modernize Starlight theme accent contrast and typography for dark and light modes",
  baselineTheme: STELLAR_CYAN_EXAMPLE,
  allowedFields: [
    "colors.dark.accent.base",
    "colors.dark.accent.high",
    "colors.dark.accent.low",
    "colors.light.accent.base",
    "colors.light.accent.high",
    "colors.light.accent.low",
    "typography.lineHeight",
  ],
  allowedModes: ["dark", "light"],
  approvedTemplates: ["page-title-frame"],
  acceptanceCriteria: [
    "Maintain WCAG 2.2 AA contrast on accent text",
    "Body line height at least 1.6",
  ],
  prohibitedChanges: [
    "Do not alter contentWidth or sidebarWidth geometry",
    "Do not alter neutrals background tokens",
  ],
  visualEvidence: [visualRecordDraft],
  metadata: {
    author: "Theme Lab Operator",
    timestamp: "2026-09-07T00:00:00Z",
  },
});

const briefJson = serializeThemeExchangePacket(brief);
writeFileSync(resolve(EXAMPLES_DIR, "brief.tfsl-brief.json"), briefJson, "utf8");
console.log("Written brief.tfsl-brief.json, digest:", brief.briefDigest);

// 2. Candidate A
const candidateATheme = JSON.parse(JSON.stringify(STELLAR_CYAN_EXAMPLE));
candidateATheme.colors.dark.accent.base = "#00d2ff";
candidateATheme.colors.dark.accent.low = "#002b36";
candidateATheme.colors.dark.accent.high = "#99edff";
candidateATheme.colors.light.accent.base = "#007a99";
candidateATheme.colors.light.accent.low = "#e6f9fc";
candidateATheme.colors.light.accent.high = "#004052";
candidateATheme.typography.lineHeight = 1.75;

const candidateA = createThemeCandidate({
  candidateId: "cyan-accessible-high-contrast",
  brief,
  theme: candidateATheme,
  rationale: "Improves WCAG 2.2 AA contrast on accent-low and accent-high pairs, widens body text line-height",
  packageMetadata: {
    name: "@knowledge-forge-ai/starlight-theme-cyan-accessible",
    version: "0.1.0",
    description: "Accessible high-contrast variant of Starlight Stellar Cyan",
    author: "Starlight Theme Designer",
    license: "AGPL-3.0-or-later",
    template: "page-title-frame",
  },
  claimedProvenance: {
    author: "Agent-Designer-V1",
    toolName: "tfsl",
    toolVersion: COMPILER_VERSION,
    timestamp: "2026-09-07T01:00:00Z",
  },
  visualEvidence: [visualRecordDraft],
});

const candidateAJson = serializeThemeExchangePacket(candidateA);
writeFileSync(resolve(EXAMPLES_DIR, "candidate-a.tfsl-candidate.json"), candidateAJson, "utf8");
console.log("Written candidate-a.tfsl-candidate.json, digest:", candidateA.candidateDigest);

// 3. Candidate B
const candidateBTheme = JSON.parse(JSON.stringify(STELLAR_CYAN_EXAMPLE));
candidateBTheme.colors.dark.accent.base = "#00e5ff";
candidateBTheme.colors.dark.accent.low = "#003344";
candidateBTheme.colors.dark.accent.high = "#a6f4ff";
candidateBTheme.colors.light.accent.base = "#0088aa";
candidateBTheme.colors.light.accent.low = "#e0faff";
candidateBTheme.colors.light.accent.high = "#004d61";
candidateBTheme.typography.lineHeight = 1.65;

const candidateB = createThemeCandidate({
  candidateId: "cyan-vibrant-neon",
  brief,
  theme: candidateBTheme,
  rationale: "Provides an energetic neon cyber tone with compliant contrast ratios",
  packageMetadata: {
    name: "@knowledge-forge-ai/starlight-theme-cyan-neon",
    version: "0.1.0",
    description: "Vibrant neon variant of Starlight Stellar Cyan",
    author: "Starlight Theme Designer",
    license: "AGPL-3.0-or-later",
    template: "page-title-frame",
  },
  claimedProvenance: {
    author: "Agent-Designer-V2",
    toolName: "tfsl",
    toolVersion: COMPILER_VERSION,
    timestamp: "2026-09-07T01:30:00Z",
  },
  visualEvidence: [],
});

const candidateBJson = serializeThemeExchangePacket(candidateB);
writeFileSync(resolve(EXAMPLES_DIR, "candidate-b.tfsl-candidate.json"), candidateBJson, "utf8");
console.log("Written candidate-b.tfsl-candidate.json, digest:", candidateB.candidateDigest);

// 4. Review
const review = createThemeReview({
  reviewId: "cyan-modernization-review",
  brief,
  candidateDigests: [candidateA.candidateDigest, candidateB.candidateDigest],
  dispositions: [
    {
      candidateDigest: candidateA.candidateDigest,
      disposition: "preferred",
      comment: "Excellent contrast across both dark and light modes",
    },
    {
      candidateDigest: candidateB.candidateDigest,
      disposition: "deferred",
      comment: "Vibrant look, reserved for alternative dark-only skin",
    },
  ],
  annotations: [
    {
      annotationId: "ann-accent-dark",
      candidateDigest: candidateA.candidateDigest,
      target: {
        kind: "field",
        fieldPath: "colors.dark.accent.base",
        mode: "dark",
      },
      category: "contrast",
      severity: "note",
      comment: "Crisp primary cyan accent meets WCAG 2.2 AA on dark neutral background",
    },
    {
      annotationId: "ann-visual-preview",
      candidateDigest: candidateA.candidateDigest,
      target: {
        kind: "visual",
        evidenceDigest: visualRecordDraft.evidenceDigest,
        pngDigest: visualRecordDraft.pngDigest,
        region: [100000, 100000, 500000, 500000],
      },
      category: "layout",
      severity: "note",
      comment: "Header nav and brand badge align cleanly with high-contrast accent",
    },
  ],
  overallDisposition: {
    kind: "preferred",
    candidateDigest: candidateA.candidateDigest,
  },
  summary: "Candidate A is preferred due to superior contrast and typography readability.",
});

const reviewJson = serializeThemeExchangePacket(review);
writeFileSync(resolve(EXAMPLES_DIR, "review.tfsl-review.json"), reviewJson, "utf8");
console.log("Written review.tfsl-review.json, digest:", review.reviewDigest);

// 5. Inventory
const inventory = {
  schema: "tfsl.theme-evidence-inventory",
  schemaVersion: 1,
  protocolVersion: "1.0",
  schemas: [
    {
      schema: "tfsl.theme-brief",
      schemaVersion: 1,
      file: "brief.schema.json",
      extension: ".tfsl-brief.json",
      digestDomain: "tfsl.theme-brief-v1\n",
    },
    {
      schema: "tfsl.theme-candidate",
      schemaVersion: 1,
      file: "candidate.schema.json",
      extension: ".tfsl-candidate.json",
      digestDomain: "tfsl.theme-candidate-v1\n",
    },
    {
      schema: "tfsl.theme-review",
      schemaVersion: 1,
      file: "review.schema.json",
      extension: ".tfsl-review.json",
      digestDomain: "tfsl.theme-review-v1\n",
    },
    {
      schema: "tfsl.theme-visual-evidence",
      schemaVersion: 1,
      file: "visual-evidence.schema.json",
      extension: ".json",
      digestDomain: "tfsl.theme-visual-evidence-v1\n",
    },
  ],
  examples: [
    {
      kind: "brief",
      file: "examples/brief.tfsl-brief.json",
      id: brief.briefId,
      digest: brief.briefDigest,
    },
    {
      kind: "candidate",
      file: "examples/candidate-a.tfsl-candidate.json",
      id: candidateA.candidateId,
      digest: candidateA.candidateDigest,
    },
    {
      kind: "candidate",
      file: "examples/candidate-b.tfsl-candidate.json",
      id: candidateB.candidateId,
      digest: candidateB.candidateDigest,
    },
    {
      kind: "review",
      file: "examples/review.tfsl-review.json",
      id: review.reviewId,
      digest: review.reviewDigest,
    },
  ],
};
writeFileSync(resolve(PROTOCOL_DIR, "inventory.json"), canonicalJson(inventory), "utf8");
console.log("Written inventory.json");

// Generate negative corpus
const negativeCases = [
  {
    id: "brief-tampered-digest",
    category: "digest",
    description: "Brief with altered self-digest must be rejected",
    packet: {
      ...JSON.parse(briefJson),
      briefDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
  },
  {
    id: "brief-non-nfc",
    category: "text",
    description: "Brief with NFD unnormalized string must be rejected",
    packet: {
      ...JSON.parse(briefJson),
      title: "Cafe\u0301 modernization", // e + combining acute
    },
  },
  {
    id: "brief-prohibited-controls",
    category: "text",
    description: "Brief with CR or null byte in title must be rejected",
    packet: {
      ...JSON.parse(briefJson),
      title: "Modernization\rBrief",
    },
  },
  {
    id: "brief-unknown-key",
    category: "schema",
    description: "Brief with unexpected top-level property must be rejected",
    packet: {
      ...JSON.parse(briefJson),
      extraKeyNotAllowed: "injected",
    },
  },
  {
    id: "brief-invalid-schema-name",
    category: "schema",
    description: "Brief with wrong schema must be rejected",
    packet: {
      ...JSON.parse(briefJson),
      schema: "tfsb.design-brief",
    },
  },
  {
    id: "brief-invalid-schema-version",
    category: "schema",
    description: "Brief with unsupported schemaVersion must be rejected",
    packet: {
      ...JSON.parse(briefJson),
      schemaVersion: 2,
    },
  },
  {
    id: "brief-invalid-leaf-field",
    category: "leaf-field",
    description: "Brief with non-existent leaf field in allowedFields must be rejected",
    packet: {
      ...JSON.parse(briefJson),
      allowedFields: ["colors.invalid.palette.token"],
    },
  },
  {
    id: "brief-unsorted-allowed-fields",
    category: "ordering",
    description: "Brief with unsorted allowedFields must be rejected",
    packet: {
      ...JSON.parse(briefJson),
      allowedFields: ["typography.lineHeight", "colors.dark.accent.base"],
    },
  },
  {
    id: "candidate-tampered-digest",
    category: "digest",
    description: "Candidate with altered candidateDigest must be rejected",
    packet: {
      ...JSON.parse(candidateAJson),
      candidateDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
  },
  {
    id: "candidate-theme-digest-mismatch",
    category: "digest",
    description: "Candidate with corrupted themeDigest must be rejected",
    packet: {
      ...JSON.parse(candidateAJson),
      themeDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
  },
  {
    id: "candidate-unknown-key",
    category: "schema",
    description: "Candidate with unexpected top-level property must be rejected",
    packet: {
      ...JSON.parse(candidateAJson),
      unauthorizedScript: "alert(1)",
    },
  },
  {
    id: "candidate-unapproved-template",
    category: "generator",
    description: "Candidate with unapproved template must be rejected",
    packet: {
      ...JSON.parse(candidateAJson),
      packageMetadata: {
        ...candidateA.packageMetadata,
        template: "arbitrary-template-v9",
      },
    },
  },
  {
    id: "review-tampered-digest",
    category: "digest",
    description: "Review with altered reviewDigest must be rejected",
    packet: {
      ...JSON.parse(reviewJson),
      reviewDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    },
  },
  {
    id: "review-unknown-candidate-ref",
    category: "reference",
    description: "Review with unknown candidateDigest reference must be rejected",
    packet: {
      ...JSON.parse(reviewJson),
      candidateDigests: ["sha256:0000000000000000000000000000000000000000000000000000000000000000"],
    },
  },
  {
    id: "review-two-preferred-candidates",
    category: "constraint",
    description: "Review marking more than one candidate preferred must be rejected",
    packet: {
      ...JSON.parse(reviewJson),
      dispositions: [
        { candidateDigest: candidateA.candidateDigest, disposition: "preferred" },
        { candidateDigest: candidateB.candidateDigest, disposition: "preferred" },
      ],
    },
  },
  {
    id: "review-overall-disposition-mismatch",
    category: "constraint",
    description: "Review with overall preferred but candidate disposition deferred must be rejected",
    packet: {
      ...JSON.parse(reviewJson),
      dispositions: [
        { candidateDigest: candidateA.candidateDigest, disposition: "deferred" },
        { candidateDigest: candidateB.candidateDigest, disposition: "deferred" },
      ],
      overallDisposition: {
        kind: "preferred",
        candidateDigest: candidateA.candidateDigest,
      },
    },
  },
  {
    id: "review-annotation-missing-candidate",
    category: "reference",
    description: "Review annotation referencing candidate not in candidateDigests must be rejected",
    packet: {
      ...JSON.parse(reviewJson),
      annotations: [
        {
          annotationId: "ann-ghost",
          candidateDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          target: { kind: "field", fieldPath: "colors.dark.accent.base" },
          category: "color",
          severity: "note",
          comment: "Comment on missing candidate",
        },
      ],
    },
  },
  {
    id: "review-annotation-invalid-field",
    category: "reference",
    description: "Review annotation referencing non-existent field must be rejected",
    packet: {
      ...JSON.parse(reviewJson),
      annotations: [
        {
          annotationId: "ann-bad-field",
          candidateDigest: candidateA.candidateDigest,
          target: { kind: "field", fieldPath: "invalid.theme.field" },
          category: "color",
          severity: "note",
          comment: "Comment on non-existent field",
        },
      ],
    },
  },
];

const negativeCorpus = {
  schema: "tfsl.theme-evidence-negative-corpus",
  schemaVersion: 1,
  cases: negativeCases,
};

writeFileSync(resolve(PROTOCOL_DIR, "negative-corpus.json"), canonicalJson(negativeCorpus), "utf8");
console.log("Written negative-corpus.json with", negativeCases.length, "cases");
