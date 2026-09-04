export const EMPTY_RECORDS = Object.freeze({
  wave: 0,
  kills: 0,
  parries: 0,
  flow: 0,
});

const RECORDS_KEY = 'samurai-records';
const LEDGER_KEY = 'samurai-ledger';
const GRUDGE_KEY = 'samurai-grudge';

function score(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
}

export function normalizeRecords(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    wave: score(source.wave),
    kills: score(source.kills),
    parries: score(source.parries),
    flow: score(source.flow),
  };
}

export function runResult(state) {
  return normalizeRecords({
    wave: state.wave,
    kills: state.kills,
    parries: state.perfectParries,
    flow: state.bestChain,
  });
}

export function mergeRecords(previous, result) {
  const before = normalizeRecords(previous);
  const next = normalizeRecords(result);
  return {
    wave: Math.max(before.wave, next.wave),
    kills: Math.max(before.kills, next.kills),
    parries: Math.max(before.parries, next.parries),
    flow: Math.max(before.flow, next.flow),
  };
}

export function isNewRecord(previous, result) {
  const before = normalizeRecords(previous);
  const next = normalizeRecords(result);
  return Object.keys(EMPTY_RECORDS).some((metric) => next[metric] > before[metric]);
}

function normalizeLedger(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({
      ...normalizeRecords(entry),
      daily: Boolean(entry.daily),
      date: typeof entry.date === 'string' ? entry.date : '',
    }))
    .slice(-48);
}

export class RunRecordsStore {
  constructor(storage, { writeEnabled = true } = {}) {
    this.storage = storage;
    this.writeEnabled = writeEnabled;
  }

  readJson(key, fallback) {
    try {
      const raw = this.storage?.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  writeJson(key, value) {
    if (!this.writeEnabled) return;
    try { this.storage?.setItem(key, JSON.stringify(value)); } catch { /* private storage can fail */ }
  }

  loadRecords() {
    return normalizeRecords(this.readJson(RECORDS_KEY, EMPTY_RECORDS));
  }

  saveRecords(records) {
    const normalized = normalizeRecords(records);
    this.writeJson(RECORDS_KEY, normalized);
    return normalized;
  }

  loadLedger() {
    return normalizeLedger(this.readJson(LEDGER_KEY, []));
  }

  pushLedger(entry) {
    const ledger = [...this.loadLedger(), {
      ...normalizeRecords(entry),
      daily: Boolean(entry.daily),
      date: typeof entry.date === 'string' ? entry.date : '',
    }].slice(-48);
    this.writeJson(LEDGER_KEY, ledger);
    return ledger;
  }

  loadGrudge() {
    try {
      const value = this.storage?.getItem(GRUDGE_KEY);
      return typeof value === 'string' ? value : '';
    } catch {
      return '';
    }
  }

  saveGrudge(name) {
    if (!this.writeEnabled || typeof name !== 'string') return;
    try { this.storage?.setItem(GRUDGE_KEY, name); } catch { /* private storage can fail */ }
  }

  clearGrudge() {
    if (!this.writeEnabled) return;
    try { this.storage?.removeItem(GRUDGE_KEY); } catch { /* private storage can fail */ }
  }

  recordRun(result, ledgerEntry) {
    const previous = this.loadRecords();
    const normalizedResult = normalizeRecords(result);
    const records = this.saveRecords(mergeRecords(previous, normalizedResult));
    const ledger = this.pushLedger(ledgerEntry);
    return {
      previous,
      records,
      ledger,
      isRecord: isNewRecord(previous, normalizedResult),
    };
  }
}
