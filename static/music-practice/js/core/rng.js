// Seeded pseudo-random generator (mulberry32) so exercises can be regenerated from a seed.

export function makeRng(seed = Date.now()) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed,
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    weighted(items) {
      // items: [[value, weight], ...]
      const total = items.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [v, w] of items) if ((r -= w) < 0) return v;
      return items[items.length - 1][0];
    },
  };
}

export const randomSeed = () => Math.floor(Math.random() * 1e9);
