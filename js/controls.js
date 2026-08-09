/**
 * controls.js – Übersetzt Tastendrücke in Aktionen.
 *
 * Es wird `event.key` ausgewertet (nicht `event.code`), damit die Belegung dem
 * folgt, was tatsächlich auf den Tasten steht. Welches Layout gilt, entscheidet
 * die Einstellung – deshalb wird sie bei jedem Anschlag frisch abgefragt und
 * nicht beim Anmelden eingefroren.
 *
 * Der Listener hängt am `window`, wird aber nur registriert, solange die
 * Cube-Ansicht eingeblendet ist (siehe embed.js). Eingaben in Formularfeldern
 * oder auf fokussierten Bedienelementen werden durchgelassen.
 *
 * ZWEI MODI, EINE BELEGUNG
 * ------------------------
 * Im Virtual-Modus dreht die Tastatur den Würfel, die Leertaste mischt.
 * Im Timer-Modus liegt der echte Würfel in der Hand: dann ist die Leertaste
 * die Stoppuhr (halten, loslassen, läuft) und JEDE Taste hält sie wieder an –
 * genau wie am csTimer. Welcher Modus gilt, wird bei jedem Anschlag frisch
 * abgefragt, damit ein Moduswechsel sofort greift.
 */

import { keymapFor } from './keys.js';

const IGNORED_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SUMMARY', 'A']);

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return IGNORED_TAGS.has(target.tagName) || target.isContentEditable;
}

/**
 * @param {{
 *   mode:()=>('virtual'|'timer'),
 *   layout:()=>string,
 *   onMove:(token:string)=>void,
 *   onScramble:()=>void,
 *   onAbort:()=>void,
 *   onReset:()=>void,
 *   onHold:()=>void,        Leertaste unten (Timer-Modus)
 *   onRelease:()=>void,     Leertaste losgelassen (Timer-Modus)
 *   onStop:()=>void,        irgendeine Taste, während die Uhr läuft
 *   isRunning:()=>boolean,
 * }} handlers
 * @returns {() => void} Funktion zum Abmelden der Listener
 */
export function bindKeyboard(handlers) {
  let holding = false;   // liegt die Leertaste gerade unten?

  const onKeyDown = (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;

    const timerMode = handlers.mode() === 'timer';

    /*
     * Anhalten hat Vorrang vor allem anderen und akzeptiert auch eine
     * gedrückt gehaltene Taste (`event.repeat`): wer beim Lösen die Hand auf
     * die Tastatur legt, will die Uhr anhalten, nicht ignoriert werden.
     */
    if (timerMode && handlers.isRunning()) {
      if (event.key === 'Escape') { event.preventDefault(); handlers.onAbort(); return; }
      event.preventDefault();
      handlers.onStop();
      return;
    }

    /*
     * Die Leertaste wird IMMER abgefangen, auch bei Wiederholungen. Sie ist im
     * Browser die Bild-ab-Taste: hält man sie zum Starten gedrückt, feuert sie
     * nach kurzer Zeit weiter, und jeder dieser Anschläge scrollt die Seite –
     * man stünde beim Loslassen am Seitenende. Deshalb steht das vor der
     * Abfrage auf `repeat` und nicht dahinter.
     */
    if (event.key === ' ') {
      event.preventDefault();
      if (event.repeat) return;

      if (timerMode) {
        if (!holding) {
          holding = true;
          handlers.onHold();
        }
      } else {
        handlers.onScramble();
      }
      return;
    }

    if (event.repeat) return;            // Dauerfeuer beim Gedrückthalten

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        handlers.onAbort();
        return;
      case 'Backspace':
        event.preventDefault();
        handlers.onReset();
        return;
      default:
        break;
    }

    if (timerMode) return;               // im Timer-Modus dreht nichts den Würfel

    const token = keymapFor(handlers.layout())[event.key.toLowerCase()];
    if (token) {
      event.preventDefault();
      handlers.onMove(token);
    }
  };

  const onKeyUp = (event) => {
    if (event.key !== ' ' || !holding) return;
    holding = false;
    if (handlers.mode() === 'timer') {
      event.preventDefault();
      handlers.onRelease();
    }
  };

  /*
   * Verlässt das Fenster den Fokus, während die Leertaste unten ist, kommt das
   * keyup nie an – die Uhr bliebe für immer im Haltezustand. Ein Fokuswechsel
   * ist aber kein Startsignal: der Versuch wird abgebrochen, nicht begonnen.
   */
  const onBlur = () => {
    if (!holding) return;
    holding = false;
    handlers.onAbort();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  };
}
