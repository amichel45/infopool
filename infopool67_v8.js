/* ================================================================
   Info-Pool 67 · v8.2 · infopool67_v8.js  (Glue-Schicht)
   ----------------------------------------------------------------
   Bindet das v8.2-Mockup-Layout an die ECHTEN Daten und Module:
     · Hero-Suche        ← searchIndexData (+ sidebarInitData für Titel)
     · „Themen durchstöbern" / Nav-Card ← sidebarInitData
     · Viewer            ← öffnet die echte Datei (href) in einem iframe
     · Chips Handy/Organigramm ← __ip67_mitarbeiterliste
     · Chips Organigramm/Zuständigkeiten ← eingebundene Bestandsseiten
     · Admin / Volltext-Index ← delegiert an die Core-Engine (IP67.openIndexModal)

   Die unveränderte Core-Engine (infopool67_core_v8.js) bootet parallel
   in den versteckten Host (#ip67-engine-host) und stellt die Module
   (Index/Admin) bereit. Diese Schicht rendert die sichtbare Oberfläche.
   ================================================================ */
(function () {
  'use strict';

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---- Konfiguration ---- */
  var ORG_PAGE = 'organigramm.html'; // Fallback-Link auf die klassische Vollseite

  /* ================================================================
     1. Helfer (esc / Highlight / Snippet)
     ================================================================ */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }
  function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }
  function hl(text, q) {
    var e = esc(text);
    if (!q) return e;
    var re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
    return e.replace(re, '<span class="hl">$1</span>');
  }
  function snippet(text, q, len) {
    len = len || 90;
    if (!q) return esc(String(text).slice(0, len)) + '…';
    var i = String(text).toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return esc(String(text).slice(0, len)) + '…';
    var start = Math.max(0, i - 30);
    return (start > 0 ? '…' : '') + hl(String(text).slice(start, start + len), q) + '…';
  }

  /* ================================================================
     2. Daten aus den echten Globals ableiten
     ================================================================ */
  var byId = {};
  var docs = [];          // durchsuchbare Dokumente (analog Mockup-„docs")
  var sessionRecent = []; // zuletzt geöffnete Doc-Indizes (Session)

  function kidsOf(n) { return n.children || n.items || null; }

  function flatten(nodes, parentId) {
    (nodes || []).forEach(function (n) {
      if (!n || typeof n !== 'object') return;
      if (n.id) {
        byId[n.id] = n;
        /* v8.7: Elternkette merken. Sie ist die Grundlage dafuer, dass
           Gueltigkeits- und Zustaendigkeitsangaben an einem ORDNER
           gepflegt werden koennen und sich auf alle Dokumente darin
           vererben - sonst muesste man jede einzelne Datei pflegen. */
        if (parentId) _parentOf[n.id] = parentId;
      }
      var k = kidsOf(n);
      if (k && k.length) flatten(k, n.id || parentId);
    });
  }

  function badge(fmt) {
    fmt = String(fmt || '').toLowerCase();
    if (fmt === 'pdf') return 'pdf';
    if (fmt === 'doc' || fmt === 'docx') return 'docx';
    if (fmt === 'xls' || fmt === 'xlsx') return 'xls';
    return 'pdf';
  }
  function metaLine(e) {
    var fmt = e.format ? String(e.format).toUpperCase() : 'Datei';
    if (e.totalPages) return fmt + ' · ' + e.totalPages + (e.totalPages === 1 ? ' Seite' : ' Seiten');
    if (e.size)       return fmt + ' · ' + Math.max(1, Math.round(e.size / 1024)) + ' KB';
    return fmt;
  }
  function realHref(h) { return (h && h !== '#' && h !== '#home') ? h : ''; }

  function buildDocs() {
    docs = [];
    var idx = window.searchIndexData || {};
    Object.keys(idx).forEach(function (id) {
      var e = idx[id] || {};
      var node = byId[id];
      docs.push({
        id: id,
        t: (node && node.title) || e.fileName || id,
        m: metaLine(e),
        ft: badge(e.format),
        href: realHref(node && node.href),
        plain: e.text || '',
        /* v8.9: Seitenumbrueche aus dem Volltextindex. Sie sind die
           Grundlage dafuer, dass die Anwendung bei PDFs wenigstens die
           Trefferseiten benennen und anspringen kann. */
        breaks: Array.isArray(e.pageBreaks) ? e.pageBreaks : null,
        term: ''
      });
    });
  }

  function docIndexByHref(href) {
    for (var i = 0; i < docs.length; i++) if (docs[i].href && docs[i].href === href) return i;
    return -1;
  }

  /* ================================================================
     3. Suchpanel (Hero) – über die echten docs
     ================================================================ */
  var panel, input, box;

  function rowHTML(i, sub) {
    var d = docs[i];
    /* Dezenter Punkt, wenn die fachliche Pruefung ueberfaellig ist -
       der Treffer bleibt nutzbar, aber man sieht die Unsicherheit. */
    var stale = (giltStatus(d.id).st === 'due')
      ? '<span class="stale" title="Prüfung überfällig"></span>' : '';
    return '<div class="doc" data-doc="' + i + '" role="option" aria-selected="false"' +
      ' id="opt-d' + i + '" tabindex="-1">' +
      '<div class="ftype ' + d.ft + '">' + d.ft.toUpperCase().slice(0, 3) + '</div>' +
      '<div class="meta"><div class="name">' + esc(d.t) + stale + '</div>' +
      '<div class="sub">' + sub + '</div></div></div>';
  }
  function skeleton(n) {
    var h = '';
    for (var i = 0; i < n; i++) {
      h += '<div class="skel-row"><div class="skel box"></div>' +
           '<div style="flex:1"><div class="skel l1"></div><div class="skel l2"></div></div></div>';
    }
    return h;
  }
  function recentIdx() {
    if (sessionRecent.length) return sessionRecent.slice(0, 5);
    var out = [];
    for (var i = 0; i < docs.length && out.length < 3; i++) if (docs[i].href) out.push(i);
    return out;
  }
  /* ----------------------------------------------------------------
     v8.5 · Such-Modus: Seite sperren, Panel exakt einpassen (Punkt 2)
     ----------------------------------------------------------------
     Solange die Suche offen ist, wird die gesamte .aspx-Seite fixiert.
     Ohne das wandert beim Scrollen im Trefferpanel die Seite darunter
     weiter, sobald das Panel keine eigene Scrollbar hat oder deren Ende
     erreicht ist (Scroll-Chaining). Zusaetzlich sorgt
     overscroll-behavior:contain im CSS fuer den Fall, dass der Browser
     die Kette schon vorher unterbrechen kann.
     ---------------------------------------------------------------- */
  var _lockY = 0, _locked = false;

  function isSearching() { return document.body.classList.contains('searching'); }

  function lockScroll() {
    if (_locked) return;
    _lockY = window.scrollY || window.pageYOffset || 0;
    /* Breite der Scrollbar ausgleichen, sonst springt das Layout beim
       Sperren um ca. 15px nach rechts. */
    var sbw = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.top = (-_lockY) + 'px';
    if (sbw > 0) document.body.style.paddingRight = sbw + 'px';
    document.body.classList.add('ip67-scrollock');
    _locked = true;
  }

  function unlockScroll() {
    if (!_locked) return;
    document.body.classList.remove('ip67-scrollock');
    document.body.style.top = '';
    document.body.style.paddingRight = '';
    window.scrollTo(0, _lockY);
    _locked = false;
  }

  /* Panelhoehe aus der realen Unterkante der Suchbox ableiten, damit die
     Trefferliste bei gesperrter Seite nie unten aus dem Bild faellt. */
  function measurePanel() {
    if (!box) return;
    var r = box.getBoundingClientRect();
    var platz = Math.max(180, window.innerHeight - r.bottom - 28);
    document.documentElement.style.setProperty('--panelMax', platz + 'px');
  }

  function setzeAufgeklappt(auf) {
    var i = document.getElementById('searchInput');
    if (i) i.setAttribute('aria-expanded', auf ? 'true' : 'false');
  }
  function openSearch() {
    setzeAufgeklappt(true);
    if (!isSearching()) {
      document.body.classList.add('searching');
      lockScroll();
    }
    measurePanel();
  }

  function closeSearch() {
    setzeAufgeklappt(false);
    _aktiv = -1;
    try { setzeActiveDescendant(null); } catch (e) { /* vor der Verdrahtung */ }
    var st = document.getElementById('suchStatus');
    if (st) { st.textContent = ''; _standLetzt = ''; }
    if (!isSearching()) return;
    document.body.classList.remove('searching');
    unlockScroll();
  }

  /* ----------------------------------------------------------------
     v9.7 · Punkt 2: Wann darf ein Klick die Trefferliste schließen?
     ----------------------------------------------------------------
     Bisher schloss JEDER Klick ausserhalb der Suchbox die Liste - also
     auch der Klick auf ein Dokument und jeder Klick IM Betrachter.
     Nach dem Schliessen der Vorschau stand man deshalb wieder vor der
     leeren Startseite und musste den Suchbegriff neu eintippen.
     Jetzt gilt: liegt eine Vollbild-Ebene ueber der Seite (Betrachter
     oder eines der Overlays), bleibt die Suche unberuehrt. Erst ein
     Klick auf die freie Seitenflaeche blendet sie aus.
     ---------------------------------------------------------------- */
  function viewerOffen() {
    var v = document.getElementById('viewer');
    return !!(v && v.classList.contains('fullscreen'));
  }
  function ueberlagert(target) {
    if (viewerOffen()) return true;
    var fs = document.getElementById('fsOverlay');
    if (fs && fs.classList.contains('show')) return true;
    return !!(target && target.closest &&
      target.closest('#viewer,#viewerBackdrop,#fsOverlay,#ip67Push'));
  }

  function showRecent() {
    openSearch();
    panel.dataset.q = '';
    var rec = recentIdx();
    panel.innerHTML = '<div class="p-head"><span class="t">Zuletzt geöffnet</span><span class="cnt">' +
      rec.length + '</span></div>' + skeleton(Math.max(1, rec.length));
    setTimeout(function () {
      if (panel.dataset.q !== '') return;
      if (!rec.length) { panel.innerHTML = '<div class="p-empty">Noch keine zuletzt geöffneten Dokumente.</div>'; return; }
      panel.innerHTML = '<div class="p-head" aria-hidden="true"><span class="t">Zuletzt geöffnet</span><span class="cnt">' +
        rec.length + '</span></div>' + rec.map(function (i) { return rowHTML(i, docs[i].m); }).join('');
      _aktiv = -1;
      setzeActiveDescendant(null);
    }, 300);
  }
  /* ----------------------------------------------------------------
     v8.6 · Personen-Treffer (Punkt 1)
     ----------------------------------------------------------------
     Personen laufen bewusst NICHT ueber den Volltextindex, sondern live
     gegen _peopleCache (dieselbe Quelle, aus der Handyliste UND
     Organigramm gespeist werden). Damit ist jede Aenderung an einer
     Person oder einem Orga-Code sofort in der Suche sichtbar – ohne
     Re-Indizierung, ohne zweiten Datenstand.
     ---------------------------------------------------------------- */
  function searchPeople(q) {
    var L = _peopleCache || [];
    if (!L.length) return [];
    var ql = q.toLowerCase();
    var telQ = ql.replace(/[^0-9]/g, '');
    var out = [];
    L.forEach(function (p) {
      var score = -1;
      var name = (p.name || '').toLowerCase();
      var orga = (p.orga || '').toLowerCase();
      var sg   = (p.sg   || '').toLowerCase();
      var tel  = (p.tel  || '').replace(/[^0-9]/g, '');
      if (name.indexOf(ql) === 0) score = 0;               // Name beginnt mit
      else if (name.indexOf(ql) > 0) score = 1;            // Name enthaelt
      else if (orga.indexOf(ql) === 0) score = 2;          // Orga-Code
      else if (telQ.length >= 3 && tel.indexOf(telQ) >= 0) score = 3;
      else if (sg.indexOf(ql) >= 0) score = 4;             // Zustaendigkeit
      else if (orga.indexOf(ql) >= 0) score = 5;
      if (score >= 0) out.push({ p: p, s: score });
    });
    out.sort(function (a, b) {
      return a.s - b.s || a.p.name.localeCompare(b.p.name, 'de');
    });
    return out.slice(0, 12).map(function (x) { return x.p; });
  }

  function initials(name) {
    var parts = String(name || '').split(/[,\s]+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }

  var _optPid = 0;
  function personRowHTML(p, q) {
    var sub = [];
    if (p.orga) sub.push('<span class="pr-orga">' + hl(p.orga, q) + '</span>');
    if (p.sg)   sub.push(esc(p.sg));
    var tel = p.tel
      ? '<a class="pr-tel mono" href="tel:' + escAttr(p.tel) + '" title="Anrufen">' + hl(p.tel, q) + '</a>'
      : '<span class="pr-tel pr-tel-none">keine Nummer</span>';
    /* v9.9 · AP1: Die Zeile ist die Option; die beiden Knoepfe darin
       bleiben fuer die Maus, sind fuer die Tastatur aber bewusst nicht
       einzeln anspringbar - eine Option darf keine eigenen Bedienelemente
       enthalten, JAWS wuerde sie ohnehin ueberspringen. Die Eingabetaste
       auf der Zeile oeffnet die Handyliste, also das haeufigere Ziel. */
    return '<div class="prow" role="option" aria-selected="false"' +
      ' id="opt-p' + (_optPid++) + '" tabindex="-1">' +
      '<div class="pr-ava">' + esc(initials(p.name)) + '</div>' +
      '<div class="pr-meta"><div class="pr-name">' + hl(p.name, q) + '</div>' +
      '<div class="pr-sub">' + sub.join(' \u00b7 ') + '</div></div>' +
      tel +
      '<div class="pr-acts">' +
        '<button type="button" class="pr-go" data-pfs="handy" data-pq="' + escAttr(p.name) + '">Handyliste</button>' +
        '<button type="button" class="pr-go" data-pfs="org" data-pq="' + escAttr(p.name) + '">Organigramm</button>' +
      '</div></div>';
  }

  /* Overlay oeffnen und dessen Filterfeld vorbelegen. Das Overlay
     rendert asynchron, deshalb wird kurz auf das Feld gewartet. */
  function applyFsFilter(key, q, tries) {
    if (!q) return;
    tries = tries || 0;
    var sel = (key === 'handy') ? '#handyFilter' : '#orgFilter';
    var body = $('#fsBody');
    var el = body ? body.querySelector(sel) : null;
    if (!el) {
      if (tries < 25) setTimeout(function () { applyFsFilter(key, q, tries + 1); }, 60);
      return;
    }
    el.value = q;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function openPersonIn(key, q) {
    if (typeof window.__ip67_openFs !== 'function') return;
    window.__ip67_openFs(key);
    applyFsFilter(key, q);
  }

  var _gapNote = null;

  function runSearch(q) {
    q = String(q || '').trim();
    if (q.length < 2) { showRecent(); return; }
    openSearch();
    panel.dataset.q = q;
    var ql = q.toLowerCase(), titleHits = [], contentHits = [];
    docs.forEach(function (d, i) {
      if (d.t.toLowerCase().indexOf(ql) >= 0) titleHits.push(i);
      else if (d.plain.toLowerCase().indexOf(ql) >= 0) contentHits.push(i);
    });
    titleHits   = titleHits.slice(0, 30);
    contentHits = contentHits.slice(0, 30);
    var peopleHits = searchPeople(q);
    var h = '';
    if (peopleHits.length) {
      h += '<div class="p-group" role="group" aria-label="Personen und Organisation"><div class="p-head" aria-hidden="true"><span class="t">Personen &amp; Organisation</span><span class="cnt">' +
        peopleHits.length + '</span></div>' +
        peopleHits.map(function (p) { return personRowHTML(p, q); }).join('') + '</div>';
    }
    if (titleHits.length) {
      h += '<div class="p-group" role="group" aria-label="Treffer im Titel"><div class="p-head" aria-hidden="true"><span class="t">Treffer im Titel</span><span class="cnt">' +
        titleHits.length + '</span></div>' +
        titleHits.map(function (i) { return rowHTML(i, hl(docs[i].m, q)); }).join('') + '</div>';
    }
    if (contentHits.length) {
      h += '<div class="p-group" role="group" aria-label="Treffer im Inhalt"><div class="p-head" aria-hidden="true"><span class="t">Treffer im Inhalt</span><span class="cnt">' +
        contentHits.length + '</span></div>' +
        contentHits.map(function (i) { return rowHTML(i, snippet(docs[i].plain, q)); }).join('') + '</div>';
    }
    if (!h) {
      /* v8.7: Erfolglose Suche merken. Erst nach kurzer Tippruhe, damit
         Zwischenstaende wie "baumkon" nicht im Protokoll landen. */
      clearTimeout(_gapNote);
      _gapNote = setTimeout(function () {
        if (panel.dataset.q === q) noteGap(q);
      }, 1400);
      h = '<div class="p-empty">Keine Treffer für „' + esc(q) + '"' +
          '<span class="gap-report">Dieser Suchbegriff wird vermerkt – so sieht das Amt, ' +
          'welche Inhalte im Info-Pool noch fehlen.</span></div>';
    } else {
      clearTimeout(_gapNote);
    }
    panel.innerHTML = h;
    _aktiv = -1;
    setzeActiveDescendant(null);
    sageStand(peopleHits.length + titleHits.length + contentHits.length, q);
  }

  /* ----------------------------------------------------------------
     v9.9 · AP1 · Ansage der Trefferzahl
     ----------------------------------------------------------------
     Die Suche laeuft bei jedem Tastendruck. Wuerde jede Zwischenzahl
     angesagt, redete die Sprachausgabe pausenlos dazwischen. Deshalb
     erst nach kurzer Tippruhe - und nur, wenn sich der Text wirklich
     geaendert hat.
     ---------------------------------------------------------------- */
  var _standTimer = null, _standLetzt = '';
  function sageStand(anzahl, q) {
    var el = document.getElementById('suchStatus');
    if (!el) return;
    var txt = !q ? ''
      : (anzahl === 0 ? 'Keine Treffer für ' + q
        : anzahl === 1 ? 'Ein Treffer für ' + q + '. Mit Pfeil nach unten zur Liste.'
        : anzahl + ' Treffer für ' + q + '. Mit Pfeil nach unten zur Liste.');
    clearTimeout(_standTimer);
    _standTimer = setTimeout(function () {
      if (txt === _standLetzt) return;
      _standLetzt = txt;
      el.textContent = txt;
    }, 700);
  }

  /* ----------------------------------------------------------------
     v9.9 · AP1 · Tastaturführung in der Trefferliste (ARIA 1.2)
     ----------------------------------------------------------------
     Der Fokus bleibt im Eingabefeld. Angesteuert wird ueber
     aria-activedescendant: die Sprachausgabe liest die jeweilige Zeile
     vor, das Weitertippen bleibt jederzeit moeglich. Ein echtes
     Fokus-Wandern in die Liste wuerde das verhindern.
     ---------------------------------------------------------------- */
  var _aktiv = -1;
  function optionen() {
    return panel ? Array.prototype.slice.call(panel.querySelectorAll('[role="option"]')) : [];
  }
  function setzeActiveDescendant(el) {
    if (!input) return;
    optionen().forEach(function (o) {
      o.setAttribute('aria-selected', o === el ? 'true' : 'false');
      o.classList.toggle('is-aktiv', o === el);
    });
    if (el) {
      input.setAttribute('aria-activedescendant', el.id);
      if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }
  function wandere(schritt) {
    var o = optionen();
    if (!o.length) return;
    if (schritt === 'erste')      _aktiv = 0;
    else if (schritt === 'letzte') _aktiv = o.length - 1;
    else {
      _aktiv += schritt;
      if (_aktiv < 0) _aktiv = o.length - 1;
      if (_aktiv >= o.length) _aktiv = 0;
    }
    setzeActiveDescendant(o[_aktiv]);
  }

  /* Personendaten fruehzeitig laden, damit die Suche sofort Treffer
     liefern kann (Handyliste/Organigramm nutzen denselben Cache). */
  function preloadPeople() {
    try { loadPeople(); } catch (e) { /* still */ }
  }

  function wireSearch() {
    panel = $('#panel'); input = $('#searchInput'); box = $('#searchBox');
    if (!panel || !input || !box) return;
    input.addEventListener('focus', function () { input.value.trim() ? runSearch(input.value) : showRecent(); });
    input.addEventListener('input', function () { runSearch(input.value); syncClear(); });

    /* v9.7 · Punkt 2: An die Stelle des Knopfes „Suchen“ tritt ein
       Löschkreuz. Es leert das Feld, laesst die Liste aber offen -
       der naechste Suchbegriff kann sofort getippt werden. */
    var clr = $('#searchClear');
    function syncClear() { if (clr) clr.hidden = !input.value.length; }
    if (clr) clr.addEventListener('click', function () {
      input.value = '';
      syncClear();
      showRecent();
      input.focus();
    });
    syncClear();

    document.addEventListener('click', function (e) {
      if (box.contains(e.target)) return;
      if (ueberlagert(e.target)) return;   // Betrachter/Overlay liegt darueber
      closeSearch();
    });
    /* Escape schliesst die Suche und gibt das Scrollen wieder frei. */
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        /* v9.9 · AP1: Erst die Auswahl in der Liste aufheben, erst beim
           zweiten Druck die Suche schliessen - so wie es das
           Combobox-Muster vorsieht. */
        if (_aktiv >= 0) { _aktiv = -1; setzeActiveDescendant(null); return; }
        input.blur(); closeSearch(); return;
      }
      if (e.key === 'ArrowDown')  { e.preventDefault(); wandere(_aktiv < 0 ? 'erste' : 1); return; }
      if (e.key === 'ArrowUp')    { e.preventDefault(); wandere(_aktiv < 0 ? 'letzte' : -1); return; }
      if (e.key === 'Home' && _aktiv >= 0) { e.preventDefault(); wandere('erste'); return; }
      if (e.key === 'End'  && _aktiv >= 0) { e.preventDefault(); wandere('letzte'); return; }
      if (e.key === 'Enter') {
        var o = optionen();
        if (_aktiv >= 0 && o[_aktiv]) {
          e.preventDefault();
          /* Umschalt+Eingabe fuehrt bei Personen ins Organigramm statt
             in die Handyliste - dieselbe Wahl, die die Maus ueber die
             zwei Knoepfe in der Zeile hat. */
          aktiviere(o[_aktiv], e.shiftKey ? 'org' : 'handy');
        }
        return;
      }
    });
    /* Fenstergroesse geaendert -> Panelhoehe neu berechnen. */
    addEventListener('resize', function () { if (isSearching()) measurePanel(); });
    /* v9.9 · AP1: Die Auswertung eines Treffers steckte bisher im
       Klick-Ereignis. Sie ist jetzt eine eigene Funktion, damit die
       Eingabetaste exakt denselben Weg nimmt - sonst laufen Maus und
       Tastatur auseinander, sobald sich hier etwas aendert. */
    function aktiviere(zeile, ziel) {
      if (!zeile) return;
      if (zeile.classList.contains('prow')) {
        var nm = zeile.querySelector('[data-pq]');
        closeSearch();
        openPersonIn(ziel || 'handy', nm ? nm.dataset.pq : '');
        return;
      }
      if (!zeile.classList.contains('doc')) return;
      var d = docs[+zeile.dataset.doc];
      if (d && /^#fs=/.test(d.href || '')) {
        var key = (d.href.match(/^#fs=([a-z]+)/) || [])[1];
        if (key && typeof window.__ip67_openFs === 'function') { closeSearch(); window.__ip67_openFs(key); return; }
      }
      openDocReal(+zeile.dataset.doc, panel.dataset.q || '');
      openViewerFull();
    }

    panel.addEventListener('click', function (e) {
      /* v8.6: Personentreffer – zwei Ziele je Zeile (Handyliste/Organigramm). */
      var pg = e.target.closest('[data-pfs]');
      if (pg) {
        closeSearch();
        openPersonIn(pg.dataset.pfs, pg.dataset.pq || '');
        return;
      }
      if (e.target.closest('.pr-tel')) return; // tel:-Link normal ausfuehren
      /* v9.9 · AP1: Ab hier uebernimmt aktiviere() - dieselbe Funktion,
         die auch die Eingabetaste aufruft. Die Fallunterscheidung nach
         Personenzeile und Dokumentzeile steckt dort.
         v9.7 · Punkt 2: Bei Dokumenten wird die Suche NICHT beendet - der
         Vollbild-Betrachter legt sich darueber, und beim Schliessen steht
         die Trefferliste unveraendert wieder da. Nur die Personen-Overlays
         sind ein echter Ansichtswechsel und schliessen die Suche.
         v8.5: Personentreffer tragen seit der JSON-Umstellung App-interne
         Anker (#fs=handy&p=… / #fs=org&p=…) statt der alten, auf SharePoint
         toten file://-Links. Sie oeffnen das jeweilige Overlay. */
      aktiviere(e.target.closest('.prow, .doc[data-doc]'), 'handy');
    });
  }

  /* ================================================================
     4. Viewer – öffnet die echte Datei (href) in einem iframe
     ================================================================ */
  var viewer, vSkel, vBody, backdrop;

  function openDocReal(i, q, modus) {
    var d = docs[i]; if (!d) return;
    _vDoc = d;                                   // v9.7 · Punkt 3
    _vDocI = i;                                  // v10.0 · AP3
    var dlBtn = $('#vDownload');
    if (dlBtn) dlBtn.hidden = !d.href;
    /* v8.7 · Punkt 3+4: Suchbegriff mitfuehren. Bisher endete die Suche
       am Viewer-Rand - das Dokument oeffnete sich, aber der Begriff war
       darin nicht markiert. */
    _vq = String(q || '').trim();
    _vHits = []; _vPages = []; _vHitI = -1;
    renderHitBar();
    sessionRecent = [i].concat(sessionRecent.filter(function (x) { return x !== i; })).slice(0, 6);

    if ($('#vTitle')) $('#vTitle').textContent = d.t;
    if ($('#vMeta'))  $('#vMeta').textContent  = d.m;
    renderGiltBar(i);   // v8.7: Gültigkeit + Zuständigkeit

    /* v9.0: Einen laufenden PDF-Betrachter sauber beenden - sonst
       arbeiten dessen Hintergrundprozesse weiter. */
    if (_vPdf) { try { _vPdf.zerstoere(); } catch (e) {} _vPdf = null; }
    var old = viewer ? viewer.querySelector('.v-frame') : null;
    if (old) old.remove();
    /* v10.0 · AP3: Der Hinweis fuer die Sprachausgabe gilt nur fuer das
       gerade gezeigte PDF und darf beim naechsten Dokument nicht stehen
       bleiben. */
    var altHw = viewer ? viewer.querySelector('.ip67-pdfhinweis') : null;
    if (altHw) altHw.remove();
    if (vBody) vBody.style.display = 'none';
    if (vSkel) vSkel.style.display = 'block';

    /* ----------------------------------------------------------------
       v10.0 · AP3: Weiche zwischen Originalansicht und Textfassung.
       Ohne ausdrueckliche Wahl (dritter Parameter) entscheidet die
       gemerkte Einstellung. Ab hier ist Schluss - die Textfassung baut
       sich vollstaendig aus dem Index auf und braucht die Datei nicht.
       ---------------------------------------------------------------- */
    _vTextAn = textAnsichtMoeglich(d) &&
      ((modus === undefined || modus === null) ? textPrefLies() : !!modus);
    aktualisiereTextKnopf();
    if (_vTextAn) { zeigeTextansicht(d); return; }

    if (!d.href) {
      setTimeout(function () {
        if (vBody) {
          vBody.innerHTML = '<p style="color:var(--muted)">Für diesen Eintrag liegt keine direkt einbettbare Datei vor. ' +
            'Er ist über die Volltextsuche auffindbar.</p>';
          vBody.style.display = 'block';
        }
        if (vSkel) vSkel.style.display = 'none';
      }, 250);
      return;
    }
    var ifr = document.createElement('iframe');
    ifr.className = 'v-frame';
    ifr.title = d.t;
    ifr.addEventListener('load', function () { if (vSkel) vSkel.style.display = 'none'; });

    /* ----------------------------------------------------------------
       v8.6 · Punkt 6: HTML-Dateien wurden heruntergeladen statt angezeigt.
       Ursache liegt nicht in dieser Anwendung, sondern in SharePoint:
       bei "Browser File Handling = Strict" liefert die Farm .html mit
       "Content-Disposition: attachment" aus – ein iframe mit src=<datei>
       loest dann den Download-Dialog aus.
       Loesung: Inhalt per fetch holen (same-origin, Windows-Auth greift
       automatisch), <base> setzen, damit relative Bilder/Links weiter
       funktionieren, und als Blob in den Viewer haengen. Der
       Content-Disposition-Header ist beim fetch bedeutungslos.
       ---------------------------------------------------------------- */
    var ext = (String(d.href).split('?')[0].split('#')[0].split('.').pop() || '').toLowerCase();
    if (ext === 'html' || ext === 'htm') {
      if (viewer) viewer.appendChild(ifr);
      loadHtmlIntoFrame(ifr, d.href);
      return;
    }

    /* ----------------------------------------------------------------
       v8.9 · PDF
       Der Versuch mit #search= ist entfallen: dieser Open-Parameter
       stammt vom alten Adobe-Reader-Plugin. Der in Edge und Chrome
       eingebaute PDF-Betrachter (PDFium) wertet ihn NICHT aus, deshalb
       blieb der Suchbegriff unmarkiert.
       Was der eingebaute Betrachter zuverlaessig versteht, ist #page=N.
       Und die Trefferseiten kennt die Anwendung bereits: der
       Volltextindex haelt zu jedem Dokument den Text samt
       Seitenumbruechen. Also: Fundstellen selbst berechnen, den Betrachter
       auf die richtige Seite schicken und den Fundtext oben gelb
       markiert anzeigen.
       Eine echte gelbe Markierung IM PDF ginge nur mit einem eigenen
       PDF-Betrachter (PDF.js). Der laesst sich hier hosten, ist aber
       ein eigener Arbeitsschritt - siehe Hinweis im Chat.
       ---------------------------------------------------------------- */
    if (ext === 'pdf') {
      /* v9.0: eigener Betrachter (PDF.js) - markiert wirklich im
         Dokument. Schlaegt er fehl, greift der bisherige Weg ueber den
         eingebauten Betrachter mit #page=. */
      if (window.IP67PDF && typeof window.IP67PDF.oeffne === 'function') {
        oeffnePdfJs(d);
        return;
      }
      _vPages = _vq ? findePdfTreffer(d) : [];
      _vHitI  = _vPages.length ? 0 : -1;
      ifr.src = d.href + (_vPages.length ? '#page=' + _vPages[0].seite : '');
      if (viewer) viewer.appendChild(ifr);
      setTimeout(function () { if (vSkel) vSkel.style.display = 'none'; }, 1500);
      renderHitBar();
      return;
    }
    /* ----------------------------------------------------------------
       v9.7 · Punkt 3: Tabellen (Excel, CSV)
       ----------------------------------------------------------------
       Warum das bisher nicht ging: SharePoint liefert .xlsx mit
       „Content-Disposition: attachment“ aus. Ein iframe mit src=<datei>
       zeigt dann nichts an - der Betrachter blieb leer.
       Und selbst wenn die Farm die Datei eingebettet ausliefern wuerde,
       waere das Ergebnis ein bearbeitbares Tabellenblatt. Genau das soll
       der Betrachter NICHT sein.
       Loesung: Die Datei wird per fetch geholt (same-origin, die
       Windows-Anmeldung greift automatisch) und mit der ohnehin schon
       fuer die Indizierung vorhandenen Bibliothek lib/xlsx gelesen. Was
       daraus entsteht, ist reines HTML - eine Tabelle zum Ansehen, ohne
       jede Moeglichkeit, etwas zurueckzuschreiben.
       Schlaegt das fehl, erscheint die Herunterladen-Karte statt einer
       leeren Flaeche.
       ---------------------------------------------------------------- */
    if (TABELLEN_EXT.indexOf(ext) >= 0) {
      zeigeTabelle(d, ext);
      return;
    }

    ifr.src = d.href;
    if (viewer) viewer.appendChild(ifr);
    setTimeout(function () { if (vSkel) vSkel.style.display = 'none'; }, 1500);
    if (_vq) showHitBarInfo('Dieser Dateityp lässt keine Markierung zu – bitte Strg+F im Dokument.');
  }

  /* ================================================================
     v8.7 · Markierung und Trefferzähler im HTML-Viewer
     ----------------------------------------------------------------
     Warum das nur bei HTML vollstaendig geht: die Datei wird ohnehin
     schon per fetch geholt und als Blob eingehaengt (siehe unten,
     SharePoint liefert .html sonst als Download aus). Eine Blob-URL
     erbt den Origin der Seite, deshalb darf die Anwendung in das
     iframe hineinschauen und dort <mark>-Elemente setzen. Bei PDF und
     Office-Dateien rendert der Browser den Inhalt selbst - dort ist
     kein Zugriff moeglich.
     ================================================================ */
  var _vq = '';        // aktueller Suchbegriff im Viewer
  var _vDoc = null;    // v9.7 · aktuell angezeigtes Dokument (fuer Herunterladen)

  /* ================================================================
     v9.7 · Punkt 3 · Tabellen schreibgeschützt anzeigen
     ----------------------------------------------------------------
     Dateiendungen, die NICHT an den Browser durchgereicht, sondern hier
     selbst gerendert werden. Alles andere bleibt unveraendert.
     ================================================================ */
  var TABELLEN_EXT = ['xlsx', 'xlsm', 'xls', 'csv'];
  var XLSX_LIB = 'lib/xlsx/xlsx.full.min.js';
  var _xlsxLaden = null;

  function ladeXlsxLib() {
    if (window.XLSX) return Promise.resolve(true);
    if (_xlsxLaden) return _xlsxLaden;
    _xlsxLaden = new Promise(function (res) {
      var s = document.createElement('script');
      s.src = XLSX_LIB;
      s.async = true;
      s.charset = 'UTF-8';
      s.onload  = function () { res(!!window.XLSX); };
      s.onerror = function () { res(false); };
      document.head.appendChild(s);
    });
    return _xlsxLaden;
  }

  /* Datei herunterladen. Bewusst ueber einen Blob und nicht ueber einen
     schlichten Link auf die SharePoint-Adresse: bei „Browser File
     Handling = Strict“ oeffnet die Farm manche Formate stattdessen in
     einer neuen Registerkarte, und bei Office-Dateien kann der Browser
     versuchen, sie in der Anwendung zu OEFFNEN statt zu speichern. */
  function ladeAktuellesDokument() {
    var d = _vDoc;
    if (!d || !d.href) return;
    var name = String(d.href).split('/').pop() || (d.t + '');
    fetch(encodeURI(d.href), { credentials: 'include' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      })
      .catch(function (e) {
        console.warn('[Info-Pool 67] Herunterladen fehlgeschlagen:', e && e.message);
        /* Letzter Ausweg: die Adresse direkt oeffnen. */
        try { window.open(encodeURI(d.href), '_blank'); } catch (x) {}
      });
  }

  /* Rueckfall-Karte: Datei laesst sich nicht anzeigen, aber holen. */
  function zeigeDownloadKarte(d, grund) {
    if (vSkel) vSkel.style.display = 'none';
    if (!vBody) return;
    vBody.innerHTML =
      '<div class="v-dlcard">' +
        '<div class="dc-ico" aria-hidden="true">⤓</div>' +
        '<div class="dc-h">Diese Datei lässt sich hier nicht anzeigen</div>' +
        '<div class="dc-s">' + esc(grund) + ' Sie können sie herunterladen und in der ' +
          'zugehörigen Anwendung öffnen. Die Fassung im Info-Pool bleibt davon unberührt – ' +
          'Änderungen an der heruntergeladenen Kopie wirken sich hier nicht aus.</div>' +
        '<button type="button" class="dc-btn" id="dcGo">⤓ ' + esc(d.t) + ' herunterladen</button>' +
      '</div>';
    vBody.style.display = 'block';
    var b = vBody.querySelector('#dcGo');
    if (b) b.addEventListener('click', ladeAktuellesDokument);
  }

  /* ================================================================
     v10.0 · AP3 · Textfassung aus dem Volltextindex
     ----------------------------------------------------------------
     Warum es diese Ansicht gibt: der PDF-Betrachter malt jede Seite auf
     ein <canvas>. Im Dokumentbaum steht danach kein einziges Wort - fuer
     eine Sprachausgabe ist ein PDF damit eine leere Flaeche.
     Der Volltext liegt aber ohnehin schon bereit: buildDocs() legt ihn
     als docs[i].plain ab, die Seitenmarken als docs[i].breaks. Diese
     Ansicht gibt genau das als gewoehnliches HTML aus - linear, in der
     richtigen Lesereihenfolge, ohne die absolut positionierten Spans des
     PDF-Textlayers, die bei Tabellen und Mehrspaltigkeit durcheinander
     geraten.
     Eine Eigenheit des Index ist dabei zu beachten: beim Einlesen werden
     alle Zeilenumbrueche zusammengestrichen (infopool67_index_v8.js,
     text.replace(/\s+/g, ' ')). Der gespeicherte Text ist also eine
     einzige lange Zeile. Die Gliederung muss deshalb hier neu entstehen:
     Seiten aus den Seitenmarken, Absaetze aus Satzenden. Ohne das waere
     jede Seite ein einziger Block - mit der Absatztaste nicht begehbar.
     ================================================================ */
  var TEXT_PREF_KEY    = 'ip67-textansicht';
  var TEXT_ABSATZ_ZIEL = 480;    // angestrebte Absatzlaenge in Zeichen
  var TEXT_MAX_CHARS   = 300000; // Obergrenze des Indexers - siehe dort
  var _vDocI   = -1;             // Listenplatz des angezeigten Dokuments
  var _vTextAn = false;          // laeuft gerade die Textfassung?

  /* Gemerkte Vorliebe. Wer die Textfassung einmal gewaehlt hat, landet
     kuenftig sofort dort - ohne diesen Schritt muesste die Kollegin bei
     jedem Dokument erneut umschalten. Es gibt keinen verlaesslichen Weg,
     eine Sprachausgabe aus dem Browser heraus zu erkennen; eine bewusst
     gesetzte Einstellung ist die ehrlichere Loesung. */
  function textPrefLies() {
    try { return localStorage.getItem(TEXT_PREF_KEY) === '1'; } catch (e) { return false; }
  }
  function textPrefSchreib(an) {
    try {
      if (an) localStorage.setItem(TEXT_PREF_KEY, '1');
      else    localStorage.removeItem(TEXT_PREF_KEY);
    } catch (e) {}
  }

  function extVon(d) {
    return (String((d && d.href) || '').split('?')[0].split('#')[0].split('.').pop() || '').toLowerCase();
  }

  /* Tabellen bleiben bewusst aussen vor: zeigeTabelle() baut eine echte
     <table> mit Zeilen- und Spaltenbezug. Das ist fuer eine Sprachausgabe
     deutlich besser als der Fliesstext aus dem Index, in dem die
     Zellgrenzen verloren sind. */
  function textAnsichtMoeglich(d) {
    if (!d) return false;
    return TABELLEN_EXT.indexOf(extVon(d)) < 0;
  }

  function aktualisiereTextKnopf() {
    var b = $('#vTextBtn'); if (!b) return;
    b.hidden = !textAnsichtMoeglich(_vDoc);
    b.setAttribute('aria-pressed', _vTextAn ? 'true' : 'false');
    b.innerHTML = _vTextAn
      ? '<span aria-hidden="true">\uD83D\uDDCE</span> Originalansicht'
      : '<span aria-hidden="true">\uD83D\uDCD6</span> Als Text';
    b.title = _vTextAn ? 'Zurück zur Originalansicht' : 'Textfassung für die Sprachausgabe';
  }

  /* Text in Absaetze zerlegen. Getrennt wird nur nach einem Satzende und
     erst, wenn genug Zeichen beisammen sind - so entstehen Bloecke, die
     man mit der Absatztaste sinnvoll durchgehen kann. */
  function absaetze(text) {
    var t = String(text || '').trim();
    if (!t) return [];
    var out = [], start = 0, i = 0;
    while (i < t.length) {
      var c = t.charAt(i);
      var satzende = (c === '.' || c === '!' || c === '?' || c === ':' || c === ';');
      if (satzende && (i - start) >= TEXT_ABSATZ_ZIEL && t.charAt(i + 1) === ' ') {
        out.push(t.slice(start, i + 1));
        start = i + 2; i = start;
        continue;
      }
      /* Notbremse fuer Text ohne jede Satzzeichen-Struktur - Listen und
         Tabellen aus PDFs bestehen oft nur aus Wortgruppen. Ohne diesen
         Zweig bliebe so eine Seite ein einziger Riesenabsatz. */
      if ((i - start) > TEXT_ABSATZ_ZIEL * 4) {
        var luecke = t.lastIndexOf(' ', i);
        if (luecke <= start) luecke = i;
        out.push(t.slice(start, luecke));
        start = luecke + 1; i = start;
        continue;
      }
      i++;
    }
    if (start < t.length) out.push(t.slice(start));
    return out;
  }

  /* Wie markiereInTabelle(), aber fuer einen reinen Textabschnitt: der
     Suchbegriff wird hervorgehoben, alles andere maskiert. */
  function escMitMarke(s, q, zaehler) {
    var text = String(s || '');
    var ql   = String(q || '').toLowerCase();
    if (ql.length < 2) return esc(text);
    var low = text.toLowerCase(), out = '', pos = 0, schutz = 0;
    while (schutz++ < 200) {
      var i = low.indexOf(ql, pos);
      if (i < 0) break;
      out += esc(text.slice(pos, i)) +
             '<mark class="hl">' + esc(text.slice(i, i + ql.length)) + '</mark>';
      pos = i + ql.length;
      if (zaehler) zaehler.n++;
    }
    return out + esc(text.slice(pos));
  }

  /* Der einzige Weg zwischen den beiden Ansichten: der Knopf in der
     Kopfzeile und der Rueckweg aus der Fehlerkarte laufen beide hier
     entlang - dieselbe Ueberlegung wie bei aktiviere() in der Suche. */
  function setzeTextansicht(an) {
    if (_vDocI < 0) return;
    openDocReal(_vDocI, _vq, !!an);
  }

  /* Der Lesefokus soll oben im Dokument stehen, sonst beginnt die
     Sprachausgabe irgendwo mitten im Betrachter. Erst im naechsten
     Durchlauf, weil der Betrachter zum Zeitpunkt des Aufbaus noch nicht
     im Vollbild ist - openViewerFull() kommt danach. */
  function fokusTextanfang() {
    setTimeout(function () {
      var h = vBody && vBody.querySelector('#vtStart');
      if (!h || !viewer || !viewer.classList.contains('fullscreen')) return;
      try { h.focus(); } catch (e) {}
    }, 0);
  }

  function zeigeTextansicht(d) {
    if (vSkel) vSkel.style.display = 'none';
    /* Trefferleiste und Fundstellen-Ausschnitt gehoeren zur
       Originalansicht: sie zaehlen Seiten im Blatt. In der Textfassung
       ist der Begriff ohnehin im Fliesstext markiert. */
    var bar = $('#vHits'); if (bar) bar.hidden = true;
    var sn  = $('#vSnip'); if (sn)  sn.hidden  = true;
    if (!vBody) return;

    var text = String((d && d.plain) || '').trim();
    if (!text) { zeigeTextFehlt(d); return; }

    var breaks  = (d.breaks && d.breaks.length) ? d.breaks : null;
    var zaehler = { n: 0 };
    var teile   = [];

    function absatzHtml(stueck) {
      return absaetze(stueck).map(function (p) {
        return '<p>' + escMitMarke(p, _vq, zaehler) + '</p>';
      }).join('');
    }

    if (breaks) {
      for (var s = 0; s < breaks.length; s++) {
        var von = breaks[s];
        var bis = (s + 1 < breaks.length) ? breaks[s + 1] : text.length;
        var stueck = text.slice(von, bis).trim();
        if (!stueck) continue;
        teile.push(
          '<section class="vt-seite" aria-labelledby="vts-' + (s + 1) + '">' +
            '<h3 class="vt-sh" id="vts-' + (s + 1) + '">Seite ' + (s + 1) +
              ' von ' + breaks.length + '</h3>' +
            absatzHtml(stueck) +
          '</section>');
      }
    } else {
      /* docx, txt, html, csv, eml, msg kennen im Index keinen
         Seitenbegriff - dort gibt es schlicht keine Gliederung zu bauen. */
      teile.push('<section class="vt-seite">' + absatzHtml(text) + '</section>');
    }

    var info = 'Textfassung aus dem Volltextindex' +
      (breaks ? ' · ' + breaks.length + (breaks.length === 1 ? ' Seite' : ' Seiten') : '') +
      (text.length >= TEXT_MAX_CHARS ? ' · sehr langes Dokument, Text gekürzt' : '');
    var fund = _vq
      ? '<p class="vt-fund">Suchbegriff „' + esc(_vq) + '“ · ' +
        (zaehler.n === 0 ? 'keine Fundstelle im Text'
                         : (zaehler.n === 1 ? 'eine Fundstelle' : zaehler.n + ' Fundstellen') +
                           ' hervorgehoben') + '.</p>'
      : '';

    vBody.innerHTML =
      '<div class="v-text">' +
        '<h2 class="vt-h" id="vtStart" tabindex="-1">' + esc(d.t) + ' – Textfassung</h2>' +
        '<p class="vt-info">' + esc(info) + '</p>' +
        fund +
        '<label class="vt-merk"><input type="checkbox" id="vtMerk"' +
          (textPrefLies() ? ' checked' : '') + '> Dokumente künftig gleich als Text öffnen</label>' +
        teile.join('') +
      '</div>';
    vBody.style.display = 'block';
    vBody.scrollTop = 0;

    var mk = vBody.querySelector('#vtMerk');
    if (mk) mk.addEventListener('change', function () { textPrefSchreib(mk.checked); });
    fokusTextanfang();
  }

  /* Kein Text im Index - die 5 % aus der Bestandspruefung (AP0) oder ein
     Dokument, das noch nicht abgeglichen ist. Eine ehrliche Auskunft ist
     hier mehr wert als eine leere Seite, an der man ratlos steht. */
  function zeigeTextFehlt(d) {
    if (vSkel) vSkel.style.display = 'none';
    if (!vBody) return;
    var grund = (extVon(d) === 'pdf')
      ? 'Von diesem Dokument liegt kein auslesbarer Text vor – vermutlich eine eingescannte Fassung ohne Texterkennung.'
      : 'Von diesem Dokument liegt im Volltextindex kein Text vor. Möglicherweise ist es erst kürzlich hinzugekommen und noch nicht abgeglichen.';
    vBody.innerHTML =
      '<div class="v-dlcard">' +
        '<div class="dc-ico" aria-hidden="true">\uD83D\uDCD6</div>' +
        '<div class="dc-h" id="vtStart" tabindex="-1">Keine Textfassung verfügbar</div>' +
        '<div class="dc-s">' + esc(grund) + ' Die Originalansicht zeigt das Dokument weiterhin, ' +
          'zum Vorlesen taugt sie allerdings nicht.</div>' +
        '<button type="button" class="dc-btn" id="vtZurueck">Zur Originalansicht</button>' +
        '<button type="button" class="dc-btn dc-zweit" id="vtDl">' +
          '<span aria-hidden="true">⤓</span> Herunterladen</button>' +
      '</div>';
    vBody.style.display = 'block';
    var z = vBody.querySelector('#vtZurueck');
    if (z) z.addEventListener('click', function () { setzeTextansicht(false); });
    var dl = vBody.querySelector('#vtDl');
    if (dl) {
      dl.hidden = !(d && d.href);
      dl.addEventListener('click', ladeAktuellesDokument);
    }
    fokusTextanfang();
  }

  /* Tabellenblatt als reines HTML aufbauen. Kein contenteditable, keine
     Eingabefelder - die Ansicht ist von Natur aus schreibgeschuetzt. */
  function tabelleHtml(wb) {
    var X = window.XLSX;
    var namen = wb.SheetNames || [];
    if (!namen.length) return '';
    var reiter = namen.length > 1
      ? '<div class="xl-tabs">' + namen.map(function (n, i) {
          return '<button type="button" class="xl-tab' + (i === 0 ? ' is-on' : '') +
                 '" data-sheet="' + i + '">' + esc(n) + '</button>';
        }).join('') + '</div>'
      : '';
    var blaetter = namen.map(function (n, i) {
      var html = '';
      try {
        html = X.utils.sheet_to_html(wb.Sheets[n], { id: 'xls_' + i, editable: false });
      } catch (e) { html = ''; }
      /* sheet_to_html liefert eine komplette Tabelle; sie wird nur noch
         eingehuellt, damit jedes Blatt fuer sich scrollen kann. */
      return '<div class="xl-sheet' + (i === 0 ? ' is-on' : '') + '" data-sheet="' + i + '">' +
             (html || '<div class="fs-note">Dieses Blatt ist leer.</div>') + '</div>';
    }).join('');
    return reiter + '<div class="xl-wrap">' + blaetter + '</div>';
  }

  function zeigeTabelle(d, ext) {
    if (vSkel) vSkel.style.display = 'block';
    if (vBody) vBody.style.display = 'none';

    ladeXlsxLib().then(function (ok) {
      if (!ok) {
        zeigeDownloadKarte(d, 'Die Anzeige-Bibliothek für Tabellen ist im Stadtnetz gerade nicht erreichbar.');
        return null;
      }
      return fetch(encodeURI(d.href), { credentials: 'include' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      });
    }).then(function (buf) {
      if (!buf) return;
      var wb = window.XLSX.read(new Uint8Array(buf), { type: 'array' });
      var html = tabelleHtml(wb);
      if (!html) { zeigeDownloadKarte(d, 'Die Tabelle konnte nicht gelesen werden.'); return; }
      if (vSkel) vSkel.style.display = 'none';
      if (!vBody) return;
      vBody.innerHTML =
        '<div class="xl-hint">Schreibgeschützte Ansicht · ' +
          esc(String(ext).toUpperCase()) + ' · ' + (wb.SheetNames || []).length + ' Blatt/Blätter. ' +
          'Zum Bearbeiten bitte oben „Herunterladen“ benutzen.</div>' + html;
      vBody.style.display = 'block';
      var tabs = vBody.querySelector('.xl-tabs');
      if (tabs) tabs.addEventListener('click', function (e) {
        var b = e.target.closest('.xl-tab'); if (!b) return;
        $$('.xl-tab', vBody).forEach(function (x) { x.classList.toggle('is-on', x === b); });
        $$('.xl-sheet', vBody).forEach(function (x) {
          x.classList.toggle('is-on', x.dataset.sheet === b.dataset.sheet);
        });
      });
      /* Suchbegriff im Blatt hervorheben, soweit vorhanden. */
      if (_vq) markiereInTabelle(vBody, _vq);
    }).catch(function (e) {
      console.warn('[Info-Pool 67] Tabelle nicht darstellbar:', e && e.message);
      zeigeDownloadKarte(d, 'Die Datei konnte nicht geladen werden (' + esc(e && e.message || 'unbekannt') + ').');
    });
  }

  /* Einfache Hervorhebung in den Zelltexten der gerenderten Tabelle. */
  function markiereInTabelle(root, q) {
    var ql = String(q || '').toLowerCase();
    if (ql.length < 2) return;
    var zellen = root.querySelectorAll('.xl-sheet td, .xl-sheet th');
    var n = 0;
    for (var i = 0; i < zellen.length && n < 400; i++) {
      var td = zellen[i];
      if (td.children.length) continue;
      var t = td.textContent || '';
      var p = t.toLowerCase().indexOf(ql);
      if (p < 0) continue;
      td.innerHTML = esc(t.slice(0, p)) + '<mark class="hl">' +
                     esc(t.slice(p, p + ql.length)) + '</mark>' + esc(t.slice(p + ql.length));
      n++;
    }
  }

  var _vHits = [];     // gefundene <mark>-Elemente im iframe (HTML)
  var _vHitI = -1;     // aktueller Treffer
  var _vPages = [];    // Fundstellen im PDF (Ersatzweg ueber den Index)
  var _vPdf   = null;  // aktiver PDF.js-Betrachter

  /* ----------------------------------------------------------------
     v9.0 · PDF mit eigenem Betrachter oeffnen
     ----------------------------------------------------------------
     Der eingebaute Betrachter von Edge und Chrome laesst sich von
     aussen nicht steuern - deshalb blieben Suchbegriffe unmarkiert.
     PDF.js rendert das Dokument selbst und legt einen unsichtbaren
     Textbereich darueber; genau dort kann die Anwendung markieren.
     Die Bibliothek liegt lokal im Ordner pdfjs/ - kein CDN.
     ---------------------------------------------------------------- */
  function oeffnePdfJs(d) {
    /* v10.1 · AP4: Seit die Textebene auf allen Seiten mitlaeuft, ist ein
       PDF hier vorlesbar. Der Hinweis bleibt trotzdem stehen, aber mit
       anderer Aussage: die Textebene folgt der Anordnung auf dem Blatt,
       und bei Tabellen oder zwei Spalten geraet die Reihenfolge dabei
       durcheinander. Die Textfassung aus dem Index hat dieses Problem
       nicht - wer vorgelesen bekommt, faehrt dort besser. */
    if (viewer && !viewer.querySelector('.ip67-pdfhinweis')) {
      var hw = document.createElement('p');
      hw.className = 'ip67-sr-only ip67-pdfhinweis';
      hw.textContent = 'Der Text dieses Dokuments folgt hier der Anordnung auf dem Blatt; ' +
        'bei Tabellen und mehrspaltigen Seiten kann die Reihenfolge durcheinandergeraten. ' +
        'Die Schaltfläche „Als Text“ in der Kopfzeile zeigt stattdessen die geordnete ' +
        'Textfassung aus dem Volltextindex.';
      viewer.appendChild(hw);
    }
    var host = document.createElement('div');
    host.className = 'v-frame v-pdfhost';
    if (viewer) viewer.appendChild(host);

    window.IP67PDF.oeffne(host, d.href, {
      query: _vq,
      onBereit: function (n) {
        if (vSkel) vSkel.style.display = 'none';
        _vHitI = n ? 0 : -1;
        renderHitBar();
      }
    }).then(function (betrachter) {
      _vPdf = betrachter;
      if (vSkel) vSkel.style.display = 'none';
      renderHitBar();
    }).catch(function (e) {
      console.warn('[Info-Pool 67] Eigener PDF-Betrachter nicht verfügbar:', e && e.message);
      /* Rueckfallebene: eingebauter Betrachter des Browsers. Damit
         bleibt das Dokument in jedem Fall lesbar - nur ohne
         Markierung im Blatt. */
      host.remove();
      _vPages = _vq ? findePdfTreffer(d) : [];
      _vHitI  = _vPages.length ? 0 : -1;
      var ifr2 = document.createElement('iframe');
      ifr2.className = 'v-frame';
      ifr2.title = d.t;
      ifr2.src = d.href + (_vPages.length ? '#page=' + _vPages[0].seite : '');
      if (viewer) viewer.appendChild(ifr2);
      if (vSkel) vSkel.style.display = 'none';
      renderHitBar();
    });
  }

  /* ----------------------------------------------------------------
     v8.9 · Fundstellen eines PDFs aus dem Volltextindex ableiten.
     Liefert je Treffer die Seitenzahl und einen Textausschnitt.
     Mehrere Treffer auf derselben Seite werden zusammengefasst - sonst
     spraenge „Weiter" mehrfach auf dieselbe Seite und der Zaehler
     verspraeche mehr, als der Betrachter zeigen kann.
     ---------------------------------------------------------------- */
  function seiteZu(breaks, pos) {
    if (!breaks || !breaks.length) return null;
    var lo = 0, hi = breaks.length - 1, ans = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (breaks[mid] <= pos) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return ans + 1;
  }

  function findePdfTreffer(d) {
    if (!d || !d.plain || !_vq) return [];
    var text = d.plain, low = text.toLowerCase(), q = _vq.toLowerCase();
    var out = [], gesehen = {}, pos = 0, schutz = 0;
    while (schutz++ < 500) {
      var i = low.indexOf(q, pos);
      if (i < 0) break;
      pos = i + q.length;
      var seite = seiteZu(d.breaks, i);
      var schluessel = seite === null ? ('o' + out.length) : ('s' + seite);
      if (!gesehen[schluessel]) {
        gesehen[schluessel] = true;
        var a = Math.max(0, i - 110), b = Math.min(text.length, i + q.length + 110);
        out.push({
          seite: seite,
          vor:   (a > 0 ? '… ' : '') + text.slice(a, i),
          wort:  text.slice(i, i + q.length),
          nach:  text.slice(i + q.length, b) + (b < text.length ? ' …' : '')
        });
      }
    }
    return out;
  }

  function renderSnip() {
    var el = $('#vSnip');
    if (!el) return;
    var t = _vPages[_vHitI];
    if (!t) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = '<span class="vs-lbl">Fundstelle' +
      (t.seite ? ' auf Seite ' + t.seite : '') + '</span>' +
      esc(t.vor) + '<mark>' + esc(t.wort) + '</mark>' + esc(t.nach);
  }

  function hlStyleInto(doc) {
    if (doc.getElementById('ip67-hl-style')) return;
    var st = doc.createElement('style');
    st.id = 'ip67-hl-style';
    st.textContent =
      'mark.ip67-hl{background:#fff3a3;color:inherit;border-radius:2px;padding:0 1px}' +
      'mark.ip67-hl.is-cur{background:#ffc400;box-shadow:0 0 0 2px #ffc400}';
    (doc.head || doc.body).appendChild(st);
  }

  function markInNode(node, re, doc, out) {
    if (!node) return;
    if (node.nodeType === 3) {
      var text = node.nodeValue;
      re.lastIndex = 0;
      if (!re.test(text)) return;
      re.lastIndex = 0;
      var frag = doc.createDocumentFragment(), last = 0, m;
      while ((m = re.exec(text)) !== null) {
        if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)));
        var mk = doc.createElement('mark');
        mk.className = 'ip67-hl';
        mk.textContent = m[0];
        frag.appendChild(mk);
        out.push(mk);
        last = m.index + m[0].length;
        if (m[0].length === 0) re.lastIndex++;   // Endlosschleife verhindern
      }
      if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
      return;
    }
    if (node.nodeType === 1) {
      var tag = node.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME' ||
          tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'NOSCRIPT') return;
      Array.prototype.slice.call(node.childNodes).forEach(function (c) {
        markInNode(c, re, doc, out);
      });
    }
  }

  function highlightFrame(ifr) {
    if (!_vq) { renderHitBar(); return; }
    var doc = null;
    try { doc = ifr.contentDocument || (ifr.contentWindow && ifr.contentWindow.document); }
    catch (e) { doc = null; }
    if (!doc || !doc.body) {
      showHitBarInfo('Der Inhalt lässt keine Markierung zu – bitte Strg+F im Dokument.');
      return;
    }
    hlStyleInto(doc);
    var esc2 = _vq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var out = [];
    try { markInNode(doc.body, new RegExp(esc2, 'gi'), doc, out); }
    catch (e) { console.warn('[Info-Pool 67] Markierung fehlgeschlagen:', e); }
    _vHits = out;
    _vHitI = out.length ? 0 : -1;
    renderHitBar();
    if (out.length) gotoHit(0);
  }

  function gotoHit(i) {
    /* v9.0: eigener PDF-Betrachter - springt zur echten Fundstelle. */
    if (_vPdf && _vPdf.treffer && _vPdf.treffer.length) {
      var n = _vPdf.treffer.length;
      if (i < 0) i = n - 1;
      if (i >= n) i = 0;
      _vHitI = i;
      _vPdf.geheZu(i);
      renderHitBar();
      return;
    }
    /* Rueckfallebene: der eingebaute Betrachter wird ueber #page= auf die Trefferseite
       geschickt. Das Neusetzen von src ist noetig, weil eine blosse
       Hash-Aenderung bei gleicher Adresse kein Neuladen ausloest. */
    if (_vPages.length) {
      if (i < 0) i = _vPages.length - 1;
      if (i >= _vPages.length) i = 0;
      _vHitI = i;
      var ifr = viewer && viewer.querySelector('.v-frame');
      var t = _vPages[i];
      if (ifr && t && t.seite) {
        var basis = String(ifr.src).split('#')[0];
        ifr.src = basis + '#page=' + t.seite;
      }
      renderHitBar();
      return;
    }
    if (!_vHits.length) return;
    if (i < 0) i = _vHits.length - 1;
    if (i >= _vHits.length) i = 0;
    _vHits.forEach(function (m) { m.classList.remove('is-cur'); });
    _vHitI = i;
    var el = _vHits[i];
    el.classList.add('is-cur');
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    catch (e) { try { el.scrollIntoView(); } catch (e2) {} }
    renderHitBar();
  }

  function clearHits() {
    _vq = ''; _vHits = []; _vPages = []; _vHitI = -1;
    /* Markierungen im PDF-Betrachter mit entfernen. */
    if (_vPdf) {
      var host = viewer && viewer.querySelector('.v-pdfhost');
      if (host) {
        Array.prototype.forEach.call(host.querySelectorAll('mark.pdfv-hl'), function (m) {
          try { m.replaceWith(document.createTextNode(m.textContent)); } catch (e) {}
        });
      }
      try { _vPdf.treffer.length = 0; } catch (e) {}
    }
    renderHitBar();
  }

  function showHitBarInfo(msg) {
    var bar = $('#vHits'); if (!bar || !_vq) return;
    var snip = $('#vSnip'); if (snip) snip.hidden = true;
    bar.hidden = false;
    $('#vhTerm').textContent = _vq;
    $('#vhCnt').textContent = msg;
    $('#vhPrev').disabled = true;
    $('#vhNext').disabled = true;
  }

  function renderHitBar() {
    var bar = $('#vHits'); if (!bar) return;
    var snip = $('#vSnip');
    if (!_vq) { bar.hidden = true; if (snip) snip.hidden = true; return; }
    bar.hidden = false;
    $('#vhTerm').textContent = _vq;

    /* v9.0 · eigener PDF-Betrachter: echte Fundstellen im Blatt. */
    if (_vPdf && _vPdf.treffer && _vPdf.treffer.length) {
      var tr = _vPdf.treffer;
      var akt = tr[_vHitI];
      $('#vhCnt').textContent = 'Treffer ' + (_vHitI + 1) + ' von ' + tr.length +
        (akt ? ' · Seite ' + akt.seite : '');
      $('#vhPrev').disabled = tr.length < 2;
      $('#vhNext').disabled = tr.length < 2;
      if (snip) snip.hidden = true;
      return;
    }
    if (_vPdf) {
      $('#vhCnt').textContent = 'Keine Fundstelle in diesem Dokument';
      $('#vhPrev').disabled = true;
      $('#vhNext').disabled = true;
      if (snip) snip.hidden = true;
      return;
    }

    /* Rueckfallebene: Seitentreffer aus dem Volltextindex. */
    if (_vPages.length) {
      $('#vhCnt').textContent = 'Fundstelle ' + (_vHitI + 1) + ' von ' + _vPages.length +
        (_vPages[_vHitI] && _vPages[_vHitI].seite ? ' · Seite ' + _vPages[_vHitI].seite : '');
      $('#vhPrev').disabled = _vPages.length < 2;
      $('#vhNext').disabled = _vPages.length < 2;
      renderSnip();
      return;
    }
    if (snip) snip.hidden = true;

    var n = _vHits.length;
    $('#vhCnt').textContent = n
      ? ('Treffer ' + (_vHitI + 1) + ' von ' + n)
      : 'Wird gesucht …';
    $('#vhPrev').disabled = n < 2;
    $('#vhNext').disabled = n < 2;
  }

  var _blobUrls = [];
  function loadHtmlIntoFrame(ifr, href) {
    fetch(href, { credentials: 'include' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (html) {
      /* Basis-URL = Ordner der Datei, damit relative Verweise stimmen. */
      var base = new URL(href, location.href).href.replace(/[^/]*$/, '');
      if (/<base\b/i.test(html)) {
        // vorhandenes <base> respektieren
      } else if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head([^>]*)>/i, '<head$1><base href="' + base + '">');
      } else {
        html = '<base href="' + base + '">' + html;
      }
      var url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      _blobUrls.push(url);
      /* Alte Blob-URLs freigeben (die aktuelle bleibt bestehen). */
      while (_blobUrls.length > 3) URL.revokeObjectURL(_blobUrls.shift());
      /* v8.7: Erst nach dem load-Ereignis markieren - vorher gibt es
         noch keinen Inhalt, in dem etwas zu finden waere. */
      ifr.addEventListener('load', function () { highlightFrame(ifr); }, { once: true });
      ifr.src = url;
    }).catch(function (e) {
      console.warn('[Info-Pool 67] HTML-Vorschau nicht moeglich:', e && e.message);
      if (vSkel) vSkel.style.display = 'none';
      if (vBody) {
        vBody.innerHTML = '<p style="color:var(--muted)">Diese HTML-Seite konnte nicht eingebettet werden. ' +
          '<a href="' + escAttr(href) + '" target="_blank" rel="noopener">In neuem Tab öffnen</a></p>';
        vBody.style.display = 'block';
      }
    });
  }

  function openByHref(href, title, q) {
    var i = docIndexByHref(href);
    if (i < 0) {
      var ext = (href.split('.').pop() || '').toLowerCase();
      docs.push({ id: '_nav_' + docs.length, t: title || href, m: 'Dokument', ft: badge(ext), href: href, plain: '', term: '' });
      i = docs.length - 1;
    }
    openDocReal(i, q);
  }

  function openViewerFull() {
    if (!viewer) return;
    viewer.classList.add('fullscreen');
    if (backdrop) backdrop.classList.add('show');
  }
  function closeViewerFull() {
    if (!viewer) return;
    viewer.classList.remove('fullscreen');
    if (backdrop) backdrop.classList.remove('show');
    /* v9.7 · Punkt 3: Nichts darf im Hintergrund weiterlaufen. */
    if (_vPdf) { try { _vPdf.zerstoere(); } catch (e) {} _vPdf = null; }
    /* v9.7 · Punkt 2: War die Suche offen, als das Dokument geoeffnet
       wurde, steht die Trefferliste jetzt wieder frei. Der Cursor geht
       zurueck ins Suchfeld, damit sofort weitergesucht werden kann -
       ohne erneutes Anklicken und ohne den Begriff neu zu tippen. */
    if (isSearching()) {
      measurePanel();
      var si = $('#searchInput');
      if (si) setTimeout(function () { try { si.focus(); } catch (e) {} }, 0);
    }
  }

  function wireViewer() {
    viewer = $('#viewer'); vSkel = $('#vSkel'); vBody = $('#vBody'); backdrop = $('#viewerBackdrop');
    /* v8.8 · Punkt 1: Die Sektion „Themen durchstöbern" ist ausgeblendet,
       der Viewer liegt aber darin. Er wird deshalb direkt an <body>
       gehaengt - sonst waere die Dokumentvorschau mit versteckt.
       Er wird ohnehin nur im Vollbild benutzt. */
    if (viewer && viewer.parentNode !== document.body) document.body.appendChild(viewer);
    /* v8.7: Trefferleiste (Punkt 4). */
    var vp = $('#vhPrev'), vn = $('#vhNext'), vx = $('#vhOff');
    if (vp) vp.addEventListener('click', function () { gotoHit(_vHitI - 1); });
    if (vn) vn.addEventListener('click', function () { gotoHit(_vHitI + 1); });
    if (vx) vx.addEventListener('click', function () {
      _vHits.forEach(function (m) {
        try { m.replaceWith(m.ownerDocument.createTextNode(m.textContent)); } catch (e) {}
      });
      clearHits();
    });
    /* v8.9 · Punkt 1: Der Viewer ist nur noch Vollbild-Vorschau. Beim
       Schliessen wird der Rahmen entleert, damit im Hintergrund kein
       Dokument weiterlaeuft (Videos, eingebettete Seiten). */
    var z = $('#vClose');
    if (z) z.addEventListener('click', closeViewerFull);
    /* v9.7 · Punkt 3: Herunterladen ist der einzige Weg zu einer
       bearbeitbaren Fassung. Im Betrachter selbst wird ausschliesslich
       gelesen - weder das PDF-Modul noch die Tabellenansicht schreiben
       jemals in die Quelldatei zurueck. */
    var dl = $('#vDownload');
    if (dl) dl.addEventListener('click', function () { ladeAktuellesDokument(); });
    /* v10.0 · AP3: Umschalter zwischen Originalansicht und Textfassung. */
    var tb = $('#vTextBtn');
    if (tb) tb.addEventListener('click', function () { setzeTextansicht(!_vTextAn); });
    if (backdrop) backdrop.addEventListener('click', closeViewerFull);
    // Startzustand: Hinweis statt Demo-Dokument
    if (vSkel) vSkel.style.display = 'none';
    if (vBody) {
      vBody.innerHTML = '<p style="color:var(--muted)">Wählen Sie links ein Thema, um die Vorschau zu öffnen – ' +
        'oder nutzen Sie oben die Suche.</p>';
      vBody.style.display = 'block';
    }
  }

  /* ================================================================
     5. Nav-Card „Themen durchstöbern" – aus sidebarInitData
     ================================================================ */
  /* ----------------------------------------------------------------
     v8.4: Beliebig tiefe, klappbare Navigation.
     Frueher wurden nur zwei Ebenen gerendert (Gruppe + direkte Kinder);
     tiefere Unterordner der SharePoint-Ablage waeren unsichtbar gewesen.
     Ordner sind jetzt aufklappbar und starten ZUGEKLAPPT.
     ---------------------------------------------------------------- */
  /* v9.1: Gemeinsamer Einstieg fuer den Ordner-Pflege-Button. Beide
     Baeume (Nav-Karte der Startseite und „Inhalte"-Overlay) haben
     eigene Klick-Handler; ohne diese gemeinsame Funktion wuerde der
     Button nur in einem von beiden funktionieren.
     Rueckgabe true = Klick war der Pflege-Button und ist erledigt. */
  function giltClickHandled(e, onSaved) {
    var gb = e.target.closest('.nav-gilt-edit');
    if (!gb) return false;
    e.preventDefault();
    e.stopPropagation();
    var id = gb.dataset.giltId, titel = gb.dataset.giltTitle;
    /* Personendaten mitladen - sonst ist die Vorschlagsliste im Feld
       „Zustaendig" leer, wenn noch keine Handyliste geoeffnet wurde. */
    Promise.all([loadMeta(), loadPeople()]).then(function () {
      openGiltFormFor(id, titel, true, function () {
        refreshGiltBar();
        if (typeof onSaved === 'function') onSaved();
      });
    }).catch(function (err) {
      console.error('[Info-Pool 67] Angaben konnten nicht geöffnet werden:', err);
      peToast('Angaben konnten nicht geöffnet werden.', 'warn');
    });
    return true;
  }

  function navItem(n, depth) {
    depth = depth || 0;
    var k = kidsOf(n);
    var isGroup = n.type === 'group' || (k && k.length);
    var pad = 10 + depth * 14;                    // Einrueckung je Ebene
    var ico = n.icon
      ? ('<span class="ni-ico" style="display:inline-flex;align-items:center;justify-content:center;font-style:normal">' + esc(n.icon) + '</span>')
      : '';

    if (isGroup) {
      var kids = k || [];
      var body = kids.map(function (c) { return navItem(c, depth + 1); }).join('');
      /* v9.1: Im Adminmodus bekommt jeder Ordner-Knoten einen eigenen
         Pflege-Button, damit Gueltigkeit/Zustaendigkeit auf Ordnerebene
         gesetzt werden kann (Vererbung an alle Dokumente darin) statt
         jede einzelne Datei separat pflegen zu muessen. */
      var giltBtn = (isAdmin() && n.id)
        ? ('<button type="button" class="nav-gilt-edit" data-gilt-id="' + escAttr(n.id) +
           '" data-gilt-title="' + escAttr(n.title) + '" title="Gültigkeit/Zuständigkeit für diesen Ordner pflegen" ' +
           'aria-label="Gültigkeit/Zuständigkeit für diesen Ordner pflegen">✎</button>')
        : '';
      /* v9.9 · AP2: Der Ordner bekommt einen zusammenhaengenden Namen
         („Vorschriften, 12 Eintraege") statt zweier loser Textstuecke, die
         die Sprachausgabe als „Vorschriften 12" aneinanderreiht. Die Zahl
         im Feld wird deshalb ueberlesen. aria-controls verbindet Kopf und
         Inhalt, damit beim Aufklappen klar ist, was sich geoeffnet hat. */
      var subId = 'navsub-' + (_navSubId++);
      var anzahl = kids.length === 1 ? '1 Eintrag' : kids.length + ' Einträge';
      return '<div class="nav-grp" data-depth="' + depth + '" data-nid="' + escAttr(n.id || '') + '">' +
               '<div class="nav-item grp" role="button" tabindex="0" aria-expanded="false"' +
                    ' aria-controls="' + subId + '"' +
                    ' aria-label="' + escAttr(n.title + ', ' + anzahl) + '"' +
                    ' style="padding-left:' + pad + 'px">' +
                 '<span class="tw" aria-hidden="true">\u25B8</span>' + ico +
                 '<span class="nl">' + esc(n.title) + '</span>' +
                 '<span class="count" aria-hidden="true">' + kids.length + '</span>' + giltBtn +
               '</div>' +
               '<div class="nav-sub" id="' + subId + '" role="group"' +
                    ' aria-label="' + escAttr(n.title) + '">' + body + '</div>' +
             '</div>';
    }

    var href = realHref(n.href);
    /* v9.9 · AP2: Dokumentzeilen waren bisher blosse <div> ohne tabindex.
       Mit der Maus anklickbar, mit der Tastatur unerreichbar - eine blinde
       Nutzerin kam ueber den Themenbaum an kein einziges Dokument heran.
       Zeilen ohne Ziel (reine Beschriftungen) bleiben bewusst passiv. */
    var attrs = href
      ? (' data-href="' + escAttr(href) + '" data-title="' + escAttr(n.title) + '"' +
         ' role="button" tabindex="0"')
      : '';
    return '<div class="nav-item"' + attrs + ' style="padding-left:' + pad + 'px">' +
             ico + '<span class="nl">' + esc(n.title) + '</span>' +
           '</div>';
  }

  var _navSubId = 0;
  var _navWired = false;

  /* ----------------------------------------------------------------
     v9.9 · AP2 · Tastaturbedienung im Themenbaum
     ----------------------------------------------------------------
     Bewusst KEINE Pfeiltasten-Navigation und kein role="tree". JAWS
     faengt die Pfeiltasten im Lesemodus selbst ab - eigene Handler
     kaemen dort gar nicht an. Ein echtes Tree-Widget wuerde umgekehrt
     den Anwendungsmodus erzwingen und damit den virtuellen Cursor
     abschalten; fuer Ungeuebte ist das eine Huerde, kein Gewinn.
     Stattdessen: jede Zeile ist eine Schaltflaeche, erreichbar mit der
     Tabulatortaste und mit den JAWS-Schnelltasten fuer Schaltflaechen.
     Diese Funktion wird von beiden Baeumen benutzt - der Nav-Karte auf
     der Startseite und dem Inhalte-Overlay. Vorher hatte nur der eine
     einen Handler, und der auch nur fuer Ordner.
     ---------------------------------------------------------------- */
  function baumTastatur(e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    var ziel = e.target.closest('.nav-item.grp, .nav-item[data-href]');
    if (!ziel) return;
    e.preventDefault();
    ziel.click();
  }

  function renderNav() {
    var card = $('.nav-card'); if (!card) return;
    var data = window.sidebarInitData || [];
    /* v9.1: Offene Ordner merken. renderNav() laeuft jetzt auch beim
       Umschalten des Adminmodus - ohne das hier klappte der ganze Baum
       jedes Mal zu und man verlor die Stelle, an der man gerade war. */
    var offen = {};
    $$('.nav-grp.open', card).forEach(function (g) {
      if (g.dataset.nid) offen[g.dataset.nid] = true;
    });
    var html = '';
    data.forEach(function (top) {
      if (top.href === '#home') return;
      var k = kidsOf(top);
      if (top.type === 'group' || (k && k.length)) {
        /* Oberste Ebene bleibt als Ueberschrift stehen und ist immer sichtbar;
           alles darunter startet zugeklappt. */
        html += '<div class="nav-sec">' + esc(top.title) + '</div>';
        (k || []).forEach(function (c) { html += navItem(c, 0); });
      } else {
        html += navItem(top, 0);
      }
    });
    var head = card.querySelector('.nc-head');
    card.innerHTML = '';
    if (head) card.appendChild(head);
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    while (wrap.firstChild) card.appendChild(wrap.firstChild);

    /* Gemerkten Aufklapp-Zustand wiederherstellen. */
    $$('.nav-grp', card).forEach(function (g) {
      if (g.dataset.nid && offen[g.dataset.nid]) {
        g.classList.add('open');
        var h = g.querySelector(':scope > .nav-item.grp');
        if (h) h.setAttribute('aria-expanded', 'true');
      }
    });

    /* v9.1: Listener nur EINMAL binden. Vorher hing renderNav() bei
       jedem Aufruf einen weiteren Klick-Listener an dieselbe Karte -
       beim zweiten Aufruf haette jeder Klick doppelt gefeuert und
       Ordner sofort wieder zugeklappt. */
    if (_navWired) return;
    _navWired = true;

    card.addEventListener('click', function (e) {
      /* v9.1: Ordner-Pflege-Button zuerst - sonst klappt der Ordner mit. */
      if (giltClickHandled(e)) return;
      /* Ordner auf-/zuklappen */
      var grp = e.target.closest('.nav-item.grp');
      if (grp && card.contains(grp)) {
        var box = grp.parentNode;
        var open = box.classList.toggle('open');
        grp.setAttribute('aria-expanded', open ? 'true' : 'false');
        return;
      }
      /* Dokument oeffnen */
      var it = e.target.closest('.nav-item[data-href]'); if (!it) return;
      $$('.nav-card .nav-item').forEach(function (n) { n.classList.remove('active'); });
      it.classList.add('active');
      openByHref(it.dataset.href, it.dataset.title);
      if (viewer) viewer.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    /* v9.9 · AP2: Enter und Leertaste jetzt fuer Ordner UND Dokumente
       (vorher nur Ordner) - siehe baumTastatur(). */
    card.addEventListener('keydown', baumTastatur);
  }

  /* ================================================================
     6. Echte Personendaten (Handyliste + Organigramm) + Chip-Overlays
     ----------------------------------------------------------------
     Datenquelle: Mitarbeiterliste.json (strukturierte Datensaetze mit
     orga / name / zustaendigkeit / handynummer / istFuehrung /
     intranetUrl), geladen von storage_v8.js. Kein zweiter Weg.
     ================================================================ */
  /* ----------------------------------------------------------------
     v8.4: EINE Quelle für Personendaten.
     Früher gab es zwei: ip67-data.js (strukturiert, 134 Datensätze) und
     mitarbeiterliste.js (flach, drei Sucheinträge je Person). Beide
     mussten getrennt gepflegt werden und liefen auseinander – genau
     daher kamen die abweichenden Zählerstände in der Konsole.
     Jetzt gilt ausschließlich Mitarbeiterliste.json.
     ---------------------------------------------------------------- */
  var _peopleCache = null;
  function loadPeople() {
    if (_peopleCache) return Promise.resolve(_peopleCache);
    _peopleCache = normalizePeople(window.__ip67_mitarbeiterliste);
    if (!_peopleCache.length) {
      console.warn('[Info-Pool 67] Keine Personendaten – Mitarbeiterliste.json fehlt oder ist leer.');
    }
    return Promise.resolve(_peopleCache);
  }
  function normalizePeople(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(function (m) {
      return {
        orga: String((m && m.orga) || '').trim(),
        name: String((m && m.name) || '').trim(),
        sg:   String((m && m.zustaendigkeit) || '').trim(),
        tel:  String((m && m.handynummer) || '').trim(),
        lead: !!(m && m.istFuehrung),
        url:  String((m && m.intranetUrl) || '').trim()
      };
    }).filter(function (p) { return p.name; });
  }

  /* ================================================================
     Personen-Editor (Admin, Weiche A)
     -----------------------------------------------------------------
     EINE Quelle (_peopleCache via loadPeople) speist Handyliste UND
     Organigramm. Wird die orga einer Person geaendert, wandert sie
     automatisch im Organigramm (Baum ist aus orga-Codes abgeleitet) –
     das ist die wiederhergestellte v7-Dynamik "an einer Stelle beides".
     Speichern erzeugt Mitarbeiterliste.json (Download) zum Hochladen
     in SP_FOLDER; nach Reload sind die Aenderungen ueberall sichtbar.
     ================================================================ */
  var _peopleEdit  = false;   // Bearbeiten-Modus aktiv?
  var _peopleDirty = false;   // ungespeicherte Aenderungen?

  /* Punkt 4: klare Strich-Icons statt Emoji. Emoji wurden je nach
     Schriftart als Kaestchen dargestellt und waren kaum erkennbar. */
  var ICO_EDIT = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  var ICO_DEL = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>' +
    '<path d="M10 11v6"/><path d="M14 11v6"/></svg>';

  function orgaCodes() {
    var L = _peopleCache || [], s = {};
    L.forEach(function (p) { if (p.orga) s[p.orga] = 1; });
    return Object.keys(s).sort(function (a, b) { return a.localeCompare(b, 'de', { numeric: true }); });
  }
  function peopleToJson() {
    return (_peopleCache || []).map(function (p) {
      return {
        orga: p.orga || '', name: p.name || '', zustaendigkeit: p.sg || '',
        handynummer: p.tel || '', istFuehrung: !!p.lead, intranetUrl: p.url || ''
      };
    });
  }
  /* ----------------------------------------------------------------
     v8.6 · Punkt 5: Speichern direkt nach SharePoint (REST-API).
     Same-Origin + Windows-Authentifizierung – es ist kein manuelles
     Hochladen mehr noetig. Schlaegt der Upload fehl (z. B. fehlende
     Schreibrechte), wird die Datei ersatzweise heruntergeladen, damit
     die Arbeit nicht verloren geht.
     ---------------------------------------------------------------- */
  var PEOPLE_FILE = 'Mitarbeiterliste.json';
  var _peopleSaving = false;

  function downloadPeopleFallback(data) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json;charset=utf-8' }));
    a.download = PEOPLE_FILE;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function savePeople(container) {
    if (_peopleSaving) return Promise.resolve();
    var data = JSON.stringify(peopleToJson(), null, 2);
    var S = window.IP67Storage;
    if (!S || typeof S.spUploadFile !== 'function') {
      downloadPeopleFallback(data);
      _peopleDirty = false;
      peToast('Speicher-Modul nicht verfügbar – Datei wurde heruntergeladen.', 'warn');
      renderHandy(container);
      return Promise.resolve();
    }
    _peopleSaving = true;
    renderHandy(container);
    return S.spUploadFile(S.SP_FOLDER, PEOPLE_FILE, data).then(function () {
      _peopleDirty = false;
      _peopleSaving = false;
      peToast('✓ Gespeichert – die Änderungen stehen allen zur Verfügung.', 'ok');
      renderHandy(container);
    }).catch(function (e) {
      _peopleSaving = false;
      console.error('[Info-Pool 67] Speichern nach SharePoint fehlgeschlagen:', e);
      downloadPeopleFallback(data);
      peToast('Speichern in SharePoint fehlgeschlagen (' + (e && e.message ? e.message : 'unbekannt') +
              '). Die Datei wurde heruntergeladen – bitte manuell in den Infopool-Ordner legen.', 'warn');
      renderHandy(container);
    });
  }

  /* Kleiner eigener Hinweis-Balken (der Core-Toast liegt im versteckten Host). */
  function peToast(msg, kind) {
    var t = document.getElementById('peToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'peToast';
      document.body.appendChild(t);
    }
    t.className = 'pe-toast ' + (kind === 'warn' ? 'is-warn' : 'is-ok') + ' show';
    t.textContent = msg;
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove('show'); }, kind === 'warn' ? 8000 : 3500);
  }

  /* Wo landet ein Orga-Code im Organigramm? (Live-Hinweis im Formular) */
  function orgaPreview(code) {
    code = String(code || '').trim();
    if (!code) return 'Ohne Orga-Code wird die Person direkt unter <strong>67</strong> geführt.';
    var known = orgaCodes().indexOf(code) >= 0;
    var chain = [], cur = code, guard = 0;
    while (cur && guard++ < 12) { chain.unshift(cur); cur = parentCode(cur); }
    return (known ? 'Vorhandene Einheit' : '<strong>Neue Einheit</strong> – wird automatisch angelegt') +
      ': ' + chain.map(function (c) { return esc(c); }).join(' \u203a ');
  }

  function openPersonForm(container, idx) {
    var c = _peopleCache || [];
    var isNew = idx < 0;
    var p = !isNew ? c[idx] : { orga: '', name: '', sg: '', tel: '', lead: false, url: '' };
    var dl = orgaCodes().map(function (x) { return '<option value="' + escAttr(x) + '">'; }).join('');
    var host = document.createElement('div');
    host.className = 'pe-modal';
    host.innerHTML =
      '<div class="pe-card" role="dialog" aria-modal="true" aria-label="' + (isNew ? 'Person hinzufügen' : 'Person bearbeiten') + '">' +
        '<div class="pe-head">' +
          '<div class="pe-h">' + (isNew ? 'Person hinzuf\u00fcgen' : 'Person bearbeiten') + '</div>' +
          '<button type="button" class="pe-x" data-act="cancel" title="Schlie\u00dfen" aria-label="Schlie\u00dfen">\u2715</button>' +
        '</div>' +
        '<div class="pe-body">' +
          '<label class="pe-f"><span class="pe-lbl">Name</span>' +
            '<input id="pe-name" value="' + escAttr(p.name) + '" placeholder="Nachname, Vorname" autocomplete="off"></label>' +
          '<label class="pe-f"><span class="pe-lbl">Orga-Code</span>' +
            '<input id="pe-orga" list="pe-orga-list" value="' + escAttr(p.orga) + '" placeholder="z. B. 673-11" autocomplete="off">' +
            '<datalist id="pe-orga-list">' + dl + '</datalist>' +
            '<span class="pe-hint" id="pe-orga-prev">' + orgaPreview(p.orga) + '</span></label>' +
          '<label class="pe-f"><span class="pe-lbl">Zust\u00e4ndigkeit</span>' +
            '<input id="pe-sg" value="' + escAttr(p.sg) + '" placeholder="Aufgabe / Bereich" autocomplete="off">' +
            '<span class="pe-hint">Benennt zugleich die Einheit im Organigramm.</span></label>' +
          '<label class="pe-f"><span class="pe-lbl">Mobil/Durchwahl</span>' +
            '<input id="pe-tel" value="' + escAttr(p.tel) + '" placeholder="z. B. 0152 12345678" autocomplete="off"></label>' +
        '</div>' +
        '<div class="pe-foot">' +
          '<button type="button" class="pe-btn" data-act="cancel">Abbrechen</button>' +
          '<button type="button" class="pe-btn pe-btn-prim" data-act="ok">\u00dcbernehmen</button>' +
        '</div>' +
      '</div>';
    /* Modal haengt am <body>, nicht in der Liste – dadurch ist es immer
       zentriert im Bild und nicht mehr ans Listenende gescrollt (Punkt 4). */
    document.body.appendChild(host);
    var nameInp = host.querySelector('#pe-name');
    setTimeout(function () { if (nameInp) nameInp.focus(); }, 20);

    var orgaInp = host.querySelector('#pe-orga');
    var prev = host.querySelector('#pe-orga-prev');
    if (orgaInp && prev) orgaInp.addEventListener('input', function () {
      prev.innerHTML = orgaPreview(orgaInp.value);
    });

    function close() {
      host.remove();
      document.removeEventListener('keydown', onKey, true);
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT') { e.preventDefault(); submit(); }
    }
    function submit() {
      var rec = {
        orga: host.querySelector('#pe-orga').value.trim(),
        name: host.querySelector('#pe-name').value.trim(),
        sg:   host.querySelector('#pe-sg').value.trim(),
        tel:  host.querySelector('#pe-tel').value.trim(),
        /* Leitungs-Kennzeichen und Intranet-URL werden nicht mehr im
           Formular gepflegt (Punkt 4), vorhandene Werte bleiben aber
           erhalten, damit sie beim Bearbeiten nicht verloren gehen. */
        lead: !!p.lead,
        url:  p.url || ''
      };
      if (!rec.name) { host.querySelector('#pe-name').focus(); return; }
      if (!isNew) c[idx] = rec; else c.push(rec);
      _peopleDirty = true;
      close();
      renderHandy(container);
    }
    document.addEventListener('keydown', onKey, true);
    host.addEventListener('click', function (e) {
      if (e.target === host) { close(); return; }
      var b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'cancel') { close(); return; }
      submit();
    });
  }
  function deletePerson(container, idx) {
    var c = _peopleCache || [];
    if (idx < 0 || idx >= c.length) return;
    if (!window.confirm('Diesen Eintrag l\u00f6schen?\n\n' + (c[idx].name || ''))) return;
    c.splice(idx, 1); _peopleDirty = true; renderHandy(container);
  }

  /* ---- Handyliste-Renderer (mit optionalem Bearbeiten-Modus) ---- */
  /* ================================================================
     v10.2 · AP5 · Filterfelder in Handyliste und Organigramm
     ----------------------------------------------------------------
     Beide Overlays hatten dieselbe Leiste zweimal im Quelltext stehen -
     und beide Male dieselben Luecken: das Feld ohne Beschriftung (nur
     ein Platzhaltertext, den eine Sprachausgabe nicht verlaesslich
     vorliest), die Lupe ohne aria-hidden, und beim Tippen keinerlei
     Rueckmeldung. Man filtert und weiss nicht, was uebrig bleibt.
     Beides liegt jetzt an einer Stelle.
     ================================================================ */
  function filterLeiste(id, beschriftung, platzhalter) {
    return '<div class="fs-filter">' +
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" ' +
        'stroke-width="2" aria-hidden="true" focusable="false">' +
        '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>' +
      '<input id="' + id + '" type="search" autocomplete="off" ' +
        'aria-label="' + escAttr(beschriftung) + '" placeholder="' + platzhalter + '"></div>' +
      '<p class="ip67-sr-only" id="' + id + 'Stand" role="status" aria-live="polite"></p>';
  }

  /* Dieselbe Mechanik und dieselbe Tippruhe wie sageStand() bei der
     Suche - sonst redet die Sprachausgabe bei jedem Buchstaben dazwischen
     und die Anwendung verhaelt sich an zwei Stellen unterschiedlich. */
  var _filterTimer = {}, _filterLetzt = {};
  function sageFilterstand(id, txt) {
    var el = document.getElementById(id + 'Stand');
    if (!el) return;
    clearTimeout(_filterTimer[id]);
    _filterTimer[id] = setTimeout(function () {
      if (txt === _filterLetzt[id]) return;
      _filterLetzt[id] = txt;
      el.textContent = txt;
    }, 700);
  }

  function filterMeldung(sichtbar, gesamt, q, was) {
    if (!q) return 'Filter aufgehoben, alle ' + gesamt + ' ' + was + ' sichtbar.';
    if (!sichtbar) return 'Kein Treffer für ' + q + '.';
    if (sichtbar === 1) return 'Ein Treffer für ' + q + '.';
    return sichtbar + ' von ' + gesamt + ' ' + was + ' für ' + q + '.';
  }

  function renderHandy(container) {
    if (!container) return;
    var c = _peopleCache || [];
    var rows = c.map(function (p, i) { return { p: p, i: i }; })
                .sort(function (a, b) { return a.p.name.localeCompare(b.p.name, 'de'); });
    var edit = _peopleEdit;
    var saveLbl = _peopleSaving ? 'Speichert \u2026' : 'Speichern';
    /* v8.7 · Punkt 1: Der Einstieg ins Bearbeiten erscheint erst nach
       Alt+Umschalt+A. Fuer die taegliche Nutzung ist die Handyliste
       damit wieder eine reine Nachschlageliste. */
    if (!isAdmin()) { edit = _peopleEdit = false; }
    var toolbar =
      '<div class="pe-bar">' +
        (isAdmin()
          ? '<button class="pe-tb" type="button" data-pe="toggle">' +
            (edit ? '\u2713 Bearbeiten beenden' : '\u270e Bearbeiten') + '</button>'
          : '') +
        (edit ? '<button class="pe-tb" type="button" data-pe="add">\uff0b Person</button>' : '') +
        (edit && _peopleDirty ? '<button class="pe-tb pe-tb-prim" type="button" data-pe="save"' +
          (_peopleSaving ? ' disabled' : '') + '>' + saveLbl + '</button>' : '') +
        '<span class="org-stat">' + c.length + ' Personen' +
          (edit && _peopleDirty ? ' \u00b7 <span class="pe-dirty">ungespeicherte \u00c4nderungen</span>' : '') + '</span>' +
      '</div>';
    var thAct = edit ? '<th scope="col" class="pe-act-h">Aktion</th>' : '';
    var body = rows.map(function (it) {
      var r = it.p, i = it.i;
      var tel  = r.tel ? '<a class="mono" href="tel:' + escAttr(r.tel) + '">' + esc(r.tel) + '</a>' : '';
      var act  = edit
        ? '<td class="pe-act">' +
            '<button type="button" class="pe-ic" data-pe-edit="' + i + '" title="Bearbeiten" aria-label="Bearbeiten">' + ICO_EDIT + '</button>' +
            '<button type="button" class="pe-ic pe-del" data-pe-del="' + i + '" title="L\u00f6schen" aria-label="L\u00f6schen">' + ICO_DEL + '</button>' +
          '</td>'
        : '';
      return '<tr' + (r.lead ? ' class="is-lead"' : '') + '><td>' + (r.lead ? '\u2605 ' : '') + esc(r.name) +
        '</td><td class="mono">' + esc(r.orga) + '</td><td>' + esc(r.sg) + '</td><td>' + tel + '</td>' + act + '</tr>';
    }).join('');
    container.innerHTML =
      toolbar +
      filterLeiste('handyFilter', 'Handyliste durchsuchen',
        'Name, Orga, Zust&auml;ndigkeit oder Nummer &hellip;') +
      (edit ? '<div class="pe-editnote">Änderungen an einem Orga-Code verschieben die Person automatisch im Organigramm. ' +
              'Zum Schluss auf <strong>Speichern</strong> – die Datei wird direkt in SharePoint abgelegt.</div>' : '') +
      /* v10.2 · AP5: Die Beschriftung sagt einer Sprachausgabe beim
         Betreten der Tabelle, worum es geht. Optisch aendert sie nichts -
         die Zahl steht sichtbar bereits in der Leiste darueber. */
      '<table class="tbl" id="handyTbl">' +
      '<caption class="ip67-sr-only">Rufnummern des Amtes, ' + c.length +
        (c.length === 1 ? ' Person' : ' Personen') + '</caption>' +
      '<thead><tr><th scope="col">Name</th><th scope="col">Orga</th>' +
      '<th scope="col">Zust&auml;ndigkeit</th><th scope="col">Mobil/Durchwahl</th>' + thAct +
      '</tr></thead><tbody>' +
      body + '</tbody></table>';
    var hf = $('#handyFilter');
    if (hf) hf.addEventListener('input', function () {
      var v = hf.value.toLowerCase();
      var sichtbar = 0, alle = $$('#handyTbl tbody tr');
      alle.forEach(function (tr) {
        var passt = tr.textContent.toLowerCase().indexOf(v) >= 0;
        tr.style.display = passt ? '' : 'none';
        if (passt) sichtbar++;
      });
      sageFilterstand('handyFilter',
        filterMeldung(sichtbar, alle.length, hf.value.trim(), 'Personen'));
    });
    var bar = container.querySelector('.pe-bar');
    if (bar) bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pe]'); if (!b) return;
      if (b.dataset.pe === 'toggle') {
        if (_peopleEdit && _peopleDirty &&
            !window.confirm('Es gibt ungespeicherte Änderungen.\n\nBearbeiten trotzdem beenden?')) return;
        _peopleEdit = !_peopleEdit; renderHandy(container);
      }
      else if (b.dataset.pe === 'add')  { openPersonForm(container, -1); }
      else if (b.dataset.pe === 'save') { savePeople(container); }
    });
    var tbl = container.querySelector('#handyTbl');
    if (tbl) tbl.addEventListener('click', function (e) {
      var ed = e.target.closest('[data-pe-edit]'); if (ed) { openPersonForm(container, +ed.dataset.peEdit); return; }
      var de = e.target.closest('[data-pe-del]'); if (de) { deletePerson(container, +de.dataset.peDel); return; }
    });
  }

  /* ---- Handyliste: Loader-Wrapper (echte Daten, dedupliziert) ---- */
  function fsHandyInto(container) {
    if (!container) return;
    container.innerHTML = '<div class="org-skel">Lade Mitarbeiterliste &hellip;</div>';
    loadPeople().then(function (people) {
      if (!people.length) {
        container.innerHTML = '<div class="fs-note">Die Mitarbeiterliste ist derzeit nicht geladen. ' +
          'Sie wird auf dem SharePoint aus <code>ip67-data.js</code> gespeist.</div>';
        return;
      }
      renderHandy(container);
    });
  }

  /* ---- Organigramm v8: Hierarchie aus orga-Codes ableiten ----
     67 -> 671/672/673 -> ...-1 -> ...-11 -> ...  Eltern = Code ohne
     letztes Zeichen (bzw. ohne abschliessendes '-'). Fehlende
     Zwischenknoten werden synthetisiert. ------------------------------ */
  function parentCode(code) {
    if (!code || code === '67') return null;
    var p = code.slice(0, -1);
    if (p.charAt(p.length - 1) === '-') p = p.slice(0, -1);
    return p || null;
  }
  function buildOrgTree(people) {
    var nodes = {};
    function ensure(code) {
      if (!code) return null;
      if (nodes[code]) return nodes[code];
      var n = { code: code, label: '', people: [], children: [], direct: 0, total: 0 };
      nodes[code] = n;
      var pc = parentCode(code);
      if (pc) { var pn = ensure(pc); if (pn) pn.children.push(n); }
      return n;
    }
    ensure('67');
    people.forEach(function (p) {
      var code = p.orga || '67';
      var n = ensure(code) || nodes['67'];
      if (n) n.people.push(p);
    });
    Object.keys(nodes).forEach(function (code) {
      var n = nodes[code];
      n.direct = n.people.length;
      var counts = {}, best = '', bestN = 0;
      n.people.forEach(function (p) {
        if (!p.sg) return;
        counts[p.sg] = (counts[p.sg] || 0) + 1;
        if (counts[p.sg] > bestN) { bestN = counts[p.sg]; best = p.sg; }
      });
      n.label = best;
      n.people.sort(function (a, b) { return (b.lead ? 1 : 0) - (a.lead ? 1 : 0) || a.name.localeCompare(b.name, 'de'); });
      n.children.sort(function (a, b) { return a.code.localeCompare(b.code, 'de', { numeric: true }); });
    });
    function tot(n) { var t = n.direct; n.children.forEach(function (c) { t += tot(c); }); n.total = t; return t; }
    var root = nodes['67'];
    if (root) { tot(root); root._units = Object.keys(nodes).length; }
    return root;
  }
  /* ----------------------------------------------------------------
     v10.2 · AP5 · Der Klapp-Knopf bekommt einen Namen
     ----------------------------------------------------------------
     Bisher stand im Knopf nur „\u25b8“. Eine Sprachausgabe meldete
     „Schaltflaeche Dreieck“ - welche Einheit sich da aufklappt, erfuhr
     man nicht. Der Kasten daneben zerfiel ausserdem in vier lose
     Textstuecke (Code, Titel, Leitung, Zahl), die einzeln vorgelesen
     wurden. Beides ist dasselbe Problem, das AP2 beim Ordnerkopf im
     Themenbaum geloest hat, und wird hier genauso geloest: ein
     zusammenhaengender aria-label, das Zeichen wird ueberlesen.
     Weiterhin bewusst KEIN role="tree" - siehe AP1.
     ---------------------------------------------------------------- */
  var _orgSubId = 0;
  function orgNodeHTML(n, depth) {
    var open = depth < 1;
    var interactive = n.children.length > 0 || n.people.length > 0;
    var title = n.label || ('Orga ' + n.code);
    var lead = null;
    for (var i = 0; i < n.people.length; i++) { if (n.people[i].lead) { lead = n.people[i]; break; } }

    var subId = 'orgsub-' + (++_orgSubId);
    var teile = [n.code, title];
    if (lead) teile.push('Leitung ' + lead.name);
    teile.push(n.total === 1 ? '1 Person' : n.total + ' Personen');
    var knopfName = teile.join(', ');

    var h = '<div class="org-node" data-code="' + escAttr(n.code) + '">';
    h += '<div class="org-box' + (depth === 0 ? ' is-root' : '') + '">';
    h += '<button class="org-toggle" type="button"' + (interactive ? '' : ' disabled') +
      ' aria-expanded="' + (open ? 'true' : 'false') + '"' +
      (interactive ? ' aria-controls="' + subId + '"' : '') +
      ' aria-label="' + escAttr(knopfName) + '">' +
      '<span aria-hidden="true">' + (interactive ? (open ? '\u25be' : '\u25b8') : '\u00b7') + '</span></button>';
    /* Die vier Angaben stehen im Namen des Knopfes bereits zusammen-
       haengend. Einzeln vorgelesen ergaeben sie nur Bruchstuecke. */
    h += '<span class="org-badge" aria-hidden="true">' + esc(n.code) + '</span>';
    h += '<span class="org-title" aria-hidden="true">' + esc(title) + '</span>';
    if (lead) h += '<span class="org-leadtag" aria-hidden="true" title="Leitung">\u2605 ' + esc(lead.name) + '</span>';
    h += '<span class="org-count" aria-hidden="true" title="Personen gesamt (inkl. Untereinheiten)">' + n.total + '</span>';
    h += '</div>';
    h += '<div class="org-children" id="' + subId + '" role="group" aria-label="' + escAttr(title) + '"' +
      (open ? '' : ' hidden') + '>';
    if (n.people.length) {
      h += '<div class="org-people">' + n.people.map(function (p) {
        var tel = p.tel ? '<a class="mono" href="tel:' + escAttr(p.tel) + '">' + esc(p.tel) + '</a>' : '';
        /* Der Pfeil allein war namenlos; ein title reicht dafuer nicht. */
        var link = p.url ? '<a class="fs-link" href="' + escAttr(p.url) + '" target="_blank" rel="noopener"' +
          ' title="Intranet-Profil" aria-label="Intranet-Profil von ' + escAttr(p.name) + ' öffnen">' +
          '<span aria-hidden="true">\u2197</span></a>' : '';
        return '<div class="org-person' + (p.lead ? ' is-lead' : '') + '"><span class="op-name">' + (p.lead ? '\u2605 ' : '') + esc(p.name) + '</span>' +
          (p.sg ? '<span class="op-sg">' + esc(p.sg) + '</span>' : '') + '<span class="op-tel">' + tel + '</span><span class="op-link">' + link + '</span></div>';
      }).join('') + '</div>';
    }
    n.children.forEach(function (c) { h += orgNodeHTML(c, depth + 1); });
    h += '</div></div>';
    return h;
  }

  /* Das Zeichen sitzt seit AP5 in einem eigenen <span>, damit der Name
     des Knopfes beim Umklappen nicht ueberschrieben wird. */
  function setzeCaret(tg, zeichen) {
    var s = tg.querySelector('span');
    if (s) s.textContent = zeichen; else tg.textContent = zeichen;
  }

  function refreshCarets(container) {
    $$('.org-toggle', container).forEach(function (tg) {
      if (tg.disabled) { setzeCaret(tg, '\u00b7'); return; }
      var kids = tg.closest('.org-node').querySelector(':scope > .org-children');
      if (!kids) return;
      var op = !kids.hasAttribute('hidden');
      setzeCaret(tg, op ? '\u25be' : '\u25b8');
      tg.setAttribute('aria-expanded', op ? 'true' : 'false');
    });
  }
  function renderOrgInto(container) {
    if (!container) return;
    container.innerHTML =
      filterLeiste('orgFilter', 'Organigramm durchsuchen',
        'Name, Orga oder Bereich &hellip;') +
      '<div class="org-toolbar"><button class="org-btn" type="button" data-act="expand">Alle ausklappen</button>' +
      '<button class="org-btn" type="button" data-act="collapse">Alle einklappen</button>' +
      /* v8.7 · Punkt 1: bisher fuer JEDEN sichtbar - jetzt nur im Adminmodus. */
      (isAdmin() ? '<button class="org-btn" type="button" data-act="editpeople">\u270e Personen/Org bearbeiten</button>' : '') +
      '<span class="org-stat" id="orgStat"></span></div>' +
      '<div class="org-skel">Lade Organigramm &hellip;</div>';
    loadPeople().then(function (people) {
      var skel = container.querySelector('.org-skel');
      if (!people.length) { if (skel) skel.outerHTML = '<div class="fs-note">Die Mitarbeiterdaten sind derzeit nicht geladen. Sie werden auf dem SharePoint aus <code>ip67-data.js</code> gespeist.</div>'; return; }
      var root = buildOrgTree(people);
      if (!root) { if (skel) skel.outerHTML = '<div class="fs-note">Organigramm konnte nicht aufgebaut werden.</div>'; return; }
      if (skel) skel.outerHTML = '<div class="org-tree">' + orgNodeHTML(root, 0) + '</div>';
      var stat = container.querySelector('#orgStat');
      if (stat) stat.textContent = root.total + ' Personen \u00b7 ' + (root._units || 0) + ' Einheiten';
      wireOrg(container);
    }).catch(function () {
      var skel = container.querySelector('.org-skel');
      if (skel) skel.outerHTML = '<div class="fs-note">Organigramm konnte nicht geladen werden.</div>';
    });
  }
  function wireOrg(container) {
    container.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('.org-toggle');
      if (!t || t.disabled) return;
      var node = t.closest('.org-node');
      var kids = node && node.querySelector(':scope > .org-children');
      if (!kids) return;
      if (kids.hasAttribute('hidden')) { kids.removeAttribute('hidden'); setzeCaret(t, '\u25be'); t.setAttribute('aria-expanded', 'true'); }
      else { kids.setAttribute('hidden', ''); setzeCaret(t, '\u25b8'); t.setAttribute('aria-expanded', 'false'); }
    });
    var bar = container.querySelector('.org-toolbar');
    if (bar) bar.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.org-btn'); if (!b) return;
      if (b.dataset.act === 'editpeople') {
        _peopleEdit = true;
        if (window.__ip67_openFs) window.__ip67_openFs('handy');
        return;
      }
      var expand = b.dataset.act === 'expand';
      $$('.org-children', container).forEach(function (k) {
        var box = k.parentNode.querySelector(':scope > .org-box');
        if (expand) k.removeAttribute('hidden');
        else if (box && box.classList.contains('is-root')) k.removeAttribute('hidden');
        else k.setAttribute('hidden', '');
      });
      refreshCarets(container);
    });
    var f = container.querySelector('#orgFilter');
    if (f) f.addEventListener('input', function () { filterOrg(container, f.value); });
  }
  function filterOrg(container, q) {
    q = (q || '').trim();
    var roh = q.toLowerCase();
    var nodes = $$('.org-node', container);
    var alle = $$('.org-person', container);
    if (!roh) {
      nodes.forEach(function (nd) { nd.style.display = ''; });
      alle.forEach(function (p) { p.style.display = ''; });
      $$('.org-children', container).forEach(function (k) {
        var box = k.parentNode.querySelector(':scope > .org-box');
        if (box && box.classList.contains('is-root')) k.removeAttribute('hidden'); else k.setAttribute('hidden', '');
      });
      refreshCarets(container);
      sageFilterstand('orgFilter', filterMeldung(alle.length, alle.length, '', 'Personen'));
      return;
    }
    alle.forEach(function (p) {
      p.style.display = p.textContent.toLowerCase().indexOf(roh) >= 0 ? '' : 'none';
    });
    nodes.slice().reverse().forEach(function (nd) {
      var box = nd.querySelector(':scope > .org-box');
      var boxMatch = box && box.textContent.toLowerCase().indexOf(roh) >= 0;
      var hasPerson = $$(':scope > .org-children > .org-people > .org-person', nd).some(function (p) { return p.style.display !== 'none'; });
      var hasChild = $$(':scope > .org-children > .org-node', nd).some(function (c) { return c.style.display !== 'none'; });
      var visible = boxMatch || hasPerson || hasChild;
      nd.style.display = visible ? '' : 'none';
      var kids = nd.querySelector(':scope > .org-children');
      if (kids && visible) kids.removeAttribute('hidden');
      var tg = box && box.querySelector('.org-toggle');
      if (tg && !tg.disabled) { setzeCaret(tg, '\u25be'); tg.setAttribute('aria-expanded', 'true'); }
    });
    /* Gezaehlt werden Personen, nicht Einheiten: danach wird gesucht. */
    var sichtbar = alle.filter(function (p) {
      return p.style.display !== 'none' && !istVerdeckt(p);
    }).length;
    sageFilterstand('orgFilter', filterMeldung(sichtbar, alle.length, q, 'Personen'));
  }

  /* Eine Person kann sichtbar sein und trotzdem in einer ausgeblendeten
     Einheit stecken. Fuer die Ansage zaehlt nur, was wirklich dasteht. */
  function istVerdeckt(el) {
    for (var p = el.parentNode; p && p.classList; p = p.parentNode) {
      if (p.classList.contains('org-node') && p.style.display === 'none') return true;
      if (p.classList.contains('org-tree')) return false;
    }
    return false;
  }

  var fsReg = {
    handy:   ['📞 Handyliste',       fsHandyInto],
    org:     ['🗂️ Organigramm',      renderOrgInto],
    /* v8.7 · Punkt 5: „Themen durchstöbern" als eigener Vollbild-Einstieg. */
    inhalte: ['📚 Inhalte des Info-Pools', renderInhalteInto]
  };

  function wireChips() {
    var fs = $('#fsOverlay');
    if (!fs) return;
    /* ----------------------------------------------------------------
       v9.9 · AP2 · Fokusführung im Vollbild-Overlay
       ----------------------------------------------------------------
       Ohne Fokusfalle wandert die Tabulatortaste hinter das Overlay in
       die Startseite darunter. Die Sprachausgabe liest dann Dinge vor,
       die optisch verdeckt sind - man bedient etwas, das man nicht
       sieht. Beim Schliessen geht der Fokus dorthin zurueck, wo er
       herkam; sonst steht er am Seitenanfang und der Weg beginnt neu.
       ---------------------------------------------------------------- */
    var _fsVorher = null;

    function fsFalle(e) {
      if (e.key !== 'Tab') return;
      if (!fs.classList.contains('show')) return;
      /* Liegt der Vollbild-Betrachter darueber, gehoert ihm die
         Tastatur - dann haelt diese Falle sich heraus. */
      if (viewer && viewer.classList.contains('fullscreen')) return;
      var f = fs.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
      f = Array.prototype.filter.call(f, function (el) {
        return el.offsetParent !== null || el === document.activeElement;
      });
      if (!f.length) return;
      var erst = f[0], letzt = f[f.length - 1];
      if (e.shiftKey && document.activeElement === erst) { e.preventDefault(); letzt.focus(); }
      else if (!e.shiftKey && document.activeElement === letzt) { e.preventDefault(); erst.focus(); }
    }

    function closeFs() {
      if (!fs.classList.contains('show')) return;
      fs.classList.remove('show');
      document.removeEventListener('keydown', fsFalle, true);
      var zurueck = _fsVorher; _fsVorher = null;
      if (zurueck && zurueck.focus) { try { zurueck.focus(); } catch (_) {} }
    }
    window.__ip67_closeFs = closeFs;

    function openFs(key) {
      var def = fsReg[key]; if (!def) return;
      var body = $('#fsBody');
      /* v9.9 · AP2: Das Symbol steckte mit im Titeltext - die
         Sprachausgabe las „Bücher Inhalte des Info-Pools". Es wird
         jetzt getrennt gehalten und ueberlesen. */
      var t = $('#fsTitle');
      var m = String(def[0]).match(/^(\S+)\s+([\s\S]+)$/);
      t.innerHTML = m
        ? '<span aria-hidden="true">' + esc(m[1]) + '</span> ' + esc(m[2])
        : esc(def[0]);
      if (body) body.innerHTML = '';
      if (!fs.classList.contains('show')) _fsVorher = document.activeElement;
      fs.classList.add('show');
      if (body) def[1](body);
      document.addEventListener('keydown', fsFalle, true);
      /* Fokus in den Dialog holen, sonst bleibt er auf dem Chip stehen
         und vom Overlay wird nichts angesagt. */
      var zu = $('#fsClose');
      if (zu) setTimeout(function () { try { zu.focus(); } catch (_) {} }, 0);
    }
    window.__ip67_openFs = openFs; // von Chips und Suchtreffern genutzt
    $$('.chip[data-fs]').forEach(function (c) {
      c.addEventListener('click', function () { openFs(c.dataset.fs); });
    });
    /* Der Link „Ganze Struktur" zeigte auf href="#" und tat nichts. */
    var gs = $('#ganzeStruktur');
    if (gs) gs.addEventListener('click', function (e) { e.preventDefault(); openFs('inhalte'); });
    var close = $('#fsClose');
    if (close) close.addEventListener('click', closeFs);
    addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      /* v8.8 · Punkt 3: Escape arbeitet sich Schicht für Schicht zurück.
         Vorher schloss ein einziger Druck Viewer UND Overlay gleichzeitig,
         sodass man aus der Vorschau direkt auf der Startseite landete. */
      if (viewer && viewer.classList.contains('fullscreen')) { closeViewerFull(); return; }
      closeFs();
    });
  }

  /* ================================================================
     8. Admin / Volltext-Index → an die Core-Engine delegieren
     ================================================================ */
  /* ----------------------------------------------------------------
     v8.4: Das Upload-Fenster („Dokument hochladen") ist entfallen.
     Dokumente werden ausschließlich in SharePoint abgelegt; Struktur und
     Volltextindex ziehen automatisch nach. Ein zweiter Upload-Weg in der
     Anwendung wäre irreführend gewesen.
     Verbleibend: der Einstieg in die Einstellungen.
     ---------------------------------------------------------------- */
  function wireAdmin() {
    var sTop = $('#settingsTop');
    if (sTop) sTop.addEventListener('click', function () {
      if (window.IP67 && typeof window.IP67.openModal === 'function') {
        window.IP67.openModal();
      }
    });
  }

  /* ================================================================
     9. Hilfe am Fragezeichen · v9.5
     ----------------------------------------------------------------
     Die automatische Einführung beim Programmstart ist entfallen. Wer
     Hilfe braucht, fährt unten rechts über das Fragezeichen; dort
     öffnet sich ein kleines Menü mit
       · zwei Sprach-Einführungen (Anwender / Admin) und
       · den beiden Handbüchern aus SharePoint.

     Die Handbücher werden NICHT fest verdrahtet, sondern beim ersten
     Öffnen des Menüs im SharePoint-Ordner gesucht (erst im Unterordner
     „Handbuch", dann im Info-Pool-Ordner selbst). Damit bleibt der
     Dateiname frei wählbar – Hauptsache, er enthält „Handbuch" und
     „Anwender" bzw. „Admin".
     ================================================================ */
  var HELP_AUDIO = {
    anwender: 'mp3/einfuehrung-anwender.mp3',
    admin:    'mp3/einfuehrung-admin.mp3'
  };
  /* Unterordner, in dem zuerst nach den Handbüchern gesucht wird.
     Leerstring = nur der Info-Pool-Ordner selbst. */
  var HANDBUCH_ORDNER = 'Handbuch';

  var _helpAudio = null;      // aktuell laufendes Audio-Objekt
  var _handbuchP = null;      // Promise mit dem Suchergebnis (einmalig)

  function helpStop() {
    if (_helpAudio) { try { _helpAudio.pause(); } catch (e) {} }
    _helpAudio = null;
    var fab = $('#helpFab'); if (fab) fab.classList.remove('playing');
    var st = $('.hm-item.is-stop'); if (st) st.hidden = true;
  }

  function helpPlay(art) {
    var datei = HELP_AUDIO[art];
    var fab = $('#helpFab'), st = $('.hm-item.is-stop');
    helpStop();
    if (fab) { fab.classList.add('playing'); fab.classList.remove('audio-error'); }
    if (st) st.hidden = false;
    try {
      /* encodeURI: hält Leerzeichen und Umlaute im Pfad SharePoint-sicher. */
      var a = new Audio(encodeURI(datei));
      _helpAudio = a;
      a.addEventListener('ended', helpStop, { once: true });
      var pr = a.play();
      if (pr && pr.catch) pr.catch(function (err) {
        helpStop();
        if (fab) {
          fab.classList.add('audio-error');
          fab.title = 'Sprachdatei nicht abspielbar – bitte prüfen: ' + datei;
        }
        peToast('Die Sprachdatei „' + datei + '" konnte nicht abgespielt werden.', 'warn');
        if (window.console) console.warn('[Info-Pool 67] Audio nicht abspielbar:', datei, err);
      });
    } catch (e) {
      helpStop();
      if (fab) fab.classList.add('audio-error');
      if (window.console) console.warn('[Info-Pool 67] Audio-Fehler:', e);
    }
  }

  /* ---- Handbücher in SharePoint suchen (einmal pro Sitzung) ------- */
  function ladeHandbuecher() {
    if (_handbuchP) return _handbuchP;
    var S = window.IP67Storage;
    if (!S || !S.SP_SITE_URL) { _handbuchP = Promise.resolve({}); return _handbuchP; }

    function dateien(absPfad) {
      var url = S.SP_SITE_URL + "/_api/web/GetFolderByServerRelativeUrl('" +
                S.spEnc(absPfad) + "')/Files?$select=Name,ServerRelativeUrl&$top=500";
      return fetch(url, {
        credentials: 'include',
        headers: { 'Accept': 'application/json;odata=verbose' }
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (j) {
        var d = j && j.d;
        return (d && (d.results || (d.Files && d.Files.results))) || [];
      }).catch(function () { return []; });
    }

    var ordner = [];
    if (HANDBUCH_ORDNER) ordner.push(S.SP_FOLDER + '/' + HANDBUCH_ORDNER);
    ordner.push(S.SP_FOLDER);

    _handbuchP = Promise.all(ordner.map(dateien)).then(function (listen) {
      var alle = [];
      listen.forEach(function (l) { alle = alle.concat(l); });
      var treffer = {};
      alle.forEach(function (f) {
        var n = String(f.Name || '').toLowerCase();
        if (n.indexOf('handbuch') < 0) return;
        var istAdmin = /admin/.test(n);
        var istAnw   = /anwender|benutzer|nutzer/.test(n);
        var art = istAdmin ? 'admin' : (istAnw ? 'anwender' : '');
        /* Der erste Fund gewinnt – der Unterordner „Handbuch" wird zuerst
           durchsucht und hat damit Vorrang vor dem Hauptordner. */
        if (art && !treffer[art]) treffer[art] = String(f.ServerRelativeUrl || '');
      });
      return treffer;
    });
    return _handbuchP;
  }

  function oeffneHandbuch(art) {
    var S = window.IP67Storage;
    ladeHandbuecher().then(function (t) {
      var pfad = t && t[art];
      if (!pfad) {
        peToast('Kein Handbuch für „' + (art === 'admin' ? 'Admin' : 'Anwender') +
                '" gefunden. Erwartet wird eine Datei mit „Handbuch" und „' +
                (art === 'admin' ? 'Admin' : 'Anwender') + '" im Namen – im Ordner „' +
                (HANDBUCH_ORDNER || 'Infopool') + '".', 'warn');
        return;
      }
      var url = location.origin + (S && S.spEnc ? S.spEnc(pfad) : encodeURI(pfad));
      window.open(url, '_blank', 'noopener');
    });
  }

  function wireHelp() {
    var wrap = $('#helpWrap'), fab = $('#helpFab'), menu = $('#helpMenu');
    if (!wrap || !fab || !menu) return;
    var zu = null;

    function auf() {
      if (zu) { clearTimeout(zu); zu = null; }
      menu.classList.add('show');
      fab.setAttribute('aria-expanded', 'true');
      /* Beim ersten Öffnen im Hintergrund nach den Handbüchern sehen,
         damit der spätere Klick ohne Wartezeit reagiert. */
      ladeHandbuecher();
    }
    function schliessen(sofort) {
      if (zu) { clearTimeout(zu); zu = null; }
      if (sofort) {
        menu.classList.remove('show');
        fab.setAttribute('aria-expanded', 'false');
        return;
      }
      /* Kleine Verzögerung: der Weg vom Knopf zum Menü führt über eine
         Lücke – ohne Nachlauf klappt das Menü unterwegs zu. */
      zu = setTimeout(function () { schliessen(true); }, 260);
    }

    wrap.addEventListener('mouseenter', auf);
    wrap.addEventListener('mouseleave', function () { schliessen(false); });
    /* Klick/Tastatur: für Touch-Geräte und Bedienung ohne Maus. */
    fab.addEventListener('click', function (e) {
      e.preventDefault();
      if (menu.classList.contains('show')) schliessen(true); else auf();
    });
    wrap.addEventListener('focusin', auf);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu.classList.contains('show')) schliessen(true);
    });
    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) schliessen(true);
    });

    menu.addEventListener('click', function (e) {
      var it = e.target.closest ? e.target.closest('.hm-item') : null;
      if (!it) return;
      var was = it.getAttribute('data-help');
      if (was === 'stop')            { helpStop(); return; }
      if (was === 'audio-anwender')  { helpPlay('anwender'); schliessen(true); return; }
      if (was === 'audio-admin')     { helpPlay('admin');    schliessen(true); return; }
      if (was === 'buch-anwender')   { oeffneHandbuch('anwender'); schliessen(true); return; }
      if (was === 'buch-admin')      { oeffneHandbuch('admin');    schliessen(true); return; }
    });
  }

  /* ================================================================
     9b. Hell/Dunkel · v9.5
     ----------------------------------------------------------------
     Ohne Zutun folgt die Ansicht dem Tageslicht in Köln: vor
     Sonnenaufgang und nach Sonnenuntergang dunkel, dazwischen hell.
     Die Zeiten werden lokal gerechnet (Verfahren nach NOAA) – kein
     Netzdienst, keine externe Bibliothek, damit die Seite auch bei
     zickigem Stadtnetz zuverlässig startet.

     Der Knopf oben rechts schaltet von Hand um. Diese Handentscheidung
     gilt bis zum NÄCHSTEN Sonnenereignis; danach übernimmt wieder die
     Automatik. So bleibt die Automatik dauerhaft nützlich, ohne dass
     eine einmalige Handschaltung sie für immer abschaltet.
     ================================================================ */
  var KOELN = { lat: 50.9375, lon: 6.9603 };
  var THEME_KEY = 'ip67_theme_override';   // { theme:'dark'|'light', bis:<ms> }
  var THEME_LAST = 'ip67_theme_last';      // letzter wirksamer Zustand (Rückfall)
  /* v10.5 · { d:'YYYY-M-D', auf:<ms seit Mitternacht>, unter:<ms> } –
     die Grenzen, nicht der Zustand. Siehe unten merkeSonnenzeiten(). */
  var THEME_SONNE = 'ip67_theme_sonne';

  /* Sonnenauf-/untergang für ein Datum (Verfahren nach NOAA/SunCalc). */
  function sonnenZeiten(datum, lat, lon) {
    var rad = Math.PI / 180, tag = 86400000, J1970 = 2440588, J2000 = 2451545;
    var sin = Math.sin, cos = Math.cos, asin = Math.asin, acos = Math.acos;
    function ausJul(j) { return new Date((j + 0.5 - J1970) * tag); }
    var d  = datum.valueOf() / tag - 0.5 + J1970 - J2000;
    var lw = rad * -lon, phi = rad * lat;
    var n  = Math.round(d - 0.0009 - lw / (2 * Math.PI));
    var ds = 0.0009 + lw / (2 * Math.PI) + n;
    var M  = rad * (357.5291 + 0.98560028 * ds);
    var C  = rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M));
    var L  = M + C + rad * 102.9372 + Math.PI;
    var e  = rad * 23.4397;
    var dek = asin(sin(e) * sin(L));
    var mittag = J2000 + ds + 0.0053 * sin(M) - 0.0069 * sin(2 * L);
    var h0 = -0.833 * rad;
    var arg = (sin(h0) - sin(phi) * sin(dek)) / (cos(phi) * cos(dek));
    if (arg < -1 || arg > 1) return null;              // Polartag/-nacht
    var w = acos(arg);
    var dsSet = 0.0009 + (w + lw) / (2 * Math.PI) + n;
    var unter = J2000 + dsSet + 0.0053 * sin(M) - 0.0069 * sin(2 * L);
    var auf = mittag - (unter - mittag);
    return { auf: ausJul(auf), unter: ausJul(unter) };
  }

  /* ----------------------------------------------------------------
     v10.5 · Grenzen für die Vorabanzeige hinterlegen

     BEFUND: Die Vorabanzeige im Kopf der .aspx setzte bis v10.4 den
     zuletzt wirksamen Zustand. Wer tagsüber hell arbeitete und am
     Abend neu öffnete, sah deshalb zuerst Hell und einen Augenblick
     später den Sprung auf Dunkel.

     ÄNDERUNG: Diese Funktion – die einzige Stelle, die den Sonnenstand
     rechnet – legt ihr Ergebnis als TAGESZEIT ab. Die Vorabanzeige
     vergleicht nur noch und rechnet nichts nach; damit bleibt es bei
     einer Quelle für die Sonnenzeiten.

     WAS BLEIBT: Ist noch nichts hinterlegt (erster Besuch), greift in
     der .aspx weiterhin ip67_theme_last. Ist der Eintrag von gestern,
     ist er auf wenige Minuten genau – die Automatik korrigiert das
     unmittelbar danach ohnehin.
     ---------------------------------------------------------------- */
  var _sonneGemerkt = '';
  function tagesMs(d) {
    return ((d.getHours() * 60 + d.getMinutes()) * 60 + d.getSeconds()) * 1000;
  }
  function merkeSonnenzeiten(z) {
    try {
      var tag = z.auf.getFullYear() + '-' + (z.auf.getMonth() + 1) + '-' + z.auf.getDate();
      /* Nur einmal je Tag schreiben – themeAutomatik() läuft minütlich. */
      if (tag === _sonneGemerkt) return;
      _sonneGemerkt = tag;
      localStorage.setItem(THEME_SONNE, JSON.stringify({
        d: tag, auf: tagesMs(z.auf), unter: tagesMs(z.unter)
      }));
    } catch (e) {}
  }

  /* Liefert { theme, naechste } – naechste = Zeitpunkt des nächsten Wechsels. */
  function themeAutomatik(jetzt) {
    jetzt = jetzt || new Date();
    var z = sonnenZeiten(jetzt, KOELN.lat, KOELN.lon);
    if (z) merkeSonnenzeiten(z);
    if (!z) {   /* Notnagel, in Köln praktisch unerreichbar */
      var h = jetzt.getHours();
      return { theme: (h < 7 || h >= 19) ? 'dark' : 'light', naechste: null };
    }
    if (jetzt < z.auf)   return { theme: 'dark',  naechste: z.auf };
    if (jetzt < z.unter) return { theme: 'light', naechste: z.unter };
    /* Nach Sonnenuntergang: nächster Wechsel ist der Sonnenaufgang morgen. */
    var morgen = new Date(jetzt.getTime() + 86400000);
    var zm = sonnenZeiten(morgen, KOELN.lat, KOELN.lon);
    return { theme: 'dark', naechste: zm ? zm.auf : null };
  }

  function themeOverride() {
    try {
      var raw = localStorage.getItem(THEME_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.theme) return null;
      if (o.bis && Date.now() >= o.bis) { localStorage.removeItem(THEME_KEY); return null; }
      return o;
    } catch (e) { return null; }
  }

  function themeSetzen(theme, mitAnimation) {
    var el = document.documentElement;
    /* v10.5: Der Rückfallwert wird IMMER nachgeführt, auch wenn die
       Vorabanzeige bereits richtig lag. Bis v10.4 sprang die Funktion
       vorher heraus – dadurch veraltete ip67_theme_last genau bei den
       Nutzenden, bei denen die Vorabanzeige funktionierte. */
    try { localStorage.setItem(THEME_LAST, theme); } catch (e) {}
    if (el.getAttribute('data-theme') === theme) return;
    if (mitAnimation) {
      el.classList.add('theme-anim');
      setTimeout(function () { el.classList.remove('theme-anim'); }, 400);
    }
    el.setAttribute('data-theme', theme);
  }

  function themeKnopf(theme, quelle) {
    var ico = $('#themeIco'), txt = $('#themeTxt'), btn = $('#themeToggle');
    var zielDunkel = (theme !== 'dark');
    if (ico) ico.textContent = zielDunkel ? '\uD83C\uDF19' : '\u2600';
    if (txt) txt.textContent = zielDunkel ? 'Dunkel' : 'Hell';
    if (btn) btn.title = (theme === 'dark' ? 'Dunkle' : 'Helle') + ' Ansicht aktiv' +
      (quelle === 'auto'
        ? ' (folgt automatisch dem Tageslicht in Köln)'
        : ' (von Hand gewählt – bis zum nächsten Sonnenauf-/untergang)') +
      ' · Klicken zum Umschalten auf ' + (zielDunkel ? 'dunkel' : 'hell') + '.';
  }

  function themeAnwenden(mitAnimation) {
    var ov = themeOverride();
    var auto = themeAutomatik();
    var theme = ov ? ov.theme : auto.theme;
    themeSetzen(theme, mitAnimation);
    themeKnopf(theme, ov ? 'hand' : 'auto');
    return theme;
  }

  function wireTheme() {
    var btn = $('#themeToggle');
    themeAnwenden(false);
    if (btn) btn.addEventListener('click', function () {
      var jetzt = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      var ziel = (jetzt === 'dark') ? 'light' : 'dark';
      var auto = themeAutomatik();
      try {
        if (ziel === auto.theme) {
          /* Wieder im Einklang mit der Automatik – Handschaltung löschen. */
          localStorage.removeItem(THEME_KEY);
        } else {
          localStorage.setItem(THEME_KEY, JSON.stringify({
            theme: ziel,
            bis: auto.naechste ? auto.naechste.getTime() : (Date.now() + 12 * 3600000)
          }));
        }
      } catch (e) {}
      themeAnwenden(true);
    });
    /* Minütlich nachsehen: läuft die Seite über den Sonnenuntergang
       hinweg, wechselt die Ansicht von selbst. */
    setInterval(function () { themeAnwenden(true); }, 60000);
  }

  /* ================================================================
     10. Scroll-Effekte + Reveal/Stagger (wie im Mockup)
     ================================================================ */
  /* v8.5: Die scrollabhaengige Verschiebung/Ausblendung der Suchzone ist
     entfernt. Sie schrieb bei JEDEM Scroll-Tick inline transform+opacity auf
     #searchZone - zusammen mit der Fokus-Umschaltung war das die zweite
     Quelle der Unruhe. Fortschrittsbalken und Topbar bleiben erhalten. */
  function wireScroll() {
    var bar = $('#progressBar'), top = $('#topBar');
    var ticking = false;
    function onScroll() {
      if (ticking) return; ticking = true;
      requestAnimationFrame(function () {
        var sc = window.scrollY, max = document.documentElement.scrollHeight - window.innerHeight;
        if (bar)  bar.style.transform = 'scaleX(' + (max > 0 ? (sc / max) : 0).toFixed(4) + ')';
        if (top)  top.classList.toggle('stuck', sc > 12);
        ticking = false;
      });
    }
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
  function wireReveal() {
    if (!('IntersectionObserver' in window)) {
      $$('.reveal,.stagger').forEach(function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0, rootMargin: '0px 0px -8% 0px' });
    $$('.reveal,.stagger').forEach(function (el) { io.observe(el); });
  }

  /* ================================================================
     v8.5 · Begruessung nach Tageszeit + Namensabgleich (Punkt 3)
     ----------------------------------------------------------------
     Der Vorname wird NUR angezeigt, wenn der Nachname aus der
     Handyliste VOLLSTAENDIG im Windows-Anmeldenamen steckt
     (michelisa enthaelt michelis -> "Andre"). Teiltreffer wie
     "musterm" fuer "Mustermann" ergeben bewusst KEINEN Namen -
     lieber neutral gruessen als jemanden falsch ansprechen.
     ================================================================ */
  var GRUSS = {
    morgen:     ['Guten Morgen', 'Schön, dass Sie da sind'],
    vormittag:  ['Guten Morgen', 'Hallo'],
    mittag:     ['Guten Tag', 'Mahlzeit'],
    nachmittag: ['Guten Tag', 'Schönen Nachmittag'],
    abend:      ['Guten Abend', 'Schönen Feierabend'],
    nacht:      ['Noch spät unterwegs', 'Guten Abend']
  };
  var LEADS = [
    'Alle Dokumente, Personen und Themen aus Amt 67 – an einem Ort.',
    'Fragen Sie einfach – Dokumente, Personen und Themen aus Amt 67.',
    'Was brauchen Sie? Das ganze Amt 67 an einem Ort.',
    'Suchen Sie los – Dokumente, Personen und Themen aus Amt 67.'
  ];

  /* Ortszeit verwenden (Anti-Pattern A7: NICHT toISOString). */
  function tagesabschnitt() {
    var h = new Date().getHours();
    if (h >= 5  && h < 10) return 'morgen';
    if (h >= 10 && h < 12) return 'vormittag';
    if (h >= 12 && h < 14) return 'mittag';
    if (h >= 14 && h < 18) return 'nachmittag';
    if (h >= 18 && h < 23) return 'abend';
    return 'nacht';
  }
  function zufall(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /* Vergleichsform: Kleinschreibung, Umlaute wie im AD transliteriert. */
  function normName(s) {
    return String(s || '').toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]/g, '');
  }

  /* Windows-Anmeldename ueber die SharePoint-REST-API.
     Liefert z. B. "i:0#.w|domaene\michelisa" oder "DOMAENE\michelisa". */
  function currentLogin() {
    var base = (window.IP67Storage && window.IP67Storage.SP_SITE_URL) || '';
    if (!base) return Promise.resolve('');
    return fetch(base + '/_api/web/currentuser', {
      credentials: 'include',
      headers: { 'Accept': 'application/json;odata=verbose' }
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var d = (j && j.d) || {};
      return String(d.LoginName || d.Title || '');
    }).catch(function () { return ''; });
  }

  /* Laengster vollstaendig enthaltener Nachname gewinnt. Bleiben dabei
     mehrere verschiedene Personen uebrig (Meyer, Sengersdorf, Breuer sind
     doppelt vergeben), wird kein Name angezeigt. */
  function vornameZuLogin(login, people) {
    var kern = normName(String(login).split('|').pop().split('\\').pop().split('@')[0]);
    if (kern.length < 4) return '';
    var best = 0, treffer = [];
    (people || []).forEach(function (p) {
      var voll = String(p.name || '');
      var komma = voll.indexOf(',');
      if (komma < 0) return;
      var nach = normName(voll.slice(0, komma));
      /* Kurze Nachnamen (< 4 Zeichen) sind als Suchmuster zu unsicher -
         sie stecken zufaellig in fremden Anmeldenamen. */
      if (nach.length < 4 || kern.indexOf(nach) < 0) return;
      var vor = voll.slice(komma + 1).trim();
      if (nach.length > best) { best = nach.length; treffer = [{ v: vor, n: nach }]; }
      else if (nach.length === best) treffer.push({ v: vor, n: nach });
    });
    if (!treffer.length) return '';
    var eindeutig = {};
    treffer.forEach(function (t) { eindeutig[t.n + '|' + t.v] = 1; });
    return Object.keys(eindeutig).length === 1 ? treffer[0].v : '';
  }

  function setzeBegruessung(vorname) {
    var h1 = $('.hero h1'), lead = $('.hero .lead');
    if (h1) {
      var text = zufall(GRUSS[tagesabschnitt()]);
      h1.textContent = vorname ? (text + ', ' + vorname + '!') : (text + '!');
    }
    if (lead) lead.textContent = zufall(LEADS);
  }

  function wireBegruessung() {
    /* Sofort ohne Name setzen, damit nichts nachflackert. */
    setzeBegruessung('');
    Promise.all([currentLogin(), loadPeople()]).then(function (res) {
      var login = res[0], people = res[1];
      if (!login || !people || !people.length) return;
      var vor = vornameZuLogin(login, people);
      if (!vor) {
        console.info('[Info-Pool 67] Begruessung: kein eindeutiger Nachname zu "' + login + '" – ohne Namen.');
        return;
      }
      var h1 = $('.hero h1');
      if (h1 && h1.textContent) h1.textContent = h1.textContent.replace(/!$/, ', ' + vor + '!');
    }).catch(function (e) {
      console.info('[Info-Pool 67] Begruessung ohne Namen:', e && e.message);
    });
  }


  /* ================================================================
     12. v8.7 · Adminmodus (Alt+Shift+A)
     ----------------------------------------------------------------
     Ausdruecklich KEIN Rechtesystem. Wer diese Datei im Browser
     oeffnet, findet die Tastenkombination. Der eigentliche Schutz
     liegt in den SharePoint-Schreibrechten auf Mitarbeiterliste.json
     und dokument-meta.json - schlaegt der Upload dort fehl, kann auch
     ein "Admin" hier nichts veraendern.
     Zweck ist, dass die Bearbeiten-Einstiege den 130 taeglichen
     Nutzern nicht im Weg stehen und niemand versehentlich etwas
     verstellt. Der Zustand gilt bis der Tab geschlossen wird.
     ================================================================ */
  var ADMIN_KEY = 'ip67_admin';
  var _admin = false;

  function isAdmin() { return _admin; }

  function setAdmin(on, still) {
    _admin = !!on;
    try { sessionStorage.setItem(ADMIN_KEY, _admin ? '1' : '0'); } catch (e) {}
    document.body.classList.toggle('ip67-admin', _admin);
    /* v8.9: „Einstellungen" ist reine Verwaltung und erscheint nur im
       Adminmodus. Für die tägliche Nutzung gibt es dort nichts zu holen. */
    var sTop = $('#settingsTop'); if (sTop) sTop.hidden = !_admin;
    renderAdminFlag();
    /* Offene Ansichten sofort nachziehen, damit die Buttons nicht erst
       nach dem Schliessen und erneuten Oeffnen erscheinen. */
    var body = $('#fsBody');
    if (body && $('#fsOverlay') && $('#fsOverlay').classList.contains('show')) {
      if (body.querySelector('#handyTbl')) renderHandy(body);
      else if (body.querySelector('.org-tree, .org-toolbar')) renderOrgInto(body);
      else if (body.querySelector('.fs-tabs')) renderInhalteInto(body);
    }
    refreshGiltBar();
    /* v9.1: Themenstruktur neu rendern, damit die Ordner-Pflege-Buttons
       sofort erscheinen/verschwinden, ohne dass ein Reload noetig ist. */
    if ($('.nav-card')) renderNav();
    if (!still) {
      peToast(_admin
        ? 'Adminmodus an – Bearbeiten-Schaltflächen sind jetzt sichtbar.'
        : 'Adminmodus aus.', _admin ? 'warn' : 'ok');
    }
  }

  function renderAdminFlag() {
    var f = document.getElementById('adminFlag');
    if (!_admin) { if (f) f.remove(); return; }
    if (!f) {
      f = document.createElement('div');
      f.id = 'adminFlag';
      f.className = 'admin-flag';
      f.innerHTML = '<span><b>Adminmodus</b> – Bearbeiten ist freigeschaltet ' +
                    '(Alt+Umschalt+A)</span>' +
                    '<button type="button" class="af-x">Beenden</button>';
      document.body.appendChild(f);
      f.querySelector('.af-x').addEventListener('click', function () { setAdmin(false); });
    }
  }

  function wireAdminMode() {
    try { _admin = sessionStorage.getItem(ADMIN_KEY) === '1'; } catch (e) { _admin = false; }
    var sTop0 = $('#settingsTop'); if (sTop0) sTop0.hidden = !_admin;
    if (_admin) { document.body.classList.add('ip67-admin'); renderAdminFlag(); }
    addEventListener('keydown', function (e) {
      /* e.code statt e.key: bei gedruecktem Alt liefern Windows-Layouts
         fuer e.key teils Sonderzeichen statt "A". */
      if (e.altKey && e.shiftKey && !e.ctrlKey && (e.code === 'KeyA' || e.key === 'A' || e.key === 'a')) {
        e.preventDefault();
        setAdmin(!_admin);
      }
    });
  }

  /* ================================================================
     13. v8.7 · Gültigkeit und Zuständigkeit je Dokument
     ----------------------------------------------------------------
     Ein Wissensspeicher ohne Verfallsdatum verrottet leise: nach zwei
     Jahren weiss niemand mehr, ob eine Dienstanweisung noch gilt, und
     dann glaubt niemand mehr dem ganzen Bestand.
     Quelle: dokument-meta.json im Infopool-Ordner.
         { "<knoten-id>": { "geprueft":"2026-03-15",
                            "frist": 24,               // Monate
                            "zustaendig":"Nachname, Vorname",
                            "hinweis":"freier Text" }, ... }
     WICHTIG: Angaben duerfen auch an ORDNER-IDs haengen. Ein Dokument
     ohne eigene Angabe erbt vom naechsten Vorfahren. Dadurch pflegt
     man rund 20 Ordner statt mehrerer hundert Dateien - der einzige
     Grund, warum so eine Pflege im Alltag ueberhaupt durchgehalten wird.
     ================================================================ */
  var META_FILE = 'dokument-meta.json';
  var _meta = null;          // roh, wie in der Datei
  var _metaDirty = false;
  var _parentOf = {};        // knoten-id -> eltern-id (aus flatten())

  function loadMeta() {
    if (_meta) return Promise.resolve(_meta);
    var S = window.IP67Storage;
    if (!S || typeof S.spReadFileText !== 'function') { _meta = {}; return Promise.resolve(_meta); }
    return S.spReadFileText(S.SP_FOLDER + '/' + META_FILE).then(function (txt) {
      try { _meta = JSON.parse(String(txt).replace(/^\uFEFF/, '')) || {}; }
      catch (e) { _meta = {}; console.warn('[Info-Pool 67] ' + META_FILE + ' ist kein gültiges JSON.'); }
      return _meta;
    }).catch(function () {
      /* Datei fehlt noch - das ist der Normalzustand vor der ersten
         Pflege und ausdruecklich kein Fehler. */
      _meta = {};
      return _meta;
    });
  }

  function saveMeta() {
    var S = window.IP67Storage;
    var data = JSON.stringify(_meta || {}, null, 2);
    if (!S || typeof S.spUploadFile !== 'function') {
      peToast('Speicher-Modul nicht verfügbar – Angaben konnten nicht abgelegt werden.', 'warn');
      return Promise.resolve();
    }
    return S.spUploadFile(S.SP_FOLDER, META_FILE, data).then(function () {
      _metaDirty = false;
      peToast('✓ Angaben gespeichert.', 'ok');
    }).catch(function (e) {
      console.error('[Info-Pool 67] ' + META_FILE + ' speichern fehlgeschlagen:', e);
      peToast('Speichern fehlgeschlagen (' + (e && e.message ? e.message : 'unbekannt') +
              '). Bitte Schreibrechte auf den Infopool-Ordner prüfen.', 'warn');
    });
  }

  /* Eigene Angabe, sonst die des naechsten Vorfahren. */
  function metaFor(id) {
    if (!id || !_meta) return null;
    var cur = id, guard = 0;
    while (cur && guard++ < 20) {
      var m = _meta[cur];
      if (m && (m.geprueft || m.zustaendig)) {
        return { m: m, vonOrdner: cur !== id, quelle: cur };
      }
      cur = _parentOf[cur] || null;
    }
    return null;
  }

  function addMonths(iso, months) {
    var d = new Date(iso + 'T12:00:00');
    if (isNaN(d.getTime())) return null;
    d.setMonth(d.getMonth() + (months || 24));
    return d;
  }
  function deDate(iso) {
    if (!iso) return '';
    var t = String(iso).slice(0, 10).split('-');
    return t.length === 3 ? (t[2] + '.' + t[1] + '.' + t[0]) : String(iso);
  }
  function heuteIso() {
    /* Ortszeit, nicht toISOString - sonst kippt der Tag am Abend um. */
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
           '-' + String(d.getDate()).padStart(2, '0');
  }

  /* Zustand eines Dokuments: 'ok' | 'due' | 'none' */
  function giltStatus(id) {
    var f = metaFor(id);
    if (!f || !f.m.geprueft) return { st: 'none', f: f };
    var faellig = addMonths(f.m.geprueft, f.m.frist || 24);
    if (faellig && faellig.getTime() < Date.now()) return { st: 'due', f: f, faellig: faellig };
    return { st: 'ok', f: f, faellig: faellig };
  }

  /* Zustaendige Person aus der Mitarbeiterliste heraussuchen. */
  function personByName(name) {
    if (!name) return null;
    var key = normName(name);
    var L = _peopleCache || [];
    for (var i = 0; i < L.length; i++) if (normName(L[i].name) === key) return L[i];
    /* Zweiter Versuch: nur der Nachname vor dem Komma. */
    for (var j = 0; j < L.length; j++) {
      var nach = String(L[j].name).split(',')[0];
      if (nach && normName(nach) === key) return L[j];
    }
    return null;
  }

  var _giltDocId = null;

  function refreshGiltBar() { if (_giltDocId !== null) renderGiltBar(_giltDocId); }

  function renderGiltBar(docIdx) {
    var el = $('#vGilt');
    if (!el) return;
    _giltDocId = docIdx;
    var d = docs[docIdx];
    if (!d || !d.id) { el.hidden = true; return; }
    var g = giltStatus(d.id);
    var txt, cls;
    if (g.st === 'ok') {
      cls = 'is-ok';
      txt = 'Geprüft am ' + deDate(g.f.m.geprueft) +
            (g.faellig ? ' · nächste Prüfung ' + deDate(g.faellig.toISOString()) : '');
    } else if (g.st === 'due') {
      cls = 'is-due';
      txt = '⚠ Prüfung überfällig – zuletzt geprüft am ' + deDate(g.f.m.geprueft);
    } else {
      cls = 'is-none';
      txt = 'Noch nicht auf Aktualität geprüft';
    }
    if (g.f && g.f.vonOrdner) txt += ' (Angabe des übergeordneten Ordners)';

    var pers = '';
    if (g.f && g.f.m.zustaendig) {
      var p = personByName(g.f.m.zustaendig);
      var lbl = esc(g.f.m.zustaendig);
      pers = '<span class="g-pers">Zuständig: ' +
        (p && p.tel
          ? '<a href="tel:' + escAttr(p.tel) + '" title="Anrufen">' + lbl + '</a> ' +
            '<span class="mono">' + esc(p.tel) + '</span>'
          : '<a href="#" data-gp="' + escAttr(g.f.m.zustaendig) + '">' + lbl + '</a>') +
        '</span>';
    }
    var btn = isAdmin()
      ? '<button type="button" class="g-edit" id="giltEdit">✎ Angaben pflegen</button>'
      : '';
    el.className = 'v-gilt ' + cls;
    el.hidden = false;
    el.innerHTML = '<span class="g-dot"></span><span>' + esc(txt) + '</span>' +
      (g.f && g.f.m.hinweis ? '<span> · ' + esc(g.f.m.hinweis) + '</span>' : '') +
      pers + (pers ? '' : '<span class="g-pers"></span>') + btn;

    var e2 = el.querySelector('#giltEdit');
    if (e2) e2.addEventListener('click', function () { openGiltForm(docIdx); });
    var gp = el.querySelector('[data-gp]');
    if (gp) gp.addEventListener('click', function (ev) {
      ev.preventDefault();
      openPersonIn('handy', gp.dataset.gp);
    });
  }

  function openGiltForm(docIdx) {
    var d = docs[docIdx]; if (!d || !d.id) return;
    openGiltFormFor(d.id, d.t, false, function () { renderGiltBar(docIdx); });
  }

  /* v9.1: Generische Variante - nimmt direkt eine Knoten-ID statt eines
     Dokumentindex entgegen. Dadurch laesst sich dasselbe Formular auch
     an ORDNER-Knoten der Themenstruktur oeffnen, nicht nur am gerade
     angezeigten Dokument. onSaved wird nach dem Speichern aufgerufen,
     damit der jeweilige Aufrufer seine Ansicht aktualisieren kann. */
  function openGiltFormFor(id, titel, istOrdner, onSaved) {
    if (!id) return;
    var eigen = (_meta && _meta[id]) || {};
    var geerbt = metaFor(id);
    var namen = (_peopleCache || []).map(function (x) {
      return '<option value="' + escAttr(x.name) + '">';
    }).join('');
    var host = document.createElement('div');
    host.className = 'pe-modal';
    host.innerHTML =
      '<div class="pe-card" role="dialog" aria-modal="true" aria-label="Angaben zum ' +
        (istOrdner ? 'Ordner' : 'Dokument') + '">' +
        '<div class="pe-head"><div class="pe-h">Gültigkeit und Zuständigkeit</div>' +
          '<button type="button" class="pe-x" data-act="cancel" aria-label="Schließen">✕</button></div>' +
        '<div class="pe-body">' +
          '<div class="pe-editnote">Gilt für <strong>' + esc(titel || '') + '</strong>' +
            (istOrdner ? ' <span class="pe-hint">(und alle Dokumente darin ohne eigene Angabe)</span>' : '') + '. ' +
            'Leer lassen heißt: die Angabe des übergeordneten Ordners gilt weiter' +
            (geerbt && geerbt.vonOrdner ? ' (derzeit geprüft am ' + deDate(geerbt.m.geprueft) + ').' : '.') +
          '</div>' +
          '<label class="pe-f"><span class="pe-lbl">Zuletzt geprüft am</span>' +
            '<input id="gf-datum" type="date" value="' + escAttr(String(eigen.geprueft || '').slice(0, 10)) + '">' +
            '<span class="pe-hint">Das Datum, an dem jemand den Inhalt zuletzt fachlich bestätigt hat.</span></label>' +
          '<label class="pe-f"><span class="pe-lbl">Erneut prüfen nach</span>' +
            '<select id="gf-frist">' +
              [6, 12, 24, 36, 60].map(function (m) {
                return '<option value="' + m + '"' + ((eigen.frist || 24) === m ? ' selected' : '') + '>' +
                       m + ' Monaten</option>';
              }).join('') +
            '</select></label>' +
          '<label class="pe-f"><span class="pe-lbl">Zuständig</span>' +
            '<input id="gf-pers" list="gf-pers-list" value="' + escAttr(eigen.zustaendig || '') + '" ' +
              'placeholder="Nachname, Vorname" autocomplete="off">' +
            '<datalist id="gf-pers-list">' + namen + '</datalist>' +
            '<span class="pe-hint">Name aus der Handyliste – die Durchwahl wird automatisch ergänzt.</span></label>' +
          '<label class="pe-f"><span class="pe-lbl">Hinweis (optional)</span>' +
            '<input id="gf-hint" value="' + escAttr(eigen.hinweis || '') + '" ' +
              'placeholder="z. B. ersetzt DA 03/2019"></label>' +
        '</div>' +
        '<div class="pe-foot">' +
          '<button type="button" class="pe-btn" data-act="heute">Heute geprüft</button>' +
          '<button type="button" class="pe-btn" data-act="cancel">Abbrechen</button>' +
          '<button type="button" class="pe-btn pe-btn-prim" data-act="ok">Speichern</button>' +
        '</div></div>';
    document.body.appendChild(host);

    function close() { host.remove(); document.removeEventListener('keydown', onKey, true); }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    document.addEventListener('keydown', onKey, true);

    host.addEventListener('click', function (e) {
      if (e.target === host) { close(); return; }
      var b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'cancel') { close(); return; }
      if (b.dataset.act === 'heute') { host.querySelector('#gf-datum').value = heuteIso(); return; }
      var rec = {
        geprueft:   host.querySelector('#gf-datum').value || '',
        frist:      +host.querySelector('#gf-frist').value || 24,
        zustaendig: host.querySelector('#gf-pers').value.trim(),
        hinweis:    host.querySelector('#gf-hint').value.trim()
      };
      if (!_meta) _meta = {};
      if (!rec.geprueft && !rec.zustaendig && !rec.hinweis) delete _meta[id];
      else _meta[id] = rec;
      close();
      saveMeta().then(function () { if (typeof onSaved === 'function') onSaved(); });
    });
  }

  /* ================================================================
     14. v8.7 · Erfolglose Suchen protokollieren
     ----------------------------------------------------------------
     Die wertvollste Information, die ein Wissensspeicher erzeugt:
     wonach gesucht wird, was es aber nicht gibt. Das ist die Liste
     der fehlenden Inhalte - kostenlos und ohne Umfrage.
     Gefiltert wird bewusst streng, sonst besteht das Protokoll aus
     halb getippten Woertern:
       · mindestens 3 Zeichen
       · 1,4 s Tippruhe (kein Zwischenstand)
       · wirklich null Treffer in ALLEN Rubriken
     Geschrieben wird gebuendelt (nicht bei jedem Tastendruck) per
     Lesen-Aendern-Schreiben. Bei gleichzeitigem Schreiben zweier
     Nutzer kann im Ausnahmefall ein Zaehlerschritt verloren gehen -
     fuer eine Bedarfsliste ist das ohne Belang.
     ================================================================ */
  var GAPS_FILE  = 'such-luecken.json';
  var GAPS_LOCAL = 'ip67_gaps_pending';
  var _gaps = null;
  var _gapTimer = null;

  function gapsPending() {
    try { return JSON.parse(localStorage.getItem(GAPS_LOCAL) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function gapsPendingSet(o) {
    try { localStorage.setItem(GAPS_LOCAL, JSON.stringify(o)); } catch (e) {}
  }

  function noteGap(q) {
    q = String(q || '').trim().toLowerCase();
    if (q.length < 3 || q.length > 60) return;
    var pend = gapsPending();
    pend[q] = (pend[q] || 0) + 1;
    gapsPendingSet(pend);
    clearTimeout(_gapTimer);
    _gapTimer = setTimeout(flushGaps, 20000);
  }

  function loadGaps() {
    if (_gaps) return Promise.resolve(_gaps);
    var S = window.IP67Storage;
    if (!S || typeof S.spReadFileText !== 'function') { _gaps = {}; return Promise.resolve(_gaps); }
    return S.spReadFileText(S.SP_FOLDER + '/' + GAPS_FILE).then(function (txt) {
      try { _gaps = JSON.parse(String(txt).replace(/^\uFEFF/, '')) || {}; } catch (e) { _gaps = {}; }
      return _gaps;
    }).catch(function () { _gaps = {}; return _gaps; });
  }

  function flushGaps() {
    var pend = gapsPending();
    var keys = Object.keys(pend);
    if (!keys.length) return Promise.resolve();
    var S = window.IP67Storage;
    if (!S || typeof S.spUploadFile !== 'function') return Promise.resolve();
    /* Immer frisch lesen, damit die Eintraege anderer erhalten bleiben. */
    _gaps = null;
    return loadGaps().then(function (server) {
      var heute = heuteIso();
      keys.forEach(function (k) {
        var e = server[k] || { n: 0, erst: heute, letzt: heute };
        e.n = (e.n || 0) + pend[k];
        e.letzt = heute;
        if (!e.erst) e.erst = heute;
        server[k] = e;
      });
      return S.spUploadFile(S.SP_FOLDER, GAPS_FILE, JSON.stringify(server, null, 2));
    }).then(function () {
      gapsPendingSet({});
    }).catch(function (e) {
      /* Nicht schlimm - beim naechsten Versuch erneut. Der lokale
         Puffer bleibt bewusst stehen. */
      console.info('[Info-Pool 67] Suchlücken noch nicht übertragen:', e && e.message);
    });
  }

  function wireGaps() {
    addEventListener('pagehide', function () { flushGaps(); });
    /* Beim Start uebertragen, was beim letzten Mal liegen geblieben ist. */
    setTimeout(flushGaps, 8000);
  }

  /* ================================================================
     15. v8.7 · Neu seit Ihrem letzten Besuch
     ----------------------------------------------------------------
     Der Grund, wiederzukommen. Ohne diesen Blick ist ein Info-Pool
     ein Ort, den man nur aufsucht, wenn man ohnehin schon weiss,
     dass man etwas braucht.
     Der Zeitstempel wird erst beim VERLASSEN der Seite fortgeschrieben,
     damit die Neuheiten waehrend des ganzen Besuchs sichtbar bleiben
     und nicht schon nach dem ersten Klick verschwinden.
     ================================================================ */
  var VISIT_KEY = 'ip67_last_visit';
  var _lastVisit = null;
  /* v9.7 · Punkt 6: Beginn DIESES Seitenaufrufs. Siehe stampVisit(). */
  var _sitzungsStart = new Date().toISOString();

  function readLastVisit() {
    try { _lastVisit = localStorage.getItem(VISIT_KEY) || null; } catch (e) { _lastVisit = null; }
    return _lastVisit;
  }
  /* ----------------------------------------------------------------
     v9.7 · Punkt 6: Hier lag der Fehler, warum frisch hochgeladene
     Dokumente nie als „neu“ erschienen.
     ----------------------------------------------------------------
     Bisher wurde beim Verlassen der Seite die AKTUELLE Uhrzeit
     gespeichert. Wer ein Dokument hochlaedt, waehrend der Info-Pool
     offen ist, und danach neu laedt, verschiebt damit den Stichtag auf
     einen Zeitpunkt NACH dem Hochladen - die Datei liegt fortan vor dem
     Stichtag und gilt fuer immer als alt. Genau dieser Ablauf ist der
     Normalfall bei allen, die Inhalte einstellen.
     Gespeichert wird deshalb der BEGINN der Sitzung. Alles, was
     waehrend einer offenen Sitzung dazukommt, liegt danach zuverlaessig
     hinter dem Stichtag und wird beim naechsten Start gemeldet.
     Der Preis: Dokumente, die man in derselben Sitzung schon gesehen
     hat, koennen beim naechsten Mal noch einmal auftauchen. Das ist die
     ungefaehrlichere Seite des Irrtums - lieber einmal zu viel gemeldet
     als eine Neuerung dauerhaft verschluckt.
     ---------------------------------------------------------------- */
  function stampVisit() {
    try { localStorage.setItem(VISIT_KEY, _sitzungsStart); } catch (e) {}
  }

  /* Dateien, die seit dem letzten Besuch dazugekommen oder geaendert
     wurden. Beim allerersten Besuch bewusst LEER - sonst waeren 500
     Dokumente "neu" und die Anzeige waertlos. */
  function neueDateien() {
    if (!_lastVisit) return [];
    var LT = window.IP67LiveTree;
    if (!LT || typeof LT.listFiles !== 'function') return [];
    var seit = Date.parse(_lastVisit);
    if (isNaN(seit)) return [];
    return LT.listFiles().filter(function (f) {
      var t = f.modified ? Date.parse(f.modified) : NaN;
      return !isNaN(t) && t > seit;
    }).sort(function (a, b) {
      return Date.parse(b.modified) - Date.parse(a.modified);
    }).slice(0, 60);
  }

  /* v8.8 · Punkt 4: Kurzer Blick auf die Startseite.
     ----------------------------------------------------------------
     Der Kasten ist bewusst fluechtig: er soll beim Ankommen auffallen,
     aber die Startseite nicht dauerhaft zustellen - die Suche ist der
     Hauptweg. Nach 30 Sekunden blendet er sich selbst aus. Die
     vollstaendige Liste bleibt unter „Inhalte" verfuegbar, solange die
     Seite offen ist.
     Ein einmal weggeklickter Kasten kommt in derselben Sitzung nicht
     wieder; der Zeitstempel wird trotzdem erst beim Verlassen der Seite
     fortgeschrieben, damit „Inhalte" weiter alles zeigt. */
  /* v9.5: von drei Minuten auf 30 Sekunden verkürzt. */
  var NEU_SEKUNDEN = 30;

  function renderNeuSektion(liste) {
    var sec = $('#neuSec');
    if (!sec || !liste.length) return;
    var zeig = liste.slice(0, 5);
    sec.innerHTML =
      '<div class="neu-head"><h2>Neu seit Ihrem letzten Besuch</h2>' +
        '<span class="nh-n">' + liste.length + '</span>' +
        '<button type="button" class="nh-x" data-neu="zu">Ausblenden</button></div>' +
      zeig.map(function (f) {
        var ordner = String(f.href || '').split('/').slice(1, -1).join(' \u203a ');
        return '<div class="nl-row" data-href="' + escAttr(f.href) + '" data-title="' + escAttr(f.title) + '">' +
          '<div><div class="nl-t">' + esc(f.title) + '</div>' +
          '<div class="nl-p">' + esc(ordner || 'Ablage') + '</div></div>' +
          '<div class="nl-d">' + deDate(f.modified) + '</div></div>';
      }).join('') +
      (liste.length > zeig.length
        ? '<a href="#" class="neu-more" data-neu="alle">Alle ' + liste.length +
          ' Neuerungen unter „Inhalte" ansehen \u2192</a>'
        : '');
    sec.hidden = false;

    sec.addEventListener('click', function (e) {
      var x = e.target.closest('[data-neu]');
      if (x) {
        e.preventDefault();
        if (x.dataset.neu === 'zu') { versteckeNeu(true); return; }
        versteckeNeu(true);
        if (typeof window.__ip67_openFs === 'function') {
          window.__ip67_openFs('inhalte');
          /* Direkt auf dem Reiter „Neu" landen. */
          setTimeout(function () {
            var t = document.querySelector('.fs-tab[data-tab="neu"]');
            if (t) t.click();
          }, 60);
        }
        return;
      }
      var r = e.target.closest('.nl-row'); if (!r) return;
      openByHref(r.dataset.href, r.dataset.title);
      openViewerFull();
    });

    /* Selbstausblendung. setTimeout statt CSS-Animation, damit der Kasten
       aus dem Layout verschwindet und keine Luecke hinterlaesst. */
    setTimeout(function () { versteckeNeu(false); }, NEU_SEKUNDEN * 1000);
  }

  function versteckeNeu(sofort) {
    var sec = $('#neuSec');
    if (!sec || sec.hidden) return;
    sec.classList.add('is-fading');
    setTimeout(function () { sec.hidden = true; sec.classList.remove('is-fading'); },
               sofort ? 200 : 500);
  }

  function wireNeu() {
    readLastVisit();
    addEventListener('pagehide', stampVisit);
    /* v9.7: Zusätzliche Absicherung. `pagehide` feuert nicht in jeder
       Konstellation zuverlässig (abgewürgter Tab, Standby). Da jetzt
       ein FESTER Wert (der Sitzungsbeginn) geschrieben wird, ist ein
       mehrfaches Stempeln folgenlos – es schreibt immer dasselbe. */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') stampVisit();
    });
    var liste = neueDateien();
    /* v9.5 · Nachvollziehbarkeit: bleibt der Kasten aus, steht in der
       Konsole, woran es lag – kein letzter Besuch (erster Aufruf),
       leere Ablage (LiveTree-Fehler) oder schlicht nichts Neues. */
    if (window.console) {
      var LT = window.IP67LiveTree;
      console.info('[Info-Pool 67] Neu-Prüfung ·',
        'letzter Besuch:', _lastVisit || '(keiner – beim ersten Aufruf bleibt die Anzeige leer)',
        '· Dateien in der Ablage:', (LT && LT.listFiles) ? LT.listFiles().length : 0,
        '· davon neu:', liste.length);
    }
    var b = $('#chipNeuBadge');
    if (b && liste.length) { b.textContent = liste.length > 99 ? '99+' : String(liste.length); b.hidden = false; }
    renderNeuSektion(liste);
  }

  /* ================================================================
     16. v8.7 · Overlay „Inhalte"
     ----------------------------------------------------------------
     „Themen durchstöbern" stand bisher weit unten auf der Seite und
     wurde daher kaum gefunden. Der Einstieg sitzt jetzt als dritter
     Chip direkt unter dem Suchfeld - dort, wo der Blick beim Öffnen
     der Seite ohnehin steht - und nutzt dasselbe Vollbild-Muster wie
     Handyliste und Organigramm (schließen mit Esc).
     ================================================================ */
  function renderInhalteInto(container) {
    if (!container) return;
    var neu = neueDateien();
    var tabs =
      '<div class="fs-tabs">' +
        '<button type="button" class="fs-tab is-on" data-tab="struktur">Themenstruktur</button>' +
        /* v10.3 · AP6: Der Reiter steht bewusst ZWISCHEN Themenstruktur und
           „Neu seit letztem Besuch". Wer die Ablage durchsieht, soll direkt
           daneben sehen, welche Dokumente die Volltextsuche NICHT erfasst -
           sonst sucht man dort vergeblich und haelt den Info-Pool fuer
           unvollstaendig. */
        '<button type="button" class="fs-tab" data-tab="ohneindex">Dokumente ohne Indexsuche' +
          (ohneIndexAnzahl() ? '<span class="tb">' + ohneIndexAnzahl() + '</span>' : '') + '</button>' +
        '<button type="button" class="fs-tab" data-tab="neu">Neu seit letztem Besuch' +
          (neu.length ? '<span class="tb">' + neu.length + '</span>' : '') + '</button>' +
        (isAdmin() ? '<button type="button" class="fs-tab" data-tab="luecken">Wissenslücken</button>' : '') +
      '</div>';
    container.innerHTML = tabs +
      '<div class="fs-pane is-on" data-pane="struktur">' +
        '<div class="fs-hint">Die vollständige Ablage aus SharePoint. Links den Bereich wählen, ' +
          'rechts Ordner aufklappen – ein Klick auf ein Dokument öffnet die Vorschau.</div>' +
        filterLeiste('treeFilter', 'Themen und Dokumente durchsuchen',
          'Ordner oder Dokument \u2026') +
        '<div class="tree-split">' +
          '<aside class="tree-nav" id="treeNav"></aside>' +
          '<div class="tree-main" id="treeCols"></div>' +
        '</div>' +
      '</div>' +
      '<div class="fs-pane" data-pane="ohneindex"><div class="fs-note">Wird ermittelt &hellip;</div></div>' +
      '<div class="fs-pane" data-pane="neu"></div>' +
      (isAdmin() ? '<div class="fs-pane" data-pane="luecken"><div class="fs-note">Lade …</div></div>' : '');

    /* --- Reiter --- */
    container.querySelector('.fs-tabs').addEventListener('click', function (e) {
      var b = e.target.closest('.fs-tab'); if (!b) return;
      $$('.fs-tab', container).forEach(function (x) { x.classList.toggle('is-on', x === b); });
      $$('.fs-pane', container).forEach(function (x) {
        x.classList.toggle('is-on', x.dataset.pane === b.dataset.tab);
      });
      if (b.dataset.tab === 'luecken') renderLueckenInto(container.querySelector('[data-pane="luecken"]'));
      /* Bewusst bei JEDEM Oeffnen neu: der Hintergrund-Abgleich laeuft
         weiter, waehrend die Seite offen ist. Eine einmal gerenderte
         Liste waere nach wenigen Minuten falsch. */
      if (b.dataset.tab === 'ohneindex') renderOhneIndexInto(container.querySelector('[data-pane="ohneindex"]'));
    });

    /* --- Struktur --- */
    /* v8.8 · Punkt 2: Jeder oberste Abschnitt wird zu einer eigenen Karte
       im Grid. Vorher lief der ganze Baum durch ein CSS-Mehrspaltenlayout;
       dabei floss der Inhalt von Spalte zu Spalte und zerschnitt die
       Hierarchie – Dateien standen scheinbar losgelöst neben ihrem Ordner,
       und jedes Auf-/Zuklappen ordnete alles neu an. Karten fliessen nicht. */
    /* ----------------------------------------------------------------
       v9.7 · Punkt 4: Bereichsnavigation statt Kachelteppich
       ----------------------------------------------------------------
       Bisher wurde jeder oberste Ordner zu einer Karte, alle Karten
       nebeneinander in ein Raster. Bei drei Bereichen war das
       uebersichtlich. Bei zwanzig oder dreissig waere es eine Wand aus
       Kaesten, durch die man scrollen muss, um ueberhaupt zu sehen,
       welche Bereiche es gibt.
       Jetzt gilt das Muster, das jedes Ablagesystem benutzt: LINKS eine
       ruhige Liste aller Bereiche mit der Zahl der Dokumente darin,
       RECHTS der Baum genau eines Bereichs. Die Liste bleibt auch bei
       fuenfzig Bereichen auf einen Blick erfassbar; der Baum rechts
       bleibt so flach wie bisher.
       „Alle Bereiche“ bleibt als erster Eintrag erhalten - fuer den
       Fall, dass jemand die frueher gewohnte Gesamtansicht sucht, und
       als Ziel bei aktivem Filter (siehe unten).
       Gerendert wird EINMAL; die Auswahl schaltet nur Sichtbarkeiten um.
       Damit gehen aufgeklappte Ordner beim Bereichswechsel nicht
       verloren, und es wird nie waehrend einer Eingabe neu gezeichnet.
       ---------------------------------------------------------------- */
    var cols = container.querySelector('#treeCols');
    var nav  = container.querySelector('#treeNav');
    var data = window.sidebarInitData || [];
    var karten = [];
    var bereiche = [];
    var lose = '';
    data.forEach(function (top) {
      if (top.href === '#home') return;
      var k = kidsOf(top);
      if (top.type === 'group' || (k && k.length)) {
        bereiche.push(top.title);
        karten.push('<div class="tree-card" data-area="' + (bereiche.length - 1) + '">' +
          '<div class="nav-sec">' + esc(top.title) + '</div>' +
          (k || []).map(function (c) { return navItem(c, 0); }).join('') + '</div>');
      } else {
        lose += navItem(top, 0);
      }
    });
    if (lose) {
      bereiche.push('Weitere');
      karten.push('<div class="tree-card" data-area="' + (bereiche.length - 1) + '">' +
        '<div class="nav-sec">Weitere</div>' + lose + '</div>');
    }
    cols.innerHTML = karten.join('') ||
      '<div class="fs-note">Die Themenstruktur ist derzeit nicht geladen.</div>';

    /* Dokumentzahl je Bereich – aus dem gerenderten Baum gezaehlt, nicht
       aus den Rohdaten. So stimmt sie immer mit dem ueberein, was
       tatsaechlich angezeigt wird. */
    function dokZahl(i) {
      var c = cols.querySelector('.tree-card[data-area="' + i + '"]');
      return c ? c.querySelectorAll('.nav-item[data-href]').length : 0;
    }

    var gesamt = 0;
    bereiche.forEach(function (_, i) { gesamt += dokZahl(i); });

    if (nav && bereiche.length) {
      nav.innerHTML =
        '<div class="tn-head">Bereiche</div>' +
        '<button type="button" class="tn-item" data-area="alle">' +
          '<span class="tn-t">Alle Bereiche</span><span class="tn-n">' + gesamt + '</span></button>' +
        bereiche.map(function (t, i) {
          return '<button type="button" class="tn-item" data-area="' + i + '">' +
                 '<span class="tn-t">' + esc(t) + '</span>' +
                 '<span class="tn-n">' + dokZahl(i) + '</span></button>';
        }).join('');
    } else if (nav) {
      /* Kein Bereich vorhanden (Struktur nicht geladen): keinen leeren
         Kasten stehen lassen, sondern die Spalte ganz zurücknehmen. */
      nav.remove();
      var sp = container.querySelector('.tree-split');
      if (sp) sp.style.gridTemplateColumns = '1fr';
      nav = null;
    }

    /* Auswahl umschalten. Rein ueber Klassen – kein Neuaufbau. */
    var _wahl = bereiche.length ? '0' : 'alle';
    function waehle(a) {
      _wahl = String(a);
      var alle = (_wahl === 'alle');
      cols.classList.toggle('is-all', alle);
      $$('.tree-card', cols).forEach(function (c) {
        c.dataset.hidArea = (alle || c.dataset.area === _wahl) ? '' : '1';
      });
      if (nav) $$('.tn-item', nav).forEach(function (b) {
        b.classList.toggle('is-on', b.dataset.area === _wahl);
      });
      zeigeKarten();
    }
    /* Eine Karte ist sichtbar, wenn sie weder von der Bereichswahl noch
       vom Filter ausgeschlossen ist. Zwei getrennte Merker, damit sich
       beide nicht gegenseitig ueberschreiben. */
    function zeigeKarten() {
      $$('.tree-card', cols).forEach(function (c) {
        c.style.display = (c.dataset.hidArea || c.dataset.hidFilter) ? 'none' : '';
      });
    }
    if (nav) nav.addEventListener('click', function (e) {
      var b = e.target.closest('.tn-item'); if (!b) return;
      waehle(b.dataset.area);
    });
    waehle(_wahl);
    cols.addEventListener('click', function (e) {
      /* v9.1: Ordner-Pflege-Button. Muss hier eigenstaendig behandelt
         werden - dieses Overlay hat seinen eigenen Handler und teilt
         ihn nicht mit der Nav-Karte der Startseite. */
      if (giltClickHandled(e)) return;
      var grp = e.target.closest('.nav-item.grp');
      if (grp) {
        var box = grp.parentNode;
        var open = box.classList.toggle('open');
        grp.setAttribute('aria-expanded', open ? 'true' : 'false');
        return;
      }
      var it = e.target.closest('.nav-item[data-href]'); if (!it) return;
      /* v8.8 · Punkt 3: Das Overlay bleibt offen und liegt unter dem
         Vollbild-Viewer (z-index 90 gegen 80). Beim Schliessen der
         Vorschau steht die Inhaltsliste unveraendert da - mit
         aufgeklappten Ordnern, Filtertext und Scrollposition. */
      openByHref(it.dataset.href, it.dataset.title);
      openViewerFull();
    });
    /* v9.9 · AP2: Dieses Overlay hatte ueberhaupt keinen keydown-Handler.
       Ordner liessen sich mit der Tastatur nicht aufklappen, obwohl sie
       role="button" und tabindex tragen - der Klick kam nie an. */
    cols.addEventListener('keydown', baumTastatur);
    /* ----------------------------------------------------------------
       v9.7 · Punkt 4: Der Filter sucht ueber ALLE Bereiche, nicht nur
       ueber den gerade gewaehlten. Sonst suchte man in einem Bereich und
       bekaeme „nichts gefunden“ zu sehen, obwohl das Dokument nebenan
       liegt. Solange etwas im Feld steht, schaltet die Ansicht deshalb
       auf „Alle Bereiche“ und die Bereichsliste zeigt, wo wie viele
       Treffer liegen. Wird das Feld geleert, kehrt die vorherige
       Bereichswahl zurueck.
       Ausschliesslich DOM-Umschaltung – waehrend der Eingabe wird nie
       neu gerendert (sonst ginge der Schreibcursor verloren).
       ---------------------------------------------------------------- */
    var tf = container.querySelector('#treeFilter');
    var _vorFilter = null;

    function navZaehler(v) {
      if (!nav) return;
      if (nav) $$('.tn-item', nav).forEach(function (b) {
        var a = b.dataset.area;
        var s = b.querySelector('.tn-n');
        if (!s) return;
        if (a === 'alle') {
          var g = 0;
          $$('.tree-card', cols).forEach(function (c) {
            g += $$('.nav-item[data-href]', c).filter(function (n) { return n.style.display !== 'none'; }).length;
          });
          s.textContent = v ? g : gesamt;
          b.classList.toggle('is-leer', !!v && g === 0);
          return;
        }
        var card = cols.querySelector('.tree-card[data-area="' + a + '"]');
        var n = card
          ? $$('.nav-item[data-href]', card).filter(function (x) { return x.style.display !== 'none'; }).length
          : 0;
        s.textContent = v ? n : dokZahl(a);
        b.classList.toggle('is-leer', !!v && n === 0);
      });
    }

    if (tf) tf.addEventListener('input', function () {
      var v = tf.value.trim().toLowerCase();
      if (!v) {
        $$('.nav-grp,.nav-item,.nav-sec', cols).forEach(function (n) { n.style.display = ''; });
        $$('.nav-grp', cols).forEach(function (n) { n.classList.remove('open'); });
        $$('.tree-card', cols).forEach(function (c) { c.dataset.hidFilter = ''; });
        navZaehler('');
        if (_vorFilter !== null) { waehle(_vorFilter); _vorFilter = null; }
        else zeigeKarten();
        sageFilterstand('treeFilter',
          filterMeldung(zaehleSichtbar(), zaehleSichtbar(), '', 'Dokumente'));
        return;
      }
      if (_vorFilter === null) { _vorFilter = _wahl; waehle('alle'); }
      /* Von innen nach aussen: ein Ordner bleibt sichtbar, sobald er
         selbst passt oder noch ein sichtbares Kind hat. */
      $$('.nav-item:not(.grp)', cols).forEach(function (n) {
        n.style.display = n.textContent.toLowerCase().indexOf(v) >= 0 ? '' : 'none';
      });
      $$('.nav-grp', cols).slice().reverse().forEach(function (g) {
        var head = g.querySelector(':scope > .nav-item.grp');
        var selbst = head && head.textContent.toLowerCase().indexOf(v) >= 0;
        var kind = $$(':scope > .nav-sub > .nav-item, :scope > .nav-sub > .nav-grp', g)
                     .some(function (c) { return c.style.display !== 'none'; });
        g.style.display = (selbst || kind) ? '' : 'none';
        g.classList.toggle('open', !!(selbst || kind));
        if (head) head.style.display = '';
      });
      /* Karten ohne sichtbaren Inhalt ganz ausblenden, sonst bleiben
         leere Kaesten mit blosser Ueberschrift im Raster stehen. */
      $$('.tree-card', cols).forEach(function (c) {
        var drin = $$(':scope > .nav-item, :scope > .nav-grp', c)
                     .some(function (n) { return n.style.display !== 'none'; });
        c.dataset.hidFilter = drin ? '' : '1';
      });
      zeigeKarten();
      navZaehler(v);
      /* v10.2 · AP5: Ohne Rueckmeldung filtert man hier ins Leere - die
         Zahlen an den Bereichen daneben sieht nur, wer sie sehen kann. */
      sageFilterstand('treeFilter',
        filterMeldung(zaehleSichtbar(), gesamt, tf.value.trim(), 'Dokumente'));
    });

    /* Zaehlt die Dokumente, die nach dem Filtern wirklich dastehen. */
    function zaehleSichtbar() {
      return $$('.tree-card', cols).reduce(function (n, c) {
        if (c.dataset.hidFilter === '1') return n;
        return n + $$('.nav-item[data-href]', c)
          .filter(function (x) { return x.style.display !== 'none'; }).length;
      }, 0);
    }

    /* --- Neu --- */
    var pn = container.querySelector('[data-pane="neu"]');
    if (!_lastVisit) {
      pn.innerHTML = '<div class="fs-note">Das ist Ihr erster Besuch mit dieser Funktion. ' +
        'Ab dem nächsten Mal steht hier, was seit Ihrem letzten Besuch dazugekommen ist.</div>';
    } else if (!neu.length) {
      pn.innerHTML = '<div class="fs-note">Seit Ihrem letzten Besuch am ' +
        deDate(_lastVisit) + ' hat sich in der Ablage nichts geändert.</div>';
    } else {
      pn.innerHTML = '<div class="fs-hint">Geändert oder neu seit ' + deDate(_lastVisit) + '.</div>' +
        neu.map(function (f) {
          var ordner = String(f.href || '').split('/').slice(1, -1).join(' › ');
          return '<div class="nl-row" data-href="' + escAttr(f.href) + '" data-title="' + escAttr(f.title) + '">' +
            '<div><div class="nl-t">' + esc(f.title) + '</div>' +
            '<div class="nl-p">' + esc(ordner || 'Ablage') + '</div></div>' +
            '<div class="nl-d">' + deDate(f.modified) + '</div></div>';
        }).join('');
      pn.addEventListener('click', function (e) {
        var r = e.target.closest('.nl-row'); if (!r) return;
        openByHref(r.dataset.href, r.dataset.title);
        openViewerFull();
      });
    }
  }

  /* ================================================================
     16b. v10.3 · AP6 · „Dokumente ohne Indexsuche"
     ----------------------------------------------------------------
     BEFUND. Ein Teil der Ablage ist ueber die Volltextsuche nicht
     erreichbar: gescannte PDF ohne Texterkennung, Formate die gar
     nicht ausgelesen werden, Dateien oberhalb der 25-MB-Grenze. Diese
     Dokumente sind vorhanden und im Themenbaum sichtbar - aber wer
     nach einem Wort DARIN sucht, bekommt keinen Treffer und schliesst
     daraus, es gebe das Dokument nicht.

     LOESUNG. Ein eigener Reiter macht genau diese Menge sichtbar. Er
     ist fuer ALLE da, nicht nur fuer den Adminmodus: der Hinweis „hier
     hilft die Suche nicht, sieh direkt nach" gehoert allen, die suchen.

     KEINE ZWEITE DATENHALTUNG. Die Einstufung kommt live aus
     IP67.a11yPruefe() (infopool67_a11ycheck_v8.js), das seinerseits nur
     LiveTree und den Volltextindex auswertet. Kein zusaetzlicher
     Abruf bei SharePoint, kein Feld im Index, nichts zu pflegen.
     Regel 12: dieser Block rechnet und zeigt an, mehr nicht.
     ================================================================ */

  /* Muss zur Obergrenze in infopool67_indexsync_v8.js passen (CFG.maxBytes).
     Wird sie dort geaendert, gehoert sie hier mitgeaendert. */
  var MAX_INDEX_BYTES = 25 * 1024 * 1024;

  function ohneIndexZeilen() {
    if (!window.IP67 || typeof window.IP67.a11yPruefe !== 'function') return null;
    var r;
    try { r = window.IP67.a11yPruefe(); } catch (e) { return null; }
    if (!r || r.fehler || !r.zeilen) return null;
    var liste = r.zeilen.filter(function (z) {
      return z.befund !== 'lesbar' && z.befund !== 'duenn';
    }).map(function (z) {
      /* Die Groessengrenze kennt der Lesbarkeitsbericht nicht - fuer ihn
         ist eine zu grosse Datei schlicht „noch nicht indiziert". Hier
         ist die Unterscheidung aber die wichtigste: sie sagt dem Amt,
         dass Warten nichts bringt. */
      /* v10.4 · Der Lesbarkeitsbericht kennt die Größengrenze jetzt
         selbst (Befund „zu-gross"). Die eigene Byte-Prüfung bleibt als
         Rückfall stehen: Sie greift für Dateien, die noch keinen
         Vermerk tragen, weil der Abgleich in dieser Sitzung noch nicht
         so weit war. */
      var zuGross = (z.befund === 'zu-gross') ||
                    (typeof z.bytes === 'number' && z.bytes > MAX_INDEX_BYTES);
      return {
        titel:  z.titel,
        ordner: z.ordner,
        href:   z.href,
        ext:    z.ext,
        grund:  (zuGross && z.befund !== 'zu-gross')
          ? 'Datei über 25 MB – wird nicht automatisch ausgelesen'
          : z.grund,
        art: zuGross ? 'zu groß'
           : (z.befund === 'kein-text'   ? 'Scan ohne Texterkennung'
           : (z.befund === 'kein-format' ? 'Format wird nicht ausgelesen'
           : 'noch nicht ausgelesen'))
      };
    });
    return { liste: liste, k: r.k, durch: !!r.abgleichDurch };
  }

  function ohneIndexAnzahl() {
    var d = ohneIndexZeilen();
    return d ? d.liste.length : 0;
  }

  function renderOhneIndexInto(pane) {
    if (!pane) return;
    var d = ohneIndexZeilen();

    if (!d) {
      pane.innerHTML = '<div class="fs-note">Die Prüfung steht gerade nicht zur Verfügung. ' +
        'Sie braucht die Themenstruktur und den Volltextindex – bitte die Seite neu laden ' +
        'und es in ein bis zwei Minuten erneut versuchen.</div>';
      return;
    }
    if (!d.liste.length) {
      pane.innerHTML = '<div class="fs-note">Jedes Dokument der Ablage ist über die Volltextsuche ' +
        'erreichbar. Es gibt hier gerade nichts nachzuarbeiten.</div>';
      return;
    }

    var hinweis =
      '<div class="fs-hint">Diese Dokumente liegen im Info-Pool und lassen sich öffnen, ' +
      'aber die Volltextsuche findet sie <strong>nur über den Titel</strong> – nicht über Wörter im Text. ' +
      'Wer hier etwas vermutet, sieht das Dokument am besten direkt durch. ' +
      /* v10.4 · Bis v10.3 stand hier für dauerhaft nicht auslesbare
         Dokumente die Zusage, sie verschwänden „von selbst, sobald sie
         ausgelesen sind". Das konnte nicht eintreten: Der Abgleich galt
         erst als abgeschlossen, wenn nichts mehr offen war – und genau
         diese Dateien blieben für immer offen. Der Text nennt jetzt den
         Grund, statt auf ein Ereignis zu vertrösten. */
      (d.durch
        ? 'Der Abgleich mit der Ablage ist abgeschlossen; die Liste ist vollständig.'
        : 'Der Abgleich mit der Ablage läuft gerade noch – frisch hochgeladene Dokumente ' +
          'können hier vorübergehend erscheinen und verschwinden wieder, sobald sie ' +
          'ausgelesen sind. Für die übrigen ist der Grund in der letzten Spalte genannt; ' +
          'sie ändern sich nicht mehr von selbst.') +
      '</div>';

    var zeilen = d.liste.map(function (z) {
      return '<tr>' +
        '<td><button type="button" class="oi-open" data-href="' + escAttr(z.href) + '" ' +
          'data-title="' + escAttr(z.titel) + '">' + esc(z.titel) + '</button></td>' +
        '<td>' + esc(z.ordner) + '</td>' +
        '<td class="mono">' + esc(z.ext) + '</td>' +
        '<td><span class="oi-art">' + esc(z.art) + '</span> ' +
          '<span class="oi-grund">' + esc(z.grund) + '</span></td>' +
        '</tr>';
    }).join('');

    pane.innerHTML =
      hinweis +
      filterLeiste('oiFilter', 'Dokumente ohne Indexsuche durchsuchen',
        'Titel, Ordner oder Grund \u2026') +
      '<table class="tbl" id="oiTbl">' +
      '<caption class="ip67-sr-only">Dokumente, die die Volltextsuche nicht erfasst, ' +
        d.liste.length + (d.liste.length === 1 ? ' Dokument' : ' Dokumente') + '</caption>' +
      '<thead><tr><th scope="col">Dokument</th><th scope="col">Ordner</th>' +
      '<th scope="col">Format</th><th scope="col">Grund</th></tr></thead>' +
      '<tbody>' + zeilen + '</tbody></table>' +
      (d.k && d.k.duenn
        ? '<div class="fs-note">Weitere ' + d.k.duenn + ' Dokument(e) enthalten nur sehr wenig Text ' +
          '(meist ein maschinelles Deckblatt vor einem Scan). Sie sind auffindbar, aber nur zum Teil.</div>'
        : '');

    /* Ein Klick oeffnet das Dokument im Vollbild-Betrachter - dieselbe
       Mechanik wie im Reiter „Neu seit letztem Besuch". */
    pane.addEventListener('click', function (e) {
      var b = e.target.closest('.oi-open'); if (!b) return;
      openByHref(b.dataset.href, b.dataset.title);
      openViewerFull();
    });

    var of = document.getElementById('oiFilter');
    if (of) of.addEventListener('input', function () {
      var v = of.value.toLowerCase();
      var alle = $$('#oiTbl tbody tr'), sichtbar = 0;
      alle.forEach(function (tr) {
        var passt = tr.textContent.toLowerCase().indexOf(v) >= 0;
        tr.style.display = passt ? '' : 'none';
        if (passt) sichtbar++;
      });
      sageFilterstand('oiFilter',
        filterMeldung(sichtbar, alle.length, of.value.trim(), 'Dokumente'));
    });
  }

  function renderLueckenInto(pane) {
    if (!pane || pane._done) return;
    pane._done = true;
    loadGaps().then(function (g) {
      var keys = Object.keys(g || {}).sort(function (a, b) {
        return (g[b].n || 0) - (g[a].n || 0);
      });
      if (!keys.length) {
        pane.innerHTML = '<div class="fs-note">Bisher wurde keine erfolglose Suche protokolliert. ' +
          'Sobald jemand etwas sucht, das es im Info-Pool nicht gibt, erscheint der Suchbegriff hier – ' +
          'das ist die Liste der fehlenden Inhalte.</div>';
        return;
      }
      pane.innerHTML =
        '<div class="fs-hint">Suchbegriffe ohne Treffer, nach Häufigkeit sortiert. ' +
          'Jede Zeile ist ein Hinweis auf einen Inhalt, den jemand erwartet hat und nicht gefunden hat. ' +
          'Quelle: <code>' + GAPS_FILE + '</code>.</div>' +
        keys.slice(0, 120).map(function (k) {
          var e = g[k];
          return '<div class="gap-row"><span class="gq">' + esc(k) + '</span>' +
            '<span class="gd">zuletzt ' + deDate(e.letzt) + '</span>' +
            '<span class="gn">' + (e.n || 1) + '×</span></div>';
        }).join('');
    });
  }

  /* ================================================================
     11. Initialisierung – nach DOM + Daten + Live-Baum
     ================================================================ */
  function init() {
    try {
      flatten(window.sidebarInitData || []);
      buildDocs();
      wireAdminMode();   // v8.7 · Punkt 1
      wireScroll();
      wireSearch();
      wireViewer();
      renderNav();
      wireChips();
      wireAdmin();
      wireHelp();
      wireTheme();      // v9.5 · Hell/Dunkel nach Sonnenstand
      wireReveal();
      wireBegruessung();
      preloadPeople();   // v8.6: Personensuche ohne Wartezeit
      wireNeu();         // v8.7: „Neu seit letztem Besuch"
      wireGaps();        // v8.7: erfolglose Suchen protokollieren
      /* Metadaten nachladen und die Oberflaeche danach auffrischen.
         Bewusst NICHT blockierend - fehlt dokument-meta.json, laeuft
         alles Uebrige unveraendert weiter. */
      loadMeta().then(function () { refreshGiltBar(); });
      console.info('[Info-Pool 67] v9.7 Glue bereit ·',
        Object.keys(byId).length, 'Knoten ·', docs.length, 'indizierte Dokumente ·',
        (isAdmin() ? 'Adminmodus AN' : 'Adminmodus aus'));
    } catch (e) {
      console.error('[Info-Pool 67] v9.7 Glue-Init-Fehler:', e);
    }
  }

  function whenReady(cb) {
    var domReady = (document.readyState !== 'loading')
      ? Promise.resolve()
      : new Promise(function (r) { document.addEventListener('DOMContentLoaded', r); });
    var dataReady = (window.IP67_DATA_READY && typeof window.IP67_DATA_READY.then === 'function')
      ? window.IP67_DATA_READY.catch(function () {})
      : Promise.resolve();
    /* v8.4: Die Themenstruktur wird live aus der SharePoint-Ablage aufgebaut
       (infopool67_livetree_v8.js). Ohne dieses Warten würde die Oberfläche
       mit einem noch leeren window.sidebarInitData rendern -> „0 Knoten". */
    var treeReady = (window.IP67_TREE_READY && typeof window.IP67_TREE_READY.then === 'function')
      ? window.IP67_TREE_READY.catch(function () {})
      : Promise.resolve();
    Promise.all([domReady, dataReady, treeReady]).then(cb);
  }

  whenReady(init);
})();
