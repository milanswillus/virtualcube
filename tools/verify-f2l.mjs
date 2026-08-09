/**
 * verify-f2l.mjs – Prüft den F2L-Solver end-to-end am echten Würfel.
 *
 * Vorgehen wie bei verify-cross.mjs: mischen, das Kreuz mit dem Kreuz-Solver
 * bauen, dann so lange F2L-Schritte anwenden, bis alle vier Slots stehen.
 * Geprüft wird unabhängig vom Solver: die unteren beiden Ebenen müssen
 * vollständig zu ihren Mittelsteinen passen.
 *
 * Zusätzlich wird die Kernzusage kontrolliert, auf der die ganze Konstruktion
 * beruht – ein Schritt darf NIE ein bereits fertiges Paar oder das Kreuz
 * zerstören. Ohne diese Prüfung könnte der Solver konvergieren und trotzdem
 * unbrauchbar sein.
 *
 *   node tools/verify-f2l.mjs [anzahl]
 */

import { CubeState } from '../js/cubeState.js';
import { generateScramble } from '../js/scramble.js';
import { planCross } from '../js/solver/crossSolver.js';
import { readCube } from '../js/solver/pieces.js';
import { planF2L } from '../js/solver/f2lSolver.js';
import { crossIsSolved, solvedSlots } from './checks.mjs';

const RUNS = Number(process.argv[2] ?? 200);

let failures = 0;
let totalMoves = 0;
let totalRotations = 0;
let totalClears = 0;
let worstMoves = 0;
let worstScramble = null;
let longestStep = 0;
let slowest = 0;

/*
 * Die erste echte Suche baut die Tabelle auf – separat messen, denn im Browser
 * trifft dieser eine Aufruf den Nutzer sichtbar. Ein gelöster Würfel taugt
 * dafür nicht: dort ist F2L sofort fertig und es wird gar nicht gesucht.
 */
{
  const cube = new CubeState();
  cube.applySequence(generateScramble(20));
  for (let i = 0; i < 12 && !crossIsSolved(cube); i++) {
    const step = planCross(readCube(cube));
    cube.applySequence([...step.rotation, ...step.moves]);
  }
  const t0 = performance.now();
  planF2L(readCube(cube));
  console.log(`erste Suche (Tabelle) ${(performance.now() - t0).toFixed(0)} ms`);
}

for (let run = 0; run < RUNS; run++) {
  const cube = new CubeState();
  const scramble = generateScramble(20);
  cube.applySequence(scramble);

  for (const rot of ['x', 'y', 'z']) {
    const n = Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) cube.applyMove(rot);
  }

  // Kreuz vorweg – der F2L-Solver setzt es voraus.
  let guard = 0;
  while (!crossIsSolved(cube)) {
    const step = planCross(readCube(cube));
    cube.applySequence([...step.rotation, ...step.moves]);
    if (++guard > 12) break;
  }
  if (!crossIsSolved(cube)) {
    console.log(`FAIL  Kreuz nicht gebaut\n      ${scramble.join(' ')}`);
    failures++;
    continue;
  }

  let moves = 0;
  let rotations = 0;
  let steps = 0;
  let done = 0;
  let broken = false;

  while (solvedSlots(cube) < 4) {
    if (++steps > 24) {
      console.log(`FAIL  keine Konvergenz nach 24 Schritten\n      ${scramble.join(' ')}`);
      failures++;
      broken = true;
      break;
    }

    const before = solvedSlots(cube);

    const t0 = performance.now();
    const step = planF2L(readCube(cube));
    slowest = Math.max(slowest, performance.now() - t0);

    if (!step || (step.moves.length === 0 && !step.done)) {
      console.log(`FAIL  kein Plan gefunden\n      ${scramble.join(' ')}`);
      failures++;
      broken = true;
      break;
    }

    cube.applySequence([...step.rotation, ...step.moves]);
    rotations += step.rotation.length;
    moves += step.moves.length;
    longestStep = Math.max(longestStep, step.moves.length);
    if (step.kind === 'clear') totalClears++;

    // Die zentrale Zusage: nichts Fertiges geht kaputt.
    if (!crossIsSolved(cube)) {
      console.log(`FAIL  Kreuz zerstört von [${step.moves.join(' ')}]\n      ${scramble.join(' ')}`);
      failures++;
      broken = true;
      break;
    }
    const after = solvedSlots(cube);
    if (after < before) {
      console.log(`FAIL  fertiges Paar zerstört von [${step.moves.join(' ')}]\n      ${scramble.join(' ')}`);
      failures++;
      broken = true;
      break;
    }
    done = after;
  }

  if (broken) continue;

  totalMoves += moves;
  totalRotations += rotations;
  if (moves > worstMoves) { worstMoves = moves; worstScramble = scramble.join(' '); }
}

console.log(`Läufe                 ${RUNS}`);
console.log(`Fehler                ${failures}`);
console.log(`Züge im Schnitt       ${(totalMoves / RUNS).toFixed(2)}`);
console.log(`Drehungen im Schnitt  ${(totalRotations / RUNS).toFixed(2)}`);
console.log(`Slots geräumt         ${totalClears} in ${RUNS} Läufen`);
console.log(`längster Schritt      ${longestStep} Züge`);
console.log(`schlechtester Fall    ${worstMoves} Züge   (${worstScramble})`);
console.log(`langsamster Schritt   ${slowest.toFixed(1)} ms`);
console.log(failures === 0 ? '\nalles grün' : `\n${failures} FEHLER`);
process.exit(failures === 0 ? 0 : 1);
