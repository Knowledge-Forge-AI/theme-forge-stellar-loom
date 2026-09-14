import { createHash } from "node:crypto";
import {
  SEMANTIC_COMPILER_V2,
  ADAPTER_V2,
  CATALOG_V2,
  normalizeDigest,
} from "./constants.js";
import {
  CATALOG_DIGEST,
  COMPILER_VERSION,
  compileThemeV2,
  type CompilationResultV2,
  type CompileThemeV2Options,
} from "../v2/index.js";
import {
  type ThemeCandidateV2Packet,
  type VerifyThemeCandidateV2Options,
  type ThemeCandidateV2VerificationResult,
  type ThemeOutputInventoryEntryV2,
} from "./types.js";
import { compareUtf8 } from "./canonical.js";
import { validateThemeCandidateV2 } from "./validator.js";

export function verifyThemeCandidateV2(
  candidate: ThemeCandidateV2Packet,
  options?: VerifyThemeCandidateV2Options
): ThemeCandidateV2VerificationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return {
      valid: false,
      candidateId: "",
      candidateDigest: "",
      inputDigest: "",
      outputDigest: "",
      diagnostics: [],
      errors: ["Candidate must be a valid plain object"],
      warnings: [],
    };
  }

  // 1. Validate candidate schema, closed fields, and self-digest
  try {
    validateThemeCandidateV2(candidate);
  } catch (err: any) {
    return { valid: false, candidateId: "", candidateDigest: "", inputDigest: "", outputDigest: "", diagnostics: [], errors: [`Candidate validation error: ${err.message || String(err)}`], warnings: [] };
  }

  // 2. Verify semantic compatibility (semanticCompiler, adapter, catalog, catalogDigest)
  if (candidate.semanticCompiler !== SEMANTIC_COMPILER_V2) {
    errors.push(
      `Unsupported semantic compiler '${candidate.semanticCompiler}'; expected '${SEMANTIC_COMPILER_V2}'`
    );
  }
  if (candidate.adapter !== ADAPTER_V2) {
    errors.push(`Unsupported adapter '${candidate.adapter}'; expected '${ADAPTER_V2}'`);
  }
  if (candidate.catalog !== CATALOG_V2) {
    errors.push(`Unsupported catalog '${candidate.catalog}'; expected '${CATALOG_V2}'`);
  }
  if (normalizeDigest(candidate.catalogDigest) !== CATALOG_DIGEST) {
    errors.push(
      `Catalog digest mismatch: candidate has '${candidate.catalogDigest}', expected 'sha256:${CATALOG_DIGEST}'`
    );
  }

  // Producer version provenance: check for informational purposes; package version is never an acceptance gate
  if (candidate.producer?.version && candidate.producer.version !== COMPILER_VERSION) {
    warnings.push(
      `Candidate produced with package version '${candidate.producer.version}' differs from local compiler version '${COMPILER_VERSION}' (semantic level '${candidate.semanticCompiler}' is compatible)`
    );
  }

  // State check: must never be adopted
  if (candidate.state !== "candidate") {
    errors.push(`Candidate state must be 'candidate' (got '${candidate.state}')`);
  }

  // 3. Re-compile theme and verify input/output digests and output inventory
  let compileResult: CompilationResultV2 | undefined;
  try {
    const compileOptions: CompileThemeV2Options = {};
    if (candidate.selectedAccent !== undefined) {
      compileOptions.accent = candidate.selectedAccent;
    }
    if (options?.strictContrast !== undefined) {
      compileOptions.strictContrast = options.strictContrast;
    }
    compileResult = compileThemeV2(candidate.theme, compileOptions);

    const expectedInputDigest = compileResult.inputDigest;
    if (normalizeDigest(candidate.inputDigest) !== expectedInputDigest) {
      errors.push(
        `inputDigest mismatch: candidate has '${candidate.inputDigest}', recomputed 'sha256:${expectedInputDigest}'`
      );
    }

    const expectedOutputDigest = compileResult.outputDigest;
    if (normalizeDigest(candidate.outputDigest) !== expectedOutputDigest) {
      errors.push(
        `outputDigest mismatch: candidate has '${candidate.outputDigest}', recomputed 'sha256:${expectedOutputDigest}'`
      );
    }

    // Verify output inventory entries match recompiled output
    const recomputedInventory: ThemeOutputInventoryEntryV2[] = [];
    for (const [id, content] of compileResult.styles.entries()) {
      const digest = `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
      recomputedInventory.push({ id, digest });
    }

    if (!candidate.outputInventory || candidate.outputInventory.length !== recomputedInventory.length) {
      errors.push(
        `outputInventory count mismatch: candidate has ${candidate.outputInventory?.length ?? 0} entries, expected ${recomputedInventory.length}`
      );
    } else {
      for (let i = 0; i < recomputedInventory.length; i++) {
        const expected = recomputedInventory[i]!;
        const actual = candidate.outputInventory[i]!;
        if (actual.id !== expected.id || actual.digest !== expected.digest) {
          errors.push(
            `Output inventory entry '${actual.id}' digest mismatch (tamper detected): candidate has '${actual.digest}', expected '${expected.digest}'`
          );
        }
      }
    }
  } catch (err: any) {
    errors.push(`Theme compilation error: ${err.message || String(err)}`);
  }

  if ((options?.fontResources?.size ?? 0) !== (candidate.theme?.fonts?.length ?? 0)) errors.push("Font verification failed: missing or unselected resources");
  // 4. Verify explicit font resources when fonts are present
  if (candidate.theme?.fonts && candidate.theme.fonts.length > 0) {
    if (!options?.fontResources) {
      errors.push(
        `Font verification failed: theme declares ${candidate.theme.fonts.length} font(s) but no fontResources map was provided`
      );
    } else {
      for (const font of candidate.theme.fonts) {
        const resourceBytes = options.fontResources.get(font.id);
        if (!resourceBytes) {
          errors.push(`Font verification failed: missing resource for font id '${font.id}'`);
        } else {
          const computedHex = createHash("sha256").update(resourceBytes).digest("hex");
          if (computedHex !== font.sha256 && `sha256:${computedHex}` !== font.sha256) {
            errors.push(
              `Font verification failed: digest mismatch for font id '${font.id}': expected '${font.sha256}' but resource has digest '${computedHex}'`
            );
          }
        }
      }
    }
  }

  const valid = errors.length === 0;

  return {
    valid,
    candidateId: candidate.candidateId,
    candidateDigest: candidate.candidateDigest,
    inputDigest: valid ? candidate.inputDigest : "",
    outputDigest: valid ? candidate.outputDigest : "",
    descriptor: valid ? compileResult?.descriptor : undefined,
    compiledCss: valid ? compileResult?.css : undefined,
    styles: valid ? compileResult?.styles : undefined,
    diagnostics: compileResult?.diagnostics ?? [],
    errors,
    warnings,
  };
}
