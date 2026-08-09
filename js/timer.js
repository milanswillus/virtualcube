/**
 * timer.js – Stoppuhr auf Basis von performance.now().
 *
 * Bewusst ohne eigenes Intervall: die Anzeige wird von main.js pro Frame
 * aktualisiert, solange der Timer läuft.
 */

export class Timer {
  constructor() {
    this.reset();
  }

  reset() {
    this.startedAt = 0;
    this.stoppedAt = 0;
    this.running = false;
  }

  start() {
    this.startedAt = performance.now();
    this.stoppedAt = 0;
    this.running = true;
  }

  /** @returns {number} gestoppte Zeit in Millisekunden */
  stop() {
    if (this.running) {
      this.stoppedAt = performance.now();
      this.running = false;
    }
    return this.elapsed;
  }

  /** Verstrichene Zeit in ms – live, solange der Timer läuft. */
  get elapsed() {
    if (!this.startedAt) return 0;
    return (this.running ? performance.now() : this.stoppedAt) - this.startedAt;
  }
}

/** Formatiert ms als "12.34" bzw. "1:23.45". */
export function formatTime(ms) {
  const total = ms / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return minutes > 0
    ? `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`
    : seconds.toFixed(2);
}

/**
 * Average of 5 nach WCA: bestes und schlechtestes Ergebnis streichen,
 * aus dem Rest den Mittelwert bilden.
 * @param {number[]} times ms, chronologisch
 */
export function averageOf(times, n = 5) {
  if (times.length < n) return null;
  const window = times.slice(-n).sort((a, b) => a - b).slice(1, -1);
  return window.reduce((a, b) => a + b, 0) / window.length;
}
