import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, lstatSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Explicit qualification build. Existing npm scripts and historical evidence stay unchanged.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
let outputRoot = root;
if (args.length > 0) {
  const [flagCli, typescriptCli, flagOut, outArg, ...rest] = args;
  if (
    rest.length > 0 ||
    flagCli !== "--typescript-cli" ||
    flagOut !== "--output-root" ||
    !typescriptCli ||
    !outArg ||
    typescriptCli.startsWith("-") ||
    outArg.startsWith("-") ||
    !isAbsolute(typescriptCli) ||
    !isAbsolute(outArg)
  ) {
    throw new Error("Usage: build-catalog-evidence.mjs [--typescript-cli <abs-tsc-path> --output-root <abs-output-dir>]");
  }
  const resolvedRoot = resolve(root);
  const resolvedOut = resolve(outArg);
  const relToOut = relative(resolvedRoot, resolvedOut);
  const relToRoot = relative(resolvedOut, resolvedRoot);
  if (
    resolvedOut === resolvedRoot ||
    (!relToOut.startsWith("../") && relToOut !== "..") ||
    (!relToRoot.startsWith("../") && relToRoot !== "..")
  ) {
    throw new Error(`Staged --output-root must be disjoint from package root: ${outArg}`);
  }
  outputRoot = resolvedOut;
  execFileSync(process.execPath, [typescriptCli, "-p", "tsconfig.build.json", "--outDir", join(outputRoot, "dist")], {
    cwd: root,
    stdio: "inherit",
  });
} else {
  execFileSync("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
}
const compare = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function walk(base, path, suffix) {
  const result = [];
  for (const entry of readdirSync(join(base, path), { withFileTypes: true })) {
    const name = `${path}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Symlink in build inventory: ${name}`);
    if (entry.isDirectory()) result.push(...walk(base, name, suffix));
    else if (entry.isFile() && name.endsWith(suffix)) result.push(name);
    else if (!entry.isFile()) throw new Error(`Non-regular build member: ${name}`);
  }
  return result.sort(compare);
}
const sourceFiles = walk(root, "src", ".ts").filter((name) => !name.endsWith(".d.ts"));
const expectedJs = sourceFiles.map((name) => `dist/${relative("src", name).replace(/\.ts$/, ".js")}`).sort(compare);
const actualJs = walk(outputRoot, "dist", ".js");
if (JSON.stringify(expectedJs) !== JSON.stringify(actualJs)) throw new Error("Built JS inventory differs from the closed source inventory; inspect stale or missing outputs.");
const requiredMembers = [...expectedJs, "bin/tfsl.js", "bin/tfsl-batch.js"].sort(compare);
const hashMembers = (base, members) => members.map((path) => {
  if (!lstatSync(join(base, path)).isFile()) throw new Error(`Required regular member missing: ${path}`);
  const bytes = readFileSync(join(base, path));
  return { path, bytes: bytes.length, sha256: digest(bytes) };
});
const manifest = {
  schema: "tfsl.catalog-build-evidence-v1",
  members: hashMembers(outputRoot, requiredMembers),
  sources: hashMembers(root, [...sourceFiles, "tsconfig.json", "tsconfig.build.json", "tools/build-catalog-evidence.mjs"].sort(compare)),
};
writeFileSync(join(outputRoot, "dist/catalog-build-evidence.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Catalog qualification build bound ${manifest.members.length} executable members and ${manifest.sources.length} source inputs.`);
