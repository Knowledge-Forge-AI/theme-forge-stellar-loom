/**
 * Fixed original media asset for Loom Orbit.
 * Self-contained pure SVG vector data; requires NO ImageMetadata or image processing.
 */
export function emitLoomOrbitSvg(): string {
  return `<svg viewBox="0 0 400 400" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" class="tfsl-loom-orbit-svg" aria-hidden="true">
  <defs>
    <radialGradient id="tfsl-loom-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="var(--sl-color-accent, #3b82f6)" stop-opacity="0.3" />
      <stop offset="100%" stop-color="var(--sl-color-accent, #3b82f6)" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="tfsl-loom-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="var(--sl-color-accent-high, #60a5fa)" />
      <stop offset="100%" stop-color="var(--sl-color-accent, #3b82f6)" />
    </linearGradient>
  </defs>
  <circle cx="200" cy="200" r="180" fill="url(#tfsl-loom-glow)" />
  <circle cx="200" cy="200" r="140" fill="none" stroke="var(--sl-color-hairline, #e2e8f0)" stroke-width="1.5" stroke-dasharray="4 6" opacity="0.6" />
  <circle cx="200" cy="200" r="95" fill="none" stroke="var(--sl-color-border, #cbd5e1)" stroke-width="2" opacity="0.8" />
  <circle cx="200" cy="200" r="50" fill="none" stroke="url(#tfsl-loom-ring-grad)" stroke-width="2.5" />
  <circle cx="200" cy="200" r="16" fill="var(--sl-color-accent, #3b82f6)" />
  <circle cx="200" cy="200" r="8" fill="var(--sl-color-white, #ffffff)" />
  <circle cx="200" cy="60" r="7" fill="var(--sl-color-accent-high, #60a5fa)" />
  <circle cx="267" cy="133" r="5" fill="var(--sl-color-accent, #3b82f6)" />
  <circle cx="105" cy="200" r="9" fill="var(--sl-color-accent-base, #2563eb)" />
  <circle cx="235" cy="335" r="6" fill="var(--sl-color-accent-low, #93c5fd)" />
  <circle cx="340" cy="200" r="4" fill="var(--sl-color-text-muted, #94a3b8)" />
</svg>
`;
}
