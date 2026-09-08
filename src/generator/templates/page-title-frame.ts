export const PAGE_TITLE_FRAME_TEMPLATE_ID = "page-title-frame" as const;

export function emitPageTitleFrameComponent(): string {
  return `---
import Default from "@astrojs/starlight/components/PageTitle.astro";
---

<div class="tfsl-page-title-frame" data-tfsl-template="page-title-frame">
  <Default {...Astro.props} />
</div>

<style>
  .tfsl-page-title-frame {
    border-left: 4px solid var(--sl-color-accent);
    padding-left: 1rem;
    margin-bottom: 1.5rem;
  }
</style>
`;
}
