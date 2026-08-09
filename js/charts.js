/**
 * charts.js – Die Diagramme, in der Bildsprache des Dashboards.
 *
 * Alles ist handgezeichnetes SVG ohne Bibliothek: die Formen sind einfach
 * (Balken, ein Streckenzug, ein Histogramm), und eine Bibliothek brächte ihr
 * eigenes Aussehen mit – genau das, was hier NICHT passieren soll.
 *
 * Gemeinsame Regeln, damit die drei Diagramme als ein System lesbar bleiben:
 *   • Farbe trägt nur die Daten. Achsen, Raster und Beschriftung laufen über
 *     `currentColor` mit Deckkraft und erben damit das Thema der Seite.
 *   • Die Balken enden oben abgerundet und stehen auf der Grundlinie.
 *   • Zwischen gestapelten Abschnitten bleiben 2px Luft – dadurch trennen sie
 *     sich auch dann, wenn zwei Rottöne nebeneinander liegen.
 *   • Jede Fläche, die man treffen können soll, bekommt ein unsichtbares
 *     Rechteck über die ganze Spalte. Ein 3px-Balken ist kein Ziel für eine Maus.
 */

import { formatTime } from './timer.js';
import { PHASES, effective, rollingAverage } from './stats.js';

const NS = 'http://www.w3.org/2000/svg';

/** Kürzel für die Achsen: "12.3" bzw. "1:23" – zwei Nachkommastellen wären Lärm. */
function tick(ms) {
  const total = ms / 1000;
  if (total >= 60) {
    const m = Math.floor(total / 60);
    return `${m}:${String(Math.round(total - m * 60)).padStart(2, '0')}`;
  }
  return total.toFixed(1);
}

function node(tag, attrs = {}) {
  const element = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) element.setAttribute(name, String(value));
  }
  return element;
}

function label(attrs, content) {
  const element = node('text', {
    'font-size': 9, fill: 'currentColor', 'fill-opacity': 0.4,
    'font-family': 'inherit', ...attrs,
  });
  element.textContent = content;
  return element;
}

/**
 * Balken mit abgerundeter Oberkante. Unten bleibt er eckig, weil er dort auf
 * der Grundlinie steht – ein rundes Ende würde die Achse anheben.
 */
function barPath(x, y, w, h, r = 2) {
  const radius = Math.max(0, Math.min(r, w / 2, h));
  if (h <= 0) return '';
  return `M${x},${y + h}V${y + radius}a${radius},${radius} 0 0 1 ${radius},${-radius}`
    + `h${w - radius * 2}a${radius},${radius} 0 0 1 ${radius},${radius}V${y + h}Z`;
}

/* ── Tooltip ────────────────────────────────────────────────────────── */

let tipElement = null;
let tipTheme = 'dark';

function tipNode() {
  if (!tipElement) {
    tipElement = document.createElement('div');
    tipElement.className = 'cb-tip';
    document.body.appendChild(tipElement);
  }
  tipElement.dataset.theme = tipTheme;
  return tipElement;
}

/**
 * Der Tooltip hängt am Body und erbt deshalb weder Untergrund noch die Rampe
 * von .cb-app – beides kommt über dieses data-Attribut (siehe cube.css).
 */
export function setTipTheme(theme) {
  tipTheme = theme;
  if (tipElement) tipElement.dataset.theme = theme;
}

export function hideTip() {
  if (tipElement) tipElement.classList.remove('on');
}

function showTip(event, html) {
  const tip = tipNode();
  tip.innerHTML = html;
  tip.classList.add('on');

  // Am Rand kippt der Kasten auf die andere Seite des Zeigers, statt aus dem
  // Fenster zu laufen.
  const box = tip.getBoundingClientRect();
  const x = event.clientX + 14 + box.width > window.innerWidth - 8
    ? event.clientX - box.width - 14 : event.clientX + 14;
  const y = event.clientY + 14 + box.height > window.innerHeight - 8
    ? event.clientY - box.height - 14 : event.clientY + 14;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}

/**
 * Hängt einen Tooltip an ein beliebiges Element.
 * Getrennt von `hitArea`, weil der Kalender aus HTML-Zellen besteht und keine
 * SVG-Rechtecke hat – der Tooltip soll darum trotzdem derselbe sein.
 */
function attachTip(element, html) {
  element.addEventListener('mousemove', (event) => showTip(event, html));
  element.addEventListener('mouseleave', hideTip);
}

/** Unsichtbares Trefferfeld über eine ganze Spalte. */
function hitArea(svg, rect, html) {
  const hit = node('rect', { ...rect, fill: 'transparent' });
  attachTip(hit, html);
  svg.appendChild(hit);
}

/**
 * Grundgerüst: Grösse aus dem Element lesen, viewBox setzen, leeren.
 * Gezeichnet wird in CSS-Pixeln, damit Schriftgrössen überall gleich wirken.
 *
 * Gemessen wird `clientWidth` und NICHT `getBoundingClientRect()`: gefragt ist
 * die Grösse des Zeichenbereichs im Layout, nicht die, in der er am Ende auf
 * dem Bildschirm landet. Steht über der Seite eine Skalierung (`zoom`, ein
 * `transform`), unterscheiden sich beide – und die viewBox muss zum Layout
 * passen, die Skalierung erledigt der Browser danach von selbst.
 *
 * Die viewBox bekommt bewusst KEIN `preserveAspectRatio: none`: passt sie
 * einmal nicht zur echten Breite – zwischen einer Grössenänderung und dem
 * nächsten Zeichnen –, skaliert das Bild dann gleichmässig statt in die Breite
 * gezerrt zu werden. Ein kurz zu kleines Diagramm ist zu verschmerzen, ein
 * verzerrtes nicht.
 */
function prepare(svg, height, min = 260) {
  const width = Math.max(svg.clientWidth || min, min);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.textContent = '';
  return width;
}

function emptyState(svg, width, height, text) {
  svg.appendChild(label({
    x: width / 2, y: height / 2, 'text-anchor': 'middle', 'font-size': 10, 'fill-opacity': 0.3,
  }, text));
}

/** Waagerechtes Raster mit Beschriftung – in allen Diagrammen gleich. */
function grid(svg, { left, right, top, height, max }) {
  const y = (value) => top + height - (value / max) * height;
  for (const value of [0, max / 2, max]) {
    svg.appendChild(node('line', {
      x1: left, x2: right, y1: y(value), y2: y(value),
      stroke: 'currentColor', 'stroke-opacity': value === 0 ? 0.22 : 0.07,
    }));
    if (value > 0) {
      svg.appendChild(label({ x: left - 6, y: y(value) + 3, 'text-anchor': 'end' }, tick(value)));
    }
  }
  return y;
}

/* ── 1 · Zeiten über die Versuche ───────────────────────────────────── */

/**
 * Ein Balken je Versuch, darüber der laufende ao5 als Linie.
 *
 * Beides sind Millisekunden und teilen sich deshalb EINE Achse – zwei Skalen
 * nebeneinander würden aus der Linie eine reine Dekoration machen, deren
 * Höhe nichts mit den Balken darunter zu tun hat.
 *
 * DNF bekommt einen vollhohen, schraffierten Balken: er ist nicht "unendlich
 * langsam", aber er darf auch nicht fehlen – sonst zeigt die Kurve einen
 * Fortschritt, den es nicht gab.
 */
export function renderTimes(svg, solves, { limit = 60 } = {}) {
  const height = 200;
  const width = prepare(svg, height, 320);
  const shown = solves.slice(-limit);

  if (!shown.length) {
    emptyState(svg, width, height, 'no solves yet');
    return;
  }

  const m = { t: 14, r: 8, b: 20, l: 34 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;

  const times = shown.map(effective).filter(Number.isFinite);
  const max = Math.max(...(times.length ? times : [10000])) * 1.08;
  const y = grid(svg, { left: m.l, right: width - m.r, top: m.t, height: ih, max });

  const slot = iw / shown.length;
  const bw = Math.max(Math.min(slot - 3, 22), 1.5);
  const fastest = times.length ? Math.min(...times) : null;
  const offset = solves.length - shown.length;

  shown.forEach((solve, i) => {
    const x = m.l + i * slot + (slot - bw) / 2;
    const value = effective(solve);
    const isDnf = !Number.isFinite(value);
    const h = isDnf ? ih : (value / max) * ih;
    const isBest = !isDnf && value === fastest;

    const bar = node('path', {
      d: barPath(x, m.t + ih - h, bw, h),
      fill: isDnf ? 'none' : isBest ? 'var(--cb-accent)' : 'var(--cb-bar)',
      stroke: isDnf ? 'var(--cb-line)' : 'none',
      'stroke-dasharray': isDnf ? '2 3' : null,
      class: 'cb-rise',
    });
    // Gestaffelter Einlauf: die Balken wachsen von links nach rechts hoch.
    bar.style.animationDelay = `${Math.min(i * 12, 400)}ms`;
    svg.appendChild(bar);

    const splits = solve.splits
      ? PHASES.map((p, n) => `<div class="r"><i class="dot" style="background:var(--cb-p${n})"></i>${p}<b>${formatTime(solve.splits[p])}</b></div>`).join('')
      : '';

    hitArea(svg, { x: m.l + i * slot, y: m.t, width: slot, height: ih }, `
      <div class="t">solve ${offset + i + 1} · ${solve.mode}</div>
      <div class="r"><i class="dot" style="background:var(--cb-accent)"></i>time<b>${isDnf ? 'dnf' : formatTime(value)}</b></div>
      ${splits}`);
  });

  // ao5-Linie. Sie beginnt erst beim fünften Versuch – davor gibt es keinen
  // Wert, und eine bei null anfangende Linie wäre eine Behauptung.
  const averages = rollingAverage(solves).slice(-shown.length);
  const points = averages
    .map((value, i) => (value === null ? null : `${m.l + i * slot + slot / 2},${y(value)}`))
    .filter(Boolean);

  if (points.length > 1) {
    const line = node('polyline', {
      points: points.join(' '), fill: 'none', stroke: 'currentColor',
      'stroke-opacity': 0.85, 'stroke-width': 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      // Normiert die Strichlänge auf 1 – der Einlauf in cube.css rechnet damit
      // und muss die echte Länge des Zuges nicht kennen.
      pathLength: 1,
      class: 'cb-draw',
    });
    svg.appendChild(line);
  }

  // Nur die Ränder beschriften: eine Zahl unter jedem Balken wäre nicht lesbar.
  svg.appendChild(label({ x: m.l, y: height - 6 }, `#${offset + 1}`));
  svg.appendChild(label({
    x: width - m.r, y: height - 6, 'text-anchor': 'end',
  }, `#${solves.length}`));
}

/* ── 2 · Wo die Zeit hingeht ────────────────────────────────────────── */

/**
 * Gestapelte Balken: ein Balken je Versuch, vier Abschnitte übereinander.
 *
 * Die Rampe läuft hell → dunkel in der Reihenfolge cross · f2l · oll · pll.
 * Sie ist bewusst EINE Farbe in vier Stufen und keine vier Farben: die
 * Abschnitte haben eine feste Reihenfolge, und die soll man im Bild sehen.
 */
export function renderPhases(svg, solves, { limit = 40 } = {}) {
  const height = 168;
  const width = prepare(svg, height, 300);
  const shown = solves.filter((s) => s.splits && s.penalty !== 'dnf').slice(-limit);

  if (!shown.length) {
    emptyState(svg, width, height, 'solve on the virtual cube to collect splits');
    return;
  }

  const m = { t: 12, r: 8, b: 18, l: 34 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;

  const totals = shown.map((s) => PHASES.reduce((sum, p) => sum + s.splits[p], 0));
  const max = Math.max(...totals) * 1.05;
  grid(svg, { left: m.l, right: width - m.r, top: m.t, height: ih, max });

  const slot = iw / shown.length;
  const bw = Math.max(Math.min(slot - 3, 26), 2);

  shown.forEach((solve, i) => {
    const x = m.l + i * slot + (slot - bw) / 2;
    let bottom = m.t + ih;

    PHASES.forEach((phase, n) => {
      const raw = (solve.splits[phase] / max) * ih;
      // 2px Fuge nach unten – sonst verschmelzen zwei benachbarte Rottöne.
      const h = Math.max(raw - (n === 0 ? 0 : 2), 0);
      if (h <= 0) return;

      const segment = node('rect', {
        x, y: bottom - h, width: bw, height: h,
        fill: `var(--cb-p${n})`, rx: n === PHASES.length - 1 ? 2 : 0,
        class: 'cb-rise',
      });
      segment.style.animationDelay = `${Math.min(i * 14, 400)}ms`;
      svg.appendChild(segment);
      bottom -= raw;
    });

    hitArea(svg, { x: m.l + i * slot, y: m.t, width: slot, height: ih }, `
      <div class="t">${formatTime(totals[i])} total</div>
      ${PHASES.map((p, n) => `<div class="r"><i class="dot" style="background:var(--cb-p${n})"></i>${p}<b>${formatTime(solve.splits[p])}</b></div>`).join('')}`);
  });

  svg.appendChild(label({ x: m.l, y: height - 5 }, `last ${shown.length}`));
}

/**
 * Der Schnitt je Abschnitt als ein einziger liegender Balken.
 *
 * Hier stehen die Zahlen direkt an den Abschnitten: es sind nur vier, sie
 * ändern sich langsam, und es ist die eine Stelle, an der man den Anteil
 * ablesen können soll, ohne mit der Maus darüberzufahren.
 */
export function renderPhaseBar(host, averages) {
  if (!averages) {
    host.innerHTML = '<div class="cb-empty">no splits yet</div>';
    return;
  }

  const total = PHASES.reduce((sum, p) => sum + averages[p], 0) || 1;

  host.innerHTML = `
    <div class="cb-stack">
      ${PHASES.map((phase, n) => `
        <i style="flex:${averages[phase] || 0.001}; background:var(--cb-p${n})"
           title="${phase} ${formatTime(averages[phase])}"></i>`).join('')}
    </div>
    <div class="cb-stack-key">
      ${PHASES.map((phase, n) => `
        <span><i class="dot" style="background:var(--cb-p${n})"></i>${phase}
          <b>${formatTime(averages[phase])}</b>
          <em>${Math.round((averages[phase] / total) * 100)}%</em></span>`).join('')}
    </div>`;
}

/* ── 3 · Verteilung ─────────────────────────────────────────────────── */

/**
 * Histogramm der Zeiten. Es beantwortet die Frage, die weder Balken noch
 * Schnitt beantworten: wie verlässlich ist die Zeit? Zwei Läufer mit gleichem
 * Schnitt sehen hier völlig verschieden aus.
 */
export function renderDistribution(svg, solves, { buckets = 12 } = {}) {
  const height = 132;
  const width = prepare(svg, height, 240);
  const times = solves.map(effective).filter(Number.isFinite);

  if (times.length < 3) {
    emptyState(svg, width, height, 'needs a few more solves');
    return;
  }

  const m = { t: 10, r: 6, b: 18, l: 6 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;

  const min = Math.min(...times);
  const max = Math.max(...times);
  const span = (max - min) || 1;
  const counts = new Array(buckets).fill(0);
  for (const value of times) {
    counts[Math.min(buckets - 1, Math.floor(((value - min) / span) * buckets))]++;
  }

  const peak = Math.max(...counts);
  const slot = iw / buckets;
  const bw = Math.max(slot - 2, 1.5);
  const latest = effective(solves[solves.length - 1]);
  const latestBucket = Number.isFinite(latest)
    ? Math.min(buckets - 1, Math.floor(((latest - min) / span) * buckets)) : -1;

  svg.appendChild(node('line', {
    x1: m.l, x2: width - m.r, y1: m.t + ih, y2: m.t + ih,
    stroke: 'currentColor', 'stroke-opacity': 0.22,
  }));

  counts.forEach((count, i) => {
    const h = (count / peak) * ih;
    const x = m.l + i * slot + 1;
    const current = i === latestBucket;

    if (h > 0) {
      const bar = node('path', {
        d: barPath(x, m.t + ih - h, bw, h),
        fill: current ? 'var(--cb-accent)' : 'currentColor',
        'fill-opacity': current ? 1 : 0.3,
        class: 'cb-rise',
      });
      bar.style.animationDelay = `${i * 18}ms`;
      svg.appendChild(bar);
    }

    const from = min + (span / buckets) * i;
    hitArea(svg, { x: m.l + i * slot, y: m.t, width: slot, height: ih }, `
      <div class="t">${tick(from)}s – ${tick(from + span / buckets)}s</div>
      <div class="r">solves<b>${count}</b></div>`);
  });

  svg.appendChild(label({ x: m.l, y: height - 5 }, `${tick(min)}s`));
  svg.appendChild(label({ x: width - m.r, y: height - 5, 'text-anchor': 'end' }, `${tick(max)}s`));
}

/* ── 4 · Der Kalender ───────────────────────────────────────────────── */

/** Ab wie vielen Versuchen ein Tag eine Stufe dunkler wird. */
const HEAT_STEPS = [1, 3, 6, 13];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Der Kalender wie auf GitHub: eine Spalte je Woche, eine Zeile je Wochentag.
 *
 * Bewusst HTML statt SVG. Die Zellen sollen mit der Kartenbreite mitwachsen,
 * und das erledigt ein Raster aus `1fr`-Spalten von selbst – in SVG müsste
 * dafür bei jeder Breitenänderung neu gerechnet werden.
 *
 * Die Wochen beginnen am Montag. Damit die erste Spalte vollständig ist, wird
 * vorne mit leeren Zellen aufgefüllt: sonst rutschten alle Wochentage um den
 * Wochentag des ersten Tages nach oben und die Zeilen bedeuteten nichts mehr.
 *
 * @param {HTMLElement} host    Raster der Tage
 * @param {HTMLElement} months  Leiste für die Monatskürzel darüber
 * @param {{day:string, solves:object[], best:number|null}[]} days
 */
export function renderHeatmap(host, months, days) {
  if (!days.length) { host.innerHTML = ''; months.innerHTML = ''; return; }

  // Montag = 0. `getDay()` zählt ab Sonntag, deshalb der Versatz.
  const weekday = (key) => (new Date(`${key}T00:00:00`).getDay() + 6) % 7;
  const pad = weekday(days[0].day);

  const cells = [];
  for (let i = 0; i < pad; i++) cells.push('<i data-empty></i>');
  for (const day of days) {
    const count = day.solves.length;
    const level = HEAT_STEPS.filter((step) => count >= step).length;
    cells.push(`<i data-level="${level}" data-key="${day.day}"></i>`);
  }
  host.innerHTML = cells.join('');

  // Erst jetzt die Tooltips: sie brauchen die fertigen Elemente.
  host.querySelectorAll('i[data-key]').forEach((cell) => {
    const day = days.find((d) => d.day === cell.dataset.key);
    attachTip(cell, `
      <div class="t">${day.day}</div>
      <div class="r">solves<b>${day.solves.length}</b></div>
      ${day.best ? `<div class="r">best<b>${formatTime(day.best)}</b></div>` : ''}`);
  });

  /*
   * Monatskürzel über der Spalte, in der der Monat anfängt. Die Leiste hat
   * dieselbe Spaltenzahl wie das Raster, dadurch stehen die Kürzel ohne
   * Rechnerei über der richtigen Woche.
   */
  const weeks = Math.ceil((pad + days.length) / 7);
  const labels = new Array(weeks).fill('');
  let labelled = -1;   // zuletzt beschrifteter Monat

  days.forEach((day, i) => {
    const date = new Date(`${day.day}T00:00:00`);
    const month = date.getMonth();
    if (month === labelled) return;

    /*
     * Der Monatswechsel fällt fast nie auf einen Montag – die erste Woche eines
     * Monats liegt deshalb meist in ZWEI Spalten. Beschriftet wird nur die
     * erste davon, sonst stünde jedes Kürzel doppelt.
     */
    labelled = month;
    labels[Math.floor((pad + i) / 7)] = MONTHS[month];
  });

  months.style.setProperty('--cb-weeks', weeks);
  months.innerHTML = labels.map((label) => `<span>${label}</span>`).join('');
}

/* ── 5 · Tageszeit ──────────────────────────────────────────────────── */

/**
 * Wann wird geübt? Ein Balken je Stunde. Die aktuelle Stunde trägt den Akzent,
 * die stärkste Stunde etwas mehr Deckkraft als der Rest – so sieht man die
 * eigene Gewohnheit und den eigenen Moment darin gleichzeitig.
 */
export function renderHours(svg, hours) {
  const height = 140;
  const width = prepare(svg, height, 260);
  const total = hours.reduce((a, b) => a + b, 0);

  if (!total) {
    emptyState(svg, width, height, 'no solves yet');
    return;
  }

  const m = { t: 10, r: 4, b: 20, l: 4 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const max = Math.max(...hours);
  const slot = iw / 24;
  const bw = Math.max(slot - 2, 1.5);
  const peak = hours.indexOf(max);
  const now = new Date().getHours();

  svg.appendChild(node('line', {
    x1: m.l, x2: width - m.r, y1: m.t + ih, y2: m.t + ih,
    stroke: 'currentColor', 'stroke-opacity': 0.22,
  }));

  for (let h = 0; h < 24; h++) {
    const bh = (hours[h] / max) * ih;
    const x = m.l + h * slot + 1;

    if (bh > 0) {
      const bar = node('path', {
        d: barPath(x, m.t + ih - bh, bw, bh),
        fill: h === now ? 'var(--cb-accent)' : 'currentColor',
        'fill-opacity': h === now ? 1 : h === peak ? 0.75 : 0.35,
        class: 'cb-rise',
      });
      bar.style.animationDelay = `${h * 12}ms`;
      svg.appendChild(bar);
    }

    hitArea(svg, { x: m.l + h * slot, y: m.t, width: slot, height: ih }, `
      <div class="t">${String(h).padStart(2, '0')}:00</div>
      <div class="r">solves<b>${hours[h]}</b></div>`);

    if (h % 6 === 0) {
      svg.appendChild(label({
        x: x + bw / 2, y: height - 6, 'text-anchor': 'middle',
      }, String(h).padStart(2, '0')));
    }
  }
}

/* ── 6 · Sparkline ──────────────────────────────────────────────────── */

/**
 * Fläche plus Linie, wie die Spark-Kurven auf dem Dashboard. Ohne Achsen und
 * ohne Beschriftung: sie zeigt die FORM eines Verlaufs, die Zahlen dazu stehen
 * als Kacheln daneben.
 */
export function renderSpark(svg, values) {
  const height = 36;
  const width = prepare(svg, height, 120);
  if (values.length < 2) return;

  const max = Math.max(...values, 0.001);
  const step = width / (values.length - 1);
  const points = values.map((value, i) =>
    [i * step, height - 2 - (value / max) * (height - 6)]);
  const line = points
    .map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(' ');

  svg.appendChild(node('path', {
    d: `${line} L${width} ${height} L0 ${height} Z`,
    fill: 'var(--cb-accent)', opacity: 0.12,
  }));
  svg.appendChild(node('path', {
    d: line, fill: 'none', stroke: 'var(--cb-accent)', 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    pathLength: 1, class: 'cb-draw',
  }));
}

/* ── 7 · Die letzten 30 Tage ────────────────────────────────────────── */

/**
 * Bestzeit je Tag als kleine Fläche. Leere Tage bleiben leer – eine
 * durchgezogene Linie über eine Pause hinweg würde Versuche behaupten, die es
 * nicht gab.
 */
export function renderDays(svg, days) {
  const height = 56;
  const width = prepare(svg, height, 200);
  const values = days.map((d) => d.best).filter(Number.isFinite);

  if (values.length < 2) {
    emptyState(svg, width, height, '');
    return;
  }

  const m = { t: 6, r: 2, b: 6, l: 2 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = (max - min) || 1;

  const slot = iw / Math.max(days.length - 1, 1);
  const y = (value) => m.t + ih - ((value - min) / span) * ih;

  // Kleiner Punkt je Tag mit Versuchen, verbunden nur zwischen benachbarten
  // gefüllten Tagen – die Lücken bleiben sichtbar.
  let previous = null;
  days.forEach((day, i) => {
    if (!Number.isFinite(day.best)) { previous = null; return; }
    const x = m.l + i * slot;

    if (previous) {
      svg.appendChild(node('line', {
        x1: previous.x, y1: previous.y, x2: x, y2: y(day.best),
        stroke: 'var(--cb-accent)', 'stroke-width': 2, 'stroke-linecap': 'round',
      }));
    }
    svg.appendChild(node('circle', {
      cx: x, cy: y(day.best), r: 2, fill: 'var(--cb-accent)',
    }));

    hitArea(svg, { x: x - slot / 2, y: 0, width: slot, height }, `
      <div class="t">${day.day}</div>
      <div class="r">best<b>${formatTime(day.best)}</b></div>
      <div class="r">solves<b>${day.solves.length}</b></div>`);

    previous = { x, y: y(day.best) };
  });
}
