/**
 * pieces.js – Liest aus dem Würfelzustand heraus, wo welcher Stein liegt.
 *
 * ZWEI BEZUGSSYSTEME
 * ------------------
 * Die Kamera steht fest. `U`, `R`, `F` … bezeichnen deshalb immer *Weltseiten*
 * – und genau darauf wirken auch die Tasten. Die Aufkleber tragen dagegen
 * *Farben*, die ebenfalls U/R/F… heissen (im gelösten Ausgangszustand lag
 * Farbe X auf Seite X).
 *
 * Nach einer Ganzwürfeldrehung fallen beide auseinander: nach `y` liegt die
 * Farbe F auf der Weltseite L. Der Coach muss beides auseinanderhalten – er
 * erkennt Steine über ihre FARBEN, gibt Züge aber in WELTSEITEN aus.
 *
 * `colorOnFace` und `faceOfColor` sind die Brücke zwischen beiden.
 */

import { FACE_NORMALS } from '../config.js';
import { parseMove } from '../cubeState.js';
import { apply, dot, rotationMatrix } from '../math3d.js';

/** Farbe, aus der das Kreuz gebaut wird – in beiden Schemata das Weiss. */
export const CROSS_COLOR = 'U';

/** Weltseite, auf der das Kreuz am Ende liegen soll (Standard-CFOP). */
export const CROSS_FACE = 'D';

/** Gegenüberliegende Seite bzw. Farbe. */
export const OPPOSITE = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };

export const FACES = Object.keys(FACE_NORMALS);

/** Vergleicht zwei Vektoren aus {-1,0,1}³. */
export const sameVec = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Weltseite, deren Aussennormale gleich `normal` ist. */
export const faceOfNormal = (normal) => FACES.find((f) => sameVec(FACE_NORMALS[f], normal));

/** Kanonischer Schlüssel für ein Farb-Set, z. B. ['R','U'] → "RU". */
export const key = (colors) => [...colors].sort().join('');

/**
 * Momentaufnahme des Würfels.
 *
 * @param {import('../cubeState.js').CubeState} state
 * @returns {{
 *   colorOnFace: Record<string,string>,
 *   faceOfColor: Record<string,string>,
 *   corners: Map<string,object>,
 *   edges:   Map<string,object>,
 * }}
 */
export function readCube(state) {
  const colorOnFace = {};
  const faceOfColor = {};
  const corners = new Map();   // "DFR" → Stein
  const edges = new Map();     // "FR"  → Stein

  for (const cubie of state.cubies) {
    // Aufkleber mit ihrer AKTUELLEN Weltnormalen.
    const stickers = [];
    for (const sticker of cubie.stickers) {
      if (!sticker.face) continue;
      stickers.push({ color: sticker.face, normal: apply(cubie.rot, sticker.normal) });
    }
    if (stickers.length === 0) continue;                 // Kern

    if (stickers.length === 1) {                         // Mittelstein
      const face = faceOfNormal(stickers[0].normal);
      colorOnFace[face] = stickers[0].color;
      faceOfColor[stickers[0].color] = face;
      continue;
    }

    const piece = {
      colors: stickers.map((s) => s.color),
      normals: stickers.map((s) => s.normal),
      faces: stickers.map((s) => faceOfNormal(s.normal)),
      pos: cubie.pos,
    };
    (stickers.length === 3 ? corners : edges).set(key(piece.colors), piece);
  }

  return { colorOnFace, faceOfColor, corners, edges };
}

/** Auf welcher Weltseite liegt eine bestimmte Farbe dieses Steins? */
export function faceOfSticker(piece, color) {
  return piece.faces[piece.colors.indexOf(color)];
}

/**
 * Wo liegt der Stein mit diesen Farben gerade?
 *
 * Für die Trainer-Anzeige: sie soll nicht nur zeigen, WELCHE Steine dran sind,
 * sondern auch, wo man sie am Würfel sucht. Bewusst grob gehalten – "oben" und
 * "im Slot" reichen zum Wiederfinden, eine genaue Platzangabe würde nur vom
 * Würfel ablenken.
 *
 * @param {object} snapshot Ergebnis von `readCube()`
 * @param {string[]} colors Farben des Steins
 * @returns {'placed'|'twisted'|'top'|'trapped'|null}
 */
export function locate(snapshot, colors) {
  const piece = (colors.length === 3 ? snapshot.corners : snapshot.edges).get(key(colors));
  if (!piece) return null;

  if (piece.colors.every((c, i) => piece.faces[i] === snapshot.faceOfColor[c])) return 'placed';

  // Heimatplatz aus den Mittelsteinen: Summe der Normalen der Zielseiten.
  const home = [0, 0, 0];
  for (const color of colors) {
    const normal = FACE_NORMALS[snapshot.faceOfColor[color]];
    for (let i = 0; i < 3; i++) home[i] += normal[i];
  }
  if (sameVec(piece.pos, home)) return 'twisted';

  // Die obere Ebene ist die dem Kreuz gegenüberliegende Weltseite.
  return dot(piece.pos, FACE_NORMALS[OPPOSITE[CROSS_FACE]]) === 1 ? 'top' : 'trapped';
}

/** Weltnormale einer bestimmten Farbe dieses Steins. */
export function normalOfSticker(piece, color) {
  return piece.normals[piece.colors.indexOf(color)];
}

/**
 * Wohin wandert eine Weltseite durch eine Ganzwürfeldrehung?
 * Leitet sich über `parseMove` direkt aus MOVE_DEFS ab und kann deshalb nicht
 * von den dortigen Vorzeichen abweichen.
 */
export function faceAfterRotation(face, token) {
  const { amount, def } = parseMove(token);
  const R = rotationMatrix(def.axis, def.sign * 90);
  let normal = FACE_NORMALS[face];
  for (let i = 0; i < amount; i++) normal = apply(R, normal);
  return faceOfNormal(normal);
}

/** Alle Ganzwürfeldrehungen, die als Umorientierung in Frage kommen. */
const ROTATION_TOKENS = ['x', "x'", 'x2', 'y', "y'", 'y2', 'z', "z'", 'z2'];

/**
 * Eine Drehung, die `fromFace` auf `toFace` bringt – oder [] wenn schon richtig.
 * Eine einzelne Vierteldrehung genügt immer, um eine Seite auf eine beliebige
 * andere zu bringen.
 * @returns {string[]}
 */
export function rotationToPut(fromFace, toFace) {
  if (fromFace === toFace) return [];
  const move = ROTATION_TOKENS.find((t) => faceAfterRotation(fromFace, t) === toFace);
  return move ? [move] : [];
}

/**
 * Wie `rotationToPut`, aber ausschliesslich mit `y`.
 *
 * Sobald das Kreuz unten liegt, darf nur noch um die stehende Achse gedreht
 * werden – ein `x` oder `z` würde die Kreuzfarbe wieder von unten wegdrehen.
 * Zwischen zwei Seitenflächen genügt `y` immer.
 * @returns {string[]}
 */
export function yRotationToPut(fromFace, toFace) {
  if (fromFace === toFace) return [];
  const move = ['y', "y'", 'y2'].find((t) => faceAfterRotation(fromFace, t) === toFace);
  return move ? [move] : [];
}

/**
 * Schreibt eine Zugfolge in das Bezugssystem um, das nach `rotation` gilt.
 *
 * Wer den Würfel dreht, muss danach andere Tasten drücken: die Schicht, die
 * vorher `F` war, heisst nach einem `y` anders. Ohne diese Umrechnung wären
 * alle Züge nach einer Drehung falsch.
 *
 * BEWUSST NUR FÜR AUSSENDREHUNGEN. Slices und Wide-Moves mitzudrehen ginge
 * zwar (M würde je nach Achse zu S oder E), wird hier aber nicht gebraucht:
 * Kreuz und F2L rechnen ausschliesslich mit Aussendrehungen, und die
 * OLL-/PLL-Algorithmen sind bereits in ihrem Standard-Bezugssystem notiert –
 * dort bringt die vorangestellte Drehung den Würfel zum Algorithmus, nicht
 * umgekehrt. Ein Slice hier wäre also ein Denkfehler und soll auffallen.
 */
export function rewriteAfterRotation(tokens, rotation) {
  if (!rotation) return tokens;

  const map = {};
  for (const face of FACES) map[face] = faceAfterRotation(face, rotation);

  return tokens.map((token) => {
    const face = token[0];
    if (!map[face]) {
      throw new Error(
        `rewriteAfterRotation: "${token}" ist keine Aussendrehung – siehe Kommentar.`,
      );
    }
    return map[face] + token.slice(1);
  });
}
