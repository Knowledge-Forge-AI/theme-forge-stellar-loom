import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { CATALOG_SOURCE_PINS, CATALOG_ENTRYPOINTS } from "../src/catalog/qualification.js";
import { CATALOG_DIGEST, CATALOG_IDENTITY, CATALOG_COMPILER_SEMANTIC } from "../src/catalog/index.js";
const root=resolve(import.meta.dirname,"..");
describe("catalog successor qualification",()=>{
  it("binds the literal successor identity",()=>{
    expect({semantic:CATALOG_COMPILER_SEMANTIC,catalog:CATALOG_IDENTITY,digest:CATALOG_DIGEST}).toEqual(JSON.parse(readFileSync(resolve(root,"test/fixtures/catalog-identity.json"),"utf8")));
  });
  it("retains historical pins and independently qualifies every current source including the literal carrier",()=>{
    const qualification=JSON.parse(readFileSync(resolve(root,"protocol/catalog-source-qualification.json"),"utf8"));
    expect(qualification.schema).toBe("tfsl.catalog-repository-source-qualification-v1");
    expect(createHash("sha256").update(JSON.stringify(CATALOG_SOURCE_PINS)).digest("hex")).toBe(qualification.historicalPinsDigest);
    const sources=readdirSync(resolve(root,"src"),{recursive:true}).map(String).filter(p=>p.endsWith(".ts")&&!p.endsWith(".d.ts")).map(p=>"src/"+p);
    expect(qualification.sources.map((p:{path:string})=>p.path).filter((p:string)=>p.startsWith("src/"))).toEqual(sources.sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b))));
    for(const pin of qualification.sources) expect(createHash("sha256").update(readFileSync(resolve(root,pin.path))).digest("hex"),pin.path).toBe(pin.sha256);
    const pkg=JSON.parse(readFileSync(resolve(root,"package.json"),"utf8"));
    expect({exports:pkg.exports,bin:pkg.bin,type:pkg.type}).toEqual(CATALOG_ENTRYPOINTS);
  });
});
