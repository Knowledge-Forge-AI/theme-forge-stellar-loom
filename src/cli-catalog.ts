import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, basename, relative } from "node:path";
import { runCli as historicalRunCli, CLI_HELP } from "./cli.js";
import { compileThemeCatalog, parseThemeCatalog, generateThemePackageCatalog } from "./catalog/index.js";
import { materializeFontResources } from "./font-resources.js";
import { inspectV2Path, writeV2Files } from "./generator/v2-writer.js";
import { createThemeCatalogCandidate, parseThemeCatalogCandidate, serializeThemeCatalogCandidate, verifyThemeCatalogCandidate } from "./design-exchange-catalog/index.js";
export { CLI_HELP };

export async function runCli(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  const exchange = args[0] === "exchange" && ["catalog-create", "catalog-verify"].includes(args[1] ?? "");
  if (!exchange && (!["compile", "generate", "validate"].includes(args[0] ?? "") || args.includes("--help") || args.includes("-h"))) return historicalRunCli(argv);
  const values = new Map<string, string>();
  let input: string | undefined;
  let parseError: string | undefined;
  for (let i = exchange ? 2 : 1; i < args.length; i++) {
    const arg = args[i]!;
    if (["--json", "--overwrite", "--strict-contrast"].includes(arg)) continue;
    if (["--out", "--package", "--accent", "--font-root", "--font-ids", "--template"].includes(arg)) {
      if (values.has(arg) || !args[i + 1] || args[i + 1]!.startsWith("-")) { parseError = `Invalid or duplicate option ${arg}`; break; }
      values.set(arg, args[++i]!);
    } else if (arg.startsWith("-") || input) { parseError = `Unexpected argument ${arg}`; }
    else input = arg;
  }
  let raw = "";
  if (input) { try { raw = await readFile(input, "utf8"); } catch { if (!exchange) return historicalRunCli(argv); } }
  if (!exchange) {
    try { const probe = JSON.parse(raw); if (!probe || typeof probe !== "object" || !Object.hasOwn(probe, "catalog")) return historicalRunCli(argv); }
    catch { return historicalRunCli(argv); }
  }
  try {
    if (parseError) throw new Error(parseError);
    if (!input) throw new Error("Missing input file");
    if (args.includes("--overwrite")) throw new Error("Catalog output never overwrites");
    if (args.includes("--strict-contrast")) throw new Error("Catalog strict contrast is unsupported");
    const verify = exchange && args[1] === "catalog-verify";
    const packet = verify ? parseThemeCatalogCandidate(raw) : undefined;
    const spec = packet ? packet.theme : parseThemeCatalog(raw);
    const compiled = compileThemeCatalog(spec, { accent: values.get("--accent") });
    if (!exchange && args[0] === "validate") {
      process.stdout.write(JSON.stringify({ status: "success", command: "validate", inputDigest: compiled.inputDigest, diagnostics: compiled.diagnostics }) + "\n"); return 0;
    }
    const fontResources = spec.fonts.length ? await materializeFontResources(values.get("--font-root") ?? "", spec.fonts, values.get("--font-ids")?.split(",") ?? []) : new Map<string, Uint8Array>();
    if (!spec.fonts.length && (values.has("--font-root") || values.has("--font-ids"))) throw new Error("Unselected font authority");
    if (verify) {
      if (values.has("--out") || values.has("--accent") || values.has("--package") || values.has("--template")) throw new Error("Verification does not rebind candidate data");
      const result = verifyThemeCatalogCandidate(packet, { fontResources });
      process.stdout.write(JSON.stringify(result) + "\n"); return result.valid ? 0 : 1;
    }
    const out = values.get("--out"); if (!out) throw new Error("Missing --out destination");
    const output = await inspectV2Path(out);
    for (const selected of [input, values.get("--package"), values.get("--font-root")]) {
      if (!selected) continue;
      const canonicalInput = selected === values.get("--font-root") ? await inspectV2Path(selected) : resolve(await inspectV2Path(dirname(resolve(selected))), basename(selected));
      const rel = relative(output, canonicalInput);
      if (rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"))) throw new Error("Input/output collision");
    }
    if (exchange || args[0] === "generate") {
      const packagePath = values.get("--package"); if (!packagePath) throw new Error("Missing --package metadata");
      const metadata = JSON.parse(await readFile(packagePath, "utf8"));
      if (exchange) {
        const candidate = createThemeCatalogCandidate(spec, { metadata, accent: values.get("--accent"), fontResources });
        const parent = await inspectV2Path(dirname(output)); await mkdir(parent, { recursive: true }); await inspectV2Path(parent);
        await writeFile(output, serializeThemeCatalogCandidate(candidate), { flag: "wx" });
        process.stdout.write(JSON.stringify({ status: "success", candidateDigest: candidate.candidateDigest, state: "candidate" }) + "\n");
      } else {
        const result = generateThemePackageCatalog({ themeSpec: spec, metadata, accent: values.get("--accent"), template: values.get("--template"), fontResources });
        const filesWritten = await writeV2Files(result.files, output);
        process.stdout.write(JSON.stringify({ status: "success", command: "generate", descriptor: result.descriptor, filesWritten }) + "\n");
      }
    } else {
      const files = new Map<string, string | Uint8Array>(compiled.styles);
      files.set("theme.descriptor.json", JSON.stringify(compiled.descriptor, null, 2) + "\n");
      spec.fonts.forEach((f, i) => files.set(`fonts/font-${String(i).padStart(2, "0")}.${f.format}`, fontResources.get(f.id)!));
      spec.catalog.fontLicenses.forEach((l, i) => files.set(`licenses/license-${String(i).padStart(2, "0")}.txt`, l.text));
      const filesWritten = await writeV2Files(files, output);
      process.stdout.write(JSON.stringify({ status: "success", command: "compile", descriptor: compiled.descriptor, filesWritten }) + "\n");
    }
    return 0;
  } catch (error) {
    process.stdout.write(JSON.stringify({ status: "error", code: "CATALOG_ERROR", message: (error as Error).message }) + "\n"); return 1;
  }
}
