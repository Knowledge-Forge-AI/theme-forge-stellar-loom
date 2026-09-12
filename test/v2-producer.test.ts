import { it, expect } from "vitest";
import { cp, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createThemeCandidateV2, verifyThemeCandidateV2 } from "../src/design-exchange-v2/index.js";
import { compileThemeV2 } from "../src/v2/index.js";

it("an actual producer package patch preserves semantic compatibility and changes provenance", async () => {
  const root = resolve(import.meta.dirname, "..");
  const dir = await mkdtemp(join(tmpdir(), "loom-producer-patch-"));
  try {
    await cp(join(root, "dist"), join(dir, "dist"), { recursive: true });
    await cp(join(root, "bin"), join(dir, "bin"), { recursive: true });
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    pkg.version = "0.1.2";
    await writeFile(join(dir, "package.json"), JSON.stringify(pkg));
    const theme = JSON.parse(await readFile(join(root, "examples/loom-black-core.theme.json"), "utf8"));
    const original = createThemeCandidateV2(theme);
    await writeFile(join(dir, "theme.json"), JSON.stringify(theme));
    await writeFile(join(dir, "original.json"), JSON.stringify(original));
    const probe = `import {readFileSync} from 'node:fs';
      import {compileThemeV2,createThemeCandidateV2,verifyThemeCandidateV2} from './dist/index.js';
      const theme=JSON.parse(readFileSync('theme.json','utf8'));
      const compiled=compileThemeV2(theme);
      console.log(JSON.stringify({outputDigest:compiled.outputDigest,version:compiled.descriptor.provenance.compilerVersion,candidate:createThemeCandidateV2(theme),verification:verifyThemeCandidateV2(JSON.parse(readFileSync('original.json','utf8'))).valid}));`;
    const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", probe], { cwd: dir, encoding: "utf8" }));
    expect(result.version).toBe("0.1.2");
    expect(result.outputDigest).toBe(compileThemeV2(theme).outputDigest);
    expect(result.candidate.producer.packageDigest).not.toBe(original.producer.packageDigest);
    expect(result.candidate.producer.version).toBe("0.1.2");
    expect(result.verification).toBe(true);
    expect(verifyThemeCandidateV2(result.candidate).valid).toBe(true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
