/**
 * verify-moves.mjs – Prüft die um Slices und Wide-Moves erweiterte Engine.
 *
 * Referenz ist durchgehend `toFaceletString()`: zwei Zugfolgen sind genau dann
 * gleichwertig, wenn sie aus dem gelösten Würfel denselben 54-Zeichen-String
 * erzeugen. Damit lassen sich die Definitionen gegen die bekannten Identitäten
 * der Notation prüfen, ohne eine zweite Wahrheit einzuführen.
 *
 *   node tools/verify-moves.mjs
 */

import { CubeState } from '../js/cubeState.js';
import { KEY_LAYOUTS, MOVE_DEFS, ROTATIONS } from '../js/config.js';
import { keysForMove, keyTableRows, keymapFor } from '../js/keys.js';

const SOLVED = new CubeState().toFaceletString();

/** Wendet eine Zugfolge (als String) auf einen gelösten Würfel an. */
const run = (seq) => {
  const cube = new CubeState();
  cube.applySequence(seq.trim().split(/\s+/).filter(Boolean));
  return cube.toFaceletString();
};

let failures = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS  ' : 'FAIL  '}${name}`);
  if (!ok) console.log(`        ist    ${actual}\n        soll   ${expected}`);
};

const equiv = (name, a, b) => check(`${name}:  ${a}  ==  ${b}`, run(a), run(b));
const solves = (name, seq) => check(`${name}:  ${seq}`, run(seq), SOLVED);

console.log('── Identitäten der Notation ─────────────────────────────');
// Eine Ganzwürfeldrehung ist die Aussenseite plus Mittelschicht plus Gegenseite.
equiv('x', 'x', "R M' L'");
equiv('y', 'y', "U E' D'");
equiv('z', 'z', "F S B'");
// Wide-Moves sind Aussenseite plus Mittelschicht.
equiv('r', 'r', "R M'");
equiv('l', 'l', 'L M');
equiv('u', 'u', "U E'");
equiv('d', 'd', 'D E');
equiv('f', 'f', 'F S');
equiv('b', 'b', "B S'");
// Wide-Move = Ganzwürfeldrehung minus Gegenseite.
equiv('r über x', 'r', "x L");
equiv('u über y', 'u', "y D");

console.log('\n── Ordnung und Umkehrung ────────────────────────────────');
for (const move of Object.keys(MOVE_DEFS)) {
  solves(`${move} x4`, `${move} ${move} ${move} ${move}`);
  solves(`${move} ${move}'`, `${move} ${move}'`);
  solves(`${move}2 ${move}2`, `${move}2 ${move}2`);
}

console.log('\n── Slices bewegen nur die Mittelschicht ─────────────────');
// M lässt die 8 Ecken unberührt: nach M M M M' M' M' (= M2) sind Ecken gleich.
{
  const cube = new CubeState();
  cube.applySequence(['M']);
  const cornersMoved = cube.cubies.filter(
    (c) => c.pos.filter((v) => v !== 0).length === 3
      && c.home.some((v, i) => v !== c.pos[i]),
  ).length;
  check('M bewegt keine Ecke', String(cornersMoved), '0');
}

console.log('\n── Kanonische Algorithmen ───────────────────────────────');
// Sune und sein Gegenstück heben sich auf.
solves('Sune + Umkehrung', "R U R' U R U2 R'   R U2 R' U' R U' R'");
// H-Perm ist selbstinvers – und braucht den neuen M-Slice.
solves('H-Perm x2', 'M2 U M2 U2 M2 U M2 '.repeat(2));
// Ua und Ub heben sich gegenseitig auf.
solves('Ua + Ub', "M2 U M U2 M' U M2   M2 U' M U2 M' U' M2");
// T-Perm ist selbstinvers.
solves('T-Perm x2', "R U R' U' R' F R2 U' R' U' R U R' F' ".repeat(2));
// Der 2-Look-OLL-Kantenalg braucht den neuen Wide-Move f.
solves('OLL-Kante + Umkehrung', "f R U R' U' f'   f U R U' R' f'");

console.log('\n── Tastenbelegung ───────────────────────────────────────');
{
  // Alles, was die Algorithmen und die Tabelle brauchen. E und Bw kommen in
  // CFOP nicht vor und bleiben bewusst ohne Taste.
  const needed = ['U', 'D', 'R', 'L', 'F', 'B', 'M', 'S', 'r', 'l', 'u', 'd', 'f'];

  for (const layout of Object.keys(KEY_LAYOUTS)) {
    // Jede Belegung zeigt auf einen Zug, den die Engine kennt.
    const unknown = Object.keys(KEY_LAYOUTS[layout]).filter((move) => !MOVE_DEFS[move[0]]);
    check(`${layout}: nur bekannte Züge`, unknown.join(',') || 'keine', 'keine');

    // Keine Taste ist doppelt vergeben.
    const keys = Object.values(KEY_LAYOUTS[layout]).flat();
    check(`${layout}: keine doppelte Taste`,
      String(new Set(keys).size), String(keys.length));

    // Jeder Zug, den die Algorithmen brauchen, ist tippbar.
    const missing = [];
    for (const face of needed) {
      for (const token of [face, `${face}'`, `${face}2`]) {
        if (!keysForMove(token, layout)) missing.push(token);
      }
    }
    check(`${layout}: alle benötigten Züge tippbar`, missing.join(',') || 'keine', 'keine');
    check(`${layout}: Tastentabelle vollständig`,
      String(keyTableRows(layout).length), '32');
  }

  // Doppelzug = Taste zweimal.
  check('R2 → zwei Anschläge', keysForMove('R2', 'qwerty').join(''), 'ii');
  check('M2 → zwei Anschläge', keysForMove('M2', 'qwerty').join(''), '..');

  // QWERTZ ist nur eine Umbeschriftung: dieselben Finger, andere Buchstaben.
  const de = keymapFor('qwertz');
  check('qwertz: ö statt ;', de['ö'], 'y');
  check('qwertz: - statt /', de['-'], "d'");
  check('qwertz: y und z vertauscht', `${de.y},${de.z}`, 'd,x');
  check('qwertz: gleicher Umfang',
    String(Object.keys(de).length), String(Object.keys(keymapFor('qwerty')).length));
}

console.log('\n── Spiegelung der Tastatur ──────────────────────────────');
{
  /** Die vier Tastenreihen des englischen Layouts, links nach rechts. */
  const ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl;', 'zxcvbnm,./'];

  /** Taste → die an der Tastaturmitte gespiegelte Taste. */
  const mirror = {};
  for (const row of ROWS) {
    const cells = [...row];
    cells.forEach((key, i) => { mirror[key] = cells[cells.length - 1 - i]; });
  }

  const km = keymapFor('qwerty');
  check('L spiegelt zu R\'', km[mirror.d], "R'");
  check('L\' spiegelt zu R', km[mirror.e], 'R');
  check('U\' spiegelt zu U',  km[mirror.f], 'U');
  check('F\' spiegelt zu F',  km[mirror.g], 'F');
  check('Lw spiegelt zu Rw\'', km[mirror.v], "r'");
  check('y spiegelt zu y\'', km[mirror[';']], "y'");
  check('x liegt auf beiden Händen', `${km.t},${km[mirror.t]}`, 'x,x');

  /*
   * Jede belegte Taste hat ihr Gegenstück auf der anderen Hand – ausser Fw und
   * Fw'. csTimer legt die beiden auf 7 und 5 statt auf ein Spiegelpaar; das ist
   * die einzige Unsymmetrie der Belegung und steht hier, damit sie sichtbar
   * bleibt statt unbemerkt zu verschwinden.
   */
  const bound = new Set(Object.values(KEY_LAYOUTS.qwerty).flat());
  const lonely = [...bound].filter((key) => !bound.has(mirror[key])).sort();
  check('nur Fw/Fw\' liegen unsymmetrisch', lonely.join(',') || 'keine', '5,7');
}

console.log('\n── Timer-Regel ──────────────────────────────────────────');
check('Rotationen starten die Uhr nicht', ROTATIONS.join(','), 'x,y,z');
check('M ist keine Rotation', String(ROTATIONS.includes('M')), 'false');

console.log(failures === 0 ? '\nalles grün' : `\n${failures} FEHLER`);
process.exit(failures === 0 ? 0 : 1);
