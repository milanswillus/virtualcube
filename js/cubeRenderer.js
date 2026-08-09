/**
 * cubeRenderer.js – Zeichnet den Zustand aus cubeState.js als CSS-3D-Szene.
 *
 * Der Renderer besitzt KEINEN eigenen Zustand: `render()` leitet jede
 * Transformation frisch aus `state.cubies` ab. Dadurch kann die Anzeige
 * niemals von der Logik abweichen.
 *
 * Transformationskette pro Cubie (CSS wertet von links nach rechts aus,
 * d. h. der linkeste Eintrag ist die äusserste Transformation):
 *
 *   [Animationsdrehung] · translate3d(Position) · matrix3d(Orientierung)
 *
 * Die Animationsdrehung ist eine Drehung um den Würfelmittelpunkt und wird nur
 * den Cubies der gerade drehenden Schicht vorangestellt.
 *
 * Alle Klassen und CSS-Variablen sind mit `cb-` bzw. `--cb-` präfixiert, damit
 * nichts mit den Styles der übrigen Seite kollidiert.
 */

import { CUBIE_SIZE, CUBIE_GAP, INNER_COLOR, FACE_NORMALS, HIDDEN_DIRECTIONS } from './config.js';
import { cssMatrix3d, cssAngle, cssPosition, apply } from './math3d.js';

const SPACING = CUBIE_SIZE + CUBIE_GAP;

/** Lokale Ausrichtung eines Aufklebers im (CSS-)Frame seines Cubies. */
const FACE_TRANSFORM = {
  U: 'rotateX(90deg)',
  D: 'rotateX(-90deg)',
  F: '',
  B: 'rotateY(180deg)',
  R: 'rotateY(90deg)',
  L: 'rotateY(-90deg)',
};

export class CubeRenderer {
  /**
   * @param {HTMLElement} container – Element mit `transform-style: preserve-3d`
   * @param {import('./cubeState.js').CubeState} state
   */
  constructor(container, state) {
    this.container = container;
    this.state = state;
    this.elements = new Map(); // cubie.id → HTMLElement
    // { cubie, normal, el } je sichtbarem Sticker. Hält direkte Referenzen auf
    // die Cubie-Objekte – `CubeState.reset()` setzt diese deshalb in place
    // zurück, statt sie zu ersetzen.
    this.hints = [];
    this.#applyCssVariables();
    this.build();
  }

  /** Grössen aus der Konfiguration an das Stylesheet durchreichen. */
  #applyCssVariables() {
    const targets = [this.container.style, document.documentElement.style];
    if (this.container.parentElement) targets.push(this.container.parentElement.style);
    for (const target of targets) {
      target.setProperty('--cb-cubie', `${CUBIE_SIZE}px`);
      target.setProperty('--cb-half', `${CUBIE_SIZE / 2}px`);
      target.setProperty('--cb-size', `${SPACING * 3}px`);
      target.setProperty('--cb-body', INNER_COLOR);
    }
  }

  /** Baut das DOM einmalig auf: 27 Cubies mit je 6 Flächen. */
  build() {
    this.container.textContent = '';
    this.elements.clear();
    this.hints.length = 0;

    const fragment = document.createDocumentFragment();

    for (const cubie of this.state.cubies) {
      const el = document.createElement('div');
      el.className = 'cb-cubie';

      for (const sticker of cubie.stickers) {
        // Zu welcher Seite gehört diese Fläche im Ursprungszustand?
        const faceKey = Object.keys(FACE_NORMALS).find((f) =>
          FACE_NORMALS[f].every((v, i) => v === sticker.normal[i]));

        const face = document.createElement('div');
        face.className = 'cb-facelet';
        face.style.transform = `${FACE_TRANSFORM[faceKey]} translateZ(var(--cb-half))`;

        if (sticker.face) {
          // Sichtbarer Aufkleber. Die Farbe kommt über data-face aus dem CSS.
          const cap = document.createElement('div');
          cap.className = 'cb-cap';
          cap.dataset.face = sticker.face;
          face.appendChild(cap);

          /*
           * Hint-Tafel für den "hints"-Modus: dieselbe Fläche, entlang ihrer
           * eigenen Normalen nach aussen versetzt. Weil sie am Cubie hängt,
           * dreht sie bei jedem Zug automatisch mit. Sichtbar ist sie nur,
           * wenn ihre Seite gerade vom Betrachter wegzeigt (siehe #updateHints).
           */
          const hint = document.createElement('div');
          hint.className = 'cb-hintface';
          hint.dataset.face = sticker.face;
          hint.style.transform =
            `${FACE_TRANSFORM[faceKey]} translateZ(calc(var(--cb-half) + var(--cb-hint-gap)))`;
          el.appendChild(hint);
          this.hints.push({ cubie, normal: sticker.normal, el: hint });
        }
        el.appendChild(face);
      }

      this.elements.set(cubie.id, el);
      fragment.appendChild(el);
    }

    this.container.appendChild(fragment);
    this.render();
  }

  /**
   * Legt fest, welche Hint-Tafeln in Frage kommen: genau die, deren Sticker
   * aktuell in eine der drei verdeckten Richtungen zeigt. Ob sie dann auch
   * gezeigt werden, entscheidet der Modus im CSS.
   *
   * Läuft nur im Ruhezustand – während einer Drehung schwenken die Tafeln mit
   * ihrer Schicht mit, die Auswahl wird erst am Zugende neu bestimmt.
   */
  #updateHints() {
    for (const hint of this.hints) {
      const normal = apply(hint.cubie.rot, hint.normal);
      const hidden = HIDDEN_DIRECTIONS.some((d) => d.every((v, i) => v === normal[i]));
      if (hidden) hint.el.dataset.show = '';
      else delete hint.el.dataset.show;
    }
  }

  /**
   * Zeichnet den aktuellen Zustand.
   * @param {{ids:Set<number>, axis:'x'|'y'|'z', angle:number}|null} anim
   *        Optionale laufende Schichtdrehung (Winkel in Modell-Grad).
   */
  render(anim = null) {
    const prefix = anim
      ? `rotate${anim.axis.toUpperCase()}(${cssAngle(anim.axis, anim.angle).toFixed(3)}deg) `
      : '';

    for (const cubie of this.state.cubies) {
      const el = this.elements.get(cubie.id);
      const [px, py, pz] = cssPosition(cubie.pos, SPACING);
      const base = `translate3d(${px}px,${py}px,${pz}px) ${cssMatrix3d(cubie.rot)}`;
      el.style.transform = (anim && anim.ids.has(cubie.id) ? prefix : '') + base;
    }

    if (!anim) this.#updateHints();
  }
}
