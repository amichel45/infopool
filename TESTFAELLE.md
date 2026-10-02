# Testfallkatalog · Info-Pool 67

Stadt Köln · Amt für Landschaftspflege und Grünflächen (Amt 67)
Stand v10.3

Dieser Katalog beschreibt, was vor einer Auslieferung geprüft wird, wer prüft und
wann eine Fassung als abgenommen gilt. Das zugehörige Abnahmeprotokoll liegt als
eigene Datei bei.

---

## 1 · Zwei Stufen

**Stufe 1 — automatisch.** Regressionstests auf Node.js mit jsdom. Sie prüfen das
erzeugte DOM und das Verhalten einzelner Funktionen, nicht die Anwendung im Betrieb.
Sie laufen in Sekunden und werden bei **jeder** Codeänderung ausgeführt.

**Stufe 2 — von Hand.** Alles, was nur in der echten Umgebung prüfbar ist: die
SharePoint-Anbindung, die Windows-Anmeldung, das Zusammenspiel mit dem Browser, die
Darstellung, die Sprachausgabe. Der Kurzsatz (Abschnitt 4) läuft bei jeder Auslieferung,
der Vollsatz (Abschnitt 5) bei der förmlichen Abnahme und nach jeder Änderung an der
SharePoint-Umgebung.

Die Trennung ist wichtig: Kein automatischer Test kann feststellen, ob SharePoint eine
Datei mit falschem Zeichensatz ausliefert oder ob das Amt die neue Fassung überhaupt
öffnen darf.

## 2 · Automatische Tests, Ist-Stand

```
node test_ap1.js         Grundgerüst, Landmarks, Combobox, Symbolknöpfe
node test_ap2.js         Tastaturbedienung von Trefferliste und Themenbaum
node test_ap3.js         Textfassung aus dem Volltextindex
node test_ap6.js         Reiter „Dokumente ohne Indexsuche"
node test_a11ycheck.js   Lesbarkeitsbericht gegen künstliche Bestände
node test_keintext.js    Gedächtnis für dauerhaft nicht auslesbare Dateien (v10.4)
```

Voraussetzung: `npm install jsdom` im Arbeitsverzeichnis. Node dient ausschließlich als
Werkzeug; zur Laufzeit der Anwendung ist es nicht beteiligt.

**Befund vom 29. August 2026** (Lauf gegen den Auslieferungsstand v10.4):

| Test | Ergebnis |
|---|---|
| `test_ap1.js` | 46 bestanden, 0 fehlgeschlagen |
| `test_ap2.js` | 43 bestanden, 0 fehlgeschlagen |
| `test_ap3.js` | 113 bestanden, 1 fehlgeschlagen |
| `test_a11ycheck.js` | 40 bestanden, 0 fehlgeschlagen |
| `test_keintext.js` | 23 bestanden, 0 fehlgeschlagen |

Von den fünf Fehlschlägen des Vorbefunds sind vier erledigt: Die BOM-Prüfungen waren ein
Artefakt der Projektkopie und laufen gegen den ausgelieferten Stand durch; die beiden auf
v10.0 festgenagelten Fassungsprüfungen sind mit v10.4 auf eine verhaltensbezogene
Formulierung umgestellt (Cache-Bust an allen zehn Stellen einheitlich, Fußzeile nennt
dieselbe Fassung). Offen bleibt eine Erwartung in `test_ap3.js`, siehe Abschnitt 7.

Ein Testsatz, der ohnehin rot ist, schützt vor nichts. Deshalb wird jede rote Zeile
entweder in derselben Lieferung nachgezogen oder in Abschnitt 7 mit Begründung geführt —
stillschweigendes Rotbleiben gibt es nicht.

## 3 · Prüfung vor jedem Speichern von Code

Ohne Ausnahme, auch bei einer Änderung von einer Zeile:

1. `node -c` auf jeder geänderten JavaScript-Datei.
2. Klammerbilanz der CSS geprüft.
3. Alle Tests aus Abschnitt 2 laufen durch.
4. Barrierefreiheits-Prüfliste A bis E abgearbeitet und im Änderungsprotokoll abgehakt.

## 4 · Kurzsatz — bei jeder Auslieferung

Elf Fälle, rund 15 Minuten. Sie decken die Wege ab, auf denen ein Fehler das Amt sofort
trifft.

| Nr | Prüfung | Erwartet |
|---|---|---|
| K1 | Seite im Intranet öffnen | Lädt ohne Fehler in der Entwicklerkonsole; Fußzeile nennt die neue Fassung |
| K2 | Suchbegriff mit mehreren Treffern eingeben | Trefferliste erscheint während der Eingabe, Trefferzahl wird angesagt |
| K3 | Treffer in einem PDF öffnen | Betrachter zeigt das Dokument, die Fundstelle ist hervorgehoben |
| K4 | Im Betrachter auf Textfassung umschalten | Reiner Text mit Seitenmarken erscheint |
| K5 | Themenstruktur öffnen, Ordner auf- und zuklappen | Klappt einmal, nicht doppelt; Zustand bleibt nach dem Schließen erhalten |
| K6 | Handyliste und Organigramm öffnen, filtern | Beide erscheinen, Filter greift, Filterstand wird angesagt |
| K7 | Ein Dokument mit Umlaut im Namen öffnen | Titel und Text zeigen „ö", nicht „Ã¶" |
| K8 | Frisch hochgeladenes Dokument suchen | Erscheint in der Themenstruktur; Streifen zum Aufnehmen kommt |
| K9 | Verwaltungsmodus ein- und ausschalten (Alt+Umschalt+A) | Bearbeiten-Schaltflächen erscheinen und verschwinden ohne Neuladen |
| K10 | Esc in einer Vollbildebene | Schließt schichtweise; der Fokus kehrt zum auslösenden Knopf zurück |
| K11 | Nach einem Lauf „Jetzt aufnehmen" die Seite neu laden | Der Streifen kommt für dieselben Dokumente **nicht** wieder; die Konsole meldet unter „Dauerhaft ohne Volltext" dieselbe Zahl wie zuvor (v10.4) |

**Ein fehlgeschlagener Fall des Kurzsatzes verhindert die Auslieferung.** Es gibt keine
Auflagen auf dieser Stufe.

## 5 · Vollsatz — bei der Abnahme

### T1 · Start und Datenanbindung

| Nr | Prüfung | Erwartet |
|---|---|---|
| T1.1 | Seite mit leerem Browserspeicher öffnen | Baut vollständig auf; Themenstruktur kommt live aus der Ablage |
| T1.2 | Seite ohne Netzverbindung zu SharePoint öffnen | Klare Fehlermeldung, **keine** stillschweigend alten Ersatzdaten |
| T1.3 | Personendaten prüfen | Handyliste vollständig; Organigramm entspricht den Organisationscodes |
| T1.4 | Nach einer Änderung an `Mitarbeiterliste.json` neu laden | Änderung sichtbar, ohne Zwischenspeicher zu leeren |

### T2 · Suche

| Nr | Prüfung | Erwartet |
|---|---|---|
| T2.1 | Einzelwort mit vielen Treffern | Trefferliste nach Relevanz, Fundstellen mit Seitenzahl |
| T2.2 | Zwei Wörter | Nur Dokumente, die **beide** enthalten |
| T2.3 | Wortform beugen („Bäume" statt „Baum") | Findet trotzdem — der Stemmer greift |
| T2.4 | Begriff ohne jeden Treffer | Leermeldung; der Begriff landet in den Wissenslücken |
| T2.5 | Treffer in Personendaten | Personentreffer erscheinen in eigener Rubrik |
| T2.6 | Betrachter öffnen und wieder schließen | Trefferliste steht danach noch da |

### T3 · Betrachter

| Nr | Prüfung | Erwartet |
|---|---|---|
| T3.1 | PDF mit mehreren Seiten | Blättern möglich, Fundstellen hervorgehoben |
| T3.2 | Word-Dokument | Wird lesbar dargestellt |
| T3.3 | Tabellenblatt | Reiter je Blatt, Inhalt lesbar, nicht bearbeitbar |
| T3.4 | HTML-Datei aus der Ablage | Wird **angezeigt**, nicht zum Herunterladen angeboten |
| T3.5 | Gescanntes PDF ohne Texterkennung | Wird angezeigt; die Textfassung meldet ehrlich, dass kein Text vorliegt |
| T3.6 | Datei über 25 MB | Erscheint im Reiter „Dokumente ohne Indexsuche" mit Grund „zu groß" |

### T4 · Inhalte und Angaben

| Nr | Prüfung | Erwartet |
|---|---|---|
| T4.1 | Gültigkeit an einem **Ordner** pflegen | Angabe gilt für alle Dokumente darin, die keine eigene haben |
| T4.2 | Gültigkeit an einem einzelnen Dokument pflegen | Übersteuert die Ordnerangabe |
| T4.3 | Zuständige Person eintragen | Durchwahl wird automatisch aus der Handyliste ergänzt |
| T4.4 | Reiter „Dokumente ohne Indexsuche" | Listet mit Ordner, Format und Grund; Klick öffnet das Dokument |
| T4.5 | „Neu seit Ihrem letzten Besuch" | Zeigt neue Dokumente; Banner blendet nach 30 s aus |

### T5 · Verwaltung und Index

| Nr | Prüfung | Erwartet |
|---|---|---|
| T5.1 | Neues Dokument hochladen, Seite öffnen | Streifen „Jetzt aufnehmen" erscheint bei berechtigten Personen |
| T5.2 | Aufnehmen und bereitstellen | Dokument ist danach **an einem zweiten Arbeitsplatz** über die Suche auffindbar |
| T5.3 | Dokument umbenennen | Indexeintrag und gepflegte Angaben bleiben erhalten |
| T5.4 | Dokument in einen anderen Ordner verschieben | Ebenso |
| T5.5 | Themenstruktur künstlich unvollständig laden | Der Abgleich räumt **nicht** auf, sondern meldet den ausgesetzten Lauf |
| T5.6 | Mit einem Konto ohne Schreibrechte speichern | Datei wird zum Herunterladen angeboten; Meldung sagt, was zu tun ist |
| T5.7 | Lesbarkeitsbericht öffnen | Einstufung und Quote werden ausgegeben |
| T5.8 | Gescanntes PDF ohne Texterkennung hochladen, aufnehmen lassen, Seite neu laden | Der Ausleseversuch findet **genau einmal** statt. Danach steht das Dokument im Reiter „Dokumente ohne Indexsuche" mit dem Grund „Scan ohne Texterkennung"; der Streifen kommt dafür nicht wieder |
| T5.9 | Dasselbe Dokument durch eine Fassung **mit** Texterkennung ersetzen | Der Abgleich erkennt die geänderte Bytegröße und liest von selbst erneut aus; das Dokument verlässt den Reiter |
| T5.10 | Datei über 25 MB in die Ablage legen | Sie wird **nicht** heruntergeladen. Reiter und Lesbarkeitsbericht nennen den Grund „über der Größengrenze"; im Bericht erscheint der Befund „nicht ausgelesen", nicht „kein Text" |
| T5.11 | Nach T5.8 an einem **zweiten** Arbeitsplatz öffnen | Auch dort kein erneuter Ausleseversuch — der Vermerk kam über `search-index.json` mit |

### T6 · Barrierefreiheit

| Nr | Prüfung | Erwartet |
|---|---|---|
| T6.1 | Die gesamte Anwendung nur mit der Tastatur bedienen | Jede Funktion erreichbar; keine Falle; Esc führt aus jeder Ebene heraus |
| T6.2 | Fokus verfolgen | Immer sichtbar, nie von der Kopfleiste verdeckt |
| T6.3 | Mit Sprachausgabe durchgehen | Jedes Bedienelement hat einen Namen; Trefferzahl und Filterstand werden angesagt |
| T6.4 | Zoom auf 200 % | Alles bedienbar, kein waagerechtes Scrollen |
| T6.5 | Fensterbreite 320 px | Ebenso |
| T6.6 | Hell und dunkel umschalten | Beide Ansichten lesbar; Automatik nach Tageslicht greift |
| T6.7 | Bewegungsreduzierung im Betriebssystem | Animationen unterbleiben |

### T7 · Umgebung

| Nr | Prüfung | Erwartet |
|---|---|---|
| T7.1 | Nach dem Hochladen neuer Programmdateien F5 | Neue Fassung lädt, keine Mischung aus alt und neu |
| T7.2 | Fußzeile und Cache-Bust vergleichen | Beide nennen dieselbe Fassung |
| T7.3 | Seite in allen im Amt eingesetzten Browsern öffnen | Gleiches Verhalten |
| T7.4 | Zeichensatz stichprobenhaft prüfen | Umlaute in Dateinamen, Trefferliste und Personendaten unversehrt |

## 6 · Abnahmekriterien

**Bestanden**, wenn alle Bedingungen zutreffen:

- Alle automatischen Tests laufen fehlerfrei durch.
- Der Kurzsatz K1 bis K10 ist vollständig bestanden.
- Kein Fall des Vollsatzes ist fehlgeschlagen, der Daten verändert, verliert oder
  unauffindbar macht (T1.2, T4.1, T5.2 bis T5.6, T7.1).
- Kein Fall der Gruppe T6 ist fehlgeschlagen, ohne dass die Abweichung schriftlich
  begründet und mit Frist versehen ist.

**Bestanden mit Auflagen:** Einzelne Fälle außerhalb der genannten sind fehlgeschlagen,
die Abweichung ist benannt, einer Person zugeordnet und mit einer Frist versehen. Die
Fassung darf in Betrieb gehen.

**Nicht bestanden:** alles andere. Die Fassung geht nicht in Betrieb; der vorherige Stand
bleibt oder wird aus dem Archiv zurückgeholt.

Zwei Punkte dazu, die keine Formsache sind. Erstens ist ein rot laufender Testsatz
gleichbedeutend mit „nicht bestanden", auch wenn die Fehlschläge bekannt und harmlos
scheinen — sonst gewöhnt man sich an Rot und übersieht die echte Regression. Zweitens
zählt T5.2 nur, wenn die Prüfung tatsächlich an einem **zweiten** Arbeitsplatz erfolgt:
Auf dem eigenen Rechner ist ein Dokument auch dann auffindbar, wenn es für niemanden
sonst bereitsteht. Genau dieser Unterschied ist der häufigste Fehler im Betrieb.

## 7 · Pflege des Testsatzes

- Für jede neue Bedienoberfläche wird der Testsatz **erweitert**, nicht nur ausgeführt.
- Erwartungen werden ans Verhalten geknüpft, nicht an Textmuster im Quelltext. Wo ein
  Textmuster unvermeidlich ist, wird es als solches gekennzeichnet.
- **Keine Fassungsnummern in Erwartungen festnageln.** Zwei Prüfungen in `test_ap3.js`
  taten das und liefen von v10.1 bis v10.3 rot; sie sind mit v10.4 auf die eigentliche
  Aussage umgestellt — alle zehn Cache-Bust-Angaben tragen dieselbe Fassung, und die
  Fußzeile nennt sie ebenfalls. Welche Fassung das ist, prüft der Test nicht mehr.

**Offene Punkte am Testsatz (Stand 29. August 2026):**

| Fundstelle | Befund | Bewertung |
|---|---|---|
| `test_ap3.js` | Erwartet im PDF-Modul das Textmuster `if (tot \|\| !query) return null;` | Muster existiert so nicht mehr; durch AP4 (durchgehende Textebene, v10.1) inhaltlich überholt. Zu klären, ob sich das Verhalten oder nur die Formulierung geändert hat |
| `test_ap6.js` | In Abschnitt 2 geführt, liegt aber nicht im Projektordner | Vor der Abnahme klären, ob die Datei verlorenging oder nie ausgeliefert wurde |

Diese Punkte sind bewusst nicht nebenbei gelöst worden (Regel 12): Sie gehören in eine
eigene Lieferung mit eigenem Nachweis.

## 8 · Wer prüft

| Stufe | Wer |
|---|---|
| Automatische Tests, `node -c` | Entwicklung |
| Kurzsatz K1–K10 | Entwicklung |
| Vollsatz T1–T7 | Entwicklung gemeinsam mit der Fachadministration |
| T6 mit Sprachausgabe | möglichst mit einer Person, die eine Sprachausgabe täglich nutzt |
| Fachliche Abnahme | *noch zu benennen* (Frage B2) |

Der Vollsatz wird nicht von einer Person allein durchgeführt. Wer eine Änderung gebaut
hat, sieht deren Nebenwirkungen am schlechtesten.
