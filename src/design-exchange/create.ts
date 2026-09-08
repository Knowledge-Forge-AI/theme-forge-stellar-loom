import { validateThemeSpecification } from "../schema/validator.js";
import { canonicalizeSpecification } from "../compiler/index.js";
import { COMPILER_VERSION } from "../compiler/descriptor.js";
import {
  SCHEMA_THEME_BRIEF,
  SCHEMA_THEME_CANDIDATE,
  SCHEMA_THEME_REVIEW,
  THEME_EXCHANGE_SCHEMA_VERSION,
} from "./constants.js";
import {
  type ThemeBriefPacket,
  type ThemeCandidatePacket,
  type ThemeReviewPacket,
  type ThemeBriefCreateInput,
  type ThemeCandidateCreateInput,
  type ThemeReviewCreateInput,
  ThemeExchangeValidationError,
} from "./types.js";
import { computePacketDigest } from "./canonical.js";
import {
  validateThemeBrief,
  validateThemeCandidate,
  validateThemeReview,
  compareUtf8,
} from "./validator.js";
import { checkConstraints } from "./leaf-fields.js";

export function createThemeBrief(input: ThemeBriefCreateInput): ThemeBriefPacket {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ThemeExchangeValidationError("Expected plain object for briefInput", "INVALID_REQUEST", "briefInput");
  }
  if (!input.briefId || typeof input.briefId !== "string") {
    throw new ThemeExchangeValidationError("Missing required field 'briefId'", "MISSING_REQUIRED_FIELD", "briefId");
  }
  if (!input.title || typeof input.title !== "string") {
    throw new ThemeExchangeValidationError("Missing required field 'title'", "MISSING_REQUIRED_FIELD", "title");
  }
  if (!input.goal || typeof input.goal !== "string") {
    throw new ThemeExchangeValidationError("Missing required field 'goal'", "MISSING_REQUIRED_FIELD", "goal");
  }
  if (!input.baselineTheme || typeof input.baselineTheme !== "object" || Array.isArray(input.baselineTheme)) {
    throw new ThemeExchangeValidationError("Missing required field 'baselineTheme'", "MISSING_REQUIRED_FIELD", "baselineTheme");
  }

  if (input.allowedFields !== undefined && !Array.isArray(input.allowedFields)) {
    throw new ThemeExchangeValidationError("'allowedFields' must be an array", "SCHEMA_ERROR", "allowedFields");
  }
  if (input.allowedModes !== undefined && !Array.isArray(input.allowedModes)) {
    throw new ThemeExchangeValidationError("'allowedModes' must be an array", "SCHEMA_ERROR", "allowedModes");
  }
  if (input.approvedTemplates !== undefined && !Array.isArray(input.approvedTemplates)) {
    throw new ThemeExchangeValidationError("'approvedTemplates' must be an array", "SCHEMA_ERROR", "approvedTemplates");
  }
  if (input.acceptanceCriteria !== undefined && !Array.isArray(input.acceptanceCriteria)) {
    throw new ThemeExchangeValidationError("'acceptanceCriteria' must be an array", "SCHEMA_ERROR", "acceptanceCriteria");
  }
  if (input.prohibitedChanges !== undefined && !Array.isArray(input.prohibitedChanges)) {
    throw new ThemeExchangeValidationError("'prohibitedChanges' must be an array", "SCHEMA_ERROR", "prohibitedChanges");
  }
  if (input.visualEvidence !== undefined && !Array.isArray(input.visualEvidence)) {
    throw new ThemeExchangeValidationError("'visualEvidence' must be an array", "SCHEMA_ERROR", "visualEvidence");
  }
  if (input.metadata !== undefined && (typeof input.metadata !== "object" || input.metadata === null || Array.isArray(input.metadata))) {
    throw new ThemeExchangeValidationError("'metadata' must be an object", "SCHEMA_ERROR", "metadata");
  }

  const baseline = validateThemeSpecification(input.baselineTheme);
  const canonical = canonicalizeSpecification(baseline);
  const themeDigest = `sha256:${canonical.inputDigest}`;

  const allowedFields = input.allowedFields ? [...input.allowedFields].sort(compareUtf8) : [];
  const allowedModes = input.allowedModes ? [...input.allowedModes].sort(compareUtf8) : ["dark", "light"];
  const approvedTemplates = input.approvedTemplates ? [...input.approvedTemplates].sort(compareUtf8) : [];
  const acceptanceCriteria = input.acceptanceCriteria ? [...input.acceptanceCriteria] : [];
  const prohibitedChanges = input.prohibitedChanges ? [...input.prohibitedChanges] : [];
  const visualEvidence = input.visualEvidence ? [...input.visualEvidence] : [];

  const draft: any = {
    schema: SCHEMA_THEME_BRIEF,
    schemaVersion: THEME_EXCHANGE_SCHEMA_VERSION,
    briefId: input.briefId,
    title: input.title,
    goal: input.goal,
    baselineTheme: baseline,
    themeDigest,
    compilerVersion: COMPILER_VERSION,
    adapter: input.adapter ?? "starlight-v0.42",
    allowedFields,
    allowedModes,
    approvedTemplates,
    acceptanceCriteria,
    prohibitedChanges,
    visualEvidence,
  };

  if (input.metadata) {
    draft.metadata = { ...input.metadata };
  }

  const briefDigest = computePacketDigest(draft);
  draft.briefDigest = briefDigest;

  return validateThemeBrief(draft);
}

export function createThemeCandidate(input: ThemeCandidateCreateInput): ThemeCandidatePacket {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ThemeExchangeValidationError("Expected plain object for candidateInput", "INVALID_REQUEST", "candidateInput");
  }
  if (!input.candidateId || typeof input.candidateId !== "string") {
    throw new ThemeExchangeValidationError("Missing required field 'candidateId'", "MISSING_REQUIRED_FIELD", "candidateId");
  }

  if (!input.brief) {
    throw new ThemeExchangeValidationError("Missing required field 'brief'", "MISSING_REQUIRED_FIELD", "brief");
  }

  let briefDigest: string | undefined;
  if (typeof input.brief === "string") {
    briefDigest = input.brief;
  } else if (typeof input.brief === "object" && typeof (input.brief as any).briefDigest === "string") {
    briefDigest = (input.brief as any).briefDigest;
  }

  if (!briefDigest) {
    throw new ThemeExchangeValidationError("Missing required field 'brief'", "MISSING_REQUIRED_FIELD", "brief");
  }

  if (!input.theme || typeof input.theme !== "object" || Array.isArray(input.theme)) {
    throw new ThemeExchangeValidationError("Missing required field 'theme'", "MISSING_REQUIRED_FIELD", "theme");
  }
  if (input.rationale === undefined || typeof input.rationale !== "string") {
    throw new ThemeExchangeValidationError("Missing required field 'rationale'", "MISSING_REQUIRED_FIELD", "rationale");
  }

  if (input.visualEvidence !== undefined && !Array.isArray(input.visualEvidence)) {
    throw new ThemeExchangeValidationError("'visualEvidence' must be an array", "SCHEMA_ERROR", "visualEvidence");
  }
  if (input.claimedDiagnostics !== undefined && !Array.isArray(input.claimedDiagnostics)) {
    throw new ThemeExchangeValidationError("'claimedDiagnostics' must be an array", "SCHEMA_ERROR", "claimedDiagnostics");
  }
  if (input.claimedProvenance !== undefined && (typeof input.claimedProvenance !== "object" || input.claimedProvenance === null || Array.isArray(input.claimedProvenance))) {
    throw new ThemeExchangeValidationError("'claimedProvenance' must be an object", "SCHEMA_ERROR", "claimedProvenance");
  }
  if (input.packageMetadata !== undefined && (typeof input.packageMetadata !== "object" || input.packageMetadata === null || Array.isArray(input.packageMetadata))) {
    throw new ThemeExchangeValidationError("'packageMetadata' must be an object", "SCHEMA_ERROR", "packageMetadata");
  }

  const theme = validateThemeSpecification(input.theme);
  const canonical = canonicalizeSpecification(theme);
  const themeDigest = `sha256:${canonical.inputDigest}`;

  // If a full brief packet was provided, verify constraints
  if (typeof input.brief === "object" && input.brief !== null) {
    const brief = input.brief;
    if (!brief.baselineTheme || typeof brief.baselineTheme !== "object") {
      throw new ThemeExchangeValidationError("Provided brief packet missing baselineTheme", "SCHEMA_ERROR", "brief.baselineTheme");
    }
    const violations = checkConstraints(
      brief.baselineTheme,
      theme,
      brief.allowedFields ?? [],
      brief.allowedModes ?? []
    );
    if (violations.length > 0) {
      throw new ThemeExchangeValidationError(
        `Candidate theme violates brief constraints:\n${violations.join("\n")}`,
        "CONSTRAINT_VIOLATION"
      );
    }
  }

  const draft: any = {
    schema: SCHEMA_THEME_CANDIDATE,
    schemaVersion: THEME_EXCHANGE_SCHEMA_VERSION,
    candidateId: input.candidateId,
    briefDigest,
    theme,
    themeDigest,
    rationale: input.rationale,
    visualEvidence: input.visualEvidence ? [...input.visualEvidence] : [],
  };

  if (input.packageMetadata) {
    draft.packageMetadata = { ...input.packageMetadata };
  }
  if (input.claimedProvenance) {
    draft.claimedProvenance = { ...input.claimedProvenance };
  }
  if (input.claimedDiagnostics) {
    draft.claimedDiagnostics = [...input.claimedDiagnostics];
  }
  if (input.claimedCssDigest) {
    draft.claimedCssDigest = input.claimedCssDigest;
  }

  const candidateDigest = computePacketDigest(draft);
  draft.candidateDigest = candidateDigest;

  return validateThemeCandidate(draft);
}

export function createThemeReview(input: ThemeReviewCreateInput): ThemeReviewPacket {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ThemeExchangeValidationError("Expected plain object for reviewInput", "INVALID_REQUEST", "reviewInput");
  }
  if (!input.reviewId || typeof input.reviewId !== "string") {
    throw new ThemeExchangeValidationError("Missing required field 'reviewId'", "MISSING_REQUIRED_FIELD", "reviewId");
  }

  if (!input.brief) {
    throw new ThemeExchangeValidationError("Missing required field 'brief'", "MISSING_REQUIRED_FIELD", "brief");
  }

  let briefDigest: string | undefined;
  if (typeof input.brief === "string") {
    briefDigest = input.brief;
  } else if (typeof input.brief === "object" && typeof (input.brief as any).briefDigest === "string") {
    briefDigest = (input.brief as any).briefDigest;
  }

  if (!briefDigest) {
    throw new ThemeExchangeValidationError("Missing required field 'brief'", "MISSING_REQUIRED_FIELD", "brief");
  }

  if (!input.candidateDigests || !Array.isArray(input.candidateDigests)) {
    throw new ThemeExchangeValidationError("Missing required field 'candidateDigests' or not an array", "MISSING_REQUIRED_FIELD", "candidateDigests");
  }
  if (!input.dispositions || !Array.isArray(input.dispositions)) {
    throw new ThemeExchangeValidationError("Missing required field 'dispositions' or not an array", "MISSING_REQUIRED_FIELD", "dispositions");
  }
  if (!input.overallDisposition || typeof input.overallDisposition !== "object" || Array.isArray(input.overallDisposition)) {
    throw new ThemeExchangeValidationError("Missing required field 'overallDisposition'", "MISSING_REQUIRED_FIELD", "overallDisposition");
  }
  if (input.summary === undefined || typeof input.summary !== "string") {
    throw new ThemeExchangeValidationError("Missing required field 'summary'", "MISSING_REQUIRED_FIELD", "summary");
  }
  if (input.annotations !== undefined && !Array.isArray(input.annotations)) {
    throw new ThemeExchangeValidationError("'annotations' must be an array", "SCHEMA_ERROR", "annotations");
  }

  const candidateDigests = [...input.candidateDigests].sort(compareUtf8);
  const dispositions = [...input.dispositions].sort((a, b) => compareUtf8(a.candidateDigest, b.candidateDigest));
  const annotations = input.annotations ? [...input.annotations].sort((a, b) => compareUtf8(a.annotationId, b.annotationId)) : [];

  const draft: any = {
    schema: SCHEMA_THEME_REVIEW,
    schemaVersion: THEME_EXCHANGE_SCHEMA_VERSION,
    reviewId: input.reviewId,
    briefDigest,
    candidateDigests,
    dispositions,
    annotations,
    overallDisposition: input.overallDisposition,
    summary: input.summary,
  };

  const reviewDigest = computePacketDigest(draft);
  draft.reviewDigest = reviewDigest;

  return validateThemeReview(draft);
}
