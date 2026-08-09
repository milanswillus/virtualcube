/**
 * llAlgs.js – Die Standard-Algorithmensätze für OLL und PLL.
 *
 * WARUM HIER DATEN STEHEN UND KEINE SUCHE LÄUFT
 * ---------------------------------------------
 * Kreuz und F2L werden gesucht: dort gibt es keinen "richtigen" Algorithmus,
 * nur einen kurzen. Bei OLL und PLL ist das umgekehrt. Diese 57 bzw. 21 Folgen
 * SIND der Lernstoff – sie stehen so auf jedem Algorithmenblatt, sie werden mit
 * den Fingern eingeschliffen. Eine selbst gesuchte, formal kürzere Variante
 * wäre hier wertlos, weil sie in keinem Video und keiner Tabelle vorkommt.
 *
 * DIE FÄLLE STEHEN BEWUSST NICHT DABEI
 * ------------------------------------
 * Zu jedem Algorithmus gehört ein Muster. Dieses Muster wird NICHT hier
 * notiert, sondern in lastLayer.js aus dem Algorithmus selbst abgeleitet: die
 * Umkehrung auf einen gelösten Würfel angewandt ergibt genau die Stellung, die
 * er löst. Damit kann Muster und Algorithmus nicht auseinanderlaufen – und ein
 * Tippfehler bleibt nicht unbemerkt, sondern reisst ein Loch in die
 * Fallabdeckung, das `tools/verify-ll.mjs` meldet.
 *
 * ERLAUBTE ZÜGE
 * -------------
 * Nur solche, die in den KEY_LAYOUTS eine Taste haben – sonst stünde im Trainer
 * ein Zug ohne Griff. Konkret heisst das: kein `E`-Slice und kein `b`-Wide-Move.
 */

/**
 * Orientierung der letzten Ebene, Nummerierung wie im Standard (1–57).
 * `name` ist der gebräuchliche Formname; er hilft beim Wiedererkennen mehr als
 * die Nummer.
 */
export const OLL_ALGS = [
  { id: 1,  name: 'Dot',        moves: "R U2 R2 F R F' U2 R' F R F'" },
  { id: 2,  name: 'Dot',        moves: "F R U R' U' F' f R U R' U' f'" },
  { id: 3,  name: 'Dot',        moves: "f R U R' U' f' U' F R U R' U' F'" },
  { id: 4,  name: 'Dot',        moves: "f R U R' U' f' U F R U R' U' F'" },
  { id: 5,  name: 'Square',     moves: "r' U2 R U R' U r" },
  { id: 6,  name: 'Square',     moves: "r U2 R' U' R U' r'" },
  { id: 7,  name: 'Lightning',  moves: "r U R' U R U2 r'" },
  { id: 8,  name: 'Lightning',  moves: "r' U' R U' R' U2 r" },
  { id: 9,  name: 'Kite',       moves: "R U R' U' R' F R2 U R' U' F'" },
  { id: 10, name: 'Kite',       moves: "R U R' U R' F R F' R U2 R'" },
  { id: 11, name: 'Lightning',  moves: "r U R' U R' F R F' R U2 r'" },
  { id: 12, name: 'Lightning',  moves: "M' R' U' R U' R' U2 R U' R r'" },
  { id: 13, name: 'Knight',     moves: "F U R U' R2 F' R U R U' R'" },
  { id: 14, name: 'Knight',     moves: "R' F R U R' F' R F U' F'" },
  { id: 15, name: 'Knight',     moves: "r' U' r R' U' R U r' U r" },
  { id: 16, name: 'Knight',     moves: "r U r' R U R' U' r U' r'" },
  { id: 17, name: 'Dot',        moves: "F R' F' R2 r' U R U' R' U' M'" },
  { id: 18, name: 'Dot',        moves: "r U R' U R U2 r2 U' R U' R' U2 r" },
  { id: 19, name: 'Dot',        moves: "r' R U R U R' U' M' R' F R F'" },
  { id: 20, name: 'Dot',        moves: "r U R' U' M2 U R U' R' U' M'" },
  { id: 21, name: 'Cross H',    moves: "R U2 R' U' R U R' U' R U' R'" },
  { id: 22, name: 'Cross Pi',   moves: "R U2 R2 U' R2 U' R2 U2 R" },
  { id: 23, name: 'Cross U',    moves: "R2 D' R U2 R' D R U2 R" },
  { id: 24, name: 'Cross T',    moves: "r U R' U' r' F R F'" },
  { id: 25, name: 'Cross L',    moves: "F' r U R' U' r' F R" },
  { id: 26, name: 'Antisune',   moves: "R U2 R' U' R U' R'" },
  { id: 27, name: 'Sune',       moves: "R U R' U R U2 R'" },
  { id: 28, name: 'Shape',      moves: "r U R' U' r' R U R U' R'" },
  { id: 29, name: 'Awkward',    moves: "R U R' U' R U' R' F' U' F R U R'" },
  { id: 30, name: 'Awkward',    moves: "F R' F R2 U' R' U' R U R' F2" },
  { id: 31, name: 'P',          moves: "R' U' F U R U' R' F' R" },
  { id: 32, name: 'P',          moves: "L U F' U' L' U L F L'" },
  { id: 33, name: 'T',          moves: "R U R' U' R' F R F'" },
  { id: 34, name: 'C',          moves: "R U R2 U' R' F R U R U' F'" },
  { id: 35, name: 'Fish',       moves: "R U2 R2 F R F' R U2 R'" },
  { id: 36, name: 'W',          moves: "L' U' L U' L' U L U L F' L' F" },
  { id: 37, name: 'Fish',       moves: "F R' F' R U R U' R'" },
  { id: 38, name: 'W',          moves: "R U R' U R U' R' U' R' F R F'" },
  { id: 39, name: 'Lightning',  moves: "L F' L' U' L U F U' L'" },
  { id: 40, name: 'Lightning',  moves: "R' F R U R' U' F' U R" },
  { id: 41, name: 'Awkward',    moves: "R U R' U R U2 R' F R U R' U' F'" },
  { id: 42, name: 'Awkward',    moves: "R' U' R U' R' U2 R F R U R' U' F'" },
  { id: 43, name: 'P',          moves: "F' U' L' U L F" },
  { id: 44, name: 'P',          moves: "F U R U' R' F'" },
  { id: 45, name: 'T',          moves: "F R U R' U' F'" },
  { id: 46, name: 'C',          moves: "R' U' R' F R F' U R" },
  { id: 47, name: 'Small L',    moves: "R' U' R' F R F' R' F R F' U R" },
  { id: 48, name: 'Small L',    moves: "F R U R' U' R U R' U' F'" },
  { id: 49, name: 'Small L',    moves: "r U' r2 U r2 U r2 U' r" },
  { id: 50, name: 'Small L',    moves: "r' U r2 U' r2 U' r2 U r'" },
  { id: 51, name: 'I',          moves: "F U R U' R' U R U' R' F'" },
  { id: 52, name: 'I',          moves: "R U R' U R U' B U' B' R'" },
  { id: 53, name: 'Small L',    moves: "r' U' R U' R' U R U' R' U2 r" },
  { id: 54, name: 'Small L',    moves: "r U R' U R U' R' U R U2 r'" },
  { id: 55, name: 'I',          moves: "R U2 R2 U' R U' R' U2 F R F'" },
  { id: 56, name: 'I',          moves: "r U r' U R U' R' U R U' R' r U' r'" },
  { id: 57, name: 'H',          moves: "R U R' U' M' U R U' r'" },
];

/**
 * Permutation der letzten Ebene. Die Buchstaben sind die üblichen Namen –
 * "T-Perm", "Ua-Perm" und so weiter.
 */
export const PLL_ALGS = [
  { id: 'Aa', name: 'A-Perm',  moves: "R' F R' B2 R F' R' B2 R2" },
  { id: 'Ab', name: 'A-Perm',  moves: "R B' R F2 R' B R F2 R2" },
  { id: 'E',  name: 'E-Perm',  moves: "x' L' U L D' L' U' L D L' U' L D' L' U L D x" },
  { id: 'F',  name: 'F-Perm',  moves: "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R" },
  { id: 'Ga', name: 'G-Perm',  moves: "R2 U R' U R' U' R U' R2 U' D R' U R D'" },
  { id: 'Gb', name: 'G-Perm',  moves: "R' U' R U D' R2 U R' U R U' R U' R2 D" },
  { id: 'Gc', name: 'G-Perm',  moves: "R2 U' R U' R U R' U R2 U D' R U' R' D" },
  { id: 'Gd', name: 'G-Perm',  moves: "R U R' U' D R2 U' R U' R' U R' U R2 D'" },
  { id: 'H',  name: 'H-Perm',  moves: "M2 U M2 U2 M2 U M2" },
  { id: 'Ja', name: 'J-Perm',  moves: "R' U L' U2 R U' R' U2 R L" },
  { id: 'Jb', name: 'J-Perm',  moves: "R U R' F' R U R' U' R' F R2 U' R' U'" },
  { id: 'Na', name: 'N-Perm',  moves: "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'" },
  { id: 'Nb', name: 'N-Perm',  moves: "R' U R U' R' F' U' F R U R' F R' F' R U' R" },
  { id: 'Ra', name: 'R-Perm',  moves: "R U' R' U' R U R D R' U' R D' R' U2 R'" },
  { id: 'Rb', name: 'R-Perm',  moves: "R2 F R U R U' R' F' R U2 R' U2 R" },
  { id: 'T',  name: 'T-Perm',  moves: "R U R' U' R' F R2 U' R' U' R U R' F'" },
  { id: 'Ua', name: 'U-Perm',  moves: "R U' R U R U R U' R' U' R2" },
  { id: 'Ub', name: 'U-Perm',  moves: "R2 U R U R' U' R' U' R' U R'" },
  { id: 'V',  name: 'V-Perm',  moves: "R' U R' U' y R' F' R2 U' R' U R' F R F" },
  { id: 'Y',  name: 'Y-Perm',  moves: "F R U' R' U' R U R' F' R U R' U' R' F R F'" },
  { id: 'Z',  name: 'Z-Perm',  moves: "M2 U M2 U M' U2 M2 U2 M' U2" },
];
