/**
 * coach.js – Sagt, was als Nächstes zu tun ist.
 *
 * Der Coach ist ZUSTANDSLOS: `nextStep()` bekommt den Würfel und leitet daraus
 * den nächsten Schritt ab. Wer sich vertippt, bekommt beim nächsten Aufruf
 * einfach einen neuen, passenden Plan – es gibt keinen Fortschritt, der
 * "kaputtgehen" könnte.
 *
 * Jeder Schritt enthält die nötigen Ganzwürfeldrehungen mit. Das ist der
 * eigentliche Punkt: ein Schritt soll ohne Umdenken ausführbar sein, also wird
 * der Würfel erst in die gewohnte Lage gedreht und dann gearbeitet.
 *
 * Ausbaustufen: Kreuz und F2L sind fertig, OLL/PLL folgen (siehe `stage`).
 */

import { readCube, locate, CROSS_COLOR } from './pieces.js';
import { planCross } from './crossSolver.js';
import { planF2L } from './f2lSolver.js';
import { planOLL, planPLL } from './lastLayer.js';

/**
 * @typedef {object} Piece
 * @property {'corner'|'edge'} role
 * @property {string[]} colors  Farben des Steins (data-face-Werte)
 */

/**
 * @typedef {object} Step
 * @property {string}   stage     'orient'|'cross'|'f2l'|'oll'|'pll'|'done'|'stuck'
 * @property {string}   label     Überschrift, z. B. "Kreuz 2/4"
 * @property {string?}  caseName  Name des Falls, z. B. "Sune" oder "T"
 * @property {string[]} moves     Vollständige Zugfolge inklusive Drehungen
 * @property {Piece[]}  pieces    Steine, um die es geht (Kreuz und F2L)
 * @property {object?}  diagram   Bild der letzten Ebene (OLL und PLL)
 * @property {string}   note      Kurzer Klartext-Hinweis
 * @property {boolean}  pending   true = Stufe kann nicht weiterhelfen
 */

/** Ein leerer Schritt – Grundlage für alle Rückgaben unten. */
const step = (fields) => ({
  pieces: [], diagram: null, caseName: null, pending: false, ...fields,
});

/**
 * Klartext zum F2L-Fall. Beschreibt bewusst die AUSGANGSLAGE, nicht den
 * Algorithmus: was man am Würfel sieht, ist das, woran man den Fall
 * wiedererkennt.
 */
function f2lNote(plan, snapshot) {
  if (plan.kind === 'clear') {
    return 'The slot is occupied by an intruder piece – bring to top layer first.';
  }

  const corner = locate(snapshot, plan.cornerColors);
  const edge = locate(snapshot, plan.edgeColors);

  if (corner === 'top' && edge === 'top') {
    return 'Corner and edge are on top – pair up first, then insert.';
  }
  if (corner === 'top') return 'Edge is already in slot – pair with corner from top layer.';
  if (edge === 'top') return 'Corner is already in slot – remove and re-insert.';
  return 'Both are in slot, but incorrectly – remove and insert together.';
}

/**
 * Nächster Schritt für den aktuellen Würfel.
 * @param {import('../cubeState.js').CubeState} state
 * @returns {Step}
 */
export function nextStep(state) {
  const snapshot = readCube(state);

  const cross = planCross(snapshot);

  if (cross && cross.orienting) {
    return step({
      stage: 'orient',
      label: 'Orientation',
      moves: cross.rotation,
      note: 'White to bottom – the cross is built there.',
    });
  }

  if (cross && !cross.done) {
    return step({
      stage: 'cross',
      label: `Cross ${cross.placed}/4`,
      moves: [...cross.rotation, ...cross.moves],
      // Seitenfarbe zuerst, Kreuzfarbe zuletzt – wie bei F2L (siehe unten).
      pieces: [{ role: 'edge', colors: [cross.edgeColor, CROSS_COLOR] }],
      note: 'Rotate edge to front and insert from below.',
    });
  }

  const f2l = planF2L(snapshot);

  if (f2l && !f2l.done) {
    /*
     * Anzeigereihenfolge, nicht Solverreihenfolge: die beiden Seitenfarben
     * zuerst, die Kreuzfarbe zuletzt. Die Vorschau setzt je zwei Felder in eine
     * Zeile – die Ecke steht damit genau über der Kante, und dass beide
     * dieselben zwei Farben tragen, sieht man ohne Lesen.
     */
    const [cross, front, right] = f2l.cornerColors;

    return step({
      stage: 'f2l',
      label: `F2L ${f2l.placed}/4`,
      moves: [...f2l.rotation, ...f2l.moves],
      pieces: [
        { role: 'corner', colors: [front, right, cross] },
        { role: 'edge', colors: f2l.edgeColors },
      ],
      note: f2lNote(f2l, snapshot),
    });
  }

  const oll = planOLL(snapshot);

  if (oll && !oll.done) {
    return step({
      stage: 'oll',
      label: oll.id ? `OLL ${oll.id}` : 'OLL',
      caseName: oll.name,
      moves: oll.moves,
      diagram: oll.diagram,
      // Nicht "gelb": im Schema "minimal" ist die Deckfarbe ein dunkles Grau.
      note: 'Top face color up. Order will scramble temporarily – PLL will sort it.',
    });
  }

  const pll = planPLL(snapshot);

  if (pll && !pll.done) {
    return step({
      stage: 'pll',
      // "PLL Ga · G-Perm" – die Kennung sucht man im Blatt, der Name im Kopf.
      label: pll.id ? `PLL ${pll.id}` : 'PLL',
      caseName: pll.name,
      moves: [...pll.rotation, ...pll.moves],
      diagram: pll.diagram,
      note: 'Sort last layer – side colors indicate which case you have.',
    });
  }

  if (state.isSolved()) {
    return step({
      stage: 'done',
      label: 'Solved',
      moves: [],
      note: 'Done – press space for next scramble.',
    });
  }

  /*
   * Hierher kommt man nur mit einem Würfel, den keine Stufe erkennt – etwa
   * einem mit vertauschten Aufklebern. Lieber ehrlich stehen bleiben als einen
   * Algorithmus raten, der die Lage verschlimmert.
   */
  return step({
    stage: 'stuck',
    label: 'Unknown',
    moves: [],
    note: 'This state cannot be categorized – press backspace to reset.',
    pending: true,
  });
}
