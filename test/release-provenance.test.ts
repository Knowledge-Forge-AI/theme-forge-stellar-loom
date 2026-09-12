import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { compileTheme, STELLAR_CYAN_EXAMPLE } from "../src/index.js";
import { generateThemePackageCatalog } from "../src/catalog/index.js";

const root = new URL("../", import.meta.url);
const metadata = { name: "starlight-theme-release-probe", version: "0.2.0" };

describe("0.2.0 release producer provenance", () => {
  it("reports the current release producer for Theme v1 while preserving its CSS", () => {
    const compiled = compileTheme(STELLAR_CYAN_EXAMPLE, {cssFile:"styles/theme.css"});
    expect(compiled.descriptor.provenance.compilerVersion).toBe("0.2.0");
    expect(compiled.css).toBe(readFileSync(new URL("test/fixtures/v1-baseline/stellar-cyan/theme.css", root), "utf8"));
  });
  it("binds current producer metadata and verifies a fresh packet without rewriting history", () => {
    const version = JSON.parse(readFileSync(new URL("package.json", root), "utf8")).version;
    expect(version).toBe("0.2.0");
    const baseline = JSON.parse(readFileSync(new URL("test/fixtures/catalog-dogfood-baseline/manifest.json", root), "utf8"));
    const record = baseline.records.find((entry: { name: string }) => entry.name === "flexoki");
    const first = generateThemePackageCatalog({ themeSpec: record.spec, metadata, accent: record.accent });
    const second = generateThemePackageCatalog({ themeSpec: record.spec, metadata, accent: record.accent });
    expect(first.files).toEqual(second.files);
    expect(first.descriptor.provenance.compilerVersion).toBe(version);
    const probe = `
      import {readFileSync} from 'node:fs';
      import {createThemeCatalogCandidate,verifyThemeCatalogCandidate} from './dist/design-exchange-catalog/index.js';
      const data=JSON.parse(readFileSync('test/fixtures/catalog-dogfood-baseline/manifest.json','utf8'));
      const record=data.records.find(x=>x.name==='flexoki');
      const packet=createThemeCatalogCandidate(record.spec,{metadata:{name:'starlight-theme-release-probe',version:'0.2.0'},accent:record.accent});
      if(!verifyThemeCatalogCandidate(packet).valid)throw new Error('fresh packet rejected');
      process.stdout.write('verified');
    `;
    expect(execFileSync(process.execPath, ["--input-type=module", "-e", probe], { cwd: root, encoding: "utf8" })).toBe("verified");
  });
});
