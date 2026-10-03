// Chord voicing search: every playable grip of a chord on a tuning, scored so familiar shapes come first.
// A voicing: { frets, fingers, barre, baseFret, midis, roles, style, score }
//   frets/fingers/roles: one entry per string, LOW string first (-1 = muted, 0 = open)
//   barre: { fret, from, to } with string numbers (1 = high e), from = the bass-side string (from >= to), or null
//   style: 'open' | 'barre' | 'movable' | 'shell' | 'drop2' | 'drop3'; score: higher is better

import { CHORD_TYPES } from '../core/chords.js';
import { tuningStrings } from './tunings.js';

const mod12 = (n) => ((n % 12) + 12) % 12;
const THIRDS = ['3', '♭3'];
const SEVENTHS = ['7', '♭7', '𝄫7', '6'];

/** Style groups accepted by the `style` filter. */
export const VOICING_STYLES = {
  any: null,
  open: ['open'],
  barre: ['barre'],
  movable: ['movable', 'barre', 'drop2', 'drop3', 'shell'],
  jazz: ['shell', 'drop2', 'drop3'],
  shell: ['shell'],
  drop2: ['drop2'],
  drop3: ['drop3'],
};

/**
 * Left-hand fingering for a set of frets (low string first). Up to four fretted notes get one finger each, in
 * order of fret (then from the bass side); more notes need an index-finger barre across the lowest fret.
 * @returns { fingers, barre: { fret, lo, hi } (string indices) | null } or null when unplayable
 */
export function fingerFrets(frets) {
  const fretted = frets.map((f, s) => ({ s, f })).filter((x) => x.f > 0);
  const fingers = frets.map(() => 0);
  const assign = (list, first) => {
    list.sort((x, y) => x.f - y.f || x.s - y.s).forEach((x, i) => { fingers[x.s] = first + i; });
  };
  if (fretted.length <= 4) {
    assign(fretted, 1);
    return { fingers, barre: null };
  }
  const minF = Math.min(...fretted.map((x) => x.f));
  const at = fretted.filter((x) => x.f === minF).map((x) => x.s);
  const lo = Math.min(...at);
  const hi = Math.max(...at);
  if (at.length < 2) return null;
  for (let s = lo; s <= hi; s++) if (frets[s] < minF) return null; // open or muted strings under the barre
  const rest = fretted.filter((x) => x.f > minF);
  if (rest.length > 3) return null;
  at.forEach((s) => { fingers[s] = 1; });
  assign(rest, 2);
  return { fingers, barre: { fret: minF, lo, hi } };
}

function classify(v, chordRoles, hasSeventh) {
  const sounding = v.frets.filter((f) => f >= 0).length;
  if (v.frets.some((f) => f === 0)) return 'open';
  const roles = v.roles.filter(Boolean);
  if (sounding === 3 && hasSeventh && new Set(roles).size === 3 && roles.includes('R')
    && roles.some((r) => THIRDS.includes(r)) && roles.some((r) => SEVENTHS.includes(r))) return 'shell';
  if (sounding === 4 && new Set(v.midis.map(mod12)).size === 4) {
    const m = v.midis;
    if (m[0] + 12 > m[2] && m[0] + 12 < m[3] && m[3] - m[1] < 12) return 'drop2';
    if (m[0] + 12 > m[1] && m[0] + 12 < m[2] && m[3] - m[1] < 12) return 'drop3';
  }
  if (v.barre && sounding >= 5) return 'barre';
  return 'movable';
}

/**
 * All playable voicings of a chord, best first.
 * @param rootPc root pitch class (0 = C)
 * @param type CHORD_TYPES id
 * @param opts.style 'any' | 'open' | 'barre' | 'movable' | 'jazz' | 'shell' | 'drop2' | 'drop3'
 * @param opts.bass chord role required in the bass ('3', '♭3', '5', '♭7'...), null = root
 */
export function chordVoicings(rootPc, type, tuning, { style = 'any', bass = null, maxFret = 15, limit = 12 } = {}) {
  const open = tuningStrings(tuning);
  const n = open.length;
  const def = CHORD_TYPES[type];
  const roleOf = {};
  for (const [semi, , role] of def.tones) roleOf[mod12(semi)] = role;
  const optional = def.optional || [];
  const required = def.tones.map(([, , r]) => r).filter((r) => !optional.includes(r));
  const bassRole = bass || 'R';
  const hasSeventh = def.tones.some(([, , r]) => SEVENTHS.includes(r));
  const allowed = VOICING_STYLES[style] ?? (style in VOICING_STYLES ? null : [style]);
  const roleAt = (s, f) => roleOf[mod12(open[s] + f - rootPc)];

  const options = open.map((o, s) => {
    const list = [-1];
    for (let f = 0; f <= maxFret; f++) if (roleAt(s, f)) list.push(f);
    return list;
  });

  const found = [];
  const frets = new Array(n);
  const visit = (s, minF, maxF) => {
    if (s === n) { evaluate(); return; }
    for (const f of options[s]) {
      let lo = minF;
      let hi = maxF;
      if (f > 0) { lo = Math.min(lo, f); hi = Math.max(hi, f); }
      if (hi - lo > 4 || (lo <= 4 && hi - lo > 3)) continue;
      frets[s] = f;
      visit(s + 1, lo, hi);
    }
  };

  function evaluate() {
    const idx = frets.map((f, s) => (f >= 0 ? s : -1)).filter((s) => s >= 0);
    if (idx.length < 3) return;
    const first = idx[0];
    const last = idx[idx.length - 1];
    const innerMutes = last - first + 1 - idx.length;
    const trebleMutes = n - 1 - last;
    if (innerMutes > 1 || trebleMutes > 2) return;
    const fretted = frets.filter((f) => f > 0);
    const minF = fretted.length ? Math.min(...fretted) : 0;
    const maxF = fretted.length ? Math.max(...fretted) : 0;
    const opens = frets.filter((f) => f === 0).length;
    if (opens && maxF > 7) return;
    const roles = frets.map((f, s) => (f >= 0 ? roleAt(s, f) : null));
    const sounding = roles.filter(Boolean);
    if (!required.every((r) => sounding.includes(r))) return;
    const midis = idx.map((s) => open[s] + frets[s]).sort((a, b) => a - b);
    const bassString = idx.find((s) => open[s] + frets[s] === midis[0]);
    if (roles[bassString] !== bassRole) return;
    const fing = fingerFrets(frets);
    if (!fing) return;

    // Penalty: lower is better.
    const nFingers = new Set(fing.fingers.filter((x) => x > 0)).size;
    let p = 0.12 * minF;
    p += [0, 0, 0.3, 0.9, 2.2][maxF - minF];
    p += 0.35 * nFingers;
    if (fing.barre) p += 0.8;
    // Two fingers on one fret with higher-fretted notes between them twist the hand (x10331).
    for (let a = 0; a < n; a++) {
      for (let b = a + 2; b < n; b++) {
        if (frets[a] > 0 && frets[a] === frets[b] && fing.fingers[a] !== fing.fingers[b]
          && frets.slice(a + 1, b).some((f) => f > frets[a])) p += 1;
      }
    }
    p += (n - idx.length) * 0.5;
    p += innerMutes * 1.2 + trebleMutes * 0.8 + (first > 2 ? 1 : 0);
    p += opens * (maxF <= 3 ? -0.35 : 0.6 * (maxF - 3));
    const counts = {};
    for (const r of sounding) counts[r] = (counts[r] || 0) + 1;
    for (const c of Object.values(counts)) if (c > 2) p += 0.5 * (c - 2);
    p += optional.filter((r) => !sounding.includes(r)).length * 0.4;
    const thirds = sounding.filter((r) => THIRDS.includes(r)).length;
    if (thirds > 1) p += 0.3 * (thirds - 1);

    const v = {
      frets: [...frets],
      fingers: fing.fingers,
      barre: fing.barre ? { fret: fing.barre.fret, from: n - fing.barre.lo, to: n - fing.barre.hi } : null,
      baseFret: minF || 1,
      midis,
      roles,
      style: '',
      score: Math.round((20 - p) * 100) / 100,
    };
    v.style = classify(v, roleOf, hasSeventh);
    if (allowed && !allowed.includes(v.style)) return;
    found.push(v);
  }

  visit(0, Infinity, -Infinity);
  found.sort((a, b) => b.score - a.score || a.baseFret - b.baseFret);

  // Drop voicings that are just a better voicing with strings left out.
  const out = [];
  for (const v of found) {
    const covered = out.some((w) => w.style === v.style && v.frets.every((f, s) => f < 0 || f === w.frets[s]));
    if (covered) continue;
    out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

/** Diagram string like 'x32010' (frets above 9 in parentheses). */
export function voicingString(frets) {
  return frets.map((f) => (f < 0 ? 'x' : f > 9 ? `(${f})` : String(f))).join('');
}
