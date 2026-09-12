import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile, stat } from "node:fs/promises";
import { mkdtempSync, cpSync, rmSync, writeFileSync, symlinkSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  computeExecutableIdentityDigestCatalog,
  readMember,
} from "../src/design-exchange-catalog/executable.js";
import {
  materializeFontResources,
  FontResourceDeclaration,
  FontResourceError,
} from "../src/font-resources.js";
import { runExchangeV2Cli } from "../src/cli-v2.js";

const unsupported = vi.hoisted(() => ({ flag: "" }));
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return { ...original, constants: new Proxy({ ...original.constants }, {
    get(target, key) { return key === unsupported.flag ? undefined : Reflect.get(target, key); },
  }) };
});

function sha256(data: Buffer | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

describe("TFSB66B-R7 Security Hardening Adversarial Tests", () => {
  const root = resolve(import.meta.dirname, "..");
  const allocatedDirs: string[] = [];

  function createInstalledDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "tfsl-adv-installed-"));
    allocatedDirs.push(dir);
    for (const member of ["dist", "bin", "package.json"]) {
      cpSync(join(root, member), join(dir, member), { recursive: true });
    }
    return dir;
  }

  afterEach(() => {
    unsupported.flag = "";
    for (const dir of allocatedDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("Alert #23: js/file-system-race executable.ts - Descriptor Identity & Symlink Rejection", () => {
    it.each(["O_NOFOLLOW", "O_NONBLOCK"])("refuses executable reads without %s support", (flag) => {
      const dir = createInstalledDir();
      unsupported.flag = flag;
      expect(() => readMember(dir, "package.json")).toThrow("UNSUPPORTED_SECURE_FILESYSTEM");
    });
    it("rejects an executable member leaf that is a symbolic link via O_NOFOLLOW in readMember", () => {
      const dir = createInstalledDir();
      const target = join(dir, "dist/catalog/compiler.js");
      const realTarget = join(dir, "dist/catalog/compiler.real.js");
      cpSync(target, realTarget);
      rmSync(target);
      symlinkSync(realTarget, target);

      expect(() => readMember(dir, "dist/catalog/compiler.js")).toThrow("SYMLINK_EXECUTABLE_MEMBER");
    });

    it("rejects an executable member whose ancestor directory is a symbolic link in readMember", () => {
      const dir = createInstalledDir();
      const catalogDir = join(dir, "dist/catalog");
      const realCatalogDir = join(dir, "dist/catalog-real");
      cpSync(catalogDir, realCatalogDir, { recursive: true });
      rmSync(catalogDir, { recursive: true, force: true });
      symlinkSync(realCatalogDir, catalogDir);

      expect(() => readMember(dir, "dist/catalog/compiler.js")).toThrow("SYMLINK_EXECUTABLE_MEMBER");
    });

    it("rejects when the executable root itself is a symbolic link", () => {
      const dir = createInstalledDir();
      const symlinkRoot = join(dir, "root-link");
      symlinkSync(dir, symlinkRoot);

      expect(() => readMember(symlinkRoot, "package.json")).toThrow("INVALID_EXECUTABLE_ROOT");
      expect(() => computeExecutableIdentityDigestCatalog(symlinkRoot)).toThrow("INVALID_EXECUTABLE_ROOT");
    });

    it("rejects non-regular member (e.g. directory in place of member file)", () => {
      const dir = createInstalledDir();
      const target = join(dir, "dist/catalog/compiler.js");
      rmSync(target);
      mkdirSync(target);

      expect(() => readMember(dir, "dist/catalog/compiler.js")).toThrow("INVALID_EXECUTABLE_MEMBER");
    });

    it("rejects empty member via descriptor fstatSync check", () => {
      const dir = createInstalledDir();
      const target = join(dir, "dist/catalog/compiler.js");
      writeFileSync(target, "");

      expect(() => readMember(dir, "dist/catalog/compiler.js")).toThrow("EMPTY_EXECUTABLE_MEMBER");
    });

    it("rejects an executable FIFO without blocking on open", () => {
      const dir = createInstalledDir();
      const fifo = join(dir, "fifo");
      execFileSync("mkfifo", [fifo]);
      expect(() => readMember(dir, "fifo")).toThrow("INVALID_EXECUTABLE_MEMBER");
    });

    it("reads valid member bytes using descriptor operations", () => {
      const dir = createInstalledDir();
      const bytes = readMember(dir, "package.json");
      expect(bytes.length).toBeGreaterThan(0);
      expect(JSON.parse(bytes.toString("utf8")).name).toBe("@knowledge-forge-ai/theme-forge-stellar-loom");
    });

    it("rejects manifest evidence that is a symbolic link in readMember", () => {
      const dir = createInstalledDir();
      const evidence = join(dir, "dist/catalog-build-evidence.json");
      const realEvidence = join(dir, "evidence-real.json");
      cpSync(evidence, realEvidence);
      rmSync(evidence);
      symlinkSync(realEvidence, evidence);

      expect(() => readMember(dir, "dist/catalog-build-evidence.json")).toThrow("SYMLINK_EXECUTABLE_MEMBER");
    });

    it("rejects package.json that is a symbolic link during full catalog identity computation", () => {
      const dir = createInstalledDir();
      const pkg = join(dir, "package.json");
      const realPkg = join(dir, "package-real.json");
      cpSync(pkg, realPkg);
      rmSync(pkg);
      symlinkSync(realPkg, pkg);

      expect(() => computeExecutableIdentityDigestCatalog(dir)).toThrow("SYMLINK_EXECUTABLE_MEMBER");
    });

    it("successfully computes catalog identity from an installed distribution", () => {
      const dir = createInstalledDir();
      const digest = computeExecutableIdentityDigestCatalog(dir);
      expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    });
  });

  describe("Alert #24 & #26: font-resources.ts - Descriptor Identity, O_NOFOLLOW, O_NONBLOCK & Restrictive Mode", () => {
    let testDir: string;
    const SAMPLE_FONT_BYTES = Buffer.from("LOOM_SYNTHETIC_TEST_FONT_RESOURCE_SECURE_PAYLOAD");
    const SAMPLE_DIGEST = sha256(SAMPLE_FONT_BYTES);

    beforeEach(async () => {
      testDir = await mkdtemp(join(tmpdir(), "tfsl-font-adv-"));
      allocatedDirs.push(testDir);
    });

    it.each(["O_NOFOLLOW", "O_NONBLOCK"])("refuses font reads without %s support", async (flag) => {
      const id = "unsupported-font";
      await writeFile(join(testDir, `${id}.woff2`), SAMPLE_FONT_BYTES);
      unsupported.flag = flag;
      await expect(materializeFontResources(testDir, [{ id, format: "woff2", sha256: SAMPLE_DIGEST }], [id]))
        .rejects.toMatchObject({ code: "UNSUPPORTED_SECURE_FILESYSTEM" });
    });

    it("materializes valid font file directly via open descriptor without TOCTOU pre-stat", async () => {
      const id = "adv-font-1";
      await writeFile(join(testDir, `${id}.woff2`), SAMPLE_FONT_BYTES, { mode: 0o600 });

      const decl: FontResourceDeclaration = {
        id,
        format: "woff2",
        sha256: SAMPLE_DIGEST,
      };

      const result = await materializeFontResources(testDir, [decl], [id]);
      expect(result.size).toBe(1);
      const bytes = result.get(id);
      expect(bytes).toBeDefined();
      expect(Buffer.compare(Buffer.from(bytes!), SAMPLE_FONT_BYTES)).toBe(0);
    });

    it("rejects symlinked leaf font file via O_NOFOLLOW without opening or following", async () => {
      const realTarget = join(testDir, "real-target.woff2");
      await writeFile(realTarget, SAMPLE_FONT_BYTES);

      const symlinkLeaf = join(testDir, "symlink-font.woff2");
      await symlink(realTarget, symlinkLeaf);

      const decl: FontResourceDeclaration = {
        id: "symlink-font",
        format: "woff2",
        sha256: SAMPLE_DIGEST,
      };

      await expect(
        materializeFontResources(testDir, [decl], ["symlink-font"])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "SYMLINK_REJECTED" })
      );
    });

    it("rejects non-regular FIFO pipe without blocking via O_NONBLOCK", async () => {
      const fifoPath = join(testDir, "fifo-pipe.woff2");
      execFileSync("mkfifo", [fifoPath]);

      const decl: FontResourceDeclaration = {
        id: "fifo-pipe",
        format: "woff2",
        sha256: "0".repeat(64),
      };

      await expect(
        materializeFontResources(testDir, [decl], ["fifo-pipe"])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "NOT_A_REGULAR_FILE" })
      );
    });

    it("rejects directory in place of font leaf file", async () => {
      const dirLeaf = join(testDir, "dir-font.woff2");
      await mkdir(dirLeaf);

      const decl: FontResourceDeclaration = {
        id: "dir-font",
        format: "woff2",
        sha256: SAMPLE_DIGEST,
      };

      await expect(
        materializeFontResources(testDir, [decl], ["dir-font"])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "NOT_A_REGULAR_FILE" })
      );
    });

    it("rejects empty font file with EMPTY_FONT_RESOURCE", async () => {
      await writeFile(join(testDir, "empty.woff2"), Buffer.alloc(0));

      const decl: FontResourceDeclaration = {
        id: "empty",
        format: "woff2",
        sha256: sha256(Buffer.alloc(0)),
      };

      await expect(
        materializeFontResources(testDir, [decl], ["empty"])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "EMPTY_FONT_RESOURCE" })
      );
    });
  });

  describe("Alert #25: js/insecure-temporary-file cli-v2.ts - Exclusive Creation & Restrictive Mode (0o600)", () => {
    let tmpCliDir: string;
    const v2ThemePath = join(root, "examples/loom-black-core.theme.json");

    beforeEach(async () => {
      tmpCliDir = await mkdtemp(join(tmpdir(), "tfsl-cli-adv-"));
      allocatedDirs.push(tmpCliDir);
    });

    it("creates output exchange packet with restrictive mode 0o600", async () => {
      const outPath = join(tmpCliDir, "out-candidate.json");

      const origStdout = process.stdout.write;
      let stdoutContent = "";
      process.stdout.write = ((chunk: any) => {
        stdoutContent += chunk;
        return true;
      }) as any;

      try {
        const exitCode = await runExchangeV2Cli([
          "v2-create",
          v2ThemePath,
          "--out",
          outPath,
        ]);
        expect(exitCode).toBe(0);

        const response = JSON.parse(stdoutContent);
        expect(response.status).toBe("success");

        // Inspect file permissions: restrictive mode 0o600 (owner read/write only)
        const fileStat = await stat(outPath);
        const mode = fileStat.mode & 0o777;
        expect(mode).toBe(0o600);
      } finally {
        process.stdout.write = origStdout;
      }
    });

    it("refuses to overwrite existing file via exclusive creation flag wx", async () => {
      const outPath = join(tmpCliDir, "existing-candidate.json");
      await writeFile(outPath, "pre-existing content", { mode: 0o600 });

      const origStdout = process.stdout.write;
      let stdoutContent = "";
      process.stdout.write = ((chunk: any) => {
        stdoutContent += chunk;
        return true;
      }) as any;

      try {
        const exitCode = await runExchangeV2Cli([
          "v2-create",
          v2ThemePath,
          "--out",
          outPath,
        ]);
        expect(exitCode).toBe(1);

        const response = JSON.parse(stdoutContent);
        expect(response.status).toBe("error");
        expect(response.code).toBe("EEXIST");

        // Existing file content must NOT be overwritten
        const content = readFileSync(outPath, "utf8");
        expect(content).toBe("pre-existing content");
      } finally {
        process.stdout.write = origStdout;
      }
    });

    it("refuses to write through an ancestor directory that is a symlink", async () => {
      const realSubDir = join(tmpCliDir, "real-sub");
      await mkdir(realSubDir);
      const symlinkSubDir = join(tmpCliDir, "symlink-sub");
      await symlink(realSubDir, symlinkSubDir);

      const outPath = join(symlinkSubDir, "forbidden.json");

      const origStdout = process.stdout.write;
      let stdoutContent = "";
      process.stdout.write = ((chunk: any) => {
        stdoutContent += chunk;
        return true;
      }) as any;

      try {
        const exitCode = await runExchangeV2Cli([
          "v2-create",
          v2ThemePath,
          "--out",
          outPath,
        ]);
        expect(exitCode).toBe(1);

        const response = JSON.parse(stdoutContent);
        expect(response.status).toBe("error");
        expect(response.code).toBe("SYMLINK_REJECTED");
      } finally {
        process.stdout.write = origStdout;
      }
    });
  });
});
