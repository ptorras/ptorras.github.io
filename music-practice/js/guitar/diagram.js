// Guitar visuals as SVG strings: chord boxes and horizontal fretboards. Pure functions (no DOM), so they run in
// node too. Colours come from `currentColor` and CSS classes (css/guitar.css); the presentation attributes set
// here are only fallbacks, so the drawings stay readable without the stylesheet.

/** Default pitch-class names (common mixed spelling). */
export const PC_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

const pcOf = (m) => ((m % 12) + 12) % 12;
const r1 = (x) => Math.round(x * 10) / 10;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attrs = (o) => Object.entries(o)
  .filter(([, v]) => v !== undefined && v !== null && v !== false)
  .map(([k, v]) => ` ${k}="${typeof v === 'number' ? r1(v) : esc(v)}"`).join('');
const el = (tag, a, body = null) => (body === null ? `<${tag}${attrs(a)}/>` : `<${tag}${attrs(a)}>${body}</${tag}>`);
const labelSize = (text, r) => r1(r * (String(text).length > 1 ? 1.12 : 1.35));

/** Fret span shown by a chord box: { base, rows, open } (base = fret of the first row). */
export function diagramWindow(frets, baseFret = null, minRows = 5) {
  const fretted = frets.filter((f) => f > 0);
  const lo = fretted.length ? Math.min(...fretted) : 1;
  const hi = fretted.length ? Math.max(...fretted) : 1;
  let base = baseFret ?? (hi <= minRows ? 1 : lo);
  if (base > lo || hi - base + 1 > Math.max(minRows, hi - lo + 1)) base = hi <= minRows ? 1 : lo;
  // Shapes with open strings that fit below the 5th fret are drawn from the nut.
  if (frets.includes(0) && hi <= minRows) base = 1;
  base = Math.max(1, base);
  return { base, rows: Math.max(minRows, hi - base + 1), open: base === 1 };
}

/**
 * Vertical chord box: strings vertical (lowest string on the left), frets horizontal.
 * @param voicing { frets: [low→high, -1 mute, 0 open], fingers?, barre?: { fret, from, to } (string numbers, 1 = high),
 *   baseFret?, roles?: [low→high], midis? }
 * @param opts.labels 'fingers' | 'notes' | 'roles' | 'none'
 * @param opts.names pitch-class names for 'notes' (12 strings, default PC_NAMES)
 * @param opts.tuning { strings } to compute note names when the voicing has no per-string midis
 * @param opts.rootPc pitch class drawn as root when the voicing has no roles
 */
export function chordDiagramSVG(voicing, { title = '', labels = 'fingers', size = 1, names = PC_NAMES, tuning = null,
  rootPc = null, className = '' } = {}) {
  const frets = voicing.frets;
  const n = frets.length;
  const { base, rows, open } = diagramWindow(frets, voicing.baseFret ?? null);
  const SS = 14;
  const FS = 18;
  const R = 6.3;
  const padL = 30;
  const padR = 12;
  const titleH = title ? 20 : 4;
  const markH = 13;
  const top = titleH + markH;
  const W = padL + (n - 1) * SS + padR;
  const H = top + rows * FS + 6;
  const colX = (i) => padL + i * SS;
  const rowY = (f) => top + (f - base + 0.5) * FS;
  const col = (stringNo) => n - stringNo; // string 1 (high) is the rightmost column
  const midiAt = (i) => {
    if (frets[i] < 0) return null;
    if (tuning?.strings?.length === n) return tuning.strings[i] + frets[i];
    if (voicing.midis?.length === n) return voicing.midis[i];
    if (voicing.midis) return voicing.midis[frets.slice(0, i).filter((f) => f >= 0).length] ?? null;
    return null;
  };
  const roleAt = (i) => {
    if (voicing.roles?.[i]) return voicing.roles[i];
    const m = midiAt(i);
    return rootPc !== null && m !== null && pcOf(m) === rootPc ? 'R' : null;
  };
  const labelAt = (i) => {
    if (labels === 'fingers') return voicing.fingers?.[i] > 0 ? voicing.fingers[i] : '';
    if (labels === 'roles') return roleAt(i) ?? '';
    if (labels === 'notes') { const m = midiAt(i); return m === null ? '' : names[pcOf(m)]; }
    return '';
  };

  const out = [];
  const cx = padL + ((n - 1) * SS) / 2;
  if (title) out.push(el('text', { class: 'cd-title', x: cx, y: 14, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 600, fill: 'currentColor' }, esc(title)));
  // Frets and nut
  for (let r = open ? 1 : 0; r <= rows; r++) {
    out.push(el('line', { class: 'cd-fret', x1: colX(0), x2: colX(n - 1), y1: top + r * FS, y2: top + r * FS, stroke: 'currentColor', 'stroke-width': 1, opacity: 0.55 }));
  }
  if (open) out.push(el('rect', { class: 'cd-nut', x: colX(0) - 0.5, y: top - 3.5, width: (n - 1) * SS + 1, height: 4, rx: 1, fill: 'currentColor' }));
  else out.push(el('text', { class: 'cd-pos', x: colX(0) - R - 2, y: rowY(base), 'text-anchor': 'end', 'dominant-baseline': 'central', 'font-size': 9.5, fill: 'currentColor' }, `${base}fr`));
  // Strings (lower strings a little thicker)
  for (let i = 0; i < n; i++) {
    out.push(el('line', { class: 'cd-string', x1: colX(i), x2: colX(i), y1: top, y2: top + rows * FS, stroke: 'currentColor', 'stroke-width': 0.8 + (n - 1 - i) * 0.12 }));
  }
  // Open / muted markers above the nut
  const my = top - markH / 2 - (open ? 2.5 : 1);
  for (let i = 0; i < n; i++) {
    const x = colX(i);
    if (frets[i] < 0) {
      const d = 3.2;
      out.push(el('path', { class: 'cd-mute', d: `M${r1(x - d)} ${r1(my - d)}L${r1(x + d)} ${r1(my + d)}M${r1(x + d)} ${r1(my - d)}L${r1(x - d)} ${r1(my + d)}`, stroke: 'currentColor', 'stroke-width': 1.4, fill: 'none', 'stroke-linecap': 'round' }));
    } else if (frets[i] === 0) {
      out.push(el('circle', { class: `cd-open${roleAt(i) === 'R' ? ' root' : ''}`, cx: x, cy: my, r: 3.4, stroke: 'currentColor', 'stroke-width': 1.3, fill: 'none' }));
    }
  }
  // Barre
  const barre = voicing.barre;
  let barreCols = null;
  if (barre && barre.fret >= base && barre.fret < base + rows) {
    const a = Math.min(col(barre.from), col(barre.to));
    const b = Math.max(col(barre.from), col(barre.to));
    barreCols = [a, b];
    const hh = R * 1.7;
    out.push(el('rect', { class: 'cd-barre', x: colX(a) - R, y: rowY(barre.fret) - hh / 2, width: colX(b) - colX(a) + 2 * R, height: hh, rx: hh / 2, fill: 'currentColor' }));
  }
  // Dots
  for (let i = 0; i < n; i++) {
    const f = frets[i];
    if (f <= 0) continue;
    const onBarre = barreCols && f === barre.fret && i >= barreCols[0] && i <= barreCols[1];
    const root = roleAt(i) === 'R';
    let text = labelAt(i);
    // A barre shows its finger once, on its lowest string.
    if (onBarre && labels === 'fingers' && i !== barreCols[0]) text = '';
    if (onBarre && !root && !text) continue;
    const x = colX(i);
    const y = rowY(f);
    let g = el('circle', { class: `cd-dot${root ? ' root' : ''}`, cx: x, cy: y, r: R, fill: root ? '#d9480f' : 'currentColor' });
    if (text !== '') {
      g += el('text', { class: 'cd-label', x, y: y + 0.4, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': labelSize(text, R), 'font-weight': 600, fill: '#fff' }, esc(text));
    }
    out.push(el('g', { class: 'cd-note' }, g));
  }
  return el('svg', {
    xmlns: 'http://www.w3.org/2000/svg', class: `chord-diagram${className ? ` ${className}` : ''}`, viewBox: `0 0 ${W} ${H}`,
    width: W * size, height: H * size, role: 'img', 'aria-label': title || 'chord diagram',
    'font-family': 'system-ui, sans-serif',
  }, out.join(''));
}

/** Frets with inlay dots (12 and 24 get two). */
export const INLAYS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];
const DOUBLE = [12, 24];

/**
 * Geometry of a horizontal fretboard (high string at the top). Shared by fretboardSVG and the footer component.
 * @returns { W, H, n, first, openW, cellW, S, padT, x(fret wire), cx(fret) (centre of a position), y(stringNo) }
 */
export function fretboardGeometry({ tuning, fromFret = 0, toFret = 15, showFretNumbers = true, width = null,
  stringSpacing = 18, cellWidth = 40 } = {}) {
  const n = tuning.strings.length;
  const first = Math.max(1, fromFret);
  const cells = Math.max(1, toFret - first + 1);
  const openW = fromFret === 0 ? 28 : 10;
  const padR = 6;
  const S = stringSpacing;
  const padT = 11;
  const padB = showFretNumbers ? 18 : 9;
  const W = width ?? openW + cells * cellWidth + padR;
  const cellW = (W - openW - padR) / cells;
  const H = padT + (n - 1) * S + padB;
  const x = (k) => openW + (k - first + 1) * cellW;
  const cx = (f) => (f === 0 ? openW / 2 : x(f) - cellW / 2);
  const y = (s) => padT + (s - 1) * S;
  return { W, H, n, first, fromFret, toFret, openW, cellW, S, padT, x, cx, y };
}

/**
 * Horizontal fretboard: high string at the top (as in tab), nut, frets, inlays and marks.
 * @param marks [{ string (1 = high), fret, label?, kind? ('root'|'tone'|'hint'|'pressed'|'good'|'wrong'|'dim'|...) }]
 * @param opts.labels show the marks' labels (default true)
 * @param opts.width viewBox width (frets stretch to fill it); default: about 40 units per fret
 * @param opts.hitAreas add transparent `.fb-hit` rects (data-s, data-f) for every position, for pointer input
 */
export function fretboardSVG({ tuning, fromFret = 0, toFret = 15, marks = [], showFretNumbers = true, labels = true,
  width = null, stringSpacing = 18, cellWidth = 40, hitAreas = false, className = '' } = {}) {
  const g = fretboardGeometry({ tuning, fromFret, toFret, showFretNumbers, width, stringSpacing, cellWidth });
  const { W, H, n, first, openW, cellW, S, x, cx, y } = g;
  const out = [];
  const yTop = y(1) - S / 2 + 2;
  const yBot = y(n) + S / 2 - 2;
  out.push(el('rect', { class: 'fb-board', x: x(first - 1), y: yTop, width: x(toFret) - x(first - 1), height: yBot - yTop, fill: 'currentColor', opacity: 0.06 }));
  // Inlays
  const mid = (n + 1) / 2;
  for (let f = first; f <= toFret; f++) {
    if (!INLAYS.includes(f)) continue;
    const ys = DOUBLE.includes(f) ? [y(mid - 1), y(mid + 1)] : [(y(1) + y(n)) / 2];
    for (const yy of ys) out.push(el('circle', { class: 'fb-inlay', cx: cx(f), cy: yy, r: Math.min(S, cellW) * 0.22, fill: 'currentColor', opacity: 0.18 }));
  }
  // Frets and nut
  for (let k = first - 1; k <= toFret; k++) {
    if (k === 0) out.push(el('rect', { class: 'fb-nut', x: x(0) - 2.5, y: yTop, width: 4, height: yBot - yTop, fill: 'currentColor', opacity: 0.85 }));
    else out.push(el('line', { class: 'fb-fret', x1: x(k), x2: x(k), y1: yTop, y2: yBot, stroke: 'currentColor', 'stroke-width': 1.4, opacity: 0.4 }));
  }
  // Strings: high at the top, lower strings thicker
  const x0 = fromFret === 0 ? 3 : x(first - 1);
  for (let s = 1; s <= n; s++) {
    out.push(el('line', { class: 'fb-string', x1: x0, x2: x(toFret), y1: y(s), y2: y(s), stroke: 'currentColor', 'stroke-width': 0.7 + (s - 1) * 0.22, opacity: 0.7 }));
  }
  // Fret numbers
  if (showFretNumbers) {
    for (let f = fromFret; f <= toFret; f++) {
      const strong = INLAYS.includes(f) || f === fromFret;
      out.push(el('text', { class: `fb-num${strong ? ' strong' : ''}`, x: cx(f), y: yBot + 11, 'text-anchor': 'middle', 'font-size': 9.5, fill: 'currentColor', opacity: strong ? 0.75 : 0.4 }, String(f)));
    }
  }
  // Hit areas
  if (hitAreas) {
    for (let s = 1; s <= n; s++) {
      for (let f = fromFret; f <= toFret; f++) {
        const x1 = f === 0 ? 0 : x(f - 1);
        const x2 = f === 0 ? openW : x(f);
        out.push(el('rect', { class: 'fb-hit', 'data-s': s, 'data-f': f, x: x1, y: y(s) - S / 2, width: x2 - x1, height: S, fill: 'transparent' }));
      }
    }
  }
  // Marks
  const R = Math.min(S * 0.46, cellW * 0.42, 9.5);
  for (const m of marks) {
    if (m.string < 1 || m.string > n || m.fret < fromFret || m.fret > toFret) continue;
    const mx = cx(m.fret);
    const my = y(m.string);
    let body = el('circle', { cx: mx, cy: my, r: R, fill: m.kind === 'root' ? '#d9480f' : 'currentColor' });
    const text = labels && m.label !== undefined && m.label !== null ? String(m.label) : '';
    if (text) body += el('text', { x: mx, y: my + 0.4, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': labelSize(text, R), 'font-weight': 600, fill: '#fff' }, esc(text));
    out.push(el('g', { class: `fb-mark${m.kind ? ` ${m.kind}` : ''}`, 'data-s': m.string, 'data-f': m.fret }, body));
  }
  return el('svg', {
    xmlns: 'http://www.w3.org/2000/svg', class: `fretboard${className ? ` ${className}` : ''}`, viewBox: `0 0 ${r1(W)} ${r1(H)}`,
    role: 'img', 'aria-label': 'fretboard', 'font-family': 'system-ui, sans-serif',
  }, out.join(''));
}
