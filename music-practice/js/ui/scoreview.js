// OpenSheetMusicDisplay wrapper: renders MusicXML, extracts the playable timeline,
// colors individual noteheads and moves the cursor.

/* global opensheetmusicdisplay */

const HALFTONE_TO_MIDI = 12; // OSMD halfTone: C4 = 48

export class ScoreView {
  constructor(container) {
    this.container = container;
    this.osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(container, {
      backend: 'svg',
      autoResize: false, // we re-render ourselves so we can restore colors and cursor
      autoBeam: true,
      drawTitle: true,
      drawSubtitle: false,
      drawCredits: false,
      drawPartNames: false,
      drawFingerings: true,
      followCursor: true,
      cursorsOptions: [{ type: 0, color: '#3b82f6', alpha: 0.35, follow: true }],
    });
    this.osmd.setLogLevel('warn');
    this.notes = []; // id -> OSMD Note
    this.colors = new Map(); // id -> color
    this.pos = 0;
    this.timeline = null;
    let t;
    this.resizeObserver = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => this.rerender(), 250);
    });
    this.resizeObserver.observe(container);
    this.lastWidth = 0;
  }

  /**
   * Load MusicXML text, or a binary string of a compressed .mxl file.
   * @param generated true for our own exercises: honour their explicit line breaks (not those of loaded files)
   */
  async load(content, zoom = 1, { generated = false } = {}) {
    this.colors.clear();
    this.osmd.setOptions({ newSystemFromXML: generated });
    await this.osmd.load(content);
    this.osmd.Zoom = zoom;
    this.osmd.render();
    this.lastWidth = this.container.clientWidth;
    this.timeline = this.#buildTimeline();
    this.osmd.cursor.reset();
    this.osmd.cursor.show();
    this.pos = 0;
    return this.timeline;
  }

  get loaded() {
    return Boolean(this.timeline);
  }

  setZoom(z) {
    if (!this.loaded) return;
    this.osmd.Zoom = z;
    this.rerender(true);
  }

  rerender(force = false) {
    if (!this.loaded || this.container.clientWidth === 0) return; // hidden (a panel tab is showing)
    if (!force && Math.abs(this.container.clientWidth - this.lastWidth) < 8) return;
    this.lastWidth = this.container.clientWidth;
    this.osmd.render();
    for (const [id, c] of this.colors) this.#paint(id, c);
    const p = this.pos;
    this.osmd.cursor.reset();
    this.pos = 0;
    this.osmd.cursor.show();
    this.cursorTo(p);
  }

  #buildTimeline() {
    const cursor = this.osmd.cursor;
    const sheet = this.osmd.Sheet;
    const staves = sheet.Staves;
    cursor.reset();
    this.notes = [];
    const steps = [];
    const measures = [];
    let lastMeasure = -1;
    let pos = 0;
    while (!cursor.iterator.EndReached) {
      const it = cursor.iterator;
      const ts = (it.CurrentEnrolledTimestamp ?? it.currentTimeStamp).RealValue * 4;
      if (it.CurrentMeasureIndex !== lastMeasure) {
        lastMeasure = it.CurrentMeasureIndex;
        const sm = sheet.SourceMeasures[lastMeasure];
        const sig = sm.ActiveTimeSignature;
        const msStart = ts - (it.currentTimeStamp.RealValue - sm.AbsoluteTimestamp.RealValue) * 4;
        measures.push({
          index: lastMeasure,
          time: msStart,
          length: sm.Duration.RealValue * 4,
          beats: sig?.Numerator || 4,
          beatType: sig?.Denominator || 4,
        });
      }
      const notes = [];
      for (const ve of it.CurrentVoiceEntries) {
        for (const n of ve.Notes) {
          if (n.isRest() || n.IsGraceNote || n.IsCueNote || n.Pitch == null) continue;
          if (n.NoteTie && n.NoteTie.StartNote !== n) continue; // tie continuation: already held
          const id = this.notes.length;
          this.notes.push(n);
          const tieLen = n.NoteTie ? n.NoteTie.Duration.RealValue : n.Length.RealValue;
          const note = {
            id,
            midi: n.halfTone + HALFTONE_TO_MIDI,
            staff: staves.indexOf(n.ParentStaff),
            duration: tieLen * 4,
          };
          // Tab notes know their string (1 = highest) and fret.
          if (n.StringNumberTab > 0 && n.FretNumber >= 0) Object.assign(note, { string: n.StringNumberTab, fret: n.FretNumber });
          notes.push(note);
        }
      }
      steps.push({ pos, time: ts, notes });
      cursor.next();
      pos++;
    }
    cursor.reset();
    const end = measures.length ? measures[measures.length - 1].time + measures[measures.length - 1].length : 0;
    const staffInfo = staves.map((s, i) => {
      const inst = s.ParentInstrument;
      const local = inst.Staves.indexOf(s);
      const name = inst.Name || 'Part';
      return { index: i, label: inst.Staves.length > 1 ? `${name} – staff ${local + 1}` : name, tab: Boolean(s.isTab) };
    });
    return { steps, measures, staves: staffInfo, end };
  }

  /** Move the cursor to a timeline position (cursor step index). */
  cursorTo(pos) {
    const cursor = this.osmd.cursor;
    if (pos < this.pos) {
      cursor.reset();
      this.pos = 0;
    }
    while (this.pos < pos && !cursor.iterator.EndReached) {
      cursor.next();
      this.pos++;
    }
  }

  resetCursor() {
    this.osmd.cursor.reset();
    this.osmd.cursor.show();
    this.pos = 0;
  }

  color(ids, color) {
    for (const id of [].concat(ids)) {
      if (color) this.colors.set(id, color);
      else this.colors.delete(id);
      this.#paint(id, color || '#000000');
    }
  }

  clearColors() {
    const ids = [...this.colors.keys()];
    this.colors.clear();
    for (const id of ids) this.#paint(id, '#000000');
  }

  #paint(id, color) {
    const n = this.notes[id];
    if (!n) return;
    try {
      const g = this.osmd.EngravingRules.GNote(n);
      g?.setColor(color, {
        applyToNoteheads: true, applyToStem: false, applyToBeams: false, applyToFlag: false,
        applyToModifiers: false, applyToLedgerLines: false, applyToTies: false, applyToSlurs: false, applyToLyrics: false,
      });
    } catch (err) {
      console.warn('color failed', err);
    }
  }
}
