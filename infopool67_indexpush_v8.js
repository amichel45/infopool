/* ================================================================
   Info-Pool 67 · infopool67_indexpush_v8.js   (Stand: Cache ?v=9.7)
   ----------------------------------------------------------------
   ZWECK
   Der Volltextindex liegt in der IndexedDB des jeweiligen Browsers.
   Wer neue Dokumente in die SharePoint-Ablage legt, macht sie damit
   zunaechst nur fuer SICH durchsuchbar. Zentral wirksam werden sie
   erst, wenn search-index.json im Infopool-Ordner erneuert wird.

   Bisher war das ein Export-Knopf tief im Volltextindex-Dialog, der
   eine Datei herunterlaedt, die man anschliessend von Hand wieder
   hochladen muss. Fuer Kolleginnen und Kollegen ohne IT-Hintergrund
   ist das keine Aufgabe, die im Alltag zuverlaessig passiert.

   DIESES MODUL macht daraus einen einzigen Klick:

     1) Es erkennt still im Hintergrund, ob es etwas zu tun gibt.
     2) Nur dann und nur bei SCHREIBBERECHTIGTEN erscheint unten ein
        ruhiger Hinweisstreifen in Alltagssprache.
     3) Ein Klick liest die fehlenden Dokumente aus (Fortschritts-
        balken mit Dateinamen) und legt search-index.json anschliessend
        selbsttaetig per REST im Infopool-Ordner ab.

   BEWUSST NICHT AUTOMATISCH BEIM ANMELDEN
   Ein Vorgang, der von allein losrennt, verunsichert und wird im
   Zweifel mitten im Lauf durch Schliessen des Tabs abgebrochen. Der
   Streifen fragt, er handelt nicht ungefragt. „Spaeter" gilt fuer die
   laufende Sitzung.

   KEIN SCHREIBEN OHNE RECHT
   Vor dem Anzeigen wird ueber /_api/web/effectiveBasePermissions
   geprueft, ob das Windows-Konto ueberhaupt schreiben darf. Ist das
   nicht der Fall oder laesst es sich nicht ermitteln, bleibt der
   Streifen aus - lieber gar kein Hinweis als einer, der ins Leere
   fuehrt. Schlaegt der Upload trotzdem fehl, faellt das Modul auf den
   Download zurueck und sagt klar, was zu tun ist.

   ZUSAMMENSPIEL
   - Der Abgleich selbst kommt unveraendert aus
     infopool67_indexsync_v8.js (analyse()). Diese Datei rechnet nichts
     nach, sie fuehrt nur aus und zeigt an.
   - IP67.exportIndex() wird uebernommen: der vorhandene Knopf
     „Index exportieren" legt die Datei jetzt ebenfalls direkt zentral
     ab, statt sie nur herunterzuladen. Details siehe Abschnitt 7.
   ================================================================ */
(function () {
  'use strict';

  var LOG = '[IndexPush]';

  var CFG = {
    /* Muss zum Cache-Bust in infopool67_v8.aspx passen.
       v10.4: stand bis hierher auf '9.7' und war damit seit sechs
       Fassungen falsch (I5). Lädt dieses Modul das Index-Modul zuerst
       nach – etwa weil jemand den Streifen anklickt, bevor die
       Hintergrund-Indizierung anläuft –, zog der Browser einen Stand
       von v9.7 aus dem Cache, während indexsync v10.3 anforderte. */
    moduleVersion: '10.5',
    /* v10.5 · Wie lange „Später" gilt (ms). Sieben Tage – lang genug,
       dass niemand bei jedem Öffnen gefragt wird, kurz genug, dass ein
       echter Rückstand nicht dauerhaft unbemerkt liegen bleibt.
       Kommen neue Dokumente hinzu, fragt der Info-Pool sofort wieder;
       maßgeblich ist der Rückstand, nicht die Zeit allein. */
    spaeterTage: 7,
    /* Wartezeit, bis der Abgleich aus indexsync vorliegt (ms). */
    pollEvery: 2000,
    pollMax: 15,
    /* Obergrenze fuer EINEN Durchlauf des Assistenten. Grosszuegiger
       als die Hintergrund-Drosselung: hier schaut jemand zu und hat
       den Vorgang bewusst gestartet. */
    maxPerRun: 200,
    /* Dateien oberhalb dieser Groesse werden uebersprungen. */
    maxBytes: 25 * 1024 * 1024,
    indexFile: 'search-index.json',
    /* v9.7 · Punkt 6: Nachprüfung, siehe Abschnitt 9b. Alle 15 Sekunden,
       höchstens 20 Runden – also rund fünf Minuten. Das deckt auch ein
       langsames Auslesen mehrerer Dokumente ab, ohne dauerhaft zu
       laufen. */
    nachEvery: 15000,
    nachMax: 20
  };

  var _busy = false;
  /* v9.7 · Punkt 6: „Später“ gilt nur für diesen Seitenaufruf.
     v10.5: zusätzlich eine Ruhezeit über Seitenaufrufe hinweg, siehe
     Abschnitt 1b. Diese Variable bleibt die Sperre für den laufenden
     Aufruf; die Ruhezeit ist davon unabhängig. */
  var _spaeter = false;
  /* Wird gesetzt, sobald der Streifen einmal sichtbar war – verhindert,
     dass die Nachprüfung ihn über einen laufenden Vorgang legt. */
  var _gezeigt = false;

  /* ================================================================
     1. HILFEN
     ================================================================ */
  function I() {
    return (window.IP67 && window.IP67._internal) ? window.IP67._internal : null;
  }
  function S() { return window.IP67Storage || null; }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function fileNameOf(href) {
    var parts = String(href || '').split(/[/\\]/);
    return parts[parts.length - 1] || '';
  }
  function extOf(href) {
    var s = String(href || '');
    var q = s.indexOf('?'); if (q >= 0) s = s.slice(0, q);
    var d = s.lastIndexOf('.');
    return d < 0 ? '' : s.slice(d + 1).toLowerCase();
  }
  function esc(s) {
    var Int = I();
    if (Int && Int.escHtml) return Int.escHtml(s);
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function toast(msg, ms) {
    var Int = I();
    if (Int && Int.toast) Int.toast(msg, ms);
    else console.info(LOG, msg);
  }

  /* ================================================================
     1b. v10.5 · RUHEZEIT NACH „SPÄTER"
     ----------------------------------------------------------------
     BEFUND: „Später" galt seit v9.7 nur für den laufenden
     Seitenaufruf. Das war die Antwort auf einen echten Fehler – ein
     sessionStorage-Eintrag hatte den Hinweis bei manchen Nutzenden
     auf unbestimmte Zeit und ohne jede Spur stillgelegt. Die Lösung
     ist aber zu weit ins andere Extrem gegangen: Wer schreiben darf
     und einen Rückstand hat, wird seitdem bei JEDEM Öffnen des
     Info-Pools erneut gefragt. Ein Hinweis, der immer kommt, wird
     nicht gelesen, sondern weggeklickt.

     ÄNDERUNG: „Später" hält jetzt CFG.spaeterTage Tage – aber nur für
     GENAU DEN Rückstand, der beim Klick vorlag. Kommt ein Dokument
     hinzu, ändert sich die Kennung und der Info-Pool fragt sofort
     wieder. Zeitablauf und Rückstandsänderung wirken unabhängig
     voneinander; es kann also nicht passieren, dass neue Dokumente
     eine Woche lang unbemerkt liegen bleiben.

     WAS BLEIBT: Der Grund für die Stille steht in der Konsole, mit
     Restlaufzeit und Kennung – die Unauffindbarkeit von damals darf
     sich nicht wiederholen. IP67IndexPush.wiederFragen() hebt die
     Ruhezeit von Hand auf.
     ================================================================ */
  var RUHE_KEY = 'ip67_push_spaeter';   // { bis:<ms>, stand:'<Kennung>' }

  /* Kennung des Rückstands: welche Dokumente, nicht wie viele. Sortiert,
     damit die Reihenfolge aus dem Abgleich keine Rolle spielt. */
  function rueckstandKennung(rs) {
    if (!rs) return '';
    var ids = [];
    (rs.luecken || []).forEach(function (f) { ids.push('L:' + (f && f.id)); });
    (rs.unpubliziert || []).forEach(function (id) { ids.push('U:' + id); });
    return ids.sort().join('|');
  }

  function ruheLesen() {
    try {
      var o = JSON.parse(localStorage.getItem(RUHE_KEY) || 'null');
      if (!o || typeof o.bis !== 'number') return null;
      if (Date.now() >= o.bis) { localStorage.removeItem(RUHE_KEY); return null; }
      return o;
    } catch (e) { return null; }
  }

  function ruheSetzen(kennung) {
    try {
      localStorage.setItem(RUHE_KEY, JSON.stringify({
        bis:   Date.now() + CFG.spaeterTage * 86400000,
        stand: kennung || ''
      }));
    } catch (e) {}
  }

  function ruheLoeschen() {
    try { localStorage.removeItem(RUHE_KEY); } catch (e) {}
  }

  /* ================================================================
     2. SCHREIBRECHT PRUEFEN
     ----------------------------------------------------------------
     SharePoint liefert eine 64-Bit-Maske in zwei Haelften als
     Zeichenketten. Das Recht „AddListItems" ist Bit 1 der unteren
     Haelfte (Wert 2). Bitweise Operatoren scheiden aus, weil Low
     groesser als 2^31 werden kann - daher Division statt Shift.
     ================================================================ */
  function findLow(obj, depth) {
    if (!obj || typeof obj !== 'object' || (depth || 0) > 4) return null;
    if (typeof obj.Low !== 'undefined') return obj.Low;
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      var hit = findLow(obj[k], (depth || 0) + 1);
      if (hit !== null) return hit;
    }
    return null;
  }

  function darfSchreiben() {
    var st = S();
    if (!st || !st.SP_SITE_URL) return Promise.resolve(false);
    return fetch(st.SP_SITE_URL + '/_api/web/effectiveBasePermissions', {
      credentials: 'include',
      headers: { 'Accept': 'application/json;odata=verbose' }
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var low = findLow(j, 0);
      if (low === null) return false;
      var n = Number(low);
      if (!isFinite(n)) return false;
      return Math.floor(n / 2) % 2 === 1;      // AddListItems
    }).catch(function (e) {
      console.info(LOG, 'Schreibrecht nicht ermittelbar –', e.message,
        '· der Hinweis bleibt aus.');
      return false;
    });
  }

  /* ================================================================
     3. WAS IST ZU TUN?
     ----------------------------------------------------------------
     Zwei verschiedene Rueckstaende, die der Streifen unterscheidet:

     luecken       Dokumente, die NIRGENDS durchsuchbar sind - weder
                   hier noch zentral. Muessen erst ausgelesen werden.
     unpubliziert  Dokumente, die auf DIESEM Rechner durchsuchbar sind,
                   in der zentralen search-index.json aber fehlen oder
                   dort anders aussehen. Muessen nur hochgeladen werden.

     Der zentrale Stand steht als window.searchIndexData bereit -
     storage_v8.js legt die geladene JSON dort ab. Ein zweiter Download
     der womoeglich mehrere Megabyte grossen Datei entfaellt dadurch.
     ================================================================ */
  function ermittleRueckstand() {
    var Int = I();
    if (!Int || !window.IP67IndexSync ||
        typeof window.IP67IndexSync.analyse !== 'function') return null;

    var plan = window.IP67IndexSync.analyse();
    if (!plan) return null;

    var lokal   = Int.getSearchIndex() || {};
    var zentral = (window.searchIndexData && typeof window.searchIndexData === 'object')
      ? window.searchIndexData : {};

    var unpubliziert = [];
    Object.keys(lokal).forEach(function (id) {
      var e = lokal[id];
      if (!e || e._isExternal) return;

      /* v10.4 · Auch die textlosen Vermerke gehoeren nach oben.
         Sonst bleibt das Wissen „aus dieser Datei ist nichts zu holen"
         auf dem einen Rechner liegen, der es erarbeitet hat – und jeder
         andere Browser im Amt laeuft dieselbe Schleife noch einmal
         durch: Datei herunterladen, scheitern, vergessen, wiederholen. */
      if (!e.text && !e._keinText) return;

      var z = zentral[id];
      if (!z) { unpubliziert.push(id); return; }
      if (e.text) {
        /* Fehlt zentral, oder der Text hat eine andere Laenge -> der
           zentrale Stand ist nicht der hiesige. */
        if (!z.text || z.size !== e.size) unpubliziert.push(id);
      } else if (!z._keinText) {
        unpubliziert.push(id);
      }
    });

    return {
      luecken: plan.missing.concat(plan.stale),
      unpubliziert: unpubliziert,
      guard: plan.guard
    };
  }

  /* ================================================================
     4. INDEX-MODUL SICHERSTELLEN
     ================================================================ */
  function ensureIndexModule() {
    if (window.IP67 && typeof window.IP67._indexFileForId === 'function') {
      return Promise.resolve(true);
    }
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = 'infopool67_index_v8.js?v=' + CFG.moduleVersion;
      s.async = false;
      s.charset = 'UTF-8';
      s.onload  = function () { resolve(typeof window.IP67._indexFileForId === 'function'); };
      s.onerror = function () { resolve(false); };
      document.head.appendChild(s);
    });
  }

  /* ================================================================
     5. DATEI HOLEN UND AUSLESEN
     ================================================================ */
  function fetchAsFile(href) {
    var name = fileNameOf(href);
    return fetch(encodeURI(href), { credentials: 'include' }).then(function (resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp.blob();
    }).then(function (blob) {
      if (blob.size > CFG.maxBytes) throw new Error('Datei zu groß');
      try { return new File([blob], name, { type: blob.type }); }
      catch (e) { blob.name = name; return blob; }
    });
  }

  /* Dateizustand am Eintrag vermerken. Ohne diese Angaben haelt der
     naechste Abgleich ein blosses Umbenennen faelschlich fuer eine
     Inhaltsaenderung (siehe Kopf von infopool67_indexsync_v8.js). */
  function stampSource(f) {
    var Int = I();
    if (!Int) return Promise.resolve();
    var e = Int.getSearchIndex()[f.id];
    if (!e) return Promise.resolve();
    e._href = f.href;
    e._uid  = f.uid || null;
    if (typeof f.size === 'number') e._srcSize = f.size;
    if (f.modified) e._srcModified = f.modified;
    return Promise.resolve(Int.saveIndexEntry(f.id, e)).catch(function () {});
  }

  /* v10.5 · Bytes als gerundete Megabyte, für lesbare Meldungen. */
  function mb(bytes) {
    return Math.round((Number(bytes) || 0) / (1024 * 1024));
  }

  /* v10.5 · Vermerk „über der Größengrenze“ anlegen. Feldnamen und
     Bedeutung entsprechen genau markiereZuGross() in
     infopool67_indexsync_v8.js (v10.4) – der Befund „zu-gross“ ist im
     Lesbarkeitsbericht ein eigener Zustand und wird im Reiter
     „Dokumente ohne Indexsuche“ als solcher ausgewiesen. Der Eintrag
     trägt bewusst keinen Text; buildPayload() nimmt ihn trotzdem mit
     nach oben, damit das Ergebnis amtsweit einmal gilt. */
  function vermerkeZuGross(f) {
    var Int = I();
    if (!Int) return Promise.resolve();
    var e = Int.getSearchIndex()[f.id];
    e = e ? e : {};
    e.text      = '';
    e.size      = 0;
    e.fileName  = e.fileName || fileNameOf(f.href);
    e.format    = e.format   || extOf(f.href);
    e.indexedAt = e.indexedAt || new Date().toISOString().slice(0, 10);
    e._keinText      = 'zu-gross';
    e._keinTextGrund = 'Datei über ' + mb(CFG.maxBytes) + ' MB' +
                       (typeof f.size === 'number' ? ' (' + mb(f.size) + ' MB)' : '') +
                       ' – wird nicht automatisch ausgelesen';
    e._versuchtAm    = new Date().toISOString().slice(0, 10);
    e._href = f.href;
    if (f.uid) e._uid = f.uid;
    if (typeof f.size === 'number') e._srcSize = f.size;
    if (f.modified) e._srcModified = f.modified;
    return Promise.resolve(Int.saveIndexEntry(f.id, e)).catch(function () {});
  }

  /* ================================================================
     6. NUTZLAST FUER search-index.json
     ----------------------------------------------------------------
     Personendatensaetze (_isExternal) bleiben draussen: sie stammen
     aus der Mitarbeiterliste und werden bei jedem Start ohnehin von
     dort gelesen. Im Index waeren sie ein zweiter, divergierender
     Bestand.

     WICHTIG gegenueber dem frueheren Export: _srcSize/_srcModified
     wandern MIT. Fehlen sie zentral, faellt jeder frisch geladene
     Browser beim Abgleich auf den Datumsvergleich zurueck - und liest
     nach jeder Umbenennung alles neu aus. Genau das soll nicht sein.
     ================================================================ */
  function buildPayload() {
    var Int = I();
    var idx = Int.getSearchIndex();
    var out = {}, n = 0, personen = 0;

    Object.keys(idx).forEach(function (id) {
      var e = idx[id];
      if (!e) return;
      if (e._isExternal) { personen++; return; }

      /* v10.4 · Textlose Vermerke wandern mit, siehe ermittleRueckstand().
         Sie sind winzig (kein Text, nur Begruendung und Bytegroesse) und
         ersparen jedem weiteren Browser den vergeblichen Versuch. */
      if (!e.text && !e._keinText) return;
      if (!e.text) {
        var v = {
          text:      '',
          indexedAt: e.indexedAt || '',
          size:      0,
          fileName:  e.fileName || '',
          format:    e.format || '',
          _keinText:      e._keinText,
          _keinTextGrund: e._keinTextGrund || ''
        };
        if (e._versuchtAm) v._versuchtAm = e._versuchtAm;
        if (typeof e._srcSize === 'number') v._srcSize = e._srcSize;
        if (e._srcModified) v._srcModified = e._srcModified;
        if (e._uid)  v._uid  = e._uid;
        if (e._href) v._href = e._href;
        out[id] = v;
        n++;
        return;
      }

      var o = {
        text:      e.text,
        indexedAt: e.indexedAt,
        size:      e.size,
        fileName:  e.fileName || '',
        format:    e.format || ''
      };
      if (Array.isArray(e.pageBreaks))       o.pageBreaks  = e.pageBreaks;
      if (typeof e.totalPages  === 'number') o.totalPages  = e.totalPages;
      if (typeof e.totalTokens === 'number') o.totalTokens = e.totalTokens;
      if (e.topTerms && typeof e.topTerms === 'object') o.topTerms = e.topTerms;
      /* Bezugspunkt fuer die Veraltet-Erkennung. */
      if (typeof e._srcSize === 'number') o._srcSize = e._srcSize;
      if (e._srcModified) o._srcModified = e._srcModified;
      if (e._uid)  o._uid  = e._uid;
      if (e._href) o._href = e._href;
      out[id] = o;
      n++;
    });

    return { json: JSON.stringify(out), anzahl: n, personen: personen };
  }

  function ladeHerunter(body) {
    try {
      var blob = new Blob([body], { type: 'application/json;charset=utf-8' });
      var url  = URL.createObjectURL(blob);
      var a    = document.createElement('a');
      a.href = url; a.download = CFG.indexFile;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    } catch (e) { return false; }
  }

  /* Zentral ablegen. Rueckgabe: 'upload' | 'download' | 'fehler' */
  function veroeffentliche() {
    var st = S();
    var p  = buildPayload();
    if (p.anzahl === 0) return Promise.resolve({ weg: 'fehler', grund: 'Keine Dokumenteinträge vorhanden.' });

    if (!st || typeof st.spUploadFile !== 'function') {
      return Promise.resolve({
        weg: ladeHerunter(p.json) ? 'download' : 'fehler',
        grund: 'Speicher-Modul nicht verfügbar.', anzahl: p.anzahl
      });
    }

    return st.spUploadFile(st.SP_FOLDER, CFG.indexFile, p.json).then(function () {
      /* Der eigene Stand ist jetzt der zentrale - kuenftige Vergleiche
         sollen keinen Rueckstand mehr melden. */
      try { window.searchIndexData = JSON.parse(p.json); } catch (e) {}
      return { weg: 'upload', anzahl: p.anzahl };
    }).catch(function (e) {
      console.warn(LOG, 'Upload fehlgeschlagen:', e.message);
      return {
        weg: ladeHerunter(p.json) ? 'download' : 'fehler',
        grund: e.message, anzahl: p.anzahl
      };
    });
  }

  /* ================================================================
     7. OBERFLAECHE
     ================================================================ */
  function styles() {
    if (document.getElementById('ip67PushStyle')) return;
    var s = document.createElement('style');
    s.id = 'ip67PushStyle';
    s.textContent = [
      '#ip67Push{position:fixed;left:50%;bottom:22px;transform:translate(-50%,14px);',
      'z-index:96;max-width:min(680px,calc(100vw - 32px));background:var(--card,#fff);',
      'border:1px solid var(--line,#e7e7ea);border-radius:var(--radius,16px);',
      'box-shadow:var(--shadow-lg,0 12px 40px rgba(0,0,0,.12));padding:14px 16px;',
      'display:flex;gap:14px;align-items:center;flex-wrap:wrap;opacity:0;visibility:hidden;',
      'transition:opacity .25s var(--ease,ease),transform .25s var(--ease,ease);',
      'font-family:"Segoe UI",Arial,sans-serif;color:var(--ink,#1a1a1a)}',
      '#ip67Push.show{opacity:1;visibility:visible;transform:translate(-50%,0)}',
      '#ip67Push .pu-ico{font-size:1.5rem;line-height:1;flex:0 0 auto}',
      '#ip67Push .pu-txt{flex:1 1 260px;min-width:220px}',
      '#ip67Push .pu-h{font-weight:600;font-size:.92rem}',
      '#ip67Push .pu-s{font-size:.78rem;color:var(--muted,#666);margin-top:3px;line-height:1.45}',
      '#ip67Push .pu-act{display:flex;gap:8px;flex:0 0 auto}',
      '#ip67Push button{font:inherit;font-size:.82rem;border-radius:var(--radius-sm,12px);',
      'padding:9px 15px;cursor:pointer;border:1px solid var(--line,#e7e7ea);background:transparent;',
      'color:var(--muted,#666)}',
      '#ip67Push button.prim{background:var(--accent,#2f6f5f);border-color:var(--accent,#2f6f5f);color:#fff;font-weight:600}',
      '#ip67Push button:disabled{opacity:.5;cursor:default}',
      '#ip67Push .pu-bar{flex:1 1 100%;height:6px;border-radius:3px;background:var(--skeleton,#ececef);overflow:hidden;display:none}',
      '#ip67Push.run .pu-bar{display:block}',
      '#ip67Push .pu-bar>i{display:block;height:100%;width:0;background:var(--accent,#2f6f5f);',
      'transition:width .3s var(--ease,ease)}',
      '@media (max-width:600px){#ip67Push{left:12px;right:12px;transform:none;max-width:none}',
      '#ip67Push.show{transform:none}#ip67Push .pu-act{flex:1 1 100%}',
      '#ip67Push .pu-act button{flex:1}}'
    ].join('');
    document.head.appendChild(s);
  }

  function el() { return document.getElementById('ip67Push'); }

  function zeige(kopf, unter, knopf, aktion) {
    styles();
    var d = el();
    if (!d) {
      d = document.createElement('div');
      d.id = 'ip67Push';
      d.setAttribute('role', 'status');
      document.body.appendChild(d);
    }
    d.className = '';
    d.innerHTML =
      '<span class="pu-ico" aria-hidden="true">📄</span>' +
      '<div class="pu-txt"><div class="pu-h">' + esc(kopf) + '</div>' +
      '<div class="pu-s">' + esc(unter) + '</div></div>' +
      '<div class="pu-act">' +
      '<button type="button" class="prim" id="ip67PushGo">' + esc(knopf) + '</button>' +
      '<button type="button" id="ip67PushLater">Später</button></div>' +
      '<div class="pu-bar"><i></i></div>';

    document.getElementById('ip67PushGo').addEventListener('click', aktion);
    document.getElementById('ip67PushLater').addEventListener('click', function () {
      /* v9.7 · Punkt 6: Hier stand `sessionStorage`. Das war der Grund,
         warum der Streifen bei manchen Nutzenden nie wieder erschien:
         sessionStorage ueberlebt jedes Neuladen der Seite und sogar das
         Wiederherstellen der Registerkarte. Ein einziges „Spaeter“ hat
         den Hinweis damit auf unbestimmte Zeit stillgelegt - ohne jede
         Meldung in der Konsole, also unauffindbar.
         Jetzt gilt „Spaeter“ genau so lange, wie die Seite offen ist.
         Nach dem naechsten Neuladen fragt der Info-Pool wieder.

         v10.5: Das war zu streng – bei jedem Öffnen erneut gefragt zu
         werden, stört im Alltag ebenso. „Später“ hält deshalb wieder
         über den Seitenaufruf hinaus, aber befristet, an den konkreten
         Rückstand gebunden und mit nachlesbarer Begründung in der
         Konsole. Siehe Abschnitt 1b. */
      _spaeter = true;
      var kn = rueckstandKennung(ermittleRueckstand());
      ruheSetzen(kn);
      console.info(LOG, '„Später“ gewählt – der Hinweis bleibt für ' +
        CFG.spaeterTage + ' Tage aus, solange kein weiteres Dokument hinzukommt. ' +
        'Von Hand aufheben mit IP67IndexPush.wiederFragen()');
      verstecke();
    });
    requestAnimationFrame(function () { d.classList.add('show'); });
    _gezeigt = true;
  }

  function verstecke() {
    var d = el();
    if (!d) return;
    d.classList.remove('show');
    setTimeout(function () { if (d && d.parentNode) d.parentNode.removeChild(d); }, 300);
  }

  function fortschritt(kopf, unter, anteil) {
    var d = el();
    if (!d) return;
    d.classList.add('run');
    var h = d.querySelector('.pu-h'), s = d.querySelector('.pu-s'),
        b = d.querySelector('.pu-bar>i'), go = document.getElementById('ip67PushGo'),
        la = document.getElementById('ip67PushLater');
    if (h) h.textContent = kopf;
    if (s) s.textContent = unter;
    if (b) b.style.width = Math.round(Math.max(0, Math.min(1, anteil)) * 100) + '%';
    if (go) { go.disabled = true; go.textContent = 'Läuft …'; }
    if (la) la.disabled = true;
  }

  function fertig(kopf, unter) {
    var d = el();
    if (!d) return;
    d.classList.remove('run');
    d.innerHTML =
      '<span class="pu-ico" aria-hidden="true">✅</span>' +
      '<div class="pu-txt"><div class="pu-h">' + esc(kopf) + '</div>' +
      '<div class="pu-s">' + esc(unter) + '</div></div>' +
      '<div class="pu-act"><button type="button" id="ip67PushClose">Schließen</button></div>';
    document.getElementById('ip67PushClose').addEventListener('click', verstecke);
    setTimeout(verstecke, 12000);
  }

  /* ================================================================
     8. DER EIGENTLICHE DURCHLAUF
     ================================================================ */
  function lauf() {
    if (_busy) return;
    _busy = true;

    var rs = ermittleRueckstand();
    var luecken = (rs && rs.luecken) ? rs.luecken.slice(0, CFG.maxPerRun) : [];

    fortschritt('Einen Moment …', 'Vorbereitung läuft.', 0.02);

    var vorbereitung = luecken.length ? ensureIndexModule() : Promise.resolve(true);

    vorbereitung.then(function (ok) {
      if (!luecken.length) return { gelesen: 0, misslungen: 0 };
      if (!ok) {
        return { gelesen: 0, misslungen: luecken.length,
                 hinweis: 'Das Auslese-Modul konnte nicht geladen werden.' };
      }
      /* Einmalig pruefen, ob die Extraktionsbibliothek erreichbar ist. */
      return window.IP67._probeExtractor(extOf(luecken[0].href)).then(function (kann) {
        if (!kann) {
          return { gelesen: 0, misslungen: luecken.length,
                   hinweis: 'Die Software zum Auslesen von PDF- und Word-Dateien ist ' +
                            'aus dem Stadtnetz gerade nicht erreichbar.' };
        }
        return leseAlle(luecken);
      });
    }).then(function (erg) {
      fortschritt('Wird bereitgestellt …',
        'Der Suchbestand wird in SharePoint abgelegt.', 0.95);
      return veroeffentliche().then(function (v) { return { erg: erg, v: v }; });
    }).then(function (r) {
      _busy = false;
      var erg = r.erg, v = r.v;

      if (v.weg === 'upload') {
        var t = 'Alle Dokumente sind jetzt für alle auffindbar.';
        if (erg.gelesen)    t = erg.gelesen + ' Dokument(e) aufgenommen. ' + t;
        /* v10.4 · Die alte Formulierung („ließen sich nicht lesen")
           klang nach einem Fehler, der beim nächsten Versuch vielleicht
           ausbleibt – und weil bis v10.3 tatsächlich bei jedem
           Seitenaufruf erneut versucht wurde, kam sie auch jedes Mal
           wieder. Jetzt sagt sie, woran es liegt und wo die Dokumente
           künftig zu finden sind. */
        if (erg.misslungen) t += ' ' + erg.misslungen + ' Datei(en) ließen sich nicht ' +
          'aufnehmen' +
          (erg.hinweis ? ': ' + erg.hinweis
                       : ' – meist Scans ohne Texterkennung oder Dateien über ' +
                         mb(CFG.maxBytes) + ' MB. Sie sind weiterhin über ' +
                         'den Titel auffindbar und stehen im Reiter „Dokumente ohne ' +
                         'Indexsuche". Ein erneuter Versuch erfolgt nicht.');
        /* v10.5: Der Rückstand ist abgearbeitet – eine noch laufende
           Ruhezeit aus einem früheren „Später" hat sich damit erledigt. */
        ruheLoeschen();
        fertig('Fertig', t);
      } else if (v.weg === 'download') {
        fertig('Fast fertig – ein Schritt von Hand',
          'Das Ablegen in SharePoint war nicht möglich, die Datei „' + CFG.indexFile +
          '" wurde stattdessen heruntergeladen. Bitte legen Sie sie in den Infopool-Ordner. ' +
          '(Grund: ' + (v.grund || 'unbekannt') + ')');
      } else {
        fertig('Das hat leider nicht geklappt',
          v.grund || 'Bitte wenden Sie sich an die Betreuung des Info-Pools.');
      }
    }).catch(function (e) {
      _busy = false;
      console.error(LOG, e);
      fertig('Das hat leider nicht geklappt', e.message || String(e));
    });
  }

  function leseAlle(liste) {
    var Int = I();
    var gelesen = 0, misslungen = 0, i = 0;

    function schritt() {
      if (i >= liste.length) {
        return Promise.resolve({ gelesen: gelesen, misslungen: misslungen });
      }
      var f = liste[i++];
      fortschritt(
        'Dokumente werden aufgenommen …',
        'Datei ' + i + ' von ' + liste.length + ': ' + fileNameOf(f.href),
        (i - 1) / liste.length * 0.9
      );

      /* Kann inzwischen vom Hintergrundlauf erledigt worden sein. */
      var vorhanden = Int.getSearchIndex()[f.id];
      if (vorhanden && vorhanden.text) return sleep(0).then(schritt);

      /* v10.5 · Dateien über der Größengrenze GAR NICHT erst holen.
         Bis v10.4 lud fetchAsFile() die Datei vollständig herunter und
         warf danach „Datei zu groß“ – der Fehler landete im .catch,
         ohne einen Vermerk zu hinterlassen. Die Datei blieb damit im
         Rückstand und wurde beim nächsten Öffnen erneut angeboten,
         inklusive des vergeblichen Downloads von über 25 MB. Jetzt
         wird der Grund einmal vermerkt und mitveröffentlicht, damit
         niemand im Amt noch einmal danach gefragt wird. */
      if (typeof f.size === 'number' && f.size > CFG.maxBytes) {
        misslungen++;
        console.info(LOG, '⊘ über der Größengrenze:', f.title,
          '(' + mb(f.size) + ' MB) · wird künftig übersprungen.');
        return vermerkeZuGross(f).then(function () { return sleep(0); }).then(schritt);
      }

      return fetchAsFile(f.href)
        .then(function (file) { return window.IP67._indexFileForId(file, f.id); })
        .then(function (ok) {
          if (ok) { gelesen++; return stampSource(f); }
          /* v10.4 · Auch hier den Vermerk mit Pfad und Bytegroesse
             versehen, den infopool67_index_v8.js gerade angelegt hat.
             Ohne diesen Bezugspunkt wuerde der naechste Abgleich die
             Datei erneut in die Warteschlange stellen. */
          misslungen++;
          console.info(LOG, '⊘ kein Text gewinnbar:', f.title,
            '· wird kuenftig uebersprungen.');
          return stampSource(f);
        })
        .catch(function (e) {
          misslungen++;
          /* v10.5 · Meldet SharePoint keine Dateigröße, fällt die
             Vorprüfung oben aus und die Grenze schlägt erst nach dem
             vollständigen Download zu. Auch dann muss ein Vermerk
             bleiben – sonst steht die Datei beim nächsten Öffnen
             wieder im Rückstand und wird erneut geholt. */
          if (/zu gro/i.test(e.message || '')) {
            console.info(LOG, '⊘ über der Größengrenze:', f.title,
              '· wird künftig übersprungen.');
            return vermerkeZuGross(f);
          }
          console.warn(LOG, '✗', f.title, '–', e.message);
        })
        .then(function () { return sleep(120); })
        .then(schritt);
    }
    return schritt();
  }

  /* ================================================================
     9. ENTSCHEIDEN, OB DER STREIFEN ERSCHEINT
     ================================================================ */
  function pruefe(versuch) {
    /* Defensiv: indexsync kann fehlen oder – bei falsch gesetztem
       Cache-Bust – in einem aelteren Stand ohne getState()/analyse()
       aus dem Browsercache kommen. Ein TypeError hier wuerde den
       gesamten Hinweis lautlos verschlucken. */
    var IS = window.IP67IndexSync;
    if (!IS || typeof IS.getState !== 'function' || typeof IS.analyse !== 'function') {
      if ((versuch || 0) >= CFG.pollMax) {
        console.warn(LOG, 'infopool67_indexsync_v8.js fehlt oder ist veraltet – kein Hinweis.');
        return;
      }
      setTimeout(function () { pruefe((versuch || 0) + 1); }, CFG.pollEvery);
      return;
    }

    var sy = IS.getState();
    if (!sy || !sy.ran || sy.laeuft) {
      if ((versuch || 0) >= CFG.pollMax) {
        console.info(LOG, 'Abgleich war nach', CFG.pollMax * CFG.pollEvery / 1000,
          'Sekunden noch nicht fertig – die Nachprüfung übernimmt.');
        return;
      }
      setTimeout(function () { pruefe((versuch || 0) + 1); }, CFG.pollEvery);
      return;
    }

    if (_spaeter) {
      console.info(LOG, 'Hinweis unterdrückt: „Später“ wurde in diesem Seitenaufruf gewählt.');
      return;
    }
    if (_busy || _gezeigt) return;   // läuft bereits oder steht schon da

    var rs = ermittleRueckstand();
    if (!rs) {
      console.info(LOG, 'Kein Hinweis: Rückstand nicht ermittelbar ' +
        '(Core-Schnittstelle oder Abgleich fehlt).');
      return;
    }

    /* Bei ausgesetztem Aufraeumen ist der Befund unzuverlaessig -
       dann waere ein zentrales Schreiben womoeglich schaedlich. */
    if (rs.guard) {
      console.warn(LOG, 'Kein Hinweis: Abgleich war nicht schluessig (' + rs.guard + ').');
      return;
    }

    var nLuecken = rs.luecken.length;
    var nUnpub   = rs.unpubliziert.length;
    if (!nLuecken && !nUnpub) {
      console.info(LOG, 'Nichts zu tun – der zentrale Suchbestand ist aktuell.');
      /* Kein Rückstand mehr: die Ruhezeit hat sich erledigt. */
      ruheLoeschen();
      return;
    }

    /* v10.5 · Ruhezeit prüfen – aber nur für denselben Rückstand. */
    var kennung = rueckstandKennung(rs);
    var ruhe = ruheLesen();
    if (ruhe && ruhe.stand === kennung) {
      console.info(LOG, 'Hinweis unterdrückt: „Später“ gilt noch ' +
        Math.ceil((ruhe.bis - Date.now()) / 86400000) + ' Tag(e) für diesen ' +
        'Rückstand (' + nLuecken + ' ohne Index, ' + nUnpub + ' nicht bereitgestellt). ' +
        'Von Hand aufheben mit IP67IndexPush.wiederFragen()');
      return;
    }
    if (ruhe) {
      console.info(LOG, 'Der Rückstand hat sich seit „Später“ geändert – ' +
        'der Hinweis kommt wieder.');
      ruheLoeschen();
    }

    darfSchreiben().then(function (darf) {
      if (!darf) {
        console.info(LOG, 'Rückstand vorhanden (' + nLuecken + ' Lücken, ' + nUnpub +
          ' unveröffentlicht), aber dieses Konto darf im Infopool-Ordner nicht schreiben.');
        return;
      }
      if (nLuecken > 0) {
        zeige(
          nLuecken === 1 ? 'Ein Dokument ist noch nicht durchsuchbar.'
                         : nLuecken + ' Dokumente sind noch nicht durchsuchbar.',
          'Der Info-Pool kann sie aufnehmen, damit alle im Amt sie über die Suche finden. ' +
          'Das dauert etwa ' + Math.max(1, Math.round(nLuecken * 4 / 60)) +
          ' Minute(n). Bitte lassen Sie das Fenster so lange geöffnet.',
          'Jetzt aufnehmen', lauf
        );
      } else {
        zeige(
          nUnpub === 1 ? 'Ein Dokument ist erst auf diesem Rechner durchsuchbar.'
                       : nUnpub + ' Dokumente sind erst auf diesem Rechner durchsuchbar.',
          'Mit einem Klick werden sie für alle im Amt auffindbar. Das dauert nur einen Moment.',
          'Für alle bereitstellen', lauf
        );
      }
    });
  }

  /* ================================================================
     9b. v9.7 · Punkt 6 · NACHPRUEFUNG
     ----------------------------------------------------------------
     Warum eine einmalige Pruefung nicht genuegt:
     infopool67_indexsync_v8.js setzt `ran` sofort, beginnt mit dem
     Auslesen der fehlenden Dokumente aber erst nach einer Anlaufzeit
     von vier Sekunden. Zwischen beidem liegt ein Fenster, in dem
     `ran === true` und `laeuft === false` gilt, obwohl noch gar nichts
     geschehen ist. Faellt die einzige Pruefung in dieses Fenster,
     entscheidet sie auf einem Zwischenstand - und danach fragt niemand
     mehr nach, obwohl das Dokument inzwischen ausgelesen wurde und nur
     noch bereitgestellt werden muesste. Genau dieser Fall wurde
     beobachtet: der Streifen blieb aus, obwohl ein frisches Dokument
     vorlag.
     Die Nachpruefung schaut deshalb ueber einige Minuten in Ruhe
     nach - und hoert auf, sobald es entweder nichts mehr zu tun gibt
     oder der Streifen steht.
     ================================================================ */
  function nachpruefen(runde) {
    runde = runde || 0;
    if (runde > CFG.nachMax) {
      console.info(LOG, 'Nachprüfung beendet – kein offener Rückstand mehr festgestellt.');
      return;
    }
    if (_gezeigt || _busy || _spaeter) return;

    var IS = window.IP67IndexSync;
    var sy = (IS && typeof IS.getState === 'function') ? IS.getState() : null;
    /* Solange ausgelesen wird, in Ruhe abwarten. */
    if (sy && sy.laeuft) { setTimeout(function () { nachpruefen(runde + 1); }, CFG.nachEvery); return; }

    var rs = (sy && sy.ran) ? ermittleRueckstand() : null;
    if (rs && !rs.guard && (rs.luecken.length || rs.unpubliziert.length)) {
      console.info(LOG, 'Nachprüfung: Rückstand gefunden (' + rs.luecken.length +
        ' ohne Index, ' + rs.unpubliziert.length + ' nicht bereitgestellt).');
      pruefe(0);
      return;
    }
    setTimeout(function () { nachpruefen(runde + 1); }, CFG.nachEvery);
  }

  /* ================================================================
     10. KNOPF „INDEX EXPORTIEREN“ UEBERNEHMEN
     ----------------------------------------------------------------
     Der vorhandene Knopf im Volltextindex-Dialog lud die Datei nur
     herunter; das anschliessende Hochladen von Hand blieb Aufgabe der
     Nutzerin. Er legt sie jetzt direkt zentral ab.

     Warum defineProperty statt einfacher Zuweisung: infopool67_index_v8.js
     wird spaeter nachgeladen und setzt in seinem Abschluss alle eigenen
     Funktionen erneut auf window.IP67 - eine schlichte Zuweisung waere
     danach wieder ueberschrieben (Frozen-Reference-Muster, vgl. A15).
     Der Setter nimmt die Zuweisung entgegen und verwirft sie still;
     ohne Setter wuerde das Modul im strict mode mit TypeError abbrechen.
     ================================================================ */
  function exportIndexZentral(silent) {
    return veroeffentliche().then(function (v) {
      if (silent) return;
      if (v.weg === 'upload') {
        toast('✓ ' + v.anzahl + ' Dokumente bereitgestellt – für alle im Amt auffindbar', 4000);
      } else if (v.weg === 'download') {
        toast('Ablegen in SharePoint nicht möglich – Datei heruntergeladen, bitte in den Infopool-Ordner legen', 6000);
      } else {
        toast('Bereitstellen fehlgeschlagen: ' + (v.grund || 'unbekannt'), 5000);
      }
    });
  }

  function uebernimmExport() {
    if (!window.IP67) return;
    try {
      Object.defineProperty(window.IP67, 'exportIndex', {
        configurable: true,
        get: function () { return exportIndexZentral; },
        set: function () { /* Zuweisung aus index_v8.js bewusst verwerfen */ }
      });
    } catch (e) {
      window.IP67.exportIndex = exportIndexZentral;
    }
  }

  /* Der Dialogtext von infopool67_index_v8.js beschreibt noch das alte
     Verfahren („Datei in den Infopool-Ordner legen"). Da der Knopf jetzt
     direkt zentral ablegt, waere das eine Anleitung zu einem Schritt,
     den niemand mehr ausfuehren muss - fuer fachfremde Admins die
     sicherste Art, Verwirrung zu stiften. Die Beschriftung wird daher
     nach dem Rendern des Dialogs korrigiert. */
  function korrigiereBeschriftung() {
    var box = document.querySelector('#indexModalBody .index-publish');
    if (!box) return;
    var t = box.querySelector('.ip-text');
    if (t) {
      t.innerHTML =
        '<strong>Für alle bereitstellen</strong>' +
        '<div class="idz-sub">Legt den Suchbestand in SharePoint ab. Danach finden ' +
        'alle im Amt die Dokumente über die Suche – ohne dass jemand selbst indizieren muss.</div>';
    }
    var b = box.querySelector('button');
    if (b) b.textContent = 'Für alle bereitstellen';
  }

  var _realOpen = null;
  function uebernimmDialog() {
    if (!window.IP67) return;
    _realOpen = window.IP67.openIndexModal;
    try {
      Object.defineProperty(window.IP67, 'openIndexModal', {
        configurable: true,
        get: function () {
          return function () {
            var r = _realOpen ? _realOpen.apply(null, arguments) : undefined;
            /* Der Dialog rendert teils erst nach dem Nachladen des
               Moduls – mehrfach nachfassen statt einmal zu raten. */
            setTimeout(korrigiereBeschriftung, 0);
            setTimeout(korrigiereBeschriftung, 400);
            setTimeout(korrigiereBeschriftung, 1200);
            return r;
          };
        },
        set: function (v) { _realOpen = v; }
      });
    } catch (e) { /* Beschriftung bleibt dann beim alten Text. */ }
  }

  /* ================================================================
     11. START
     ================================================================ */
  function boot() {
    if (!window.IP67 || !window.IP67._internal) {
      console.warn(LOG, 'Core nicht geladen – Modul wird übersprungen.');
      return;
    }
    uebernimmExport();
    uebernimmDialog();

    window.IP67IndexPush = {
      /* Von Hand anstossen, z. B. aus den Einstellungen. */
      jetzt: lauf,
      veroeffentliche: exportIndexZentral,
      rueckstand: ermittleRueckstand,
      /* v9.7: Von Hand nachprüfen – hilfreich zur Fehlersuche in der Konsole:
         IP67IndexPush.pruefeJetzt() */
      pruefeJetzt: function () { _spaeter = false; _gezeigt = false; pruefe(0); },
      /* v10.5: Ruhezeit aus „Später" aufheben und sofort neu prüfen. */
      wiederFragen: function () {
        ruheLoeschen(); _spaeter = false; _gezeigt = false; pruefe(0);
      },
      darfSchreiben: darfSchreiben,
      CFG: CFG
    };

    var dom = (document.readyState !== 'loading')
      ? Promise.resolve()
      : new Promise(function (r) { document.addEventListener('DOMContentLoaded', r); });
    dom.then(function () {
      pruefe(0);
      /* Und danach in Ruhe nachfassen (Abschnitt 9b). */
      setTimeout(function () { nachpruefen(0); }, CFG.nachEvery);
    });
  }

  boot();
  console.info('[Info-Pool 67] indexpush.js bereit');
})();
