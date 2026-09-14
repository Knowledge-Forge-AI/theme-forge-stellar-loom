import { compareUtf8 } from "../design-exchange-v2/canonical.js";
import { COMPILER_VERSION } from "../v2/types.js";
import { createHash } from "node:crypto";
import { compileThemeV2, type ThemeSpecificationV2 } from "../v2/index.js";
import { COMPILER_PACKAGE } from "../compiler/descriptor.js";
import { validatePackageMetadata } from "./metadata.js";
import { emitPageTitleFrameComponent } from "./templates/page-title-frame.js";
import { AGPL_3_LICENSE_TEXT, FIRST_PARTY_NOTICE_TEXT, COMMERCIAL_LICENSE_TEXT } from "./legal.js";
import type { GeneratedFile } from "./v2-writer.js";

export interface GeneratePackageV2Options {
  themeSpec: unknown;
  metadata: unknown;
  template?: string | undefined;
  accent?: string | undefined;
  strictContrast?: boolean | undefined;
  fontResources?: ReadonlyMap<string, Uint8Array> | undefined;
}
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function generateThemePackageV2(options: GeneratePackageV2Options) {
  if (options.strictContrast) throw new Error("V2 strict contrast qualification is not implemented; refusing to ignore the requested check");
  const compilation = compileThemeV2(options.themeSpec, options.accent === undefined ? undefined : { accent: options.accent });
  const spec: ThemeSpecificationV2 = compilation.specification;
  const metadata = validatePackageMetadata(options.metadata);
  const template = spec.components.pageTitle === "page-title-frame" ? "page-title-frame" : undefined;
  for (const requested of [metadata.template, options.template]) {
    if (requested !== undefined && requested !== template) throw new Error("V2 components.pageTitle is the template authority; metadata/template conflicts");
  }
  if (template) metadata.template = template;
  const files = new Map<string, GeneratedFile>();
  const resources = options.fontResources ?? new Map<string, Uint8Array>();
  if (resources.size !== spec.fonts.length) throw new Error("Missing or unselected font resources");
  let fontTotal = 0;
  for (const [index, font] of spec.fonts.entries()) {
    const supplied = resources.get(font.id);
    if (!(supplied instanceof Uint8Array)) throw new Error("Missing selected font bytes");
    const bytes = Uint8Array.from(supplied);
    fontTotal += bytes.byteLength;
    if (bytes.byteLength === 0 || bytes.byteLength > 4 * 1024 * 1024 || fontTotal > 16 * 1024 * 1024 || hash(bytes) !== font.sha256) throw new Error("Font resource size or digest mismatch");
    files.set(`fonts/font-${String(index).padStart(2, "0")}.${font.format}`, bytes);
  }
  for (const [name, content] of compilation.styles) files.set(name, content);
  const cssPaths = [...compilation.styles.keys()].map(path => `${metadata.name}/${path}`);
  files.set("index.js", `export default function themePlugin() {
  return { name: ${JSON.stringify(metadata.name)}, hooks: {
    "config:setup"({ config, updateConfig }) {
      const defaults = ${JSON.stringify(cssPaths)};
      const customCss = [...defaults, ...(Array.isArray(config.customCss) ? config.customCss : []).filter(path => !defaults.includes(path))];
      const components = { ${template ? `PageTitle: ${JSON.stringify(`${metadata.name}/components/PageTitleFrame.astro`)},` : ""} ...(config.components ?? {}) };
      updateConfig({ customCss, components });
    }
  } };
}
`);
  files.set("index.d.ts", "export default function themePlugin(): { name: string; hooks: { 'config:setup'(context: { config: { customCss?: string[]; components?: Record<string, string> }; updateConfig(config: unknown): void }): void } };\n");
  files.set("package.json", JSON.stringify({
    name: metadata.name, version: metadata.version, private: true, type: "module",
    description: metadata.description ?? `${spec.name} Starlight theme`,
    license: metadata.license ?? "AGPL-3.0-or-later",
    ...(metadata.author ? { author: metadata.author } : {}),
    exports: { ".": { types: "./index.d.ts", import: "./index.js" }, "./styles/*": "./styles/*", ...(template ? { "./components/*": "./components/*" } : {}) },
    files: ["index.js", "index.d.ts", "styles", "fonts", "components", "theme.json", "theme.descriptor.json", "provenance.json", "README.md", "LICENSE", "NOTICE", "COMMERCIAL-LICENSE.md"],
    peerDependencies: { astro: "^7.3.1", "@astrojs/starlight": "^0.42.0" }, engines: { node: ">=22" },
  }, null, 2) + "\n");
  const themeCanonicalJson = JSON.stringify(spec, null, 2) + "\n";
  files.set("theme.json", themeCanonicalJson);
  files.set("theme.descriptor.json", JSON.stringify(compilation.descriptor, null, 2) + "\n");
  if (template) files.set("components/PageTitleFrame.astro", emitPageTitleFrameComponent());
  files.set("LICENSE", AGPL_3_LICENSE_TEXT);
  files.set("NOTICE", FIRST_PARTY_NOTICE_TEXT);
  files.set("COMMERCIAL-LICENSE.md", COMMERCIAL_LICENSE_TEXT);
  files.set("README.md", `# ${metadata.name}\n\nPrivate generated theme-v2 core candidate. Install the locally packed tarball with scripts disabled.\n\nThe fixed stylesheet family loads before consumer customCss. The adapter declares Starlight before Loom layers. Unlayered consumer rules such as \`:root { --sl-color-hairline: #e11d48; }\`, \`.sl-markdown-content a:focus-visible\`, and \`::selection\` override the corresponding theme defaults under ordinary CSS cascade rules. Consumer PageTitle overrides win. Code presentation remains consumer-owned.\n\nSystem fonts do not promise pixel-identical rendering across operating systems. Package-local resources are digest-bound; no runtime network font requests are generated.\n`);
  const records = [...files].sort(([a], [b]) => compareUtf8(a, b)).map(([path, content]) => ({ path, size: Buffer.byteLength(content), sha256: hash(content) }));
  const provenance = {
    schema: "tfsl.package-provenance-v2" as const,
    producer: { package: COMPILER_PACKAGE, version: COMPILER_VERSION },
    descriptor: compilation.descriptor,
    packageName: metadata.name, packageVersion: metadata.version,
    inventoryDigest: hash("tfsl.package-inventory-v2\n" + JSON.stringify(records)),
    inventoryExcludes: ["provenance.json"], files: records,
    fonts: spec.fonts,
  };
  files.set("provenance.json", JSON.stringify(provenance, null, 2) + "\n");
  return { metadata, themeSpec: spec, themeCanonicalJson, themeInputDigest: compilation.inputDigest, cssContent: compilation.css, cssOutputDigest: compilation.outputDigest, descriptor: compilation.descriptor, provenance, files: new Map([...files].sort(([a], [b]) => compareUtf8(a, b))), diagnostics: compilation.diagnostics };
}

export type GeneratePackageV2Result = ReturnType<typeof generateThemePackageV2>;
