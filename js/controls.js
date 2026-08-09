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
 */

import { keymapFor } from './keys.js';

const IGNORED_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SUMMARY', 'A']);

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return IGNORED_TAGS.has(target.tagName) || target.isContentEditable;
}

/**
 * @param {{layout:()=>string,
 *          onMove:(token:string)=>void,
 *          onScramble:()=>void,
 *          onAbort:()=>void,
 *          onReset:()=>void}} handlers
 * @returns {() => void} Funktion zum Abmelden des Listeners
 */
export function bindKeyboard(handlers) {
  const onKeyDown = (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.repeat) return;            // Dauerfeuer beim Gedrückthalten
    if (isTypingTarget(event.target)) return;

    switch (event.key) {
      case ' ':
        event.preventDefault();          // sonst scrollt die Seite
        handlers.onScramble();
        return;
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

    const token = keymapFor(handlers.layout())[event.key.toLowerCase()];
    if (token) {
      event.preventDefault();
      handlers.onMove(token);
    }
  };

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
