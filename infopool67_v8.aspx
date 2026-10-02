<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Info-Pool 67 · Amt für Landschaftspflege und Grünflächen · Stadt Köln</title>
<link rel="stylesheet" href="infopool67_v8.css?v=10.6" charset="UTF-8">
<!-- v10.6 · Vorabanzeige Hell/Dunkel, noch VOR dem ersten Zeichnen.

     BEFUND (v10.4): Hier stand der zuletzt WIRKSAME Zustand
     (ip67_theme_last). Wer tagsüber hell arbeitete und am Abend neu
     öffnete, bekam deshalb zuerst die helle Fassung zu sehen; erst die
     Glue-Schicht schaltete Sekundenbruchteile später auf dunkel um.

     ÄNDERUNG (v10.5): Gespeichert wird nicht mehr der Zustand, sondern
     die GRENZE. Die Glue-Schicht legt die von ihr berechneten
     Sonnenzeiten für Köln als Tageszeit in ip67_theme_sonne ab; hier
     wird nur noch verglichen, nicht gerechnet.

     BEFUND (v10.5 · I17): s.d (das Datum, für das die Grenzen gelten)
     wurde beim Schreiben abgelegt, hier beim Lesen aber nie geprüft.
     Nach einer Pause – z. B. über Nacht – galten so die GESTRIGEN
     Sonnenzeiten für heute weiter. Morgens, kurz vor dem tatsächlichen
     heutigen Sonnenaufgang, lieferte der Vergleich mit der gestrigen
     (fast, aber nicht exakt gleichen) Aufgangszeit "dunkel"; die
     Glue-Schicht rechnete Sekundenbruchteile später die echten
     heutigen Zeiten nach und sprang – je nach Differenz – auf "hell".
     Also dasselbe Aufblitzen wie beim I5/v10.4-Fehler, nur in der
     Gegenrichtung und nur nach längerer Pause sichtbar.

     ÄNDERUNG: s.d wird gegen das heutige Datum geprüft. Nur ein
     TAGESGLEICHER Eintrag zählt als Vorabanzeige; ein Eintrag von
     gestern (oder älter) ist kein Rückfall auf Verdacht, sondern wird
     wie "nicht vorhanden" behandelt – die Kette fällt dann auf
     ip67_theme_last zurück, wie beim allerersten Besuch auch.

     WAS BLEIBT: Es gibt weiterhin genau EINE Stelle, die den
     Sonnenstand bestimmt (infopool67_v8.js, Abschnitt 9b, Verfahren
     nach NOAA) – die Mechanik ist nicht durch eine einfache
     Toggle-Speicherung ersetzt. Die Handschaltung (ip67_theme_override)
     hat weiterhin Vorrang. -->
<script charset="UTF-8">
(function(){try{
  var t=null,n=Date.now();
  var ov=JSON.parse(localStorage.getItem('ip67_theme_override')||'null');
  if(ov&&(ov.theme==='dark'||ov.theme==='light')&&(!ov.bis||n<ov.bis))t=ov.theme;
  if(!t){
    var s=JSON.parse(localStorage.getItem('ip67_theme_sonne')||'null');
    var heute=new Date(),htag=heute.getFullYear()+'-'+(heute.getMonth()+1)+'-'+heute.getDate();
    if(s&&s.d===htag&&typeof s.auf==='number'&&typeof s.unter==='number'){
      var ms=((heute.getHours()*60+heute.getMinutes())*60+heute.getSeconds())*1000;
      t=(ms>=s.auf&&ms<s.unter)?'light':'dark';
    }
  }
  if(!t){var l=localStorage.getItem('ip67_theme_last');
         if(l==='dark'||l==='light')t=l;}
  if(t)document.documentElement.setAttribute('data-theme',t);
}catch(e){}})();
</script>
</head>
<body>

<!-- v9.9 · AP1: Sprungmarke. Erste Station der Tabulatortaste; sichtbar
     nur bei Tastaturfokus. Ohne sie muesste sich eine blinde Nutzerin bei
     jedem Seitenaufruf erneut durch Kopfzeile und Chips arbeiten. -->
<a class="skip-link" href="#hauptinhalt">Zum Inhalt springen</a>

<div class="progress" aria-hidden="true"><div class="bar" id="progressBar"></div></div>

<header class="top" id="topBar">
  <div class="brand"><span class="dot">67</span> Info-Pool</div>
  <div class="top-right">
    <!-- v8.9: nur im Adminmodus sichtbar (Alt+Umschalt+A) -->
    <button type="button" class="admin-link" id="settingsTop" hidden>
      <span aria-hidden="true">⚙</span> Einstellungen</button>
    <!-- v9.5: Hell/Dunkel. Ohne Klick folgt die Ansicht Sonnenauf-/untergang
         (Köln); ein Klick setzt sich bis zum nächsten Sonnenereignis darüber. -->
    <button type="button" class="theme-btn" id="themeToggle"
            title="Ansicht umschalten" aria-label="Zwischen heller und dunkler Ansicht wechseln">
      <span class="tb-ico" id="themeIco" aria-hidden="true">☀</span><span class="tb-txt" id="themeTxt">Hell</span>
    </button>
  </div>
</header>

<main class="app" id="hauptinhalt">

  <section class="hero">
    <div class="searchZone" id="searchZone">
      <h1>Wonach suchen Sie?</h1>
      <p class="lead">Alle Dokumente, Personen und Themen aus Amt 67 – an einem Ort.</p>

      <div class="search" id="searchBox">
        <svg class="mag" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
        <!-- v9.9 · AP1: Combobox nach ARIA 1.2. Das Eingabefeld fuehrt, die
             Trefferliste ist ihm ueber aria-controls zugeordnet; die jeweils
             angesteuerte Zeile wird ueber aria-activedescendant benannt,
             ohne dass der Fokus das Feld verlaesst. Nur so bleibt das
             Weitertippen moeglich, waehrend die Liste durchgegangen wird. -->
        <label for="searchInput" class="ip67-sr-only">Suche in Dokumenten, Personen und Themen</label>
        <input id="searchInput" placeholder="z. B. Baumkontrolle, Pflegekonzept, Telefonnummer …" autocomplete="off"
               role="combobox" aria-expanded="false" aria-controls="panel"
               aria-autocomplete="list" aria-haspopup="listbox">
        <!-- v9.7 · Punkt 2: Der Knopf „Suchen" ist entfallen. Die Trefferliste
             erscheint bereits beim Tippen; ein zusätzlicher Knopf hat nur
             dieselbe Suche noch einmal ausgelöst und suggeriert, man müsse
             ihn drücken. Statt seiner steht rechts ein Löschkreuz, das den
             Suchbegriff verwirft, ohne die Liste zu schließen. -->
        <button type="button" class="s-clear" id="searchClear" hidden
                title="Eingabe löschen" aria-label="Eingabe löschen"><span aria-hidden="true">✕</span></button>
        <div class="panel" id="panel" role="listbox" aria-label="Suchergebnisse"></div>
      </div>

      <!-- v9.9 · AP1: Aus <span> wurden Schaltflaechen. Vorher waren die
           drei Einstiege ausschliesslich mit der Maus erreichbar - eine
           Sprachausgabe hat sie als blossen Text vorgelesen. Die Symbole
           sind Zierrat und werden ueberlesen. -->
      <nav class="chips" aria-label="Bereiche">
        <button type="button" class="chip" data-fs="handy"><span class="ci" aria-hidden="true">📞</span>Handyliste<span class="fs" aria-hidden="true">⛶</span></button>
        <button type="button" class="chip" data-fs="org"><span class="ci" aria-hidden="true">🗂️</span>Organigramm<span class="fs" aria-hidden="true">⛶</span></button>
        <button type="button" class="chip" data-fs="inhalte"><span class="ci" aria-hidden="true">📚</span>Inhalte<span class="cnew" id="chipNeuBadge" hidden></span><span class="fs" aria-hidden="true">⛶</span></button>
      </nav>

    </div>

    <!-- v9.8 · „Neu seit Ihrem letzten Besuch“ sitzt jetzt IM Hero,
         direkt unter den Chips – vorher stand der Kasten unterhalb des
         100vh hohen Hero und lag damit immer unter der Bildkante; kaum
         jemand hat ihn je gesehen.
         Wichtig: der Kasten bleibt AUSSERHALB von .searchZone. Das
         Trefferpanel positioniert sich absolut gegen .searchZone
         (top: calc(100% + 14px)); läge der Kasten darin, würde die
         Trefferliste um dessen Höhe nach unten rutschen.
         Während einer laufenden Suche wird er ausgeblendet (CSS,
         body.searching) – dort gehört die Trefferliste hin. -->
    <section class="neu-sec" id="neuSec" hidden></section>

    <!-- v9.9 · AP1: Ansage der Trefferzahl. Optisch nicht vorhanden; die
         Sprachausgabe liest den Text hier vor, sobald er sich aendert.
         Ohne diese Zeile lief die Suche fuer eine blinde Nutzerin voellig
         lautlos ab - es aenderte sich nur der Bildschirm. -->
    <p id="suchStatus" class="ip67-sr-only" role="status" aria-live="polite" aria-atomic="true"></p>
  </section>

  <!-- v8.8 · Punkt 1: Diese Sektion ist auf der Startseite ausgeblendet.
       Der Einstieg laeuft ausschliesslich ueber den Chip „Inhalte" – zwei
       Wege zur selben Struktur haben nur verwirrt. Das Markup bleibt
       stehen, weil der Viewer darin liegt; die Glue-Schicht holt ihn beim
       Start heraus und haengt ihn direkt an <body>. -->
  <section class="section section--wide" id="browseSection" hidden>
    <div class="section-head reveal"><h2>Themen durchstöbern</h2><a href="#" id="ganzeStruktur">Ganze Struktur öffnen ⛶</a></div>
    <div class="browse">
      <aside class="nav-card reveal">
        <div class="nc-head"><span class="t">Themenfelder</span></div>
        <div class="nav-sec">Vorschriften</div>
        <div class="nav-item active" data-doc="0">
          <svg class="ni-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
          <span>Dienstanweisungen</span><span class="count">12</span>
        </div>
        <div class="nav-item child" data-doc="1"><span>Baumkontrolle 2026</span><span class="count">3</span></div>
        <div class="nav-item child" data-doc="2"><span>Verkehrssicherung</span><span class="count">5</span></div>
        <div class="nav-sec">Grünpflege</div>
        <div class="nav-item" data-doc="3">
          <svg class="ni-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="M12 2C7 7 7 13 12 22 17 13 17 7 12 2z"/></svg>
          <span>Pflegekonzepte</span><span class="count">18</span>
        </div>
        <div class="nav-item" data-doc="4">
          <svg class="ni-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/></svg>
          <span>Standortlisten</span><span class="count">7</span>
        </div>
      </aside>

      <div class="viewer reveal" id="viewer">
        <div class="v-head">
          <svg class="mag" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--muted)" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
          <span class="vt" id="vTitle">Dienstanweisung Baumkontrolle 2026</span>
          <span class="vmeta" id="vMeta">PDF · 14 Seiten</span>
          <!-- v9.7 · Punkt 3: Herunterladen als ausdrücklicher Schritt. Im
               Betrachter wird nur gelesen; wer die Datei bearbeiten will,
               holt sie sich bewusst. -->
          <!-- v10.0 · AP3: Umschalter zur Textfassung aus dem Volltextindex.
               Der PDF-Betrachter malt die Seiten auf ein <canvas> – für eine
               Sprachausgabe ist das eine leere Fläche. Die Beschriftung des
               Knopfes wechselt je nach Ansicht; sichtbar wird er nur, wenn das
               Format überhaupt eine Textfassung hergibt. -->
          <button type="button" class="v-txt" id="vTextBtn" hidden aria-pressed="false" title="Textfassung für die Sprachausgabe"><span aria-hidden="true">📖</span> Als Text</button>
          <button type="button" class="v-dl" id="vDownload" title="Datei herunterladen"><span aria-hidden="true">⤓</span> Herunterladen</button>
          <!-- v9.7 · Punkt 5: Hieß „Vollbild/Verkleinern“ und war ein
               Umschalter. Der Betrachter existiert aber nur noch als
               Vollbild – „Verkleinern“ führte ihn also in einen Zustand,
               den es gar nicht gibt. Jetzt dieselbe Beschriftung wie bei
               Handyliste und Organigramm: ✕ Schließen. -->
          <button type="button" class="fs-close v-close" id="vClose" title="Vorschau schließen"><span aria-hidden="true">✕</span> Schließen</button>
        </div>
        <div class="v-hits" id="vHits" hidden>
          <span class="vh-term" id="vhTerm"></span>
          <span class="vh-cnt" id="vhCnt"></span>
          <button type="button" class="vh-nav" id="vhPrev" title="Vorheriger Treffer" aria-label="Vorheriger Treffer"><span aria-hidden="true">◀</span></button>
          <button type="button" class="vh-nav" id="vhNext" title="Nächster Treffer" aria-label="Nächster Treffer"><span aria-hidden="true">▶</span></button>
          <button type="button" class="vh-x" id="vhOff" title="Markierung ausblenden" aria-label="Markierung ausblenden"><span aria-hidden="true">✕</span></button>
        </div>
        <div class="v-snip" id="vSnip" hidden></div>
        <div class="v-gilt" id="vGilt" hidden></div>
        <div class="v-skel" id="vSkel" aria-hidden="true">
          <div class="skel sk" style="width:80%;height:15px;margin-bottom:12px"></div>
          <div class="skel sk" style="width:100%;height:11px;margin-bottom:12px"></div>
          <div class="skel sk" style="width:96%;height:11px;margin-bottom:12px"></div>
          <div class="skel sk" style="width:90%;height:11px;margin-bottom:12px"></div>
          <div class="skel sk" style="width:70%;height:11px"></div>
        </div>
        <div class="v-body" id="vBody" style="display:none">
          <h3 id="vbTitle"></h3><p id="vbP1"></p><p id="vbP2"></p>
        </div>
      </div>
    </div>
  </section>

  <footer>Amt für Landschaftspflege und Grünflächen · Stadt Köln · Info-Pool 67 · v10.6</footer>
  <!-- v9.5 · Wasserzeichen: bewusst sehr zurückhaltend. Jahreszahl hier
       ändern, falls ein anderes Entstehungsjahr gewünscht ist. -->
  <div class="wm" aria-hidden="true">2026 · Michelis</div>
</main>

<div class="viewer-backdrop" id="viewerBackdrop"></div>

<div class="fs" id="fsOverlay" role="dialog" aria-modal="true" aria-labelledby="fsTitle">
  <div class="fs-head"><h2 class="fst" id="fsTitle"></h2><button type="button" class="fs-close" id="fsClose"><span aria-hidden="true">✕</span> Schließen</button></div>
  <div class="fs-body" id="fsBody"></div>
</div>

<!-- v9.5 · Hilfe: Menü öffnet bei Mauskontakt (und per Klick/Tastatur).
     Die automatische Einführung beim Programmstart ist entfallen – Hilfe
     kommt jetzt ausschließlich, wenn sie gesucht wird. -->
<div class="help-wrap" id="helpWrap">
  <div class="help-menu" id="helpMenu" role="menu" aria-labelledby="helpFab">
    <div class="hm-t">Einführung anhören</div>
    <button type="button" class="hm-item" role="menuitem" data-help="audio-anwender">
      <span class="hi" aria-hidden="true">🔊</span><span class="hx">Einführung Anwender<span class="hs">Rundgang durch den Info-Pool</span></span>
    </button>
    <button type="button" class="hm-item" role="menuitem" data-help="audio-admin">
      <span class="hi" aria-hidden="true">🔊</span><span class="hx">Einführung Admin<span class="hs">Ablage, Index und Einstellungen</span></span>
    </button>
    <button type="button" class="hm-item is-stop" role="menuitem" data-help="stop" hidden>
      <span class="hi" aria-hidden="true">⏹</span><span class="hx">Wiedergabe beenden</span>
    </button>
    <div class="hm-sep"></div>
    <div class="hm-t">Handbuch öffnen</div>
    <button type="button" class="hm-item" role="menuitem" data-help="buch-anwender">
      <span class="hi" aria-hidden="true">📕</span><span class="hx">Handbuch Anwender<span class="hs">Zum Nachlesen · aus SharePoint</span></span>
    </button>
    <button type="button" class="hm-item" role="menuitem" data-help="buch-admin">
      <span class="hi" aria-hidden="true">📗</span><span class="hx">Handbuch Admin<span class="hs">Zum Nachlesen · aus SharePoint</span></span>
    </button>
  </div>
  <button class="help-fab" id="helpFab" title="Hilfe: Einführung und Handbuch"
          aria-haspopup="true" aria-expanded="false">?</button>
</div>

<!-- ============================================================
     Versteckter Engine-Host – hier bootet die unveränderte
     Core-Engine (renderTree, Boxen, Frame, Suchergebnis-Seite).
     Unsichtbar (#ip67-engine-host{display:none}); die sichtbare
     v8.2-Oberfläche rendert die Glue-Schicht aus denselben Daten.
     ============================================================ -->
<div id="ip67-engine-host" hidden>
  <input id="sidebarSearch" type="search">
  <button id="searchClearBtn"></button>
  <div id="searchHistoryDropdown"></div>
  <div id="sidebarContent"></div>

  <div id="welcomeScreen"></div>
  <div id="frameWrapper">
    <div id="breadcrumb"></div>
    <div id="frameUrlBar"></div>
    <button id="frameDownloadBtn"></button>
    <button id="frameSimilarBtn"></button>
    <div id="viewerSimilarPanel"></div>
    <iframe id="mainFrame" title="Dokumentvorschau"></iframe>
  </div>

  <div id="searchResultsPage">
    <h2 id="sphQueryTitle"></h2>
    <div id="sphStats"></div>
    <div id="searchResultsList"></div>
  </div>
  <div id="searchJumpBar"><span id="sjbPageInfo"></span><span id="sjbTerms"></span></div>

  <div id="newDocsBox"><div id="newDocsList"></div></div>
  <div id="recentDocsBox"><div id="recentDocsList"></div></div>

  <span id="themeIcon"></span>
  <div id="startAudioBackdrop"></div>
  <div id="watcherLog"></div>
</div>

<!-- Engine-Modals/Toast: außerhalb des Hosts, damit .show greift; per CSS ins v8.2-Theme gebracht -->
<div id="indexModal" class="ip67-modal">
  <div class="modal-card">
    <div class="modal-head">
      <h3 id="indexModalTitle">Volltextindex</h3>
      <button class="modal-x" onclick="IP67.closeIndexModal()" title="Schließen">×</button>
    </div>
    <div id="indexModalBody"></div>
  </div>
</div>
<div id="adminModal" class="ip67-modal">
  <div class="modal-card">
    <div class="modal-head">
      <h3 id="modalTitle">Einstellungen</h3>
      <button class="modal-x" onclick="IP67.closeModal()" title="Schließen">×</button>
    </div>
    <div id="modalBody"></div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="IP67.closeModal()">Schließen</button>
      <button class="btn btn-primary" id="modalSaveBtn" style="display:none">Speichern</button>
    </div>
  </div>
</div>
<div id="statsModal" class="ip67-modal">
  <div id="statsModalBody">
    <div id="statsListLocal"></div>
    <div id="statsListShared"></div>
    <label><input type="checkbox" id="statsShareToggle"> Statistik teilen</label>
  </div>
</div>
<div id="toast" role="status" aria-live="polite" aria-atomic="true"><span id="toastMsg"></span></div>

<!-- 1) Daten als eingebettete Globals (file://-Fallback; auf SharePoint lädt storage_v8 die .json) -->
<!-- v8.4: search-index.js ist ENTFALLEN. Die Datei enthielt einen alten
     Indexstand, der bei jedem Start erneut eingelesen wurde und dadurch
     dauerhaft verwaiste Einträge erzeugte. Der zentrale Index kommt jetzt
     ausschließlich aus search-index.json (geladen von storage_v8.js). -->
<!-- 1b) Reichhaltige Personendaten (orga/zustaendigkeit/handynummer/istFuehrung/intranetUrl) für Handyliste + Organigramm -->
<!-- 2) Storage: startet IP67_DATA_READY (JSON-fetch, sonst Globals) -->
<script src="storage_v8.js?v=10.6" charset="UTF-8"></script>
<!-- 2b) LiveTree: baut die Themenstruktur bei jedem Start aus dem SharePoint-Ordner „Ablage" -->
<script src="infopool67_livetree_v8.js?v=10.6" charset="UTF-8"></script>
<!-- 3) Core-Engine: bootet in den versteckten Host, lädt index lazy -->
<script src="infopool67_core_v8.js?v=10.6" charset="UTF-8"></script>
<!-- 3b) Admin-Helfer (Speicher-Ordner + Download für den Volltextindex).
         MUSS nach dem Core stehen: benötigt window.IP67._internal. -->
<script src="infopool67_admin_v8.js?v=10.6" charset="UTF-8"></script>
<!-- 3c) Eigener PDF-Betrachter (PDF.js). Laedt die Bibliothek aus dem
         Unterordner pdfjs/ erst beim ersten PDF nach - die Startseite
         bleibt dadurch unveraendert schnell. -->
<script src="infopool67_pdf_v8.js?v=10.6" charset="UTF-8"></script>
<!-- 4) Glue-Schicht: rendert die v8.2-Oberfläche aus echten Daten, delegiert an die Engine -->
<script src="infopool67_v8.js?v=10.6" charset="UTF-8"></script>
<!-- 5) Index-Abgleich: vergleicht Ablage und Volltextindex, räumt verwaiste
        Einträge auf und liest Lücken gedrosselt im Hintergrund nach. -->
<script src="infopool67_indexsync_v8.js?v=10.6" charset="UTF-8"></script>
<!-- 6) Bereitstellen: fragt Schreibberechtigte, ob neue Dokumente fuer
        alle durchsuchbar gemacht werden sollen, und legt search-index.json
        anschliessend selbsttaetig im Infopool-Ordner ab.
        MUSS nach indexsync stehen: nutzt dessen analyse(). -->
<!-- 6) Prüflauf: Lesbarkeit der Dokumente für Sprachausgabe -->
<script src="infopool67_a11ycheck_v8.js?v=10.6" charset="UTF-8"></script>
<script src="infopool67_indexpush_v8.js?v=10.6" charset="UTF-8"></script>
</body>
</html>
