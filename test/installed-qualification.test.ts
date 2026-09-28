import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PUBLIC_MEMBERSHIP_REQUIREMENTS,
  checkPublicMembershipRequirements,
  compareDirectorySnapshots,
  parseInstalledArgs,
  qualifyInstalled,
  resolveInstalledTargets,
  runBatchFramed,
  runBoundedCommand,
  takeDirectorySnapshot,
// @ts-expect-error - qualify-installed.mjs is an ES module tool without separate d.ts
} from "../tools/qualify-installed.mjs";

const loomRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testAllocations: string[] = [];

function makeTemp(prefix = "tfsl-qual-test-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  testAllocations.push(dir);
  return dir;
}

function createInstalledFixture(destDir: string): string {
  const pkgRoot = join(destDir, "installed-pkg");
  mkdirSync(pkgRoot, { recursive: true });

  const members = [
    "dist",
    "bin",
    "package.json",
    "examples",
    "LICENSE",
    "NOTICE",
    "COMMERCIAL-LICENSE.md",
    "README.md",
  ];

  for (const member of members) {
    const src = join(loomRoot, member);
    const dest = join(pkgRoot, member);
    cpSync(src, dest, { recursive: true });
  }

  return pkgRoot;
}

afterEach(() => {
  for (const dir of testAllocations.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("parseInstalledArgs", () => {
  it("parses empty arguments with defaults", () => {
    const parsed = parseInstalledArgs([]);
    expect(parsed.packageRoot).toBeNull();
    expect(parsed.tfsl).toBeNull();
    expect(parsed.tfslBatch).toBeNull();
    expect(parsed.node).toBeNull();
    expect(parsed.workDir).toBeNull();
    expect(parsed.timeoutMs).toBe(15_000);
    expect(parsed.stdout).toBe(true);
    expect(parsed.json).toBe(false);
  });

  it("parses explicit arguments with spaces", () => {
    const parsed = parseInstalledArgs([
      "--package-root",
      "/opt/loom",
      "--tfsl",
      "/opt/loom/bin/tfsl.js",
      "--tfsl-batch",
      "/opt/loom/bin/tfsl-batch.js",
      "--node",
      "/usr/local/bin/node",
      "--work-dir",
      "/tmp/scratch",
      "--timeout",
      "30000",
      "--no-stdout",
      "--json",
    ]);

    expect(parsed.packageRoot).toBe(resolve("/opt/loom"));
    expect(parsed.tfsl).toBe(resolve("/opt/loom/bin/tfsl.js"));
    expect(parsed.tfslBatch).toBe(resolve("/opt/loom/bin/tfsl-batch.js"));
    expect(parsed.node).toBe(resolve("/usr/local/bin/node"));
    expect(parsed.workDir).toBe(resolve("/tmp/scratch"));
    expect(parsed.timeoutMs).toBe(30_000);
    expect(parsed.stdout).toBe(false);
    expect(parsed.json).toBe(true);
  });

  it("parses arguments with equals syntax", () => {
    const parsed = parseInstalledArgs([
      "--package-root=/nix/store/loom",
      "--cli=/nix/store/loom/bin/tfsl",
      "--batch=/nix/store/loom/bin/tfsl-batch",
      "--node-runtime=/nix/store/node",
      "--scratch=/tmp/custom-work",
      "--timeout-ms=20000",
    ]);

    expect(parsed.packageRoot).toBe(resolve("/nix/store/loom"));
    expect(parsed.tfsl).toBe(resolve("/nix/store/loom/bin/tfsl"));
    expect(parsed.tfslBatch).toBe(resolve("/nix/store/loom/bin/tfsl-batch"));
    expect(parsed.node).toBe(resolve("/nix/store/node"));
    expect(parsed.workDir).toBe(resolve("/tmp/custom-work"));
    expect(parsed.timeoutMs).toBe(20_000);
  });

  it("recognizes help flags", () => {
    expect(parseInstalledArgs(["--help"]).help).toBe(true);
    expect(parseInstalledArgs(["-h"]).help).toBe(true);
  });

  it("throws on duplicate arguments", () => {
    expect(() => parseInstalledArgs(["--package-root", "/a", "--package-root", "/b"])).toThrow(
      "Duplicate --package-root argument.",
    );
    expect(() => parseInstalledArgs(["--tfsl", "/a", "--cli", "/b"])).toThrow(
      "Duplicate --tfsl argument.",
    );
    expect(() => parseInstalledArgs(["--node", "/a", "--node-path", "/b"])).toThrow(
      "Duplicate --node argument.",
    );
    expect(() => parseInstalledArgs(["--work-dir", "/a", "--scratch", "/b"])).toThrow(
      "Duplicate --work-dir argument.",
    );
  });

  it("throws on missing argument values or unexpected flags", () => {
    expect(() => parseInstalledArgs(["--package-root"])).toThrow('Missing value for argument "--package-root".');
    expect(() => parseInstalledArgs(["--timeout", "not-a-number"])).toThrow('Invalid value for --timeout: "not-a-number".');
    expect(() => parseInstalledArgs(["--unknown-flag"])).toThrow('Unexpected argument: "--unknown-flag".');
  });
});

describe("resolveInstalledTargets", () => {
  it("throws when --package-root is missing or non-existent", () => {
    expect(() => resolveInstalledTargets({})).toThrow("Missing required --package-root option.");
    expect(() => resolveInstalledTargets({ packageRoot: "/non/existent/path/12345" })).toThrow(
      "Package root does not exist or is not a directory",
    );
  });

  it("throws when node binary is invalid", () => {
    const temp = makeTemp();
    expect(() =>
      resolveInstalledTargets({
        packageRoot: temp,
        node: "/non/existent/node-bin",
      }),
    ).toThrow("Specified node runtime executable does not exist");
  });

  it("fails closed without PATH or source fallback when binaries are not in packageRoot", () => {
    const temp = makeTemp();
    // Empty directory has no binaries
    expect(() =>
      resolveInstalledTargets({
        packageRoot: temp,
      }),
    ).toThrow(/Could not resolve tfsl CLI executable within package root/);
  });

  it("resolves tfsl and tfsl-batch inside installed package layout", () => {
    const temp = makeTemp();
    const pkgRoot = createInstalledFixture(temp);
    const targets = resolveInstalledTargets({ packageRoot: pkgRoot });

    expect(targets.packageRoot).toBe(pkgRoot);
    expect(targets.tfsl).toBe(join(pkgRoot, "bin", "tfsl.js"));
    expect(targets.tfslBatch).toBe(join(pkgRoot, "bin", "tfsl-batch.js"));
    expect(targets.node).toBe(process.execPath);
  });

  it("respects explicitly supplied executable paths", () => {
    const temp = makeTemp();
    const pkgRoot = createInstalledFixture(temp);
    const customTfsl = join(temp, "custom-tfsl.js");
    const customBatch = join(temp, "custom-batch.js");
    writeFileSync(customTfsl, "// custom\n");
    writeFileSync(customBatch, "// custom\n");

    const targets = resolveInstalledTargets({
      packageRoot: pkgRoot,
      tfsl: customTfsl,
      tfslBatch: customBatch,
    });

    expect(targets.tfsl).toBe(customTfsl);
    expect(targets.tfslBatch).toBe(customBatch);
  });
});

describe("checkPublicMembershipRequirements", () => {
  it("passes on a complete installed package layout", () => {
    const temp = makeTemp();
    const pkgRoot = createInstalledFixture(temp);
    const membership = checkPublicMembershipRequirements(pkgRoot);

    expect(membership.valid).toBe(true);
    expect(membership.errors).toEqual([]);
    expect(membership.missingMembers).toEqual([]);
    expect(membership.mismatchedMembers).toEqual([]);
    expect(membership.packageMetadata.name).toBe(PUBLIC_MEMBERSHIP_REQUIREMENTS.packageName);
    expect(membership.packageMetadata.hasRequiredExports).toBe(true);
    expect(membership.packageMetadata.hasRequiredBin).toBe(true);
    expect(membership.manifestEvidence.present).toBe(true);
    expect(membership.manifestEvidence.valid).toBe(true);
    expect(membership.binFiles["bin/tfsl.js"].isRegularFile).toBe(true);
    expect(membership.binFiles["bin/tfsl-batch.js"].isRegularFile).toBe(true);
  });

  it("detects missing catalog build evidence", () => {
    const temp = makeTemp();
    const pkgRoot = createInstalledFixture(temp);
    unlinkSync(join(pkgRoot, "dist", "catalog-build-evidence.json"));

    const membership = checkPublicMembershipRequirements(pkgRoot);
    expect(membership.valid).toBe(false);
    expect(membership.manifestEvidence.present).toBe(false);
    expect(membership.errors.some((e: string) => e.includes("catalog-build-evidence.json"))).toBe(true);
  });

  it("rejects symlinked bin files (enforces regular file requirement)", () => {
    const temp = makeTemp();
    const pkgRoot = createInstalledFixture(temp);

    // Replace regular bin/tfsl.js with symlink
    const realBin = join(pkgRoot, "bin", "tfsl.js");
    const backupBin = join(temp, "tfsl-real.js");
    cpSync(realBin, backupBin);
    unlinkSync(realBin);
    symlinkSync(backupBin, realBin);

    const membership = checkPublicMembershipRequirements(pkgRoot);
    expect(membership.valid).toBe(false);
    expect(membership.binFiles["bin/tfsl.js"].isRegularFile).toBe(false);
    expect(membership.errors.some((e: string) => e.includes("not a regular file"))).toBe(true);
  });

  it("detects corrupted member digest in build evidence", () => {
    const temp = makeTemp();
    const pkgRoot = createInstalledFixture(temp);

    // Modify a dist file
    const targetFile = join(pkgRoot, "dist", "catalog", "compiler.js");
    writeFileSync(targetFile, readFileSync(targetFile, "utf8") + "\n// mutation\n");

    const membership = checkPublicMembershipRequirements(pkgRoot);
    expect(membership.valid).toBe(false);
    expect(membership.mismatchedMembers.some((m: string) => m.includes("dist/catalog/compiler.js"))).toBe(true);
  });
});

describe("runBatchFramed", () => {
  it("processes framed example action over stdin and cleanly terminates on EOF", async () => {
    const temp = makeTemp();
    const pkgRoot = createInstalledFixture(temp);
    const batchBin = join(pkgRoot, "bin", "tfsl-batch.js");

    const req = JSON.stringify({ action: "example", exampleName: "stellar-cyan", uiRevision: 77 });
    const result = await runBatchFramed(batchBin, req, { cwd: temp });

    expect(result.timedOut).toBe(false);
    expect(result.status).toBe(0);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("success");
    expect(parsed.valid).toBe(true);
    expect(parsed.uiRevision).toBe(77);
    expect(typeof parsed.compiledCss).toBe("string");
    expect(parsed.compiledCss.length).toBeGreaterThan(100);
  });

  it("returns error and exits 1 on unknown example name over framed stdin", async () => {
    const temp = makeTemp();
    const pkgRoot = createInstalledFixture(temp);
    const batchBin = join(pkgRoot, "bin", "tfsl-batch.js");

    const req = JSON.stringify({ action: "example", exampleName: "unknown-theme-xyz" });
    const result = await runBatchFramed(batchBin, req, { cwd: temp });

    expect(result.timedOut).toBe(false);
    expect(result.status).toBe(1);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("error");
    expect(parsed.valid).toBe(false);
    expect(parsed.error?.code).toBe("UNKNOWN_EXAMPLE");
  });

  it("cleanly terminates with EMPTY_INPUT when stdin is immediately closed with no bytes", async () => {
    const temp = makeTemp();
    const pkgRoot = createInstalledFixture(temp);
    const batchBin = join(pkgRoot, "bin", "tfsl-batch.js");

    const result = await runBatchFramed(batchBin, "", { cwd: temp });

    expect(result.timedOut).toBe(false);
    expect(result.status).toBe(1);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("error");
    expect(parsed.error?.code).toBe("EMPTY_INPUT");
  });

  it("cleanly terminates with INVALID_JSON when stdin contains malformed data", async () => {
    const temp = makeTemp();
    const pkgRoot = createInstalledFixture(temp);
    const batchBin = join(pkgRoot, "bin", "tfsl-batch.js");

    const result = await runBatchFramed(batchBin, "not valid json {", { cwd: temp });

    expect(result.timedOut).toBe(false);
    expect(result.status).toBe(1);

    const parsed = JSON.parse(result.stdout);
    expect(parsed.status).toBe("error");
    expect(parsed.error?.code).toBe("INVALID_JSON");
  });
});

describe("qualifyInstalled end-to-end qualification probe", () => {
  it("qualifies an installed package layout end-to-end with zero mutation", async () => {
    const temp = makeTemp();
    const pkgRoot = createInstalledFixture(temp);
    const workDir = join(temp, "isolated-work");

    const report: any = await qualifyInstalled({
      packageRoot: pkgRoot,
      workDir,
      stdout: false,
    });

    expect(report.qualified).toBe(true);
    expect(report.installedTreeUnchanged).toBe(true);
    expect(report.publicMembershipRequirements.status).toBe("pass");
    expect(report.probes.versionAndHelp.passed).toBe(true);
    expect(report.probes.validation.passed).toBe(true);
    expect(report.probes.compilation.passed).toBe(true);
    expect(report.probes.repeatDeterminism.passed).toBe(true);
    expect(report.probes.malformedRejection.passed).toBe(true);
    expect(report.probes.cwdIndependence.passed).toBe(true);
    expect(report.probes.isolatedUserState.passed).toBe(true);
    expect(report.probes.batchFraming.passed).toBe(true);
    expect(report.probes.exchangeCatalog.passed).toBe(true);
    expect(report.probes.libraryEsm.passed).toBe(true);
  });

  it("fails qualification if catalog build evidence is absent", async () => {
    const temp = makeTemp();
    const pkgRoot = createInstalledFixture(temp);
    unlinkSync(join(pkgRoot, "dist", "catalog-build-evidence.json"));

    await expect(
      qualifyInstalled({
        packageRoot: pkgRoot,
        workDir: join(temp, "work"),
        stdout: false,
      }),
    ).rejects.toThrow(/membership requirements check failed/);
  });

  it("fails qualification if bin regular file is absent", async () => {
    const temp = makeTemp();
    const pkgRoot = createInstalledFixture(temp);
    unlinkSync(join(pkgRoot, "bin", "tfsl.js"));

    await expect(
      qualifyInstalled({
        packageRoot: pkgRoot,
        workDir: join(temp, "work"),
        stdout: false,
      }),
    ).rejects.toThrow(/membership requirements check failed/);
  });
});
