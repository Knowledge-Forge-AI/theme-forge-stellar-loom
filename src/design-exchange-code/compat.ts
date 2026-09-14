import { assertSafePreSerialization } from "../code/index.js";
import {
  SEMANTIC_COMPILER_CODE,
  ADAPTER_CODE,
  CATALOG_CODE,
} from "./constants.js";
import {
  SEMANTIC_COMPILER_V2,
  ADAPTER_V2,
  CATALOG_V2,
} from "../design-exchange-v2/constants.js";
import {
  verifyThemeCandidateV2,
  type ThemeCandidateV2Packet,
  type ThemeCandidateV2VerificationResult,
} from "../design-exchange-v2/index.js";
import { verifyThemeCodeCandidate } from "./verify.js";
import type {
  ThemeCodeCandidatePacket,
  ThemeCodeCandidateVerificationResult,
} from "./types.js";

export interface VerifyThemeCandidateCompatibleOptions {
  readonly fontResources?: ReadonlyMap<string, Uint8Array> | undefined;
  readonly strictContrast?: boolean | undefined;
}

export type CompatibleVerificationResult =
  | ThemeCandidateV2VerificationResult
  | ThemeCodeCandidateVerificationResult;

/**
 * Explicit compatibility wrapper routing exact core packet tuple to original verifyThemeCandidateV2
 * and code packet tuple to verifyThemeCodeCandidate. Historical bytes remain untouched.
 */
export function verifyThemeCandidateCompatible(
  candidate: unknown,
  options?: VerifyThemeCandidateCompatibleOptions
): CompatibleVerificationResult {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return {
      valid: false,
      candidateId: "",
      candidateDigest: "",
      inputDigest: "",
      outputDigest: "",
      diagnostics: [],
      errors: ["Candidate packet must be a valid plain object"],
      warnings: [],
    } as any;
  }

  try { assertSafePreSerialization(candidate, 16 * 1024 * 1024); } catch { return { valid: false, candidateId: "", candidateDigest: "", inputDigest: "", outputDigest: "", diagnostics: [], errors: ["Unsafe candidate data"], warnings: [] }; }
  const packet = candidate as Record<string, unknown>;
  const semanticCompiler = packet.semanticCompiler;
  const adapter = packet.adapter;
  const catalog = packet.catalog;

  // Exact core packet tuple: route to original verifyThemeCandidateV2
  if (
    semanticCompiler === SEMANTIC_COMPILER_V2 &&
    adapter === ADAPTER_V2 &&
    catalog === CATALOG_V2
  ) {
    return verifyThemeCandidateV2(packet as unknown as ThemeCandidateV2Packet, options);
  }

  // Exact code packet tuple: route to verifyThemeCodeCandidate
  if (
    semanticCompiler === SEMANTIC_COMPILER_CODE &&
    adapter === ADAPTER_CODE &&
    catalog === CATALOG_CODE
  ) {
    return verifyThemeCodeCandidate(packet as unknown as ThemeCodeCandidatePacket, options);
  }

  // Mixed or unknown tuple: fail closed
  const isMixed =
    (semanticCompiler === SEMANTIC_COMPILER_V2 && catalog === CATALOG_CODE) ||
    (semanticCompiler === SEMANTIC_COMPILER_CODE && catalog === CATALOG_V2);

  const errorMsg = isMixed
    ? `Mixed tuple detected: semanticCompiler='${String(semanticCompiler)}' paired with catalog='${String(catalog)}'; mixed core/code tuples are strictly forbidden`
    : `Unsupported or unknown candidate tuple: semanticCompiler='${String(semanticCompiler)}', adapter='${String(adapter)}', catalog='${String(catalog)}'`;

  return {
    valid: false,
    candidateId: typeof packet.candidateId === "string" ? packet.candidateId : "",
    candidateDigest: typeof packet.candidateDigest === "string" ? packet.candidateDigest : "",
    inputDigest: "",
    outputDigest: "",
    themeDigest: "",
    syntaxDigest: "",
    diagnostics: [],
    errors: [errorMsg],
    warnings: [],
  } as any;
}
