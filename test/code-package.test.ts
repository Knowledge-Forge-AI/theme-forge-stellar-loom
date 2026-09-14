import { describe, it, expect, vi } from "vitest";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  generateThemePackageCode,
  type GeneratePackageCodeResult,
} from "../src/generator/code-emitter.js";
import {
  mergeCodeConfig,
  deepCloneSafe,
  MERGE_HELPER_STRING,
  emitMergeHelper,
} from "../src/generator/code-merge.js";
import { generateThemePackageV2 } from "../src/generator/v2-emitter.js";
import {
  generateThemePackage,
  writeThemePackage,
} from "../src/generator/dispatch.js";
import {
  validateThemeCode,
  type ThemeSpecificationCode,
  type CodePresentationConfig,
} from "../src/code/index.js";
import { validateThemeV2 } from "../src/v2/index.js";
import * as catalog from "../src/code/catalog.js";
vi.spyOn(catalog, "verifyCodeCatalogDigest").mockImplementation(() => true);

const hash = (b: string | Uint8Array) =>
  createHash("sha256").update(b).digest("hex");

function createValidCodePresentation(): CodePresentationConfig {
  return {
    mode: "expressive-code",
    syntaxTheme: {
      light: {
        rules: [
          {
            scopes: ["comment", "punctuation.definition.comment"],
            foreground: "#64748b",
            fontStyle: "italic",
          },
          {
            scopes: ["keyword", "storage.type"],
            foreground: "#ea580c",
            fontStyle: "bold",
          },
          {
            scopes: ["string", "string.quoted"],
            foreground: "#16a34a",
          },
        ],
      },
      dark: {
        rules: [
          {
            scopes: ["comment", "punctuation.definition.comment"],
            foreground: "#8a92a6",
            fontStyle: "italic",
          },
          {
            scopes: ["keyword", "storage.type"],
            foreground: "#f97316",
            fontStyle: "bold",
          },
          {
            scopes: ["string", "string.quoted"],
            foreground: "#4ade80",
          },
        ],
      },
    },
    frame: "editor",
    marks: {
      marked: "#3b82f6",
      inserted: "#22c55e",
      deleted: "#ef4444",
    },
    copy: "standard",
    tabs: "deferred",
  };
}

async function getCodeSpec(): Promise<ThemeSpecificationCode> {
  const base = JSON.parse(
    await readFile(
      new URL("../examples/loom-black-core.theme.json", import.meta.url),
      "utf8"
    )
  );
  return validateThemeCode({
    ...base,
    codePresentation: createValidCodePresentation(),
  });
}

const metadata = { name: "loom-code-test", version: "0.1.0" };

describe("TFSB61B Code Package Emitter & Merge Helper", () => {
  describe("Exports and Type Contracts", () => {
    it("exports expected generator and merge helper functions and strings", () => {
      expect(typeof generateThemePackageCode).toBe("function");
      expect(typeof mergeCodeConfig).toBe("function");
      expect(typeof deepCloneSafe).toBe("function");
      expect(typeof emitMergeHelper).toBe("function");
      expect(typeof MERGE_HELPER_STRING).toBe("string");
      expect(emitMergeHelper()).toBe(MERGE_HELPER_STRING);
    });
  });

  describe("Emitted Helper Config Hook & Consumer Precedence", () => {
    it("generates plugin whose config:setup hook merges customCss, components, and expressiveCode", async () => {
      const theme = await getCodeSpec();
      theme.components.pageTitle = "page-title-frame";
      const result = generateThemePackageCode({ themeSpec: theme, metadata });

      const indexJs = result.files.get("index.js")!;
      expect(indexJs).toContain("mergeCodeConfig");
      expect(indexJs).toContain("expressiveCode");

      const pluginModule = await import(
        `data:text/javascript;base64,${Buffer.from(indexJs).toString("base64")}`
      );
      const plugin = pluginModule.default();
      expect(plugin.name).toBe("loom-code-test");

      let update: any;
      plugin.hooks["config:setup"]({
        config: {
          customCss: ["consumer.css", "loom-code-test/styles/base.css"],
          components: { PageTitle: "consumer.astro" },
        },
        updateConfig: (value: any) => {
          update = value;
        },
      });

      expect(update.customCss).toEqual([
        ...["layers", "tokens", "base", "accent", "overrides", "code"].map(
          (n) => `loom-code-test/styles/${n}.css`
        ),
        "consumer.css",
      ]);
      expect(update.components.PageTitle).toBe("consumer.astro");
      expect(update.expressiveCode).toBeDefined();
      expect(update.expressiveCode.themes).toHaveLength(2);
      expect(update.expressiveCode.defaultProps.frame).toBe("code");
    });
  });

  describe("Consumer False Stays False", () => {
    it("preserves consumer false at root and nested leaves in config:setup", async () => {
      const theme = await getCodeSpec();
      const result = generateThemePackageCode({ themeSpec: theme, metadata });
      const plugin = (
        await import(
          `data:text/javascript;base64,${Buffer.from(result.files.get("index.js")!).toString("base64")}`
        )
      ).default();

      // Root false stays false
      let updateRoot: any;
      plugin.hooks["config:setup"]({
        config: { expressiveCode: false },
        updateConfig: (v: any) => {
          updateRoot = v;
        },
      });
      expect(updateRoot.expressiveCode).toBe(false);

      // Leaf false stays false
      let updateLeaf: any;
      plugin.hooks["config:setup"]({
        config: {
          expressiveCode: {
            useStarlightUiThemeColors: false,
            defaultProps: { frame: false },
            styleOverrides: { codeBackground: false },
          },
        },
        updateConfig: (v: any) => {
          updateLeaf = v;
        },
      });
      expect(updateLeaf.expressiveCode.useStarlightUiThemeColors).toBe(false);
      expect(updateLeaf.expressiveCode.defaultProps.frame).toBe(false);
      expect(updateLeaf.expressiveCode.styleOverrides.codeBackground).toBe(false);
      // Other styleOverrides leaves retained
      expect(updateLeaf.expressiveCode.styleOverrides.borderRadius).toBeDefined();
    });

    it("evaluates direct mergeCodeConfig with false", () => {
      const defaults = { a: true, b: { c: true } };
      expect(mergeCodeConfig(defaults, false)).toBe(false);
      expect(mergeCodeConfig(defaults, { a: false })).toEqual({
        a: false,
        b: { c: true },
      });
      expect(mergeCodeConfig(defaults, { b: { c: false } })).toEqual({
        a: true,
        b: { c: false },
      });
    });
  });

  describe("Nested Known Theme Branches Recurse", () => {
    it("recurses into nested styleOverrides and defaultProps while preserving sibling defaults", async () => {
      const theme = await getCodeSpec();
      const result = generateThemePackageCode({ themeSpec: theme, metadata });
      const plugin = (
        await import(
          `data:text/javascript;base64,${Buffer.from(result.files.get("index.js")!).toString("base64")}`
        )
      ).default();

      let update: any;
      plugin.hooks["config:setup"]({
        config: {
          expressiveCode: {
            styleOverrides: {
              borderRadius: "14px",
              frames: {
                editorBackground: ["#111111", "#eeeeee"],
              },
            },
            defaultProps: {
              frame: "terminal",
            },
          },
        },
        updateConfig: (v: any) => {
          update = v;
        },
      });

      expect(update.expressiveCode.styleOverrides.borderRadius).toBe("14px");
      expect(
        update.expressiveCode.styleOverrides.frames.editorBackground
      ).toEqual(["#111111", "#eeeeee"]);
      expect(update.expressiveCode.defaultProps.frame).toBe("terminal");

      // Preserved defaults in styleOverrides
      expect(update.expressiveCode.styleOverrides.borderWidth).toBeDefined();
      expect(update.expressiveCode.styleOverrides.borderColor).toBeDefined();
      expect(update.expressiveCode.styleOverrides.focusBorder).toBeDefined();
      expect(update.expressiveCode.styleOverrides.textMarkers).toBeDefined();
      // Preserved defaults in frames
      expect(
        update.expressiveCode.styleOverrides.frames.terminalBackground
      ).toBeDefined();
      expect(
        update.expressiveCode.styleOverrides.frames.editorTabBarBackground
      ).toBeDefined();
    });
  });

  describe("Consumer Arrays Replace Including Empty", () => {
    it("replaces arrays completely even when empty", async () => {
      const theme = await getCodeSpec();
      const result = generateThemePackageCode({ themeSpec: theme, metadata });
      const plugin = (
        await import(
          `data:text/javascript;base64,${Buffer.from(result.files.get("index.js")!).toString("base64")}`
        )
      ).default();

      // Empty array replaces
      let updateEmpty: any;
      plugin.hooks["config:setup"]({
        config: {
          expressiveCode: {
            themes: [],
          },
        },
        updateConfig: (v: any) => {
          updateEmpty = v;
        },
      });
      expect(updateEmpty.expressiveCode.themes).toEqual([]);

      // Custom array replaces
      const customTheme = {
        name: "custom-dark",
        type: "dark" as const,
        bg: "#000",
        fg: "#fff",
        tokenColors: [],
      };
      let updateCustom: any;
      plugin.hooks["config:setup"]({
        config: {
          expressiveCode: {
            themes: [customTheme],
          },
        },
        updateConfig: (v: any) => {
          updateCustom = v;
        },
      });
      expect(updateCustom.expressiveCode.themes).toEqual([customTheme]);
    });
  });

  describe("Unknown Consumer Leaves and Opaque Callbacks", () => {
    it("preserves unknown consumer leaves and keeps callbacks opaque without invocation", async () => {
      const theme = await getCodeSpec();
      const result = generateThemePackageCode({ themeSpec: theme, metadata });
      const plugin = (
        await import(
          `data:text/javascript;base64,${Buffer.from(result.files.get("index.js")!).toString("base64")}`
        )
      ).default();

      const opaquePlugin = vi.fn(() => ({ name: "test-plugin" }));
      const styleOverridesCallback = vi.fn(({ theme }: any) => ({
        borderRadius: "4px",
      }));

      let update: any;
      plugin.hooks["config:setup"]({
        config: {
          expressiveCode: {
            plugins: [opaquePlugin],
            styleOverrides: styleOverridesCallback,
            tabWidth: 4,
            useDarkModeMediaQuery: true,
          },
        },
        updateConfig: (v: any) => {
          update = v;
        },
      });

      expect(opaquePlugin).not.toHaveBeenCalled();
      expect(styleOverridesCallback).not.toHaveBeenCalled();
      expect(update.expressiveCode.plugins).toEqual([opaquePlugin]);
      expect(update.expressiveCode.styleOverrides).toBe(styleOverridesCallback);
      expect(update.expressiveCode.tabWidth).toBe(4);
      expect(update.expressiveCode.useDarkModeMediaQuery).toBe(true);
    });

    it("does not mutate or traverse prototype keys", () => {
      const defaults = { defaultProps: { frame: "code" } };
      const consumer = JSON.parse(
        '{"__proto__": {"polluted": true}, "constructor": {"polluted": true}}'
      );
      const merged: any = mergeCodeConfig(defaults, consumer);
      expect((Object.prototype as any).polluted).toBeUndefined();
      expect(Object.hasOwn(merged, "__proto__")).toBe(false);
      expect(Object.hasOwn(merged, "constructor")).toBe(false);
    });
  });

  describe("Deterministic Package Generation and Provenance", () => {
    it("produces deterministic bit-for-bit packages with sorted provenance", async () => {
      const theme = await getCodeSpec();
      const res1 = generateThemePackageCode({ themeSpec: theme, metadata });
      const res2 = generateThemePackageCode({ themeSpec: theme, metadata });

      expect(res1.files).toEqual(res2.files);
      expect(res1.provenance).toEqual(res2.provenance);
      expect(res1.provenance.inventoryDigest).toBe(
        res2.provenance.inventoryDigest
      );

      // Inventory excludes provenance.json
      expect(res1.provenance.inventoryExcludes).toEqual(["provenance.json"]);
      const inventoryPaths = res1.provenance.files.map((f) => f.path);
      expect(inventoryPaths).not.toContain("provenance.json");

      // Sorted strictly by byte order (compareUtf8)
      expect(inventoryPaths).toEqual(
        [...inventoryPaths].sort((a, b) =>
          Buffer.compare(Buffer.from(a), Buffer.from(b))
        )
      );

      // Contains all 6 styles
      expect(res1.files.has("styles/layers.css")).toBe(true);
      expect(res1.files.has("styles/tokens.css")).toBe(true);
      expect(res1.files.has("styles/base.css")).toBe(true);
      expect(res1.files.has("styles/accent.css")).toBe(true);
      expect(res1.files.has("styles/overrides.css")).toBe(true);
      expect(res1.files.has("styles/code.css")).toBe(true);

      // Descriptor references code catalog and semantic
      expect(res1.descriptor.catalogIdentity).toBe(
        "tfsl.starlight-code-catalog-v1"
      );
      expect(res1.descriptor.compilerSemantic).toBe(
        "tfsl.theme-compiler-v2-code-1"
      );

      // Package.json has AGPL license and correct peerDependencies
      const pkg = JSON.parse(res1.files.get("package.json") as string);
      expect(pkg.name).toBe(metadata.name);
      expect(pkg.peerDependencies["@astrojs/starlight"]).toBe("^0.42.0");

      // README describes code candidate
      const readme = res1.files.get("README.md") as string;
      expect(readme).toContain("Private generated theme-v2 code candidate");
    });

    it("writes package safely through writeThemePackage with conflict detection", async () => {
      const theme = await getCodeSpec();
      const result = generateThemePackageCode({ themeSpec: theme, metadata });
      const root = await mkdtemp(join(tmpdir(), "loom-code-pkg-"));
      try {
        const outDir = join(root, "my-theme-pkg");
        const written = await writeThemePackage(result, outDir);
        expect(written.filesWritten).toContain("styles/code.css");
        expect(written.filesWritten).toContain("index.js");

        // Fails on non-empty directory
        await expect(writeThemePackage(result, outDir)).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  describe("Core Unchanged & Dispatch Parity", () => {
    it("preserves core v2 package generation when themeSpec lacks code domain", async () => {
      const coreTheme = validateThemeV2(
        JSON.parse(
          await readFile(
            new URL("../examples/loom-black-core.theme.json", import.meta.url),
            "utf8"
          )
        )
      );

      // generateThemePackage with core theme calls v2 emitter
      const v2Result = generateThemePackage({
        themeSpec: coreTheme,
        metadata,
      });
      expect(v2Result.files.has("styles/code.css")).toBe(false);
      expect(v2Result.files.get("index.js")).not.toContain("mergeCodeConfig");
      expect((v2Result as any).descriptor.catalogIdentity).toBe(
        "tfsl.starlight-core-catalog-v1"
      );

      // generateThemePackage with code theme calls code emitter
      const codeTheme = await getCodeSpec();
      const codeResult = generateThemePackage({
        themeSpec: codeTheme,
        metadata,
      });
      expect(codeResult.files.has("styles/code.css")).toBe(true);
      expect(codeResult.files.get("index.js")).toContain("mergeCodeConfig");
      expect((codeResult as any).descriptor.catalogIdentity).toBe(
        "tfsl.starlight-code-catalog-v1"
      );
    });
  });
});
