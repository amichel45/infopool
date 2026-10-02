/* ================================================================
   Info-Pool 67 · v8.4 · infopool67_admin_v8.js
   ----------------------------------------------------------------
   HINWEIS ZUR VERSION 8.4
   Die Bearbeitung der Themenstruktur wurde VOLLSTÄNDIG entfernt.
   Die Struktur ergibt sich seit v8.4 ausschließlich aus dem
   SharePoint-Ordner „Ablage" und wird bei jedem Start neu aufgebaut
   (infopool67_livetree_v8.js). Umbenennen, Sortieren und Verschieben
   geschieht daher direkt in SharePoint, nicht mehr in der Anwendung.

   Entfernt gegenüber v8.3:
     · Admin-Modus (Strg+Shift+A), Auswahl, Pfeiltasten-Verschieben
     · Drag & Drop von Einträgen
     · Eintrag/Gruppe anlegen, bearbeiten, löschen, umwandeln
     · „Veröffentlichen" (sidebar-data.js), Backup-Export/-Import

   Verbleibender Zweck dieser Datei:
     · Speicher-Ordner-Verwaltung (File-System-Access-API)
     · Schreib-/Download-Helfer für das Volltextindex-Modul
     · Einstellungen-Dialog (Index, Watcher, Start-Audio)
   ================================================================ */
(function () {
'use strict';

if (!window.IP67 || !window.IP67._internal) {
  console.error('[Admin] Core nicht geladen – Modul wird übersprungen.');
  return;
}

const I = window.IP67._internal;
const INDEX_FILE_NAME = I.INDEX_FILE_NAME;

/* ============================================================
   1. SAVE-FOLDER-API (File-System-Access-API)
============================================================ */
async function getSaveFolderHandle(promptIfMissing) {
  if (!I.hasFileSystemAccessAPI()) return null;
  let handle = await I.idbSettingGet('saveFolder');
  if (!handle && promptIfMissing) {
    try {
      handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'ip67-save-folder' });
      await I.idbSettingPut('saveFolder', handle);
    } catch (e) {
      if (e && e.name === 'AbortError') return null;
      throw e;
    }
  }
  if (handle) {
    const perm = await ensureRwPermission(handle);
    if (!perm) return null;
  }
  return handle || null;
}

async function ensureRwPermission(handle) {
  if (!handle.queryPermission) return true;
  let perm = await handle.queryPermission({ mode: 'readwrite' });
  if (perm === 'granted') return true;
  perm = await handle.requestPermission({ mode: 'readwrite' });
  return perm === 'granted';
}

async function writeFileToFolder(handle, fileName, contents, mime) {
  const fileHandle = await handle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(new Blob([contents], { type: mime || 'application/octet-stream' }));
  await writable.close();
}

function downloadFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function pickSaveFolder() {
  if (!I.hasFileSystemAccessAPI()) {
    I.toast('Ihr Browser unterstützt die Ordnerauswahl nicht (nur Edge/Chrome). Es wird der Download-Ordner verwendet.');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'ip67-save-folder' });
    await I.idbSettingPut('saveFolder', handle);
    if (I.getModalCtx() && I.getModalCtx().action === 'settings') renderModalBody();
    I.toast('✓ Speicher-Ordner gemerkt: ' + (handle.name || 'Ordner'));
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    I.toast('Ordner konnte nicht gewählt werden: ' + e.message);
  }
}

async function clearSaveFolder() {
  await I.idbSettingDelete('saveFolder');
  if (I.getModalCtx() && I.getModalCtx().action === 'settings') renderModalBody();
  I.toast('Gemerkter Speicher-Ordner entfernt – der Index wird künftig heruntergeladen.');
}

/* ============================================================
   3. EINSTELLUNGEN
============================================================ */
function settingsForm() {
  const searchIndex = I.getSearchIndex();
  const indexedCount = Object.keys(searchIndex).length;

  /* Live-Stand der Ordnerablage anzeigen. */
  const lt = (window.IP67LiveTree && window.IP67LiveTree.getState())
    ? window.IP67LiveTree.getState() : null;
  let treeHint;
  if (!lt) {
    treeHint = '<em>LiveTree-Modul nicht geladen</em>';
  } else if (lt.source === 'live') {
    /* ?v=9.3: ID-Modus mit ausgeben. „pfad" bedeutet, dass dieses
       SharePoint keine UniqueId liefert – dann kosten Umbenennungen
       weiterhin eine Neu-Indizierung. Unlesbare Ordner werden genannt,
       weil sie das Aufräumen des Index aussetzen. */
    treeHint = `✓ Live aus SharePoint · ${lt.folders} Ordner · ${lt.files} Dateien` +
               (lt.idMode === 'pfad' ? ' · ⚠ IDs aus dem Pfad (keine UniqueId)' : '') +
               (lt.incomplete ? ` · ⚠ ${lt.incomplete} Ordner nicht lesbar` : '');
  } else if (lt.source === 'cache') {
    treeHint = `⚠ SharePoint nicht erreichbar – letzter bekannter Stand (${lt.folders} Ordner, ${lt.files} Dateien)`;
  } else {
    treeHint = `✗ Struktur konnte nicht geladen werden${lt.error ? ' (' + I.escHtml(lt.error) + ')' : ''}`;
  }

  /* Stand des automatischen Index-Abgleichs. */
  const sy = (window.IP67IndexSync && window.IP67IndexSync.getState())
    ? window.IP67IndexSync.getState() : null;
  let syncHint;
  if (!sy || !sy.ran) {
    syncHint = 'Automatischer Abgleich läuft noch …';
  } else if (sy.extraktion === false) {
    syncHint = '⚠ ' + I.escHtml(sy.hinweis);
  } else if (sy.offen === 0) {
    syncHint = '✓ Abgleich mit der Ablage erledigt – Index ist aktuell' +
               (sy.entfernt ? ` · ${sy.entfernt} verwaiste Einträge entfernt` : '');
  } else {
    syncHint = `${sy.offen} Dokument(e) offen · ${sy.erledigt} in dieser Sitzung nachgeholt` +
               (sy.laeuft ? ' · läuft gerade …' : '') +
               (sy.uebersprungen ? ` · ${sy.uebersprungen} für den nächsten Start vorgemerkt` : '');
  }
  /* ?v=9.3: Umgehängte Einträge und ausgesetztes Aufräumen anhängen.
     Beides sind Vorgänge, die man sehen können muss – das eine, weil es
     eine ersparte Neu-Indizierung belegt, das andere, weil es auf einen
     unvollständig gelesenen Baum hinweist. */
  if (sy && sy.ran) {
    if (sy.umgehaengt) {
      syncHint += ` · ${sy.umgehaengt} umbenannt/verschoben erkannt und übernommen`;
    }
    if (sy.geschuetzt) {
      syncHint += `<br><span style="color:var(--warn,#b45309)">⚠ Aufräumen ausgesetzt: ` +
                  I.escHtml(sy.geschuetzt) + ' – es wurde nichts gelöscht.</span>';
    }
  }

  /* v8.6 · Punkt 2/8: Der Block „Speicher-Ordner für den Volltextindex"
     entfällt ebenso wie der Datei-Watcher. Beide waren im Alltag ohne
     Nutzen: der Ordner-Picker ist auf HTTP gar nicht verfügbar, und der
     Watcher setzte genau diesen Ordner voraus. Übrig blieben nur zwei
     Warnhinweise, die niemand auflösen konnte. */

  /* Kurzstand der Lesbarkeit für Sprachausgabe. Rein rechnend über
     bereits geladene Daten – kostet nichts. Solange der Index-Abgleich
     läuft, wird bewusst keine Quote genannt: sie wäre irreführend, weil
     jede noch nicht ausgelesene Datei sowohl „lesbar" als auch
     „kein Text" werden kann. */
  let a11yHint;
  if (!window.IP67 || typeof window.IP67.a11yPruefe !== 'function') {
    a11yHint = '<em>Prüfmodul nicht geladen</em>';
  } else {
    try {
      const a = window.IP67.a11yPruefe();
      if (a.fehler) {
        a11yHint = '⚠ ' + I.escHtml(a.fehler);
      } else if (!a.abgleichDurch) {
        a11yHint = `Noch keine belastbare Aussage – ${a.k.offen} Dokument(e) ` +
                   'sind noch nicht ausgelesen';
      } else if (a.k.keinText === 0 && a.k.duenn === 0) {
        a11yHint = `✓ Alle ${a.k.bewertbar} bewertbaren Dokumente sind vorlesbar`;
      } else {
        a11yHint = `${a.k.quote.toFixed(0)} % der bewertbaren Dokumente vorlesbar · ` +
                   `${a.k.keinText} ohne Text` +
                   (a.k.duenn ? ` · ${a.k.duenn} mit auffällig wenig Text` : '');
      }
    } catch (e) {
      a11yHint = '⚠ Prüfung fehlgeschlagen: ' + I.escHtml(e.message);
    }
  }

  return `
    <div class="set-sec">
      <div class="set-sec-h">Themenstruktur</div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-status">${treeHint}</div>
          <div class="set-desc">
            Wird bei jedem Öffnen automatisch aus dem SharePoint-Ordner
            <code>Ablage</code> aufgebaut. Ordner und Dateien direkt in
            SharePoint anlegen oder umbenennen – ein Veröffentlichen in der
            Anwendung ist nicht nötig.
          </div>
        </div>
      </div>
    </div>

    <div class="set-sec">
      <div class="set-sec-h">Volltextsuche</div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-status">${indexedCount} von ${I.countItems()} Einträgen indiziert</div>
          <div class="set-desc">${syncHint}</div>
          <div class="set-desc">Speicherort: <strong>IndexedDB</strong> (mehrere hundert MB möglich)</div>
        </div>
        <button class="set-btn" onclick="IP67.openIndexModal()">Index verwalten …</button>
      </div>
    </div>

    <div class="set-sec">
      <div class="set-sec-h">Barrierefreiheit</div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-status">${a11yHint}</div>
          <div class="set-desc">
            Prüft, welche Dokumente eine Textebene besitzen und damit von
            einer Sprachausgabe vorgelesen werden können. Gescannte PDFs
            ohne Texterkennung sind für blinde Nutzerinnen und Nutzer
            unlesbar – sie erscheinen im Bericht rot. Der Lauf wertet nur
            vorhandene Daten aus und stellt keine Anfrage an SharePoint.
          </div>
        </div>
        <button class="set-btn" onclick="IP67.openA11yCheck()">Bericht öffnen …</button>
      </div>
    </div>

    <div class="set-sec">
      <div class="set-sec-h">Start-Erklärung (MP3 beim Öffnen)</div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-desc">
            Das MP3 „Infopool Erklärung html-Start" wird beim Öffnen der Seite
            abgespielt, solange das eingetragene Datum nicht überschritten ist.
            Leeres Feld = kein automatisches Abspielen.
          </div>
        </div>
        <input type="date" id="f_startAudioExpiry" class="set-date"
               value="${I.escAttr(localStorage.getItem('ip67-start-audio-expiry') || '')}"
               onchange="IP67._saveStartAudioExpiry(this.value)">
      </div>
    </div>

    <div class="set-sec">
      <div class="set-sec-h">Aktionen</div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-desc">
            Löscht den lokalen Volltextindex und lädt die Seite neu.
            Die Dateien in SharePoint bleiben unberührt.
          </div>
        </div>
        <button class="set-btn set-btn-warn" onclick="IP67.resetAll()">Zurücksetzen</button>
      </div>
    </div>
  `;
}

function renderModalBody() {
  const body = document.getElementById('modalBody');
  if (!body) return;
  body.innerHTML = settingsForm();
}

/* Damit der Core (watcherToggle/setInterval) neu zeichnen kann. */
window.IP67._renderSettingsBody = renderModalBody;

/* ============================================================
   4. MODAL (nur noch Einstellungen)
============================================================ */
function openModal() {
  I.setModalCtx({ action: 'settings' });
  const overlay = document.getElementById('adminModal');
  const title   = document.getElementById('modalTitle');
  const saveBtn = document.getElementById('modalSaveBtn');
  if (!overlay) return;
  if (title) title.textContent = 'Einstellungen';
  if (saveBtn) saveBtn.style.display = 'none';
  renderModalBody();
  overlay.classList.add('show');
}

function closeModal() {
  const overlay = document.getElementById('adminModal');
  if (overlay) overlay.classList.remove('show');
  I.setModalCtx(null);
}

/* ============================================================
   5. ZURÜCKSETZEN
============================================================ */
async function resetAll() {
  if (!confirm('Lokalen Volltextindex und zwischengespeicherte Daten zurücksetzen?\n\nDie Dateien in SharePoint bleiben unverändert.')) return;
  try { localStorage.removeItem(I.STORAGE_KEY); } catch (_) {}
  try { await I.idbClear(); } catch (_) {}
  location.reload();
}

/* ============================================================
   6. ÖFFENTLICHE FUNKTIONEN REGISTRIEREN
============================================================ */
window.IP67._adminHelpers = { getSaveFolderHandle, writeFileToFolder, downloadFile };

const real = {
  openModal, closeModal, resetAll,
  pickSaveFolder, clearSaveFolder,
  _saveStartAudioExpiry(val) {
    if (val) localStorage.setItem('ip67-start-audio-expiry', val);
    else     localStorage.removeItem('ip67-start-audio-expiry');
    I.toast('✓ Datum gespeichert');
  }
};
Object.keys(real).forEach(k => { window.IP67[k] = real[k]; });

console.info('[Info-Pool 67] admin.js (v8.4, ohne Strukturbearbeitung) bereit');

})();
