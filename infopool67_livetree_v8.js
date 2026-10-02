/* ================================================================
   Info-Pool 67 · infopool67_livetree_v8.js   (Stand: Cache ?v=9.3)
   ----------------------------------------------------------------
   ZWECK
   Baut die Themenstruktur bei JEDEM Start live aus dem SharePoint-
   Ordner „Ablage" auf. Ersetzt die bisher manuell gepflegte Datei
   sidebar-data.js / sidebar-data.json vollständig.

   PRINZIP
     Ordner  ->  Gruppe   (type: 'group')
     Datei   ->  Eintrag  (type: 'item')
     Titel   =   Ordner- bzw. Dateiname (bei Dateien ohne Endung)
     Sortierung: Ordner zuerst, dann Dateien, jeweils alphabetisch (de)

   ================================================================
   ÄNDERUNG GEGENÜBER ?v=9.2 – KNOTEN-ID AUS DER SHAREPOINT-GUID
   ================================================================
   BISHER war die Knoten-ID ein Hash des PFADES. Damit war jede
   Umbenennung und jedes Verschieben aus Sicht der Anwendung eine
   Neugeburt: der alte Volltextindex-Eintrag galt als verwaist und
   wurde gelöscht, das Dokument musste komplett neu ausgelesen werden.

   JETZT liefert SharePoint mit `UniqueId` je Datei und Ordner eine
   GUID, die Umbenennen und Verschieben INNERHALB derselben Bibliothek
   unbeschadet übersteht. Daraus wird die Knoten-ID gebildet:

       id = 'u_' + GUID ohne Bindestriche      (Regelfall)
       id = 'f_' + Pfad-Hash                   (Rückfall, s. u.)

   Folge: Umbenennen und Verschieben ändern die ID NICHT MEHR. Der
   Indexeintrag bleibt gültig, es wird nichts neu ausgelesen – und
   zwar für alle Nutzenden gleichzeitig, ohne zentrales Nachpflegen.

   RÜCKFALL AUF DEN PFAD-HASH
   Sollte diese SharePoint-Version `UniqueId` im $select nicht
   akzeptieren (Antwort 400/500), wird EINMALIG pro Sitzung auf die
   frühere Abfrage zurückgeschaltet und mit Pfad-IDs weitergearbeitet.
   Die Anwendung läuft dann exakt wie in ?v=9.2 – nur ohne den Vorteil.

   MIGRATION DES BESTANDES
   Jeder Knoten führt zusätzlich `_legacyId` – die ID, die er nach dem
   alten Pfadverfahren hätte. infopool67_indexsync_v8.js benutzt sie,
   um vorhandene Indexeinträge verlustfrei auf die neue ID umzuhängen,
   OHNE ein einziges Dokument neu auszulesen.

   UNVOLLSTÄNDIGE BÄUME WERDEN MARKIERT
   Ein Unterordner, der sich nicht lesen lässt, wird weiterhin als
   leere Gruppe aufgenommen, damit ein einzelner Aussetzer nie den
   ganzen Baum kippt. NEU: Er wird als `_incomplete` markiert und
   gezählt. Ohne diese Markierung hielte der Index-Abgleich sämtliche
   Dokumente dieses Ordners für gelöscht und würde ihre Indexeinträge
   entfernen – ein stiller Datenverlust bei einem bloßen Netzhänger.

   KEIN ERSATZBESTAND
   Schlägt die REST-Abfrage insgesamt fehl, bleibt die Struktur leer
   und der Fehler ist sichtbar. Ein lokal gespiegelter Altstand würde
   Dokumente anzeigen, die es vielleicht nicht mehr gibt.
   ================================================================ */
(function () {
  'use strict';

  /* ================================================================
     KONFIGURATION
     ================================================================ */
  var S = window.IP67Storage || {};
  var SP_SITE_URL = S.SP_SITE_URL || 'http://67-programme.verwaltung.stadtkoeln.de/Wissen673';
  var SP_FOLDER   = S.SP_FOLDER   || '/Wissen673/Freigegebene Dokumente/Infopool';

  /* Name des Ablage-Unterordners (relativ zum App-Ordner). */
  var ABLAGE_NAME = 'Ablage';
  var ABLAGE_ABS  = SP_FOLDER + '/' + ABLAGE_NAME;

  /* Ordner, die SharePoint selbst anlegt bzw. die nicht zur
     fachlichen Ablage gehören. */
  var SKIP_FOLDERS = ['forms', '_catalogs', '_private', '_vti_cnf'];

  /* Sicherheitsnetz gegen Endlosrekursion bei zyklischen Strukturen. */
  var MAX_DEPTH = 12;

  /* Wird auf false gesetzt, sobald SharePoint `UniqueId` im $select
     ablehnt. Gilt dann für den Rest der Sitzung. */
  var _uidSelect = true;

  /* ================================================================
     1. HILFSFUNKTIONEN
     ================================================================ */

  /* Server-relative Pfade für REST kodieren (Slashes bleiben Trenner). */
  function spEnc(p) {
    return p.split('/').map(function (seg) {
      return encodeURIComponent(seg);
    }).join('/');
  }

  /* Deterministische ID aus dem Pfad (djb2-Variante, kollisionsarm).
     Gleicher Pfad -> immer gleiche ID, auch nach Neustart.
     Bleibt als `_legacyId` erhalten und dient der Migration. */
  function idForPath(relPath) {
    var h1 = 5381, h2 = 52711, i, c;
    for (i = 0; i < relPath.length; i++) {
      c = relPath.charCodeAt(i);
      h1 = ((h1 * 33) ^ c) >>> 0;
      h2 = ((h2 * 31) ^ c) >>> 0;
    }
    return 'f_' + h1.toString(36) + h2.toString(36);
  }

  /* GUID prüfen und normieren.
     SharePoint liefert je nach Version „{1234-…}" oder „1234-…".
     Die Null-GUID gilt als „nicht vorhanden". */
  var GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  var GUID_ZERO = '00000000000000000000000000000000';

  function normGuid(raw) {
    if (!raw) return '';
    var s = String(raw).trim().toLowerCase().replace(/^\{|\}$/g, '');
    if (!GUID_RE.test(s)) return '';
    var hex = s.replace(/-/g, '');
    return (hex === GUID_ZERO) ? '' : hex;
  }

  /* Knoten-ID bilden: GUID bevorzugt, sonst Pfad-Hash. */
  function idForNode(rawUid, relPath) {
    var g = normGuid(rawUid);
    if (g) { _stat.uid++; return 'u_' + g; }
    _stat.path++;
    return idForPath(relPath);
  }

  /* Dateiendung für die Titelanzeige entfernen. */
  function stripExt(name) {
    return name.replace(/\.[^.\/\\]+$/, '');
  }

  /* Alphabetisch, deutsche Sortierregeln (Umlaute korrekt einsortiert). */
  var collator = (typeof Intl !== 'undefined' && Intl.Collator)
    ? new Intl.Collator('de', { numeric: true, sensitivity: 'base' })
    : null;

  function cmpName(a, b) {
    if (collator) return collator.compare(a.title, b.title);
    return String(a.title).localeCompare(String(b.title));
  }

  function isSkippedFolder(name) {
    var n = String(name || '').toLowerCase();
    if (!n) return true;
    if (n.charAt(0) === '_') return true;
    return SKIP_FOLDERS.indexOf(n) !== -1;
  }

  /* ================================================================
     2. SHAREPOINT-REST: EINE ORDNEREBENE LESEN
     ----------------------------------------------------------------
     SharePoint liefert Unterordner und Dateien über zwei getrennte
     Endpunkte. Eine rekursive „alles auf einmal"-Abfrage gibt es in
     On-Premises nicht, daher wird pro Ebene gelesen und abgestiegen.
     ================================================================ */
  /* v9.5 · WICHTIG: cache:'no-store' + no-cache-Kopf.
     Ohne diese beiden Angaben liefert der Browser die Ordnerabfrage aus
     seinem eigenen Zwischenspeicher zurück. Eine frisch in SharePoint
     abgelegte Datei taucht dann weder unter „Inhalte" noch unter „Neu
     seit Ihrem letzten Besuch" auf – die Anwendung sah schlicht einen
     alten Stand der Ablage. Genau das war der Grund, warum neue
     Dokumente erst nach einem harten Neuladen sichtbar wurden. */
  function apiGet(url) {
    return fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'Accept': 'application/json;odata=verbose',
        'Cache-Control': 'no-cache'
      }
    }).then(function (resp) {
      if (!resp.ok) {
        var e = new Error('HTTP ' + resp.status);
        e.status = resp.status;
        throw e;
      }
      return resp.arrayBuffer();
    }).then(function (buf) {
      /* SharePoint setzt im HTTP-Header teils Windows-1252. Bytes
         holen und explizit als UTF-8 dekodieren, sonst zerfallen
         Umlaute in Ordner- und Dateinamen (KÃ¶ln statt Köln). */
      var txt = new TextDecoder('utf-8').decode(buf);
      return JSON.parse(txt.replace(/^\uFEFF/, ''));
    });
  }

  function odataResults(json) {
    if (!json) return [];
    if (json.d && Array.isArray(json.d.results)) return json.d.results;
    if (Array.isArray(json.value)) return json.value;
    return [];
  }

  /* Abfrage mit UniqueId, bei Ablehnung einmalig ohne.
     Wichtig: NUR 400/500 lösen den Rückfall aus. Ein 404 (Ordner weg)
     oder 403 (keine Rechte) ist ein echter Fehler und bleibt einer. */
  function apiGetSel(base, endpoint, selUid, selPlain) {
    function url(sel) { return base + endpoint + '?$select=' + sel + '&$top=2000'; }
    if (!_uidSelect) return apiGet(url(selPlain));
    return apiGet(url(selUid)).catch(function (e) {
      if (_uidSelect && (e.status === 400 || e.status === 500)) {
        _uidSelect = false;
        console.warn('[LiveTree] Dieses SharePoint akzeptiert „UniqueId" nicht im $select – ' +
                     'Rückfall auf Pfad-IDs für diese Sitzung.');
        return apiGet(url(selPlain));
      }
      throw e;
    });
  }

  function listFolder(absPath) {
    var base = SP_SITE_URL +
      "/_api/web/GetFolderByServerRelativeUrl('" + spEnc(absPath) + "')";

    var pFolders = apiGetSel(base, '/Folders',
      'Name,ServerRelativeUrl,ItemCount,UniqueId',
      'Name,ServerRelativeUrl,ItemCount');
    var pFiles = apiGetSel(base, '/Files',
      'Name,ServerRelativeUrl,TimeLastModified,Length,UniqueId',
      'Name,ServerRelativeUrl,TimeLastModified,Length');

    return Promise.all([pFolders, pFiles]).then(function (res) {
      return {
        folders: odataResults(res[0]),
        files:   odataResults(res[1])
      };
    });
  }

  /* ================================================================
     3. REKURSIVER AUFBAU
     ----------------------------------------------------------------
     relPrefix ist der Pfad RELATIV zum App-Ordner, also genau das,
     was später als href im Viewer/iframe landet (z. B.
     „Ablage/Fahrzeuge und Maschinen/Merkblatt.pdf").
     ================================================================ */
  function buildLevel(absPath, relPrefix, depth) {
    if (depth > MAX_DEPTH) return Promise.resolve([]);

    return listFolder(absPath).then(function (lvl) {
      var groups = [];
      var items  = [];

      /* --- Dateien dieser Ebene --- */
      lvl.files.forEach(function (f) {
        var name = f.Name || '';
        if (!name || name.charAt(0) === '_') return;
        var rel = relPrefix + '/' + name;
        items.push({
          id:        idForNode(f.UniqueId, rel),
          type:      'item',
          title:     stripExt(name),
          href:      rel,
          dateAdded: (f.TimeLastModified || '').slice(0, 10) || undefined,
          /* Grundlage für den automatischen Index-Abgleich. */
          _uid:      normGuid(f.UniqueId) || null,
          _legacyId: idForPath(rel),
          _modified: f.TimeLastModified || null,
          _size:     typeof f.Length !== 'undefined' ? Number(f.Length) : null
        });
      });

      /* --- Unterordner rekursiv --- */
      var subs = lvl.folders.filter(function (d) {
        return !isSkippedFolder(d.Name);
      });

      return Promise.all(subs.map(function (d) {
        var name = d.Name;
        var rel  = relPrefix + '/' + name;
        return buildLevel(absPath + '/' + name, rel, depth + 1)
          .then(function (children) {
            groups.push({
              id:        idForNode(d.UniqueId, rel),
              type:      'group',
              title:     name,
              _uid:      normGuid(d.UniqueId) || null,
              _legacyId: idForPath(rel),
              children:  children
            });
          })
          .catch(function (e) {
            /* Ein unlesbarer Unterordner darf nie den ganzen Baum
               kippen – als leere Gruppe aufnehmen und weitermachen.
               Die Markierung `_incomplete` verhindert, dass der
               Index-Abgleich die Dokumente darin für gelöscht hält. */
            _stat.incomplete++;
            console.warn('[LiveTree] Ordner nicht lesbar:', rel, e.message);
            groups.push({
              id:        idForNode(d.UniqueId, rel),
              type:      'group',
              title:     name,
              _uid:      normGuid(d.UniqueId) || null,
              _legacyId: idForPath(rel),
              _incomplete: true,
              children:  []
            });
          });
      })).then(function () {
        groups.sort(cmpName);
        items.sort(cmpName);
        /* Ordner zuerst, dann Dateien. */
        return groups.concat(items);
      });
    });
  }

  /* ================================================================
     4. ÖFFENTLICHER AUFBAU
     ================================================================ */
  var _state = {
    tree:      [],
    source:    'none',   // 'live' | 'none'
    stampedAt: null,
    error:     null,
    fileCount: 0,
    folderCount: 0,
    incomplete: 0,
    idMode:    'unbekannt'
  };

  /* Zähler des laufenden Aufbaus. */
  var _stat = { uid: 0, path: 0, incomplete: 0 };

  function countNodes(list, acc) {
    list.forEach(function (n) {
      if (n.type === 'group') { acc.folders++; countNodes(n.children || [], acc); }
      else acc.files++;
    });
    return acc;
  }

  function rebuild() {
    var t0 = Date.now();
    _stat = { uid: 0, path: 0, incomplete: 0 };

    return buildLevel(ABLAGE_ABS, ABLAGE_NAME, 0).then(function (tree) {
      var c = countNodes(tree, { files: 0, folders: 0 });
      _state.tree        = tree;
      _state.source      = 'live';
      _state.stampedAt   = new Date().toISOString();
      _state.error       = null;
      _state.fileCount   = c.files;
      _state.folderCount = c.folders;
      _state.incomplete  = _stat.incomplete;
      _state.idMode      = (_stat.uid && _stat.path) ? 'gemischt'
                         : (_stat.uid ? 'sharepoint-guid' : 'pfad');

      window.sidebarInitData = tree;

      console.info('[LiveTree] Struktur live aufgebaut:',
        c.folders + ' Ordner,', c.files + ' Dateien,',
        (Date.now() - t0) + ' ms · IDs:', _state.idMode);
      if (_stat.incomplete > 0) {
        console.warn('[LiveTree]', _stat.incomplete,
          'Ordner konnten nicht gelesen werden – der Baum ist unvollständig. ' +
          'Der Index-Abgleich räumt deshalb nichts auf.');
      }
      return tree;
    }).catch(function (e) {
      _state.error  = e;
      _state.tree   = [];
      _state.source = 'none';
      _state.fileCount = 0;
      _state.folderCount = 0;
      _state.incomplete = 0;
      _state.idMode = 'unbekannt';
      window.sidebarInitData = [];
      console.error('[LiveTree] Struktur konnte nicht geladen werden:', e.message,
        '– es wird bewusst kein Altstand angezeigt.');
      return _state.tree;
    });
  }

  /* ================================================================
     6. START
     ----------------------------------------------------------------
     Sofort beim Parsen anstoßen. Der Core wartet im Bootstrap auf
     IP67_TREE_READY, bevor er die Struktur rendert.
     ================================================================ */
  window.IP67_TREE_READY = rebuild();

  window.IP67LiveTree = {
    ABLAGE_NAME: ABLAGE_NAME,
    ABLAGE_ABS:  ABLAGE_ABS,
    rebuild:     rebuild,
    getTree:     function () { return _state.tree; },
    getState:    function () {
      return {
        source: _state.source, stampedAt: _state.stampedAt,
        files: _state.fileCount, folders: _state.folderCount,
        /* Anzahl nicht lesbarer Ordner. > 0 bedeutet: Baum unvollständig. */
        incomplete: _state.incomplete,
        /* 'sharepoint-guid' | 'pfad' | 'gemischt' | 'unbekannt' */
        idMode: _state.idMode,
        error: _state.error ? _state.error.message : null
      };
    },
    /* Flache Liste aller Dateien – Grundlage für die automatische
       Index-Aktualisierung.
         id       – aktuelle Knoten-ID (GUID-basiert, sonst Pfad)
         legacyId – ID nach dem alten Pfadverfahren (Migration)
         uid      – SharePoint-GUID ohne Bindestriche, sonst null
         size     – Dateigröße in BYTES (nicht Textlänge!)             */
    listFiles: function () {
      var out = [];
      (function walk(list) {
        list.forEach(function (n) {
          if (n.type === 'group') walk(n.children || []);
          else out.push({
            id:       n.id,
            legacyId: n._legacyId || null,
            uid:      n._uid || null,
            title:    n.title,
            href:     n.href,
            modified: n._modified,
            size:     (typeof n._size === 'number') ? n._size : null
          });
        });
      })(_state.tree);
      return out;
    }
  };

  console.info('[Info-Pool 67] livetree.js bereit · Quelle:', ABLAGE_ABS);
})();
