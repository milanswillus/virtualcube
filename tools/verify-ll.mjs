/**
 * verify-ll.mjs – Prüft die OLL- und PLL-Sätze aus llAlgs.js.
 *
 * DREI PRÜFUNGEN, DIE ZUSAMMEN JEDEN TIPPFEHLER FANGEN
 * ----------------------------------------------------
 * 1. Jeder Algorithmus muss die ersten beiden Ebenen unangetastet lassen
 *    (PLL zusätzlich die Ausrichtung). Ein verrutschter Zug fällt hier auf.
 *
 * 2. ABDECKUNG. Es gibt genau 216 mögliche Ausrichtungen und 288 mögliche
 *    Vertauschungen der letzten Ebene. Jeder Tabelleneintrag entsteht daraus,
 *    dass ein Algorithmus rückwärts auf einen gelösten Würfel angewandt wird –
 *    ist also per Konstruktion eine echte, lösbare Stellung. Erreicht die
 *    Tabelle diese Zahlen, ist der Satz zwangsläufig vollständig UND
 *    fehlerfrei: ein vertippter Algorithmus würde eine Stellung doppelt
 *    besetzen und eine andere leer lassen.
 *
 * 3. Kompletter Durchlauf: mischen und über alle vier Stufen bis zum gelösten
 *    Würfel.
 *
 *   node tools/verify-ll.mjs [anzahl]
 */

import { generateScramble } from '../js/scramble.js';
import { readCube } from '../js/solver/pieces.js';
import { nextStep } from '../js/solver/coach.js';
import { OLL_ALGS, PLL_ALGS } from '../js/solver/llAlgs.js';
import { tables, invert, referenceCube } from '../js/solver/lastLayer.js';
import { f2lIsSolved, lastLayerIsOriented } from './checks.mjs';

const RUNS = Number(process.argv[2] ?? 200);

/** So viele Stellungen der letzten Ebene gibt es. */
const OLL_STATES = 216;   // 3³ Eckenausrichtungen · 2³ Kantenausrichtungen
const PLL_STATES = 288;   // 4!·4!/2 – nur gerade Permutationen sind erreichbar

let failures = 0;
const fail = (message) => { console.log(`FAIL  ${message}`); failures++; };

/* ── 1. Lassen die Algorithmen alles Fertige in Ruhe? ───────────────────── */

for (const { id, moves } of OLL_ALGS) {
  const cube = referenceCube();
  cube.applySequence(invert(moves.split(' ')));
  if (!f2lIsSolved(cube)) fail(`OLL ${id} zerstört die ersten beiden Ebenen: ${moves}`);
}

for (const { id, moves } of PLL_ALGS) {
  const cube = referenceCube();
  cube.applySequence(invert(moves.split(' ')));
  if (!f2lIsSolved(cube)) fail(`PLL ${id} zerstört die ersten beiden Ebenen: ${moves}`);
  else if (!lastLayerIsOriented(cube)) fail(`PLL ${id} verdreht die letzte Ebene: ${moves}`);
}

/* ── 2. Abdeckung ───────────────────────────────────────────────────────── */

const { oll, pll } = tables();

console.log(`OLL-Fälle abgedeckt   ${oll.size} von ${OLL_STATES}`);
console.log(`PLL-Fälle abgedeckt   ${pll.size} von ${PLL_STATES}`);

if (oll.size !== OLL_STATES) fail(`OLL deckt ${oll.size} statt ${OLL_STATES} Stellungen ab`);
if (pll.size !== PLL_STATES) fail(`PLL deckt ${pll.size} statt ${PLL_STATES} Stellungen ab`);

/* ── 3. Kompletter Durchlauf ────────────────────────────────────────────── */

let totalMoves = 0;
let worst = 0;
let worstScramble = null;
let slowest = 0;

for (let run = 0; run < RUNS; run++) {
  const cube = referenceCube();
  const scramble = generateScramble(20);
  cube.applySequence(scramble);

  for (const rot of ['x', 'y', 'z']) {
    const n = Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) cube.applyMove(rot);
  }

  let moves = 0;
  let steps = 0;
  let broken = false;

  while (!cube.isSolved()) {
    if (++steps > 40) {
      fail(`keine Konvergenz nach 40 Schritten\n      ${scramble.join(' ')}`);
      broken = true;
      break;
    }

    const t0 = performance.now();
    const step = nextStep(cube);
    slowest = Math.max(slowest, performance.now() - t0);

    if (step.pending || step.moves.length === 0) {
      fail(`Sackgasse in Stufe "${step.stage}"\n      ${scramble.join(' ')}`);
      broken = true;
      break;
    }

    cube.applySequence(step.moves);
    moves += step.moves.length;
  }

  if (broken) continue;
  totalMoves += moves;
  if (moves > worst) { worst = moves; worstScramble = scramble.join(' '); }
}

console.log(`Läufe                 ${RUNS}`);
console.log(`Züge im Schnitt       ${(totalMoves / RUNS).toFixed(1)}`);
console.log(`schlechtester Fall    ${worst} Züge   (${worstScramble})`);
console.log(`langsamster Schritt   ${slowest.toFixed(1)} ms`);
console.log(failures === 0 ? '\nalles grün' : `\n${failures} FEHLER`);
process.exit(failures === 0 ? 0 : 1);
