import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import {
  materializeFontResources,
  FontResourceDeclaration,
  FontResourceError,
  MAX_FONT_DECLARATIONS,
  MAX_PER_FONT_BYTES,
  MAX_AGGREGATE_BYTES,
} from "../src/font-resources.js";

/** Helper to compute lowercase SHA-256 hex string */
function sha256(data: Buffer | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

describe("font-resources materialization", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "stellar-loom-font-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  });

  // Explicitly NON-rendering synthetic fixture bytes
  const NON_RENDERING_WOFF2_A = Buffer.from(
    "STELLAR_LOOM_SYNTHETIC_TEST_NON_RENDERING_WOFF2_A_PAYLOAD"
  );
  const NON_RENDERING_WOFF_B = Buffer.from(
    "STELLAR_LOOM_SYNTHETIC_TEST_NON_RENDERING_WOFF_B_PAYLOAD"
  );
  const NON_RENDERING_WOFF2_C = Buffer.from(
    "STELLAR_LOOM_SYNTHETIC_TEST_NON_RENDERING_WOFF2_C_PAYLOAD"
  );

  describe("happy path and binary exactness", () => {
    it("rejects an empty resource even when its digest matches", async () => {
      await writeFile(join(testDir, "empty.woff2"), Buffer.alloc(0));
      await expect(materializeFontResources(testDir,
        [{ id: "empty", format: "woff2", sha256: sha256(Buffer.alloc(0)) }], ["empty"]))
        .rejects.toThrow(/Empty font resource/);
    });

    it("materializes a single valid woff2 font with exact binary content", async () => {
      const id = "inter-regular";
      const format = "woff2";
      const digest = sha256(NON_RENDERING_WOFF2_A);

      await writeFile(join(testDir, `${id}.${format}`), NON_RENDERING_WOFF2_A);

      const decl: FontResourceDeclaration = {
        id,
        format,
        sha256: digest,
      };

      const result = await materializeFontResources(testDir, [decl], [id]);

      expect(result.size).toBe(1);
      expect(result.has(id)).toBe(true);

      const bytes = result.get(id);
      expect(bytes).toBeDefined();
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(Buffer.compare(Buffer.from(bytes!), NON_RENDERING_WOFF2_A)).toBe(0);
      expect(sha256(bytes!)).toBe(digest);
    });

    it("materializes multiple fonts (woff and woff2) preserving IDs and exact bytes", async () => {
      const declA: FontResourceDeclaration = {
        id: "inter-bold",
        format: "woff2",
        sha256: sha256(NON_RENDERING_WOFF2_A),
      };
      const declB: FontResourceDeclaration = {
        id: "fira-code-regular",
        format: "woff",
        sha256: sha256(NON_RENDERING_WOFF_B),
      };

      await writeFile(join(testDir, "inter-bold.woff2"), NON_RENDERING_WOFF2_A);
      await writeFile(join(testDir, "fira-code-regular.woff"), NON_RENDERING_WOFF_B);

      const result = await materializeFontResources(
        testDir,
        [declA, declB],
        ["inter-bold", "fira-code-regular"]
      );

      expect(result.size).toBe(2);
      expect(Buffer.compare(Buffer.from(result.get("inter-bold")!), NON_RENDERING_WOFF2_A)).toBe(0);
      expect(Buffer.compare(Buffer.from(result.get("fira-code-regular")!), NON_RENDERING_WOFF_B)).toBe(0);
    });

    it("structurally supports broader v2 font records with family, weight, style, license", async () => {
      const id = "source-sans-400";
      const format = "woff2";
      const digest = sha256(NON_RENDERING_WOFF2_C);

      await writeFile(join(testDir, `${id}.${format}`), NON_RENDERING_WOFF2_C);

      const broaderDecl = {
        id,
        format: "woff2" as const,
        sha256: digest,
        family: "Source Sans 3",
        weight: 400,
        style: "normal",
        license: "SIL OFL 1.1",
        notice: "Non-rendering synthetic test fixture",
      };

      const result = await materializeFontResources(testDir, [broaderDecl], [id]);
      expect(result.has(id)).toBe(true);
      expect(Buffer.compare(Buffer.from(result.get(id)!), NON_RENDERING_WOFF2_C)).toBe(0);
    });

    it("returns copied isolated bytes so mutating output does not alter original", async () => {
      const id = "copy-isolation-test";
      const format = "woff2";
      const original = Buffer.from("SYNTHETIC_COPY_ISOLATION_FIXTURE");
      const digest = sha256(original);

      await writeFile(join(testDir, `${id}.${format}`), original);

      const decl: FontResourceDeclaration = { id, format, sha256: digest };
      const result = await materializeFontResources(testDir, [decl], [id]);

      const bytes = result.get(id)!;
      expect(bytes[0]).toBe(original[0]);

      // Mutate the returned Uint8Array
      bytes[0] = 0xff;

      // Re-read independently to verify disk/source was unaffected
      const result2 = await materializeFontResources(testDir, [decl], [id]);
      expect(result2.get(id)![0]).toBe(original[0]);
    });

    it("returns a ReadonlyMap that rejects mutations (.set, .delete, .clear)", async () => {
      const id = "readonly-map-test";
      const format = "woff2";
      const digest = sha256(NON_RENDERING_WOFF2_A);

      await writeFile(join(testDir, `${id}.${format}`), NON_RENDERING_WOFF2_A);

      const decl: FontResourceDeclaration = { id, format, sha256: digest };
      const result = await materializeFontResources(testDir, [decl], [id]);

      expect(() => (result as any).set("evil", new Uint8Array([1]))).toThrow(TypeError);
      expect(() => (result as any).delete(id)).toThrow(TypeError);
      expect(() => (result as any).clear()).toThrow(TypeError);
      expect(Object.isFrozen(result)).toBe(true);
    });

    it("returns an empty map when declarations and selectedIds are both empty", async () => {
      const result = await materializeFontResources(testDir, [], []);
      expect(result.size).toBe(0);
      expect([...result.keys()]).toEqual([]);
    });

    it("supports boundary of exactly 8 font declarations (MAX_FONT_DECLARATIONS)", async () => {
      const decls: FontResourceDeclaration[] = [];
      const selectedIds: string[] = [];

      for (let i = 1; i <= MAX_FONT_DECLARATIONS; i++) {
        const id = `font-variant-${i}`;
        const payload = Buffer.from(`NON_RENDERING_PAYLOAD_${i}`);
        await writeFile(join(testDir, `${id}.woff2`), payload);
        decls.push({ id, format: "woff2", sha256: sha256(payload) });
        selectedIds.push(id);
      }

      const result = await materializeFontResources(testDir, decls, selectedIds);
      expect(result.size).toBe(8);
      for (let i = 1; i <= MAX_FONT_DECLARATIONS; i++) {
        expect(result.has(`font-variant-${i}`)).toBe(true);
      }
    });
  });

  describe("selectedIds and declarations coverage verification", () => {
    it("rejects duplicate IDs in declarations", async () => {
      const decl1: FontResourceDeclaration = {
        id: "dupe-font",
        format: "woff2",
        sha256: "a".repeat(64),
      };
      const decl2: FontResourceDeclaration = {
        id: "dupe-font",
        format: "woff",
        sha256: "b".repeat(64),
      };

      await expect(
        materializeFontResources(testDir, [decl1, decl2], ["dupe-font"])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "DUPLICATE_ID" })
      );
    });

    it("rejects duplicate IDs in selectedIds", async () => {
      const decl: FontResourceDeclaration = {
        id: "test-font",
        format: "woff2",
        sha256: sha256(NON_RENDERING_WOFF2_A),
      };
      await writeFile(join(testDir, "test-font.woff2"), NON_RENDERING_WOFF2_A);

      await expect(
        materializeFontResources(testDir, [decl], ["test-font", "test-font"])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "DUPLICATE_ID" })
      );
    });

    it("rejects unselected declarations (declared but missing from selectedIds)", async () => {
      const decl1: FontResourceDeclaration = {
        id: "font-selected",
        format: "woff2",
        sha256: sha256(NON_RENDERING_WOFF2_A),
      };
      const decl2: FontResourceDeclaration = {
        id: "font-omitted",
        format: "woff2",
        sha256: sha256(NON_RENDERING_WOFF2_C),
      };
      await writeFile(join(testDir, "font-selected.woff2"), NON_RENDERING_WOFF2_A);
      await writeFile(join(testDir, "font-omitted.woff2"), NON_RENDERING_WOFF2_C);

      await expect(
        materializeFontResources(testDir, [decl1, decl2], ["font-selected"])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "UNSELECTED_DECLARATION" })
      );
    });

    it("rejects extra selected IDs (in selectedIds but missing from declarations)", async () => {
      const decl: FontResourceDeclaration = {
        id: "font-one",
        format: "woff2",
        sha256: sha256(NON_RENDERING_WOFF2_A),
      };
      await writeFile(join(testDir, "font-one.woff2"), NON_RENDERING_WOFF2_A);

      await expect(
        materializeFontResources(testDir, [decl], ["font-one", "font-two"])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "MISSING_DECLARATION" })
      );
    });

    it("rejects when declarations are present but selectedIds is empty", async () => {
      const decl: FontResourceDeclaration = {
        id: "font-one",
        format: "woff2",
        sha256: sha256(NON_RENDERING_WOFF2_A),
      };

      await expect(
        materializeFontResources(testDir, [decl], [])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "UNSELECTED_DECLARATION" })
      );
    });

    it("rejects when selectedIds has items but declarations is empty", async () => {
      await expect(
        materializeFontResources(testDir, [], ["font-ghost"])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "MISSING_DECLARATION" })
      );
    });

    it("rejects when declarations exceed maximum of 8", async () => {
      const decls: FontResourceDeclaration[] = [];
      const ids: string[] = [];
      for (let i = 1; i <= 9; i++) {
        decls.push({ id: `font-${i}`, format: "woff2", sha256: "0".repeat(64) });
        ids.push(`font-${i}`);
      }

      await expect(
        materializeFontResources(testDir, decls, ids)
      ).rejects.toThrowError(
        expect.objectContaining({ code: "TOO_MANY_FONTS" })
      );
    });

    it("rejects when selectedIds exceed maximum of 8", async () => {
      const decls: FontResourceDeclaration[] = [];
      const ids: string[] = [];
      for (let i = 1; i <= 9; i++) {
        ids.push(`font-${i}`);
      }

      await expect(
        materializeFontResources(testDir, decls, ids)
      ).rejects.toThrowError(
        expect.objectContaining({ code: "TOO_MANY_FONTS" })
      );
    });
  });

  describe("safe lower-case IDs and prototype name exclusion", () => {
    it.each([
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "__proto__",
      "prototype",
      "isPrototypeOf",
      "propertyIsEnumerable",
      "toLocaleString",
    ])("rejects prototype property name '%s'", async (protoName) => {
      const decl: FontResourceDeclaration = {
        id: protoName,
        format: "woff2",
        sha256: "0".repeat(64),
      };

      await expect(
        materializeFontResources(testDir, [decl], [protoName])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "PROTOTYPE_NAME_FORBIDDEN" })
      );
    });

    it.each([
      ["uppercase letters", "Inter-Regular"],
      ["all uppercase", "ROBOTO"],
      ["embedded space", "font name"],
      ["embedded dot", "font.name"],
      ["slash", "sub/font"],
      ["backslash", "sub\\font"],
      ["special character @", "font@1"],
      ["leading hyphen", "-font"],
      ["leading underscore", "_font"],
      ["empty string", ""],
      ["exceeds 64 chars", "a".repeat(65)],
    ])("rejects unsafe ID: %s ('%s')", async (_, invalidId) => {
      const decl: FontResourceDeclaration = {
        id: invalidId,
        format: "woff2",
        sha256: "0".repeat(64),
      };

      await expect(
        materializeFontResources(testDir, [decl], [invalidId])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "INVALID_ID" })
      );
    });
  });

  describe("format and sha256 validation", () => {
    it.each(["ttf", "otf", "eot", "svg", "woff3", ""])(
      "rejects unsupported format '%s'",
      async (format) => {
        const decl = {
          id: "test-font",
          format: format as any,
          sha256: "0".repeat(64),
        };

        await expect(
          materializeFontResources(testDir, [decl], ["test-font"])
        ).rejects.toThrowError(
          expect.objectContaining({ code: "INVALID_FORMAT" })
        );
      }
    );

    it.each([
      ["too short", "abc"],
      ["too long", "a".repeat(65)],
      ["non-hex characters", "z".repeat(64)],
      ["contains spaces", " " + "a".repeat(63)],
      ["empty string", ""],
    ])("rejects invalid sha256: %s", async (_, invalidSha) => {
      const decl: FontResourceDeclaration = {
        id: "test-font",
        format: "woff2",
        sha256: invalidSha,
      };

      await expect(
        materializeFontResources(testDir, [decl], ["test-font"])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "INVALID_SHA256" })
      );
    });

    it("rejects digest mismatch when file content does not match declaration sha256", async () => {
      const id = "tampered-font";
      const format = "woff2";
      await writeFile(join(testDir, `${id}.${format}`), NON_RENDERING_WOFF2_A);

      const decl: FontResourceDeclaration = {
        id,
        format,
        sha256: "e".repeat(64), // Mismatched digest
      };

      await expect(
        materializeFontResources(testDir, [decl], [id])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "DIGEST_MISMATCH" })
      );
    });
  });

  describe("size limits: 4 MiB per font, 16 MiB aggregate", () => {
    it("allows a font file of exactly 4 MiB", async () => {
      const id = "four-mib-font";
      const format = "woff2";
      const fourMibPayload = Buffer.alloc(MAX_PER_FONT_BYTES, 0x42);
      const digest = sha256(fourMibPayload);

      await writeFile(join(testDir, `${id}.${format}`), fourMibPayload);

      const decl: FontResourceDeclaration = { id, format, sha256: digest };
      const result = await materializeFontResources(testDir, [decl], [id]);
      expect(result.get(id)!.byteLength).toBe(MAX_PER_FONT_BYTES);
    });

    it("rejects a font file exceeding 4 MiB by 1 byte", async () => {
      const id = "oversize-font";
      const format = "woff2";
      const oversizePayload = Buffer.alloc(MAX_PER_FONT_BYTES + 1, 0x42);
      const digest = sha256(oversizePayload);

      await writeFile(join(testDir, `${id}.${format}`), oversizePayload);

      const decl: FontResourceDeclaration = { id, format, sha256: digest };
      await expect(
        materializeFontResources(testDir, [decl], [id])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "FONT_TOO_LARGE" })
      );
    });

    it("allows aggregate size of exactly 16 MiB (4 fonts of 4 MiB)", async () => {
      const decls: FontResourceDeclaration[] = [];
      const ids: string[] = [];

      for (let i = 1; i <= 4; i++) {
        const id = `four-mib-${i}`;
        const payload = Buffer.alloc(MAX_PER_FONT_BYTES, i);
        await writeFile(join(testDir, `${id}.woff2`), payload);
        decls.push({ id, format: "woff2", sha256: sha256(payload) });
        ids.push(id);
      }

      const result = await materializeFontResources(testDir, decls, ids);
      expect(result.size).toBe(4);
    });

    it("rejects aggregate size exceeding 16 MiB across multiple files", async () => {
      const decls: FontResourceDeclaration[] = [];
      const ids: string[] = [];

      // 5 files of 3.5 MiB each = 17.5 MiB (> 16 MiB)
      const sizeEach = 3.5 * 1024 * 1024;
      for (let i = 1; i <= 5; i++) {
        const id = `font-chunk-${i}`;
        const payload = Buffer.alloc(sizeEach, i);
        await writeFile(join(testDir, `${id}.woff2`), payload);
        decls.push({ id, format: "woff2", sha256: sha256(payload) });
        ids.push(id);
      }

      await expect(
        materializeFontResources(testDir, decls, ids)
      ).rejects.toThrowError(
        expect.objectContaining({ code: "AGGREGATE_TOO_LARGE" })
      );
    });
  });

  describe("path traversal prevention", () => {
    it("rejects directory traversal in font ID ('../evil')", async () => {
      const decl: FontResourceDeclaration = {
        id: "../evil",
        format: "woff2",
        sha256: "0".repeat(64),
      };

      await expect(
        materializeFontResources(testDir, [decl], ["../evil"])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "INVALID_ID" })
      );
    });

    it("rejects traversal segment '..' in root directory path", async () => {
      const subDir = join(testDir, "sub");
      await mkdir(subDir);
      const traversalRoot = `${subDir}/../escape`;

      const decl: FontResourceDeclaration = {
        id: "inter",
        format: "woff2",
        sha256: "0".repeat(64),
      };

      await expect(
        materializeFontResources(traversalRoot, [decl], ["inter"])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "TRAVERSAL_DETECTED" })
      );
    });
  });

  describe("symlink rejection on ancestors and leaf files", () => {
    it("rejects leaf font file that is a symbolic link", async () => {
      const realFile = join(testDir, "real-external.woff2");
      await writeFile(realFile, NON_RENDERING_WOFF2_A);

      const symlinkLeaf = join(testDir, "symlink-font.woff2");
      await symlink(realFile, symlinkLeaf);

      const decl: FontResourceDeclaration = {
        id: "symlink-font",
        format: "woff2",
        sha256: sha256(NON_RENDERING_WOFF2_A),
      };

      await expect(
        materializeFontResources(testDir, [decl], ["symlink-font"])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "SYMLINK_REJECTED" })
      );
    });

    it("rejects root directory when it is a symbolic link", async () => {
      const realDir = join(testDir, "real-root");
      await mkdir(realDir);
      await writeFile(join(realDir, "font.woff2"), NON_RENDERING_WOFF2_A);

      const symlinkRoot = join(testDir, "symlink-root");
      await symlink(realDir, symlinkRoot);

      const decl: FontResourceDeclaration = {
        id: "font",
        format: "woff2",
        sha256: sha256(NON_RENDERING_WOFF2_A),
      };

      await expect(
        materializeFontResources(symlinkRoot, [decl], ["font"])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "SYMLINK_REJECTED" })
      );
    });

    it("rejects ancestor directory that is a non-system symbolic link", async () => {
      const realParent = join(testDir, "real-parent");
      const fontDir = join(realParent, "fonts");
      await mkdir(fontDir, { recursive: true });
      await writeFile(join(fontDir, "font.woff2"), NON_RENDERING_WOFF2_A);

      const symlinkParent = join(testDir, "symlink-parent");
      await symlink(realParent, symlinkParent);

      const decl: FontResourceDeclaration = {
        id: "font",
        format: "woff2",
        sha256: sha256(NON_RENDERING_WOFF2_A),
      };

      // Root path passes through symlinkParent ancestor
      const symlinkAncestorRoot = join(symlinkParent, "fonts");

      await expect(
        materializeFontResources(symlinkAncestorRoot, [decl], ["font"])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "SYMLINK_REJECTED" })
      );
    });

    it("allows valid directories under macOS system symlinks (/tmp, /var)", async () => {
      // tmpdir() on macOS is in /var/folders/... (which starts with /var -> private/var)
      // Normal directories created under tmpdir() should succeed
      const id = "sys-root-test";
      const format = "woff2";
      const digest = sha256(NON_RENDERING_WOFF2_A);

      await writeFile(join(testDir, `${id}.${format}`), NON_RENDERING_WOFF2_A);

      const decl: FontResourceDeclaration = { id, format, sha256: digest };
      const result = await materializeFontResources(testDir, [decl], [id]);
      expect(result.has(id)).toBe(true);
    });
  });

  describe("regular file snapshot and root directory validation", () => {
    it("rejects missing leaf font file (ENOENT)", async () => {
      const decl: FontResourceDeclaration = {
        id: "missing-font",
        format: "woff2",
        sha256: "0".repeat(64),
      };

      await expect(
        materializeFontResources(testDir, [decl], ["missing-font"])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "MISSING_FONT_FILE" })
      );
    });

    it("rejects leaf that is a directory instead of a regular file", async () => {
      const id = "dir-as-font";
      await mkdir(join(testDir, `${id}.woff2`));

      const decl: FontResourceDeclaration = {
        id,
        format: "woff2",
        sha256: "0".repeat(64),
      };

      await expect(
        materializeFontResources(testDir, [decl], [id])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "NOT_A_REGULAR_FILE" })
      );
    });

    it("rejects root that does not exist", async () => {
      const nonExistent = join(testDir, "does-not-exist");
      const decl: FontResourceDeclaration = {
        id: "font",
        format: "woff2",
        sha256: "0".repeat(64),
      };

      await expect(
        materializeFontResources(nonExistent, [decl], ["font"])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "INVALID_ROOT" })
      );
    });

    it("rejects root that is a regular file instead of a directory", async () => {
      const filePath = join(testDir, "file-not-dir.txt");
      await writeFile(filePath, "not a directory");

      const decl: FontResourceDeclaration = {
        id: "font",
        format: "woff2",
        sha256: "0".repeat(64),
      };

      await expect(
        materializeFontResources(filePath, [decl], ["font"])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "NOT_A_DIRECTORY" })
      );
    });

    it("rejects empty root directory path", async () => {
      const decl: FontResourceDeclaration = {
        id: "font",
        format: "woff2",
        sha256: "0".repeat(64),
      };

      await expect(
        materializeFontResources("", [decl], ["font"])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "INVALID_ROOT" })
      );
    });

    it("rejects non-array declarations argument", async () => {
      await expect(
        materializeFontResources(testDir, null as any, [])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "INVALID_DECLARATION" })
      );
    });

    it("rejects non-array selectedIds argument", async () => {
      await expect(
        materializeFontResources(testDir, [], null as any)
      ).rejects.toThrowError(
        expect.objectContaining({ code: "INVALID_SELECTED_IDS" })
      );
    });

    it("rejects invalid non-object declaration entry", async () => {
      await expect(
        materializeFontResources(testDir, [null as any], ["font"])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "INVALID_DECLARATION" })
      );
    });

    it("accepts uppercase hex in declaration sha256 and matches case-insensitively", async () => {
      const id = "uppercase-hash-test";
      const format = "woff2";
      const digest = sha256(NON_RENDERING_WOFF2_A);

      await writeFile(join(testDir, `${id}.${format}`), NON_RENDERING_WOFF2_A);

      const decl: FontResourceDeclaration = {
        id,
        format,
        sha256: digest.toUpperCase(),
      };

      const result = await materializeFontResources(testDir, [decl], [id]);
      expect(result.has(id)).toBe(true);
    });

    it("rejects internal symlink leaf pointing to another file in root", async () => {
      const realFile = join(testDir, "real-target.woff2");
      await writeFile(realFile, NON_RENDERING_WOFF2_A);

      const symlinkFile = join(testDir, "internal-sym.woff2");
      await symlink(realFile, symlinkFile);

      const decl: FontResourceDeclaration = {
        id: "internal-sym",
        format: "woff2",
        sha256: sha256(NON_RENDERING_WOFF2_A),
      };

      await expect(
        materializeFontResources(testDir, [decl], ["internal-sym"])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "SYMLINK_REJECTED" })
      );
    });

    it("rejects non-regular file such as a FIFO pipe (regular file snapshot)", async () => {
      const { execFileSync } = await import("node:child_process");
      const id = "fifo-font";
      const fifoPath = join(testDir, `${id}.woff2`);
      try {
        execFileSync("mkfifo", [fifoPath]);
      } catch {
        // Skip if platform does not support mkfifo
        return;
      }

      const decl: FontResourceDeclaration = {
        id,
        format: "woff2",
        sha256: "0".repeat(64),
      };

      await expect(
        materializeFontResources(testDir, [decl], [id])
      ).rejects.toThrowError(
        expect.objectContaining({ code: "NOT_A_REGULAR_FILE" })
      );
    });
  });
});
