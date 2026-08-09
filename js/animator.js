/**
 * animator.js – Warteschlange und Interpolation für Zugdrehungen.
 *
 * Ablauf eines Zuges:
 *   1. Betroffene Cubies aus dem AKTUELLEN Zustand bestimmen.
 *   2. Über `requestAnimationFrame` von 0° auf den Zielwinkel interpolieren;
 *      dabei wird nur die Darstellung verändert.
 *   3. Am Ende genau einmal `state.applyMove()` aufrufen und neu zeichnen.
 *
 * Der logische Zustand springt also diskret von "vorher" auf "nachher" – es
 * gibt keinen Zwischenzustand, in dem Logik und Bild auseinanderfallen können.
 * Schnell hintereinander gedrückte Tasten landen in der Queue und gehen nicht
 * verloren.
 */

import { TURN_DURATION } from './config.js';
import { parseMove, moveAngle } from './cubeState.js';

/** Weiche Beschleunigungskurve (ease-in-out, quadratisch). */
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

export class Animator {
  /** Als Feld definiert, damit `this` beim rAF-Callback erhalten bleibt. */
  #tick = (now) => {
    const c = this.current;
    if (!c) return;

    const t = Math.min(1, (now - c.start) / c.item.duration);
    this.renderer.render({ ids: c.ids, axis: c.axis, angle: c.total * ease(t) });

    if (t < 1) requestAnimationFrame(this.#tick);
    else this.#finish();
  };

  constructor(state, renderer) {
    this.state = state;
    this.renderer = renderer;
    this.queue = [];
    this.current = null;
    this.onMoveDone = null;  // (token) => void, nach jedem abgeschlossenen Zug
  }

  get busy() {
    return this.current !== null || this.queue.length > 0;
  }

  /**
   * Züge einreihen.
   * @param {string|string[]} tokens
   * @param {{duration?:number, onDone?:Function}} options
   *        `onDone` feuert, wenn der LETZTE Zug dieses Aufrufs fertig ist.
   */
  enqueue(tokens, { duration = TURN_DURATION, onDone = null } = {}) {
    const list = Array.isArray(tokens) ? tokens : [tokens];
    list.forEach((token, i) => {
      this.queue.push({ token, duration, onDone: i === list.length - 1 ? onDone : null });
    });
    this.#next();
  }

  /** Bricht alles ab; ein laufender Zug wird sofort zu Ende geführt. */
  clear() {
    this.queue.length = 0;
    if (this.current) this.#finish();
  }

  #next() {
    if (this.current || this.queue.length === 0) return;

    const item = this.queue.shift();
    const move = parseMove(item.token);
    this.current = {
      item,
      axis: move.def.axis,
      ids: this.state.affectedIds(move.def),
      total: moveAngle(move),
      start: performance.now(),
    };
    requestAnimationFrame(this.#tick);
  }

  #finish() {
    const { item } = this.current;
    this.current = null;

    // Erst jetzt wandert der Zug in das logische Modell.
    this.state.applyMove(item.token);
    this.renderer.render();

    if (item.onDone) item.onDone(item.token);
    if (this.onMoveDone) this.onMoveDone(item.token);

    this.#next();
  }
}
