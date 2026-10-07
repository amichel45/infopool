> **Archiviert am 07.10.2026.** Der Info-Pool ist in die Startseite von Programme 67 aufgegangen und wird nur noch in
> [amichel45/Start-Programme-67](https://github.com/amichel45/Start-Programme-67) weiterentwickelt (ab Fassung 1.12:
> `start67_infopool.js`, übernommene Module `storage_v8.js` und `infopool67_*.js`). Die Daten bleiben im
> SharePoint-Ordner `/Wissen673/Freigegebene Dokumente/Infopool`. Hier nichts mehr ändern.

# Info-Pool 67

Internes Dokumenten- und Wissensportal des Amtes für Landschaftspflege und
Grünflächen (Amt 67) der Stadt Köln. Betrieb im SharePoint-Intranet, reines HTTP,
Windows-Authentifizierung.

Diese Datei beschreibt Aufbau, Ablage und Auslieferung. Das Datenmodell steht in
`DATENMODELL.md`, die Änderungen in `CHANGELOG.md`, die Bedienung für Redaktion und
Verwaltung in `ANLEITUNG_ADMIN.md`.

**Aktueller Stand: v10.3**

---

## 1 · Was die Anwendung tut

Volltextsuche über die Ablage des Amtes · Dokumentbetrachter für PDF, HTML, Bilder und
Text mit Hervorhebung der Fundstellen · Themenstruktur der Ablage · Handyliste ·
Organigramm · „Neu seit Ihrem letzten Besuch" · Gültigkeit und Zuständigkeit je
Dokument · Verwaltungsmodus für Redaktion · Hilfe mit Audio-Einführungen ·
automatischer Hell-/Dunkelwechsel nach Tageslicht · Lesbarkeitsbericht und Liste der
Dokumente, die die Suche nicht erfasst.

## 2 · Was die Anwendung nicht braucht

Keinen Serverdienst, keine Datenbank, keine Laufzeitumgebung auf einem Server, keine
Installation auf den Arbeitsplätzen. Die Anwendung besteht aus statischen Dateien in
einer SharePoint-Bibliothek und läuft vollständig im Browser der aufrufenden Person.

Ebenfalls bewusst nicht vorhanden: Build-Werkzeug, Bundler, npm zur Laufzeit,
TypeScript, ES-Module (`import`/`export`), Bibliotheken aus dem Internet (CDN).
Im Stadtnetz sind Fremdquellen gesperrt; alles liegt lokal.

## 3 · Ablageorte

Site: `http://67-programme.verwaltung.stadtkoeln.de/Wissen673`
Programmordner: `/Wissen673/Freigegebene Dokumente/Infopool`

```
Infopool/
├── infopool67_v8.aspx            Einstiegsseite (UTF-8 MIT BOM)
├── infopool67_v8.css             ein Stylesheet für alles
├── storage_v8.js                 SharePoint-Schnittstelle
├── infopool67_livetree_v8.js     Themenstruktur live aus der Ablage
├── infopool67_core_v8.js         Kern-Engine (unverändert)
├── infopool67_admin_v8.js        Bearbeiten, Hinzufügen, Veröffentlichen
├── infopool67_pdf_v8.js          PDF-Betrachter
├── infopool67_v8.js              Glue-Schicht, die sichtbare Oberfläche
├── infopool67_indexsync_v8.js    Hintergrundabgleich Ablage ↔ Index
├── infopool67_index_v8.js        Textauslesung (wird nachgeladen)
├── infopool67_a11ycheck_v8.js    Lesbarkeitsbericht (nur lesend)
├── infopool67_indexpush_v8.js    Veröffentlichen des Index
├── search-index.json             veröffentlichter Volltextindex
├── Mitarbeiterliste.json         Personendaten
├── dokument-meta.json            Gültigkeit und Zuständigkeit
├── such-luecken.json             erfolglose Suchen
├── lib/pdfjs/                    PDF.js 3.11.174, lokal
├── mp3/                          einfuehrung-anwender.mp3, einfuehrung-admin.mp3
├── Handbuch/                     Handbücher, werden automatisch gefunden
├── Ablage/                       die Dokumente des Amtes
└── Archiv/                       ausgelieferte Fassungen (siehe Abschnitt 6)
```

Die drei Konstanten dazu stehen am Kopf von `storage_v8.js`
(`SP_SITE_URL`, `SP_FOLDER`, `SP_NAME`); der Handbuchordner in
`infopool67_v8.js` (`HANDBUCH_ORDNER`), der PDF.js-Pfad in
`infopool67_pdf_v8.js` (`ORDNER`).

## 4 · Ladereihenfolge

Die Reihenfolge der `<script>`-Zeilen in `infopool67_v8.aspx` ist **bindend**. Jede
Datei setzt globale Variablen, auf die die nächste zugreift.

| # | Datei | Aufgabe |
|---|---|---|
| 1 | `storage_v8.js` | SharePoint-Schnittstelle (`IP67Storage`); lädt `search-index.json` und `Mitarbeiterliste.json` in Globals |
| 2 | `infopool67_livetree_v8.js` | baut die Themenstruktur live aus dem Ordner `Ablage` → `window.sidebarInitData` |
| 3 | `infopool67_core_v8.js` | Kern-Engine `window.IP67`: Suche, Stemmer, TF-IDF, IndexedDB. Bootet in den versteckten Host `#ip67-engine-host` |
| 4 | `infopool67_admin_v8.js` | Verwaltungsfunktionen (wird bei Bedarf aktiv) |
| 5 | `infopool67_pdf_v8.js` | PDF-Betrachter, lädt `lib/pdfjs/` beim ersten PDF nach |
| 6 | `infopool67_v8.js` | Glue-Schicht: die gesamte sichtbare Oberfläche |
| 7 | `infopool67_indexsync_v8.js` | Hintergrundabgleich, lädt `infopool67_index_v8.js` nach |
| 8 | `infopool67_a11ycheck_v8.js` | Lesbarkeitsbericht |
| 9 | `infopool67_indexpush_v8.js` | Veröffentlichen des Index |

**Das tragende Muster: Glue-Schicht über verstecktem Kern.** `infopool67_core_v8.js`
bleibt unangetastet und liefert die Logik. `infopool67_v8.js` rendert die Oberfläche
und delegiert an `IP67.*`; auf Interna wird ausschließlich über
`window.IP67._internal` zugegriffen. Solange eine Aufgabe über die Glue-Schicht
lösbar ist, wird die Kerndatei nicht angefasst.

`infopool67_v8.js` ist in nummerierte Abschnitte gegliedert, die als Kommentarblöcke
im Quelltext stehen: 1 Helfer · 2 Daten aus Globals · 3 Suchpanel · 4 Betrachter ·
5 Nav-Card · 6 Personendaten · 8 Admin- und Index-Delegation · 9 Hilfe ·
9b Hell/Dunkel · 10 Scroll-Effekte · 12 Adminmodus · 13 Gültigkeit und Zuständigkeit ·
14 erfolglose Suchen · 15 Neu seit letztem Besuch · 16 Overlay „Inhalte" · 11 Init.

## 5 · Auslieferung

1. Fassungsnummer hochzählen: **zehn** Cache-Bust-Angaben `?v=` in der `.aspx`
   (eine für das Stylesheet, neun für die Skripte), `CFG.moduleVersion` in
   `infopool67_indexsync_v8.js`, Fußzeilentext in der `.aspx`. Wird eine Stelle
   vergessen, zieht der Browser eine alte Moduldatei zu neuem Code.
2. Kodierung prüfen: `.aspx` **mit** UTF-8-BOM (`EF BB BF`) und `charset="UTF-8"` an
   jedem `<script>` und `<link>`; `.js` und `.css` **ohne** BOM.
3. `node -c` auf allen geänderten JS-Dateien. Klammerbilanz der CSS prüfen.
4. Regressionstests laufen lassen: `test_ap1.js`, `test_ap2.js`, `test_ap3.js`,
   `test_ap6.js`, `test_a11ycheck.js`. Alle müssen fehlerfrei durchlaufen.
5. Barrierefreiheits-Prüfliste vollständig abarbeiten und im Änderungsprotokoll
   abhaken — auch dann, wenn die Änderung auf den ersten Blick keine Bedienelemente
   betrifft.
6. Sicherung ziehen (siehe `SICHERUNG.md`).
7. Dateien in den Ordner `Infopool` legen. Zusammengehörige Dateien **immer gemeinsam**
   hochladen. Danach in der Bibliotheksansicht F5.
8. Kopie in den Archivordner (Abschnitt 6) und Eintrag in `CHANGELOG.md`.

## 6 · Archiv der Fassungen

Jede ausgelieferte Fassung liegt vollständig und unverändert unter:

```
Infopool/Archiv/v10.3/          alle Programmdateien dieser Fassung
Infopool/Archiv/v10.3/STAND.txt Datum, ausgeliefert von, Kurzbeschreibung
```

Zweck: Ein Rückschritt auf eine frühere Fassung muss ohne Rekonstruktion möglich sein.
Der Archivordner enthält nur Programmdateien, keine Dokumente der Ablage und keine
Datendateien; für diese gilt `SICHERUNG.md`.

Archivfassungen werden nicht nachträglich verändert. Wird an einer alten Fassung ein
Fehler entdeckt, entsteht daraus eine neue Fassung, kein Eingriff ins Archiv.

## 7 · Grenzen der Umgebung

- **Keine Texterkennung.** Gescannte PDFs sind nur über den Dateinamen auffindbar.
  Das ist eine bewusste Grenze; sichtbar gemacht über den Reiter „Dokumente ohne
  Indexsuche" und den Lesbarkeitsbericht.
- **File System Access API scheidet aus** (nur HTTP). Der Volltextindex wird deshalb
  im Browser aufgebaut und als Datei nach SharePoint veröffentlicht.
- **`Content-Disposition: attachment`** auf HTML-Dateien: SharePoint bietet sie zum
  Herunterladen an statt sie anzuzeigen. Umweg im Code: `fetch` und Blob-URL.
- **Windows-Authentifizierung:** jeder `fetch` mit `credentials: 'include'`.
- **Zeichenkodierung:** SharePoint meldet im HTTP-Kopf teils Windows-1252. Antworten
  werden deshalb als `arrayBuffer()` geholt und mit `new TextDecoder("utf-8")`
  dekodiert, ein etwaiges BOM wird abgeschnitten. Sonst wird aus „Köln" ein „KÃ¶ln".
- **Zwischenspeicher:** jeder `fetch` auf eine Datendatei mit `cache: 'no-store'`,
  sonst erscheinen frisch hochgeladene Dokumente nicht.
- **PDF.js bleibt auf 3.11.174.** Ab Fassung 4 liefert PDF.js `.mjs`-Module, die
  SharePoint On-Premises ohne passenden MIME-Typ ausliefert; der Betrachter bliebe
  schwarz.
- **Größengrenze:** Dateien über 25 MB werden nicht automatisch ausgelesen.

## 8 · Verwaltungsmodus

Alt + Umschalt + A, sitzungsgebunden. Er blendet ausschließlich Bedienelemente ein.
Die tatsächliche Berechtigung erzwingt SharePoint über die Schreibrechte am Ordner —
der Verwaltungsmodus ist **keine** Sicherheitsgrenze und darf nie als solche
dargestellt werden.

## 9 · Werkzeuge für die Entwicklung

Node.js ausschließlich als Werkzeug (`node -c`, `vm`, `jsdom`), nie zur Laufzeit.
Python für BOM-Behandlung, Dateizusammenbau und CSS-Prüfung. Sprachstand des Codes:
Vanilla JS, überwiegend `var` und `function`; neuer Code wird an den umgebenden Stil
angepasst statt gemischt.

**Regel 12:** Beim Umsetzen einer Änderung wird kein unbeteiligter Code angefasst,
nicht nebenbei aufgeräumt, nicht umbenannt, nicht umformatiert. Wird dabei ein
anderer Fehler entdeckt, wird er im Änderungsprotokoll als offener Punkt vermerkt,
nicht eigenmächtig mitgelöst.

## 10 · Verantwortung

Entwicklung und Betrieb: Andre Michelis, Amt 67.
Fachliche Verantwortung und Vertretung: *noch zu benennen.*
