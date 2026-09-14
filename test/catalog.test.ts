import { describe, it, expect } from "vitest";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  isThemeCatalog,
  validateThemeCatalog,
  parseThemeCatalog,
  canonicalizeThemeCatalog,
  compileThemeCatalog,
  generateThemePackageCatalog,
  writeThemePackageCatalog,
  CATALOG_COMPILER_SEMANTIC,
  CATALOG_IDENTITY,
  CATALOG_DIGEST,
  verifyCatalogDigest,
  computeCatalogDigest,
  STARLIGHT_COMPONENT_CATALOG_V1,
  emitCompatCss,
  emitHeroComponent,
  emitPageTitleComponent,
  emitPaginationComponent,
  emitSidebarComponent,
  emitLoomOrbitSvg,
  emitMiddleware,
} from "../src/catalog/index.js";
import { ValidationErrorV2 } from "../src/v2/validator.js";
import { FilesystemSafetyError } from "../src/generator/writer.js";
import type { ThemeCatalogConfig, ThemeSpecificationCatalog } from "../src/catalog/types.js";

function getBlackCatalogJson(): ThemeSpecificationCatalog {
  return JSON.parse(
    readFileSync(resolve(__dirname, "../examples/loom-black-catalog.json"), "utf8")
  );
}

function getCelestiaCatalogJson(): ThemeSpecificationCatalog {
  return JSON.parse(
    readFileSync(resolve(__dirname, "../examples/loom-celestia-catalog.json"), "utf8")
  );
}

function getFlexokiCatalogJson(): ThemeSpecificationCatalog {
  return JSON.parse(
    readFileSync(resolve(__dirname, "../examples/loom-flexoki-catalog.json"), "utf8")
  );
}

describe("TFSB61B Catalog Runtime", () => {
  describe("Catalog Manifest and Digest", () => {
    it("exports matching identity and semantic constants", () => {
      expect(CATALOG_IDENTITY).toBe("tfsl.starlight-component-catalog-v1");
      expect(CATALOG_COMPILER_SEMANTIC).toBe("tfsl.theme-compiler-v2-catalog-1");
      expect(STARLIGHT_COMPONENT_CATALOG_V1.catalogIdentity).toBe(CATALOG_IDENTITY);
      expect(STARLIGHT_COMPONENT_CATALOG_V1.adapter).toBe("starlight-v0.42");
    });

    it("verifies deterministic catalog manifest digest", () => {
      expect(verifyCatalogDigest()).toBe(true);
      expect(computeCatalogDigest()).toBe(CATALOG_DIGEST);
      expect(typeof CATALOG_DIGEST).toBe("string");
      expect(CATALOG_DIGEST.length).toBe(64);
    });

    it("includes required style inventory and layers in order", () => {
      expect(STARLIGHT_COMPONENT_CATALOG_V1.styleInventory).toEqual([
        "styles/layers.css",
        "styles/tokens.css",
        "styles/base.css",
        "styles/accent.css",
        "styles/overrides.css",
        "styles/code.css",
        "styles/compat.css",
      ]);
      expect(STARLIGHT_COMPONENT_CATALOG_V1.layers).toEqual([
        "starlight",
        "tfsl",
        "tfsl.tokens",
        "tfsl.base",
        "tfsl.accent",
        "tfsl.overrides",
      ]);
    });
  });

  describe("Schema Validation and Type Guard", () => {
    it("isThemeCatalog correctly identifies catalog specs via own-property preflight", () => {
      const black = getBlackCatalogJson();
      expect(isThemeCatalog(black)).toBe(true);
      expect(isThemeCatalog(null)).toBe(false);
      expect(isThemeCatalog(undefined)).toBe(false);
      expect(isThemeCatalog("not an object")).toBe(false);
      expect(isThemeCatalog({})).toBe(false);
      expect(isThemeCatalog({ catalog: null })).toBe(false);
      expect(isThemeCatalog({ ...black, schemaVersion: "tfsl.theme-v1" })).toBe(false);
    });

    it("validates real candidate examples", () => {
      const black = getBlackCatalogJson();
      const validatedBlack = validateThemeCatalog(black);
      expect(validatedBlack.catalog.hero.routes.length).toBe(6);
      expect(validatedBlack.catalog.layout).toBe("standard");

      const celestia = getCelestiaCatalogJson();
      const validatedCelestia = validateThemeCatalog(celestia);
      expect(validatedCelestia.catalog.fontLicenses.length).toBe(1);
      expect(validatedCelestia.catalog.layout).toBe("compact");

      const flexoki = getFlexokiCatalogJson();
      const validatedFlexoki = validateThemeCatalog(flexoki);
      expect(validatedFlexoki.catalog.pagination.variant).toBe("plain");
      expect(validatedFlexoki.catalog.sidebar.mode).toBe("select");
    });

    it("rejects input exceeding 1 MiB envelope", () => {
      const black = getBlackCatalogJson();
      const oversized = {
        ...black,
        giantPadding: "a".repeat(1024 * 1024 + 50),
      };
      expect(() => validateThemeCatalog(oversized)).toThrow(ValidationErrorV2);
      expect(() => validateThemeCatalog(oversized)).toThrow(/1 MiB/);
    });

    it("rejects missing catalog property", () => {
      const black = getBlackCatalogJson();
      const noCatalog: any = { ...black };
      delete noCatalog.catalog;
      expect(() => validateThemeCatalog(noCatalog)).toThrow(ValidationErrorV2);
      expect(() => validateThemeCatalog(noCatalog)).toThrow(/catalog/);
    });

    it("rejects unknown keys in catalog object (finite closed record)", () => {
      const black = getBlackCatalogJson();
      const invalid = {
        ...black,
        catalog: {
          ...black.catalog,
          unknownKey: "rejected",
        },
      };
      expect(() => validateThemeCatalog(invalid)).toThrow(ValidationErrorV2);
    });

    it("rejects invalid catalog layout presets", () => {
      const black = getBlackCatalogJson();
      const invalid = {
        ...black,
        catalog: {
          ...black.catalog,
          layout: "wide", // wide is in core but rejected in catalog (only standard | compact)
        },
      };
      expect(() => validateThemeCatalog(invalid)).toThrow(ValidationErrorV2);
    });

    it("rejects invalid pageTitle copy options", () => {
      const black = getBlackCatalogJson();
      const invalid = {
        ...black,
        catalog: {
          ...black.catalog,
          pageTitle: {
            copy: "clipboard",
          },
        },
      };
      expect(() => validateThemeCatalog(invalid)).toThrow(ValidationErrorV2);
    });

    it("rejects invalid pagination variants", () => {
      const black = getBlackCatalogJson();
      const invalid = {
        ...black,
        catalog: {
          ...black.catalog,
          pagination: {
            variant: "floating",
          },
        },
      };
      expect(() => validateThemeCatalog(invalid)).toThrow(ValidationErrorV2);
    });

    it("rejects invalid sidebar modes and duplicate group IDs", () => {
      const black = getBlackCatalogJson();
      const invalidMode = {
        ...black,
        catalog: {
          ...black.catalog,
          sidebar: {
            mode: "drawer",
            groupIds: ["group-1"],
          },
        },
      };
      expect(() => validateThemeCatalog(invalidMode)).toThrow(ValidationErrorV2);

      const duplicateGroups = {
        ...black,
        catalog: {
          ...black.catalog,
          sidebar: {
            mode: "nested",
            groupIds: ["group-1", "group-1"],
          },
        },
      };
      expect(() => validateThemeCatalog(duplicateGroups)).toThrow(ValidationErrorV2);
    });
  });

  describe("Hero Validation and Path Safety", () => {
    it("rejects non-root-relative hero routes", () => {
      const black = getBlackCatalogJson();
      const invalidRoute = {
        ...black,
        catalog: {
          ...black.catalog,
          hero: {
            routes: [
              {
                ...black.catalog.hero.routes[0],
                route: "docs/getting-started", // missing leading slash
              },
            ],
          },
        },
      };
      expect(() => validateThemeCatalog(invalidRoute)).toThrow(ValidationErrorV2);
    });

    it("rejects directory traversal in hero routes and action hrefs", () => {
      const black = getBlackCatalogJson();

      // Raw traversal
      const rawTraversal = {
        ...black,
        catalog: {
          ...black.catalog,
          hero: {
            routes: [
              {
                ...black.catalog.hero.routes[0],
                route: "/docs/../../secret",
              },
            ],
          },
        },
      };
      expect(() => validateThemeCatalog(rawTraversal)).toThrow(/traversal/i);

      // Encoded traversal %2e%2e
      const encodedTraversal = {
        ...black,
        catalog: {
          ...black.catalog,
          hero: {
            routes: [
              {
                ...black.catalog.hero.routes[0],
                route: "/docs/%2e%2e/secret",
              },
            ],
          },
        },
      };
      expect(() => validateThemeCatalog(encodedTraversal)).toThrow(/traversal/i);

      // Backslash traversal
      const backslash = {
        ...black,
        catalog: {
          ...black.catalog,
          hero: {
            routes: [
              {
                ...black.catalog.hero.routes[0],
                route: "/docs\\windows\\path",
              },
            ],
          },
        },
      };
      expect(() => validateThemeCatalog(backslash)).toThrow(ValidationErrorV2);

      // Protocol-relative //
      const protoRelative = {
        ...black,
        catalog: {
          ...black.catalog,
          hero: {
            routes: [
              {
                ...black.catalog.hero.routes[0],
                actions: [{ label: "Link", href: "//malicious.com" }],
              },
            ],
          },
        },
      };
      expect(() => validateThemeCatalog(protoRelative)).toThrow(ValidationErrorV2);

      // External scheme
      const schemeHref = {
        ...black,
        catalog: {
          ...black.catalog,
          hero: {
            routes: [
              {
                ...black.catalog.hero.routes[0],
                actions: [{ label: "Link", href: "javascript:alert(1)" }],
              },
            ],
          },
        },
      };
      expect(() => validateThemeCatalog(schemeHref)).toThrow(ValidationErrorV2);
    });

    it("rejects hero layouts not in the 5 approved layouts", () => {
      const black = getBlackCatalogJson();
      const invalidLayout = {
        ...black,
        catalog: {
          ...black.catalog,
          hero: {
            routes: [
              {
                ...black.catalog.hero.routes[0],
                layout: "floating-card",
              },
            ],
          },
        },
      };
      expect(() => validateThemeCatalog(invalidLayout)).toThrow(ValidationErrorV2);
    });

    it("rejects media other than 'loom-orbit'", () => {
      const black = getBlackCatalogJson();
      const invalidMedia = {
        ...black,
        catalog: {
          ...black.catalog,
          hero: {
            routes: [
              {
                ...black.catalog.hero.routes[0],
                media: "custom-video",
              },
            ],
          },
        },
      };
      expect(() => validateThemeCatalog(invalidMedia)).toThrow(ValidationErrorV2);
    });
  });

  describe("Font Licenses and WOFF/WOFF2 Enforcements", () => {
    it("rejects font license hash mismatch", () => {
      const celestia = getCelestiaCatalogJson();
      const badHash = {
        ...celestia,
        catalog: {
          ...celestia.catalog,
          fontLicenses: [
            {
              ...celestia.catalog.fontLicenses[0],
              sha256: "0".repeat(64),
            },
          ],
        },
      };
      expect(() => validateThemeCatalog(badHash)).toThrow(/sha256 mismatch/i);
    });

    it("rejects used font without corresponding license in fontLicenses", () => {
      const celestia = getCelestiaCatalogJson();
      const missingLicense = {
        ...celestia,
        catalog: {
          ...celestia.catalog,
          fontLicenses: [], // Missing license for source-code-pro-ofl
        },
      };
      expect(() => validateThemeCatalog(missingLicense)).toThrow(/requires matching license/i);
    });

    it("rejects non-WOFF/WOFF2 font formats", () => {
      const celestia = getCelestiaCatalogJson();
      const invalidFont = {
        ...celestia,
        fonts: [
          {
            ...celestia.fonts[0],
            format: "ttf",
          },
        ],
      };
      expect(() => validateThemeCatalog(invalidFont)).toThrow(/woff/i);
    });
  });

  describe("Parsing and Canonicalization", () => {
    it("parseThemeCatalog parses valid JSON text", () => {
      const black = getBlackCatalogJson();
      const text = JSON.stringify(black, null, 2);
      const parsed = parseThemeCatalog(text);
      expect(parsed.name).toBe("loom-black-catalog");
      expect(parsed.catalog.layout).toBe("standard");
    });

    it("parseThemeCatalog rejects duplicate JSON keys", () => {
      const badJson = `{"name": "test", "name": "duplicate", "schemaVersion": "tfsl.theme-v2"}`;
      expect(() => parseThemeCatalog(badJson)).toThrow(/duplicate/i);
    });

    it("canonicalizeThemeCatalog deterministically byte-sorts keys and calculates SHA-256", () => {
      const black = getBlackCatalogJson();
      const { canonicalObject, canonicalJson, inputDigest } = canonicalizeThemeCatalog(black);
      expect(typeof canonicalJson).toBe("string");
      expect(typeof inputDigest).toBe("string");
      expect(inputDigest.length).toBe(64);

      // Verify re-canonicalization produces identical output
      const second = canonicalizeThemeCatalog(canonicalObject);
      expect(second.canonicalJson).toBe(canonicalJson);
      expect(second.inputDigest).toBe(inputDigest);

      // Expected sha256
      const expected = createHash("sha256").update(canonicalJson, "utf8").digest("hex");
      expect(inputDigest).toBe(expected);
    });
  });

  describe("Compilation and Unlayered Compat CSS", () => {
    it("compiles standard catalog theme and outputs ordered style inventory", () => {
      const black = getBlackCatalogJson();
      const compilation = compileThemeCatalog(black);

      expect(compilation.descriptor.catalogIdentity).toBe(CATALOG_IDENTITY);
      expect(compilation.descriptor.compilerSemantic).toBe(CATALOG_COMPILER_SEMANTIC);
      expect(compilation.styles.has("styles/compat.css")).toBe(true);

      const styleKeys = [...compilation.styles.keys()];
      expect(styleKeys).toEqual([
        "styles/layers.css",
        "styles/tokens.css",
        "styles/base.css",
        "styles/accent.css",
        "styles/overrides.css",
        "styles/code.css",
        "styles/compat.css",
      ]);

      const compatCss = compilation.styles.get("styles/compat.css")!;
      // Standard layout: 72rem (1152px)
      expect(compatCss).toContain("--sl-content-width: min(1152px, 1152px);");
      expect(compatCss).toContain(":root:not([data-has-sidebar])");
      // Coherent light print palette
      expect(compatCss).toContain("@media print");
      expect(compatCss).toContain(":root[data-theme]");
      expect(compatCss).toContain("color-scheme: light;");
    });

    it("compiles compact catalog theme with 60rem sidebar-less width", () => {
      const celestia = getCelestiaCatalogJson();
      const compilation = compileThemeCatalog(celestia);

      const compatCss = compilation.styles.get("styles/compat.css")!;
      // Compact layout: 60rem (960px)
      expect(compatCss).toContain("--sl-content-width: min(960px, 960px);");
    });
  });

  describe("Templates Generation", () => {
    it("emits valid Hero component supporting 5 layouts and single h1 _top", () => {
      const black = getBlackCatalogJson();
      const heroCode = emitHeroComponent(black.catalog);
      expect(heroCode).toContain('id="_top"');
      expect(heroCode).toContain('data-page-title');
      expect(heroCode).toContain("layout-centered");
      expect(heroCode).toContain("layout-media-top");
      expect(heroCode).toContain("layout-media-left");
      expect(heroCode).toContain("layout-media-right");
      expect(heroCode).toContain("layout-banner");
      expect(heroCode).toContain("tfsl-loom-orbit-svg");
      expect(heroCode).toContain("<DefaultHero />");
    });

    it("emits valid PageTitle component supporting copy modes", () => {
      const black = getBlackCatalogJson();
      const pageTitleCode = emitPageTitleComponent(black.catalog, true);
      expect(pageTitleCode).toContain('id="_top"');
      expect(pageTitleCode).toContain('tfsl-page-title-frame');
      expect(pageTitleCode).toContain('tfsl-title-copy-btn');
      expect(pageTitleCode).toContain("navigator.clipboard.writeText");
    });

    it("emits valid Pagination component with starlightRoute props", () => {
      const black = getBlackCatalogJson();
      const paginationCode = emitPaginationComponent(black.catalog);
      expect(paginationCode).toContain("Astro.locals.starlightRoute");
      expect(paginationCode).toContain("pagination-card");
      expect(paginationCode).toContain("pagination-plain");
      expect(paginationCode).toContain("pagination-compact");
    });

    it("emits valid Sidebar component with roving tabs, native select, and no SidebarPersister", () => {
      const black = getBlackCatalogJson();
      const sidebarCode = emitSidebarComponent(black.catalog);
      expect(sidebarCode).toContain("tfsl-roving-tablist");
      expect(sidebarCode).toContain("tfsl-sidebar-dropdown");
      expect(sidebarCode).toContain("MobileMenuFooter");
      expect(sidebarCode).not.toContain("SidebarPersister");
      expect(sidebarCode).toContain("projectNavigation");
      expect(sidebarCode).toContain("<Tree entries={entries}");
    });

    it("emits valid Route Middleware honoring consumer base and hero precedence", () => {
      const black = getBlackCatalogJson();
      const middlewareCode = emitMiddleware(black.catalog.hero.routes);
      expect(middlewareCode).toContain("route.entry.data.hero");
      expect(middlewareCode).toContain("normalize(route.id)");
      expect(middlewareCode).not.toContain("import.meta.env");
      expect(middlewareCode).toContain("data.hero.routes");
    });
  });

  describe("Package Generation, Inventory, and Writing", () => {
    it("generates complete closed package files and valid provenance for black catalog", () => {
      const black = getBlackCatalogJson();
      const metadata = {
        name: "starlight-theme-loom-black",
        version: "0.1.0",
      };

      const result = generateThemePackageCatalog({
        themeSpec: black,
        metadata,
      });

      expect(result.files.has("components/Hero.astro")).toBe(true);
      expect(result.files.has("components/PageTitle.astro")).toBe(true);
      expect(result.files.has("components/Pagination.astro")).toBe(true);
      expect(result.files.has("components/Sidebar.astro")).toBe(true);
      expect(result.files.has("assets/loom-orbit.svg")).toBe(true);
      expect(result.files.has("middleware.js")).toBe(true);
      expect(result.files.has("styles/compat.css")).toBe(true);

      const pkgJson = JSON.parse(result.files.get("package.json") as string);
      expect(pkgJson.scripts).toBeUndefined(); // no scripts
      expect(pkgJson.peerDependencies["@astrojs/starlight"]).toBe("^0.42.0");
      expect(pkgJson.peerDependencies["astro"]).toBe("^7.3.1");

      const indexJs = result.files.get("index.js") as string;
      expect(indexJs).toContain("Hero:");
      expect(indexJs).toContain("PageTitle:");
      expect(indexJs).toContain("Pagination:");
      expect(indexJs).toContain("Sidebar:");
      expect(indexJs).toContain("addRouteMiddleware");
      expect(indexJs).toContain("...(config?.components ?? {})"); // consumer overrides win

      // Provenance inventory verification (provenance.json is excluded from its own file inventory)
      expect(result.provenance.files.length).toBe(result.files.size - 1);
      for (const entry of result.provenance.files) {
        expect(result.files.has(entry.path)).toBe(true);
        expect(entry.sha256).toBe(
          createHash("sha256").update(result.files.get(entry.path)!).digest("hex")
        );
      }
    });

    it("generates package with font licenses materialized in inventory for celestia catalog", () => {
      const celestia = getCelestiaCatalogJson();
      const metadata = {
        name: "starlight-theme-loom-celestia",
        version: "0.1.0",
      };

      // Load fixture font byte
      const fontBytes = readFileSync(
        resolve(__dirname, "fixtures/catalog-font/source-code-pro.woff2")
      );
      const fontResources = new Map<string, Uint8Array>([
        ["source-code-pro", new Uint8Array(fontBytes)],
      ]);

      const result = generateThemePackageCatalog({
        themeSpec: celestia,
        metadata,
        fontResources,
      });

      expect(result.files.has("fonts/font-00.woff2")).toBe(true);
      expect(result.files.has("licenses/source-code-pro-ofl.txt")).toBe(true);
      expect(result.files.has("fonts/licenses/source-code-pro-ofl.txt")).toBe(false);

      const licContent = result.files.get("licenses/source-code-pro-ofl.txt") as string;
      expect(licContent).toContain("SIL OPEN FONT LICENSE Version 1.1");
    });

    it("writeThemePackageCatalog safely publishes to absent directory and rejects overwrite", async () => {
      const black = getBlackCatalogJson();
      const metadata = {
        name: "starlight-theme-test-write",
        version: "0.1.0",
      };

      const result = generateThemePackageCatalog({
        themeSpec: black,
        metadata,
      });

      const tempBase = mkdtempSync(join(tmpdir(), "tfsl-catalog-test-"));
      const outDir = join(tempBase, "pkg-out");

      try {
        const writtenFiles = await writeThemePackageCatalog(result, outDir);
        expect(writtenFiles.length).toBe(result.files.size);
        expect(existsSync(join(outDir, "package.json"))).toBe(true);
        expect(existsSync(join(outDir, "components/Hero.astro"))).toBe(true);
        expect(existsSync(join(outDir, "styles/compat.css"))).toBe(true);

        // Reject overwrite
        await expect(
          writeThemePackageCatalog(result, outDir, { overwrite: true })
        ).rejects.toThrow(FilesystemSafetyError);
      } finally {
        rmSync(tempBase, { recursive: true, force: true });
      }
    });
  });
});
