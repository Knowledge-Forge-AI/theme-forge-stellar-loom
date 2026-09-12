import { createHash } from "node:crypto";
import { readFileSync, readdirSync, lstatSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REQUIRED_EXECUTABLE_MEMBERS } from "./executable-members.js";
import { CATALOG_COMPILER_SEMANTIC, CATALOG_IDENTITY, CATALOG_DIGEST } from "../catalog/index.js";

export const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const order = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
export const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export function canonical(value: unknown): string {
  const sort = (v: any): any => Array.isArray(v) ? v.map(sort) : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v).sort(order).map(k => [k, sort(v[k])])) : v;
  return JSON.stringify(sort(value));
}
function fail(code: string): never { throw new Error(code); }
function readMember(root: string, path: string): Buffer {
  if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.startsWith("/") || path.split("/").some(x => !x || x === "." || x === "..")) fail("INVALID_EXECUTABLE_MEMBER");
  let current = resolve(root);
  if (!lstatSync(current).isDirectory() || lstatSync(current).isSymbolicLink()) fail("INVALID_EXECUTABLE_ROOT");
  for (const part of path.split("/")) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) fail("SYMLINK_EXECUTABLE_MEMBER");
  }
  if (!lstatSync(current).isFile()) fail("INVALID_EXECUTABLE_MEMBER");
  const bytes = readFileSync(current);
  if (!bytes.length) fail("EMPTY_EXECUTABLE_MEMBER");
  return bytes;
}
function jsInventory(root: string, directory: string): string[] {
  const paths: string[] = [];
  for (const item of readdirSync(join(root, directory), { withFileTypes: true })) {
    if (item.isSymbolicLink() || (!item.isDirectory() && !item.isFile())) fail("INVALID_EXECUTABLE_MEMBER");
    const path = `${directory}/${item.name}`;
    if (item.isDirectory()) paths.push(...jsInventory(root, path));
    else if (/\.(?:js|mjs|cjs)$/.test(path)) paths.push(path);
  }
  return paths.sort(order);
}
export function assertBuiltCatalogExecution(): void {
  if (!fileURLToPath(import.meta.url).endsWith("/dist/design-exchange-catalog/executable.js")) fail("BUILT_CATALOG_EXECUTION_REQUIRED");
}
export function computeExecutableIdentityDigestCatalog(root = packageRoot): string {
  const expected = [...REQUIRED_EXECUTABLE_MEMBERS].sort(order);
  const actual = [...jsInventory(root, "dist"), ...jsInventory(root, "bin")].sort(order);
  if (canonical(expected) !== canonical(actual)) fail("EXECUTABLE_INVENTORY_MISMATCH");
  const manifestBytes = readMember(root, "dist/catalog-build-evidence.json");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (canonical(Object.keys(manifest).sort()) !== canonical(["members", "schema", "sources"]) || manifest.schema !== "tfsl.catalog-build-evidence-v1" || !Array.isArray(manifest.members) || !Array.isArray(manifest.sources)) fail("MALFORMED_BUILD_EVIDENCE");
  if (canonical(manifest.members.map((m: any) => m.path)) !== canonical(expected)) fail("EXECUTABLE_INVENTORY_MISMATCH");
  const check = (records: any[], source: boolean, readBytes = true) => {
    let previous = "";
    for (const record of records) {
      if (!record || typeof record !== "object" || canonical(Object.keys(record).sort()) !== canonical(["bytes", "path", "sha256"]) || typeof record.path !== "string" || order(previous, record.path) >= 0 || typeof record.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(record.sha256) || !Number.isSafeInteger(record.bytes) || record.bytes <= 0) fail("MALFORMED_BUILD_EVIDENCE");
      previous = record.path;
      if (!readBytes) continue;
      const bytes = readMember(root, record.path);
      if (bytes.length !== record.bytes || hash(bytes) !== record.sha256) fail(source ? "STALE_CATALOG_BUILD" : "EXECUTABLE_IDENTITY_MISMATCH");
    }
  };
  check(manifest.members, false);
  // Only an additional source freshness assertion varies by installation shape.
  // The identity always hashes exactly the same built bytes and manifest.
  const sources = expected.filter(p => p.startsWith("dist/")).map(p => p.replace(/^dist\//, "src/").replace(/\.js$/, ".ts"));
  sources.push("tools/build-catalog-evidence.mjs", "tsconfig.build.json", "tsconfig.json");
  check(manifest.sources, true, false);
  if (canonical(manifest.sources.map((m: any) => m.path)) !== canonical(sources.sort(order))) fail("SOURCE_INVENTORY_MISMATCH");
  if (existsSync(join(root, "src"))) check(manifest.sources, true);
  const pkg = JSON.parse(readMember(root, "package.json").toString("utf8"));
  if (!pkg.exports || !pkg.bin || pkg.type !== "module") fail("MALFORMED_ENTRY_PROJECTION");
  const identity = {
    schema: "tfsl.catalog-executable-identity-v1", semantic: CATALOG_COMPILER_SEMANTIC,
    catalog: CATALOG_IDENTITY, catalogDigest: CATALOG_DIGEST,
    entries: { exports: pkg.exports, bin: pkg.bin, type: pkg.type },
    buildEvidence: hash(manifestBytes),
    members: expected.map(path => ({ path, sha256: hash(readMember(root, path)) })),
  };
  return `sha256:${hash(canonical(identity))}`;
}
