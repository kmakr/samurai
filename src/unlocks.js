export const SKIN_UNLOCKS = Object.freeze({
  hitokiri: { metric: 'wave', need: 5, label: 'REACH WAVE 5' },
  masamune: { metric: 'wave', need: 10, label: 'REACH WAVE 10' },
  mibu: { metric: 'flow', need: 20, label: 'HOLD A FLOW OF 20' },
});

export const WEAPON_UNLOCKS = Object.freeze({
  nodachi: { metric: 'wave', need: 8, label: 'REACH WAVE 8' },
});

function progress(records, requirement) {
  const value = Number(records?.[requirement.metric]);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function isUnlocked(id, records, requirements) {
  const requirement = requirements[id];
  return !requirement || progress(records, requirement) >= requirement.need;
}

export function nextLocked(items, records, requirements, describe) {
  let best = null;
  let bestRatio = -1;
  for (const item of items) {
    const requirement = requirements[item.id];
    if (!requirement || isUnlocked(item.id, records, requirements)) continue;
    const ratio = progress(records, requirement) / requirement.need;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = { id: item.id, ...describe(item), label: requirement.label };
    }
  }
  return best;
}

export function newlyUnlocked(items, before, after, requirements) {
  return items.filter((item) => (
    isUnlocked(item.id, after, requirements)
      && !isUnlocked(item.id, before, requirements)
  ));
}

export const isSkinUnlocked = (id, records) => isUnlocked(id, records, SKIN_UNLOCKS);
export const isWeaponUnlocked = (id, records) => isUnlocked(id, records, WEAPON_UNLOCKS);
export const nextLockedSkin = (items, records) => (
  nextLocked(items, records, SKIN_UNLOCKS, (item) => ({ name: item.name }))
);
export const nextLockedWeapon = (items, records) => (
  nextLocked(items, records, WEAPON_UNLOCKS, (item) => ({ roman: item.roman }))
);
export const newlyUnlockedSkins = (items, before, after) => (
  newlyUnlocked(items, before, after, SKIN_UNLOCKS)
);
export const newlyUnlockedWeapons = (items, before, after) => (
  newlyUnlocked(items, before, after, WEAPON_UNLOCKS)
);
