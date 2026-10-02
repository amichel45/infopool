/* ============================================================
   Info-Pool 67 – Index-Modul (v7.3)
   ============================================================
   Wird vom Core lazy nachgeladen, sobald der Volltextindex-
   Dialog geöffnet wird (im Admin-Modus).

   Inhalte:
     · Index-Verwaltungs-Modal
     · Datei-Aufnahme (Drag&Drop, File-Picker, Folder-Picker)
     · Lazy-Loader für externe Bibliotheken (PDF.js, mammoth,
       SheetJS, MsgReader)
     · Extraktoren für PDF, DOCX, XLSX, TXT, CSV, MSG, EML
     · Helfer für Multipart-MIME (für mehrteilige EML-Mails)

   ── Geändert in v7.3 ───────────────────────────────────
   · Phase 2: Beim Indizieren werden topTerms (Top-50-Tokens
     nach Frequenz, ohne Stoppwörter) und totalTokens
     mitgespeichert. Diese werden später für die Berechnung
     ähnlicher Dokumente (TF-IDF + Cosine) genutzt.
   ============================================================ */
(function(){
'use strict';

if (!window.IP67 || !window.IP67._internal) {
  console.error('[Info-Pool 67] Index-Modul vor dem Core geladen – Abbruch.');
  return;
}

const I = window.IP67._internal;
const H = window.IP67._adminHelpers || {};   // Save-Folder-Funktionen vom Admin-Modul
const INDEX_FILE_NAME      = I.INDEX_FILE_NAME;
const SUPPORTED_INDEX_EXTS = I.SUPPORTED_INDEX_EXTS;

/* ============================================================
   1. CDN-LADER (externe Bibliotheken)
============================================================ */
/* ----------------------------------------------------------------
   v8.4: Bibliotheken werden LOKAL aus dem Ordner „lib" geladen.
   Externe CDNs (cdnjs, jsDelivr) werden im Stadtnetz von der
   Tracking-Prevention des Browsers blockiert – damit war keine
   Textextraktion möglich. Die Pfade sind relativ zur .aspx.

   Erwartete Ablage unterhalb von …/Infopool/ :
     lib/pdfjs/pdf.min.js
     lib/pdfjs/pdf.worker.min.js
     lib/mammoth/mammoth.browser.min.js
     lib/xlsx/xlsx.full.min.js
     lib/msgreader/MsgReader.js        (optional, nur für .msg)
   ---------------------------------------------------------------- */
const CDN = {
  pdfjs:    'lib/pdfjs/pdf.min.js',
  pdfjsWk:  'lib/pdfjs/pdf.worker.min.js',
  mammoth:  'lib/mammoth/mammoth.browser.min.js',
  xlsx:     'lib/xlsx/xlsx.full.min.js',
  msgreader:'lib/msgreader/MsgReader.js'
};

const _loadedScripts = {};
function loadScript(url) {
  if (_loadedScripts[url]) return _loadedScripts[url];
  _loadedScripts[url] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = url; s.async = true;
    s.onload  = () => res();
    s.onerror = () => rej(new Error('Bibliothek nicht ladbar: ' + url +
      ' — Ordner „lib" neben infopool67_v8.aspx pruefen.'));
    document.head.appendChild(s);
  });
  return _loadedScripts[url];
}

/* ============================================================
   2. INDEX-MODAL
============================================================ */
function openIndexModal() {
  /* v8.4: Der frühere Admin-Modus ist entfallen (die Themenstruktur wird
     live aus der SharePoint-Ablage aufgebaut). Die Indexverwaltung ist
     daher ohne vorherige Modus-Umschaltung erreichbar. */
  const modal = document.getElementById('indexModal');
  if (!modal) { I.toast('Index-Dialog nicht verfügbar'); return; }
  modal.classList.add('show');
  renderIndexModal();
}

function closeIndexModal() {
  document.getElementById('indexModal').classList.remove('show');
}

function renderIndexModal() {
  const body = document.getElementById('indexModalBody');
  if (!body) return;
  const searchIndex = I.getSearchIndex();
  const indexFilter = I.getIndexFilter();
  const indexFilterStatus = I.getIndexFilterStatus();

  const allItems = I.flatIndex().filter(x =>
    x.node.type === 'item' && x.node.href && x.node.href !== '#' && x.node.href !== '#home'
  );
  const indexedCount = Object.keys(searchIndex).filter(id => allItems.some(x => x.node.id === id)).length;
  const totalSize = Object.values(searchIndex).reduce((s, e) => s + (e.size || 0), 0);
  const missCount = allItems.filter(x => !searchIndex[x.node.id]).length;

  // PDFs ohne Seitenzahl-Info (vor v7.1 indiziert)
  const pdfNoPages = Object.values(searchIndex).filter(e =>
    (e.format === 'pdf') && !e.pageBreaks
  ).length;

  let listItems = allItems;
  if (indexFilterStatus !== 'all') {
    listItems = listItems.filter(x => {
      const ent = searchIndex[x.node.id];
      if (indexFilterStatus === 'ok')   return !!ent;
      if (indexFilterStatus === 'miss') return !ent;
      if (indexFilterStatus === 'stale') {
        if (!ent) return false;
        if (!ent.indexedAt) return true;
        const days = (Date.now() - new Date(ent.indexedAt).getTime()) / 86400000;
        return days > 90;
      }
      return true;
    });
  }
  if (indexFilter) {
    const q = indexFilter.toLowerCase();
    listItems = listItems.filter(x =>
      x.node.title.toLowerCase().includes(q) || (x.node.href || '').toLowerCase().includes(q)
    );
  }

  const dirPickerSupported = 'showDirectoryPicker' in window;

  body.innerHTML = `
    <div class="index-stats">
      <div class="index-stat"><div class="index-stat-value">${indexedCount}</div><div class="index-stat-label">indiziert</div></div>
      <div class="index-stat"><div class="index-stat-value">${missCount}</div><div class="index-stat-label">fehlend</div></div>
      <div class="index-stat"><div class="index-stat-value">${I.formatBytes(totalSize)}</div><div class="index-stat-label">Textmenge</div></div>
    </div>
    <div class="index-sub">Speicherort: <strong>IndexedDB</strong> im Browser${dirPickerSupported ? '' : ' · klassischer Ordnermodus'}</div>

    ${pdfNoPages > 0 ? `
    <div class="index-hint-box">
      <strong>💡 Hinweis:</strong> ${pdfNoPages} PDF${pdfNoPages===1?' wurde':'s wurden'} vor v7.1 indiziert und ${pdfNoPages===1?'enthält':'enthalten'} keine Seitenzahl-Information.
      In der Trefferliste fehlt deshalb das „S. X / Y"-Badge. Erneutes Indizieren dieser Dateien ergänzt die Seitenzahlen.
    </div>` : ''}

    <label class="index-dropzone" id="indexDropzone" for="indexFileInput">
      <input type="file" id="indexFileInput" multiple
             accept=".pdf,.docx,.xlsx,.xls,.txt,.csv,.msg,.eml,.html,.htm">
      <span class="idz-icon">📥</span>
      <div class="idz-title">Dateien hier ablegen oder klicken</div>
      <div class="idz-sub">PDF · DOCX · XLSX · TXT · CSV · MSG · EML · HTML — automatische Zuordnung über Dateinamen</div>
    </label>

    <div class="index-action-row">
      <button class="index-action-btn" onclick="IP67.pickFolderModern()" ${dirPickerSupported?'':'disabled title="Nur in Edge/Chrome verfügbar"'}>
        Ganzen Ordner auswählen…
      </button>
      <button class="index-action-btn" onclick="document.getElementById('indexFolderInput').click()">
        Ordner durchsuchen (klassisch)
      </button>
      <input type="file" id="indexFolderInput" webkitdirectory multiple style="display:none"
             onchange="IP67.handleFolderInput(event)">
    </div>

    <!-- v8.4: Zentrale Bereitstellung. Ohne diesen Knopf war der Index nur
         im jeweiligen Browser vorhanden; exportIndex() war zwar vorhanden,
         aber über keine Schaltfläche erreichbar. -->
    <div class="index-publish">
      <div class="ip-text">
        <strong>Index für alle bereitstellen</strong>
        <div class="idz-sub">Erzeugt <code>search-index.json</code>. Die Datei in den
        Infopool-Ordner legen – dann muss nicht jede und jeder für sich indizieren.</div>
      </div>
      <button class="index-action-btn index-action-prim" onclick="IP67.exportIndex()">
        Index exportieren
      </button>
    </div>

    <div class="index-progress" id="indexProgress">
      <div class="index-progress-text">
        <span id="indexProgressLabel">Wird verarbeitet …</span>
        <span id="indexProgressCount">0 / 0</span>
      </div>
      <div class="index-progress-bar"><div class="index-progress-fill" id="indexProgressFill"></div></div>
    </div>

    <div class="index-filter">
      <input type="text" id="indexFilterInput" placeholder="Einträge filtern …"
             value="${I.escAttr(indexFilter)}"
             oninput="IP67.setIndexFilter(this.value)">
      <select id="indexFilterStatus" onchange="IP67.setIndexFilterStatus(this.value)">
        <option value="all"   ${indexFilterStatus==='all'?'selected':''}>Alle</option>
        <option value="ok"    ${indexFilterStatus==='ok'?'selected':''}>✓ Indiziert</option>
        <option value="miss"  ${indexFilterStatus==='miss'?'selected':''}>✗ Fehlend</option>
        <option value="stale" ${indexFilterStatus==='stale'?'selected':''}>🕓 Veraltet</option>
      </select>
    </div>

    <div class="index-list" id="indexList">
      ${listItems.length === 0
        ? '<div style="padding:1rem;text-align:center;color:var(--muted);font-size:0.78rem;">Keine Einträge entsprechen dem Filter.</div>'
        : listItems.map(x => renderIndexRow(x.node, x.parent)).join('')}
    </div>

    <div class="index-note">
      <strong>So funktioniert's:</strong> Dokumente oder einen ganzen Ordner oben ablegen.
      Der Browser liest den Text aus und ordnet ihn über den Dateinamen dem passenden
      Eintrag zu; ist die Zuordnung nicht eindeutig, erscheint ein Auswahldialog.
      Zum Schluss <strong>Index exportieren</strong> und <code>${INDEX_FILE_NAME}</code>
      in den Infopool-Ordner legen.
    </div>
  `;

  const dz = document.getElementById('indexDropzone');
  if (dz) {
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
    dz.addEventListener('drop', async e => {
      e.preventDefault();
      dz.classList.remove('dragover');
      const files = await extractFilesFromDataTransfer(e.dataTransfer);
      if (files.length > 0) processIndexFiles(files);
    });
  }
  const fi = document.getElementById('indexFileInput');
  if (fi) {
    fi.addEventListener('change', e => {
      const files = Array.from(e.target.files || []);
      if (files.length > 0) processIndexFiles(files);
      e.target.value = '';
    });
  }
}

function renderIndexRow(node, breadcrumb) {
  const entry = I.getSearchIndex()[node.id];
  let status = 'miss', icon = '✗', metaTxt = '', fmtBadge = '';
  if (entry) {
    status = 'ok'; icon = '✓';
    const date = entry.indexedAt ? I.formatDate(entry.indexedAt) : '?';
    const size = entry.size ? I.formatBytes(entry.size) : '';
    metaTxt = `${date} · ${size}`;
    if (entry.indexedAt) {
      const days = (Date.now() - new Date(entry.indexedAt).getTime()) / 86400000;
      if (days > 90) { status = 'stale'; icon = '🕓'; }
    }
    if (entry.format) {
      fmtBadge = `<span class="idx-format-badge fmt-${I.escAttr(entry.format.toLowerCase())}">${I.escHtml(entry.format)}</span>`;
    }
  }
  const parentTxt = breadcrumb.length > 0 ? breadcrumb[breadcrumb.length-1] : '';

  return `
    <div class="index-list-row" data-id="${node.id}">
      <span class="idx-status ${status}" title="${status==='ok'?'Indiziert':(status==='stale'?'Vor mehr als 90 Tagen indiziert':'Nicht indiziert')}">${icon}</span>
      <span class="idx-title" title="${I.escAttr(node.href || '')}">
        ${I.escHtml(node.icon || I.iconForHref(node.href))} ${I.escHtml(node.title)}${fmtBadge}
        ${parentTxt ? `<span style="color:var(--muted);font-size:0.7rem;"> · ${I.escHtml(parentTxt)}</span>` : ''}
      </span>
      <span class="idx-meta">${I.escHtml(metaTxt)}</span>
      <span class="idx-actions">
        <button onclick="IP67.pickFileForItem('${node.id}')" title="Datei für diesen Eintrag wählen">📄</button>
        ${entry ? `<button class="del" onclick="IP67.removeIndexEntry('${node.id}')" title="Indexeintrag löschen">×</button>` : ''}
      </span>
    </div>
  `;
}

function setIndexFilter(v) {
  I.setIndexFilter(v);
  const list = document.getElementById('indexList');
  if (!list) return;
  const indexFilter = I.getIndexFilter();
  const indexFilterStatus = I.getIndexFilterStatus();
  const searchIndex = I.getSearchIndex();
  const allItems = I.flatIndex().filter(x =>
    x.node.type === 'item' && x.node.href && x.node.href !== '#' && x.node.href !== '#home'
  );
  let listItems = allItems;
  if (indexFilterStatus !== 'all') {
    listItems = listItems.filter(x => {
      const ent = searchIndex[x.node.id];
      if (indexFilterStatus === 'ok')   return !!ent;
      if (indexFilterStatus === 'miss') return !ent;
      if (indexFilterStatus === 'stale') {
        if (!ent) return false;
        if (!ent.indexedAt) return true;
        const days = (Date.now() - new Date(ent.indexedAt).getTime()) / 86400000;
        return days > 90;
      }
      return true;
    });
  }
  if (indexFilter) {
    const q = indexFilter.toLowerCase();
    listItems = listItems.filter(x =>
      x.node.title.toLowerCase().includes(q) || (x.node.href || '').toLowerCase().includes(q)
    );
  }
  list.innerHTML = listItems.length === 0
    ? '<div style="padding:1rem;text-align:center;color:var(--muted);font-size:0.78rem;">Keine Einträge entsprechen dem Filter.</div>'
    : listItems.map(x => renderIndexRow(x.node, x.parent)).join('');
}

function setIndexFilterStatus(v) { I.setIndexFilterStatus(v); setIndexFilter(I.getIndexFilter()); }

async function removeIndexEntry(id) {
  if (!confirm('Indexeintrag für diesen Datensatz löschen?')) return;
  await I.deleteIndexEntry(id);
  renderIndexModal();
  I.toast('Indexeintrag gelöscht');
}

async function clearIndex() {
  if (!confirm('Den gesamten Volltext-Index löschen? Diese Aktion kann nicht rückgängig gemacht werden.')) return;
  I.setSearchIndex({});
  try { await I.idbClear(); } catch(e) { console.warn(e); }
  renderIndexModal();
  I.toast('Index geleert');
}

async function exportIndex(silent) {
  const searchIndex = I.getSearchIndex();

  /* ----------------------------------------------------------------
     v8.4: Nur echte Dokumenteintraege exportieren.
     Personendatensaetze (_isExternal) stammen aus der Mitarbeiterliste
     und werden bei jedem Start ohnehin von dort neu eingelesen. Wandern
     sie zusaetzlich in den Volltextindex, blaeht das die Datei auf und
     erzeugt doppelte Bestaende.
     ---------------------------------------------------------------- */
  const clean = {};
  let persons = 0;
  for (const id in searchIndex) {
    const e = searchIndex[id];
    if (!e || !e.text) continue;
    if (e._isExternal) { persons++; continue; }
    const out = {
      text:      e.text,
      indexedAt: e.indexedAt,
      size:      e.size,
      fileName:  e.fileName || '',
      format:    e.format || ''
    };
    if (Array.isArray(e.pageBreaks))        out.pageBreaks  = e.pageBreaks;
    if (typeof e.totalPages  === 'number')  out.totalPages  = e.totalPages;
    if (typeof e.totalTokens === 'number')  out.totalTokens = e.totalTokens;
    if (e.topTerms && typeof e.topTerms === 'object') out.topTerms = e.topTerms;
    clean[id] = out;
  }

  const count = Object.keys(clean).length;
  if (count === 0) {
    if (!silent) I.toast('Keine Dokumenteintraege vorhanden – nichts zu exportieren');
    return;
  }

  const stamp   = new Date().toLocaleString('de-DE');
  const payload = JSON.stringify(clean);

  /* Zwei Formate, weil beide Ladewege bedient werden:
       search-index.js   – per <script>-Tag, funktioniert immer
       search-index.json – bevorzugter Weg von storage_v8.js          */
  /* v8.4: NUR JSON. Die frueher zusaetzlich erzeugte search-index.js war
     eine zweite Fassung derselben Daten; wurde nur eine der beiden Dateien
     ausgetauscht, liefen sie auseinander und alte Eintraege kamen bei jedem
     Start zurueck. */
  const files = [
    { name: 'search-index.json', body: payload, mime: 'application/json;charset=utf-8' }
  ];

  const note = count + ' Dokumente' + (persons ? ' (' + persons + ' Personendatensaetze ausgenommen)' : '');

  /* Bevorzugt direkt in den gemerkten Ordner schreiben. */
  if (I.hasFileSystemAccessAPI() && H.getSaveFolderHandle && H.writeFileToFolder) {
    try {
      const handle = await H.getSaveFolderHandle(false);
      if (handle) {
        for (const f of files) await H.writeFileToFolder(handle, f.name, f.body, f.mime);
        if (!silent) I.toast('✓ ' + note + ' gespeichert → search-index.json in „' + handle.name + '"');
        return;
      }
    } catch (e) { console.warn('exportIndex FSA fehlgeschlagen:', e); }
  }

  /* Sonst beide Dateien herunterladen. */
  for (const f of files) {
    if (H.downloadFile) {
      H.downloadFile(f.body, f.name, f.mime);
    } else {
      const blob = new Blob([f.body], { type: f.mime });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = f.name;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  }
  if (!silent) I.toast('✓ ' + note + ' heruntergeladen · Datei in den Infopool-Ordner legen');
}

/* ============================================================
   3. DATEI-AUFNAHME
============================================================ */
async function extractFilesFromDataTransfer(dt) {
  if (!dt) return [];
  const files = [];
  const items = dt.items;
  if (items && items.length && typeof items[0].webkitGetAsEntry === 'function') {
    const entries = [];
    for (let i = 0; i < items.length; i++) {
      const ent = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
      if (ent) entries.push(ent);
    }
    for (const entry of entries) await walkEntry(entry, files);
    return files;
  }
  return Array.from(dt.files || []);
}

function walkEntry(entry, out) {
  return new Promise(resolve => {
    if (entry.isFile) {
      entry.file(f => { out.push(f); resolve(); }, _ => resolve());
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const readBatch = () => {
        reader.readEntries(async ents => {
          if (!ents.length) { resolve(); return; }
          for (const e of ents) await walkEntry(e, out);
          readBatch();
        }, _ => resolve());
      };
      readBatch();
    } else resolve();
  });
}

async function pickFolderModern() {
  if (!('showDirectoryPicker' in window)) {
    I.toast('Diese Browser-Variante unterstützt den modernen Ordner-Picker nicht – nutzen Sie „Ordner durchsuchen"');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker();
    const files = await collectFilesFromDirHandle(handle);
    if (files.length === 0) { I.toast('Ordner enthält keine indizierbaren Dateien'); return; }
    processIndexFiles(files);
  } catch(e) {
    if (e && e.name === 'AbortError') return;
    console.error(e); I.toast('Ordner-Auswahl: ' + e.message);
  }
}

async function collectFilesFromDirHandle(dirHandle) {
  const out = [];
  async function walk(h) {
    for await (const [name, entry] of h.entries()) {
      if (entry.kind === 'file') {
        const ext = getFileExt(name);
        if (SUPPORTED_INDEX_EXTS.indexOf(ext) < 0) continue;
        try { out.push(await entry.getFile()); } catch(_){}
      } else if (entry.kind === 'directory') {
        await walk(entry);
      }
    }
  }
  await walk(dirHandle);
  return out;
}

function handleFolderInput(event) {
  const all = Array.from(event.target.files || []);
  event.target.value = '';
  if (all.length === 0) return;
  const files = all.filter(f => SUPPORTED_INDEX_EXTS.indexOf(getFileExt(f.name)) >= 0);
  if (files.length === 0) { I.toast('Keine indizierbaren Dateien im Ordner'); return; }
  processIndexFiles(files);
}

function pickFileForItem(id) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.docx,.xlsx,.xls,.txt,.csv,.msg,.eml';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.onchange = async () => {
    const f = input.files && input.files[0];
    document.body.removeChild(input);
    if (!f) return;
    const ok = await indexSingleFile(f, id);
    if (ok) { renderIndexModal(); I.toast('✓ „'+f.name+'" indiziert'); }
  };
  input.click();
}

async function processIndexFiles(files) {
  const validFiles = files.filter(f => SUPPORTED_INDEX_EXTS.indexOf(getFileExt(f.name)) >= 0);
  if (validFiles.length === 0) {
    I.toast('Keine unterstützten Dateien (PDF/DOCX/XLSX/TXT/CSV/MSG/EML)');
    return;
  }
  if (validFiles.length < files.length) {
    I.toast((files.length - validFiles.length) + ' Datei(en) übersprungen (Format nicht unterstützt)');
  }

  const progress = document.getElementById('indexProgress');
  const fill     = document.getElementById('indexProgressFill');
  const label    = document.getElementById('indexProgressLabel');
  const counter  = document.getElementById('indexProgressCount');
  if (progress) progress.classList.add('active');

  let unmatched = 0, indexed = 0, failed = 0;
  for (let i = 0; i < validFiles.length; i++) {
    const f = validFiles[i];
    if (label)   label.textContent = 'Verarbeite: ' + f.name;
    if (counter) counter.textContent = (i+1) + ' / ' + validFiles.length;
    if (fill)    fill.style.width = Math.round(((i+1) / validFiles.length) * 100) + '%';

    let itemId = findItemIdByFilename(f.name);
    if (!itemId) {
      const picked = await askForItemAssignment(f.name);
      if (!picked) { unmatched++; continue; }
      itemId = picked;
    }
    const ok = await indexSingleFile(f, itemId);
    if (ok) indexed++; else failed++;
  }

  if (progress) progress.classList.remove('active');
  renderIndexModal();

  const parts = [];
  if (indexed   > 0) parts.push(indexed + ' indiziert');
  if (failed    > 0) parts.push(failed + ' fehlgeschlagen');
  if (unmatched > 0) parts.push(unmatched + ' nicht zugeordnet');
  I.toast('✓ Fertig – ' + (parts.length ? parts.join(', ') : 'nichts zu tun'));
}

function getFileExt(name) {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot+1).toLowerCase();
}

function findItemIdByFilename(fileName) {
  const fileBase = baseName(fileName).toLowerCase();
  const allItems = I.flatIndex().filter(x =>
    x.node.type === 'item' && x.node.href && x.node.href !== '#' && x.node.href !== '#home'
  );
  for (const x of allItems) {
    const refBase = baseName(x.node.href).toLowerCase();
    if (refBase === fileBase) return x.node.id;
  }
  for (const x of allItems) {
    if (x.node.href.toLowerCase().endsWith('\\' + fileName.toLowerCase()) ||
        x.node.href.toLowerCase().endsWith('/'  + fileName.toLowerCase())) {
      return x.node.id;
    }
  }
  return null;
}

function baseName(path) {
  if (!path) return '';
  const cleaned = path.split(/[?#]/)[0];
  const idx = Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\'));
  return cleaned.slice(idx + 1);
}

function askForItemAssignment(fileName) {
  return new Promise(resolve => {
    const items = I.flatIndex().filter(x =>
      x.node.type === 'item' && x.node.href && x.node.href !== '#' && x.node.href !== '#home'
    );
    showItemPicker(fileName, items, resolve);
  });
}

function showItemPicker(fileName, items, resolve) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay show';
  overlay.style.zIndex = 2000;
  overlay.innerHTML = `
    <div class="modal" style="max-width:500px;">
      <div class="modal-header"><h3>Datei zuordnen</h3></div>
      <div class="modal-body">
        <div class="form-group">
          <label>Datei „${I.escHtml(fileName)}" konnte keinem Eintrag automatisch zugeordnet werden.</label>
          <select id="pickerSelect" style="width:100%;background:rgba(0,0,0,0.25);border:1px solid var(--border);
                  border-radius:7px;padding:0.55rem 0.8rem;font-family:'Outfit',sans-serif;font-size:0.85rem;
                  color:var(--text);outline:none;">
            <option value="">— Eintrag auswählen —</option>
            ${items.map(x => `<option value="${x.node.id}">${I.escHtml(x.node.title)}${x.parent.length>0?' ('+I.escHtml(x.parent[x.parent.length-1])+')':''}</option>`).join('')}
          </select>
        </div>
        <div class="hint" style="font-size:0.72rem;color:var(--muted);">Tipp: Im Dropdown den Anfang des Titels tippen.</div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="pickerSkip">Überspringen</button>
        <button class="btn-primary" id="pickerOk">Zuordnen</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const sel  = overlay.querySelector('#pickerSelect');
  const ok   = overlay.querySelector('#pickerOk');
  const skip = overlay.querySelector('#pickerSkip');
  sel.focus();
  ok.onclick   = () => { const v = sel.value; document.body.removeChild(overlay); resolve(v || null); };
  skip.onclick = () => { document.body.removeChild(overlay); resolve(null); };
}

/* ============================================================
   4. DATEI INDIZIEREN
============================================================ */
async function indexSingleFile(file, itemId) {
  const ext = getFileExt(file.name);
  let extracted = '';
  try {
    if (ext === 'pdf')                                   extracted = await extractPdf(file);
    else if (ext === 'docx')                             extracted = await extractDocx(file);
    else if (ext === 'xlsx' || ext === 'xls')            extracted = await extractXlsx(file);
    else if (ext === 'txt'  || ext === 'csv')            extracted = await extractTxt(file);
    else if (ext === 'html' || ext === 'htm')            extracted = await extractHtml(file);
    else if (ext === 'eml')                              extracted = await extractEml(file);
    else if (ext === 'msg')                              extracted = await extractMsg(file);
    else throw new Error('Format ' + ext + ' nicht unterstützt');
  } catch(err) {
    console.error('[Index] ' + file.name + ':', err);
    I.toast('Fehler bei „' + file.name + '": ' + err.message);
    return false;
  }

  let text, pageBreaks = null, totalPages = null;
  if (typeof extracted === 'string') {
    text = extracted;
  } else if (extracted && typeof extracted.text === 'string') {
    text       = extracted.text;
    pageBreaks = Array.isArray(extracted.pageBreaks) ? extracted.pageBreaks : null;
    totalPages = typeof extracted.totalPages === 'number' ? extracted.totalPages : null;
  } else {
    text = '';
  }

  if (!text || text.trim().length === 0) {
    /* v10.4 · Gedächtnis für dauerhaft textlose Dateien.
       BEFUND. Bis v10.3 verließ diese Stelle die Funktion mit `false`,
       ohne irgendetwas zu hinterlassen. Für den Abgleich in
       infopool67_indexsync_v8.js sah die Datei danach wieder aus wie
       eine, die noch nie drangewesen ist – sie kam bei JEDEM Aufruf der
       Seite erneut in die Warteschlange, wurde erneut heruntergeladen
       und scheiterte erneut. Bei gescannten PDF ohne Texterkennung ist
       das kein Ausnahmefall, sondern der Normalfall: die Schleife endet
       nie, und der Hinweisstreifen „x Dokumente sind noch nicht
       durchsuchbar" kehrt bei jedem Seitenaufruf wieder.
       ÄNDERUNG. Es wird ein Eintrag OHNE Text geschrieben, der den
       Versuch festhält. Der Kern überspringt textlose Einträge an jeder
       Stelle (`if (!e || !e.text) continue`) – Suche, Ähnlichkeit und
       Trefferliste bleiben davon unberührt. `_srcSize` ist der
       Bezugspunkt: Wird die Datei später durch eine Fassung MIT
       Texterkennung ersetzt, ändert sich die Bytegröße, und der
       Abgleich versucht es von selbst erneut.
       WAS BLEIBT. Nur dieser eine Zweig merkt sich etwas – der
       Fehlerzweig oben (Extraktion abgebrochen) ausdrücklich nicht:
       dort ist die Ursache unklar (Bibliothek nicht erreichbar,
       Datei beschädigt), und eine vorübergehende Störung darf ein
       Dokument nicht dauerhaft aus der Suche nehmen. */
    try {
      const leer = {
        text:      '',
        indexedAt: I.today(),
        size:      0,
        fileName:  file.name,
        format:    ext,
        _keinText:      'scan',
        _keinTextGrund: 'kein Text gewinnbar – Scan ohne Texterkennung',
        _versuchtAm:    I.today()
      };
      if (typeof file.size === 'number') leer._srcSize = file.size;
      await I.saveIndexEntry(itemId, leer);
    } catch (e) {
      console.warn('[Index] Vermerk „kein Text" konnte nicht gespeichert werden:', e);
    }
    I.toast('„' + file.name + '" enthält keinen extrahierbaren Text');
    return false;
  }

  const origText = text;
  text = text.replace(/\s+/g, ' ').trim();

  if (pageBreaks && pageBreaks.length > 0) {
    pageBreaks = remapPageBreaks(origText, text, pageBreaks);
  }

  const MAX_CHARS = 300000;
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
    if (pageBreaks) pageBreaks = pageBreaks.filter(b => b < MAX_CHARS);
  }

  const entry = {
    text,
    indexedAt: I.today(),
    size: text.length,
    fileName: file.name,
    format: ext
  };
  if (pageBreaks && pageBreaks.length > 0) {
    entry.pageBreaks = pageBreaks;
    entry.totalPages = totalPages || pageBreaks.length;
  }

  // Phase 2: Top-Terme und Gesamttoken-Zahl für TF-IDF / Ähnlichkeit
  try {
    const { topTerms, totalTokens } = I.extractTopTerms(text);
    if (totalTokens > 0) {
      entry.topTerms = topTerms;
      entry.totalTokens = totalTokens;
    }
  } catch(e) {
    console.warn('topTerms-Berechnung fehlgeschlagen:', e);
  }

  await I.saveIndexEntry(itemId, entry);
  return true;
}

function remapPageBreaks(orig, normalized, breaks) {
  const out = [];
  let normPos = 0;
  let origPos = 0;
  let inWs = false;
  let leadingTrim = true;
  const sortedBreaks = breaks.slice().sort((a,b)=>a-b);
  let bIdx = 0;
  while (origPos < orig.length && bIdx < sortedBreaks.length) {
    while (bIdx < sortedBreaks.length && origPos === sortedBreaks[bIdx]) {
      out.push(normPos);
      bIdx++;
    }
    const c = orig.charCodeAt(origPos);
    const isWs = (c <= 32);
    if (isWs) {
      if (!inWs && !leadingTrim) normPos++;
      inWs = true;
    } else {
      inWs = false;
      leadingTrim = false;
      normPos++;
    }
    origPos++;
  }
  while (bIdx < sortedBreaks.length) { out.push(normPos); bIdx++; }
  return out;
}

/* ============================================================
   5. EXTRAKTOREN
============================================================ */
async function extractPdf(file) {
  await loadScript(CDN.pdfjs);
  if (typeof window.pdfjsLib === 'undefined') throw new Error('pdf.js nicht geladen');
  /* Der Worker wird vom pdf.js-Skript selbst nachgeladen; ein relativer
     Pfad würde dabei gegen eine andere Basis aufgelöst. Daher absolut. */
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(CDN.pdfjsWk, document.baseURI).href;
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  const pageTexts = [];
  const pageBreaks = [];
  let runningLen = 0;
  const maxPages = Math.min(pdf.numPages, 500);
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(it => it.str).join(' ');
    pageBreaks.push(runningLen);
    pageTexts.push(pageText);
    runningLen += pageText.length + 1;
  }
  return { text: pageTexts.join('\n'), pageBreaks, totalPages: maxPages };
}

async function extractDocx(file) {
  await loadScript(CDN.mammoth);
  if (typeof window.mammoth === 'undefined') throw new Error('mammoth nicht geladen');
  const buf = await file.arrayBuffer();
  const res = await window.mammoth.extractRawText({ arrayBuffer: buf });
  return res.value || '';
}

async function extractXlsx(file) {
  await loadScript(CDN.xlsx);
  if (typeof window.XLSX === 'undefined') throw new Error('SheetJS (XLSX) nicht geladen');
  const buf = await file.arrayBuffer();
  const wb = window.XLSX.read(buf, { type: 'array' });
  const allText = [];
  wb.SheetNames.forEach(name => {
    const sheet = wb.Sheets[name];
    const csv = window.XLSX.utils.sheet_to_csv(sheet);
    allText.push('# ' + name + '\n' + csv);
  });
  return allText.join('\n');
}

function extractTxt(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(String(r.result || ''));
    r.onerror = () => rej(new Error('Datei konnte nicht gelesen werden'));
    r.readAsText(file, 'utf-8');
  });
}

/* ── HTML/HTM — statische HTML-Seiten ──
   Liest die Datei zunächst als UTF-8. Wird im <meta charset="…">
   ein abweichender Zeichensatz angegeben (z.B. windows-1252),
   liest die Funktion die Datei mit diesem Charset erneut ein.
   Anschließend werden <script>, <style> und Kommentare entfernt
   (über die bestehende stripHtml-Hilfsfunktion). Der <title> wird
   dem Text vorangestellt, damit er bei der Volltextsuche besonders
   gut gefunden wird. */
async function extractHtml(file) {
  let raw = await extractTxt(file); // UTF-8-Lesung als Default
  // BOM entfernen, falls vorhanden
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);

  // Charset aus <meta charset="…"> bzw. <meta http-equiv="Content-Type" …>
  const csMatch =
       raw.match(/<meta[^>]+charset\s*=\s*["']?\s*([a-zA-Z0-9_\-]+)/i)
    || raw.match(/<meta[^>]+http-equiv\s*=\s*["']?content-type[^>]+charset=([a-zA-Z0-9_\-]+)/i);
  const declared = csMatch ? csMatch[1].toLowerCase() : 'utf-8';

  // Falls ein anderes Charset deklariert wurde, Datei mit diesem Charset
  // erneut einlesen. UTF-8 / UTF8 ist der Default und wird nicht erneut gelesen.
  if (declared && declared !== 'utf-8' && declared !== 'utf8') {
    try {
      raw = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = () => res(String(r.result || ''));
        r.onerror = () => rej(new Error('Datei konnte nicht gelesen werden'));
        r.readAsText(file, declared);
      });
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    } catch(e) {
      console.warn('[Index] HTML-Charset „' + declared + '" konnte nicht angewendet werden, bleibe bei UTF-8:', e);
    }
  }

  // Titel extrahieren und voranstellen
  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripHtml(titleMatch[1]) : '';

  const body = stripHtml(raw);
  return title ? (title + '\n\n' + body) : body;
}

/* ── EML — RFC-822 Mails, optional multipart ── */
async function extractEml(file) {
  const raw = await readAsBinaryString(file);
  const headerEnd = raw.indexOf('\r\n\r\n') >= 0 ? raw.indexOf('\r\n\r\n') : raw.indexOf('\n\n');
  const headers = headerEnd >= 0 ? raw.slice(0, headerEnd) : raw;
  const body    = headerEnd >= 0 ? raw.slice(headerEnd + (raw.indexOf('\r\n\r\n') >= 0 ? 4 : 2)) : '';
  const subjMatch = headers.match(/^Subject:\s*([^\r\n]+(?:\r?\n[ \t][^\r\n]+)*)/im);
  const fromMatch = headers.match(/^From:\s*([^\r\n]+)/im);
  const toMatch   = headers.match(/^To:\s*([^\r\n]+)/im);
  const dateMatch = headers.match(/^Date:\s*([^\r\n]+)/im);

  let prelude = '';
  if (subjMatch) prelude += 'Betreff: ' + decodeMimeHeader(subjMatch[1]) + '\n';
  if (fromMatch) prelude += 'Von: '     + decodeMimeHeader(fromMatch[1]) + '\n';
  if (toMatch)   prelude += 'An: '      + decodeMimeHeader(toMatch[1])   + '\n';
  if (dateMatch) prelude += 'Datum: '   + dateMatch[1].trim() + '\n';

  if (/Content-Type:\s*multipart\//i.test(headers)) {
    return prelude + '\n' + parseMultipartMimeBody(raw);
  }
  const enc = (headers.match(/content-transfer-encoding:\s*([^\r\n]+)/i) || [])[1] || '7bit';
  const cs  = ((headers.match(/charset=(?:"([^"]+)"|([^\s;]+))/i) || [])[1] || 'utf-8').toLowerCase();
  let bodyTxt = body;
  if (enc.toLowerCase() === 'quoted-printable') bodyTxt = decodeQuotedPrintable(body, cs);
  else if (enc.toLowerCase() === 'base64')      bodyTxt = bytesToString(atob(body.replace(/\s+/g,'')), cs);
  else                                          bodyTxt = bytesToString(body, cs);

  if (/^Content-Type:\s*text\/html/im.test(headers)) bodyTxt = stripHtml(bodyTxt);
  return prelude + '\n' + bodyTxt;
}

/* ── MSG — Outlook ── */
async function extractMsg(file) {
  await loadScript(CDN.msgreader);
  const MsgReader = window.MsgReader && (window.MsgReader.default || window.MsgReader);
  if (!MsgReader) throw new Error('MsgReader nicht geladen');
  const buf = await file.arrayBuffer();
  const reader = new MsgReader(buf);
  const m = reader.getFileData();
  const parts = [];
  if (m.subject)      parts.push('Betreff: ' + m.subject);
  if (m.senderName)   parts.push('Von: '     + m.senderName + (m.senderEmail ? ' <'+m.senderEmail+'>' : ''));
  if (m.recipients && m.recipients.length) {
    parts.push('An: ' + m.recipients.map(r => (r.name || '') + (r.email ? ' <'+r.email+'>' : '')).join(', '));
  }
  if (m.messageDeliveryTime) parts.push('Datum: ' + m.messageDeliveryTime);
  if (m.body)         parts.push('\n' + m.body);
  if (m.bodyHTML && !m.body) parts.push('\n' + stripHtml(m.bodyHTML));
  return parts.join('\n');
}

/* ============================================================
   6. MULTIPART-/MIME-HILFSFUNKTIONEN (für EML)
============================================================ */
function readAsBinaryString(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(String(r.result || ''));
    r.onerror = () => rej(new Error('Datei konnte nicht gelesen werden'));
    r.readAsBinaryString(file);
  });
}

/* Parst einen multipart/...-Body und extrahiert die Text-Teile.
   Wird intern für mehrteilige EML-Mails verwendet. */
function parseMultipartMimeBody(raw) {
  const m = raw.match(/Content-Type:\s*multipart\/[^;]+;\s*boundary=(?:"([^"]+)"|([^\s;]+))/i);
  if (!m) return stripHtml(raw);
  const boundary = '--' + (m[1] || m[2]);
  const parts = raw.split(boundary).slice(1, -1);

  const texts = [];
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    const altHeaderEnd = part.indexOf('\n\n');
    const splitAt = headerEnd >= 0 ? headerEnd : altHeaderEnd;
    if (splitAt < 0) continue;

    const headerBlob = part.slice(0, splitAt).toLowerCase();
    let body = part.slice(splitAt + (headerEnd >= 0 ? 4 : 2));
    body = body.replace(/\r?\n\s*$/, '');

    const ctMatch = headerBlob.match(/content-type:\s*([^;\r\n]+)/);
    const ct = ctMatch ? ctMatch[1].trim() : '';
    if (ct.indexOf('text/') !== 0) continue;

    const encMatch = headerBlob.match(/content-transfer-encoding:\s*([^\r\n]+)/);
    const enc = encMatch ? encMatch[1].trim() : '7bit';

    const csMatch = headerBlob.match(/charset=(?:"([^"]+)"|([^\s;]+))/);
    const charset = (csMatch ? (csMatch[1] || csMatch[2]) : 'utf-8').toLowerCase();

    let decoded;
    if (enc === 'base64') {
      try {
        const clean = body.replace(/\s+/g, '');
        const bin = atob(clean);
        decoded = bytesToString(bin, charset);
      } catch(e) { decoded = body; }
    } else if (enc === 'quoted-printable') {
      decoded = decodeQuotedPrintable(body, charset);
    } else {
      decoded = bytesToString(body, charset);
    }

    if (ct.indexOf('text/html') === 0) decoded = stripHtml(decoded);
    texts.push(decoded);
  }
  return texts.join('\n\n');
}

function bytesToString(binStr, charset) {
  try {
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i) & 0xff;
    return new TextDecoder(charset || 'utf-8', { fatal: false }).decode(bytes);
  } catch(e) {
    return binStr;
  }
}

function decodeQuotedPrintable(input, charset) {
  let s = input.replace(/=\r?\n/g, '');
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && i + 2 < s.length) {
      const hex = s.slice(i+1, i+3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        out.push(String.fromCharCode(parseInt(hex, 16)));
        i += 2;
        continue;
      }
    }
    out.push(s[i]);
  }
  return bytesToString(out.join(''), charset);
}

function decodeMimeHeader(input) {
  return input.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, enc, data) => {
    try {
      if (enc.toLowerCase() === 'b') {
        return bytesToString(atob(data), cs.toLowerCase());
      } else {
        return decodeQuotedPrintable(data.replace(/_/g, ' '), cs.toLowerCase());
      }
    } catch(e) { return data; }
  }).trim();
}

function stripHtml(html) {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
              .replace(/<style[\s\S]*?<\/style>/gi, ' ')
              .replace(/<!--[\s\S]*?-->/g, ' ');
  const tmp = document.createElement('div');
  tmp.innerHTML = s;
  return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
}

/* ============================================================
   7. ÖFFENTLICHE FUNKTIONEN REGISTRIEREN
============================================================ */
const real = {
  openIndexModal, closeIndexModal,
  exportIndex, clearIndex, removeIndexEntry,
  pickFileForItem, setIndexFilter, setIndexFilterStatus,
  pickFolderModern, handleFolderInput
};
Object.keys(real).forEach(k => { window.IP67[k] = real[k]; });

/* ============================================================
   v8.4: Schnittstelle für den automatischen Index-Abgleich
   (infopool67_indexsync_v8.js). Indiziert EINE Datei unter einer
   vorgegebenen Knoten-ID, ohne Dialog und ohne Nutzerinteraktion.
============================================================ */
window.IP67._indexFileForId = function (file, itemId) {
  return indexSingleFile(file, itemId);
};

/* Prüft, ob die Extraktionsbibliothek für eine Endung erreichbar ist.
   Im Stadtnetz kann der CDN-Zugriff gesperrt sein – dann meldet das
   der Abgleich sauber, statt reihenweise Fehler zu erzeugen. */
window.IP67._probeExtractor = async function (ext) {
  try {
    if (ext === 'pdf')                        { await loadScript(CDN.pdfjs);   return true; }
    if (ext === 'docx')                       { await loadScript(CDN.mammoth); return true; }
    if (ext === 'xlsx' || ext === 'xls')      { await loadScript(CDN.xlsx);    return true; }
    return true; /* txt/csv/html brauchen keine externe Bibliothek */
  } catch (e) { return false; }
};

window.IP67._supportedIndexExts = SUPPORTED_INDEX_EXTS;

})();
