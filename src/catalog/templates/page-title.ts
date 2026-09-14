import type { ThemeCatalogConfig } from "../types.js";

/**
 * Emits the PageTitle.astro component supporting copy: 'none' | 'title' | 'url'.
 * Copies explicit page title or same-origin URL only.
 * Retains single h1 with id="_top", and preserves frame styling if configured.
 */
export function emitPageTitleComponent(catalog: ThemeCatalogConfig, frame = false): string {
  const copyMode = catalog.pageTitle.copy;

  return `---
const starlightRoute = Astro.locals.starlightRoute;
const title = starlightRoute?.entry?.data?.title || "";
const copyMode = ${JSON.stringify(copyMode)};
const hasFrame = ${JSON.stringify(frame)};
---

<div class:list={["tfsl-page-title-wrap", { "tfsl-page-title-frame": hasFrame }]} data-tfsl-template="page-title">
  <div class="tfsl-page-title-row">
    <h1 id="_top" data-page-title>{title}</h1>
    {copyMode !== "none" && (
      <button
        type="button"
        class="tfsl-title-copy-btn"
        data-copy-mode={copyMode}
        data-copy-title={copyMode === "title" ? title : undefined}
        title={copyMode === "title" ? "Copy page title" : "Copy page URL"}
        aria-label={copyMode === "title" ? "Copy page title" : "Copy page URL"}
      >
        <svg class="copy-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        <svg class="check-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </button>
    )}
  </div>
</div>

{copyMode !== "none" && (
  <script is:inline>
    (() => {
      document.addEventListener("click", (e) => {
        const btn = e.target && e.target.closest(".tfsl-title-copy-btn");
        if (!btn) return;
        const mode = btn.dataset.copyMode;
        // Copy explicit title or same-origin URL only
        const textToCopy = mode === "title" ? btn.dataset.copyTitle : window.location.href;
        if (textToCopy && navigator.clipboard) {
          navigator.clipboard.writeText(textToCopy).then(() => {
            btn.classList.add("copied");
            setTimeout(() => btn.classList.remove("copied"), 1500);
          }).catch(() => {});
        }
      });
    })();
  </script>
)}

<style>
  .tfsl-page-title-wrap {
    margin-top: 1rem;
    margin-bottom: 1.5rem;
  }

  .tfsl-page-title-frame {
    border-left: 4px solid var(--sl-color-accent, #3b82f6);
    padding-left: 1rem;
  }

  .tfsl-page-title-row {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
  }

  h1 {
    margin: 0;
    font-size: var(--sl-text-h1, 2.25rem);
    line-height: var(--sl-line-height-headings, 1.25);
    font-weight: 600;
    color: var(--sl-color-white, #ffffff);
  }

  .tfsl-title-copy-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.375rem;
    background: transparent;
    border: 1px solid var(--sl-color-border, #334155);
    border-radius: var(--sl-radius, 0.375rem);
    color: var(--sl-color-text-muted, #94a3b8);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .tfsl-title-copy-btn:hover {
    color: var(--sl-color-accent, #3b82f6);
    border-color: var(--sl-color-accent, #3b82f6);
  }

  .check-icon {
    display: none;
  }

  .tfsl-title-copy-btn.copied .copy-icon {
    display: none;
  }

  .tfsl-title-copy-btn.copied .check-icon {
    display: inline-block;
    color: var(--sl-color-green, #22c55e);
  }
</style>
`;
}
