import type { ThemeCatalogConfig, BookChromeConfig } from "../types.js";

/**
 * Emits Pagination.astro supporting plain, card, and compact variants.
 * Uses public starlightRoute props.
 */
export function emitPaginationComponent(
  catalog: ThemeCatalogConfig,
  isTs = false,
  bookChrome: boolean | BookChromeConfig = false
): string {
  const variant = catalog.pagination.variant;
  const navImport = isTs ? "../dist/navigation.js" : "../navigation.js";

  const chapterNavigation = typeof bookChrome === "object" ? bookChrome.chapterNavigation !== false : Boolean(bookChrome);
  const keyboardShortcuts = typeof bookChrome === "object" ? bookChrome.keyboardShortcuts !== false : Boolean(bookChrome);

  const arrowsMarkup = chapterNavigation ? `
<div class="tfsl-book-nav-arrows print:hidden" dir={dir}>
  {prev && (
    <a href={prev.href} rel="prev" class="tfsl-book-nav-arrow tfsl-book-nav-prev" title={prev.label} aria-label={prev.label}>
      <span aria-hidden="true">{isRtl ? "→" : "←"}</span>
    </a>
  )}
  {next && (
    <a href={next.href} rel="next prefetch" class="tfsl-book-nav-arrow tfsl-book-nav-next" title={next.label} aria-label={next.label}>
      <span aria-hidden="true">{isRtl ? "←" : "→"}</span>
    </a>
  )}
</div>
` : "";

  const scriptSnippet = keyboardShortcuts ? `
<script>
  function fieldHasFocus(e: KeyboardEvent): boolean {
    const target = (e.composedPath()[0] as HTMLElement | undefined) || (e.target as HTMLElement);
    if (!target) return false;
    if (target.isContentEditable) return true;
    if (/^(?:input|select|textarea)$/i.test(target.nodeName)) return true;
    if (target.closest?.('[role="tab"], [role="tablist"], [contenteditable="true"], .expressive-code, pre, code')) return true;
    let el: HTMLElement | null = target;
    let depth = 0;
    while (el && depth < 5 && el !== document.body && el !== document.documentElement) {
      if (el.scrollWidth - el.clientWidth >= 16) {
        const style = window.getComputedStyle(el);
        if (style.overflowX === "auto" || style.overflowX === "scroll") return true;
      }
      el = el.parentElement;
      depth++;
    }
    return false;
  }
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (document.querySelector("dialog[open]")) return;
    if (fieldHasFocus(e)) return;
    const isRtl = document.documentElement.dir === "rtl";
    let selector: string | null = null;
    if (e.key === "ArrowRight") selector = isRtl ? ".tfsl-book-nav-prev, [rel='prev']" : ".tfsl-book-nav-next, [rel~='next']";
    else if (e.key === "ArrowLeft") selector = isRtl ? ".tfsl-book-nav-next, [rel~='next']" : ".tfsl-book-nav-prev, [rel='prev']";
    if (!selector) return;
    const link = document.querySelector<HTMLAnchorElement>(selector);
    if (link && link.href) {
      e.preventDefault();
      window.location.href = link.href;
    }
  });
</script>
` : "";

  return `---
import { safeHref, text } from "${navImport}";
const starlightRoute = Astro.locals.starlightRoute;
const dir = starlightRoute?.dir || "ltr";
const pagination = starlightRoute?.pagination || {};
const prev = pagination.prev ? { href:safeHref(pagination.prev.href), label:text(pagination.prev.label) } : undefined;
const next = pagination.next ? { href:safeHref(pagination.next.href), label:text(pagination.next.label) } : undefined;
const variant = ${JSON.stringify(variant)};
const isRtl = dir === "rtl";
---
${arrowsMarkup ? `${arrowsMarkup}\n` : "\n"}{Boolean(prev || next) && (
  <nav class:list={["tfsl-pagination", \`variant-\${variant}\`, "print:hidden"]} aria-label="Pagination" dir={dir}>
    {variant === "plain" && (
      <div class="pagination-plain">
        {prev && (
          <a href={prev.href} rel="prev" class="plain-prev">
            <span class="arrow">{isRtl ? "→" : "←"}</span>
            <span class="label">{prev.label}</span>
          </a>
        )}
        {next && (
          <a href={next.href} rel="next" class="plain-next">
            <span class="label">{next.label}</span>
            <span class="arrow">{isRtl ? "←" : "→"}</span>
          </a>
        )}
      </div>
    )}

    {variant === "card" && (
      <div class="pagination-card">
        {prev && (
          <a href={prev.href} rel="prev" class="card-link prev">
            <span class="card-direction">{Astro.locals.t ? Astro.locals.t("page.previousLink") : "Previous"}</span>
            <span class="card-label">{prev.label}</span>
          </a>
        )}
        {next && (
          <a href={next.href} rel="next" class="card-link next">
            <span class="card-direction">{Astro.locals.t ? Astro.locals.t("page.nextLink") : "Next"}</span>
            <span class="card-label">{next.label}</span>
          </a>
        )}
      </div>
    )}

    {variant === "compact" && (
      <div class="pagination-compact">
        {prev && (
          <a href={prev.href} rel="prev" class="compact-btn prev" title={prev.label}>
            <span>{isRtl ? "→" : "←"}</span>
            <span class="compact-text">{prev.label}</span>
          </a>
        )}
        {next && (
          <a href={next.href} rel="next" class="compact-btn next" title={next.label}>
            <span class="compact-text">{next.label}</span>
            <span>{isRtl ? "←" : "→"}</span>
          </a>
        )}
      </div>
    )}
  </nav>
)}

<style>
  .tfsl-pagination {
    margin-top: 3rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--sl-color-hairline, #334155);
  }

  /* Plain */
  .pagination-plain {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
  }
  .pagination-plain a {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--sl-color-text-link, var(--sl-color-accent, #3b82f6));
    text-decoration: none;
    font-weight: 500;
  }
  .pagination-plain a:hover {
    text-decoration: underline;
  }
  .plain-next {
    margin-inline-start: auto;
  }

  /* Card */
  .pagination-card {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(16rem, 100%), 1fr));
    gap: 1rem;
  }
  .card-link {
    display: flex;
    flex-direction: column;
    padding: 1rem 1.25rem;
    border: 1px solid var(--sl-color-border, #334155);
    border-radius: var(--sl-radius, 0.5rem);
    background-color: var(--sl-color-bg-card, rgba(255, 255, 255, 0.02));
    text-decoration: none;
    transition: border-color 0.15s ease, background-color 0.15s ease;
  }
  .card-link:hover {
    border-color: var(--sl-color-accent, #3b82f6);
    background-color: var(--sl-color-bg-raised, rgba(255, 255, 255, 0.05));
  }
  .card-direction {
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--sl-color-text-muted, #94a3b8);
    margin-bottom: 0.25rem;
  }
  .card-label {
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--sl-color-white, #ffffff);
  }
  .card-link.next {
    text-align: end;
  }

  /* Compact */
  .pagination-compact {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .compact-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    font-size: 0.875rem;
    font-weight: 500;
    border-radius: var(--sl-radius, 0.375rem);
    border: 1px solid var(--sl-color-border, #334155);
    color: var(--sl-color-text, #cbd5e1);
    text-decoration: none;
    max-width: 48%;
  }
  .compact-btn:hover {
    border-color: var(--sl-color-accent, #3b82f6);
    color: var(--sl-color-white, #ffffff);
  }
  .compact-btn.next {
    margin-inline-start: auto;
  }
  .compact-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>${scriptSnippet ? `\n${scriptSnippet.trim()}\n` : "\n"}`;
}
