// General piano fingering for a monophonic line (scales, arpeggios, broken chords), by dynamic programming.
//
// Every note gets a finger 1-5; the fingering minimises a sum of costs in the spirit of Parncutt et al. (1997):
//  - spans: each finger pair has a relaxed, a comfortable and a practical span (in semitones);
//  - crossings: the thumb passes under 2, 3 or 4 (or they cross over it). A crossing costs more for 4 and for
//    wider distances, and less from a black key onto a white thumb. Other crossings (4 over 3...) are not allowed;
//  - key colour: the thumb and the 5th finger avoid black keys;
//  - a few local rules: 3 followed by 4 is awkward, a repeated note keeps its finger, hand jumps are a last resort.
// The model is written for the right hand. The left hand is mirrored around D (midi -> 124 - midi), which keeps
// the pattern of black and white keys, so the same model applies with pitch direction reversed.

import { isBlackKey } from './theory.js';

/** Mirror axis: D4 (62) maps to itself and black keys stay black (pc -> 4 - pc). */
export const mirrorMidi = (midi) => 124 - midi;

// Normal spans for finger pairs (lower finger plays the lower note), in semitones:
// [relaxed min, relaxed max, comfortable max, practical max, cost per semitone above relaxed].
const SPAN = {
  12: [1, 5, 8, 10, 1], 13: [3, 7, 10, 12, 1], 14: [5, 9, 12, 14, 1], 15: [7, 10, 13, 15, 1],
  23: [1, 2, 4, 5, 1], 24: [3, 4, 5, 7, 1], 25: [5, 6, 8, 10, 1],
  34: [1, 2, 4, 5, 1], 35: [3, 4, 5, 7, 1],
  45: [1, 3, 4, 5, 0.5],
};

// Crossings with the thumb, by the crossing finger: [base cost, comfortable distance, practical distance,
// cost per semitone beyond comfortable]. 3 crosses up to a fourth comfortably, 4 only up to a major third.
const CROSS = { 2: [4, 3, 6, 2], 3: [4, 5, 7, 2], 4: [4.2, 4, 6, 3] };

const JUMP = 20;
const END = 1.2; // per finger away from the natural finger at the ends of the line // the hand leaves the keys (non-legato shift)

/** Cost of playing note b with finger fb right after note a with finger fa (right-hand model). */
function transition(fa, a, fb, b) {
  const d = b - a;
  if (d === 0) return fa === fb ? 0 : 3;
  if (fa === fb) return JUMP + Math.abs(d) / 4;
  // Orient the pair so `lo` is the lower finger; dist = note(hi finger) - note(lo finger).
  const lo = Math.min(fa, fb);
  const hi = Math.max(fa, fb);
  const dist = fa < fb ? d : -d;
  if (dist > 0) {
    const [rMin, rMax, cMax, pMax, w] = SPAN[lo * 10 + hi];
    if (dist > pMax) return JUMP + dist - pMax;
    let c = 0;
    if (dist < rMin) c += (rMin - dist) * (lo === 1 ? 1 : 2);
    if (dist > rMax) c += w * (dist - rMax);
    if (dist > cMax) c += 2 * (dist - cMax);
    // Thumb pairs reaching a white key from a black one sit lower in the hand: slightly awkward.
    if (lo === 1 && isBlackKey(fa === 1 ? a : b) && !isBlackKey(fa === 1 ? b : a)) c += 1;
    return c;
  }
  // Crossing: only with the thumb, never with 5.
  if (lo !== 1 || hi === 5) return Infinity;
  const [base, cMax, pMax, w] = CROSS[hi];
  const x = -dist;
  if (x > pMax) return Infinity;
  let c = base + 0.5 * (x - 1);
  if (x > cMax) c += w * (x - cMax);
  // Passing the thumb is easiest when the long finger is on a black key and the thumb on a white one.
  const fingerKey = fa === 1 ? b : a;
  const thumbKey = fa === 1 ? a : b;
  if (!isBlackKey(fingerKey)) c += 0.5;
  if (isBlackKey(thumbKey) && !isBlackKey(fingerKey)) c += 2;
  return c;
}

/** Cost of finger f on note i of the line (context: neighbours, ends). */
function noteCost(f, m, i) {
  const n = m[i];
  const black = isBlackKey(n);
  const prev = m[i - 1];
  const next = m[i + 1];
  let c = 0;
  if (f === 1 && black) c += 4 + ((prev === undefined || !isBlackKey(prev)) && (next === undefined || !isBlackKey(next)) ? 2 : 0);
  if (f === 5 && black) c += 2;
  if (f === 4) c += 0.3;
  // Ends: start low (RH) with a low finger when the line rises, finish with 5 at a top, 1 at a bottom.
  const dirOut = next === undefined ? 0 : Math.sign(next - n);
  const dirIn = prev === undefined ? 0 : Math.sign(n - prev);
  if (prev === undefined && dirOut > 0) c += END * (f - 1);
  if (prev === undefined && dirOut < 0) c += END * (5 - f);
  if (next === undefined && dirIn > 0) c += END * (5 - f);
  if (next === undefined && dirIn < 0) c += END * (f - 1);
  return c;
}

/** Second-order cost for three consecutive fingers (local habits). */
function triple(f0, f1, f2, a, b, c) {
  let cost = 0;
  if (f1 === 3 && f2 === 4 && !isBlackKey(b) && isBlackKey(c)) cost += 1; // 3 on white then 4 on black
  if (f0 === 3 && f1 === 4 && f2 === 5 && c - a > 4) cost += 1;
  // A note between a crossing and the next crossing should not be played by the thumb twice in a row:
  // prefer groups (1-2-3, 1-2-3-4) over 1-2-1 zig-zags.
  if (f0 === 1 && f2 === 1 && f1 !== 1 && Math.sign(b - a) === Math.sign(c - b)) cost += 2;
  return cost;
}

/**
 * Cost tables of a (right-hand) line, computed once and shared by every search over it:
 * note[i*6+f], trans[i*36+f*6+g] (note i-1 with f -> note i with g), trip[i*216+p*36+f*6+g] (notes i-2..i).
 */
function prepare(m) {
  const n = m.length;
  const note = new Float64Array(n * 6);
  const trans = new Float64Array(n * 36).fill(Infinity);
  const trip = new Float64Array(n * 216);
  for (let i = 0; i < n; i++) {
    for (let f = 1; f <= 5; f++) {
      note[i * 6 + f] = noteCost(f, m, i);
      if (i === 0) continue;
      for (let g = 1; g <= 5; g++) {
        trans[i * 36 + f * 6 + g] = transition(f, m[i - 1], g, m[i]);
        if (i === 1) continue;
        for (let p = 1; p <= 5; p++) trip[i * 216 + p * 36 + f * 6 + g] = triple(p, f, g, m[i - 2], m[i - 1], m[i]);
      }
    }
  }
  return { m, n, note, trans, trip };
}

/**
 * Minimum-cost fingering of a prepared line, by dynamic programming. State: fingers of the previous and the current
 * note, so three-note habits can be scored. `bias[i*6+f]` adds an extra cost per note (used for consistency).
 */
function solve(model, opts, bias = null) {
  const { n, note, trans, trip } = model;
  const allowed = (i, f) => !((i === 0 && opts.first && f !== opts.first) || (i === n - 1 && opts.last && f !== opts.last));
  const local = (i, f) => note[i * 6 + f] + (bias ? bias[i * 6 + f] : 0);
  if (n === 1) {
    let best = 0;
    for (let f = 1; f <= 5; f++) if (allowed(0, f) && (!best || local(0, f) < local(0, best))) best = f;
    return [best];
  }
  // cost[f*6+g]: best total with fingers f, g on the last two notes; back[i*36+f*6+g]: finger of note i-2.
  let cost = new Float64Array(36).fill(Infinity);
  let next = new Float64Array(36);
  const back = new Int8Array(n * 36);
  for (let p = 1; p <= 5; p++) {
    for (let f = 1; f <= 5; f++) {
      if (allowed(0, p) && allowed(1, f)) cost[p * 6 + f] = local(0, p) + local(1, f) + trans[36 + p * 6 + f];
    }
  }
  for (let i = 2; i < n; i++) {
    next.fill(Infinity);
    for (let f = 1; f <= 5; f++) {
      for (let g = 1; g <= 5; g++) {
        const t = trans[i * 36 + f * 6 + g];
        if (t === Infinity || !allowed(i, g)) continue;
        const base = t + local(i, g);
        let best = Infinity;
        let arg = 0;
        for (let p = 1; p <= 5; p++) {
          const c = cost[p * 6 + f] + trip[i * 216 + p * 36 + f * 6 + g];
          if (c < best) { best = c; arg = p; }
        }
        if (best + base < next[f * 6 + g]) {
          next[f * 6 + g] = best + base;
          back[i * 36 + f * 6 + g] = arg;
        }
      }
    }
    [cost, next] = [next, cost];
  }
  let best = -1;
  for (let k = 0; k < 36; k++) if (cost[k] < Infinity && (best < 0 || cost[k] < cost[best])) best = k;
  if (best < 0) return null;
  const out = new Array(n);
  out[n - 1] = best % 6;
  out[n - 2] = Math.floor(best / 6);
  for (let i = n - 1; i >= 2; i--) out[i - 2] = back[i * 36 + out[i - 1] * 6 + out[i]];
  return out;
}

const CONSISTENCY = 1.5; // cost of a finger other than the one the same pitch class usually gets

const pcOf = (midi) => ((midi % 12) + 12) % 12;

/** Preferred finger per pitch class among notes [from, to) of a fingering, weighted towards the middle of the line. */
function preferences(m, fingers, from, to) {
  const n = m.length;
  const votes = new Map();
  for (let i = Math.max(1, from); i < Math.min(n - 1, to); i++) {
    const v = votes.get(pcOf(m[i])) || [0, 0, 0, 0, 0, 0];
    v[fingers[i]] += Math.min(i, n - 1 - i); // the ends are special: the middle of the line votes more
    votes.set(pcOf(m[i]), v);
  }
  // A clear majority only: ties leave the pitch class free.
  const pref = new Map();
  for (const [pc, v] of votes) {
    const top = Math.max(...v);
    if (v.filter((x) => x === top).length === 1) pref.set(pc, v.indexOf(top));
  }
  return pref;
}

/** Interior notes whose finger differs from the one their pitch class gets most often. */
function inconsistency(m, fingers) {
  const counts = new Map();
  for (let i = 1; i < m.length - 1; i++) {
    const v = counts.get(pcOf(m[i])) || [0, 0, 0, 0, 0, 0];
    v[fingers[i]]++;
    counts.set(pcOf(m[i]), v);
  }
  let out = 0;
  for (const v of counts.values()) out += v.reduce((a, b) => a + b, 0) - Math.max(...v);
  return out;
}

/** Cost of a fingering of a prepared line. */
function rawCost({ n, note, trans, trip }, f) {
  let c = 0;
  for (let i = 0; i < n; i++) {
    c += note[i * 6 + f[i]];
    if (i > 0) c += trans[i * 36 + f[i - 1] * 6 + f[i]];
    if (i > 1) c += trip[i * 216 + f[i - 2] * 36 + f[i - 1] * 6 + f[i]];
  }
  return c;
}

/**
 * Fingering for a monophonic sequence of MIDI notes (scales, arpeggios, broken chords...).
 * The cheapest fingering is not always a consistent one (cost ties between groupings), so the result minimises
 * cost plus a penalty for every note whose finger differs from its pitch class's usual finger, so repeated octaves
 * fall into the same groups. Candidates: the cheapest fingering (solved forwards and backwards), and the cheapest
 * with a bias towards a preferred finger per pitch class, refined by a small local search over those preferences.
 * Results are cached, so calling it again for the same line is cheap.
 * @param midis MIDI numbers in playing order
 * @param hand 'R' | 'L'
 * @param opts.first / opts.last force the finger of the first / last note
 * @returns array of fingers 1-5 (same length as midis)
 */
export function dpFingering(midis, hand, opts = {}) {
  if (!midis.length) return [];
  const key = `${hand}${opts.first || ''}${opts.last || ''}:${midis.join(',')}`;
  let out = cache.get(key);
  if (!out) {
    if (cache.size > 2000) cache.clear();
    out = consistentFingering(hand === 'L' ? midis.map(mirrorMidi) : midis.slice(), opts);
    cache.set(key, out);
  }
  return out.slice();
}

const cache = new Map();

/** The search behind dpFingering, on a right-hand (possibly mirrored) line. */
function consistentFingering(m, opts) {
  const model = prepare(m);
  const first = solve(model, opts);
  if (!first) return m.map(() => 1);
  const n = m.length;
  // The same line solved backwards breaks cost ties the other way: a second seed.
  const back = solve(prepare(m.slice().reverse()), { first: opts.last, last: opts.first });
  const withPref = (pref) => {
    const bias = new Float64Array(n * 6);
    for (let i = 1; i < n - 1; i++) {
      const want = pref.get(pcOf(m[i]));
      if (want !== undefined) for (let f = 1; f <= 5; f++) if (f !== want) bias[i * 6 + f] = CONSISTENCY;
    }
    return solve(model, opts, bias);
  };
  const score = (f) => rawCost(model, f) + CONSISTENCY * inconsistency(m, f);
  let best = first;
  let bestScore = score(first);
  let bestPref = null;
  const consider = (pref) => {
    const f = withPref(pref);
    const sc = f ? score(f) : Infinity;
    if (sc < bestScore - 1e-9) {
      best = f;
      bestScore = sc;
      bestPref = pref;
      return true;
    }
    return false;
  };
  for (const seed of back ? [first, back.reverse()] : [first]) {
    if (seed !== first && score(seed) < bestScore - 1e-9) {
      best = seed;
      bestScore = score(seed);
    }
    for (const [from, to] of [[0, n], [0, n >> 1], [n >> 1, n]]) consider(preferences(m, seed, from, to));
  }
  // Nothing can beat a consistent fingering of minimum cost.
  if (bestScore <= rawCost(model, first) + 1e-9) return best;
  // Local search: change one pitch class's preferred finger at a time while the score improves.
  if (!bestPref) bestPref = preferences(m, best, 0, n);
  const pcs = [...new Set(m.slice(1, -1).map(pcOf))];
  for (let round = 0, improved = true; round < 3 && improved; round++) {
    improved = false;
    for (const pc of pcs) {
      for (const f of [undefined, 1, 2, 3, 4, 5]) {
        if (bestPref.get(pc) === f) continue;
        const pref = new Map(bestPref);
        if (f === undefined) pref.delete(pc);
        else pref.set(pc, f);
        if (consider(pref)) improved = true;
      }
    }
  }
  return best;
}

/** Total cost of a given fingering under the model (for tests and comparisons). */
export function fingeringCost(midis, fingers, hand) {
  return rawCost(prepare(hand === 'L' ? midis.map(mirrorMidi) : midis), fingers);
}

/** Is a consecutive pair of fingered notes physically playable (legato, no impossible span or crossing)? */
export function playable(a, fa, b, fb, hand) {
  const [x, y] = hand === 'L' ? [mirrorMidi(a), mirrorMidi(b)] : [a, b];
  return transition(fa, x, fb, y) < JUMP;
}
