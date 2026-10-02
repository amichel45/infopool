/* ================================================================
   test_zentralfelder.js  ·  Regressionstest für v10.5
   ----------------------------------------------------------------
   Zwei Befunde, die zu dieser Fassung führten:

   1) DER ZENTRALE INDEX WURDE BEIM EINLESEN BESCHNITTEN.
      fetchIndexIfAvailable() in infopool67_core_v8.js baute jeden
      Eintrag aus search-index.json neu auf und übernahm dabei nur
      Text, Datum, Länge, Dateiname und Format. `_srcSize` fiel weg –
      obwohl infopool67_indexpush_v8.js es beim Veröffentlichen
      ausdrücklich mitschreibt. Ohne `_srcSize` fällt isStale() auf
      den Datumsvergleich zurück; ein Dokument mit neuerem
      SharePoint-Datum galt damit bei JEDEM Seitenaufruf erneut als
      veraltet: herunterladen, auslesen, Hinweisstreifen – und beim
      nächsten Start von vorn. Ausserdem liess `if (!e.text) continue`
      die v10.4-Vermerke ohne Text gar nicht herein, sodass das
      amtsweite Lernen aus v10.4 beim Empfänger nie ankam.

   2) DIE VORABANZEIGE HELL/DUNKEL SPEICHERTE DEN ZUSTAND, NICHT DIE
      GRENZE. Wer tagsüber hell arbeitete und abends neu öffnete,
      bekam zuerst die helle Fassung und sah den Sprung auf dunkel.

   Geprüft wird deshalb:
     A) der Kern übernimmt die Bezugsfelder und die Vermerke
     B) örtlich gewonnener Text wird nicht durch einen zentralen
        Vermerk „kein Text" überschrieben
     C) die Vorabanzeige vergleicht Sonnengrenzen und achtet auf die
        Handschaltung
     D) „Später" wirkt über den Seitenaufruf hinaus, aber befristet
        und an den konkreten Rückstand gebunden

   Aufruf:  node test_zentralfelder.js
   ================================================================ */
'use strict';

const fs = require('fs');
const vm = require('vm');

let ok = 0, fehl = 0;
function pruefe(name, bedingung, zusatz) {
  if (bedingung) { ok++; }
  else { fehl++; console.log('  FEHL: ' + name + (zusatz ? '  [' + zusatz + ']' : '')); }
}

console.log('\n=== v10.5 · Zentrale Bezugsfelder und Vorabanzeige ===\n');

const core  = fs.readFileSync('infopool67_core_v8.js', 'utf8');
const glue  = fs.readFileSync('infopool67_v8.js', 'utf8');
const push  = fs.readFileSync('infopool67_indexpush_v8.js', 'utf8');
const aspxB = fs.readFileSync('infopool67_v8.aspx');
const aspx  = aspxB.toString('utf8').replace(/^\uFEFF/, '');

/* ---------------------------------------------------------------
   A · Der Kern übernimmt die Bezugsfelder
   --------------------------------------------------------------- */
{
  /* Die Schleife über den zentralen Bestand herausschneiden, damit
     die Prüfungen nicht versehentlich auf der localStorage-Migration
     weiter oben anschlagen. */
  const von = core.indexOf('async function fetchIndexIfAvailable()');
  const bis = core.indexOf('Datei 2: Mitarbeiterliste', von);
  pruefe('fetchIndexIfAvailable() ist auffindbar', von > 0 && bis > von);
  const block = core.slice(von, bis);

  pruefe('Einträge ohne Text werden nicht mehr pauschal übersprungen',
    /if \(!e\.text && !e\._keinText\) continue;/.test(block));
  pruefe('Das alte, verwerfende Gate ist fort',
    !/if \(!e \|\| !e\.text\) continue;/.test(block));

  pruefe('_srcSize wird übernommen', /_srcSize/.test(block));
  pruefe('_srcModified wird übernommen', /_srcModified/.test(block));
  pruefe('_uid wird übernommen', /_uid/.test(block));
  pruefe('_href wird übernommen', /_href/.test(block));
  pruefe('Der Vermerk _keinText wird übernommen',
    /entry\._keinText\s*=/.test(block));
  pruefe('Der Grund des Vermerks wandert mit',
    /_keinTextGrund/.test(block));
  pruefe('_versuchtAm wandert mit', /_versuchtAm/.test(block));

  pruefe('Fehlt _srcSize zentral, gilt der örtlich bekannte Wert',
    /alt && typeof alt\._srcSize === 'number'/.test(block));
  pruefe('Örtlich gewonnener Text schlägt einen zentralen Vermerk',
    /if \(!e\.text && alt && alt\.text\) continue;/.test(block));
  pruefe('size stürzt bei textlosen Einträgen nicht ab',
    !/e\.size \|\| e\.text\.length/.test(block));

  /* Die Bedeutung der beiden Größenfelder darf nicht verwischen. */
  pruefe('Der Unterschied size/_srcSize ist im Code benannt (I12)',
    /Textlänge[\s\S]{0,120}Bytegrösse|Textlänge[\s\S]{0,120}Bytegröße/.test(block));
}

/* ---------------------------------------------------------------
   B · Verhalten der Übernahme, an einer Nachbildung geprüft
   --------------------------------------------------------------- */
{
  /* Die Schleife wird isoliert nachgebildet – der Kern lässt sich
     ohne Browser nicht booten. Die Bedingungen stammen wörtlich aus
     der geprüften Quelle (Abschnitt A stellt das sicher). */
  const sandbox = { ergebnis: {}, today: () => '2026-01-01',
                    guessFormat: () => 'pdf' };
  const von = core.indexOf('for (const id in parsed) {',
                           core.indexOf('async function fetchIndexIfAvailable()'));
  const bis = core.indexOf('_idfCache = null;', von);
  let schleife = core.slice(von, bis)
    .replace(/searchIndex\[id\] = entry;/, 'ergebnis[id] = entry;')
    .replace(/try \{ await idbPut\(id, entry\); \} catch\(_\)\{\}/, '');

  const lauf = (parsed, searchIndex) => {
    sandbox.ergebnis = {};
    sandbox.parsed = parsed;
    sandbox.searchIndex = searchIndex;
    vm.createContext(sandbox);
    vm.runInContext('(function(){' + schleife + '})()', sandbox);
    return sandbox.ergebnis;
  };

  /* Fall 1: zentral vollständig – alles kommt an. */
  let r = lauf(
    { u_a: { text: 'abc', size: 3, _srcSize: 4711, _srcModified: '2026-05-01' } },
    {});
  pruefe('Zentral vorhandenes _srcSize kommt an',
    r.u_a && r.u_a._srcSize === 4711, r.u_a && r.u_a._srcSize);
  pruefe('Zentral vorhandenes _srcModified kommt an',
    r.u_a && r.u_a._srcModified === '2026-05-01');

  /* Fall 2: zentral ohne _srcSize, örtlich vorhanden – der örtliche
     Wert überlebt. Genau dieser Fall war die Endlosschleife. */
  r = lauf(
    { u_b: { text: 'abc', size: 3 } },
    { u_b: { text: 'abc', size: 3, _srcSize: 999, _srcModified: '2026-04-04' } });
  pruefe('Örtliches _srcSize überlebt einen zentralen Eintrag ohne Angabe',
    r.u_b && r.u_b._srcSize === 999, r.u_b && r.u_b._srcSize);
  pruefe('Örtliches _srcModified überlebt ebenso',
    r.u_b && r.u_b._srcModified === '2026-04-04');

  /* Fall 3: zentraler Vermerk ohne Text – wird übernommen. */
  r = lauf(
    { u_c: { text: '', _keinText: 'scan', _keinTextGrund: 'Scan ohne Texterkennung',
             _versuchtAm: '2026-06-01', _srcSize: 120 } },
    {});
  pruefe('Der zentrale Vermerk „kein Text" kommt an',
    r.u_c && r.u_c._keinText === 'scan', r.u_c && r.u_c._keinText);
  pruefe('Der Grund kommt mit',
    r.u_c && r.u_c._keinTextGrund === 'Scan ohne Texterkennung');
  pruefe('Der textlose Eintrag hat size 0',
    r.u_c && r.u_c.size === 0, r.u_c && r.u_c.size);

  /* Fall 4: zentraler Vermerk, örtlich aber echter Text – der Text
     bleibt. Sonst verlöre ein Arbeitsplatz nachweisbares Wissen. */
  r = lauf(
    { u_d: { text: '', _keinText: 'scan' } },
    { u_d: { text: 'echter Text', size: 11 } });
  pruefe('Örtlicher Text wird nicht durch einen Vermerk verdrängt',
    !r.u_d, r.u_d && r.u_d.text);

  /* Fall 5: weder Text noch Vermerk – nach wie vor übersprungen. */
  r = lauf({ u_e: { text: '' } }, {});
  pruefe('Ein leerer Eintrag ohne Vermerk wird weiterhin übersprungen', !r.u_e);
}

/* ---------------------------------------------------------------
   C · Vorabanzeige Hell/Dunkel
   --------------------------------------------------------------- */
{
  pruefe('Die .aspx trägt weiterhin das Pflicht-BOM (I4)',
    aspxB[0] === 0xEF && aspxB[1] === 0xBB && aspxB[2] === 0xBF);
  const kopf = aspx.slice(aspx.indexOf('<script charset="UTF-8">'),
                          aspx.indexOf('</head>'));
  pruefe('Die Vorabanzeige liest die Sonnengrenzen',
    /ip67_theme_sonne/.test(kopf));
  pruefe('Die Handschaltung hat in der Vorabanzeige Vorrang',
    kopf.indexOf('ip67_theme_override') > 0 &&
    kopf.indexOf('ip67_theme_override') < kopf.indexOf('ip67_theme_sonne'));
  pruefe('ip67_theme_last bleibt als Rückfall erhalten',
    /ip67_theme_last/.test(kopf));
  pruefe('Die Vorabanzeige rechnet den Sonnenstand NICHT selbst nach',
    !/sonnenZeiten|NOAA|Math\.asin/.test(kopf));

  pruefe('Die Glue-Schicht legt die Sonnengrenzen ab',
    /THEME_SONNE\s*=\s*'ip67_theme_sonne'/.test(glue));
  pruefe('merkeSonnenzeiten() wird aus themeAutomatik() gerufen',
    /if \(z\) merkeSonnenzeiten\(z\);/.test(glue));
  pruefe('Geschrieben wird nur einmal je Tag',
    /if \(tag === _sonneGemerkt\) return;/.test(glue));
  pruefe('Die Grenzen stehen als Tageszeit, nicht als Zeitstempel',
    /function tagesMs\(d\)/.test(glue));
  pruefe('ip67_theme_last wird auch bei unverändertem Zustand nachgeführt',
    /setItem\(THEME_LAST, theme\);[\s\S]{0,120}getAttribute\('data-theme'\) === theme\) return;/
      .test(glue));
  pruefe('Die Sonnenstands-Automatik ist nicht durch eine Toggle-Speicherung ersetzt',
    /sonnenZeiten\(jetzt, KOELN\.lat, KOELN\.lon\)/.test(glue));

  /* Die abgelegten Grenzen müssen zur Auswertung im Kopf passen. */
  const s = { auf: 6 * 3600000, unter: 20 * 3600000 };
  const entscheide = (h) => {
    const ms = h * 3600000;
    return (ms >= s.auf && ms < s.unter) ? 'light' : 'dark';
  };
  pruefe('05:00 Uhr ergibt dunkel', entscheide(5) === 'dark');
  pruefe('12:00 Uhr ergibt hell',   entscheide(12) === 'light');
  pruefe('21:00 Uhr ergibt dunkel', entscheide(21) === 'dark');

  /* ---------------------------------------------------------------
     I17 (v10.6) · Veraltete Sonnengrenzen dürfen nicht als heute
     gültig durchgehen. Nach einer Pause (z. B. über Nacht) stand in
     ip67_theme_sonne noch der GESTRIGE Eintrag; die Vorabanzeige
     prüfte s.auf/s.unter, ohne je s.d gegen das heutige Datum
     abzugleichen – ein Tag-alter Eintrag wurde wie ein heutiger
     behandelt. Sichtbar wurde das morgens: kurz vor dem tatsächlichen
     Sonnenaufgang lieferte die (leicht abweichende) gestrige Grenze
     "dunkel", die Glue-Schicht rechnete Sekundenbruchteile später mit
     den echten heutigen Zeiten nach und sprang auf "hell" – dasselbe
     Aufblitzen wie bei I5, nur in der Gegenrichtung. ------------- */
  pruefe('Die Vorabanzeige vergleicht s.d gegen das heutige Datum',
    /s\.d\s*===\s*htag/.test(kopf));
  pruefe('Das heutige Tagesdatum wird im Kopf-Script gebildet',
    /getFullYear\(\)\+'-'\+\(heute\.getMonth\(\)\+1\)\+'-'\+heute\.getDate\(\)/.test(kopf));

  /* Nachbildung der Kopf-Logik inkl. Datumsprüfung, wie in der .aspx. */
  const entscheideMitDatum = (s, htagGespeichert, htagHeute, stunde) => {
    let t = null;
    if (s && htagGespeichert === htagHeute &&
        typeof s.auf === 'number' && typeof s.unter === 'number') {
      const ms = stunde * 3600000;
      t = (ms >= s.auf && ms < s.unter) ? 'light' : 'dark';
    }
    return t; // null = kein Treffer, Kette fällt auf ip67_theme_last zurück
  };
  pruefe('Tagesgleicher Eintrag liefert weiterhin ein Ergebnis',
    entscheideMitDatum(s, '2026-9-1', '2026-9-1', 12) === 'light');
  pruefe('Ein Eintrag von gestern wird verworfen, nicht als heute gewertet',
    entscheideMitDatum(s, '2026-8-31', '2026-9-1', 6) === null);
  pruefe('Bei verworfenem Eintrag bleibt nur ip67_theme_last als Rückfall',
    /if\(!t\)\{var l=localStorage\.getItem\('ip67_theme_last'\);/.test(kopf));
}

/* ---------------------------------------------------------------
   D · Ruhezeit nach „Später"
   --------------------------------------------------------------- */
{
  pruefe('Es gibt einen eigenen Speicherschlüssel für die Ruhezeit',
    /RUHE_KEY\s*=\s*'ip67_push_spaeter'/.test(push));
  pruefe('Die Ruhezeit ist befristet',
    /spaeterTage:\s*\d+/.test(push));
  pruefe('Die Ruhezeit ist an eine Rückstandskennung gebunden',
    /function rueckstandKennung\(rs\)/.test(push));
  pruefe('Die Kennung wird sortiert, die Reihenfolge zählt nicht',
    /ids\.sort\(\)\.join\('\|'\)/.test(push));
  pruefe('Ein geänderter Rückstand hebt die Ruhezeit auf',
    /Der Rückstand hat sich seit „Später“ geändert/.test(push));
  pruefe('Der Grund der Stille steht in der Konsole',
    /Hinweis unterdrückt: „Später“ gilt noch/.test(push));
  pruefe('Die Ruhezeit lässt sich von Hand aufheben',
    /wiederFragen:/.test(push));
  pruefe('Ein erledigter Rückstand löscht die Ruhezeit',
    (push.match(/ruheLoeschen\(\)/g) || []).length >= 3,
    (push.match(/ruheLoeschen\(\)/g) || []).length + ' Aufrufe');

  pruefe('Zu große Dateien werden vor dem Herunterladen erkannt',
    /f\.size > CFG\.maxBytes/.test(push));
  pruefe('Zu große Dateien hinterlassen einen Vermerk',
    /function vermerkeZuGross\(f\)/.test(push));
  pruefe('Der Vermerk trägt den Befund „zu-gross" wie in indexsync',
    /_keinText\s*=\s*'zu-gross'/.test(push));
  pruefe('Auch der Fehlerweg hinterlässt den Vermerk',
    /zu gro\/i\.test\(e\.message/.test(push));

  /* Verhalten der Kennung an einer Nachbildung. */
  const von = push.indexOf('function rueckstandKennung(rs)');
  const bis = push.indexOf('function ruheLesen()');
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(push.slice(von, bis), sandbox);
  const k = sandbox.rueckstandKennung;
  pruefe('Gleicher Rückstand ergibt gleiche Kennung',
    k({ luecken: [{ id: 'b' }, { id: 'a' }], unpubliziert: [] }) ===
    k({ luecken: [{ id: 'a' }, { id: 'b' }], unpubliziert: [] }));
  pruefe('Ein zusätzliches Dokument ändert die Kennung',
    k({ luecken: [{ id: 'a' }], unpubliziert: [] }) !==
    k({ luecken: [{ id: 'a' }, { id: 'c' }], unpubliziert: [] }));
  pruefe('Lücke und Unveröffentlichtes werden unterschieden',
    k({ luecken: [{ id: 'a' }], unpubliziert: [] }) !==
    k({ luecken: [], unpubliziert: ['a'] }));
}

/* ---------------------------------------------------------------
   E · Fassungsnummer (I5)
   --------------------------------------------------------------- */
{
  pruefe('Cache-Bust steht an zehn Stellen auf v10.6',
    (aspx.match(/\?v=10\.6/g) || []).length === 10 &&
    aspx.indexOf('?v=10.5') < 0,
    (aspx.match(/\?v=10\.6/g) || []).length + ' Stellen');
  pruefe('Die Fußzeile nennt v10.6',
    aspx.indexOf('Info-Pool 67 · v10.6') >= 0);
  pruefe('indexsync lädt das Index-Modul in v10.5',
    /moduleVersion:\s*'10\.5'/.test(
      fs.readFileSync('infopool67_indexsync_v8.js', 'utf8')));
  pruefe('indexpush lädt das Index-Modul in v10.5',
    /moduleVersion:\s*'10\.5'/.test(push));
}

console.log('\n' + ok + ' bestanden, ' + fehl + ' fehlgeschlagen\n');
process.exit(fehl ? 1 : 0);
