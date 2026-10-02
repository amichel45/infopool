# Datenmodell · Info-Pool 67

Stand v10.3. Diese Datei beschreibt vollständig, welche Angaben die Anwendung hält,
in welcher Datei sie stehen, welche Felder verbindlich sind und wie die Teile
zusammenhängen. Sie ist die Zuarbeit für jede spätere Prüfung und für eine etwaige
Überführung in eine Datenbank.

---

## 1 · Grundsatz: eine Quelle je Datenbestand

Es gibt für jeden Datenbestand **genau eine** Quelle. Die früheren Doppelwege
(`ip67-data.js`, `mitarbeiterliste.js`, `search-index.js`, `sidebar-data.json`) sind
seit v8.4 ersatzlos entfallen, weil sie auseinanderliefen und niemand mehr sagen
konnte, welcher Stand galt.

Ist SharePoint nicht erreichbar, gibt es bewusst **keine** Ersatzdaten, sondern eine
klare Fehlermeldung (`DATA_SOURCE = "json"`, strikt). Eine Anwendung, die
stillschweigend Altstände zeigt, ist gefährlicher als eine, die stehen bleibt.

## 2 · Überblick

```
SharePoint „Ablage"   ──LiveTree (REST, UniqueId)──▶  window.sidebarInitData
search-index.json     ──storage_v8 (fetch/REST)────▶  window.searchIndexData ──▶ IndexedDB
Mitarbeiterliste.json ──storage_v8 (fetch/REST)────▶  window.__ip67_mitarbeiterliste
dokument-meta.json    ──spReadFileText────────────▶  Gültigkeit / Zuständigkeit
such-luecken.json     ──spReadFileText / Upload───▶  Bedarfsliste
                                     │
                                     ▼
                          infopool67_v8.js rendert alles
```

Vier Dateien tragen den gesamten Datenbestand. Alle vier liegen im Programmordner
`Infopool`, sind reines JSON in UTF-8 und für einen Menschen lesbar.

---

## 3 · Themenstruktur (keine Datei — abgeleitet)

Die Themenstruktur ist **keine gepflegte Datei**, sondern wird bei jedem Start live
aus dem Ordner `Ablage` gelesen (`infopool67_livetree_v8.js`, SharePoint-REST). Es
gibt nichts zu pflegen und nichts, was auseinanderlaufen kann: Wer einen Ordner
anlegt, hat ihn damit auch in der Anwendung.

**Knoten-ID (der Schlüssel des ganzen Systems):**

| Fall | Bildung | Bemerkung |
|---|---|---|
| Regelfall | `'u_' + UniqueId ohne Bindestriche` | die GUID, die SharePoint der Datei gibt |
| Rückfall | `'f_' + Pfad-Hash` | nur, wenn die SharePoint-Fassung `UniqueId` im `$select` ablehnt |

Weil die ID an der GUID hängt und nicht am Pfad, überstehen **Umbenennen und
Verschieben innerhalb derselben Bibliothek** den Vorgang: Indexeintrag, Gültigkeit und
Zuständigkeit bleiben erhalten. Vor v9.3 gingen sie dabei verloren.

Diese Knoten-ID ist der Fremdschlüssel, über den `search-index.json` und
`dokument-meta.json` an ein Dokument gebunden sind. In einer Datenbank wäre sie der
Primärschlüssel der Tabelle „Dokument".

---

## 4 · `search-index.json` — Volltextindex

Der veröffentlichte Suchindex. Aufbau: ein Objekt, dessen **Schlüssel die Knoten-IDs**
sind und dessen Werte je einen Eintrag bilden.

```json
{
  "u_3f9a1c...": {
    "text": "…ausgelesener Volltext…",
    "indexedAt": "2026-08-14T09:12:44.000Z",
    "size": 48213,
    "fileName": "Dienstanweisung Baumkontrolle 2026.pdf",
    "format": "pdf",
    "pageBreaks": [0, 2140, 4980],
    "totalPages": 12,
    "totalTokens": 6104,
    "topTerms": { "baumkontroll": 41, "verkehrssicher": 22 },
    "_srcSize": 1842391,
    "_srcModified": "2026-08-13T14:02:10Z",
    "_uid": "3f9a1c…",
    "_href": "/Wissen673/Freigegebene Dokumente/Infopool/Ablage/…"
  }
}
```

| Feld | Bedeutung | Pflicht |
|---|---|---|
| `text` | ausgelesener Volltext | ja |
| `indexedAt` | Zeitpunkt der Auslesung (ISO) | ja |
| `size` | **Zeichenzahl des Textes** | ja |
| `fileName` | Dateiname zum Anzeigen | ja |
| `format` | Endung in Kleinschreibung (`pdf`, `docx`, `html`, …) | ja |
| `pageBreaks` | Zeichenpositionen der Seitenwechsel | wenn seitenbasiert |
| `totalPages` | Seitenzahl | wenn bekannt |
| `totalTokens` | Wortzahl, Grundlage der Ähnlichkeitsrechnung | wenn bekannt |
| `topTerms` | häufigste Wortstämme mit Zähler, für TF-IDF | wenn bekannt |
| `_srcSize` | **Bytegröße der Quelldatei** | wenn bekannt |
| `_srcModified` | Änderungszeitpunkt der Quelldatei | wenn bekannt |
| `_uid` | SharePoint-`UniqueId` | wenn bekannt |
| `_href` | server-relativer Pfad der Quelldatei | wenn bekannt |
| `_keinText` | Vermerk „hier ist dauerhaft nichts zu holen": `scan` oder `zu-gross` (seit v10.4) | nur bei textlosen Einträgen |
| `_keinTextGrund` | Begründung im Klartext, wird in der Oberfläche angezeigt | mit `_keinText` |
| `_versuchtAm` | Tag des letzten Ausleseversuchs (`JJJJ-MM-TT`) | mit `_keinText` |

> **`size` und `_srcSize` nie verwechseln.** `size` ist die Textlänge in Zeichen,
> `_srcSize` die Dateigröße in Bytes. Der Abgleich unterscheidet an genau diesem
> Unterschied ein bloßes Umbenennen von einer echten Inhaltsänderung. Eine
> Verwechslung führt dazu, dass entweder alles oder nichts neu ausgelesen wird.

**Woher der Index kommt.** Er entsteht im Browser: `infopool67_index_v8.js` liest
Dokumente aus und legt sie in IndexedDB (`ip67-db`, Store `fulltext`);
`infopool67_indexpush_v8.js` schreibt daraus `search-index.json` nach SharePoint;
beim nächsten Start liest `storage_v8.js` die Datei wieder ein. Personeneinträge
(`_isExternal`) werden beim Veröffentlichen bewusst ausgelassen.

### Einträge ohne Text (seit v10.4)

Ein Eintrag mit `"text": ""` und gesetztem `_keinText` ist **kein** Dokumenteintrag,
sondern ein Vermerk: Der Info-Pool hat diese Datei angefasst und festgestellt, dass
ein Auslesen dauerhaft nichts bringt.

```json
{
  "u_7c2e5b…": {
    "text": "",
    "indexedAt": "2026-08-29",
    "size": 0,
    "fileName": "Merkblatt_Dienstfahrrad.pdf",
    "format": "pdf",
    "_keinText": "scan",
    "_keinTextGrund": "kein Text gewinnbar – Scan ohne Texterkennung",
    "_versuchtAm": "2026-08-29",
    "_srcSize": 512044,
    "_uid": "7c2e5b…",
    "_href": "…/Ablage/Organisation/Vordrucke/Merkblatt_Dienstfahrrad.pdf"
  }
}
```

Zwei Werte sind vorgesehen:

| `_keinText` | Bedeutung | Wer setzt ihn |
|---|---|---|
| `scan` | Format wird unterstützt, aber es ist kein Text zu gewinnen (gescanntes PDF ohne Texterkennung) | `infopool67_index_v8.js` nach dem Ausleseversuch |
| `zu-gross` | Datei über 25 MB; wird nicht automatisch ausgelesen. Über den Textinhalt sagt der Vermerk **nichts** aus | `infopool67_indexsync_v8.js` beim Abgleich (ohne Download); seit v10.5 auch `infopool67_indexpush_v8.js`, wenn die Größe erst beim Aufnehmen auffällt |

**Warum der Vermerk sein muss.** Bis v10.3 hinterließ ein gescheiterter Ausleseversuch
keine Spur. Der Abgleich stufte die Datei bei jedem Seitenaufruf erneut als „ohne
Index" ein: Der Hinweisstreifen „x Dokumente sind noch nicht durchsuchbar" kam wieder,
das Auslesen lief wieder, es scheiterte wieder. Weil der Rückstand dadurch nie null
wurde, konnte auch der Lesbarkeitsbericht nie zwischen „kein Text vorhanden" und „noch
nicht drangewesen" unterscheiden — die betroffenen Dokumente standen dauerhaft als
„noch nicht indiziert" da.

**Wirkung auf die Suche: keine.** Ein Vermerk erzeugt keinen Treffer, geht nicht in die
Ähnlichkeitsrechnung ein und zählt nicht zur Bewertungsquote des Lesbarkeitsberichts.
Die Dokumente bleiben über den Titel auffindbar.

> **Korrektur seit v10.5.** Bis v10.4 stand hier, die Kern-Engine überspringe textlose
> Einträge „an jeder Stelle". Für die Suche stimmt das und soll so bleiben. Beim
> **Einlesen der zentralen `search-index.json`** war es dagegen ein Fehler:
> `fetchIndexIfAvailable()` in `infopool67_core_v8.js` verwarf jeden Eintrag ohne Text
> und ließ damit genau die Vermerke nicht herein, die v10.4 amtsweit verteilen sollte.
> Das Wissen „aus dieser Datei ist nichts zu holen" blieb auf dem Rechner liegen, der
> es erarbeitet hatte. Seit v10.5 werden Vermerke beim Einlesen übernommen — in die
> Suche gehen sie weiterhin nicht ein.

**Wann erneut versucht wird.** `_srcSize` ist der Bezugspunkt. Weicht die Bytegröße
der Datei davon ab, ist es eine andere Fassung — etwa nach einer Texterkennung — und
der Abgleich nimmt sie von selbst wieder in die Warteschlange. Ohne Größenänderung
wird nicht erneut versucht.

### Bezugsfelder beim Einlesen (seit v10.5)

Die zentrale `search-index.json` führt zu jedem Eintrag die Felder `_srcSize`,
`_srcModified`, `_uid` und `_href` mit. Sie sind der Bezugspunkt der
Veraltet-Erkennung und werden beim Einlesen **vollständig übernommen**.

Bis v10.4 baute `fetchIndexIfAvailable()` den Eintrag neu auf und übernahm nur
`text`, `indexedAt`, `size`, `fileName` und `format`; alles mit Unterstrich fiel weg,
und der vorhandene örtliche Eintrag wurde dabei überschrieben. Ohne `_srcSize` fällt
der Abgleich auf den Datumsvergleich zurück — ein Dokument, dessen Änderungsdatum in
SharePoint neuer ist als der Tag der zentralen Aufnahme, galt damit bei **jedem**
Seitenaufruf erneut als veraltet und wurde erneut heruntergeladen und ausgelesen.

Es gilt seit v10.5: Fehlt ein Bezugsfeld zentral, bleibt der örtlich bekannte Wert
erhalten. Hat der Arbeitsplatz echten Text zu einem Dokument, verdrängt ein zentraler
Vermerk „kein Text" ihn nicht.

**Grenzen des automatischen Auslesens:** 25 MB je Datei, 25 Dateien je Sitzung,
1200 ms Pause zwischen den Dateien, Beginn 4 s nach dem Start, nur bei sichtbarem Tab.
Diese Zurückhaltung ist Absicht: Der Abgleich läuft auf Arbeitsplatzrechnern mit.

**Schutz gegen Massenlöschung.** `infopool67_indexsync_v8.js` räumt **nichts** auf,
wenn der Themenbaum unvollständig ist, nicht live stammt oder der Anteil verwaister
Einträge über 30 % liegt (ab 5 verwaisten Einträgen). Stattdessen wird gemeldet.
Dieser Schutz darf nie umgangen werden — ohne ihn löscht ein einziger fehlgeschlagener
Baumaufbau den gesamten Index.

---

## 5 · `Mitarbeiterliste.json` — Personendaten

Ein **flaches Array** von Personen. Handyliste **und** Organigramm werden daraus
abgeleitet; es gibt keine zweite Strukturdatei.

```json
[
  {
    "id": 214,
    "orga": "67/32-2",
    "name": "Muster, Erika",
    "bereich": "Baumpflege",
    "zustaendigkeit": "Baumkontrolle Innenstadt",
    "aufgaben": "…",
    "handynummer": "0221 221-12345",
    "istFuehrung": false,
    "intranetUrl": "http://…"
  }
]
```

| Feld | Bedeutung | Verwendung |
|---|---|---|
| `orga` | Organisationscode, z. B. `67/32-2` | **erzeugt den gesamten Organigrammbaum** |
| `name` | „Nachname, Vorname" | Anzeige; Schlüssel für `zustaendig` in `dokument-meta.json` |
| `zustaendigkeit` | fachliche Zuständigkeit | Anzeige, Suche |
| `handynummer` | dienstliche Erreichbarkeit | Anzeige |
| `istFuehrung` | Leitungsfunktion | erzeugt die Hervorhebung im Organigramm |
| `intranetUrl` | Verweis ins Intranet | Anzeige |
| `id`, `bereich`, `aufgaben` | im Bestand vorhanden | werden angezeigt, aber **nicht** vom Editor zurückgeschrieben |

**Der Baum entsteht allein aus den `orga`-Codes.** Ändert sich der Code einer Person,
wandert sie im Organigramm automatisch mit. Es gibt keine Stelle, an der die Hierarchie
zusätzlich gepflegt würde — und damit auch keine, an der sie veralten könnte.

> **Bekannte Gefahr (Anti-Pattern I13).** Der Personen-Editor schreibt nur die sechs
> ihm bekannten Felder zurück; `id`, `bereich` und `aufgaben` gehen beim ersten
> Speichern über den Editor verloren. Vor jedem Rückschreiben ist zu prüfen, ob die
> Quelldatei mehr Felder führt als der Schreibpfad kennt. **Dieser Punkt ist offen.**

---

## 6 · `dokument-meta.json` — Gültigkeit und Zuständigkeit

Schlüssel ist wieder die **Knoten-ID**. Der Eintrag `_hinweis` am Dateianfang ist
Dokumentation für Menschen und wird vom Programm ignoriert.

| Feld | Bedeutung |
|---|---|
| `geprueft` | `JJJJ-MM-TT`, Tag der letzten fachlichen Bestätigung |
| `frist` | Monate bis zur nächsten Prüfung: 6, 12, 24, 36 oder 60 — Vorgabe 24 |
| `zustaendig` | Name **genau wie** in `Mitarbeiterliste.json` („Nachname, Vorname"); die Durchwahl wird daraus automatisch ergänzt |
| `hinweis` | freier Text, z. B. „ersetzt DA 03/2019" |

**Vererbung.** Eine Angabe an einer **Ordner**-ID gilt für alle Dokumente darin, die
keine eigene Angabe haben. Deshalb genügt es, die rund 20 Hauptordner zu pflegen statt
jeder einzelnen Datei. Das ist der Grund, warum die Pflege überhaupt leistbar ist.

Gepflegt wird nicht in der Datei, sondern im Verwaltungsmodus über „Angaben pflegen"
im Betrachter.

---

## 7 · `such-luecken.json` — erfolglose Suchen

Die Bedarfsliste: was gesucht wurde, aber nicht da ist. Schlüssel ist der Suchbegriff
in Kleinschreibung.

```json
{ "winterdienstplan": { "n": 14, "erst": "2026-03-02", "letzt": "2026-08-21" } }
```

| Feld | Bedeutung |
|---|---|
| `n` | wie oft der Begriff ohne Treffer blieb |
| `erst` | Tag der ersten erfolglosen Suche |
| `letzt` | Tag der letzten erfolglosen Suche |

Aufgenommen wird nur, was mindestens 3 und höchstens 60 Zeichen lang ist, nach 1,4 s
Tippruhe, und wirklich in **allen** Rubriken null Treffer hatte. Geschrieben wird
gebündelt nach 20 s, immer als Lesen-Ändern-Schreiben, damit die Einträge anderer
erhalten bleiben.

**Kein Personenbezug.** Es wird ausschließlich der Begriff mit einem Zähler und zwei
Tagesdaten geführt — ohne Bezug zu Person, Gerät oder Uhrzeit. Aus dieser Datei lässt
sich weder eine einzelne Person noch ein Arbeitsverhalten ableiten. Sie dient allein
dazu, fehlende Inhalte zu erkennen; eine Verwendung zur Leistungs- oder
Verhaltenskontrolle ist ausgeschlossen.

---

## 8 · Örtliche Zwischenspeicher

Diese Daten liegen im Browser der einzelnen Person, nicht auf dem Server. Sie sind
jederzeit entbehrlich: Wird der Browserspeicher geleert, baut die Anwendung alles neu
auf. **Kein** Datenbestand existiert ausschließlich hier.

**IndexedDB `ip67-db`:** Store `fulltext` (ausgelesener Volltext je Dokument),
Store `settings` (Einstellungen).

**localStorage:**

| Schlüssel | Inhalt |
|---|---|
| `ip67-sidebar-v2` | Zustand der Themenstruktur (welche Ordner offen sind) |
| `ip67-theme`, `ip67_theme_override` | Farbmodus, Zeitraum der manuellen Übersteuerung |
| `ip67_theme_last` | zuletzt wirksamer Farbmodus — Rückfall der Vorabanzeige beim allerersten Besuch |
| `ip67_theme_sonne` | Sonnenauf-/-untergang für Köln als Tageszeit (`{d, auf, unter}` in ms seit Mitternacht). Von der Glue-Schicht geschrieben, von der Vorabanzeige im Kopf der `.aspx` gelesen (seit v10.5) |
| `ip67_push_spaeter` | Ruhezeit nach „Später" am Hinweisstreifen: `{bis, stand}` — Frist und Kennung des Rückstands, für den sie gilt (seit v10.5) |
| `ip67_admin` | Verwaltungsmodus, sitzungsgebunden |
| `ip67_last_visit` | Bezugspunkt für „Neu seit Ihrem letzten Besuch" |
| `ip67-textansicht` | Vorwahl Originalansicht oder Textfassung |
| `ip67-recent-docs`, `ip67-search-history`, `ip67-access-stats`, `ip67-browser-id` | Verlauf und örtliche Nutzungszahlen |
| `ip67_gaps_pending`, `ip67-start-audio-expiry`, `ip67-sp-connected`, `ip67-watcher-*` | Zwischenstände |

Die im Programmkern angelegte Möglichkeit, eine eigene Nutzungsstatistik zu teilen,
ist im Betrieb des Amtes technisch wirkungslos: Sie setzt eine Browser-Schnittstelle
voraus, die im Intranet der Stadt Köln nicht zur Verfügung steht. Es werden dadurch
keine Daten übertragen.

---

## 9 · Was eine Datenbank daraus machen würde

Falls eine Überführung in eine Datenbank gefordert wird, sähe das Schema so aus.
Die Zuordnung ist eindeutig, ein Umbau wäre technisch machbar — er würde allerdings
eine Serverkomponente voraussetzen, die es heute nicht gibt (siehe Fragenkatalog,
Fragen A2 und A5).

| Tabelle | Herkunft | Schlüssel |
|---|---|---|
| `dokument` | LiveTree (Ordner `Ablage`) | Knoten-ID |
| `volltext` | `search-index.json` | Knoten-ID → `dokument` |
| `dokument_meta` | `dokument-meta.json` | Knoten-ID → `dokument` |
| `person` | `Mitarbeiterliste.json` | `id` |
| `suchluecke` | `such-luecken.json` | Suchbegriff |

Beziehungen: `volltext` 1:1 zu `dokument` · `dokument_meta` 1:1 zu `dokument`, mit
Vererbung entlang der Ordnerhierarchie · `dokument_meta.zustaendig` zeigt auf
`person.name` (heute über den Namen, in einer Datenbank besser über `person.id`) ·
die Organisationshierarchie bliebe aus `person.orga` abgeleitet, nicht als eigene
Tabelle geführt.

Der einzige nicht triviale Punkt wäre `volltext.text`: Die Textmenge über die gesamte
Ablage liegt in der Größenordnung mehrerer hundert Megabyte. Eine Datenbank müsste
dafür eine Volltextsuche mitbringen; die heutige Lösung rechnet Stemming und TF-IDF
im Browser.
