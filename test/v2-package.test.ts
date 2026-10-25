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
    const currentProfile = JSON.parse(
      await readFile(new URL("./fixtures/current-legal-profile-v050/manifest.json", import.meta.url), "utf8")
    );
    const exampleBytes = await readFile(new URL("../examples/loom-black-core.theme.json", import.meta.url));
    const inputRecord = {
      example: "packages/stellar-loom/examples/loom-black-core.theme.json",
      exampleSha256: hash(exampleBytes),
      metadata,
    };
    expect(currentProfile.schema).toBe("loom.current-legal-profile.v2");
    // Root acceptance boolean records producer receipt read/review only, not full QA or release qualification.
    expect(currentProfile.receipt.parentReviewedCurrentReceipt).toBe(true);
    expect(inputRecord).toEqual(currentProfile.v2Package.input);
    expect(hash(JSON.stringify(inputRecord))).toBe(currentProfile.v2Package.inputIdentity);
    expect(currentProfile.v2Package.inventoryDigest).toBe(
      "66adb4696e80bd8112ff8ca31bbb7208705384d488d1a8949febc1ad084029bc"
    );
    expect(currentProfile.v2Package.provenanceSha256).toBe(
      "818962d83527bc6d9b24abd620dcda1acebc82f39c9dec37b1a1119dafcf233f"
    );
    // Same-producer contact-only counterfactual (0.5.0 producer with historical contact rows in NOTICE and COMMERCIAL-LICENSE.md, not a historical prior 0.5.0 release).
    expect(currentProfile.counterfactualReceipt).toEqual({
      producerVersion: "0.5.0",
      inputIdentity: "9e0e60a0e090762e44237c67274e5712587dff8871bc1c90ca017b3f911bd434",
      inventoryDigest: "f1488f2f37ef18bba12c35c7d763082d868ac1ea9bd45cceb420312ecf9dce1a",
      provenanceSha256: "1186a933c2a6c2236c711a2cfcb82545e8d2977f223f9018b8775df2c0eb475f",
      substitutions: ["NOTICE", "COMMERCIAL-LICENSE.md"],
      legalRows: [
        {
          path: "COMMERCIAL-LICENSE.md",
          bytes: 932,
          sha256: "a81bcda7ec57a5c09f1cc6d05de420db7a0053b9496f1762065e083a60e5ede2",
        },
        {
          path: "LICENSE",
          bytes: 34460,
          sha256: "62eef07fc3ad238dd889ff98cf9ed87b3ef0f421579b6945f87ec37c608afb62",
        },
        {
          path: "NOTICE",
          bytes: 598,
          sha256: "e711709e69f5f8fc65c55ff3b3e47c390ed8f60890eb38cf999d95c2494b5d17",
        },
      ],
    });
    const original = String.prototype.localeCompare;
    String.prototype.localeCompare = () => { throw new Error("locale collation is forbidden"); };
    try {
      const result = generateThemePackageV2({ themeSpec: theme, metadata });
      const paths = result.provenance.files.map(file => file.path);
      expect(paths).toEqual([...paths].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
      // Release 0.5.0 producer metadata and reviewed current contact profile receipt.
      expect(result.provenance.producer.version).toBe(currentProfile.source.packageVersion);
      expect(result.provenance.inventoryDigest).toBe(currentProfile.v2Package.inventoryDigest);
      expect(hash(result.files.get("provenance.json")!)).toBe(currentProfile.v2Package.provenanceSha256);
      expect(result.provenance.inventoryDigest).not.toBe(currentProfile.counterfactualReceipt.inventoryDigest);
      expect(hash(result.files.get("provenance.json")!)).not.toBe(currentProfile.counterfactualReceipt.provenanceSha256);
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
