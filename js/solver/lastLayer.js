/**
 * lastLayer.js – OLL und PLL: Fallerkennung, Nachschlagen, Musterbild.
 *
 * DIE FÄLLE WERDEN AUS DEN ALGORITHMEN ERZEUGT
 * --------------------------------------------
 * Nirgends steht "Muster X gehört zu Algorithmus Y". Stattdessen wird jeder
 * Algorithmus einmal RÜCKWÄRTS auf einen gelösten Würfel angewandt – heraus
 * kommt genau die Stellung, die er löst. Diese Stellung wird als Schlüssel
 * abgelegt.
 *
 * Das hat drei Folgen, die zusammen den Aufwand rechtfertigen:
 *   • Muster und Algorithmus können nicht auseinanderlaufen.
 *   • Jeder Tabelleneintrag ist per Konstruktion korrekt: er löst die Stellung,
 *     aus der er entstanden ist.
 *   • Ein Tippfehler in llAlgs.js erzeugt keinen falschen Rat, sondern einen
 *     Eintrag für eine Stellung, die es nicht gibt – und lässt dafür eine echte
 *     Stellung unbesetzt. `tools/verify-ll.mjs` zählt genau das.
 *
 * AUF GEHÖRT IN DIE TABELLE, NICHT IN DIE ERKENNUNG
 * -------------------------------------------------
 * Derselbe Fall kann in vier Drehlagen der oberen Ebene auftreten, bei PLL
 * zusätzlich mit vier Schlusslagen. Statt beim Erkennen zu probieren, werden
 * beim Aufbau alle Varianten mitsamt ihrer U-Vor- und -Nachdrehung erzeugt.
 * Erkennen ist dadurch ein einziger Zugriff.
 *
 * WARUM PLL DREHT UND OLL NICHT
 * -----------------------------
 * OLL kennt nur Ausrichtungen. Ob der Würfel um y verdreht steht, ändert das
 * Bild genauso wie eine U-Drehung – und die steckt schon in der Tabelle. OLL
 * braucht deshalb nie eine Ganzwürfeldrehung.
 *
 * PLL dagegen bringt Steine zu ihren Mittelsteinen; das Muster hängt an den
 * Farben. Hier wird der Würfel erst per `y` in die Normallage gedreht und dann
 * der Algorithmus in seinem Standard-Bezugssystem ausgeführt – genau der Fall,
 * den `rewriteAfterRotation` in pieces.js ausdrücklich NICHT abdeckt, weil ein
 * Umschreiben von M und r dort ein Denkfehler wäre.
 */

import { FACE_NORMALS } from '../config.js';
import { CubeState, parseMove } from '../cubeState.js';
import { apply, identity, multiply, rotationMatrix } from '../math3d.js';
import {
  CROSS_FACE, OPPOSITE, readCube, sameVec, yRotationToPut,
} from './pieces.js';
import { OLL_ALGS, PLL_ALGS } from './llAlgs.js';

/** Weltseite der letzten Ebene – dem Kreuz gegenüber. */
const TOP_FACE = OPPOSITE[CROSS_FACE];
const TOP_NORMAL = FACE_NORMALS[TOP_FACE];

/** Die vier Ecken- und vier Kantenplätze der letzten Ebene, feste Reihenfolge. */
const LL_SLOTS = [
  [1, 1, 1], [-1, 1, 1], [-1, 1, -1], [1, 1, -1],     // Ecken
  [0, 1, 1], [-1, 1, 0], [0, 1, -1], [1, 1, 0],       // Kanten
];

const vecKey = (v) => `${v[0]},${v[1]},${v[2]}`;
const slotIndex = (pos) => LL_SLOTS.findIndex((s) => sameVec(s, pos));
const axisOf = (normal) => (normal[0] !== 0 ? 0 : normal[1] !== 0 ? 1 : 2);

/** Kehrt eine Zugfolge um: rückwärts, und jeder Zug durch seinen Gegenzug. */
export function invert(tokens) {
  return [...tokens].reverse().map((token) => {
    if (token.endsWith('2')) return token;
    return token.endsWith("'") ? token.slice(0, -1) : `${token}'`;
  });
}

/** Drehmatrix zu einem Ganzwürfel-Token, oder die Einheitsmatrix. */
function matrixFor(token) {
  if (!token) return identity();
  const { amount, def } = parseMove(token);
  const R = rotationMatrix(def.axis, def.sign * 90);
  let M = identity();
  for (let i = 0; i < amount; i++) M = multiply(R, M);
  return M;
}

/** Die vier U-Vordrehungen als Zugfolge. */
const AUF = [[], ['U'], ['U2'], ["U'"]];

/**
 * Gelöster Würfel in der Normallage: Kreuzfarbe unten, Farbe F vorne.
 *
 * Ein frischer `CubeState` hat die Kreuzfarbe OBEN – das ist die Bauform, nicht
 * die Solverkonvention. Gedreht wird mit `z2` und nicht mit `x2`: beide bringen
 * die Kreuzfarbe nach unten, aber `x2` schiebt dabei die Farbe F nach hinten.
 * Damit stünde der Referenzwürfel für PLL schief, dessen Muster an den
 * Mittelsteinen hängt.
 */
export function referenceCube() {
  const cube = new CubeState();
  cube.applyMove('z2');
  return cube;
}

/* ── Stellung lesen ─────────────────────────────────────────────────────── */

/**
 * Die acht Steine der letzten Ebene, nach Platz sortiert.
 * @param {object} snapshot Ergebnis von `readCube()`
 * @param {number[][]} M    Drehung in das gewünschte Bezugssystem
 */
function lastLayerPieces(snapshot, M) {
  const out = new Array(LL_SLOTS.length).fill(null);

  for (const piece of [...snapshot.corners.values(), ...snapshot.edges.values()]) {
    const pos = apply(M, piece.pos);
    const index = slotIndex(pos);
    if (index >= 0) out[index] = { piece, pos };
  }
  return out;
}

/**
 * Ausrichtungsmuster: für jeden Platz die Achse, in die der Aufkleber der
 * Deckfarbe zeigt. Rein platzbezogen, ganz ohne Mittelsteine – deshalb gilt es
 * unverändert, egal wie der Würfel um y steht.
 */
function ollPattern(snapshot) {
  const topColor = snapshot.colorOnFace[TOP_FACE];
  let code = 0;

  for (const entry of lastLayerPieces(snapshot, identity())) {
    const { piece } = entry;
    const normal = piece.normals[piece.colors.indexOf(topColor)];
    code = code * 3 + axisOf(normal);
  }
  return code;
}

/**
 * Vertauschungsmuster: für jeden Platz, wohin der dort liegende Stein gehört.
 * Die Zielplätze folgen den Mittelsteinen, deshalb muss vorher in die
 * Normallage gedreht werden (`M`).
 */
function pllPattern(snapshot, M) {
  let code = 0;

  for (const entry of lastLayerPieces(snapshot, M)) {
    const home = [0, 0, 0];
    for (const color of entry.piece.colors) {
      const normal = FACE_NORMALS[snapshot.faceOfColor[color]];
      for (let i = 0; i < 3; i++) home[i] += normal[i];
    }
    code = code * 8 + slotIndex(apply(M, home));
  }
  return code;
}

/* ── Tabellen ───────────────────────────────────────────────────────────── */

/**
 * Baut eine Nachschlagetabelle Muster → Zugfolge.
 *
 * @param {Array} algs      Einträge aus llAlgs.js
 * @param {Function} pattern  Musterfunktion auf einem `snapshot`
 * @param {boolean} postAuf true = auch die vier Schlussdrehungen erzeugen (PLL)
 */
function buildTable(algs, pattern, postAuf) {
  const table = new Map();

  // Die Nulllösung gehört dazu: fertig, aber die Ebene steht vielleicht schief.
  const entries = [{ id: null, name: null, moves: '' }, ...algs];

  for (const entry of entries) {
    const alg = entry.moves ? entry.moves.split(' ') : [];

    for (const before of AUF) {
      for (const after of postAuf ? AUF : [[]]) {
        const solution = [...before, ...alg, ...after];

        const cube = referenceCube();
        cube.applySequence(invert(solution));

        const code = pattern(readCube(cube));
        const known = table.get(code);
        if (known && known.moves.length <= solution.length) continue;
        table.set(code, { moves: solution, id: entry.id, name: entry.name });
      }
    }
  }
  return table;
}

let OLL_TABLE = null;
let PLL_TABLE = null;

/** Nur für `tools/verify-ll.mjs` – prüft Vollständigkeit der Abdeckung. */
export function tables() {
  // Der Referenzwürfel steht schon in der Normallage, deshalb keine Drehung.
  if (!OLL_TABLE) OLL_TABLE = buildTable(OLL_ALGS, ollPattern, false);
  if (!PLL_TABLE) {
    PLL_TABLE = buildTable(PLL_ALGS, (snap) => pllPattern(snap, identity()), true);
  }
  return { oll: OLL_TABLE, pll: PLL_TABLE, ollPattern, pllPattern };
}

/* ── Musterbild für den Trainer ─────────────────────────────────────────── */

/** Aufkleberfarbe an einer Stelle, im Bezugssystem `M`. */
function stickerMap(snapshot, M) {
  const map = new Map();
  for (const piece of [...snapshot.corners.values(), ...snapshot.edges.values()]) {
    const pos = apply(M, piece.pos);
    piece.colors.forEach((color, i) => {
      map.set(`${vecKey(pos)}|${vecKey(apply(M, piece.normals[i]))}`, color);
    });
  }
  return map;
}

/** Die neun Felder der Deckfläche, von hinten links nach vorne rechts. */
const TOP_CELLS = [];
for (const z of [-1, 0, 1]) {
  for (const x of [-1, 0, 1]) TOP_CELLS.push([[x, 1, z], TOP_NORMAL]);
}

/** Die zwölf Seitenaufkleber ringsum, je Kante von links nach rechts gelesen. */
const SIDE_CELLS = {
  north: [-1, 0, 1].map((x) => [[x, 1, -1], FACE_NORMALS.B]),
  east:  [-1, 0, 1].map((z) => [[1, 1, z], FACE_NORMALS.R]),
  south: [-1, 0, 1].map((x) => [[x, 1, 1], FACE_NORMALS.F]),
  west:  [-1, 0, 1].map((z) => [[-1, 1, z], FACE_NORMALS.L]),
};

/**
 * Das Bild, das links im Trainer steht.
 *
 * OLL zeigt nur, WO die Deckfarbe schon oben liegt – alles andere bleibt leer,
 * genau wie auf einem Algorithmenblatt. PLL zeigt die Deckfläche geschlossen
 * und ringsum die echten Seitenfarben; daran erkennt man den Fall.
 */
function buildDiagram(snapshot, M, mode) {
  const stickers = stickerMap(snapshot, M);
  const topColor = snapshot.colorOnFace[TOP_FACE];
  const at = ([pos, normal]) => stickers.get(`${vecKey(pos)}|${vecKey(normal)}`) ?? null;

  const cell = (spot) => {
    /*
     * Der Mittelstein steht in keiner Steinliste – `readCube` verarbeitet ihn
     * zu `colorOnFace` und legt ihn nicht zu Ecken und Kanten. Er bewegt sich
     * ohnehin nie: das Feld in der Mitte trägt immer die Deckfarbe.
     */
    const [pos] = spot;
    if (pos[0] === 0 && pos[2] === 0) return topColor;

    const color = at(spot);
    if (mode === 'pll') return color;
    return color === topColor ? topColor : null;
  };

  return {
    top: TOP_CELLS.map((spot) => (mode === 'pll' ? topColor : cell(spot))),
    north: SIDE_CELLS.north.map(cell),
    east: SIDE_CELLS.east.map(cell),
    south: SIDE_CELLS.south.map(cell),
    west: SIDE_CELLS.west.map(cell),
  };
}

/* ── Pläne ──────────────────────────────────────────────────────────────── */

/** Zeigen alle acht Deckfarben nach oben? */
function isOriented(snapshot) {
  const topColor = snapshot.colorOnFace[TOP_FACE];
  return lastLayerPieces(snapshot, identity()).every(({ piece }) =>
    sameVec(piece.normals[piece.colors.indexOf(topColor)], TOP_NORMAL));
}

/**
 * Nächster OLL-Schritt.
 * @returns {{done: boolean, moves: string[], id: number|null, name: string|null,
 *            diagram: object} | null}
 */
export function planOLL(snapshot) {
  if (isOriented(snapshot)) return { done: true, moves: [], id: null, name: null, diagram: null };

  const { oll } = tables();
  const hit = oll.get(ollPattern(snapshot));
  if (!hit) return null;

  return {
    done: false,
    moves: hit.moves,
    id: hit.id,
    name: hit.name,
    diagram: buildDiagram(snapshot, identity(), 'oll'),
  };
}

/**
 * Nächster PLL-Schritt. Setzt eine ausgerichtete letzte Ebene voraus.
 * @returns {{done: boolean, rotation: string[], moves: string[],
 *            id: string|null, name: string|null, diagram: object} | null}
 */
export function planPLL(snapshot) {
  const { faceOfColor } = snapshot;

  // In die Normallage drehen: die Farbe F gehört nach vorne.
  const rotation = yRotationToPut(faceOfColor.F, 'F');
  const M = matrixFor(rotation[0]);

  const { pll } = tables();
  const hit = pll.get(pllPattern(snapshot, M));
  if (!hit) return null;

  if (hit.moves.length === 0) {
    return { done: true, rotation: [], moves: [], id: null, name: null, diagram: null };
  }

  return {
    done: false,
    rotation,
    moves: hit.moves,
    id: hit.id,
    name: hit.name,
    diagram: buildDiagram(snapshot, M, 'pll'),
  };
}
