// Adaptive practice statistics shared by the trainer panels: per-item accuracy and response time, persisted
// in localStorage, and selection weights that favour weak (or slow, or unseen) items.
// Pure logic: storage is injected (anything with getItem/setItem), so it runs in node.

const RECENT = 12; // results kept per item for the recent accuracy

/** localStorage when usable, else null (private mode, node). */
export function safeStorage() {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    s.getItem('pianoPractice.probe');
    return s;
  } catch {
    return null;
  }
}

/** Smoothed recent accuracy of an entry (Laplace prior, so 1 of 1 is not 100 %). */
export function entryAccuracy(e) {
  if (!e || !e.recent?.length) return null;
  const ok = e.recent.reduce((a, b) => a + b, 0);
  return (ok + 1) / (e.recent.length + 2);
}

/**
 * Selection weight of an item: unseen items get a high weight so they are tried soon; then the weight grows
 * with the recent error rate and with response times slower than the average (`refMs`).
 */
export function itemWeight(e, refMs = null) {
  if (!e || !e.n) return 2;
  const acc = entryAccuracy(e);
  let w = 0.3 + 3 * (1 - acc);
  if (refMs && e.ms) w += Math.min(1.5, Math.max(0, e.ms / refMs - 1));
  return w;
}

/** Pick one of `items` with probability proportional to weightOf(item). */
export function weightedPick(rng, items, weightOf = () => 1) {
  if (items.length === 1) return items[0];
  return rng.weighted(items.map((it) => [it, Math.max(0.05, weightOf(it))]));
}

/** Per-item statistics stored under one localStorage key. Item keys are free-form strings ('type:maj'). */
export class ItemStats {
  constructor(key, storage = safeStorage()) {
    this.key = key;
    this.storage = storage;
    this.data = { v: 1, items: {} };
    try {
      const raw = storage?.getItem(key);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && typeof d.items === 'object') this.data = d;
      }
    } catch { /* corrupt or unavailable: start fresh */ }
  }

  entry(item) {
    return this.data.items[item] || null;
  }

  /** Record one answer. `ms` (response time) is only averaged for correct answers. */
  record(item, correct, ms = null) {
    const e = (this.data.items[item] ||= { n: 0, correct: 0, recent: [], ms: null });
    e.n++;
    if (correct) e.correct++;
    e.recent.push(correct ? 1 : 0);
    if (e.recent.length > RECENT) e.recent.splice(0, e.recent.length - RECENT);
    if (correct && ms !== null && Number.isFinite(ms)) e.ms = e.ms ? Math.round(e.ms * 0.7 + ms * 0.3) : Math.round(ms);
    return e;
  }

  /** Mean of the items' response times (items starting with `prefix`), for the slowness term of the weight. */
  refMs(prefix = '') {
    const ms = Object.entries(this.data.items).filter(([k, e]) => k.startsWith(prefix) && e.ms).map(([, e]) => e.ms);
    return ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : null;
  }

  weight(item) {
    const prefix = item.slice(0, item.lastIndexOf(':') + 1);
    return itemWeight(this.entry(item), this.refMs(prefix));
  }

  /** Items (with `prefix`) sorted weakest first: [{ item, n, accuracy, ms }]. */
  weakest(prefix = '', minN = 3) {
    return Object.entries(this.data.items)
      .filter(([k, e]) => k.startsWith(prefix) && e.n >= minN)
      .map(([item, e]) => ({ item, n: e.n, accuracy: entryAccuracy(e), ms: e.ms }))
      .sort((a, b) => a.accuracy - b.accuracy);
  }

  save() {
    try { this.storage?.setItem(this.key, JSON.stringify(this.data)); } catch { /* quota or private mode */ }
  }

  reset(prefix = '') {
    for (const k of Object.keys(this.data.items)) if (k.startsWith(prefix)) delete this.data.items[k];
    this.save();
  }
}
