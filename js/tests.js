// Pruebas de las 10 conversiones con archivos generados aquí mismo. Abrir tests.html.
(async () => {
  'use strict';
  const { TOOLS, need } = window.Conv;
  const rows = document.getElementById('rows');
  const results = [];
  const noop = () => {};

  function assert(cond, msg) { if (!cond) throw new Error(msg); }
  async function expectError(promise, re) {
    try { await promise; } catch (e) { assert(re.test(e.message), `mensaje inesperado: ${e.message}`); return e.message; }
    throw new Error('debía fallar y no falló');
  }
  const run = (id, input, opts = {}) => TOOLS[id].run(input, opts, noop);

  // ---------- Generadores de archivos de prueba ----------
  function canvasOf(w, h, color) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = color; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff'; ctx.font = '40px sans-serif'; ctx.fillText(`${w}x${h}`, 20, 60);
    return c;
  }
  const blobOf = (c, type) => new Promise((r) => c.toBlob(r, type, 0.9));
  const fileOf = (data, name, type = '') => new File([data], name, { type });

  async function makeDocx(paragraphs = 3) {
    const D = await need('docx');
    const png = new Uint8Array(await (await blobOf(canvasOf(240, 160, '#4c58c9'), 'image/png')).arrayBuffer());
    const body = [];
    for (let i = 0; i < paragraphs; i++) body.push(new D.Paragraph(`Párrafo ${i + 1}. Este documento de prueba contiene texto, una tabla, una imagen y un encabezado para comprobar la conversión.`));
    const doc = new D.Document({
      sections: [{
        headers: { default: new D.Header({ children: [new D.Paragraph('Encabezado de prueba')] }) },
        children: [
          new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, children: [new D.TextRun('Informe de prueba')] }),
          ...body,
          new D.Table({
            width: { size: 100, type: D.WidthType.PERCENTAGE },
            rows: [['Producto', 'Cantidad'], ['Manzanas', '12'], ['Peras', '7']].map((r) => new D.TableRow({
              children: r.map((t) => new D.TableCell({ children: [new D.Paragraph(t)] })),
            })),
          }),
          new D.Paragraph({ children: [new D.ImageRun({ data: png, transformation: { width: 120, height: 80 } })] }),
        ],
      }],
    });
    return fileOf(await D.Packer.toBlob(doc), 'prueba.docx');
  }

  async function makePptx() {
    const P = await need('pptx');
    const p = new P();
    p.layout = 'LAYOUT_16x9';
    const s1 = p.addSlide();
    s1.addText('Diapositiva uno', { x: 0.5, y: 0.5, w: 9, h: 1, fontSize: 32, bold: true, color: '1F1D1A' });
    s1.addShape(p.ShapeType.rect, { x: 0.5, y: 2, w: 4, h: 2, fill: { color: 'CF5536' } });
    const s2 = p.addSlide();
    s2.addText('Diapositiva dos', { x: 0.5, y: 0.5, w: 9, h: 1, fontSize: 28 });
    s2.addText('Texto de ejemplo con acentos: áéíóú ñ', { x: 0.5, y: 2, w: 9, h: 1, fontSize: 18 });
    return fileOf(await p.write({ outputType: 'blob' }), 'prueba.pptx');
  }

  async function makeXlsx() {
    const XLSX = await need('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Mes', 'Ventas'], ['Enero', 1200], ['Febrero', 1350.5]]), 'Ventas');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Nombre', 'Ciudad', 'Edad'], ['Ana', 'Madrid', 34], ['Luis', 'Lima', 28]]), 'Clientes');
    return fileOf(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }), 'prueba.xlsx');
  }

  const TABLE = [['Región', 'Enero', 'Febrero', 'Marzo'], ['Norte', '1200', '1350', '1410'], ['Sur', '980', '1020', '1105'], ['Centro', '1500', '1490', '1620']];
  async function makePdf() {
    const { PDFDocument, StandardFonts, rgb } = await need('pdflib');
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const p1 = doc.addPage([595.28, 841.89]);
    p1.drawText('Informe trimestral', { x: 56, y: 770, size: 22, font: bold });
    p1.drawText('Este PDF de prueba tiene un párrafo de texto y una tabla con datos.', { x: 56, y: 740, size: 11, font });
    p1.drawText('La tabla muestra las ventas por región durante el primer trimestre.', { x: 56, y: 725, size: 11, font });
    const x0 = 56, y0 = 680, cw = 120, rh = 22;
    TABLE.forEach((r, i) => r.forEach((t, j) => {
      p1.drawRectangle({ x: x0 + j * cw, y: y0 - i * rh - 6, width: cw, height: rh, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 });
      p1.drawText(t, { x: x0 + j * cw + 6, y: y0 - i * rh, size: 11, font: i === 0 ? bold : font });
    }));
    const p2 = doc.addPage([595.28, 841.89]);
    p2.drawText('Segunda página', { x: 56, y: 770, size: 18, font: bold });
    p2.drawText('Conclusiones del informe.', { x: 56, y: 740, size: 11, font });
    return fileOf(await doc.save(), 'prueba.pdf', 'application/pdf');
  }

  async function makeScannedPdf() {
    const { PDFDocument } = await need('pdflib');
    const doc = await PDFDocument.create();
    const jpg = await doc.embedJpg(await (await blobOf(canvasOf(600, 800, '#888'), 'image/jpeg')).arrayBuffer());
    doc.addPage([595.28, 841.89]).drawImage(jpg, { x: 0, y: 0, width: 595.28, height: 841.89 });
    return fileOf(await doc.save(), 'escaneado.pdf');
  }

  // ---------- Verificadores ----------
  async function pdfPages(blob) {
    const { PDFDocument } = await need('pdflib');
    return (await PDFDocument.load(await blob.arrayBuffer())).getPageCount();
  }
  async function zipOf(blob) { return (await need('jszip')).loadAsync(await blob.arrayBuffer()); }
  const slideCount = (zip) => Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length;
  async function imgDecodes(bytes) { const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' })); return [bmp.width, bmp.height]; }

  // ---------- Pruebas ----------
  const fx = {};
  const tests = [
    ['Archivos de prueba', async () => {
      Object.assign(fx, { docx: await makeDocx(), docxLong: await makeDocx(40), pptx: await makePptx(), xlsx: await makeXlsx(), pdf: await makePdf(), scanned: await makeScannedPdf() });
      return 'docx, pptx, xlsx, pdf y pdf escaneado generados';
    }],
    ['1. JPG a PDF (2 JPG + 1 PNG, orientación automática)', async () => {
      const files = [
        fileOf(await blobOf(canvasOf(800, 600, '#b7791f'), 'image/jpeg'), 'a.jpg'),
        fileOf(await blobOf(canvasOf(600, 800, '#3b8656'), 'image/jpeg'), 'b.jpg'),
        fileOf(await blobOf(canvasOf(500, 500, '#4c58c9'), 'image/png'), 'c.png'),
      ];
      const [out] = await run('jpg-pdf', files, { size: 'a4', orientation: 'auto', margin: '10' });
      const { PDFDocument } = await need('pdflib');
      const doc = await PDFDocument.load(await out.blob.arrayBuffer());
      assert(doc.getPageCount() === 3, `páginas: ${doc.getPageCount()}`);
      const [w, h] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
      assert(w > h, 'la primera imagen (horizontal) debía ir en página horizontal');
      // La imagen JPEG debe estar tal cual dentro del PDF (sin recomprimir).
      const jpgBytes = new Uint8Array(await files[0].arrayBuffer());
      const pdfBytes = new Uint8Array(await out.blob.arrayBuffer());
      const needle = jpgBytes.slice(200, 232);
      let found = false;
      outer: for (let i = 0; i < pdfBytes.length - needle.length; i++) { for (let j = 0; j < needle.length; j++) if (pdfBytes[i + j] !== needle[j]) continue outer; found = true; break; }
      assert(found, 'los bytes JPEG originales no aparecen en el PDF');
      return '3 páginas, horizontal automática, JPEG sin recomprimir';
    }],
    ['1b. JPG a PDF respeta la rotación EXIF de fotos del móvil', async () => {
      const raw = new Uint8Array(await (await blobOf(canvasOf(800, 600, '#b7791f'), 'image/jpeg')).arrayBuffer());
      // APP1 Exif con Orientation = 6 (girar 90°), insertado tras el marcador SOI.
      const exif = [0xff, 0xe1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0];
      const jpg = new Uint8Array([...raw.slice(0, 2), ...exif, ...raw.slice(2)]);
      const [out] = await run('jpg-pdf', [fileOf(jpg, 'movil.jpg')], { size: 'imagen', orientation: 'auto', margin: '0' });
      const { PDFDocument } = await need('pdflib');
      const page = (await PDFDocument.load(await out.blob.arrayBuffer())).getPage(0);
      assert(Math.round(page.getWidth()) === 450 && Math.round(page.getHeight()) === 600, `página ${page.getWidth()}x${page.getHeight()}`);
      const pdf = await Conv.openPdf(await out.blob.arrayBuffer());
      const { canvas } = await Conv.renderPage(await pdf.getPage(1), 1);
      const px = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
      assert(px[0] > 150 && px[2] < 100, 'la imagen no ocupa la página tras girarla');
      return 'foto 800×600 con EXIF 6 → página vertical 450×600 pt';
    }],
    ['2. Word a PDF', async () => {
      const [out] = await run('word-pdf', fx.docx);
      const n = await pdfPages(out.blob);
      assert(n === 1, `páginas: ${n}`);
      return `${n} página, ${Math.round(out.blob.size / 1024)} KB`;
    }],
    ['2b. Word a PDF (documento largo, paginación)', async () => {
      const [out] = await run('word-pdf', fx.docxLong);
      const n = await pdfPages(out.blob);
      assert(n >= 2, `páginas: ${n}`);
      return `${n} páginas`;
    }],
    ['3. PowerPoint a PDF', async () => {
      const [out] = await run('ppt-pdf', fx.pptx);
      const { PDFDocument } = await need('pdflib');
      const doc = await PDFDocument.load(await out.blob.arrayBuffer());
      assert(doc.getPageCount() === 2, `páginas: ${doc.getPageCount()}`);
      const ratio = doc.getPage(0).getWidth() / doc.getPage(0).getHeight();
      assert(Math.abs(ratio - 16 / 9) < 0.05, `proporción ${ratio.toFixed(2)}`);
      return '2 páginas 16:9';
    }],
    ['4. Excel a PDF', async () => {
      const [out] = await run('excel-pdf', fx.xlsx);
      const n = await pdfPages(out.blob);
      assert(n === 2, `páginas: ${n}`);
      const pdf = await Conv.openPdf(await out.blob.arrayBuffer());
      const text = (await (await pdf.getPage(2)).getTextContent()).items.map((i) => i.str).join(' ');
      assert(text.includes('Madrid'), 'el texto de la hoja 2 no aparece');
      return '2 páginas (una por hoja), texto seleccionable';
    }],
    ['5. HTML a PDF (preparación para imprimir)', async () => {
      const f = fileOf('<html><head><title>x</title></head><body style="background:#fde">Hola</body></html>', 'p.html', 'text/html');
      const [out] = await run('html-pdf', f, { size: 'carta' });
      assert(out.html.includes('@page{size:letter'), 'falta @page');
      assert(out.html.includes('print-color-adjust:exact'), 'faltan los fondos');
      assert(out.html.includes('print()'), 'falta la llamada a imprimir');
      return 'tamaño Carta, fondos activados (el PDF lo guarda el diálogo del navegador)';
    }],
    ['6. PDF a JPG (300 ppp, ZIP)', async () => {
      const [out] = await run('pdf-jpg', fx.pdf, { dpi: '300' });
      const zip = await zipOf(out.blob);
      const names = Object.keys(zip.files);
      assert(names.length === 2, `imágenes: ${names.length}`);
      const bytes = await zip.file(names[0]).async('uint8array');
      const [w] = await imgDecodes(bytes);
      assert(Math.abs(w - Math.floor(595.28 / 72 * 300)) <= 2, `ancho ${w}`);
      assert(bytes[13] === 1 && (bytes[14] << 8 | bytes[15]) === 300, 'cabecera JFIF sin 300 ppp');
      return `2 JPG de ${w} px de ancho`;
    }],
    ['7. PDF a Word', async () => {
      const [out] = await run('pdf-word', fx.pdf);
      const zip = await zipOf(out.blob);
      const xml = await zip.file('word/document.xml').async('string');
      assert(xml.includes('Informe trimestral'), 'falta el título');
      assert(xml.includes('<w:tbl>'), 'no se creó la tabla');
      assert(xml.includes('Centro') && xml.includes('1620'), 'faltan datos de la tabla');
      const sections = (xml.match(/<w:sectPr/g) || []).length;
      assert(sections === 2, `secciones (páginas): ${sections}`);
      return '2 páginas, título, párrafos y tabla editable';
    }],
    ['8a. PDF a PowerPoint (idéntico)', async () => {
      const [out] = await run('pdf-ppt', fx.pdf, { mode: 'identico' });
      const n = slideCount(await zipOf(out.blob));
      assert(n === 2, `diapositivas: ${n}`);
      return '2 diapositivas';
    }],
    ['8b. PDF a PowerPoint (editable)', async () => {
      const [out] = await run('pdf-ppt', fx.pdf, { mode: 'editable' });
      const zip = await zipOf(out.blob);
      assert(slideCount(zip) === 2, `diapositivas: ${slideCount(zip)}`);
      const xml = await zip.file('ppt/slides/slide1.xml').async('string');
      assert(xml.includes('Informe trimestral'), 'falta el texto');
      return '2 diapositivas con texto editable';
    }],
    ['9. PDF a Excel', async () => {
      const [out] = await run('pdf-excel', fx.pdf);
      const XLSX = await need('xlsx');
      const wb = XLSX.read(await out.blob.arrayBuffer(), { type: 'array' });
      assert(wb.SheetNames.length === 1, `hojas: ${wb.SheetNames.length}`);
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      assert(aoa.length === 4 && aoa[0].length === 4, `tamaño ${aoa.length}x${aoa[0]?.length}`);
      assert(aoa[0][0] === 'Región' && aoa[3][3] === 1620, `valores: ${JSON.stringify(aoa)}`);
      return '1 hoja, tabla 4×4 con números';
    }],
    ['9b. PDF a Excel sin tablas → aviso', async () => {
      const { PDFDocument, StandardFonts } = await need('pdflib');
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      doc.addPage().drawText('Solo un párrafo sin tablas.', { x: 50, y: 700, size: 12, font });
      return expectError(run('pdf-excel', fileOf(await doc.save(), 'texto.pdf')), /No se detectaron tablas/);
    }],
    ['10. PDF a PDF/A-2b', async () => {
      const [out] = await run('pdf-pdfa', fx.pdf, { level: '2b' });
      assert(out.ok, out.warnings.join(' '));
      assert(await pdfPages(out.blob) === 2, 'páginas');
      return out.warnings.at(-1);
    }],
    ['10b. PDF a PDF/A-1b', async () => {
      const [out] = await run('pdf-pdfa', fx.pdf, { level: '1b' });
      assert(out.ok, out.warnings.join(' '));
      return 'cumple la validación básica';
    }],
    ['Error: PDF escaneado sin texto', () => expectError(run('pdf-word', fx.scanned), /escaneado/)],
    ['Error: PDF dañado', () => expectError(run('pdf-jpg', fileOf('%PDF-1.7\nbasura sin estructura', 'roto.pdf')), /dañado/)],
    ['Error: extensión falsa (PNG llamado .pdf)', async () => expectError(run('pdf-jpg', fileOf(await blobOf(canvasOf(10, 10, '#000'), 'image/png'), 'falso.pdf')), /no lo es/)],
    ['Error: formato no válido', () => expectError(run('word-pdf', fileOf('hola', 'nota.txt')), /Formato no válido/)],
    ['Error: Office protegido o antiguo', () => expectError(run('word-pdf', fileOf(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), 'secreto.docx')), /contraseña/)],
  ];

  for (const [name, fn] of tests) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td></td><td>…</td><td></td><td></td>`;
    tr.cells[0].textContent = name;
    rows.append(tr);
    const t0 = performance.now();
    let ok = true, detail = '';
    try { detail = (await fn()) || ''; } catch (e) { ok = false; detail = e.message; console.error(name, e); }
    const ms = Math.round(performance.now() - t0);
    tr.cells[1].innerHTML = ok ? '<span class="pass">OK</span>' : '<span class="fail">FALLO</span>';
    tr.cells[2].textContent = detail;
    tr.cells[3].textContent = ms;
    results.push({ name, ok, detail, ms });
  }
  const failed = results.filter((r) => !r.ok).length;
  document.getElementById('summary').textContent = failed ? `${failed} de ${results.length} pruebas fallaron.` : `Las ${results.length} pruebas pasaron.`;
  window.__results = results;
})();
