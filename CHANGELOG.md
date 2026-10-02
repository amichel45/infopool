# Änderungsprotokoll · Info-Pool 67

Stadt Köln · Amt für Landschaftspflege und Grünflächen (Amt 67)
Internes Dokumenten- und Wissensportal im SharePoint-Intranet.

Dies ist das **eine** fortlaufende Änderungsprotokoll der Anwendung. Es löst die
bisherigen Einzeldateien (`CHANGELOG_v9_7.md`, `CHANGELOG_v10_3.md`) ab; deren
Inhalt ist hier eingearbeitet. Neue Einträge kommen **oben** dazu.

---

## Wie ein Eintrag aufgebaut ist

Jede ausgelieferte Fassung erhält genau einen Abschnitt nach diesem Muster:

```
## vX.Y · JJJJ-MM-TT · Kurztitel
Was geändert wurde, in einem Satz.

| Datei | Änderung |
|---|---|
| … | … |

**Barrierefreiheit:** A Tastatur · B Sprachausgabe · C Sichtbarkeit ·
D Inhalt · E Nachweis — jeder Punkt abgehakt oder mit „nicht berührt" quittiert.

**Offene Punkte:** was auffiel, aber nach Regel 12 nicht mitgelöst wurde.
```

Verbindlich bei jeder Auslieferung:

1. Fassungsnummer an **allen** Stellen hochzählen: zehn Cache-Bust-Angaben
   (`?v=`) in `infopool67_v8.aspx`, `CFG.moduleVersion` in
   `infopool67_indexsync_v8.js`, Fußzeilentext in der `.aspx`.
2. Vollständige Kopie aller ausgelieferten Dateien in den Archivordner
   (`Infopool/Archiv/vX.Y/`), unverändert, mit dem Datum der Auslieferung.
3. Barrierefreiheits-Prüfliste vollständig abgearbeitet und hier abgehakt.
4. `node -c` auf allen geänderten JS-Dateien; `test_ap*.js` und
   `test_a11ycheck.js` laufen fehlerfrei durch.

---

## v10.6 · 2026-09-01 · Aufblitzen morgens/nach Pause behoben (I17)

Die v10.5-Vorabanzeige verglich die abgelegten Sonnengrenzen (`ip67_theme_sonne`),
ohne je zu prüfen, ob dieser Eintrag noch vom **heutigen** Tag stammt. Nach einer
Pause — insbesondere über Nacht — stand dort noch der Eintrag von gestern. Da sich
Sonnenauf-/untergang von Tag zu Tag kaum verschieben, lieferte der Vergleich meist
trotzdem ein plausibles Ergebnis — außer in dem schmalen Zeitfenster kurz vor dem
tatsächlichen heutigen Sonnenaufgang: Dort ergab die (noch knapp gültige) gestrige
Grenze „dunkel", während die Glue-Schicht Sekundenbruchteile später die echten
heutigen Zeiten nachrechnete und auf „hell" umschaltete. Sichtbares Aufblitzen beim
Öffnen — dieselbe Ursachenfamilie wie der v10.4-Fehler, nur in der Gegenrichtung und
nur nach längerer Pause bemerkbar, weshalb es beim täglichen Testen unentdeckt blieb.

| Datei | Änderung |
|---|---|
| `infopool67_v8.aspx` | Vorabanzeige-Script im Kopf: `s.d` (das beim Schreiben bereits abgelegte Datum) wird jetzt gegen das heutige Tagesdatum geprüft. Nur ein tagesgleicher Eintrag zählt; ein älterer Eintrag wird wie „nicht vorhanden" behandelt, die Kette fällt dann auf `ip67_theme_last` zurück — wie beim allerersten Besuch. Fassung an zehn Stellen 10.5 → 10.6. |
| `test_zentralfelder.js` | Block C um vier Prüfungen zu I17 ergänzt: Datumsabgleich im Kopf-Script vorhanden, tagesgleicher Eintrag liefert weiterhin ein Ergebnis, ein Eintrag von gestern wird verworfen, Rückfall auf `ip67_theme_last` bleibt bestehen. Fassungsprüfungen 10.5 → 10.6 nachgezogen. |
| `test_keintext.js` | Fassungsprüfungen 10.5 → 10.6 nachgezogen. |

`infopool67_v8.js` (Abschnitt 9b, `merkeSonnenzeiten()`/`themeAutomatik()`) ist
unverändert — die einzige Stelle, die den Sonnenstand rechnet, bleibt dieselbe wie
in v10.5. Der Fehler lag ausschließlich im Lesepfad der Vorabanzeige.

**Barrierefreiheit:**
- **A Tastatur** — nicht berührt. Keine Bedienelemente geändert.
- **B Sprachausgabe** — nicht berührt. Der Knopf `#themeToggle` und sein
  zugänglicher Name sind unverändert.
- **C Sichtbarkeit** — verbessert. Das morgendliche Aufblitzen zwischen dunkler und
  heller Fassung entfällt; kein unangekündigter Kontrastwechsel mehr direkt nach
  dem Öffnen. Keine neuen Farben, keine neuen Flächen.
- **D Inhalt** — nicht berührt.
- **E Nachweis** — `node -c` auf `infopool67_v8.aspx` (Inline-Script isoliert
  geprüft); CSS nicht geändert; BOM der `.aspx` gesetzt und geprüft (`ef bb bf`).
  `test_ap1` 46/46, `test_ap2` 43/43, `test_ap3` 113/114 (ein Fehlschlag
  vorbestehend, PDF-Modul „Nebenweg A", außerhalb dieses Auftrags — siehe unten),
  `test_keintext` 23/23, `test_zentralfelder` 61/61 (davon 4 neu für I17).

**Offene Punkte:** `test_ap3.js` meldet weiterhin einen vorbestehenden, bereits als
zurückgestellt dokumentierten Befund im PDF-Modul („!query-Gate", Nebenweg A). Mit
dieser Lieferung nicht mitgelöst (Regel 12) — betrifft eine andere Datei
(`infopool67_pdf_v8.js`) und steht in keinem Zusammenhang mit der Theme-Vorabanzeige.

---

## v10.5 · 2026-08-31 · Der zentrale Suchbestand kommt vollständig an; kein Aufblitzen beim Start

Drei Befunde aus dem laufenden Betrieb. Der wichtigste: Der zentrale Suchbestand wurde
beim Einlesen beschnitten — dadurch galt ein Dokument bei **jedem** Seitenaufruf erneut
als veraltet, und die Meldung „Ein Dokument ist noch nicht durchsuchbar" kehrte endlos
wieder. Die Endlosschleife, die v10.4 für textlose Dateien beseitigt hat, bestand für
die lesbaren Dateien unbemerkt weiter.

| Datei | Änderung |
|---|---|
| `infopool67_core_v8.js` | **Eingriff in die Kerndatei** (Begründung unten). `fetchIndexIfAvailable()` übernimmt `_srcSize`, `_srcModified`, `_uid`, `_href` aus der zentralen `search-index.json`, statt sie zu verwerfen; fehlt ein Feld zentral, bleibt der örtlich bekannte Wert erhalten. Einträge ohne Text mit `_keinText` werden nicht mehr übersprungen. Örtlich gewonnener Text wird nicht durch einen zentralen Vermerk „kein Text" verdrängt. |
| `infopool67_v8.aspx` | Vorabanzeige Hell/Dunkel vergleicht jetzt die Sonnengrenzen statt den zuletzt wirksamen Zustand; die Handschaltung hat Vorrang, `ip67_theme_last` bleibt Rückfall. Gerechnet wird im Kopf weiterhin nichts. Fassung an elf Stellen 10.4 → 10.5. Pflicht-BOM gesetzt (fehlte im Projektstand). |
| `infopool67_v8.js` | Abschnitt 9b: `merkeSonnenzeiten()` legt die berechneten Sonnenzeiten als Tageszeit in `ip67_theme_sonne` ab (einmal je Tag). `themeSetzen()` führt `ip67_theme_last` jetzt auch dann nach, wenn die Vorabanzeige bereits richtig lag. |
| `infopool67_indexpush_v8.js` | Neuer Abschnitt 1b: „Später" hält sieben Tage, aber nur für **denselben** Rückstand — kommt ein Dokument hinzu, wird sofort wieder gefragt. Grund und Restlaufzeit stehen in der Konsole, `IP67IndexPush.wiederFragen()` hebt die Ruhezeit auf. Dateien über 25 MB werden vermerkt statt vergeblich geholt (`vermerkeZuGross()`), auch wenn die Größe erst nach dem Download auffällt. `CFG.moduleVersion` 10.4 → 10.5. |
| `infopool67_indexsync_v8.js` | `CFG.moduleVersion` 10.4 → 10.5 (I5). Sonst unverändert. |
| `test_zentralfelder.js` | **Neu**, 56 Prüfungen: Übernahme der Bezugsfelder (an einer Nachbildung der Schleife durchgespielt), Vorrang der Handschaltung in der Vorabanzeige, Verhalten der Rückstandskennung, Fassungsnummer an allen Stellen. |
| `test_keintext.js` | Fassungsprüfungen 10.4 → 10.5 nachgezogen. |
| `DATENMODELL.md` | Neuer Abschnitt „Bezugsfelder beim Einlesen"; die Aussage, der Kern überspringe textlose Einträge „an jeder Stelle", ist als Fehler richtiggestellt; drei neue localStorage-Schlüssel. |
| `TESTFAELLE.md` | Drei neue Fälle (T-51 bis T-53). |

### Warum die Kerndatei angefasst wurde

Es gilt: `infopool67_core_v8.js` bleibt unangetastet, solange die Aufgabe über die
Glue-Schicht lösbar ist. Hier war sie es nicht. Der Verlust entsteht in der Schleife,
die den zentralen Bestand einliest; eine nachträgliche Reparatur von aussen wäre ein
Wettlauf gegen die Hintergrund-Warteschlange, die genau diese Felder unmittelbar
danach liest. Der Eingriff bleibt auf diese eine Schleife beschränkt und ist im Code
ausführlich begründet.

### Was der Fehler bewirkt hat

`infopool67_indexpush_v8.js` schreibt `_srcSize` beim Veröffentlichen ausdrücklich mit —
der Lesepfad im Kern warf es wieder weg. Ohne `_srcSize` fällt `isStale()` auf den
Datumsvergleich zurück. Ein Dokument, dessen Änderungsdatum in SharePoint neuer ist als
der Tag der zentralen Aufnahme, ist damit dauerhaft „veraltet": herunterladen, auslesen,
fragen — und beim nächsten Start von vorn. Sichtbar war das als
`0 ohne Index · 1 veraltet` bei jedem Seitenaufruf. Zugleich kam der v10.4-Vermerk
„hier ist nichts zu holen" bei keinem zweiten Arbeitsplatz an, weshalb dieselbe Ablage
auf verschiedenen Rechnern verschieden viele nicht durchsuchbare Dokumente meldete.

**Barrierefreiheit:**
- **A Tastatur** — nicht berührt. Der Hinweisstreifen behält beide Knöpfe in der
  Leserichtung, keine Tastaturfalle, keine positiven `tabindex`-Werte. Der Knopf
  Hell/Dunkel ist unverändert erreichbar.
- **B Sprachausgabe** — geprüft. Der Streifen bleibt `role="status"`; die geänderte
  Abschlussmeldung ist vollständiger Fließtext und nennt Ursache und Verbleib. Keine
  neuen Bedienelemente, keine neuen Symbolzeichen.
- **C Sichtbarkeit** — verbessert. Das Aufblitzen der hellen Fassung beim abendlichen
  Start entfällt; das war ein unangekündigter Wechsel des Gesamtkontrasts. Keine neuen
  Farben, keine neuen Flächen; Klickflächen unverändert.
- **D Inhalt** — geprüft. `lang="de"` unverändert, Überschriftenhierarchie nicht
  berührt. Die Abschlussmeldung nennt jetzt beide Ursachen (Scan **oder** Größengrenze)
  und den Weg dorthin — Reiter „Dokumente ohne Indexsuche". Kein Inhalt ist allein in
  einem Bild verfügbar.
- **E Nachweis** — `node -c` auf allen zehn JS-Dateien fehlerfrei; CSS-Klammerbilanz
  585/585; BOM der `.aspx` gesetzt und geprüft. `test_ap1` 46/46, `test_ap2` 43/43,
  `test_ap3` 113/114, `test_keintext` 23/23, `test_zentralfelder` 56/56 (neu).

**Offene Punkte** (nach Regel 12 nicht mitgelöst):
- `test_ap3.js` prüft in `infopool67_pdf_v8.js` auf die Zeile
  `if (tot || !query) return null;`. Die Datei enthält stattdessen `if (!query) return
  Promise.resolve([]);`. Der Test hinkt dem Modul hinterher oder umgekehrt — zu klären,
  bevor die Abnahme darauf gestützt wird. Bestand bereits vor dieser Lieferung.
- `_fetchJson()` in `storage_v8.js` hat weiterhin kein `cache: 'no-store'` (I2, seit
  v9.5 offen).
- `test_ap6.js` ist in `TESTFAELLE.md` genannt, aber nicht vorhanden — unverändert offen.
- Der Projektordner führte `infopool67_indexsync_v8.js` in einem Stand von v10.3,
  während produktiv v10.4 lief. Für diese Lieferung wurde der Produktivstand
  nachgereicht. Der Projektordner sollte nach jeder Auslieferung nachgezogen werden,
  sonst wird auf veraltetem Quelltext gearbeitet (I16).

---

## v10.4 · 2026-08-29 · Nicht auslesbare Dokumente werden nur noch einmal versucht

Ein Dokument, aus dem sich kein Text gewinnen lässt, hinterließ bisher keine Spur.
Der Abgleich hielt es bei jedem Seitenaufruf für unbearbeitet, der Hinweisstreifen
kehrte wieder, das Auslesen scheiterte erneut. Der Info-Pool merkt sich diesen Befund
jetzt — einmal, zentral, widerruflich.

| Datei | Änderung |
|---|---|
| `infopool67_index_v8.js` | Schreibt bei „kein Text gewinnbar" einen Eintrag ohne Text mit `_keinText`, `_keinTextGrund`, `_versuchtAm`, `_srcSize`. Der Fehlerzweig (Extraktion abgebrochen) merkt sich bewusst nichts. |
| `infopool67_indexsync_v8.js` | `dauerhaftOhneText()`; vermerkte und zu große Dateien kommen nicht mehr in `missing`, sondern in die neuen Kategorien `keinText` und `zuGross`. Neu `markiereZuGross()` — vermerkt Dateien über 25 MB ohne Download. Fehlschläge werden einzeln protokolliert. `CFG.moduleVersion` 10.3 → 10.4. |
| `infopool67_indexpush_v8.js` | Vermerke werden in `search-index.json` mitveröffentlicht und gelten als bereitzustellen. Abschlussmeldung nennt Ursache und Verbleib statt „ließen sich nicht lesen". `CFG.moduleVersion` **9.7 → 10.4** (siehe unten). |
| `infopool67_a11ycheck_v8.js` | Liest den Vermerk unmittelbar, statt auf `abgleichDurch` zu warten. Neuer Befund `zu-gross` mit eigenem Zähler, Kopfzeile und Filterknopf. |
| `infopool67_v8.js` | Reiter „Dokumente ohne Indexsuche" wertet den Befund `zu-gross` aus; der Hinweistext verspricht nicht mehr, die Einträge verschwänden von selbst. |
| `infopool67_v8.aspx` | Cache-Bust `?v=10.4` (zehn Stellen), Fußzeile, BOM. |
| `test_keintext.js` | **neu** — 23 Prüfungen. |
| `test_ap3.js` | Zwei auf v10.0 festgenagelte Fassungsprüfungen nachgezogen (siehe unten). |
| `DATENMODELL.md` | Abschnitt „Einträge ohne Text", drei neue Felder in der Tabelle. |
| `TESTFAELLE.md` | Fälle T40–T44, Kurzsatz erweitert. |

### Warum ein Vermerk und keine örtliche Merkliste

Dass ein bestimmtes PDF keine Textebene hat, ist eine Eigenschaft des Dokuments, nicht
des Rechners, der es zuerst bemerkt hat. Der Vermerk wandert deshalb über
`search-index.json` mit: Das Amt lernt es einmal, nicht jeder Arbeitsplatz für sich.
Er ist winzig — kein Text, nur Begründung und Bytegröße.

Die Suche bleibt unberührt: Die Kern-Engine überspringt textlose Einträge ohnehin an
jeder Stelle. Und der Vermerk ist widerruflich — weicht die Bytegröße der Datei von
`_srcSize` ab, ist es eine andere Fassung, und der Abgleich versucht es von selbst
erneut. Ein nachträglich mit Texterkennung versehenes Dokument findet also von allein
zurück in die Suche.

### Zwei Befunde, die dabei auffielen

**`moduleVersion` in `infopool67_indexpush_v8.js` stand auf `9.7`** und war damit seit
sechs Fassungen falsch (I5). Lädt dieses Modul das Index-Modul zuerst nach, zog der
Browser einen Stand von v9.7 aus dem Cache, während `indexsync` v10.3 anforderte. Da
diese Lieferung ohnehin beide Module ändert, ist die Angabe hier mitkorrigiert.

**Der Befund `zu-gross` ist absichtlich kein Sonderfall von „kein Text".** Eine 29-MB-PDF
kann eine tadellose Textebene haben; sie wird nur nicht automatisch ausgelesen. Sie
unter „kein Text" zu führen hieße, dem Amt eine Barriere zu melden, die es womöglich
gar nicht gibt. Wie „noch offen" bleibt der Befund deshalb außerhalb der
Bewertungsquote.

**Barrierefreiheit:**

- **A Tastatur** — Ein zusätzlicher Filterknopf im Lesbarkeitsbericht, gebaut mit
  derselben `knopf()`-Funktion wie die vorhandenen: `<button type="button">`, in der
  Leserichtung, kein `tabindex`, Esc führt weiterhin aus dem Dialog. Sonst nicht berührt.
- **B Sprachausgabe** — Der neue Knopf trägt sichtbaren Text samt Anzahl und meldet
  seinen Zustand über `aria-pressed`, das `zeichneListe()` mitzieht. Die Befundspalte
  nennt „nicht ausgelesen" im Text, nicht nur über die Ampelfarbe. Die Abschlussmeldung
  des Streifens steht in der vorhandenen `role="status"`-Region.
- **C Sichtbarkeit** — Keine neuen Farben, keine neuen Maße: Der Befund `zu-gross`
  übernimmt Grau `#6b7280` von „noch offen", der Filterknopf die Klasse `set-btn`.
  Kontrastwerte weiterhin nicht systematisch gemessen (bekannte Lücke, unverändert).
- **D Inhalt** — Der eigentliche Gewinn dieser Lieferung. Drei Texte, die eine Ursache
  verschwiegen oder eine falsche Erwartung weckten, benennen sie jetzt: der
  Reiterhinweis („verschwinden von selbst" → Grund in der letzten Spalte), die
  Abschlussmeldung („ließen sich nicht lesen" → Scans ohne Texterkennung, weiterhin
  über den Titel auffindbar, kein erneuter Versuch) und die Konsolenzeile je Fehlschlag.
  Damit ist auch Prüfpunkt D erfüllt, dass kein Inhalt ausschließlich in einem
  gescannten PDF steckt, ohne dass darauf hingewiesen wird.
- **E Nachweis** — `node -c` auf allen geänderten Dateien fehlerfrei.
  `test_a11ycheck.js` 40/0 · `test_ap1.js` 46/0 · `test_ap2.js` 43/0 ·
  `test_ap3.js` 113/1 · `test_keintext.js` 23/0 (neu, erweitert den Satz um die
  neue Logik). Gegenprobe gegen den Stand v10.3: `test_keintext.js` schlägt dort fehl.

**Offene Punkte** (nach Regel 12 nicht mitgelöst):

1. `test_ap3.js` meldet weiterhin „Das !query-Gate im PDF-Modul bleibt unangetastet".
   Die Erwartung stammt aus AP3 und wurde durch AP4 (durchgehende Textebene, v10.1)
   inhaltlich überholt. Sie betrifft `infopool67_pdf_v8.js`, das diese Lieferung nicht
   anfasst.
2. Der Toast „… enthält keinen extrahierbaren Text" aus `infopool67_index_v8.js` feuert
   beim Hintergrundlauf je Datei einmal. Das fällt jetzt weniger auf, weil es nur noch
   beim ersten Versuch geschieht — schön ist es nicht.
3. Wird ein vermerktes Dokument in eine andere Bibliothek verschoben, sodass sich die
   Knoten-ID ändert, wandert der Vermerk nicht mit; die Datei wird einmal erneut
   versucht. Innerhalb der Ablage tritt der Fall nicht auf (GUID-IDs, v9.3).
4. `_fetchJson()` in `storage_v8.js` hat weiterhin kein `cache: 'no-store'` (I2,
   unverändert offen).

---

## v10.3 · 2026-08-27 · AP6 – Dokumente ohne Indexsuche

Neuer Reiter im Bereich „Inhalte": Er listet jedes Dokument der Ablage, das die
Volltextsuche nicht erfasst, mit Ordner, Format und Grund. Damit wird eine stille
Lücke zu einer benannten.

| Datei | Änderung |
|---|---|
| `infopool67_v8.js` | Reiter, Renderer, Konstante `MAX_INDEX_BYTES` |
| `infopool67_v8.css` | neuer „Teil F" am Dateiende |
| `infopool67_v8.aspx` | Cache-Bust `?v=10.3` (zehn Stellen), Fußzeile |
| `infopool67_indexsync_v8.js` | `CFG.moduleVersion` 9.7 → 10.3 |
| `test_ap6.js` | **neu** – 34 Prüfungen |

Gründe, die der Reiter unterscheidet: Scan ohne Texterkennung · Format wird nicht
ausgelesen · über 25 MB · noch nicht ausgelesen. Der Reiter ist bewusst **für alle**
sichtbar, nicht nur im Adminmodus. Er rechnet live aus `IP67.a11yPruefe()` und stellt
keine zusätzliche Anfrage an SharePoint.

**Barrierefreiheit:** A – Titel sind echte `<button>`, Esc schließt die Ebene.
B – `<caption class="ip67-sr-only">`, `scope="col"`, Filterstand über
`role="status" aria-live="polite"`. C – keine Ampelfarbe, Einstufung steht als Wort;
`min-height:24px`. D – Hinweistext nennt Bedeutung **und** Handlung. E – erledigt.

---

## v10.2 · AP5 – Beschriftungen in Handyliste und Organigramm

Filterfelder mit gesprochener Rückmeldung, benannte Klapp-Schaltflächen,
Tabellenbeschriftungen.

## v10.1 · AP4 – Textebene über alle Seiten

Durchgehende Textebene, dauerhafte Seitenmarke beim Vorlesen.

## v10.0 · AP3 – Textfassung

Jedes ausgelesene Dokument lässt sich als reiner, vorlesbarer Text anzeigen statt
als eingebettete Datei. Seitenmarken bleiben erhalten, damit Fundstellen benennbar sind.

## v9.9 · AP1 und AP2 – Grundlagen der Barrierefreiheit

Sprungmarke zum Inhalt, durchgehend sichtbarer Fokusring, Suchfeld als Kombinationsfeld
nach ARIA 1.2, Ansage der Trefferzahl, `prefers-reduced-motion`. Vollständige
Tastaturbedienung von Trefferliste und Themenbaum, Fokusführung und Fokusrückgabe in
allen Vollbild-Ebenen, Esc schließt schichtweise.

## v9.8 · „Neu seit Ihrem letzten Besuch" im Hero

Der Hinweis sitzt jetzt direkt unter den Chips statt am Seitenende.

## v9.7 · Suche, Dunkelmodus, Trefferliste

Dunkelmodus wurde beim Suchen nicht mehr hell. Der Knopf „Suchen" entfiel, weil die
Suche ohnehin bei jeder Eingabe lief. Die Trefferliste überlebt das Öffnen des
Betrachters (Anti-Pattern I14: Außenklick darf nicht schließen, solange eine
Vollbildebene darüberliegt).

## v9.6 · Wasserzeichen, Banner

Wasserzeichen „2026 · Michelis" nahe der Fußzeile. „Neu"-Banner blendet nach 30 s
statt nach 3 min aus.

## v9.5 · Tageslicht, Hilfe, Zwischenspeicher

Automatischer Hell-/Dunkelwechsel nach Sonnenstand (NOAA-Algorithmus für Köln) mit
manueller Übersteuerung. Hilfe-Menü am Fragezeichen mit Audio-Einführungen und
automatisch gefundenen Handbüchern. `cache:'no-store'` auf allen `apiGet`-Aufrufen —
ohne das erschienen frisch hochgeladene Dokumente nicht (Anti-Pattern I2).

## v9.3 · Knoten-IDs aus der SharePoint-UniqueId

`id = 'u_' + GUID ohne Bindestriche`. Umbenennen und Verschieben innerhalb derselben
Bibliothek verlieren den Indexeintrag seither nicht mehr.

## v9.1 · Ordnerpflege im Adminmodus

Klick-Listener nur noch einmalig binden (Anti-Pattern I9: pro Render ein weiterer
Listener ließ Ordner sofort wieder zuklappen).

## v9.0 · Eigener PDF-Betrachter

PDF.js 3.11.174, lokal unter `lib/pdfjs/`, mit echter Trefferhervorhebung.
Bewusst nicht angehoben: ab Fassung 4 liefert PDF.js `.mjs`-Module, die SharePoint
On-Premises ohne passenden MIME-Typ ausliefert (Anti-Pattern I6).

## v8.9 · Seitenumbrüche im Volltextindex

Fundstellen bekommen dadurch eine Seitenzahl.

## v8.8 · Themenstruktur als Karten

Escape arbeitet sich Schicht für Schicht zurück statt alles auf einmal zu schließen.

## v8.7 · Adminmodus und Dokumentangaben

Adminmodus über Alt + Umschalt + A. Gültigkeit und Zuständigkeit je Dokument
(`dokument-meta.json`). Protokoll erfolgloser Suchen. „Neu seit Ihrem letzten Besuch".
Vollbild-Overlay „Inhalte".

## v8.6 · Speichern über die SharePoint-Schnittstelle

Direkt per REST statt Herunterladen und wieder Hochladen.

## v8.5 · Hero oben verankert

Kein Springen der Seite mehr beim Fokussieren des Suchfelds.

## v8.3 und v8.4 · Eine Quelle je Datenbestand

Volle Bildschirmbreite. Die Doppelwege (`ip67-data.js`, `mitarbeiterliste.js`,
`search-index.js`, `sidebar-data.json`) entfielen ersatzlos, weil sie auseinanderliefen.
Die Themenstruktur kommt seither live aus der Ablage (LiveTree).

## v8.2 · Umzug auf SharePoint

`.aspx` statt lokaler HTML-Datei. Einführung der **Glue-Schicht** über der
unveränderten Kern-Engine — das bis heute tragende Muster.

## v7.1 bis v7.5 · Modulares Vanilla JS

Kern-Engine `IP67` mit IndexedDB, deutscher Stemmer, Mehrwort-UND-Suche,
TF-IDF-Ähnlichkeit, Anker und Hervorhebung beim Öffnen aus der Suche, Datei-Watcher,
lazy nachgeladene Admin- und Index-Module.

## v4 bis v6 · Vorgeschichte, vollständig aufgegeben

Eine monolithische HTML-Datei, lokal über `file://` geöffnet. Suchindex per
PowerShell erzeugt, MHT-Unterstützung. Der Ansatz wurde mit v8.2 vollständig verlassen
und wird hier nur der Vollständigkeit halber geführt.

---

*Angaben zu v4 bis v7 stammen aus dem Projektverlauf, ab v8.2 aus den Versionsmarken
im Quelltext. Bis einschließlich v10.3 wurden Datumsangaben nicht durchgängig geführt;
ab v10.4 ist das Datum Pflichtbestandteil jedes Eintrags.*
