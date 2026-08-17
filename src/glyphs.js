// Discipline sigils: sumi-e brush marks, one per upgrade scroll. Inline SVG in
// the game's ink-on-paper palette (currentColor), so they stay text like every
// other asset. Each is built from a few tapering strokes plus one dry-brush
// dashed line — the same vocabulary as the sword trail and the ink marks.

const S = (body) =>
  `<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true">${body}</svg>`;

export const DISCIPLINE_ART = {
  // The enso: one breath, one circle, and the blade waiting in the gap.
  steelMind: S(`
    <path d="M76 20 A 43 43 0 1 0 93 35" stroke-width="10"/>
    <path d="M71 26 A 35 35 0 1 0 87 39" stroke-width="2.2" opacity="0.28" stroke-dasharray="16 7 24 9"/>
    <path d="M89 12 L 79 44" stroke-width="5"/>
    <path d="M79 44 L 75 52" stroke-width="2" opacity="0.5"/>`),

  // A rising gust that cuts, ink flung from its tip.
  bloodWind: S(`
    <path d="M14 86 Q 52 64 100 34" stroke-width="9"/>
    <path d="M24 97 Q 58 80 90 58" stroke-width="5" opacity="0.6"/>
    <path d="M20 90 Q 54 70 96 40" stroke-width="1.6" opacity="0.26" stroke-dasharray="10 6 22 8"/>
    <circle cx="106" cy="27" r="3.2" fill="currentColor" stroke="none"/>
    <circle cx="111" cy="18" r="1.8" fill="currentColor" stroke="none" opacity="0.7"/>`),

  // Two measuring cuts, then the one that ends it.
  finalStroke: S(`
    <path d="M36 20 L 24 70" stroke-width="4" opacity="0.5"/>
    <path d="M60 17 L 48 72" stroke-width="4" opacity="0.5"/>
    <path d="M103 15 L 22 101" stroke-width="10"/>
    <path d="M98 24 L 31 95" stroke-width="2" opacity="0.28" stroke-dasharray="16 7 20 9"/>`),

  // One drop, three rings, and the surface keeps its calm.
  stillWater: S(`
    <path d="M60 14 Q 63 40 60 62" stroke-width="5"/>
    <circle cx="60" cy="66" r="2.6" fill="currentColor" stroke="none"/>
    <ellipse cx="60" cy="76" rx="40" ry="10" stroke-width="3.4" opacity="0.8"/>
    <ellipse cx="60" cy="76" rx="24" ry="6" stroke-width="2.4" opacity="0.5"/>
    <ellipse cx="60" cy="76" rx="10" ry="2.6" stroke-width="2" opacity="0.32"/>`),

  // The blade, the tsuba, and a shadow that reaches past the steel.
  longShadow: S(`
    <path d="M14 48 Q 58 41 102 44" stroke-width="7"/>
    <path d="M27 37 L 35 55" stroke-width="4" opacity="0.8"/>
    <path d="M28 64 L 114 57" stroke-width="2.2" opacity="0.34" stroke-dasharray="26 8 36 10"/>`),

  // The leaf that refuses the ground once; its fall line drifts.
  fallingLeaf: S(`
    <path d="M24 14 Q 48 26 44 50 Q 42 60 32 66" stroke-width="2" opacity="0.32" stroke-dasharray="12 6 16 7"/>
    <path d="M52 44 Q 82 44 100 72 Q 68 76 52 44 Z" fill="currentColor" stroke="none" opacity="0.92"/>
    <path d="M100 72 L 107 82" stroke-width="2.6"/>`),
};

// Small marks for the HUD and chrome, same brush vocabulary at glyph size.

// Life is ink here — the health gauge is marked with a drop of it.
export const HUD_LIFE = `<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 2 Q 15 9 14.2 13.2 A 4.5 4.5 0 0 1 5.6 13.2 Q 5 9 10 2 Z"/></svg>`;

// The drawn blade with its tsuba tick — the iai charge.
export const HUD_IAI = `<svg viewBox="0 0 24 14" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true"><path d="M3 10 L 21 5" stroke-width="2.6"/><path d="M6.2 4.2 L 8.6 11" stroke-width="1.8" opacity="0.8"/></svg>`;

// Mastery: the enso all but closed, with the center held. The circle is kept.
export const MASTERY_SEAL = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true"><path d="M13.4 3.6 A 7.6 7.6 0 1 0 16.2 8.2" stroke-width="2.4"/><circle cx="10" cy="10.4" r="2.1" fill="currentColor" stroke="none"/></svg>`;

// A stroke that trails off into dry fragments — set above the death poem.
export const POEM_FLOURISH = `<svg viewBox="0 0 120 14" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true"><path d="M6 9 Q 50 4 88 7" stroke-width="3"/><path d="M94 7.5 L 103 8.2" stroke-width="1.6" opacity="0.6"/><path d="M108 8.6 L 113 9" stroke-width="1" opacity="0.35"/></svg>`;
