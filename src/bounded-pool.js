export const TRANSIENT_EFFECT_LIMITS = Object.freeze({
  parryRings: 12,
  impactBursts: 24,
  dashWakes: 12,
});

export const INK_LIMITS = Object.freeze({
  stains: 620,
  drops: 420,
  jets: 64,
  screenMarks: 120,
  slashes: 6,
});

export const RAGDOLL_LIMITS = Object.freeze({ bodies: 48, debris: 60 });
export const DEFAULT_GIB_POOL = 320;

// Small short-lived effects are intentionally ordinary arrays, but every
// producer goes through this gate so a burst of events cannot grow them without
// limit. `onEvict` releases Three.js resources when the oldest slot is reused.
export function pushBounded(list, value, limit, onEvict = () => {}) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('limit must be a positive integer');
  }
  while (list.length >= limit) onEvict(list.shift());
  list.push(value);
  return value;
}
