/**
 * crossSolver.js – Das weisse Kreuz, Kante für Kante.
 *
 * WARUM NICHT DAS ABSOLUTE OPTIMUM
 * --------------------------------
 * Ein global optimales Kreuz braucht selten mehr als 8 Züge, ist aber praktisch
 * nicht nachvollziehbar – die Züge setzen alle vier Kanten gleichzeitig und
 * verschränkt. Hier wird stattdessen jede Kante EINZELN optimal gelöst, ohne
 * die schon gesetzten wieder zu zerstören. Das ist der Weg, den man auch
 * unterrichtet: sichtbarer Fortschritt, jeder Schritt erklärbar.
 *
 * SUCHE
 * -----
 * Für das Kreuz zählen nur die vier weissen Kanten. Jede sitzt in einem von 12
 * Kantenplätzen und ist dort auf eine von zwei Arten orientiert – 24 Zustände
 * pro Kante. Der gesamte Suchraum ist damit klein genug für eine reine
 * Breitensuche über ganzzahlige Zustände; ein Klonen des ganzen Würfels pro
 * Knoten wäre um Größenordnungen teurer.
 *
 * Gedreht wird in der Suche NUR mit Aussendrehungen. Die Mittelsteine bleiben
 * dadurch stehen, und `faceOfColor` gilt während der ganzen Suche unverändert.
 */

import { FACE_NORMALS } from '../config.js';
import { parseMove } from '../cubeState.js';
import { apply, rotationMatrix } from '../math3d.js';
import {
  CROSS_COLOR, CROSS_FACE, FACES, faceOfNormal, sameVec,
  normalOfSticker, rotationToPut, yRotationToPut, rewriteAfterRotation,
} from './pieces.js';

/** Zugvorrat der Suche: alle Aussendrehungen. */
const SEARCH_MOVES = [];
for (const face of ['U', 'D', 'R', 'L', 'F', 'B']) {
  SEARCH_MOVES.push(face, `${face}'`, `${face}2`);
}

/** Die 12 Kantenplätze als Positionsvektoren. */
const EDGE_SLOTS = [];
for (const a of [-1, 0, 1]) {
  for (const b of [-1, 0, 1]) {
    for (const c of [-1, 0, 1]) {
      if ([a, b, c].filter((v) => v !== 0).length === 2) EDGE_SLOTS.push([a, b, c]);
    }
  }
}

const slotIndex = (pos) => EDGE_SLOTS.findIndex((s) => sameVec(s, pos));

/**
 * Ein Zug, vorbereitet für die Suche: Rotationsmatrix plus die Frage, ob eine
 * Position überhaupt betroffen ist.
 */
const PREPARED = SEARCH_MOVES.map((token) => {
  const { amount, def } = parseMove(token);
  const R = rotationMatrix(def.axis, def.sign * 90);
  const axisIndex = { x: 0, y: 1, z: 2 }[def.axis];
  const layers = Array.isArray(def.layer) ? def.layer : [def.layer];
  return { token, amount, R, axisIndex, layers };
});

/** Wendet einen vorbereiteten Zug auf einen einzelnen Stein an. */
function turn(prepared, pos, normal) {
  if (!prepared.layers.includes(pos[prepared.axisIndex])) return { pos, normal };
  let p = pos;
  let n = normal;
  for (let i = 0; i < prepared.amount; i++) {
    p = apply(prepared.R, p);
    n = apply(prepared.R, n);
  }
  return { pos: p, normal: n };
}

/** Kompakter Zustandsschlüssel für vier Kanten: je Platz und Orientierung. */
function encode(edges) {
  let code = 0;
  for (const e of edges) {
    // Orientierung: zeigt der weisse Aufkleber entlang der Achse, auf der der
    // Platz "steht"? Zwei Möglichkeiten, deshalb ein Bit.
    const slot = slotIndex(e.pos);
    const bit = e.normal[0] !== 0 ? 0 : e.normal[1] !== 0 ? 1 : 2;
    code = code * 36 + slot * 3 + bit;
  }
  return code;
}

/**
 * Sitzt diese Kante an ihrem Kreuz-Platz?
 * Weisser Aufkleber auf CROSS_FACE, zweite Farbe auf der Seite ihres Centers.
 */
function isPlaced(edge, faceOfColor) {
  if (faceOfNormal(edge.normal) !== CROSS_FACE) return false;
  return faceOfNormal(edge.sideNormal) === faceOfColor[edge.sideColor];
}

/**
 * Sucht die kürzeste Zugfolge, die `targetIndex` setzt und dabei alle Kanten
 * aus `keep` gesetzt lässt.
 *
 * @returns {string[]|null} Zugfolge oder null, wenn in `maxDepth` nicht lösbar
 */
function search(edges, targetIndex, keep, faceOfColor, maxDepth = 7) {
  const done = (list) => isPlaced(list[targetIndex], faceOfColor)
    && keep.every((i) => isPlaced(list[i], faceOfColor));

  if (done(edges)) return [];

  const seen = new Set([encode(edges)]);
  let frontier = [{ edges, path: [] }];

  for (let depth = 1; depth <= maxDepth; depth++) {
    const next = [];
    for (const node of frontier) {
      for (const prepared of PREPARED) {
        const moved = node.edges.map((e) => {
          const a = turn(prepared, e.pos, e.normal);
          const b = turn(prepared, e.pos, e.sideNormal);
          return { ...e, pos: a.pos, normal: a.normal, sideNormal: b.normal };
        });

        const code = encode(moved);
        if (seen.has(code)) continue;
        seen.add(code);

        const path = [...node.path, prepared.token];
        if (done(moved)) return path;
        next.push({ edges: moved, path });
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return null;
}

/**
 * Plant den nächsten Kreuzschritt.
 *
 * @param {object} snapshot Ergebnis von `readCube()`
 * @returns {{
 *   done: boolean, placed: number,
 *   rotation: string[], moves: string[], edgeColor: string,
 * } | null}
 */
export function planCross(snapshot) {
  const { faceOfColor, edges: allEdges } = snapshot;

  /*
   * Erster Schritt überhaupt: die Kreuzfarbe nach unten drehen. Ohne das wäre
   * jede weitere Aussage über "gesetzt" sinnlos, weil das Ziel gar nicht dort
   * liegt, wo gesucht wird.
   */
  if (faceOfColor[CROSS_COLOR] !== CROSS_FACE) {
    return {
      done: false,
      placed: 0,
      orienting: true,
      rotation: rotationToPut(faceOfColor[CROSS_COLOR], CROSS_FACE),
      moves: [],
      edgeColor: null,
    };
  }

  // Die vier Kanten mit der Kreuzfarbe, in fester Reihenfolge.
  const edges = [];
  for (const color of FACES) {
    if (color === CROSS_COLOR || color === 'D') continue;   // U/D sind keine Seitenfarben
    const piece = allEdges.get([CROSS_COLOR, color].sort().join(''));
    if (!piece) continue;
    edges.push({
      sideColor: color,
      pos: piece.pos,
      normal: normalOfSticker(piece, CROSS_COLOR),
      sideNormal: normalOfSticker(piece, color),
    });
  }

  const placedFlags = edges.map((e) => isPlaced(e, faceOfColor));
  const placed = placedFlags.filter(Boolean).length;
  if (placed === 4) {
    return { done: true, placed, orienting: false, rotation: [], moves: [], edgeColor: null };
  }

  // Jede noch offene Kante durchrechnen und die günstigste nehmen.
  const keep = placedFlags.map((ok, i) => (ok ? i : -1)).filter((i) => i >= 0);
  let best = null;

  for (let i = 0; i < edges.length; i++) {
    if (placedFlags[i]) continue;
    const moves = search(edges, i, keep, faceOfColor);
    if (moves && (best === null || moves.length < best.moves.length)) {
      best = { index: i, moves, edgeColor: edges[i].sideColor };
    }
  }
  if (!best) return null;

  /*
   * Damit der Schritt verständlich ist, wird die Zielkante nach vorne gedreht:
   * ihre Seitenfarbe soll auf der Weltseite F liegen. Nur `y` ist erlaubt –
   * alles andere würde die Kreuzfarbe wieder von unten wegdrehen. Die
   * gefundenen Züge müssen danach im neuen Bezugssystem benannt werden.
   */
  const rotation = yRotationToPut(faceOfColor[best.edgeColor], 'F');
  const moves = rewriteAfterRotation(best.moves, rotation[0]);

  return { done: false, placed, orienting: false, rotation, moves, edgeColor: best.edgeColor };
}
