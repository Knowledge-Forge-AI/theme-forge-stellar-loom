import { processBatchRequest as historicalProcess, MAX_STDIN_BYTES, MAX_COMPILE_INPUT_BYTES } from "./batch.js";
import type { BatchRequest, BatchResponse as HistoricalResponse } from "./batch.js";
import { compileThemeCatalog } from "./catalog/index.js";
import { assertSafePreSerialization } from "./code/index.js";
import { assertUniqueJsonKeys } from "./code/json.js";
export type { BatchRequest, BatchError, BatchAction } from "./batch.js";
export type BatchResponse = Omit<HistoricalResponse, "descriptor"> & { descriptor?: any };
export { MAX_STDIN_BYTES, MAX_COMPILE_INPUT_BYTES };
function catalogInput(value: unknown): boolean { return !!value && typeof value === "object" && Object.hasOwn(value, "catalog"); }
export function processBatchRequest(request: BatchRequest): BatchResponse {
  if (!request || typeof request !== "object") return historicalProcess(request);
  const action = Object.getOwnPropertyDescriptor(request, "action")?.value;
  const specification = Object.getOwnPropertyDescriptor(request, "specification")?.value;
  if ((action === "compile" || action === "validate") && catalogInput(specification)) {
    try {
      assertSafePreSerialization(request, MAX_COMPILE_INPUT_BYTES);
      if (request.options?.strictContrast) throw new Error("Catalog strict contrast is unsupported");
      const result = compileThemeCatalog(specification, request.options);
      return { status: "success", uiRevision: request.uiRevision, valid: true, diagnostics: result.diagnostics,
        ...(action === "compile" ? { compiledCss: result.css, descriptor: result.descriptor, styles: [...result.styles].map(([path, css]) => ({path, css})) } : {}) };
    } catch (error) { return { status: "error", uiRevision: request.uiRevision, valid: false, diagnostics: [], error: { code: "CATALOG_ERROR", message: (error as Error).message } }; }
  }
  return historicalProcess(request);
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

  let response: BatchResponse;
  try {
    if (catalogInput(parsed?.specification)) assertUniqueJsonKeys(raw);
    response = processBatchRequest(parsed);
  } catch (error) { response = { status: "error", valid: false, diagnostics: [], error: { code: "CATALOG_ERROR", message: (error as Error).message } }; }
  process.stdout.write(JSON.stringify(response, null, 2) + "\n");
  return response.status === "success" ? 0 : 1;
}
