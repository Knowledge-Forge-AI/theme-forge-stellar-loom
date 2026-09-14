import { createHash } from "node:crypto";
import { sortCodeKeys as sortKeysDeep } from "./canonical.js";
import { emitPageTitleFrameComponent } from "../generator/templates/page-title-frame.js";
import {
  CODE_CATALOG_IDENTITY,
  CODE_CATALOG_DIGEST,
  CODE_STYLE_FILES,
} from "./types.js";

export const CODE_CSS_EXPRESSION = `/* Theme Forge Stellar Loom v2 - Expressive Code overrides */
@layer tfsl.overrides {
  .sl-markdown-content .expressive-code pre,
  .expressive-code pre {
    background-color: var(--code-background, var(--ec-codeBg));
  }
  .expressive-code pre, .expressive-code pre > code {
    font-family: var(--ec-codeFontFml);
    font-size: var(--ec-codeFontSize);
    line-height: var(--ec-codeLineHt);
  }
}
`;

export const STARLIGHT_CODE_CATALOG_V1 = Object.freeze({
  catalogIdentity: CODE_CATALOG_IDENTITY,
  adapter: "starlight-v0.42",
  coreQualification: { identity: "tfsl.starlight-core-catalog-v1", digest: "d45f945d3323244c5b6d2908799c968d5d1d223e945b8aed0a0ce96b76f32953" },
  runtime: { expressiveCode: "0.44.2", shiki: "4.4.3", starlight: "0.42.0" },
  syntax: { bytes: 262144, rules: 512, scopesPerRule: 32, scopeBytes: 128, colors: "srgb-hex-6", order: "authored-rules-and-scopes-utf8-map-keys", requiredModes: ["light", "dark"] },
  // Repository qualification pins; no claim of runtime source authentication.
  sourceSha256: Object.freeze({
  "batch.ts": "de0a46ea70ef0e420394cb74e23addc9b0361006689a90f86656595d7f010bd4",
  "cli-v2.ts": "b443b093c334e7e8106531846057d90f147d59cae052610a3d71b21444b8bf52",
  "code/canonical.ts": "fa1e4aa1ad8b7c0e62c0f682609050989ec2611244bace1cb92f879403ed8eba",
  "code/compiler.ts": "c469a9f37493195be9211be159c66d7776be90e80c3aca0505679541f482f82f",
  "code/config.ts": "0665803bc847c5236e50622c412b6e8e23abfbbb7ff52a5689a9b796e00450f0",
  "code/index.ts": "3640ff044109bd8d8e17721da9a76578c9348f96ccad77518eee5bee4e3ab18d",
  "code/json.ts": "e857de1bd3167ec986d375490c96bc6948b4438bde7b3022cd7be84eda0a3b4a",
  "code/parse.ts": "ae5849c3de013b2d5e807ed2bd96011f2ea4f301f537132d31a42829accbb7a9",
  "code/validator.ts": "f6b53ea3b13bfccf8a172828c9af46105bbc5bd64e64af840d09767b6923c82c",
  "design-exchange-code/canonical.ts": "a5eff4e6ef4fbafb21768788b300960769e39f65e1767b57509727c4d1253684",
  "design-exchange-code/compat.ts": "a2608e1ab83bfadf4b0c7e08771750eab25600f12da7d9fc8888f8535b3f5b9b",
  "design-exchange-code/constants.ts": "9fa03ac93f7b63dd9135890b432b5d5462ae5a5352eb36462f5be39a1ddb1908",
  "design-exchange-code/create.ts": "373b338858fd4c0e96941ab970e2134db48df51b8975fdbb6d065a7910c65e7d",
  "design-exchange-code/index.ts": "7dbd0035e7eae29f8db534822b5d4c471268fe844755a34c046f7d1460fcc428",
  "design-exchange-code/package-generator.ts": "a745ecef8524e096f361b9f23e91727e0237f0c8c79726f3dbb936716e33f6fc",
  "design-exchange-code/serde.ts": "ace594deeed97d50e823db8373d9ec88fedd23425a5b08bf0e5a41990ffe1497",
  "design-exchange-code/types.ts": "068cffa4bed27962d32ea042beca5ca30d12fb0807d7497d7062d83b7f419e3e",
  "design-exchange-code/validator.ts": "75f69ebd512576811a0cd3a8be8ea1336f92a0f25151107accf409b53c8ffb59",
  "design-exchange-code/verify.ts": "a07d269dd15f628645e58683047604c50dfecbbdec371c2cf4f85bdd369ba476",
  "generator/code-emitter.ts": "4dba1e11f9b51fbf0354d3380a62a34dfa1e239fe64d0881c906b497eeb66f79",
  "generator/code-merge.ts": "87a10e5943e0ee15452748256163a9c09b5c952f7c0a48d24957b8dbc0a34588",
  "generator/dispatch.ts": "7b9fe3bcdd034e62fc53fdb4b9af202b7d382e79ce034a5b0fb7732a6480d690",
  "index.ts": "e730acab092b9280150f8190ab4a7624b8881ad6030b7f4c7c67e1436500620e",
  "public-api.ts": "2da0491906047c06055856f3f4d7c6cbc256585b3ab54f90672ffa5981e248d5"
}),
  styleInventory: Object.freeze([...CODE_STYLE_FILES]),
  approvedExpressions: Object.freeze({
    codeCss: CODE_CSS_EXPRESSION,
    pageTitleFrameTemplate: emitPageTitleFrameComponent(),
  }),
  approvedMappings: Object.freeze({
    frames: Object.freeze({
      plain: "none",
      editor: "code",
      terminal: "terminal",
    }),
    copy: Object.freeze(["standard", "minimal"]),
    tabs: "deferred",
    lineNumbers: "deferred",
    focused: "deferred",
  }),
  approvedStacks: Object.freeze({
    "system-sans": "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif",
    "system-serif": "ui-serif, Georgia, Cambria, \"Times New Roman\", Times, serif",
    "system-mono": "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace",
    "system-code": "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, \"Liberation Mono\", \"Courier New\", monospace",
    "system-ui": "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif",
  }),
  approvedLayouts: Object.freeze({
    standard: Object.freeze({
      contentWidth: 1152,
    }),
    compact: Object.freeze({
      contentWidth: 960,
    }),
    wide: Object.freeze({
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

export function computeCodeCatalogDigest(): string {
  const sorted = sortKeysDeep(STARLIGHT_CODE_CATALOG_V1);
  const json = JSON.stringify(sorted, null, 2) + "\n";
  return createHash("sha256").update(json, "utf8").digest("hex");
}

export { CODE_CATALOG_DIGEST };

export function verifyCodeCatalogDigest(): boolean {
  return computeCodeCatalogDigest() === CODE_CATALOG_DIGEST;
}
