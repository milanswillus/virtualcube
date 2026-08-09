/**
 * keys.js – Zugriff auf die Tastenbelegung: welche Taste erzeugt welchen Zug?
 *
 * Der Coach zeigt zu jedem Algorithmus die zu tippende Tastenfolge an. Damit
 * Anzeige und tatsächliche Belegung nicht auseinanderlaufen können, wird alles
 * aus denselben KEY_LAYOUTS abgeleitet – auch die Tabelle im "keys"-Panel.
 *
 * Jede Funktion nimmt das Layout ("qwerty" | "qwertz") als Argument entgegen.
 * Es gibt bewusst kein gemerktes "aktuelles" Layout: die einzige Wahrheit sind
 * die Einstellungen in embed.js, alles andere wäre eine zweite Quelle, die
 * davon abdriften kann.
 *
 * Doppelzüge (R2, M2) haben bewusst keine eigene Taste: sie werden zweimal
 * getippt. Das entspricht dem, was man am Timer ohnehin tut.
 */

import { KEY_LAYOUTS, MOVE_DEFS, DEFAULT_SETTINGS } from './config.js';

/** Unbekannte Namen fallen auf die Voreinstellung zurück statt zu werfen. */
function movesToKeys(layout) {
  return KEY_LAYOUTS[layout] ?? KEY_LAYOUTS[DEFAULT_SETTINGS.layout];
}

/** Alle Tasten für eine Vierteldrehung, z. B. "x" → ["t", "y"]. */
export function keysForQuarterTurn(token, layout) {
  return movesToKeys(layout)[token] ?? [];
}

/**
 * Umkehrung für die Tastaturabfrage: Taste → Zug.
 *
 * Gecacht, weil das bei jedem Anschlag gebraucht wird und die Layouts sich zur
 * Laufzeit nicht ändern.
 */
const keymapCache = new Map();
export function keymapFor(layout) {
  const name = KEY_LAYOUTS[layout] ? layout : DEFAULT_SETTINGS.layout;
  if (!keymapCache.has(name)) {
    const out = {};
    for (const [move, keys] of Object.entries(KEY_LAYOUTS[name])) {
      for (const key of keys) out[key] = move;
    }
    keymapCache.set(name, out);
  }
  return keymapCache.get(name);
}

/**
 * Zerlegt einen Zug in Notation in Seite und Wiederholungen.
 * "R2" → { face: 'R', repeat: 2, prime: false }
 */
function parse(token) {
  const face = token[0];
  const suffix = token.slice(1);
  return {
    face,
    repeat: suffix === '2' ? 2 : 1,
    prime: suffix === "'",
  };
}

/**
 * Tastenfolge für einen einzelnen Zug.
 *   "U'" → ['f']      "R2" → ['i','i']      "M2" → ['.','.']
 * Züge ohne Belegung liefern `null`, damit das Panel eine Lücke zeigt statt
 * eine falsche Taste.
 * @returns {string[]|null}
 */
export function keysForMove(token, layout) {
  const { face, repeat, prime } = parse(token);
  if (!MOVE_DEFS[face]) return null;

  const key = keysForQuarterTurn(prime ? `${face}'` : face, layout)[0];
  if (!key) return null;

  return Array(repeat).fill(key);
}

/**
 * Tastenfolge für eine ganze Zugfolge, Zug für Zug.
 * @param {string[]} tokens
 * @returns {Array<{move:string, keys:string[]|null}>}
 */
export function keysForSequence(tokens, layout) {
  return tokens.map((move) => ({ move, keys: keysForMove(move, layout) }));
}

/**
 * Anzeigereihenfolge der Tastentabelle: nach Gruppen, innerhalb einer Gruppe
 * immer Zug und Gegenzug nebeneinander.
 */
const TABLE_ORDER = [
  ['U', "U'"], ['R', "R'"], ['L', "L'"], ['F', "F'"],
  ['D', "D'"], ['B', "B'"],
  ['M', "M'"], ['S', "S'"],
  ['r', "r'"], ['l', "l'"], ['u', "u'"], ['d', "d'"], ['f', "f'"],
  ['y', "y'"], ['x', "x'"], ['z', "z'"],
];

/**
 * Zeilen für das "keys"-Panel, direkt aus der Belegung erzeugt.
 * @returns {Array<[string, string]>} [Zug, Taste(n)]
 */
export function keyTableRows(layout) {
  const rows = [];
  for (const group of TABLE_ORDER) {
    for (const move of group) {
      const keys = keysForQuarterTurn(move, layout);
      if (keys.length) rows.push([move, keys.join(' / ')]);
    }
  }
  return rows;
}
