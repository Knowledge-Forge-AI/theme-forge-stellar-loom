import { createHash } from "node:crypto";
import {
  SEMANTIC_COMPILER_CODE,
  ADAPTER_CODE,
  CATALOG_CODE,
  normalizeDigest,
} from "./constants.js";
import {
  SEMANTIC_COMPILER_V2,
  CATALOG_V2,
} from "../design-exchange-v2/constants.js";
import {
  CODE_CATALOG_DIGEST,
  type CompilationResultCode,
  type CompileThemeCodeOptions,
} from "../code/index.js";
import { COMPILER_VERSION } from "../v2/index.js";
import { compileThemeCode as safeCompileThemeCode } from "../code/compiler.js";
import {
  type ThemeCodeCandidatePacket,
  type VerifyThemeCodeCandidateOptions,
  type ThemeCodeCandidateVerificationResult,
  type ThemeCodeOutputInventoryEntry,
} from "./types.js";
import {
  computeSyntaxDigest,
  compareUtf8,
} from "./canonical.js";
import { generatePackageCode } from "./package-generator.js";
import { assertNoAccessorsOrFunctions, validateThemeCodeCandidate } from "./validator.js";

export function verifyThemeCodeCandidate(
  candidate: ThemeCodeCandidatePacket,
  options?: VerifyThemeCodeCandidateOptions
): ThemeCodeCandidateVerificationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return {
      valid: false,
      candidateId: "",
      candidateDigest: "",
      inputDigest: "",
      outputDigest: "",
      themeDigest: "",
      syntaxDigest: "",
      diagnostics: [],
      errors: ["Candidate must be a valid plain object"],
      warnings: [],
    };
  }

  try { assertNoAccessorsOrFunctions(candidate); }
  catch { return { valid: false, candidateId: "", candidateDigest: "", inputDigest: "", outputDigest: "", themeDigest: "", syntaxDigest: "", diagnostics: [], errors: ["Unsafe candidate data"], warnings: [] }; }

  // 1. Reject core tuples and mixed tuples immediately with specific errors
  const candAny = candidate as any;
  const isCoreSemantic = candAny.semanticCompiler === SEMANTIC_COMPILER_V2;
  const isCoreCatalog = candAny.catalog === CATALOG_V2;
  const isCodeSemantic = candAny.semanticCompiler === SEMANTIC_COMPILER_CODE;
  const isCodeCatalog = candAny.catalog === CATALOG_CODE;

  if (isCoreSemantic && isCoreCatalog) {
    return {
      valid: false,
      candidateId: typeof candAny.candidateId === "string" ? candAny.candidateId : "",
      candidateDigest: typeof candAny.candidateDigest === "string" ? candAny.candidateDigest : "",
      inputDigest: "",
      outputDigest: "",
      themeDigest: "",
      syntaxDigest: "",
      diagnostics: [],
      errors: [
        "Core theme candidate tuple cannot be verified by verifyThemeCodeCandidate; use verifyThemeCandidateCompatible or verifyThemeCandidateV2",
      ],
      warnings: [],
    };
  }

  if ((isCoreSemantic && isCodeCatalog) || (isCodeSemantic && isCoreCatalog)) {
    return {
      valid: false,
      candidateId: typeof candAny.candidateId === "string" ? candAny.candidateId : "",
      candidateDigest: typeof candAny.candidateDigest === "string" ? candAny.candidateDigest : "",
      inputDigest: "",
      outputDigest: "",
      themeDigest: "",
      syntaxDigest: "",
      diagnostics: [],
      errors: [
        `Mixed tuple detected (semanticCompiler='${candAny.semanticCompiler}', catalog='${candAny.catalog}'); mixed core/code tuples are strictly forbidden`,
      ],
      warnings: [],
    };
  }

  // 2. Validate candidate schema, closed fields, and self-digest
  try {
    validateThemeCodeCandidate(candidate);
  } catch (err: any) {
    return {
      valid: false,
      candidateId: "",
      candidateDigest: "",
      inputDigest: "",
      outputDigest: "",
      themeDigest: "",
      syntaxDigest: "",
      diagnostics: [],
      errors: [`Candidate validation error: ${err.message || String(err)}`],
      warnings: [],
    };
  }

  // 3. Verify semantic compatibility
  {
    if (candidate.semanticCompiler !== SEMANTIC_COMPILER_CODE) {
      errors.push(
        `Unsupported semantic compiler '${candidate.semanticCompiler}'; expected '${SEMANTIC_COMPILER_CODE}'`
      );
    }
    if (candidate.adapter !== ADAPTER_CODE) {
      errors.push(`Unsupported adapter '${candidate.adapter}'; expected '${ADAPTER_CODE}'`);
    }
    if (candidate.catalog !== CATALOG_CODE) {
      errors.push(`Unsupported catalog '${candidate.catalog}'; expected '${CATALOG_CODE}'`);
    }
    if (normalizeDigest(candidate.catalogDigest) !== normalizeDigest(CODE_CATALOG_DIGEST)) {
      errors.push(
        `Catalog digest mismatch: candidate has '${candidate.catalogDigest}', expected 'sha256:${CODE_CATALOG_DIGEST}'`
      );
    }
  }

  // Producer version provenance
  if (candidate.producer?.version && candidate.producer.version !== COMPILER_VERSION) {
    warnings.push(
      `Candidate produced with package version '${candidate.producer.version}' differs from local compiler version '${COMPILER_VERSION}' (semantic level '${candidate.semanticCompiler}' is compatible)`
    );
  }

  // State check: must never be adopted
  if (candidate.state !== "candidate") {
    errors.push(`Candidate state must be 'candidate' (got '${candidate.state}')`);
  }

  // 3. Re-compile theme and verify input, theme, syntax, and output digests
  let compileResult: CompilationResultCode | undefined;
  try {
    const compileOptions: CompileThemeCodeOptions = {};
    if (candidate.selectedAccent !== undefined) {
      compileOptions.accent = candidate.selectedAccent;
    }
    if (options?.strictContrast !== undefined) {
      compileOptions.strictContrast = options.strictContrast;
    }
    compileResult = safeCompileThemeCode(candidate.theme, compileOptions);

    const expectedInputDigest = compileResult.inputDigest;
    if (normalizeDigest(candidate.inputDigest) !== expectedInputDigest) {
      errors.push(
        `inputDigest mismatch: candidate has '${candidate.inputDigest}', recomputed 'sha256:${expectedInputDigest}'`
      );
    }

    if (normalizeDigest(candidate.themeDigest) !== expectedInputDigest) {
      errors.push(
        `themeDigest mismatch: candidate has '${candidate.themeDigest}', recomputed 'sha256:${expectedInputDigest}'`
      );
    }

    const expectedSyntaxDigest = computeSyntaxDigest(candidate.theme.codePresentation.syntaxTheme);
    if (candidate.syntaxDigest !== expectedSyntaxDigest) {
      errors.push(
        `syntaxDigest mismatch: candidate has '${candidate.syntaxDigest}', recomputed '${expectedSyntaxDigest}'`
      );
    }

    const expectedOutputDigest = compileResult.outputDigest;
    if (normalizeDigest(candidate.outputDigest) !== expectedOutputDigest) {
      errors.push(
        `outputDigest mismatch: candidate has '${candidate.outputDigest}', recomputed 'sha256:${expectedOutputDigest}'`
      );
    }
  } catch (err: any) {
    errors.push(`Theme compilation error: ${err.message || String(err)}`);
  }

  // 4. Re-generate full package and verify entire member inventory (not only CSS)
  let packageFiles: ReadonlyMap<string, string | Uint8Array> | undefined;
  if (compileResult) {
    try {
      const pkgResult = generatePackageCode({
        themeSpec: candidate.theme,
        metadata: candidate.metadata,
        accent: candidate.selectedAccent,
        fontResources: options?.fontResources,
      });
      packageFiles = pkgResult.files;

      // Recompute expected inventory from full generated package, including generated provenance
      const recomputedInventory: ThemeCodeOutputInventoryEntry[] = [];
      for (const [id, content] of pkgResult.files.entries()) {
        const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
        recomputedInventory.push({ id, digest });
      }
      recomputedInventory.sort((a, b) => compareUtf8(a.id, b.id));

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
      errors.push(`Package re-generation error: ${err.message || String(err)}`);
    }
  }

  // 5. Verify explicit font resources when fonts are present
  const declaredFontCount = candidate.theme?.fonts?.length ?? 0;
  if (declaredFontCount > 0) {
    if (!options?.fontResources) {
      errors.push(
        `Font verification failed: theme declares ${declaredFontCount} font(s) but no fontResources map was provided`
      );
    } else if (options.fontResources.size !== declaredFontCount) {
      errors.push(
        `Font verification failed: theme declares ${declaredFontCount} font(s) but fontResources has ${options.fontResources.size}`
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
    themeDigest: valid ? candidate.themeDigest : "",
    syntaxDigest: valid ? candidate.syntaxDigest : "",
    descriptor: valid ? compileResult?.descriptor : undefined,
    compiledCss: valid ? compileResult?.css : undefined,
    styles: valid ? compileResult?.styles : undefined,
    packageFiles: valid ? packageFiles : undefined,
    diagnostics: compileResult?.diagnostics ?? [],
    errors,
    warnings,
  };
}
