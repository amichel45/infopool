/* ================================================================
   Info-Pool 67 – storage.js  (AP1: SharePoint-Storage)
   ----------------------------------------------------------------
   Zweck:
   1) SharePoint-REST-Primitiven (Lesen/Schreiben/Ordner) für die
      On-Premises-Umgebung (HTTP, Windows-Auth, Same-Origin).
   2) File-System-Access-API-Emulation (SpDirectoryHandle/SpFileHandle)
      als Vorbereitung für die Admin-Schreibwege (AP5/AP6).
   3) ensureDataLoaded(): lädt sidebar-data / search-index /
      Mitarbeiterliste per fetch als .json und legt sie auf die
      bestehenden Globals. Fällt auf die per <script> eingebetteten
      JS-Variablen zurück, wenn (noch) kein .json existiert oder die
      App per file:// geöffnet wurde -> heutiges Verhalten bleibt heil.

   Lädt KEINE Netzwerkdaten beim Parsen synchron; alle fetch-Aufrufe
   laufen async in ensureDataLoaded() und sind gekapselt (try/catch),
   damit ein nicht erreichbarer Server die App nie blockiert.
   ================================================================ */
(function () {
  'use strict';

  /* ================================================================
     KONFIGURATION  –  bei abweichendem SharePoint-Pfad NUR HIER ändern.
     ----------------------------------------------------------------
     ▸ SP_FOLDER ist der server-relative Bibliotheks-/Ordnerpfad.
       Der Default ist eine ANNAHME (analog zum Grünportal-Muster
       „…/Freigegebene Dokumente/<App>"). Bitte vor dem Produktiv-
       Deployment mit dem tatsächlichen Info-Pool-Ordner abgleichen.
     ▸ DATA_SOURCE:
         'auto'    – JSON per fetch versuchen, sonst eingebettete Globals
         'json'    – ausschließlich .json (nach AP2-Migration)
         'globals' – kein fetch, nur eingebettete <script>-Globals (file://)
     ================================================================ */
  var SP_SITE_URL = "http://67-programme.verwaltung.stadtkoeln.de/Wissen673";
  var SP_FOLDER   = "/Wissen673/Freigegebene Dokumente/Infopool";
  var SP_NAME     = "Info-Pool 67";
  /* v8.4: Unterordner, aus dem die Themenstruktur live gelesen wird. */
  var SP_ABLAGE   = SP_FOLDER + "/Ablage";
  // AP2: Migration abgeschlossen -> ausschließlich .json per fetch.
  // (Zum vorübergehenden Zurückfallen auf eingebettete <script>-Globals: "auto".)
  var DATA_SOURCE = "json";

  /* ----------------------------------------------------------------
     URL-Enkodierung für REST-Pfade (Leerzeichen/Umlaute kodieren,
     Schrägstriche bleiben Trenner).
     ---------------------------------------------------------------- */
  function spEnc(serverRelativeUrl) {
    return serverRelativeUrl.split("/").map(function (seg) {
      return encodeURIComponent(seg);
    }).join("/");
  }

  /* ----------------------------------------------------------------
     FormDigest (CSRF-Pendant) – 30-Minuten-Cache. Nur für Schreibops.
     ---------------------------------------------------------------- */
  var _digestCache = { value: null, expires: 0 };

  function spGetDigest() {
    if (_digestCache.value && Date.now() < _digestCache.expires) {
      return Promise.resolve(_digestCache.value);
    }
    return fetch(SP_SITE_URL + "/_api/contextinfo", {
      method: "POST",
      credentials: "include",
      headers: {
        "Accept": "application/json;odata=verbose",
        "Content-Type": "application/json;odata=verbose"
      }
    }).then(function (resp) {
      if (!resp.ok) throw new Error("SharePoint-Auth fehlgeschlagen (" + resp.status + ")");
      return resp.json();
    }).then(function (j) {
      var info = j.d.GetContextWebInformation;
      _digestCache = {
        value: info.FormDigestValue,
        expires: Date.now() + ((info.FormDigestTimeoutSeconds || 1800) * 1000) - 30000
      };
      return _digestCache.value;
    });
  }

  /* ----------------------------------------------------------------
     Datei als Text lesen (Reads brauchen KEINEN Digest).
     ---------------------------------------------------------------- */
  function spReadFileText(serverRelativeUrl) {
    var url = SP_SITE_URL +
      "/_api/web/GetFileByServerRelativeUrl('" + spEnc(serverRelativeUrl) + "')/$value";
    return fetch(url, {
      credentials: "include",
      headers: { "Accept": "text/plain, */*" }
    }).then(function (resp) {
      if (resp.status === 404) { var e = new Error("NotFound"); e.name = "NotFoundError"; throw e; }
      if (!resp.ok) throw new Error("Lesefehler " + resp.status);
      return resp.text();
    });
  }

  /* ----------------------------------------------------------------
     Datei hochladen / überschreiben.
     ---------------------------------------------------------------- */
  function spUploadFile(folderServerRelativeUrl, fileName, body) {
    return spGetDigest().then(function (digest) {
      var url = SP_SITE_URL +
        "/_api/web/GetFolderByServerRelativeUrl('" + spEnc(folderServerRelativeUrl) +
        "')/Files/Add(url='" + encodeURIComponent(fileName) + "',overwrite=true)";
      var payload = (typeof body === "string")
        ? new Blob([body], { type: "application/octet-stream" })
        : body;
      return fetch(url, {
        method: "POST",
        credentials: "include",
        headers: { "Accept": "application/json;odata=verbose", "X-RequestDigest": digest },
        body: payload
      });
    }).then(function (resp) {
      if (!resp.ok) throw new Error("Upload-Fehler " + resp.status + ": " + fileName);
    });
  }

  /* ----------------------------------------------------------------
     Ordner anlegen (idempotent – 400 = existiert bereits).
     ---------------------------------------------------------------- */
  function spEnsureFolder(serverRelativeUrl) {
    return spGetDigest().then(function (digest) {
      return fetch(SP_SITE_URL + "/_api/web/folders", {
        method: "POST",
        credentials: "include",
        headers: {
          "Accept": "application/json;odata=verbose",
          "Content-Type": "application/json;odata=verbose",
          "X-RequestDigest": digest
        },
        body: JSON.stringify({ "__metadata": { "type": "SP.Folder" }, "ServerRelativeUrl": serverRelativeUrl })
      });
    }).then(function (resp) {
      if (!resp.ok && resp.status !== 400) {
        throw new Error("Ordner-Fehler " + resp.status + ": " + serverRelativeUrl);
      }
    });
  }

  /* ----------------------------------------------------------------
     File-System-Access-API-Emulation.
     Damit können spätere Admin-Schreibwege (AP5/AP6) denselben Code
     wie die bisherige showDirectoryPicker()-Logik nutzen.
     ---------------------------------------------------------------- */
  function SpFileHandle(folderUrl, fileName) {
    this._folderUrl = folderUrl;
    this._fileName = fileName;
    this.name = fileName;
  }
  SpFileHandle.prototype.getFile = function () {
    var self = this;
    return spReadFileText(self._folderUrl + "/" + self._fileName).then(function (text) {
      return {
        text: function () { return Promise.resolve(text); },
        arrayBuffer: function () { return Promise.resolve(new TextEncoder().encode(text).buffer); }
      };
    });
  };
  SpFileHandle.prototype.createWritable = function () {
    var self = this;
    return Promise.resolve({
      write: function (data) { self._pending = data; return Promise.resolve(); },
      close: function () { return spUploadFile(self._folderUrl, self._fileName, self._pending); }
    });
  };

  function SpDirectoryHandle(folderUrl, name) {
    this._folderUrl = folderUrl;
    this.name = name;
  }
  SpDirectoryHandle.prototype.getFileHandle = function (fileName, opts) {
    opts = opts || {};
    var handle = new SpFileHandle(this._folderUrl, fileName);
    if (opts.create) return Promise.resolve(handle);
    var folderUrl = this._folderUrl;
    return spReadFileText(folderUrl + "/" + fileName).then(function () { return handle; });
  };
  SpDirectoryHandle.prototype.getDirectoryHandle = function (subName, opts) {
    opts = opts || {};
    var subUrl = this._folderUrl + "/" + subName;
    var p = opts.create ? spEnsureFolder(subUrl) : Promise.resolve();
    return p.then(function () { return new SpDirectoryHandle(subUrl, subName); });
  };

  /* ----------------------------------------------------------------
     Drop-in-Ersatz für die FS-Access-API-Funktionen (1:1).
     ---------------------------------------------------------------- */
  function fsApiAvailable() { return true; }

  function pickFolder() {
    return spGetDigest().then(function () {
      try { localStorage.setItem("ip67-sp-connected", "1"); } catch (_) {}
      return new SpDirectoryHandle(SP_FOLDER, SP_NAME);
    }).catch(function (e) {
      throw new Error(
        "SharePoint nicht erreichbar.\n" +
        "Bitte prüfen: (1) Netzwerkverbindung, (2) Am Domänen-PC angemeldet,\n" +
        "(3) App über die SharePoint-URL geöffnet (nicht per Doppelklick).\n" +
        "Details: " + e.message);
    });
  }

  function tryRestoreFolder() {
    try { if (!localStorage.getItem("ip67-sp-connected")) return Promise.resolve(null); }
    catch (_) { return Promise.resolve(null); }
    return Promise.resolve(new SpDirectoryHandle(SP_FOLDER, SP_NAME));
  }

  function ensurePermission() { return Promise.resolve(true); }

  /* ================================================================
     DATEN-VORLADEN (fetch statt JS-Variablen)
     ----------------------------------------------------------------
     Lädt jede Datendatei als .json (Same-Origin, relativ zum .aspx).
     Erfolg  -> entsprechendes window-Global wird ersetzt.
     Fehler  -> im 'auto'-Modus bleibt das eingebettete Global stehen.
     ================================================================ */
  /* v8.4: sidebar-data.json ist ENTFALLEN. Die Themenstruktur wird nicht
     mehr aus einer gepflegten Datei geladen, sondern bei jedem Start live
     aus dem SharePoint-Ordner „Ablage" aufgebaut
     (infopool67_livetree_v8.js -> window.sidebarInitData). */
  /* v8.4: EINE Quelle je Datenbestand – ausschliesslich JSON.
     Die frueheren <script>-Globals (search-index.js, mitarbeiterliste.js,
     ip67-data.js) sind entfallen. Sie waren eine zweite Fassung derselben
     Daten, liefen auseinander und mussten bei jeder Aenderung mitgepflegt
     werden. Ist SharePoint nicht erreichbar, gibt es bewusst KEINEN
     Ersatzbestand: lieber eine klare Fehlermeldung als stille Altdaten. */
  var DATA_TARGETS = [
    { json: "search-index.json",   global: "searchIndexData",         expect: "object" },
    { json: "Mitarbeiterliste.json", global: "__ip67_mitarbeiterliste", expect: "array" }
  ];

  function _typeOk(val, expect) {
    if (expect === "array")  return Array.isArray(val);
    if (expect === "object") return val && typeof val === "object" && !Array.isArray(val);
    return true;
  }

  function _fetchJson(relPath) {
    return fetch(encodeURI(relPath), {
      credentials: "include",
      headers: { "Accept": "application/json, text/plain, */*" }
    }).then(function (resp) {
      if (!resp.ok) { var e = new Error("HTTP " + resp.status); e.status = resp.status; throw e; }
      return resp.arrayBuffer();
    }).then(function (buf) {
      // AP2: SharePoint setzt im HTTP-Header teils Windows-1252. resp.text() würde
      //      Umlaute zerstören (KÃ¶ln statt Köln). Daher Bytes holen und EXPLIZIT
      //      als UTF-8 dekodieren; ein evtl. vorhandenes BOM danach entfernen.
      var txt = new TextDecoder("utf-8").decode(buf);
      return JSON.parse(txt.replace(/^\uFEFF/, ""));
    });
  }

  /* v8.4: Zweiter Weg über die SharePoint-REST-API.
     Der direkte fetch auf die .json scheitert in dieser Umgebung teils,
     weil SharePoint bei fehlender Datei eine HTML-Fehlerseite mit Status
     200 ausliefert („Unexpected token <"). GetFileByServerRelativeUrl
     liefert dagegen einen sauberen 404 bzw. den echten Dateiinhalt. */
  function _fetchJsonViaRest(relPath) {
    return spReadFileText(SP_FOLDER + "/" + relPath).then(function (txt) {
      return JSON.parse(String(txt).replace(/^\uFEFF/, ""));
    });
  }

  /* Probiert alle Kandidatenpfade, je Pfad erst per fetch, dann per REST.
     Erst wenn ALLE scheitern, wird ein Fehler gemeldet – so entsteht keine
     rote Konsolenmeldung, nur weil die Datei woanders liegt. */
  function _loadTarget(t) {
    var candidates = [t.json].concat(t.alt || []);
    var errors = [];

    function tryAt(i) {
      if (i >= candidates.length) {
        var err = new Error("nicht gefunden unter: " + candidates.join(" | ") +
                            " (" + errors.join("; ") + ")");
        err.status = 404;
        return Promise.reject(err);
      }
      var path = candidates[i];
      return _fetchJson(path).catch(function (e1) {
        return _fetchJsonViaRest(path).catch(function (e2) {
          errors.push(path + ": " + e1.message + "/" + e2.message);
          return tryAt(i + 1);
        });
      });
    }
    return tryAt(0);
  }

  function ensureDataLoaded() {
    if (DATA_SOURCE === "globals") return Promise.resolve();
    return Promise.all(DATA_TARGETS.map(function (t) {
      var hadGlobal = _typeOk(window[t.global], t.expect);
      return _loadTarget(t).then(function (data) {
        if (_typeOk(data, t.expect)) {
          window[t.global] = data;
          console.info("[Storage] geladen via fetch:", t.json);
        } else {
          console.warn("[Storage] unerwarteter Typ in", t.json, "- behalte eingebettetes Global");
        }
      }).catch(function (e) {
        if (DATA_SOURCE === "json") {
          console.error("[Storage] Pflicht-JSON nicht ladbar:", t.json, e.message);
        } else if (hadGlobal) {
          console.info("[Storage] kein", t.json, "(" + (e.status || e.message) +
                       ") – nutze eingebettetes window." + t.global + " [Übergangsmodus]");
        } else {
          console.warn("[Storage] weder", t.json, "noch window." + t.global, "verfügbar");
        }
      });
    })).then(function () { /* immer erfüllen, nie ablehnen */ });
  }

  /* ----------------------------------------------------------------
     Sofort beim Parsen starten; der Core wartet im Bootstrap darauf.
     ---------------------------------------------------------------- */
  window.IP67_DATA_READY = ensureDataLoaded();

  /* ----------------------------------------------------------------
     Öffentliche Schnittstelle.
     ---------------------------------------------------------------- */
  window.IP67Storage = {
    SP_SITE_URL: SP_SITE_URL,
    SP_FOLDER: SP_FOLDER,
    SP_ABLAGE: SP_ABLAGE,
    SP_NAME: SP_NAME,
    DATA_SOURCE: DATA_SOURCE,
    spEnc: spEnc,
    spGetDigest: spGetDigest,
    spReadFileText: spReadFileText,
    spUploadFile: spUploadFile,
    spEnsureFolder: spEnsureFolder,
    SpDirectoryHandle: SpDirectoryHandle,
    SpFileHandle: SpFileHandle,
    fsApiAvailable: fsApiAvailable,
    pickFolder: pickFolder,
    tryRestoreFolder: tryRestoreFolder,
    ensurePermission: ensurePermission,
    ensureDataLoaded: ensureDataLoaded
  };

  console.info("[Info-Pool 67] storage.js (AP1) bereit · Modus:", DATA_SOURCE,
               "· Ziel:", SP_NAME);
})();
