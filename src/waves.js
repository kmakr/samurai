// Pure wave rules. Scene creation and presentation remain in main.js; this
// module owns only the deterministic difficulty curve.

export const MAX_WAVE_ENEMIES = 18;
export const RIVAL_INTERVAL = 5;

export function isRivalWave(wave) {
  return wave > 0 && wave % RIVAL_INTERVAL === 0;
}

export function attackSlotsForWave(wave) {
  return wave === 1 ? 1 : Math.min(5, 2 + Math.floor(wave / 3));
}

export function enemyScalingForWave(wave) {
  return {
    hp: 1 + wave * 0.05,
    damage: 1 + wave * 0.04,
  };
}

export function waveComposition(wave, maxEnemies = MAX_WAVE_ENEMIES) {
  const list = [];
  // Counts plateau so late difficulty comes from threat and simultaneity, not
  // an unreadable crowd or an unbounded rendering cost.
  const ronin = Math.min(7, 2 + Math.floor(wave * 0.6));
  const hunters = wave >= 2 ? Math.min(6, Math.floor(wave * 0.5)) : 0;
  const yari = wave >= 3 ? Math.min(4, 1 + Math.floor((wave - 3) * 0.35)) : 0;
  // Wave four teaches one brute before it can mix with the first rival.
  const brutes = wave >= 4 ? Math.min(4, 1 + Math.floor((wave - 4) / 3)) : 0;
  const yumi = wave >= 6 ? Math.min(3, 1 + Math.floor((wave - 6) / 4)) : 0;

  for (let i = 0; i < ronin; i++) list.push('ronin');
  for (let i = 0; i < hunters; i++) list.push('hunter');
  for (let i = 0; i < yari; i++) list.push('yari');
  for (let i = 0; i < brutes; i++) list.push('brute');
  for (let i = 0; i < yumi; i++) list.push('yumi');
  if (isRivalWave(wave)) list.push('oni');

  // Preserve the dangerous mix and trim excess chaff first. This is also the
  // hard performance budget for full-field signature kills.
  const minimum = { ronin: 2, hunter: 3, yari: 2, brute: 2, yumi: 1, oni: 1 };
  const trimOrder = ['ronin', 'hunter', 'yari', 'brute', 'yumi'];
  while (list.length > maxEnemies) {
    let removed = false;
    for (const type of trimOrder) {
      const count = list.reduce((total, entry) => total + (entry === type ? 1 : 0), 0);
      if (count <= minimum[type]) continue;
      list.splice(list.indexOf(type), 1);
      removed = true;
      break;
    }
    if (!removed) list.pop();
  }

  return list;
}
