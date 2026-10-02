/* ================================================================
   test_ap3.js  ·  Regressionstest für AP3
   ----------------------------------------------------------------
   Die Textfassung wird aus der echten Datei herausgeschnitten und
   gegen einen künstlichen Index ausgeführt – geprüft wird das
   erzeugte DOM, nicht der Quelltext.

   Aufruf:  node test_ap3.js
   ================================================================ */
'use strict';

const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');

let ok = 0, fehl = 0;
function pruefe(name, bedingung, zusatz) {
  if (bedingung) { ok++; }
  else { fehl++; console.log('  FEHL: ' + name + (zusatz ? '  [' + zusatz + ']' : '')); }
}

const quelle = fs.readFileSync('infopool67_v8.js', 'utf8');
const css    = fs.readFileSync('infopool67_v8.css', 'utf8');
const aspx   = fs.readFileSync('infopool67_v8.aspx', 'utf8').replace(/^\uFEFF/, '');

function schneide(name) {
  const start = quelle.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('Funktion nicht gefunden: ' + name);
  let tiefe = 0;
  for (let j = quelle.indexOf('{', start); j < quelle.length; j++) {
    const c = quelle[j];
    if (c === '{') tiefe++;
    else if (c === '}') { tiefe--; if (tiefe === 0) return quelle.slice(start, j + 1); }
  }
  throw new Error('Kein Ende gefunden: ' + name);
}

/* ----------------------------------------------------------------
   Umgebung: der Betrachter, wie ihn die .aspx aufspannt, plus die
   Hilfsfunktionen, die zeigeTextansicht() um sich herum erwartet.
   ---------------------------------------------------------------- */
function bauSandkasten() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body>' +
    '<div class="viewer fullscreen" id="viewer">' +
      '<button id="vTextBtn" hidden aria-pressed="false"></button>' +
      '<div class="v-hits" id="vHits"></div>' +
      '<div class="v-snip" id="vSnip"></div>' +
      '<div class="v-skel" id="vSkel"></div>' +
      '<div class="v-body" id="vBody"></div>' +
    '</div></body></html>',
    { url: 'http://localhost/', pretendToBeVisual: true });

  const s = {
    document: dom.window.document,
    window: dom.window,
    localStorage: dom.window.localStorage,
    setTimeout: dom.window.setTimeout.bind(dom.window),
    console,
    TABELLEN_EXT: ['xlsx', 'xlsm', 'xls', 'csv'],
    TEXT_PREF_KEY: 'ip67-textansicht',
    TEXT_ABSATZ_ZIEL: 480,
    TEXT_MAX_CHARS: 300000,
    _vq: '', _vDoc: null, _vDocI: -1, _vTextAn: false,
    viewer: dom.window.document.getElementById('viewer'),
    vBody: dom.window.document.getElementById('vBody'),
    vSkel: dom.window.document.getElementById('vSkel'),
    $: (sel) => dom.window.document.querySelector(sel),
    esc: (x) => String(x == null ? '' : x)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/'/g, '&#39;'),
    ladeAktuellesDokument: () => {},
    openDocReal: () => {}
  };
  s.escAttr = (x) => s.esc(x).replace(/"/g, '&quot;');
  vm.createContext(s);
  vm.runInContext([
    'textPrefLies', 'textPrefSchreib', 'extVon', 'textAnsichtMoeglich',
    'aktualisiereTextKnopf', 'absaetze', 'escMitMarke', 'setzeTextansicht',
    'fokusTextanfang', 'zeigeTextansicht', 'zeigeTextFehlt'
  ].map(schneide).join('\n'), s);
  return s;
}

/* Text mit Seitenmarken bauen: n Seiten à laenge Zeichen. */
function seitenText(n, laenge) {
  const teile = [], breaks = [];
  let lauf = 0;
  for (let i = 1; i <= n; i++) {
    const satz = 'Seite ' + i + ' Inhalt. ';
    let t = satz;
    while (t.length < laenge) t += 'Ein Satz mit ausreichend Text zum Lesen. ';
    t = t.slice(0, laenge);
    breaks.push(lauf);
    teile.push(t);
    lauf += t.length;
  }
  return { text: teile.join(''), breaks: breaks };
}

console.log('\n=== AP3 · Textfassung aus dem Volltextindex ===\n');

/* ---------------- 1. absaetze() -------------------------------- */
{
  const s = bauSandkasten();
  pruefe('Leerer Text ergibt keine Absätze', s.absaetze('').length === 0);
  pruefe('Nur Leerzeichen ergeben keine Absätze', s.absaetze('   ').length === 0);

  const kurz = s.absaetze('Ein kurzer Satz. Noch einer.');
  pruefe('Kurzer Text bleibt ein Absatz', kurz.length === 1, kurz.length);

  const lang = s.absaetze('Ein Satz mit Inhalt. '.repeat(200));
  pruefe('Langer Text wird in mehrere Absätze zerlegt', lang.length > 5, lang.length);
  pruefe('Kein Absatz wird unangemessen lang',
    lang.every(p => p.length < 480 * 4 + 50),
    Math.max.apply(null, lang.map(p => p.length)));
  pruefe('Getrennt wird nur nach einem Satzende',
    lang.slice(0, -1).every(p => /[.!?:;]$/.test(p.trim())),
    lang.find(p => !/[.!?:;]$/.test(p.trim())));
  pruefe('Kein Zeichen geht beim Zerlegen verloren',
    lang.join(' ').replace(/\s+/g, '') ===
    ('Ein Satz mit Inhalt. '.repeat(200)).trim().replace(/\s+/g, ''));

  /* Der Index streicht alle Zeilenumbrueche zusammen. Text ohne
     Satzzeichen (Listen, Tabellen aus PDFs) muss trotzdem zerfallen. */
  const ohne = s.absaetze('Wort '.repeat(2000));
  pruefe('Text ganz ohne Satzzeichen wird trotzdem zerlegt', ohne.length > 1, ohne.length);
  pruefe('Notbremse hält die Blöcke begrenzt',
    ohne.every(p => p.length <= 480 * 4 + 10),
    Math.max.apply(null, ohne.map(p => p.length)));
}

/* ---------------- 2. escMitMarke() ----------------------------- */
{
  const s = bauSandkasten();
  pruefe('Ohne Suchbegriff wird nur maskiert',
    s.escMitMarke('a < b & c', '') === 'a &lt; b &amp; c', s.escMitMarke('a < b & c', ''));
  pruefe('Ein Zeichen als Suchbegriff wird ignoriert (zu unscharf)',
    s.escMitMarke('Baum', 'a').indexOf('<mark') < 0);
  pruefe('Der Suchbegriff wird hervorgehoben',
    /<mark class="hl">Baum<\/mark>/.test(s.escMitMarke('Ein Baum steht', 'Baum')));
  pruefe('Groß- und Kleinschreibung spielt keine Rolle',
    /<mark class="hl">BAUM<\/mark>/.test(s.escMitMarke('Ein BAUM steht', 'baum')));
  pruefe('Mehrere Fundstellen werden alle markiert',
    (s.escMitMarke('Baum Baum Baum', 'Baum').match(/<mark/g) || []).length === 3);
  pruefe('Der Zähler wird mitgeführt', (() => {
    const z = { n: 0 };
    s.escMitMarke('Baum Baum', 'Baum', z);
    return z.n === 2;
  })());
  pruefe('Spitze Klammern im Suchbegriff werden maskiert',
    s.escMitMarke('a <b> c', '<b>').indexOf('&lt;b&gt;') > 0,
    s.escMitMarke('a <b> c', '<b>'));
}

/* ---------------- 3. Welche Formate bekommen die Ansicht? ------- */
{
  const s = bauSandkasten();
  const f = (h) => s.textAnsichtMoeglich({ href: h });
  pruefe('PDF bekommt die Textfassung', f('/d/a.pdf') === true);
  pruefe('DOCX bekommt die Textfassung', f('/d/a.docx') === true);
  pruefe('XLSX bleibt bei der echten Tabelle', f('/d/a.xlsx') === false);
  pruefe('CSV bleibt bei der echten Tabelle', f('/d/a.csv') === false);
  pruefe('XLS bleibt bei der echten Tabelle', f('/d/a.xls') === false);
  pruefe('Großschreibung der Endung stört nicht', f('/d/a.XLSX') === false);
  pruefe('Anhängsel an der Adresse stören nicht', f('/d/a.xlsx?v=2#x') === false);
  pruefe('Eintrag ohne Datei bekommt sie trotzdem (Text kommt aus dem Index)',
    f('') === true);
  pruefe('Ohne Dokument gibt es keine Textfassung', s.textAnsichtMoeglich(null) === false);
}

/* ---------------- 4. Gemerkte Einstellung ---------------------- */
{
  const s = bauSandkasten();
  pruefe('Voreinstellung ist aus', s.textPrefLies() === false);
  s.textPrefSchreib(true);
  pruefe('Einstellung wird gemerkt', s.textPrefLies() === true);
  pruefe('Einstellung liegt unter dem vereinbarten Schlüssel',
    s.localStorage.getItem('ip67-textansicht') === '1');
  s.textPrefSchreib(false);
  pruefe('Einstellung lässt sich zurücknehmen', s.textPrefLies() === false);
  pruefe('Der Schlüssel wird dabei entfernt',
    s.localStorage.getItem('ip67-textansicht') === null);
}

/* ---------------- 5. Textfassung mit Seiten -------------------- */
{
  const s = bauSandkasten();
  const st = seitenText(4, 1600);
  s._vDoc = { t: 'Dienstanweisung Baumkontrolle', plain: st.text, breaks: st.breaks, href: '/d/a.pdf' };
  s.zeigeTextansicht(s._vDoc);
  const b = s.vBody;

  pruefe('Die Textfassung wird aufgebaut', !!b.querySelector('.v-text'));
  pruefe('Der Betrachter zeigt sie an', b.style.display === 'block');
  pruefe('Das Ladegerüst ist wieder weg', s.vSkel.style.display === 'none');
  pruefe('Die Überschrift trägt den Dokumenttitel',
    /Dienstanweisung Baumkontrolle/.test(b.querySelector('.vt-h').textContent));
  pruefe('Die Überschrift ist als Textfassung gekennzeichnet',
    /Textfassung/.test(b.querySelector('.vt-h').textContent));
  pruefe('Die Überschrift ist anspringbar (tabindex="-1")',
    b.querySelector('#vtStart').getAttribute('tabindex') === '-1');
  pruefe('Es gibt genau einen Anfangspunkt',
    b.querySelectorAll('#vtStart').length === 1);
  pruefe('Jede Seite wird ein eigener Abschnitt',
    b.querySelectorAll('.vt-seite').length === 4,
    b.querySelectorAll('.vt-seite').length);
  pruefe('Jeder Abschnitt trägt eine Seitenüberschrift',
    b.querySelectorAll('.vt-sh').length === 4);
  pruefe('Die Seitenüberschrift nennt Seite und Gesamtzahl',
    b.querySelector('.vt-sh').textContent === 'Seite 1 von 4',
    b.querySelector('.vt-sh').textContent);
  pruefe('Die letzte Seite wird richtig gezählt',
    b.querySelectorAll('.vt-sh')[3].textContent === 'Seite 4 von 4');
  pruefe('Die Abschnitte sind über ihre Überschrift benannt', (() => {
    const sec = b.querySelector('.vt-seite');
    return sec.getAttribute('aria-labelledby') === sec.querySelector('.vt-sh').id;
  })());
  pruefe('Die Überschriften-IDs sind eindeutig',
    new Set(Array.from(b.querySelectorAll('.vt-sh')).map(h => h.id)).size === 4);
  pruefe('Der Text steht in Absätzen', b.querySelectorAll('.vt-seite p').length > 4,
    b.querySelectorAll('.vt-seite p').length);
  pruefe('Der Inhalt der ersten Seite steht auch drin',
    /Seite 1 Inhalt/.test(b.querySelector('.vt-seite').textContent));
  pruefe('Die Merk-Einstellung wird angeboten', !!b.querySelector('#vtMerk'));
  pruefe('Die Merk-Einstellung ist beschriftet',
    /als Text/i.test(b.querySelector('.vt-merk').textContent),
    b.querySelector('.vt-merk').textContent);
  pruefe('Die Seitenzahl steht in der Kopfzeile',
    /4 Seiten/.test(b.querySelector('.vt-info').textContent),
    b.querySelector('.vt-info').textContent);
  pruefe('Trefferleiste und Fundstelle sind ausgeblendet',
    s.$('#vHits').hidden === true && s.$('#vSnip').hidden === true);
}

/* ---------------- 6. Merk-Einstellung im Betrieb --------------- */
{
  const s = bauSandkasten();
  s._vDoc = { t: 'A', plain: 'Ein Text.', breaks: null, href: '/d/a.pdf' };
  s.zeigeTextansicht(s._vDoc);
  const mk = s.vBody.querySelector('#vtMerk');
  pruefe('Das Kästchen ist zunächst leer', mk.checked === false);
  mk.checked = true;
  mk.dispatchEvent(new s.window.Event('change'));
  pruefe('Ankreuzen merkt die Einstellung', s.textPrefLies() === true);
  mk.checked = false;
  mk.dispatchEvent(new s.window.Event('change'));
  pruefe('Abwählen nimmt sie zurück', s.textPrefLies() === false);

  s.textPrefSchreib(true);
  s.zeigeTextansicht(s._vDoc);
  pruefe('Beim nächsten Aufbau ist das Kästchen gesetzt',
    s.vBody.querySelector('#vtMerk').checked === true);
}

/* ---------------- 7. Ohne Seitenbegriff ------------------------ */
{
  const s = bauSandkasten();
  s._vDoc = { t: 'Protokoll', plain: 'Ein Satz mit Inhalt. '.repeat(100),
              breaks: null, href: '/d/a.docx' };
  s.zeigeTextansicht(s._vDoc);
  const b = s.vBody;
  pruefe('Ohne Seitenmarken gibt es keine Seitenüberschriften',
    b.querySelectorAll('.vt-sh').length === 0);
  pruefe('Der Fließtext ist trotzdem da', b.querySelectorAll('p').length > 3);
  pruefe('Die Kopfzeile verspricht keine Seiten',
    !/Seite/.test(b.querySelector('.vt-info').textContent),
    b.querySelector('.vt-info').textContent);
}
{
  const s = bauSandkasten();
  s._vDoc = { t: 'Einseiter', plain: 'Kurz.', breaks: [0], href: '/d/a.pdf' };
  s.zeigeTextansicht(s._vDoc);
  pruefe('Eine Seite wird im Singular angesagt',
    /1 Seite(?!n)/.test(s.vBody.querySelector('.vt-info').textContent),
    s.vBody.querySelector('.vt-info').textContent);
}

/* ---------------- 8. Suchbegriff in der Textfassung ------------ */
{
  const s = bauSandkasten();
  s._vq = 'Baumkontrolle';
  s._vDoc = { t: 'A', plain: 'Die Baumkontrolle erfolgt jährlich. Die Baumkontrolle wird dokumentiert.',
              breaks: null, href: '/d/a.pdf' };
  s.zeigeTextansicht(s._vDoc);
  const b = s.vBody;
  pruefe('Der Suchbegriff ist im Text markiert',
    b.querySelectorAll('mark.hl').length === 2, b.querySelectorAll('mark.hl').length);
  pruefe('Die Zahl der Fundstellen wird genannt',
    /2 Fundstellen/.test(b.querySelector('.vt-fund').textContent),
    b.querySelector('.vt-fund').textContent);
  pruefe('Der Suchbegriff selbst wird genannt',
    /Baumkontrolle/.test(b.querySelector('.vt-fund').textContent));
}
{
  const s = bauSandkasten();
  s._vq = 'Streusalz';
  s._vDoc = { t: 'A', plain: 'Hier steht nichts dazu.', breaks: null, href: '/d/a.pdf' };
  s.zeigeTextansicht(s._vDoc);
  pruefe('Ohne Fundstelle wird das ehrlich gesagt',
    /keine Fundstelle/i.test(s.vBody.querySelector('.vt-fund').textContent),
    s.vBody.querySelector('.vt-fund').textContent);
}
{
  const s = bauSandkasten();
  s._vDoc = { t: 'A', plain: 'Ein Text.', breaks: null, href: '/d/a.pdf' };
  s.zeigeTextansicht(s._vDoc);
  pruefe('Ohne Suche gibt es keine Fundstellen-Zeile',
    !s.vBody.querySelector('.vt-fund'));
}

/* ---------------- 9. Kein Text im Index ------------------------ */
{
  const s = bauSandkasten();
  s._vDoc = { t: 'Gescannter Aushang', plain: '', breaks: null, href: '/d/scan.pdf' };
  s.zeigeTextansicht(s._vDoc);
  const b = s.vBody;
  pruefe('Statt leerer Fläche erscheint eine Karte', !!b.querySelector('.v-dlcard'));
  pruefe('Die Karte sagt, dass es keine Textfassung gibt',
    /Keine Textfassung/i.test(b.querySelector('.dc-h').textContent));
  pruefe('Bei PDF wird der Scan als Ursache benannt',
    /Scan|Texterkennung/i.test(b.querySelector('.dc-s').textContent),
    b.querySelector('.dc-s').textContent);
  pruefe('Der Rückweg zur Originalansicht wird angeboten',
    !!b.querySelector('#vtZurueck'));
  pruefe('Herunterladen wird angeboten', !!b.querySelector('#vtDl'));
  pruefe('Der Herunterladen-Knopf ist sichtbar, weil es eine Datei gibt',
    b.querySelector('#vtDl').hidden === false);
  pruefe('Auch diese Karte hat einen Anfangspunkt für den Lesefokus',
    !!b.querySelector('#vtStart'));
  pruefe('Das Ladegerüst ist weg', s.vSkel.style.display === 'none');
  pruefe('Der Rückweg ruft setzeTextansicht(false)', (() => {
    let arg = null;
    s.openDocReal = (i, q, m) => { arg = m; };
    s._vDocI = 3;
    b.querySelector('#vtZurueck').dispatchEvent(new s.window.Event('click'));
    return arg === false;
  })());
}
{
  const s = bauSandkasten();
  s._vDoc = { t: 'Neu hochgeladen', plain: '   ', breaks: null, href: '/d/neu.docx' };
  s.zeigeTextansicht(s._vDoc);
  pruefe('Text nur aus Leerzeichen zählt als kein Text',
    !!s.vBody.querySelector('.v-dlcard'));
  pruefe('Bei Nicht-PDF wird der fehlende Abgleich benannt',
    /abgeglichen|Volltextindex/i.test(s.vBody.querySelector('.dc-s').textContent),
    s.vBody.querySelector('.dc-s').textContent);
}
{
  const s = bauSandkasten();
  s._vDoc = { t: 'Nur Indexeintrag', plain: '', breaks: null, href: '' };
  s.zeigeTextansicht(s._vDoc);
  pruefe('Ohne Datei wird Herunterladen ausgeblendet',
    s.vBody.querySelector('#vtDl').hidden === true);
}

/* ---------------- 10. Der Umschalter --------------------------- */
{
  const s = bauSandkasten();
  const b = s.$('#vTextBtn');

  s._vDoc = { t: 'A', href: '/d/a.pdf' }; s._vTextAn = false;
  s.aktualisiereTextKnopf();
  pruefe('Bei PDF ist der Knopf sichtbar', b.hidden === false);
  pruefe('In der Originalansicht heißt er "Als Text"',
    /Als Text/.test(b.textContent), b.textContent);
  pruefe('aria-pressed ist "false"', b.getAttribute('aria-pressed') === 'false');

  s._vTextAn = true;
  s.aktualisiereTextKnopf();
  pruefe('In der Textfassung heißt er "Originalansicht"',
    /Originalansicht/.test(b.textContent), b.textContent);
  pruefe('aria-pressed ist "true"', b.getAttribute('aria-pressed') === 'true');
  pruefe('Der Titel wechselt mit', /Original/i.test(b.title), b.title);
  pruefe('Das Symbol im Knopf wird überlesen',
    b.querySelector('span').getAttribute('aria-hidden') === 'true');

  s._vDoc = { t: 'T', href: '/d/t.xlsx' };
  s.aktualisiereTextKnopf();
  pruefe('Bei Tabellen bleibt der Knopf verborgen', b.hidden === true);

  s._vDoc = null;
  s.aktualisiereTextKnopf();
  pruefe('Ohne Dokument bleibt er verborgen', b.hidden === true);
}
{
  const s = bauSandkasten();
  let ruf = null;
  s.openDocReal = (i, q, m) => { ruf = { i, q, m }; };
  s._vDocI = 7; s._vq = 'Baum';
  s.setzeTextansicht(true);
  pruefe('Umschalten öffnet dasselbe Dokument neu', ruf && ruf.i === 7);
  pruefe('Der Suchbegriff wird mitgenommen', ruf && ruf.q === 'Baum');
  pruefe('Die Ansicht wird ausdrücklich vorgegeben', ruf && ruf.m === true);

  ruf = null; s._vDocI = -1;
  s.setzeTextansicht(true);
  pruefe('Ohne offenes Dokument passiert nichts', ruf === null);
}

/* ---------------- 11. Weiche in openDocReal -------------------- */
{
  pruefe('openDocReal nimmt einen dritten Parameter für die Ansicht',
    /function openDocReal\(i, q, modus\)/.test(quelle));
  pruefe('Der Listenplatz wird gemerkt', /_vDocI = i;/.test(quelle));
  pruefe('Ohne Vorgabe entscheidet die gemerkte Einstellung',
    /modus === undefined \|\| modus === null\) \? textPrefLies\(\)/.test(quelle));
  pruefe('Die Weiche steht vor dem Bau des Rahmens',
    quelle.indexOf('if (_vTextAn) { zeigeTextansicht(d); return; }') <
    quelle.indexOf("var ifr = document.createElement('iframe');"));
  pruefe('Der Umschalter ist im Betrachter verdrahtet',
    /vTextBtn'\)[\s\S]{0,120}setzeTextansicht\(!_vTextAn\)/.test(quelle));
  pruefe('Der PDF-Betrachter nennt der Sprachausgabe den Weg zur Textfassung',
    /ip67-pdfhinweis/.test(quelle) && /ip67-sr-only ip67-pdfhinweis/.test(quelle));
  pruefe('Der Hinweis wird beim nächsten Dokument entfernt',
    /altHw[\s\S]{0,80}remove\(\)/.test(quelle));
  pruefe('Das !query-Gate im PDF-Modul bleibt unangetastet (Nebenweg A zurückgestellt)',
    /if \(tot \|\| !query\) return null;/.test(
      fs.readFileSync('infopool67_pdf_v8.js', 'utf8')));
}

/* ---------------- 12. Oberfläche und Stil ---------------------- */
{
  const dom = new JSDOM(aspx);
  const d = dom.window.document;
  const b = d.getElementById('vTextBtn');
  pruefe('Der Knopf steht in der .aspx', !!b);
  pruefe('Er sitzt in der Kopfzeile des Betrachters', !!b.closest('.v-head'));
  pruefe('Er steht vor dem Herunterladen-Knopf',
    b.compareDocumentPosition(d.getElementById('vDownload')) &
    dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  pruefe('Er ist type="button"', b.getAttribute('type') === 'button');
  pruefe('Er startet verborgen', b.hasAttribute('hidden'));
  pruefe('Er meldet seinen Zustand über aria-pressed',
    b.getAttribute('aria-pressed') === 'false');
  pruefe('Sein Symbol wird überlesen',
    b.querySelector('span').getAttribute('aria-hidden') === 'true');
  pruefe('Er trägt sichtbaren Text', /Als Text/.test(b.textContent));

  pruefe('Die .aspx trägt weiterhin das Pflicht-BOM',
    fs.readFileSync('infopool67_v8.aspx', 'utf8').charCodeAt(0) === 0xFEFF);
  /* v10.4 nachgezogen: Diese beiden Prüfungen waren auf die Fassung
     festgenagelt, in der AP3 entstand (v10.0), und liefen seit v10.1
     bei jeder Lieferung rot. Sie prüfen jetzt, worum es eigentlich
     geht: dass der Cache-Bust an allen zehn Stellen einheitlich ist
     und die Fußzeile dieselbe Fassung nennt – unabhängig davon,
     welche das gerade ist. */
  {
    const fassungen = (aspx.match(/\?v=([0-9]+\.[0-9]+)/g) || [])
      .map(s => s.slice(3));
    const einheitlich = fassungen.length === 10 &&
      fassungen.every(v => v === fassungen[0]);
    pruefe('Cache-Bust steht an allen zehn Stellen auf derselben Fassung',
      einheitlich, fassungen.join(','));
    pruefe('Die Fußzeile nennt dieselbe Fassung',
      einheitlich &&
      new RegExp('Info-Pool 67 · v' + fassungen[0].replace('.', '\\.') +
                 '<\\/footer>').test(aspx));
  }

  pruefe('.v-text ist gestaltet', /\.v-text\{/.test(css));
  pruefe('Die Lesebreite ist begrenzt', /\.v-text\{[^}]*max-width:\d+ch/.test(css));
  pruefe('Der Zeilenabstand ist großzügig', /\.v-text p\{[^}]*line-height:1\.[78]/.test(css));
  pruefe('Die Seitenüberschrift ist gestaltet', /\.vt-sh\{/.test(css));
  pruefe('Der Anfangspunkt bekommt einen sichtbaren Fokusring',
    /\.v-text \.vt-h:focus-visible/.test(css));
  pruefe('Der Textknopf teilt sich die Form mit dem Herunterladen-Knopf',
    /\.v-head \.v-dl,\s*\n?\.v-head \.v-txt\{/.test(css));
  pruefe('Auch der Textknopf lässt sich verbergen',
    /\.v-head \.v-txt\[hidden\]/.test(css));
  pruefe('Die Klammerbilanz im CSS stimmt',
    (css.match(/\{/g) || []).length === (css.match(/\}/g) || []).length);
}

console.log('\n' + ok + ' bestanden, ' + fehl + ' fehlgeschlagen\n');
process.exit(fehl ? 1 : 0);
