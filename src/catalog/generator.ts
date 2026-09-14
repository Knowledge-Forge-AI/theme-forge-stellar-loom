import { createHash } from "node:crypto";
import { compareUtf8 } from "../design-exchange-v2/canonical.js";
import { COMPILER_VERSION } from "../v2/types.js";
import { COMPILER_PACKAGE } from "../compiler/descriptor.js";
import { validatePackageMetadata } from "../generator/metadata.js";
import { generateThemePackageV2 } from "../generator/v2-emitter.js";
import { generateThemePackageCode } from "../generator/code-emitter.js";
import { writeV2Files, type GeneratedFile } from "../generator/v2-writer.js";
import { MERGE_HELPER_STRING } from "../generator/code-merge.js";
import { createCodeDefaults } from "../code/config.js";
import { compileThemeCatalog } from "./compiler.js";
import { emitHeroComponent } from "./templates/hero.js";
import { emitPageTitleComponent } from "./templates/page-title.js";
import { emitPaginationComponent } from "./templates/pagination.js";
import { emitSidebarComponent, emitSidebarTree } from "./templates/sidebar.js";
import { emitLoomOrbitSvg } from "./templates/loom-orbit.js";
import { emitNavigationHelpers } from "./templates/navigation.js";
import { emitMiddleware } from "./templates/middleware.js";
import type {
  GeneratePackageCatalogOptions,
  GeneratePackageCatalogResult,
} from "./types.js";

const hash = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * Generates an installable theme package within the TFSB61B catalog envelope.
 * Lowers to base code or v2 package emitter, writes catalog components,
 * sets font license texts into inventory, emits route middleware if needed,
 * builds plugin with consumer component precedence, and re-computes complete provenance.
 */
export function generateThemePackageCatalog(
  options: GeneratePackageCatalogOptions
): GeneratePackageCatalogResult {
  if (options.strictContrast) {
    throw new Error(
      "V2 strict contrast qualification is not implemented; refusing to ignore the requested check"
    );
  }

  const compilation = compileThemeCatalog(options.themeSpec, {
    accent: options.accent,
    strictContrast: options.strictContrast,
  });
  const spec = compilation.specification;
  const metadata = validatePackageMetadata(options.metadata);

  // Lower by removing catalog property for base generator execution
  const { catalog, ...lowered } = spec;

  const isCode =
    Boolean(lowered.codePresentation) &&
    typeof lowered.codePresentation === "object" &&
    (lowered.codePresentation as any).mode === "expressive-code";

  const baseResult = isCode
    ? generateThemePackageCode({
        ...options,
        themeSpec: lowered,
      })
    : generateThemePackageV2({
        ...options,
        themeSpec: lowered,
      });

  const files = new Map<string, GeneratedFile>(baseResult.files);

  // 1. Materialize font licenses into package files
  for (const lic of spec.catalog.fontLicenses) {
    files.set(`licenses/${lic.id}.txt`, lic.text);
  }

  // 2. Add all compilation styles (including unlayered compat.css)
  for (const [name, content] of compilation.styles) {
    files.set(name, content);
  }
  const cssPaths = [...compilation.styles.keys()].map(
    (path) => `${metadata.name}/${path}`
  );

  // 3. Emit components
  files.set("components/Hero.astro", emitHeroComponent(spec.catalog));
  files.set(
    "components/PageTitle.astro",
    emitPageTitleComponent(spec.catalog, spec.components?.pageTitle === "page-title-frame")
  );
  files.set("components/Pagination.astro", emitPaginationComponent(spec.catalog));
  files.set("components/Sidebar.astro", emitSidebarComponent(spec.catalog));
  files.set("components/SidebarTree.astro", emitSidebarTree());
  files.set("catalog-data.json", JSON.stringify({ hero:catalog.hero, sidebar:catalog.sidebar }, null, 2) + "\n");
  files.set("navigation.js", emitNavigationHelpers());
  files.set("assets/loom-orbit.svg", emitLoomOrbitSvg());

  // 4. Emit route middleware if hero routes exist
  const hasHeroRoutes = spec.catalog.hero.routes.length > 0;
  if (hasHeroRoutes) {
    files.set("middleware.js", emitMiddleware(spec.catalog.hero.routes));
  }

  // 5. Build index.js with consumer overrides winning
  const ecDefaults = isCode ? createCodeDefaults(lowered as any, options.accent) : null;

  files.set(
    "index.js",
    `${isCode ? MERGE_HELPER_STRING : ""}
export default function themePlugin() {
  return {
    name: ${JSON.stringify(metadata.name)},
    hooks: {
      "config:setup"({ config, updateConfig${hasHeroRoutes ? ", addRouteMiddleware" : ""} }) {
        const defaults = ${JSON.stringify(cssPaths)};
        const customCss = [
          ...defaults,
          ...(Array.isArray(config?.customCss) ? config.customCss : []).filter((path) => !defaults.includes(path)),
        ];
        const components = {
          Hero: ${JSON.stringify(`${metadata.name}/components/Hero.astro`)},
          PageTitle: ${JSON.stringify(`${metadata.name}/components/PageTitle.astro`)},
          Pagination: ${JSON.stringify(`${metadata.name}/components/Pagination.astro`)},
          Sidebar: ${JSON.stringify(`${metadata.name}/components/Sidebar.astro`)},
          ...(config?.components ?? {})
        };
        ${
          hasHeroRoutes
            ? `addRouteMiddleware({ entrypoint: ${JSON.stringify(`${metadata.name}/middleware.js`)}, order: "default" });`
            : ""
        }
        ${
          isCode
            ? `const ecDefaults = ${JSON.stringify(ecDefaults)};
        const expressiveCode = mergeCodeConfig(ecDefaults, config?.expressiveCode);
        updateConfig({ customCss, components, expressiveCode });`
            : `updateConfig({ customCss, components });`
        }
      }
    }
  };
}
`
  );

  files.set(
    "index.d.ts",
    `export default function themePlugin(): {
  name: string;
  hooks: {
    'config:setup'(context: {
      config?: {
        customCss?: string[];
        components?: Record<string, string>;
        expressiveCode?: unknown;
      };
      updateConfig(config: unknown): void;
      addRouteMiddleware?(options: { entrypoint: string; order?: 'default' | 'pre' | 'post' }): void;
    }): void;
  };
};
`
  );

  // 6. Update package.json
  const pkgJson = JSON.parse(files.get("package.json") as string);
  pkgJson.exports = {
    ".": { types: "./index.d.ts", import: "./index.js" },
    "./catalog-data.json": "./catalog-data.json",
    "./navigation.js": "./navigation.js",
    "./styles/*": "./styles/*",
    "./components/*": "./components/*",
    "./assets/*": "./assets/*",
    "./licenses/*": "./licenses/*",
    ...(hasHeroRoutes ? { "./middleware.js": "./middleware.js", "./middleware": "./middleware.js" } : {}),
  };
  pkgJson.files = [
    "index.js",
    "catalog-data.json",
    "navigation.js",
    "index.d.ts",
    "styles",
    "fonts",
    "components",
    "assets",
    "licenses",
    "theme.json",
    "theme.descriptor.json",
    "provenance.json",
    "README.md",
    "LICENSE",
    "NOTICE",
    "COMMERCIAL-LICENSE.md",
    ...(hasHeroRoutes ? ["middleware.js"] : []),
  ];
  delete pkgJson.scripts; // Ensure no scripts
  files.set("package.json", JSON.stringify(pkgJson, null, 2) + "\n");

  // 7. Update theme.json & descriptor
  const themeCanonicalJson = JSON.stringify(spec, null, 2) + "\n";
  files.set("theme.json", themeCanonicalJson);
  files.set(
    "theme.descriptor.json",
    JSON.stringify(compilation.descriptor, null, 2) + "\n"
  );

  // 8. Update README.md
  files.set(
    "README.md",
    `# ${metadata.name}

Private generated theme-v2 catalog candidate. Install the locally packed tarball with scripts disabled.

The fixed stylesheet family loads before consumer customCss. The adapter declares Starlight before Loom layers.
Unlayered compat CSS ensures correct sidebar-less width and coherent light print palettes.
Consumer component overrides and frontmatter hero configurations always win.
Expressive Code defaults and route middleware are merged under consumer precedence.

System fonts do not promise pixel-identical rendering across operating systems.
Package-local resources and font licenses are digest-bound; no runtime network requests are generated.
`
  );

  // 9. Rebuild complete provenance sorted by compareUtf8
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
    packageName: metadata.name,
    packageVersion: metadata.version,
    inventoryDigest: hash(
      "tfsl.package-inventory-v2\n" + JSON.stringify(records)
    ),
    inventoryExcludes: ["provenance.json"],
    files: records,
    fonts: spec.fonts,
    fontLicenses: spec.catalog.fontLicenses,
  };
  files.set("provenance.json", JSON.stringify(provenance, null, 2) + "\n");

  return {
    metadata,
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

/**
 * Writes the generated package files to an absent or empty directory using safe whole-directory publication.
 */
export async function writeThemePackageCatalog(
  result: GeneratePackageCatalogResult,
  outDir: string,
  options?: { overwrite?: boolean | undefined }
): Promise<string[]> {
  return writeV2Files(result.files, outDir, options);
}
