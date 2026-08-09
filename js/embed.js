/**
 * embed.js – Einbettbare Variante des Würfels für mil4n.de.
 *
 * Stellt `window.CubeApp = { mount(el), unmount() }` bereit. Die DC-Komponente
 * in index.html ruft `mount()` auf, sobald die Cube-Ansicht sichtbar ist, und
 * `unmount()` beim Verlassen.
 *
 * Warum imperativ statt über das Template? Eine Drehung aktualisiert 27
 * Elemente pro Frame – das über setState laufen zu lassen wäre unnötig teuer.
 * Das Mount-Element bleibt im Template kinderlos, React fasst den Inhalt
 * deshalb nie an; wir bauen ihn hier einmalig auf.
 *
 * Phasen:
 *   idle        – frei spielbar, kein Versuch aktiv
 *   scrambling  – Scramble läuft (Eingaben werden ignoriert)
 *   ready       – gemischt, wartet auf den ersten Zug
 *   solving     – Timer läuft
 *   solved      – Würfel gelöst, Zeit steht
 */

import {
  TURN_DURATION, SCRAMBLE_DURATION, SCRAMBLE_LENGTH,
  ROTATIONS, DEFAULT_SETTINGS,
} from './config.js';
import { CubeState } from './cubeState.js';
import { CubeRenderer } from './cubeRenderer.js';
import { Animator } from './animator.js';
import { generateScramble } from './scramble.js';
import { Timer, formatTime, averageOf } from './timer.js';
import { bindKeyboard } from './controls.js';
import { keyTableRows, keysForMove } from './keys.js';
import { nextStep } from './solver/coach.js';
import { readCube, locate } from './solver/pieces.js';

const IDLE_HINT = 'space = scramble · esc = abort · backspace = reset';
const SETTINGS_KEY = 'mil4nde:cube:v2:settings';

/**
 * Das Bild der letzten Ebene, wie auf einem Algorithmenblatt: die Deckfläche
 * als 3×3, ringsum zwölf schmale Streifen für die Seitenaufkleber.
 *
 * Fünf mal fünf Zellen in Leserichtung, die vier Ecken bleiben leer – dadurch
 * setzt das Grid alles von selbst an die richtige Stelle und die Reihenfolge
 * aus `lastLayer.js` bleibt eins zu eins erhalten. Ob eine Zelle Farbe zeigt,
 * entscheidet dort schon der Solver: OLL färbt nur, was oben liegt, PLL zeigt
 * die echten Seitenfarben.
 */
function diagramMarkup(diagram) {
  if (!diagram) return '';
  const { top, north, east, south, west } = diagram;

  const cell = (color, kind) =>
    `<i data-kind="${kind}"${color ? ` data-face="${color}"` : ''}></i>`;
  const corner = '<span></span>';
  const side = (color) => cell(color, 'side');
  const face = (color) => cell(color, 'top');

  const rows = [
    [corner, ...north.map(side), corner],
    [side(west[0]), ...top.slice(0, 3).map(face), side(east[0])],
    [side(west[1]), ...top.slice(3, 6).map(face), side(east[1])],
    [side(west[2]), ...top.slice(6, 9).map(face), side(east[2])],
    [corner, ...south.map(side), corner],
  ];

  return `<div class="cb-ll">${rows.flat().join('')}</div>`;
}

/**
 * Wie weit bringt ein fertig animierter Zug den erwarteten Planzug voran?
 *
 * Doppelzüge haben bewusst KEINE eigene Taste – sie werden zweimal getippt
 * (siehe keys.js). Vom Animator kommen deshalb zwei Vierteldrehungen an, wo im
 * Plan ein einzelnes "R2" steht. Ohne diesen Zwischenschritt gälte schon der
 * erste Anschlag als Vertipper und verwürfe den ganzen Algorithmus.
 *
 * Beide Anschläge müssen dieselbe Richtung haben: nach "R" und dann "R'" steht
 * der Würfel wieder wie vorher – dort ist ein neuer Plan die richtige Antwort,
 * kein halb abgehakter Doppelzug.
 *
 * @param {string} expected Zug aus dem Plan, z. B. "R2"
 * @param {string} token    Gerade ausgeführte Drehung, immer eine Vierteldrehung
 * @param {string|null} half Erster Anschlag, falls schon einer erfolgt ist
 * @returns {'done'|'half'|'no'}
 */
function consumeMove(expected, token, half) {
  if (expected === token) return 'done';
  if (!expected.endsWith('2')) return 'no';
  if (token !== expected[0] && token !== `${expected[0]}'`) return 'no';
  if (half === null) return 'half';
  return half === token ? 'done' : 'no';
}

/** Beschriftung der Steinvorschau im Trainer. */
const PIECE_ROLE = { corner: 'corner', edge: 'edge' };
const PIECE_WHERE = {
  placed: 'placed',
  twisted: 'in slot, twisted',
  top: 'top',
  trapped: 'in wrong slot',
};

/** Einstellungen überleben auch einen Reload. */
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.coach === 'an') parsed.coach = 'on';
      if (parsed.coach === 'aus') parsed.coach = 'off';
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (e) { /* localStorage kann blockiert sein – dann eben Defaults */ }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) { /* ignorieren */ }
}

/** Bleibt über Ansichtswechsel hinweg erhalten. */
const session = { results: [], settings: loadSettings() };

/**
 * Aufbau des Einstellungs-Panels. `key` landet als data-Attribut am .cb-app
 * und steuert von dort aus rein über CSS das Aussehen.
 */
const SETTING_GROUPS = [
  {
    key: 'scheme',
    label: 'colors',
    options: [
      { value: 'classic', label: 'classic' },
      { value: 'minimal', label: 'minimal' },
    ],
  },
  {
    key: 'view',
    label: 'cube',
    options: [
      { value: 'solid', label: 'solid' },
      { value: 'ghost', label: 'ghost' },
      { value: 'hints', label: 'hints' },
    ],
  },
  {
    key: 'camera',
    label: 'angle',
    options: [
      { value: 'angled', label: 'angled' },
      { value: 'front',  label: 'front' },
    ],
  },
  {
    key: 'coach',
    label: 'coach',
    options: [
      { value: 'on',  label: 'on' },
      { value: 'off', label: 'off' },
    ],
  },
  {
    key: 'layout',
    label: 'keyboard',
    options: [
      { value: 'qwerty', label: 'qwerty' },
      { value: 'qwertz', label: 'qwertz' },
    ],
  },
];

class CubeApp {
  constructor() {
    this.mounted = null; // aktuelles Mount-Element
  }

  /** @param {HTMLElement} host */
  mount(host) {
    if (!host || this.mounted === host) return;
    this.unmount();
    this.mounted = host;

    this.#buildMarkup(host);

    this.state    = new CubeState();
    this.renderer = new CubeRenderer(this.el.cube, this.state);
    this.animator = new Animator(this.state, this.renderer);
    this.timer    = new Timer();
    this.phase    = 'idle';

    this.unbind = bindKeyboard({
      layout:     () => session.settings.layout,
      onMove:     (t) => this.handleMove(t),
      onScramble: () => this.startScramble(),
      onAbort:    () => this.abort(),
      onReset:    () => this.resetCube(),
    });

    // Vorhandener Haken im Animator: feuert nach jedem fertig animierten Zug.
    this.animator.onMoveDone = (token) => this.#advancePlan(token);

    this.#paintTimer();
    this.#renderResults();
    this.#recomputeCoach();
  }

  unmount() {
    if (!this.mounted) return;
    if (this.unbind) this.unbind();
    if (this.animator) this.animator.clear();
    if (this.timer) this.timer.reset();
    this.mounted.textContent = '';
    this.mounted = null;
  }

  /* ── Aufbau ───────────────────────────────────────────────────────── */

  #buildMarkup(host) {
    host.innerHTML = `
      <div class="cb-app" data-state="idle">
        <div class="cb-layout">
          <aside class="cb-coach" hidden>
            <div class="cb-coach-stage"></div>
            <div class="cb-coach-diagram"></div>
            <div class="cb-coach-pieces"></div>
            <ol class="cb-coach-moves"></ol>
            <div class="cb-coach-note"></div>
          </aside>
          <div class="cb-main">
            <div class="cb-scramble">press space to scramble</div>
            <div class="cb-stage"><div class="cb-scene"><div class="cb-cube"></div></div></div>
            <div class="cb-hint">${IDLE_HINT}</div>
          </div>
          <div class="cb-time">0.00</div>
          <div class="cb-extras">
            <div class="cb-stats">
              <span>best <b class="cb-best">–</b></span>
              <span>ao5 <b class="cb-ao5">–</b></span>
              <span>solves <b class="cb-count">0</b></span>
            </div>
            <ol class="cb-times"></ol>
            <details class="cb-fold cb-keys">
              <summary>keys</summary>
              <table></table>
            </details>
            <details class="cb-fold cb-settings" open>
              <summary>settings</summary>
              ${SETTING_GROUPS.map((group) => `
                <div class="cb-row">
                  <span>${group.label}</span>
                  <div class="cb-opts" data-key="${group.key}">
                    ${group.options.map((o) =>
                      `<button type="button" data-value="${o.value}">${o.label}</button>`).join('')}
                  </div>
                </div>`).join('')}
              <div class="cb-note">
                ghost = all sides visible · hints = hidden sides as panels ·
                front = straight on, as if held in your hand ·
                qwertz = same finger positions, german labels
              </div>
            </details>
          </div>
        </div>
      </div>`;

    const q = (sel) => host.querySelector(sel);
    this.el = {
      app:      q('.cb-app'),
      cube:     q('.cb-cube'),
      scramble: q('.cb-scramble'),
      time:     q('.cb-time'),
      hint:     q('.cb-hint'),
      times:    q('.cb-times'),
      best:     q('.cb-best'),
      ao5:      q('.cb-ao5'),
      count:    q('.cb-count'),
      coach:        q('.cb-coach'),
      coachStage:   q('.cb-coach-stage'),
      coachDiagram: q('.cb-coach-diagram'),
      coachPieces:  q('.cb-coach-pieces'),
      coachMoves:  q('.cb-coach-moves'),
      coachNote:   q('.cb-coach-note'),
      keys:     q('.cb-keys table'),
    };

    // Nach einem Klick den Fokus abgeben, sonst schlucken <summary> und
    // <button> die Leertaste, statt ein neues Scramble auszulösen.
    host.querySelectorAll('.cb-fold summary, .cb-opts button').forEach((el) => {
      el.addEventListener('click', () => setTimeout(() => el.blur(), 0));
    });

    // Ein Delegat für alle Optionsgruppen.
    host.querySelectorAll('.cb-opts').forEach((group) => {
      group.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-value]');
        if (!button) return;
        const key = group.dataset.key;
        session.settings[key] = button.dataset.value;

        /*
         * Das Kreuz entsteht auf der Unterseite, und die ist bei fester Kamera
         * verdeckt. Wer den Coach einschaltet, sähe im "solid"-Modus also
         * ausgerechnet den Teil nicht, um den es gerade geht – deshalb einmalig
         * auf "hints" umschalten. Danach bleibt die Wahl beim Nutzer.
         */
        if (key === 'coach' && button.dataset.value === 'on'
            && session.settings.view === 'solid') {
          session.settings.view = 'hints';
        }

        saveSettings(session.settings);
        this.#applySettings();
        this.#recomputeCoach();
      });
    });

    this.#applySettings();
  }

  /**
   * Überträgt die Einstellungen an das DOM: die Werte landen als data-Attribute
   * am .cb-app, das Aussehen entsteht daraus komplett im Stylesheet.
   */
  #applySettings() {
    for (const group of SETTING_GROUPS) {
      const value = session.settings[group.key];
      this.el.app.dataset[group.key] = value;
      this.mounted.querySelectorAll(`.cb-opts[data-key="${group.key}"] button`)
        .forEach((button) => {
          button.setAttribute('aria-pressed', String(button.dataset.value === value));
        });
    }
    this.#renderKeys();
  }

  /**
   * Die keys-Tabelle. Bewusst aus der Belegung abgeleitet statt hier noch
   * einmal getippt – sonst driftet die Anzeige von der echten Belegung weg.
   * Wird bei jedem Layoutwechsel neu gezeichnet.
   */
  #renderKeys() {
    this.el.keys.innerHTML = keyTableRows(session.settings.layout)
      .map(([move, key]) => `<tr><td>${move}</td><th>${key}</th></tr>`)
      .join('');
  }

  /* ── Anzeige ──────────────────────────────────────────────────────── */

  #setPhase(next, hint) {
    this.phase = next;
    this.el.app.dataset.state = next;
    if (hint !== undefined) this.el.hint.textContent = hint;
  }

  #paintTimer() {
    this.el.time.textContent = formatTime(this.timer.elapsed);
  }

  /** Aktualisiert die Anzeige jeden Frame, solange der Timer läuft. */
  #timerLoop = () => {
    if (!this.mounted || !this.timer.running) return;
    this.#paintTimer();
    requestAnimationFrame(this.#timerLoop);
  };

  #renderResults() {
    const { results } = session;
    this.el.count.textContent = results.length;
    this.el.best.textContent = results.length ? formatTime(Math.min(...results)) : '–';
    const ao5 = averageOf(results, 5);
    this.el.ao5.textContent = ao5 === null ? '–' : formatTime(ao5);

    this.el.times.innerHTML = results.slice(-5).reverse()
      .map((ms, i) => `<li><span>${results.length - i}</span><b>${formatTime(ms)}</b></li>`)
      .join('');
  }

  /* ── Coach ────────────────────────────────────────────────────────── */

  /**
   * Rechnet den nächsten Schritt neu aus.
   *
   * Der Coach selbst ist zustandslos; hier wird nur der Zeiger auf den gerade
   * abzuarbeitenden Zug gehalten, damit die Anzeige nicht bei jedem Tastendruck
   * neu aufblitzt (siehe #advancePlan).
   */
  #recomputeCoach() {
    if (session.settings.coach !== 'on' || this.phase === 'scrambling') {
      this.plan = null;
      this.#renderCoach();
      return;
    }
    this.plan = { step: nextStep(this.state), index: 0, half: null };
    this.#renderCoach();
  }

  /**
   * Läuft nach jedem fertig animierten Zug.
   *
   * Passt der Zug zum Plan, wandert nur der Zeiger weiter – der angezeigte
   * Algorithmus bleibt stehen und man sieht, wo man ist. Bei einem Vertipper
   * (oder am Ende des Algorithmus) wird komplett neu geplant; dadurch heilen
   * sich Fehler von selbst, ohne dass es einen Fehlerzustand gäbe.
   */
  #advancePlan(token) {
    if (session.settings.coach !== 'on' || this.phase === 'scrambling') return;

    const plan = this.plan;
    const expected = plan ? plan.step.moves[plan.index] : null;

    switch (expected ? consumeMove(expected, token, plan.half) : 'no') {
      case 'half':
        plan.half = token;
        this.#renderCoach();
        return;

      case 'done':
        plan.half = null;
        plan.index++;
        if (plan.index < plan.step.moves.length) {
          this.#renderCoach();
          return;
        }
        break;

      default:
        break;
    }
    this.#recomputeCoach();
  }

  #renderCoach() {
    const { coach, coachStage, coachDiagram, coachPieces, coachMoves, coachNote } = this.el;

    if (!this.plan) {
      coach.hidden = true;
      return;
    }
    coach.hidden = false;

    const { step, index, half } = this.plan;
    coach.dataset.stage = step.stage;
    coach.toggleAttribute('data-pending', step.pending);

    coachStage.innerHTML = `<b>${step.label}</b>`
      + (step.caseName ? `<span>${step.caseName}</span>` : '');
    coachDiagram.innerHTML = diagramMarkup(step.diagram);
    coachPieces.innerHTML = this.#piecesMarkup(step.pieces);

    coachMoves.innerHTML = step.moves.map((move, i) => {
      const keys = keysForMove(move, session.settings.layout);
      const state = i < index ? ' data-done' : i === index ? ' data-next' : '';

      /*
       * Beim halb getippten Doppelzug den erledigten Anschlag abhaken. Sonst
       * passiert nach dem ersten von zwei gleichen Tastendrücken sichtbar
       * nichts und man weiss nicht, ob er angekommen ist.
       */
      const typed = i === index && half ? 1 : 0;
      const marks = keys
        ? keys.map((key, n) => `<em${n < typed ? ' data-done' : ''}>${key}</em>`).join(' ')
        : '–';

      return `<li${state}><b>${move}</b><span>${marks}</span></li>`;
    }).join('');

    coachNote.textContent = step.note;
  }

  /**
   * Die Steine des aktuellen Schritts als aufgeklappte Aufkleber.
   *
   * Der Fundort wird bei JEDEM Rendern frisch aus dem Würfel gelesen, nicht aus
   * dem Schritt übernommen: während ein Algorithmus abgearbeitet wird, wandern
   * die beiden Steine ja gerade an ihren Platz, und genau das soll man hier
   * mitverfolgen können.
   */
  #piecesMarkup(pieces) {
    if (!pieces.length) return '';
    const snapshot = readCube(this.state);

    return pieces.map((piece) => {
      const where = locate(snapshot, piece.colors) ?? 'top';
      const caps = piece.colors.map((face) => `<i data-face="${face}"></i>`).join('');
      return `
        <figure data-role="${piece.role}" data-where="${where}">
          <div class="cb-piece">${caps}</div>
          <figcaption>${PIECE_ROLE[piece.role]}<span>${PIECE_WHERE[where]}</span></figcaption>
        </figure>`;
    }).join('');
  }

  /* ── Aktionen ─────────────────────────────────────────────────────── */

  /** Leertaste: Würfel zurücksetzen und neu mischen. */
  startScramble() {
    this.animator.clear();
    this.timer.reset();
    this.#paintTimer();

    // Vom gelösten Zustand aus mischen – garantiert einen gültigen Startpunkt.
    this.state.reset();
    this.renderer.render();

    const sequence = generateScramble(SCRAMBLE_LENGTH);
    this.el.scramble.textContent = sequence.join(' ');

    this.#setPhase('scrambling', 'scrambling …');
    this.#recomputeCoach();          // blendet das Panel während des Mischens aus
    this.animator.enqueue(sequence, {
      duration: SCRAMBLE_DURATION,
      onDone: () => {
        this.#setPhase('ready', 'ready – your first turn starts the clock');
        this.#recomputeCoach();
      },
    });
  }

  /** Esc: laufenden Versuch verwerfen. */
  abort() {
    if (this.phase === 'scrambling') return;
    const wasSolving = this.phase === 'solving';
    this.timer.reset();
    this.#paintTimer();
    this.#setPhase('idle', wasSolving ? 'attempt aborted' : IDLE_HINT);
  }

  /** Backspace: Würfel in den gelösten Zustand zurückversetzen. */
  resetCube() {
    this.animator.clear();
    this.timer.reset();
    this.#paintTimer();
    this.state.reset();
    this.renderer.render();
    this.el.scramble.textContent = 'press space to scramble';
    this.#setPhase('idle', IDLE_HINT);
    this.#recomputeCoach();
  }

  /** Ein Zug über die Tastatur. */
  handleMove(token) {
    if (this.phase === 'scrambling') return; // während des Mischens keine Eingabe

    // Ganzwürfel-Drehungen (x/y/z) starten die Zeit nicht – nur echte Züge.
    // Slice- und Wide-Moves verändern den Würfel und zählen deshalb mit.
    const isFaceTurn = !ROTATIONS.includes(token[0]);

    if (this.phase === 'ready' && isFaceTurn) {
      this.#setPhase('solving', 'solving …');
      this.timer.start();
      this.#timerLoop();
    }

    this.animator.enqueue(token, {
      duration: TURN_DURATION,
      onDone: () => this.#checkSolved(),
    });
  }

  /** Läuft nach jedem beendeten Zug – prüft die Abbruchbedingung des Timers. */
  #checkSolved() {
    if (this.phase !== 'solving') return;
    if (!this.state.isSolved()) return;

    const ms = this.timer.stop();
    this.#paintTimer();
    session.results.push(ms);
    this.#renderResults();
    this.#setPhase('solved', `solved in ${formatTime(ms)} · space for the next one`);
  }
}

window.CubeApp = new CubeApp();
// Modul-Scripts laufen nach dem ersten Render – die Seite kann so nachziehen,
// falls die Cube-Ansicht schon offen ist.
window.dispatchEvent(new Event('cubeapp:ready'));
