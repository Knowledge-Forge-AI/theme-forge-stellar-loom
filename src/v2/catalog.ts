import { createHash } from "node:crypto";
import { emitPageTitleFrameComponent } from "../generator/templates/page-title-frame.js";
import { CATALOG_IDENTITY, CATALOG_DIGEST } from "./types.js";

function sortKeysDeep(val: unknown): unknown {
  if (Array.isArray(val)) {
    return val.map(sortKeysDeep);
  }
  if (val !== null && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortKeysDeep(obj[key]);
    }
    return sorted;
  }
  return val;
}

export const STARLIGHT_CORE_CATALOG_V1 = Object.freeze({
  catalogIdentity: CATALOG_IDENTITY,
  adapter: "starlight-v0.42",
  // Repository qualification pins; installed consumers do not read TypeScript source.
  sourceSha256: Object.freeze({
    "v2/compiler.ts": "30d556dab3eab9750070a56dbd84d73dff4e8a456e525984fbdf35a986450982",
    "v2/validator.ts": "472c165917a96ef7fa2f6093817f0dd70de3be431724266eeb01fe50e9f6574e",
    "v2/canonical.ts": "a9859a17c9f433f9f9dc9ca4e4d7c9467af05a96f0c38ae0eb854e636004ded2",
    "generator/v2-emitter.ts": "83af82e70436b3795d0cb2f99c230e1c21b6d2462a8c1b8c5642558e27aa0e21",
    "generator/v2-writer.ts": "afc6b00095f5f57e158d7d57335b37c083c7a87cae2fb67a1a464803d8f8105c",
    "generator/metadata.ts": "8511a180a86477449b83839d8687ec9827e1d0cc55a3cdf71a3ad15fe22184fe",
    "generator/legal.ts": "1f389ed0d1286e9603890f7fd9ed5f2a4fd91c2981901dfea4ae4cb3b9a9b918",
    "generator/templates/page-title-frame.ts": "142239e3e062bc98383a1e4514b2ebb4bbe242d3536cf093a8af5db1a78c8ba7",
    "font-resources.ts": "566312badf04fa48acb938de923ea61b0c7cf41385cf6bc1c37f6a861802d749",
    "design-exchange-v2/canonical.ts": "9cdc2f241465eba6d0012d71863a34c1271c69f652d9add98aeb96e9e26599f9",
    "design-exchange-v2/import-v1.ts": "8c5223b906fb15b5ea163dd536863ce855ef5a618cf019ed5773e88ff1ae1497"
}),
  styleInventory: ["styles/layers.css", "styles/tokens.css", "styles/base.css", "styles/accent.css", "styles/overrides.css"],
  approvedExpressions: Object.freeze({
    pageTitleFrameTemplate: emitPageTitleFrameComponent(),
  }),
  approvedStacks: Object.freeze({
    "system-sans": "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
    "system-serif": "ui-serif, Georgia, Cambria, \"Times New Roman\", Times, serif",
    "system-mono": "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace",
    "system-code": "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace",
    "system-ui": "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif",
  }),
  approvedLayouts: Object.freeze({
    "standard": Object.freeze({
      contentWidth: 1152,
    }),
    "compact": Object.freeze({
      contentWidth: 960,
    }),
    "wide": Object.freeze({
      contentWidth: 1440,
    }),
  }),
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
  const sorted = sortKeysDeep(STARLIGHT_CORE_CATALOG_V1);
  const json = JSON.stringify(sorted, null, 2) + "\n";
  return createHash("sha256").update(json, "utf8").digest("hex");
}

export function verifyCatalogDigest(): boolean {
  return computeCatalogDigest() === CATALOG_DIGEST;
}
