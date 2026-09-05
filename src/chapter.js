// A finite, authored journey. Combat, crossings, rewards and the ending are
// separate states: an empty battlefield alone can never skip a gate or win.
export const CHAPTER_STAGES = Object.freeze([
  { name: 'The Rain Court', subtitle: 'I / OUTER WALL', objective: 'Break the watch. Reach the garden gate.', gate: 'ENTER THE LANTERN GARDEN', arrival: 'Kurogane has sealed the shrine. His watch holds the outer court.' },
  { name: 'Lantern Garden', subtitle: 'II / THE APPROACH', objective: 'Cut through the ambush. Open the shrine.', gate: 'CROSS THE SHRINE GATE', arrival: 'The lanterns are still burning. The garden is not empty.' },
  { name: 'The Inner Shrine', subtitle: 'III / THE IRON DEMON', objective: 'Defeat Kurogane. End the long rain.', gate: 'LEAVE THE BLADE AT THE SHRINE', arrival: 'One last gate. Kurogane waits beneath the bell.' },
]);

const encounter = (name, groups, slots, options = {}) => ({ name, groups, slots, ...options });
export const CHAPTER_ENCOUNTERS = Object.freeze([
  encounter('The watch', [['ronin','ronin'], ['ronin','ronin','hunter']], 1),
  encounter('Blades in the rain', [['hunter','ronin','hunter'], ['yari','ronin','ronin']], 2),
  encounter('The gatekeeper', [['brute','ronin','ronin'], ['yari','hunter','hunter']], 2),
  encounter('The lantern ambush', [['yumi','ronin','ronin'], ['hunter','hunter','yari','yumi']], 2),
  encounter('Through the bamboo', [['yari','yari','hunter'], ['brute','ronin','yumi','hunter']], 3),
  encounter('The shrine watch', [['brute','yari','hunter','hunter'], ['yumi','ronin','brute']], 3),
  encounter('The last disciples', [['yari','hunter','ronin','yumi'], ['brute','yari','hunter','ronin']], 3),
  encounter('A silence before steel', [['brute','yari','hunter'], ['brute','yari','hunter','yumi']], 3),
  encounter('Kurogane', [['oni']], 1, { rivalName: 'KUROGANE' }),
]);

export class ChapterDirector {
  constructor(state) { this.state = state; this.reset(); }
  reset() {
    this.stage = 0; this.index = -1; this.phase = 'arrival';
    this.timer = 3; this.elapsed = 0; this.cleared = 0; this.victory = false;
    this.state.chapterWon = false;
  }
  get active() { return this.phase !== 'inactive'; }
  disable() { this.phase = 'inactive'; }
  get stageInfo() { return CHAPTER_STAGES[this.stage]; }
  tick(dt, enemyCount, position) {
    if (!this.active || this.victory || this.state.over) return null;
    if (!this.state.choosingUpgrade) this.elapsed += dt;
    if (this.phase === 'combat') {
      if (enemyCount === 0) { this.phase = 'settle'; this.timer = 2.4; }
      return null;
    }
    if (this.phase === 'crossing' || this.phase === 'offering') {
      // The open gate is a physical destination, with a generous touch radius.
      if (Math.abs(position.x) < 3.3 && position.z < -13.2) {
        if (this.phase === 'offering') {
          this.victory = true; this.state.chapterWon = true; this.phase = 'complete';
          return 'victory';
        }
        this.phase = 'transition'; this.timer = .65;
        return 'fade';
      }
      return null;
    }
    if (this.phase === 'choice') return null;
    this.timer -= dt;
    if (this.timer > 0) return null;
    if (this.phase === 'settle') {
      this.cleared++;
      if (this.index === CHAPTER_ENCOUNTERS.length - 1) { this.phase = 'offering'; return 'offering'; }
      if (this.cleared % 3 === 0) { this.phase = 'crossing'; return 'gate'; }
      this.phase = 'choice';
      return this.index === 0 ? 'technique' : 'upgrade';
    }
    if (this.phase === 'transition') {
      this.stage++; this.phase = 'arrival'; this.timer = 3.2;
      return 'enter';
    }
    if (this.phase === 'arrival' || this.phase === 'ready') return 'start';
    return null;
  }
  startEncounter({ grudgeName = '' } = {}) {
    if (this.phase !== 'arrival' && this.phase !== 'ready') return null;
    const def = CHAPTER_ENCOUNTERS[++this.index];
    if (!def) return null;
    this.phase = 'combat'; this.state.wave = this.index + 1;
    this.state.slots = def.slots;
    const enemies = def.groups.flatMap((group, groupIndex) => group.map((type, i) => ({
      type, delay: groupIndex * 9 + i * .65 + .1,
      // Enemies walk in from the two visible side entrances, never rise
      // underneath the player. Reinforcements have their own arrival beat.
      entry: { x: (i % 2 ? -1 : 1) * 17.2, z: (i % 3 - 1) * .65 },
      rival: type === 'oni', rivalName: def.rivalName || '',
      grudge: type === 'oni' && grudgeName === def.rivalName,
    })));
    if (def.rivalName) enemies[0].entry = { x: 0, z: -11.5 };
    return { wave: this.state.wave, name: def.name, rivalName: def.rivalName || '',
      grudge: grudgeName === def.rivalName, composition: enemies.map(e => e.type), enemies };
  }
  finishChoice() {
    if (this.phase !== 'choice') return false;
    this.phase = 'ready'; this.timer = 1.5; return true;
  }
}

export const TECHNIQUES = Object.freeze([
  { id: 'reprisal', name: 'Storm Reprisal', mark: '雷', style: 'READ · RETURN', description: 'A perfect parry stores lightning. Your next cut releases it through nearby enemies.', mastery: 'Each gate crossed adds another lightning target.' },
  { id: 'echo', name: 'Hollow Step', mark: '影', style: 'BAIT · VANISH', description: 'Dashing leaves a swordsman behind. Half a second later, your echo cuts anyone who followed.', mastery: 'Each gate crossed strengthens the echo and widens its cut.' },
  { id: 'thread', name: "Heaven’s Thread", mark: '糸', style: 'MARK · EXECUTE', description: 'Cuts mark up to three enemies. Your signature also strikes every marked foe, wherever they stand.', mastery: 'Each gate crossed strengthens the remote execution.' },
]);

export function chapterRecord(previous, { seconds, technique, kills, parries }) {
  const source = previous && typeof previous === 'object' ? previous : {};
  const finite=value=>Number.isFinite(Number(value))?Math.max(0,Math.round(Number(value))):0;
  const safeTime = Math.max(1, finite(seconds));
  return { clears: finite(source.clears) + 1,
    bestSeconds: finite(source.bestSeconds) > 0 ? Math.min(finite(source.bestSeconds), safeTime) : safeTime,
    last: { seconds: safeTime, technique, kills, parries } };
}
