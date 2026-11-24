// Corre tests.html en Chromium sin ventana y falla si alguna prueba no pasa. Lo usa la CI.
// Uso: npm install --no-save playwright && npx playwright install chromium && node scripts/pruebas-navegador.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

const servidor = createServer(async (req, res) => {
  const ruta = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  try {
    const cuerpo = await readFile(join(RAIZ, ruta || 'index.html'));
    res.writeHead(200, { 'content-type': TIPOS[extname(ruta)] ?? 'application/octet-stream' }).end(cuerpo);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const url = `http://localhost:${servidor.address().port}/tests.html`;

const navegador = await chromium.launch();
const pagina = await navegador.newPage();
const errores = [];
pagina.on('pageerror', (e) => errores.push(e.message));
await pagina.goto(url);
// Las pruebas descargan librerías de CDN y Ghostscript (16 MB): se les da tiempo de sobra.
await pagina.waitForFunction(() => /pruebas pasaron|fallaron|fall/i.test(document.body.innerText), null, { timeout: 180_000 });
const filas = await pagina.$$eval('tbody tr', (trs) => trs.map((tr) => [...tr.cells].map((c) => c.innerText.trim())));
await navegador.close();
servidor.close();

for (const [prueba, resultado, detalle] of filas) console.log(`${resultado === 'OK' ? 'ok  ' : 'FALLA'} ${prueba}${resultado === 'OK' ? '' : ` — ${detalle}`}`);
const fallas = filas.filter(([, r]) => r !== 'OK');
if (errores.length) console.log('Errores de la página:', errores);
console.log(`\n${filas.length - fallas.length}/${filas.length} pruebas pasaron.`);
process.exit(fallas.length || errores.length || !filas.length ? 1 : 0);
