import { COLOR_ROLES } from "../../v2/types.js";
import { resolveToken } from "../../v2/validator.js";
import type { ThemeSpecificationCatalog } from "../types.js";

/** Starlight 0.42 unlayered sidebar-less rule and late print token corrections. */
export function emitCompatCss(spec: ThemeSpecificationCatalog, accent: string): string {
  const variant = spec.accentVariants[accent]!;
  const light = Object.fromEntries(COLOR_ROLES.map(role => [role, resolveToken(spec.tokenSets, variant.tokenSet, variant.light[role]!, accent, role, "light")]));
  const cap = Math.min({ standard:1152, compact:960, wide:1440 }[spec.layoutPreset], spec.catalog.layout === "compact" ? 960 : 1152);
  const mappings: Record<string,string> = {
    bg:"page", "bg-nav":"header", "bg-sidebar":"sidebar", "bg-inline-code":"inline-code",
    text:"body", "text-accent":"link", "text-invert":"inverted", white:"secondary", black:"page",
    "hairline":"hairline", "hairline-light":"border", "hairline-shade":"border",
    "accent":"accent-base", "accent-low":"accent-low", "accent-high":"accent-high", "bg-accent":"accent-base",
    "gray-1":"secondary", "gray-2":"secondary", "gray-3":"muted", "gray-4":"muted", "gray-5":"border", "gray-6":"raised", "gray-7":"panel",
  };
  return `/* Fixed Starlight 0.42 compatibility. Later consumer rules of matching specificity win. */
@media screen {
  :root:not([data-has-sidebar]) { --sl-content-width: ${spec.surfaces.content}px; }
  @media (min-width:50rem) {
    :root:not([data-has-sidebar]) { --sl-content-width: min(${spec.surfaces.content}px, ${cap}px); }
  }
}
@media print {
  :root[data-theme] {
    color-scheme: light;
${COLOR_ROLES.map(role => `    --tfsl-color-${role}: ${light[role]};`).join("\n")}
${Object.entries(mappings).map(([key,role])=>`    --sl-color-${key}: var(--tfsl-color-${role});`).join("\n")}
  }
  .expressive-code .frame pre {
    background-color: var(--tfsl-color-code);
    color: var(--tfsl-color-body);
    --code-background: var(--tfsl-color-code);
    --ec-codeBg: var(--tfsl-color-code);
  }
  .expressive-code .frame pre code { color: inherit; }
  .expressive-code .frame pre span[style] { color: var(--0, inherit); }
}
`;
}
