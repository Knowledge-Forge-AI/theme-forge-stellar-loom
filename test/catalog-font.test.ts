import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { materializeFontResources } from "../src/font-resources.js";
import { fileURLToPath } from "node:url";

const root = new URL("./fixtures/catalog-font/", import.meta.url);
const digest = "8badfe75c98da1e8315a52619f177def4618350f7b3e496baf5b8894da2c2ac0";
describe("selected unmodified Source Code Pro font inventory", () => {
  it("binds the independently compared font and full upstream license bytes", () => {
    const provenance = JSON.parse(readFileSync(new URL("provenance.json", root), "utf8"));
    for (const resource of provenance.resources) {
      const bytes = readFileSync(new URL(resource.path, root));
      expect(bytes.byteLength).toBe(resource.bytes);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(resource.sha256);
    }
    expect(readFileSync(new URL("source-code-pro.woff2", root)).subarray(0, 4).toString()).toBe("wOF2");
    expect(provenance.sourcePackage.revision).toBe("1159e78c4747b02ef996e55082b704c09b970588");
    expect(provenance.license).toBe("OFL-1.1");
    expect(readFileSync(new URL("LICENSE.txt", root), "utf8")).toContain("Copyright 2010, 2012 Adobe Systems Incorporated");
  });
  it("passes selected-byte materialization without a provider or remote resource", async () => {
    const resources = await materializeFontResources(fileURLToPath(root), [{ id: "source-code-pro", format: "woff2", sha256: digest }], ["source-code-pro"]);
    expect(resources.size).toBe(1);
    expect(Buffer.from(resources.get("source-code-pro")!)).toEqual(readFileSync(new URL("source-code-pro.woff2", root)));
  });
});
