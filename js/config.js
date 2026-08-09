/**
 * config.js – Zentrale Konfiguration.
 *
 * KOORDINATENSYSTEM (Modell, rechtshändig):
 *   +x = rechts (R)   +y = oben (U)   +z = vorne/zum Betrachter (F)
 * Jede Cubie-Position ist ein Vektor aus {-1, 0, 1}³.
 *
 * ACHTUNG: CSS benutzt ein anderes System (y zeigt nach UNTEN). Die Umrechnung
 * passiert ausschliesslich in math3d.js / cubeRenderer.js – die gesamte Logik
 * arbeitet durchgehend im Modell-System.
 */

/* ── Geometrie ──────────────────────────────────────────────────────── */
export const CUBIE_SIZE = 64;   // Kantenlänge eines Cubies in px
/**
 * Bewusst 0: die Cubie-Körper stossen bündig aneinander und bilden einen
 * geschlossenen Block. Das schwarze Raster entsteht allein durch die
 * eingerückten Sticker (siehe .cb-cap). Mit einer echten Fuge blitzen an den
 * Silhouettenkanten sonst die Sticker der dahinterliegenden Seiten durch.
 */
export const CUBIE_GAP  = 0;

/**
 * Die Stickerfarben stehen NICHT hier, sondern als CSS-Variablen in cube.css
 * (--cb-U … --cb-L, je Schema). Der Renderer schreibt nur `data-face="U"` an
 * den Sticker; welche Farbe daraus wird, entscheidet allein das Stylesheet.
 * So lässt sich das Schema umschalten, ohne die 27 Cubies neu aufzubauen.
 */

/** Farbe des Würfelkörpers bzw. der nie sichtbaren Innenflächen. */
export const INNER_COLOR = '#0a0a0a';

/**
 * Voreinstellungen (siehe embed.js).
 *
 * `mode` und `scope` stehen bewusst hier mit drin, obwohl sie nicht im
 * Einstellungs-Panel auftauchen: sie werden genauso gespeichert und sollen
 * einen Reload überleben. Wer im Timer-Modus übt, will nach dem Neuladen nicht
 * wieder im Virtual-Modus landen.
 */
export const DEFAULT_SETTINGS = {
  mode:   'virtual',  // virtual | timer – Würfel am Bildschirm oder in der Hand
  scheme: 'minimal',  // classic | minimal
  view:   'ghost',    // solid | ghost | hints
  camera: 'front',    // angled | front – Blickwinkel auf den Würfel
  coach:  'on',       // on | off – CFOP-Hinweise dauerhaft einblenden
  layout: 'auto',     // auto | qwerty | qwertz – Tastaturbelegung
  scope:  'session',  // session | all – worauf sich Statistik und Diagramme beziehen
};

/**
 * Belegung, wenn keine andere feststeht.
 *
 * MUSS ein echtes Layout sein und darf nicht auf `DEFAULT_SETTINGS.layout`
 * zeigen: dort steht "auto", und "auto" ist keine Tabelle in KEY_LAYOUTS. Ein
 * Fallback auf einen Namen, den es nicht gibt, wäre kein Fallback – der erste
 * Tastendruck liefe in ein `undefined` (siehe keys.js).
 */
export const FALLBACK_LAYOUT = 'qwerty';

/**
 * Blickrichtungen, die nie zum Betrachter zeigen.
 * Für genau diese Seiten blendet der "hints"-Modus die versetzten Tafeln ein.
 * Die Kamera steht fest, Ganzwürfeldrehungen bewegen den Würfel – die drei
 * Richtungen bleiben deshalb konstant. Das gilt für beide Blickwinkel: auch
 * "front" schaut noch von oben rechts, nur flacher (siehe cube.css).
 */
export const HIDDEN_DIRECTIONS = [
  [-1,  0,  0],  // links
  [ 0, -1,  0],  // unten
  [ 0,  0, -1],  // hinten
];

/**
 * Aussennormale jeder Seite im Modell-System.
 * Daraus wird beim Aufbau bestimmt, welcher Aufkleber auf welchem Cubie sitzt.
 */
export const FACE_NORMALS = {
  U: [ 0,  1,  0],
  D: [ 0, -1,  0],
  R: [ 1,  0,  0],
  L: [-1,  0,  0],
  F: [ 0,  0,  1],
  B: [ 0,  0, -1],
};

/**
 * Definition aller Züge.
 *   axis  – Rotationsachse im Modell-System
 *   layer – betroffene Schicht(en) als Koordinate auf der Achse.
 *           Zahl = eine Schicht, Array = mehrere, null = ganzer Würfel.
 *   sign  – Vorzeichen für eine Vierteldrehung "im Uhrzeigersinn von aussen
 *           betrachtet". Nach der Rechte-Hand-Regel ist das bei den positiven
 *           Schichten (U/R/F) -90°, bei den negativen (D/L/B) +90°.
 */
export const MOVE_DEFS = {
  U: { axis: 'y', layer:  1,   sign: -1 },
  D: { axis: 'y', layer: -1,   sign: +1 },
  R: { axis: 'x', layer:  1,   sign: -1 },
  L: { axis: 'x', layer: -1,   sign: +1 },
  F: { axis: 'z', layer:  1,   sign: -1 },
  B: { axis: 'z', layer: -1,   sign: +1 },

  /*
   * Mittelschichten. Jede folgt der Drehrichtung der gleichnamigen Aussenseite:
   * M wie L, E wie D, S wie F – deshalb übernehmen sie deren `sign`.
   */
  M: { axis: 'x', layer:  0,   sign: +1 },
  E: { axis: 'y', layer:  0,   sign: +1 },
  S: { axis: 'z', layer:  0,   sign: -1 },

  /*
   * Wide-Moves: Aussenseite plus Mittelschicht, in Richtung der Aussenseite.
   * Es gilt also r = R M', l = L M, u = U E', d = D E, f = F S, b = B S'.
   */
  r: { axis: 'x', layer: [0,  1], sign: -1 },
  l: { axis: 'x', layer: [-1, 0], sign: +1 },
  u: { axis: 'y', layer: [0,  1], sign: -1 },
  d: { axis: 'y', layer: [-1, 0], sign: +1 },
  f: { axis: 'z', layer: [0,  1], sign: -1 },
  b: { axis: 'z', layer: [-1, 0], sign: +1 },

  // Ganzwürfel-Drehungen – gleiche Richtung wie die jeweils gleichnamige Seite
  x: { axis: 'x', layer: null, sign: -1 },
  y: { axis: 'y', layer: null, sign: -1 },
  z: { axis: 'z', layer: null, sign: -1 },
};

/**
 * csTimer-Tastenbelegung, notiert auf dem englischen QWERTY-Layout.
 *
 * Die Tastennamen haben bewusst nichts mit den Zugnamen zu tun – es zählt die
 * Fingerposition, nicht der Buchstabe. Ausgangsstellung sind die Zeigefinger
 * auf F und J.
 *
 * Tragendes Prinzip ist die SPIEGELUNG: spiegelt man den Würfel an der Ebene
 * zwischen L und R, so wird aus L ein R', aus U ein U', aus M ein M'. Genau
 * dieselben Paare liegen auf gespiegelten Tasten der Tastatur:
 *
 *   Zahlen  1 2 3 4 5 6 7 8 9 0      S'=1  ←→  0=S
 *   oben    q w e r t y u i o p      L'=e  ←→  i=R,   Lw'=r ←→ u=Rw,  z'=q ←→ p=z
 *   Grund   a s d f g h j k l ;      L =d  ←→  k=R',  U'=f  ←→ j=U,   y'=a ←→ ;=y
 *   unten   z x c v b n m , . /      M'=x  ←→  .=M,   Lw=v  ←→ m=Rw', Dw=z ←→ /=Dw'
 *
 * Selbstgespiegelte Züge (x, x') bekommen beide Tasten des Paars: x liegt auf
 * T und Y, x' auf B und N – dieselbe Bewegung, egal welche Hand.
 *
 * Doppelzüge (R2, M2) haben keine eigene Taste, sie werden zweimal getippt.
 * E und Bw kommen in CFOP nicht vor und bleiben ohne Taste.
 *
 * Die erste Taste einer Liste gilt als die bevorzugte – der Coach zeigt sie an.
 */
const QWERTY_KEYS = {
  U: ['j'],  "U'": ['f'],      // Zeigefinger der Grundstellung
  R: ['i'],  "R'": ['k'],      // Mittelfinger rechts
  L: ['d'],  "L'": ['e'],      // Mittelfinger links
  F: ['h'],  "F'": ['g'],      // Zeigefinger nach innen
  D: ['s'],  "D'": ['l'],      // Ringfinger
  B: ['w'],  "B'": ['o'],      // Ringfinger, obere Reihe

  M: ['.'],  "M'": ['x'],      // Mittelschichten auf der unteren Reihe
  S: ['0'],  "S'": ['1'],

  r: ['u'],  "r'": ['m'],      // Wide-Moves
  l: ['v'],  "l'": ['r'],
  u: [','],  "u'": ['c'],
  d: ['z'],  "d'": ['/'],
  f: ['7'],  "f'": ['5'],

  x: ['t', 'y'], "x'": ['b', 'n'],   // Ganzwürfel-Drehungen
  y: [';'],  "y'": ['a'],
  z: ['p'],  "z'": ['q'],
};

/**
 * Deutsches Layout: dieselben Tasten unter denselben Fingern, nur anders
 * beschriftet. Y und Z sind vertauscht, rechts neben dem L steht das Ö und
 * rechts neben dem Punkt das Minus. Alles andere liegt gleich, deshalb genügt
 * diese kurze Liste – die Spiegelungen von oben bleiben dadurch erhalten.
 */
const QWERTZ_FOR_QWERTY = { y: 'z', z: 'y', ';': 'ö', '/': '-' };

const relabel = (keys, table) => Object.fromEntries(
  Object.entries(keys).map(([move, list]) => [move, list.map((k) => table[k] ?? k)]),
);

/**
 * Zug → Tasten, je Layout. Schlüssel sind immer klein geschriebene
 * `event.key`-Werte, damit sie direkt gegen ein Tastenereignis passen.
 */
export const KEY_LAYOUTS = {
  qwerty: QWERTY_KEYS,
  qwertz: relabel(QWERTY_KEYS, QWERTZ_FOR_QWERTY),
};

/**
 * Reine Ganzwürfel-Drehungen. Sie verändern den Würfel nicht und starten
 * deshalb auch den Timer nicht – jeder andere Zug schon.
 */
export const ROTATIONS = ['x', 'y', 'z'];

/* ── Timing ─────────────────────────────────────────────────────────── */
export const TURN_DURATION     = 110;  // ms pro Zug beim Lösen
export const SCRAMBLE_DURATION =  70;  // ms pro Zug beim Mischen
export const SCRAMBLE_LENGTH   =  20;  // Züge pro Scramble
