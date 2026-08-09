/**
 * stats.js – Die Zeiten: speichern, laden, auswerten.
 *
 * Ein Solve ist ein flaches Objekt und wird als JSON im localStorage abgelegt.
 * Bewusst EIN Schlüssel für alles statt einer Liste je Modus: Bestzeit und
 * Schnitt sollen über beide Modi hinweg vergleichbar bleiben, und gefiltert
 * wird erst bei der Auswertung.
 *
 *   {
 *     id:       eindeutig, dient auch als Sortierschlüssel
 *     at:       Zeitstempel (ms seit Epoche) – Grundlage der Tagesansicht
 *     ms:       gestoppte Rohzeit
 *     mode:     'timer' | 'virtual'
 *     scramble: die Zugfolge, an der gelöst wurde
 *     penalty:  0 | 2000 | 'dnf'
 *     splits:   { cross, f2l, oll, pll } in ms – nur im Virtual-Modus
 *     moves:    Anzahl gedrehter Züge – nur im Virtual-Modus
 *   }
 *
 * PENALTY ALS ZAHL: "+2" ist in Millisekunden gespeichert und nicht als Flag,
 * damit `effective()` ohne Sonderfall rechnen kann. DNF bleibt ein String, weil
 * es keine Zeit ist, sondern das Fehlen einer.
 */

import { formatTime } from './timer.js';

const SOLVES_KEY = 'cherrychrono:v1:solves';

/** Vorgängername der App. Die Zeiten von damals sollen nicht verloren gehen. */
const LEGACY_SOLVES_KEY = 'mil4nde:cube:v2:solves';

/** Mehr braucht keine Auswertung, und der localStorage bleibt klein. */
const MAX_SOLVES = 2000;

/** Reihenfolge der CFOP-Abschnitte – überall dieselbe (Charts, Tabellen). */
export const PHASES = ['cross', 'f2l', 'oll', 'pll'];

/* ── Speicher ───────────────────────────────────────────────────────── */

export function loadSolves() {
  try {
    // Beim ersten Start unter dem neuen Namen die alten Zeiten übernehmen.
    const raw = localStorage.getItem(SOLVES_KEY) ?? localStorage.getItem(LEGACY_SOLVES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s?.ms === 'number') : [];
  } catch (e) {
    return [];                    // localStorage kann blockiert oder kaputt sein
  }
}

export function saveSolves(solves) {
  try {
    localStorage.setItem(SOLVES_KEY, JSON.stringify(solves.slice(-MAX_SOLVES)));
  } catch (e) { /* ignorieren – die Sitzung läuft auch ohne Speicher weiter */ }
}

/* ── Rechnen ────────────────────────────────────────────────────────── */

/**
 * Die Zeit, mit der gerechnet wird: Rohzeit plus Strafe.
 * DNF ergibt Infinity – damit sortiert und vergleicht es sich von selbst
 * richtig, ohne dass jede Auswertung den Sonderfall kennen muss.
 */
export function effective(solve) {
  if (solve.penalty === 'dnf') return Infinity;
  return solve.ms + (solve.penalty || 0);
}

/** "12.34", "1:23.45" – DNF und +2 werden mit angeschrieben. */
export function label(solve) {
  if (solve.penalty === 'dnf') return 'dnf';
  const time = formatTime(solve.ms + (solve.penalty || 0));
  return solve.penalty === 2000 ? `${time}+` : time;
}

/**
 * Average of N nach WCA: bestes und schlechtestes Ergebnis streichen, aus dem
 * Rest den Mittelwert bilden. Zwei DNF machen den Schnitt ungültig – eines
 * fällt als "schlechtestes" ohnehin heraus.
 *
 * @param {object[]} solves chronologisch; gewertet wird das Ende der Liste
 * @returns {number|null|'dnf'} ms, null = zu wenige Versuche, 'dnf' = ungültig
 */
export function average(solves, n) {
  if (solves.length < n) return null;

  const window = solves.slice(-n).map(effective).sort((a, b) => a - b);
  const counted = window.slice(1, -1);
  if (counted.some((ms) => !Number.isFinite(ms))) return 'dnf';
  return counted.reduce((a, b) => a + b, 0) / counted.length;
}

/** Schlichtes Mittel über alle gültigen Versuche. */
export function mean(solves) {
  const valid = solves.map(effective).filter(Number.isFinite);
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

export function best(solves) {
  const valid = solves.map(effective).filter(Number.isFinite);
  return valid.length ? Math.min(...valid) : null;
}

/**
 * Alles, was der Kopfbereich anzeigt – in einem Durchgang.
 * @param {object[]} solves chronologisch
 */
export function summarize(solves) {
  return {
    count: solves.length,
    best:  best(solves),
    mean:  mean(solves),
    ao5:   average(solves, 5),
    ao12:  average(solves, 12),
  };
}

/**
 * Der beste Schnitt, den es in dieser Liste je gab – nicht der aktuelle.
 * Ein Rekord, der mit dem nächsten Versuch verschwindet, ist keiner.
 */
export function bestAverage(solves, n) {
  let record = null;
  for (let i = n; i <= solves.length; i++) {
    const value = average(solves.slice(0, i), n);
    if (typeof value === 'number' && (record === null || value < record)) record = value;
  }
  return record;
}

/**
 * Die drei Bestmarken samt Datum.
 *
 * Bei den Schnitten zählt der Zeitpunkt des LETZTEN Versuchs, der dazugehört –
 * an dem war der Rekord vollständig. Beim Einzelrekord der Versuch selbst.
 *
 * @returns {{single:{ms:number,at:number}|null, ao5:object|null, ao12:object|null}}
 */
export function records(solves) {
  const out = { single: null, ao5: null, ao12: null };

  let fastest = Infinity;
  for (const solve of solves) {
    const value = effective(solve);
    if (Number.isFinite(value) && value < fastest) {
      fastest = value;
      out.single = { ms: value, at: solve.at };
    }
  }

  for (const n of [5, 12]) {
    let record = null;
    for (let i = n; i <= solves.length; i++) {
      const value = average(solves.slice(0, i), n);
      if (typeof value === 'number' && (record === null || value < record.ms)) {
        record = { ms: value, at: solves[i - 1].at };
      }
    }
    out[n === 5 ? 'ao5' : 'ao12'] = record;
  }

  return out;
}

/**
 * Anteil der letzten `n` Versuche unter einer Schwelle.
 * Die Schwelle kommt nicht von aussen, sondern aus dem eigenen Schnitt (siehe
 * `subTarget`) – so misst die Zahl immer den nächsten erreichbaren Schritt.
 */
export function subRate(solves, limit, n = 12) {
  const window = solves.slice(-n);
  if (!window.length) return null;
  const under = window.filter((s) => effective(s) < limit).length;
  return { under, of: window.length, share: under / window.length };
}

/**
 * Die Marken, in denen Cuber über ihre Zeiten reden. Bewusst eine Liste und
 * keine Rechnung: die Abstände sind oben grob und unten fein, weil eine
 * Sekunde bei einem Schnitt von einer Minute nichts heisst und bei acht
 * Sekunden eine halbe Ewigkeit ist.
 */
const SUB_MILESTONES = [120, 90, 60, 45, 40, 35, 30, 25, 20, 17, 15, 13, 12, 11, 10, 9, 8, 7, 6, 5];

/**
 * Die nächste Marke unterhalb des aktuellen Schnitts, in ms.
 *
 * "Unterhalb" ist der Punkt: das Ziel muss noch offen sein. Bei einem ao12 von
 * 12,8 s ist das sub-12 und nicht sub-13 (schon erreicht) und auch nicht sub-10
 * (zu weit weg, um diese Woche etwas zu bedeuten).
 */
export function subTarget(reference) {
  if (!Number.isFinite(reference)) return null;
  const seconds = reference / 1000;
  const target = SUB_MILESTONES.find((mark) => mark < seconds);
  return target ? target * 1000 : null;
}

/**
 * Serie: Tage in Folge mit mindestens einem Versuch.
 *
 * Der heutige Tag zählt besonders: ist er leer, läuft die Serie von gestern aus
 * noch weiter (sie endet erst um Mitternacht), gilt aber als nicht bestätigt.
 * Genau das unterscheidet "du bist dran" von "du hast es verpasst".
 *
 * @param {{day:string, solves:object[]}[]} days Ergebnis von `byDay`, aufsteigend
 */
export function streaks(days) {
  let longest = 0;
  let run = 0;
  let practised = 0;

  for (const day of days) {
    if (day.solves.length) { run++; practised++; longest = Math.max(longest, run); }
    else run = 0;
  }

  const today = days[days.length - 1];
  const activeToday = Boolean(today && today.solves.length);

  /*
   * Gezählt wird ab GESTERN rückwärts, der heutige Tag kommt danach einzeln
   * dazu. Ohne diese Trennung wäre ein leerer heutiger Tag sofort ein
   * Serienende – dabei hat man bis Mitternacht noch Zeit.
   */
  let current = 0;
  for (let i = days.length - 2; i >= 0; i--) {
    if (!days[i].solves.length) break;
    current++;
  }
  if (activeToday) current++;

  return { current, longest, activeToday, practised };
}

/** Versuche je Stunde des Tages – 24 Zahlen, Ortszeit. */
export function byHour(solves) {
  const hours = new Array(24).fill(0);
  for (const solve of solves) hours[new Date(solve.at).getHours()]++;
  return hours;
}

/**
 * Tempo: Züge pro Sekunde. Nur Virtual-Solves bringen eine Zugzahl mit – am
 * Timer zählt niemand mit, und geschätzte Züge wären eine erfundene Zahl.
 *
 * @returns {{count:number, tps:number, moves:number, bestTps:number,
 *            fewestMoves:number, series:number[]}|null}
 */
export function speed(solves) {
  const counted = solves.filter((s) => s.moves > 0 && s.penalty !== 'dnf' && s.ms > 0);
  if (!counted.length) return null;

  const series = counted.map((s) => s.moves / (s.ms / 1000));
  return {
    count: counted.length,
    tps: series.reduce((a, b) => a + b, 0) / series.length,
    moves: counted.reduce((sum, s) => sum + s.moves, 0) / counted.length,
    bestTps: Math.max(...series),
    fewestMoves: Math.min(...counted.map((s) => s.moves)),
    series,
  };
}

/** "3d ago" – wie auf dem Dashboard, damit Zeitangaben überall gleich klingen. */
export function ago(ts) {
  if (!ts) return 'never';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * Mittlere Dauer je CFOP-Abschnitt über die Solves, die Splits mitbringen.
 *
 * DNF und abgebrochene Versuche bleiben draussen: eine Phase, die nie zu Ende
 * gelöst wurde, hat keine Dauer, und ein halber Wert würde den Schnitt
 * schönrechnen.
 *
 * @returns {{cross:number,f2l:number,oll:number,pll:number,count:number}|null}
 */
export function phaseAverages(solves) {
  const withSplits = solves.filter((s) => s.splits && s.penalty !== 'dnf');
  if (!withSplits.length) return null;

  const out = { count: withSplits.length };
  for (const phase of PHASES) {
    out[phase] = withSplits.reduce((sum, s) => sum + (s.splits[phase] || 0), 0)
      / withSplits.length;
  }
  return out;
}

/**
 * Der Abschnitt, der am meisten Zeit kostet – gemessen am Anteil, nicht an der
 * absoluten Dauer. Genau die Aussage, wegen der man Splits überhaupt misst.
 */
export function slowestPhase(averages) {
  if (!averages) return null;
  const total = PHASES.reduce((sum, p) => sum + averages[p], 0);
  if (!total) return null;

  const phase = PHASES.reduce((worst, p) => (averages[p] > averages[worst] ? p : worst), PHASES[0]);
  return { phase, share: averages[phase] / total };
}

/**
 * Solves nach Tagen gebündelt, lückenlos über die letzten `days` Tage.
 *
 * Lückenlos ist der Punkt: ein Tag ohne Versuche ist eine Aussage und muss im
 * Diagramm eine leere Spalte bekommen, keine übersprungene.
 *
 * @returns {{day:string, solves:object[], best:number|null, mean:number|null}[]}
 */
export function byDay(solves, days = 30) {
  const buckets = new Map();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    buckets.set(dayKey(date), []);
  }

  for (const solve of solves) {
    const key = dayKey(new Date(solve.at));
    if (buckets.has(key)) buckets.get(key).push(solve);
  }

  return [...buckets].map(([day, list]) => ({
    day,
    solves: list,
    best: best(list),
    mean: mean(list),
  }));
}

/** "2026-08-09" in Ortszeit – `toISOString()` würde nach UTC verschieben. */
export function dayKey(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Laufender ao5 je Versuch – die Linie, die im Diagramm über den Balken liegt.
 * Vor dem fünften Versuch gibt es keinen Wert; dort bleibt die Linie leer.
 * @returns {(number|null)[]} gleich lang wie `solves`
 */
export function rollingAverage(solves, n = 5) {
  return solves.map((_, i) => {
    const value = average(solves.slice(0, i + 1), n);
    return typeof value === 'number' ? value : null;
  });
}
