import { createHash } from "node:crypto";
import { parseThemeExchangePacket } from "../design-exchange/serde.js";
import type { ThemeCandidatePacket } from "../design-exchange/types.js";
import type {
  ThemeSpecificationV2,
  TypographyV2,
  SurfacesV2,
  AccentVariantDefinition,
} from "../v2/index.js";
import {
  type ThemeCandidateV2Packet,
  type ImportThemeV1ToV2Options,
} from "./types.js";
import { createThemeCandidateV2 } from "./create.js";

/**
 * Import a historical v1 theme candidate packet into a fresh v2 candidate.
 * Strictly validates the historical packet using the existing v1 parser,
 * strips $schema, maps v1 palette to all 22 role refs in the new v2 specification,
 * performs a fresh local compile linking original packet digest and byte digest
 * in originV1, and produces an unadopted state: "candidate" packet.
 * No review/adoption is carried over.
 */
export function importThemeV1ToV2(
  raw: string | Uint8Array,
  options?: ImportThemeV1ToV2Options
): ThemeCandidateV2Packet {
  // 1. Calculate serialized byte digest of the raw input
  const rawBuffer = typeof raw === "string" ? Buffer.from(raw, "utf8") : Buffer.from(raw);
  const byteDigest = `sha256:${createHash("sha256").update(rawBuffer).digest("hex")}`;

  // 2. Parse and validate the historical packet using the strict v1 parser
  const v1Candidate = parseThemeExchangePacket(raw, "candidate") as ThemeCandidatePacket;
  const packetDigest = v1Candidate.candidateDigest;

  // 3. Map v1 theme to v2 theme: strip $schema and finite map old palette to all 22 role refs
  const v1Theme = v1Candidate.theme as any;
  const darkColors = v1Theme.colors.dark;
  const lightColors = v1Theme.colors.light;

  const tokenSet: Record<string, string> = {
    "bg-page-dark": darkColors.neutrals.bg,
    "bg-page-light": lightColors.neutrals.bg,
    "bg-nav-dark": darkColors.neutrals.bgNav,
    "bg-nav-light": lightColors.neutrals.bgNav,
    "bg-sidebar-dark": darkColors.neutrals.bgSidebar,
    "bg-sidebar-light": lightColors.neutrals.bgSidebar,
    "bg-raised-dark": darkColors.grays.gray6 ?? darkColors.neutrals.bg,
    "bg-raised-light": lightColors.grays.gray6 ?? lightColors.neutrals.bg,
    "bg-panel-dark": darkColors.neutrals.bgNav,
    "bg-panel-light": lightColors.neutrals.bgNav,
    "bg-card-dark": darkColors.neutrals.bgSidebar,
    "bg-card-light": lightColors.neutrals.bgSidebar,
    "bg-inline-code-dark": darkColors.neutrals.bgInlineCode,
    "bg-inline-code-light": lightColors.neutrals.bgInlineCode,
    "bg-code-dark": darkColors.neutrals.bgInlineCode,
    "bg-code-light": lightColors.neutrals.bgInlineCode,
    "text-body-dark": darkColors.neutrals.text,
    "text-body-light": lightColors.neutrals.text,
    "text-secondary-dark": darkColors.grays.gray1,
    "text-secondary-light": lightColors.grays.gray1,
    "text-muted-dark": darkColors.grays.gray3,
    "text-muted-light": lightColors.grays.gray3,
    "text-invert-dark": darkColors.neutrals.textInvert,
    "text-invert-light": lightColors.neutrals.textInvert,
    "text-link-dark": darkColors.neutrals.textAccent,
    "text-link-light": lightColors.neutrals.textAccent,
    "hairline-dark": darkColors.neutrals.hairline,
    "hairline-light": lightColors.neutrals.hairline,
    "border-dark": darkColors.neutrals.hairlineLight,
    "border-light": lightColors.neutrals.hairlineLight,
    "focus-dark": darkColors.neutrals.textAccent,
    "focus-light": lightColors.neutrals.textAccent,
    "selection-bg-dark": darkColors.accent.low,
    "selection-bg-light": lightColors.accent.low,
    "selection-text-dark": darkColors.accent.high,
    "selection-text-light": lightColors.accent.high,
    "accent-base-dark": darkColors.accent.base,
    "accent-base-light": lightColors.accent.base,
    "accent-low-dark": darkColors.accent.low,
    "accent-low-light": lightColors.accent.low,
    "accent-high-dark": darkColors.accent.high,
    "accent-high-light": lightColors.accent.high,
  };

  const accentVariants: Record<string, AccentVariantDefinition> = {
    default: {
      tokenSet: "imported-v1",
      dark: {
        page: "bg-page-dark",
        navigation: "bg-nav-dark",
        header: "bg-nav-dark",
        sidebar: "bg-sidebar-dark",
        raised: "bg-raised-dark",
        panel: "bg-panel-dark",
        card: "bg-card-dark",
        "inline-code": "bg-inline-code-dark",
        code: "bg-code-dark",
        body: "text-body-dark",
        secondary: "text-secondary-dark",
        muted: "text-muted-dark",
        inverted: "text-invert-dark",
        link: "text-link-dark",
        hairline: "hairline-dark",
        border: "border-dark",
        focus: "focus-dark",
        "selection-background": "selection-bg-dark",
        "selection-text": "selection-text-dark",
        "accent-base": "accent-base-dark",
        "accent-low": "accent-low-dark",
        "accent-high": "accent-high-dark",
      },
      light: {
        page: "bg-page-light",
        navigation: "bg-nav-light",
        header: "bg-nav-light",
        sidebar: "bg-sidebar-light",
        raised: "bg-raised-light",
        panel: "bg-panel-light",
        card: "bg-card-light",
        "inline-code": "bg-inline-code-light",
        code: "bg-code-light",
        body: "text-body-light",
        secondary: "text-secondary-light",
        muted: "text-muted-light",
        inverted: "text-invert-light",
        link: "text-link-light",
        hairline: "hairline-light",
        border: "border-light",
        focus: "focus-light",
        "selection-background": "selection-bg-light",
        "selection-text": "selection-text-light",
        "accent-base": "accent-base-light",
        "accent-low": "accent-low-light",
        "accent-high": "accent-high-light",
      },
    },
  };

  const baseFontSize = typeof v1Theme.typography?.baseFontSize === "string"
    ? parseFloat(v1Theme.typography.baseFontSize) || 16
    : (typeof v1Theme.typography?.baseFontSize === "number" ? v1Theme.typography.baseFontSize : 16);
  const lineHeight = typeof v1Theme.typography?.lineHeight === "number"
    ? v1Theme.typography.lineHeight
    : 1.6;
  const bodyFont = v1Theme.typography?.bodyFont ?? "system-sans";
  const codeFont = v1Theme.typography?.codeFont ?? "system-mono";

  const typography: TypographyV2 = {
    body: { font: bodyFont, size: baseFontSize, lineHeight },
    heading: { font: bodyFont, size: 28, lineHeight: 1.25 },
    ui: { font: bodyFont, size: 14, lineHeight: 1.5 },
    code: { font: codeFont, size: 14, lineHeight: 1.5 },
  };

  const surfaces: SurfacesV2 = {
    spacing: 4,
    radii: 8,
    border: 1,
    focus: 2,
    content: 1152,
    sidebar: 288,
  };

  const v2Theme: ThemeSpecificationV2 = {
    // $schema is stripped
    name: v1Theme.name,
    version: v1Theme.version,
    schemaVersion: "tfsl.theme-v2",
    adapter: "starlight-v0.42",
    tokenSets: {
      "imported-v1": tokenSet,
    },
    accentVariants,
    defaultAccent: "default",
    typography,
    surfaces,
    layoutPreset: "standard",
    components: {
      pageTitle: v1Candidate.packageMetadata?.template === "page-title-frame" ? "page-title-frame" : "consumer-default",
    },
    codePresentation: "consumer-default",
    fonts: [],
  };

  // 4. Rebind fresh compile with createThemeCandidateV2 (state: "candidate" only, no inherited adoption)
  return createThemeCandidateV2(v2Theme, {
    candidateId: options?.candidateId ?? `v2-import-${byteDigest.slice(7, 31)}`,
    rationale: `${options?.rationale ?? "Explicit historical v1 import"}. Lossy core mapping: original layout ${JSON.stringify(v1Theme.layout)} is replaced by content 1152px and sidebar 288px; heading 28px, UI/code 14px and standard layout preset are fresh core defaults. Relative font sizes are interpreted numerically as px. Fresh visual verification and adoption are required.`,
    selectedAccent: options?.selectedAccent ?? "default",
    visualSha: options?.visualSha,
    visualEvidence: options?.visualEvidence,
    claimedProvenance: options?.claimedProvenance,
    fontResources: options?.fontResources,
    originV1: {
      packetDigest,
      byteDigest,
    },
  });
}
