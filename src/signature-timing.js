// Real-time choreography lets the player draw while the battlefield is held.
export const IAI_TIMING = Object.freeze({ draw: .22, travel: .14, strike: .36, release: .51, finish: .70 });
export function iaiProgress(seconds) {
  const t = Math.max(0, Math.min(1, (seconds - IAI_TIMING.draw) / IAI_TIMING.travel));
  return t * t * (3 - 2 * t);
}
export function isTimeStopped(action, skill, seconds) {
  return action === 'iai' && skill === 'iai' && seconds < IAI_TIMING.release;
}
