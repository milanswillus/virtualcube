/**
 * checks.mjs – Unabhängige Prüfungen am Würfel, gemeinsam für alle Werkzeuge.
 *
 * Bewusst OHNE die Solver: hier wird nur aus den Farben gelesen, ob etwas steht.
 * Ein Fehler im Solver kann sich dadurch nicht in die Prüfung fortpflanzen.
 * Weil dieselbe Frage in mehreren Werkzeugen vorkommt, steht sie hier einmal –
 * zwei Kopien einer Prüfregel wären genau die Sorte Drift, die sie aufdecken
 * soll.
 */

import { readCube, CROSS_COLOR, CROSS_FACE, OPPOSITE } from '../js/solver/pieces.js';

const at = (map, colors) => map.get([...colors].sort().join(''));

/** Sitzt der Stein vollständig richtig – Platz UND Ausrichtung? */
const placed = (piece, faceOfColor) =>
  piece.colors.every((color, i) => piece.faces[i] === faceOfColor[color]);

/** Steht das Kreuz auf der Unterseite? */
export function crossIsSolved(cube) {
  const { faceOfColor, edges } = readCube(cube);
  if (faceOfColor[CROSS_COLOR] !== CROSS_FACE) return false;

  return ['R', 'L', 'F', 'B'].every((color) =>
    placed(at(edges, [CROSS_COLOR, color]), faceOfColor));
}

/** Wie viele der vier F2L-Slots stehen? */
export function solvedSlots(cube) {
  const { colorOnFace, faceOfColor, corners, edges } = readCube(cube);
  const bottom = colorOnFace[CROSS_FACE];

  return [['F', 'R'], ['R', 'B'], ['B', 'L'], ['L', 'F']]
    .map(([front, right]) => [bottom, colorOnFace[front], colorOnFace[right]])
    .filter((colors) => placed(at(corners, colors), faceOfColor)
      && placed(at(edges, colors.slice(1)), faceOfColor))
    .length;
}

/** Kreuz und alle vier Slots – die Voraussetzung für OLL und PLL. */
export const f2lIsSolved = (cube) => crossIsSolved(cube) && solvedSlots(cube) === 4;

/** Zeigen alle acht Deckfarben der letzten Ebene nach oben? */
export function lastLayerIsOriented(cube) {
  const snapshot = readCube(cube);
  const topFace = OPPOSITE[CROSS_FACE];
  const topColor = snapshot.colorOnFace[topFace];

  for (const piece of [...snapshot.corners.values(), ...snapshot.edges.values()]) {
    if (!piece.colors.includes(topColor)) continue;
    if (piece.faces[piece.colors.indexOf(topColor)] !== topFace) return false;
  }
  return true;
}
