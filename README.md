# Fahrtbriefing — Ballon-Fahrtvorbereitung

Stellt das Fahrtbriefing für Heissluft- und Gasballonfahrten zusammen: Stammdaten,
Sonnen- und Dämmerungszeiten (amtliche RAC-4-4-Tabelle für die Schweiz, sonst
astronomisch), Tragkraft-/Treibstoff- bzw. Ballastrechnung, Tagesplanung mit
Routing, Meteo- und Navigations-Panels mit Einfüge-Assistent, Briefingsicht zum
Drucken (A4), persönliche Links für Mitarbeit oder Lesen. Zweisprachig DE/EN.

**Live:** https://ops.wicki.aero (bis 12.10.2026 briefing.wicki.aero, Repository `bwicki/briefing`) · **Repository:** https://github.com/bwicki/ops
**Stack:** HTML/CSS/JS ohne Build-Schritt (GitHub Pages) + Cloudflare Worker mit D1
(Datenbank) und R2 (Bilder). Gestaltung, Tokens und Bedienidiom aus GaforCast/StueveCast.

> **Planungshilfe ohne Gewähr.** Flughandbuch (AFM) und amtliche Produkte
> (MeteoSchweiz/skybriefing, DWD, DABS/NOTAM) sind massgebend.

Stand: Phase 1 (Version 0.1.0). Die automatischen Meteo-Abrufe, DABS/NOTAM und
die KI-Hinweise folgen in Phase 2 (siehe Konzept v0.4 im Projektordner).

---

## Die App von oben nach unten

### Anmeldeseite

Beim ersten Laden fragt die App Nutzer und Kennwort. Im **Server-Modus** prüft
sie der Worker (Hash in der Datenbank, Fehlversuche werden gebremst); nach zwei
Stunden ohne Benutzung wird wieder gefragt, Menü → *Sperren* sofort. Der zuletzt
benutzte Anmeldename wird vorgeschlagen. Nach der Anmeldung öffnet sich immer die Übersicht
**«Meine Briefings»** (0.12.2; Freigabe-Links bleiben auf ihrer Seite). Das eigene Kennwort wird in
**Einstellungen → Experte** geändert — nach der Inbetriebnahme bitte ein längeres
setzen, weil die Briefings Pax-Namen enthalten.

Menü ≡ → **«Einführung (Filme)»** öffnet `demo/`: zwei Filme mit Sprecherstimme (Heissluftfahrt HB-QWZ,
Gasfahrt HB-QPJ, je rund zweieinhalb Minuten) mit Kapiteln und Sprechtext – Konzept und Pipeline in
`docs/Konzept_Demo_Einfuehrung.md` und `demo/build/`.

### Nutzer, Rollen und Freigaben (ab 0.5.0)

Die App kennt zwei Rollen. Der **Supermaster** (Startbenutzer `bwicki`) verwaltet
Nutzer, die zentralen Zugänge (API-Schlüssel) und sieht die Nutzungsstatistik;
er hat lesende Einsicht in alle Briefings (Sicht *Alle Nutzer*) und in den Stamm
jedes Nutzers (*Stamm ansehen*), ändert fremde Briefings aber nicht. Ein
**Master** hat eigenen Stamm (Ballone, Personen, Startplätze, Treffpunkte,
Betreiber), eigene Briefings und eigenes Kennwort; Master sehen einander nicht.
Beim Anlegen kann der Supermaster den Stamm eines bestehenden Nutzers kopieren
(sonst beginnt der neue Nutzer mit dem Beispiel-Stamm der App) und je Nutzer
KI, NOTAM und Final-PDF freischalten.

**Freigaben** (Einstellungen → Nutzer & Freigaben): jeder Nutzer gibt per
Klickbox je Kategorie Teile seines Stamms einem anderen Nutzer zur Auswahl frei
— etwa die Ballone, wenn jemand das eigene Material mitbenützt. Freigegebene
Einträge erscheinen im Ablauf mit dem Namen des Gebers in Klammern und bleiben
dessen Eigentum (der Empfänger ändert sie nicht). Verwendet ein Nutzer einen
freigegebenen Ballon, sieht der Eigner das Briefing lesend unter *Fahrten mit
meinem Material* — die Grundlage für das Ballonbuch. Persönliche Links (Mitarbeit,
Nur lesen) bleiben wie bisher je Briefing.

**Material-Links für Externe** (Einstellungen → Nutzer & Freigaben → *Fahrten mit
meinem Material*): für Materialeigner ohne Nutzerkonto, etwa den Halter eines
mitbenützten Ballons. Der Nutzer wählt Name und Kennungen aus seinem Stamm;
der Link (`#/m/<token>`, Standard 1 Jahr gültig, widerrufbar, QR/WhatsApp/E-Mail)
zeigt ohne Kennwort die Liste aller Briefings mit diesen Kennungen — eigene und
solche anderer Nutzer, die den Ballon über eine Freigabe verwenden — und jedes
davon in der Briefingsicht samt Pax-Karte, nur lesen. Jedes Öffnen zählt in der
Statistik als Link-Öffnung des Erstellers.

**Nutzungsstatistik** (Supermaster, Einstellungen → Statistik): je Nutzer und
Monat Anmeldungen, neue Briefings, Freigaben als Final, Datenabrufe je Quelle,
KI-Aufrufe und Tokens, PDFs, Dateien/Bytes, Links; Fahrten je Ballon (Eigner,
Material von), Speicher je Nutzer; Export als CSV.

Ist der Worker nicht erreichbar (oder in `js/config.js` keine Adresse eingetragen),
läuft die App im **lokalen Modus**: Daten bleiben im Browser dieses Geräts,
persönliche Links und Zugänge sind dann nicht verfügbar. Die Kopfzeile zeigt
das mit «Lokaler Modus» an.

### Übersicht «Briefings»

Start- und Landeorte tragen das zweistellige Länderkennzeichen voran – seit 0.12.8 immer, auch in der
Schweiz («CH-Oberlunkhofen AG», «DE-Wolfegg», «CZ-Falki»; Liste, Kopfzeile, Tagesplanung, Kalender-Export,
Briefingsicht, Ortsnamen aus der Rückwärtssuche). **A1 Stammdaten** (0.12.8): Startort und darunter in
gleicher Gliederung der **Landeort (geplant)** (Name, ICAO-Koordinaten, Höhe, Google-Maps-Link; nicht fett);
die Zeile **Fahrtabsicht** lautet «Fahrtdauer 24:00 h · Fahrthöhen 500–10000 ft AMSL · Grobrichtung ~068° ·
Distanz 755 km · Ankunft ~Do 19:25 LT (Fahrzeit 20:55 h) · ⌀ Fahrthöhe 2210 m AMSL · ⌀ Geschwindigkeit
36.1 km/h» (Kurs/Distanz aus dem Landeraum, Fahrzeit und Höhe aus der Trajektorienschätzung; `intent.target`).
**A2 Astronomische Daten** als zwei Tabellen: Sonne (BCMT · SR · SS · ECET; Zeilen LT, UTC, bei RAC
astronomisch) und Mond (Aufgang · Untergang in LT/UTC, Phase); Quelle als Fussnote, ohne NVFR-Anmerkung.
METAR-Klartext: Änderungsgruppen («→ BECMG …») stehen bündig unter dem Text, auf den sie sich beziehen, mit
hängendem Einzug. **Drei Schriften in der Briefingsicht (0.12.9):** Titel der linken Spalte (wie «Stammdaten»),
Beschriftungen (wie «Briefingnummer»: Mono, klein, grau) und Angaben (wie «2'600 m³»: Sans 11.5 px, schwarz) – auch
für METAR/NOTAM-Texte, Tabellen und Hinweise; Grafiken und das Höhenprofil-Werkzeug sind davon nicht berührt.
A2-Tabellen kompakt.

Alle Briefings kompakt (zwei Zeilen je Zelle): **#** (Ordnungsnummer, 🔒 bei Sperre), Datum
und Startzeit, Startort (ICAO-Kurzkoordinaten, Höhe), Ballon, Fahrttyp, **Status** («in Arbeit
NN %» oder «Final vN», darunter die Phase Vorplanung > 72 h / Planung 24–72 h / Final < 24 h) und
**Letzte Änderung** (Bearbeitungsstand vN · Datum · Bearbeiter, dazu 🔗 n aktive Freigabelinks).
Aktionen als Symbole: ✎ Bearbeiten (gesperrt: 👁 Briefingsicht), ⧉ Duplizieren, 🗑 Löschen.
Sortierung über die Spaltenköpfe (Standard: Nummer absteigend, jüngste zuoberst); Doppelklick auf
eine Zeile öffnet die Briefingsicht. Seit 0.12.10/0.12.11 drei Abschnitte: **Briefings in Arbeit** (Startzeitpunkt in
der Zukunft), **Laufende Fahrten** (Start vorbei, geplante Landung + 6 h noch nicht erreicht: gesperrt – Ansicht, Druck;
Stift = **Nachtrag**: nach Rückfrage geht der bisherige Stand als eingefrorene Archivkopie mit der bisherigen
Briefingnummer ins Archiv, das Briefing selbst erhält die Nummer mit Buchstabe «2026-008a», «…b» und ist in dieser
Erarbeitung bearbeitbar – je Öffnung ein Buchstabe; der Abschnitt erscheint nur, wenn eine Fahrt läuft) und **Archiv**
(geplante Landung = Start + Fahrtdauer, plus 6 h, sowie Archivkopien: unbeschränkt aufgeführt, unveränderlich – nur
Ansicht, Druck und ⧉ Kopie als Vorlage; kein Löschen, der Supermaster kann Einträge ausblenden (nichts wird gelöscht) und
über «Ausgeblendete anzeigen» im Archiv-Titel wieder einblenden (0.12.12, `GET /api/briefings?scope=all&hidden=1`,
`POST /api/briefings/:id/unhide`);
der Worker lehnt Änderungen und Löschen archivierter Briefings ab (423), Nachträge laufen über
`POST /api/briefings/:id/amend`); Suche über alle; Sichten *Meine Briefings*,
*Alle Nutzer* (Supermaster) und *Fahrten mit meinem Material* (wenn Ballone
freigegeben sind; fremde Briefings öffnen sich nur in der Briefingsicht). Rechts
die nächste Fahrt mit Sonnenzeiten und der Knopf «Einstellungen» (0.12.8: ohne Rekapitulation der Stammdaten). **⧉** dupliziert ein Briefing als Vorlage (Ballon, Startort, PIC,
Pax, Nachfahrer, Absicht, Ausrüstung, Absprachen bleiben; Datum morgen 06:30, Anlass, Startplatzwerte,
Tagesplanung und Meteo-Panels neu) und öffnet den Ablauf bei Schritt 1 – ebenso «Kopieren und neu
anlegen» bei gesperrten Briefings.

### Neues Briefing — geführter Ablauf

Sechs Schritte mit Zurück/Weiter (Eingabetaste = Weiter); der Entwurf wird laufend
gespeichert, *Als Entwurf speichern* verlässt den Ablauf.

1. **Ballon & Fahrt** — Heissluft (Kennung) oder Gas (Hülle × Korb und **Ausrüstung (kg)**:
   Instrumente, Leinen, leere Säcke, Verpflegung; Vorgabe aus dem Korb, ca. 45 kg; zählt zur
   Startmasse neben Pilot und Crew, 0.12.4), Typ der Fahrt mit
   **NVFR-Schalter** (bewusst geplante Nachtfahrt: keine Nacht-Warnungen, Nachtausrüstung
   wird gesetzt), Lufttransportführer, Anlass.
2. **Ort & Zeit** — Favoriten-Chips (nur Startplätze, die zum Ballontyp passen;
   Kennzeichnung Heissluft/Gas in den Einstellungen) und **Ortswahl**: ins Ortsfeld
   tippen öffnet die Suche direkt. Kurzkoordinaten, Höhe, Land und Zeitzone werden
   ermittelt (Open-Meteo, Nominatim); Datum, Startzeit (10-min-Schritte), LT/UTC; Sonne/Dämmerung
   sofort, Warnung bei Nachtfahrt mit dem Schalter **«NVFR zulassen»** (macht den Flugplan C
   verbindlich und setzt die Nachtausrüstung; Hinweis «NVFR geplant»); Planungshorizont mit
   verfügbaren Modellen. «Als Favorit speichern» nur, wenn kein Favorit gewählt ist.
   Sobald Ort und Zeit stehen, erscheint die **Start-Ampel** (denkbar / marginal /
   eher ausgeschlossen) aus Modellwerten und Ampel-Grenzen — grobe Einschätzung,
   keine Entscheidung. Mit «NVFR zulassen» entfällt das Kriterium «ausserhalb der
   bürgerlichen Dämmerung» in Start-Ampel und Meteogramm-Ampel (0.12.3); die
   Nachtkennzeichnung im Meteogramm bleibt.
3. **Fahrtabsicht** — Start-Ampel, Dauer, Höhenband, Trajektorien-Niveaus; **Wettermodell**
   wählbar (Vorgabe ICON-EU; Modelle, die die Fahrt nicht abdecken, mit ⚠ – bei der Warnung
   «reicht nur … h voraus» hier umstellen, 0.12.4); **Trajektorien-
   Karte mit allen Niveaus** (Legende, Stundenpunkte, zeichnet bei Änderungen neu); ein
   Klick auf die Karte übernimmt den Punkt als **geplanten Landeraum** und füllt die
   Zielrichtung als `Ort · W266° · 25 km · ~1:30 h · ⌀ 1200 m AMSL` (Fahrzeit und
   mittlere Fahrthöhe aus den beiden nächsten Trajektorien links/rechts des Ziels,
   nach Querabstand gewichtet; `>` = Ziel jenseits der Bahnenden). Trajektorien-
   Niveaus (Startwerte je Ballontyp aus den Einstellungen). Landeraum und Richtung
   bleiben optional.
4. **Personen** — PIC, **2. Pilot** (Personen mit Rolle «2. Pilot» aus den
   Einstellungen oder frei; zählt zu Personen an Bord, Masse und Flugplan P/; 0.12.6, seit 0.12.7
   für alle Ballontypen), **mehrere
   Nachfahrer** (Liste aus Stamm oder frei), Pax
   (Name leer = Platzhalter im Briefing, Gewicht), Vorschau Tragkraft bzw. Ballast;
   Temperatur/QNH/Feuchte werden, wenn der Start innert 15 Tagen liegt, aus dem
   Modell geholt.
5. **Tagesplanung** — **Tabelle** mit je Zeile Zeit · Aktivität (Dropdown:
   Treffpunkt, Fahrt, Ankunft Startplatz, Aufrüsten, Füllen, Reserve, Briefing,
   Start, Fahrt (Ballon), Landung, Bergung, Rückfahrt, Verpflegung, Tanken,
   Sonstiges; unter Experte ein-/ausblendbar, Standarddauer, eigene Aktivitäten) ·
   Info · Dauer (min) · Ort. Zeilen per Ziehen oder ▲▼ verschieben, hinzufügen,
   löschen – die Zeiten laufen mit: Anker ist «Start» (Startzeit), danach Zeit +
   Dauer vorwärts, davor rückwärts, Rundung auf 5 min. Zeit tippen = Pin (↺ löst
   ihn). Treffpunkte aus dem Stamm in der Spalte «Ort» wählbar («anderer …» per
   Ortswahl); Fahrten werden geroutet (OSRM × Anhängerfaktor + Zuschlag), sobald Ort
   davor und danach bekannt sind; Ankunft = Startplatz, Landung = Landeraum; die
   Dauer der Ballonfahrt ist dieselbe wie in «Was ist geplant». Warnungen bei
   unplausibler Reihenfolge; Zeilen vor BCMT / nach ECET dunkel, Dämmerung hell
   schattiert. «Vorlage neu» baut die Tabelle aus Stamm und Favoriten neu. Klickbox
   **«kein Tagesplan anlegen / später»**.
6. **Prüfen** — Zusammenfassung und Pflicht-Panels; *Briefing anlegen*.

### Ortswahl (Startort, Treffpunkt, Landeraum, Stammdaten)

Der Knopf **Ort wählen …** öffnet ein Fenster mit Karte (Marker setzen oder
ziehen), Suche und Koordinatenausgabe. Die Suche versteht Ortsnamen (Open-Meteo),
Adressen mit Hausnummer (Nominatim/OpenStreetMap), Dezimalkoordinaten
«47.3, 8.4», ICAO-Kurzkoordinaten «4719N00824E», Grad/Minuten
«47°19.0'N 008°24.0'E» und eingefügte Google-Maps-Links. 📍 übernimmt den
eigenen Standort (Handy). Höhe, Zeitzone und Land werden automatisch ergänzt.
Ergebnis in allen Sichten: **Name · Kurzkoordinaten · Höhe · Google Maps ↗**
(öffnet in neuem Fenster, auch im PDF klickbar); ⎘ kopiert Koordinaten und Link.

### Erarbeitungssicht

Oben in jeder Sicht die Hauptnavigation **Briefings · + Neues Briefing**; Einstellungen,
JSON (Import/Export der Einstellungen), Berechtigungen und «Mehr» im Hamburger-Menü.
Links die Navigation A–D mit Status-Punkt je Panel (grün erledigt, blau
automatisch/noch nicht geladen, orange manuell offen, rot Pflicht offen; Legende mit eingefärbten
Punkten; Zeilen als Raster Punkt · Nummer · Titel in einer Schriftgrösse, Nummern ohne Umbruch, Zwischentitel
hervorgehoben, 0.12.8), Mitte die Panels in Druckreihenfolge, **nummeriert A1–An, B1–Bn, C1–Cn, D1–Dn** unter
markanten Abschnittstiteln (A Operationelle, B Meteorologische, C Navigatorische Vorbereitung, D
Crew-/Pax-Briefing) in einem eigenen Rollbereich mit sichtbarem Rollbalken (0.12.8), rechts (0.12.8)
**Planungshorizont**, **Grunddaten** (Datum/Zeit, Startort, Kennzeichen, Fahrtdauer, Landeort, Klickbox
NVFR), **Einschätzung (Modellsicht)** in Blöcken untereinander (Gesamteinschätzung kritisch / marginal /
unkritisch, Gründe, Modellaussage), bei Bedarf «Seit Final geändert» und die KI-**Zusammenfassung**; die
Spalten links und rechts bleiben unter der Kopfzeile stehen. Beim Wechsel Erarbeitung ↔ Briefingsicht öffnet
die andere Sicht an der zuletzt gesehenen Stelle (erstes Öffnen der Briefingsicht in einer Sitzung: oben). Die Navigation links ist ein
**Akkordeon**: offen ist nur der Abschnitt der gerade bearbeiteten Stelle (folgt dem Scrollen und dem
Fokus); selbst geöffnete Abschnitte bleiben offen. Über dem Abschnitt A steht die Zeile **«Alle verfügbaren
Daten aktualisieren»** (lädt alle automatischen Panels neu, ohne KI-Kommentare) und **«Pflichtinhalte
ergänzen (n)»** (springt zum nächsten noch leeren Pflicht-Panel, zyklisch; zeigt die Zahl der offenen); die
Zeile bleibt beim Rollen unter der Kopfzeile stehen (0.12.2). Im Kopf der
**Bearbeitungsstand** («v12 · Datum Zeit · Name»; +1 je Bearbeitungssitzung: Öffnen der Erarbeitung,
Weiterarbeit nach Freigabe oder Final-PDF), der Status und die Phase.

Alle Bedienelemente verwenden den Symbolsatz «Linie» (`js/ui/icons.js`, SVG 24 × 24, Strich 2 px) –
keine Emoji, daher auf allen Geräten und im Druck gleich. Jedes Panel kann unter dem Inhalt drei Boxen haben: **Eigener Text / Bilder / Daten** (blau; Text,
Bilder, Links, Daten aus eigener Recherche), **KI-Kommentar** (violett; editierbar, verwerfbar) und
**Kommentar PIC** (gelb). Die blaue und die gelbe Box erscheinen nur mit Inhalt oder nach Klick auf
die Symbolknöpfe (Dokument mit Plus, Sprechblase) im Panelkopf (rechts, unter KI-Kommentar und Quelle). Panels mit
Einfügepflicht (LINK + EINFÜGEN) zeigen zusätzlich immer das Feld «Bericht / Daten einfügen».

Panel-Arten:

* **Berechnet** — Stammdaten, Sonne/Mond, Tragkraft/Ballast (Eingaben Temperatur,
  QNH, Feuchte, Hüllentemperatur; Knopf «aus Modell übernehmen»; Tanks je Briefing
  änderbar), Tagesplanung (Routing, Überschreibungen mit ↺ zurücksetzen),
  Spezialausrüstung (Gasballon ohne Druckerhöhung und Heli-Bergung), Übergangshöhe (die für die Fahrt
  anwendbaren sind automatisch angeklickt – Länder von Startort, Landeraum, FIR-Folge und Profil; Handänderung
  bleibt bis «wieder automatisch», 0.12.6), Standard-Briefing PAX
  (Checkliste, AMC1 BOP.BAS.115, Zusatzpunkte Gasballon).
* **Einfüge-Assistent** (Meteo, DABS, NOTAM, SIGWX …) — *Quelle öffnen ↗* führt
  zur Quelle (Einstellungen → Quellen), das Feld nimmt Text per Tastatur und
  **Bilder aus der Zwischenablage** (Ctrl/Cmd-V, iPad «Einsetzen»), per Drag & Drop
  oder Datei. Bilder werden auf 1600 px verkleinert, im Server-Modus in R2
  abgelegt.
* **Automatisch** (seit 0.3.0, Abschnitt B und C) — der Inhalt wird aus Modellen
  und amtlichen Quellen geholt und als **Schnappschuss** mit Stand, Modell und
  Quelle im Briefing gespeichert (Druck, Leselink, Final-Versionen). Jedes
  dieser Panels hat *Aktualisieren*, *KI-Hinweis*, ✕ (Schnappschuss entfernen);
  eigener Text/Bilder gehören in die blaue Zusatzbox. Details im Abschnitt
  «Automatische Panels».
* **Text** — Landeorte, Bemerkungen, Flugplan, Absprachen, Briefingbedürfnisse; bei Gasfahrten ab
  12 h zusätzlich **Nachfahrer** (Route, Maut/Vignetten, Übernachtung, Grenzdokumente, Treffpunkt).
* **Fahrtprofil: Höhen, Etappen, Ballast** (0.12, nur Gasballon) — «Daten aufbereiten» holt
  Prognosen entlang der Bahn, Relief, **Wasserflächen aus OpenStreetMap** (Overpass, Rückfall Heuristik
  aus dem Relief), Stundenprofile, Sonne und Lufträume; die Grafik (Distanz × Höhe, Zeilen km · Zeit LT/UTC
  mit Sonnenzeiten · Datum) steht als Bild im Panel, «Werkzeug öffnen» startet das Vollbild-Werkzeug:
  Punkte ziehen/setzen/löschen (≡), Etappen nummeriert mit Griff ⋮ und Menü (umbenennen, mit
  Vorgänger/Nachfolger zusammenlegen), Rückgängig (Ctrl+Z), Pille **«Wettermodell ‹Name› ⋯»** (Vorgabe das
  feinste Modell, das die ganze Fahrt abdeckt; Horizont-Warnung), «Beispiel» (synthetische Fahrt mit
  nummerierten Erklärungen zum Üben), Layer Wetter/Lufträume, Kartenansicht mit wählbarer Grundkarte,
  **Spreizung Höhe** ×1/×2/×3 (Grafik wächst, Rahmen rollt; 0.12.6) und **Ausschnitt** (0.12.7): Schieber
  **unterhalb der Zeitskala** mit Beginn- und Endmarke über die ganze Fahrt (Etappenstriche zur Orientierung);
  das Fenster wird über die ganze Breite gespreizt (km-Skala feiner), Band verschiebbar, Klick auf die
  Übersicht zentriert, Doppelklick oder Knopf **«Ganze Fahrt»** stellt alles wieder her – nur zur
  Bearbeitung, nicht gespeichert (Panel und Druck zeigen die ganze Fahrt). Oben **«Speichern und
  schliessen»** / **«Schliessen ohne Speichern»** (stellt Profil, Etappen, Zeitbasis und Etappen-Planungen
  vom Öffnen wieder her; ✕ und Escape = speichern, 0.12.6).
  Die **Legende** (erste Zeile: Bedienhinweis) ist einklappbar und wird im Briefingdruck immer gedruckt.
  Darunter die **Etappenübersicht** (Zeit, km, Höhenband, Ort, Land/FIR, Lufträume, Achtung, Kontakte:
  FIS-Sektoren aus openAIP entlang der Etappe, sonst die FIS-Kontakte je Land aus den Einstellungen; in der
  Briefingsicht stehen Lufträume, Achtung und Kontakte seit 0.12.9 als zweite Zeile je Etappe) und die
  **Schätzung Ballastverbrauch** (Manöver, Level-Out, Temperatur, Adiabatik; Balken gegen den Vorrat aus A3)
  mit dem einklappbaren Block **«Modell der Schätzung»** (Parameter und Bedeutung der Spalten; im
  Briefingdruck nur, wenn aufgeklappt). Im NOTAM-Panel («Umkreis um Orte») übernimmt «Orte aus Etappen» die
  Etappenmitten.
* **Ops-Briefing je Etappe** (0.12.5, nur Gasballon) — jede Etappe des Fahrtprofils kann eine eigene
  Meteo-, Luftraum- und NOTAM-Planung tragen. Die Planung der **Startetappe** sind die Abschnitte **B und C**
  des Briefings (Startort). Mit nur einer Etappe gilt sie für die ganze Fahrt; **sobald weitere Etappen
  bestehen, ist sie auf den Bereich der Startetappe beschränkt** (0.12.7: Dauer, Höhenband, Luftraum und
  NOTAM entlang des Abschnitts bis zur zweiten Etappe; Temps zur Startzeit; Startort, Landeraum und alle
  übrigen Panels unverändert; Unterzeile «Etappe 1 bis km …») – und die einzige Vorgabe-Etappe «Enroute»
  wird beim Anlegen einer weiteren Etappe in **«Start»** umbenannt. Jede weitere Etappe mit Planung bekommt zwischen C und D
  einen eigenen Abschnitt **«E‹n› · Etappe n · Name»** mit Zeitfenster und Ort: Meteo-Panels (METAR/TAF,
  Temps zur Etappenmitte, Beobachtungen, Flugwetterprognose DE, Wind, Ballonprognose, SIGWX, Thermik,
  Meteogramm) zur **Mitte der Etappe** im **Zeitfenster der Etappe**, Luftraum entlang des Etappenabschnitts der
  Bahn, NOTAM in überlappenden Kreisen entlang des Abschnitts, DABS nur, wenn der Abschnitt die Schweiz berührt,
  je Abschnitt «Bemerkungen». Schalten: Klickbox **«Ops-Briefing für Etappe»** im Etappenmenü (≡) des
  Werkzeugs und im Dialog beim Anlegen einer Etappe (Klick auf die Zeitzeile: Name + Klickbox); Etappen mit
  Planung tragen die Marke **B/C** hinter dem Namen (Grafik, Etappenübersicht, Legende). **Mindestens eine
  Etappe** je Briefing hat eine Planung (Vorgabe Startetappe): die Klickbox der letzten Planung ist gesperrt;
  ist die Startetappe ausgeschaltet, fehlen in B/C die orts-/zeitgebundenen Panels (Hinweis), Flugplan,
  Absprachen, Übergangshöhe und Bemerkungen bleiben. Vorgabe-Etappen: ab 10 h Fahrtdauer Start / Enroute /
  Landung, darunter eine Etappe «Enroute». Etappen-Briefings zählen bei Vollständigkeit, Pflichtinhalten
  («Pflichtinhalte ergänzen», Freigabe-Checkliste), «Alle verfügbaren Daten aktualisieren», Navigation,
  KI-Kommentar (mit Etappenkontext) und Druck (eigene Abschnitte, DABS-Beilagen mit Etappen-Kennung) mit.
  Verschobene Etappen: Hinweis «Etappe seit dem Abruf verschoben – Daten aktualisieren». **Gliederung
  (0.12.6):** mit Etappen-Briefings zeigt die Erarbeitungssicht Etappenköpfe «E1 · Etappe 1 · ‹Start›»
  (= Abschnitte B/C des Hauptbriefings) und «E‹n› · …» mit B/C als Untertiteln; die Navigation links
  gruppiert entsprechend (A · E1 (B, C) · E‹n› (B, C) · D), und neben «Alle verfügbaren Daten
  aktualisieren» springen Etappen-Knöpfe (E1 · Start, E3 · Nacht …) zum Etappenkopf. **Nummern mit Etappe
  (0.12.7):** sobald Etappen-Briefings bestehen, tragen die Panels der Abschnitte B/C die Etappe in der
  Nummer – «E1-B2», «E3-C3» – in Navigation, Panelköpfen und Briefingsicht (dort mit Etappenkopf E1); A und
  D bleiben «A1», «D2». Daten:
  `b.profile.stages[].ops`, `b.stagePlans[stageId].panels` (+ Ortsnamen, Abrufeinstellungen);
  abgeleitete Sicht `stagePlanBriefing()` in `js/calc/stageplan.js`.

### Automatische Panels (Phase 2)

Über Abschnitt B steht die **Modell-Leiste**: Modellwahl (ICON-D2 2 km bis 48 h,
ARPEGE, ICON-EU, ECMWF IFS, UKMO, ICON global, GFS, Auto) mit Vorschlag je
Planungshorizont, **Alle aktualisieren** und der Stand der letzten Aktualisierung.
Beim ersten Öffnen eines Briefings laden sich alle automatischen Panels von
selbst (Modell-Panels sofort; DABS, Karten und NOTAM — soweit freigeschaltet —
kurz danach). **0.12.8:** Schnappschüsse, die den gegenwärtigen Stand wiedergeben (METAR/TAF,
Beobachtungen, SIGMET, NOTAM, Allgemeine Lage, DABS, Radar/Webcams), tragen bei einem Start, der mehr als 6 h entfernt liegt,
ein Warnsymbol ⚠ («Info gibt gegenwärtigen Stand wieder, muss auf den Startzeitpunkt hin
aktualisiert werden»); Modelldaten zum Startzeitpunkt nicht. **0.12.10:** das Warndreieck steht rot in der
Titelzeile des Panels (Erarbeitung und Briefingsicht) und gilt zusätzlich für die Ballonprognose (DWD-Vorhersagetag der
Fahrt fehlt) und die Druckdifferenzprognose (Reihen reichen nicht bis zur Landung). TAF-Änderungsgruppen, deren
Zeitraum die Fahrt berührt, tragen einen feinen Rahmen (Rohtext und Klartext). Bei **METAR/TAF** und **NOTAM** blendet ein ✕
rechts in der Kopfzeile einer Station/Meldung diese ohne Rückfrage aus (`content.hidden`; gilt auch in der
Briefingsicht, Zähler «n ausgeblendet»); «Aktualisieren» fragt dann «Alle Meldungen aktualisieren» oder
«Selektion beim Aktualisieren beibehalten». NOTAM mit Lage (Koordinaten/Radius aus den Feldern oder aus dem
Text «… 0.54NM RADIUS CENTERED ON 491158N 0123224E») haben links vom ✕ einen Karten-Knopf: Kartenfenster
mit Kreis/Punkt des NOTAM, dem geplanten Fahrtweg (Profilbahn, sonst Trajektorien), Startort und Landeraum.
«Schnappschuss entfernen» fragt im Dialog der Anwendung nach (statt Browser-Meldung). Im Radar-Panel heissen
die Ebenen «Regen», «Webcams», «Wettersonden». Bei Gasfahrten mit Etappen-Briefings steht die **Allgemeine
Lage** (ganze Fahrt) unter «B · Ganze Fahrt» vor der Startetappe E1 (Nummer B1 ohne Etappe).

| Panel | Inhalt | Quelle |
|---|---|---|
| Allgemeine Lage | Schnappschüsse amtlicher Karten (DWD-Bodenanalysen, ECMWF Bodendruck/Wind 850 hPa zur Startzeit und +24 h; Liste in Einstellungen → Meteo) **und** die Grosswetteranalyse des nationalen Dienstes als Text für das Land des Startorts/Landeraums (DWD Synoptische Übersicht Kurz-/Mittelfrist und ORF/GeoSphere Austria geprüft; MeteoSchweiz und Aeronautica Militare liefern nur per JavaScript → als Link; weitere Seiten mit CSS-Selektor konfigurierbar, Haken «abrufen») | DWD, ECMWF Open Charts (CC-BY-4.0), nationale Dienste; über Worker (`/api/wx/snapshot`, `/api/wx/wxtext`) |
| METAR/TAF | alle Plätze im Umkreis (direkt im Panel einstellbar, Standard 150 km); Richtungspfeil vom Startort zum Platz; Schlechtwetter rot (Wind/Böen ≥ 14 kt, Sicht < 5 km, Niederschlag/Nebel/Gewitter, Basis ≤ 1500 ft, CB/TCU); je Platz **Rohmeldung und Klartext nebeneinander** (DE/EN: Wind, Sicht, Wetter, Wolken, T/Td, QNH, Trend; TAF mit BECMG/TEMPO/PROB/FM-Gruppen und Gültigkeit); Alter «(vor 0:30 h)» bezogen auf die Publikation des Briefings (Final), sonst auf jetzt | aviationweather.gov über Worker; Rückfall GaforCast-Kopie |
| Temps | Stüve-Diagramm des Modellprofils zur Startzeit (T, Td, Feuchteschattierung blau ab RH 85 %, **Wolkenschichten rötlich ab RH 95 %**, Windfahnen, Grenzschicht, 0 °C), Inversionen; dazu die **letzte Radiosondierung** der nächsten Station (Payerne u. a.) als zweites Stüve mit Tabelle; **nächste Live-Radiosonde aus SondeHub** (Amateurempfang, letzte 12 h, Umkreis einstellbar, Standard 250 km) als drittes Stüve | Open-Meteo Druckflächen; Radiosonde über Worker `/api/wx/sounding` (Archiv University of Wyoming); SondeHub über `/api/wx/sondes`, `/api/wx/sonde`) |
| Beobachtungen (Wetterstationen) | 0.12.17: regionale Netze AT/IT/F. 0.12.15: automatisch beim Öffnen; übriges Europa über MeteoGate/E-SOH (EUMETNET, Flächenabfrage).  **Wetterstationen im Umkreis** des Startorts (Standard 75 km, im Panel einstellbar): SwissMetNet (MeteoSchweiz via api.existenz.ch), DWD (Bright Sky), **GeoSphere Austria** (TAWES 10-min), **Südtirol** (Landeswetterdienst Open Data, 10-min mit QNH), **Italien: Meteo-Hub** (Agenzia ItaliaMeteo, Beobachtungs-API ohne Anmeldung, CC BY 4.0 – regionale DPCN-Netze Piemonte, Lombardia, Veneto, Liguria, Toscana, Lazio, Campania, Puglia, Sicilia, Sardegna usw., Open-Trentino, ARPA FVG, Emilia-Romagna; Amateurnetz MeteoNetwork zusätzlich, kursiv gekennzeichnet, höchstens 30, verdrängt keine amtlichen Stationen), **Météo-France** (DPObs 6-min, nur mit Schlüssel `meteofrance_key` in den Zugängen), übriges Europa EUMETNET MeteoGate/E-SOH (3-km-Regel gegen Doppelnennungen; höchstens 80 Stationen); in Italien ohne Netz: Valle d'Aosta, Abruzzo; Tabelle Pfeil · km · Zeit · Wind/Böen (rot ab 14/20 kt) · T/Td · RH · QNH · Niederschlag · Sicht (0.12.17e, nur wo gemeldet, rot unter 5 km) | über Worker (`/api/wx/stations`) |
| Flugwetterprognose | 0.12.15: eingefügter CH-Bericht in der Briefingsicht gegliedert (Zwischentitel fett, Absätze zusammengeführt, Windtabellen Payerne/Zürich/Lugano nebeneinander), Gültigkeit aus dem Text → Aktualitätswarnung. **DE:** DWD Flugwetterübersicht des Bereichs + GAFOR-Einstufung des Gebiets (Punkt-in-Polygon). **CH:** MeteoSchweiz-Prognose einfügen (Pflicht) | DWD-Luftsportberichte (Kopie gafor.wicki.aero) |
| Windprognose | Windprofil Start–Landung stündlich (°/kt je Niveau), Profilgrafiken mit Höhenband-Marken; **Modellvergleich** zur Startzeit (bis zwei weitere Modellfamilien, Spannweite je Niveau) und **Ensemble-Spannweite** (ICON-D2/EU-EPS Bodenschicht, ECMWF ENS Druckflächen; p10/p50/p90, Richtung ± Streuung) (0.12.14) | Open-Meteo |
| Ballonprognose | **DE:** DWD-Gebietsvorhersage Ballonsport (Tabellen); immer: eigene Stundentabelle mit Ampel fahrbar/grenzwertig/nein und Begründung | DWD (Kopie), Open-Meteo |
| Druckdifferenz | Genève–Güttingen (Bise), Zürich–Lugano (Föhn) aus Modell-QNH, stündlich; Paare in Einstellungen | Open-Meteo |
| Trajektorien | **Spannweite** der Endpunkte je Niveau über die Vergleichsmodelle (0.12.14, gestrichelt auf der Karte); Bahnen je Niveau (SFC, «1000 AGL», «3000», «FL065»; Standard aus Fahrtabsicht), Dauer (Heissluft 2 h, Gas 24 h), Startversatz ±2 h; **Legende Farbe = Höhe**; Landeraum als grüner Punkt **verschiebbar** (setzt Landeraum und Zielrichtung); am Bildschirm die Karte (Basiskarte oder Satellit, Luftraum-Overlay; Knopf ▦ rechts oben blendet das Distanzraster-Skizze ein), im Druck die Nord-oben-Skizze; Tabelle mit Stundenmarken, Endpunkt als ICAO + Maps-Link | eigene Rechnung aus dem Modellwind (Punktprognose, linear zwischen Stunden und Niveaus) |
| SIGWX | 0.12.15: Gültigkeit aus dem Kartentitel (KI) oder von Hand → Aktualitätswarnung. Einfügefeld für die SIGWX-low-Alps-Karte aus skybriefing (0.12.13: ohne Automatik) | skybriefing |
| Warnungen | SIGMET/AIRMET im Umkreis automatisch (z. B. TURB SEV), je Meldung ✕ und Karte (Polygon, Fahrtweg); **amtliche Warnungen automatisch** (0.12.14): CH MeteoSchweiz (App-Schnittstelle, PLZ aus Nominatim), DE DWD-WFS Warnungen_Gemeinden – Startort, Landeraum, Bahn-Endpunkte, Stufe/Gültigkeit/Text, ✕; weitere Warnungen einfügen | aviationweather.gov, app-prod-ws.meteoswiss-app.ch, maps.dwd.de über Worker `/api/wx/warnings` |
| Thermik | eigene Abschätzung aus dem Modell: Globalstrahlung × Bowen-Faktor → Wärmestrom, mit Grenzschichthöhe zur konvektiven Geschwindigkeitsskala w* (Deardorff); je Stunde Klasse keine/schwach/mässig/kräftig/stark (Grenzen unter Einstellungen → Experte), Einsetzen, Maximum, Abschwächen, Fahrtfenster; Tabelle links, Balken rechts | Open-Meteo |
| Meteogramm | Grafik über Start −6 h … Landung +6 h mit beschrifteten Bändern (0.12.14: zusätzlich Sicht/Nebelrisiko, Grenzschichthöhe und bei Gasfahrten die 0 °C-Grenze; Temperatur/Taupunkt mit Extremwerten, Wind/Böen kt mit Fahnen, Bewölkung hoch/mittel/tief, Niederschlag mm/h + CAPE), Zeitachse LT mit Tageswechsel, Start-/Landemarke, Nacht- und Fahrtfenster-Schattierung, Ampelstreifen und Legende; dazu Stundentabelle mit Nebelrisiko und Wolkenbasis | Open-Meteo |
| Radar | Live-Radar (RainViewer) auf der Karte (weit genug für die Niederschlagsgebiete), Startort und Landeraum markiert, **Webcams im Umkreis automatisch aus öffentlichen Quellen** (europaweit: Windy Webcams API mit Schlüssel, OpenStreetMap ohne; Umkreis in Einstellungen → Meteo, Standard 40 km um Start und Landeraum) plus eigene Liste, als Kamera-Symbol mit Popup (Vorschaubild, Link) und aufklappbarer Liste; Klickboxen Regen/Webcams/Sonden; **Klick auf eine Sonde** verkleinert die Karte und öffnet daneben Emagramm + Daten der Sonde; Links Windy/MeteoSchweiz/Blitzortung/Sat24 — nur am Bildschirm | RainViewer, Windy, OSM/Overpass; über Worker (`/api/wx/webcams`) |
| Lufträume | **Luftraumanalyse** aus openAIP für die berechneten Trajektorien: je Luftraum *durchfahren* (Bahn innerhalb, Untergrenze unter der geplanten Maximalhöhe; km ab Start, ETA je Bahn), *nahe* (im Korridor, Standard 5 km, Einstellungen → Meteo) oder *oberhalb der Maximalhöhe* (eingeklappt); Typ (CTR, TMA, TMZ, RMZ, R/D/P, TRA/TSA, ATZ …), ICAO-Klasse, Unter-/Obergrenze, Zusatzcodes (NOTAM/REQ/AGRMT, Squawk, Frequenz); reine Klasse-E/G-Lufträume werden nicht gelistet; **Warnungen** Startort in CTR/ATZ und TMA/CTA tiefer als 900 ft über dem Startort (Experte); **FIR-Folge** als Tabelle (0.12.13: Niveau, FIR, ab km, ETA, nach Start); Liste mit Spalten ETA und km ab Start, ✕ je Zeile blendet einen Luftraum aus (beim Aktualisieren Rückfrage wie bei NOTAM); Karte mit Polygonen und Bahnen (Bildschirm), Nord-oben-Skizze (Druck). Braucht die Trajektorien (werden sonst mitberechnet) und den openAIP-Schlüssel («Zugänge: openaip» oder der Kachel-Schlüssel der Overlay-URL) | openAIP Core API über Worker `/api/wx/airspace` (6 h Cache je Ausschnitt) |
| DABS | nur sichtbar und Pflicht, wenn die Fahrt die Schweiz berührt (Startort/Landeraum in CH, FIR-Folge oder Bahn über der Schweiz – Umriss, kein Rechteck, 0.12.4); DABS-PDF (heute/morgen) automatisch holen; Seiten im kleinen Viewer mit Blättern (‹ ›, Pfeiltasten, Link zum PDF), im Druck alle Seiten bzw. als Beilage | skybriefing über Worker, R2 |
| NOTAM | **FAA NMS** (Abrufdatei des Workflows, wenn ≤ 3 h alt) → **autorouter** (wenn «autorouter Nutzer/Kennwort» hinterlegt; NOTAM je FIR der Fahrt – Startort, Landeraum, Lufträume – auf den Umkreis gefiltert) oder **FAA NMS API** (ab 0.14.1 über die GitHub Action `fetch-notam.yml` alle 30 min nach `data/notam/<key>.json`, Secrets `FAA_CLIENT_ID/FAA_CLIENT_SECRET`; der Worker liest die Dateien – die Google-Cloud-Sperrliste weist Cloudflare Workers mit 403 ab (FAA NAIMES, 19.10.2026); Punkte = Startort, Landeraum, Bahn-Endpunkte und NOTAM-Orte der Briefings der nächsten 7 Tage plus alle zuletzt abgefragten Kreise (Tabelle `notam_points`); frische Datei (≤ 3 h) zuerst, sonst autorouter, zuletzt die veraltete Datei mit Hinweis; `src=faa&diag=1` zeigt die Erreichbarkeit aus dem Worker); **ohne Zugang** (0.12.4) zuerst **FAA DINS** (`notams.faa.gov`, FIR-NOTAMs der beteiligten Länder, Umkreis aus der Q-Zeile) und dann **FAA NOTAM Search** (`notams.aim.faa.gov`, Umkreis um Breite/Länge) – beide ohne Schlüssel, inoffiziell, 15 min Cache; wahlweise **Strecke** (Startort → Landeraum → Trajektorien-Endpunkte, Radius einstellbar) oder **Umkreis um Orte** (Ortswahl, Standard Startort, Radius 200 km); **VFR-Filter** (zeitlich, untere Grenze unter Höhenband + 2000 ft, keine reinen IFR-/Infrastruktur-NOTAM); übrige einklappbar | autorouter NOTAM API (`api.autorouter.aero`, OAuth2 mit E-Mail/Kennwort, API-Freischaltung per Support-Ticket) · FAA NOTAM API (Zugänge in Einstellungen → Zugänge) |

**KI-Hinweis:** Knopf im Panel öffnet den Prompt (Fahrtkontext + Panel-Inhalt +
Bilder, ohne Pax-Namen) zur Kontrolle, sendet ihn über den Worker an die
Anthropic-API (Modell in Einstellungen → Meteo) und legt 2–5 Zeilen als
editierbaren Hinweis ab (gelb markiert, im Druck «KI-Hinweis»). Keine
Startempfehlung.

Die **Ampel** (fahrbar/grenzwertig/nein) bewertet Modellstunden gegen die Grenzen
in Einstellungen → Meteo (Bodenwind, Böen, Böigkeit, Niederschlag, CAPE, Sicht,
Wolkenbasis, bürgerliche Dämmerung). Sie ersetzt keine Beratung — sie zeigt,
welche Stunden man anschauen muss.

### Länder-Matrix (0.11.1)

Einstellungen → Experte → **Länder-Matrix**: je Land (CH, LI, DE, AT, FR, IT, übrige) stehen
amtliches Flugwetter und Zugang, Modell, Luftraum/NOTAM, DABS-Pflicht, Sonnenquelle, Flugplan,
Kontakte und die Pflichtpunkte je Rolle der Fahrt (Start, Überflug, Landung); eigene Notizen je
Land bleiben gespeichert. Die Stammdaten zeigen «Länder (Rolle)». Für deutsche Startorte
übernimmt A2 die Dämmerungszeiten aus dem DWD-Ballonwetterbericht des Gebiets, sobald die
Ballonprognose geladen ist.

### Ordnungsnummer, Fortschritt, Sperre (0.11)

Jedes Briefing erhält beim ersten Speichern eine **Ordnungsnummer `JJJJ-NNN`**
(Jahr des Fahrtdatums, laufende Nummer je Jahr, z. B. `2026-017`); sie wird im
Server-Modus zentral vergeben (eindeutig über alle Nutzer), im lokalen Modus im
Browser. Sie steht in der Liste, in den Stammdaten, in der Kopfzeile und auf allen
Ausdrucken rechtsbündig als Titelzeile `Fahrtbriefing · 2026-017 · HB-QWZ · Start:
Di 06.10.2026, 06:30 – Oberlunkhofen AG`, darunter `Letzte Änderung: Datum Zeit ·
Bearbeiter`. Dateinamen (PDF, JSON, ICS, FPL) beginnen mit der Nummer:
`2026-017_Fahrtbriefing_HB-QWZ_2026-10-06[_final-v1].pdf`. Bestehende Briefings
werden beim ersten Aufruf nach dem Update nach Startzeit durchnummeriert.

Die Liste zeigt als Status **«in Arbeit NN %»** (Anteil gefüllter Panels) oder
**«Final vN»**. Liegt die Fahrt zurück (Start + max. 6 h / Fahrtdauer + 2 h), ist das
Briefing **gesperrt** (🔒 in der Liste): Erarbeitung und Wizard leiten auf die
Briefingsicht um, dort steht der Hinweis mit **«Kopieren und neu anlegen»** (neue
Nummer, Datum eine Woche später, Panels leer). Das alte Briefing bleibt unverändert.

**Freigeben als Final** prüft die Pflicht-Panels (Einstellungen → Panels & Pflicht);
fehlt etwas, kann mit Begründung trotzdem freigegeben werden (Protokoll). Jede
Freigabe wird als Final v1, v2 … mit Schnappschuss abgelegt.

### Phase 3: Tendenz, Änderungen, Gesamteinschätzung, Pax-Karte, Crew, PDF, offline

* **Einschätzung/Modellsicht** rechts im Editor und oben in der Briefingsicht: fasst die
  Stundenampel des Meteogramms im Fahrtfenster und die Go/No-Go-Kriterien
  (Trockenfenster, Gewitterabstand/CAPE, Mittelwind, Böen; Einstellungen →
  Go/No-Go) zu unkritisch / marginal / kritisch (0.12.8; Stundenampel weiterhin fahrbar/marginal/nein) mit
  Gründen zusammen. Kein Startentscheid.
* **Seit Final vN geändert**: nach einer Freigabe zeigt die Seitenleiste, welche
  Stammdaten und Panels sich seither geändert haben (klickbar); die Briefingsicht
  markiert geänderte Panels, die Freigabe-Checkliste listet sie.
* **Mehr ▾** im Editor-Kopf: Pax-Sicherheitskarte, Crew-Nachricht & Kalender,
  Gesamteinschätzung (KI), Final-PDF, Briefing exportieren (JSON).
* **Gesamteinschätzung (KI)**: Prompt aus allen Panels (automatische Daten, Texte,
  KI-Hinweise, Kommentare) – 6–10 Zeilen mit Tendenz, editierbar, erscheint oben
  in der Briefingsicht.
* **Pax-Sicherheitskarte** (`#/pax/<id>`, Leselink `…/p`): eine Seite für die
  Passagiere – Treffpunkt mit Maps-Link, Zeiten, Mitbringen (Liste in
  Einstellungen → Experte), Sicherheitspunkte, Kontakt. Druck A4.
* **Crew-Nachricht & Kalender**: Text mit Zeitplan und Maps-Links zum Kopieren,
  per WhatsApp/E-Mail (Adressen der beteiligten Personen), `.ics`-Termin von
  Abfahrt bis Rückkehr mit Erinnerung 12 h vorher.
* **Final-PDF**: auf dem Server (Cloudflare Browser Rendering druckt die
  Briefingsicht nach R2; Zugänge `cf_account_id`/`cf_api_token`) oder ein mit
  «Als PDF sichern» erzeugtes PDF hochladen; Link in der Briefingsicht.
* **Export**: Einstellungen → Experte → alle Briefings + Einstellungen als JSON.
* **PWA / offline**: `sw.js` lädt die App-Hülle vor; zuletzt geöffnete Briefings
  und Dateien bleiben offline lesbar (Netz zuerst, Cache als Rückfall). Zum
  Startbildschirm hinzufügen (iPad/Handy) ergibt die App im Vollbild.
* **Luftraum-Overlay**: Kachel-URL (openAIP) in Einstellungen → Experte, wird auf
  Trajektorien- und Radarkarte gelegt.

### Briefingsicht und Druck

Das fertige Briefing wie im gedruckten Muster: Kopf (links Datum · Ort und Ballonzeile, rechts
Logo, Titelzeile, letzte Änderung, Status), Abschnitte A–D als zweispaltige Tabellen, eigener
Text/KI-Kommentar/Kommentar PIC unter dem Inhalt, Fuss mit Version und Hinweis. Am Bildschirm öffnet
ein Klick auf Grafiken, Bilder und Tabellen eine **vergrösserte Ansicht** (✕ oder Escape schliesst). **PDF / Drucken** nutzt den Browserdruck (A4 hoch; «Als PDF
sichern»). Bild-Schnappschüsse (DABS, Karten) stehen als **Beilagen** auf eigenen
Seiten nach dem Briefing; die Klickbox «Beilagen mitdrucken» in der Werkzeugleiste
schaltet sie für den Druck ab (am Bildschirm zeigt das Panel den Viewer). Die
Pax-Karte (A5 hoch, mit QR-Code des Treffpunkts) druckt auf A4 quer zwei Karten
nebeneinander zum Trennen. Auf dem Handy werden die Tabellen gestapelt.

### Flugplan (ICAO FPL)

Panel C «Flugplan»: Schalter «Flugplan erstellen?» (Vorschlag ja bei Grenzüberschreitung oder
Gasfahrt; bei NVFR fest ein und Pflicht), dann «Aus Briefing erzeugen». Der Datensatz folgt dem ICAO-Flugplanblatt
(Doc 4444): Kennung, Flugregeln V, Art des Flugs, ZZZZ/L, Ausrüstung, EOBT UTC, Geschwindigkeit,
Flugfläche aus der Maximalhöhe, Route `DRIFTING … FROM … TO … VIA …`, Gesamt-EET, ALTN ZZZZ,
Feld 18 (DEP/ DEST/ mit Kurzkoordinaten, DOF/, **EET/ je FIR aus der Luftraumanalyse**, TYP/,
ALTN/UNKNOWN, RMK/NVFR CREW CONTACT …) und Feld 19 (Autonomie, Personen, Notfunk,
Überlebensausrüstung, Westen, Rettungsinseln, Farbe aus dem Ballon, Bemerkungen, PIC). Jedes
Feld ist überschreibbar; die ICAO-Nachricht (Format des skybriefing-Imports: «Flightplan and
Briefing → Flight Plan import», Text einfügen → Import) kann kopiert oder als .txt geladen werden.
DEP/ und DEST/ behalten das Kantonskürzel als eigenes Wort («BUELACH ZH»).
Standardwerte unter Einstellungen → Flugplan. Trajektorien und Luftraum vorher laden, damit
Route und EET/ gefüllt sind.

### Berechtigungen (persönliche Links)

Je Briefing Personen mit Rolle **Mitarbeit** (alle Inhalte inkl. Pax-Namen ändern,
nicht löschen/freigeben/berechtigen) oder **Nur lesen** (Briefingsicht). Gültig bis
Fahrtdatum + 7 Tage (änderbar), widerrufbar, mit QR-Code (lokal erzeugt), WhatsApp-
und E-Mail-Weitergabe. Mitarbeit-Empfänger nennen beim ersten Öffnen ihren Namen;
Änderungen stehen mit Name/Zeit im Kopf und Protokoll. Nur im Server-Modus.

### Einstellungen

Jede Liste (Ballone, Hüllen, Körbe, Personen, Betreiber, Startplätze, Treffpunkte,
Übergangshöhen, Karten, Webcams, Wettertexte) hat ein **«+»** im Kartenkopf. Ballone
haben **Muster** (z. B. BB26E) und **Transponder-Hexcode**; Ballone und Personen tragen
**Dokumente** (Typ aus der Standardliste unter Experte, Bezeichnung, gültig bis, Datei
PDF/Bild – im Server-Modus in der Worker-Ablage R2, nicht in GitHub). Abgelaufene
Dokumente erscheinen mit ⚠ im Stammdaten-Panel.

Der Zurück-Knopf (←) in der Kopfzeile führt an die Stelle zurück, von der man in die
Einstellungen kam; «Speichern» füllt sich erst, wenn etwas geändert wurde.

Allgemein (Sprache, Thema, Name im Protokoll, Expertenmodus), Ballone (Heissluft-
Profile mit Tanks; Gas: Hüllen und Körbe getrennt; Standardkombination; je Ballon
Tracker-Links für die Passagierkarte, die Hüllenfarbe für den Flugplan und ein Bild der
Hülle – quadratischer Mittenausschnitt – das im Titel des Stammdaten-Panels, im Pax-Blatt und
im Wizard erscheint, im Druck 2 × 2 cm), Personen,
Lufttransportführer, Startplätze & Treffpunkte, Fahrtabsicht-Startwerte, Zeitplan,
Meteo & Auto-Panels (Ampel-Grenzen, Trajektorien-Dauer, Profilhöhe, METAR-Umkreis,
NOTAM-Radius, KI-Modell, Karten für «Allgemeine Lage»)
(Anhänger-Faktor, Zuschlag, Puffer, Bergezeit), Sonne/RAC 4-4 (PDF-Upload, siehe
unten), Übergangshöhen, Go/No-Go-Kriterien (Ampel ab Phase 3), Panels & Pflicht
(Tabelle je Abschnitt mit der Panel-Nummer wie im Briefing, ausblenden/Pflicht),
Freigabe-Links, Nutzer & Freigaben (Stamm-Freigaben; Supermaster: Nutzer
anlegen, Kennwort setzen, Freischaltungen, Stamm ansehen), Statistik (Supermaster),
Zugänge (API-Schlüssel und Logins, zentral, verschlüsselt; nur der Supermaster
ändert sie; das Auge zeigt die Eingabe im Klartext und lädt bei leerem Feld den
gespeicherten Wert nach — protokolliert), Experte (Kennwort ändern, Reserve-Regel, Aerostatik Gasballon, Achtung-Zeichen-Grenzen und Mindestabstand des Höhenprofils, FIS-Kontakte je Land (0.12.7: Deutschland nach DFS AIC VFR 01/26, Frankreich nach AIP France – Platzhalter für München Information und Italien bleiben) für die Etappenübersicht; Gashüllen zusätzlich Widerstandszahl WZ). *Export/Import JSON* sichert
die Einstellungen (ohne Zugänge).

---

## Rechenmodelle

* **Höhenprofil, Etappen und Ballast der Gasfahrt (0.12)** — Panel A «Fahrtprofil» (nur Gas).
  `js/calc/profile.js`: Punkte (km entlang der zusammengesetzten Bahn, m AMSL), Kopplung km ↔ Zeit ↔ Ort
  aus der Bahn, Teilstücke mit Steig-/Sinkrate, Reliefabstand, Etappen (nummeriert, verschiebbar,
  zusammenlegbar), Nachtanteil aus ECET/BCMT, Achtung-Zeichen (Wind, Scherung, CAPE, Nebel nahe Grund,
  Niederschlag, Vereisung) und das **Ballastmodell nach der Aerostatik** (`docs/Aerostatik_Gasballon.md`,
  Emden/DFSV-Handbuch 2.10, «Gone with the Wind» Kap. 4): Manöver WZ·v² (Abfangen × 1,3), Level-Out über
  der Prallhöhe 1 % je 80 m (Prallhöhe aus dem Füllungsgrad), Temperaturgesetz 0,4 % je K mit den
  Überhitzungen Tag/Nacht klar/bedeckt aus Einstellungen → Experten → Aerostatik, Adiabatik beim
  schnellen Steigen. `js/auto/profiledata.js` setzt die Bahn aus Wegpunkt-Prognosen zusammen (Luftpaket
  im Modellwind der jeweils geplanten Höhe, 10-min-Schritte; Wegpunkte alle 40 km, Modell mit
  ausreichendem Horizont), holt Relief (Open-Meteo Elevation über `/api/wx/elevation`), Stundenprofile
  (Decken RH ≥ 95 %, Inversionen und Isothermieschichten, Nullgradgrenze, Wind/Scherung), Sonnenereignisse entlang der Bahn
  (astronomisch am Bahnpunkt) und Lufträume (openAIP, durchfahren/nahe, HX-Status). Werkzeug und
  Darstellung in `js/ui/profile.js` (Skizze Stand 8: `docs/Hoehenprofil_Werkzeug_Skizze.html`,
  Entscheide in `docs/Konzept_0.12_Hoehenprofil.md`). Zeitzone einheitlich die des Briefings (LT/UTC).
* **Sonne/Dämmerung** — Schweiz: RAC 4-4 (VFR Manual, skyguide): BCMT, SR, SS, ECET
  in Lokalzeit, Referenz Sternwarte Bern, gültig für die FIR. Die mitgelieferte
  Tabelle (`data/rac/rac-ch.json`) deckt OCT 2026 – DEC 2027 ab; ein neues PDF wird
  in den Einstellungen hochgeladen und im Browser geparst (pdf.js). Ausserhalb der
  Schweiz und als Vergleich: astronomisch (NOAA-Verfahren, aus GaforCast).
  Mond: Auf-/Untergang, Phase, beleuchteter Anteil (Meeus, niedrige Genauigkeit).
* **Heissluft** — Excel-Modell «Tragkraft-, Massen- und Treibstoffberechnung» 1:1
  (ISA-Gradient ab Startplatz, barometrische Höhenformel ab QNH, Tragkraft/m³ =
  ρ·(T_H − T)/(273.15 + T_H), Tabelle je 100 m, Max. Steighöhe wie VLOOKUP − 100 m),
  erweitert um feuchte Luft (Magnus, optional), exakte Gleichgewichtshöhe,
  benötigte Hüllentemperatur, Treibstoffbedarf = (Dauer + Reserve) · Verbrauch mit
  Reserve = min(25 % · Dauer, 30 min) (einstellbar). **Zulässiges Startgewicht** =
  Tragkraft am Startplatz bei Hüllentemperatur, höchstens MTOM; Minder-/Mehrgewicht
  bezieht sich darauf (die massgebende Grenze wird genannt).
* **Gas** — Brutto-Auftrieb = V · Füllungsgrad · (ρ_Luft − ρ_Gasgemisch) mit Gasdichte aus p, T
  und Reinheit (Füllungsgrad je Briefing in A3, Vorgabe 100 %); Ballast = Brutto-Auftrieb − Nettomasse; Kennzahlen Abkühlung je K,
  Ballast je 100 m, Ballast-Einheiten, Landereserve. Ein Excel-Modus reproduziert
  die Vorlage v2 exakt (Tests).
* **Tagesplanung** — Zeilenliste mit Anker «Start»: vorwärts Zeit + Dauer,
  rückwärts nächste Zeit − eigene Dauer, Pins je Zeile, Rundung auf 5 min
  (`buildPlan`); Hinweise bei BCMT/ECET-Konflikt und Rückfahrt nach SS.

`node test/calc.test.mjs` prüft diese Modelle gegen die Excel-Werte und die RAC-Tabelle.

---

## Woher die Daten kommen

| Was | Quelle | Weg |
|---|---|---|
| Ortssuche, Höhe, Zeitzone, Modellwerte T/QNH/RH | Open-Meteo (Geocoding, Elevation, Forecast) | direkt aus dem Browser |
| Ortsname/Land zum Kartenpunkt | Nominatim / OpenStreetMap | direkt aus dem Browser |
| Fahrzeit | OSRM-Demo-Server (OpenStreetMap) | direkt aus dem Browser |
| Kartenkacheln | OpenStreetMap | direkt aus dem Browser |
| Sonne/Dämmerung CH | RAC 4-4 (skyguide) | `data/rac/rac-ch.json`, Upload in den Einstellungen |
| Briefings, Einstellungen, Links | eigener Worker (D1) | `js/config.js → apiBase` |
| Bilder | eigener Worker (R2) | unerratbare Dateischlüssel |

| Modellprognose (Stunden, Druckflächen) | Open-Meteo Forecast API | Server-Modus über Worker `/api/wx/om` (Kundenschlüssel, 15 min Cache); lokal direkt |
| METAR/TAF, SIGMET/AIRMET | NOAA aviationweather.gov | Worker `/api/wx/metar`, `/api/wx/sigmet` (10 min Cache); Rückfall `gafor.wicki.aero/data/dwd/metar.json` |
| DWD Luftsportberichte, Ballon-Gebietsvorhersagen, GAFOR-Gebiete, METAR-Kopie | DWD / NOAA, eigener Abruf durch die GitHub Action `fetch-dwd.yml` (3×/h) nach `data/dwd/`; Rückfall GaforCast-Kopie | Worker `/api/wx/dwd` oder direkt von der eigenen Origin |
| Amtliche Karten (Schnappschuss) | DWD Hobbymeteorologie, ECMWF Open Charts | Worker `/api/wx/snapshot` (Allowlist) → R2 |
| DABS | skybriefing `o/dabs?today|tomorrow` | Worker `/api/wx/dabs` → R2, Seiten mit pdf.js (vendored) gerendert |
| Lufträume | openAIP Core API (`api.core.openaip.net/api/airspaces?bbox=…`) | Worker `/api/wx/airspace` mit `openaip`-Schlüssel aus «Zugänge» (Rückfall: Kachel-Schlüssel aus der Overlay-URL), Analyse im Browser (`js/calc/airspace.js`) |
| Webcams | Windy Webcams API v3, OpenStreetMap/Overpass | Worker `/api/wx/webcams` (Schlüssel `windy_webcams` optional) |
| NOTAM | FAA NMS API (`api-nms.aim.faa.gov`, eigener Abruf durch die GitHub Action `fetch-notam.yml` (2×/h) nach `data/notam/`, Secrets `FAA_CLIENT_ID/FAA_CLIENT_SECRET`) · autorouter NOTAM API (`api.autorouter.aero`, FIR-Kennungen je Land im Worker) · ohne Zugang: FAA DINS (`notams.faa.gov/dinsQueryWeb`) und FAA NOTAM Search (`notams.aim.faa.gov/notamSearch`) | Worker `/api/wx/notam`: Abrufdatei von der eigenen Origin, sonst `autorouter_user/pass` aus «Zugänge», sonst die schlüssellosen Quellen; `/api/handover/notam-points` liefert dem Workflow die Punkte |
| KI-Hinweis | Anthropic API | Worker `/api/wx/ai` mit `anthropic`-Schlüssel aus «Zugänge» |
| Radar | RainViewer public API | direkt aus dem Browser (nur Bildschirm) |

Alle `/api/wx/*`-Aufrufe brauchen die Owner-Sitzung oder einen gültigen
persönlichen Link (`?t=`); DABS, Schnappschuss und KI zusätzlich Mitarbeit-Rolle.
Nicht automatisiert (bewusst, siehe Konzept 5.7): pc_met und skybriefing-Produkte
hinter Login — Deep-Link + Einfügen.

---

## Betrieb

* **Frontend:** GitHub Pages aus `main` (Root). `CNAME` = `ops.wicki.aero`.
* **Worker:** `worker/` (wrangler). Deployment automatisch über die GitHub Action
  `deploy-worker.yml` bei Änderungen unter `worker/` — Einrichtung in **SETUP.md**.
* **Konfiguration:** `js/config.js` enthält die Worker-Adresse (`apiBase`).
* **Sicherung:** `GET /api/export` (mit Sitzung) liefert alle Briefings und
  Einstellungen als JSON; Export-Knopf in der App folgt in Phase 3.
* **RAC-Tabelle:** jährlich das neue RAC-4-4-PDF in den Einstellungen hochladen.

## Versionierung

`js/version.js` ist die eine Stelle für die Versionsnummer (Semantic Versioning);
`sw.js` liest den Cache-Namen von dort (neue Version = neuer Cache). Beim Release
zusätzlich `CHANGELOG.md` nachführen.

## Dateien

```
index.html                 App-Hülle (Kennwortseite, Kopfzeile, Ansichten)
css/base.css               Token-Satz und Komponenten (GaforCast-Familie)
css/app.css                Layout, Ablauf, Editor, Briefingsicht, Handy/iPad
css/print.css              Druck A4
js/config.js               Worker-Adresse
js/app.js                  Kennwortseite, Menü, Routing
js/store.js                Datenhaltung: Worker (remote) oder localStorage (lokal)
js/model.js                Briefing-Datensatz, abgeleitete Grössen
js/defaults.js             Standard-Einstellungen und Stammdaten
js/panels.js               Panel-Register A–D
js/i18n.js                 Oberflächentexte DE/EN
js/net.js                  Open-Meteo, Nominatim, OSRM
js/calc/*.js               Sonne/Mond, RAC-Parser, Aerostatik, Zeitplan, Geo, Zeit, Flugplan (fpl.js), Höhenprofil/Etappen/Ballast (profile.js), Ops-Briefing je Etappe (stageplan.js)
js/ui/*.js                 Liste, Ablauf, Erarbeitung, Briefingsicht, Einstellungen, Links, Flugplan-Panel (fplpanel.js), Höhenprofil-Werkzeug (profile.js, Beispiel profile_sample.js)
js/vendor/                 Leaflet (BSD-2), qrcode-generator (MIT)
data/rac/rac-ch.json       RAC 4-4 OCT 2026 – DEC 2027
worker/                    Cloudflare Worker (src/index.js, schema.sql, wrangler.toml)
test/                      Rechentests (node, inkl. Trajektorien/Ampel/NOTAM-Filter), Oberflächen-Durchläufe (Playwright, Open-Meteo synthetisch über test/om_fixture.py)
js/auto/                   Open-Meteo, Trajektorien, Grafiken (Stüve, Wind, Meteogramm), Datenbeschaffung, KI-Prompt, Profildaten der Gasfahrt (profiledata.js)
js/ui/autopanels.js, autorender.js  automatische Panels (Erarbeitung) und ihre Darstellung (beide Sichten)
worker/src/wx.js           Datenabrufe im Worker (/api/wx/*)
worker/src/trajectory.js   Ist-Trajektorie aus analyze.wicki.aero (Übergabe-API, Tabelle trajectories, GeoJSON in R2); js/calc/actual.js (Soll/Ist), js/ui/actual.js (Abschnitt F)
```

## Lizenz

Alle Rechte vorbehalten; Quelltext zur Einsicht veröffentlicht. Jede Nutzung
über das Lesen hinaus nur mit vorheriger ausdrücklicher Zustimmung von
Balthasar Wicki / Wicki Aero GmbH und mit Quellenangabe — siehe `LICENSE`
(DE/EN). Drittkomponenten: Leaflet (BSD-2-Clause), qrcode-generator (MIT),
pdf.js (Apache-2.0, `js/vendor/pdfjs`). Logo und Name
«Wicki Partners Ballonteam» sind nicht Teil der Lizenz.


## Sitzung und Protokoll (0.12.16)

* **Leerlaufsperre:** 2 h ohne Aktivität → Anmeldeseite (Client im Minutentakt und auf dem Server je Sitzung; `sessions`-Tabelle, 30 Tage Höchstdauer). «Abmelden» beendet die Sitzung auf dem Server.
* **Aktivitätsprotokoll:** Einstellungen → Statistik (nur Supermaster): alle protokollierten Aktionen aller Nutzer mit Filter und CSV (`GET /api/admin/log`). Die Tabelle `usage` wächst mit; kürzen über D1 (z. B. `DELETE FROM usage WHERE ts < …`).

## Betriebsdokumente (0.13.0, Stufe 0 des Konzepts ops.wicki.aero)

| Dokument | Route | Inhalt |
|---|---|---|
| Passagierliste und Beförderungsschein | `#/bs/<id>` (Links: `#/s/<token>/bs`, `#/m/<token>/<id>/bs`) | Vorlage BHB ANH 511 v7, DE/EN nach Briefingsprache, 2 Seiten; vorausgefüllt aus Briefing und Stammdaten; Entgelt nur bei gewerblicher Fahrt (Panel «Fahrt») |
| Flugauftrag / Operator Flight Assignment | `#/fa/<id>` | 1 Seite nach Entwurf 12.10.2026: Fahrt, Ballon (Registerdaten), Besatzung (Lizenz/Medical aus Personendokumenten), Pax, Rahmenbedingungen, Erteilung/Annahme |

Digitale Unterschrift: Unterschriftenbild je Nutzer (Einstellungen → Allgemein), Knöpfe «Als Betreiber/PIC signieren» setzen Bild, Name und Zeitstempel UTC (gespeichert in `b.docs`). PDF über `data('pdf', { b, doc: 'bs'|'fa' })` (Browser Rendering), Ablage in R2. Abgelaufenes Medical eines PIC → Nachfrage beim Login.

## Ist-Trajektorie aus analyze.wicki.aero (0.14.0, Konzept Fahrtdaten/Debriefing 3.1 und 4.1)

Nach der Fahrt übergibt **analyze.wicki.aero** (Bericht → Spezialfunktionen → «Track übergeben», Ballonteam-PIN oder
Supermaster) die ausgewertete Fahrt an ein Briefing: die Trajektorie als GeoJSON (ausgedünnt auf ~30 s), Kennzahlen
(Start/Landung mit Ort, Dauer, Strecke, Höhe, Steigen/Sinken, Fahrt, Nacht), Stammdaten des Berichts, den Viewer-Link und
den Verweis auf das Ereignislog – keine Fotos. Die beiden Worker kennen ein gemeinsames **Dienst-Token**
(Secret `OPS_HANDOVER_TOKEN` in beiden Repositories; der Browser sieht es nie). Das Briefing wählt man in analyze aus der
Liste der letzten 20 Briefings; eine zweite Übergabe ersetzt die erste.

| Was | Wo |
|---|---|
| Ablage | D1-Tabelle `trajectories` (Zusammenfassung, je Briefing eine Zeile), GeoJSON in R2 unter `<briefing>/trajectory.geojson`; die Briefing-JSON bleibt unverändert (kein Revisionskonflikt, keine Archivsperre) |
| API (Dienst-Token, Header `X-Handover-Token`) | `GET /api/handover/briefings?limit=20` (jüngste zuerst, mit Stand einer vorhandenen Trajektorie) · `PUT /api/handover/briefings/<id>/trajectory` (Paket ≤ 4 MB, ≤ 20 000 Punkte) |
| API (Sitzung) | `GET /api/briefings/<id>/trajectory` (Eigner, Supermaster, Materialeigner) · `DELETE …/trajectory` (Eigner, Supermaster); Links `?t=<Zugangslink>` bzw. `?mt=<Material-Link>` lesen bis 3 Monate nach dem Fahrtende (Konzept 4.4) |
| Übersicht | Tag «Ist ✓» in der Statusspalte (Datum als Tooltip) |
| Briefingsicht | Abschnitt **F · Ist-Trajektorie**: F1 Fahrt (Kennzahlen, Link «in analyze öffnen», Übergabedatum; Eigner/Supermaster können die Trajektorie entfernen), F2 **Soll/Ist** je geplanter Bahn (Profilbahn, Niveaus aus B.traj): Querabweichung je volle Stunde (Soll-Position derselben Bahn zur gleichen Zeit, links/rechts), Endpunktabstand, Abstand zur Landezeit, Richtungsfehler (+ rechts), Abdeckung; beste Bahn markiert, Stundentabelle dazu. F3 Karte (Bildschirm: geplante Bahnen gestrichelt, Profilbahn braun, Ist schwarz mit Stundenpunkten, Start/Landung) und Nord-oben-Skizze im Druck |
| Protokoll | `trajectory` (Eigner des Briefings, n = Punkte) und `trajectory_delete` im Aktivitätsprotokoll |

Rechnung in `js/calc/actual.js` (rein, getestet): `actualPoints`, `plannedTracks`, `posAt`, `compareTrack`, `compareAll`.
