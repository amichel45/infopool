/* ================================================================
   Info-Pool 67 · infopool67_indexsync_v8.js   (Stand: Cache ?v=9.7)
   ----------------------------------------------------------------
   ZWECK
   Hält den Volltextindex automatisch mit der SharePoint-Ablage
   synchron, ohne dass jemand manuell nachpflegen muss.

   DREISTUFIGES VORGEHEN
   1) UMHÄNGEN  – kostenlos, NEU in ?v=9.3.
      Ein Dokument, das umbenannt oder verschoben wurde, ist kein
      neues Dokument. Sein vorhandener Indexeintrag wird auf die neue
      Knoten-ID übertragen, statt gelöscht und neu ausgelesen zu
      werden. Zwei Wege, in dieser Reihenfolge:
        a) `legacyId` – exakt. Der LiveTree liefert zu jeder Datei
           zusätzlich die ID, die sie nach dem alten Pfadverfahren
           hätte. Damit wandert der Altbestand beim ersten Start nach
           der Umstellung verlustfrei auf die GUID-IDs. Keine Rätsel,
           keine Heuristik.
        b) Dateiname – Rückfall. Nur wenn dieses SharePoint keine
           `UniqueId` liefert und deshalb weiter mit Pfad-IDs
           gearbeitet wird. Greift ausschließlich bei EINDEUTIGEN
           Namen (genau ein Verwaister, genau eine Lücke). Erkennt
           Verschieben; Umbenennen erkennt es naturgemäß nicht.

   2) ABGLEICH beim Start – kostenlos.
      Der Live-Baum liefert Pfad, Knoten-ID, Änderungszeitstempel und
      Dateigröße. Daraus ergibt sich ohne einen einzigen zusätzlichen
      Download, was fehlt, was veraltet ist und was es nicht mehr gibt.

   3) AUSLESEN im Hintergrund – teuer, daher stark gedrosselt.
      Nur echte Lücken werden nachgeholt: Datei laden, Text
      extrahieren, Eintrag speichern. Sequenziell, mit Pause, angehalten
      sobald der Tab in den Hintergrund wechselt, Obergrenze je Sitzung.

   ================================================================
   „VERALTET" WIRD ÜBER DIE DATEIGRÖSSE ERKANNT, NICHT ÜBER DAS DATUM
   ================================================================
   SharePoint setzt `TimeLastModified` auch beim blossen UMBENENNEN
   neu. Ein Datumsvergleich hielte jede Umbenennung für eine inhaltliche
   Änderung – und läse das Dokument neu aus, obwohl sich am Text nichts
   geändert hat. Genau das sollte Schritt 1 ja gerade vermeiden.
   Deshalb wird beim Indizieren die BYTEGRÖSSE der Quelldatei mitnotiert
   (`_srcSize`) und beim Abgleich verglichen:
       Größe gleich    -> nur umbenannt/verschoben -> nichts tun
       Größe abweichend-> Inhalt geändert          -> neu auslesen
   Für Altbestand ohne `_srcSize` gilt weiter der Tagesvergleich.
   ACHTUNG: `entry.size` ist die TEXTLÄNGE, nicht die Dateigröße – die
   beiden Felder dürfen nie verwechselt werden.

   ================================================================
   MASSENLÖSCHUNGS-SCHUTZ
   ================================================================
   `buildLevel()` im LiveTree nimmt einen nicht lesbaren Unterordner als
   LEERE Gruppe auf, damit ein einzelner Aussetzer nicht den ganzen Baum
   kippt. Für den Abgleich sähe das aus, als seien alle Dokumente dieses
   Ordners gelöscht – ihre Indexeinträge wären weg. Deshalb wird NICHTS
   aufgeräumt, wenn der Baum unvollständig ist, nicht live stammt oder
   der Anteil der Verwaisten unplausibel hoch liegt. Der Abgleich meldet
   das, statt still Daten zu vernichten.

   ABHÄNGIGKEIT MIT RISIKO
   Die Textextraktion aus PDF/DOCX/XLSX lädt Bibliotheken von einem
   externen CDN. Ist dieses im Stadtnetz gesperrt, kann NICHT
   ausgelesen werden. Das wird einmalig geprüft und deutlich gemeldet;
   Umhängen, Abgleich und Aufräumen funktionieren davon unabhängig.
   ================================================================ */
(function () {
  'use strict';

  /* ================================================================
     KONFIGURATION
     ================================================================ */
  var CFG = {
    /* Höchstzahl Dateien, die EINE Sitzung im Hintergrund ausliest.
       Verhindert, dass ein einzelner Browser die halbe Ablage zieht. */
    maxPerSession: 25,
    /* Pause zwischen zwei Dateien (ms) – hält die Oberfläche flüssig. */
    delayBetween: 1200,
    /* Wartezeit nach dem Start, bevor überhaupt begonnen wird (ms). */
    startDelay: 4000,
    /* Dateien oberhalb dieser Größe werden nicht automatisch geholt. */
    maxBytes: 25 * 1024 * 1024,
    /* Version der nachzuladenden Moduldatei – muss zum Cache-Bust
       in infopool67_v8.aspx passen, sonst lädt ein alter Stand. */
    moduleVersion: '10.5',
    /* Aufräumen unterbleibt, wenn mehr als dieser Anteil des Index
       verwaist wirkt (und mindestens minOrphansForGuard Einträge). */
    orphanGuardRatio: 0.30,
    minOrphansForGuard: 5
  };

  var LOG = '[IndexSync]';

  /* ================================================================
     ZUSTAND
     ================================================================ */
  var _state = {
    ran: false,
    missing: [], stale: [], orphans: 0,
    /* v10.4 · Dateien, für die ein Auslesen dauerhaft nichts bringt.
       Sie zählen ausdrücklich NICHT zu `offen` – sonst wäre der
       Rückstand nie null und der Hinweisstreifen nie still. */
    keinText: 0, zuGross: 0,
    rehomed: 0,
    guard: null,            // Grund, warum nicht aufgeräumt wurde
    done: 0, failed: 0, skipped: 0,
    running: false,
    extractorOk: null,      // null = ungeprüft, false = CDN gesperrt
    note: ''
  };

  function getState() {
    var lt = (window.IP67LiveTree && window.IP67LiveTree.getState())
      ? window.IP67LiveTree.getState() : {};
    return {
      ran: _state.ran,
      offen: _state.missing.length + _state.stale.length,
      fehlend: _state.missing.length,
      veraltet: _state.stale.length,
      entfernt: _state.orphans,
      ohneText: _state.keinText,
      zuGross: _state.zuGross,
      umgehaengt: _state.rehomed,
      geschuetzt: _state.guard,
      unvollstaendig: lt.incomplete || 0,
      idModus: lt.idMode || 'unbekannt',
      erledigt: _state.done,
      fehlgeschlagen: _state.failed,
      uebersprungen: _state.skipped,
      laeuft: _state.running,
      extraktion: _state.extractorOk,
      hinweis: _state.note
    };
  }

  /* ================================================================
     HILFEN
     ================================================================ */
  function I() {
    return (window.IP67 && window.IP67._internal) ? window.IP67._internal : null;
  }

  function extOf(nameOrHref) {
    var s = String(nameOrHref || '');
    var q = s.indexOf('?'); if (q >= 0) s = s.slice(0, q);
    var dot = s.lastIndexOf('.');
    return dot < 0 ? '' : s.slice(dot + 1).toLowerCase();
  }

  function fileNameOf(href) {
    var parts = String(href || '').split(/[/\\]/);
    return parts[parts.length - 1] || '';
  }

  /* Datum eines Index-Eintrags bzw. der Datei auf einen Tag normieren,
     damit „YYYY-MM-DD" und ISO-Zeitstempel vergleichbar sind. */
  function dayOf(v) {
    if (!v) return '';
    return String(v).slice(0, 10);
  }

  /* Flache Kopie eines Indexeintrags (kein structuredClone – in
     manchen Umgebungen nicht vorhanden, siehe Anti-Pattern A13). */
  function copyEntry(e) {
    var out = {}, k;
    for (k in e) if (Object.prototype.hasOwnProperty.call(e, k)) out[k] = e[k];
    return out;
  }

  /* v10.4 · Ist dieser Eintrag ein Vermerk „hier ist nichts zu holen"?
     infopool67_index_v8.js legt bei einem gescannten PDF einen Eintrag
     ohne Text mit `_keinText` an; für zu große Dateien tut es dieses
     Modul weiter unten selbst. Solange die Datei unverändert ist, wird
     sie NICHT erneut ausgelesen – genau das war die Endlosschleife.
     Ändert sich die Bytegröße, ist es eine andere Fassung (etwa nach
     einer Texterkennung), und der Versuch lohnt sich erneut. */
  function dauerhaftOhneText(entry, f) {
    if (!entry || !entry._keinText) return false;
    if (typeof entry._srcSize === 'number' && typeof f.size === 'number' &&
        entry._srcSize !== f.size) return false;
    return true;
  }

  /* Veraltet? Bytegröße schlägt Datum – Begründung siehe Kopf. */
  function isStale(entry, f) {
    if (typeof entry._srcSize === 'number' && typeof f.size === 'number') {
      return entry._srcSize !== f.size;
    }
    var fileDay = dayOf(f.modified);
    var idxDay  = dayOf(entry.indexedAt);
    return !!(fileDay && idxDay && fileDay > idxDay);
  }

  /* ================================================================
     1. ABGLEICH  (kostenlos – nur Metadaten)
     ----------------------------------------------------------------
     Liefert einen PLAN. Ausgeführt wird er erst in run().
     ================================================================ */
  function analyse() {
    var Int = I();
    if (!Int || !window.IP67LiveTree) return null;

    var files = window.IP67LiveTree.listFiles() || [];
    var tree  = window.IP67LiveTree.getState() || {};
    var index = Int.getSearchIndex() || {};
    var supported = (window.IP67 && window.IP67._supportedIndexExts) ||
                    Int.SUPPORTED_INDEX_EXTS || [];

    var liveIds  = Object.create(null);
    var consumed = Object.create(null);   // alte IDs, die umgehängt werden
    var planned  = Object.create(null);   // neue IDs, die dadurch belegt sind
    var rehome   = [];

    function indexable(f) {
      return supported.indexOf(extOf(f.href)) >= 0;
    }

    /* --- Durchgang 1a: exakte Migration über legacyId --------------
       Greift beim ersten Start nach der Umstellung auf GUID-IDs und
       bei jedem späteren ID-Wechsel. Kein Raten: der LiveTree sagt
       ausdrücklich, welche alte ID zu welcher Datei gehörte. */
    files.forEach(function (f) {
      liveIds[f.id] = true;
      if (!indexable(f)) return;
      var cur = index[f.id];
      if (cur && cur.text) return;
      var old = f.legacyId;
      if (!old || old === f.id) return;
      var prev = index[old];
      if (!prev || !prev.text || prev._isExternal || consumed[old]) return;
      rehome.push({ from: old, to: f.id, f: f, grund: 'ID-Wechsel' });
      consumed[old] = true;
      planned[f.id] = true;
    });

    /* --- vorläufige Lücken und Verwaiste --------------------------- */
    var notYet = files.filter(function (f) {
      if (!indexable(f)) return false;
      if (planned[f.id]) return false;
      var e = index[f.id];
      return !e || !e.text;
    });

    var orphanIds = Object.keys(index).filter(function (id) {
      var e = index[id];
      if (!e || e._isExternal) return false;
      if (liveIds[id]) return false;
      if (consumed[id]) return false;
      return true;
    });

    /* --- Durchgang 1b: Rückfall über den Dateinamen ----------------
       Nur bei EINDEUTIGER Zuordnung auf beiden Seiten. Bleibt ein Name
       mehrdeutig (zwei „Übersicht.pdf" in verschiedenen Ordnern), wird
       nichts umgehängt – dann lieber einmal neu auslesen als den
       falschen Text an das falsche Dokument hängen. */
    if (orphanIds.length && notYet.length) {
      var byOrph = Object.create(null), byMiss = Object.create(null);
      orphanIds.forEach(function (id) {
        var n = String(index[id].fileName || '').toLowerCase();
        if (!n) return;
        (byOrph[n] = byOrph[n] || []).push(id);
      });
      notYet.forEach(function (f) {
        var n = fileNameOf(f.href).toLowerCase();
        (byMiss[n] = byMiss[n] || []).push(f);
      });
      Object.keys(byMiss).forEach(function (n) {
        if (byMiss[n].length !== 1) return;
        var o = byOrph[n];
        if (!o || o.length !== 1) return;
        var f = byMiss[n][0];
        rehome.push({ from: o[0], to: f.id, f: f, grund: 'verschoben' });
        consumed[o[0]] = true;
        planned[f.id]  = true;
      });
    }

    /* --- endgültige Einstufung ------------------------------------- */
    var missing = [], stale = [], keinText = [], zuGross = [];
    files.forEach(function (f) {
      if (!indexable(f)) return;          // z. B. Bilder – nicht indizierbar
      if (planned[f.id]) return;          // wird umgehängt -> gilt als vorhanden
      var entry = index[f.id];

      /* v10.4 · Zwei Gründe, aus denen ein Auslesen dauerhaft nichts
         bringt. Beide gehören NICHT in `missing`, sonst bleibt der
         Rückstand für immer größer als null: der Hinweisstreifen käme
         bei jedem Seitenaufruf wieder, und `abgleichDurch` im
         Lesbarkeitsbericht könnte nie wahr werden. Sichtbar bleiben
         sie über den Reiter „Dokumente ohne Indexsuche". */
      if (dauerhaftOhneText(entry, f)) { keinText.push(f); return; }
      if (typeof f.size === 'number' && f.size > CFG.maxBytes) { zuGross.push(f); return; }

      if (!entry || !entry.text) { missing.push(f); return; }
      if (isStale(entry, f)) stale.push(f);
    });

    var orphans = orphanIds.filter(function (id) { return !consumed[id]; });

    /* --- Massenlöschungs-Schutz ------------------------------------ */
    var guard = null;
    var indexSize = Object.keys(index).length;
    if (tree.source !== 'live') {
      guard = 'Struktur stammt nicht aus SharePoint';
    } else if (tree.incomplete > 0) {
      guard = tree.incomplete + ' Ordner nicht lesbar – Baum unvollständig';
    } else if (orphans.length >= CFG.minOrphansForGuard &&
               indexSize > 0 &&
               orphans.length > indexSize * CFG.orphanGuardRatio) {
      guard = orphans.length + ' von ' + indexSize + ' Einträgen wirken verwaist – unplausibel';
    }

    return {
      missing: missing, stale: stale,
      keinText: keinText, zuGross: zuGross,
      orphans: orphans, rehome: rehome,
      guard: guard, total: files.length
    };
  }

  /* ================================================================
     2. UMHÄNGEN  (Eintrag auf neue Knoten-ID übertragen)
     ================================================================ */
  function applyRehome(list) {
    var Int = I();
    if (!Int || !list.length) return Promise.resolve(0);

    var chain = Promise.resolve(), n = 0;
    list.forEach(function (r) {
      chain = chain.then(function () {
        var index = Int.getSearchIndex();
        var src = index[r.from];
        if (!src || !src.text) return;
        var copy = copyEntry(src);
        copy._href = r.f.href;
        copy._uid  = r.f.uid || null;
        if (!copy.fileName) copy.fileName = fileNameOf(r.f.href);
        /* Aktuellen Dateizustand als Bezugspunkt übernehmen: das
           Dokument ist inhaltlich unverändert, nur anders benannt
           oder anders abgelegt. */
        if (typeof r.f.size === 'number') copy._srcSize = r.f.size;
        if (r.f.modified) copy._srcModified = r.f.modified;

        return Promise.resolve(Int.saveIndexEntry(r.to, copy))
          .then(function () { return Int.deleteIndexEntry(r.from); })
          .then(function () { n++; });
      }).catch(function (e) {
        console.warn(LOG, 'Umhängen fehlgeschlagen für', r.f.title, '–', e.message);
      });
    });
    return chain.then(function () { return n; });
  }

  /* ================================================================
     2b. v10.4 · VERMERK FÜR ZU GROSSE DATEIEN
     ----------------------------------------------------------------
     BEFUND. Eine Datei oberhalb von CFG.maxBytes wurde bis v10.3 in die
     Warteschlange gestellt, heruntergeladen (bzw. an der
     Content-Length-Prüfung abgebrochen) und als Fehlschlag gezählt –
     bei jedem Seitenaufruf aufs Neue. Das Grünhandbuch mit 29 MB war
     damit ein Dauergast in der Fehlerliste, obwohl das Ergebnis von
     vornherein feststand.

     ÄNDERUNG. Die Größe steht schon im LiveTree, ganz ohne Abruf. Wer
     über der Grenze liegt, bekommt denselben textlosen Vermerk wie ein
     Scan, nur mit anderer Begründung. Damit weiß der Lesbarkeitsbericht,
     dass hier keine Aussage über die Lesbarkeit möglich ist – anders als
     beim Scan, der tatsächlich unlesbar ist.

     WAS BLEIBT. Kein Download, kein Netzverkehr. Wird die Datei
     verkleinert oder geteilt, ändert sich die Bytegröße und der
     Abgleich nimmt sie von selbst wieder auf.
     ================================================================ */
  function markiereZuGross(list) {
    var Int = I();
    if (!Int || !list.length) return Promise.resolve(0);

    var chain = Promise.resolve(), n = 0;
    list.forEach(function (f) {
      chain = chain.then(function () {
        var index = Int.getSearchIndex();
        var vorhanden = index[f.id];
        /* Schon vermerkt und unverändert? Dann nichts schreiben – jeder
           überflüssige Schreibvorgang landet sonst in der zentralen
           search-index.json und erzeugt dort einen Scheinunterschied. */
        if (vorhanden && vorhanden._keinText === 'zu-gross' &&
            vorhanden._srcSize === f.size) return;

        var mb = Math.round(f.size / 1048576);
        var e = {
          text:      '',
          indexedAt: heute(),
          size:      0,
          fileName:  fileNameOf(f.href),
          format:    extOf(f.href),
          _keinText:      'zu-gross',
          _keinTextGrund: 'Datei über ' + Math.round(CFG.maxBytes / 1048576) +
                          ' MB (' + mb + ' MB) – wird nicht automatisch ausgelesen',
          _versuchtAm:    heute(),
          _srcSize:  f.size,
          _href:     f.href,
          _uid:      f.uid || null
        };
        if (f.modified) e._srcModified = f.modified;
        return Promise.resolve(Int.saveIndexEntry(f.id, e)).then(function () { n++; });
      }).catch(function (err) {
        console.warn(LOG, 'Vermerk „zu groß" fehlgeschlagen für', f.title, '–', err.message);
      });
    });
    return chain.then(function () { return n; });
  }

  /* Tagesdatum in der Schreibweise des Index (YYYY-MM-DD). Der Kern
     bringt dafür `today()` mit; ohne ihn der gleichwertige Eigenbau. */
  function heute() {
    var Int = I();
    if (Int && typeof Int.today === 'function') return Int.today();
    return new Date().toISOString().slice(0, 10);
  }

  /* ================================================================
     3. AUFRÄUMEN  (verwaiste Einträge entfernen)
     ================================================================ */
  function removeOrphans(ids) {
    var Int = I();
    if (!Int || !ids.length) return Promise.resolve(0);
    var chain = Promise.resolve();
    ids.forEach(function (id) {
      chain = chain.then(function () {
        return Promise.resolve(Int.deleteIndexEntry(id)).catch(function () {});
      });
    });
    return chain.then(function () {
      if (Int.invalidateSimilarityCache) Int.invalidateSimilarityCache();
      return ids.length;
    });
  }

  /* ================================================================
     4. DATEI VON SHAREPOINT HOLEN
     ----------------------------------------------------------------
     href ist relativ zur .aspx (z. B. „Ablage/673/DA_Pflege.pdf").
     Same-Origin, daher genügt ein normaler fetch mit Windows-Auth.
     ================================================================ */
  function fetchAsFile(href) {
    var name = fileNameOf(href);
    return fetch(encodeURI(href), { credentials: 'include' })
      .then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var len = Number(resp.headers.get('content-length') || 0);
        if (len && len > CFG.maxBytes) throw new Error('Datei zu groß (' + Math.round(len / 1048576) + ' MB)');
        return resp.blob();
      })
      .then(function (blob) {
        if (blob.size > CFG.maxBytes) throw new Error('Datei zu groß');
        /* File statt Blob, weil die Extraktoren file.name auswerten. */
        try { return new File([blob], name, { type: blob.type }); }
        catch (e) { blob.name = name; return blob; }
      });
  }

  /* Nach erfolgreichem Auslesen den Dateizustand am Eintrag vermerken,
     damit der nächste Abgleich Umbenennen von Inhaltsänderung
     unterscheiden kann. */
  function stampSource(f) {
    var Int = I();
    if (!Int) return Promise.resolve();
    var index = Int.getSearchIndex();
    var e = index[f.id];
    if (!e) return Promise.resolve();
    e._href = f.href;
    e._uid  = f.uid || null;
    if (typeof f.size === 'number') e._srcSize = f.size;
    if (f.modified) e._srcModified = f.modified;
    return Promise.resolve(Int.saveIndexEntry(f.id, e)).catch(function () {});
  }

  /* ================================================================
     5. HINTERGRUND-WARTESCHLANGE
     ================================================================ */
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* Wartet, solange der Tab im Hintergrund ist – dort soll nichts
     gerechnet und nichts geladen werden. */
  function whenVisible() {
    if (document.visibilityState !== 'hidden') return Promise.resolve();
    return new Promise(function (resolve) {
      var h = function () {
        if (document.visibilityState !== 'hidden') {
          document.removeEventListener('visibilitychange', h);
          resolve();
        }
      };
      document.addEventListener('visibilitychange', h);
    });
  }

  function ensureIndexModule() {
    if (window.IP67 && typeof window.IP67._indexFileForId === 'function') {
      return Promise.resolve(true);
    }
    /* Modul nachladen. Die Version MUSS zum Cache-Bust der .aspx
       passen, sonst zieht der Browser einen alten Stand aus dem Cache. */
    if (window.IP67 && typeof window.IP67.openIndexModal === 'function') {
      return new Promise(function (resolve) {
        var s = document.createElement('script');
        s.src = 'infopool67_index_v8.js?v=' + CFG.moduleVersion;
        s.async = false;
        s.charset = 'UTF-8';
        s.onload = function () {
          resolve(typeof window.IP67._indexFileForId === 'function');
        };
        s.onerror = function () { resolve(false); };
        document.head.appendChild(s);
      });
    }
    return Promise.resolve(false);
  }

  function processQueue(queue) {
    if (!queue.length) return Promise.resolve();

    _state.running = true;
    var i = 0;

    function step() {
      if (i >= queue.length || _state.done >= CFG.maxPerSession) {
        _state.running = false;
        var rest = queue.length - i;
        if (rest > 0) {
          _state.skipped += rest;
          console.info(LOG, 'Obergrenze der Sitzung erreicht –', rest,
            'Dokument(e) bleiben für den nächsten Start offen.');
        }
        console.info(LOG, 'Hintergrund-Indizierung beendet ·',
          _state.done, 'erledigt,', _state.failed, 'fehlgeschlagen');
        return Promise.resolve();
      }

      var f = queue[i++];
      return whenVisible()
        .then(function () { return fetchAsFile(f.href); })
        .then(function (file) { return window.IP67._indexFileForId(file, f.id); })
        .then(function (ok) {
          if (ok) {
            _state.done++;
            console.info(LOG, '✓ indiziert:', f.title);
            return stampSource(f);
          }
          /* v10.4 · Bis v10.3 wurde hier nur stillschweigend gezählt.
             In der Konsole erschien deshalb „7 fehlgeschlagen", ohne
             dass zu sehen war, welche Dateien das betraf – die einzigen
             sichtbaren Fehlschläge waren die, die über den Fehlerzweig
             unten liefen. Jetzt sagt jede Zeile, worum es geht.
             `stampSource` überträgt zusätzlich Pfad und Bytegröße auf
             den Vermerk, den infopool67_index_v8.js soeben angelegt hat –
             ohne diesen Bezugspunkt könnte der nächste Abgleich nicht
             erkennen, ob die Datei inzwischen ersetzt wurde. */
          _state.failed++;
          console.info(LOG, '⊘ kein Text gewinnbar:', f.title,
            '· wird künftig übersprungen und steht im Reiter ' +
            '„Dokumente ohne Indexsuche".');
          return stampSource(f);
        })
        .catch(function (e) {
          _state.failed++;
          console.warn(LOG, '✗', f.title, '–', e.message);
        })
        .then(function () { return sleep(CFG.delayBetween); })
        .then(step);
    }

    return step();
  }

  /* ================================================================
     6. ABLAUF
     ================================================================ */
  function run() {
    var res = analyse();
    if (!res) { console.warn(LOG, 'Abgleich nicht möglich (Baum oder Core fehlen).'); return; }

    _state.ran      = true;
    _state.missing  = res.missing;
    _state.stale    = res.stale;
    _state.guard    = res.guard;
    _state.keinText = res.keinText.length;
    _state.zuGross  = res.zuGross.length;

    console.info(LOG, 'Abgleich:', res.total, 'Dateien in der Ablage ·',
      res.rehome.length, 'umzuhängen ·',
      res.missing.length, 'ohne Index ·', res.stale.length, 'veraltet ·',
      res.orphans.length, 'verwaist');

    /* v10.4 · Die dauerhaft nicht auslesbaren getrennt melden. Sie sind
       kein Rückstand, sondern ein Bestandsmerkmal – wer die Konsole
       liest, soll die beiden Zahlen nicht verwechseln. */
    if (res.keinText.length || res.zuGross.length) {
      console.info(LOG, 'Dauerhaft ohne Volltext:',
        res.keinText.length, 'ohne Textebene ·',
        res.zuGross.length, 'über der Größengrenze ·',
        'werden nicht erneut ausgelesen (Reiter „Dokumente ohne Indexsuche").');
    }

    /* Zu große Dateien einmalig vermerken – ohne Download. */
    markiereZuGross(res.zuGross).then(function (n) {
      if (n > 0) {
        console.info(LOG, n, 'Datei(en) über der Größengrenze vermerkt · ' +
          'sie kommen nicht mehr in die Warteschlange.');
      }
    });

    /* Zuerst umhängen – das ist der Fall „umbenannt oder verschoben"
       und kostet nichts ausser einem Schreibvorgang in die IndexedDB. */
    applyRehome(res.rehome)
      .then(function (n) {
        _state.rehomed = n;
        if (n > 0) {
          console.info(LOG, n, 'Indexeintrag/-einträge auf neue Knoten-IDs umgehängt ' +
            '(nichts neu ausgelesen).');
          var Int = I();
          if (Int && Int.invalidateSimilarityCache) Int.invalidateSimilarityCache();
        }
        /* Danach aufräumen – aber nur, wenn der Befund plausibel ist. */
        if (res.guard) {
          _state.orphans = 0;
          console.warn(LOG, 'Aufräumen ausgesetzt:', res.guard,
            '· es wurde KEIN Indexeintrag gelöscht.');
          return 0;
        }
        return removeOrphans(res.orphans);
      })
      .then(function (n) {
        if (!res.guard) {
          _state.orphans = n;
          if (n > 0) console.info(LOG, n, 'verwaiste Index-Einträge entfernt.');
        }
      });

    var queue = res.missing.concat(res.stale);
    if (!queue.length) {
      _state.note = 'Index ist aktuell.';
      console.info(LOG, 'Index ist aktuell – nichts auszulesen.');
      return;
    }

    /* Erst nach einer Anlaufzeit beginnen, damit der Seitenaufbau und
       die erste Interaktion Vorrang haben. */
    sleep(CFG.startDelay)
      .then(whenVisible)
      .then(ensureIndexModule)
      .then(function (ok) {
        if (!ok) {
          _state.note = 'Index-Modul nicht ladbar – Auslesen übersprungen.';
          console.warn(LOG, _state.note);
          return;
        }
        /* Einmalig prüfen, ob die Extraktionsbibliothek erreichbar ist.
           Im Stadtnetz kann der CDN-Zugriff gesperrt sein. */
        var firstExt = extOf(queue[0].href);
        return window.IP67._probeExtractor(firstExt).then(function (can) {
          _state.extractorOk = !!can;
          if (!can) {
            _state.note = 'Textextraktion nicht verfügbar (externe Bibliothek nicht erreichbar). ' +
                          'Umhängen und Abgleich liefen trotzdem.';
            console.warn(LOG, _state.note);
            return;
          }
          console.info(LOG, 'Starte Hintergrund-Indizierung für', queue.length, 'Dokument(e) …');
          return processQueue(queue);
        });
      })
      .catch(function (e) { console.warn(LOG, 'Abbruch:', e.message); });
  }

  /* ================================================================
     7. START – nach Baum UND Core-Bootstrap
     ================================================================ */
  function boot() {
    var tree = (window.IP67_TREE_READY && window.IP67_TREE_READY.then)
      ? window.IP67_TREE_READY.catch(function () {})
      : Promise.resolve();
    var dom = (document.readyState !== 'loading')
      ? Promise.resolve()
      : new Promise(function (r) { document.addEventListener('DOMContentLoaded', r); });

    Promise.all([tree, dom])
      /* Dem Core Zeit geben, den Index aus IndexedDB und der zentralen
         search-index.json zu laden – sonst gälte alles als „fehlend". */
      .then(function () { return sleep(1500); })
      .then(run);
  }

  boot();

  window.IP67IndexSync = {
    getState: getState,
    analyse: analyse,
    /* Manuell anstoßen (z. B. aus den Einstellungen). */
    runNow: function () { _state.done = 0; _state.skipped = 0; run(); },
    CFG: CFG
  };

  console.info('[Info-Pool 67] indexsync.js bereit');
})();
