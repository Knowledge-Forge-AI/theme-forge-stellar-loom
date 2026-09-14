import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { validateThemeCode, parseThemeCode } from "../src/code/index.js";
import { deepCloneSafe, mergeCodeConfig, CODE_MERGE_HELPER_STRING } from "../src/generator/code-merge.js";

function fixture() {
  const spec = JSON.parse(readFileSync(new URL("../examples/loom-black-core.theme.json", import.meta.url), "utf8"));
  spec.codePresentation = {
    mode: "expressive-code",
    syntaxTheme: {
      light: { rules: [{ scopes: ["keyword"], foreground: "#123456" }] },
      dark: { rules: [{ scopes: ["keyword"], foreground: "#abcdef" }] },
    },
    frame: "editor", marks: { marked: "#112233", inserted: "#223344", deleted: "#334455" },
    copy: "standard", tabs: "deferred",
  };
  return spec;
}

describe("code data boundary does not invoke supplied execution", () => {
  it("keeps both shipped merge helpers structurally aligned with the tested functions", async () => {
    const emitted = await import(`data:text/javascript;base64,${Buffer.from(CODE_MERGE_HELPER_STRING + "\nexport { deepCloneSafe, mergeCodeConfig };\n").toString("base64")}`);
    // Ignore formatting and transpiler-added block semicolons; preserve string literals.
    const normalize = (fn: Function) => fn.toString().replace(
      /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|}\s*;|\s+/g,
      (match, literal: string | undefined) => literal ?? (match.startsWith("}") ? "}" : ""),
    );
    expect(normalize(emitted.deepCloneSafe)).toBe(normalize(deepCloneSafe));
    expect(normalize(emitted.mergeCodeConfig)).toBe(normalize(mergeCodeConfig));
  });
  it("bounds byte transport before parsing and rejects duplicate keys", () => {
    expect(parseThemeCode(JSON.stringify(fixture()))).toEqual(validateThemeCode(fixture()));
    expect(() => parseThemeCode(" ".repeat(1024 * 1024 + 1))).toThrow(/exceeds 1 MiB/);
    expect(() => parseThemeCode(new Uint8Array([0xff]))).toThrow();
    expect(() => parseThemeCode('{"name":"a","na\\u006de":"b"}')).toThrow(/Duplicate key/);
  });
  it("accepts exactly 256 KiB syntax and rejects the next byte", () => {
    const spec = fixture();
    const syntax = spec.codePresentation.syntaxTheme;
    for (const mode of ["light", "dark"]) syntax[mode].rules = Array.from({ length: 256 }, () => ({ scopes: ["a"], foreground: "#123456" }));
    const rules = [...syntax.light.rules, ...syntax.dark.rules];
    let remaining = 256 * 1024 - Buffer.byteLength(JSON.stringify(syntax));
    for (const rule of rules) {
      for (let i = 0; i < 32 && remaining > 0; i++) {
        if (i >= rule.scopes.length) {
          if (remaining < 4) break;
          rule.scopes.push("a"); remaining -= 4;
        }
        const amount = Math.min(127, remaining);
        rule.scopes[i] += "a".repeat(amount); remaining -= amount;
      }
    }
    expect(remaining).toBe(0);
    expect(Buffer.byteLength(JSON.stringify(syntax))).toBe(256 * 1024);
    expect(() => validateThemeCode(spec)).not.toThrow();
    rules.at(-1)!.scopes[0] += "a";
    expect(Buffer.byteLength(JSON.stringify(syntax))).toBe(256 * 1024 + 1);
    expect(() => validateThemeCode(spec)).toThrow(/SYNTAX_OVERSIZED/);
  });
  it("preserves opaque consumer instances and accessors in both emitted and direct merge", async () => {
    const emitted = await import(`data:text/javascript;base64,${Buffer.from(CODE_MERGE_HELPER_STRING + "\nexport { mergeCodeConfig };\n").toString("base64")}`);
    for (const merge of [mergeCodeConfig, emitted.mergeCodeConfig]) {
      let calls = 0;
      const opaque = new Date(0);
      const consumer = { unrelated: opaque, styleOverrides: {} };
      Object.defineProperty(consumer.styleOverrides, "codeBackground", { enumerable: true, get() { calls++; return "#123456"; } });
      const result = merge({ styleOverrides: { codeBackground: "#abcdef", borderRadius: "4px" } }, consumer);
      expect(calls).toBe(0);
      expect(result.unrelated).toBe(opaque);
      expect(Object.getOwnPropertyDescriptor(result.styleOverrides, "codeBackground")?.get).toBeDefined();
      expect(result.styleOverrides.borderRadius).toBe("4px");
      expect(merge({ themes: ["theme"] }, true)).toEqual({ themes: ["theme"] });
    }
  });
  it("rejects array getters before reading elements", () => {
    const spec = fixture(); let calls = 0;
    Object.defineProperty(spec.codePresentation.syntaxTheme.light.rules, "0", {
      enumerable: true, get() { calls++; return { scopes: ["keyword"], foreground: "#123456" }; },
    });
    expect(() => validateThemeCode(spec)).toThrow();
    expect(calls).toBe(0);
  });
  it("rejects array serializers before serialization", () => {
    const spec = fixture(); let calls = 0;
    spec.codePresentation.syntaxTheme.light.rules.toJSON = () => { calls++; return []; };
    expect(() => validateThemeCode(spec)).toThrow();
    expect(calls).toBe(0);
  });
  it("rejects sparse and custom-prototype arrays", () => {
    for (const rules of [new Array(512), Object.setPrototypeOf([], { toJSON() { throw new Error("executed"); } })]) {
      const spec = fixture(); spec.codePresentation.syntaxTheme.light.rules = rules;
      expect(() => validateThemeCode(spec)).toThrow();
    }
  });
});
