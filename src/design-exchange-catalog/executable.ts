import { createHash } from "node:crypto";
import { readFileSync, readdirSync, lstatSync, existsSync, openSync, fstatSync, closeSync, constants } from "node:fs";
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
export function readMember(root: string, path: string): Buffer {
  if (!/^[A-Za-z0-9_./-]+$/.test(path) || path.startsWith("/") || path.split("/").some(x => !x || x === "." || x === "..")) fail("INVALID_EXECUTABLE_MEMBER");
  const rootPath = resolve(root);
  let rootStat;
  try {
    rootStat = lstatSync(rootPath);
  } catch {
    fail("INVALID_EXECUTABLE_ROOT");
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("INVALID_EXECUTABLE_ROOT");
  const directories = [{ path: rootPath, stat: rootStat }];
  const parts = path.split("/");
  let current = rootPath;
  for (let i = 0; i < parts.length - 1; i++) {
    current = join(current, parts[i]!);
    let st;
    try {
      st = lstatSync(current);
    } catch {
      fail("INVALID_EXECUTABLE_MEMBER");
    }
    if (st.isSymbolicLink()) fail("SYMLINK_EXECUTABLE_MEMBER");
    if (!st.isDirectory()) fail("INVALID_EXECUTABLE_MEMBER");
    directories.push({ path: current, stat: st });
  }
  const leafPath = join(current, parts[parts.length - 1]!);
  if (typeof constants.O_NOFOLLOW !== "number" || typeof constants.O_NONBLOCK !== "number") fail("UNSUPPORTED_SECURE_FILESYSTEM");
  let fd: number;
  try {
    fd = openSync(leafPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  } catch (err: any) {
    if (err?.code === "ELOOP" || err?.code === "SYMLINK" || err?.code === "EMLINK") {
      fail("SYMLINK_EXECUTABLE_MEMBER");
    }
    fail("INVALID_EXECUTABLE_MEMBER");
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) fail("INVALID_EXECUTABLE_MEMBER");
    // O_NOFOLLOW protects the leaf. Recheck the ancestor identities separately;
    // a leaf descriptor alone does not establish directory confinement.
    const verifyPaths = () => {
      for (const directory of directories) {
        const now = lstatSync(directory.path);
        if (!now.isDirectory() || now.isSymbolicLink() || now.dev !== directory.stat.dev || now.ino !== directory.stat.ino) fail("INVALID_EXECUTABLE_ROOT");
      }
      const leaf = lstatSync(leafPath);
      if (!leaf.isFile() || leaf.isSymbolicLink() || leaf.dev !== st.dev || leaf.ino !== st.ino) fail("INVALID_EXECUTABLE_MEMBER");
    };
    verifyPaths();
    if (st.size === 0) fail("EMPTY_EXECUTABLE_MEMBER");
    const bytes = readFileSync(fd);
    if (!bytes.length) fail("EMPTY_EXECUTABLE_MEMBER");
    const after = fstatSync(fd);
    if (after.size !== st.size || after.mtimeMs !== st.mtimeMs || after.ctimeMs !== st.ctimeMs || bytes.length !== st.size) fail("INVALID_EXECUTABLE_MEMBER");
    verifyPaths();
    return bytes;
  } finally {
    closeSync(fd);
  }
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
