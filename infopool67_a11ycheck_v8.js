/* ================================================================
   Info-Pool 67 · infopool67_a11ycheck_v8.js
   ----------------------------------------------------------------
   PRÜFLAUF: Welche Dokumente der Ablage sind für eine blinde
   Nutzerin überhaupt lesbar?

   Hintergrund
   -----------
   Ein Screenreader kann nur vorlesen, was als TEXT vorliegt. Ein
   eingescanntes PDF ist eine Bilddatei mit Papieroptik – für die
   Sprachausgabe eine leere Seite. Ob ein Dokument Text enthält,
   weiß der Info-Pool bereits: Die Volltext-Indizierung
   (infopool67_index_v8.js) extrahiert genau diesen Text und legt
   ihn samt Seitenmarken in der IndexedDB ab. Fehlt der Eintrag,
   obwohl das Format unterstützt wird, konnte kein Text gewonnen
   werden – das ist der Scan ohne Texterkennung.

   Dieses Modul wertet daher NUR bereits vorhandene Daten aus:
     · window.IP67LiveTree.listFiles()  – die Dateien der Ablage
     · IP67._internal.getSearchIndex()  – der Volltextindex
   Es stellt KEINE zusätzliche Anfrage an SharePoint und lädt
   keine Datei erneut. Der Lauf ist deshalb beliebig oft und
   gefahrlos wiederholbar – gedacht als Dauerwerkzeug, das nach
   jedem Schwung neuer Uploads erneut aufgerufen wird.

   Einstufung
   ----------
     lesbar        Text vorhanden und in normaler Dichte
     duenn         Text vorhanden, aber auffällig wenig je Seite
                   (Deckblatt maschinell, Rest gescannt – oder
                   ein Dokument, das fast nur aus Bildern besteht)
     kein-text     Unterstütztes Format, Abgleich durch, aber kein
                   Text gewinnbar  →  für Blinde unlesbar
     offen         Noch nicht indiziert; Aussage erst nach dem
                   Abgleich möglich
     kein-format   Format wird gar nicht ausgelesen (z. B. Bilder,
                   Präsentationen, Archive) – nicht bewertbar

   Regel 12: Diese Datei fasst nichts an. Sie liest, rechnet und
   zeigt an. Kein Schreibzugriff, keine Änderung am Index.
   ================================================================ */
(function () {
'use strict';

var MODUL_VERSION = '1.0';

/* ============================================================
   0. SCHWELLENWERTE
   ------------------------------------------------------------
   Die Zahlen sind Erfahrungswerte, keine Norm. Eine normal
   gesetzte DIN-A4-Seite trägt 1500–3000 Zeichen. Alles unter
   400 Zeichen je Seite ist verdächtig, unter 120 praktisch
   sicher ein Scan, bei dem nur Kopf- oder Fußzeile maschinell
   erzeugt wurden. Zentral hier oben, damit sie sich nach den
   ersten echten Ergebnissen nachjustieren lassen.
============================================================ */
var ZEICHEN_JE_SEITE_GUT   = 400;
var ZEICHEN_JE_SEITE_DUENN = 120;

/* Formate ohne Seitenbegriff (docx, txt, html, csv, xlsx, eml,
   msg) werden über die Gesamtlänge bewertet. */
var ZEICHEN_GESAMT_MIN = 200;

/* Ab dieser Dateigröße bei gleichzeitig wenig Text ist der
   Verdacht auf eine reine Bildstrecke besonders belastbar. */
var GROSS_ABER_TEXTARM_BYTES = 1024 * 1024;   // 1 MB

/* v10.4 · „zu-gross" ist ein eigener Befund, kein Sonderfall von
   „kein Text". Eine 29-MB-PDF kann eine tadellose Textebene haben – sie
   wird nur nicht automatisch ausgelesen. Sie unter „kein Text" zu
   führen hieße, dem Amt eine Barriere zu melden, die es womöglich gar
   nicht gibt. Wie „offen" bleibt der Befund deshalb außerhalb der
   Bewertungsquote: eine Aussage über die Lesbarkeit ist nicht möglich. */
var BEFUNDE = {
  'lesbar':      { rang: 4, farbe: '#16a34a', wort: 'lesbar' },
  'duenn':       { rang: 2, farbe: '#d97706', wort: 'wenig Text' },
  'kein-text':   { rang: 1, farbe: '#dc2626', wort: 'kein Text' },
  'offen':       { rang: 3, farbe: '#6b7280', wort: 'noch offen' },
  'zu-gross':    { rang: 3, farbe: '#6b7280', wort: 'nicht ausgelesen' },
  'kein-format': { rang: 5, farbe: '#9ca3af', wort: 'nicht auslesbar' }
};

/* ============================================================
   1. HILFEN
============================================================ */
function Int() {
  return (window.IP67 && window.IP67._internal) ? window.IP67._internal : null;
}

function esc(s) {
  var I = Int();
  if (I && I.escHtml) return I.escHtml(s == null ? '' : String(s));
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function endungVon(href) {
  var s = String(href || '');
  var q = s.indexOf('?'); if (q >= 0) s = s.slice(0, q);
  var p = s.split('/').pop();
  var d = p.lastIndexOf('.');
  return d > 0 ? p.slice(d + 1).toLowerCase() : '';
}

/* Der Ordnerpfad unterhalb der Ablage – für die Spalte „Ordner"
   und damit man weiß, wo man nacharbeiten muss. */
function ordnerVon(href) {
  var s = decodeURIComponent(String(href || ''));
  var teile = s.split('/');
  teile.pop();
  var i = teile.lastIndexOf('Ablage');
  if (i >= 0) teile = teile.slice(i + 1);
  else teile = teile.slice(-2);
  return teile.join(' › ') || '—';
}

function zahl(n) {
  if (n == null || isNaN(n)) return '—';
  return Math.round(n).toLocaleString('de-DE');
}

/* ------------------------------------------------------------
   Zusatzbefund Dateiname.
   Fließt bewusst NICHT in die Ampel ein – ein kryptischer Name
   macht ein Dokument nicht unlesbar. Er macht die Trefferliste
   aber mühsam, weil die Sprachausgabe „zwei null zwei sechs
   null eins eins vier unterstrich D A unterstrich…" buchstabiert.
   Deshalb als leiser Hinweis mitgeführt.
------------------------------------------------------------ */
function nameSperrig(titel) {
  var t = String(titel || '');
  if (/\d{8,}/.test(t)) return true;                       // lange Ziffernkette
  if (t.length > 28 && t.indexOf(' ') < 0) return true;    // ein Wort-Wurm
  if (/(^|[_\-\s])(v\d+|final|neu|kopie|entwurf)\d*([_\-\s]|$)/i.test(t)) return true;
  return false;
}

/* ============================================================
   2. DER PRÜFLAUF
   ------------------------------------------------------------
   Rein rechnend, ohne Netz. Liefert Zeilen und Kennzahlen.
============================================================ */
function pruefe() {
  var I = Int();
  if (!I) return { fehler: 'Core nicht geladen.' };
  if (!window.IP67LiveTree || !window.IP67LiveTree.listFiles) {
    return { fehler: 'LiveTree nicht geladen – die Ablage ist unbekannt.' };
  }

  var dateien = window.IP67LiveTree.listFiles() || [];
  var index   = I.getSearchIndex() || {};
  var unterstuetzt = (window.IP67 && window.IP67._supportedIndexExts) ||
                     I.SUPPORTED_INDEX_EXTS || [];

  /* Ist der automatische Abgleich durch? Solange er läuft, lässt
     sich „kein Text" nicht von „noch nicht drangewesen" trennen.
     Diese Unterscheidung ehrlich zu machen ist wichtiger, als
     eine glatte Zahl zu liefern. */
  var sy = (window.IP67IndexSync && window.IP67IndexSync.getState)
    ? window.IP67IndexSync.getState() : null;
  var abgleichDurch = !!(sy && sy.ran && sy.offen === 0);

  var zeilen = [];

  dateien.forEach(function (f) {
    var ext = endungVon(f.href);
    var e   = index[f.id];
    var hatText = !!(e && e.text && e.text.length > 0);

    var zeichen = hatText ? e.text.length : 0;
    var seiten  = (e && typeof e.totalPages === 'number' && e.totalPages > 0)
      ? e.totalPages : null;
    var dichte  = (hatText && seiten) ? (zeichen / seiten) : null;

    var befund, grund;

    if (unterstuetzt.indexOf(ext) < 0) {
      befund = 'kein-format';
      grund  = 'Format ' + (ext || '?') + ' wird nicht ausgelesen';

    /* v10.4 · Der Abgleich hinterlässt seit dieser Fassung einen
       ausdrücklichen Vermerk, wenn ein Auslesen dauerhaft nichts
       bringt. Bis v10.3 war diese Aussage nur indirekt über
       `abgleichDurch` zu haben – und die Bedingung dafür
       (`sync.offen === 0`) konnte nie eintreten, solange auch nur eine
       einzige Datei nicht auslesbar war. Die betroffenen Dokumente
       standen deshalb dauerhaft als „noch nicht indiziert" da, mit dem
       Versprechen, das erledige sich von selbst. Der Vermerk ersetzt
       diese Hilfskonstruktion durch eine belegte Aussage. */
    } else if (e && e._keinText === 'zu-gross') {
      befund = 'zu-gross';
      grund  = e._keinTextGrund || 'über der Größengrenze – nicht automatisch ausgelesen';

    } else if (e && e._keinText && !hatText) {
      befund = 'kein-text';
      grund  = e._keinTextGrund || 'kein Text gewinnbar – Scan ohne Texterkennung';

    } else if (hatText) {
      if (dichte != null) {
        if (dichte >= ZEICHEN_JE_SEITE_GUT) {
          befund = 'lesbar';
          grund  = 'Textebene vorhanden';
        } else if (dichte >= ZEICHEN_JE_SEITE_DUENN) {
          befund = 'duenn';
          grund  = 'nur ' + zahl(dichte) + ' Zeichen je Seite';
        } else {
          befund = 'duenn';
          grund  = 'fast textlos (' + zahl(dichte) + ' Zeichen je Seite) – vermutlich Scan';
        }
      } else {
        if (zeichen >= ZEICHEN_GESAMT_MIN) {
          befund = 'lesbar';
          grund  = 'Textebene vorhanden';
        } else {
          befund = 'duenn';
          grund  = 'nur ' + zahl(zeichen) + ' Zeichen insgesamt';
        }
      }
      /* Verschärfung: viel Datei, wenig Text = Bildstrecke. */
      if (befund === 'duenn' && typeof f.size === 'number' &&
          f.size > GROSS_ABER_TEXTARM_BYTES) {
        grund += ' · große Datei, kaum Text';
      }

    } else if (!abgleichDurch) {
      befund = 'offen';
      grund  = 'noch nicht indiziert';

    } else {
      befund = 'kein-text';
      grund  = 'kein Text gewinnbar – Scan ohne Texterkennung';
    }

    zeilen.push({
      id:      f.id,
      titel:   f.title || '(ohne Namen)',
      ordner:  ordnerVon(f.href),
      href:    f.href,
      ext:     ext || '—',
      seiten:  seiten,
      zeichen: zeichen,
      dichte:  dichte,
      bytes:   (typeof f.size === 'number') ? f.size : null,
      befund:  befund,
      grund:   grund,
      sperrig: nameSperrig(f.title)
    });
  });

  /* Sortierung: das Dringlichste zuerst, darin alphabetisch.
     Wer den Bericht öffnet, will nicht scrollen müssen, um zu
     sehen, was zu tun ist. */
  zeilen.sort(function (a, b) {
    var ra = BEFUNDE[a.befund].rang, rb = BEFUNDE[b.befund].rang;
    if (ra !== rb) return ra - rb;
    return a.titel.localeCompare(b.titel, 'de');
  });

  var k = { gesamt: zeilen.length, lesbar: 0, duenn: 0, keinText: 0,
            offen: 0, zuGross: 0, keinFormat: 0, sperrig: 0 };
  zeilen.forEach(function (z) {
    if (z.befund === 'lesbar')           k.lesbar++;
    else if (z.befund === 'duenn')       k.duenn++;
    else if (z.befund === 'kein-text')   k.keinText++;
    else if (z.befund === 'offen')       k.offen++;
    else if (z.befund === 'zu-gross')    k.zuGross++;
    else                                 k.keinFormat++;
    if (z.sperrig) k.sperrig++;
  });

  /* Bewertbar sind nur die Dateien, über die eine Aussage
     möglich ist – ohne die offenen und die formatfremden. */
  k.bewertbar = k.lesbar + k.duenn + k.keinText;
  k.quote = k.bewertbar > 0 ? (k.lesbar / k.bewertbar * 100) : null;

  return { zeilen: zeilen, k: k, abgleichDurch: abgleichDurch, sync: sy };
}

/* ============================================================
   3. BERICHT ANZEIGEN
   ------------------------------------------------------------
   Der Bericht über Barrierefreiheit muss selbst barrierefrei
   sein – sonst wäre er ein schlechter Witz. Also: echte
   Tabelle mit Kopfzellen, role="dialog", Fokusfalle, ESC,
   Fokusrückgabe, Statuswechsel per aria-live.
============================================================ */
var _offen = null;   // { host, vorherFokus, filter }

function schliesse() {
  if (!_offen) return;
  document.removeEventListener('keydown', aufTaste, true);
  if (_offen.host && _offen.host.parentNode) _offen.host.parentNode.removeChild(_offen.host);
  var zurueck = _offen.vorherFokus;
  _offen = null;
  if (zurueck && zurueck.focus) { try { zurueck.focus(); } catch (_) {} }
}

function aufTaste(e) {
  if (!_offen) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); schliesse(); return; }
  if (e.key !== 'Tab') return;

  /* Fokusfalle: Ohne sie wandert die Tabulatortaste hinter den
     Dialog in die Seite darunter – die Sprachausgabe liest dann
     Dinge vor, die optisch verdeckt sind. */
  var f = _offen.host.querySelectorAll(
    'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (!f.length) return;
  var erst = f[0], letzt = f[f.length - 1];
  if (e.shiftKey && document.activeElement === erst) {
    e.preventDefault(); letzt.focus();
  } else if (!e.shiftKey && document.activeElement === letzt) {
    e.preventDefault(); erst.focus();
  }
}

function balken(k) {
  if (!k.bewertbar) return '';
  function teil(n, farbe, titel) {
    if (!n) return '';
    var p = (n / k.bewertbar * 100).toFixed(1);
    return '<span style="width:' + p + '%;background:' + farbe +
           ';display:block;height:100%" title="' + esc(titel) + '"></span>';
  }
  return '<div aria-hidden="true" style="display:flex;height:10px;border-radius:999px;' +
         'overflow:hidden;margin:10px 0 4px;background:var(--line)">' +
         teil(k.lesbar,   BEFUNDE['lesbar'].farbe,    'lesbar') +
         teil(k.duenn,    BEFUNDE['duenn'].farbe,     'wenig Text') +
         teil(k.keinText, BEFUNDE['kein-text'].farbe, 'kein Text') +
         '</div>';
}

function kopfText(r) {
  var k = r.k;
  var s = '<p style="margin-bottom:6px">' +
    '<strong>' + zahl(k.gesamt) + '</strong> Dateien in der Ablage · ' +
    '<strong>' + zahl(k.bewertbar) + '</strong> davon bewertbar.';
  if (k.quote != null) {
    s += ' Für eine Sprachausgabe nutzbar: <strong>' +
         k.quote.toFixed(0) + ' %</strong>.';
  }
  s += '</p>';

  s += '<p style="margin-bottom:2px">' +
    ampelPunkt('lesbar')      + zahl(k.lesbar)     + ' lesbar · ' +
    ampelPunkt('duenn')       + zahl(k.duenn)      + ' wenig Text · ' +
    ampelPunkt('kein-text')   + zahl(k.keinText)   + ' kein Text' +
    (k.offen      ? ' · ' + ampelPunkt('offen')       + zahl(k.offen) + ' noch offen' : '') +
    (k.zuGross    ? ' · ' + ampelPunkt('zu-gross')    + zahl(k.zuGross) + ' nicht ausgelesen' : '') +
    (k.keinFormat ? ' · ' + ampelPunkt('kein-format') + zahl(k.keinFormat) + ' nicht auslesbar' : '') +
    '</p>';

  if (!r.abgleichDurch) {
    s += '<p style="color:var(--warn,#b45309)"><strong>Achtung:</strong> Der ' +
         'Index-Abgleich ist noch nicht durch. Die ' + zahl(k.offen) + ' offenen ' +
         'Dateien können sich noch auf „lesbar" oder „kein Text" verteilen. ' +
         'Für belastbare Zahlen den Bericht später erneut öffnen.</p>';
  }
  if (k.sperrig) {
    s += '<p>' + zahl(k.sperrig) + ' Dateiname(n) sind für eine Sprachausgabe ' +
         'schwer verständlich (lange Ziffernketten, Kürzel, Versionszusätze). ' +
         'In der Liste mit <strong>⚑</strong> markiert – das ist ein Hinweis, ' +
         'kein Mangel.</p>';
  }
  return s;
}

function ampelPunkt(b) {
  return '<span aria-hidden="true" style="display:inline-block;width:9px;height:9px;' +
         'border-radius:50%;background:' + BEFUNDE[b].farbe + ';margin-right:5px"></span>';
}

function tabelle(zeilen, filter) {
  var sicht = zeilen.filter(function (z) {
    if (filter === 'alle')    return true;
    if (filter === 'problem') return z.befund === 'kein-text' || z.befund === 'duenn';
    return z.befund === filter;
  });

  if (!sicht.length) {
    return '<p style="padding:14px 0">Keine Dateien in dieser Auswahl.</p>';
  }

  var h = '<table><caption class="ip67-sr-only">Dokumente der Ablage mit ' +
          'Befund zur Lesbarkeit durch eine Sprachausgabe</caption><thead><tr>' +
          '<th scope="col">Datei</th><th scope="col">Ordner</th>' +
          '<th scope="col">Format</th><th scope="col">Seiten</th>' +
          '<th scope="col">Zeichen</th><th scope="col">Befund</th>' +
          '</tr></thead><tbody>';

  sicht.forEach(function (z) {
    var B = BEFUNDE[z.befund];
    h += '<tr>' +
      '<td>' + esc(z.titel) +
        (z.sperrig ? ' <span title="Name für Sprachausgabe schwer verständlich">⚑</span>' : '') +
      '</td>' +
      '<td style="color:var(--muted)">' + esc(z.ordner) + '</td>' +
      '<td>' + esc(z.ext) + '</td>' +
      '<td>' + (z.seiten != null ? zahl(z.seiten) : '—') + '</td>' +
      '<td>' + (z.zeichen ? zahl(z.zeichen) : '—') + '</td>' +
      '<td><span style="color:' + B.farbe + ';font-weight:600">' + esc(B.wort) + '</span>' +
        '<span style="color:var(--muted);display:block;font-size:12px">' + esc(z.grund) + '</span>' +
      '</td></tr>';
  });

  h += '</tbody></table>';
  h += '<p style="color:var(--muted);margin-top:10px">' + zahl(sicht.length) +
       ' von ' + zahl(zeilen.length) + ' Dateien angezeigt.</p>';
  return h;
}

function zeichneListe() {
  if (!_offen) return;
  var ziel = _offen.host.querySelector('#a11yListe');
  if (!ziel) return;
  ziel.innerHTML = tabelle(_offen.r.zeilen, _offen.filter);

  var stand = _offen.host.querySelector('#a11yStand');
  if (stand) {
    var n = ziel.querySelectorAll('tbody tr').length;
    stand.textContent = n + ' Dateien in der Auswahl.';
  }
  /* Knöpfe nachziehen, damit die Sprachausgabe den aktiven
     Filter ansagt statt ihn nur farblich zu zeigen. */
  var kn = _offen.host.querySelectorAll('[data-a11y-filter]');
  Array.prototype.forEach.call(kn, function (b) {
    var an = b.getAttribute('data-a11y-filter') === _offen.filter;
    b.setAttribute('aria-pressed', an ? 'true' : 'false');
  });
}

function csv(zeilen) {
  var kopf = ['Datei', 'Ordner', 'Format', 'Seiten', 'Zeichen',
              'Zeichen je Seite', 'Befund', 'Begruendung', 'Name sperrig'];
  function feld(v) {
    var s = (v == null) ? '' : String(v);
    return '"' + s.replace(/"/g, '""') + '"';
  }
  var out = [kopf.map(feld).join(';')];
  zeilen.forEach(function (z) {
    out.push([
      z.titel, z.ordner, z.ext,
      z.seiten != null ? z.seiten : '',
      z.zeichen || '',
      z.dichte != null ? Math.round(z.dichte) : '',
      BEFUNDE[z.befund].wort, z.grund,
      z.sperrig ? 'ja' : ''
    ].map(feld).join(';'));
  });
  /* BOM, damit Excel die Umlaute nicht zerlegt. */
  return '\ufeff' + out.join('\r\n');
}

function exportiere() {
  if (!_offen) return;
  var inhalt = csv(_offen.r.zeilen);
  var name = 'infopool67-lesbarkeit-' + new Date().toISOString().slice(0, 10) + '.csv';
  var hel = window.IP67 && window.IP67._adminHelpers;
  if (hel && hel.downloadFile) {
    hel.downloadFile(inhalt, name, 'text/csv;charset=utf-8');
  } else {
    var b = new Blob([inhalt], { type: 'text/csv;charset=utf-8' });
    var u = URL.createObjectURL(b);
    var a = document.createElement('a');
    a.href = u; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(u);
  }
  var I = Int();
  if (I && I.toast) I.toast('✓ Liste als CSV gespeichert');
}

function oeffne() {
  if (_offen) return;

  var r = pruefe();
  if (r.fehler) {
    var I0 = Int();
    if (I0 && I0.toast) I0.toast(r.fehler);
    else alert(r.fehler);
    return;
  }

  var host = document.createElement('div');
  host.className = 'ip67-modal show';
  host.id = 'a11yModal';
  host.innerHTML =
    '<div class="modal-card" role="dialog" aria-modal="true" ' +
         'aria-labelledby="a11yTitel" style="max-width:1000px;width:94vw">' +
      '<div class="modal-head">' +
        '<h3 id="a11yTitel">Lesbarkeit für Sprachausgabe</h3>' +
        '<button class="modal-x" id="a11yX" aria-label="Bericht schließen">×</button>' +
      '</div>' +
      '<div id="a11yKopf">' + kopfText(r) + balken(r.k) + '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 4px" ' +
           'role="group" aria-label="Anzeige einschränken">' +
        knopf('problem',     'Zu klären (' + (r.k.keinText + r.k.duenn) + ')') +
        knopf('kein-text',   'Kein Text (' + r.k.keinText + ')') +
        knopf('duenn',       'Wenig Text (' + r.k.duenn + ')') +
        knopf('lesbar',      'Lesbar (' + r.k.lesbar + ')') +
        (r.k.offen ? knopf('offen', 'Noch offen (' + r.k.offen + ')') : '') +
        (r.k.zuGross ? knopf('zu-gross', 'Nicht ausgelesen (' + r.k.zuGross + ')') : '') +
        (r.k.keinFormat ? knopf('kein-format', 'Nicht auslesbar (' + r.k.keinFormat + ')') : '') +
        knopf('alle',        'Alle (' + r.k.gesamt + ')') +
      '</div>' +
      '<p id="a11yStand" aria-live="polite" style="min-height:1em"></p>' +
      '<div id="a11yListe" style="max-height:52vh;overflow:auto"></div>' +
      '<div class="modal-actions">' +
        '<button class="btn btn-ghost" id="a11yCsv">Als CSV speichern</button>' +
        '<button class="btn btn-primary" id="a11yZu">Schließen</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(host);

  _offen = {
    host: host,
    r: r,
    filter: (r.k.keinText + r.k.duenn) > 0 ? 'problem' : 'alle',
    vorherFokus: document.activeElement
  };

  host.addEventListener('click', function (e) {
    var f = e.target.closest ? e.target.closest('[data-a11y-filter]') : null;
    if (f) { _offen.filter = f.getAttribute('data-a11y-filter'); zeichneListe(); return; }
    if (e.target.id === 'a11yX' || e.target.id === 'a11yZu') { schliesse(); return; }
    if (e.target.id === 'a11yCsv') { exportiere(); return; }
    if (e.target === host) { schliesse(); }
  });

  document.addEventListener('keydown', aufTaste, true);
  zeichneListe();

  /* Fokus in den Dialog holen – sonst bleibt er auf dem Knopf
     dahinter stehen und der Bericht wird nie angesagt. */
  var erst = host.querySelector('#a11yX');
  if (erst) erst.focus();
}

function knopf(wert, beschriftung) {
  return '<button type="button" class="set-btn" data-a11y-filter="' + wert +
         '" aria-pressed="false">' + esc(beschriftung) + '</button>';
}

/* ============================================================
   4. NUR-FÜR-SPRACHAUSGABE-KLASSE
   ------------------------------------------------------------
   Wird für die Tabellen-Beschriftung gebraucht. Als eigener
   Stilblock hier drin, damit die CSS-Datei unangetastet bleibt.
============================================================ */
(function stil() {
  if (document.getElementById('ip67-a11y-stil')) return;
  var s = document.createElement('style');
  s.id = 'ip67-a11y-stil';
  s.textContent =
    '.ip67-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;' +
    'overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}' +
    '#a11yModal .set-btn[aria-pressed="true"]{outline:2px solid var(--accent);' +
    'outline-offset:1px}';
  document.head.appendChild(s);
})();

/* ============================================================
   5. REGISTRIEREN
============================================================ */
if (!window.IP67) {
  console.error('[A11yCheck] IP67 nicht vorhanden – Modul wird übersprungen.');
  return;
}

window.IP67.openA11yCheck  = oeffne;
window.IP67.closeA11yCheck = schliesse;

/* Für Auswertungen ohne Oberfläche (Konsole, spätere Module):
   IP67.a11yPruefe() liefert die Rohdaten. */
window.IP67.a11yPruefe = pruefe;

console.info('[Info-Pool 67] a11ycheck.js ' + MODUL_VERSION + ' bereit');

})();
