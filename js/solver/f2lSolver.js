/**
 * f2lSolver.js – Die ersten beiden Ebenen, Paar für Paar.
 *
 * WAS EIN F2L-SCHRITT LEISTEN MUSS
 * --------------------------------
 * Ein Slot besteht aus zwei Steinen: der Ecke mit der Kreuzfarbe und der Kante
 * darüber. Beide werden gemeinsam eingesetzt. Der Algorithmus darf dabei alles
 * anfassen, was oben liegt – aber nichts, was schon fertig ist. Genau das ist
 * die Definition der klassischen F2L-Algorithmen: sie verändern den Zielslot
 * und die obere Ebene, sonst nichts.
 *
 * Diese Bedingung wird hier NICHT geprüft, sondern in die Suche eingebaut:
 * mitgeführt werden acht Steine – das Zielpaar plus die sechs Plätze, die von
 * U, R und F überhaupt berührt werden können (die beiden Nachbarslots und die
 * beiden Kreuzkanten vorne und rechts). Alle acht müssen am Ende zu Hause sein.
 * Ein Zug, der ein fertiges Paar zerlegt, kann als Lösung also gar nicht erst
 * gefunden werden.
 *
 * Der vierte Slot hinten links und die Kreuzkanten hinten und links liegen
 * ausserhalb von U, R und F – sie können sich nicht bewegen und müssen deshalb
 * auch nicht mitgeführt werden.
 *
 * WARUM DIE SUCHE ZWEIGETEILT IST
 * -------------------------------
 * Die längsten F2L-Fälle brauchen elf Züge. Eine reine Breitensuche über neun
 * Zugtoken käme dort auf Milliarden Knoten. Stattdessen wird einmalig eine
 * Tabelle aller Stellungen aufgebaut, die vom gelösten Slot aus in höchstens
 * sechs Zügen erreichbar sind. Die eigentliche Suche läuft dann vom aktuellen
 * Würfel aus vorwärts, bis sie einen Eintrag dieser Tabelle trifft – beide
 * Hälften zusammen decken zwölf Züge ab, kosten aber nur die Wurzel des
 * Aufwands.
 *
 * FESTGEFAHRENE STEINE
 * --------------------
 * Steckt ein Stein in einem FREMDEN Slot, ist er für die Tabelle unerreichbar:
 * sie darf fremde Slots ja nicht anfassen. Solche Fälle bekommen deshalb einen
 * eigenen, dreizügigen Schritt, der den Slot leert (`R U R'`). Danach plant der
 * Coach neu. Das terminiert, weil bei jedem Räumen mindestens ein Stein aus
 * einem Slot nach oben wandert und nie einer zusätzlich hängen bleibt.
 */

import { FACE_NORMALS } from '../config.js';
import { parseMove } from '../cubeState.js';
import { AXIS_INDEX, apply, identity, multiply, rotationMatrix } from '../math3d.js';
import {
  CROSS_COLOR, CROSS_FACE, key, sameVec, normalOfSticker, yRotationToPut,
} from './pieces.js';

/**
 * Die vier Slots als Weltseitenpaar (vorne, rechts), im Uhrzeigersinn.
 * Die Reihenfolge innerhalb eines Paars ist wesentlich: sie legt fest, welche
 * Seite die Drehung nach vorne holt, und damit die Händigkeit des Slots.
 */
const SLOT_FACES = [['F', 'R'], ['R', 'B'], ['B', 'L'], ['L', 'F']];

/** Zugvorrat der Suche – der Slot liegt dabei immer vorne rechts. */
const SEARCH_MOVES = [];
for (const face of ['U', 'R', 'F']) SEARCH_MOVES.push(face, `${face}'`, `${face}2`);

const PREPARED = SEARCH_MOVES.map((token) => {
  const { amount, def } = parseMove(token);
  return {
    token,
    face: token[0],
    amount,
    R: rotationMatrix(def.axis, def.sign * 90),
    axisIndex: AXIS_INDEX[def.axis],
    layer: def.layer,
  };
});

/** Index des Gegenzugs zu jedem Zug – für den Rückweg aus der Tabelle. */
const INVERSE = PREPARED.map(({ token }) => {
  const inverse = token.endsWith('2') ? token
    : token.endsWith("'") ? token[0]
      : `${token}'`;
  return PREPARED.findIndex((p) => p.token === inverse);
});

/* ── Zustandscodierung ──────────────────────────────────────────────────
 *
 * Ein Stein wird über seinen Platz und die Achse eines Referenzstickers
 * beschrieben. Das Vorzeichen der Normalen muss nicht mitcodiert werden: ein
 * nach aussen zeigender Sticker hat auf seiner Achse immer dasselbe Vorzeichen
 * wie der Platz selbst. Damit passt ein Stein in eine Zahl unter 60 und der
 * ganze Zustand aus acht Steinen in eine exakte Ganzzahl (60⁸ < 2⁵³).
 */

/** Alle 20 Ecken- und Kantenplätze in fester Reihenfolge. */
const SLOTS = [];
for (const x of [-1, 0, 1]) {
  for (const y of [-1, 0, 1]) {
    for (const z of [-1, 0, 1]) {
      if ((x !== 0) + (y !== 0) + (z !== 0) >= 2) SLOTS.push([x, y, z]);
    }
  }
}

const SLOT_INDEX = new Map(SLOTS.map((slot, i) => [slot.join(','), i]));
const VALUES = SLOTS.length * 3;   // 60 mögliche Steinzustände
const TRACKED = 8;                 // mitgeführte Steine

const axisOf = (normal) => (normal[0] !== 0 ? 0 : normal[1] !== 0 ? 1 : 2);

const valueOf = (pos, normal) => SLOT_INDEX.get(pos.join(',')) * 3 + axisOf(normal);

function decode(value) {
  const pos = SLOTS[(value / 3) | 0];
  const axis = value % 3;
  if (pos[axis] === 0) return null;   // in echten Zuständen unerreichbar
  const normal = [0, 0, 0];
  normal[axis] = pos[axis];
  return { pos, normal };
}

/** Je Zug eine Tabelle Steinzustand → Steinzustand. */
const TRANSITION = PREPARED.map((prepared) => {
  const table = new Uint8Array(VALUES);
  for (let value = 0; value < VALUES; value++) {
    const piece = decode(value);
    if (!piece) { table[value] = value; continue; }

    let { pos, normal } = piece;
    if (pos[prepared.axisIndex] === prepared.layer) {
      for (let i = 0; i < prepared.amount; i++) {
        pos = apply(prepared.R, pos);
        normal = apply(prepared.R, normal);
      }
    }
    table[value] = valueOf(pos, normal);
  }
  return table;
});

/** Wendet einen Zug auf den ganzen Zustand an – acht Tabellenzugriffe. */
function applyMove(values, move) {
  const table = TRANSITION[move];
  const out = new Uint8Array(TRACKED);
  for (let i = 0; i < TRACKED; i++) out[i] = table[values[i]];
  return out;
}

function encode(values) {
  let code = 0;
  for (let i = 0; i < TRACKED; i++) code = code * VALUES + values[i];
  return code;
}

/**
 * Zielzustand im kanonischen Bezugssystem: Kreuz unten, Zielslot vorne rechts.
 * Reihenfolge ist Vertrag mit `trackedState()`.
 */
const HOME = [
  [[1, -1, 1], [0, -1, 0]],    // Ecke des Slots, Kreuzfarbe nach unten
  [[1, 0, 1], [0, 0, 1]],      // Kante des Slots, Frontfarbe nach vorne
  [[-1, -1, 1], [0, -1, 0]],   // Ecke vorne links
  [[1, -1, -1], [0, -1, 0]],   // Ecke hinten rechts
  [[-1, 0, 1], [0, 0, 1]],     // Kante vorne links
  [[1, 0, -1], [1, 0, 0]],     // Kante hinten rechts
  [[0, -1, 1], [0, -1, 0]],    // Kreuzkante vorne
  [[1, -1, 0], [0, -1, 0]],    // Kreuzkante rechts
];

const SOLVED = Uint8Array.from(HOME, ([pos, normal]) => valueOf(pos, normal));

/*
 * Die sechs Plätze ab Index 2 werden nicht als konkrete Steine verfolgt,
 * sondern als PLÄTZE: sie starten zu Hause und müssen dort wieder ankommen.
 * Das ist genau die Bedingung "der Algorithmus lässt sie in Ruhe" – unabhängig
 * davon, welcher Stein gerade darin liegt und ob der schon richtig ist.
 */
const KEEP_START = SOLVED.slice(2);

/* ── Tabelle der letzten sechs Züge ─────────────────────────────────────── */

const TABLE_DEPTH = 6;
const SEARCH_DEPTH = 6;

/** Zustand → (Abstand zum Ziel) · 16 + (Zug, der hierher führte). */
let TABLE = null;

function buildTable() {
  const table = new Map();
  table.set(encode(SOLVED), 15);   // Abstand 0, kein Zug

  let frontier = [{ values: SOLVED, face: null }];

  for (let distance = 1; distance <= TABLE_DEPTH; distance++) {
    const next = [];
    for (const node of frontier) {
      for (let move = 0; move < PREPARED.length; move++) {
        if (PREPARED[move].face === node.face) continue;   // U nach U ist ein Zug
        const values = applyMove(node.values, move);
        const code = encode(values);
        if (table.has(code)) continue;
        table.set(code, distance * 16 + move);
        next.push({ values, face: PREPARED[move].face });
      }
    }
    frontier = next;
  }
  return table;
}

/** Rückweg aus der Tabelle: Zug für Zug rückwärts bis zum gelösten Slot. */
function pathToHome(values) {
  const out = [];
  let current = values;
  for (;;) {
    const entry = TABLE.get(encode(current));
    if (entry >> 4 === 0) return out;
    const back = INVERSE[entry & 15];
    out.push(PREPARED[back].token);
    current = applyMove(current, back);
  }
}

/**
 * Kürzeste Zugfolge, die das Paar einsetzt und die sechs Nachbarplätze in Ruhe
 * lässt. Vorwärtssuche bis zum ersten Treffer in der Tabelle.
 * @returns {string[]|null}
 */
function searchPair(start) {
  if (!TABLE) TABLE = buildTable();

  const startCode = encode(start);
  let frontier = [{ values: start, code: startCode, move: -1, face: null, parent: null }];
  const seen = new Set([startCode]);

  for (let depth = 0; ; depth++) {
    // Innerhalb einer Ebene den Treffer mit dem kürzesten Restweg nehmen.
    let best = null;
    for (const node of frontier) {
      const entry = TABLE.get(node.code);
      if (entry === undefined) continue;
      const total = depth + (entry >> 4);
      if (best === null || total < best.total) best = { node, total };
    }
    if (best) {
      const prefix = [];
      for (let n = best.node; n.move >= 0; n = n.parent) prefix.unshift(PREPARED[n.move].token);
      return [...prefix, ...pathToHome(best.node.values)];
    }

    if (depth === SEARCH_DEPTH) return null;

    const next = [];
    for (const node of frontier) {
      for (let move = 0; move < PREPARED.length; move++) {
        if (PREPARED[move].face === node.face) continue;
        const values = applyMove(node.values, move);
        const code = encode(values);
        if (seen.has(code)) continue;
        seen.add(code);
        next.push({ values, code, move, face: PREPARED[move].face, parent: node });
      }
    }
    if (next.length === 0) return null;
    frontier = next;
  }
}

/* ── Vom Würfel zur Suche ───────────────────────────────────────────────── */

/** Drehmatrix zu einem Ganzwürfel-Token, oder die Einheitsmatrix. */
function matrixFor(token) {
  if (!token) return identity();
  const { amount, def } = parseMove(token);
  const R = rotationMatrix(def.axis, def.sign * 90);
  let M = identity();
  for (let i = 0; i < amount; i++) M = multiply(R, M);
  return M;
}

/** Heimatplatz eines Steins in Weltkoordinaten, aus den Mittelsteinen. */
function homePosition(colors, faceOfColor) {
  const out = [0, 0, 0];
  for (const color of colors) {
    const normal = FACE_NORMALS[faceOfColor[color]];
    for (let i = 0; i < 3; i++) out[i] += normal[i];
  }
  return out;
}

/** Sitzt der Stein vollständig richtig – Platz UND Ausrichtung? */
const isPlaced = (piece, faceOfColor) =>
  piece.colors.every((color, i) => piece.faces[i] === faceOfColor[color]);

/**
 * Liest die vier Slots aus dem Würfel.
 * `front`/`right` sind Weltseiten, die Farben ergeben sich aus den dortigen
 * Mittelsteinen – der Würfel darf also beliebig um y gedreht stehen.
 */
function readSlots(snapshot) {
  const { colorOnFace, faceOfColor, corners, edges } = snapshot;
  const bottomColor = colorOnFace[CROSS_FACE];

  return SLOT_FACES.map(([front, right]) => {
    const frontColor = colorOnFace[front];
    const rightColor = colorOnFace[right];
    const cornerColors = [bottomColor, frontColor, rightColor];
    const edgeColors = [frontColor, rightColor];

    const corner = corners.get(key(cornerColors));
    const edge = edges.get(key(edgeColors));

    return {
      front,
      right,
      frontColor,
      rightColor,
      cornerColors,
      edgeColors,
      corner,
      edge,
      cornerHome: homePosition(cornerColors, faceOfColor),
      edgeHome: homePosition(edgeColors, faceOfColor),
      solved: isPlaced(corner, faceOfColor) && isPlaced(edge, faceOfColor),
    };
  });
}

/**
 * Ein Stein ist "frei", wenn die Suche ihn erreichen kann: er liegt oben oder
 * bereits in seinem eigenen Slot. Steckt er in einem fremden Slot, muss der
 * erst geräumt werden.
 */
const isFree = (piece, home) => piece.pos[1] === 1 || sameVec(piece.pos, home);

/** In welchem Slot steckt ein Stein, der weder oben noch zu Hause liegt? */
function hostSlot(pos, slots) {
  return slots.find(({ front, right }) => {
    const f = FACE_NORMALS[front];
    const r = FACE_NORMALS[right];
    const on = (n) => pos[0] * n[0] + pos[1] * n[1] + pos[2] * n[2] === 1;
    return on(f) && on(r);
  });
}

/** Acht Steine im kanonischen Bezugssystem, bereit für die Suche. */
function trackedState(slot, M) {
  const values = new Uint8Array(TRACKED);

  const corner = slot.corner;
  values[0] = valueOf(
    apply(M, corner.pos),
    apply(M, normalOfSticker(corner, slot.cornerColors[0])),
  );

  const edge = slot.edge;
  values[1] = valueOf(
    apply(M, edge.pos),
    apply(M, normalOfSticker(edge, slot.frontColor)),
  );

  values.set(KEEP_START, 2);
  return values;
}

/* ── Plan ───────────────────────────────────────────────────────────────── */

/**
 * Plant den nächsten F2L-Schritt.
 *
 * @param {object} snapshot Ergebnis von `readCube()`
 * @returns {{
 *   done: boolean, placed: number, kind: 'insert'|'clear',
 *   rotation: string[], moves: string[],
 *   slot: {front: string, right: string},
 *   cornerColors: string[], edgeColors: string[],
 * } | null}
 */
export function planF2L(snapshot) {
  const slots = readSlots(snapshot);
  const placed = slots.filter((slot) => slot.solved).length;

  if (placed === 4) {
    return { done: true, placed, kind: 'insert', rotation: [], moves: [], slot: null };
  }

  /*
   * Erst die Paare, die direkt eingesetzt werden können. Von diesen gewinnt das
   * kürzeste – so wie beim Kreuz auch. Die Drehung zählt bewusst nicht mit:
   * sie kostet keine Denkarbeit, der Algorithmus schon.
   */
  let best = null;

  for (const slot of slots) {
    if (slot.solved) continue;
    if (!isFree(slot.corner, slot.cornerHome)) continue;
    if (!isFree(slot.edge, slot.edgeHome)) continue;

    const rotation = yRotationToPut(slot.front, 'F');
    const moves = searchPair(trackedState(slot, matrixFor(rotation[0])));
    if (moves && (best === null || moves.length < best.moves.length)) {
      best = { slot, rotation, moves };
    }
  }

  if (best) {
    return {
      done: false,
      placed,
      kind: 'insert',
      rotation: best.rotation,
      moves: best.moves,
      slot: { front: best.slot.front, right: best.slot.right },
      cornerColors: best.slot.cornerColors,
      edgeColors: best.slot.edgeColors,
    };
  }

  /*
   * Kein Paar erreichbar – also steckt mindestens ein Stein in einem fremden
   * Slot. Den nach oben holen; im nächsten Schritt ist sein Paar dann frei.
   */
  for (const slot of slots) {
    if (slot.solved) continue;
    for (const [piece, home] of [[slot.corner, slot.cornerHome], [slot.edge, slot.edgeHome]]) {
      if (isFree(piece, home)) continue;

      const host = hostSlot(piece.pos, slots);
      if (!host) continue;
      return {
        done: false,
        placed,
        kind: 'clear',
        rotation: yRotationToPut(host.front, 'F'),
        moves: ['R', 'U', "R'"],
        slot: { front: host.front, right: host.right },
        cornerColors: slot.cornerColors,
        edgeColors: slot.edgeColors,
      };
    }
  }

  return null;
}
