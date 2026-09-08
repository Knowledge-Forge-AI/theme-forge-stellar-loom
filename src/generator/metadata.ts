import { ValidationError } from "../schema/validator.js";
import {
  APPROVED_TEMPLATES,
  type ApprovedTemplateId,
  type PackageMetadata,
} from "./types.js";

// npm package name rules:
// - lowercase letters, digits, hyphens, underscores, dots
// - optional scope: @scope/name
// - max 214 chars
// - no leading dot or underscore in unscoped name or scope
// - no path traversal or URL-unfriendly characters
const NPM_PACKAGE_NAME_REGEX =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

// Strict SemVer 2.0.0 regex
const SEMVER_REGEX =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function validatePackageMetadata(input: unknown): PackageMetadata {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ValidationError(
      "Package metadata must be a JSON object",
      "metadata",
      "INVALID_METADATA_TYPE"
    );
  }

  const record = input as Record<string, unknown>;

  // Check unknown top-level keys
  const allowedKeys = new Set([
    "name",
    "version",
    "description",
    "author",
    "license",
    "template",
  ]);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) {
      throw new ValidationError(
        `Unknown property in package metadata: '${key}'`,
        `metadata.${key}`,
        "UNKNOWN_METADATA_PROPERTY"
      );
    }
  }

  // 1. name (required)
  if (typeof record.name !== "string" || record.name.trim().length === 0) {
    throw new ValidationError(
      "Package name is required and must be a non-empty string",
      "metadata.name",
      "INVALID_PACKAGE_NAME"
    );
  }

  const name = record.name.trim();
  if (name.length > 214) {
    throw new ValidationError(
      "Package name exceeds maximum length of 214 characters",
      "metadata.name",
      "PACKAGE_NAME_TOO_LONG"
    );
  }

  if (name !== name.toLowerCase()) {
    throw new ValidationError(
      "Package name must be entirely lowercase",
      "metadata.name",
      "PACKAGE_NAME_NOT_LOWERCASE"
    );
  }

  if (name.includes("..") || name.includes("\\") || name.startsWith("/") || name.endsWith("/")) {
    throw new ValidationError(
      "Package name contains path traversal or invalid path characters",
      "metadata.name",
      "PATH_TRAVERSAL_DETECTED"
    );
  }

  if (!NPM_PACKAGE_NAME_REGEX.test(name)) {
    throw new ValidationError(
      `Package name '${name}' is not a valid npm package name`,
      "metadata.name",
      "INVALID_PACKAGE_NAME"
    );
  }

  // 2. version (required)
  if (typeof record.version !== "string" || record.version.trim().length === 0) {
    throw new ValidationError(
      "Package version is required and must be a non-empty string",
      "metadata.version",
      "INVALID_PACKAGE_VERSION"
    );
  }

  const version = record.version.trim();
  if (!SEMVER_REGEX.test(version)) {
    throw new ValidationError(
      `Package version '${version}' is not valid SemVer (e.g. 0.1.0)`,
      "metadata.version",
      "INVALID_SEMVER"
    );
  }

  // 3. description (optional)
  let description: string | undefined = undefined;
  if (record.description !== undefined && record.description !== null) {
    if (typeof record.description !== "string") {
      throw new ValidationError(
        "Package description must be a string",
        "metadata.description",
        "INVALID_DESCRIPTION"
      );
    }
    const desc = record.description.trim();
    if (desc.length > 500) {
      throw new ValidationError(
        "Package description must not exceed 500 characters",
        "metadata.description",
        "DESCRIPTION_TOO_LONG"
      );
    }
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(desc)) {
      throw new ValidationError(
        "Package description contains forbidden control characters",
        "metadata.description",
        "FORBIDDEN_CONTROL_CHARACTERS"
      );
    }
    description = desc;
  }

  // 4. author (optional)
  let author: string | undefined = undefined;
  if (record.author !== undefined && record.author !== null) {
    if (typeof record.author !== "string") {
      throw new ValidationError(
        "Package author must be a string",
        "metadata.author",
        "INVALID_AUTHOR"
      );
    }
    const auth = record.author.trim();
    if (auth.length > 200) {
      throw new ValidationError(
        "Package author must not exceed 200 characters",
        "metadata.author",
        "AUTHOR_TOO_LONG"
      );
    }
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(auth)) {
      throw new ValidationError(
        "Package author contains forbidden control characters",
        "metadata.author",
        "FORBIDDEN_CONTROL_CHARACTERS"
      );
    }
    author = auth;
  }

  // 5. license (optional, default AGPL-3.0-or-later)
  let license = "AGPL-3.0-or-later";
  if (record.license !== undefined && record.license !== null) {
    if (typeof record.license !== "string") {
      throw new ValidationError(
        "Package license must be a string",
        "metadata.license",
        "INVALID_LICENSE"
      );
    }
    const lic = record.license.trim();
    if (lic !== "AGPL-3.0-or-later") {
      throw new ValidationError(
        `Package license '${lic}' is not permitted. First-party policy requires 'AGPL-3.0-or-later'`,
        "metadata.license",
        "UNSUPPORTED_LICENSE"
      );
    }
    license = lic;
  }

  // 6. template (optional)
  let template: ApprovedTemplateId | undefined = undefined;
  if (record.template !== undefined && record.template !== null) {
    if (typeof record.template !== "string") {
      throw new ValidationError(
        "Package template must be a string",
        "metadata.template",
        "INVALID_TEMPLATE"
      );
    }
    const tmpl = record.template.trim();
    if (!APPROVED_TEMPLATES.includes(tmpl as ApprovedTemplateId)) {
      throw new ValidationError(
        `Unknown or unapproved template ID '${tmpl}'. Approved templates: ${APPROVED_TEMPLATES.join(", ")}`,
        "metadata.template",
        "UNKNOWN_TEMPLATE"
      );
    }
    template = tmpl as ApprovedTemplateId;
  }

  const result: PackageMetadata = {
    name,
    version,
    license,
  };
  if (description !== undefined) result.description = description;
  if (author !== undefined) result.author = author;
  if (template !== undefined) result.template = template;

  return result;
}
