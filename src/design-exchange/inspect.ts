import {
  SCHEMA_THEME_BRIEF,
  SCHEMA_THEME_CANDIDATE,
  SCHEMA_THEME_REVIEW,
} from "./constants.js";
import {
  type ThemeExchangePacket,
  type ThemeExchangeInspection,
  type ThemeExchangePacketKind,
} from "./types.js";
import { validateThemeExchangePacket } from "./validator.js";

export function inspectThemeExchangePacket(packet: ThemeExchangePacket): ThemeExchangeInspection {
  const errors: string[] = [];
  try {
    validateThemeExchangePacket(packet);
  } catch (err: any) {
    errors.push(err.message || String(err));
  }

  const valid = errors.length === 0;

  if (packet.schema === SCHEMA_THEME_BRIEF) {
    const brief = packet;
    return {
      kind: "brief",
      schema: brief.schema,
      schemaVersion: brief.schemaVersion,
      digest: brief.briefDigest,
      publicId: brief.briefId,
      valid,
      errors,
      summary: {
        briefId: brief.briefId,
        title: brief.title,
        goal: brief.goal,
        baselineTheme: brief.baselineTheme?.name,
        themeDigest: brief.themeDigest,
        compilerVersion: brief.compilerVersion,
        adapter: brief.adapter,
        allowedFields: brief.allowedFields,
        allowedModes: brief.allowedModes,
        acceptanceCriteriaCount: brief.acceptanceCriteria?.length ?? 0,
        prohibitedChangesCount: brief.prohibitedChanges?.length ?? 0,
        visualEvidenceCount: brief.visualEvidence?.length ?? 0,
      },
    };
  }

  if (packet.schema === SCHEMA_THEME_CANDIDATE) {
    const cand = packet;
    return {
      kind: "candidate",
      schema: cand.schema,
      schemaVersion: cand.schemaVersion,
      digest: cand.candidateDigest,
      publicId: cand.candidateId,
      valid,
      errors,
      summary: {
        candidateId: cand.candidateId,
        briefDigest: cand.briefDigest,
        themeName: cand.theme?.name,
        themeVersion: cand.theme?.version,
        themeDigest: cand.themeDigest,
        rationale: cand.rationale,
        hasPackageMetadata: Boolean(cand.packageMetadata),
        claimedDiagnosticsCount: cand.claimedDiagnostics?.length ?? 0,
        visualEvidenceCount: cand.visualEvidence?.length ?? 0,
      },
    };
  }

  if (packet.schema === SCHEMA_THEME_REVIEW) {
    const rev = packet;
    return {
      kind: "review",
      schema: rev.schema,
      schemaVersion: rev.schemaVersion,
      digest: rev.reviewDigest,
      publicId: rev.reviewId,
      valid,
      errors,
      summary: {
        reviewId: rev.reviewId,
        briefDigest: rev.briefDigest,
        candidateCount: rev.candidateDigests?.length ?? 0,
        candidateDigests: rev.candidateDigests,
        dispositionsCount: rev.dispositions?.length ?? 0,
        annotationsCount: rev.annotations?.length ?? 0,
        overallDisposition: rev.overallDisposition,
        summary: rev.summary,
      },
    };
  }

  return {
    kind: "brief" as ThemeExchangePacketKind,
    schema: (packet as any).schema ?? "unknown",
    schemaVersion: (packet as any).schemaVersion ?? 0,
    digest: "unknown",
    publicId: "unknown",
    valid: false,
    errors: ["Unknown packet schema"],
    summary: {},
  };
}
