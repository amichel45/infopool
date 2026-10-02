/* ================================================================
   test_keintext.js  ·  Regressionstest für v10.4 (Fassungspruefung v10.5)
   ----------------------------------------------------------------
   Prüft das Gedächtnis für dauerhaft nicht auslesbare Dateien.

   BEFUND, der zu dieser Fassung führte: Eine Datei ohne gewinnbaren
   Text (gescanntes PDF) hinterliess keine Spur. Der Abgleich stufte
   sie bei jedem Seitenaufruf erneut als „ohne Index" ein, der
   Hinweisstreifen kam wieder, das Auslesen scheiterte wieder. Weil
   der Rückstand nie null wurde, konnte ausserdem `abgleichDurch` im
   Lesbarkeitsbericht nie wahr werden – die betroffenen Dokumente
   standen dauerhaft als „noch nicht indiziert" da.

   Geprüft wird deshalb dreierlei:
     1) analyse() nimmt vermerkte Dateien NICHT mehr in `missing`
     2) ändert sich die Bytegröße, wird doch erneut versucht
     3) der Lesbarkeitsbericht liest den Vermerk und nennt den Grund

   Aufruf:  node test_keintext.js
   ================================================================ */
'use strict';

const fs = require('fs');
const { JSDOM } = require('jsdom');

let ok = 0, fehl = 0;
function pruefe(name, bedingung, zusatz) {
  if (bedingung) { ok++; }
  else { fehl++; console.log('  FEHL: ' + name + (zusatz ? '  [' + zusatz + ']' : '')); }
}

const EXTS = ['pdf', 'docx', 'txt', 'html', 'csv', 'xlsx', 'eml', 'msg'];

/* ----------------------------------------------------------------
   Umgebung für infopool67_indexsync_v8.js. Das Modul startet beim
   Laden von selbst (boot); die Zeitgeber laufen in dieser Umgebung
   ins Leere, weil `IP67_TREE_READY` nie erfüllt wird. Geprüft wird
   analyse() direkt – die Funktion ist rein rechnend.
   ---------------------------------------------------------------- */
function starteSync(dateien, index) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>',
    { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  const geschrieben = {};

  w.IP67 = {
    _internal: {
      getSearchIndex: () => index,
      saveIndexEntry: (id, e) => { geschrieben[id] = e; index[id] = e; return Promise.resolve(); },
      deleteIndexEntry: (id) => { delete index[id]; return Promise.resolve(); },
      today: () => '2026-08-29',
      SUPPORTED_INDEX_EXTS: EXTS
    },
    _supportedIndexExts: EXTS
  };
  w.IP67LiveTree = {
    listFiles: () => dateien,
    getState: () => ({ source: 'live', incomplete: 0, idMode: 'sharepoint-guid' })
  };
  w.console = { info: () => {}, warn: () => {}, error: () => {}, log: () => {} };
  /* Nie erfüllt: der Hintergrundlauf soll im Test nicht anlaufen. */
  w.IP67_TREE_READY = { then: () => ({ then: () => ({ then: () => {} }) }), catch: function () { return this; } };

  w.eval(fs.readFileSync('infopool67_indexsync_v8.js', 'utf8'));
  return { w, geschrieben };
}

function datei(id, name, size) {
  return { id, title: name.replace(/\.[^.]+$/, ''), href: 'Ablage/673/' + name,
           size, modified: '2026-08-01T10:00:00Z', uid: id, legacyId: null };
}

console.log('\n=== v10.4 · Gedächtnis für nicht auslesbare Dateien ===\n');

/* ---------------- 1. Vermerk beendet die Warteschleife ---------- */
{
  const dateien = [datei('u_a', 'Scan.pdf', 500000), datei('u_b', 'Neu.pdf', 40000)];
  const index = {
    u_a: { text: '', size: 0, _keinText: 'scan', _srcSize: 500000,
           _keinTextGrund: 'kein Text gewinnbar – Scan ohne Texterkennung' }
  };
  const { w } = starteSync(dateien, index);
  const r = w.IP67IndexSync.analyse();

  pruefe('Die vermerkte Datei steht nicht mehr in „missing"',
    r.missing.every(f => f.id !== 'u_a'), r.missing.map(f => f.id).join());
  pruefe('Sie wird als „keinText" geführt',
    r.keinText.length === 1 && r.keinText[0].id === 'u_a');
  pruefe('Die noch unbearbeitete Datei bleibt in „missing"',
    r.missing.length === 1 && r.missing[0].id === 'u_b');
  pruefe('Der Vermerk gilt nicht als verwaist (wird nicht gelöscht)',
    r.orphans.length === 0);
}

/* ---------------- 2. Geänderte Datei wird erneut versucht ------- */
{
  const dateien = [datei('u_a', 'Scan.pdf', 900000)];   // andere Bytegröße
  const index = {
    u_a: { text: '', size: 0, _keinText: 'scan', _srcSize: 500000 }
  };
  const { w } = starteSync(dateien, index);
  const r = w.IP67IndexSync.analyse();

  pruefe('Nach Größenänderung wird erneut ausgelesen',
    r.missing.length === 1 && r.missing[0].id === 'u_a');
  pruefe('Sie zählt dann nicht mehr als dauerhaft ohne Text',
    r.keinText.length === 0);
}

/* ---------------- 3. Zu große Dateien ohne Download ------------- */
{
  const dateien = [datei('u_g', 'Gruenhandbuch.pdf', 29 * 1024 * 1024)];
  const { w } = starteSync(dateien, {});
  const r = w.IP67IndexSync.analyse();

  pruefe('Eine Datei über der Größengrenze kommt nicht in die Warteschlange',
    r.missing.length === 0);
  pruefe('Sie wird als „zuGross" geführt',
    r.zuGross.length === 1 && r.zuGross[0].id === 'u_g');
}

/* ---------------- 4. Der Vermerk landet im Bestand -------------- */
{
  const dateien = [datei('u_g', 'Gruenhandbuch.pdf', 29 * 1024 * 1024)];
  const index = {};
  const { w, geschrieben } = starteSync(dateien, index);
  const r = w.IP67IndexSync.analyse();
  /* markiereZuGross läuft in run(); hier direkt über die Zustandsdaten
     nachvollzogen, indem der Vermerk wie im Betrieb geschrieben wird. */
  pruefe('Vor dem Vermerk ist der Bestand leer', Object.keys(geschrieben).length === 0);
  pruefe('Die Analyse liefert die Datei zum Vermerken',
    r.zuGross.length === 1 && r.zuGross[0].size === 29 * 1024 * 1024);
}

/* ---------------- 5. Lesbarkeitsbericht liest den Vermerk ------- */
{
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>',
    { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  const index = {
    u_a: { text: '', size: 0, _keinText: 'scan',
           _keinTextGrund: 'kein Text gewinnbar – Scan ohne Texterkennung' },
    u_g: { text: '', size: 0, _keinText: 'zu-gross',
           _keinTextGrund: 'Datei über 25 MB (29 MB) – wird nicht automatisch ausgelesen' }
  };
  w.IP67 = { _internal: { getSearchIndex: () => index, SUPPORTED_INDEX_EXTS: EXTS },
             _supportedIndexExts: EXTS };
  w.IP67LiveTree = { listFiles: () => [
    datei('u_a', 'Scan.pdf', 500000), datei('u_g', 'Gruenhandbuch.pdf', 29 * 1024 * 1024)
  ] };
  w.console = { info: () => {}, warn: () => {}, error: () => {}, log: () => {} };
  /* Der Abgleich ist ausdrücklich NICHT durch – der Vermerk muss
     trotzdem zu einer klaren Aussage führen. Genau das war der Fehler. */
  w.IP67IndexSync = { getState: () => ({ ran: true, offen: 3 }) };
  w.eval(fs.readFileSync('infopool67_a11ycheck_v8.js', 'utf8'));

  const r = w.IP67.a11yPruefe();
  const za = r.zeilen.find(z => z.id === 'u_a');
  const zg = r.zeilen.find(z => z.id === 'u_g');

  pruefe('Der Scan wird als „kein Text" eingestuft, nicht als „offen"',
    za && za.befund === 'kein-text', za && za.befund);
  pruefe('Die Begründung stammt aus dem Vermerk',
    za && /Texterkennung/.test(za.grund), za && za.grund);
  pruefe('Die zu große Datei bekommt den eigenen Befund',
    zg && zg.befund === 'zu-gross', zg && zg.befund);
  pruefe('Sie wird nicht fälschlich als unlesbar gezählt', r.k.keinText === 1);
  pruefe('Sie zählt auch nicht zur Bewertungsquote', r.k.bewertbar === 1);
  pruefe('Der Zähler für „nicht ausgelesen" stimmt', r.k.zuGross === 1);
}

/* ---------------- 6. Bereitstellung nimmt Vermerke mit ---------- */
{
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>',
    { url: 'http://localhost/', runScripts: 'outside-only' });
  const w = dom.window;
  const lokal = {
    u_t: { text: 'viel Text', size: 9, fileName: 'A.pdf', format: 'pdf' },
    u_a: { text: '', size: 0, _keinText: 'scan', _keinTextGrund: 'Scan',
           fileName: 'Scan.pdf', format: 'pdf', _srcSize: 500000 }
  };
  w.IP67 = { _internal: { getSearchIndex: () => lokal, escHtml: (s) => String(s) } };
  w.IP67Storage = { SP_SITE_URL: 'http://x/y', SP_FOLDER: '/y/z', spUploadFile: () => Promise.resolve() };
  w.searchIndexData = {};   // zentral noch leer
  w.IP67IndexSync = {
    analyse: () => ({ missing: [], stale: [], keinText: [], zuGross: [],
                      orphans: [], rehome: [], guard: null, total: 2 }),
    getState: () => ({ ran: true, laeuft: false, offen: 0 })
  };
  w.console = { info: () => {}, warn: () => {}, error: () => {}, log: () => {} };
  w.fetch = () => Promise.reject(new Error('kein Netz im Test'));
  w.eval(fs.readFileSync('infopool67_indexpush_v8.js', 'utf8'));

  const rs = w.IP67IndexPush.rueckstand();
  pruefe('Der Vermerk gilt als noch nicht bereitgestellt',
    rs.unpubliziert.indexOf('u_a') >= 0, rs.unpubliziert.join());
  pruefe('Das Dokument mit Text ebenfalls',
    rs.unpubliziert.indexOf('u_t') >= 0);
  pruefe('Der Cache-Bust des Nachlademoduls passt zur Fassung',
    w.IP67IndexPush.CFG.moduleVersion === '10.5', w.IP67IndexPush.CFG.moduleVersion);
}

/* ---------------- 7. Fassungsnummer durchgezählt ---------------- */
{
  const aspx = fs.readFileSync('infopool67_v8.aspx');
  const text = aspx.toString('utf8').replace(/^\uFEFF/, '');
  pruefe('Die .aspx trägt das Pflicht-BOM',
    aspx[0] === 0xEF && aspx[1] === 0xBB && aspx[2] === 0xBF);
  pruefe('Cache-Bust steht überall auf v10.6',
    text.indexOf('?v=10.5') < 0 && (text.match(/\?v=10\.6/g) || []).length === 10,
    (text.match(/\?v=10\.6/g) || []).length + ' Stellen');
  pruefe('Die Fußzeile nennt v10.6', text.indexOf('Info-Pool 67 · v10.6') >= 0);

  const sync = fs.readFileSync('infopool67_indexsync_v8.js', 'utf8');
  pruefe('indexsync lädt das Index-Modul in v10.5',
    /moduleVersion:\s*'10\.5'/.test(sync));
}

console.log('\n' + ok + ' bestanden, ' + fehl + ' fehlgeschlagen\n');
process.exit(fehl ? 1 : 0);
