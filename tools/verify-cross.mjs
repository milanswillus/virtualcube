/**
 * verify-cross.mjs – Prüft Stellungserkennung und Kreuz-Solver end-to-end.
 *
 * Vorgehen: Zufalls-Scramble, dann so lange den vom Coach vorgeschlagenen
 * Schritt anwenden, bis das Kreuz steht. Geprüft wird nicht die interne Logik,
 * sondern das Ergebnis am echten Würfel – die vier weissen Kanten müssen unten
 * sitzen und zu ihren Mittelsteinen passen.
 *
 *   node tools/verify-cross.mjs [anzahl]
 */

import { CubeState } from '../js/cubeState.js';
import { generateScramble } from '../js/scramble.js';
import { readCube, CROSS_COLOR, CROSS_FACE, faceOfNormal, normalOfSticker } from '../js/solver/pieces.js';
import { planCross } from '../js/solver/crossSolver.js';

const RUNS = Number(process.argv[2] ?? 300);

/** Unabhängige Prüfung: steht das weisse Kreuz? */
function crossIsSolved(cube) {
  const { faceOfColor, edges } = readCube(cube);
  if (faceOfColor[CROSS_COLOR] !== CROSS_FACE) return false;

  for (const color of ['R', 'L', 'F', 'B']) {
    const piece = edges.get([CROSS_COLOR, color].sort().join(''));
    if (faceOfNormal(normalOfSticker(piece, CROSS_COLOR)) !== CROSS_FACE) return false;
    if (faceOfNormal(normalOfSticker(piece, color)) !== faceOfColor[color]) return false;
  }
  return true;
}

let failures = 0;
let totalMoves = 0;
let totalRotations = 0;
let worstMoves = 0;
let worstScramble = null;
let slowest = 0;

for (let run = 0; run < RUNS; run++) {
  const cube = new CubeState();
  const scramble = generateScramble(20);
  cube.applySequence(scramble);

  // Zufällige Startorientierung – der Coach muss Weiss selbst nach unten holen.
  for (const rot of ['x', 'y', 'z']) {
    const n = Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) cube.applyMove(rot);
  }

  let moves = 0;
  let rotations = 0;
  let steps = 0;

  while (!crossIsSolved(cube)) {
    if (++steps > 12) {
      console.log(`FAIL  keine Konvergenz nach 12 Schritten\n      ${scramble.join(' ')}`);
      failures++;
      break;
    }

    const t0 = performance.now();
    const step = planCross(readCube(cube));
    slowest = Math.max(slowest, performance.now() - t0);

    if (!step) {
      console.log(`FAIL  kein Plan gefunden\n      ${scramble.join(' ')}`);
      failures++;
      break;
    }

    const sequence = [...step.rotation, ...step.moves];
    if (sequence.length === 0) {
      console.log(`FAIL  leerer Schritt, aber Kreuz nicht fertig\n      ${scramble.join(' ')}`);
      failures++;
      break;
    }

    cube.applySequence(sequence);
    rotations += step.rotation.length;
    moves += step.moves.length;
  }

  totalMoves += moves;
  totalRotations += rotations;
  if (moves > worstMoves) { worstMoves = moves; worstScramble = scramble.join(' '); }
}

console.log(`Läufe                 ${RUNS}`);
console.log(`Fehler                ${failures}`);
console.log(`Züge im Schnitt       ${(totalMoves / RUNS).toFixed(2)}`);
console.log(`Drehungen im Schnitt  ${(totalRotations / RUNS).toFixed(2)}`);
console.log(`schlechtester Fall    ${worstMoves} Züge   (${worstScramble})`);
console.log(`langsamster Schritt   ${slowest.toFixed(1)} ms`);
console.log(failures === 0 ? '\nalles grün' : `\n${failures} FEHLER`);
process.exit(failures === 0 ? 0 : 1);
