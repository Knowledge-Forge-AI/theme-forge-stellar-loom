import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertSafePreSerialization, CODE_COMPILER_SEMANTIC, CODE_CATALOG_IDENTITY, CODE_CATALOG_DIGEST } from "../code/index.js";
import { assertUniqueJsonKeys } from "../code/json.js";
import { verifyThemeCandidateCompatible as verifyHistorical } from "../design-exchange-code/compat.js";
import { validatePackageMetadata } from "../generator/metadata.js";
import { validateThemeCatalog, generateThemePackageCatalog, CATALOG_COMPILER_SEMANTIC, CATALOG_IDENTITY, CATALOG_DIGEST } from "../catalog/index.js";
import type { ThemeSpecificationCatalog } from "../catalog/types.js";
import type { PackageMetadata } from "../generator/types.js";
import { assertBuiltCatalogExecution, computeExecutableIdentityDigestCatalog, canonical, hash, packageRoot } from "./executable.js";
export { computeExecutableIdentityDigestCatalog } from "./executable.js";

type Inventory = Array<{ id: string; digest: string }>;
export interface ThemeCatalogCandidatePacket {
  schema: "tfsl.theme-catalog-candidate"; schemaVersion: 1; state: "candidate";
  semanticCompiler: string; adapter: "starlight-v0.42"; catalog: string; catalogDigest: string;
  producer: { package: string; version: string; executableDigest: string; packageMetadataDigest: string; tarballDigest?: string };
  theme: ThemeSpecificationCatalog; metadata: PackageMetadata; selectedAccent: string;
  inputDigest: string; outputDigest: string; outputInventory: Inventory;
  fontInventory: Array<{ id: string; digest: string; licenseId: string; licenseDigest: string }>;
  code: null | { semantic: string; catalog: string; catalogDigest: string; inputDigest: string };
  visualEvidence: Array<{ id: string; digest: string }>;
  candidateDigest: string;
}
export interface CreateThemeCatalogCandidateOptions {
  metadata: unknown; accent?: string | undefined; selectedAccent?: string | undefined;
  fontResources?: ReadonlyMap<string, Uint8Array> | undefined;
  tarballDigest?: string | undefined; visualEvidence?: Array<{ id: string; digest: string }> | undefined;
}
const digest = (v: unknown) => `sha256:${hash(canonical(v))}`;
const byteDigest = (v: string | Uint8Array) => `sha256:${hash(v)}`;
function exact(value: any, required: string[], optional: string[] = []): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || required.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) throw new Error("CATALOG_PACKET_SCHEMA_ERROR");
}
function validDigest(value: unknown): void { if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) throw new Error("INVALID_DIGEST"); }
function packetDigest(packet: any): string { const { candidateDigest: _, ...body } = packet; return digest(body); }
function inventory(files: ReadonlyMap<string, string | Uint8Array>): Inventory {
  return [...files].map(([id, bytes]) => ({ id, digest: byteDigest(bytes) })).sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)));
}
function bindings(theme: ThemeSpecificationCatalog) {
  return {
    fontInventory: theme.fonts.map(f => ({ id: f.id, digest: `sha256:${f.sha256}`, licenseId: f.notice, licenseDigest: `sha256:${theme.catalog.fontLicenses.find(l => l.id === f.notice)!.sha256}` })),
    code: typeof theme.codePresentation === "object" ? { semantic: CODE_COMPILER_SEMANTIC, catalog: CODE_CATALOG_IDENTITY, catalogDigest: `sha256:${CODE_CATALOG_DIGEST}`, inputDigest: digest(theme.codePresentation) } : null,
  };
}
export function createThemeCatalogCandidate(input: unknown, options: CreateThemeCatalogCandidateOptions): ThemeCatalogCandidatePacket {
  assertBuiltCatalogExecution();
  const executableDigest = computeExecutableIdentityDigestCatalog();
  const theme = validateThemeCatalog(input);
  const result = generateThemePackageCatalog({ themeSpec: theme, metadata: options.metadata, accent: options.selectedAccent ?? options.accent, fontResources: options.fontResources });
  const packageBytes = readFileSync(join(packageRoot, "package.json"));
  const pkg = JSON.parse(packageBytes.toString("utf8"));
  const packet: ThemeCatalogCandidatePacket = {
    schema: "tfsl.theme-catalog-candidate", schemaVersion: 1, state: "candidate",
    semanticCompiler: CATALOG_COMPILER_SEMANTIC, adapter: "starlight-v0.42", catalog: CATALOG_IDENTITY, catalogDigest: `sha256:${CATALOG_DIGEST}`,
    producer: { package: pkg.name, version: pkg.version, executableDigest, packageMetadataDigest: byteDigest(packageBytes), ...(options.tarballDigest ? { tarballDigest: options.tarballDigest } : {}) },
    theme, metadata: result.metadata, selectedAccent: result.descriptor.selectedAccent,
    inputDigest: `sha256:${result.themeInputDigest}`, outputDigest: `sha256:${result.cssOutputDigest}`, outputInventory: inventory(result.files),
    ...bindings(theme), visualEvidence: options.visualEvidence ?? [], candidateDigest: "",
  };
  packet.candidateDigest = packetDigest(packet);
  return validateThemeCatalogCandidate(packet);
}
export function validateThemeCatalogCandidate(input: unknown): ThemeCatalogCandidatePacket {
  assertSafePreSerialization(input, 4 * 1024 * 1024);
  const p = input as ThemeCatalogCandidatePacket;
  exact(p, ["schema", "schemaVersion", "state", "semanticCompiler", "adapter", "catalog", "catalogDigest", "producer", "theme", "metadata", "selectedAccent", "inputDigest", "outputDigest", "outputInventory", "fontInventory", "code", "visualEvidence", "candidateDigest"]);
  if (p.schema !== "tfsl.theme-catalog-candidate" || p.schemaVersion !== 1 || p.state !== "candidate" || p.semanticCompiler !== CATALOG_COMPILER_SEMANTIC || p.adapter !== "starlight-v0.42" || p.catalog !== CATALOG_IDENTITY || p.catalogDigest !== `sha256:${CATALOG_DIGEST}`) throw new Error("CATALOG_TUPLE_MISMATCH");
  exact(p.producer, ["package", "version", "executableDigest", "packageMetadataDigest"], ["tarballDigest"]);
  if (p.producer.package !== "@knowledge-forge-ai/theme-forge-stellar-loom" || typeof p.producer.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(p.producer.version)) throw new Error("INVALID_PRODUCER");
  for (const d of [p.inputDigest, p.outputDigest, p.candidateDigest, p.producer.executableDigest, p.producer.packageMetadataDigest]) validDigest(d);
  if (p.producer.tarballDigest !== undefined) validDigest(p.producer.tarballDigest);
  const theme = validateThemeCatalog(p.theme);
  validatePackageMetadata(p.metadata);
  if (!Object.hasOwn(theme.accentVariants, p.selectedAccent)) throw new Error("INVALID_ACCENT");
  const bound = bindings(theme);
  if (canonical(bound.fontInventory) !== canonical(p.fontInventory) || canonical(bound.code) !== canonical(p.code)) throw new Error("CATALOG_RESOURCE_BINDING_MISMATCH");
  for (const [records, max] of [[p.outputInventory, 128], [p.visualEvidence, 256]] as const) {
    if (!Array.isArray(records) || records.length > max) throw new Error("INVALID_INVENTORY");
    const seen = new Set();
    for (const entry of records) {
      exact(entry, ["id", "digest"]);
      if (typeof entry.id !== "string" || !/^[a-zA-Z0-9_./-]{1,256}$/.test(entry.id) || entry.id.startsWith("/") || entry.id.split("/").some(s => !s || s === "." || s === "..") || seen.has(entry.id)) throw new Error("INVALID_INVENTORY_ID");
      seen.add(entry.id); validDigest(entry.digest);
    }
  }
  if (packetDigest(p) !== p.candidateDigest) throw new Error("CANDIDATE_DIGEST_MISMATCH");
  return p;
}
export function serializeThemeCatalogCandidate(packet: ThemeCatalogCandidatePacket): string { return canonical(validateThemeCatalogCandidate(packet)) + "\n"; }
export function parseThemeCatalogCandidate(input: string | Uint8Array): ThemeCatalogCandidatePacket {
  if ((typeof input === "string" ? Buffer.byteLength(input) : input.byteLength) > 4 * 1024 * 1024) throw new Error("PACKET_TOO_LARGE");
  const text = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true }).decode(input);
  assertUniqueJsonKeys(text);
  return validateThemeCatalogCandidate(JSON.parse(text));
}
export function verifyThemeCatalogCandidate(input: unknown, options?: { fontResources?: ReadonlyMap<string, Uint8Array> | undefined }) {
  try {
    assertBuiltCatalogExecution();
    const p = validateThemeCatalogCandidate(input);
    if (computeExecutableIdentityDigestCatalog() !== p.producer.executableDigest) throw new Error("EXECUTABLE_IDENTITY_MISMATCH");
    const result = generateThemePackageCatalog({ themeSpec: p.theme, metadata: p.metadata, accent: p.selectedAccent, fontResources: options?.fontResources });
    if (`sha256:${result.themeInputDigest}` !== p.inputDigest || `sha256:${result.cssOutputDigest}` !== p.outputDigest || canonical(inventory(result.files)) !== canonical(p.outputInventory)) throw new Error("CATALOG_OUTPUT_MISMATCH");
    return { valid: true, candidateDigest: p.candidateDigest, inputDigest: p.inputDigest, outputDigest: p.outputDigest, diagnostics: result.diagnostics, errors: [] as string[], warnings: [] as string[] };
  } catch (error) {
    return { valid: false, candidateDigest: "", inputDigest: "", outputDigest: "", diagnostics: [], errors: [(error as Error).message], warnings: [] as string[] };
  }
}
export function verifyThemeCandidateCompatible(input: unknown, options?: { fontResources?: ReadonlyMap<string, Uint8Array> | undefined; strictContrast?: boolean | undefined }) {
  try {
    assertSafePreSerialization(input, 16 * 1024 * 1024);
    const p = input as any;
    if (p?.schema === "tfsl.theme-catalog-candidate" || p?.semanticCompiler === CATALOG_COMPILER_SEMANTIC || p?.catalog === CATALOG_IDENTITY || (p?.theme && Object.hasOwn(p.theme, "catalog"))) return verifyThemeCatalogCandidate(input, options);
    return verifyHistorical(input, options);
  } catch (error) { return { valid: false, diagnostics: [], errors: [(error as Error).message], warnings: [] }; }
}
