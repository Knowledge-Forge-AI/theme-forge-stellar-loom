import { compileTheme, canonicalizeSpecification, ContrastError } from "../compiler/index.js";
import { COMPILER_VERSION } from "../compiler/descriptor.js";
import type {
  CompileOptions,
  ContrastDiagnostic,
  ThemeDescriptor,
  CompilationResult,
} from "../types.js";
import type {
  ThemeBriefPacket,
  ThemeCandidatePacket,
  ThemeReviewPacket,
  ThemeCandidateVerificationResult,
  ThemeReviewValidationResult,
} from "./types.js";
import { checkConstraints, getLeafFieldValue } from "./leaf-fields.js";
import { validateThemeCandidate, validateThemeBrief, validateThemeReview } from "./validator.js";
import { MAX_CANDIDATES } from "./constants.js";

export function verifyThemeCandidate(
  candidate: ThemeCandidatePacket,
  brief?: ThemeBriefPacket,
  options?: CompileOptions
): ThemeCandidateVerificationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const constraintViolations: string[] = [];

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return {
      valid: false,
      candidateId: "",
      candidateDigest: "",
      briefDigest: "",
      themeDigest: "",
      diagnostics: [],
      constraintViolations: [],
      errors: ["Candidate must be a valid plain object"],
      warnings: [],
    };
  }

  // Validate candidate schema and self-consistency
  try {
    validateThemeCandidate(candidate);
  } catch (err: any) {
    errors.push(`Candidate validation error: ${err.message || String(err)}`);
  }

  let computedCssDigest: string | undefined;
  let compiledCss: string | undefined;
  let descriptor: ThemeDescriptor | undefined;
  let diagnostics: readonly ContrastDiagnostic[] = [];
  let themeDigest = "";

  // Compile candidate theme once with options (including strictContrast)
  try {
    const compileResult: CompilationResult = compileTheme(candidate.theme, options);
    computedCssDigest = compileResult.descriptor.outputDigest;
    compiledCss = compileResult.css;
    descriptor = compileResult.descriptor;
    diagnostics = compileResult.diagnostics;
    themeDigest = `sha256:${compileResult.inputDigest}`;

    if (candidate.themeDigest && themeDigest !== candidate.themeDigest) {
      errors.push(`Candidate themeDigest '${candidate.themeDigest}' does not match recomputed '${themeDigest}'`);
    }

    // Check claimed diagnostics if present
    if (candidate.claimedDiagnostics) {
      if (candidate.claimedDiagnostics.length !== diagnostics.length) {
        warnings.push(
          `Claimed diagnostics count (${candidate.claimedDiagnostics.length}) differs from locally recomputed count (${diagnostics.length})`
        );
      }
    }
    if (candidate.claimedCssDigest && computedCssDigest && candidate.claimedCssDigest !== `sha256:${computedCssDigest}`) {
      warnings.push(
        `Claimed CSS digest '${candidate.claimedCssDigest}' differs from locally compiled '${computedCssDigest}'`
      );
    }
  } catch (err: any) {
    if (err instanceof ContrastError) {
      diagnostics = err.diagnostics;
      errors.push(err.message);
    } else {
      errors.push(`Compilation error: ${err.message || String(err)}`);
    }
  }

  // Compiler compatibility checks
  if (candidate.theme?.adapter !== "starlight-v0.42") {
    errors.push(`Unsupported candidate adapter '${candidate.theme?.adapter}'`);
  }
  if (candidate.claimedProvenance?.toolVersion && candidate.claimedProvenance.toolVersion !== COMPILER_VERSION) {
    warnings.push(
      `Candidate claimed toolVersion '${candidate.claimedProvenance.toolVersion}' differs from local compiler version '${COMPILER_VERSION}'`
    );
  }

  // Candidate + brief binding validation (when brief is provided)
  if (brief) {
    try {
      validateThemeBrief(brief);
    } catch (err: any) {
      errors.push(`Target brief validation error: ${err.message || String(err)}`);
    }

    if (candidate.briefDigest !== brief.briefDigest) {
      errors.push(
        `Candidate briefDigest '${candidate.briefDigest}' does not match target brief digest '${brief.briefDigest}'`
      );
    }

    if (candidate.theme?.adapter !== brief.adapter) {
      errors.push(
        `Candidate theme adapter '${candidate.theme?.adapter}' does not match brief adapter '${brief.adapter}'`
      );
    }

    if (brief.compilerVersion !== COMPILER_VERSION) {
      errors.push(
        `Brief compilerVersion '${brief.compilerVersion}' differs from local compiler version '${COMPILER_VERSION}'`
      );
    }

    if (candidate.packageMetadata?.template) {
      const template = candidate.packageMetadata.template;
      if (!brief.approvedTemplates || brief.approvedTemplates.length === 0 || !brief.approvedTemplates.includes(template)) {
        errors.push(
          `Candidate template '${template}' is not in brief approvedTemplates [${brief.approvedTemplates?.join(", ") ?? ""}]`
        );
      }
    }

    if (brief.baselineTheme && candidate.theme) {
      const violations = checkConstraints(
        brief.baselineTheme,
        candidate.theme,
        brief.allowedFields ?? [],
        brief.allowedModes ?? []
      );
      constraintViolations.push(...violations);
      if (violations.length > 0) {
        errors.push(`Candidate violates ${violations.length} brief constraint(s)`);
      }
    }
  }

  const valid = errors.length === 0 && constraintViolations.length === 0;

  return {
    valid,
    candidateId: candidate.candidateId,
    candidateDigest: candidate.candidateDigest,
    briefDigest: candidate.briefDigest,
    themeDigest: valid ? themeDigest : "",
    computedCssDigest: valid ? computedCssDigest : undefined,
    compiledCss: valid ? compiledCss : undefined,
    descriptor: valid ? descriptor : undefined,
    diagnostics,
    constraintViolations,
    errors,
    warnings,
  };
}

export function validateThemeReviewLinks(
  review: ThemeReviewPacket,
  candidates: readonly ThemeCandidatePacket[],
  brief?: ThemeBriefPacket
): ThemeReviewValidationResult {
  const errors: string[] = [];
  const annotationErrors: string[] = [];

  if (!review || typeof review !== "object" || Array.isArray(review)) {
    return {
      valid: false,
      reviewId: "",
      reviewDigest: "",
      briefDigest: "",
      candidateMatches: false,
      dispositionMatches: false,
      annotationErrors: [],
      errors: ["Review must be a valid plain object"],
    };
  }

  try {
    validateThemeReview(review);
  } catch (err: any) {
    errors.push(`Review validation error: ${err.message || String(err)}`);
  }

  if (brief) {
    try {
      validateThemeBrief(brief);
    } catch (err: any) {
      errors.push(`Target brief validation error: ${err.message || String(err)}`);
    }

    if (review.briefDigest !== brief.briefDigest) {
      errors.push(
        `Review briefDigest '${review.briefDigest}' does not match provided brief digest '${brief.briefDigest}'`
      );
    }

    if (brief.compilerVersion !== COMPILER_VERSION) {
      errors.push(
        `Brief compilerVersion '${brief.compilerVersion}' differs from local compiler version '${COMPILER_VERSION}'`
      );
    }
  }

  if (!Array.isArray(candidates)) {
    errors.push("Candidates context must be an array");
  } else if (candidates.length > MAX_CANDIDATES) {
    errors.push(`Candidates context exceeds maximum bound of ${MAX_CANDIDATES} candidates (received ${candidates.length})`);
  }

  const candidateMap = new Map<string, ThemeCandidatePacket>();
  const seenDigests = new Set<string>();
  const seenCandidateIds = new Set<string>();

  if (Array.isArray(candidates)) {
    for (const c of candidates) {
      if (!c || typeof c !== "object" || Array.isArray(c)) {
        errors.push("Invalid candidate packet in candidates list");
        continue;
      }

      // MUST validate every candidate via validateThemeCandidate incl candidateDigest/evidence integrity
      try {
        validateThemeCandidate(c);
      } catch (err: any) {
        errors.push(`Candidate '${(c as any)?.candidateId ?? "unknown"}' validation error: ${err.message || String(err)}`);
      }

      if (c.candidateDigest) {
        if (seenDigests.has(c.candidateDigest)) {
          errors.push(`Duplicate candidate with candidateDigest '${c.candidateDigest}' provided in context`);
          continue;
        }
        seenDigests.add(c.candidateDigest);
      }

      if (c.candidateId) {
        if (seenCandidateIds.has(c.candidateId)) {
          errors.push(`Duplicate candidateId '${c.candidateId}' in candidates context`);
        } else {
          seenCandidateIds.add(c.candidateId);
        }
      }

      // Check candidate briefDigest against review briefDigest
      if (review.briefDigest && c.briefDigest && c.briefDigest !== review.briefDigest) {
        errors.push(
          `Candidate '${c.candidateId}' (digest '${c.candidateDigest}') is bound to briefDigest '${c.briefDigest}', which does not match review briefDigest '${review.briefDigest}'`
        );
      }

      if (c.candidateDigest) {
        candidateMap.set(c.candidateDigest, c);
      }
    }
  }

  let candidateMatches = true;
  if (Array.isArray(review.candidateDigests)) {
    for (const d of review.candidateDigests) {
      if (!candidateMap.has(d)) {
        errors.push(`Review references candidate digest '${d}' not present in provided candidates`);
        candidateMatches = false;
      }
    }
  } else {
    candidateMatches = false;
  }

  let dispositionMatches = true;
  if (Array.isArray(review.dispositions) && Array.isArray(review.candidateDigests)) {
    const dispDigests = new Set(
      review.dispositions
        .filter((disp): disp is { candidateDigest: string; disposition: any } => Boolean(disp && typeof disp === "object" && typeof disp.candidateDigest === "string"))
        .map((disp) => disp.candidateDigest)
    );
    for (const d of review.candidateDigests) {
      if (!dispDigests.has(d)) {
        errors.push(`Candidate '${d}' is missing from review dispositions`);
        dispositionMatches = false;
      }
    }
    for (const disp of review.dispositions) {
      if (disp && typeof disp === "object" && typeof disp.candidateDigest === "string") {
        if (!review.candidateDigests.includes(disp.candidateDigest)) {
          errors.push(`Disposition references candidate '${disp.candidateDigest}' not present in candidateDigests`);
          dispositionMatches = false;
        }
      }
    }
  } else {
    dispositionMatches = false;
  }

  // Validate overallDisposition reference
  if (review.overallDisposition && typeof review.overallDisposition === "object") {
    const overall = review.overallDisposition as any;
    if (overall.candidateDigest && !candidateMap.has(overall.candidateDigest)) {
      errors.push(`overallDisposition references candidate '${overall.candidateDigest}' not present in provided candidates`);
    }
  }

  // Strengthened annotation validation (duplicate / missing / stale / visual binding)
  const seenAnnotationIds = new Set<string>();
  if (Array.isArray(review.annotations)) {
    for (const ann of review.annotations) {
      if (!ann || typeof ann !== "object") continue;

      if (seenAnnotationIds.has(ann.annotationId)) {
        annotationErrors.push(`Duplicate annotationId '${ann.annotationId}'`);
        continue;
      }
      seenAnnotationIds.add(ann.annotationId);

      const targetCandidate = candidateMap.get(ann.candidateDigest);
      if (!targetCandidate) {
        annotationErrors.push(
          `Annotation '${ann.annotationId}' references missing candidate '${ann.candidateDigest}'`
        );
        continue;
      }

      const target = ann.target;
      if (!target || typeof target !== "object") {
        annotationErrors.push(`Annotation '${ann.annotationId}' has invalid target`);
        continue;
      }

      if (target.kind === "field") {
        const val = getLeafFieldValue(targetCandidate.theme, target.fieldPath);
        if (val === undefined) {
          annotationErrors.push(
            `Annotation '${ann.annotationId}' references field '${target.fieldPath}' that does not exist in candidate theme`
          );
        } else if (target.mode !== undefined) {
          if (target.fieldPath.startsWith("colors.dark.") && target.mode !== "dark") {
            annotationErrors.push(
              `Annotation '${ann.annotationId}' specifies mode '${target.mode}' but fieldPath '${target.fieldPath}' is in dark mode`
            );
          } else if (target.fieldPath.startsWith("colors.light.") && target.mode !== "light") {
            annotationErrors.push(
              `Annotation '${ann.annotationId}' specifies mode '${target.mode}' but fieldPath '${target.fieldPath}' is in light mode`
            );
          }
        }
      } else if (target.kind === "visual") {
        const visualRec = targetCandidate.visualEvidence?.find(
          (v) => v.evidenceDigest === target.evidenceDigest
        );
        if (!visualRec) {
          annotationErrors.push(
            `Annotation '${ann.annotationId}' references visual evidence '${target.evidenceDigest}' not present in candidate`
          );
        } else {
          if (visualRec.presence !== "included") {
            annotationErrors.push(
              `Annotation '${ann.annotationId}' references visual record '${target.evidenceDigest}' with presence '${visualRec.presence}', but visual annotations require 'included'`
            );
          } else {
            if (visualRec.pngDigest !== target.pngDigest) {
              annotationErrors.push(
                `Annotation '${ann.annotationId}' pngDigest '${target.pngDigest}' does not match visual record pngDigest '${visualRec.pngDigest}'`
              );
            }
            if (Array.isArray(target.region)) {
              const [x1, y1, x2, y2] = target.region;
              if (x1 < 0 || y1 < 0 || x2 > 1000000 || y2 > 1000000 || x1 >= x2 || y1 >= y2) {
                annotationErrors.push(
                  `Annotation '${ann.annotationId}' region [${x1}, ${y1}, ${x2}, ${y2}] is outside normalized bounds [0, 0, 1000000, 1000000]`
                );
              }
            }
          }
        }
      }
    }
  }

  if (annotationErrors.length > 0) {
    errors.push(...annotationErrors);
  }

  return {
    valid: errors.length === 0,
    reviewId: review.reviewId,
    reviewDigest: review.reviewDigest,
    briefDigest: review.briefDigest,
    candidateMatches,
    dispositionMatches,
    annotationErrors,
    errors,
  };
}
