/**
 * cubeState.js – Die logische Repräsentation des Würfels.
 *
 * SINGLE SOURCE OF TRUTH
 * ----------------------
 * Der Zustand besteht aus 27 Cubies. Jedes Cubie kennt
 *   • pos      – seine aktuelle Position [x,y,z] ∈ {-1,0,1}³
 *   • rot      – seine akkumulierte Orientierung als 3×3-Ganzzahlmatrix
 *   • stickers – seine Aufkleber mit der URSPRÜNGLICHEN Normalen (Modellframe)
 *
 * Der Renderer zeichnet *ausschliesslich* aus diesen Daten, und `isSolved()`
 * bzw. `getFacelets()` lesen *dieselben* Daten. Damit ist die Synchronität von
 * Logik und Darstellung strukturell garantiert – es gibt keine zweite,
 * separat gepflegte Farbtabelle, die auseinanderlaufen könnte.
 *
 * Die aktuelle Weltnormale eines Aufklebers ist immer `rot · sticker.normal`.
 */

import { FACE_NORMALS, MOVE_DEFS } from './config.js';
import { identity, rotationMatrix, multiply, apply, dot, AXIS_INDEX } from './math3d.js';

/**
 * Zerlegt einen Zug in Notation ("U", "R'", "F2", "y'") in Seite + Anzahl
 * Vierteldrehungen im Uhrzeigersinn (1, 2 oder 3).
 */
export function parseMove(token) {
  const face = token[0];
  const suffix = token.slice(1);
  const amount = suffix === "'" ? 3 : suffix === '2' ? 2 : 1;
  if (!MOVE_DEFS[face]) throw new Error(`Unbekannter Zug: ${token}`);
  return { face, amount, def: MOVE_DEFS[face] };
}

/**
 * Winkel, um den bei der Animation gedreht werden soll (Modell-Grad).
 * Wichtig: ein "'"-Zug (amount = 3) wird als -90° animiert, nicht als +270°.
 */
export function moveAngle({ amount, def }) {
  const turns = amount === 3 ? -1 : amount;
  return def.sign * 90 * turns;
}

/**
 * Zeilen-/Spaltenrichtung jeder Seite für die 2D-Facelet-Darstellung
 * (Standardabwicklung: U mit B oben, D mit F oben, Rest von U nach D).
 */
const FACELET_LAYOUT = {
  U: { row: [0, 0,  1], col: [ 1, 0,  0] },
  R: { row: [0, -1, 0], col: [ 0, 0, -1] },
  F: { row: [0, -1, 0], col: [ 1, 0,  0] },
  D: { row: [0, 0, -1], col: [ 1, 0,  0] },
  L: { row: [0, -1, 0], col: [ 0, 0,  1] },
  B: { row: [0, -1, 0], col: [-1, 0,  0] },
};

export class CubeState {
  constructor() {
    this.reset();
  }

  /**
   * Setzt den Würfel in den gelösten Zustand zurück.
   *
   * WICHTIG: Die Cubie-Objekte werden dabei NICHT ersetzt, sondern nur ihre
   * Position und Orientierung zurückgesetzt. Der Renderer hält direkte
   * Referenzen darauf (siehe `CubeRenderer.hints`); neue Objekte würden diese
   * Referenzen still verwaisen lassen – die Hint-Tafeln blieben dann für immer
   * auf dem Stand vor dem Reset stehen.
   */
  reset() {
    if (!this.cubies) this.#build();

    for (const cubie of this.cubies) {
      cubie.pos = [...cubie.home];
      cubie.rot = identity();
    }
  }

  /** Legt die 27 Cubies einmalig an. */
  #build() {
    this.cubies = [];
    let id = 0;
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          const home = [x, y, z];
          // Ein Aufkleber pro Seite; nach aussen zeigende Seiten bekommen die
          // Seitenfarbe, alle übrigen bleiben "innen" (face = null).
          const stickers = Object.entries(FACE_NORMALS).map(([face, normal]) => ({
            normal,
            // Liegt das Cubie auf dieser Aussenseite?
            face: dot(home, normal) === 1 ? face : null,
          }));
          this.cubies.push({ id: id++, home, pos: [...home], rot: identity(), stickers });
        }
      }
    }
  }

  /**
   * IDs aller Cubies, die von einem Zug bewegt werden.
   * `layer` ist eine Koordinate auf der Achse, ein Array davon (Wide-Moves)
   * oder null für den ganzen Würfel.
   */
  affectedIds({ axis, layer }) {
    if (layer === null) return new Set(this.cubies.map((c) => c.id));
    const i = AXIS_INDEX[axis];
    const layers = Array.isArray(layer) ? layer : [layer];
    return new Set(this.cubies.filter((c) => layers.includes(c.pos[i])).map((c) => c.id));
  }

  /**
   * Wendet einen Zug an: Position und Orientierung der betroffenen Cubies
   * werden mit derselben Rotationsmatrix multipliziert. Da die Rotation um die
   * Schichtachse erfolgt, bleibt die Menge der betroffenen Cubies konstant –
   * eine Mehrfachdrehung (X2, X') darf also einfach wiederholt werden.
   */
  applyMove(token) {
    const move = parseMove(token);
    const R = rotationMatrix(move.def.axis, move.def.sign * 90);
    const ids = this.affectedIds(move.def);

    for (let n = 0; n < move.amount; n++) {
      for (const cubie of this.cubies) {
        if (!ids.has(cubie.id)) continue;
        cubie.pos = apply(R, cubie.pos);
        cubie.rot = multiply(R, cubie.rot);
      }
    }
    return move;
  }

  /** Wendet eine ganze Zugfolge an (z. B. ein Scramble ohne Animation). */
  applySequence(tokens) {
    tokens.forEach((t) => this.applyMove(t));
  }

  /**
   * Alle aktuell sichtbaren Aufkleber als flache Liste:
   *   { face, normal, pos, color }  –  face = Farbe, normal = Blickrichtung.
   */
  visibleStickers() {
    const out = [];
    for (const cubie of this.cubies) {
      for (const sticker of cubie.stickers) {
        if (!sticker.face) continue;
        const normal = apply(cubie.rot, sticker.normal);
        // Nur zählen, wenn das Cubie auch wirklich auf dieser Aussenseite liegt.
        if (dot(cubie.pos, normal) !== 1) continue;
        out.push({ color: sticker.face, normal, pos: cubie.pos });
      }
    }
    return out;
  }

  /**
   * Gelöst = jede der sechs Seiten ist einfarbig.
   * Bewusst NICHT gegen feste Sollfarben geprüft, damit ein Würfel auch nach
   * Ganzwürfel-Drehungen (y, x, z) korrekt als gelöst erkannt wird.
   */
  isSolved() {
    const seen = new Map(); // "x,y,z" der Normalen → Farbe
    for (const s of this.visibleStickers()) {
      const key = s.normal.join(',');
      const known = seen.get(key);
      if (known === undefined) seen.set(key, s.color);
      else if (known !== s.color) return false;
    }
    return seen.size === 6;
  }

  /**
   * Logischer 54-Facelet-Zustand, abgeleitet aus denselben Cubie-Daten.
   * Praktisch zum Debuggen und für Solver/Export.
   * @returns {{U:string[],R:string[],F:string[],D:string[],L:string[],B:string[]}}
   */
  getFacelets() {
    const faces = {};
    for (const face of Object.keys(FACELET_LAYOUT)) faces[face] = new Array(9).fill('?');

    for (const s of this.visibleStickers()) {
      // Auf welcher Seite liegt dieser Aufkleber gerade?
      const face = Object.keys(FACE_NORMALS)
        .find((f) => FACE_NORMALS[f].every((v, i) => v === s.normal[i]));
      const { row, col } = FACELET_LAYOUT[face];
      faces[face][(dot(s.pos, row) + 1) * 3 + (dot(s.pos, col) + 1)] = s.color;
    }
    return faces;
  }

  /** Facelets als 54-Zeichen-String in der üblichen Reihenfolge URFDLB. */
  toFaceletString() {
    const f = this.getFacelets();
    return ['U', 'R', 'F', 'D', 'L', 'B'].map((k) => f[k].join('')).join('');
  }
}
