import { describe, it, expect } from "vitest";
import { readFile, mkdtemp, mkdir, writeFile, readdir, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { generateThemePackageV2 } from "../src/generator/v2-emitter.js";
import { writeV2Files } from "../src/generator/v2-writer.js";
import { validateThemeV2 } from "../src/v2/index.js";
import { compileTheme, generateThemePackage, writeThemePackage, processBatchRequest } from "../src/index.js";

const spec = async () => validateThemeV2(JSON.parse(await readFile(new URL("../examples/loom-black-core.theme.json", import.meta.url), "utf8")));
const metadata = { name: "loom-core-test", version: "0.1.0" };
const hash = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
describe("v2 package/public surfaces", () => {
  it("dispatches the same compiler through library, generator and batch", async () => {
    const theme = await spec();
    const compiled = compileTheme(theme);
    const generated = generateThemePackage({ themeSpec: theme, metadata });
    expect(generated.cssOutputDigest).toBe(compiled.outputDigest);
    const batch = processBatchRequest({ action: "compile", specification: theme });
    expect(batch.compiledCss).toBe(compiled.css);
    expect(batch.styles).toEqual([...compiled.styles].map(([path, css]) => ({ path, css })));
  });
  it("preserves fixed style order and consumer CSS/component overrides", async () => {
    const theme = await spec(); theme.components.pageTitle = "page-title-frame";
    const result = generateThemePackageV2({ themeSpec: theme, metadata });
    const plugin = (await import(`data:text/javascript;base64,${Buffer.from(result.files.get("index.js")!).toString("base64")}`)).default();
    let update: any;
    plugin.hooks["config:setup"]({ config: { customCss: ["consumer.css", "loom-core-test/styles/base.css"], components: { PageTitle: "consumer.astro" }, expressiveCode: false }, updateConfig: (value: any) => { update = value; } });
    expect(update.customCss).toEqual(["layers", "tokens", "base", "accent", "overrides"].map(n => `loom-core-test/styles/${n}.css`).concat("consumer.css"));
    expect(update.components.PageTitle).toBe("consumer.astro");
    expect(update).not.toHaveProperty("expressiveCode");
    expect(() => generateThemePackageV2({ themeSpec: { ...theme, components: { pageTitle: "consumer-default" } }, metadata: { ...metadata, template: "page-title-frame" } })).toThrow(/authority/);
  });
  it("pins package provenance bytes and uses byte order without locale collation", async () => {
    const theme = await spec();
    const original = String.prototype.localeCompare;
    String.prototype.localeCompare = () => { throw new Error("locale collation is forbidden"); };
    try {
      const result = generateThemePackageV2({ themeSpec: theme, metadata });
      const paths = result.provenance.files.map(file => file.path);
      expect(paths).toEqual([...paths].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
      // Release 0.2.0 producer metadata changes the descriptor and its receipt.
      expect(result.provenance.inventoryDigest).toBe("4f0e8a951023b21336ed83d3b7573e00cf875a42945e60e124c60f69f08fec00");
      expect(hash(result.files.get("provenance.json")!)).toBe("f5410f7d04b862d1c7ecb8ddef8dfe93e957e4fe9c6782986535eb101db19f46");
      expect(generateThemePackageV2({ themeSpec: theme, metadata }).files).toEqual(result.files);
    } finally { String.prototype.localeCompare = original; }
  });
  it("binds copied binary bytes and refuses missing/mismatched resources", async () => {
    const theme = await spec();
    const bytes = new Uint8Array([0, 255, 128, 13, 10, 1]); // Original NON-rendering pipeline fixture, not a valid font.
    theme.fonts = [{ id: "fixture", family: "Original Fixture", style: "normal", weight: 400, format: "woff2", sha256: hash(bytes), license: "original-fixture", notice: "non-rendering-fixture" }];
    expect(() => generateThemePackageV2({ themeSpec: theme, metadata })).toThrow(/resources/);
    const resources = new Map([["fixture", bytes]]);
    const generated = generateThemePackageV2({ themeSpec: theme, metadata, fontResources: resources });
    bytes[0] = 9;
    expect(generated.files.get("fonts/font-00.woff2")).toEqual(new Uint8Array([0, 255, 128, 13, 10, 1]));
    expect(() => generateThemePackageV2({ themeSpec: theme, metadata, fontResources: resources })).toThrow(/digest/);
  });
  it("publishes deterministic absent/empty destinations and preserves manual files", async () => {
    const root = await mkdtemp(join(tmpdir(), "loom-v2-package-"));
    try {
      const result = generateThemePackageV2({ themeSpec: await spec(), metadata });
      const a = join(root, "a"); const b = join(root, "b"); await mkdir(b);
      await writeThemePackage(result, a); await writeThemePackage(result, b);
      for (const [name, bytes] of result.files) {
        expect(await readFile(join(a, name))).toEqual(Buffer.from(bytes));
        expect(await readFile(join(b, name))).toEqual(Buffer.from(bytes));
      }
      await writeFile(join(a, "manual.txt"), "retain");
      await expect(writeThemePackage(result, a)).rejects.toThrow();
      expect(await readFile(join(a, "manual.txt"), "utf8")).toBe("retain");
      await expect(writeThemePackage(result, join(root, "c"), { overwrite: true })).rejects.toThrow(/overwrite/);
      await symlink(a, join(root, "link"));
      await expect(writeThemePackage(result, join(root, "link", "nested"))).rejects.toThrow(/Symbolic/);
      const concurrent = await Promise.allSettled([writeThemePackage(result, join(root, "race")), writeThemePackage(result, join(root, "race"))]);
      expect(concurrent.filter(r => r.status === "fulfilled")).toHaveLength(1);
      for (const [name, bytes] of result.files) expect(await readFile(join(root, "race", name))).toEqual(Buffer.from(bytes));
      expect((await readdir(root)).filter(n => n.startsWith(".tfsl"))).toEqual([]);
      await expect(writeV2Files(new Map([["../escape", "bad"]]), join(root, "invalid"))).rejects.toThrow();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
