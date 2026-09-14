import { afterEach, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { computeExecutableIdentityDigestCatalog, assertBuiltCatalogExecution } from "../src/design-exchange-catalog/executable.js";

const root = resolve(import.meta.dirname, "..");
const allocated: string[] = [];
function installed() {
  const dir = mkdtempSync(join(tmpdir(), "tfsl-catalog-executable-")); allocated.push(dir);
  for (const member of ["dist", "bin", "package.json"]) cpSync(join(root, member), join(dir, member), { recursive: true });
  return dir;
}
function mutate(dir: string, member: string) { writeFileSync(join(dir, member), readFileSync(join(dir, member), "utf8") + "\n// mutation\n"); }
afterEach(() => { for (const dir of allocated.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe("catalog built executable evidence", () => {
  it("requires a fresh build and has the identical source/installed identity", () => {
    expect(computeExecutableIdentityDigestCatalog(root)).toBe(computeExecutableIdentityDigestCatalog(installed()));
    expect(() => assertBuiltCatalogExecution()).toThrow("BUILT_CATALOG_EXECUTION_REQUIRED");
  });
  it.each(["dist/catalog/compiler.js", "dist/catalog/templates/hero.js", "bin/tfsl.js"])("rejects changed output-determining member %s", member => {
    const dir = installed(); mutate(dir, member);
    expect(() => computeExecutableIdentityDigestCatalog(dir)).toThrow("EXECUTABLE_IDENTITY_MISMATCH");
  });
  it("rejects missing and unexpected executables and missing evidence", () => {
    let dir = installed(); unlinkSync(join(dir, "dist/catalog/compiler.js"));
    expect(() => computeExecutableIdentityDigestCatalog(dir)).toThrow("EXECUTABLE_INVENTORY_MISMATCH");
    dir = installed(); writeFileSync(join(dir, "dist/unexpected.mjs"), "export default 1;");
    expect(() => computeExecutableIdentityDigestCatalog(dir)).toThrow("EXECUTABLE_INVENTORY_MISMATCH");
    dir = installed(); unlinkSync(join(dir, "dist/catalog-build-evidence.json"));
    expect(() => computeExecutableIdentityDigestCatalog(dir)).toThrow();
  });
  it("rejects stale source and malformed installed source inventory", () => {
    const dir = installed();
    for (const member of ["src", "tools", "tsconfig.json", "tsconfig.build.json"]) cpSync(join(root, member), join(dir, member), { recursive: true });
    mutate(dir, "src/catalog/compiler.ts");
    expect(() => computeExecutableIdentityDigestCatalog(dir)).toThrow("STALE_CATALOG_BUILD");
    const clean = installed(); const manifest = JSON.parse(readFileSync(join(clean, "dist/catalog-build-evidence.json"), "utf8"));
    manifest.sources[0].sha256 = "not-a-digest";
    writeFileSync(join(clean, "dist/catalog-build-evidence.json"), JSON.stringify(manifest));
    expect(() => computeExecutableIdentityDigestCatalog(clean)).toThrow("MALFORMED_BUILD_EVIDENCE");
  });
  it("excludes package version but binds entry-point routing", () => {
    const dir = installed(); const before = computeExecutableIdentityDigestCatalog(dir);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")); pkg.version = "9.9.9";
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
    expect(computeExecutableIdentityDigestCatalog(dir)).toBe(before);
    pkg.exports["."].import = "./dist/index.js"; writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
    expect(computeExecutableIdentityDigestCatalog(dir)).not.toBe(before);
  });
  it("recomputes identity when verifying installed candidates and rejects mixed historical tuples", () => {
    const dir = installed(); cpSync(join(root, "examples/loom-black-catalog.json"), join(dir, "input.json"));
    const script = `
      import { readFileSync, writeFileSync } from 'node:fs';
      import { createThemeCatalogCandidate, verifyThemeCatalogCandidate, verifyThemeCandidateCompatible } from './dist/design-exchange-catalog/index.js';
      const theme=JSON.parse(readFileSync('input.json','utf8'));
      const packet=createThemeCatalogCandidate(theme,{metadata:{name:'@fixture/catalog',version:'1.0.0'}});
      if(!verifyThemeCatalogCandidate(packet).valid) throw new Error('valid packet failed');
      if(verifyThemeCandidateCompatible({...packet,semanticCompiler:'tfsl.theme-compiler-v2-core-1'}).valid) throw new Error('mixed tuple passed');
      const pkg=JSON.parse(readFileSync('package.json','utf8')); pkg.exports['.'].import='./dist/index.js'; writeFileSync('package.json',JSON.stringify(pkg));
      const result=verifyThemeCatalogCandidate(packet);
      if(result.valid || !result.errors.includes('EXECUTABLE_IDENTITY_MISMATCH')) throw new Error(JSON.stringify(result));
    `;
    expect(() => execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: dir, stdio: "pipe" })).not.toThrow();
  });
});
