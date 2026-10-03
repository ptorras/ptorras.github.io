// All guitar exercises, in menu order.

import { guitarScalesExercise } from './scales.js';
import { guitarArpeggioExercise } from './arpeggios.js';
import { guitarSightReadingExercise } from './sightreading.js';
import { guitarChordsExercise } from './chords.js';

export const GUITAR_EXERCISES = [guitarSightReadingExercise, guitarScalesExercise, guitarArpeggioExercise, guitarChordsExercise];

export { guitarScalesExercise, guitarArpeggioExercise, guitarSightReadingExercise, guitarChordsExercise };
