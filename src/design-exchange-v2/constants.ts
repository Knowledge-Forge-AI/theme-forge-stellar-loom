import { CATALOG_DIGEST, CATALOG_IDENTITY, COMPILER_SEMANTIC } from "../v2/index.js";

export const SCHEMA_THEME_CANDIDATE_V2 = "tfsl.theme-candidate";
export const THEME_EXCHANGE_V2_SCHEMA_VERSION = 2;

export const DIGEST_DOMAIN_CANDIDATE_V2 = "tfsl.theme-candidate-v2\n";
export const DIGEST_DOMAIN_VISUAL_V2 = "tfsl.theme-visual-evidence-v2\n";
export const DIGEST_DOMAIN_CATALOG_V2 = "tfsl.starlight-core-catalog-v1\n";
export const DIGEST_DOMAIN_EXECUTABLE_V2 = "tfsl.theme-compiler-executable-v2\n";

export const SEMANTIC_COMPILER_V2 = COMPILER_SEMANTIC;
export const ADAPTER_V2 = "starlight-v0.42";
export const CATALOG_V2 = CATALOG_IDENTITY;

export const EXTENSION_CANDIDATE_V2 = ".tfsl-candidate-v2.json";

export const CATALOG_V2_DIGEST = `sha256:${CATALOG_DIGEST}`;

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
