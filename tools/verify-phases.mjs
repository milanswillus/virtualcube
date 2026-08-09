/**
 * verify-phases.mjs – Prüft die Zwischenzeiten: Phasenerkennung und Statistik.
 *
 * WARUM DAS EINE PRÜFUNG BRAUCHT
 * ------------------------------
 * `currentPhase()` beantwortet dieselbe Frage wie die Solver, aber auf einem
 * ganz anderen Weg – es schaut nur, ob etwas steht, statt zu suchen. Zwei
 * unabhängige Antworten auf dieselbe Frage sind die beste Prüfung, die es gibt:
 * hier wird bei jedem einzelnen Zug einer echten Lösung gegengerechnet, ob die
 * schnelle Antwort mit der aus checks.mjs übereinstimmt.
 *
 * Dazu drei Eigenschaften, auf die sich die Anzeige verlässt:
 *   • Die Phase muss unter Ganzwürfeldrehungen gleich bleiben. Ein `y` ändert
 *     nichts am Fortschritt, verschiebt aber jede Weltseite.
 *   • Die Zwischenzeiten müssen sich lückenlos zur Gesamtzeit addieren.
 *   • Die WCA-Regeln für ao5 (bestes und schlechtestes streichen, zwei DNF
 *     machen den Schnitt ungültig) müssen stimmen – daran hängt jede Zahl im
 *     Kopfbereich.
 *
 *   node tools/verify-phases.mjs [anzahl]
 */

import { CubeState } from '../js/cubeState.js';
import { generateScramble } from '../js/scramble.js';
import { nextStep } from '../js/solver/coach.js';
import { readCube, rotationToPut, CROSS_COLOR, CROSS_FACE } from '../js/solver/pieces.js';
import { invert } from '../js/solver/lastLayer.js';
import { currentPhase, PhaseTracker, PHASE_ORDER } from '../js/phases.js';
import {
  average, effective, phaseAverages, byDay, byHour,
  streaks, records, speed, subTarget, subRate,
} from '../js/stats.js';
import { crossIsSolved, f2lIsSolved, lastLayerIsOriented } from './checks.mjs';

const RUNS = Number(process.argv[2] ?? 60);

let failures = 0;
const fail = (message) => { console.log(`FAIL  ${message}`); failures++; };
const pass = (message) => console.log(`PASS  ${message}`);

/**
 * Die Phase, wie sie sich aus den unabhängigen Prüfungen ergibt.
 *
 * `crossIsSolved()` aus checks.mjs verlangt das Kreuz auf der WELTSEITE D – es
 * ist für den Solver geschrieben, der den Würfel vorher dorthin dreht. Der
 * Trainer dreht aber mitten in einem Schritt (`x'` in einem PLL-Algorithmus),
 * und dann liegt die Kreuzfarbe zwischenzeitlich woanders.
 *
 * Deshalb wird hier vor dem Prüfen zurückgedreht und danach wieder her: die
 * Prüfung selbst bleibt unangetastet, sie bekommt nur den Würfel in der Lage,
 * für die sie geschrieben ist. Ohne das würde der Test genau die
 * Drehunabhängigkeit anmahnen, die `currentPhase()` haben SOLL.
 */
function expectedPhase(cube) {
  const rotation = rotationToPut(readCube(cube).faceOfColor[CROSS_COLOR], CROSS_FACE);
  if (rotation.length) cube.applySequence(rotation);

  try {
    if (!crossIsSolved(cube)) return 'cross';
    if (!f2lIsSolved(cube)) return 'f2l';
    if (!lastLayerIsOriented(cube)) return 'oll';
    return cube.isSolved() ? 'done' : 'pll';
  } finally {
    if (rotation.length) cube.applySequence(invert(rotation));
  }
}

/* ── 1. Stimmt die schnelle Antwort mit der langsamen überein? ──────────── */

let checked = 0;
let orderViolations = 0;
let rotationProbes = 0;

for (let run = 0; run < RUNS; run++) {
  const cube = new CubeState();
  const scramble = generateScramble(20);
  cube.applySequence(scramble);

  const tracker = new PhaseTracker();
  let clock = 0;
  let steps = 0;
  let lastIndex = -1;
  const applied = [];
  let crossDoneAt = null;   // Züge bis zum fertigen Kreuz – für die Drehprobe

  while (!cube.isSolved()) {
    if (++steps > 60) { fail(`keine Konvergenz: ${scramble.join(' ')}`); break; }

    const step = nextStep(cube);
    if (step.pending || step.moves.length === 0) {
      fail(`Sackgasse in "${step.stage}": ${scramble.join(' ')}`);
      break;
    }

    // Zug für Zug, nicht der ganze Algorithmus am Stück: die Zwischenzeiten
    // entstehen im Betrieb genauso, und nur so werden auch die Zustände
    // MITTEN in einem Algorithmus geprüft.
    for (const move of step.moves) {
      cube.applyMove(move);
      applied.push(move);
      clock += 100;

      const actual = currentPhase(cube);
      const expected = expectedPhase(cube);
      checked++;

      if (crossDoneAt === null && actual !== 'cross') crossDoneAt = [...applied];

      if (actual !== expected) {
        fail(`Phase "${actual}" statt "${expected}" nach ${move}\n      ${scramble.join(' ')}`);
      }

      /*
       * Kreuz und F2L dürfen zwischendurch wieder aufgehen – ein F2L-Paar wird
       * eingesetzt, indem man den Slot öffnet. Der TRACKER darf davon nichts
       * mitbekommen: einmal gestellte Zwischenzeiten bleiben stehen.
       */
      tracker.update(actual, clock);
      const index = actual === 'done' ? PHASE_ORDER.length : PHASE_ORDER.indexOf(actual);
      if (index < lastIndex) orderViolations++;
      lastIndex = Math.max(lastIndex, index);

      if (tracker.done > PHASE_ORDER.length) fail('Tracker läuft über das Ende hinaus');
    }
  }

  /*
   * Die Drehprobe – und zwar an einer Stellung, an der sie etwas aussagt: mit
   * fertigem Kreuz. `crossIsSolved()` aus checks.mjs verlangt das Kreuz auf der
   * Weltseite D und würde hier umschlagen; `currentPhase()` darf das nicht,
   * denn gelöst bleibt gelöst, egal wie herum man den Würfel hält.
   */
  if (crossDoneAt) {
    const plain = new CubeState();
    plain.applySequence(scramble);
    plain.applySequence(crossDoneAt);

    const twisted = new CubeState();
    twisted.applySequence(scramble);
    twisted.applySequence(crossDoneAt);
    twisted.applySequence(['x', "y'", 'z2']);

    if (currentPhase(plain) !== currentPhase(twisted)) {
      fail(`Ganzwürfeldrehung ändert die Phase (${currentPhase(plain)} → `
        + `${currentPhase(twisted)}): ${scramble.join(' ')}`);
    }
    rotationProbes++;
  }

  // Die Zwischenzeiten müssen die Gesamtzeit lückenlos aufteilen.
  const splits = tracker.splits(clock);
  const sum = PHASE_ORDER.reduce((total, phase) => total + splits[phase], 0);
  if (Math.abs(sum - clock) > 0.001) {
    fail(`Zwischenzeiten ergeben ${sum} statt ${clock}`);
  }
  if (PHASE_ORDER.some((phase) => splits[phase] < 0)) {
    fail(`negative Zwischenzeit: ${JSON.stringify(splits)}`);
  }
}

if (!failures) pass(`${checked} Stellungen stimmen mit checks.mjs überein`);
if (!failures) pass(`${rotationProbes} Drehproben mit fertigem Kreuz`);
if (orderViolations) {
  pass(`${orderViolations} Rückschritte im Verlauf – vom Tracker korrekt ignoriert`);
}

/* ── 2. Die Regeln für den Schnitt ─────────────────────────────────────── */

const solve = (ms, penalty = 0) => ({ ms, penalty, at: Date.now(), mode: 'timer' });

if (effective(solve(1000, 2000)) !== 3000) fail('+2 wird nicht aufgeschlagen');
if (Number.isFinite(effective(solve(1000, 'dnf')))) fail('DNF ist keine endliche Zeit');

// 10 20 30 40 50 → 10 und 50 fallen weg, es bleibt (20+30+40)/3 = 30.
const five = [10, 20, 30, 40, 50].map((s) => solve(s * 1000));
if (average(five, 5) !== 30000) fail(`ao5 ergibt ${average(five, 5)} statt 30000`);

if (average(five.slice(0, 4), 5) !== null) fail('ao5 mit vier Versuchen muss null sein');

// Ein DNF ist das "schlechteste" und fällt heraus – der Schnitt bleibt gültig.
const oneDnf = [solve(10000), solve(20000), solve(30000), solve(40000), solve(50000, 'dnf')];
if (typeof average(oneDnf, 5) !== 'number') fail('ein DNF darf den ao5 nicht ungültig machen');

// Zwei DNF nicht mehr: nur eines wird gestrichen.
const twoDnf = [solve(10000), solve(20000), solve(30000), solve(40000, 'dnf'), solve(50000, 'dnf')];
if (average(twoDnf, 5) !== 'dnf') fail('zwei DNF müssen den ao5 ungültig machen');

if (!failures) pass('ao5 folgt den WCA-Regeln');

/* ── 3. Auswertung der Zwischenzeiten ──────────────────────────────────── */

const withSplits = [
  { ...solve(10000), splits: { cross: 1000, f2l: 5000, oll: 2000, pll: 2000 } },
  { ...solve(20000), splits: { cross: 3000, f2l: 9000, oll: 4000, pll: 4000 } },
  { ...solve(30000, 'dnf'), splits: { cross: 9000, f2l: 9000, oll: 6000, pll: 6000 } },
];

const averages = phaseAverages(withSplits);
if (averages.count !== 2) fail(`DNF wird mitgemittelt (${averages.count} statt 2)`);
if (averages.cross !== 2000) fail(`cross-Schnitt ${averages.cross} statt 2000`);
if (phaseAverages([solve(1000)]) !== null) fail('ohne Splits muss null herauskommen');

const days = byDay([{ ...solve(5000), at: Date.now() }], 30);
if (days.length !== 30) fail(`byDay liefert ${days.length} statt 30 Tage`);
if (days[29].solves.length !== 1) fail('der heutige Versuch landet nicht im letzten Feld');

if (!failures) pass('Auswertung der Zwischenzeiten stimmt');

/* ── 4. Die Zahlen der Karten ──────────────────────────────────────────
 *
 * Serie, Rekorde und Tempo sind reine Rechnungen auf einer Liste – sie lassen
 * sich deshalb an von Hand gesetzten Fällen prüfen, und genau die Fälle, die im
 * Betrieb selten sind (Lücke in der Serie, DNF unter den Rekorden, gar keine
 * Virtual-Solves), sind die, in denen sie schiefgehen können.
 */

const DAY = 86400000;
const at = (daysAgo, hour = 12) => {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.getTime() - daysAgo * DAY;
};
const rec = (daysAgo, ms, extra = {}) =>
  ({ id: `x${daysAgo}-${ms}`, at: at(daysAgo), ms, mode: 'timer', penalty: 0, ...extra });

/* Serie: heute, gestern, vorgestern – davor eine Lücke. */
const withGap = [rec(0, 12000), rec(1, 13000), rec(2, 14000), rec(5, 15000), rec(6, 16000)];
const s1 = streaks(byDay(withGap, 30));
if (s1.current !== 3) fail(`Serie ${s1.current} statt 3`);
if (s1.longest !== 3) fail(`längste Serie ${s1.longest} statt 3`);
if (s1.practised !== 5) fail(`geübte Tage ${s1.practised} statt 5`);
if (!s1.activeToday) fail('heute wurde gelöst, activeToday sagt nein');

/* Ohne Versuch heute läuft die Serie von gestern weiter – sie endet erst um
   Mitternacht. Das ist der Fall, den eine naive Zählung falsch macht. */
const notToday = [rec(1, 12000), rec(2, 13000), rec(3, 14000)];
const s2 = streaks(byDay(notToday, 30));
if (s2.current !== 3) fail(`Serie ohne Versuch heute: ${s2.current} statt 3`);
if (s2.activeToday) fail('ohne Versuch heute darf activeToday nicht gelten');

const s3 = streaks(byDay([], 30));
if (s3.current !== 0 || s3.longest !== 0) fail('leere Liste muss Serie 0 ergeben');

/* Rekorde: das DNF darf nie der Einzelrekord sein, auch wenn es die kleinste
   Rohzeit trägt. */
const pbList = [
  rec(9, 9000, { penalty: 'dnf' }),
  rec(8, 20000), rec(7, 19000), rec(6, 18000), rec(5, 17000), rec(4, 16000),
  rec(3, 11000), rec(2, 15000), rec(1, 14000),
];
const pb = records(pbList);
if (pb.single.ms !== 11000) fail(`Einzelrekord ${pb.single.ms} statt 11000`);
if (pb.single.at !== at(3)) fail('Einzelrekord trägt den falschen Zeitpunkt');
if (!pb.ao5 || pb.ao5.ms >= 20000) fail(`ao5-Rekord unplausibel: ${JSON.stringify(pb.ao5)}`);
if (pb.ao12 !== null) fail('ohne zwölf Versuche darf es keinen ao12-Rekord geben');
if (records([]).single !== null) fail('leere Liste darf keinen Rekord haben');

/* Die Marke muss UNTER dem Schnitt liegen und darf keine schon erreichte sein. */
if (subTarget(12800) !== 12000) fail(`subTarget(12.8s) = ${subTarget(12800)}, erwartet 12000`);
if (subTarget(13000) !== 12000) fail(`subTarget(13.0s) = ${subTarget(13000)}, erwartet 12000`);
if (subTarget(17400) !== 17000) fail(`subTarget(17.4s) = ${subTarget(17400)}, erwartet 17000`);
if (subTarget(4000) !== null) fail('unter der schnellsten Marke gibt es kein Ziel mehr');
if (subTarget(null) !== null) fail('ohne Bezugswert kein Ziel');

const rate = subRate([rec(0, 9000), rec(0, 11000), rec(0, 13000)], 12000);
if (rate.under !== 2 || rate.of !== 3) fail(`Sub-Quote ${JSON.stringify(rate)}`);

/* Tempo: nur Versuche mit Zugzahl zählen, DNF fliegt raus. */
const moves = [
  rec(2, 10000, { mode: 'virtual', moves: 50 }),
  rec(1, 20000, { mode: 'virtual', moves: 60 }),
  rec(1, 10000, { mode: 'virtual', moves: 90, penalty: 'dnf' }),
  rec(0, 15000),
];
const sp = speed(moves);
if (sp.count !== 2) fail(`Tempo zählt ${sp.count} statt 2 Versuche`);
if (Math.abs(sp.tps - 4) > 0.001) fail(`tps ${sp.tps} statt 4`);
if (sp.fewestMoves !== 50) fail(`wenigste Züge ${sp.fewestMoves} statt 50`);
if (speed([rec(0, 12000)]) !== null) fail('ohne Zugzahlen muss null herauskommen');

/* Stunden: Ortszeit, 24 Fächer. */
const hours = byHour([rec(0, 12000)]);
if (hours.length !== 24) fail(`byHour liefert ${hours.length} Fächer`);
if (hours[12] !== 1) fail('der Versuch um 12 Uhr landet im falschen Fach');

if (!failures) pass('Serie, Rekorde, Ziel und Tempo rechnen richtig');

console.log(failures === 0 ? '\nalles grün' : `\n${failures} FEHLER`);
process.exit(failures === 0 ? 0 : 1);
