export const SCHEMA_THEME_BRIEF = "tfsl.theme-brief";
export const SCHEMA_THEME_CANDIDATE = "tfsl.theme-candidate";
export const SCHEMA_THEME_REVIEW = "tfsl.theme-review";
export const SCHEMA_THEME_VISUAL_EVIDENCE = "tfsl.theme-visual-evidence";

export const THEME_EXCHANGE_SCHEMA_VERSION = 1;

export const DIGEST_DOMAIN_BRIEF = "tfsl.theme-brief-v1\n";
export const DIGEST_DOMAIN_CANDIDATE = "tfsl.theme-candidate-v1\n";
export const DIGEST_DOMAIN_REVIEW = "tfsl.theme-review-v1\n";
export const DIGEST_DOMAIN_VISUAL = "tfsl.theme-visual-evidence-v1\n";

export const EXTENSION_BRIEF = ".tfsl-brief.json";
export const EXTENSION_CANDIDATE = ".tfsl-candidate.json";
export const EXTENSION_REVIEW = ".tfsl-review.json";

export const MAX_PACKET_BYTES = 16 * 1024 * 1024; // 16 MiB
export const MAX_AGGREGATE_VISUAL_BYTES = 8 * 1024 * 1024; // 8 MiB
export const MAX_PNG_BYTES = 6 * 1024 * 1024; // 6 MiB
export const MAX_CANDIDATES = 8;
export const MAX_VISUAL_RECORDS = 8;
export const MAX_ANNOTATIONS = 128;
export const MAX_GENERAL_TEXT_BYTES = 4096;
export const MAX_ANNOTATION_COMMENT_BYTES = 2048;
export const MIN_IMAGE_DIMENSION = 16;
export const MAX_IMAGE_DIMENSION = 1024;

export const ID_REGEX = /^[a-z][a-z0-9]*(?:[-.][a-z0-9]+)*$/;
export const DIGEST_REGEX = /^sha256:[0-9a-f]{64}$/;
