/* ================================================================
   Info-Pool 67 · v9.0 · infopool67_pdf_v8.js
   ----------------------------------------------------------------
   ZWECK
   Eigener PDF-Betrachter auf Basis von PDF.js. Er ersetzt die
   bisherige Direktanzeige im iframe und loest damit das Problem,
   dass der eingebaute Browser-Betrachter (PDFium in Edge/Chrome)
   Suchbegriffe nicht markieren kann.

   WARUM NICHT DER MITGELIEFERTE PDF.JS-VIEWER (web/viewer.html)?
   Der bringt Seitenleiste, Anmerkungs-Werkzeuge, Formular-Editor
   und Sprachdateien fuer 100 Sprachen mit - Ballast, der im
   Stadtnetz nur Ladezeit kostet und optisch nicht zum Info-Pool
   passt. Dieses Modul nutzt ausschliesslich die Programmier-
   schnittstelle von PDF.js und rendert selbst.

   ABHAENGIGKEITEN (alle lokal im Ordner pdfjs/, KEIN CDN)
     pdfjs/pdf.min.js            Programmbibliothek
     pdfjs/pdf.worker.min.js     Hintergrundprozess (Pflicht)
     pdfjs/standard_fonts/       Ersatzschriften fuer PDFs ohne
                                 eingebettete Schrift - ohne diesen
                                 Ordner bleiben solche Seiten leer.

   ARBEITSWEISE
     1. Bibliothek erst beim ersten PDF nachladen (spart Ladezeit
        auf der Startseite).
     2. Text ALLER Seiten einlesen und die Fundstellen zaehlen,
        bevor gerendert wird - dadurch steht die Trefferzahl sofort.
     3. Seiten als Platzhalter in richtiger Groesse anlegen, damit
        der Scrollbalken von Anfang an stimmt.
     4. Text ALLER Seiten sofort in den Dokumentbaum legen (v10.1 ·
        AP4). Nur das Bild der Seite entsteht spaeter und nur dort,
        wo hingeblaettert wird - ein 200-Seiten-Dokument vollstaendig
        zu zeichnen wuerde den Rechner blockieren. Fuer eine
        Sprachausgabe zaehlt aber nur der Text, und der ist billig:
        er wird fuer die Trefferzaehlung ohnehin von jeder Seite
        geholt. Vorher entstand er nur bei aktiver Suche und nur auf
        sichtbaren Seiten - ein PDF war damit eine stumme Flaeche.
     5. Auf gerenderten Seiten die Fundstellen gelb hinterlegen,
        die aktuelle oranger.

   OEFFENTLICHE SCHNITTSTELLE
     window.IP67PDF.oeffne(host, url, { query, onBereit, onSeite })
       -> Promise<Betrachter>
     Betrachter: { treffer, geheZu(i), zerstoere() }
   ================================================================ */
(function () {
  'use strict';

  /* ================================================================
     KONFIGURATION
     ================================================================ */
  var ORDNER  = 'lib/pdfjs/';
  var LIB     = ORDNER + 'pdf.min.js';
  var WORKER  = ORDNER + 'pdf.worker.min.js';
  var FONTS   = ORDNER + 'standard_fonts/';

  /* Grenzen fuer die Darstellungsgroesse. */
  var ZOOM_STUFEN = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
  var ZOOM_START  = 2;   // Index in ZOOM_STUFEN -> 1.0 = Breite anpassen

  /* Sehr grosse Dokumente: Text nur bis hierher vorab einlesen,
     damit das Oeffnen nicht minutenlang dauert. */
  var MAX_TEXT_SEITEN = 400;

  /* ================================================================
     1. BIBLIOTHEK NACHLADEN
     ----------------------------------------------------------------
     Nur einmal, und erst wenn wirklich ein PDF geoeffnet wird.
     ================================================================ */
  var _libP = null;

  function ladeLib() {
    if (_libP) return _libP;
    _libP = new Promise(function (ok, fehler) {
      if (window.pdfjsLib) { ok(window.pdfjsLib); return; }
      var sc = document.createElement('script');
      sc.src = LIB;
      sc.charset = 'UTF-8';
      sc.onload = function () {
        if (!window.pdfjsLib) { fehler(new Error('pdfjsLib nicht gefunden')); return; }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER;
        ok(window.pdfjsLib);
      };
      sc.onerror = function () {
        fehler(new Error('PDF-Bibliothek nicht ladbar: ' + LIB));
      };
      document.head.appendChild(sc);
    });
    return _libP;
  }

  /* ================================================================
     2. HILFEN
     ================================================================ */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }
  function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* Zaehlt Vorkommen von q in text (ohne Ueberlappung). */
  function zaehle(text, q) {
    if (!text || !q) return 0;
    var low = text.toLowerCase(), ql = q.toLowerCase();
    var n = 0, i = 0;
    while ((i = low.indexOf(ql, i)) >= 0) { n++; i += ql.length; }
    return n;
  }

  /* ================================================================
     3. BETRACHTER
     ================================================================ */
  function oeffne(host, url, opts) {
    opts = opts || {};
    var query = String(opts.query || '').trim();

    return ladeLib().then(function (pdfjsLib) {
      return pdfjsLib.getDocument({
        url: url,
        /* Windows-Authentifizierung mitschicken (same-origin). */
        withCredentials: true,
        /* Ersatzschriften lokal - sonst bleiben PDFs ohne eingebettete
           Schrift leer. Genau das passiert bei vielen aelteren
           Verwaltungsdokumenten. */
        standardFontDataUrl: FONTS,
        /* Verhindert, dass PDF.js Bereichs-Abrufe versucht; SharePoint
           On-Premises beantwortet die nicht immer korrekt. */
        disableRange: false,
        disableStream: false
      }).promise;
    }).then(function (pdf) {
      return baueAuf(host, url, pdf, query, opts);
    });
  }

  function baueAuf(host, url, pdf, query, opts) {
    var anzahl = pdf.numPages;

    /* ---- Geruest ---- */
    host.innerHTML =
      '<div class="pdfv">' +
        '<div class="pdfv-bar">' +
          '<button type="button" class="pdfv-b" data-z="raus" title="Verkleinern" aria-label="Verkleinern">\u2212</button>' +
          '<span class="pdfv-zoom" data-zoomlbl>100\u2009%</span>' +
          '<button type="button" class="pdfv-b" data-z="rein" title="Vergr\u00f6\u00dfern" aria-label="Vergr\u00f6\u00dfern">+</button>' +
          '<span class="pdfv-sep"></span>' +
          '<span class="pdfv-seite" data-seitelbl>Seite 1 von ' + anzahl + '</span>' +
          '<a class="pdfv-link" href="' + esc(url) + '" target="_blank" rel="noopener">' +
            'In neuem Tab \u00f6ffnen \u2197</a>' +
        '</div>' +
        '<div class="pdfv-scroll" data-scroll></div>' +
      '</div>';

    var wrap    = host.querySelector('.pdfv');
    var scroll  = host.querySelector('[data-scroll]');
    var zoomLbl = host.querySelector('[data-zoomlbl]');
    var seiteLbl= host.querySelector('[data-seitelbl]');

    var zoomIdx  = ZOOM_START;
    var seiten   = [];    // {n, div, canvas, textDiv, breite, hoehe, gerendert, aufgabe}
    var treffer  = [];    // {seite, nrAufSeite}  – global fortlaufend
    var aktuell  = -1;
    var beobachter = null;
    var tot      = false;

    /* ---- Basisgroessen einlesen (schnell, ohne Rendern) ---- */
    function seitenInfos() {
      var jobs = [];
      for (var n = 1; n <= anzahl; n++) jobs.push(pdf.getPage(n));
      return Promise.all(jobs).then(function (pages) {
        return pages.map(function (p, i) {
          var vp = p.getViewport({ scale: 1 });
          return { n: i + 1, page: p, breite: vp.width, hoehe: vp.height };
        });
      });
    }

    /* ---- Fundstellen zaehlen (Text aller Seiten) ---- */
    function sucheTreffer(infos) {
      if (!query) return Promise.resolve([]);
      var bis = Math.min(anzahl, MAX_TEXT_SEITEN);
      var jobs = [];
      for (var i = 0; i < bis; i++) jobs.push(infos[i].page.getTextContent());
      return Promise.all(jobs).then(function (inhalte) {
        var out = [];
        inhalte.forEach(function (tc, i) {
          /* Die Textstuecke werden zusammengehaengt. Ein Suchwort, das
             im PDF ueber zwei Textstuecke verteilt liegt, wird dadurch
             hier gefunden - im gerenderten Textbereich spaeter unter
             Umstaenden nicht. Die Navigation faengt das ab, indem sie
             notfalls die Seite anspringt statt die genaue Stelle. */
          var txt = (tc.items || []).map(function (it) { return it.str; }).join('');
          var k = zaehle(txt, query);
          for (var j = 0; j < k; j++) out.push({ seite: i + 1, nrAufSeite: j });
        });
        return out;
      });
    }

    /* ---- Massstab: Breite des Rahmens als Grundlage ---- */
    function massstab(info) {
      var platz = Math.max(320, scroll.clientWidth - 36);
      var basis = platz / info.breite;
      return basis * ZOOM_STUFEN[zoomIdx];
    }

    /* ---- Platzhalter anlegen ---- */
    function platzhalter(infos) {
      scroll.innerHTML = '';
      seiten = infos.map(function (info) {
        var s = massstab(info);
        var div = document.createElement('div');
        div.className = 'pdfv-page';
        div.dataset.p = info.n;
        div.style.width  = Math.round(info.breite * s) + 'px';
        div.style.height = Math.round(info.hoehe  * s) + 'px';
        /* v10.1 · AP4: Die Seitenmarke bleibt dauerhaft stehen, auch
           nachdem das Bild gezeichnet ist. Ohne sie waere der Text
           eines PDF fuer eine Sprachausgabe ein Strom ohne jede
           Orientierung - dieselbe Gliederung wie in der Textfassung
           aus AP3. Die sichtbare Warte-Anzeige daneben ist nur fuers
           Auge und wird ueberlesen. */
        div.innerHTML =
          '<span class="ip67-sr-only">Seite ' + info.n + ' von ' + anzahl + '</span>' +
          '<div class="pdfv-warte" aria-hidden="true">Seite ' + info.n + '</div>';
        scroll.appendChild(div);
        return { n: info.n, page: info.page, div: div,
                 breite: info.breite, hoehe: info.hoehe,
                 gerendert: false, aufgabe: null };
      });
    }

    /* ---- Textebene einer Seite aufbauen ----
       v10.1 · AP4: frueher steckte das mitten in rendere() und lief nur
       bei aktiver Suche. Jetzt ist es ein eigener, mehrfach gefahrloser
       Schritt: er haengt nicht am Bild und kann deshalb fuer alle Seiten
       vorab laufen. */
    function fuelleText(s) {
      if (tot || s.textDiv) return Promise.resolve();
      var skala = massstab(s);
      var vp = s.page.getViewport({ scale: skala });

      var tl = document.createElement('div');
      tl.className = 'pdfv-text';
      /* PDF.js ab Fassung 3 verlangt diese CSS-Variable auf dem
         Textbereich - ohne sie sitzen die Textstellen falsch. */
      tl.style.setProperty('--scale-factor', skala);
      tl.style.width  = Math.floor(vp.width)  + 'px';
      tl.style.height = Math.floor(vp.height) + 'px';
      s.div.appendChild(tl);
      s.textDiv = tl;

      return s.page.getTextContent().then(function (tc) {
        if (tot) return null;
        return window.pdfjsLib.renderTextLayer({
          textContentSource: tc,
          container: tl,
          viewport: vp
        }).promise;
      }).then(function () {
        if (tot) return;
        if (query) markiere(s);
      }).catch(function (e) {
        if (tot) return;
        console.warn('[Info-Pool 67] Text der PDF-Seite ' + s.n +
          ' nicht lesbar:', e && e.message);
      });
    }

    /* ---- Text aller Seiten nacheinander einlesen ----
       Bewusst der Reihe nach und nicht alle auf einmal: bei einem
       langen Dokument wuerden hundert gleichzeitige Anfragen an den
       Hintergrundprozess die Anzeige der ersten Seite ausbremsen. Die
       Obergrenze ist dieselbe wie bei der Trefferzaehlung. */
    function fuelleTextAlle() {
      var bis = Math.min(seiten.length, MAX_TEXT_SEITEN);
      var kette = Promise.resolve();
      for (var i = 0; i < bis; i++) {
        (function (s) {
          kette = kette.then(function () { return tot ? null : fuelleText(s); });
        })(seiten[i]);
      }
      return kette;
    }

    /* ---- Eine Seite wirklich rendern (das Bild) ---- */
    function rendere(s) {
      if (tot || s.gerendert) return Promise.resolve();
      s.gerendert = true;
      var skala = massstab(s);
      var vp = s.page.getViewport({ scale: skala });
      var dpr = Math.min(window.devicePixelRatio || 1, 2);

      var cv = document.createElement('canvas');
      cv.className = 'pdfv-cv';
      /* v10.1 · AP4: Das Bild der Seite hat fuer eine Sprachausgabe
         keinen Wert - sie wuerde nur „Grafik“ melden. Der Inhalt steckt
         in der Textebene daneben. */
      cv.setAttribute('aria-hidden', 'true');
      cv.width  = Math.floor(vp.width  * dpr);
      cv.height = Math.floor(vp.height * dpr);
      cv.style.width  = Math.floor(vp.width)  + 'px';
      cv.style.height = Math.floor(vp.height) + 'px';

      /* Der Platzhalter wird nicht mehr geleert: Seitenmarke und eine
         bereits aufgebaute Textebene muessen stehen bleiben. */
      var warte = s.div.querySelector('.pdfv-warte');
      if (warte) warte.remove();
      if (s.textDiv) s.div.insertBefore(cv, s.textDiv);
      else s.div.appendChild(cv);
      s.canvas = cv;

      var ctx = cv.getContext('2d');
      s.aufgabe = s.page.render({
        canvasContext: ctx,
        viewport: vp,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null
      });

      return s.aufgabe.promise.then(function () {
        if (tot) return null;
        return fuelleText(s);
      }).catch(function (e) {
        if (tot) return;
        console.warn('[Info-Pool 67] PDF-Seite ' + s.n + ' nicht darstellbar:', e && e.message);
        /* Nur das Bild fehlt. Der Text bleibt stehen, damit die Seite
           wenigstens vorlesbar ist. */
        if (s.canvas) { try { s.canvas.remove(); } catch (x) {} s.canvas = null; }
        var hinweis = document.createElement('div');
        hinweis.className = 'pdfv-warte';
        hinweis.textContent = 'Seite ' + s.n + ' konnte nicht dargestellt werden.';
        s.div.insertBefore(hinweis, s.div.firstChild);
      });
    }

    /* ---- Fundstellen auf einer gerenderten Seite hinterlegen ---- */
    function markiere(s) {
      if (!s.textDiv || !query) return;
      var basis = 0;
      for (var i = 0; i < treffer.length; i++) {
        if (treffer[i].seite === s.n) { basis = i; break; }
      }
      var re = new RegExp(escRe(query), 'gi');
      var gefunden = [];
      durchlaufe(s.textDiv, re, gefunden);
      gefunden.forEach(function (m, k) {
        m.dataset.hit = basis + k;
      });
      zeigeAktuell();
    }

    function durchlaufe(knoten, re, out) {
      if (!knoten) return;
      if (knoten.nodeType === 3) {
        var text = knoten.nodeValue;
        re.lastIndex = 0;
        if (!re.test(text)) return;
        re.lastIndex = 0;
        var frag = document.createDocumentFragment(), last = 0, m;
        while ((m = re.exec(text)) !== null) {
          if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
          var mk = document.createElement('mark');
          mk.className = 'pdfv-hl';
          mk.textContent = m[0];
          frag.appendChild(mk);
          out.push(mk);
          last = m.index + m[0].length;
          if (m[0].length === 0) re.lastIndex++;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        knoten.parentNode.replaceChild(frag, knoten);
        return;
      }
      if (knoten.nodeType === 1 && knoten.tagName !== 'MARK') {
        Array.prototype.slice.call(knoten.childNodes).forEach(function (k) {
          durchlaufe(k, re, out);
        });
      }
    }

    function zeigeAktuell() {
      var alle = scroll.querySelectorAll('mark.pdfv-hl');
      Array.prototype.forEach.call(alle, function (m) {
        m.classList.toggle('is-cur', +m.dataset.hit === aktuell);
      });
    }

    /* ---- Sichtbare Seiten nachrendern ---- */
    function starteBeobachter() {
      if (beobachter) beobachter.disconnect();
      if (!('IntersectionObserver' in window)) {
        seiten.forEach(rendere);
        return;
      }
      beobachter = new IntersectionObserver(function (eintraege) {
        eintraege.forEach(function (e) {
          if (!e.isIntersecting) return;
          var s = seiten[+e.target.dataset.p - 1];
          if (s) rendere(s);
        });
      }, { root: scroll, rootMargin: '400px 0px' });
      seiten.forEach(function (s) { beobachter.observe(s.div); });
    }

    /* ---- Sichtbare Seitenzahl in der Leiste ---- */
    function aktualisiereSeitenzahl() {
      var mitte = scroll.scrollTop + scroll.clientHeight / 2;
      var n = 1;
      for (var i = 0; i < seiten.length; i++) {
        if (seiten[i].div.offsetTop <= mitte) n = seiten[i].n; else break;
      }
      seiteLbl.textContent = 'Seite ' + n + ' von ' + anzahl;
      if (opts.onSeite) opts.onSeite(n, anzahl);
    }

    /* ---- Springen ---- */
    function geheZu(i) {
      if (!treffer.length) return;
      if (i < 0) i = treffer.length - 1;
      if (i >= treffer.length) i = 0;
      aktuell = i;
      var s = seiten[treffer[i].seite - 1];
      if (!s) return;
      var fertig = function () {
        var ziel = scroll.querySelector('mark.pdfv-hl[data-hit="' + i + '"]');
        if (!ziel) {
          /* Die genaue Stelle konnte im gerenderten Text nicht
             wiedergefunden werden (Wort ueber zwei Textstuecke
             verteilt). Dann wenigstens die richtige Seite zeigen. */
          scroll.scrollTo({ top: s.div.offsetTop - 12, behavior: 'smooth' });
        } else {
          var oben = ziel.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
          scroll.scrollTo({ top: scroll.scrollTop + oben - scroll.clientHeight / 3,
                            behavior: 'smooth' });
        }
        zeigeAktuell();
        aktualisiereSeitenzahl();
      };
      if (s.gerendert && s.textDiv) { fertig(); }
      else {
        scroll.scrollTop = s.div.offsetTop - 12;   // erst grob hin
        rendere(s).then(fertig);
      }
    }

    /* ---- Zoom ---- */
    function setzeZoom(richtung) {
      var neu = zoomIdx + richtung;
      if (neu < 0 || neu >= ZOOM_STUFEN.length) return;
      zoomIdx = neu;
      zoomLbl.textContent = Math.round(ZOOM_STUFEN[zoomIdx] * 100) + '\u2009%';
      var merkeSeite = 1;
      var mitte = scroll.scrollTop + 10;
      for (var i = 0; i < seiten.length; i++) {
        if (seiten[i].div.offsetTop <= mitte) merkeSeite = seiten[i].n; else break;
      }
      /* Alles verwerfen und in neuer Groesse aufbauen. Einzelne
         Seiten umzuskalieren waere schneller, aber der Textbereich
         muesste dabei ebenfalls neu vermessen werden - der Aufwand
         lohnt bei den Dokumentgroessen hier nicht. */
      var infos = seiten.map(function (s) {
        return { n: s.n, page: s.page, breite: s.breite, hoehe: s.hoehe };
      });
      platzhalter(infos);
      starteBeobachter();
      /* v10.1 · AP4: platzhalter() wirft die alten Textebenen weg, weil
         sie in der neuen Groesse falsch saessen. Also gleich wieder
         aufbauen - sonst waere das Dokument nach einem Zoom stumm. */
      fuelleTextAlle();
      var z = seiten[merkeSeite - 1];
      if (z) scroll.scrollTop = z.div.offsetTop - 12;
      aktualisiereSeitenzahl();
    }

    wrap.querySelector('.pdfv-bar').addEventListener('click', function (e) {
      var b = e.target.closest('[data-z]'); if (!b) return;
      setzeZoom(b.dataset.z === 'rein' ? 1 : -1);
    });
    scroll.addEventListener('scroll', function () {
      clearTimeout(scroll._t);
      scroll._t = setTimeout(aktualisiereSeitenzahl, 120);
    }, { passive: true });

    /* ---- Ablauf ---- */
    return seitenInfos().then(function (infos) {
      if (tot) return null;
      platzhalter(infos);
      zoomLbl.textContent = Math.round(ZOOM_STUFEN[zoomIdx] * 100) + '\u2009%';
      starteBeobachter();
      return sucheTreffer(infos);
    }).then(function (tr) {
      if (tot) return null;
      treffer = tr || [];
      if (opts.onBereit) opts.onBereit(treffer.length, anzahl);
      if (treffer.length) geheZu(0);
      /* v10.1 · AP4: Erst jetzt, damit die Fundstellen bereits bekannt
         sind und beim Aufbau gleich mitmarkiert werden. Laeuft im
         Hintergrund weiter - auf das Ergebnis wartet niemand, die
         ersten Seiten sind langst da. */
      fuelleTextAlle();
      return {
        get treffer() { return treffer; },
        anzahlSeiten: anzahl,
        geheZu: geheZu,
        zerstoere: function () {
          tot = true;
          if (beobachter) beobachter.disconnect();
          seiten.forEach(function (s) {
            try { if (s.aufgabe) s.aufgabe.cancel(); } catch (e) {}
          });
          try { pdf.destroy(); } catch (e) {}
          host.innerHTML = '';
        }
      };
    });
  }

  window.IP67PDF = {
    oeffne: oeffne,
    /* Nur zur Diagnose: ist die Bibliothek erreichbar? */
    pruefe: function () {
      return ladeLib().then(function () { return true; })
                      .catch(function () { return false; });
    }
  };

  console.info('[Info-Pool 67] pdf.js-Betrachter bereit \u00b7 Quelle:', ORDNER);
})();
