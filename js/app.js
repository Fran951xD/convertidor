// Interfaz: portada, página de cada herramienta, lista de archivos, progreso, vista previa y descarga.
(() => {
  'use strict';
  const { TOOLS, ConvError, MAX_BYTES } = window.Conv;
  const app = document.getElementById('app');
  const FMT_COLOR = { JPG: '--f-jpg', DOC: '--f-doc', PPT: '--f-ppt', XLS: '--f-xls', HTML: '--f-html', 'PDF/A': '--f-pdfa', PDF: '--pdf' };
  let urls = [];

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtSize = (b) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

  // Dos hojas superpuestas: la de atrás es el origen y la de delante el destino.
  function sheet(x, y, fmt, cx = 14) {
    const c = `var(${FMT_COLOR[fmt]})`;
    const fs = fmt.length > 3 ? 7 : 9;
    return `<g transform="translate(${x} ${y})"><path d="M0 4a4 4 0 0 1 4-4h15l9 9v25a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4z" fill="${c}"/>` +
      `<path d="M19 0v6a3 3 0 0 0 3 3h6" fill="rgb(255 255 255 / .35)"/>` +
      `<text x="${cx}" y="29" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="800" font-size="${fs}" fill="#fff">${fmt}</text></g>`;
  }
  function icon(tool) {
    const [a, b] = tool.group === 'to' ? [tool.fmt, 'PDF'] : ['PDF', tool.fmt];
    return `<svg class="ico" viewBox="0 0 56 48" aria-hidden="true">${sheet(2, 2, a, 12)}<g opacity=".97">${sheet(26, 8, b)}</g></svg>`;
  }

  // ---------- Portada ----------
  function home() {
    document.title = 'Taller PDF';
    const col = (group, title) => `<section class="col ${group}"><h2>${title}</h2><ul class="tools">${Object.entries(TOOLS)
      .filter(([, t]) => t.group === group)
      .map(([id, t]) => `<li><a class="tool" href="#/${id}">${icon(t)}<span class="txt"><strong>${t.title}</strong><small>${t.desc}</small></span></a></li>`)
      .join('')}</ul></section>`;
    app.innerHTML = `<section class="hero"><h1>Convertí documentos sin subirlos a ningún lado</h1>
      <p>Diez herramientas para pasar archivos a PDF y desde PDF. Todo pasa en tu navegador, también en el celular.</p></section>
      <div class="columns">${col('to', 'Convertir a PDF')}${col('from', 'Convertir desde PDF')}</div>`;
  }

  // ---------- Herramienta ----------
  function toolPage(id) {
    const tool = TOOLS[id];
    document.title = `${tool.title} · Taller PDF`;
    const accent = tool.group === 'to' ? 'var(--to)' : 'var(--from)';
    const accept = tool.exts.map((e) => '.' + e).join(',');
    const opts = {};
    (tool.options || []).forEach((o) => (opts[o.key] = o.choices[0][0]));

    app.innerHTML = `
      <a href="#/" class="back">← Todas las herramientas</a>
      <div class="tool-head">${icon(tool)}<div><h1>${tool.title}</h1><p>${tool.desc}</p></div></div>
      <p class="note ${tool.approx ? 'approx' : ''}">${tool.approx ? '<strong>Aviso:</strong> ' : ''}${tool.note}</p>
      ${tool.options ? `<div class="options">${tool.options.map((o) => `<fieldset><legend>${o.label}</legend><div class="seg">${o.choices
        .map(([v, l], i) => `<label><input type="radio" name="${o.key}" value="${v}" ${i ? '' : 'checked'}><span>${l}</span></label>`)
        .join('')}</div></fieldset>`).join('')}</div>` : ''}
      <label class="drop" tabindex="0">
        <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span class="big">Arrastrá tus archivos acá o <u>elegilos</u></span>
        <small>${tool.exts.map((e) => '.' + e).join(', ')} · varios a la vez · máximo 50 MB cada uno</small>
        <input type="file" multiple accept="${accept}">
      </label>
      <ul class="files" aria-label="Archivos seleccionados"></ul>
      <div class="actions"><button class="btn primary" id="go" disabled>Convertir</button><span class="global-status" role="status" aria-live="polite"></span></div>
      <section class="results" aria-live="polite"></section>`;
    app.style.setProperty('--accent', accent);

    const drop = app.querySelector('.drop');
    const input = drop.querySelector('input');
    const list = app.querySelector('.files');
    const go = app.querySelector('#go');
    const gstatus = app.querySelector('.global-status');
    const results = app.querySelector('.results');
    let items = [];
    let busy = false;

    app.querySelectorAll('.options input').forEach((r) => r.addEventListener('change', () => (opts[r.name] = r.value)));
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => { add(input.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { if (!e.dataTransfer.types.includes('Files')) return; e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
    drop.addEventListener('drop', (e) => { e.preventDefault(); add(e.dataTransfer.files); });

    function add(fileList) {
      for (const file of fileList) {
        const ext = Conv.extOf(file.name);
        const item = { file, id: Math.random().toString(36).slice(2), error: null };
        if (!tool.exts.includes(ext)) item.error = `Formato no válido. Se aceptan: ${tool.exts.map((e) => '.' + e).join(', ')}.`;
        else if (file.size > MAX_BYTES) item.error = 'Supera el tamaño máximo de 50 MB.';
        items.push(item);
      }
      renderList();
    }

    function renderList() {
      list.innerHTML = '';
      items.forEach((it, i) => {
        const ext = Conv.extOf(it.file.name);
        const li = h(`<li class="file" data-id="${it.id}" ${tool.combine ? 'draggable="true"' : ''}>
          <span class="thumb">${esc(ext.toUpperCase())}</span>
          <div class="meta"><div class="name" title="${esc(it.file.name)}">${esc(it.file.name)}</div>
            <div class="status ${it.error ? 'error' : ''}">${it.error ? esc(it.error) : fmtSize(it.file.size)}</div></div>
          <div class="ctrl">
            ${tool.combine ? `<button class="icon-btn up" aria-label="Subir ${esc(it.file.name)}" ${i ? '' : 'disabled'}>↑</button>
            <button class="icon-btn down" aria-label="Bajar ${esc(it.file.name)}" ${i < items.length - 1 ? '' : 'disabled'}>↓</button>` : ''}
            <button class="icon-btn rm" aria-label="Quitar ${esc(it.file.name)}">✕</button>
          </div>
          <div class="bar"><i></i></div></li>`);
        it.el = li;
        if (['jpg', 'jpeg', 'png'].includes(ext) && !it.error) {
          it.thumbUrl ||= URL.createObjectURL(it.file);
          li.querySelector('.thumb').replaceWith(h(`<img class="thumb" alt="" src="${it.thumbUrl}">`));
        }
        li.querySelector('.rm').onclick = () => { if (busy) return; if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl); items = items.filter((x) => x !== it); renderList(); };
        li.querySelector('.up')?.addEventListener('click', () => move(i, i - 1));
        li.querySelector('.down')?.addEventListener('click', () => move(i, i + 1));
        if (tool.combine) dragSort(li, i);
        list.append(li);
      });
      go.disabled = busy || !items.some((x) => !x.error);
    }
    function move(from, to) {
      if (busy || to < 0 || to >= items.length) return;
      const [x] = items.splice(from, 1);
      items.splice(to, 0, x);
      renderList();
      list.children[to]?.querySelector(to < from ? '.up' : '.down')?.focus();
    }
    let dragFrom = -1;
    function dragSort(li, i) {
      li.addEventListener('dragstart', (e) => { dragFrom = i; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); });
      li.addEventListener('dragend', () => { li.classList.remove('dragging'); dragFrom = -1; });
      li.addEventListener('dragover', (e) => { if (dragFrom < 0) return; e.preventDefault(); li.classList.add('drop-target'); });
      li.addEventListener('dragleave', () => li.classList.remove('drop-target'));
      li.addEventListener('drop', (e) => { if (dragFrom < 0) return; e.preventDefault(); li.classList.remove('drop-target'); move(dragFrom, i); });
    }

    function setState(it, cls, text, frac) {
      const st = it.el.querySelector('.status');
      st.className = 'status ' + cls;
      st.textContent = text;
      const bar = it.el.querySelector('.bar');
      bar.classList.toggle('on', frac != null);
      if (frac != null) bar.firstElementChild.style.width = Math.round(frac * 100) + '%';
    }

    const message = (e) => {
      if (e instanceof ConvError) return e.message;
      console.error(e);
      if (/memory|allocation|RangeError/i.test(String(e))) return 'El dispositivo se quedó sin memoria. Probá con un archivo más chico o una calidad menor.';
      return 'Error inesperado al convertir: ' + (e?.message || e);
    };

    go.addEventListener('click', async () => {
      busy = true;
      go.disabled = true;
      urls.forEach(URL.revokeObjectURL);
      urls = [];
      results.innerHTML = '';
      gstatus.className = 'global-status';
      gstatus.textContent = 'Convirtiendo…';
      const valid = items.filter((x) => !x.error);
      const outputs = [];
      if (tool.combine) {
        valid.forEach((it) => setState(it, '', 'En cola', 0));
        try {
          const out = await tool.run(valid.map((x) => x.file), opts, (f, label) => {
            gstatus.textContent = label;
            valid.forEach((it, i) => setState(it, '', i < Math.round(f * valid.length) ? 'Añadida' : 'En cola', f));
          });
          valid.forEach((it) => setState(it, 'done', 'Añadida al PDF'));
          outputs.push(...out);
        } catch (e) {
          gstatus.className = 'global-status error';
          gstatus.textContent = message(e);
          valid.forEach((it) => setState(it, '', fmtSize(it.file.size)));
        }
      } else {
        valid.forEach((it) => setState(it, '', 'En cola'));
        for (const it of valid) {
          setState(it, '', 'Preparando…', 0.02);
          try {
            const out = await tool.run(it.file, opts, (f, label) => setState(it, '', label, Math.max(0.02, f)));
            setState(it, 'done', 'Convertido');
            outputs.push(...out);
          } catch (e) {
            setState(it, 'error', message(e));
          }
        }
      }
      const failed = valid.length - (tool.combine ? (outputs.length ? valid.length : 0) : valid.filter((it) => it.el.querySelector('.status.done')).length);
      if (!gstatus.classList.contains('error')) gstatus.textContent = outputs.length ? `Listo${failed ? ` · ${failed} con error` : ''}` : 'No se pudo convertir ningún archivo';
      if (!outputs.length && !gstatus.classList.contains('error')) gstatus.className = 'global-status error';
      busy = false;
      renderResults(outputs);
      go.disabled = !items.some((x) => !x.error);
      go.textContent = 'Convertir de nuevo';
    });

    function renderResults(outputs) {
      if (!outputs.length) return;
      results.append(h(`<h2>${outputs.length === 1 ? 'Resultado' : `Resultados (${outputs.length})`}</h2>`));
      for (const o of outputs) {
        const card = h(`<article class="out"><div class="pv">Vista previa no disponible para este formato</div>
          <div class="info"><div class="oname">${esc(o.name)}</div><div class="osize"></div><ul class="warn"></ul></div></article>`);
        const info = card.querySelector('.info');
        const warn = card.querySelector('.warn');
        for (const w of o.warnings || []) warn.append(h(`<li class="${w.startsWith('⚠') ? 'bad' : ''}">${esc(w)}</li>`));
        if (o.html) {
          card.querySelector('.osize').textContent = 'Se abrirá en una pestaña nueva con el diálogo de impresión';
          const btn = h('<button class="btn primary">Abrir y guardar como PDF</button>');
          // window.open debe ejecutarse en el mismo clic para que el navegador no lo bloquee.
          btn.onclick = () => {
            const u = URL.createObjectURL(new Blob([o.html], { type: 'text/html' }));
            urls.push(u);
            if (!window.open(u, '_blank')) alert('El navegador bloqueó la ventana nueva. Permite las ventanas emergentes para esta página.');
          };
          info.append(btn);
          card.querySelector('.pv').textContent = 'En el diálogo elegí «Guardar como PDF»';
        } else {
          card.querySelector('.osize').textContent = fmtSize(o.blob.size);
          const u = URL.createObjectURL(o.blob);
          urls.push(u);
          info.append(h(`<a class="btn primary" href="${u}" download="${esc(o.name)}">Descargar</a>`));
          preview(card.querySelector('.pv'), o);
        }
        results.append(card);
      }
      const files = outputs.filter((o) => o.blob);
      if (files.length > 1) {
        const all = h('<button class="btn">Descargar todo (ZIP)</button>');
        all.onclick = async () => {
          all.disabled = true;
          all.textContent = 'Preparando ZIP…';
          const JSZip = await Conv.need('jszip');
          const zip = new JSZip();
          const used = new Set();
          for (const o of files) {
            let name = o.name, n = 2;
            while (used.has(name)) name = o.name.replace(/(\.[^.]+)$/, ` (${n++})$1`);
            used.add(name);
            zip.file(name, o.blob);
          }
          const u = URL.createObjectURL(await zip.generateAsync({ type: 'blob' }));
          urls.push(u);
          const a = h(`<a href="${u}" download="convertidos.zip"></a>`);
          document.body.append(a);
          a.click();
          a.remove();
          all.disabled = false;
          all.textContent = 'Descargar todo (ZIP)';
        };
        const row = h('<div class="actions"></div>');
        row.append(all);
        results.append(row);
      }
      results.querySelector('h2').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    async function preview(box, o) {
      try {
        if (o.preview) {
          const u = URL.createObjectURL(o.preview);
          urls.push(u);
          box.innerHTML = `<img alt="Vista previa de la primera página" src="${u}">`;
        } else if (o.previewHtml) {
          box.classList.add('table');
          box.innerHTML = o.previewHtml; // generado por SheetJS, que escapa el contenido
        } else if (o.blob.type === 'application/pdf') {
          box.textContent = 'Generando vista previa…';
          const pdf = await Conv.openPdf(await o.blob.arrayBuffer());
          const page = await pdf.getPage(1);
          const w = page.getViewport({ scale: 1 }).width;
          const { canvas } = await Conv.renderPage(page, (360 * (window.devicePixelRatio || 1)) / w);
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', 'Vista previa de la primera página');
          box.innerHTML = '';
          box.append(canvas);
          pdf.destroy();
        }
      } catch {
        box.textContent = 'Vista previa no disponible';
      }
    }
  }

  // ---------- Rutas ----------
  function route() {
    const id = location.hash.replace(/^#\/?/, '');
    app.style.removeProperty('--accent');
    if (TOOLS[id]) toolPage(id); else home();
    window.scrollTo(0, 0);
    if (id) app.focus({ preventScroll: true });
  }
  // Evita que soltar un archivo fuera de la zona abra el archivo en la pestaña.
  ['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => { if (!e.target.closest?.('.drop, .file')) e.preventDefault(); }));
  window.addEventListener('hashchange', route);
  route();
})();
