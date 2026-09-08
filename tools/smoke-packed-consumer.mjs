import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const TFSL_DIR = resolve(import.meta.dirname, "..");
const EXAMPLE_CYAN = join(TFSL_DIR, "examples/stellar-cyan.theme.json");

function sha256(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return null;
}

let packDir = null;
let isExternalTarball = false;
let isExternalWorkDir = false;

async function run() {
  console.log("=== TFSL Packed Consumer Smoke Test ===");

  const packedTfslArg = getArg("--packed-tfsl") || getArg("--packed-cli");
  const workDirArg = getArg("--work-dir");

  let tarballPath;
  isExternalTarball = Boolean(packedTfslArg);
  isExternalWorkDir = Boolean(workDirArg);

  if (isExternalTarball) {
    tarballPath = resolve(packedTfslArg);
    if (!existsSync(tarballPath)) {
      throw new Error(`Specified packed tarball does not exist: ${tarballPath}`);
    }
    console.log(`1. Using external packed tarball: ${tarballPath}`);
  } else {
    packDir = workDirArg
      ? join(resolve(workDirArg), "pack")
      : await mkdtemp(join(tmpdir(), "tfsl-pack-"));
    await mkdir(packDir, { recursive: true });

    console.log(`1. Packing tarball from packages/stellar-loom into ${packDir}...`);
    const packOutput = execFileSync("npm", ["pack", "--json", "--pack-destination", packDir], {
      cwd: TFSL_DIR,
      encoding: "utf8",
    });
    const packInfo = JSON.parse(packOutput);
    const tarballName = packInfo[0].filename;
    tarballPath = join(packDir, tarballName);
    console.log(`   Packed tarball: ${tarballName}`);
  }

  const consumerDir = workDirArg
    ? join(resolve(workDirArg), "consumer")
    : await mkdtemp(join(tmpdir(), "tfsl-consumer-"));
  if (isExternalWorkDir) {
    await mkdir(resolve(workDirArg), { recursive: true });
    await mkdir(consumerDir);
  }
  console.log(`2. Created isolated consumer directory: ${consumerDir}`);

  try {
    // Initialize consumer project
    console.log("3. Initializing disposable package and installing tarball...");
    execFileSync("npm", ["init", "-y"], { cwd: consumerDir, stdio: "ignore" });

    // Ensure consumer uses ESM
    const consumerPkgJsonPath = join(consumerDir, "package.json");
    const consumerPkg = JSON.parse(await readFile(consumerPkgJsonPath, "utf8"));
    consumerPkg.type = "module";
    await writeFile(consumerPkgJsonPath, JSON.stringify(consumerPkg, null, 2), "utf8");

    execFileSync("npm", ["install", "--ignore-scripts", tarballPath], {
      cwd: consumerDir,
      stdio: "ignore",
    });

    const tfslBin = join(consumerDir, "node_modules/.bin/tfsl");

    // Test 1: CLI Version and Help
    console.log("4. Testing CLI binary --version and --help...");
    const versionOutput = execFileSync(process.execPath, [tfslBin, "--version"], {
      cwd: consumerDir,
      encoding: "utf8",
    }).trim();
    if (!versionOutput.includes("0.1.0")) {
      throw new Error(`Unexpected CLI version: '${versionOutput}', expected to contain '0.1.0'`);
    }
    console.log(`   CLI version verified: ${versionOutput}`);

    const helpOutput = execFileSync(process.execPath, [tfslBin, "--help"], {
      cwd: consumerDir,
      encoding: "utf8",
    });
    if (!helpOutput.includes("Usage:") || !helpOutput.includes("tfsl compile")) {
      throw new Error("CLI --help did not contain expected usage statement");
    }
    console.log("   CLI help output verified");

    // Test 2: CLI Validate Command
    console.log("5. Testing CLI validate command...");
    const validateOutput = execFileSync(process.execPath, [tfslBin, "validate", EXAMPLE_CYAN], {
      cwd: consumerDir,
      encoding: "utf8",
    });
    if (!validateOutput.includes("is valid")) {
      throw new Error(`CLI validate failed: ${validateOutput}`);
    }

    const validateJsonOutput = execFileSync(process.execPath, [tfslBin, "validate", EXAMPLE_CYAN, "--json"], {
      cwd: consumerDir,
      encoding: "utf8",
    });
    const parsedValidate = JSON.parse(validateJsonOutput);
    if (parsedValidate.status !== "success" || parsedValidate.theme !== "stellar-cyan") {
      throw new Error(`CLI validate --json unexpected output: ${validateJsonOutput}`);
    }
    console.log("   CLI validate human and JSON modes verified");

    // Test 3: CLI Compile Command & Diagnostics
    console.log("6. Testing CLI compile command and contrast diagnostics...");
    const outDir = join(consumerDir, "out");
    const compileJsonOutput = execFileSync(process.execPath, [tfslBin, "compile", EXAMPLE_CYAN, "--out", outDir, "--json"], {
      cwd: consumerDir,
      encoding: "utf8",
    });
    const compileResult = JSON.parse(compileJsonOutput);
    if (compileResult.status !== "success") {
      throw new Error("CLI compile --json returned non-success status");
    }
    if (compileResult.theme !== "stellar-cyan") {
      throw new Error(`Unexpected theme name: ${compileResult.theme}`);
    }
    if (!Array.isArray(compileResult.diagnostics) || compileResult.diagnostics.length !== 6) {
      throw new Error(`Expected 6 contrast diagnostics, got ${compileResult.diagnostics?.length}`);
    }

    const cssContent = await readFile(join(outDir, "theme.css"), "utf8");
    const descriptorContent = JSON.parse(await readFile(join(outDir, "theme.descriptor.json"), "utf8"));

    const calculatedSha = sha256(cssContent);
    if (calculatedSha !== descriptorContent.outputDigest) {
      throw new Error(`Descriptor SHA-256 mismatch: calculated ${calculatedSha} vs recorded ${descriptorContent.outputDigest}`);
    }
    if (descriptorContent.provenance.compilerVersion !== "0.1.0") {
      throw new Error(`Descriptor compilerVersion mismatch: ${descriptorContent.provenance.compilerVersion}`);
    }
    console.log(`   CLI compile output and diagnostics verified (CSS SHA-256: ${calculatedSha.slice(0, 16)}...)`);

    // Test 4: CLI Generate Command
    console.log("7. Testing CLI generate command...");
    const genPkgMetaPath = join(consumerDir, "test-pkg-meta.json");
    await writeFile(
      genPkgMetaPath,
      JSON.stringify({
        name: "starlight-theme-smoke-cyan",
        version: "0.1.0",
        description: "Smoke test generated Starlight theme package",
        author: "Smoke Test Runner",
      }, null, 2),
      "utf8"
    );
    const genOutDir = join(consumerDir, "gen-theme-pkg");
    const genJsonOutput = execFileSync(process.execPath, [
      tfslBin,
      "generate",
      EXAMPLE_CYAN,
      "--package",
      genPkgMetaPath,
      "--out",
      genOutDir,
      "--json",
    ], {
      cwd: consumerDir,
      encoding: "utf8",
    });
    const parsedGen = JSON.parse(genJsonOutput);
    if (parsedGen.status !== "success" || !Array.isArray(parsedGen.filesWritten) || parsedGen.filesWritten.length < 10) {
      throw new Error(`CLI generate unexpected output: ${genJsonOutput}`);
    }
    const genPkgJson = JSON.parse(await readFile(join(genOutDir, "package.json"), "utf8"));
    if (genPkgJson.private !== true) {
      throw new Error("Generated package must be private: true");
    }
    const genProvenance = JSON.parse(await readFile(join(genOutDir, "provenance.json"), "utf8"));
    if (genProvenance.generatorVersion !== "0.1.0") {
      throw new Error(`Generated package provenance generatorVersion mismatch: ${genProvenance.generatorVersion}`);
    }
    console.log(`   CLI generate output verified (${parsedGen.filesWritten.length} files, private: true, generatorVersion: 0.1.0)`);

    // Test 5: Safety - Refuse overwrite if file was modified
    console.log("8. Testing CLI safety against dirty overwrite...");
    await writeFile(join(outDir, "theme.css"), "/* manually corrupted css */\n", "utf8");
    try {
      execFileSync(process.execPath, [tfslBin, "compile", EXAMPLE_CYAN, "--out", outDir, "--overwrite"], {
        cwd: consumerDir,
        stdio: "pipe",
      });
      throw new Error("CLI compile should have refused overwrite of modified theme.css");
    } catch (err) {
      if (err.status !== 3) {
        throw new Error(`Expected exit code 3 (ERROR_COLLISION_OR_DIRTY) on dirty overwrite, got ${err.status}`);
      }
    }
    console.log("   CLI safety against dirty overwrite verified (exit code 3)");

    // Test 5: Library ESM Import and API
    console.log("9. Testing library ESM imports, API functions, and generateThemePackage...");
    const esmTestScript = `
      import {
        compileTheme,
        validateTheme,
        validateThemeSpecification,
        calculateContrastRatio,
        analyzeThemeContrast,
        generateThemePackage,
        ValidationError,
        ContrastError,
        COMPILER_VERSION,
        runBatch,
        processBatchRequest,
        STELLAR_CYAN_EXAMPLE,
        AMBER_FORGE_EXAMPLE,
      } from "@knowledge-forge-ai/theme-forge-stellar-loom";
      import { readFileSync } from "node:fs";
      import { processBatchRequest as publicBatch } from "@knowledge-forge-ai/theme-forge-stellar-loom/batch";
      import { runCli as publicCli } from "@knowledge-forge-ai/theme-forge-stellar-loom/cli";
      if (publicBatch !== processBatchRequest || typeof publicCli !== "function") throw new Error("Public subpath exports failed");

      if (typeof compileTheme !== "function") throw new Error("compileTheme is not a function");
      if (typeof validateTheme !== "function") throw new Error("validateTheme is not a function");
      if (typeof calculateContrastRatio !== "function") throw new Error("calculateContrastRatio is not a function");
      if (typeof analyzeThemeContrast !== "function") throw new Error("analyzeThemeContrast is not a function");
      if (typeof generateThemePackage !== "function") throw new Error("generateThemePackage is not a function");
      if (typeof runBatch !== "function") throw new Error("runBatch is not a function");
      if (typeof processBatchRequest !== "function") throw new Error("processBatchRequest is not a function");
      if (!STELLAR_CYAN_EXAMPLE || STELLAR_CYAN_EXAMPLE.name !== "stellar-cyan") throw new Error("STELLAR_CYAN_EXAMPLE invalid");
      if (!AMBER_FORGE_EXAMPLE || AMBER_FORGE_EXAMPLE.name !== "amber-forge") throw new Error("AMBER_FORGE_EXAMPLE invalid");
      if (COMPILER_VERSION !== "0.1.0") throw new Error("Unexpected COMPILER_VERSION: " + COMPILER_VERSION);

      const spec = JSON.parse(readFileSync(${JSON.stringify(EXAMPLE_CYAN)}, "utf8"));
      const validated = validateTheme(spec);
      if (validated.name !== "stellar-cyan") throw new Error("Theme failed validation in library import");

      const compiled = compileTheme(spec);
      if (!compiled.css || !compiled.descriptor) throw new Error("Compiled theme missing css or descriptor");
      if (!Array.isArray(compiled.diagnostics)) throw new Error("Compiled theme missing diagnostics array");
      if (compiled.diagnostics.length !== 6) throw new Error("Expected 6 contrast diagnostics, got " + compiled.diagnostics.length);

      const generated = generateThemePackage({
        themeSpec: spec,
        metadata: {
          name: "starlight-theme-library-test",
          version: "0.1.0",
        },
      });
      if (!generated.files.has("package.json") || !generated.files.has("provenance.json")) {
        throw new Error("generateThemePackage failed to emit package files");
      }

      const batchResp = processBatchRequest({ action: "example", exampleName: "stellar-cyan" });
      if (batchResp.status !== "success" || !batchResp.valid || !batchResp.compiledCss) {
        throw new Error("processBatchRequest failed in consumer");
      }

      console.log("ESM_LIBRARY_OK");
    `;
    const esmScriptPath = join(consumerDir, "test-import.js");
    await writeFile(esmScriptPath, esmTestScript, "utf8");

    const esmResult = execFileSync(process.execPath, [esmScriptPath], {
      cwd: consumerDir,
      encoding: "utf8",
    });
    if (!esmResult.includes("ESM_LIBRARY_OK")) {
      throw new Error(`ESM import test failed: ${esmResult}`);
    }
    console.log("   Library ESM exports and runtime compilation verified");

    // Test 6: tfsl-batch binary execution over stdin/stdout
    console.log("10. Testing tfsl-batch binary over stdin/stdout...");
    const tfslBatchBin = join(consumerDir, "node_modules/.bin/tfsl-batch");
    const batchInput = JSON.stringify({ action: "example", exampleName: "stellar-cyan", uiRevision: 7 });
    const batchOut = execFileSync(process.execPath, [tfslBatchBin], {
      cwd: consumerDir,
      input: batchInput,
      encoding: "utf8",
    });
    const parsedBatch = JSON.parse(batchOut);
    if (parsedBatch.status !== "success" || parsedBatch.uiRevision !== 7 || !parsedBatch.compiledCss) {
      throw new Error(`tfsl-batch output invalid: ${batchOut}`);
    }
    console.log("   tfsl-batch binary execution over stdin/stdout verified");

    // A real exchange from the installed API, then parsed by the installed
    // batch executable in independent processes. No checkout imports or mocks.
    console.log("11. Testing brief, candidate, and review design exchange in consumer...");
    const exchangeScript = `
      import { writeFileSync } from 'node:fs';
      import {
        STELLAR_CYAN_EXAMPLE, createThemeBrief, createThemeCandidate,
        createThemeReview, serializeThemeExchangePacket, parseThemeExchangePacket,
        verifyThemeCandidate, validateThemeReviewLinks
      } from '@knowledge-forge-ai/theme-forge-stellar-loom';
      const brief = createThemeBrief({briefId:'packed-brief',title:'Packed human exchange',goal:'Compare accents',baselineTheme:STELLAR_CYAN_EXAMPLE,allowedFields:['colors.dark.accent.base']});
      const candidates = ['#7c3aed','#d946ef'].map((color,i) => {
        const theme=structuredClone(brief.baselineTheme); theme.colors.dark.accent.base=color;
        return createThemeCandidate({candidateId:'packed-'+i,brief,theme,rationale:'Compare accent '+i});
      });
      if(candidates[0].themeDigest===candidates[1].themeDigest) throw Error('Alternatives are identical');
      for(const candidate of candidates) if(!verifyThemeCandidate(candidate,brief).valid) throw Error('Candidate verification failed');
      const review=createThemeReview({reviewId:'packed-review',brief,candidateDigests:candidates.map(c=>c.candidateDigest),dispositions:candidates.map((c,i)=>({candidateDigest:c.candidateDigest,disposition:i===1?'preferred':'rejected'})),annotations:[{annotationId:'note-1',candidateDigest:candidates[1].candidateDigest,target:{kind:'field',fieldPath:'colors.dark.accent.base'},category:'color',severity:'note',comment:'Compared locally'}],overallDisposition:{kind:'preferred',candidateDigest:candidates[1].candidateDigest},summary:'Prefer second alternative'});
      if(!validateThemeReviewLinks(review,candidates,brief).valid) throw Error('Review context failed');
      for(const [name,packet] of [['brief',brief],['candidate-a',candidates[0]],['candidate-b',candidates[1]],['review',review]]) {
        const text=serializeThemeExchangePacket(packet);
        if(serializeThemeExchangePacket(parseThemeExchangePacket(text))!==text) throw Error('Canonical roundtrip failed');
        if(!text.endsWith('\\n') || !text.includes('\\n  ')) throw Error('Canonical JSON formatting changed');
        writeFileSync(name+'.json',text,{flag:'wx'});
      }
      console.log('PACKED_EXCHANGE_OK');
    `;
    const exchangePath = join(consumerDir, "exchange.mjs");
    await writeFile(exchangePath, exchangeScript);
    const exchangeResult = execFileSync(process.execPath, [exchangePath], { cwd: consumerDir, encoding: "utf8" });
    if (!exchangeResult.includes("PACKED_EXCHANGE_OK")) throw new Error("Installed exchange did not complete");
    for (const name of ["brief", "candidate-a", "candidate-b", "review"]) {
      const packetJson = await readFile(join(consumerDir, `${name}.json`), "utf8");
      const parsed = JSON.parse(execFileSync(process.execPath, [tfslBatchBin], {
        cwd: consumerDir, input: JSON.stringify({ action: "exchange-packet-parse", packetJson }), encoding: "utf8",
      }));
      if (!parsed.valid || parsed.canonicalJson !== packetJson) throw new Error(`Packed batch identity failed for ${name}`);
    }
    console.log("   Installed brief, two candidates and review preserve canonical identity across processes");

    console.log("\n=== All Packed Consumer Smoke Tests Passed Successfully ===");
  } finally {
    if (!isExternalWorkDir) {
      await rm(consumerDir, { recursive: true, force: true });
    }
    if (!isExternalTarball) {
      await rm(tarballPath, { force: true });
      if (!isExternalWorkDir && packDir) {
        await rm(packDir, { recursive: true, force: true });
      }
    }
    console.log("Cleaned up temporary consumer artifacts.");
  }
}

run().catch((err) => {
  console.error("\nFATAL: Smoke test failed:", err);
  process.exit(1);
});
