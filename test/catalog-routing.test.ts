import { it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { processBatchRequest } from "../src/batch-catalog.js";
const root=resolve(import.meta.dirname,"..");
const theme=()=>JSON.parse(readFileSync(resolve(root,"examples/loom-black-catalog.json"),"utf8"));
it("preserves exact historical CLI diagnostics and exit status through the wrapper",()=>{
  for(const input of ["examples/stellar-cyan.theme.json","examples/loom-black-core.theme.json","examples/loom-black-code.theme.json"]){
    const argv=["node","tfsl","validate",input,"--json"];
    const run=(entry:string)=>spawnSync(process.execPath,["--input-type=module","-e",`import {runCli} from './dist/${entry}.js';process.exitCode=await runCli(${JSON.stringify(argv)});`],{cwd:root,encoding:"utf8"});
    const before=run("cli"),after=run("cli-catalog");
    expect({status:after.status,stdout:after.stdout,stderr:after.stderr}).toEqual({status:before.status,stdout:before.stdout,stderr:before.stderr});
  }
});
it("routes built CLI and library runCli identically for catalog validation",()=>{
  const args=["validate","examples/loom-black-catalog.json","--json"];
  const bin=execFileSync(process.execPath,["bin/tfsl.js",...args],{cwd:root,encoding:"utf8"});
  const api=execFileSync(process.execPath,["--input-type=module","-e",`import {runCli} from './dist/index-catalog.js';process.exitCode=await runCli(${JSON.stringify(["node","tfsl",...args])});`],{cwd:root,encoding:"utf8"});
  expect(api).toBe(bin);expect(JSON.parse(bin).status).toBe("success");
});
it("reads catalog batch stdin once and rejects duplicate JSON keys",()=>{
  const request={action:"compile" as const,specification:theme()};
  expect(processBatchRequest(request).status).toBe("success");
  const result=execFileSync(process.execPath,["bin/tfsl-batch.js"],{cwd:root,input:JSON.stringify(request),encoding:"utf8"});
  expect(JSON.parse(result).descriptor.compilerSemantic).toBe("tfsl.theme-compiler-v2-catalog-1");
  const duplicate=JSON.stringify(request).replace('"catalog":','"catalog":{},"catalog":');
  const rejected=spawnSync(process.execPath,["bin/tfsl-batch.js"],{cwd:root,input:duplicate,encoding:"utf8"});
  expect(rejected.status).toBe(1);expect(JSON.parse(rejected.stdout).status).toBe("error");
});
it("fails closed on malformed catalog input instead of historical lowering",()=>{
  const malformed=theme();malformed.catalog.callback="forbidden";
  expect(processBatchRequest({action:"compile",specification:malformed}).status).toBe("error");
});
