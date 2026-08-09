/**
 * math3d.js – Minimale 3×3-Matrixmathematik für den Würfel.
 *
 * Da ausschliesslich Vielfache von 90° vorkommen, sind alle Matrizen und
 * Vektoren ganzzahlig. Das ist wichtig: es kann sich kein Rundungsfehler
 * aufsummieren, Positionen bleiben exakt -1 / 0 / 1 und der Vergleich
 * "gelöst?" funktioniert ohne Epsilon.
 */

/** Index der Achse im Vektor [x, y, z]. */
export const AXIS_INDEX = { x: 0, y: 1, z: 2 };

/** Einheitsmatrix (= keine Drehung). */
export const identity = () => [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/**
 * Rotationsmatrix im MODELL-System (rechtshändig, y zeigt nach oben).
 * Positive Winkel drehen nach der Rechte-Hand-Regel um die Achse.
 */
export function rotationMatrix(axis, deg) {
  const rad = (deg * Math.PI) / 180;
  const c = Math.round(Math.cos(rad));
  const s = Math.round(Math.sin(rad));
  switch (axis) {
    case 'x': return [[1, 0, 0], [0, c, -s], [0, s,  c]];
    case 'y': return [[c, 0, s], [0, 1,  0], [-s, 0, c]];
    case 'z': return [[c, -s, 0], [s, c,  0], [0, 0,  1]];
    default:  throw new Error(`Unbekannte Achse: ${axis}`);
  }
}

/** Matrixprodukt a · b. */
export function multiply(a, b) {
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return out;
}

/** Matrix auf Vektor anwenden (m · v). */
export function apply(m, v) {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** Skalarprodukt. */
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/* ────────────────────────────────────────────────────────────────────────
 * Brücke Modell → CSS
 *
 * CSS benutzt ein System mit y NACH UNTEN. Der Übergang ist die Spiegelung
 * F = diag(1, -1, 1). Eine Modellrotation R erscheint in CSS als F·R·F,
 * was sich elementweise zu R'[i][j] = s_i · s_j · R[i][j] mit s = (1,-1,1)
 * vereinfacht.
 * ──────────────────────────────────────────────────────────────────────── */

const SIGN = [1, -1, 1];

/**
 * Wandelt eine Modell-Rotationsmatrix in einen CSS-`matrix3d(...)`-String.
 * matrix3d erwartet die Werte SPALTENWEISE.
 */
export function cssMatrix3d(m) {
  const c = (i, j) => SIGN[i] * SIGN[j] * m[i][j];
  return `matrix3d(${c(0, 0)},${c(1, 0)},${c(2, 0)},0,` +
         `${c(0, 1)},${c(1, 1)},${c(2, 1)},0,` +
         `${c(0, 2)},${c(1, 2)},${c(2, 2)},0,0,0,0,1)`;
}

/**
 * Winkel einer Modellrotation als CSS-Winkel.
 * Aus derselben Spiegelung folgt: Drehungen um x und z kehren ihr Vorzeichen
 * um, Drehungen um y bleiben unverändert (die Spiegelebene steht senkrecht
 * auf der y-Achse und kommutiert daher mit rotateY).
 */
export const cssAngle = (axis, deg) => (axis === 'y' ? deg : -deg);

/** Modellposition → CSS-Position (y spiegeln). */
export const cssPosition = (v, spacing) => [
  v[0] * spacing,
  -v[1] * spacing,
  v[2] * spacing,
];
