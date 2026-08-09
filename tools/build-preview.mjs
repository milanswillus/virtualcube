/**
 * build-preview.mjs – Backt das ganze Projekt in eine einzelne HTML-Datei.
 *
 *   node tools/build-preview.mjs   →   cube-standalone.html
 *
 * WARUM ÜBERHAUPT?
 * ----------------
 * `preview.html` lädt `js/embed.js` als `<script type="module">`. Ein Modul
 * wird per fetch geholt, und fetch auf `file://` verbietet Chrome (CORS) – ein
 * Doppelklick auf die Datei zeigt deshalb nur eine leere Seite. Deswegen der
 * lokale Server. Diese Datei hier braucht keinen: sie enthält alles selbst.
 *
 * WIE?
 * ----
 * Nicht durch Aneinanderhängen der Module. Der erste Versuch tat genau das und
 * fand dabei neun doppelt vergebene Namen (`FACES`, `encode`, `buildTable` …) –
 * in getrennten Modulen völlig in Ordnung, in einem gemeinsamen Scope hätte
 * still das falsche gewonnen.
 *
 * Stattdessen bleibt jedes Modul ein Modul: sein Quelltext wird zu einer
 * `data:`-URL, und eine Importmap verdrahtet die Pfade darauf. Die relativen
 * Importe (`./config.js`) werden dafür zu blossen Namen (`js/config.js`) –
 * relative Pfade hätten in einer data:-URL keine Basis, blosse Namen löst die
 * Importmap auf. Semantisch laufen damit dieselben ES-Module wie über den
 * Server, nur eben ohne ihn.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT   = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY  = join(ROOT, 'js/embed.js');
const OUTPUT = join(ROOT, 'cube-standalone.html');

/** `import { a, b } from './x.js';` – auch über mehrere Zeilen. */
const IMPORT = /(^import\s+(?:\{[\s\S]*?\}|[\w$]+)\s+from\s+['"])([^'"]+)(['"])/gm;

/** Modulname im Bündel: der Pfad relativ zum Projekt, also ein blosser Name. */
const idOf = (file) => relative(ROOT, file).split('\\').join('/');

/** Tiefensuche über die relativen Importe. */
function collect(file, out = new Map()) {
  if (out.has(file)) return out;
  const source = readFileSync(file, 'utf8');
  out.set(file, source);

  for (const [, , spec] of source.matchAll(IMPORT)) {
    if (spec.startsWith('.')) collect(resolve(dirname(file), spec), out);
  }
  return out;
}

const modules = collect(ENTRY);

/*
 * Jedes Modul einzeln nach base64 – der Quelltext enthält Umlaute, Backticks
 * und `</...>` in Template-Strings; base64 macht all das für JSON wie für den
 * HTML-Parser unsichtbar.
 */
const imports = {};
for (const [file, source] of modules) {
  const rewritten = source.replace(IMPORT, (match, head, spec, tail) =>
    (spec.startsWith('.')
      ? `${head}${idOf(resolve(dirname(file), spec))}${tail}`
      : match));

  const base64 = Buffer.from(rewritten, 'utf8').toString('base64');
  imports[idOf(file)] = `data:text/javascript;base64,${base64}`;
}

const css = readFileSync(join(ROOT, 'cube.css'), 'utf8').trim();

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>cube (v2)</title>
<!--
  Erzeugt von tools/build-preview.mjs – NICHT von Hand ändern.
  Alles steckt in dieser Datei, sie läuft per Doppelklick ohne Server.
-->
<link href="https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap" rel="stylesheet">
<style>
${css}

body {
  margin: 0; background: #000; color: #fff;
  font-family: 'Courier Prime', ui-monospace, SFMono-Regular, Menlo, monospace;
  --accent: #E62325;
  display: flex; justify-content: center; padding: 16px 0 40px;
}
/*
 * Breit genug für die DREIspaltige Ansicht (Trainer | Würfel | Zeit+Settings).
 * cube.css schaltet sie ab 860px Behälterbreite frei – bei 680px läge das
 * Beiwerk wieder unter dem Würfel und nähme ihm die Höhe.
 */
#mount { width: min(1280px, 100%); }
</style>
</head>
<body>
<div id="mount"></div>

<script type="importmap">
${JSON.stringify({ imports }, null, 2)}
</script>

<script type="module">
import 'js/embed.js';
window.CubeApp.mount(document.getElementById('mount'));
</script>
</body>
</html>
`;

writeFileSync(OUTPUT, html);
console.log(`${idOf(OUTPUT)}  –  ${modules.size} Module, ${(html.length / 1024).toFixed(0)} kB`);
