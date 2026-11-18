// Motores de conversión. Todo se ejecuta en el navegador: ningún archivo sale del dispositivo.
(() => {
  'use strict';

  const MAX_BYTES = 50 * 1024 * 1024;
  const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  // Límite de píxeles por lienzo: iOS no admite más de ~16,7 M.
  const MAX_CANVAS_PX = IS_MOBILE ? 16e6 : 100e6;

  class ConvError extends Error {}

  // ---------- Carga perezosa de librerías ----------
  const GS_BASE = 'https://cdn.jsdelivr.net/npm/@jspawn/ghostscript-wasm@0.0.2/';
  const LIBS = {
    pdflib: { url: 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js', global: 'PDFLib' },
    pdfjs: {
      url: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', global: 'pdfjsLib',
      async init(lib) {
        // Un worker de otro dominio no se puede crear directamente: se carga como blob.
        const src = await (await fetch('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js')).text();
        lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      },
    },
    jszip: { url: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', global: 'JSZip' },
    pptx: { url: 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js', global: 'PptxGenJS' },
    docx: { url: 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js', global: 'docx', isolate: true },
    docxPreview: { url: 'https://cdn.jsdelivr.net/npm/docx-preview@0.3.3/dist/docx-preview.min.js', global: 'docx', isolate: true, deps: ['jszip'] },
    xlsx: { url: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', global: 'XLSX' },
    html2canvas: { url: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', global: 'html2canvas' },
    jspdf: { url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', global: 'jspdf' },
    autotable: { url: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js', global: 'jspdf', deps: ['jspdf'] },
    pptxPreview: { url: 'https://cdn.jsdelivr.net/npm/pptx-preview@1.0.7/dist/pptx-preview.umd.js', global: 'pptxPreview' },
  };
  const loading = {};

  function addScript(url) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = resolve;
      s.onerror = () => reject(new ConvError('No se pudo cargar un componente necesario. Comprueba tu conexión a internet y vuelve a intentarlo.'));
      document.head.append(s);
    });
  }

  function need(name) {
    if (!loading[name]) {
      loading[name] = (async () => {
        const lib = LIBS[name];
        for (const d of lib.deps || []) await need(d);
        // docx y docx-preview usan el mismo nombre global: se aíslan.
        const prev = window[lib.global];
        if (lib.isolate) delete window[lib.global];
        await addScript(lib.url);
        const mod = window[lib.global];
        if (lib.isolate) { if (prev === undefined) delete window[lib.global]; else window[lib.global] = prev; }
        if (lib.init) await lib.init(mod);
        return mod;
      })().catch((e) => { delete loading[name]; throw e; });
    }
    return loading[name];
  }

  // ---------- Utilidades ----------
  const baseName = (name) => name.replace(/\.[^.]+$/, '');
  const extOf = (name) => (name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || '';
  const nextFrame = () => new Promise((r) => setTimeout(r, 0));
  const canvasBlob = (canvas, type = 'image/jpeg', q = 0.92) =>
    new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new ConvError('El dispositivo se quedó sin memoria al generar la imagen. Prueba con una calidad menor.'))), type, q));

  const SIGS = {
    pdf: (b) => findAscii(b, '%PDF-', 1024),
    jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    png: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
    zip: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04,
    cfb: (b) => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0,
  };
  function findAscii(bytes, text, limit) {
    const max = Math.min(bytes.length, limit) - text.length;
    outer: for (let i = 0; i <= max; i++) {
      for (let j = 0; j < text.length; j++) if (bytes[i + j] !== text.charCodeAt(j)) continue outer;
      return true;
    }
    return false;
  }

  // Comprueba extensión, tamaño y firma real del archivo. Devuelve el ArrayBuffer.
  async function readChecked(file, exts) {
    const ext = extOf(file.name);
    if (!exts.includes(ext)) throw new ConvError(`Formato no válido: «${file.name}». Se aceptan: ${exts.map((e) => '.' + e).join(', ')}.`);
    if (file.size === 0) throw new ConvError(`«${file.name}» está vacío.`);
    if (file.size > MAX_BYTES) throw new ConvError(`«${file.name}» supera el tamaño máximo de 50 MB.`);
    const buf = await file.arrayBuffer();
    const b = new Uint8Array(buf, 0, Math.min(buf.byteLength, 1024));
    const kind = { pdf: 'pdf', jpg: 'jpg', jpeg: 'jpg', png: 'png', docx: 'zip', pptx: 'zip', xlsx: 'zip', xls: 'cfb' }[ext];
    if (kind === 'cfb') {
      if (!SIGS.cfb(b)) throw new ConvError(`«${file.name}» no es un archivo de Excel válido o está dañado.`);
    } else if (kind === 'zip' && SIGS.cfb(b)) {
      throw new ConvError(`«${file.name}» está protegido con contraseña o es de un formato antiguo. Ábrelo en Office, quita la contraseña y guárdalo como .${ext}.`);
    } else if (kind && !SIGS[kind](b)) {
      const real = Object.keys(SIGS).find((k) => k !== 'cfb' && SIGS[k](b));
      throw new ConvError(real
        ? `«${file.name}» tiene extensión .${ext} pero en realidad no lo es. Formato no válido.`
        : `«${file.name}» está dañado o no es un archivo .${ext} válido.`);
    }
    return buf;
  }

  // ---------- PDF (lectura con pdf.js) ----------
  async function openPdf(buf) {
    const pdfjs = await need('pdfjs');
    try {
      // pdf.js se queda con el buffer que recibe: se le pasa una copia.
      return await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)), isEvalSupported: false }).promise;
    } catch (e) {
      if (e?.name === 'PasswordException') throw new ConvError('El PDF está protegido con contraseña. Quita la protección y vuelve a intentarlo.');
      if (e?.name === 'InvalidPDFException' || e?.name === 'FormatError') throw new ConvError('El PDF está dañado o no es un PDF válido.');
      throw e;
    }
  }

  async function renderPage(page, scale) {
    let vp = page.getViewport({ scale });
    if (vp.width * vp.height > MAX_CANVAS_PX) {
      scale *= Math.sqrt(MAX_CANVAS_PX / (vp.width * vp.height));
      vp = page.getViewport({ scale });
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return { canvas, scale };
  }

  // Texto de una página agrupado en líneas y celdas, en puntos con origen arriba a la izquierda.
  async function pageLines(page) {
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    try { await page.getOperatorList(); } catch { /* sin datos de fuente: no se detecta negrita */ }
    const items = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const [a, b, c, d, e, f] = it.transform;
      const size = Math.hypot(c, d) || Math.hypot(a, b) || 10;
      const [x, y] = vp.convertToViewportPoint(e, f);
      let bold = false, italic = false;
      try {
        const fo = page.commonObjs.get(it.fontName);
        bold = !!(fo.bold || fo.black || /bold|black|heavy|semibold/i.test(fo.name || ''));
        italic = !!(fo.italic || /italic|oblique/i.test(fo.name || ''));
      } catch { /* fuente no disponible */ }
      items.push({ x, y, x2: x + (it.width || it.str.length * size * 0.5), size, str: it.str, bold, italic });
    }
    items.sort((p, q) => p.y - q.y || p.x - q.x);
    const rawLines = [];
    for (const it of items) {
      const line = rawLines.at(-1);
      if (line && Math.abs(line.y - it.y) < 0.45 * Math.max(line.size, it.size)) {
        line.items.push(it);
        line.size = Math.max(line.size, it.size);
      } else rawLines.push({ y: it.y, size: it.size, items: [it] });
    }
    const lines = rawLines.map((l) => {
      l.items.sort((p, q) => p.x - q.x);
      const cells = [];
      for (const it of l.items) {
        const cell = cells.at(-1);
        const gap = cell ? it.x - cell.x2 : Infinity;
        if (cell && gap < l.size * 1.0) {
          const space = gap > l.size * 0.12 && !cell.text.endsWith(' ') && !it.str.startsWith(' ');
          cell.text += (space ? ' ' : '') + it.str;
          cell.x2 = Math.max(cell.x2, it.x2);
          cell.bold = cell.bold && it.bold;
        } else cells.push({ x: it.x, x2: it.x2, text: it.str, bold: it.bold });
      }
      cells.forEach((c) => (c.text = c.text.replace(/\s+/g, ' ').trim()));
      return {
        y: l.y, size: l.size, cells,
        x: cells[0].x, x2: cells.at(-1).x2,
        bold: l.items.every((i) => i.bold), italic: l.items.every((i) => i.italic),
        text: cells.map((c) => c.text).join(' '),
      };
    });
    return { lines, width: vp.width, height: vp.height };
  }

  // Tablas: bloques de 2+ líneas seguidas con 2+ celdas. Las columnas se obtienen uniendo intervalos que se solapan.
  function findTables(lines) {
    const tables = [];
    let i = 0;
    while (i < lines.length) {
      if (lines[i].cells.length < 2) { i++; continue; }
      let j = i + 1;
      while (j < lines.length && lines[j].cells.length >= 2 && lines[j].y - lines[j - 1].y < 3 * lines[j].size) j++;
      if (j - i >= 2) {
        const t = buildTable(lines.slice(i, j));
        if (t) tables.push({ ...t, start: i, end: j });
      }
      i = j;
    }
    return tables;
  }
  function buildTable(rows) {
    const spans = rows.flatMap((r) => r.cells.map((c) => [c.x, c.x2])).sort((a, b) => a[0] - b[0]);
    const cols = [];
    for (const [a, b] of spans) {
      const last = cols.at(-1);
      if (last && a <= last[1] + 1) last[1] = Math.max(last[1], b);
      else cols.push([a, b]);
    }
    if (cols.length < 2) return null;
    const data = rows.map((r) => {
      const row = Array(cols.length).fill('');
      for (const c of r.cells) {
        let k = cols.findIndex((col) => c.x >= col[0] - 1 && c.x <= col[1]);
        if (k < 0) k = 0;
        row[k] = row[k] ? row[k] + ' ' + c.text : c.text;
      }
      return row;
    });
    return { data, size: Math.max(...rows.map((r) => r.size)) };
  }

  async function allPageLines(pdf, progress, from = 0, span = 1) {
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      pages.push(await pageLines(page));
      progress(from + (span * n) / pdf.numPages, `Leyendo página ${n} de ${pdf.numPages}`);
    }
    return pages;
  }

  const SCANNED = 'El PDF no tiene texto seleccionable (probablemente es escaneado). El reconocimiento de texto (OCR) no está disponible.';

  // ---------- Montaje de PDF a partir de imágenes renderizadas ----------
  async function imagesToPdf(pages) {
    const { PDFDocument } = await need('pdflib');
    const doc = await PDFDocument.create();
    for (const p of pages) {
      const img = await doc.embedJpg(await (await canvasBlob(p.canvas)).arrayBuffer());
      const page = doc.addPage([p.wPt, p.hPt]);
      page.drawImage(img, { x: 0, y: 0, width: p.wPt, height: p.hPt });
      p.canvas.width = p.canvas.height = 0; // libera memoria
    }
    return new Blob([await doc.save()], { type: 'application/pdf' });
  }

  function offscreen(width) {
    const host = document.createElement('div');
    host.style.cssText = `position:absolute;left:-30000px;top:0;width:${width}px;background:#fff;color:#000;`;
    document.body.append(host);
    return host;
  }

  async function capture(el, scale = 2) {
    const h2c = await need('html2canvas');
    return h2c(el, { scale, backgroundColor: '#ffffff', useCORS: true, logging: false });
  }

  // ---------- 1. JPG/PNG → PDF (sin recomprimir) ----------
  function jpegOrientation(bytes) {
    if (!SIGS.jpg(bytes)) return 1;
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let off = 2;
    while (off + 4 < v.byteLength) {
      const marker = v.getUint16(off);
      const len = v.getUint16(off + 2);
      if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) { // "Exif"
        const t = off + 10;
        const le = v.getUint16(t) === 0x4949;
        const ifd = t + v.getUint32(t + 4, le);
        const count = v.getUint16(ifd, le);
        for (let i = 0; i < count; i++) {
          const e = ifd + 2 + i * 12;
          if (e + 10 > v.byteLength) break;
          if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le);
        }
        return 1;
      }
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break;
      off += 2 + len;
    }
    return 1;
  }

  const PAGE_SIZES = { a4: [595.28, 841.89], carta: [612, 792] };
  const MM = 72 / 25.4;

  async function jpgToPdf(files, opts, progress) {
    const { PDFDocument, degrees } = await need('pdflib');
    const doc = await PDFDocument.create();
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const buf = await readChecked(file, ['jpg', 'jpeg', 'png']);
      const bytes = new Uint8Array(buf);
      let img;
      try {
        img = SIGS.png(bytes) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      } catch {
        throw new ConvError(`La imagen «${file.name}» está dañada o no se puede leer.`);
      }
      const rot = SIGS.jpg(bytes) ? { 3: 180, 6: 90, 8: 270 }[jpegOrientation(bytes)] || 0 : 0;
      const pxW = rot % 180 ? img.height : img.width;
      const pxH = rot % 180 ? img.width : img.height;
      const margin = (Number(opts.margin) || 0) * MM;
      let pageW, pageH;
      if (opts.size === 'imagen') {
        pageW = pxW * 0.75 + 2 * margin; // 96 ppp
        pageH = pxH * 0.75 + 2 * margin;
      } else {
        [pageW, pageH] = PAGE_SIZES[opts.size] || PAGE_SIZES.a4;
        const landscape = opts.orientation === 'horizontal' || (opts.orientation !== 'vertical' && pxW > pxH);
        if (landscape) [pageW, pageH] = [pageH, pageW];
      }
      const boxW = pageW - 2 * margin, boxH = pageH - 2 * margin;
      const s = Math.min(boxW / pxW, boxH / pxH);
      const dispW = pxW * s, dispH = pxH * s;
      const bx = (pageW - dispW) / 2, by = (pageH - dispH) / 2;
      const dw = img.width * s, dh = img.height * s;
      // pdf-lib gira alrededor de la esquina inferior izquierda de la imagen.
      const pos = {
        0: { x: bx, y: by },
        90: { x: bx, y: by + dw },
        180: { x: bx + dw, y: by + dh },
        270: { x: bx + dh, y: by },
      }[rot];
      const page = doc.addPage([pageW, pageH]);
      page.drawImage(img, { ...pos, width: dw, height: dh, rotate: degrees(-rot) });
      progress((i + 1) / files.length, `Imagen ${i + 1} de ${files.length}`);
    }
    const name = files.length === 1 ? baseName(files[0].name) + '.pdf' : 'imagenes.pdf';
    return [{ name, blob: new Blob([await doc.save()], { type: 'application/pdf' }) }];
  }

  // ---------- 2. Word → PDF ----------
  async function wordToPdf(file, opts, progress) {
    const buf = await readChecked(file, ['docx']);
    const JSZip = await need('jszip');
    const zip = await JSZip.loadAsync(buf).catch(() => null);
    if (!zip || !zip.file('word/document.xml')) throw new ConvError(`«${file.name}» está dañado o no es un documento de Word válido.`);
    progress(0.1, 'Leyendo el documento');
    const dp = await need('docxPreview');
    const host = offscreen(1200);
    try {
      await dp.renderAsync(buf, host, host, {
        inWrapper: false, breakPages: true, ignoreLastRenderedPageBreak: false,
        renderHeaders: true, renderFooters: true, renderFootnotes: true, experimental: true, useBase64URL: true,
      });
      await document.fonts.ready;
      await nextFrame();
      const sections = [...host.querySelectorAll('section.docx')];
      if (!sections.length) throw new ConvError(`No se pudo leer el contenido de «${file.name}».`);
      const pages = [];
      for (let i = 0; i < sections.length; i++) {
        progress(0.15 + (0.75 * i) / sections.length, `Dibujando sección ${i + 1} de ${sections.length}`);
        pages.push(...(await sliceSection(sections[i])));
      }
      progress(0.95, 'Creando el PDF');
      return [{ name: baseName(file.name) + '.pdf', blob: await imagesToPdf(pages) }];
    } finally {
      host.remove();
    }
  }

  // docx-preview no pagina el texto que desborda: se corta en páginas por los bordes de párrafos y filas.
  async function sliceSection(section) {
    const scale = 2;
    const cs = getComputedStyle(section);
    const widthPx = section.offsetWidth;
    const pageHpx = parseFloat(section.style.minHeight) ? toPx(section.style.minHeight, section) : widthPx * 1.4142;
    const padT = parseFloat(cs.paddingTop) || 0, padB = parseFloat(cs.paddingBottom) || 0;
    const canvas = await capture(section, scale);
    const wPt = widthPx * 0.75, hPt = pageHpx * 0.75;
    const totalPx = section.offsetHeight;
    if (totalPx <= pageHpx * 1.01) return [{ canvas, wPt, hPt }];

    const top = section.getBoundingClientRect().top;
    const breaks = [...new Set([...section.querySelectorAll('p, tr, li, img, h1, h2, h3, h4, h5, h6, table')]
      .filter((el) => !el.closest('header, footer'))
      .map((el) => Math.round(el.getBoundingClientRect().bottom - top)))].sort((a, b) => a - b);
    const contentEnd = totalPx - padB;
    const out = [];
    let start = 0;
    while (start < contentEnd - 1) {
      const first = out.length === 0;
      const limit = first ? pageHpx - padB : start + pageHpx - padT - padB;
      let cut = contentEnd <= limit ? contentEnd : Math.max(...breaks.filter((b) => b > start + 20 && b <= limit), -1);
      if (cut < 0) cut = limit;
      const page = document.createElement('canvas');
      page.width = Math.round(widthPx * scale);
      page.height = Math.round(pageHpx * scale);
      const ctx = page.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, page.width, page.height);
      const dy = first ? 0 : padT * scale;
      ctx.drawImage(canvas, 0, start * scale, canvas.width, (cut - start) * scale, 0, dy, canvas.width, (cut - start) * scale);
      // Repite en cada página la franja superior (encabezado) y la inferior (pie) de la sección.
      if (!first) ctx.drawImage(canvas, 0, 0, canvas.width, padT * scale, 0, 0, canvas.width, padT * scale);
      ctx.drawImage(canvas, 0, (totalPx - padB) * scale, canvas.width, padB * scale, 0, (pageHpx - padB) * scale, canvas.width, padB * scale);
      out.push({ canvas: page, wPt, hPt });
      start = cut;
    }
    canvas.width = canvas.height = 0;
    return out;
  }
  function toPx(value, el) {
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute;visibility:hidden;height:${value}`;
    el.append(probe);
    const h = probe.offsetHeight;
    probe.remove();
    return h;
  }

  // ---------- 3. PowerPoint → PDF ----------
  async function pptToPdf(file, opts, progress) {
    let buf = await readChecked(file, ['pptx']);
    const JSZip = await need('jszip');
    const zip = await JSZip.loadAsync(buf).catch(() => null);
    if (!zip || !zip.file('ppt/presentation.xml')) throw new ConvError(`«${file.name}» está dañado o no es una presentación de PowerPoint válida.`);
    progress(0.1, 'Leyendo la presentación');
    // Algunos generadores declaran partes que no existen; PowerPoint lo tolera pero el visor no.
    const ct = await zip.file('[Content_Types].xml').async('string');
    const fixed = ct.replace(/<Override\b[^>]*PartName="\/([^"]+)"[^>]*\/>/g, (m, part) => (zip.file(part) ? m : ''));
    if (fixed !== ct) {
      zip.file('[Content_Types].xml', fixed);
      buf = await zip.generateAsync({ type: 'arraybuffer' });
    }
    const pp = await need('pptxPreview');
    const host = offscreen(1280);
    try {
      const viewer = pp.init(host, { width: 1280, height: 720 });
      await viewer.preview(buf);
      await document.fonts.ready;
      await new Promise((r) => setTimeout(r, 300)); // imágenes y gráficos internos
      const slides = [...host.querySelectorAll('.pptx-preview-slide-wrapper')];
      if (!slides.length) throw new ConvError(`La presentación «${file.name}» no tiene diapositivas.`);
      const pages = [];
      for (let i = 0; i < slides.length; i++) {
        progress(0.15 + (0.75 * i) / slides.length, `Dibujando diapositiva ${i + 1} de ${slides.length}`);
        const el = slides[i];
        el.style.margin = '0';
        const canvas = await capture(el, 1.5);
        // 1280 px = 13,33 pulgadas (ancho estándar de 16:9).
        const k = 960 / el.offsetWidth;
        pages.push({ canvas, wPt: el.offsetWidth * k, hPt: el.offsetHeight * k });
      }
      progress(0.95, 'Creando el PDF');
      return [{ name: baseName(file.name) + '.pdf', blob: await imagesToPdf(pages) }];
    } finally {
      host.remove();
    }
  }

  // ---------- 4. Excel → PDF ----------
  async function excelPageSetup(buf) {
    // Orientación y ajuste de página de cada hoja (SheetJS Community no los lee).
    const JSZip = await need('jszip');
    const setup = {};
    try {
      const zip = await JSZip.loadAsync(buf);
      const wbXml = await zip.file('xl/workbook.xml').async('string');
      const rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
      const targets = {};
      for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
        const id = m[0].match(/Id="([^"]+)"/)?.[1], t = m[0].match(/Target="([^"]+)"/)?.[1];
        if (id && t) targets[id] = t.replace(/^\/?(xl\/)?/, 'xl/');
      }
      for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
        const name = unescapeXml(m[0].match(/name="([^"]+)"/)?.[1] || '');
        const rid = m[0].match(/r:id="([^"]+)"/)?.[1];
        const f = rid && zip.file(targets[rid]);
        if (!f) continue;
        const xml = await f.async('string');
        const ps = xml.match(/<pageSetup\b[^>]*>/)?.[0] || '';
        setup[name] = {
          landscape: /orientation="landscape"/.test(ps),
          fitToPage: /<pageSetUpPr\b[^>]*fitToPage="(1|true)"/.test(xml),
          fitToWidth: Number(ps.match(/fitToWidth="(\d+)"/)?.[1] ?? 1),
          scale: Number(ps.match(/\bscale="(\d+)"/)?.[1] || 100),
        };
      }
    } catch { /* .xls u hoja sin datos de página: valores por defecto */ }
    return setup;
  }
  const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

  async function excelToPdf(file, opts, progress) {
    const buf = await readChecked(file, ['xlsx', 'xls']);
    const XLSX = await need('xlsx');
    await need('autotable');
    const { jsPDF } = window.jspdf;
    let wb;
    try {
      wb = XLSX.read(buf, { type: 'array', cellNF: true, cellDates: false });
    } catch (e) {
      if (/password|encrypt/i.test(e.message)) throw new ConvError(`«${file.name}» está protegido con contraseña. Quita la protección y vuelve a intentarlo.`);
      throw new ConvError(`«${file.name}» está dañado o no es un libro de Excel válido.`);
    }
    const setup = await excelPageSetup(buf);
    const names = wb.Workbook?.Names || [];
    let doc = null;
    let printed = 0;
    for (let idx = 0; idx < wb.SheetNames.length; idx++) {
      const sheetName = wb.SheetNames[idx];
      if (wb.Workbook?.Sheets?.[idx]?.Hidden) continue;
      const ws = wb.Sheets[sheetName];
      const pa = names.find((n) => n.Name === '_xlnm.Print_Area' && n.Sheet === idx);
      const ref = pa ? pa.Ref.split(',')[0].split('!').pop().replace(/\$/g, '') : ws['!ref'];
      if (!ref) continue;
      const range = XLSX.utils.decode_range(ref);
      const rows = buildExcelRows(XLSX, ws, range);
      if (!rows.length) continue;
      const ps = setup[sheetName] || { landscape: false, fitToPage: false, fitToWidth: 1, scale: 100 };
      const orientation = ps.landscape ? 'landscape' : 'portrait';
      if (!doc) doc = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
      else doc.addPage('a4', orientation);
      const pageW = doc.internal.pageSize.getWidth();
      const margin = 36;
      const colsPt = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const col = ws['!cols']?.[c];
        colsPt.push(col?.hidden ? 0 : (col?.wpx ? col.wpx * 0.75 : col?.wch ? col.wch * 5.5 + 4 : 48));
      }
      const natural = colsPt.reduce((a, b) => a + b, 0);
      let k = ps.scale / 100;
      const fitWidth = ps.fitToPage && ps.fitToWidth === 1;
      if (fitWidth) k = Math.min(1, (pageW - 2 * margin) / natural);
      const columnStyles = {};
      colsPt.forEach((w, i) => (columnStyles[i] = { cellWidth: Math.max(w * k, 1) }));
      doc.autoTable({
        body: rows,
        startY: margin,
        margin: { top: margin, bottom: margin, left: margin, right: margin },
        theme: 'grid',
        styles: { fontSize: Math.max(10 * k, 4), cellPadding: 2 * k + 1, overflow: 'linebreak', lineColor: [200, 200, 200], lineWidth: 0.5, textColor: [0, 0, 0] },
        columnStyles,
        horizontalPageBreak: !fitWidth,
        tableWidth: 'wrap',
      });
      printed++;
      progress(0.1 + (0.85 * (idx + 1)) / wb.SheetNames.length, `Hoja ${idx + 1} de ${wb.SheetNames.length}`);
    }
    if (!printed) throw new ConvError(`El libro «${file.name}» no tiene datos que imprimir.`);
    return [{ name: baseName(file.name) + '.pdf', blob: doc.output('blob') }];
  }

  function buildExcelRows(XLSX, ws, range) {
    const merges = (ws['!merges'] || []).filter((m) => m.s.r >= range.s.r && m.s.c >= range.s.c && m.s.r <= range.e.r && m.s.c <= range.e.c);
    const covered = new Set();
    for (const m of merges) for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) if (r !== m.s.r || c !== m.s.c) covered.add(r + ':' + c);
    const rows = [];
    let lastUsed = -1;
    for (let r = range.s.r; r <= range.e.r; r++) {
      if (ws['!rows']?.[r]?.hidden) continue;
      const row = [];
      let used = false;
      for (let c = range.s.c; c <= range.e.c; c++) {
        if (covered.has(r + ':' + c)) continue;
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        const text = cell ? (cell.w ?? (cell.v == null ? '' : String(cell.v))) : '';
        if (text !== '') used = true;
        const m = merges.find((mm) => mm.s.r === r && mm.s.c === c);
        row.push({
          content: text,
          colSpan: m ? Math.min(m.e.c, range.e.c) - c + 1 : 1,
          rowSpan: m ? Math.min(m.e.r, range.e.r) - r + 1 : 1,
          styles: { halign: cell?.t === 'n' ? 'right' : 'left' },
        });
      }
      rows.push(row);
      if (used) lastUsed = rows.length - 1;
    }
    return rows.slice(0, lastUsed + 1);
  }

  // ---------- 5. HTML → PDF (motor de impresión del propio navegador) ----------
  function prepareHtml(text, opts) {
    const size = opts.size === 'carta' ? 'letter' : 'A4';
    const inject =
      `<style>@page{size:${size};margin:12mm}html,body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}</style>` +
      `<script>addEventListener('load',function(){setTimeout(function(){print()},500)})<\/script>`;
    if (/<head[^>]*>/i.test(text)) return text.replace(/<head[^>]*>/i, (m) => m + inject);
    if (/<html[^>]*>/i.test(text)) return text.replace(/<html[^>]*>/i, (m) => m + '<head>' + inject + '</head>');
    return '<!doctype html><html><head><meta charset="utf-8">' + inject + '</head><body>' + text + '</body></html>';
  }

  async function htmlToPdf(file, opts, progress) {
    const ext = extOf(file.name);
    if (!['html', 'htm'].includes(ext)) throw new ConvError(`Formato no válido: «${file.name}». Se aceptan: .html, .htm.`);
    if (file.size > MAX_BYTES) throw new ConvError(`«${file.name}» supera el tamaño máximo de 50 MB.`);
    const text = await file.text();
    if (text.slice(0, 2048).includes('\u0000')) throw new ConvError(`«${file.name}» no es un archivo HTML de texto.`);
    progress(1, 'Listo para guardar');
    return [{ name: baseName(file.name) + '.pdf', html: prepareHtml(text, opts) }];
  }

  // ---------- 6. PDF → JPG ----------
  function setJfifDpi(bytes, dpi) {
    // Canvas escribe 72 ppp; se ajusta la cabecera JFIF para que la imagen imprima a su tamaño real.
    if (bytes[2] === 0xff && bytes[3] === 0xe0 && bytes[6] === 0x4a && bytes[7] === 0x46 && bytes[8] === 0x49 && bytes[9] === 0x46) {
      bytes[13] = 1;
      bytes[14] = dpi >> 8; bytes[15] = dpi & 255;
      bytes[16] = dpi >> 8; bytes[17] = dpi & 255;
    }
    return bytes;
  }

  async function pdfToJpg(file, opts, progress) {
    const buf = await readChecked(file, ['pdf']);
    const pdf = await openPdf(buf);
    const dpi = Number(opts.dpi) || 150;
    const images = [];
    const warnings = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      progress((n - 1) / pdf.numPages, `Página ${n} de ${pdf.numPages}`);
      const page = await pdf.getPage(n);
      const { canvas, scale } = await renderPage(page, dpi / 72);
      const realDpi = Math.round(scale * 72);
      if (realDpi < dpi - 1 && !warnings.length) warnings.push(`Algunas páginas se generaron a ${realDpi} ppp por el límite de memoria del dispositivo.`);
      const bytes = setJfifDpi(new Uint8Array(await (await canvasBlob(canvas)).arrayBuffer()), realDpi);
      canvas.width = canvas.height = 0;
      images.push(bytes);
      page.cleanup();
    }
    const base = baseName(file.name);
    const firstJpg = new Blob([images[0]], { type: 'image/jpeg' });
    if (images.length === 1) return [{ name: base + '.jpg', blob: firstJpg, preview: firstJpg, warnings }];
    const JSZip = await need('jszip');
    const zip = new JSZip();
    const pad = String(images.length).length;
    images.forEach((b, i) => zip.file(`${base}-pagina-${String(i + 1).padStart(pad, '0')}.jpg`, b));
    progress(0.98, 'Creando el ZIP');
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    return [{ name: base + '-jpg.zip', blob, preview: firstJpg, warnings }];
  }

  // ---------- 7. PDF → Word ----------
  const twip = (pt) => Math.round(pt * 20);

  async function pdfToWord(file, opts, progress) {
    const buf = await readChecked(file, ['pdf']);
    const pdf = await openPdf(buf);
    const pages = await allPageLines(pdf, progress, 0, 0.8);
    if (pages.every((p) => !p.lines.length)) throw new ConvError(SCANNED);
    const D = await need('docx');
    const warnings = [];
    const empty = pages.filter((p) => !p.lines.length).length;
    if (empty) warnings.push(`${empty} página(s) sin texto (escaneadas o solo imagen) quedaron en blanco.`);
    warnings.push('Las imágenes del PDF no se copian al Word; solo el texto y las tablas.');

    const sections = pages.map((p) => {
      const lines = p.lines;
      const left = lines.length ? Math.min(Math.max(Math.min(...lines.map((l) => l.x)), 18), 108) : 72;
      const top = lines.length ? Math.min(Math.max(lines[0].y - lines[0].size, 18), 108) : 72;
      const tables = findTables(lines);
      const children = [];
      let i = 0;
      while (i < lines.length) {
        const t = tables.find((tt) => tt.start === i);
        if (t) {
          children.push(new D.Table({
            width: { size: 100, type: D.WidthType.PERCENTAGE },
            rows: t.data.map((row, r) => new D.TableRow({
              children: row.map((txt) => new D.TableCell({
                children: [new D.Paragraph({ children: [new D.TextRun({ text: txt, size: Math.round(t.size * 2), bold: r === 0 && lines[t.start].bold })] })],
              })),
            })),
          }));
          children.push(new D.Paragraph({ children: [] }));
          i = t.end;
          continue;
        }
        // Agrupa líneas consecutivas del mismo estilo en un párrafo.
        const para = [lines[i]];
        let j = i + 1;
        while (j < lines.length && !tables.some((tt) => tt.start === j)) {
          const prev = lines[j - 1], cur = lines[j];
          const sameStyle = Math.abs(cur.size - prev.size) < prev.size * 0.15 && cur.bold === prev.bold;
          if (!sameStyle || cur.y - prev.y > prev.size * 1.6) break;
          para.push(cur);
          j++;
        }
        const first = para[0];
        let text = '';
        for (const l of para) text = text.endsWith('-') ? text.slice(0, -1) + l.text : (text ? text + ' ' : '') + l.text;
        const minX = Math.min(...para.map((l) => l.x)), maxX = Math.max(...para.map((l) => l.x2));
        const centered = Math.abs((minX + maxX) / 2 - p.width / 2) < 12 && maxX - minX < p.width * 0.7 && minX - left > 24;
        const next = lines[j];
        const gapAfter = next ? next.y - para.at(-1).y - para.at(-1).size * 1.2 : 0;
        children.push(new D.Paragraph({
          alignment: centered ? D.AlignmentType.CENTER : D.AlignmentType.LEFT,
          indent: !centered && minX - left > 6 ? { left: twip(minX - left) } : undefined,
          spacing: { after: twip(Math.min(Math.max(gapAfter, 0), 24)), line: 240 },
          children: [new D.TextRun({ text, size: Math.round(first.size * 2), bold: first.bold, italics: first.italic })],
        }));
        i = j;
      }
      return {
        properties: { page: { size: { width: twip(p.width), height: twip(p.height) }, margin: { top: twip(top), bottom: twip(36), left: twip(left), right: twip(left) } } },
        children: children.length ? children : [new D.Paragraph({ children: [] })],
      };
    });
    progress(0.9, 'Creando el documento de Word');
    const doc = new D.Document({ sections });
    const blob = await D.Packer.toBlob(doc);
    return [{ name: baseName(file.name) + '.docx', blob, warnings }];
  }

  // ---------- 8. PDF → PowerPoint ----------
  async function pdfToPpt(file, opts, progress) {
    const buf = await readChecked(file, ['pdf']);
    const pdf = await openPdf(buf);
    const Pptx = await need('pptx');
    const pptx = new Pptx();
    const first = (await pdf.getPage(1)).getViewport({ scale: 1 });
    const W = first.width / 72, H = first.height / 72;
    pptx.defineLayout({ name: 'PDF', width: W, height: H });
    pptx.layout = 'PDF';
    const editable = opts.mode === 'editable';
    const warnings = [];
    let preview = null, textFound = false;
    for (let n = 1; n <= pdf.numPages; n++) {
      progress((n - 1) / pdf.numPages * 0.9, `Página ${n} de ${pdf.numPages}`);
      const page = await pdf.getPage(n);
      const slide = pptx.addSlide();
      if (!editable) {
        const vp = page.getViewport({ scale: 1 });
        const { canvas } = await renderPage(page, Math.min(200 / 72, 3000 / Math.max(vp.width, vp.height)));
        const jpg = await canvasBlob(canvas);
        if (n === 1) preview = jpg;
        const s = Math.min(W / (vp.width / 72), H / (vp.height / 72));
        const w = (vp.width / 72) * s, h = (vp.height / 72) * s;
        slide.addImage({ data: canvas.toDataURL('image/jpeg', 0.92), x: (W - w) / 2, y: (H - h) / 2, w, h });
        canvas.width = canvas.height = 0;
      } else {
        const { lines, width } = await pageLines(page);
        const k = (W * 72) / width; // por si la página es de otro tamaño
        for (const l of lines) {
          textFound = true;
          for (const c of l.cells) {
            slide.addText(c.text, {
              x: (c.x * k) / 72, y: ((l.y - l.size * 0.95) * k) / 72,
              w: Math.max(((c.x2 - c.x) * k * 1.08) / 72, 0.2), h: (l.size * 1.35 * k) / 72,
              fontSize: Math.max(Math.round(l.size * k * 10) / 10, 1), bold: c.bold, italic: l.italic,
              fontFace: 'Arial', margin: 0, valign: 'top', wrap: false, color: '000000',
            });
          }
        }
      }
      page.cleanup();
    }
    if (editable) {
      if (!textFound) throw new ConvError(SCANNED + ' Usa el modo «Idéntico».');
      warnings.push('Modo editable: solo se copia el texto (sin imágenes ni formas). El diseño puede variar respecto al original.');
    }
    progress(0.95, 'Creando la presentación');
    const blob = await pptx.write({ outputType: 'blob' });
    return [{ name: baseName(file.name) + '.pptx', blob, preview, warnings }];
  }

  // ---------- 9. PDF → Excel ----------
  async function pdfToExcel(file, opts, progress) {
    const buf = await readChecked(file, ['pdf']);
    const pdf = await openPdf(buf);
    const pages = await allPageLines(pdf, progress, 0, 0.85);
    if (pages.every((p) => !p.lines.length)) throw new ConvError(SCANNED);
    const tables = pages.flatMap((p, i) => findTables(p.lines).map((t) => ({ ...t, page: i + 1 })));
    if (!tables.length) throw new ConvError('No se detectaron tablas en este PDF. La herramienta busca texto alineado en filas y columnas; si las tablas son imágenes o el texto no está alineado, no se pueden extraer.');
    const XLSX = await need('xlsx');
    const wb = XLSX.utils.book_new();
    tables.forEach((t, i) => {
      const aoa = t.data.map((row) => row.map(toNumber));
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = t.data[0].map((_, c) => ({ wch: Math.min(Math.max(...t.data.map((r) => r[c].length), 6) + 2, 60) }));
      XLSX.utils.book_append_sheet(wb, ws, `Tabla ${i + 1} (pág ${t.page})`.slice(0, 31));
    });
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const previewHtml = XLSX.utils.sheet_to_html(wb.Sheets[wb.SheetNames[0]], { header: '', footer: '' });
    return [{
      name: baseName(file.name) + '.xlsx',
      blob: new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      previewHtml,
      warnings: [`Se encontraron ${tables.length} tabla(s); cada una está en su propia hoja.`],
    }];
  }
  function toNumber(s) {
    const t = s.trim();
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, '').replace(',', '.'));
    if (/^-?\d+,\d+$/.test(t)) return Number(t.replace(',', '.'));
    return s;
  }

  // ---------- 10. PDF → PDF/A (Ghostscript en WebAssembly) ----------
  const PDFA_DEF = `%!
/ICCProfile (%rom%iccprofiles/default_rgb.icc) def
[/_objdef {icc_PDFA} /type /stream /OBJ pdfmark
[{icc_PDFA} <</N 3>> /PUT pdfmark
[{icc_PDFA} ICCProfile (r) file /PUT pdfmark
[/_objdef {OutputIntent_PDFA} /type /dict /OBJ pdfmark
[{OutputIntent_PDFA} <<
  /Type /OutputIntent /S /GTS_PDFA1
  /DestOutputProfile {icc_PDFA}
  /OutputConditionIdentifier (sRGB IEC61966-2.1)
  /Info (sRGB IEC61966-2.1)
>> /PUT pdfmark
[{Catalog} <</OutputIntents [ {OutputIntent_PDFA} ]>> /PUT pdfmark
`;
  let gsFactory = null;

  async function runGhostscript(input, part) {
    if (!gsFactory) gsFactory = import(GS_BASE + 'gs.mjs').then((m) => m.default).catch((e) => { gsFactory = null; throw new ConvError('No se pudo cargar Ghostscript. Comprueba tu conexión a internet.'); });
    const factory = await gsFactory;
    const log = [];
    const gs = await factory({ locateFile: (f) => GS_BASE + f, print: (t) => log.push(t), printErr: (t) => log.push(t) });
    gs.FS.writeFile('/in.pdf', input);
    gs.FS.writeFile('/pdfa_def.ps', PDFA_DEF);
    const code = gs.callMain([
      `-dPDFA=${part}`, '-dBATCH', '-dNOPAUSE', '-dNOOUTERSAVE', '-dQUIET',
      '-sColorConversionStrategy=RGB', '-dPDFACompatibilityPolicy=1',
      '-sDEVICE=pdfwrite', '--permit-file-read=/', '-sOutputFile=/out.pdf', '/pdfa_def.ps', '/in.pdf',
    ]);
    let out = null;
    try { out = gs.FS.readFile('/out.pdf'); } catch { /* sin salida */ }
    return { code, out, log };
  }

  async function validatePdfa(bytes, part) {
    const L = await need('pdflib');
    const { PDFDocument, PDFName, PDFDict, PDFRawStream, decodePDFRawStream } = L;
    const problems = [];
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    if (doc.isEncrypted) problems.push('el archivo está cifrado');
    const cat = doc.catalog;
    if (!cat.get(PDFName.of('OutputIntents'))) problems.push('falta el perfil de color (OutputIntent)');
    const meta = cat.lookup(PDFName.of('Metadata'));
    let xmp = '';
    if (meta instanceof PDFRawStream) {
      try { xmp = new TextDecoder().decode(decodePDFRawStream(meta).decode()); } catch { xmp = new TextDecoder().decode(meta.contents); }
    }
    const partMatch = xmp.match(/pdfaid:part(?:\s*=\s*["']|>)\s*(\d)/);
    if (!partMatch) problems.push('faltan los metadatos XMP de identificación PDF/A');
    else if (partMatch[1] !== String(part)) problems.push(`los metadatos indican PDF/A-${partMatch[1]} en vez de PDF/A-${part}`);
    let missingFonts = 0;
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFDict && obj.get(PDFName.of('Type')) === PDFName.of('FontDescriptor')) {
        if (!['FontFile', 'FontFile2', 'FontFile3'].some((k) => obj.get(PDFName.of(k)))) missingFonts++;
      }
    }
    if (missingFonts) problems.push(`${missingFonts} fuente(s) sin incrustar`);
    return { problems, pages: doc.getPageCount() };
  }

  async function pdfToPdfa(file, opts, progress) {
    const buf = await readChecked(file, ['pdf']);
    const pdf = await openPdf(buf); // detecta contraseña o daño antes de llamar a Ghostscript
    const pagesIn = pdf.numPages;
    const level = ['1b', '2b', '3b'].includes(opts.level) ? opts.level : '2b';
    const part = Number(level[0]);
    progress(0.1, 'Cargando Ghostscript (la primera vez tarda un poco)');
    const { code, out, log } = await runGhostscript(new Uint8Array(buf), part);
    if (!out || !out.length) {
      console.warn(log.join('\n'));
      throw new ConvError('Ghostscript no pudo convertir este PDF. Es posible que esté dañado o use funciones no compatibles con PDF/A.');
    }
    progress(0.9, 'Validando el resultado');
    const { problems, pages } = await validatePdfa(out, part);
    if (pages !== pagesIn) problems.push(`el resultado tiene ${pages} páginas y el original ${pagesIn}`);
    const warnings = [];
    if (code !== 0) warnings.push('Ghostscript terminó con avisos.');
    warnings.push(problems.length
      ? `⚠ El resultado NO cumple PDF/A-${level}: ${problems.join('; ')}.`
      : `Validación básica superada (PDF/A-${level}): metadatos, perfil de color, sin cifrado y fuentes incrustadas. Para una certificación formal usa veraPDF.`);
    return [{ name: `${baseName(file.name)}-pdfa${level}.pdf`, blob: new Blob([out], { type: 'application/pdf' }), warnings, ok: !problems.length }];
  }

  // ---------- Catálogo ----------
  const TOOLS = {
    'jpg-pdf': {
      group: 'to', title: 'JPG a PDF', fmt: 'JPG', exts: ['jpg', 'jpeg', 'png'], combine: true, run: jpgToPdf,
      desc: 'Une fotos e imágenes en un solo PDF, sin perder calidad.',
      note: 'Las imágenes se insertan tal cual, sin recomprimir. Ordénalas arrastrando o con las flechas.',
      options: [
        { key: 'size', label: 'Tamaño de página', choices: [['a4', 'A4'], ['carta', 'Carta'], ['imagen', 'Igual a la imagen']] },
        { key: 'orientation', label: 'Orientación', choices: [['auto', 'Automática'], ['vertical', 'Vertical'], ['horizontal', 'Horizontal']] },
        { key: 'margin', label: 'Margen', choices: [['0', 'Sin margen'], ['10', 'Pequeño'], ['20', 'Grande']] },
      ],
    },
    'word-pdf': {
      group: 'to', title: 'Word a PDF', fmt: 'DOC', exts: ['docx'], run: wordToPdf,
      desc: 'Convierte documentos .docx en PDF.',
      note: 'Conversión aproximada: el navegador dibuja el documento. Las fuentes que no tenga tu dispositivo se sustituyen, los saltos de página pueden no coincidir con Word y el texto del PDF queda como imagen (no seleccionable).',
      approx: true,
    },
    'ppt-pdf': {
      group: 'to', title: 'PowerPoint a PDF', fmt: 'PPT', exts: ['pptx'], run: pptToPdf,
      desc: 'Una diapositiva por página.',
      note: 'Conversión básica: texto, imágenes y formas sencillas. Efectos, degradados complejos, SmartArt y fuentes especiales pueden verse distintos.',
      approx: true,
    },
    'excel-pdf': {
      group: 'to', title: 'Excel a PDF', fmt: 'XLS', exts: ['xlsx', 'xls'], run: excelToPdf,
      desc: 'Todas las hojas visibles, con texto seleccionable.',
      note: 'Respeta el área de impresión, la orientación y el ajuste a una página de ancho. No conserva colores, bordes personalizados ni gráficos.',
      approx: true,
    },
    'html-pdf': {
      group: 'to', title: 'HTML a PDF', fmt: 'HTML', exts: ['html', 'htm'], run: htmlToPdf, print: true,
      desc: 'Usa el motor de impresión del navegador.',
      note: 'Se abre el diálogo de impresión: elige «Guardar como PDF». Las imágenes con rutas relativas no se cargan; las incrustadas o con URL completa sí. Las URL no se admiten (el navegador no permite leer otras webs).',
      options: [{ key: 'size', label: 'Tamaño de página', choices: [['a4', 'A4'], ['carta', 'Carta']] }],
    },
    'pdf-jpg': {
      group: 'from', title: 'PDF a JPG', fmt: 'JPG', exts: ['pdf'], run: pdfToJpg,
      desc: 'Cada página como imagen. Varias páginas, en un ZIP.',
      note: 'Calidad de imagen idéntica a la página original a la resolución elegida.',
      options: [{ key: 'dpi', label: 'Calidad', choices: [['150', '150 ppp'], ['300', '300 ppp'], ['600', '600 ppp']] }],
    },
    'pdf-word': {
      group: 'from', title: 'PDF a Word', fmt: 'DOC', exts: ['pdf'], run: pdfToWord,
      desc: 'Texto editable con párrafos y tablas.',
      note: 'Recupera texto, tamaños, negritas, párrafos y tablas sencillas. No copia imágenes y el diseño puede variar. Los PDF escaneados no tienen texto (OCR no disponible).',
      approx: true,
    },
    'pdf-ppt': {
      group: 'from', title: 'PDF a PowerPoint', fmt: 'PPT', exts: ['pdf'], run: pdfToPpt,
      desc: 'Una página por diapositiva.',
      note: '«Idéntico»: cada página como imagen de alta resolución (se ve igual, no editable). «Editable»: el texto en cuadros de texto en su posición (el diseño puede variar).',
      options: [{ key: 'mode', label: 'Modo', choices: [['identico', 'Idéntico'], ['editable', 'Editable']] }],
    },
    'pdf-excel': {
      group: 'from', title: 'PDF a Excel', fmt: 'XLS', exts: ['pdf'], run: pdfToExcel,
      desc: 'Extrae las tablas, una hoja por tabla.',
      note: 'Detecta tablas por la alineación del texto. Funciona bien con tablas sencillas; si no encuentra ninguna, te lo dirá.',
      approx: true,
    },
    'pdf-pdfa': {
      group: 'from', title: 'PDF a PDF/A', fmt: 'PDF/A', exts: ['pdf'], run: pdfToPdfa,
      desc: 'Formato de archivo a largo plazo.',
      note: 'Usa Ghostscript dentro del navegador (unos 16 MB que se descargan la primera vez). Se valida el resultado y se avisa si no cumple.',
      options: [{ key: 'level', label: 'Nivel', choices: [['2b', 'PDF/A-2b'], ['1b', 'PDF/A-1b'], ['3b', 'PDF/A-3b']] }],
    },
  };

  window.Conv = { TOOLS, ConvError, need, openPdf, renderPage, prepareHtml, validatePdfa, MAX_BYTES, extOf, findTables, pageLines };
})();
