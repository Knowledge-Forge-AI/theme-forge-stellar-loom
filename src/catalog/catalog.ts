import { createHash } from "node:crypto";
import { sortCatalogKeys } from "./canonical.js";
import { emitLoomOrbitSvg } from "./templates/loom-orbit.js";
import { CATALOG_IDENTITY } from "./types.js";
import { CATALOG_SOURCE_PINS, CATALOG_ENTRYPOINTS, HISTORICAL_CATALOG_DIGEST, CATALOG_RUNTIME_PROJECTION_DOMAIN, EXPECTED_CATALOG_RUNTIME_DIGEST } from "./qualification.js";

export const STARLIGHT_COMPONENT_CATALOG_V1 = Object.freeze({
  catalogIdentity: CATALOG_IDENTITY,
  adapter: "starlight-v0.42",
  sourceQualification: CATALOG_SOURCE_PINS,
  entrypoints: CATALOG_ENTRYPOINTS,
  coreQualification: Object.freeze({
    identity: "tfsl.starlight-core-catalog-v1",
    digest: "d45f945d3323244c5b6d2908799c968d5d1d223e945b8aed0a0ce96b76f32953",
  }),
  codeQualification: Object.freeze({
    identity: "tfsl.starlight-code-catalog-v1",
    digest: "a56cd99c26ce6e015854338eee63fd850121cf2c86af7cbe992cf39b4b58f34b",
  }),
  runtime: Object.freeze({
    astro: "7.3.1",
    expressiveCode: "0.44.2",
    shiki: "4.4.3",
    starlight: "0.42.0",
  }),
  capabilities: Object.freeze({
    hero: Object.freeze({
      layouts: Object.freeze(["centered", "media-top", "media-left", "media-right", "banner"]),
      media: Object.freeze(["loom-orbit"]),
      maxRoutes: 32,
      maxActionsPerRoute: 8,
    }),
    pageTitle: Object.freeze({
      copy: Object.freeze(["none", "title", "url"]),
    }),
    pagination: Object.freeze({
      variants: Object.freeze(["plain", "card", "compact"]),
    }),
    sidebar: Object.freeze({
      modes: Object.freeze(["nested", "tabs", "select", "active-only"]),
      maxGroups: 16,
    }),
    layout: Object.freeze(["standard", "compact"]),
    fontLicenses: Object.freeze({
      maxLicenses: 8,
      formats: Object.freeze(["woff", "woff2"]),
      requiredForUsedFonts: true,
    }),
  }),
  approvedComponents: Object.freeze([
    "Hero",
    "PageTitle",
    "Pagination",
    "Sidebar",
  ]),
  approvedExpressions: Object.freeze({
    compatibility: "starlight-0.42-sidebar-less-width-and-selected-light-print-v1",
    loomOrbitSvg: emitLoomOrbitSvg(),
  }),
  styleInventory: Object.freeze([
    "styles/layers.css",
    "styles/tokens.css",
    "styles/base.css",
    "styles/accent.css",
    "styles/overrides.css",
    "styles/code.css",
    "styles/compat.css",
  ]),
  layers: Object.freeze([
    "starlight",
    "tfsl",
    "tfsl.tokens",
    "tfsl.base",
    "tfsl.accent",
    "tfsl.overrides",
  ]),
});

export function computeCatalogDigest(): string {
  const sorted = sortCatalogKeys(STARLIGHT_COMPONENT_CATALOG_V1);
  const json = JSON.stringify(sorted, null, 2) + "\n";
  return createHash("sha256").update(json, "utf8").digest("hex");
}

// Output compatibility identity stays historical. It is not a current-source hash.
export const CATALOG_DIGEST = HISTORICAL_CATALOG_DIGEST;

/**
 * Runtime projection v1: UTF-8 byte-sorted object keys, authored array order,
 * two-space JSON plus LF, prefixed by the fixed domain. Historical source pins
 * and the expected-literal carrier are excluded. Executable equality is separate.
 */
export function computeCatalogRuntimeDigest(): string {
  const { sourceQualification: _, ...runtime } = STARLIGHT_COMPONENT_CATALOG_V1;
  const json = JSON.stringify(sortCatalogKeys(runtime), null, 2) + "\n";
  return createHash("sha256").update(CATALOG_RUNTIME_PROJECTION_DOMAIN + json, "utf8").digest("hex");
}

export function verifyCatalogDigest(): boolean {
  return computeCatalogRuntimeDigest() === EXPECTED_CATALOG_RUNTIME_DIGEST
    && computeCatalogDigest() === HISTORICAL_CATALOG_DIGEST;
}
