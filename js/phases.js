/**
 * phases.js – In welchem CFOP-Abschnitt steckt der Würfel gerade?
 *
 * Wird nach JEDEM Zug aufgerufen, um die Zwischenzeiten eines Solves zu
 * stellen. Deshalb rechnet hier nichts – es wird nur GEPRÜFT, ob ein Abschnitt
 * fertig ist. Die Solver in `solver/` suchen Zugfolgen und sind für einen
 * Aufruf pro Zug zu teuer; für eine Zwischenzeit genügt die Frage "schon
 * fertig?", und die beantwortet ein Blick auf die Steine.
 *
 * Der Bezug sind immer die MITTELSTEINE, nie die Weltseiten: nach einem `y`
 * liegt dieselbe Ecke woanders, gelöst ist sie trotzdem. `locate()` vergleicht
 * genau so, deshalb überstehen die Prüfungen hier jede Ganzwürfeldrehung.
 */

import { readCube, locate, CROSS_COLOR, OPPOSITE, faceOfSticker } from './solver/pieces.js';

/** Farbe der letzten Ebene – dem Kreuz gegenüber. */
const LAST_LAYER_COLOR = OPPOSITE[CROSS_COLOR];

/** Aufsteigend: ein höherer Index heisst, der Würfel ist weiter. */
export const PHASE_ORDER = ['cross', 'f2l', 'oll', 'pll'];

/** Alle Steine einer Map, die eine bestimmte Farbe tragen. */
const withColor = (map, color) => [...map.values()].filter((p) => p.colors.includes(color));

/**
 * Der Abschnitt, an dem gerade gearbeitet wird.
 *
 * @param {import('./cubeState.js').CubeState} state
 * @returns {'cross'|'f2l'|'oll'|'pll'|'done'}
 */
export function currentPhase(state) {
  const snapshot = readCube(state);

  // Kreuz: die vier Kanten mit der Kreuzfarbe sitzen richtig.
  const crossEdges = withColor(snapshot.edges, CROSS_COLOR);
  if (!crossEdges.every((edge) => locate(snapshot, edge.colors) === 'placed')) return 'cross';

  /*
   * F2L: alles ausser der letzten Ebene sitzt. Statt vier Slots einzeln zu
   * prüfen wird gefragt, welche Steine NICHT zur letzten Ebene gehören – das
   * sind genau die beiden ersten Ebenen, Kreuz eingeschlossen.
   */
  const firstTwoLayers = [...snapshot.corners.values(), ...snapshot.edges.values()]
    .filter((piece) => !piece.colors.includes(LAST_LAYER_COLOR));
  if (!firstTwoLayers.every((piece) => locate(snapshot, piece.colors) === 'placed')) return 'f2l';

  /*
   * OLL: die Deckfarbe zeigt bei allen Steinen der letzten Ebene nach oben.
   * "Oben" ist dabei die Seite, auf der der Mittelstein dieser Farbe sitzt –
   * damit stimmt es auch nach einer Ganzwürfeldrehung.
   */
  const topFace = snapshot.faceOfColor[LAST_LAYER_COLOR];
  const lastLayer = [...snapshot.corners.values(), ...snapshot.edges.values()]
    .filter((piece) => piece.colors.includes(LAST_LAYER_COLOR));
  if (!lastLayer.every((piece) => faceOfSticker(piece, LAST_LAYER_COLOR) === topFace)) return 'oll';

  // PLL: orientiert, aber noch nicht sortiert.
  return lastLayer.every((piece) => locate(snapshot, piece.colors) === 'placed') ? 'done' : 'pll';
}

/**
 * Misst die Zwischenzeiten eines Versuchs.
 *
 * Die Phase kann zurückspringen – wer beim Einsetzen eines Paares das Kreuz
 * aufreisst, steht wieder bei "cross". Gewertet wird deshalb der WEITESTE
 * erreichte Stand: eine einmal gestellte Zwischenzeit bleibt stehen, und die
 * Reparatur landet in der Phase, in der sie tatsächlich anfiel. Sonst käme
 * jeder Patzer als negative Dauer heraus.
 */
export class PhaseTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.marks = {};  // Phase → Zeitpunkt ihres Abschlusses, relativ zum Start
    this.done = 0;    // Anzahl abgeschlossener Abschnitte
  }

  /**
   * Nach jedem Zug aufrufen.
   * @param {string} phase   Ergebnis von `currentPhase()`
   * @param {number} elapsed Verstrichene Zeit in ms
   */
  update(phase, elapsed) {
    // Steht der Würfel bei "f2l", ist genau ein Abschnitt fertig – das Kreuz.
    const completed = phase === 'done' ? PHASE_ORDER.length : PHASE_ORDER.indexOf(phase);
    if (completed <= this.done) return;

    // Übersprungene Abschnitte mit abhaken: ein Zug kann zwei beenden (etwa ein
    // OLL, das die letzte Ebene gleich mit sortiert – dann hat PLL Dauer null).
    for (let i = this.done; i < completed; i++) this.marks[PHASE_ORDER[i]] = elapsed;
    this.done = completed;
  }

  /**
   * Dauer je Abschnitt, sobald der Versuch steht.
   *
   * Fehlt eine Marke – bei einem abgebrochenen Versuch –, zählt die Endzeit.
   * Der angefangene Abschnitt bekommt dann alles, was übrig ist, und die
   * dahinter bleiben bei null.
   *
   * ZUGESICHERT: die vier Werte ergeben zusammen exakt `total`. Die Gesamtzeit
   * ist die gemessene Wahrheit, die Marken sind nur ihre Unterteilung – bleibt
   * hinter der letzten Marke noch etwas übrig, gehört es an das Ende und darf
   * nicht verschwinden. Sonst zeigte ein gestapelter Balken weniger an, als die
   * Uhr daneben sagt.
   *
   * @param {number} total Endzeit in ms
   * @returns {{cross:number,f2l:number,oll:number,pll:number}}
   */
  splits(total) {
    const out = {};
    let previous = 0;

    for (const phase of PHASE_ORDER) {
      const mark = Math.min(this.marks[phase] ?? total, total);
      out[phase] = Math.max(0, mark - previous);
      previous = Math.max(mark, previous);
    }

    out[PHASE_ORDER[PHASE_ORDER.length - 1]] += Math.max(0, total - previous);
    return out;
  }
}
