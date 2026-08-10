/**
 * embed.js – cherrychrono, die einbettbare Würfel-Uhr für mil4n.de.
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
 * ZWEI MODI
 * ---------
 *   virtual – der Würfel auf dem Bildschirm wird über die Tastatur gedreht.
 *             Nur hier lässt sich mitmessen, WOMIT die Zeit vergeht: nach jedem
 *             Zug wird geprüft, wie weit der Würfel ist, und daraus entstehen
 *             die Zwischenzeiten für cross · f2l · oll · pll.
 *   timer   – reine Stoppuhr wie am csTimer: der echte Würfel liegt in der
 *             Hand, der Bildschirm zeigt Scramble und Zeit. Der Würfel steht
 *             hier als Vorschau des Scrambles, nicht als Spielzeug.
 *
 * Phasen (data-state am .cb-app):
 *   idle        – nichts läuft
 *   scrambling  – Scramble wird animiert (Eingaben werden ignoriert)
 *   ready       – gemischt, wartet auf den ersten Zug bzw. auf die Leertaste
 *   holding     – Leertaste unten, Loslassen startet (Timer-Modus)
 *   solving     – Uhr läuft
 *   solved      – Zeit steht
 */

import {
  TURN_DURATION, SCRAMBLE_DURATION, SCRAMBLE_LENGTH,
  ROTATIONS, DEFAULT_SETTINGS, FALLBACK_LAYOUT,
} from './config.js';
import { CubeState } from './cubeState.js';
import { CubeRenderer } from './cubeRenderer.js';
import { Animator } from './animator.js';
import { generateScramble } from './scramble.js';
import { Timer, formatTime } from './timer.js';
import { bindKeyboard } from './controls.js';
import { keyTableRows, keysForMove, detectLayout } from './keys.js';
import { nextStep } from './solver/coach.js';
import { readCube, locate } from './solver/pieces.js';
import { currentPhase, PhaseTracker, PHASE_ORDER } from './phases.js';
import {
  loadSolves, saveSolves, summarize, phaseAverages, slowestPhase,
  byDay, byHour, effective, label as solveLabel, PHASES,
  records, subRate, subTarget, streaks, speed, ago, average, mean,
} from './stats.js';
import {
  renderTimes, renderPhases, renderPhaseBar, renderDistribution, renderDays,
  renderHeatmap, renderHours, renderSpark, hideTip, setTipTheme,
} from './charts.js';

/*
 * Bewusst ein NEUER Schlüssel und keine Übernahme der alten Einstellungen: mit
 * dem Namen haben sich auch die Voreinstellungen geändert (front · minimal ·
 * ghost). Übernähme man die alten Werte, bekäme sie ausgerechnet der nie zu
 * sehen, der die Seite schon benutzt hat. Die ZEITEN wandern dagegen mit,
 * siehe stats.js.
 */
const SETTINGS_KEY = 'cherrychrono:v1:settings';

/** Die eine Zeile, die sagt, was gerade zu tun ist. Wechselt mit dem Zustand. */
const HINTS = {
  virtual: 'turn the cube to start the clock',
  timer:   'hold space, let go to start',
};

/** Dieselben Sätze für ein Gerät ohne Tastatur. */
const TOUCH_HINTS = {
  virtual: 'the virtual cube needs a keyboard – switch to timer',
  timer:   'hold the card, let go to start',
};

const hintFor = (mode) => (isTouchOnly() ? TOUCH_HINTS : HINTS)[mode];

/**
 * Die feste Tastenliste in der Zeit-Karte. Sie steht dort, weil man sie genau
 * dann sucht, wenn man auf die Uhr schaut – und weil sonst niemand erfährt,
 * dass es esc überhaupt gibt.
 *
 * Auf Geräten ohne Tastatur steht dort, was man dort tatsächlich tun kann.
 * Eine Liste von Tasten, die es nicht gibt, ist keine Hilfe, sondern Ballast.
 */
const BINDS = {
  virtual: [
    ['space', 'scramble'],
    ['esc', 'abort'],
    ['⌫', 'reset cube'],
  ],
  timer: [
    ['space', 'hold to start'],
    ['esc', 'abort'],
    ['⌫', 'new scramble'],
  ],
  touch: [
    ['hold', 'start'],
    ['tap', 'stop'],
    ['new', 'next scramble'],
  ],
};

/**
 * Kein Zeigegerät, kein Hover – also ein Touchgerät ohne Tastatur.
 *
 * Wird bei jedem Aufruf frisch gemessen und nicht einmalig gemerkt: an ein
 * Tablet lässt sich mitten in der Sitzung eine Tastatur anstecken, und dann
 * soll der virtuelle Würfel sofort wieder eine echte Möglichkeit sein.
 */
const isTouchOnly = () =>
  window.matchMedia('(hover: none) and (pointer: coarse)').matches;

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

function getSavedTheme() {
  try {
    return localStorage.getItem('cherrychrono:v1:theme') || localStorage.getItem('milxn-theme') || 'dark';
  } catch (e) {
    return 'dark';
  }
}

/** Einstellungen überleben auch einen Reload. */
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.coach === 'an') parsed.coach = 'on';
      if (parsed.coach === 'aus') parsed.coach = 'off';
      const settings = { ...DEFAULT_SETTINGS, ...parsed };
      if (isTouchOnly()) settings.mode = 'timer';
      return settings;
    }
  } catch (e) { /* localStorage kann blockiert sein – dann eben Defaults */ }

  return { ...DEFAULT_SETTINGS, mode: isTouchOnly() ? 'timer' : DEFAULT_SETTINGS.mode };
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) { /* ignorieren */ }
}

/**
 * Bleibt über Ansichtswechsel hinweg erhalten.
 * `mark` trennt "diese Sitzung" von "alles": alles ab diesem Index wurde seit
 * dem Öffnen der Seite gelöst.
 */
const session = {
  settings: loadSettings(),
  solves: loadSolves(),
  mark: 0,
  detected: FALLBACK_LAYOUT,   // wird beim Mount überschrieben, siehe detectLayout()
};
session.mark = session.solves.length;

/**
 * Die Belegung, die gerade gilt.
 *
 * "auto" ist keine Tabelle, sondern eine Absicht – überall dort, wo wirklich
 * Tasten gebraucht werden, muss der erkannte Wert stehen. Deshalb geht jeder
 * Zugriff durch diese eine Funktion.
 */
const activeLayout = () => (session.settings.layout === 'auto'
  ? session.detected
  : session.settings.layout);

/**
 * Aufbau des Einstellungs-Panels. `key` landet als data-Attribut am .cb-app
 * und steuert von dort aus rein über CSS das Aussehen.
 *
 * `group` bündelt, was zusammengehört – die Einstellungen sind eingeklappt, und
 * beim Aufklappen soll man nicht neun Zeilen lesen müssen, um die eine zu
 * finden, die man sucht.
 */
const SETTING_GROUPS = [
  {
    group: 'look',
    key: 'scheme',
    label: 'colors',
    options: [
      { value: 'classic', label: 'classic' },
      { value: 'minimal', label: 'minimal' },
    ],
  },
  {
    group: 'look',
    key: 'view',
    label: 'cube',
    options: [
      { value: 'solid', label: 'solid' },
      { value: 'ghost', label: 'ghost' },
      { value: 'hints', label: 'hints' },
    ],
  },
  {
    group: 'look',
    key: 'camera',
    label: 'angle',
    options: [
      { value: 'angled', label: 'angled' },
      { value: 'front',  label: 'front' },
    ],
  },
  {
    group: 'solving',
    key: 'coach',
    label: 'coach',
    options: [
      { value: 'on',  label: 'on' },
      { value: 'off', label: 'off' },
    ],
  },
  {
    group: 'solving',
    key: 'layout',
    label: 'keyboard',
    options: [
      { value: 'auto',   label: 'auto' },
      { value: 'qwerty', label: 'qwerty' },
      { value: 'qwertz', label: 'qwertz' },
    ],
  },
];

/** Überschrift und Erklärung je Gruppe. */
const GROUP_META = {
  look: {
    title: 'appearance',
    note: 'ghost = all sides visible · hints = hidden sides as panels · '
        + 'front = straight on, as if held in your hand',
  },
  solving: {
    title: 'solving',
    note: 'coach walks you through cfop · '
        + 'auto reads the layout from your keyboard · '
        + 'qwertz = same finger positions, german labels',
  },
};

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

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
    this.phases   = new PhaseTracker();
    this.phase    = 'idle';
    this.scramble = [];
    this.moveCount = 0;

    this.unbind = bindKeyboard({
      mode:       () => session.settings.mode,
      layout:     activeLayout,
      onMove:     (t) => this.handleMove(t),
      onScramble: () => this.startScramble(),
      onAbort:    () => this.abort(),
      onReset:    () => this.resetCube(),
      onHold:     () => this.holdStart(),
      onRelease:  (held) => this.holdEnd(held),
      onStop:     () => this.stopTimer(),
      isRunning:  () => this.timer.running,
    });

    // Vorhandener Haken im Animator: feuert nach jedem fertig animierten Zug.
    this.animator.onMoveDone = (token) => this.#advancePlan(token);

    /*
     * Die Diagramme rechnen in Pixeln und müssen deshalb neu gezeichnet werden,
     * wenn sich die Breite ändert. Ein ResizeObserver am Mount-Element trifft
     * dabei mehr als ein Fenster-Listener: die Spalte kann auch schmaler
     * werden, ohne dass sich das Fenster ändert.
     */
    this.resizeObserver = new ResizeObserver(() => this.#scheduleCharts());
    this.resizeObserver.observe(host);

    /*
     * Die Schriften kommen nach. Mit ihnen ändern sich die Textbreiten und
     * damit die Spalten – ein Diagramm, das vorher gezeichnet wurde, passt
     * danach nicht mehr genau. Einmal nachzeichnen, sobald sie da sind.
     */
    if (document.fonts) document.fonts.ready.then(() => this.#scheduleCharts());

    /*
     * Steckt jemand eine Tastatur an das Tablet, ändert sich die Antwort auf
     * `(hover: none)` – dann müssen Hinweis und Tastenliste mitziehen. Ohne
     * diesen Listener stünde bis zum Neuladen "tap & hold" auf einem Gerät,
     * an dem längst die Leertaste die bessere Wahl ist.
     */
    this.pointerQuery = window.matchMedia('(hover: none) and (pointer: coarse)');
    this.onPointerChange = () => {
      if (!this.mounted) return;
      this.#applySettings();
      this.#setPhase(this.phase, hintFor(session.settings.mode));
    };
    this.pointerQuery.addEventListener('change', this.onPointerChange);

    /*
     * Die Belegung der echten Tastatur steht erst asynchron fest. Bis dahin
     * gilt QWERTY – das ist kein Zwischenzustand, der stört, denn ohne
     * Tastendruck sieht man den Unterschied ohnehin nicht.
     */
    detectLayout().then((layout) => {
      if (!this.mounted || session.detected === layout) return;
      session.detected = layout;
      this.#applySettings();
      this.#recomputeCoach();
    });

    this.#applyMode(true);
    this.#paintTimer();
    this.#render();
    this.#recomputeCoach();
  }

  unmount() {
    if (!this.mounted) return;
    if (this.unbind) this.unbind();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.pointerQuery) this.pointerQuery.removeEventListener('change', this.onPointerChange);
    if (this.animator) this.animator.clear();
    if (this.timer) this.timer.reset();
    hideTip();
    this.mounted.textContent = '';
    this.mounted = null;
  }

  /* ── Aufbau ───────────────────────────────────────────────────────── */

  #buildMarkup(host) {
    const optionGroup = (entry) => `
      <div class="cb-row">
        <span>${entry.label}</span>
        <div class="cb-opts" data-key="${entry.key}">
          ${entry.options.map((o) =>
            `<button type="button" data-value="${o.value}">${o.label}</button>`).join('')}
        </div>
      </div>`;

    const settingsBlock = Object.entries(GROUP_META).map(([name, meta]) => `
      <div class="cb-set-group">
        <div class="cb-set-title">${meta.title}</div>
        ${SETTING_GROUPS.filter((g) => g.group === name).map(optionGroup).join('')}
        <div class="cb-note">${meta.note}</div>
      </div>`).join('');

    host.innerHTML = `
      <div class="cb-app" data-state="idle">

        <header class="cb-top">
          <div class="cb-switch" data-key="mode" role="group" aria-label="solving mode">
            <button type="button" data-value="timer">timer</button>
            <button type="button" data-value="virtual">virtual</button>
          </div>
          <div class="cb-logo"><span>cherrychrono</span></div>
          <div class="cb-top-meta">
            <a href="#" class="cb-theme-toggle">theme: dark</a>
            <span class="cb-meta-dot">·</span>
            <a href="https://milxn.de" class="cb-me-link">me</a>
          </div>
        </header>

        <div class="cb-layout">

          <section class="cb-panel cb-timecard" style="--i:0">
            <div class="cb-panel-head">
              <div class="h">time</div>
              <div class="s cb-state-label">idle</div>
            </div>
            <div class="cb-time">0.00</div>
            <div class="cb-hint"></div>
            <div class="cb-phase-strip"></div>
            <div class="cb-binds"></div>
          </section>

          <aside class="cb-panel cb-coach" style="--i:2" hidden>
            <div class="cb-panel-head"><div class="h">coach</div><div class="s cb-coach-stage-label"></div></div>
            <div class="cb-coach-stage"></div>
            <div class="cb-coach-diagram"></div>
            <div class="cb-coach-pieces"></div>
            <ol class="cb-coach-moves"></ol>
            <div class="cb-coach-note"></div>
          </aside>

          <section class="cb-panel cb-main" style="--i:1">
            <div class="cb-panel-head">
              <div class="h">scramble</div>
              <button type="button" class="cb-mini cb-new">new</button>
            </div>
            <div class="cb-scramble">press space to scramble</div>
            <div class="cb-stage"><div class="cb-scene"><div class="cb-cube"></div></div></div>
          </section>

          <section class="cb-panel cb-side" style="--i:1">
            <div class="cb-panel-head">
              <div class="h">session</div>
              <div class="cb-switch cb-switch-sm" data-key="scope" role="group" aria-label="which solves to show">
                <button type="button" data-value="session">session</button>
                <button type="button" data-value="all">all</button>
              </div>
            </div>

            <div class="cb-hero">
              <div class="cb-hero-v cb-best">–</div>
              <div class="cb-hero-k">best</div>
            </div>

            <div class="cb-tiles">
              <div class="cb-tile"><div class="k">ao5</div><div class="v cb-ao5">–</div></div>
              <div class="cb-tile"><div class="k">ao12</div><div class="v cb-ao12">–</div></div>
              <div class="cb-tile"><div class="k">mean</div><div class="v cb-mean">–</div></div>
              <div class="cb-tile"><div class="k">solves</div><div class="v cb-count">0</div></div>
            </div>

            <svg class="cb-spark cb-chart-days" role="img" aria-label="best time per day, last 30 days"></svg>
            <div class="cb-spark-key"><span>30 days · best per day</span><span class="cb-trend"></span></div>

            <ol class="cb-times"></ol>
          </section>
        </div>

        <div class="cb-grid cb-cards">
          <section class="cb-panel cb-streak" style="--i:3">
            <div class="cb-panel-head">
              <div class="h">streak</div>
              <div class="s cb-streak-state"></div>
            </div>
            <div class="cb-big"><div class="v cb-streak-v">0</div><div class="u">days</div></div>
            <div class="cb-sub cb-streak-sub"></div>
            <div class="cb-stats cb-streak-stats"></div>
            <div class="cb-week"></div>
            <div class="cb-vital-foot cb-streak-foot"></div>
          </section>

          <section class="cb-panel cb-records" style="--i:4">
            <div class="cb-panel-head">
              <div class="h">records</div>
              <div class="s cb-records-since"></div>
            </div>
            <div class="cb-stats cb-records-stats"></div>
            <div class="cb-goal"></div>
            <div class="cb-vital-foot cb-records-foot"></div>
          </section>

          <section class="cb-panel cb-speed" style="--i:5">
            <div class="cb-panel-head">
              <div class="h">turn speed</div>
              <div class="s cb-speed-count"></div>
            </div>
            <div class="cb-speed-body"></div>
          </section>
        </div>

        <div class="cb-grid cb-charts">
          <section class="cb-panel" style="--i:6">
            <div class="cb-panel-head">
              <div class="h">times</div>
              <div class="cb-legend">
                <span><i class="dot" style="background:var(--cb-bar)"></i>solve</span>
                <span><i class="dash"></i>ao5</span>
              </div>
            </div>
            <div class="cb-scroll">
              <svg class="cb-chart-times" role="img" aria-label="Time per solve with rolling average of five"></svg>
            </div>
            <details class="cb-table-fold">
              <summary>table view</summary>
              <div class="cb-table-times"></div>
            </details>
          </section>

          <section class="cb-panel" style="--i:7">
            <div class="cb-panel-head">
              <div class="h">where the time goes</div>
              <div class="s cb-phase-note"></div>
            </div>
            <div class="cb-phase-bar"></div>
            <div class="cb-scroll">
              <svg class="cb-chart-phases" role="img" aria-label="Cross, F2L, OLL and PLL split per solve"></svg>
            </div>
          </section>

          <section class="cb-panel" style="--i:8">
            <div class="cb-panel-head">
              <div class="h">consistency</div>
              <div class="s cb-spread"></div>
            </div>
            <div class="cb-scroll">
              <svg class="cb-chart-dist" role="img" aria-label="Distribution of solve times"></svg>
            </div>
          </section>
        </div>

        <div class="cb-grid cb-lower">
          <section class="cb-panel cb-calendar" style="--i:9">
            <div class="cb-panel-head">
              <div class="h">practice calendar</div>
              <div class="cb-heat-key">
                <span>less</span><i data-level="0"></i><i data-level="1"></i>
                <i data-level="2"></i><i data-level="3"></i><i data-level="4"></i><span>more</span>
              </div>
            </div>
            <div class="cb-heat-wrap">
              <div class="cb-heat-days"><span>mon</span><span>wed</span><span>fri</span></div>
              <div class="cb-heat-body">
                <div class="cb-heat-months"></div>
                <div class="cb-heat"></div>
              </div>
            </div>
            <div class="cb-vital-foot cb-heat-foot"></div>
          </section>

          <section class="cb-panel" style="--i:10">
            <div class="cb-panel-head">
              <div class="h">when you practise</div>
              <div class="s cb-peak"></div>
            </div>
            <div class="cb-scroll">
              <svg class="cb-chart-hours" role="img" aria-label="Solves by hour of day"></svg>
            </div>
            <div class="cb-daypart"></div>
          </section>
        </div>

        <div class="cb-grid cb-folds">
          <details class="cb-fold cb-settings" style="--i:11">
            <summary><span>settings</span><i></i></summary>
            <div class="cb-fold-body">${settingsBlock}</div>
          </details>

          <details class="cb-fold cb-keys" style="--i:12">
            <summary><span>keys</span><i></i></summary>
            <div class="cb-fold-body">
              <div class="cb-note cb-keys-note"></div>
              <table></table>
            </div>
          </details>

          <details class="cb-fold cb-data" style="--i:13">
            <summary><span>data</span><i></i></summary>
            <div class="cb-fold-body">
              <div class="cb-note cb-data-note"></div>
              <div class="cb-data-actions">
                <button type="button" class="cb-mini cb-export">export csv</button>
                <button type="button" class="cb-mini cb-danger cb-clear">delete all solves</button>
              </div>
            </div>
          </details>
        </div>
      </div>`;

    const q = (sel) => host.querySelector(sel);
    this.el = {
      app:      q('.cb-app'),
      cube:     q('.cb-cube'),
      scramble: q('.cb-scramble'),
      time:     q('.cb-time'),
      hint:        q('.cb-hint'),
      themeToggle: q('.cb-theme-toggle'),
      strip:       q('.cb-phase-strip'),
      times:    q('.cb-times'),
      best:     q('.cb-best'),
      ao5:      q('.cb-ao5'),
      ao12:     q('.cb-ao12'),
      mean:     q('.cb-mean'),
      count:    q('.cb-count'),
      trend:    q('.cb-trend'),
      timecard:   q('.cb-timecard'),
      stateLabel: q('.cb-state-label'),
      binds:      q('.cb-binds'),
      logo:       q('.cb-logo'),
      coach:        q('.cb-coach'),
      coachLabel:   q('.cb-coach-stage-label'),
      coachStage:   q('.cb-coach-stage'),
      coachDiagram: q('.cb-coach-diagram'),
      coachPieces:  q('.cb-coach-pieces'),
      coachMoves:   q('.cb-coach-moves'),
      coachNote:    q('.cb-coach-note'),
      keys:      q('.cb-keys table'),
      keysNote:  q('.cb-keys-note'),
      chartTimes:  q('.cb-chart-times'),
      chartPhases: q('.cb-chart-phases'),
      chartDist:   q('.cb-chart-dist'),
      chartDays:   q('.cb-chart-days'),
      chartHours:  q('.cb-chart-hours'),
      phaseBar:    q('.cb-phase-bar'),
      phaseNote:   q('.cb-phase-note'),
      spread:      q('.cb-spread'),
      tableTimes:  q('.cb-table-times'),
      dataNote:    q('.cb-data-note'),
      streakV:     q('.cb-streak-v'),
      streakSub:   q('.cb-streak-sub'),
      streakState: q('.cb-streak-state'),
      streakStats: q('.cb-streak-stats'),
      streakFoot:  q('.cb-streak-foot'),
      week:        q('.cb-week'),
      recordStats: q('.cb-records-stats'),
      recordSince: q('.cb-records-since'),
      goal:        q('.cb-goal'),
      speedBody:   q('.cb-speed-body'),
      speedCount:  q('.cb-speed-count'),
      heat:        q('.cb-heat'),
      heatMonths:  q('.cb-heat-months'),
      heatFoot:    q('.cb-heat-foot'),
      peak:        q('.cb-peak'),
      daypart:     q('.cb-daypart'),
      recordsFoot: q('.cb-records-foot'),
    };

    // Nach einem Klick den Fokus abgeben, sonst schlucken <summary> und
    // <button> die Leertaste, statt den Timer zu bedienen.
    host.addEventListener('click', (event) => {
      const target = event.target.closest('button, summary');
      if (target) setTimeout(() => target.blur(), 0);
    });

    // Ein Delegat für alle Options- und Umschaltgruppen.
    host.querySelectorAll('.cb-opts, .cb-switch').forEach((group) => {
      group.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-value]');
        if (button) this.#choose(group.dataset.key, button.dataset.value);
      });
    });

    q('.cb-new').addEventListener('click', () => this.startScramble());
    q('.cb-export').addEventListener('click', () => this.#exportCsv());
    q('.cb-clear').addEventListener('click', () => this.#clearSolves());

    // Zeitenliste: Strafen und Löschen laufen über data-Attribute an den Zeilen.
    this.el.times.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-act]');
      if (button) this.#actOnSolve(button.dataset.id, button.dataset.act);
    });

    /*
     * Touch: ohne Tastatur gibt es keine Leertaste. Ein Tippen auf die
     * Zeit-Karte bedient im Timer-Modus dieselbe Mechanik – halten, loslassen,
     * läuft.
     */
    const pad = this.el.timecard;
    pad.addEventListener('pointerdown', (event) => {
      if (session.settings.mode !== 'timer' || event.pointerType === 'mouse') return;
      event.preventDefault();
      if (this.timer.running) this.stopTimer();
      else this.holdStart();
    });
    pad.addEventListener('pointerup', (event) => {
      if (session.settings.mode !== 'timer' || event.pointerType === 'mouse') return;
      if (this.phase === 'holding') this.holdEnd();
    });
    pad.addEventListener('pointercancel', (event) => {
      if (session.settings.mode !== 'timer' || event.pointerType === 'mouse') return;
      if (this.phase === 'holding') this.holdEnd();
    });

    /*
     * Das Logo kippt der Maus entgegen – dieselben Winkel wie auf milxn.de
     * (siehe handleLogoMove dort). Es ist der einzige Teil der Seite, der auf
     * die blosse Anwesenheit des Zeigers reagiert, und genau deshalb wirkt er.
     */
    this.el.logo.addEventListener('mousemove', (event) => {
      const box = event.currentTarget.getBoundingClientRect();
      const px = (event.clientX - box.left) / box.width - 0.5;
      const py = (event.clientY - box.top) / box.height - 0.5;
      event.currentTarget.style.transform = `rotateX(${py * -18}deg) rotateY(${px * 22}deg)`;
    });
    this.el.logo.addEventListener('mouseleave', (event) => {
      event.currentTarget.style.transform = '';
    });

    if (this.el.themeToggle) {
      this.el.themeToggle.addEventListener('click', (e) => {
        e.preventDefault();
        const current = document.documentElement.getAttribute('data-theme') || session.theme || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        this.#applyTheme(next);
      });
    }

    this.#applySettings();
  }

  /** Eine Einstellung wurde geklickt – egal aus welcher Gruppe. */
  #choose(key, value) {
    if (!key) return;
    if (key === 'mode' && isTouchOnly()) value = 'timer';
    if (session.settings[key] === value) return;
    session.settings[key] = value;

    /*
     * Das Kreuz entsteht auf der Unterseite, und die ist bei fester Kamera
     * verdeckt. Wer den Coach einschaltet, sähe im "solid"-Modus also
     * ausgerechnet den Teil nicht, um den es gerade geht – deshalb einmalig
     * auf "hints" umschalten. Danach bleibt die Wahl beim Nutzer.
     */
    if (key === 'coach' && value === 'on' && session.settings.view === 'solid') {
      session.settings.view = 'hints';
    }

    saveSettings(session.settings);
    this.#applySettings();

    if (key === 'mode') this.#applyMode();
    if (key === 'scope') this.#render();
    this.#recomputeCoach();
  }

  /**
   * Überträgt die Einstellungen an das DOM: die Werte landen als data-Attribute
   * am .cb-app, das Aussehen entsteht daraus komplett im Stylesheet.
   */
  #applySettings() {
    const touchOnly = isTouchOnly();
    if (touchOnly) session.settings.mode = 'timer';
    this.el.app.dataset.touchOnly = String(touchOnly);

    const keys = [...SETTING_GROUPS.map((g) => g.key), 'mode', 'scope'];
    for (const key of keys) {
      const value = session.settings[key];
      this.el.app.dataset[key] = value;
      this.mounted.querySelectorAll(`[data-key="${key}"] button`).forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.value === value));
      });
    }
    this.#applyTheme();
    this.#renderKeys();
    this.#renderBinds();
  }

  #applyTheme(theme) {
    const t = theme || session.theme || getSavedTheme();
    session.theme = t;
    try {
      localStorage.setItem('cherrychrono:v1:theme', t);
      localStorage.setItem('milxn-theme', t);
    } catch (e) {}

    document.documentElement.setAttribute('data-theme', t);
    document.body.setAttribute('data-theme', t);
    if (this.el && this.el.app) this.el.app.dataset.theme = t;

    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.setAttribute('content', t === 'dark' ? '#000000' : '#ffffff');

    if (this.el && this.el.themeToggle) {
      this.el.themeToggle.textContent = `theme: ${t}`;
    }
    setTipTheme(t);
  }

  /** Moduswechsel: der Würfel bekommt eine neue Aufgabe. */
  #applyMode(initial = false) {
    const timerMode = session.settings.mode === 'timer';

    this.animator.clear();
    this.timer.reset();
    this.phases.reset();
    this.moveCount = 0;
    this.#paintTimer();
    this.#renderStrip();

    if (timerMode) {
      // Im Timer-Modus ist der Würfel Vorschau: der Scramble steht sofort da,
      // ohne die zwanzig Animationsschritte, die man nicht mitdrehen will.
      this.#newScramble({ animate: false });
    } else {
      this.state.reset();
      this.renderer.render();
      this.el.scramble.textContent = 'press space to scramble';
      this.#setPhase('idle', hintFor('virtual'));
    }

    if (!initial) this.#recomputeCoach();
  }

  /**
   * Die keys-Tabelle. Bewusst aus der Belegung abgeleitet statt hier noch
   * einmal getippt – sonst driftet die Anzeige von der echten Belegung weg.
   * Wird bei jedem Layoutwechsel neu gezeichnet.
   */
  #renderKeys() {
    const layout = activeLayout();
    this.el.keysNote.textContent = session.settings.layout === 'auto'
      ? `detected: ${layout}` : `set to ${layout}`;
    this.el.keys.innerHTML = keyTableRows(layout)
      .map(([move, key]) => `<tr><td>${move}</td><th>${key}</th></tr>`)
      .join('');
  }

  /* ── Anzeige ──────────────────────────────────────────────────────── */

  #setPhase(next, hint) {
    this.phase = next;
    this.el.app.dataset.state = next;
    this.el.stateLabel.textContent = next;

    // Die Bestzeit-Auszeichnung gehört dem letzten Versuch. Sobald ein neuer
    // beginnt, ist sie vorbei – hier statt beim Mischen, weil im Timer-Modus
    // der nächste Scramble schon steht, während die Zeit noch gefeiert wird.
    if (next === 'holding' || next === 'solving' || next === 'scrambling') {
      this.el.app.removeAttribute('data-pb');
    }

    if (hint !== undefined) this.el.hint.textContent = hint;
  }

  /** Die feste Tastenliste unter der Uhr – sie hängt am Modus und am Gerät. */
  #renderBinds() {
    const touch = isTouchOnly();
    const binds = touch && session.settings.mode === 'timer'
      ? BINDS.touch : BINDS[session.settings.mode];

    this.el.binds.innerHTML = binds
      .map(([key, what]) => `<span><kbd>${key}</kbd>${what}</span>`)
      .join('');

    // Trägt die Warnung im Virtual-Modus und blendet die keys-Tabelle aus.
    this.el.app.toggleAttribute('data-touch', touch);
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

  /** Die Solves, auf die sich Statistik und Diagramme gerade beziehen. */
  #scope() {
    return session.settings.scope === 'all'
      ? session.solves
      : session.solves.slice(session.mark);
  }

  /** Alles neu zeichnen, was von den Zeiten abhängt. */
  #render() {
    const solves = this.#scope();
    const stats = summarize(solves);
    const fmt = (value) => (typeof value === 'number' ? formatTime(value) : value === 'dnf' ? 'dnf' : '–');

    this.el.best.textContent = fmt(stats.best);
    this.el.ao5.textContent  = fmt(stats.ao5);
    this.el.ao12.textContent = fmt(stats.ao12);
    this.el.mean.textContent = fmt(stats.mean);
    this.el.count.textContent = stats.count;

    this.#renderList(solves);
    this.#renderCards();
    this.#renderCharts(solves);

    this.el.dataNote.textContent = session.solves.length
      ? `${session.solves.length} solves stored in this browser · `
        + `${session.solves.filter((s) => s.splits).length} with cfop splits`
      : 'nothing stored yet';
  }

  /** Die letzten Versuche, jeweils mit Strafen und Löschen an der Zeile. */
  #renderList(solves) {
    if (!solves.length) {
      this.el.times.innerHTML = '<li class="cb-empty">no solves yet</li>';
      return;
    }

    const fastest = Math.min(...solves.map(effective).filter(Number.isFinite));

    this.el.times.innerHTML = solves.slice(-8).reverse().map((solve, i) => {
      const number = solves.length - i;
      const isBest = effective(solve) === fastest;
      return `
        <li${isBest ? ' data-best' : ''} data-mode="${solve.mode}">
          <span class="n">${number}</span>
          <b>${solveLabel(solve)}</b>
          <span class="cb-row-acts">
            <button type="button" class="cb-mini" data-id="${solve.id}" data-act="plus2"
              aria-pressed="${solve.penalty === 2000}">+2</button>
            <button type="button" class="cb-mini" data-id="${solve.id}" data-act="dnf"
              aria-pressed="${solve.penalty === 'dnf'}">dnf</button>
            <button type="button" class="cb-mini" data-id="${solve.id}" data-act="drop"
              aria-label="delete solve ${number}">×</button>
          </span>
        </li>`;
    }).join('');
  }

  /* ── Die Karten unter der Bühne ───────────────────────────────────────
   *
   * Serie, Rekorde und Tempo hängen NICHT an der Auswahl session/all: eine
   * Serie über zwei Tage gibt es nur, wenn man alles zählt, und ein Rekord, der
   * mit dem Schliessen des Tabs verfällt, ist keiner. Sie rechnen deshalb immer
   * über `session.solves`, während Diagramme und Kopfzahlen der Auswahl folgen.
   */
  #renderCards() {
    const all = session.solves;
    const days = byDay(all, 182);

    this.#renderStreak(all, days);
    this.#renderRecords(all);
    this.#renderSpeed(all);
  }

  #renderStreak(all, days) {
    const streak = streaks(days);
    const today = days[days.length - 1];
    const week = days.slice(-7);
    const weekSolves = week.reduce((sum, d) => sum + d.solves.length, 0);

    this.el.streakV.textContent = streak.current;
    this.el.streakState.textContent = streak.activeToday ? 'solved today' : 'open';
    this.el.streakSub.innerHTML = `longest ${streak.longest} · ${streak.practised} days practised`;

    this.el.streakStats.innerHTML = `
      <div class="cb-stat"><div class="k">today</div><div class="v">${today.solves.length}</div></div>
      <div class="cb-stat"><div class="k">this week</div><div class="v">${weekSolves}</div></div>
      <div class="cb-stat"><div class="k">total</div><div class="v">${all.length}</div></div>`;

    // Die letzten sieben Tage als Punkte – heute ganz rechts.
    this.el.week.innerHTML = week.map((day) => {
      const isToday = day === today;
      return `<i${day.solves.length ? ' data-on' : ''}${isToday ? ' data-today' : ''}
        title="${day.day}: ${day.solves.length} solves"></i>`;
    }).join('');

    this.el.streakFoot.innerHTML = streak.activeToday
      ? `<span>last solve ${ago(all[all.length - 1].at)}</span><span>keep going</span>`
      : `<span>${streak.current ? 'streak still alive' : 'no streak'}</span>`
        + '<span>solve once today</span>';
  }

  #renderRecords(all) {
    const pb = records(all);
    const cell = (label, record) => `
      <div class="cb-stat">
        <div class="k">${label}</div>
        <div class="v">${record ? formatTime(record.ms) : '–'}</div>
        <div class="n">${record ? ago(record.at) : 'not yet'}</div>
      </div>`;

    this.el.recordStats.innerHTML = cell('single', pb.single)
      + cell('ao5', pb.ao5) + cell('ao12', pb.ao12);
    this.el.recordSince.textContent = all.length ? `${all.length} solves` : '';

    /*
     * Das nächste Ziel setzt sich selbst: eine runde Marke unter dem aktuellen
     * Schnitt. Die Quote daneben sagt, wie nah man ihr ist – eine Zahl, die
     * sich mit jedem Versuch bewegt, im Gegensatz zu den Rekorden darüber.
     */
    const ao12 = average(all, 12);
    const target = subTarget(typeof ao12 === 'number' ? ao12 : mean(all));
    const rate = target ? subRate(all, target) : null;

    this.el.goal.innerHTML = rate ? `
      <div class="cb-vital">
        <div class="cb-vital-row">
          <span class="k">sub-${Math.round(target / 1000)} rate</span>
          <span class="v">${rate.under}/${rate.of}</span>
        </div>
        <div class="cb-meter"><i style="width:${rate.share * 100}%"></i></div>
      </div>` : '<div class="cb-empty">a few more solves and a goal shows up here</div>';

    this.el.recordsFoot.innerHTML = rate
      ? `<span>goal from your ao12</span><span>last ${rate.of} solves</span>`
      : '';
  }

  #renderSpeed(all) {
    const stats = speed(all);
    this.el.speedCount.textContent = stats ? `${stats.count} virtual solves` : '';

    if (!stats) {
      this.el.speedBody.innerHTML =
        '<div class="cb-empty">solve on the virtual cube to measure turn speed</div>';
      return;
    }

    this.el.speedBody.innerHTML = `
      <div class="cb-big"><div class="v">${stats.tps.toFixed(1)}</div><div class="u">tps</div></div>
      <div class="cb-sub">${stats.moves.toFixed(0)} moves per solve on average</div>
      <div class="cb-stats">
        <div class="cb-stat"><div class="k">best tps</div><div class="v">${stats.bestTps.toFixed(1)}</div></div>
        <div class="cb-stat"><div class="k">fewest moves</div><div class="v">${stats.fewestMoves}</div></div>
        <div class="cb-stat"><div class="k">solves</div><div class="v">${stats.count}</div></div>
      </div>
      <svg class="cb-spark cb-chart-tps" role="img" aria-label="turns per second over time"></svg>`;

    renderSpark(this.el.speedBody.querySelector('.cb-chart-tps'), stats.series);
  }

  #renderCharts(solves) {
    // Die einbettende Seite kann ihr Thema jederzeit umschalten. Hier ist der
    // richtige Moment, das zu bemerken: gleich werden ohnehin alle Farben neu
    // vergeben, und die Rampe hängt am Untergrund.
    this.#applyTheme();

    renderTimes(this.el.chartTimes, solves);
    renderPhases(this.el.chartPhases, solves);
    renderDistribution(this.el.chartDist, solves);
    renderDays(this.el.chartDays, byDay(session.solves, 30));

    /*
     * Kalender und Tagesstunden zeigen die GEWOHNHEIT und nicht die Auswahl –
     * eine Heatmap über "diese Sitzung" wäre eine einzige Spalte. Beide rechnen
     * deshalb über alle Zeiten.
     */
    const calendar = byDay(session.solves, 182);
    renderHeatmap(this.el.heat, this.el.heatMonths, calendar);
    const active = calendar.filter((d) => d.solves.length).length;
    this.el.heatFoot.innerHTML = `<span>${active} of 182 days</span>`
      + `<span>${session.solves.length} solves</span>`;

    const hours = byHour(session.solves);
    renderHours(this.el.chartHours, hours);
    const peak = hours.indexOf(Math.max(...hours));
    this.el.peak.textContent = session.solves.length
      ? `busiest ${String(peak).padStart(2, '0')}:00` : '';

    /*
     * Die Stunden noch einmal grob: die 24 Balken zeigen die Spitzen, diese
     * drei Zahlen den Tagesablauf. Wer sieht, dass er fast nur abends übt,
     * weiss auch, warum die Zeiten dort besser aussehen.
     */
    const part = (from, to) => hours.slice(from, to).reduce((a, b) => a + b, 0);
    const total = session.solves.length;
    this.el.daypart.innerHTML = total ? [
      ['morning', part(5, 12)], ['afternoon', part(12, 18)], ['evening', part(18, 24) + part(0, 5)],
    ].map(([name, count]) =>
      `<span>${name}<b>${Math.round((count / total) * 100)}%</b></span>`).join('') : '';

    const averages = phaseAverages(solves);
    renderPhaseBar(this.el.phaseBar, averages);

    const worst = slowestPhase(averages);
    this.el.phaseNote.textContent = worst
      ? `${worst.phase} eats ${Math.round(worst.share * 100)}%`
      : 'virtual mode only';

    // Streuung als eine Zahl: die Spanne, in der die mittleren Versuche liegen.
    const times = solves.map(effective).filter(Number.isFinite).sort((a, b) => a - b);
    this.el.spread.textContent = times.length >= 4
      ? `spread ${formatTime(times[Math.floor(times.length * 0.75)] - times[Math.floor(times.length * 0.25)])}`
      : '';

    // Trend über die Tagesbestzeiten: die Aussage, wegen der man wochenlang misst.
    const days = byDay(session.solves, 30).filter((d) => Number.isFinite(d.best));
    if (days.length >= 4) {
      const half = Math.floor(days.length / 2);
      const early = days.slice(0, half).reduce((s, d) => s + d.best, 0) / half;
      const late = days.slice(-half).reduce((s, d) => s + d.best, 0) / half;
      const delta = late - early;
      this.el.trend.textContent = `${delta < 0 ? '−' : '+'}${formatTime(Math.abs(delta))}`;
      this.el.trend.dataset.dir = delta < 0 ? 'down' : 'up';
    } else {
      this.el.trend.textContent = '';
      delete this.el.trend.dataset.dir;
    }

    this.el.tableTimes.innerHTML = solves.length ? `
      <table>
        <thead><tr><th>#</th><th>time</th><th>mode</th>${PHASES.map((p) => `<th>${p}</th>`).join('')}</tr></thead>
        <tbody>${solves.slice(-30).map((s, i) => `
          <tr>
            <td>${solves.length - Math.min(solves.length, 30) + i + 1}</td>
            <td>${solveLabel(s)}</td>
            <td>${s.mode}</td>
            ${PHASES.map((p) => `<td>${s.splits ? formatTime(s.splits[p]) : '–'}</td>`).join('')}
          </tr>`).join('')}
        </tbody>
      </table>` : '';
  }

  /** Beim Ändern der Breite genügt es, die Diagramme neu zu zeichnen. */
  #scheduleCharts() {
    cancelAnimationFrame(this.chartFrame);
    this.chartFrame = requestAnimationFrame(() => {
      if (!this.mounted) return;
      // Auch die Karten: in der Tempo-Karte steckt eine Kurve, die ihre Breite
      // beim Zeichnen misst. Bliebe sie stehen, wäre sie nach einer
      // Grössenänderung als einzige Zeichnung im Bild verschoben.
      this.#renderCards();
      this.#renderCharts(this.#scope());
    });
  }

  /**
   * Der Fortschrittsbalken eines laufenden Versuchs.
   *
   * Er ersetzt im Virtual-Modus die reine Zahl: man sieht, in welchem Abschnitt
   * man steckt und was die vorigen gekostet haben – dieselben Zwischenzeiten,
   * die hinterher im Diagramm landen, nur live.
   */
  #renderStrip() {
    if (session.settings.mode !== 'virtual') {
      this.el.strip.innerHTML = '';
      return;
    }

    const active = this.phase === 'solving' ? PHASE_ORDER[this.phases.done] : null;
    const marks = this.phases.marks;
    let previous = 0;

    this.el.strip.innerHTML = PHASE_ORDER.map((phase, n) => {
      const done = marks[phase] !== undefined;
      const value = done ? marks[phase] - previous : null;
      if (done) previous = marks[phase];
      return `<span data-phase="${phase}"${done ? ' data-done' : ''}${phase === active ? ' data-active' : ''}>
        <i style="background:var(--cb-p${n})"></i>${phase}<b>${done ? formatTime(value) : '–'}</b>
      </span>`;
    }).join('');
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
    if (session.settings.coach !== 'on' || session.settings.mode !== 'virtual'
        || this.phase === 'scrambling') {
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
    if (session.settings.coach !== 'on' || session.settings.mode !== 'virtual'
        || this.phase === 'scrambling') return;

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
    const {
      coach, coachLabel, coachStage, coachDiagram, coachPieces, coachMoves, coachNote,
    } = this.el;

    if (!this.plan) {
      coach.hidden = true;
      return;
    }
    coach.hidden = false;

    const { step, index, half } = this.plan;
    coach.dataset.stage = step.stage;
    coach.toggleAttribute('data-pending', step.pending);

    coachLabel.textContent = step.stage;
    coachStage.innerHTML = `<b>${step.label}</b>`
      + (step.caseName ? `<span>${step.caseName}</span>` : '');
    coachDiagram.innerHTML = diagramMarkup(step.diagram);
    coachPieces.innerHTML = this.#piecesMarkup(step.pieces);

    coachMoves.innerHTML = step.moves.map((move, i) => {
      const keys = keysForMove(move, activeLayout());
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

  /* ── Scramble ─────────────────────────────────────────────────────── */

  /**
   * Neuer Scramble. Im Virtual-Modus wird er gedreht, damit man sieht, was
   * passiert; im Timer-Modus steht er sofort – dort ist der Würfel nur Vorschau
   * und die zwanzig Animationsschritte wären reine Wartezeit.
   */
  #newScramble({ animate, keepState = false }) {
    delete this.el.app.dataset.spun;
    this.state.reset();
    this.renderer.render();
    this.phases.reset();
    this.moveCount = 0;

    this.scramble = generateScramble(SCRAMBLE_LENGTH);
    this.el.scramble.textContent = this.scramble.join(' ');
    this.#renderStrip();

    if (!animate) {
      for (const token of this.scramble) this.state.applyMove(token);
      this.renderer.render();
      // `keepState`: nach einem Versuch soll die gestoppte Zeit stehen bleiben,
      // während der nächste Scramble schon danebensteht.
      if (!keepState) this.#setPhase('ready', hintFor('timer'));
      return;
    }

    this.#setPhase('scrambling', 'scrambling …');
    this.#recomputeCoach();          // blendet das Panel während des Mischens aus
    this.animator.enqueue(this.scramble, {
      duration: SCRAMBLE_DURATION,
      onDone: () => {
        this.#setPhase('ready', hintFor('virtual'));
        this.#recomputeCoach();
      },
    });
  }

  /** Leertaste (Virtual) bzw. "new": Würfel zurücksetzen und neu mischen. */
  startScramble() {
    this.animator.clear();
    this.timer.reset();
    this.#paintTimer();
    this.#newScramble({ animate: session.settings.mode === 'virtual' });
  }

  /** Esc: den laufenden Versuch verwerfen – in JEDEM Zustand. */
  abort() {
    this.animator.clear();
    this.timer.reset();
    this.phases.reset();
    this.moveCount = 0;
    this.#paintTimer();
    this.#renderStrip();

    // Im Timer-Modus liegt der gemischte Würfel weiter da, es geht also zurück
    // auf "ready". Im Virtual-Modus wurde am Bildschirm gedreht – dort ist der
    // Versuch mit dem Abbruch vorbei, der Würfel bleibt, wie er steht.
    const back = session.settings.mode === 'timer' ? 'ready' : 'idle';
    this.#setPhase(back, hintFor(session.settings.mode));
    if (session.settings.mode === 'virtual') this.#recomputeCoach();
  }

  /** Backspace: im Virtual-Modus zurück auf gelöst, im Timer-Modus neu mischen. */
  resetCube() {
    if (session.settings.mode === 'timer') {
      this.#newScramble({ animate: false });
      return;
    }
    this.animator.clear();
    this.timer.reset();
    this.phases.reset();
    this.#paintTimer();
    this.state.reset();
    this.renderer.render();
    this.el.scramble.textContent = 'press space to scramble';
    this.#setPhase('idle', hintFor('virtual'));
    this.#renderStrip();
    this.#recomputeCoach();
  }

  /* ── Timer-Modus ──────────────────────────────────────────────────── */

  /**
   * Leertaste unten: die Uhr springt auf null und wird rot.
   *
   * Bewusst OHNE Mindesthaltedauer, wie sie der csTimer kennt. Die Wartezeit
   * dort verhindert Fehlstarts, kostet aber die Rückmeldung: man drückt, und
   * eine Drittelsekunde lang sagt nichts, dass es angekommen ist. Hier gilt:
   * gedrückt ist rot, losgelassen läuft – und wer sich vertut, drückt esc.
   */
  holdStart() {
    if (this.phase === 'solving') return;
    if (session.settings.mode === 'timer') {
      // Vorbereitung auf den nächsten Versuch: Scramble auf dem 3D-Modell zeigen
      this.state.reset();
      for (const token of this.scramble) this.state.applyMove(token);
      this.renderer.render();
    }
    this.timer.reset();
    this.#paintTimer();
    this.#setPhase('holding', 'let go to start');
  }

  /** Leertaste losgelassen: die Uhr läuft. */
  holdEnd() {
    if (this.phase !== 'holding') return;
    this.#setPhase('solving', 'any key stops');
    this.timer.start();
    this.#timerLoop();
  }

  /** Irgendeine Taste während des Laufs: anhalten und eintragen. */
  stopTimer() {
    if (!this.timer.running) return;
    const ms = this.timer.stop();
    this.#paintTimer();

    this.#recordSolve({ ms, mode: 'timer' });

    /*
     * Der nächste Scramble steht sofort da – man will nicht erst etwas drücken
     * müssen, um zu sehen, was als Nächstes kommt. Die eben gestoppte Zeit
     * bleibt daneben stehen, bis die Leertaste den nächsten Versuch beginnt;
     * deshalb `keepState`.
     */
    this.#newScramble({ animate: false, keepState: true });

    // Sobald die Zeit gestoppt wird, ist der 3D-Würfel auf der Seite gelöst
    this.state.reset();
    this.renderer.render();

    this.#setPhase('solved', `${formatTime(ms)} · hold space for the next one`);
  }

  /* ── Virtual-Modus ────────────────────────────────────────────────── */

  /** Ein Zug über die Tastatur. */
  handleMove(token) {
    if (this.phase === 'scrambling') return; // während des Mischens keine Eingabe

    if (this.phase === 'ready') {
      this.el.app.dataset.spun = 'true';
    }

    // Ganzwürfel-Drehungen (x/y/z) starten die Zeit nicht – nur echte Züge.
    // Slice- und Wide-Moves verändern den Würfel und zählen deshalb mit.
    const isFaceTurn = !ROTATIONS.includes(token[0]);

    if (this.phase === 'ready' && isFaceTurn) {
      this.#setPhase('solving', 'solving …');
      this.phases.reset();
      this.moveCount = 0;
      this.timer.start();
      this.#timerLoop();
    }

    this.animator.enqueue(token, {
      duration: TURN_DURATION,
      onDone: (done) => this.#afterMove(done),
    });
  }

  /**
   * Läuft nach jedem beendeten Zug.
   *
   * Hier – und nur hier – entstehen die Zwischenzeiten: Nach jedem Zug wird
   * gefragt, wie weit der Würfel ist. Das ist billig (ein Blick auf die 20
   * Steine) und genau, weil es am selben Zustand hängt, den auch der Renderer
   * zeigt.
   */
  #afterMove(token) {
    if (this.phase !== 'solving') return;

    if (!ROTATIONS.includes(token[0])) this.moveCount++;

    const elapsed = this.timer.elapsed;
    const phase = currentPhase(this.state);
    const before = this.phases.done;
    this.phases.update(phase, elapsed);
    if (this.phases.done !== before) this.#renderStrip();

    if (phase !== 'done' || !this.state.isSolved()) return;

    const ms = this.timer.stop();
    this.#paintTimer();
    this.#recordSolve({
      ms,
      mode: 'virtual',
      splits: this.phases.splits(ms),
      moves: this.moveCount,
    });
    this.#renderStrip();
    this.#setPhase('solved', `solved in ${formatTime(ms)} · ${this.moveCount} moves `
      + `· ${(this.moveCount / (ms / 1000)).toFixed(1)} tps · space for the next one`);
  }

  /* ── Zeiten ───────────────────────────────────────────────────────── */

  #recordSolve(fields) {
    const solve = {
      id: uid(),
      at: Date.now(),
      penalty: 0,
      scramble: this.scramble.join(' '),
      ...fields,
    };
    session.solves.push(solve);
    saveSolves(session.solves);
    this.#render();

    // Kurzes Aufblitzen, wenn die Zeit die beste der Auswahl ist.
    const solves = this.#scope();
    const fastest = Math.min(...solves.map(effective).filter(Number.isFinite));
    this.el.app.toggleAttribute('data-pb', effective(solve) === fastest && solves.length > 1);
  }

  /** Strafe setzen oder Versuch löschen. */
  #actOnSolve(id, action) {
    const index = session.solves.findIndex((s) => s.id === id);
    if (index < 0) return;
    const solve = session.solves[index];

    if (action === 'drop') {
      session.solves.splice(index, 1);
      // Der Trennstrich zur Sitzung muss mitwandern, sonst zählt die Sitzung
      // plötzlich einen Versuch von vorher mit.
      if (index < session.mark) session.mark--;
    } else if (action === 'plus2') {
      solve.penalty = solve.penalty === 2000 ? 0 : 2000;
    } else if (action === 'dnf') {
      solve.penalty = solve.penalty === 'dnf' ? 0 : 'dnf';
    }

    saveSolves(session.solves);
    this.#render();
  }

  #clearSolves() {
    if (!session.solves.length) return;
    // Keine Rückfrage per confirm(): ein Dialog blockiert die Seite und ist auf
    // dem Handy ein Fremdkörper. Stattdessen zwei Klicks – der erste bewaffnet.
    const button = this.mounted.querySelector('.cb-clear');
    if (!button.dataset.armed) {
      button.dataset.armed = '1';
      button.textContent = 'tap again to confirm';
      setTimeout(() => {
        if (!this.mounted) return;
        delete button.dataset.armed;
        button.textContent = 'delete all solves';
      }, 4000);
      return;
    }

    session.solves = [];
    session.mark = 0;
    saveSolves(session.solves);
    delete button.dataset.armed;
    button.textContent = 'delete all solves';
    this.#render();
  }

  /** CSV, weil jede Tabellenkalkulation und jeder andere Timer das liest. */
  #exportCsv() {
    const head = ['at', 'mode', 'ms', 'penalty', 'moves', ...PHASES, 'scramble'];
    const rows = session.solves.map((s) => [
      new Date(s.at).toISOString(), s.mode, Math.round(s.ms), s.penalty || 0, s.moves ?? '',
      ...PHASES.map((p) => (s.splits ? Math.round(s.splits[p]) : '')),
      `"${s.scramble}"`,
    ].join(','));

    const blob = new Blob([[head.join(','), ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cube-solves-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
}

window.CubeApp = new CubeApp();
// Modul-Scripts laufen nach dem ersten Render – die Seite kann so nachziehen,
// falls die Cube-Ansicht schon offen ist.
window.dispatchEvent(new Event('cubeapp:ready'));
