import { createHash } from "node:crypto";
import { compareUtf8 } from "../design-exchange-v2/canonical.js";
import { COMPILER_VERSION } from "../v2/types.js";
import { COMPILER_PACKAGE } from "../compiler/descriptor.js";
import {
  generateThemePackageV2,
  type GeneratePackageV2Options,
} from "./v2-emitter.js";
import type { GeneratedFile } from "./v2-writer.js";
import {
  compileThemeCode,
  createCodeDefaults,
  type ThemeSpecificationCode,
} from "../code/index.js";
import { MERGE_HELPER_STRING } from "./code-merge.js";
import type { ThemeSpecificationV2 } from "../v2/types.js";

export type GeneratePackageCodeOptions = GeneratePackageV2Options;
export type { GeneratePackageV2Options };

const hash = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * Generates an installable Starlight theme package with Expressive Code defaults.
 * Composes validated code compiler and core generateThemePackageV2 sentinel,
 * replaces styles, theme, descriptor, index, and README, and rebuilds complete provenance.
 */
export function generateThemePackageCode(options: GeneratePackageV2Options) {
  if (options.strictContrast) {
    throw new Error(
      "V2 strict contrast qualification is not implemented; refusing to ignore the requested check"
    );
  }

  // 1. Validated code compile
  const compilation = compileThemeCode(options.themeSpec, {
    accent: options.accent,
    strictContrast: options.strictContrast,
  });
  const spec: ThemeSpecificationCode = compilation.specification;

  // 2. Sentinel for package foundation
  const sentinelSpec: ThemeSpecificationV2 = {
    ...spec,
    codePresentation: "consumer-default",
  };

  // 3. Core package foundation
  const base = generateThemePackageV2({
    ...options,
    themeSpec: sentinelSpec,
  });

  const files = new Map<string, GeneratedFile>(base.files);

  // 4. Replace styles with sixth styles/code.css
  for (const [name, content] of compilation.styles) {
    files.set(name, content);
  }
  const cssPaths = [...compilation.styles.keys()].map(
    (path) => `${base.metadata.name}/${path}`
  );

  // 5. Code presentation defaults
  const ecDefaults = createCodeDefaults(spec, options.accent);
  const template =
    spec.components.pageTitle === "page-title-frame"
      ? "page-title-frame"
      : undefined;

  // 6. Replace index.js and index.d.ts with exact shared merge helper
  files.set(
    "index.js",
    `${MERGE_HELPER_STRING}
export default function themePlugin() {
  return { name: ${JSON.stringify(base.metadata.name)}, hooks: {
    "config:setup"({ config, updateConfig }) {
      const defaults = ${JSON.stringify(cssPaths)};
      const customCss = [...defaults, ...(Array.isArray(config?.customCss) ? config.customCss : []).filter(path => !defaults.includes(path))];
      const components = { ${template ? `PageTitle: ${JSON.stringify(`${base.metadata.name}/components/PageTitleFrame.astro`)},` : ""} ...(config?.components ?? {}) };
      const ecDefaults = ${JSON.stringify(ecDefaults)};
      const expressiveCode = mergeCodeConfig(ecDefaults, config?.expressiveCode);
      updateConfig({ customCss, components, expressiveCode });
    }
  } };
}
`
  );

  files.set(
    "index.d.ts",
    "export default function themePlugin(): { name: string; hooks: { 'config:setup'(context: { config?: { customCss?: string[]; components?: Record<string, string>; expressiveCode?: unknown }; updateConfig(config: unknown): void }): void } };\n"
  );

  // 7. Replace theme.json and theme.descriptor.json
  const themeCanonicalJson = JSON.stringify(spec, null, 2) + "\n";
  files.set("theme.json", themeCanonicalJson);
  files.set(
    "theme.descriptor.json",
    JSON.stringify(compilation.descriptor, null, 2) + "\n"
  );

  // 8. Replace README.md
  files.set(
    "README.md",
    `# ${base.metadata.name}\n\nPrivate generated theme-v2 code candidate. Install the locally packed tarball with scripts disabled.\n\nThe fixed stylesheet family loads before consumer customCss. The adapter declares Starlight before Loom layers. Unlayered consumer rules such as \`:root { --sl-color-hairline: #e11d48; }\`, \`.sl-markdown-content a:focus-visible\`, and \`::selection\` override the corresponding theme defaults under ordinary CSS cascade rules. Consumer PageTitle overrides win. Expressive Code defaults are merged under consumer precedence.\n\nSystem fonts do not promise pixel-identical rendering across operating systems. Package-local resources are digest-bound; no runtime network font requests are generated.\n`
  );

  // 9. Rebuild complete provenance sorted compareUtf8
  files.delete("provenance.json");
  const records = [...files]
    .sort(([a], [b]) => compareUtf8(a, b))
    .map(([path, content]) => ({
      path,
      size: Buffer.byteLength(content),
      sha256: hash(content),
    }));

  const provenance = {
    schema: "tfsl.package-provenance-v2" as const,
    producer: { package: COMPILER_PACKAGE, version: COMPILER_VERSION },
    descriptor: compilation.descriptor,
    packageName: base.metadata.name,
    packageVersion: base.metadata.version,
    inventoryDigest: hash(
      "tfsl.package-inventory-v2\n" + JSON.stringify(records)
    ),
    inventoryExcludes: ["provenance.json"],
    files: records,
    fonts: spec.fonts,
  };
  files.set("provenance.json", JSON.stringify(provenance, null, 2) + "\n");

  return {
    metadata: base.metadata,
    themeSpec: spec,
    themeCanonicalJson,
    themeInputDigest: compilation.inputDigest,
    cssContent: compilation.css,
    cssOutputDigest: compilation.outputDigest,
    descriptor: compilation.descriptor,
    provenance,
    files: new Map([...files].sort(([a], [b]) => compareUtf8(a, b))),
    diagnostics: compilation.diagnostics,
  };
}

export type GeneratePackageCodeResult = ReturnType<
  typeof generateThemePackageCode
>;
