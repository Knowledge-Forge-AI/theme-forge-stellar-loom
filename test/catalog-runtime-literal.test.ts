import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const allocated: string[] = [];
afterEach(() => { for (const dir of allocated.splice(0)) rmSync(dir, {recursive:true, force:true}); });
function packed() {
  const dir = mkdtempSync(join(tmpdir(), "tfsl-runtime-literal-")); allocated.push(dir);
  const result = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", dir], {cwd:root, encoding:"utf8"}));
  execFileSync("tar", ["-xzf", join(dir,result[0].filename), "-C", dir]);
  cpSync(join(root,"examples/loom-black-catalog.json"),join(dir,"package/input.json"));
  return join(dir,"package");
}
const probe = `import {readFileSync} from 'node:fs';
import {generateThemePackageCatalog} from './dist/catalog/index.js';
const input=JSON.parse(readFileSync('input.json','utf8'));
generateThemePackageCatalog({themeSpec:input,metadata:{name:'starlight-theme-probe',version:'1.0.0'}});`;
describe("non-circular packed catalog runtime guard", () => {
  it("recomputes the same fixed executable identity from source qualification and the packed artifact", () => {
    const dir=packed();
    const script=`import {computeExecutableIdentityDigestCatalog} from './dist/design-exchange-catalog/executable.js'; process.stdout.write(computeExecutableIdentityDigestCatalog());`;
    const options=["--input-type=module","-e",script];
    expect(execFileSync(process.execPath,options,{cwd:dir,encoding:"utf8"})).toBe(execFileSync(process.execPath,options,{cwd:root,encoding:"utf8"}));
  });
  it("keeps historical packets parseable and rejects them against changed executable bytes", () => {
    const dir=packed();
    cpSync(join(root,"test/fixtures/catalog-dogfood-baseline/manifest.json"),join(dir,"baseline.json"));
    const script=`import {readFileSync} from 'node:fs';
import {validateThemeCatalogCandidate,verifyThemeCatalogCandidate} from './dist/design-exchange-catalog/index.js';
for(const record of JSON.parse(readFileSync('baseline.json','utf8')).records){
 validateThemeCatalogCandidate(record.packet);
 const result=verifyThemeCatalogCandidate(record.packet);
 if(result.valid||!result.errors.includes('EXECUTABLE_IDENTITY_MISMATCH')) throw Error(JSON.stringify(result));
}`;
    expect(() => execFileSync(process.execPath,["--input-type=module","-e",script],{cwd:dir,stdio:"pipe"})).not.toThrow();
  });
  it("does not invoke locale collation for runtime projection", () => {
    const dir=packed();
    const script=`String.prototype.localeCompare=()=>{throw Error('LOCALE_COLLATION');};
const {verifyCatalogDigest}=await import('./dist/catalog/catalog.js');
if(!verifyCatalogDigest()) throw Error('RUNTIME_LITERAL_MISMATCH');`;
    expect(() => execFileSync(process.execPath,["--input-type=module","-e",script],{cwd:dir,stdio:"pipe"})).not.toThrow();
  });
  it("rejects a changed catalog expression without a literal update in a fresh process", () => {
    const dir=packed();
    expect(() => execFileSync(process.execPath,["--input-type=module","-e",probe],{cwd:dir,stdio:"pipe"})).not.toThrow();
    const path=join(dir,"dist/catalog/catalog.js");
    const original=readFileSync(path,"utf8");
    const changed=original.replace("maxRoutes: 32", "maxRoutes: 31");
    expect(changed).not.toBe(original); writeFileSync(path,changed);
    expect(() => execFileSync(process.execPath,["--input-type=module","-e",probe],{cwd:dir,stdio:"pipe"})).toThrow(/Catalog expression digest mismatch/);
  });
});
