// Guitar tunings and fretboard arithmetic.
// String numbers follow the tab/MusicXML convention: string 1 is the HIGHEST string. `tuning.strings` lists the
// open-string MIDI numbers from the LOWEST string up.

export const TUNINGS = {
  standard: { id: 'standard', label: 'Standard (E A D G B E)', strings: [40, 45, 50, 55, 59, 64] },
  dropD: { id: 'dropD', label: 'Drop D (D A D G B E)', strings: [38, 45, 50, 55, 59, 64] },
  halfStepDown: { id: 'halfStepDown', label: 'Half step down (E♭ A♭ D♭ G♭ B♭ E♭)', strings: [39, 44, 49, 54, 58, 63] },
  dStandard: { id: 'dStandard', label: 'D standard (D G C F A D)', strings: [38, 43, 48, 53, 57, 62] },
  dadgad: { id: 'dadgad', label: 'DADGAD', strings: [38, 45, 50, 55, 57, 62] },
  openG: { id: 'openG', label: 'Open G (D G D G B D)', strings: [38, 43, 50, 55, 59, 62] },
  openD: { id: 'openD', label: 'Open D (D A D F♯ A D)', strings: [38, 45, 50, 54, 57, 62] },
};

export const MAX_FRET = 22;

/** Open-string MIDI numbers (low first) of a tuning object, id or plain array; standard when missing. */
export function tuningStrings(tuning) {
  if (Array.isArray(tuning)) return tuning;
  if (typeof tuning === 'string') return (TUNINGS[tuning] || TUNINGS.standard).strings;
  return (tuning && tuning.strings) || TUNINGS.standard.strings;
}

/** Open-string MIDI number of string `stringNo` (1 = highest string). */
export function openMidi(stringNo, tuning) {
  const s = tuningStrings(tuning);
  return s[s.length - stringNo];
}

/** Sounding MIDI number at a string (1 = highest) and fret. */
export function midiAt(stringNo, fret, tuning) {
  return openMidi(stringNo, tuning) + fret;
}

/** Every place a MIDI note can be played: [{ string, fret }], high string first. */
export function positionsOf(midi, tuning, { minFret = 0, maxFret = MAX_FRET } = {}) {
  const s = tuningStrings(tuning);
  const out = [];
  for (let stringNo = 1; stringNo <= s.length; stringNo++) {
    const fret = midi - openMidi(stringNo, s);
    if (fret >= minFret && fret <= maxFret) out.push({ string: stringNo, fret });
  }
  return out;
}

const INTERVAL_NAMES = ['R', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7'];

/** Interval name of a semitone distance from the root (mod 12). */
export function intervalName(semitones) {
  return INTERVAL_NAMES[((semitones % 12) + 12) % 12];
}
