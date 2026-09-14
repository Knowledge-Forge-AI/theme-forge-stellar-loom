import {
  CODE_CATALOG_DIGEST,
  CODE_CATALOG_IDENTITY,
  CODE_COMPILER_SEMANTIC,
} from "../code/index.js";

export const SCHEMA_THEME_CANDIDATE = "tfsl.theme-candidate";
export const SCHEMA_THEME_CODE_CANDIDATE = "tfsl.theme-code-candidate";
export const THEME_EXCHANGE_CODE_SCHEMA_VERSION = 2;

export const DIGEST_DOMAIN_CANDIDATE_CODE = "tfsl.theme-code-candidate-v2\n";
export const DIGEST_DOMAIN_SYNTAX_CODE = "tfsl.theme-syntax-evidence-v2\n";
export const DIGEST_DOMAIN_CATALOG_CODE = "tfsl.starlight-code-catalog-v1\n";
export const DIGEST_DOMAIN_EXECUTABLE_CODE = "tfsl.theme-compiler-executable-code-v2\n";

export const SEMANTIC_COMPILER_CODE = CODE_COMPILER_SEMANTIC;
export const ADAPTER_CODE = "starlight-v0.42";
export const CATALOG_CODE = CODE_CATALOG_IDENTITY;
export const CATALOG_CODE_DIGEST = `sha256:${CODE_CATALOG_DIGEST}`;

export const RUNTIME_CODE_DEFAULT = "EC0.44.2 Shiki4.4.3";
export const RUNTIME_EXPRESSIVE_CODE = "0.44.2";
export const RUNTIME_SHIKI = "4.4.3";

export const EXTENSION_CANDIDATE_CODE = ".tfsl-candidate-v2.json";

export const MAX_PACKET_BYTES = 16 * 1024 * 1024; // 16 MiB
export const MAX_AGGREGATE_VISUAL_BYTES = 8 * 1024 * 1024; // 8 MiB
export const MAX_PNG_BYTES = 6 * 1024 * 1024; // 6 MiB
export const MAX_VISUAL_RECORDS = 8;
export const MAX_GENERAL_TEXT_BYTES = 4096;

export const ID_REGEX = /^[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*$/;
export const DIGEST_REGEX = /^sha256:[0-9a-f]{64}$/;

export function normalizeDigest(digest: string): string {
  return digest.startsWith("sha256:") ? digest.slice(7) : digest;
}

export function toPrefixedDigest(digest: string): string {
  return digest.startsWith("sha256:") ? digest : `sha256:${digest}`;
}
