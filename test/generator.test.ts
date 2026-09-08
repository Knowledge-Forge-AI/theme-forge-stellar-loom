import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, symlink, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  generateThemePackage,
  writeThemePackage,
  validatePackageMetadata,
  FilesystemSafetyError,
} from "../src/generator/index.js";
import { STELLAR_CYAN_EXAMPLE, AMBER_FORGE_EXAMPLE } from "../src/examples.js";
import { ValidationError } from "../src/schema/validator.js";
import { compileTheme, ContrastError } from "../src/index.js";

describe("Theme Forge Stellar Loom Package Generator", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "tfsl-gen-test-"));
  });

  afterEach(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  describe("Metadata Validation", () => {
    it("accepts valid scoped and unscoped npm package names", () => {
      const unscoped = validatePackageMetadata({
        name: "starlight-theme-stellar-cyan",
        version: "0.1.0",
      });
      expect(unscoped.name).toBe("starlight-theme-stellar-cyan");
      expect(unscoped.version).toBe("0.1.0");

      const scoped = validatePackageMetadata({
        name: "@my-org/starlight-theme-amber",
        version: "1.0.0-beta.1",
        description: "A lovely Amber Forge Starlight theme",
        author: "Dev Team",
      });
      expect(scoped.name).toBe("@my-org/starlight-theme-amber");
      expect(scoped.version).toBe("1.0.0-beta.1");
      expect(scoped.description).toBe("A lovely Amber Forge Starlight theme");
      expect(scoped.author).toBe("Dev Team");
    });

    it("rejects invalid package names (uppercase, path traversal, length)", () => {
      expect(() =>
        validatePackageMetadata({ name: "Starlight-Theme", version: "0.1.0" })
      ).toThrowError(ValidationError);

      expect(() =>
        validatePackageMetadata({ name: "../bad-path", version: "0.1.0" })
      ).toThrowError(ValidationError);

      expect(() =>
        validatePackageMetadata({ name: "bad/path/too/many/slashes", version: "0.1.0" })
      ).toThrowError(ValidationError);

      expect(() =>
        validatePackageMetadata({ name: "a".repeat(215), version: "0.1.0" })
      ).toThrowError(ValidationError);
    });

    it("rejects non-SemVer versions", () => {
      expect(() =>
        validatePackageMetadata({ name: "theme-package", version: "latest" })
      ).toThrowError(ValidationError);

      expect(() =>
        validatePackageMetadata({ name: "theme-package", version: "1.0" })
      ).toThrowError(ValidationError);
    });

    it("rejects unknown template IDs", () => {
      expect(() =>
        validatePackageMetadata({
          name: "theme-package",
          version: "0.1.0",
          template: "unapproved-hero-banner" as any,
        })
      ).toThrowError(ValidationError);
    });

    it("accepts approved template ID 'page-title-frame'", () => {
      const meta = validatePackageMetadata({
        name: "theme-package",
        version: "0.1.0",
        template: "page-title-frame",
      });
      expect(meta.template).toBe("page-title-frame");
    });

    it("enforces first-party AGPL-3.0-or-later licensing policy", () => {
      const defaultLic = validatePackageMetadata({
        name: "theme-package",
        version: "0.1.0",
      });
      expect(defaultLic.license).toBe("AGPL-3.0-or-later");

      expect(() =>
        validatePackageMetadata({
          name: "theme-package",
          version: "0.1.0",
          license: "MIT",
        })
      ).toThrowError(ValidationError);
    });

    it("rejects forbidden control characters in text metadata", () => {
      expect(() =>
        validatePackageMetadata({
          name: "theme-package",
          version: "0.1.0",
          description: "Bad \x00 null byte in description",
        })
      ).toThrowError(ValidationError);
    });
  });

  describe("Pure Package Emitter & Determinism", () => {
    it("generates CSS-only package by default with closed file inventory", () => {
      const result = generateThemePackage({
        themeSpec: STELLAR_CYAN_EXAMPLE,
        metadata: {
          name: "starlight-theme-stellar-cyan",
          version: "0.1.0",
          description: "Stellar Cyan Theme",
        },
      });

      const expectedFiles = [
        "COMMERCIAL-LICENSE.md",
        "LICENSE",
        "NOTICE",
        "README.md",
        "index.d.ts",
        "index.js",
        "package.json",
        "provenance.json",
        "styles/theme.css",
        "theme.descriptor.json",
        "theme.json",
      ];

      expect(Array.from(result.files.keys()).sort()).toEqual(expectedFiles.sort());
      expect(result.files.has("components/PageTitleFrame.astro")).toBe(false);

      const pkgJson = JSON.parse(result.files.get("package.json")!);
      expect(pkgJson.name).toBe("starlight-theme-stellar-cyan");
      expect(pkgJson.version).toBe("0.1.0");
      expect(pkgJson.private).toBe(true);
      expect(pkgJson.type).toBe("module");
      expect(pkgJson.exports["."].import).toBe("./index.js");
      expect(pkgJson.exports["./styles/*"]).toBe("./styles/*");
      expect(pkgJson.exports["./components/*"]).toBeUndefined();
      expect(pkgJson.peerDependencies["@astrojs/starlight"]).toBe("^0.42.0");
      expect(pkgJson.peerDependencies["astro"]).toBe("^7.3.1");

      const indexJs = result.files.get("index.js")!;
      expect(indexJs).toContain("name: \"starlight-theme-stellar-cyan\"");
      expect(indexJs).toContain("\"config:setup\"");
      expect(indexJs).toContain("starlight-theme-stellar-cyan/styles/theme.css");
      expect(indexJs).not.toContain("components: existingComponents");

      const descriptor = JSON.parse(result.files.get("theme.descriptor.json")!);
      expect(descriptor.cssFile).toBe("styles/theme.css");
      expect(descriptor.themeName).toBe("stellar-cyan");
      expect(descriptor.outputDigest).toBe(result.cssOutputDigest);

      const provenance = JSON.parse(result.files.get("provenance.json")!);
      expect(provenance.schema).toBe("tfsl.package-provenance-v1");
      expect(provenance.packageName).toBe("starlight-theme-stellar-cyan");
      expect(provenance.template).toBeUndefined();
      expect(provenance.files.length).toBe(expectedFiles.length - 1); // all other files
    });

    it("generates package with approved opt-in 'page-title-frame' template", () => {
      const result = generateThemePackage({
        themeSpec: AMBER_FORGE_EXAMPLE,
        metadata: {
          name: "@scope/starlight-theme-amber",
          version: "0.2.0",
          template: "page-title-frame",
        },
      });

      const expectedFiles = [
        "COMMERCIAL-LICENSE.md",
        "LICENSE",
        "NOTICE",
        "README.md",
        "components/PageTitleFrame.astro",
        "index.d.ts",
        "index.js",
        "package.json",
        "provenance.json",
        "styles/theme.css",
        "theme.descriptor.json",
        "theme.json",
      ];

      expect(Array.from(result.files.keys()).sort()).toEqual(expectedFiles.sort());
      expect(result.files.has("components/PageTitleFrame.astro")).toBe(true);

      const astroComponent = result.files.get("components/PageTitleFrame.astro")!;
      expect(astroComponent).toContain("import Default from \"@astrojs/starlight/components/PageTitle.astro\";");
      expect(astroComponent).toContain("class=\"tfsl-page-title-frame\"");
      expect(astroComponent).toContain("<Default {...Astro.props} />");

      const pkgJson = JSON.parse(result.files.get("package.json")!);
      expect(pkgJson.exports["./components/*"]).toBe("./components/*");
      expect(pkgJson.files).toContain("components");

      const indexJs = result.files.get("index.js")!;
      expect(indexJs).toContain("existingComponents.PageTitle");
      expect(indexJs).toContain("Preserving existing consumer PageTitle component override");
      expect(indexJs).toContain("@scope/starlight-theme-amber/components/PageTitleFrame.astro");

      const provenance = JSON.parse(result.files.get("provenance.json")!);
      expect(provenance.template).toBe("page-title-frame");
    });

    it("is bit-for-bit deterministic across multiple runs", () => {
      const run1 = generateThemePackage({
        themeSpec: STELLAR_CYAN_EXAMPLE,
        metadata: { name: "starlight-theme-deterministic", version: "1.0.0" },
      });
      const run2 = generateThemePackage({
        themeSpec: STELLAR_CYAN_EXAMPLE,
        metadata: { name: "starlight-theme-deterministic", version: "1.0.0" },
      });

      expect(Array.from(run1.files.keys())).toEqual(Array.from(run2.files.keys()));
      for (const [key, content1] of run1.files.entries()) {
        const content2 = run2.files.get(key);
        expect(content1).toBe(content2);
      }
    });

    it("contains zero host paths, usernames, timestamps, or git repository traces", () => {
      const result = generateThemePackage({
        themeSpec: STELLAR_CYAN_EXAMPLE,
        metadata: { name: "starlight-theme-hygiene", version: "1.0.0" },
      });

      const currentHome = process.env.HOME;
      const currentUser = userInfo().username;

      for (const [path, content] of result.files.entries()) {
        if (currentHome && content.includes(currentHome)) {
          throw new Error(`File '${path}' contains host home path: '${currentHome}'`);
        }
        if (currentUser && currentUser.length > 2 && content.includes(currentUser)) {
          throw new Error(`File '${path}' contains host username: '${currentUser}'`);
        }
        if (content.includes("node_modules")) {
          throw new Error(`File '${path}' contains forbidden 'node_modules'`);
        }
        if (content.includes(".git/")) {
          throw new Error(`File '${path}' contains forbidden '.git/'`);
        }
        if (/\bgit\s+commit\b/i.test(content) || /\bcommit\s+[0-9a-f]{40}\b/i.test(content)) {
          throw new Error(`File '${path}' contains git commit references`);
        }
      }
    });

    it("strictly asserts emitted cascade order and specificity in index.js and README.md", () => {
      const result = generateThemePackage({
        themeSpec: STELLAR_CYAN_EXAMPLE,
        metadata: { name: "starlight-theme-cascade-test", version: "1.0.0" },
      });

      const indexJs = result.files.get("index.js")!;
      // Match `[themeCssPath, ...existingCustomCss]`
      const cascadeMatch = indexJs.match(/:\s*\[([^\]]+)\]/);
      expect(cascadeMatch).toBeTruthy();
      const elements = cascadeMatch![1].split(",").map((s) => s.trim());
      expect(elements[0]).toBe("themeCssPath");
      expect(elements[1]).toBe("...existingCustomCss");

      const readme = result.files.get("README.md")!;
      expect(readme).toContain(":root");
      expect(readme).toContain(":root[data-theme='light']");
    });

    it("accurately describes repeatable local pack and install for private unregistered candidate in README.md", () => {
      const result = generateThemePackage({
        themeSpec: STELLAR_CYAN_EXAMPLE,
        metadata: { name: "starlight-theme-stellar-cyan", version: "0.1.0" },
      });

      const pkgJson = JSON.parse(result.files.get("package.json")!);
      expect(pkgJson.private).toBe(true);

      const readme = result.files.get("README.md")!;
      // Accurately document private unregistered candidate and repeatable local pack/install
      expect(readme).toContain("private unregistered candidate");
      expect(readme).toContain('"private": true');
      expect(readme).toContain("local npm pack");
      expect(readme).toContain("npm pack");
      expect(readme).toContain("npm install --ignore-scripts /path/to/tarball");
      // Must not suggest registry npm install
      expect(readme).not.toContain(`npm install ${pkgJson.name}`);
      expect(readme).not.toContain("Install via npm or from local tarball:");

      // Retain dual licensing statement and files without exception
      expect(readme).toContain("## Licensing");
      expect(readme).toContain("AGPL-3.0-or-later");
      expect(readme).toContain("COMMERCIAL-LICENSE.md");
      expect(result.files.has("LICENSE")).toBe(true);
      expect(result.files.has("NOTICE")).toBe(true);
      expect(result.files.has("COMMERCIAL-LICENSE.md")).toBe(true);

      // Also verify scoped package with template
      const scopedResult = generateThemePackage({
        themeSpec: AMBER_FORGE_EXAMPLE,
        metadata: {
          name: "@scope/starlight-theme-amber",
          version: "0.2.0",
          template: "page-title-frame",
        },
      });
      const scopedReadme = scopedResult.files.get("README.md")!;
      expect(scopedReadme).toContain("private unregistered candidate");
      expect(scopedReadme).toContain("npm pack");
      expect(scopedReadme).toContain("npm install --ignore-scripts /path/to/tarball");
      expect(scopedReadme).not.toContain("npm install @scope/starlight-theme-amber");
      expect(scopedReadme).toContain("## Component Overrides");
    });
  });

  describe("Filesystem Writer & Safety", () => {
    it("writes all generated files to a clean target directory", async () => {
      const outDir = join(testDir, "out-package");
      const generated = generateThemePackage({
        themeSpec: STELLAR_CYAN_EXAMPLE,
        metadata: { name: "starlight-theme-write", version: "0.1.0" },
      });

      const writeRes = await writeThemePackage(generated, outDir);
      expect(writeRes.filesWritten.length).toBe(generated.files.size);
      expect(writeRes.filesPruned.length).toBe(0);

      for (const [relPath, content] of generated.files.entries()) {
        const diskContent = await readFile(join(outDir, relPath), "utf8");
        expect(diskContent).toBe(content);
      }
    });

    it("refuses to write to a non-empty directory", async () => {
      const outDir = join(testDir, "non-empty");
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, "random.txt"), "hello", "utf8");

      const generated = generateThemePackage({
        themeSpec: STELLAR_CYAN_EXAMPLE,
        metadata: { name: "starlight-theme-refuse", version: "0.1.0" },
      });

      await expect(writeThemePackage(generated, outDir)).rejects.toThrowError(
        FilesystemSafetyError
      );
    });

    it("preserves temporary sibling victim and rejects when occupied target has provenance naming victim", async () => {
      const victimPath = join(testDir, "outside-victim.txt");
      const victimContent = "CANARY_OUTSIDE_VICTIM_DATA";
      await writeFile(victimPath, victimContent, "utf8");
      const victimHashBefore = createHash("sha256").update(victimContent).digest("hex");

      const outDir = join(testDir, "occupied-target");
      await mkdir(outDir, { recursive: true });
      const maliciousProvenance = {
        schema: "tfsl.package-provenance-v1",
        schemaVersion: 1,
        packageName: "starlight-theme-victim",
        packageVersion: "0.1.0",
        files: [
          { path: "../outside-victim.txt", size: victimContent.length, sha256: victimHashBefore, category: "user-authored-data" },
        ],
      };
      const provPath = join(outDir, "provenance.json");
      await writeFile(provPath, JSON.stringify(maliciousProvenance, null, 2), "utf8");
      const provHashBefore = createHash("sha256").update(await readFile(provPath)).digest("hex");

      const generated = generateThemePackage({
        themeSpec: STELLAR_CYAN_EXAMPLE,
        metadata: { name: "starlight-theme-victim", version: "0.1.0" },
      });

      // Default rejection (non-empty directory)
      await expect(writeThemePackage(generated, outDir)).rejects.toThrowError(FilesystemSafetyError);

      // Overwrite request rejection (OVERWRITE_NOT_SUPPORTED)
      await expect(writeThemePackage(generated, outDir, { overwrite: true } as any)).rejects.toThrowError(
        /overwrite option is not supported/
      );

      // Verify victim bytes remain 100% untouched
      const victimAfter = await readFile(victimPath, "utf8");
      expect(victimAfter).toBe(victimContent);
      expect(createHash("sha256").update(victimAfter).digest("hex")).toBe(victimHashBefore);

      // Verify target directory provenance.json remains 100% untouched
      const provAfter = await readFile(provPath, "utf8");
      expect(createHash("sha256").update(provAfter).digest("hex")).toBe(provHashBefore);
    });

    it("preserves handwritten files and existing package edits even if overwrite requested", async () => {
      const outDir = join(testDir, "handwritten-target");
      await mkdir(outDir, { recursive: true });
      const handwrittenJs = join(outDir, "index.js");
      const handwrittenContent = "// Custom handwritten implementation\nexport default {};";
      await writeFile(handwrittenJs, handwrittenContent, "utf8");
      const jsHashBefore = createHash("sha256").update(handwrittenContent).digest("hex");

      const generated = generateThemePackage({
        themeSpec: STELLAR_CYAN_EXAMPLE,
        metadata: { name: "starlight-theme-handwritten", version: "0.1.0" },
      });

      await expect(writeThemePackage(generated, outDir)).rejects.toThrowError(FilesystemSafetyError);
      await expect(writeThemePackage(generated, outDir, { overwrite: true } as any)).rejects.toThrowError(
        /overwrite option is not supported/
      );

      const jsAfter = await readFile(handwrittenJs, "utf8");
      expect(jsAfter).toBe(handwrittenContent);
      expect(createHash("sha256").update(jsAfter).digest("hex")).toBe(jsHashBefore);
    });

    it("switching from template wrapper to CSS-only uses a new directory without pruning older package", async () => {
      const dirA = join(testDir, "pkg-with-template");
      const dirB = join(testDir, "pkg-css-only");

      // 1. Generate package with template into dirA
      const genWithTemplate = generateThemePackage({
        themeSpec: AMBER_FORGE_EXAMPLE,
        metadata: { name: "starlight-theme-amber", version: "0.1.0", template: "page-title-frame" },
      });
      await writeThemePackage(genWithTemplate, dirA);

      const templatePathA = join(dirA, "components/PageTitleFrame.astro");
      expect(await readFile(templatePathA, "utf8").then(() => true).catch(() => false)).toBe(true);

      // 2. Generating into dirA again fails (non-empty directory)
      const genCssOnly = generateThemePackage({
        themeSpec: STELLAR_CYAN_EXAMPLE,
        metadata: { name: "starlight-theme-amber", version: "0.1.1" },
      });
      await expect(writeThemePackage(genCssOnly, dirA)).rejects.toThrowError(FilesystemSafetyError);
      await expect(writeThemePackage(genCssOnly, dirA, { overwrite: true } as any)).rejects.toThrowError(
        FilesystemSafetyError
      );

      // dirA/components/PageTitleFrame.astro must still exist and be completely untouched
      expect(await readFile(templatePathA, "utf8").then(() => true).catch(() => false)).toBe(true);

      // 3. Generating into new directory dirB succeeds as fresh output
      const writeB = await writeThemePackage(genCssOnly, dirB);
      expect(writeB.filesWritten.length).toBe(genCssOnly.files.size);
      expect(writeB.filesPruned.length).toBe(0);
      expect(await readFile(templatePathA, "utf8").then(() => true).catch(() => false)).toBe(true);
      expect(await readFile(join(dirB, "components/PageTitleFrame.astro"), "utf8").then(() => true).catch(() => false)).toBe(false);
    });

    it("predictably rejects symlinks, dangling links, nonregular collisions, and invalid member paths", async () => {
      const generated = generateThemePackage({
        themeSpec: STELLAR_CYAN_EXAMPLE,
        metadata: { name: "starlight-theme-safety-checks", version: "0.1.0" },
      });

      // 4a. Symlinked directory
      const realDir = join(testDir, "real-safety-dir");
      const symlinkDir = join(testDir, "symlink-safety-dir");
      await mkdir(realDir, { recursive: true });
      await symlink(realDir, symlinkDir);
      await expect(writeThemePackage(generated, symlinkDir)).rejects.toThrowError(
        expect.objectContaining({ code: "SYMLINK_REJECTED" })
      );

      // 4b. Dangling symlink
      const danglingDir = join(testDir, "dangling-symlink");
      await symlink(join(testDir, "does-not-exist"), danglingDir);
      await expect(writeThemePackage(generated, danglingDir)).rejects.toThrowError(
        expect.objectContaining({ code: "SYMLINK_REJECTED" })
      );

      // 4c. Non-regular file collision
      const fileTarget = join(testDir, "regular-file-target.txt");
      await writeFile(fileTarget, "not a directory", "utf8");
      await expect(writeThemePackage(generated, fileTarget)).rejects.toThrowError(
        expect.objectContaining({ code: "NOT_A_DIRECTORY" })
      );

      // 4d. Invalid member paths: absolute, traversal, unnormalized
      const maliciousPkg1 = {
        ...generated,
        files: new Map(generated.files).set("../outside.txt", "payload"),
      };
      await expect(writeThemePackage(maliciousPkg1 as any, join(testDir, "fresh-1"))).rejects.toThrowError(
        expect.objectContaining({ code: "INVALID_MEMBER_PATH" })
      );

      const maliciousPkg2 = {
        ...generated,
        files: new Map(generated.files).set("/etc/passwd", "payload"),
      };
      await expect(writeThemePackage(maliciousPkg2 as any, join(testDir, "fresh-2"))).rejects.toThrowError(
        expect.objectContaining({ code: "INVALID_MEMBER_PATH" })
      );

      const maliciousPkg3 = {
        ...generated,
        files: new Map(generated.files).set("styles//nested.css", "payload"),
      };
      await expect(writeThemePackage(maliciousPkg3 as any, join(testDir, "fresh-3"))).rejects.toThrowError(
        expect.objectContaining({ code: "INVALID_MEMBER_PATH" })
      );

      // 4e. Intermediate symlink policy: parent directory with symlink resolves canonical parent and writes successfully
      const intermediateTarget = join(symlinkDir, "sub-package");
      const intermediateRes = await writeThemePackage(generated, intermediateTarget);
      expect(intermediateRes.filesWritten.length).toBe(generated.files.size);
      expect(await readFile(join(realDir, "sub-package", "package.json"), "utf8")).toBeDefined();

      // 4f. Ancestor path is a regular file (NOT_A_DIRECTORY)
      const ancestorFile = join(testDir, "ancestor-file.txt");
      await writeFile(ancestorFile, "not a directory", "utf8");
      await expect(writeThemePackage(generated, join(ancestorFile, "sub", "pkg"))).rejects.toThrowError(
        expect.objectContaining({ code: "NOT_A_DIRECTORY" })
      );

      // 4g. Intermediate dangling symlink policy: explicitly refused with SYMLINK_REJECTED
      const danglingParentSymlink = join(testDir, "dangling-parent-link");
      await symlink(join(testDir, "nonexistent-parent-target"), danglingParentSymlink);
      await expect(writeThemePackage(generated, join(danglingParentSymlink, "pkg"))).rejects.toThrowError(
        expect.objectContaining({ code: "SYMLINK_REJECTED" })
      );

      // 4h. Symlink ancestor resolves to a non-directory (NOT_A_DIRECTORY)
      const symlinkToFile = join(testDir, "symlink-to-file");
      await symlink(ancestorFile, symlinkToFile);
      await expect(writeThemePackage(generated, join(symlinkToFile, "pkg"))).rejects.toThrowError(
        expect.objectContaining({ code: "NOT_A_DIRECTORY" })
      );
    });

    it("cleans only owned staging output on failure and preserves caller-owned empty directory", async () => {
      const callerOwnedEmptyDir = join(testDir, "caller-empty");
      await mkdir(callerOwnedEmptyDir, { recursive: true });

      const valid = generateThemePackage({
        themeSpec: STELLAR_CYAN_EXAMPLE,
        metadata: { name: "starlight-theme-fail-clean", version: "0.1.0" },
      });
      // Use member paths that pass validation (no .. or /) but collide during staging
      // (writing a file over an existing directory or vice versa)
      const failingPkg = {
        ...valid,
        files: new Map(valid.files)
          .set("staging-collision", "file-content")
          .set("staging-collision/child.txt", "child-content"),
      };

      await expect(writeThemePackage(failingPkg as any, callerOwnedEmptyDir)).rejects.toThrowError(
        expect.objectContaining({ code: "FILESYSTEM_SAFETY_ERROR" })
      );

      // Caller-owned empty directory is NOT deleted and remains empty
      expect(await readdir(callerOwnedEmptyDir)).toEqual([]);

      // Verify no staging directories leaked in parent
      const parentEntries = await readdir(testDir);
      expect(parentEntries.filter((e) => e.includes(".staging."))).toEqual([]);

      // Verify rollback of newly created intermediate ancestor directories on staging failure
      const createdAncestorRoot = join(testDir, "created-ancestor-rollback");
      const deepTarget = join(createdAncestorRoot, "nested-1", "nested-2", "pkg");
      await expect(writeThemePackage(failingPkg as any, deepTarget)).rejects.toThrowError(
        expect.objectContaining({ code: "FILESYSTEM_SAFETY_ERROR" })
      );
      expect(existsSync(createdAncestorRoot)).toBe(false);
    });

    it("returns typed contrast diagnostics from pure generation matching compileTheme, and strict contrast rejects", () => {
      const lowContrastSpec = {
        name: "low-contrast-theme",
        version: "0.1.0",
        schemaVersion: "tfsl.theme-v1",
        adapter: "starlight-v0.42",
        colors: {
          dark: {
            accent: { base: "#111111", low: "#000000", high: "#222222" },
            neutrals: {
              bg: "#000000",
              bgNav: "#000000",
              bgSidebar: "#000000",
              bgInlineCode: "#000000",
              bgAccent: "#111111",
              text: "#111111",
              textAccent: "#111111",
              textInvert: "#000000",
              hairline: "#111111",
              hairlineLight: "#222222",
              hairlineShade: "#000000",
            },
            grays: {
              gray1: "#111111",
              gray2: "#222222",
              gray3: "#333333",
              gray4: "#444444",
              gray5: "#555555",
              gray6: "#666666",
              gray7: "#777777",
            },
          },
          light: {
            accent: { base: "#eeeeee", low: "#ffffff", high: "#dddddd" },
            neutrals: {
              bg: "#ffffff",
              bgNav: "#ffffff",
              bgSidebar: "#ffffff",
              bgInlineCode: "#ffffff",
              bgAccent: "#eeeeee",
              text: "#eeeeee",
              textAccent: "#eeeeee",
              textInvert: "#ffffff",
              hairline: "#eeeeee",
              hairlineLight: "#ffffff",
              hairlineShade: "#dddddd",
            },
            grays: {
              gray1: "#eeeeee",
              gray2: "#dddddd",
              gray3: "#cccccc",
              gray4: "#bbbbbb",
              gray5: "#aaaaaa",
              gray6: "#999999",
              gray7: "#888888",
            },
          },
        },
        typography: {
          bodyFont: "system-sans" as const,
          codeFont: "system-mono" as const,
        },
        layout: {
          contentWidth: "45rem",
          sidebarWidth: "18.75rem",
        },
      };

      const directCompilation = compileTheme(lowContrastSpec);
      expect(directCompilation.diagnostics.length).toBeGreaterThan(0);
      expect(directCompilation.diagnostics.some((d) => d.code === "CONTRAST_BELOW_THRESHOLD")).toBe(true);

      const packageResult = generateThemePackage({
        themeSpec: lowContrastSpec,
        metadata: { name: "starlight-theme-low-contrast", version: "0.1.0" },
      });
      expect(packageResult.diagnostics).toEqual(directCompilation.diagnostics);

      expect(() =>
        generateThemePackage({
          themeSpec: lowContrastSpec,
          metadata: { name: "starlight-theme-low-contrast", version: "0.1.0" },
          strictContrast: true,
        })
      ).toThrowError(ContrastError);
    });

    it("leaves existing directory byte-unchanged when generation or writing is rejected", async () => {
      const outDir = join(testDir, "rejection-target");
      await mkdir(outDir, { recursive: true });
      const sentinelPath = join(outDir, "sentinel.txt");
      const sentinelContent = "ORIGINAL_BYTES_DO_NOT_TOUCH";
      await writeFile(sentinelPath, sentinelContent, "utf8");
      const sentinelHashBefore = createHash("sha256").update(sentinelContent).digest("hex");

      // 1. Rejection due to non-empty directory without overwrite
      const validPkg = generateThemePackage({
        themeSpec: STELLAR_CYAN_EXAMPLE,
        metadata: { name: "starlight-theme-rejection", version: "1.0.0" },
      });
      await expect(writeThemePackage(validPkg, outDir, { overwrite: false })).rejects.toThrowError(
        FilesystemSafetyError
      );

      // Verify sentinel is still intact and byte-identical
      let currentSentinel = await readFile(sentinelPath, "utf8");
      expect(currentSentinel).toBe(sentinelContent);
      expect(createHash("sha256").update(currentSentinel).digest("hex")).toBe(sentinelHashBefore);
      let entries = await readdir(outDir);
      expect(entries).toEqual(["sentinel.txt"]);

      // 2. Rejection due to invalid metadata prior to writing
      expect(() => {
        validatePackageMetadata({
          name: "INVALID_UPPERCASE_NAME",
          version: "1.0.0",
        });
      }).toThrowError(ValidationError);

      currentSentinel = await readFile(sentinelPath, "utf8");
      expect(currentSentinel).toBe(sentinelContent);
      expect(createHash("sha256").update(currentSentinel).digest("hex")).toBe(sentinelHashBefore);
      entries = await readdir(outDir);
      expect(entries).toEqual(["sentinel.txt"]);

      // 3. Rejection due to unknown template ID
      expect(() => {
        generateThemePackage({
          themeSpec: STELLAR_CYAN_EXAMPLE,
          metadata: { name: "starlight-theme-rejection", version: "1.0.0", template: "unknown-template-xyz" },
        });
      }).toThrowError(ValidationError);

      currentSentinel = await readFile(sentinelPath, "utf8");
      expect(currentSentinel).toBe(sentinelContent);
      expect(createHash("sha256").update(currentSentinel).digest("hex")).toBe(sentinelHashBefore);
      entries = await readdir(outDir);
      expect(entries).toEqual(["sentinel.txt"]);
    });
  });

  describe("Theme Lab Interoperability", () => {
    it("successfully generates from a Theme Lab-saved theme JSON format", () => {
      // Format as constructed/saved by Theme Lab
      const themeLabSavedTheme = {
        name: "studio-saved-theme",
        version: "0.1.0",
        schemaVersion: "tfsl.theme-v1",
        adapter: "starlight-v0.42",
        colors: {
          dark: {
            accent: { base: "#ff4488", low: "#4d0022", high: "#ffaacc" },
            neutrals: {
              bg: "#0c0917",
              bgNav: "#141026",
              bgSidebar: "#100d20",
              bgInlineCode: "#1e1838",
              bgAccent: "#ff4488",
              text: "#f0edf9",
              textAccent: "#ffaacc",
              textInvert: "#0c0917",
              hairline: "#2a224d",
              hairlineLight: "#3d326e",
              hairlineShade: "#08060f",
            },
            grays: {
              gray1: "#f0edf9",
              gray2: "#d2cbe7",
              gray3: "#a69bc4",
              gray4: "#6e6293",
              gray5: "#3d326e",
              gray6: "#1e1838",
              gray7: "#100d20",
            },
          },
          light: {
            accent: { base: "#e0115f", low: "#ffe6f0", high: "#800030" },
            neutrals: {
              bg: "#ffffff",
              bgNav: "#fbfaff",
              bgSidebar: "#f6f4fc",
              bgInlineCode: "#ede9f8",
              bgAccent: "#e0115f",
              text: "#1a1528",
              textAccent: "#800030",
              textInvert: "#ffffff",
              hairline: "#e2ddf2",
              hairlineLight: "#ede9f8",
              hairlineShade: "#d2cbe7",
            },
            grays: {
              gray1: "#1a1528",
              gray2: "#2d2542",
              gray3: "#554b73",
              gray4: "#887da8",
              gray5: "#c4bce0",
              gray6: "#ede9f8",
              gray7: "#f6f4fc",
            },
          },
        },
        typography: {
          bodyFont: "system-sans",
          codeFont: "system-mono",
        },
        layout: {
          contentWidth: "45rem",
          sidebarWidth: "18.75rem",
        },
      };

      const result = generateThemePackage({
        themeSpec: themeLabSavedTheme,
        metadata: {
          name: "starlight-theme-studio-saved",
          version: "0.1.0",
          description: "Theme saved by Nebular Studio Theme Lab",
        },
      });

      expect(result.themeSpec.name).toBe("studio-saved-theme");
      expect(result.cssContent).toContain("--sl-color-accent: #ff4488;");
      expect(result.files.has("package.json")).toBe(true);
      expect(result.files.has("styles/theme.css")).toBe(true);
    });
  });
});
