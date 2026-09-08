import type { ThemeSpecification } from "../types.js";

export const VALID_LEAF_FIELDS: readonly string[] = Object.freeze([
  "colors.dark.accent.base",
  "colors.dark.accent.high",
  "colors.dark.accent.low",
  "colors.dark.grays.gray1",
  "colors.dark.grays.gray2",
  "colors.dark.grays.gray3",
  "colors.dark.grays.gray4",
  "colors.dark.grays.gray5",
  "colors.dark.grays.gray6",
  "colors.dark.grays.gray7",
  "colors.dark.neutrals.bg",
  "colors.dark.neutrals.bgAccent",
  "colors.dark.neutrals.bgInlineCode",
  "colors.dark.neutrals.bgNav",
  "colors.dark.neutrals.bgSidebar",
  "colors.dark.neutrals.hairline",
  "colors.dark.neutrals.hairlineLight",
  "colors.dark.neutrals.hairlineShade",
  "colors.dark.neutrals.text",
  "colors.dark.neutrals.textAccent",
  "colors.dark.neutrals.textInvert",
  "colors.light.accent.base",
  "colors.light.accent.high",
  "colors.light.accent.low",
  "colors.light.grays.gray1",
  "colors.light.grays.gray2",
  "colors.light.grays.gray3",
  "colors.light.grays.gray4",
  "colors.light.grays.gray5",
  "colors.light.grays.gray6",
  "colors.light.grays.gray7",
  "colors.light.neutrals.bg",
  "colors.light.neutrals.bgAccent",
  "colors.light.neutrals.bgInlineCode",
  "colors.light.neutrals.bgNav",
  "colors.light.neutrals.bgSidebar",
  "colors.light.neutrals.hairline",
  "colors.light.neutrals.hairlineLight",
  "colors.light.neutrals.hairlineShade",
  "colors.light.neutrals.text",
  "colors.light.neutrals.textAccent",
  "colors.light.neutrals.textInvert",
  "layout.contentWidth",
  "layout.sidebarWidth",
  "name",
  "typography.baseFontSize",
  "typography.bodyFont",
  "typography.codeFont",
  "typography.lineHeight",
  "version",
].sort());

const LEAF_FIELD_SET = new Set(VALID_LEAF_FIELDS);

export function isValidLeafField(path: string): boolean {
  return LEAF_FIELD_SET.has(path);
}

export function getLeafFieldValue(spec: ThemeSpecification, path: string): unknown {
  const parts = path.split(".");
  let current: any = spec;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Return list of leaf field paths that differ between two themes
 */
export function findThemeDiffs(baseSpec: ThemeSpecification, targetSpec: ThemeSpecification): string[] {
  const diffs: string[] = [];
  for (const field of VALID_LEAF_FIELDS) {
    const valA = getLeafFieldValue(baseSpec, field);
    const valB = getLeafFieldValue(targetSpec, field);
    if (valA !== valB) {
      diffs.push(field);
    }
  }
  return diffs;
}

/**
 * Check constraints of allowedFields and allowedModes.
 * Returns array of violation strings (empty if compliant).
 */
export function checkConstraints(
  baseline: ThemeSpecification,
  candidate: ThemeSpecification,
  allowedFields: readonly string[],
  allowedModes: readonly ("dark" | "light")[]
): string[] {
  const violations: string[] = [];
  const allowedSet = new Set(allowedFields);
  const allowedModesSet = new Set(allowedModes);

  // Check immutable root fields
  if (candidate.adapter !== baseline.adapter) {
    violations.push(`Candidate changed adapter from '${baseline.adapter}' to '${candidate.adapter}'`);
  }
  if (candidate.schemaVersion !== baseline.schemaVersion) {
    violations.push(`Candidate changed schemaVersion from '${baseline.schemaVersion}' to '${candidate.schemaVersion}'`);
  }

  const diffs = findThemeDiffs(baseline, candidate);

  for (const diff of diffs) {
    // If diff is in a mode-specific color path, check allowedModes
    if (diff.startsWith("colors.dark.") && !allowedModesSet.has("dark")) {
      violations.push(`Candidate changed dark mode field '${diff}' which is not in allowedModes`);
      continue;
    }
    if (diff.startsWith("colors.light.") && !allowedModesSet.has("light")) {
      violations.push(`Candidate changed light mode field '${diff}' which is not in allowedModes`);
      continue;
    }

    // Check allowedFields constraint if provided and non-empty
    if (allowedFields.length > 0 && !allowedSet.has(diff)) {
      violations.push(`Candidate modified unpermitted field '${diff}'`);
    }
  }

  return violations;
}
