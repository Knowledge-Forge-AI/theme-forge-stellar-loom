import type { ThemeCatalogConfig } from "../types.js";
import { emitLoomOrbitSvg } from "./loom-orbit.js";
export function emitHeroComponent(_catalog: ThemeCatalogConfig): string {
  return `---
import DefaultHero from "@astrojs/starlight/components/Hero.astro";
import { localHref } from "../navigation.js";
const activeHero = (Astro.locals as any).tfslCatalogHero;
const layout = activeHero?.layout;
const base = import.meta.env.BASE_URL;
---
{!activeHero ? <DefaultHero /> : (
<div class:list={["tfsl-hero", \`layout-\${layout}\`]} data-tfsl-hero-layout={layout}>
  <div class="tfsl-hero-container">
    {activeHero.announcement && <div class="tfsl-hero-announcement-wrap"><a class="tfsl-hero-announcement" href={typeof activeHero.announcement === "object" && activeHero.announcement.href ? localHref(activeHero.announcement.href, base) : undefined}>{typeof activeHero.announcement === "string" ? activeHero.announcement : activeHero.announcement.text}</a></div>}
    <div class="tfsl-hero-grid">
      {activeHero.media && (layout === "media-top" || layout === "media-left") && <div class="tfsl-hero-media">${emitLoomOrbitSvg()}</div>}
      <div class="tfsl-hero-copy">
        <h1 id="_top" data-page-title class="tfsl-hero-title">{activeHero.title}</h1>
        {activeHero.subtitle && <p class="tfsl-hero-subtitle">{activeHero.subtitle}</p>}
        {activeHero.summary && <p class="tfsl-hero-summary">{activeHero.summary}</p>}
        <div class="tfsl-hero-actions">{activeHero.actions.map((action: any) => <a class="tfsl-hero-action-btn" href={localHref(action.href, base)}>{action.label}</a>)}</div>
      </div>
      {activeHero.media && !["media-top", "media-left"].includes(layout) && <div class="tfsl-hero-media">${emitLoomOrbitSvg()}</div>}
    </div>
  </div>
</div>
)}
<style>
  .tfsl-hero {
    padding: 2rem 1rem 3rem 1rem;
    margin-bottom: 2rem;
  }

  .tfsl-hero-container {
    max-width: 100%;
    margin: 0 auto;
  }

  .tfsl-hero-announcement-wrap {
    margin-bottom: 1.5rem;
  }

  .tfsl-hero-announcement {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 500;
    border-radius: 9999px;
    background-color: var(--sl-color-accent-low, #eff6ff);
    color: var(--sl-color-accent-high, #1d4ed8);
    border: 1px solid var(--sl-color-accent, #3b82f6);
    text-decoration: none;
  }

  .tfsl-hero-title {
    font-size: clamp(2rem, 5vw, 3.25rem);
    line-height: 1.15;
    font-weight: 700;
    margin-bottom: 1rem;
    color: var(--sl-color-white, #ffffff);
  }

  .tfsl-hero-subtitle {
    font-size: clamp(1.125rem, 2.5vw, 1.375rem);
    line-height: 1.5;
    color: var(--sl-color-text, #cbd5e1);
    margin-bottom: 1rem;
  }

  .tfsl-hero-summary {
    font-size: 1rem;
    line-height: 1.6;
    color: var(--sl-color-text-muted, #94a3b8);
    margin-bottom: 1.5rem;
  }

  .tfsl-hero-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    margin-top: 1.5rem;
  }

  .tfsl-hero-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.75rem 1.5rem;
    font-size: 1rem;
    font-weight: 600;
    border-radius: var(--sl-radius, 0.5rem);
    background-color: var(--sl-color-accent, #3b82f6);
    color: var(--sl-color-text-invert, #ffffff);
    text-decoration: none;
    transition: opacity 0.15s ease;
  }

  .tfsl-hero-action-btn:hover {
    opacity: 0.9;
  }

  .tfsl-hero-media {
    width: min(100%, 20rem);
    max-width: 20rem;
    height: auto;
  }

  /* Layout 1: Centered */
  .layout-centered .tfsl-hero-container {
    text-align: center;
  }
  .layout-centered .tfsl-hero-grid {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2rem;
  }
  .layout-centered .tfsl-hero-actions {
    justify-content: center;
  }

  /* Layout 2: Media Top */
  .layout-media-top .tfsl-hero-grid {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 2rem;
  }
  .layout-media-top .tfsl-hero-actions {
    justify-content: center;
  }

  /* Layout 3: Media Left */
  .layout-media-left .tfsl-hero-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 2rem;
    align-items: center;
  }
  @media (min-width: 50rem) {
    .layout-media-left .tfsl-hero-grid {
      grid-template-columns: auto 1fr;
    }
  }

  /* Layout 4: Media Right */
  .layout-media-right .tfsl-hero-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 2rem;
    align-items: center;
  }
  @media (min-width: 50rem) {
    .layout-media-right .tfsl-hero-grid {
      grid-template-columns: 1fr auto;
    }
  }

  /* Layout 5: Banner */
  .layout-banner {
    background-color: var(--sl-color-bg-card, rgba(255, 255, 255, 0.03));
    border: 1px solid var(--sl-color-border, #334155);
    border-radius: var(--sl-radius, 0.75rem);
    padding: 2.5rem 2rem;
  }
  .layout-banner .tfsl-hero-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 2rem;
    align-items: center;
  }
  @media (min-width: 50rem) {
    .layout-banner .tfsl-hero-grid {
      grid-template-columns: 1fr auto;
    }
  }
</style>
`;
}
