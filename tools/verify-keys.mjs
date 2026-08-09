/**
 * verify-keys.mjs – Prüft die Tastatursteuerung ohne Browser.
 *
 * WARUM OHNE BROWSER
 * ------------------
 * Der Fehler, der diese Datei ausgelöst hat, war nicht zu sehen, sondern zu
 * SPÜREN: Hielt man im Timer-Modus die Leertaste, sprang die Seite ans Ende.
 * Ursache war eine Zeile Reihenfolge – `if (event.repeat) return;` stand vor
 * der Leertaste, die Wiederholungen liefen also ungebremst an den Browser
 * durch, und dort ist die Leertaste die Bild-ab-Taste.
 *
 * Genau das lässt sich hier festnageln: `bindKeyboard` braucht nur ein
 * `window` mit drei Listenern und Ereignisse mit `key`, `repeat` und
 * `preventDefault`. Beides ist in zwanzig Zeilen gebaut – und die Prüfung
 * läuft in Millisekunden statt in einem Browser.
 *
 *   node tools/verify-keys.mjs
 */

import { bindKeyboard } from '../js/controls.js';

let failures = 0;
const fail = (message) => { console.log(`FAIL  ${message}`); failures++; };
const pass = (message) => console.log(`PASS  ${message}`);
const is = (actual, expected, what) => {
  if (actual !== expected) fail(`${what}: ${JSON.stringify(actual)} statt ${JSON.stringify(expected)}`);
};

/* ── Minimaler Ersatz für Fenster und Ereignis ─────────────────────────── */

const listeners = {};
globalThis.window = {
  addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
  removeEventListener: (type, fn) => {
    listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
  },
};
// `isTypingTarget` fragt `target instanceof HTMLElement` – ohne die Klasse
// wirft schon der Vergleich.
globalThis.HTMLElement = class {};

/** Schickt ein Ereignis und sagt, ob es abgefangen wurde. */
function send(type, key, { repeat = false, target = null } = {}) {
  const event = {
    key, repeat, target,
    metaKey: false, ctrlKey: false, altKey: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };
  for (const fn of listeners[type] ?? []) fn(event);
  return event.defaultPrevented;
}

/* ── Aufzeichnung dessen, was die Steuerung auslöst ────────────────────── */

const log = [];
let mode = 'timer';
let running = false;

const unbind = bindKeyboard({
  mode: () => mode,
  layout: () => 'qwerty',
  isRunning: () => running,
  onMove: (t) => log.push(`move:${t}`),
  onScramble: () => log.push('scramble'),
  onAbort: () => log.push('abort'),
  onReset: () => log.push('reset'),
  onHold: () => log.push('hold'),
  onRelease: () => log.push('release'),
  onStop: () => log.push('stop'),
});

const drain = () => log.splice(0, log.length).join(',');

/* ── 1. Die Leertaste darf die Seite NIE scrollen ──────────────────────── */

for (const testMode of ['timer', 'virtual']) {
  mode = testMode;
  running = false;

  if (!send('keydown', ' ')) fail(`${testMode}: erster Anschlag der Leertaste nicht abgefangen`);

  // Das Halten: der Browser feuert dieselbe Taste immer weiter.
  const repeats = [];
  for (let i = 0; i < 5; i++) repeats.push(send('keydown', ' ', { repeat: true }));
  if (!repeats.every(Boolean)) {
    fail(`${testMode}: Wiederholungen der Leertaste laufen durch – die Seite scrollt`);
  }

  send('keyup', ' ');
  drain();
}

// Auch bei laufender Uhr: dort hält die Leertaste an, scrollen darf sie nicht.
mode = 'timer';
running = true;
if (!send('keydown', ' ')) fail('laufende Uhr: Leertaste nicht abgefangen');
if (!send('keydown', ' ', { repeat: true })) fail('laufende Uhr: Wiederholung nicht abgefangen');
running = false;
drain();

if (!failures) pass('die Leertaste wird in jedem Zustand abgefangen');

/* ── 2. Halten und Loslassen ───────────────────────────────────────────── */

mode = 'timer';
send('keydown', ' ');
is(drain(), 'hold', 'Leertaste unten meldet');

// Das Halten darf NICHT erneut auslösen – sonst stünde die Uhr immer wieder
// auf null, solange der Finger liegt.
for (let i = 0; i < 3; i++) send('keydown', ' ', { repeat: true });
is(drain(), '', 'Wiederholungen lösen nichts aus');

send('keyup', ' ');
is(drain(), 'release', 'Loslassen startet');

// Ohne vorheriges Halten darf ein keyup nichts starten – etwa wenn die Taste
// über der abbrechenden Escape losgelassen wird.
send('keyup', ' ');
is(drain(), '', 'Loslassen ohne Halten startet nichts');

/* ── 3. Abbrechen ──────────────────────────────────────────────────────── */

running = true;
send('keydown', 'Escape');
is(drain(), 'abort', 'Escape bricht die laufende Uhr ab');

running = true;
send('keydown', 'j');
is(drain(), 'stop', 'irgendeine Taste hält die laufende Uhr an');
running = false;

send('keydown', 'Escape');
is(drain(), 'abort', 'Escape bricht auch im Ruhezustand ab');

/* ── 4. Züge nur im Virtual-Modus ──────────────────────────────────────── */

// Bei stehender Uhr passiert im Timer-Modus gar nichts: der Würfel liegt in
// der Hand, die Tastatur hat dort nichts zu drehen und nichts anzuhalten.
mode = 'timer';
send('keydown', 'j');
is(drain(), '', 'im Timer-Modus dreht keine Taste den Würfel');

mode = 'virtual';
send('keydown', 'j');
is(drain(), 'move:U', 'j dreht U');
send('keydown', 'k');
is(drain(), "move:R'", "k dreht R'");
send('keydown', 'Backspace');
is(drain(), 'reset', 'Backspace setzt zurück');

/* ── 5. Eingabefelder und Bedienelemente bleiben unangetastet ──────────── */

class FakeButton extends globalThis.HTMLElement {
  constructor() { super(); this.tagName = 'BUTTON'; }
}
send('keydown', ' ', { target: new FakeButton() });
is(drain(), '', 'auf einem fokussierten Knopf greift die Steuerung nicht');

/* ── 6. Fokusverlust bricht ab, statt zu starten ───────────────────────── */

mode = 'timer';
send('keydown', ' ');
drain();
send('blur');
is(drain(), 'abort', 'Fokusverlust beim Halten bricht ab');
send('keyup', ' ');
is(drain(), '', 'das späte keyup startet danach nichts mehr');

unbind();
send('keydown', 'j');
is(drain(), '', 'nach dem Abmelden hört niemand mehr zu');

if (!failures) pass('Halten, Abbrechen, Züge und Fokusverlust stimmen');

console.log(failures === 0 ? '\nalles grün' : `\n${failures} FEHLER`);
process.exit(failures === 0 ? 0 : 1);
