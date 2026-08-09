/**
 * scramble.js – Zufälliger Scramble in WCA-üblicher Form.
 *
 * Regeln (Random-Move-Scramble):
 *   • dieselbe Seite nie zweimal hintereinander (U U2 wäre ein Zug)
 *   • auf derselben Achse nie A B A (z. B. R L R – die ersten beiden
 *     kommutieren, das wäre eine redundante Schreibweise)
 */

import { SCRAMBLE_LENGTH } from './config.js';

const FACES = ['U', 'D', 'R', 'L', 'F', 'B'];
const AXIS_OF = { U: 'y', D: 'y', R: 'x', L: 'x', F: 'z', B: 'z' };
const MODIFIERS = ['', "'", '2'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/**
 * @param {number} length Anzahl Züge
 * @returns {string[]} z. B. ["R", "U2", "F'", …]
 */
export function generateScramble(length = SCRAMBLE_LENGTH) {
  const moves = [];
  let last = null;       // Seite des letzten Zuges
  let secondLast = null; // Seite des vorletzten Zuges

  while (moves.length < length) {
    const face = pick(FACES);
    if (face === last) continue;
    if (secondLast === face && AXIS_OF[face] === AXIS_OF[last]) continue;

    moves.push(face + pick(MODIFIERS));
    secondLast = last;
    last = face;
  }
  return moves;
}
