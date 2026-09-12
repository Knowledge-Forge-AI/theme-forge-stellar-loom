import { readFile } from "node:fs/promises";
import { resolve, relative, basename } from "node:path";
import { compileThemeV2 as compileCoreV2 } from "./v2/index.js";
import { isThemeCode, compileThemeCode } from "./code/index.js";
const compileThemeV2 = (input: unknown, options?: { accent?: string }) => (isThemeCode(input) ? compileThemeCode : compileCoreV2)(input, options);
import { generateThemePackage as generateThemePackageV2 } from "./generator/dispatch.js";
import { writeV2Files } from "./generator/v2-writer.js";
import { materializeFontResources } from "./font-resources.js";
import { createThemeCandidateV2, verifyThemeCandidateV2, parseThemeExchangeV2, serializeThemeExchangeV2, importThemeV1ToV2 } from "./design-exchange-v2/index.js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { inspectV2Path } from "./generator/v2-writer.js";

export interface V2CliOptions {
  command?: string | undefined; filePath?: string | undefined; outDir?: string | undefined;
  packagePath?: string | undefined; template?: string | undefined; accent?: string | undefined;
  fontRoot?: string | undefined; fontIds?: string | undefined;
  overwrite: boolean; strictContrast: boolean; json: boolean;
}

export async function runExchangeV2Cli(args: string[]): Promise<number> {
  try {
    const command = args[0];
    const values = new Map<string, string>();
    let input: string | undefined;
    for (let i = 1; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === "--json") continue;
      if (["--out", "--accent", "--font-root", "--font-ids"].includes(arg)) {
        if (values.has(arg) || !args[i + 1] || args[i + 1]!.startsWith("-")) throw new Error(`Invalid or duplicate option ${arg}`);
        values.set(arg, args[++i]!);
      } else if (arg.startsWith("-") || input) throw new Error(`Unexpected argument ${arg}`);
      else input = arg;
    }
    if (!input) throw new Error("Missing input file");
    const raw = await readFile(input, "utf8");
    let packet;
    if (command === "v1-import") {
      if (values.has("--font-root") || values.has("--font-ids")) throw new Error("V1 import does not select font resources");
      packet = importThemeV1ToV2(raw);
    } else {
      const theme = command === "v2-create" ? JSON.parse(raw) : parseThemeExchangeV2(raw).theme;
      const declarations = compileThemeV2(theme).specification.fonts;
      const fontResources = declarations.length ? await materializeFontResources(values.get("--font-root") ?? "", declarations, values.get("--font-ids")?.split(",") ?? []) : new Map<string, Uint8Array>();
      if (!declarations.length && (values.has("--font-root") || values.has("--font-ids"))) throw new Error("Unselected font authority");
      if (command === "v2-verify") {
        if (values.has("--out") || values.has("--accent")) throw new Error("Verification does not rebind output or accent");
        const result = verifyThemeCandidateV2(parseThemeExchangeV2(raw), { fontResources });
        process.stdout.write(JSON.stringify(result) + "\n"); return result.valid ? 0 : 1;
      }
      packet = createThemeCandidateV2(theme, { selectedAccent: values.get("--accent"), fontResources });
    }
    const out = values.get("--out");
    if (!out) throw new Error("Missing --out packet path");
    const parent = await inspectV2Path(dirname(resolve(out)));
    await mkdir(parent, { recursive: true });
    await inspectV2Path(parent);
    await writeFile(resolve(out), serializeThemeExchangeV2(packet), { flag: "wx" });
    process.stdout.write(JSON.stringify({ status: "success", candidateDigest: packet.candidateDigest, state: packet.state }) + "\n");
    return 0;
  } catch (error: any) {
    process.stdout.write(JSON.stringify({ status: "error", code: error.code ?? "EXCHANGE_V2_ERROR", message: error.message }) + "\n"); return 1;
  }
}
export async function runThemeV2Cli(spec: unknown, args: V2CliOptions): Promise<number> {
  try {
    if (args.strictContrast) throw new Error("V2 strict contrast qualification is unsupported in core");
    const compiled = compileThemeV2(spec, args.accent === undefined ? undefined : { accent: args.accent });
    if (args.command === "validate") {
      process.stdout.write(JSON.stringify({ status: "success", command: "validate", inputDigest: compiled.inputDigest, diagnostics: compiled.diagnostics }) + "\n");
      return 0;
    }
    if (!args.outDir) throw new Error("Missing required --out directory");
    for (const input of [args.filePath, args.packagePath, args.fontRoot]) {
      if (input === undefined) continue;
      const output = await inspectV2Path(args.outDir);
      const canonicalInput = input === args.fontRoot ? await inspectV2Path(input) : resolve(await inspectV2Path(dirname(resolve(input))), basename(input));
      const rel = relative(output, canonicalInput);
      if (rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"))) throw new Error("Input/output collision");
    }
    const resources = compiled.specification.fonts.length
      ? await materializeFontResources(args.fontRoot ?? "", compiled.specification.fonts.map(f => ({ id: f.id, format: f.format, sha256: f.sha256 })), args.fontIds?.split(",") ?? [])
      : new Map<string, Uint8Array>();
    if (!compiled.specification.fonts.length && (args.fontRoot !== undefined || args.fontIds !== undefined)) throw new Error("Unselected font resource authority");
    let files;
    if (args.command === "generate") {
      if (!args.packagePath) throw new Error("Missing required --package metadata");
      const result = generateThemePackageV2({ themeSpec: compiled.specification, metadata: JSON.parse(await readFile(args.packagePath, "utf8")), template: args.template, accent: args.accent, fontResources: resources });
      files = result.files;
    } else {
      files = new Map<string, string | Uint8Array>(compiled.styles);
      files.set("theme.descriptor.json", JSON.stringify(compiled.descriptor, null, 2) + "\n");
      for (const [index, font] of compiled.specification.fonts.entries()) files.set(`fonts/font-${String(index).padStart(2, "0")}.${font.format}`, resources.get(font.id)!);
    }
    const filesWritten = await writeV2Files(files, args.outDir, { overwrite: args.overwrite });
    process.stdout.write(JSON.stringify({ status: "success", command: args.command, descriptor: compiled.descriptor, filesWritten }) + "\n");
    return 0;
  } catch (error: any) {
    process.stdout.write(JSON.stringify({ status: "error", command: args.command, code: error.code ?? "V2_ERROR", message: error.message }) + "\n");
    return 1;
  }
}
