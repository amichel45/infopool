/* ============================================================
   Info-Pool 67 – Core-Anwendungslogik (v7.4)
   ============================================================
   Globales Objekt: window.IP67
   Datenquellen:   window.sidebarInitData  (aus sidebar-data.js)
                   ./search-index.js     (optional, für Volltext)
   Speicherorte:   localStorage["ip67-sidebar-v2"]
                   localStorage["ip67-theme"]
                   localStorage["ip67-watcher-enabled"]
                   localStorage["ip67-watcher-interval"]
                   IndexedDB:  "ip67-db" / store "fulltext"
                               "ip67-db" / store "settings"

   ── Aufteilung ──────────────────────────────────────────
   Diese Datei (infopool67.js) enthält nur das Kern-Modul:
     · Sidebar laden, rendern, klicken
     · Welcome-Screen + Dokument-Viewer (PDF/HTML/Bilder/TXT)
     · Volltextsuche (Multi-Term-AND, Phrasen, Ranking, Stemmer)
     · Ähnliche Dokumente (TF-IDF + Cosine, lazy)
     · Anker/Scroll/Highlight beim Öffnen aus Suchergebnis
     · Datei-Watcher (Polling der gewählten Ordner)
     · Theme, Toast, Mobile-Toggle

   Lazy nachgeladen, sobald gebraucht:
     · infopool67_admin.js   – Bearbeiten/Hinzufügen/Drag&Drop/
                                Veröffentlichen/Einstellungen
     · infopool67_index.js   – Datei-Extraktion + Index-Modal

   ── Geändert in v7.4 (Phase 3) ────────────────────────
   · 3 Teil 3 – Leichter deutscher Stemmer (Suffix-Stripping)
     mit Umlaut-Normalisierung. Wird auf Such-Terme und auf
     Dokument-Terme angewendet – AND-Suche findet jetzt auch
     Pluralformen, Komposita-Suffixe und gebeugte Varianten.
   · 5 Teil 2 + 7 – Anker/Scroll/Highlight: Beim Öffnen eines
     Treffers aus der Suche werden die Such-Terme an den Viewer
     übergeben. Bei PDFs wird der eingebaute Browser-Viewer per
     #search=&page= angesprungen, bei HTML/HTM per Text-
     Fragmenten (#:~:text=). Eine kleine Anker-Leiste zeigt den
     Suchkontext.
   · 6 – Datei-Watcher: Polling-basiertes Beobachten des
     Veröffentlichungs-Ordners (oder eines separat gewählten
     Ordners). Geänderte/neue Dateien werden im Index automatisch
     aktualisiert. Status, Log und Intervall in den Einstellungen.
   · MHT/MHTML wird nicht mehr unterstützt (war schon in v7.2
     entfernt; in Phase 3 endgültig aus Doku/Logik raus).
   ============================================================ */
(function(){
'use strict';

/* ── KONSTANTEN ── */
const STORAGE_KEY            = 'ip67-sidebar-v2';
const OLD_INDEX_STORAGE_KEY  = 'ip67-search-index-v1';
const IDB_NAME               = 'ip67-db';
const IDB_VERSION            = 2;
const IDB_STORE              = 'fulltext';
const IDB_STORE_SETTINGS     = 'settings';

const NEW_THRESHOLD_DAYS     = 14;
const NEW_DOCS_LIMIT         = 5;

const INDEX_FILE_NAME        = 'search-index.js';
const INDEX_FILE_NAME_2      = 'html Zusätzliche Seiten/Mitarbeiterliste.json';
const SNIPPET_LEN            = 200;
const SNIPPETS_PER_DOC       = 15;
const SNIPPETS_INITIAL_SHOW  = 3;
const MIN_QUERY_LENGTH       = 2;
const SUPPORTED_INDEX_EXTS   = ['pdf','docx','xlsx','xls','txt','csv','msg','eml','html','htm'];

/* ── Phase-2-Konstanten ── */
const TOP_TERMS_LIMIT        = 50;   // wie viele Terme pro Dok für Ähnlichkeit/IDF speichern
const MIN_TERM_LEN           = 3;    // Mindestlänge für Token (gilt für Ähnlichkeit)
const SIM_DOCS_LIMIT         = 5;    // Top-N ähnliche Dokumente anzeigen
const SIM_THRESHOLD          = 0.05; // Cosine-Schwelle, unter der kein Treffer angezeigt wird
const SNIPPET_WINDOW         = 220;  // Fenster für „mehrere Terme im selben Snippet"

/* ── Phase-3-Watcher-Konstanten ──
   MÜSSEN vor IP67_INTERNAL deklariert werden, weil const-Deklarationen
   nicht gehoistet werden (Temporal Dead Zone). Sonst bricht das gesamte
   Skript beim Laden mit ReferenceError ab. */
const WATCHER_ENABLED_KEY      = 'ip67-watcher-enabled';
const WATCHER_INTERVAL_KEY     = 'ip67-watcher-interval';  // Sekunden
const WATCHER_MIN_INTERVAL     = 15;
const WATCHER_DEFAULT_INTERVAL = 60;
const WATCHER_LOG_MAX          = 30;

/* ── Phase-4-Konstanten (Recent / Suchhistorie / Statistik) ── */
const RECENT_KEY            = 'ip67-recent-docs';
const RECENT_LIMIT          = 8;
const SEARCH_HISTORY_KEY    = 'ip67-search-history';
const SEARCH_HISTORY_LIMIT  = 8;
const STATS_KEY             = 'ip67-access-stats';
const BROWSER_ID_KEY        = 'ip67-browser-id';
const STATS_SHARE_ENABLED   = 'ip67-stats-share-enabled';
const STATS_SUBFOLDER       = 'stats';   // Unterordner im Save-Folder

/* Deutsche/englische Stoppwörter – klein gehalten,
   nur die wirklich häufigsten. */
const STOPWORDS = new Set([
  // Artikel & Pronomen
  'der','die','das','des','dem','den','ein','eine','einer','eines','einem','einen',
  'er','sie','es','ich','du','wir','ihr','man','mir','mich','dich','dir',
  'uns','euch','ihm','ihn','ihnen','ihre','ihrer','sein','seine','seiner',
  'this','that','these','those','they','them','their','its',
  // Konjunktionen
  'und','oder','aber','wenn','weil','als','auch','doch','sondern','denn','dass',
  'and','or','but','if','because','that','than','then',
  // Hilfsverben
  'ist','sind','war','waren','wird','werden','wurde','wurden','worden',
  'hat','haben','hatte','hatten','kann','können','konnte','muss','müssen',
  'soll','sollen','will','wollen','wollte',
  'is','are','was','were','be','been','being','have','has','had','do','does','did',
  'will','would','should','could','can','may','might','must',
  // Präpositionen & Adverbien
  'mit','von','zu','zur','zum','für','auf','im','am','an','bei',
  'durch','über','unter','vor','nach','aus','um','beim','vom',
  'sich','nicht','noch','nur','mehr','sehr','schon','wie','wo',
  'of','in','on','at','to','for','by','with','from','as','into','about',
  // Sonstiges
  'ja','nein','etc','bzw','usw','ggf','siehe','vgl','ca','etwa','rund',
  'http','https','www','com','html','htm','pdf','docx','xlsx','msg','eml',
  'alle','allen','aller','alles','viele','vielen','vieler','mehrere',
  'oben','unten','dabei','daher','dazu','dort','hier','jetzt','heute',
  'sowie','sowohl','wegen','ohne','gegen','statt','zwischen'
]);

const MODULE_URLS = {
  admin: 'infopool67_admin_v8.js?v=8.2',
  index: 'infopool67_index_v8.js?v=8.2'
};

/* ── AUDIO-STATE ── */
let _startAudio = null;   // Audio-Objekt für Start-MP3
/* ── STATE ── */
let data            = [];
let modalCtx        = null;
let currentHref     = '#';
let currentLabel    = '';
let openGroupIds    = new Set();

let searchIndex     = {};
let indexLoaded     = false;
let indexFilter     = '';
let indexFilterStatus = 'all';

let currentQuery       = '';
let currentSearchHits  = null;
let currentSearchTerms = null; // Array von {term, isPhrase} aus parseQuery
let searchDebounceTimer = null;

/* Phase 2: IDF-Cache (wird invalidiert, sobald Index sich ändert) */
let _idfCache = null;
/* Phase 2: Cache für „Ähnliche Dokumente"-Ergebnisse pro doc-id */
const _similarCache = new Map();
/* Phase 2: Currently open document id (für Viewer-Toolbar „Ähnliche") */
let currentDocId = null;

const moduleLoaders = {};

/* ============================================================
   GLOBALE INTERNE API (Shared State + Helpers)
   Wird auch von admin.js und index.js benutzt.
============================================================ */
const IP67_INTERNAL = {
  getData:       () => data,
  setData:       v  => { data = v; },
  getModalCtx:   () => modalCtx,
  setModalCtx:   v  => { modalCtx = v; },
  getOpenGroupIds: () => openGroupIds,
  getSearchIndex:() => searchIndex,
  setSearchIndex:v  => { searchIndex = v; },
  getIndexFilter:() => indexFilter,
  setIndexFilter:v  => { indexFilter = v; },
  getIndexFilterStatus:() => indexFilterStatus,
  setIndexFilterStatus:v=> { indexFilterStatus = v; },

  STORAGE_KEY, IDB_NAME, IDB_STORE, IDB_STORE_SETTINGS,
  INDEX_FILE_NAME, NEW_THRESHOLD_DAYS, SUPPORTED_INDEX_EXTS,
  TOP_TERMS_LIMIT, MIN_TERM_LEN, STOPWORDS,

  toast, escHtml, escAttr, today, makeId, formatDate, formatBytes,
  iconForHref, guessFormat, findNode, isDescendant, flatIndex,
  collectBreadcrumb, countAll, countItems, isNew,
  renderTree, renderNewDocsBox, saveData,
  openIDB, idbGetAll, idbPut, idbDelete, idbClear,
  idbSettingGet, idbSettingPut, idbSettingDelete,
  saveIndexEntry, deleteIndexEntry,
  hasFileSystemAccessAPI,

  /* Phase 2: Tokenizer + Top-Terms (auch von index.js verwendet) */
  tokenizeForTerms, extractTopTerms,
  invalidateSimilarityCache: () => { _idfCache = null; _similarCache.clear(); },

  /* Phase 3: Stemmer + Watcher-Render-Helper für admin.js */
  stemGerman, normalizeUmlauts,
  renderWatcherLog: (logEl) => _renderWatcherLog(logEl),
  WATCHER_MIN_INTERVAL, WATCHER_DEFAULT_INTERVAL
};

/* ============================================================
   1. SIDEBAR-DATEN LADEN / SPEICHERN
============================================================ */
function loadData() {
  /* v8.4: Die Themenstruktur wird bei jedem Start LIVE aus dem
     SharePoint-Ordner „Ablage" aufgebaut (infopool67_livetree_v8.js)
     und liegt dann in window.sidebarInitData.

     Der frühere localStorage-Stand (STORAGE_KEY) wird bewusst NICHT
     mehr gelesen: Er stammte aus der manuellen Pflege und würde den
     Live-Stand dauerhaft überdecken. Die Ausfallsicherung (letzter
     bekannter Stand bei nicht erreichbarem SharePoint) übernimmt das
     LiveTree-Modul selbst. */
  if (Array.isArray(window.sidebarInitData)) {
    return JSON.parse(JSON.stringify(window.sidebarInitData));
  }
  return [];
}

function saveData() {
  /* v8.4: Die Struktur ist nicht mehr bearbeitbar – sie ergibt sich
     ausschließlich aus der Ordnerablage in SharePoint. Ein Schreiben
     nach localStorage würde beim nächsten Start nur einen veralteten
     Stand erzeugen und unterbleibt daher bewusst. */
}

function makeId() {
  return 'i_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
}
function today() { return new Date().toISOString().slice(0,10); }

/* ============================================================
   2. INDEXEDDB
============================================================ */
let _idbPromise = null;
function openIDB() {
  if (_idbPromise) return _idbPromise;
  _idbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB nicht verfügbar'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      if (!db.objectStoreNames.contains(IDB_STORE_SETTINGS)) db.createObjectStore(IDB_STORE_SETTINGS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
  return _idbPromise;
}

async function idbGetAll() {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    const result = {};
    const req = store.openCursor();
    req.onsuccess = (e) => {
      const cur = e.target.result;
      if (cur) { result[cur.key] = cur.value; cur.continue(); }
      else resolve(result);
    };
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(id, entry) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(entry, id);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function idbDelete(id) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function idbClear() {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function idbSettingGet(key) {
  try {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_SETTINGS, 'readonly');
      const req = tx.objectStore(IDB_STORE_SETTINGS).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  } catch(e) { return undefined; }
}

async function idbSettingPut(key, value) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_SETTINGS, 'readwrite');
    tx.objectStore(IDB_STORE_SETTINGS).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function idbSettingDelete(key) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_SETTINGS, 'readwrite');
    tx.objectStore(IDB_STORE_SETTINGS).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

function hasFileSystemAccessAPI() {
  return typeof window.showDirectoryPicker === 'function';
}

async function loadIndex() {
  try { searchIndex = await idbGetAll(); }
  catch(e) { console.warn('IndexedDB konnte nicht gelesen werden:', e); searchIndex = {}; }

  if (Object.keys(searchIndex).length === 0) {
    try {
      const old = localStorage.getItem(OLD_INDEX_STORAGE_KEY);
      if (old) {
        const parsed = JSON.parse(old);
        if (parsed && typeof parsed === 'object') {
          for (const id in parsed) {
            const e = parsed[id];
            if (!e || !e.text) continue;
            const entry = {
              text:      e.text,
              indexedAt: e.indexedAt || today(),
              size:      e.size || e.text.length,
              fileName:  e.fileName || '',
              format:    e.format || guessFormat(e.fileName || '')
            };
            searchIndex[id] = entry;
            await idbPut(id, entry);
          }
          localStorage.removeItem(OLD_INDEX_STORAGE_KEY);
          if (Object.keys(searchIndex).length > 0) {
            console.info('[Info-Pool 67] Index migriert: localStorage → IndexedDB');
            toast('✓ Index migriert (' + Object.keys(searchIndex).length + ' Einträge)');
          }
        }
      }
    } catch(e) { console.warn('Index-Migration:', e); }
  }

  indexLoaded = true;
}

async function saveIndexEntry(id, entry) {
  searchIndex[id] = entry;
  _idfCache = null;          // Phase 2: IDF neu berechnen
  _similarCache.clear();     // Phase 2: Ähnlichkeits-Cache leeren
  try { await idbPut(id, entry); }
  catch(e) { console.warn('IDB-Schreiben:', e); toast('Speicher-Warnung: ' + e.message); }
}

async function deleteIndexEntry(id) {
  delete searchIndex[id];
  _idfCache = null;
  _similarCache.clear();
  try { await idbDelete(id); } catch(e) { console.warn(e); }
}

async function fetchIndexIfAvailable() {
  // ── Datei 1: search-index.js (per <script>-Tag eingebunden, kein fetch nötig) ──
  try {
    const parsed = (typeof window !== 'undefined') ? window.searchIndexData : null;
    if (parsed && typeof parsed === 'object') {
      /* ────────────────────────────────────────────────────────────
         v10.5 · BEFUND, der diesen Eingriff in die Kerndatei nötig
         machte (sonst gilt: die Kerndatei bleibt unangetastet).

         Diese Schleife baute den Eintrag aus der zentralen
         search-index.json NEU auf und übernahm dabei nur Text, Datum,
         Länge, Dateiname und Format. Alles mit Unterstrich – vor
         allem `_srcSize` – fiel weg, obwohl indexpush es beim
         Veröffentlichen ausdrücklich mitschreibt. Weil sie den
         vorhandenen Eintrag ausserdem ÜBERSCHRIEB, ging auch die
         örtlich erarbeitete Angabe verloren.

         Folge: Der Abgleich in infopool67_indexsync_v8.js fand kein
         `_srcSize` mehr und fiel auf den Datumsvergleich zurück. Ein
         Dokument, dessen Änderungsdatum in SharePoint neuer ist als
         der Tag der zentralen Aufnahme, galt damit bei JEDEM
         Seitenaufruf erneut als „veraltet": herunterladen, auslesen,
         Hinweisstreifen zeigen – und beim nächsten Start von vorn.
         Genau die Endlosschleife, die v10.4 für die textlosen
         Dateien bereits beseitigt hat, bestand für die lesbaren
         Dateien unbemerkt weiter.

         Zweiter Punkt: `if (!e.text) continue` liess die in v10.4
         eingeführten Vermerke ohne Text (`_keinText`) gar nicht
         herein. Das Wissen „aus dieser Datei ist nichts zu holen"
         wurde zwar zentral abgelegt, aber von keinem anderen Browser
         gelesen – die amtsweite Lernwirkung blieb aus.

         Diese Stelle liess sich nicht über die Glue-Schicht heilen:
         Eine nachträgliche Reparatur wäre ein Wettlauf gegen die
         Hintergrund-Warteschlange, die genau diese Felder liest.
         ──────────────────────────────────────────────────────────── */
      for (const id in parsed) {
        const e = parsed[id];
        if (!e) continue;
        if (!e.text && !e._keinText) continue;

        const alt = searchIndex[id] || null;
        /* Örtlich gewonnener Text schlägt einen zentralen Vermerk
           „kein Text" – hier weiss der Browser nachweislich mehr. */
        if (!e.text && alt && alt.text) continue;

        const entry = {
          text:      e.text || '',
          indexedAt: e.indexedAt || today(),
          size:      (typeof e.size === 'number') ? e.size : (e.text ? e.text.length : 0),
          fileName:  e.fileName || (alt && alt.fileName) || '',
          format:    e.format || guessFormat(e.fileName || '')
        };
        if (Array.isArray(e.pageBreaks)) entry.pageBreaks = e.pageBreaks;
        if (typeof e.totalPages === 'number') entry.totalPages = e.totalPages;
        // Phase 2: topTerms + totalTokens übernehmen, falls vorhanden
        if (e.topTerms && typeof e.topTerms === 'object') entry.topTerms = e.topTerms;
        if (typeof e.totalTokens === 'number') entry.totalTokens = e.totalTokens;

        /* v10.5: Bezugspunkte der Veraltet-Erkennung mitnehmen. Fehlen
           sie zentral, gilt der örtlich bekannte Wert weiter – er ist
           allemal besser als gar keiner. ACHTUNG: `size` ist die
           Textlänge, `_srcSize` die Bytegrösse der Quelldatei; die
           beiden dürfen nie verwechselt werden. */
        const srcSize = (typeof e._srcSize === 'number') ? e._srcSize
                      : (alt && typeof alt._srcSize === 'number') ? alt._srcSize : null;
        if (srcSize !== null) entry._srcSize = srcSize;
        const srcMod = e._srcModified || (alt && alt._srcModified) || '';
        if (srcMod) entry._srcModified = srcMod;
        const uid = e._uid || (alt && alt._uid) || '';
        if (uid) entry._uid = uid;
        const href = e._href || (alt && alt._href) || '';
        if (href) entry._href = href;

        /* v10.5: Vermerk „nicht auslesbar" übernehmen, damit jeder
           Arbeitsplatz das Ergebnis einmal erfährt statt es selbst
           noch einmal zu erarbeiten. */
        if (e._keinText) {
          entry._keinText      = e._keinText;
          entry._keinTextGrund = e._keinTextGrund || '';
          if (e._versuchtAm) entry._versuchtAm = e._versuchtAm;
        }

        searchIndex[id] = entry;
        try { await idbPut(id, entry); } catch(_){}
      }
      _idfCache = null;
      _similarCache.clear();
      console.info('[Info-Pool 67] Volltext-Index geladen:', Object.keys(parsed).length, 'Einträge');
    }
  } catch(_e) { /* search-index.js nicht vorhanden – ignoriert */ }

  /* ── Datei 2: Mitarbeiterliste ──────────────────────────────────
     v8.4: EINZIGE Quelle ist Mitarbeiterliste.json mit strukturierten
     Datensaetzen (orga / name / zustaendigkeit / handynummer / …).
     Die frueheren flachen Sucheintraege (drei je Person, erzeugt von
     mitarbeiterliste.js) sind entfallen – sie waren eine zweite,
     abweichende Darstellung derselben Daten und mussten bei jeder
     Aenderung mitgepflegt werden. Der Suchtext wird jetzt zur Laufzeit
     aus dem Datensatz gebildet. */
  try {
    const list = window.__ip67_mitarbeiterliste;
    if (Array.isArray(list) && list.length > 0) {
      let imported = 0, skipped = 0;
      for (const m of list) {
        if (!m || !m.name) { skipped++; continue; }
        const id   = 'person::' + (m.id || m.name);
        const text = [m.name, m.orga, m.zustaendigkeit, m.handynummer]
                       .filter(Boolean).join(' · ');
        const entry = {
          text:        text,
          indexedAt:   today(),
          size:        text.length,
          fileName:    m.name,
          format:      'person',
          _url:        m.intranetUrl || '',
          _name:       m.name,
          _isExternal: true
        };
        searchIndex[id] = entry;
        try { await idbPut(id, entry); } catch(_){}
        imported++;
      }
      _idfCache = null;
      _similarCache.clear();
      console.info('[Info-Pool 67] Mitarbeiterliste geladen:', imported, 'Personen',
                   skipped > 0 ? '(' + skipped + ' ohne Namen übersprungen)' : '');
    } else if (list !== undefined) {
      console.error('[Info-Pool 67] Mitarbeiterliste ist kein Array oder leer:', list);
    } else {
      console.warn('[Info-Pool 67] Mitarbeiterliste.json nicht geladen – Suche enthält keine Personen.');
    }
  } catch(err) {
    console.error('[Info-Pool 67] Mitarbeiterliste-Import-Fehler:', err);
  }
}

function guessFormat(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  return SUPPORTED_INDEX_EXTS.indexOf(ext) >= 0 ? ext : 'txt';
}

/* ============================================================
   3. TREE-OPERATIONEN (nur Lesen im Core)
============================================================ */
function findNode(id, list, parent) {
  list = list || data;
  parent = parent || null;
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return { node: list[i], parent, parentList: list, index: i };
    if (list[i].children) {
      const found = findNode(id, list[i].children, list[i]);
      if (found) return found;
    }
  }
  return null;
}

function isDescendant(maybeChildId, ancestorId) {
  const a = findNode(ancestorId);
  if (!a || !a.node.children) return false;
  const stack = [...a.node.children];
  while (stack.length) {
    const n = stack.pop();
    if (n.id === maybeChildId) return true;
    if (n.children) stack.push(...n.children);
  }
  return false;
}

function flatIndex() {
  const items = [];
  const walk = (arr, breadcrumb) => {
    arr.forEach(n => {
      items.push({ node: n, parent: breadcrumb });
      if (n.children) walk(n.children, breadcrumb.concat([n.title]));
    });
  };
  walk(data, []);
  return items;
}

function collectBreadcrumb(id) {
  const path = [];
  const walk = (arr, current) => {
    for (const n of arr) {
      if (n.id === id) { Array.prototype.push.apply(path, current); return true; }
      if (n.children) { if (walk(n.children, current.concat([n.title]))) return true; }
    }
    return false;
  };
  walk(data, []);
  return path;
}

function countAll() {
  let n = 0;
  const walk = arr => arr.forEach(x => { n++; if (x.children) walk(x.children); });
  walk(data);
  return n;
}
function countItems() {
  let n = 0;
  const walk = arr => arr.forEach(x => {
    if (x.type === 'item' && x.href && x.href !== '#' && x.href !== '#home') n++;
    if (x.children) walk(x.children);
  });
  walk(data);
  return n;
}

/* ============================================================
   4. RENDERING (Sidebar)
============================================================ */
function escHtml(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escAttr(s){ return String(s == null ? '' : s).replace(/"/g,'&quot;'); }

function isNew(node) {
  if (!node.dateAdded) return false;
  const d = new Date(node.dateAdded);
  if (isNaN(d.getTime())) return false;
  const days = (Date.now() - d.getTime()) / 86400000;
  return days <= NEW_THRESHOLD_DAYS;
}

function renderTree() {
  const container = document.getElementById('sidebarContent');
  if (!container) return;

  document.querySelectorAll('.nav-children.open').forEach(el => {
    const pid = el.getAttribute('data-parent-id');
    if (pid) openGroupIds.add(pid);
  });

  container.innerHTML = '<div class="nav-tree">' +
    data.map(node => renderNode(node, 0)).join('') +
    '</div>';

  openGroupIds.forEach(id => {
    const node = container.querySelector('.nav-node[data-id="' + id + '"]');
    if (!node) return;
    const row = node.querySelector(':scope > .nav-row');
    const children = node.querySelector(':scope > .nav-children');
    if (children) children.classList.add('open');
    if (row) row.classList.add('open');
  });

}

function renderNode(node, depth) {
  const padPx = 0.6 + depth * 0.9;
  const padStyle = `--row-pad:${padPx}rem`;
  const newBadge = isNew(node) ? '<span class="new-badge">NEU</span>' : '';

  if (node.type === 'item') {
    return `
      <div class="nav-node" data-id="${node.id}">
        <a class="nav-row item-row" style="${padStyle}" data-id="${node.id}"
           href="${escAttr(node.href || '#')}"
           data-act="row">
          <span class="nav-icon">${escHtml(node.icon || iconForHref(node.href))}</span>
          <span class="nav-label">${escHtml(node.title)}${newBadge}</span>
        </a>
      </div>`;
  }

  const childrenHTML = (node.children || []).map(c => renderNode(c, depth + 1)).join('');

  return `
    <div class="nav-node" data-id="${node.id}">
      <button class="nav-row group-row" style="${padStyle}" data-id="${node.id}" type="button" data-act="row">
        <span class="nav-icon">${escHtml(node.icon || '📂')}</span>
        <span class="nav-label">${escHtml(node.title)}${newBadge}</span>
      </button>
      <div class="nav-children" data-parent-id="${node.id}">
        ${childrenHTML}
      </div>
    </div>`;
}

function iconForHref(href) {
  if (!href || href === '#' || href === '#home') return '📄';
  const ext = (href.split('.').pop() || '').toLowerCase();
  return { pdf:'📕', xlsx:'📊', xls:'📊', docx:'📝', doc:'📝',
           pptx:'📊', ppt:'📊', htm:'🌐', html:'🌐',
           txt:'📃', csv:'📊', png:'🖼', jpg:'🖼', jpeg:'🖼',
           one:'📓',
           msg:'✉️', eml:'✉️' }[ext] || '📄';
}

/* ============================================================
   5. KLICK-HANDLING
============================================================ */
function sidebarClickHandler(event) {
  const target = event.target.closest('[data-act]');
  if (!target) return;
  const act = target.getAttribute('data-act');
  const id  = target.getAttribute('data-id');

  if (act === 'toggle') { event.preventDefault(); event.stopPropagation(); toggleGroup(id); return; }
  if (act === 'row')  { handleRowClick(event, id); return; }
}

function handleRowClick(event, id) {
  const f = findNode(id);
  if (!f) return;

  if (f.node.type === 'group') {
    event.preventDefault(); event.stopPropagation();
    toggleGroup(id);
    return false;
  }

  event.preventDefault(); event.stopPropagation();
  if (f.node.href === '#home') showWelcome();
  else                          openDoc(f.node.href || '#', f.node.title);
  return false;
}

function toggleGroup(id) {
  const node = document.querySelector(`.nav-node[data-id="${id}"]`);
  if (!node) return;
  const row = node.querySelector(':scope > .nav-row');
  const children = node.querySelector(':scope > .nav-children');
  if (!children) return;
  const willOpen = !children.classList.contains('open');
  children.classList.toggle('open', willOpen);
  if (row) row.classList.toggle('open', willOpen);
  if (willOpen) openGroupIds.add(id);
  else openGroupIds.delete(id);
}

function setActive(label) {
  document.querySelectorAll('.nav-row.active').forEach(r => r.classList.remove('active'));
  if (!label) return;
  document.querySelectorAll('.nav-row').forEach(r => {
    const lbl = r.querySelector('.nav-label');
    if (lbl && lbl.textContent.replace(/NEU$/, '').trim() === label) {
      r.classList.add('active');
      let p = r.closest('.nav-children');
      while (p) {
        p.classList.add('open');
        const pNode = p.parentElement;
        if (pNode) {
          const pRow = pNode.querySelector(':scope > .nav-row');
          if (pRow) pRow.classList.add('open');
          const pid = pNode.getAttribute('data-id');
          if (pid) openGroupIds.add(pid);
        }
        p = p.parentElement ? p.parentElement.closest('.nav-children') : null;
      }
    }
  });
}

/* ============================================================
   6. KEYBOARD
============================================================ */
function keyDownHandler(e) {
  if (e.key === 'Escape') {
    const m = document.getElementById('adminModal');
    const im = document.getElementById('indexModal');
    if (im && im.classList.contains('show') && IP67.closeIndexModal) { IP67.closeIndexModal(); return; }
    if (m && m.classList.contains('show') && IP67.closeModal)   { IP67.closeModal(); return; }
    const ae = document.activeElement;
    if (ae && ae.id === 'sidebarSearch' && currentQuery) { clearSearch(); return; }
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
    const ae = document.activeElement;
    const isInForm = ae && ['INPUT','TEXTAREA','SELECT'].indexOf(ae.tagName) >= 0;
    if (!isInForm || (ae && ae.id === 'sidebarSearch')) {
      e.preventDefault();
      const s = document.getElementById('sidebarSearch');
      if (s) { s.focus(); s.select(); }
    }
    return;
  }

}

/* ============================================================
   8. NEUE-DOKUMENTE-BOX
============================================================ */
function getNewDocs() {
  const all = [];
  const walk = (arr, breadcrumb) => {
    arr.forEach(n => {
      if (n.type === 'group') walk(n.children || [], breadcrumb.concat([n.title]));
      else if (isNew(n) && n.href !== '#home') all.push({ node: n, breadcrumb });
    });
  };
  walk(data, []);
  all.sort((a,b) => new Date(b.node.dateAdded) - new Date(a.node.dateAdded));
  return all.slice(0, NEW_DOCS_LIMIT);
}

function renderNewDocsBox() {
  const box = document.getElementById('newDocsBox');
  const list = document.getElementById('newDocsList');
  if (!box || !list) return;
  const news = getNewDocs();
  if (news.length === 0) { box.classList.add('empty'); return; }
  box.classList.remove('empty');
  list.innerHTML = news.map(n => {
    const path = n.breadcrumb.length > 0 ? n.breadcrumb.join(' › ') : 'Hauptmenü';
    const date = formatDate(n.node.dateAdded);
    return `
      <a class="new-docs-item" href="${escAttr(n.node.href || '#')}"
         onclick="IP67.openDoc(this.getAttribute('href'), ${JSON.stringify(n.node.title)}); return false;"
         title="${escAttr(path)}">
        <span class="ndi-icon">${escHtml(n.node.icon || iconForHref(n.node.href))}</span>
        <span class="ndi-title">${escHtml(n.node.title)}</span>
        <span class="ndi-date">${date}</span>
        <span class="ndi-badge">NEU</span>
      </a>`;
  }).join('');
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('de-DE', { day:'2-digit', month:'short', year:'numeric' });
  } catch(e){ return iso; }
}

function formatBytes(n) {
  if (!n) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB';
  return (n/(1024*1024)).toFixed(2) + ' MB';
}

/* ============================================================
   9. DOKUMENT-ANSICHT
   ──────────────────────────────────────────────────────────
   v7.2: MHT/MHTML-Support entfernt. HTML/HTM bleiben im
   Viewer; alle anderen Dateien werden vom Browser nativ
   geöffnet (PDF inline, alles Andere im Standardprogramm).
============================================================ */
const VIEWABLE_EXTS = ['pdf','html','htm','txt','png','jpg','jpeg','gif','webp','svg'];

function getExt(href) {
  if (!href) return '';
  const clean = href.split(/[?#]/)[0];
  const dot = clean.lastIndexOf('.');
  const slash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  if (dot < 0 || dot < slash) return '';
  return clean.slice(dot + 1).toLowerCase();
}

function isNetworkPath(href) { return !!href && href.startsWith('\\\\'); }

function isWebUrl(href) {
  return !!href && /^https?:\/\//i.test(href);
}

function canShowInIframe(href) {
  if (!href || href === '#' || href === '#home') return false;
  if (isNetworkPath(href)) return false;
  // Bug-Fix v7.4: Externe HTTP(S)-URLs (z.B. Intranet-Seiten der Stadt Köln)
  // lassen sich wegen X-Frame-Options / Content-Security-Policy meist NICHT
  // im iframe-Viewer darstellen → immer in neuem Browser-Tab öffnen.
  if (isWebUrl(href)) return false;
  return VIEWABLE_EXTS.indexOf(getExt(href)) >= 0;
}

function triggerNativeOpen(href) {
  const a = document.createElement('a');
  a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
  a.style.display = 'none';
  document.body.appendChild(a); a.click();
  setTimeout(() => { try { document.body.removeChild(a); } catch(e){} }, 200);
}

/* ============================================================
   PHASE 3 – Anker/Scroll/Highlight: Viewer-Such-State
   ──────────────────────────────────────────────────────────
   Wird von openDoc(href, label, {searchTerms, startPage})
   gesetzt und von jumpToNextHit() / hideSearchJumpBar() gelesen.
============================================================ */
let _viewerSearch = null; // {terms: [strings], startPage: <N>, hitIndex: <i>, hitPages: [<N>...]}

/* Baut für PDFs den Open-Parameter-Fragment-String:
     #page=N&search=foo
   Mehrere Suchterme werden mit Leerzeichen verbunden (Adobe-/
   Chrome-Konvention). */
function _buildPdfFragment(terms, page) {
  const parts = [];
  if (page && page > 0) parts.push('page=' + page);
  if (terms && terms.length > 0) {
    // Phrasen in Anführungszeichen, Einzelterme ohne. Mit + getrennt;
    // Chrome/Edge interpretieren die meisten Varianten.
    const q = terms.map(t => t.term).join(' ');
    parts.push('search=' + encodeURIComponent(q));
  }
  return parts.length > 0 ? '#' + parts.join('&') : '';
}

/* Baut für HTML/HTM den Text-Fragments-Fragment-String:
     #:~:text=foo
   Wir wählen den ersten verfügbaren Term. Phrasen werden ohne
   Anführungszeichen verwendet. Funktioniert in Chromium-basierten
   Browsern (Chrome, Edge, neuere Opera) für gleiche-Origin-Dateien. */
function _buildHtmlFragment(terms) {
  if (!terms || terms.length === 0) return '';
  // Längsten Term zuerst (ist meist am spezifischsten)
  const candidates = terms.map(t => t.term).sort((a, b) => b.length - a.length);
  for (const c of candidates) {
    if (c && c.length >= 3) {
      return '#:~:text=' + encodeURIComponent(c);
    }
  }
  return '';
}

function _populateJumpBar(terms, hit) {
  const bar = document.getElementById('searchJumpBar');
  const termsEl = document.getElementById('sjbTerms');
  const pageInfo = document.getElementById('sjbPageInfo');
  if (!bar || !termsEl) return;

  termsEl.innerHTML = terms.map(t => {
    const cls = 'sjb-term' + (t.isPhrase ? ' is-phrase' : '');
    const lbl = t.isPhrase ? `„${t.term}"` : t.term;
    return `<span class="${cls}">${escHtml(lbl)}</span>`;
  }).join(' ');

  if (pageInfo) {
    if (hit && hit.startPage) {
      pageInfo.textContent = '· Sprung zu Seite ' + hit.startPage;
    } else {
      pageInfo.textContent = '';
    }
  }
  bar.classList.add('visible');
}

function hideSearchJumpBar() {
  const bar = document.getElementById('searchJumpBar');
  if (bar) bar.classList.remove('visible');
  _viewerSearch = null;
}

/* ── DOM-Highlight-Injektion in HTML-iframe-Seiten ────────────────────────
   Wird von openDoc() nach iframe-onload aufgerufen, wenn ein Suchkontext
   vorhanden ist. Markiert alle Vorkommen der Suchterme mit <mark>-Tags.
============================================================ */
function _injectHighlightStyle(doc) {
  if (doc.getElementById('ip67-hl-style')) return;
  const style = doc.createElement('style');
  style.id = 'ip67-hl-style';
  style.textContent = 'mark.ip67-hl{background:#ffe066;color:inherit;border-radius:2px;padding:0 1px;}';
  (doc.head || doc.body).appendChild(style);
}

function _markTermsInDoc(doc, terms) {
  if (!terms || terms.length === 0) return 0;
  // Alle bestehenden alten Marks entfernen (bei erneutem Öffnen)
  doc.querySelectorAll('mark.ip67-hl').forEach(m => {
    m.replaceWith(doc.createTextNode(m.textContent));
  });
  // Regex: Alle Terme als Case-insensitive Alternation,
  // sortiert nach Länge (lange zuerst → vermeidet, dass kürzere
  // Form einen Teil der längeren matcht).
  const sorted = Array.from(new Set(terms)).filter(t => t && t.length >= 2)
                  .sort((a, b) => b.length - a.length);
  if (sorted.length === 0) return 0;
  const escaped = sorted.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp('(' + escaped.join('|') + ')', 'gi');
  const counter = { n: 0 };
  _markInNode(doc.body, pattern, doc, counter);
  return counter.n;
}

function _markInNode(node, pattern, doc, counter) {
  if (!node) return;
  // Text-Knoten: Regex anwenden und <mark> einfügen
  if (node.nodeType === 3) {
    const text = node.nodeValue;
    if (!pattern.test(text)) return;
    pattern.lastIndex = 0;
    const frag = doc.createDocumentFragment();
    let last = 0, m;
    while ((m = pattern.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)));
      const mark = doc.createElement('mark');
      mark.className = 'ip67-hl';
      mark.textContent = m[0];
      frag.appendChild(mark);
      if (counter) counter.n++;
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
    node.parentNode.replaceChild(frag, node);
    return;
  }
  // Elemente: rekursiv, aber Skripte/Styles/iframes überspringen
  if (node.nodeType === 1) {
    const skip = new Set(['SCRIPT','STYLE','IFRAME','TEXTAREA','INPUT','CODE','PRE']);
    if (skip.has(node.tagName)) return;
    Array.from(node.childNodes).forEach(child => _markInNode(child, pattern, doc, counter));
  }
}

/* Bug-Fix v7.5: Robuste Highlight-Anwendung im iframe.
   ──────────────────────────────────────────────────────────
   Probleme, die hier abgefangen werden:
   1) Cross-Origin file:// → file:// blockt contentDocument-Zugriff
      in Chrome/Edge (gibt `null` zurück, KEINEN Exception!)
   2) Seite lädt Inhalt nach onload nach (rare, aber möglich)
   3) Same-Path-Hash-Update feuert kein load-Event
   Lösung: Mehrfach-Versuch (0ms / 250ms / 1000ms), explizite
   Erkennung von Cross-Origin, sichtbares Toast-Feedback.
============================================================ */
function _runHighlightInFrame(frame, termsToMark, opts) {
  opts = opts || {};
  const attempts = [0, 250, 1000]; // ms
  let attemptIdx = 0;
  let lastError = null;
  let succeeded = false;

  function tryOnce() {
    if (succeeded) return;
    let doc = null;
    try {
      doc = frame.contentDocument;
      if (!doc && frame.contentWindow) {
        // contentWindow.document Zugriff wirft bei Cross-Origin (Firefox)
        doc = frame.contentWindow.document;
      }
    } catch (ex) {
      // Cross-Origin – Firefox wirft hier eine SecurityError
      lastError = 'cross-origin';
      scheduleNext();
      return;
    }

    // Chrome: contentDocument == null bei Cross-Origin (kein Exception)
    if (!doc) {
      lastError = 'cross-origin';
      scheduleNext();
      return;
    }

    if (!doc.body) {
      // Noch nicht fertig geladen
      lastError = 'not-ready';
      scheduleNext();
      return;
    }

    try {
      _injectHighlightStyle(doc);
      const count = _markTermsInDoc(doc, termsToMark);
      if (count > 0) {
        succeeded = true;
        // Zum ersten Treffer scrollen – im nächsten Animation-Frame,
        // damit Layout fertig ist.
        const first = doc.querySelector('mark.ip67-hl');
        if (first) {
          requestAnimationFrame(() => {
            try { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
            catch(_) { try { first.scrollIntoView(); } catch(__) {} }
          });
        }
        if (opts.onSuccess) opts.onSuccess(count);
        return;
      }
      // count == 0 → Inhalt da, aber kein Treffer.
      // Kann passieren, wenn Seite Inhalt noch nachlädt → erneut versuchen.
      lastError = 'no-matches';
      scheduleNext();
    } catch (ex) {
      lastError = 'exception:' + (ex && ex.message ? ex.message : String(ex));
      console.warn('[Info-Pool 67] Highlight-Fehler:', ex);
      scheduleNext();
    }
  }

  function scheduleNext() {
    attemptIdx++;
    if (attemptIdx >= attempts.length) {
      if (opts.onFail) opts.onFail(lastError || 'unknown');
      return;
    }
    setTimeout(tryOnce, attempts[attemptIdx]);
  }

  // Erster Versuch sofort
  setTimeout(tryOnce, attempts[0]);
}

/* Sammelt alle Treffer-Seiten aus dem Index-Eintrag für das aktuell
   geöffnete Dokument, damit „Nächster Treffer" durch sie zykeln kann.
   Zurückgegeben werden eindeutige Seitenzahlen in aufsteigender
   Reihenfolge. */
function _collectHitPagesForCurrentDoc(terms) {
  if (!currentDocId) return [];
  const entry = searchIndex[currentDocId];
  if (!entry || !entry.text || !entry.pageBreaks) return [];
  const lower = entry.text.toLowerCase();
  const pagesSet = new Set();
  for (const t of terms) {
    const r = _findOccurrencesWithStem(lower, t.term, t.stem);
    for (const pos of r.positions) {
      const p = pageNumberAt(entry.pageBreaks, pos);
      if (p) pagesSet.add(p);
    }
  }
  return Array.from(pagesSet).sort((a, b) => a - b);
}

/* Springt zur nächsten Treffer-Seite (nur sinnvoll bei PDFs).
   Bei HTML/HTM nicht implementiert – Browser steuert das Text-
   Fragment selbst.  */
function jumpToNextHit() {
  if (!_viewerSearch) {
    toast('Kein aktiver Suchkontext im Viewer');
    return;
  }
  const pages = _viewerSearch.hitPages || [];
  if (pages.length === 0) {
    toast('Keine weiteren Treffer-Seiten bekannt');
    return;
  }
  _viewerSearch.hitIndex = (_viewerSearch.hitIndex + 1) % pages.length;
  const nextPage = pages[_viewerSearch.hitIndex];
  const ext = getExt(_viewerSearch.href);
  const frame = document.getElementById('mainFrame');
  if (!frame) return;

  if (ext === 'pdf') {
    const frag = _buildPdfFragment(_viewerSearch.terms, nextPage);
    // src neu setzen, damit der eingebaute PDF-Viewer den Anker erneut auswertet
    frame.src = _viewerSearch.href + frag;
    const info = document.getElementById('sjbPageInfo');
    if (info) info.textContent = '· Treffer ' + (_viewerSearch.hitIndex + 1) +
                                ' von ' + pages.length + ' · Seite ' + nextPage;
    toast('🎯 Seite ' + nextPage + ' (Treffer ' + (_viewerSearch.hitIndex + 1) + '/' + pages.length + ')');
  } else {
    toast('Anker-Sprung ist nur in PDFs unterstützt');
  }
}

function openDoc(href, label, ctx) {
  if (!href || href === '#') { toast('Noch kein Pfad hinterlegt'); return; }
  if (href === '#home') { showWelcome(); return; }

  currentHref = href;
  currentLabel = label;

  // Phase 2: Dokument-ID für „Ähnliche Dokumente"-Button im Viewer ermitteln
  currentDocId = findDocIdByHref(href);
  updateViewerSimilarButton();

  // Phase 4: Zuletzt-geöffnet + Statistik aktualisieren
  if (currentDocId) {
    const f = findNode(currentDocId);
    if (f && f.node) {
      pushRecent(f.node);
      recordAccess(f.node);
      renderRecentBox();
    }
  }

  hideSearchPage();

  // Phase 3: Suchkontext für Anker/Highlight aufbereiten
  const searchTerms = (ctx && Array.isArray(ctx.searchTerms)) ? ctx.searchTerms : null;
  const startPage   = (ctx && ctx.startPage) || null;

  // Frame-Fragment je Datei-Typ
  let fragment = '';
  const ext = getExt(href);
  if (searchTerms && searchTerms.length > 0) {
    if (ext === 'pdf') {
      fragment = _buildPdfFragment(searchTerms, startPage);
    } else if (ext === 'html' || ext === 'htm') {
      fragment = _buildHtmlFragment(searchTerms);
    }
    // Für TXT etc. gibt es keinen verlässlichen In-Page-Anker
  }

  if (canShowInIframe(href)) {
    document.getElementById('welcomeScreen').style.display = 'none';
    const fw = document.getElementById('frameWrapper');
    fw.style.display = 'flex';
    const frame = document.getElementById('mainFrame');
    document.getElementById('frameUrlBar').textContent = href + fragment;
    const dlBtn = document.getElementById('frameDownloadBtn');
    if (dlBtn) dlBtn.href = href;
    updateBreadcrumb(label);
    setActive(label);

    frame.removeAttribute('srcdoc');
    frame.removeAttribute('sandbox');

    // Bug-Fix v7.4: Hash-Wiederholung im selben Dokument robust machen.
    // Wenn die Seite bereits geladen ist und sich nur der #-Hash ändert (oder
    // gleichbleibt), setzt das simple `frame.src = ...` u.U. KEINEN
    // hashchange-Event auf einigen Browsern. Lösung:
    //   – Wenn Pfad+Hash unverändert: über contentWindow ein hashchange erzwingen
    //   – Sonst: src wie gewohnt setzen (Browser feuert load + ggf. hashchange)
    const newFullUrl = href + fragment;
    const oldFullUrl = frame.src || '';
    const splitOld = oldFullUrl.split('#');
    const splitNew = newFullUrl.split('#');
    const samePath = splitOld[0] === splitNew[0];
    const sameHash = (splitOld[1] || '') === (splitNew[1] || '');

    if (samePath && (splitNew[1] || '') !== '') {
      // Gleiches Dokument im Iframe – Hash muss neu „angestoßen" werden
      try {
        const cw = frame.contentWindow;
        if (cw) {
          if (sameHash) {
            // Identischer Hash: zuerst leeren, dann neu setzen → triggert hashchange
            cw.location.hash = '';
            // requestAnimationFrame, damit der erste hashchange durchläuft
            requestAnimationFrame(() => {
              try { cw.location.hash = splitNew[1]; } catch(_) { frame.src = newFullUrl; }
            });
          } else {
            // Anderer Hash: direkt setzen → hashchange feuert
            cw.location.hash = splitNew[1];
          }
        } else {
          frame.src = newFullUrl;
        }
      } catch (_e) {
        // Cross-Origin oder noch nicht bereit – Fallback: src komplett setzen
        frame.src = newFullUrl;
      }
    } else {
      frame.src = newFullUrl;
    }

    // Such-Anker-Leiste: nur zeigen, wenn ein Suchkontext übergeben wurde
    if (searchTerms && searchTerms.length > 0) {
      const hitPages = _collectHitPagesForCurrentDoc(searchTerms);
      // hitIndex auf den (startPage-Index - 1) setzen, sodass „Nächster"
      // direkt zum übernächsten springt; oder 0, wenn unbekannt.
      let idx = 0;
      if (startPage) {
        const found = hitPages.indexOf(startPage);
        if (found >= 0) idx = found;
      }
      _viewerSearch = {
        href, terms: searchTerms, hitPages, hitIndex: idx, startPage
      };
      _populateJumpBar(searchTerms, { startPage });
      const info = document.getElementById('sjbPageInfo');
      if (info && hitPages.length > 0) {
        info.textContent = '· Treffer ' + (idx + 1) + ' von ' + hitPages.length +
                           (startPage ? ' · Seite ' + startPage : '');
      }
    } else {
      hideSearchJumpBar();
    }

    // Bug-Fix v7.5: Robuste Highlight-Anwendung für HTML/HTM-Dokumente.
    // ──────────────────────────────────────────────────────────────────
    // Vorher: Handler wurde NACH frame.src gesetzt und prüfte stillschweigend
    // contentDocument. Bei file:// → file:// in Chrome ist das aber null
    // (Cross-Origin), und der samePath-Zweig (cw.location.hash = …) feuert
    // gar kein load-Event → Highlight lief nie.
    //
    // Neu:
    //  · Handler-Setup VOR src-Änderung (defensive timing)
    //  · samePath: Highlight nach hashchange / nächster RAF manuell anstoßen
    //  · Mehrfach-Retry + Erkennung „Cross-Origin null" mit Toast-Feedback
    //  · Stamm-/Match-Formen (z.B. „Häuser" zu Suche „haus") werden
    //    zusätzlich an die Mark-Funktion übergeben.
    if (searchTerms && searchTerms.length > 0 && (ext === 'html' || ext === 'htm')) {
      // Such-Terme + matchedForms zusammenführen
      const termsToMark = [];
      for (const t of searchTerms) {
        if (t && t.term && t.term.length >= 2) termsToMark.push(t.term);
      }
      const extraForms = (ctx && Array.isArray(ctx.matchedForms)) ? ctx.matchedForms : [];
      for (const f of extraForms) {
        if (f && typeof f === 'string' && f.length >= 2) termsToMark.push(f);
      }

      const runHighlight = () => {
        _runHighlightInFrame(frame, termsToMark, {
          onSuccess: (count) => {
            toast('🎯 ' + count + ' Stelle' + (count === 1 ? '' : 'n') + ' im Dokument markiert');
            console.info('[Info-Pool 67] Highlight: ' + count + ' Marks gesetzt für', termsToMark);
          },
          onFail: (reason) => {
            console.warn('[Info-Pool 67] Highlight fehlgeschlagen (' + reason + '). Terme:', termsToMark);
            if (reason === 'cross-origin') {
              toast('⚠ Browser-Sicherheit blockt Markierung – bitte Strg+F im Dokument verwenden');
            } else if (reason === 'no-matches') {
              toast('ℹ Suchbegriff im Dokument-Body nicht gefunden – Strg+F probieren');
            } else if (reason === 'not-ready') {
              toast('⚠ Dokument noch nicht bereit – nochmal öffnen oder Strg+F verwenden');
            }
            // Bei anderen Fehlern (exception:…) leise im Log, kein Toast
          }
        });
      };

      // Alten Handler entfernen
      if (frame._ip67HighlightHandler) {
        frame.removeEventListener('load', frame._ip67HighlightHandler);
      }
      frame._ip67HighlightHandler = runHighlight;
      // Auf nächstes load-Event hören (für Pfad-Wechsel)
      frame.addEventListener('load', runHighlight);

      // Wichtig: Im samePath-Zweig wird KEIN load gefeuert. Den Handler
      // dann nach kurzer Verzögerung manuell aufrufen, damit das hashchange
      // bereits durch ist und scroll/hash neu positioniert.
      if (samePath) {
        // 50 ms reicht, damit der cw.location.hash-Setter durch ist;
        // _runHighlightInFrame retried selbst nochmal nach 250/1000 ms.
        setTimeout(runHighlight, 50);
      }
    } else if (!searchTerms || searchTerms.length === 0) {
      // Kein Suchkontext: alten Highlight-Handler entfernen
      if (frame._ip67HighlightHandler) {
        frame.removeEventListener('load', frame._ip67HighlightHandler);
        frame._ip67HighlightHandler = null;
      }
    }

    toast(fragment
      ? '🎯 Dokument wird mit Such-Anker geladen …'
      : '📄 Dokument wird geladen …');
  } else {
    hideSearchJumpBar();
    // Bei extern geöffneten Dateien können wir Such-Kontext nicht durchreichen –
    // der Anwender muss in der Anwendung manuell suchen.
    triggerNativeOpen(href + fragment);
    const isNet = isNetworkPath(href);
    const isWeb = isWebUrl(href);
    toast(isNet
      ? '📂 Datei wird im Windows-Programm geöffnet …'
      : isWeb
        ? '🌐 Link wird in neuem Tab geöffnet …'
        : '⬇ Datei wird im Standardprogramm geöffnet …');
  }
}

/* Sucht im Sidebar-Baum den Eintrag, dessen href gleich `href` ist
   (für die Verknüpfung Viewer ↔ Index). */
function findDocIdByHref(href) {
  if (!href) return null;
  const flat = flatIndex();
  for (const x of flat) {
    if (x.node && x.node.href === href) return x.node.id;
  }
  return null;
}

/* Zeigt/versteckt den „🔗 Ähnliche"-Button in der Viewer-Toolbar
   – sichtbar nur, wenn das Dokument indiziert ist. */
function updateViewerSimilarButton() {
  const btn = document.getElementById('frameSimilarBtn');
  if (!btn) return;
  const has = currentDocId && !!searchIndex[currentDocId];
  btn.style.display = has ? '' : 'none';
  // Falls ein Panel offen ist und wir wechseln: schließen
  const panel = document.getElementById('viewerSimilarPanel');
  if (panel) panel.style.display = 'none';
}

function showWelcome() {
  hideSearchPage();
  hideSearchJumpBar();
  document.getElementById('welcomeScreen').style.display = 'flex';
  document.getElementById('frameWrapper').style.display = 'none';
  const f = document.getElementById('mainFrame');
  if (f) {
    f.removeAttribute('srcdoc');
    f.removeAttribute('sandbox');
    f.src = 'about:blank';
  }
  currentDocId = null;
  const panel = document.getElementById('viewerSimilarPanel');
  if (panel) panel.style.display = 'none';
  updateBreadcrumb(null);
  setActive(null);
}

function updateBreadcrumb(label) {
  const bc = document.getElementById('breadcrumb');
  if (!label) {
    bc.innerHTML = '<span class="bc-home" onclick="IP67.showWelcome()">🏠 Startseite</span>';
  } else {
    bc.innerHTML = `<span class="bc-home" onclick="IP67.showWelcome()">🏠 Startseite</span>
                    <span class="bc-sep">›</span>
                    <span class="bc-current">${escHtml(label)}</span>`;
  }
}

/* ============================================================
   PHASE 3 – LEICHTER DEUTSCHER STEMMER (Teil 3 Teil 3)
   ──────────────────────────────────────────────────────────
   Reduziert ein Wort auf seinen Stamm, indem typische deutsche
   Endungen rekursiv abgeschnitten werden. Sehr konservativ –
   nicht so aggressiv wie Snowball-German2, aber gut genug, um
   Pluralformen, gebeugte Verben und einige Komposita zu
   verbinden („Bäume" ↔ „Baum", „Anweisungen" ↔ „Anweisung",
   „verwaltet" ↔ „verwalt"). Zusätzlich: Umlaut-Normalisierung
   (ä→a, ö→o, ü→u, ß→ss) für robustere Vergleiche.

   Wichtig: Der Stemmer wird sowohl beim Indizieren angewandt
   (im Index zusätzlich zu den Original-Termen, in `stems`) als
   auch bei der Suche (Such-Term → Stamm → matched gegen alle
   Substrings, die mit dem Stamm beginnen). Auf diese Weise
   bleibt die schon vorhandene Substring-Logik kompatibel.
============================================================ */
function normalizeUmlauts(s) {
  if (!s) return '';
  return s
    .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ß/g, 'ss');
}

/* Liste der typischen Suffixe, von „lang nach kurz" sortiert.
   Reihenfolge ist wichtig – „ungen" muss VOR „en" geprüft werden. */
const _STEMMER_SUFFIXES = [
  // Substantiv-Plural / Nominalisierung
  'erinnen','heiten','keiten','schaften','ungen',
  'innen','heit','keit','schaft','ung','tum',
  // Konjugations-Endungen
  'eten','endes','ende','enden','endem','ender','endst','endet',
  'iert','ierten','ierst','ieren','ierte',
  // Adjektiv-Endungen
  'sten','ster','stes','este','esten','ester','estes',
  'lich','liche','licher','liches','lichen','lichem',
  'ig','ige','iger','iges','igen','igem',
  'isch','ische','ischer','isches','ischen','ischem',
  'bar','bare','barer','bares','baren','barem',
  // Generische Endungen (sehr kurz – zuletzt prüfen)
  'erei','ern','er','es','em','en','st','et','nd','e','s','n','t'
];

/* Stemming-Cache, da Stemmer bei jeder Suchanfrage millionenfach
   aufgerufen werden kann. */
const _stemCache = new Map();
const _STEM_CACHE_MAX = 50000;

function stemGerman(word) {
  if (!word) return '';
  // Cache-Check
  if (_stemCache.has(word)) return _stemCache.get(word);

  let w = word.toLowerCase();
  // Mindestlänge sichern – sonst über-stemmen wir
  if (w.length < 4) {
    _stemCache.set(word, w);
    return w;
  }

  // Umlaute normalisieren – beidseitig (Original-Wort bleibt im Index;
  // der Stamm aber wird normalisiert für robuste Match-Logik)
  let s = normalizeUmlauts(w);

  // Wiederholt Suffixe abschneiden, solange der Stamm > 3 bleibt
  let changed = true;
  let iters = 0;
  while (changed && iters < 4) {
    changed = false; iters++;
    for (const suf of _STEMMER_SUFFIXES) {
      if (s.length - suf.length < 3) continue;
      if (s.endsWith(suf)) {
        s = s.slice(0, -suf.length);
        changed = true;
        break;
      }
    }
  }

  // Verb-Endung „-e" am Schluss nach Stamm-Konsonant entfernen („liebe"→„lieb")
  if (s.length > 3 && s.endsWith('e')) s = s.slice(0, -1);

  // Cache-Größe begrenzen
  if (_stemCache.size >= _STEM_CACHE_MAX) {
    // ältesten Eintrag (FIFO) verwerfen
    const firstKey = _stemCache.keys().next().value;
    if (firstKey !== undefined) _stemCache.delete(firstKey);
  }
  _stemCache.set(word, s);
  return s;
}

/* Liefert Set aller Wörter, deren Stamm == Stamm(word) ist. */
function _matchesByStem(stem, allWords) {
  const out = new Set();
  for (const w of allWords) {
    if (stemGerman(w) === stem) out.add(w);
  }
  return out;
}


function tokenizeForTerms(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  // Split an allem, was kein Buchstabe/Zahl ist (Umlaute & ß bleiben drin)
  return lower.split(/[^a-z0-9äöüß]+/i).filter(Boolean);
}

/* Liefert {topTerms: {term: freq}, totalTokens: <N>}
   Stoppwörter, reine Zahlen und sehr kurze Tokens (< MIN_TERM_LEN)
   werden verworfen. */
function extractTopTerms(text) {
  const tokens = tokenizeForTerms(text);
  const counts = new Map();
  let totalTokens = 0;
  for (const tok of tokens) {
    if (tok.length < MIN_TERM_LEN) continue;
    if (/^\d+$/.test(tok)) continue;
    if (STOPWORDS.has(tok)) continue;
    counts.set(tok, (counts.get(tok) || 0) + 1);
    totalTokens++;
  }
  if (totalTokens === 0) return { topTerms: {}, totalTokens: 0 };
  const sorted = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_TERMS_LIMIT);
  const topTerms = {};
  for (const [term, cnt] of sorted) topTerms[term] = cnt;
  return { topTerms, totalTokens };
}

/* Stellt sicher, dass für einen Index-Eintrag topTerms vorliegen.
   Bestands-Einträge ohne Phase-2-Daten werden bei Bedarf
   nachgerüstet (lazy) und in IndexedDB persistiert. */
function ensureTopTerms(id, entry) {
  if (!entry) return null;
  if (entry.topTerms && typeof entry.totalTokens === 'number') return entry.topTerms;
  if (!entry.text) return null;
  const { topTerms, totalTokens } = extractTopTerms(entry.text);
  entry.topTerms = topTerms;
  entry.totalTokens = totalTokens;
  // Persistiere asynchron, ohne Cache-Invalidierung (würde sich selbst beißen)
  try {
    idbPut(id, entry).catch(() => {});
  } catch(_e){}
  return topTerms;
}

/* ============================================================
   PHASE 2 – IDF + COSINE SIMILARITY
============================================================ */
function getIdf() {
  if (_idfCache) return _idfCache;
  const df = {};
  let N = 0;
  for (const id in searchIndex) {
    const tt = ensureTopTerms(id, searchIndex[id]);
    if (!tt) continue;
    N++;
    for (const t in tt) df[t] = (df[t] || 0) + 1;
  }
  const idf = {};
  for (const t in df) {
    // Geglättete IDF: log(1 + N/df)
    idf[t] = Math.log(1 + N / df[t]);
  }
  _idfCache = { idf, N };
  return _idfCache;
}

function buildDocVector(entry, topTerms, idf) {
  const vec = {};
  let norm = 0;
  let total = entry.totalTokens;
  if (!total || total <= 0) {
    total = 0;
    for (const t in topTerms) total += topTerms[t];
    if (total === 0) total = 1;
  }
  for (const t in topTerms) {
    const w = (topTerms[t] / total) * (idf[t] || 0);
    vec[t] = w;
    norm += w * w;
  }
  return { vec, norm: Math.sqrt(norm) };
}

function computeSimilarDocs(targetId, maxResults) {
  maxResults = maxResults || SIM_DOCS_LIMIT;
  if (_similarCache.has(targetId)) return _similarCache.get(targetId);

  const target = searchIndex[targetId];
  if (!target) return [];
  const targetTT = ensureTopTerms(targetId, target);
  if (!targetTT || Object.keys(targetTT).length === 0) return [];

  const { idf, N } = getIdf();
  if (N < 2) return [];

  const tgt = buildDocVector(target, targetTT, idf);
  if (tgt.norm === 0) return [];

  const results = [];
  for (const id in searchIndex) {
    if (id === targetId) continue;
    const entry = searchIndex[id];
    const tt = ensureTopTerms(id, entry);
    if (!tt || Object.keys(tt).length === 0) continue;

    const doc = buildDocVector(entry, tt, idf);
    if (doc.norm === 0) continue;

    // Dot-Produkt über die kleinere Term-Liste
    const keysA = Object.keys(tgt.vec);
    const keysB = Object.keys(doc.vec);
    const small = keysA.length < keysB.length ? tgt.vec : doc.vec;
    const big   = keysA.length < keysB.length ? doc.vec : tgt.vec;
    let dot = 0;
    for (const t in small) {
      if (big[t]) dot += small[t] * big[t];
    }
    if (dot === 0) continue;
    const sim = dot / (tgt.norm * doc.norm);
    if (sim < SIM_THRESHOLD) continue;

    const found = findNode(id);
    if (!found || found.node.type !== 'item') continue;
    results.push({
      id,
      node: found.node,
      score: sim,
      breadcrumb: collectBreadcrumb(id),
      format: entry.format || guessFormat(entry.fileName || '')
    });
  }
  results.sort((a, b) => b.score - a.score);
  const out = results.slice(0, maxResults);
  _similarCache.set(targetId, out);
  return out;
}

/* ============================================================
   PHASE 2 – UI: „Ähnliche Dokumente"-Panel
============================================================ */
function renderSimilarList(similar) {
  if (!similar || similar.length === 0) {
    return '<div class="sim-empty">Keine ausreichend ähnlichen Dokumente gefunden. ' +
      'Vermutlich sind noch zu wenige Dokumente indiziert oder die Texte zu unterschiedlich.</div>';
  }
  return '<ul class="sim-list">' + similar.map(s => {
    const icon = s.node.icon || iconForHref(s.node.href);
    const path = (s.breadcrumb && s.breadcrumb.length > 0) ? s.breadcrumb.join(' › ') : 'Hauptmenü';
    const pct = Math.round(s.score * 100);
    const fmt = (s.format || '').toLowerCase();
    const fmtBadge = fmt ? `<span class="idx-format-badge fmt-${escAttr(fmt)}">${escHtml(fmt)}</span>` : '';
    return `
      <li class="sim-item"
          onclick="IP67.openDoc('${escAttr(s.node.href || '#')}', ${JSON.stringify(s.node.title).replace(/</g,'\\u003c')})">
        <span class="sim-icon">${escHtml(icon)}</span>
        <div class="sim-text">
          <div class="sim-title">${escHtml(s.node.title)} ${fmtBadge}</div>
          <div class="sim-path">${escHtml(path)}</div>
        </div>
        <div class="sim-score" title="Cosine-Ähnlichkeit über TF-IDF-Vektoren">
          <div class="sim-bar"><div class="sim-bar-fill" style="width:${pct}%"></div></div>
          <span class="sim-pct">${pct}%</span>
        </div>
      </li>`;
  }).join('') + '</ul>';
}

function toggleSimilarOnCard(btn, docId) {
  const card  = btn.closest('.sr-card');
  if (!card) return;
  const panel = card.querySelector('.sr-similar-panel[data-doc-id="' + docId + '"]');
  if (!panel) return;
  const open = panel.style.display !== 'none';
  if (open) {
    panel.style.display = 'none';
    btn.innerHTML = '🔗 Ähnliche Dokumente';
    return;
  }
  // Aufklappen: Inhalt erst jetzt berechnen
  panel.innerHTML = '<div class="sim-loading">Berechne Ähnlichkeiten …</div>';
  panel.style.display = 'block';
  btn.innerHTML = '▴ Ähnliche Dokumente ausblenden';
  // setTimeout damit der „Loading"-Zustand sichtbar ist
  setTimeout(() => {
    try {
      const similar = computeSimilarDocs(docId, SIM_DOCS_LIMIT);
      panel.innerHTML = renderSimilarList(similar);
    } catch(e) {
      console.warn('Similar-Docs:', e);
      panel.innerHTML = '<div class="sim-empty">Fehler bei der Ähnlichkeitsberechnung.</div>';
    }
  }, 30);
}

/* Im Viewer ein Floating-Panel mit den ähnlichen Dokumenten zeigen */
function toggleSimilarInViewer() {
  const wrapper = document.getElementById('frameWrapper');
  if (!wrapper || wrapper.style.display === 'none') {
    toast('Bitte erst ein Dokument öffnen'); return;
  }
  if (!currentDocId) {
    toast('Für dieses Dokument liegt keine ID vor'); return;
  }
  if (!searchIndex[currentDocId]) {
    toast('Dieses Dokument ist nicht im Volltext-Index – keine Ähnlichkeit berechenbar'); return;
  }
  let panel = document.getElementById('viewerSimilarPanel');
  if (panel && panel.style.display !== 'none') {
    panel.style.display = 'none';
    return;
  }
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'viewerSimilarPanel';
    panel.className = 'viewer-similar-panel';
    panel.innerHTML = `
      <div class="vsp-header">
        <strong>🔗 Ähnliche Dokumente</strong>
        <button class="vsp-close" onclick="document.getElementById('viewerSimilarPanel').style.display='none'" title="Schließen">×</button>
      </div>
      <div class="vsp-body"></div>`;
    wrapper.appendChild(panel);
  }
  panel.style.display = 'block';
  const body = panel.querySelector('.vsp-body');
  body.innerHTML = '<div class="sim-loading">Berechne Ähnlichkeiten …</div>';
  setTimeout(() => {
    try {
      const similar = computeSimilarDocs(currentDocId, SIM_DOCS_LIMIT);
      body.innerHTML = renderSimilarList(similar);
    } catch(e) {
      console.warn('Similar-Docs:', e);
      body.innerHTML = '<div class="sim-empty">Fehler bei der Ähnlichkeitsberechnung.</div>';
    }
  }, 30);
}

/* ============================================================
   10. SUCHE
============================================================ */
function onSearchInput(value) {
  const q = (value || '').trim();
  const btn = document.getElementById('searchClearBtn');
  if (btn) btn.classList.toggle('visible', q.length > 0);

  // Suchhistorie ausblenden, sobald Text eingegeben wird
  if (q.length > 0) hideSearchHistoryDropdown();

  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => runSearch(q), 120);

  filterNav(q);
}

function onSearchKeyDown(e) {
  if (e.key === 'Escape') { clearSearch(); e.preventDefault(); }
}

/* Bug-Fix v7.5: Sammelt alle Wort-Formen, die ein bestimmter Treffer im
   Dokument hatte (für stemmbasierte Suche). Wird beim Klick auf das
   Suchergebnis an openDoc mitgegeben, damit z.B. „Häuser" bei Suche
   nach „haus" auch im Viewer gelb markiert wird. */
function _collectMatchedFormsForHit(docId) {
  if (!docId || !currentSearchHits) return [];
  const out = new Set();
  const buckets = [currentSearchHits.fulltextHits || [], currentSearchHits.titleHits || []];
  for (const arr of buckets) {
    for (const hit of arr) {
      if (!hit.node || hit.node.id !== docId) continue;
      if (Array.isArray(hit.termCounts)) {
        for (const tc of hit.termCounts) {
          if (Array.isArray(tc.matchedForms)) {
            for (const f of tc.matchedForms) {
              if (f) out.add(f);
            }
          }
        }
      }
    }
  }
  return Array.from(out);
}

function clearSearch() {
  const input = document.getElementById('sidebarSearch');
  if (input) input.value = '';
  const btn = document.getElementById('searchClearBtn');
  if (btn) btn.classList.remove('visible');
  currentQuery = '';
  currentSearchHits = null;
  currentSearchTerms = null;
  hideSearchPage();
  filterNav('');
  showWelcome();
}

function runSearch(q) {
  currentQuery = q;
  if (!q || q.length < MIN_QUERY_LENGTH) { hideSearchPage(); return; }
  const parsed = parseQuery(q);
  currentSearchTerms = parsed.terms;
  if (parsed.terms.length === 0) { hideSearchPage(); return; }
  const hits = computeSearchHits(parsed);
  currentSearchHits = hits;
  showSearchPage(q, hits);
  // Phase 4: Suchhistorie aktualisieren (nur wenn mindestens 1 Treffer
  // ODER manueller Submit, sodass Tippfehler nicht permanent erscheinen)
  if (hits.titleHits.length + hits.fulltextHits.length > 0) {
    pushSearchHistory(q);
  }
}

/* ============================================================
   PHASE 2 / 3 – QUERY-PARSER (mit Stemmer-Expansion)
   ──────────────────────────────────────────────────────────
   Trennt die Such-Eingabe in einzelne Such-Terme.
   · Anführungszeichen umschließen exakte Phrasen
     (z.B.  müll  "abfuhr berlin"  → 2 Terme)
   · Mehrere Wörter ohne Anführungszeichen werden
     einzeln als Term gehalten → AND-Logik
   · Alle Terme werden lowercased; Duplikate werden entfernt.
   · Phase 3: Für jeden Nicht-Phrasen-Term wird zusätzlich
     der Stamm berechnet (`stem`). Im AND-Match darf ein
     Dokument den Original-Term ODER eine Stamm-Variante
     enthalten – damit findet „Bäume" auch „Baum",
     „Anweisungen" auch „Anweisung" etc.
============================================================ */
function parseQuery(raw) {
  if (!raw) return { terms: [], hasPhrase: false };
  const phrases = [];
  const phraseRe = /"([^"]+)"/g;
  let m;
  while ((m = phraseRe.exec(raw)) !== null) {
    const p = m[1].trim().toLowerCase();
    if (p) phrases.push(p);
  }
  // Phrasen aus dem Rest entfernen, Rest in Tokens splitten
  const rest = raw.replace(/"[^"]*"/g, ' ').toLowerCase();
  const tokens = rest.split(/[\s,;.:!?()\[\]{}\/\\]+/).filter(t => t.length >= 2);

  const out = [];
  const seen = new Set();
  for (const p of phrases) {
    if (!seen.has(p)) {
      out.push({ term: p, isPhrase: true, stem: null });
      seen.add(p);
    }
  }
  for (const t of tokens) {
    if (!seen.has(t)) {
      const st = stemGerman(t);
      out.push({
        term: t,
        isPhrase: false,
        // Stamm nur dann nutzen, wenn er sich tatsächlich vom Original
        // unterscheidet UND lang genug ist, um nicht zu falschen Treffern zu führen
        stem: (st && st !== t && st.length >= 3) ? st : null
      });
      seen.add(t);
    }
  }
  return { terms: out, hasPhrase: phrases.length > 0 };
}

/* Sucht alle Vorkommen eines Term *oder seines Stamms* in einem Text.
   Stamm-Match: jede zusammenhängende Wortform, deren Stamm == queryStem.
   Liefert {positions, stemPositions, matchedForms} mit den
   getroffenen Wortformen für Snippet-Highlight + Anzeige. */
function _findOccurrencesWithStem(lowerText, term, stem) {
  // 1) Substring-Treffer des Originaltermsuchworts (Phase 2 Verhalten)
  const positions = findAllOccurrences(lowerText, term);
  const matchedForms = new Set([term]);

  // 2) Stamm-Expansion: alle Wörter im Text, die mit dem Stamm beginnen
  //    (lange Wörter, max +12 Zeichen Anhang) und deren Stamm == queryStem
  let stemPositions = [];
  if (stem && stem !== term) {
    // Wörter aus dem Text extrahieren – nur Wortgrenzen
    // Wir verwenden einen Regex, der Wörter aus "Wort-/Punktuations"-Grenzen löst
    const wordRe = /[a-z0-9äöüß]{3,30}/gi;
    let mm; const seenForms = new Set();
    while ((mm = wordRe.exec(lowerText)) !== null) {
      const w = mm[0];
      if (seenForms.has(w)) continue;
      seenForms.add(w);
      // Schnelle Pre-Filter: Wort muss mit denselben 2-3 Buchstaben wie der Stamm beginnen
      if (w[0] !== stem[0]) continue;
      // Bereits über Substring-Match abgedeckt?
      if (w === term || w.includes(term)) continue;
      // Stamm prüfen
      if (stemGerman(w) === stem) matchedForms.add(w);
    }
    // Positionen für alle „neuen" Wortformen sammeln
    for (const form of matchedForms) {
      if (form === term) continue; // schon in positions[]
      const ps = findAllOccurrences(lowerText, form);
      stemPositions = stemPositions.concat(ps);
    }
  }

  // Sortieren + Deduplizieren
  const all = positions.concat(stemPositions).sort((a, b) => a - b);
  const deduped = [];
  for (const p of all) {
    if (deduped.length === 0 || deduped[deduped.length-1] !== p) deduped.push(p);
  }
  return {
    positions: deduped,
    originalCount: positions.length,
    stemCount: stemPositions.length,
    matchedForms: Array.from(matchedForms)
  };
}

function computeSearchHits(parsed) {
  const terms = parsed.terms;
  const flat = flatIndex();

  // --- TITEL-TREFFER: alle Terme müssen im Titel vorkommen (AND) ---
  // Phase 3: Stamm-Variante zählt auch (z.B. "Baum" matched "Bäume" im Titel)
  const titleHitIds = new Set();
  const titleHits = [];
  flat.forEach(x => {
    const title = x.node.title.toLowerCase();
    const allFound = terms.every(t => {
      if (title.includes(t.term)) return true;
      if (t.stem) {
        // Stamm-Match im Titel: Wörter aus dem Titel stemmen
        const titleWords = title.split(/[^a-z0-9äöüß]+/i).filter(Boolean);
        for (const tw of titleWords) {
          if (stemGerman(tw) === t.stem) return true;
        }
      }
      return false;
    });
    if (allFound) {
      titleHits.push({ node: x.node, breadcrumb: x.parent, kind: 'title' });
      titleHitIds.add(x.node.id);
    }
  });

  // --- VOLLTEXT-TREFFER: alle Terme müssen im Text vorkommen (AND) ---
  const fulltextHits = [];
  let stemmerWasHelpful = false;  // für UI-Hinweis

  for (const id in searchIndex) {
    const entry = searchIndex[id];
    if (!entry || !entry.text) continue;
    const lower = entry.text.toLowerCase();

    // Pro Term: alle Positionen sammeln (Original + Stamm-Varianten)
    const perTerm = [];
    let allFound = true;
    for (const t of terms) {
      const r = _findOccurrencesWithStem(lower, t.term, t.stem);
      if (r.positions.length === 0) { allFound = false; break; }
      if (r.stemCount > 0 && r.originalCount === 0) stemmerWasHelpful = true;
      perTerm.push({
        term: t.term,
        stem: t.stem,
        positions: r.positions,
        matchedForms: r.matchedForms,
        viaStem: r.originalCount === 0 && r.stemCount > 0
      });
    }
    if (!allFound) continue;

    const found = findNode(id);
    if (!found && !entry._isExternal) continue;

    const totalOccurrences = perTerm.reduce((s, t) => s + t.positions.length, 0);
    const distinctTerms = perTerm.length;

    // Snippets bestmöglich auswählen: mehrere Terme im selben Fenster bevorzugen
    const snippets = selectMultiTermSnippets(entry.text, perTerm, entry.pageBreaks);

    // BM25-light-Score:
    //   – Hauptgewicht: Anzahl distinkter Terme (alle gefordert → const)
    //   – Sekundär: log(totalHits) für Dichte
    //   – Tertiär: 1/(textLength+1) (kürzer = höhere Dichte)
    //   – Bonus, wenn der Titel auch alle Terme enthält
    //   – Phase 3: Treffer, die NUR über den Stemmer reinkommen, leicht abwerten
    const lengthFactor = 1 / Math.log(2 + entry.text.length);
    const stemPenalty  = perTerm.filter(p => p.viaStem).length * 8; // pro Term, der nur per Stamm getroffen wurde
    let score = distinctTerms * 100
              + Math.log(totalOccurrences + 1) * 12
              + lengthFactor * 30
              - stemPenalty;
    if (titleHitIds.has(id)) score += 60;

    const hitNode = found ? found.node : {
      id, type: 'item', icon: '👤',
      title: entry._name || entry.fileName || id,
      href:  entry._url  || '#'
    };
    const hitBreadcrumb = found ? collectBreadcrumb(id) : ['Mitarbeiterliste'];

    fulltextHits.push({
      node: hitNode,
      breadcrumb: hitBreadcrumb,
      kind: 'fulltext',
      snippets,
      occurrences: totalOccurrences,
      distinctTerms,
      termCounts: perTerm.map(p => ({
        term: p.term,
        count: p.positions.length,
        viaStem: p.viaStem,
        matchedForms: p.matchedForms
      })),
      score,
      format: entry.format || guessFormat(entry.fileName || ''),
      fileName: entry.fileName || '',
      indexedAt: entry.indexedAt || null,
      alsoTitleHit: titleHitIds.has(id),
      totalPages: entry.totalPages || (entry.pageBreaks ? entry.pageBreaks.length : null)
    });
  }

  fulltextHits.sort((a,b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.node.title.localeCompare(b.node.title, 'de');
  });
  titleHits.sort((a,b) => a.node.title.localeCompare(b.node.title, 'de'));

  return {
    titleHits, fulltextHits,
    query: parsed.terms.map(t => t.term).join(' '),
    terms: parsed.terms,
    stemmerWasHelpful
  };
}

/* ============================================================
   PHASE 2 – SNIPPET-AUSWAHL für Multi-Term
   ──────────────────────────────────────────────────────────
   Strategie:
   1. Alle Treffer aller Terme zu einer Liste mergen
      [{term, pos, len}, ...] sortiert nach pos.
   2. Für jeden Treffer „Fensterdichte" berechnen: wie viele
      *distinkte* Terme liegen in [pos-W, pos+W]?
   3. Greedy auswählen, dabei überlappende Fenster überspringen.
   4. Falls weniger Snippets gefunden als gewünscht, mit
      Einzeltreffern auffüllen (möglichst aus Termen, deren
      Terme noch nicht gezeigt wurden).
============================================================ */
function selectMultiTermSnippets(text, perTerm, pageBreaks) {
  // Alle Treffer auf eine Achse legen
  const hits = [];
  for (const { term, positions } of perTerm) {
    for (const pos of positions) {
      hits.push({ term, pos, len: term.length });
    }
  }
  hits.sort((a, b) => a.pos - b.pos);
  if (hits.length === 0) return [];

  // Dichte pro Hit (zwei-Zeiger)
  const W = SNIPPET_WINDOW;
  let lo = 0, hi = 0;
  hits.forEach((h) => {
    while (lo < hits.length && hits[lo].pos < h.pos - W) lo++;
    while (hi < hits.length && hits[hi].pos <= h.pos + W) hi++;
    const set = new Set();
    for (let k = lo; k < hi; k++) set.add(hits[k].term);
    h.density = set.size;
    h.densitySet = set;
  });

  // Sortiere nach (Dichte desc, dann Position asc) und wähle ohne Überlappung
  const ranked = hits.slice().sort((a, b) => {
    if (b.density !== a.density) return b.density - a.density;
    return a.pos - b.pos;
  });

  const chosen = [];
  const usedTerms = new Set();
  const usedRanges = []; // [start, end]
  const overlaps = (a, b) => !(a[1] < b[0] || b[1] < a[0]);

  for (const h of ranked) {
    if (chosen.length >= SNIPPETS_PER_DOC) break;
    const range = [Math.max(0, h.pos - SNIPPET_LEN), Math.min(text.length, h.pos + h.len + SNIPPET_LEN)];
    if (usedRanges.some(r => overlaps(r, range))) continue;
    usedRanges.push(range);
    chosen.push({
      text: extractSnippet(text, h.pos, h.len),
      offset: h.pos,
      page: pageNumberAt(pageBreaks, h.pos),
      densityTerms: Array.from(h.densitySet)
    });
    h.densitySet.forEach(t => usedTerms.add(t));
  }

  // Falls noch Terme „nie gezeigt" wurden und wir Platz haben: auffüllen
  if (chosen.length < SNIPPETS_PER_DOC) {
    for (const h of ranked) {
      if (chosen.length >= SNIPPETS_PER_DOC) break;
      if (usedTerms.has(h.term) && Array.from(h.densitySet).every(t => usedTerms.has(t))) continue;
      const range = [Math.max(0, h.pos - SNIPPET_LEN), Math.min(text.length, h.pos + h.len + SNIPPET_LEN)];
      if (usedRanges.some(r => overlaps(r, range))) continue;
      usedRanges.push(range);
      chosen.push({
        text: extractSnippet(text, h.pos, h.len),
        offset: h.pos,
        page: pageNumberAt(pageBreaks, h.pos),
        densityTerms: Array.from(h.densitySet)
      });
      h.densitySet.forEach(t => usedTerms.add(t));
    }
  }

  // Snippets nach Position sortieren (lesefreundlicher)
  chosen.sort((a, b) => a.offset - b.offset);
  return chosen;
}

function findAllOccurrences(haystack, needle) {
  if (!needle) return [];
  const out = [];
  let from = 0;
  while (from < haystack.length) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) break;
    out.push(idx);
    from = idx + needle.length;
    if (out.length > 500) break;
  }
  return out;
}

function pageNumberAt(pageBreaks, offset) {
  if (!pageBreaks || pageBreaks.length === 0) return null;
  let lo = 0, hi = pageBreaks.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pageBreaks[mid] <= offset) { ans = mid; lo = mid + 1; }
    else { hi = mid - 1; }
  }
  return ans + 1;
}

function extractSnippet(text, hitIdx, matchLen) {
  let start = Math.max(0, hitIdx - SNIPPET_LEN);
  let end   = Math.min(text.length, hitIdx + matchLen + SNIPPET_LEN);
  if (start > 0) {
    const sp = text.indexOf(' ', start);
    if (sp > 0 && sp < hitIdx) start = sp + 1;
  }
  if (end < text.length) {
    const sp = text.lastIndexOf(' ', end);
    if (sp > hitIdx + matchLen) end = sp;
  }
  let snippet = text.slice(start, end);
  if (start > 0)            snippet = '… ' + snippet;
  if (end < text.length)    snippet = snippet + ' …';
  return snippet.replace(/\s+/g, ' ').trim();
}

function showSearchPage(query, hits) {
  document.getElementById('welcomeScreen').style.display = 'none';
  document.getElementById('frameWrapper').style.display  = 'none';
  const f = document.getElementById('mainFrame');
  if (f && f.src && !f.src.endsWith('about:blank')) f.src = 'about:blank';

  const page = document.getElementById('searchResultsPage');
  if (!page) return;
  page.style.display = 'flex';

  renderSearchPage(query, hits);
  updateBreadcrumb('Suche: „' + query + '"');
  setActive(null);
}

function hideSearchPage() {
  const page = document.getElementById('searchResultsPage');
  if (page) page.style.display = 'none';
}

function renderSearchPage(query, hits) {
  const total = hits.titleHits.length + hits.fulltextHits.length;
  const terms = hits.terms || [];
  const queryTitle = document.getElementById('sphQueryTitle');
  const statsEl = document.getElementById('sphStats');
  const body    = document.getElementById('searchResultsList');

  if (queryTitle) {
    queryTitle.innerHTML = total > 0
      ? `${total} Ergebnis${total === 1 ? '' : 'se'} für <span class="sph-q">„${escHtml(query)}"</span>`
      : `Keine Ergebnisse für <span class="sph-q">„${escHtml(query)}"</span>`;
  }

  if (statsEl) {
    const indexedCount = Object.keys(searchIndex).length;
    let termChips = '';
    if (terms.length > 1) {
      termChips = '<span class="stat-chip">🔀 AND-Suche: ' +
        terms.map(t => `<span class="term-chip${t.isPhrase ? ' is-phrase' : ''}">${t.isPhrase ? '"' : ''}${escHtml(t.term)}${t.isPhrase ? '"' : ''}</span>`).join(' + ') +
        '</span>';
    }
    statsEl.innerHTML = `
      <span class="stat-chip">🏷 <strong>${hits.titleHits.length}</strong> Titel-Treffer</span>
      <span class="stat-chip">📄 <strong>${hits.fulltextHits.length}</strong> Inhalt-Treffer</span>
      <span class="stat-chip">🗂 <strong>${indexedCount}</strong> Dokumente im Index</span>
      ${termChips}
    `;
  }

  if (total === 0) {
    const tip = terms.length > 1
      ? `<p><strong>AND-Suche aktiv:</strong> Es wird nach Dokumenten gesucht, die <em>alle</em> Begriffe enthalten. Versuchen Sie weniger Begriffe oder leeren Sie einzelne Wörter.</p>`
      : `<p>Versuchen Sie einen anderen Begriff oder kürzere Wörter. Tipps:<br>
         • Mehrere Wörter werden als AND verknüpft (alle müssen vorkommen)<br>
         • Exakte Phrase: <code>"in Anführungszeichen"</code><br>
         • Falls die Datei noch nicht indiziert ist, kann sie nur per Titel gefunden werden.<br>
         Im Admin-Modus (Strg+Shift+A) können Sie Dokumente unter <em>🔍 Volltextindex</em> hinzufügen.</p>`;
    body.innerHTML = `
      <div class="sr-empty">
        <span class="sr-empty-icon">🔍</span>
        <h3>Keine Treffer gefunden</h3>
        ${tip}
      </div>`;
    return;
  }

  let html = '';

  if (hits.titleHits.length > 0) {
    html += `<div class="sr-section-title">🏷 Titel-Treffer <span class="sr-count">${hits.titleHits.length}</span></div>`;
    html += hits.titleHits.map(h => renderTitleCard(h, terms)).join('');
  }

  if (hits.fulltextHits.length > 0) {
    html += `<div class="sr-section-title">📄 Im Inhalt gefunden <span class="sr-count">${hits.fulltextHits.length}</span></div>`;
    html += hits.fulltextHits.map(h => renderFulltextCard(h, terms)).join('');
  }

  body.innerHTML = html;

  body.querySelectorAll('.sr-card').forEach(card => {
    card.addEventListener('click', (ev) => {
      // Klicks innerhalb interaktiver Subbereiche durchlassen
      if (ev.target.closest('.sr-more-btn, .sr-similar-btn, .sr-similar-panel')) return;
      const id = card.getAttribute('data-id');

      // Bug-Fix v7.4: Externe Personen-Treffer (Stricker — Handyliste/Organigramm/Intranet
      // aus mitarbeiterliste.js) haben keine Sidebar-Node, dafür ein data-href.
      // → direkt mit der externen URL öffnen, OHNE Volltext-Such-Kontext
      //   (würde sonst das Hash-Fragment überschreiben).
      if (card.getAttribute('data-external') === '1') {
        const extHref = card.getAttribute('data-href');
        // Titel der Karte als Breadcrumb-Label
        const titleEl = card.querySelector('.sr-card-title');
        const label = titleEl ? (titleEl.textContent || '').trim() : extHref;
        if (extHref) {
          // Intranet-/Web-URLs lassen sich nicht im iframe-Viewer darstellen
          // (X-Frame-Options / CSP). → direkt in neuem Tab öffnen, Suchergebnis-
          // Seite bleibt im Hintergrund sichtbar, damit der Anwender weitere
          // Treffer (Handyliste / Organigramm / …) zur gleichen Person ansteuern kann.
          if (isWebUrl(extHref)) {
            triggerNativeOpen(extHref);
            toast('🌐 Intranet-Seite wird in neuem Tab geöffnet …');
          } else {
            openDoc(extHref, label);
          }
        }
        return;
      }

      const f = findNode(id);
      if (!f) return;
      if (f.node.type === 'group') { toggleGroup(id); return; }
      // Phase 3: Suchkontext (Terme + erste Treffer-Seite) an openDoc mitgeben,
      // damit der Viewer per Anker/Scroll direkt zur Stelle springt.
      const firstPage = parseInt(card.getAttribute('data-first-page'), 10) || null;
      // Bug-Fix v7.5: Gestämmte Wortformen mitgeben, damit der Highlighter
      // auch „Häuser" markiert wenn nach „haus" gesucht wurde. Die Formen
      // stehen in currentSearchHits.fulltextHits[].termCounts[].matchedForms.
      const matchedForms = _collectMatchedFormsForHit(id);
      openDoc(f.node.href || '#', f.node.title, {
        searchTerms: currentSearchTerms,
        startPage: firstPage,
        matchedForms: matchedForms
      });
    });
  });
}

function renderTitleCard(hit, terms) {
  const icon = hit.node.icon || iconForHref(hit.node.href);
  const path = renderPath(hit.breadcrumb, icon);
  const titleHtml = highlight(hit.node.title, terms);
  // Bug-Fix v7.4: Externe Personen-Treffer (mitarbeiterliste.js) haben keine
  // Sidebar-Node-ID – href als data-Attribut mitgeben, damit der Click-Handler
  // direkt darauf zugreifen kann.
  const extAttr = !findNode(hit.node.id) && hit.node.href
    ? ` data-href="${escAttr(hit.node.href)}" data-external="1"`
    : '';
  return `
    <div class="sr-card title-hit" data-id="${escAttr(hit.node.id)}"${extAttr} tabindex="0">
      <div class="sr-card-path">${path}</div>
      <div class="sr-card-title">${titleHtml}</div>
      <div class="sr-card-snippet">Titel-Treffer · Klicken zum Öffnen</div>
    </div>`;
}

function renderFulltextCard(hit, terms) {
  const icon = hit.node.icon || iconForHref(hit.node.href);
  const path = renderPath(hit.breadcrumb, icon);

  // Phase 3: Stamm-Wortformen aus termCounts sammeln, damit highlight()
  // sie zusätzlich markiert.
  const allForms = new Set();
  if (Array.isArray(hit.termCounts)) {
    for (const tc of hit.termCounts) {
      if (Array.isArray(tc.matchedForms)) {
        for (const f of tc.matchedForms) allForms.add(f);
      }
    }
  }
  const formsArr = Array.from(allForms);

  const titleHtml = highlight(hit.node.title, terms, formsArr);

  const allSnippets = hit.snippets || [];
  const visibleCount = Math.min(SNIPPETS_INITIAL_SHOW, allSnippets.length);
  const hasMore = allSnippets.length > visibleCount;

  const renderOne = (s) => {
    const pageBadge = s.page
      ? `<span class="sr-page-badge" title="Seite im Originaldokument">📑 S. ${s.page}${hit.totalPages ? ' / ' + hit.totalPages : ''}</span>`
      : '';
    return `<div class="sr-snippet-row">${pageBadge}<div class="sr-snippet-text">${highlight(s.text, terms, formsArr)}</div></div>`;
  };

  const visibleHtml = allSnippets.slice(0, visibleCount).map(renderOne).join('');
  const hiddenHtml  = hasMore
    ? `<div class="sr-snippets-more" style="display:none;">${allSnippets.slice(visibleCount).map(renderOne).join('')}</div>`
    : '';
  const toggleBtn = hasMore
    ? `<button type="button" class="sr-more-btn"
         onclick="event.stopPropagation(); IP67.toggleMoreSnippets(this);"
         data-more="${allSnippets.length - visibleCount}">
         ▾ ${allSnippets.length - visibleCount} weitere Trefferstellen anzeigen
       </button>`
    : '';

  const fmt = (hit.format || '').toLowerCase();
  const fmtBadge = fmt
    ? `<span class="idx-format-badge fmt-${escAttr(fmt)}">${escHtml(fmt)}</span>` : '';
  const titleHitTag = hit.alsoTitleHit
    ? `<span class="meta-chip">🏷 auch im Titel</span>` : '';

  // Phase 2/3: Term-Coverage-Chips für Multi-Term-Suche
  let termCoverage = '';
  if (Array.isArray(hit.termCounts) && hit.termCounts.length > 1) {
    termCoverage = '<span class="meta-chip">📌 ' +
      hit.termCounts.map(tc => {
        const stemNote = tc.viaStem ? ' title="nur über Stamm-Variante gefunden"' : '';
        const cls = 'term-count-chip' + (tc.viaStem ? ' is-stem' : '');
        return `<span class="${cls}"${stemNote}>${escHtml(tc.term)} <strong>${tc.count}</strong>×</span>`;
      }).join(' ') +
      '</span>';
  }

  const meta = [
    `<span class="meta-chip">🎯 ${hit.occurrences} Trefferstelle${hit.occurrences===1?'':'n'}</span>`,
    hit.totalPages ? `<span class="meta-chip">📑 ${hit.totalPages} Seite${hit.totalPages===1?'':'n'}</span>` : '',
    hit.fileName ? `<span class="meta-chip">📁 ${escHtml(hit.fileName)}</span>` : '',
    hit.indexedAt ? `<span class="meta-chip">🕒 indiziert ${formatDate(hit.indexedAt)}</span>` : '',
    titleHitTag,
    termCoverage
  ].filter(Boolean).join('');

  // Phase 2: „Ähnliche Dokumente"-Button (lazy – Berechnung erst bei Klick)
  const similarBtn = `
    <button type="button" class="sr-similar-btn"
            onclick="event.stopPropagation(); IP67.toggleSimilarOnCard(this, '${escAttr(hit.node.id)}');"
            title="Top ähnliche Dokumente per TF-IDF / Cosine">
      🔗 Ähnliche Dokumente
    </button>
    <div class="sr-similar-panel" data-doc-id="${escAttr(hit.node.id)}" style="display:none;"></div>`;

  // Phase 3: Erste Seite mit Treffern (für Anker-Sprung beim Öffnen)
  const firstPage = (allSnippets[0] && allSnippets[0].page) || null;

  // Bug-Fix v7.4: Externe Personen-Treffer (mitarbeiterliste.js) haben keine
  // Sidebar-Node-ID – href als data-Attribut mitgeben, damit der Click-Handler
  // direkt darauf zugreifen kann (Handyliste / Organigramm / Intranet).
  const extAttr = !findNode(hit.node.id) && hit.node.href
    ? ` data-href="${escAttr(hit.node.href)}" data-external="1"`
    : '';

  return `
    <div class="sr-card" data-id="${escAttr(hit.node.id)}" data-first-page="${firstPage || ''}"${extAttr} tabindex="0">
      <div class="sr-card-path">${path} ${fmtBadge}</div>
      <div class="sr-card-title">${titleHtml}</div>
      <div class="sr-card-snippet">${visibleHtml}${hiddenHtml}${toggleBtn}</div>
      <div class="sr-card-meta">${meta}</div>
      <div class="sr-card-actions">${similarBtn}</div>
    </div>`;
}

function toggleMoreSnippets(btn) {
  const card = btn.closest('.sr-card');
  if (!card) return;
  const more = card.querySelector('.sr-snippets-more');
  if (!more) return;
  const open = more.style.display !== 'none';
  more.style.display = open ? 'none' : 'block';
  const rest = btn.getAttribute('data-more');
  btn.innerHTML = open
    ? '▾ ' + rest + ' weitere Trefferstellen anzeigen'
    : '▴ Weitere Trefferstellen ausblenden';
}

function renderPath(breadcrumb, icon) {
  const parts = [`<span class="sr-path-icon">${escHtml(icon)}</span>`];
  if (breadcrumb && breadcrumb.length > 0) parts.push(escHtml(breadcrumb.join(' › ')));
  else parts.push('<em>Hauptmenü</em>');
  return parts.join(' ');
}

/* Markiert ALLE Such-Terme (inkl. Stamm-Varianten) im Text mit <mark>.
   `terms` kann ein String oder ein Array sein:
     – String "wort"             → ein Term
     – Array von Strings         → mehrere Terme
     – Array von {term,isPhrase,stem} → Phase 3-Format
   Wenn das umgebende Card-Objekt `termCounts[i].matchedForms`
   liefert (Phase 3), werden diese zusätzlich hervorgehoben.
   Überlappende Treffer werden zusammengeführt. */
function highlight(text, terms, extraForms) {
  if (!terms) return escHtml(text);
  let termStrs;
  if (typeof terms === 'string') termStrs = [terms];
  else if (Array.isArray(terms)) {
    termStrs = terms.map(t => typeof t === 'string' ? t : (t && t.term) || '').filter(Boolean);
  } else if (terms.term) termStrs = [terms.term];
  else return escHtml(text);

  // Phase 3: zusätzliche Stamm-Varianten mit hervorheben
  if (Array.isArray(extraForms)) {
    for (const f of extraForms) {
      if (typeof f === 'string' && f && termStrs.indexOf(f) < 0) termStrs.push(f);
    }
  } else if (Array.isArray(terms)) {
    for (const t of terms) {
      if (t && Array.isArray(t.matchedForms)) {
        for (const f of t.matchedForms) {
          if (f && termStrs.indexOf(f) < 0) termStrs.push(f);
        }
      }
    }
  }

  termStrs = termStrs.map(s => String(s).toLowerCase()).filter(Boolean);
  if (termStrs.length === 0) return escHtml(text);

  // Lange Terme zuerst (Substrings nachrangig)
  termStrs.sort((a, b) => b.length - a.length);

  const lower = text.toLowerCase();
  const spans = [];
  for (const t of termStrs) {
    if (!t) continue;
    let i = 0;
    while (i < lower.length) {
      const idx = lower.indexOf(t, i);
      if (idx < 0) break;
      spans.push([idx, idx + t.length]);
      i = idx + t.length;
    }
  }
  if (spans.length === 0) return escHtml(text);

  // Sortieren & Überlappungen zusammenführen
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const s of spans) {
    if (merged.length && s[0] <= merged[merged.length-1][1]) {
      merged[merged.length-1][1] = Math.max(merged[merged.length-1][1], s[1]);
    } else {
      merged.push([s[0], s[1]]);
    }
  }

  let out = '';
  let pos = 0;
  for (const [a, b] of merged) {
    out += escHtml(text.slice(pos, a));
    out += '<mark class="search-hl">' + escHtml(text.slice(a, b)) + '</mark>';
    pos = b;
  }
  out += escHtml(text.slice(pos));
  return out;
}

function filterNav(query) {
  const q = (query || '').trim().toLowerCase();
  document.querySelectorAll('.nav-node').forEach(n => {
    if (!q) { n.classList.remove('hidden'); return; }
    const text = n.textContent.toLowerCase();
    n.classList.toggle('hidden', !text.includes(q));
    if (text.includes(q)) {
      let p = n.parentElement;
      while (p) {
        if (p.classList && p.classList.contains('nav-children')) {
          p.classList.add('open');
          const pNode = p.parentElement;
          if (pNode) {
            const pRow = pNode.querySelector(':scope > .nav-row');
            if (pRow) pRow.classList.add('open');
          }
        }
        p = p.parentElement;
      }
    }
  });
}

/* ============================================================
   11. THEME / TOAST / MOBILE
============================================================ */
function toggleTheme() {
  const isLight = document.body.classList.toggle('theme-light');
  const icon = document.getElementById('themeIcon');
  if (icon) icon.textContent = isLight ? '🌙' : '☀';
  localStorage.setItem('ip67-theme', isLight ? 'light' : 'dark');
}

(function restoreTheme(){
  if (localStorage.getItem('ip67-theme') === 'light') {
    document.body.classList.add('theme-light');
    document.addEventListener('DOMContentLoaded', () => {
      const icon = document.getElementById('themeIcon');
      if (icon) icon.textContent = '🌙';
    });
  }
})();

function toast(msg, ms) {
  const t = document.getElementById('toast');
  if (!t) return;
  const m = document.getElementById('toastMsg');
  if (m) m.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), ms || 2500);
}

function toggleMobileSidebar() {
  const s = document.querySelector('.sidebar');
  s.style.display = s.style.display === 'none' ? '' : 'none';
}

/* ============================================================
   12. LAZY-LOADER FÜR SUBMODULE
============================================================ */
function loadModule(name) {
  if (moduleLoaders[name]) return moduleLoaders[name];
  const url = MODULE_URLS[name];
  if (!url) return Promise.reject(new Error('Unbekanntes Modul: ' + name));
  moduleLoaders[name] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url; s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Konnte Modul nicht laden: ' + url));
    document.head.appendChild(s);
  });
  return moduleLoaders[name];
}

/* Stubs für Funktionen aus lazy-Modulen.
   Wenn eine Admin-/Index-Funktion aufgerufen wird, bevor das Modul
   geladen ist, laden wir es nach und delegieren erneut. */
function makeStub(moduleName, fnName) {
  return async function() {
    const args = Array.from(arguments);
    await loadModule(moduleName);
    const fn = window.IP67[fnName];
    if (typeof fn === 'function' && fn !== window.IP67._stubs[fnName]) {
      return fn.apply(null, args);
    }
    throw new Error('Funktion ' + fnName + ' nach Modul-Load nicht gefunden');
  };
}

/* ============================================================
   12b. AUDIO-HILFSFUNKTIONEN
============================================================ */

/** Spielt eine MP3 aus dem Unterordner "mp3/" ab.
 *  Dateiname ohne Extension – es wird nach dem Namen gesucht
 *  (Leerzeichen erlaubt, .mp3 wird angehängt). */
function playHelpAudio(filename) {
  const src = 'mp3/' + filename + '.mp3';
  const audio = new Audio(src);
  audio.play().catch(err => {
    console.warn('[Info-Pool 67] Audio konnte nicht abgespielt werden:', src, err);
  });
}

/** Start-Audio: zeigt Modal beim Öffnen (wenn Datum gültig),
 *  startet Audio erst bei Nutzer-Klick (Autoplay-Richtlinien der Browser).
 *  Phase 3 (Issue 3): Der Rest des Bildschirms wird durch ein
 *  blurry Backdrop überdeckt, sodass der User aktiv klicken muss. */
const START_AUDIO_EXPIRY_KEY = 'ip67-start-audio-expiry';
const START_AUDIO_FILE       = 'mp3/Infopool Erklärung html-Start.mp3';

function maybePlayStartAudio() {
  const expiry = localStorage.getItem(START_AUDIO_EXPIRY_KEY);
  if (!expiry) return;                         // kein Datum gesetzt → nichts tun
  const today = new Date(); today.setHours(0,0,0,0);
  const exp   = new Date(expiry); exp.setHours(0,0,0,0);
  if (today > exp) return;                     // abgelaufen → nichts tun

  // Audio-Objekt vorbereiten, aber NICHT automatisch abspielen
  // (Browser blockieren Autoplay ohne Nutzer-Interaktion).
  _startAudio = new Audio(START_AUDIO_FILE);

  // Modal + Backdrop einblenden, Hintergrund-Scroll sperren
  const backdrop = document.getElementById('startAudioBackdrop');
  if (backdrop) {
    backdrop.style.display = 'flex';
    document.body.classList.add('start-audio-active');
  }
}

function _hideStartAudioBackdrop() {
  const backdrop = document.getElementById('startAudioBackdrop');
  if (backdrop) backdrop.style.display = 'none';
  document.body.classList.remove('start-audio-active');
}

function startAudioContinue() {
  // Nutzer hat geklickt → jetzt darf Audio starten
  if (_startAudio) {
    _startAudio.play().catch(err => {
      console.warn('[Info-Pool 67] Start-Audio konnte nicht abgespielt werden:', err);
    });
    // Wenn das Audio durchgespielt ist, das Modal automatisch schließen
    _startAudio.addEventListener('ended', () => _hideStartAudioBackdrop(), { once: true });
  }
  _hideStartAudioBackdrop();
}

function startAudioStop() {
  if (_startAudio) { _startAudio.pause(); _startAudio.currentTime = 0; _startAudio = null; }
  _hideStartAudioBackdrop();
}

/* ============================================================
   PHASE 3 – DATEI-WATCHER (Teil 6)
   ──────────────────────────────────────────────────────────
   Beobachtet einen FileSystemDirectoryHandle (Save-Folder oder
   ein separat gewählter Watch-Folder) per Polling. Wenn sich
   eine indizierbare Datei ändert (Größe oder lastModified)
   oder neu hinzukommt, wird sie automatisch re-indiziert.

   Browser-Einschränkungen:
   · echtes Datei-Event-System gibt es im Browser nicht
   · Polling-Intervall mind. 15 Sekunden (Standardwert 60 s)
   · benötigt File System Access API (Edge/Chrome)
   · Re-Indizierung delegiert an das Lazy-Modul infopool67_index.js
     (Funktion IP67._reindexFile, die das Index-Modul bei Laden
     registriert). Solange das Modul nicht geladen ist, wird nur
     geloggt – der Index wird dann beim nächsten Admin-Aufruf
     synchronisiert.
============================================================ */
/* Watcher-Konstanten: jetzt am Dateianfang deklariert (siehe oben). */

let _watcherTimer  = null;
let _watcherFolder = null;     // {handle, snapshot:Map<name,{size,lastModified}>}
let _watcherLog    = [];       // Array von {time, msg, kind} – neueste zuletzt

function _watcherAddLog(msg, kind) {
  _watcherLog.push({
    time: new Date().toLocaleTimeString('de-DE'),
    msg: msg,
    kind: kind || 'info'
  });
  if (_watcherLog.length > WATCHER_LOG_MAX) _watcherLog.shift();
  // UI im Settings-Modal aktualisieren, falls offen
  const logEl = document.getElementById('watcherLog');
  if (logEl) _renderWatcherLog(logEl);
}

function _renderWatcherLog(logEl) {
  if (_watcherLog.length === 0) {
    logEl.innerHTML = '<div class="wl-empty">Noch keine Ereignisse aufgezeichnet.</div>';
    return;
  }
  // Älteste oben – wir zeigen aber neueste oben für Lesbarkeit
  const rows = _watcherLog.slice().reverse().map(e =>
    `<div class="wl-row"><span class="wl-time">${escHtml(e.time)}</span>${escHtml(e.msg)}</div>`
  );
  logEl.innerHTML = rows.join('');
}

function isWatcherEnabled() {
  return localStorage.getItem(WATCHER_ENABLED_KEY) === '1';
}
function getWatcherInterval() {
  const v = parseInt(localStorage.getItem(WATCHER_INTERVAL_KEY), 10);
  if (isNaN(v) || v < WATCHER_MIN_INTERVAL) return WATCHER_DEFAULT_INTERVAL;
  return v;
}

/* Snapshot des Ordners erzeugen: Map<name, {size, lastModified}>
   – nur Dateien mit indizierbarer Endung werden aufgenommen.   */
async function _watcherSnapshot(handle) {
  const map = new Map();
  if (!handle) return map;
  try {
    for await (const [name, entry] of handle.entries()) {
      if (entry.kind !== 'file') continue;
      const ext = (name.split('.').pop() || '').toLowerCase();
      if (SUPPORTED_INDEX_EXTS.indexOf(ext) < 0) continue;
      try {
        const file = await entry.getFile();
        map.set(name, { size: file.size, lastModified: file.lastModified, handle: entry });
      } catch(_) { /* nicht lesbar – ignorieren */ }
    }
  } catch (e) {
    console.warn('[Watcher] Snapshot:', e);
  }
  return map;
}

/* Vergleicht zwei Snapshots und gibt {added, changed, removed} zurück. */
function _watcherDiff(prev, curr) {
  const added = [], changed = [], removed = [];
  for (const [name, info] of curr.entries()) {
    if (!prev.has(name)) {
      added.push({ name, info });
    } else {
      const p = prev.get(name);
      if (p.size !== info.size || p.lastModified !== info.lastModified) {
        changed.push({ name, info });
      }
    }
  }
  for (const name of prev.keys()) {
    if (!curr.has(name)) removed.push({ name });
  }
  return { added, changed, removed };
}

/* Ein einzelnes Polling-Intervall ausführen. */
async function _watcherTick() {
  if (!_watcherFolder || !_watcherFolder.handle) return;
  let curr;
  try {
    // Berechtigung sicherstellen
    if (_watcherFolder.handle.queryPermission) {
      const perm = await _watcherFolder.handle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') {
        _watcherAddLog('⚠ Berechtigung verloren – Watcher pausiert', 'warn');
        watcherStop();
        return;
      }
    }
    curr = await _watcherSnapshot(_watcherFolder.handle);
  } catch (e) {
    _watcherAddLog('⚠ Polling-Fehler: ' + e.message, 'warn');
    return;
  }

  const diff = _watcherDiff(_watcherFolder.snapshot || new Map(), curr);
  _watcherFolder.snapshot = curr;

  if (diff.added.length + diff.changed.length + diff.removed.length === 0) return;

  if (diff.added.length > 0)   _watcherAddLog(`➕ ${diff.added.length} neue Datei(en) erkannt`, 'add');
  if (diff.changed.length > 0) _watcherAddLog(`✎ ${diff.changed.length} geänderte Datei(en) erkannt`, 'change');
  if (diff.removed.length > 0) _watcherAddLog(`🗑 ${diff.removed.length} entfernte Datei(en) erkannt`, 'remove');

  // Re-Index versuchen, sofern Index-Modul bereits geladen ist
  const reindex = window.IP67 && window.IP67._reindexFile;
  if (typeof reindex === 'function') {
    for (const x of diff.added.concat(diff.changed)) {
      try {
        const file = await x.info.handle.getFile();
        await reindex(file, x.name);
        _watcherAddLog('✓ re-indiziert: ' + x.name, 'ok');
      } catch (e) {
        _watcherAddLog('✗ Fehler bei ' + x.name + ': ' + e.message, 'warn');
      }
    }
  } else {
    _watcherAddLog('ℹ Index-Modul nicht geladen – manuell neu indizieren', 'info');
  }
}

async function watcherStart() {
  if (!hasFileSystemAccessAPI()) {
    toast('Datei-Watcher: Ihr Browser unterstützt die File-System-Access-API nicht (Edge/Chrome empfohlen).');
    return false;
  }
  let handle = null;
  try {
    handle = await idbSettingGet('saveFolder');
  } catch(_) {}

  if (!handle) {
    toast('Datei-Watcher: Bitte zuerst in den Einstellungen einen Speicher-Ordner wählen.');
    return false;
  }

  // Lese-Berechtigung sicherstellen
  if (handle.queryPermission) {
    let perm = await handle.queryPermission({ mode: 'read' });
    if (perm !== 'granted') {
      perm = await handle.requestPermission({ mode: 'read' });
      if (perm !== 'granted') {
        toast('Datei-Watcher: Lese-Berechtigung nicht erteilt.');
        return false;
      }
    }
  }

  _watcherFolder = { handle, snapshot: await _watcherSnapshot(handle) };
  _watcherAddLog('▶ Watcher gestartet – Ordner: ' + (handle.name || 'unbekannt') +
                 ' (' + _watcherFolder.snapshot.size + ' Dateien überwacht)', 'ok');

  const intervalMs = getWatcherInterval() * 1000;
  if (_watcherTimer) clearInterval(_watcherTimer);
  _watcherTimer = setInterval(_watcherTick, intervalMs);

  localStorage.setItem(WATCHER_ENABLED_KEY, '1');
  _updateAdminBannerWatcherBadge();
  return true;
}

function watcherStop() {
  if (_watcherTimer) { clearInterval(_watcherTimer); _watcherTimer = null; }
  _watcherFolder = null;
  localStorage.setItem(WATCHER_ENABLED_KEY, '0');
  _watcherAddLog('⏸ Watcher gestoppt', 'info');
  _updateAdminBannerWatcherBadge();
}

async function watcherToggle() {
  if (isWatcherEnabled() && _watcherTimer) {
    watcherStop();
    toast('Datei-Watcher gestoppt');
  } else {
    const ok = await watcherStart();
    if (ok) toast('✓ Datei-Watcher aktiv (Intervall ' + getWatcherInterval() + ' s)');
  }
  // Settings-Modal neu rendern, falls offen
  const ctx = modalCtx;
  if (ctx && ctx.action === 'settings' && window.IP67._renderSettingsBody) {
    window.IP67._renderSettingsBody();
  }
}

function watcherSetInterval(seconds) {
  let v = parseInt(seconds, 10);
  if (isNaN(v) || v < WATCHER_MIN_INTERVAL) v = WATCHER_MIN_INTERVAL;
  localStorage.setItem(WATCHER_INTERVAL_KEY, String(v));
  if (_watcherTimer) {
    clearInterval(_watcherTimer);
    _watcherTimer = setInterval(_watcherTick, v * 1000);
    _watcherAddLog('⏱ Intervall geändert: ' + v + ' s', 'info');
  }
}

function watcherGetState() {
  return {
    enabled: isWatcherEnabled() && !!_watcherTimer,
    interval: getWatcherInterval(),
    folderName: (_watcherFolder && _watcherFolder.handle && _watcherFolder.handle.name) || null,
    fileCount: (_watcherFolder && _watcherFolder.snapshot) ? _watcherFolder.snapshot.size : 0,
    log: _watcherLog.slice()
  };
}

function _updateAdminBannerWatcherBadge() {
  // Im Admin-Banner eine kleine Pulsing-Badge zeigen, wenn der
  // Watcher aktiv ist. Wir hängen sie an die admin-banner-right-Gruppe.
  const right = document.querySelector('.admin-banner-right');
  if (!right) return;
  const old = right.querySelector('.watcher-mini-badge');
  const active = isWatcherEnabled() && !!_watcherTimer;
  if (active && !old) {
    const span = document.createElement('span');
    span.className = 'watcher-mini-badge';
    span.title = 'Datei-Watcher aktiv – Intervall ' + getWatcherInterval() + ' s';
    span.innerHTML = '<span class="wmb-dot"></span> Watcher';
    right.insertBefore(span, right.firstChild);
  } else if (!active && old) {
    old.remove();
  }
}


/* ============================================================
   PHASE 4 – ZULETZT GEÖFFNET / SUCHHISTORIE / STATISTIK
   ──────────────────────────────────────────────────────────
   Vier zusammengehörige Personalisierungs-Features. Alle Daten
   liegen lokal im localStorage (pro Browser/PC). Für die
   Statistik gibt es zusätzlich einen Sync-Mechanismus, der
   die eigenen Zugriffsdaten als pro-User-Datei in einem
   gemeinsamen Ordner ablegt (File-System-Access-API).

   Speicherorte:
     · ip67-recent-docs       [{id,href,title,icon,ts}, …] max 8
     · ip67-search-history    [query, query, …] max 8
     · ip67-access-stats      { <docId>: {count, last} }
     · ip67-browser-id        zufälliger anonymer String
     · ip67-stats-share-enabled  "1" wenn User Stats teilt
     · IDB-Setting "saveFolder"  FileSystemDirectoryHandle (shared)
============================================================ */

/* ── 14a. BROWSER-ID (anonym, einmalig generiert) ── */
function getBrowserId() {
  let id = localStorage.getItem(BROWSER_ID_KEY);
  if (!id) {
    id = Math.random().toString(36).slice(2, 8) +
         Date.now().toString(36).slice(-4);
    localStorage.setItem(BROWSER_ID_KEY, id);
  }
  return id;
}

/* ============================================================
   14b. ZULETZT GEÖFFNET
============================================================ */
function loadRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch(_) { return []; }
}

function saveRecent(arr) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(arr)); }
  catch(e) { console.warn('Recent speichern:', e); }
}

function pushRecent(node) {
  if (!node || !node.href || node.href === '#' || node.href === '#home') return;
  const list = loadRecent();
  const idx = list.findIndex(e => e.id === node.id);
  if (idx >= 0) list.splice(idx, 1);
  list.unshift({
    id:    node.id,
    href:  node.href,
    title: node.title,
    icon:  node.icon || iconForHref(node.href),
    ts:    Date.now()
  });
  while (list.length > RECENT_LIMIT) list.pop();
  saveRecent(list);
}

function renderRecentBox() {
  const box  = document.getElementById('recentDocsBox');
  const list = document.getElementById('recentDocsList');
  if (!box || !list) return;
  const recent = loadRecent();
  if (recent.length === 0) { box.classList.add('empty'); return; }
  box.classList.remove('empty');
  list.innerHTML = recent.map(r => {
    const t = relTime(r.ts);
    return `
      <a class="recent-docs-item" href="${escAttr(r.href)}"
         onclick="IP67.openDoc(this.getAttribute('href'), ${JSON.stringify(r.title)}); return false;"
         title="${escAttr(r.title)} – ${escAttr(t)}">
        <span class="rdi-icon">${escHtml(r.icon || iconForHref(r.href))}</span>
        <span class="rdi-title">${escHtml(r.title)}</span>
        <span class="rdi-time">${escHtml(t)}</span>
      </a>`;
  }).join('');
}

function relTime(ts) {
  if (!ts) return '';
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60)       return 'gerade eben';
  if (diff < 3600)     return Math.floor(diff / 60) + ' Min';
  if (diff < 86400)    return Math.floor(diff / 3600) + ' Std';
  if (diff < 86400*7)  return Math.floor(diff / 86400) + ' Tg';
  try {
    return new Date(ts).toLocaleDateString('de-DE', { day:'2-digit', month:'short' });
  } catch(_) { return ''; }
}

function clearRecent() {
  if (!confirm('Verlauf der zuletzt geöffneten Dokumente löschen?')) return;
  saveRecent([]);
  renderRecentBox();
  toast('Verlauf gelöscht');
}

/* ============================================================
   14d. SUCHHISTORIE
============================================================ */
function loadSearchHistory() {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch(_) { return []; }
}

function saveSearchHistory(arr) {
  try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(arr)); }
  catch(e) { console.warn('Suchhistorie speichern:', e); }
}

function pushSearchHistory(query) {
  if (!query || query.trim().length < 2) return;
  const q = query.trim();
  const list = loadSearchHistory();
  const idx = list.findIndex(x => x.toLowerCase() === q.toLowerCase());
  if (idx >= 0) list.splice(idx, 1);
  list.unshift(q);
  while (list.length > SEARCH_HISTORY_LIMIT) list.pop();
  saveSearchHistory(list);
}

function clearSearchHistory() {
  saveSearchHistory([]);
  hideSearchHistoryDropdown();
  toast('Suchhistorie gelöscht');
}

function showSearchHistoryDropdown() {
  const list = loadSearchHistory();
  if (list.length === 0) { hideSearchHistoryDropdown(); return; }
  let dd = document.getElementById('searchHistoryDropdown');
  if (!dd) {
    dd = document.createElement('div');
    dd.id = 'searchHistoryDropdown';
    dd.className = 'search-history-dropdown';
    const wrapper = document.querySelector('.search-wrapper');
    if (wrapper) wrapper.appendChild(dd);
    else return;
  }
  dd.innerHTML =
    '<div class="shd-header">Zuletzt gesucht' +
    '  <button class="shd-clear" onclick="IP67.clearSearchHistory()" title="Liste leeren">×</button>' +
    '</div>' +
    list.map(q =>
      `<button class="shd-item" type="button"
               onmousedown="event.preventDefault();"
               onclick="IP67.applySearchHistory(${JSON.stringify(q)})">
         <span class="shd-icon">🕘</span>
         <span class="shd-q">${escHtml(q)}</span>
       </button>`).join('');
  dd.classList.add('visible');
}

function hideSearchHistoryDropdown() {
  const dd = document.getElementById('searchHistoryDropdown');
  if (dd) dd.classList.remove('visible');
}

function applySearchHistory(q) {
  const input = document.getElementById('sidebarSearch');
  if (!input) return;
  input.value = q;
  hideSearchHistoryDropdown();
  onSearchInput(q);
  input.focus();
}

/* ============================================================
   14e. ZUGRIFFSSTATISTIK – LOKAL + GETEILT
============================================================ */
function loadStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return (obj && typeof obj === 'object') ? obj : {};
  } catch(_) { return {}; }
}

function saveStats(stats) {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); }
  catch(e) { console.warn('Stats speichern:', e); }
}

let _statsDirty = false;

function recordAccess(node) {
  if (!node || !node.id) return;
  if (!node.href || node.href === '#' || node.href === '#home') return;
  const stats = loadStats();
  const entry = stats[node.id] || { count: 0, last: 0, title: node.title, href: node.href };
  entry.count = (entry.count || 0) + 1;
  entry.last  = Date.now();
  entry.title = node.title;
  entry.href  = node.href;
  stats[node.id] = entry;
  saveStats(stats);
  _statsDirty = true;
}

function clearStatsLocal() {
  if (!confirm('Eigene Zugriffsstatistik wirklich löschen? (Andere PCs sind nicht betroffen.)')) return;
  saveStats({});
  _statsDirty = true;
  toast('Eigene Statistik gelöscht');
  const m = document.getElementById('statsModal');
  if (m && m.classList.contains('show')) renderStatsModal();
}

function isStatsShareEnabled() {
  const val = localStorage.getItem(STATS_SHARE_ENABLED);
  // Wenn noch nie gesetzt (null), gilt die Checkbox als aktiv (Opt-out statt Opt-in)
  if (val === null) return true;
  return val === '1';
}
function setStatsShareEnabled(on) {
  if (on) localStorage.setItem(STATS_SHARE_ENABLED, '1');
  else    localStorage.removeItem(STATS_SHARE_ENABLED);
}

/* Schreibt die eigene Statistik in <SaveFolder>/stats/<browserId>.json */
async function syncStatsToFolder(silent) {
  if (!hasFileSystemAccessAPI()) {
    if (!silent) toast('Browser unterstützt das Teilen nicht (nur Edge/Chrome)');
    return false;
  }
  let handle = null;
  try { handle = await idbSettingGet('saveFolder'); } catch(_){}
  if (!handle) {
    if (!silent) toast('Bitte zuerst einen Speicher-Ordner in den Einstellungen wählen');
    return false;
  }
  try {
    if (handle.queryPermission) {
      let perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        if (silent) return false;
        perm = await handle.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          toast('Schreibrechte für den Ordner nicht erteilt');
          return false;
        }
      }
    }
    const subDir = await handle.getDirectoryHandle(STATS_SUBFOLDER, { create: true });
    const fileName = getBrowserId() + '.json';
    const fileHandle = await subDir.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    const payload = {
      browserId: getBrowserId(),
      updatedAt: new Date().toISOString(),
      stats:     loadStats()
    };
    await writable.write(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    await writable.close();
    _statsDirty = false;
    if (!silent) toast('✓ Statistik in Pool veröffentlicht');
    return true;
  } catch(e) {
    if (!silent) toast('Statistik konnte nicht geteilt werden: ' + e.message);
    console.warn('[Stats] Sync:', e);
    return false;
  }
}

/* Liest alle stats/*.json aus dem Save-Folder und aggregiert. */
async function readSharedStats() {
  if (!hasFileSystemAccessAPI()) return { contributors: 0, byDoc: {}, perBrowser: [] };
  let handle = null;
  try { handle = await idbSettingGet('saveFolder'); } catch(_){}
  if (!handle) return { contributors: 0, byDoc: {}, perBrowser: [] };
  try {
    if (handle.queryPermission) {
      const perm = await handle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') {
        const req = await handle.requestPermission({ mode: 'read' });
        if (req !== 'granted') return { contributors: 0, byDoc: {}, perBrowser: [] };
      }
    }
    let subDir;
    try { subDir = await handle.getDirectoryHandle(STATS_SUBFOLDER, { create: false }); }
    catch(_) { return { contributors: 0, byDoc: {}, perBrowser: [] }; }

    const byDoc = {};
    const perBrowser = [];
    let contributors = 0;
    for await (const [name, entry] of subDir.entries()) {
      if (entry.kind !== 'file' || !name.endsWith('.json')) continue;
      try {
        const file = await entry.getFile();
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data || !data.stats) continue;
        contributors++;
        let totalForBrowser = 0;
        for (const docId in data.stats) {
          const s = data.stats[docId];
          if (!s || !s.count) continue;
          totalForBrowser += s.count;
          if (!byDoc[docId]) byDoc[docId] = { count: 0, last: 0, title: s.title || docId, href: s.href || '', browsers: 0 };
          byDoc[docId].count   += s.count;
          byDoc[docId].browsers++;
          if (s.last > byDoc[docId].last) byDoc[docId].last = s.last;
          if (s.title && !byDoc[docId].title) byDoc[docId].title = s.title;
          if (s.href  && !byDoc[docId].href)  byDoc[docId].href  = s.href;
        }
        perBrowser.push({
          id: data.browserId || name.replace('.json',''),
          updatedAt: data.updatedAt || null,
          totalClicks: totalForBrowser,
          docCount: Object.keys(data.stats).length
        });
      } catch(_e) { /* defekte Datei überspringen */ }
    }
    return { contributors, byDoc, perBrowser };
  } catch(e) {
    console.warn('[Stats] readShared:', e);
    return { contributors: 0, byDoc: {}, perBrowser: [] };
  }
}

async function openStatsModal() {
  let modal = document.getElementById('statsModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'statsModal';
    modal.className = 'modal-overlay';
    modal.onclick = (e) => { if (e.target === modal) closeStatsModal(); };
    modal.innerHTML = `
      <div class="modal stats-modal">
        <div class="modal-header">
          <h3>📊 Zugriffsstatistik</h3>
          <button class="modal-close" onclick="IP67.closeStatsModal()" title="Schließen">×</button>
        </div>
        <div class="modal-body" id="statsModalBody"></div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="IP67.clearStatsLocal()">🗑 Eigene Stats löschen</button>
          <button class="btn-secondary" onclick="IP67.exportStats()">⬇ Export (JSON)</button>
          <button class="btn-primary"   onclick="IP67.closeStatsModal()">Fertig</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  modal.classList.add('show');
  renderStatsModal();
}

function closeStatsModal() {
  const modal = document.getElementById('statsModal');
  if (modal) modal.classList.remove('show');
}

async function renderStatsModal() {
  const body = document.getElementById('statsModalBody');
  if (!body) return;
  body.innerHTML = '<div class="stats-loading">Lade …</div>';

  const localStats = loadStats();
  const localList = Object.entries(localStats)
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => b.count - a.count);
  const localTotal = localList.reduce((s, e) => s + (e.count || 0), 0);

  let shared = { contributors: 0, byDoc: {}, perBrowser: [] };
  let sharedAvailable = false;
  try {
    shared = await readSharedStats();
    sharedAvailable = shared.contributors > 0;
  } catch(_) { /* ignored */ }

  const sharedList = Object.entries(shared.byDoc)
    .map(([id, s]) => ({ id, ...s }))
    .sort((a, b) => b.count - a.count);
  const sharedTotal = sharedList.reduce((s, e) => s + (e.count || 0), 0);

  const browserId = getBrowserId();
  const shareOn   = isStatsShareEnabled();

  let html = `
    <div class="stats-summary">
      <div class="stats-card">
        <div class="sc-label">Eigene Klicks</div>
        <div class="sc-val">${localTotal}</div>
        <div class="sc-sub">auf ${localList.length} Dokumente</div>
      </div>
      <div class="stats-card">
        <div class="sc-label">Pool-Gesamt</div>
        <div class="sc-val">${sharedTotal || '–'}</div>
        <div class="sc-sub">von ${shared.contributors} PC${shared.contributors === 1 ? '' : 's'}</div>
      </div>
      <div class="stats-card">
        <div class="sc-label">Browser-ID</div>
        <div class="sc-val sc-id">${escHtml(browserId)}</div>
        <div class="sc-sub">anonym, zufällig</div>
      </div>
    </div>

    <div class="stats-share-box ${shareOn ? 'is-on' : ''}">
      <div class="ssb-row">
        <label class="ssb-label">
          <input type="checkbox" id="statsShareToggle" ${shareOn ? 'checked' : ''}
                 onchange="IP67.toggleStatsShare(this.checked)">
          <span>Meine Statistik im Info-Pool teilen</span>
        </label>
        <button class="btn-secondary btn-sm" onclick="IP67.syncStatsNow()">↻ Jetzt teilen</button>
      </div>
      <div class="ssb-hint">
        Beim Aktivieren wird beim Schließen der Seite eine anonyme JSON-Datei
        (<code>stats/${escHtml(browserId)}.json</code>) im geteilten Ordner abgelegt.
        Enthält nur Klickzahlen pro Dokument – keine personenbezogenen Daten.
      </div>
    </div>

    <div class="stats-tabs">
      <button class="stats-tab is-active" data-tab="local"
              onclick="IP67._switchStatsTab('local')">📍 Eigene</button>
      <button class="stats-tab ${sharedAvailable ? '' : 'is-disabled'}" data-tab="shared"
              onclick="IP67._switchStatsTab('shared')">🌐 Pool ${sharedAvailable ? '('+shared.contributors+')' : ''}</button>
    </div>
  `;

  html += `<div class="stats-list" id="statsListLocal">`;
  if (localList.length === 0) {
    html += '<div class="stats-empty">Noch keine Klicks aufgezeichnet.</div>';
  } else {
    html += '<table class="stats-table"><thead><tr>' +
            '<th>#</th><th>Dokument</th><th class="sn">Klicks</th><th class="sn">Zuletzt</th>' +
            '</tr></thead><tbody>';
    localList.forEach((e, i) => {
      html += `<tr>
        <td class="srank">${i+1}</td>
        <td class="stitle">
          <a href="${escAttr(e.href || '#')}"
             onclick="IP67.openDoc(this.getAttribute('href'), ${JSON.stringify(e.title || '')}); IP67.closeStatsModal(); return false;">
            ${escHtml(e.title || e.id)}
          </a>
        </td>
        <td class="scount">${e.count}</td>
        <td class="stime">${escHtml(e.last ? relTime(e.last) : '–')}</td>
      </tr>`;
    });
    html += '</tbody></table>';
  }
  html += `</div>`;

  html += `<div class="stats-list" id="statsListShared" style="display:none;">`;
  if (!sharedAvailable) {
    html += `<div class="stats-empty">
      Keine geteilten Statistiken gefunden.<br>
      <span class="se-sub">Andere User müssen ihre Statistik erst im selben Ordner teilen,
      oder es wurde noch kein Speicher-Ordner gewählt.</span>
    </div>`;
  } else {
    html += '<table class="stats-table"><thead><tr>' +
            '<th>#</th><th>Dokument</th><th class="sn">Klicks</th><th class="sn">PCs</th><th class="sn">Zuletzt</th>' +
            '</tr></thead><tbody>';
    sharedList.forEach((e, i) => {
      html += `<tr>
        <td class="srank">${i+1}</td>
        <td class="stitle">
          <a href="${escAttr(e.href || '#')}"
             onclick="IP67.openDoc(this.getAttribute('href'), ${JSON.stringify(e.title || '')}); IP67.closeStatsModal(); return false;">
            ${escHtml(e.title || e.id)}
          </a>
        </td>
        <td class="scount">${e.count}</td>
        <td class="sbrowsers">${e.browsers}</td>
        <td class="stime">${escHtml(e.last ? relTime(e.last) : '–')}</td>
      </tr>`;
    });
    html += '</tbody></table>';

    if (shared.perBrowser.length > 0) {
      html += '<details class="stats-browsers"><summary>Beitragende PCs (' + shared.perBrowser.length + ')</summary>';
      html += '<table class="stats-table mini"><thead><tr><th>Browser-ID</th><th class="sn">Klicks</th><th class="sn">Dokumente</th><th>Letztes Update</th></tr></thead><tbody>';
      shared.perBrowser
        .sort((a,b) => b.totalClicks - a.totalClicks)
        .forEach(b => {
          let dt = '–';
          try { if (b.updatedAt) dt = new Date(b.updatedAt).toLocaleString('de-DE'); } catch(_) {}
          const isMe = b.id === browserId;
          html += `<tr${isMe ? ' class="is-me"' : ''}>
            <td>${escHtml(b.id)}${isMe ? ' <span class="me-badge">ICH</span>' : ''}</td>
            <td class="scount">${b.totalClicks}</td>
            <td class="scount">${b.docCount}</td>
            <td class="stime">${escHtml(dt)}</td>
          </tr>`;
        });
      html += '</tbody></table></details>';
    }
  }
  html += `</div>`;

  body.innerHTML = html;
}

function _switchStatsTab(tab) {
  document.querySelectorAll('.stats-tab').forEach(b => {
    b.classList.toggle('is-active', b.getAttribute('data-tab') === tab);
  });
  const loc = document.getElementById('statsListLocal');
  const sh  = document.getElementById('statsListShared');
  if (loc) loc.style.display = (tab === 'local')  ? '' : 'none';
  if (sh)  sh.style.display  = (tab === 'shared') ? '' : 'none';
}

async function toggleStatsShare(on) {
  setStatsShareEnabled(on);
  if (on) {
    const ok = await syncStatsToFolder(false);
    if (!ok) {
      setStatsShareEnabled(false);
      const cb = document.getElementById('statsShareToggle');
      if (cb) cb.checked = false;
    } else {
      renderStatsModal();
    }
  } else {
    toast('Teilen deaktiviert (lokale Daten bleiben erhalten)');
  }
}

async function syncStatsNow() {
  const ok = await syncStatsToFolder(false);
  if (ok) renderStatsModal();
}

function exportStats() {
  const payload = {
    browserId: getBrowserId(),
    exportedAt: new Date().toISOString(),
    stats: loadStats()
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'ip67-stats-' + getBrowserId() + '.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
  toast('Statistik exportiert');
}

/* Auto-Sync beim Verlassen der Seite (still). */
function _trySilentSync() {
  if (!isStatsShareEnabled()) return;
  if (!_statsDirty) return;
  syncStatsToFolder(true).catch(() => {});
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') _trySilentSync();
});
window.addEventListener('pagehide', _trySilentSync);

document.addEventListener('DOMContentLoaded', async () => {
  /* v8.4: Erst den live aufgebauten Ordnerbaum abwarten, dann rendern. */
  try { if (window.IP67_TREE_READY) await window.IP67_TREE_READY; }
  catch (e) { console.warn('[Core] LiveTree nicht bereit:', e); }

  /* v8.4: Ebenso auf die JSON-Daten warten. Seit die <script>-Globals
     entfallen sind (search-index.js / mitarbeiterliste.js / ip67-data.js),
     stehen Suchindex und Mitarbeiterliste NICHT mehr synchron bereit –
     ohne dieses Warten bliebe die Personensuche leer. */
  try { if (window.IP67_DATA_READY) await window.IP67_DATA_READY; }
  catch (e) { console.warn('[Core] Daten nicht vollständig geladen:', e); }

  data = loadData();
  renderTree();
  renderNewDocsBox();
  renderRecentBox();

  maybePlayStartAudio();

  const sidebarEl = document.getElementById('sidebarContent');
  if (sidebarEl) {
    sidebarEl.addEventListener('click', sidebarClickHandler, true);
  }

  // Suchfeld: Historie bei Focus zeigen, bei Blur ausblenden
  const sInput = document.getElementById('sidebarSearch');
  if (sInput) {
    sInput.addEventListener('focus', () => {
      if (!sInput.value) showSearchHistoryDropdown();
    });
    sInput.addEventListener('blur', () => {
      setTimeout(hideSearchHistoryDropdown, 200);
    });
  }

  await loadIndex();
  await fetchIndexIfAvailable();

  if (isWatcherEnabled()) {
    watcherStart().catch(err => console.warn('[Watcher] Auto-Resume:', err));
  }
});

window.addEventListener('keydown', keyDownHandler, true);

/* ============================================================
   14. PUBLIC API
============================================================ */
const adminStubs = {
  /* v8.4: Nur noch Einstellungen + Speicher-Ordner. Die Struktur-
     bearbeitung (modalSave/deleteItem/publish/…) ist entfallen, da
     die Themenstruktur live aus der SharePoint-Ablage stammt. */
  openModal:        makeStub('admin', 'openModal'),
  closeModal:       makeStub('admin', 'closeModal'),
  resetAll:         makeStub('admin', 'resetAll'),
  pickSaveFolder:   makeStub('admin', 'pickSaveFolder'),
  clearSaveFolder:  makeStub('admin', 'clearSaveFolder')
};
const indexStubs = {
  openIndexModal:        makeStub('index', 'openIndexModal'),
  closeIndexModal:       makeStub('index', 'closeIndexModal'),
  exportIndex:           makeStub('index', 'exportIndex'),
  clearIndex:            makeStub('index', 'clearIndex'),
  removeIndexEntry:      makeStub('index', 'removeIndexEntry'),
  pickFileForItem:       makeStub('index', 'pickFileForItem'),
  setIndexFilter:        makeStub('index', 'setIndexFilter'),
  setIndexFilterStatus:  makeStub('index', 'setIndexFilterStatus'),
  pickFolderModern:      makeStub('index', 'pickFolderModern'),
  handleFolderInput:     makeStub('index', 'handleFolderInput')
};

window.IP67 = Object.assign({
  /* Internes – wird von Submodulen verwendet */
  _internal: IP67_INTERNAL,
  _loadModule: loadModule,
  _stubs: Object.assign({}, adminStubs, indexStubs),

  /* Navigation */
  handleRowClick, openDoc, showWelcome, toggleGroupById: toggleGroup,
  /* Admin-Toggle (lädt admin.js bei Bedarf) */
  /* Suche – immer im Core */
  onSearchInput, onSearchKeyDown, clearSearch, filterNav, toggleMoreSnippets,
  /* Phase 2: Ähnliche Dokumente */
  toggleSimilarOnCard, toggleSimilarInViewer,
  /* UI */
  toggleTheme, toggleMobileSidebar,
  /* Audio */
  playHelpAudio, startAudioContinue, startAudioStop,
  /* Phase 3: Anker/Scroll/Highlight im Viewer */
  jumpToNextHit, hideSearchJumpBar,
  /* Phase 3: Datei-Watcher */
  watcherStart, watcherStop, watcherToggle,
  watcherSetInterval, watcherGetState,
  /* Phase 4: Recent / Search History / Stats */
  clearRecent,
  clearSearchHistory, applySearchHistory,
  openStatsModal, closeStatsModal,
  clearStatsLocal, exportStats,
  toggleStatsShare, syncStatsNow,
  _switchStatsTab,
  /* Wird vom admin-Modul beim Settings-Rendern überschrieben,
     damit watcherToggle/Intervall-Änderung das Modal aktualisieren kann. */
  _renderSettingsBody: function(){}
}, adminStubs, indexStubs);

})();
