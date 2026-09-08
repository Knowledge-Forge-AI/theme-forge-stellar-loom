import { assertNoDuplicateKeys } from "./design-exchange/canonical.js";
import { compileTheme } from "./compiler/index.js";
import { validateThemeSpecification, ValidationError } from "./schema/validator.js";
import { analyzeThemeContrast, ContrastError } from "./compiler/contrast.js";
import type { ThemeSpecification, ThemeDescriptor, ContrastDiagnostic, CompileOptions } from "./types.js";
import { STELLAR_CYAN_EXAMPLE, AMBER_FORGE_EXAMPLE } from "./examples.js";
import {
  type ThemeExchangePacket,
  type ThemeExchangePacketKind,
  type ThemeBriefCreateInput,
  type ThemeReviewCreateInput,
  type ThemeBriefPacket,
  type ThemeCandidatePacket,
  type ThemeReviewPacket,
  type ThemeCandidateVerificationResult,
  type ThemeReviewValidationResult,
  ThemeExchangeError,
  ThemeExchangeValidationError,
} from "./design-exchange/types.js";
import {
  createThemeBrief,
  createThemeReview,
} from "./design-exchange/create.js";
import {
  parseThemeExchangePacket,
  serializeThemeExchangePacket,
} from "./design-exchange/serde.js";
import {
  verifyThemeCandidate,
  validateThemeReviewLinks,
} from "./design-exchange/verify.js";

export type BatchAction =
  | "compile"
  | "validate"
  | "example"
  | "exchange-brief-create"
  | "exchange-packet-parse"
  | "exchange-candidate-verify"
  | "exchange-review-create"
  | "exchange-review-validate";

export interface BatchRequest {
  opaquePackets?: boolean | undefined;
  action: BatchAction;
  specification?: unknown;
  exampleName?: string | undefined;
  options?: {
    strictContrast?: boolean | undefined;
  } | undefined;
  uiRevision?: number | undefined;
  // Exchange parameters
  briefInput?: ThemeBriefCreateInput | undefined;
  reviewInput?: ThemeReviewCreateInput | undefined;
  packetJson?: string | undefined;
  packetBytesBase64?: string | undefined;
  expectedKind?: ThemeExchangePacketKind | undefined;
  candidate?: ThemeCandidatePacket | undefined;
  brief?: ThemeBriefPacket | undefined;
  review?: ThemeReviewPacket | undefined;
  candidates?: ThemeCandidatePacket[] | undefined;
}

export interface BatchError {
  code: string;
  message: string;
  fieldPath?: string | undefined;
}

export interface BatchResponse {
  status: "success" | "error";
  uiRevision?: number | undefined;
  valid: boolean;
  compiledCss?: string | undefined;
  descriptor?: ThemeDescriptor | undefined;
  diagnostics: ContrastDiagnostic[];
  specification?: ThemeSpecification | undefined;
  exampleName?: string | undefined;
  // Exchange fields
  packet?: ThemeExchangePacket | undefined;
  canonicalJson?: string | undefined;
  kind?: ThemeExchangePacketKind | undefined;
  digest?: string | undefined;
  byteCount?: number | undefined;
  candidateVerification?: ThemeCandidateVerificationResult | undefined;
  reviewValidation?: ThemeReviewValidationResult | undefined;
  error?: BatchError | undefined;
}

export const MAX_STDIN_BYTES = 32 * 1024 * 1024; // 32MB max batch transport envelope
export const MAX_COMPILE_INPUT_BYTES = 2 * 1024 * 1024; // 2MB for compile/validate

/** Native transport carries opaque canonical packet text; TFSL owns decoding. */
export function processBatchRequest(request: BatchRequest): BatchResponse {
  try {
    if (!request || typeof request !== "object") return processBatchRequestInternal(request);
    const wire = request as unknown as Record<string, unknown>;
    const decoded = { ...request };
    for (const field of ["briefInput", "reviewInput"] as const) {
      if (typeof wire[field] === "string") {
        assertNoDuplicateKeys(wire[field]);
        (decoded as unknown as Record<string, unknown>)[field] = JSON.parse(wire[field]);
      }
    }
    for (const [field, kind] of [["candidate", "candidate"], ["brief", "brief"], ["review", "review"]] as const) {
      if (typeof wire[field] === "string") {
        (decoded as unknown as Record<string, unknown>)[field] = parseThemeExchangePacket(wire[field], kind);
      }
    }
    if (Array.isArray(wire.candidates)) {
      decoded.candidates = wire.candidates.map((packet: unknown) => typeof packet === "string"
        ? parseThemeExchangePacket(packet, "candidate") as ThemeCandidatePacket : packet as ThemeCandidatePacket);
    }
    const result = processBatchRequestInternal(decoded);
    if (request.opaquePackets) {
      const { packet: _packet, ...opaqueResult } = result;
      return opaqueResult;
    }
    return result;
  } catch (error) {
    return { status: "error", uiRevision: request?.uiRevision, valid: false, diagnostics: [], error: {
      code: error instanceof ThemeExchangeError ? error.code : "INVALID_REQUEST",
      message: error instanceof Error ? error.message : "Invalid exchange input",
      ...(error instanceof ThemeExchangeValidationError && error.fieldPath ? { fieldPath: error.fieldPath } : {}),
    } };
  }
}

function processBatchRequestInternal(request: BatchRequest): BatchResponse {
  const uiRevision = request?.uiRevision;

  if (!request || typeof request !== "object" || typeof request.action !== "string") {
    return {
      status: "error",
      uiRevision,
      valid: false,
      diagnostics: [],
      error: {
        code: "INVALID_REQUEST",
        message: "Request must be an object with an 'action' property",
      },
    };
  }

  try {
    if (request.action === "example") {
      const name = request.exampleName;
      let spec: ThemeSpecification;
      if (name === "stellar-cyan" || name === "cyan") {
        spec = JSON.parse(JSON.stringify(STELLAR_CYAN_EXAMPLE));
      } else if (name === "amber-forge" || name === "amber") {
        spec = JSON.parse(JSON.stringify(AMBER_FORGE_EXAMPLE));
      } else {
        return {
          status: "error",
          uiRevision,
          valid: false,
          diagnostics: [],
          error: {
            code: "UNKNOWN_EXAMPLE",
            message: `Unknown example name '${name}'. Supported examples: 'stellar-cyan', 'amber-forge'`,
          },
        };
      }

      const validated = validateThemeSpecification(spec);
      const diagnostics = analyzeThemeContrast(validated);
      const compileResult = compileTheme(validated);
      return {
        status: "success",
        uiRevision,
        valid: true,
        exampleName: name,
        specification: validated,
        compiledCss: compileResult.css,
        descriptor: compileResult.descriptor,
        diagnostics,
      };
    }

    if (request.action === "compile") {
      const validated = validateThemeSpecification(request.specification);
      const diagnostics = analyzeThemeContrast(validated);

      if (request.options?.strictContrast) {
        const failures = diagnostics.filter((d) => d.severity === "warning");
        if (failures.length > 0) {
          throw new ContrastError(
            `Theme fails WCAG 2.2 AA contrast requirements in ${failures.length} pair(s)`,
            failures
          );
        }
      }

      const compileResult = compileTheme(validated);
      return {
        status: "success",
        uiRevision,
        valid: true,
        compiledCss: compileResult.css,
        descriptor: compileResult.descriptor,
        diagnostics,
      };
    }

    if (request.action === "validate") {
      const validated = validateThemeSpecification(request.specification);
      const diagnostics = analyzeThemeContrast(validated);
      if (request.options?.strictContrast) {
        const failures = diagnostics.filter((d) => d.severity === "warning");
        if (failures.length > 0) {
          throw new ContrastError(
            `Theme fails WCAG 2.2 AA contrast requirements in ${failures.length} pair(s)`,
            failures
          );
        }
      }
      return {
        status: "success",
        uiRevision,
        valid: true,
        diagnostics,
      };
    }

    if (request.action === "exchange-brief-create") {
      if (!request.briefInput || typeof request.briefInput !== "object" || Array.isArray(request.briefInput)) {
        throw new ThemeExchangeValidationError("Missing or invalid briefInput in exchange-brief-create request", "INVALID_REQUEST", "briefInput");
      }
      const packet = createThemeBrief(request.briefInput);
      return {
        status: "success",
        uiRevision,
        valid: true,
        diagnostics: [],
        packet,
        canonicalJson: serializeThemeExchangePacket(packet),
        kind: "brief",
        digest: packet.briefDigest,
      };
    }

    if (request.action === "exchange-packet-parse") {
      let raw: string | Uint8Array;
      if (request.packetJson !== undefined) {
        raw = request.packetJson;
      } else if (request.packetBytesBase64 !== undefined) {
        raw = Buffer.from(request.packetBytesBase64, "base64");
      } else {
        throw new ThemeExchangeValidationError("Missing packetJson or packetBytesBase64 in parse request", "INVALID_REQUEST");
      }

      const packet = parseThemeExchangePacket(raw, request.expectedKind);
      const kind: ThemeExchangePacketKind =
        packet.schema === "tfsl.theme-brief"
          ? "brief"
          : packet.schema === "tfsl.theme-candidate"
          ? "candidate"
          : "review";
      const digest =
        packet.schema === "tfsl.theme-brief"
          ? packet.briefDigest
          : packet.schema === "tfsl.theme-candidate"
          ? packet.candidateDigest
          : packet.reviewDigest;

      const byteCount = typeof raw === "string" ? Buffer.byteLength(raw, "utf8") : raw.byteLength;

      return {
        status: "success",
        uiRevision,
        valid: true,
        diagnostics: [],
        packet,
        canonicalJson: serializeThemeExchangePacket(packet),
        kind,
        digest,
        byteCount,
      };
    }

    if (request.action === "exchange-candidate-verify") {
      if (!request.candidate || typeof request.candidate !== "object" || Array.isArray(request.candidate)) {
        throw new ThemeExchangeValidationError("Missing or invalid candidate in exchange-candidate-verify request", "INVALID_REQUEST", "candidate");
      }
      if (!request.brief || typeof request.brief !== "object" || Array.isArray(request.brief)) {
        throw new ThemeExchangeValidationError("Missing or invalid brief in exchange-candidate-verify request", "INVALID_REQUEST", "brief");
      }
      const compileOptions: CompileOptions | undefined =
        request.options?.strictContrast !== undefined
          ? { strictContrast: request.options.strictContrast }
          : undefined;
      const result = verifyThemeCandidate(request.candidate, request.brief, compileOptions);
      const isStrictContrast = Boolean(request.options?.strictContrast);
      const hasContrastWarnings = result.diagnostics.some((d) => d.severity === "warning");
      const hasStrictContrastViolation = isStrictContrast && hasContrastWarnings;

      const { compiledCss: _css, descriptor: _desc, ...candidateVerification } = result;

      return {
        status: result.valid ? "success" : "error",
        uiRevision,
        valid: result.valid,
        specification: result.valid ? request.candidate.theme : undefined,
        compiledCss: result.compiledCss,
        descriptor: result.descriptor,
        diagnostics: [...result.diagnostics],
        candidateVerification,
        error: result.valid
          ? undefined
          : {
              code: hasStrictContrastViolation
                ? "STRICT_CONTRAST_VIOLATION"
                : "CANDIDATE_VERIFICATION_FAILED",
              message: result.errors.join("; ") || "Candidate verification failed",
            },
      };
    }

    if (request.action === "exchange-review-create") {
      if (!request.reviewInput || typeof request.reviewInput !== "object" || Array.isArray(request.reviewInput)) {
        throw new ThemeExchangeValidationError("Missing or invalid reviewInput in exchange-review-create request", "INVALID_REQUEST", "reviewInput");
      }
      const packet = createThemeReview(request.reviewInput);
      return {
        status: "success",
        uiRevision,
        valid: true,
        diagnostics: [],
        packet,
        canonicalJson: serializeThemeExchangePacket(packet),
        kind: "review",
        digest: packet.reviewDigest,
      };
    }

    if (request.action === "exchange-review-validate") {
      if (!request.review || typeof request.review !== "object" || Array.isArray(request.review)) {
        throw new ThemeExchangeValidationError("Missing or invalid review in exchange-review-validate request", "INVALID_REQUEST", "review");
      }
      if (!request.brief || typeof request.brief !== "object" || Array.isArray(request.brief)) {
        throw new ThemeExchangeValidationError("Missing or invalid brief in exchange-review-validate request", "INVALID_REQUEST", "brief");
      }
      const candidates = Array.isArray(request.candidates) ? request.candidates : [];
      const result = validateThemeReviewLinks(request.review, candidates, request.brief);
      return {
        status: result.valid ? "success" : "error",
        uiRevision,
        valid: result.valid,
        diagnostics: [],
        reviewValidation: result,
        error: result.valid
          ? undefined
          : {
              code: "REVIEW_VALIDATION_FAILED",
              message: result.errors.join("; ") || "Review validation failed",
            },
      };
    }

    return {
      status: "error",
      uiRevision,
      valid: false,
      diagnostics: [],
      error: {
        code: "UNKNOWN_ACTION",
        message: `Unknown action '${(request as any).action}'. Supported actions: 'compile', 'validate', 'example', 'exchange-brief-create', 'exchange-packet-parse', 'exchange-candidate-verify', 'exchange-review-create', 'exchange-review-validate'`,
      },
    };
  } catch (err: any) {
    if (err instanceof ValidationError) {
      return {
        status: "error",
        uiRevision,
        valid: false,
        diagnostics: [],
        error: {
          code: err.code || "VALIDATION_ERROR",
          message: err.message,
          fieldPath: err.fieldPath,
        },
      };
    }
    if (err instanceof ContrastError) {
      return {
        status: "error",
        uiRevision,
        valid: false,
        diagnostics: err.diagnostics,
        error: {
          code: "STRICT_CONTRAST_VIOLATION",
          message: err.message,
        },
      };
    }
    if (err instanceof ThemeExchangeValidationError) {
      return {
        status: "error",
        uiRevision,
        valid: false,
        diagnostics: [],
        error: {
          code: err.code,
          message: err.message,
          fieldPath: err.fieldPath,
        },
      };
    }
    if (err instanceof ThemeExchangeError) {
      return {
        status: "error",
        uiRevision,
        valid: false,
        diagnostics: [],
        error: {
          code: err.code,
          message: err.message,
        },
      };
    }
    return {
      status: "error",
      uiRevision,
      valid: false,
      diagnostics: [],
      error: {
        code: "INTERNAL_ERROR",
        message: err.message || String(err),
      },
    };
  }
}

export async function runBatch(): Promise<number> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of process.stdin) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > MAX_STDIN_BYTES) {
      const response: BatchResponse = {
        status: "error",
        valid: false,
        diagnostics: [],
        error: {
          code: "INPUT_TOO_LARGE",
          message: `Input exceeded maximum size limit of ${MAX_STDIN_BYTES} bytes`,
        },
      };
      process.stdout.write(JSON.stringify(response, null, 2) + "\n");
      return 1;
    }
    chunks.push(buf);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    const response: BatchResponse = {
      status: "error",
      valid: false,
      diagnostics: [],
      error: {
        code: "EMPTY_INPUT",
        message: "No input received on stdin",
      },
    };
    process.stdout.write(JSON.stringify(response, null, 2) + "\n");
    return 1;
  }

  let parsed: BatchRequest;
  try {
    parsed = JSON.parse(raw);
  } catch (err: any) {
    const response: BatchResponse = {
      status: "error",
      valid: false,
      diagnostics: [],
      error: {
        code: "INVALID_JSON",
        message: `Failed to parse input as JSON: ${err.message}`,
      },
    };
    process.stdout.write(JSON.stringify(response, null, 2) + "\n");
    return 1;
  }

  // Per-action limit checks
  if (
    (parsed.action === "compile" || parsed.action === "validate" || parsed.action === "example") &&
    raw.length > MAX_COMPILE_INPUT_BYTES
  ) {
    const response: BatchResponse = {
      status: "error",
      uiRevision: parsed.uiRevision,
      valid: false,
      diagnostics: [],
      error: {
        code: "INPUT_TOO_LARGE",
        message: `Compile action input exceeded 2MB limit`,
      },
    };
    process.stdout.write(JSON.stringify(response, null, 2) + "\n");
    return 1;
  }

  const response = processBatchRequest(parsed);
  process.stdout.write(JSON.stringify(response, null, 2) + "\n");
  return response.status === "success" ? 0 : 1;
}
