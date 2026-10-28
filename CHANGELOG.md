# Changelog

## 0.14.2 — 2026-10-28 · Luftraumanalyse: Abruffehler statt leerer Liste

* **Worker `/api/wx/airspace`:** Wies openAIP den Abruf ab (401/403/429/5xx), lieferte der Worker bisher still eine leere
  Liste – 6 h gecacht – und das Panel «Luftraum entlang des Fahrtwegs» meldete «kein Luftraum durchfahren». Jetzt: Fehler
  mit Grund (HTTP-Code, Hinweis auf Schlüssel/Sperre), nichts gecacht; der Rückfall auf die lat/lon-Reihenfolge der
  Bbox nur noch bei HTTP 400. Eine leere Antwort (0 Lufträume) trägt eine Warnung; das Panel wertet sie als Fehler,
  nicht als Analyse. Anlass: Befund aus s2ground (openAIP-Abruf aus einem Worker mit 403).
* Oberflächen-Durchlauf: Flugplan-Erwartung saisonfest (06:30 LT = 0430/0530 UTC).

## 0.14.1 — 2026-10-26 · FAA-NOTAM über GitHub Actions

* **Ursache der 403:** Die FAA-NMS-API läuft auf der Google Cloud Platform, deren Sperrliste die Ausgangsadressen von
  Cloudflare Workers abweist (FAA NAIMES, INC0033867, 19.10.2026) – von der FAA nicht zu ändern. Ein GitHub-Actions-Runner
  wird nicht abgewiesen (Probe 19.10.2026: 401 ohne Zugangsdaten).
* **Workflow `fetch-notam.yml`** (alle 30 min, `scripts/fetch-notam.mjs`): holt die Abfragepunkte vom Worker
  (`GET /api/handover/notam-points`, Dienst-Token `OPS_HANDOVER_TOKEN`), das FAA-Token (Repository-Secrets
  `FAA_CLIENT_ID`/`FAA_CLIENT_SECRET`) und je Punkt die NOTAMs (GEOJSON, normalisiert wie im Worker) nach
  `data/notam/<key>.json`; `index.json` mit Stand, Punkten und Fehlern; Dateien nicht mehr gefragter Punkte werden entfernt.
* **Punkte:** Startort, Bahn-Endpunkte, Landeraum (Radius aus den Einstellungen des Eigners) bzw. NOTAM-Orte mit eigenem
  Radius (Kreise > 100 NM wie in der App in sieben Kreise zerlegt) der Briefings der nächsten 7 Tage, dazu alles, was in
  den letzten 7 Tagen tatsächlich abgefragt wurde (neue Tabelle `notam_points`; jede NOTAM-Abfrage merkt ihren Kreis vor).
* **Worker `/api/wx/notam`:** liest zuerst die Abrufdatei (≤ 3 h alt → Quelle «FAA NMS API (Abruf GitHub hh:mm UTC)»,
  Stand im Panel), sonst autorouter wie bisher (mit Hinweis, dass die FAA-Fassung beim nächsten Lauf folgt), zuletzt die
  veraltete Datei mit Hinweis. `src=faa` erzwingt die Datei (424 mit Grund, wenn sie fehlt oder der Workflow nie lief).
* Zugänge: «FAA NMS Client Key/Secret» nur noch für die Diagnose; SETUP/README angepasst. Probe-Workflow und
  `data/faa-probe.txt` entfernt. Rechentests 303.

## 0.14.0 — 2026-10-20 · Ist-Trajektorie aus analyze.wicki.aero (Konzept Fahrtdaten/Debriefing 3.1, 4.1)

* **Übergabe-API** (Worker, Dienst-Token `OPS_HANDOVER_TOKEN`, Header `X-Handover-Token`): `GET /api/handover/briefings`
  (die letzten Briefings zur Auswahl in analyze) und `PUT /api/handover/briefings/<id>/trajectory` (Trajektorie als
  GeoJSON, Kennzahlen, Stammdaten, Viewer-Link, Ereignislog-Verweis). Ablage in der neuen Tabelle `trajectories` und in R2
  (`<briefing>/trajectory.geojson`); die Briefing-JSON bleibt unverändert. `GET/DELETE /api/briefings/<id>/trajectory`
  für Sitzungen (Eigner, Supermaster, Materialeigner lesen; Eigner/Supermaster löschen), Links `?t=`/`?mt=` lesen bis
  3 Monate nach dem Fahrtende. Briefing löschen entfernt die Trajektorie mit. Spalte `trajectoryAt` in den Listen.
* **Briefingsicht, Abschnitt F · Ist-Trajektorie:** Kennzahlen der Fahrt mit Link nach analyze; **Soll/Ist** je geplanter
  Bahn (Profilbahn, Niveaus aus B.traj): Querabweichung je volle Stunde mit Seite, Endpunktabstand, Abstand zur
  Landezeit, Richtungsfehler, Abdeckung – beste Bahn markiert, Stundentabelle; Karte (geplant gestrichelt, Ist schwarz
  mit Stundenpunkten) und Nord-oben-Skizze im Druck (`trajSvg` kennt jetzt Farbe/Breite/Strichelung je Bahn). Eigner
  und Supermaster können die Trajektorie entfernen.
* Übersicht: Tag «Ist ✓» in der Statusspalte. Deploy-Workflow setzt das Secret `OPS_HANDOVER_TOKEN`, wenn es im
  Repository hinterlegt ist. Rechenmodul `js/calc/actual.js` mit Tests (298); API-Test um die Übergabe erweitert.

## 0.13.0a — 2026-10-17

* Betriebsdokumente: Startort ohne «CH-» (Schweizer Formular), im Ausland mit Länderkürzel; digitale Signaturen werden im Aktivitätsprotokoll festgehalten (Aktion «Dokument signiert»).
* Umzug abgeschlossen: alle Verweise auf briefing.wicki.aero (SETUP, README, Setup-Skripte, Workflows, Demo, Konzepte, UA des DWD-Abrufs) auf ops.wicki.aero; alte Origin aus den erlaubten Worker-Origins entfernt. Kalender-UIDs (ICS) bleiben unverändert, damit bestehende Einträge erkannt werden.

## 0.13.0 — 2026-10-12 · Stufe 0: Beförderungsschein und Flugauftrag aus dem Briefing

* **Passagierliste und Beförderungsschein** (`#/bs/<id>`, Menü «Mehr» in der Briefingsicht): Vorlage BHB ANH 511 v7
  (28.12.2024), DE oder EN nach Briefingsprache, zwei Seiten (Seite 2 = AXA-Auszüge A–D unverändert). Vorausgefüllt:
  Datum, am/pm, Startort, Kennzeichen (HB-QWP/QWZ/QPJ/QWV angekreuzt, andere eingetragen), Luftfrachtführer, Entgelt
  (nur gewerblich), Art der Fahrt, Passagiere (Name; E-Mail aus der Personenliste, wenn erfasst), Ort/Datum, Unterschrift
  Pilot (digital), Fusszeile mit Briefingnummer/Final-Stand.
* **Flugauftrag / Operator Flight Assignment** (`#/fa/<id>`): Entwurf vom 12.10.2026 (Design-Fenster) umgesetzt –
  Betreiber, Datum/Start LT+UTC, Dauer und Landung, Startort mit ICAO-Koordinaten und Höhe, Landeraum mit Grenzübertritt
  (Länder der Fahrt), Art der Fahrt und Ballontyp, Entgelt; Ballon mit Registerdaten (Hersteller, Muster, S/N, Volumen,
  TCDS, ARC), Korb/Massen/MOPSC/MTOM/Hex; Besatzung mit Lizenz-Nr. und Medical-Gültigkeit aus den Personendokumenten
  («Lizenz …», «Medical»), Rückholer mit Telefon; Passagiere mit Insassenmasse; Fahrtabsicht (Höhenband, NVFR,
  Gasvorrat/Ballast), Wetter (Ampel, Wind/Böen, Gründe, Mindestbedingungen), Luftraum/NOTAM-Pflichten, Auflagen;
  Erteilung/Annahme mit digitalen Unterschriften Betreiber und PIC.
* **Digital signieren:** Einstellungen → Allgemein → «Unterschrift (Bild)» (gescannt, PNG/JPG, Ablage im Worker). In den
  Dokumenten «Als Betreiber signieren» / «Als PIC signieren» (Eigner, Server-Modus): Bild, Name und Zeitstempel UTC im
  Dokument und im Briefing gespeichert (`b.docs.bs/fa`).
* **PDF erzeugen:** über den bestehenden Weg (Cloudflare Browser Rendering, `pdf` mit `doc=bs|fa`), Ablage in R2
  (`…_Befoerderungsschein_…`, `…_Flugauftrag_…`), Link im Dokument.
* **Entgelt** (Panel «Fahrt», nur bei «gewerblich»): Betrag, Währung CHF/EUR, pro Fahrt/Person/unterschiedlich,
  Verrechnung durch/an Dritte, unentgeltlich (ganz / einzelne Pax).
* **Medical:** ist das Medical eines PIC (Personendokument «Medical») abgelaufen, fragt die App beim Login nach der neuen
  Gültigkeit; der Flugauftrag zeigt zudem einen Hinweis.
* Links mit Schreibrecht und Material-Links öffnen die Dokumente über `#/s/<token>/bs|fa` bzw. `#/m/<token>/<id>/bs|fa`.
* Smoke-Test: beide Dokumente (Seitenzahl, Inhalte).

## 0.12.17f — 2026-10-12 · Umzug auf ops.wicki.aero

* Website und Repository heissen neu **ops.wicki.aero** / `bwicki/ops` (Entscheid 12.10.2026, Konzept Flightportal Frage 8). Worker: erlaubte Origins um ops.wicki.aero erweitert (briefing.wicki.aero bleibt für Links in Umlauf), `APP_URL`/`DATA_BASE` (DWD-Daten) auf die neue Adresse; Links in README/Workflows. Konzept «ops.wicki.aero – Fahrtdaten, Debriefing» Fassung 2 (`docs/Konzept_Ops_Fahrtdaten_Debriefing.md`) mit den Entscheiden vom 12.10.2026 und dem Befund zu `gb_flight_data`. Die DWD-Zwischenablage (`data/dwd/`) wird vom Worker neu unter ops.wicki.aero gelesen.

## 0.12.17e — 2026-10-12 · B04: Sichtweite

* **B04:** Spalte «Sicht» (m/km, rot unter 5 km), erscheint nur, wenn mindestens eine Station im Umkreis Sichtweite meldet – derzeit Météo-France (6-min `vv`); Text-Fassung (Brief) ebenso.

## 0.12.17d — 2026-10-12 · Fahrtprofil: Link auf die O₂-Berechnung

* **Das Briefing merkt sich die Berechnung der O₂-Planung:** Bei der ersten Übergabe vergibt es den Kurzcode der Berechnung
  (`b.profile.o2.id`) und speichert ihn mit dem Briefing. Danach zeigt Panel A statt eines Knopfs zwei: **«O₂-Planung öffnen»**
  (öffnet die Berechnung unverändert) und **«Profil neu übergeben»** (ersetzt dort bewusst Fahrtprofil und Titel; Vorrat und
  Einstellungen bleiben – nach dem Nachführen im Flug also nur mit Absicht benützen).
* **Link-Zeile «O₂-Planung: o2.wicki.aero/#…»** unter der Grafik im Panel, in der Briefingsicht und im Druck.
* Die Kopie eines Briefings bekommt eine eigene O₂-Berechnung (Kurzcode wird nicht übernommen); Nachträge behalten ihn.
## 0.12.17c — 2026-10-12 · B04: Météo-France geprüft, MeteoNetwork

* **Météo-France** mit hinterlegtem Schlüssel live geprüft (Mülhausen 14, Annecy 13, Dijon 15 Stationen im Umkreis 60 km,
  6-min-Werte, ≤ 8 min alt): Felder t/td (K), u, dd, ff, fxi10 (Böen nur an einigen Stationen), pmer, rr_per bestätigt.
  Stationsnamen in Gross-/Kleinschreibung («Cran-Gevrier» statt «CRAN-GEVRIER»). `?diag=mf` liefert den Rohdatensatz der
  ersten Station (Fehlersuche).
* **Italien:** Amateurstationen des MeteoNetwork (Meteo-Hub, CC BY 4.0) zusätzlich, als «MeteoNetwork (Amateur)» kursiv und
  gedämpft dargestellt; höchstens 30 je Abruf, sie verdrängen keine amtlichen Stationen (Entscheid 12.10.2026).

## 0.12.17b — 2026-10-12 · Fahrtprofil: Übergabe an die O₂-Planung

* **Panel A «Fahrtprofil» (Gasfahrt):** neuer Knopf **O₂-Planung** neben «Werkzeug öffnen». Er öffnet die
  Sauerstoffplanung [o2.wicki.aero](https://o2.wicki.aero) in einem neuen Tab und übergibt das Höhenprofil als Höhenstufen
  (ft Druckhöhe aus m AMSL und dem QNH des Briefings, auf 100 ft gerundet) mit Dauer; Titel = Briefingnummer · Kennzeichen · Datum.
  Haltestrecken werden je eine Stufe, Steigen und Sinken je bis zu vier Teilstufen auf mittlerer Höhe – die Gesamtdauer bleibt
  erhalten, die O₂-Planung ergänzt deshalb keine eigenen Übergänge. Höchstens 24 Stufen (kürzeste Nachbarn werden zusammengefasst).
  Ohne aufbereitete Bahn kein Knopf. Das Profil steht im Anhang der Adresse (`#i.…`); die O₂-Planung legt daraus eine
  Berechnung an und speichert sie wie jede andere unter einem Kurzcode (Höhenstufen und Titel, sonst nichts aus dem Briefing).
* Rechenkern `o2Levels`/`o2Link` in `js/calc/profile.js`, Tests in `test/calc.test.mjs` und `test/ui.smoke.py`.

## 0.12.17a — 2026-10-12 · B04: ganz Italien über Meteo-Hub, Unteranfragen-Limit

* **B04 Italien:** **Meteo-Hub** (Agenzia ItaliaMeteo/CINECA, Beobachtungs-API der öffentlichen Karte, ohne Anmeldung, CC BY 4.0)
  liefert die regionalen Netze fast aller Regionen (DPCN Piemonte, Lombardia, Veneto, Liguria, Lazio, Campania, Puglia, Sicilia,
  Sardegna, Marche, Umbria, Calabria, Basilicata, Molise; Open-Trentino; SIR Toscana; ARPA FVG; Emilia-Romagna) – rund 2 600
  Stationen, 10–15-min-Werte, 11–56 min alt (gemessen 12.10.2026). Je Grösse ein Abruf (T, Richtung, Wind, Böen, RH,
  Niederschlag 1 h), Amateurnetz MeteoNetwork ausgeschlossen. **Ersetzt Meteotrentino (Stundenwerte) und ARPA Lombardia
  (Socrata, mehrere Stunden Verzug, 429).** Südtirol bleibt direkt (10-min, QNH), dort entfällt das Meteo-Hub-Duplikat. Ohne Netz: Valle d'Aosta, Abruzzo.
* **Limit von 50 Unteranfragen je Worker-Aufruf** wurde in Bozen überschritten («Too many subrequests»): Bright Sky nur noch für
  Rasterpunkte innerhalb Deutschlands und mit zwei Ringen (höchstens 13 statt 19 Abfragen); GeoSphere/Südtirol/Meteo-Hub
  brauchen zusammen ≤ 12.
* **Météo-France:** API-Schlüssel (JWT) in Kopfzeile `apikey`; alternativ die Application-ID des Portals → OAuth2-Token (50 min gecacht).
* MeteoGate-Namen ohne WMO-Zusatz («Milano / Linate (16080 0)» → «Milano / Linate»).
* **SwissMetNet:** vollständige Stationsliste (161 statt 100 eingebaute; neu u. a. Zürich/Fluntern, Zürich/Affoltern) von api.existenz.ch, täglich erneuert.

## 0.12.17 — 2026-10-11 · B04: regionale Stationsnetze Österreich, Italien, Frankreich

* **B04 Beobachtungen:** zusätzliche Quellen im Worker (`/api/wx/stations`), je nach Umkreis:
  **GeoSphere Austria** (TAWES, 10-min, CC BY; mehrere Zeitstempel je Antwort werden je Station aufgelöst),
  **Südtirol** (Landeswetterdienst Open Data, alle Stationen in einem Abruf), **Meteotrentino** (Stationsliste + Tageswerte
  der 12 nächsten Stationen, Stundenwerte), **ARPA Lombardia** (dati.lombardia.it/Socrata: Sensoren im Rechteck, Werte der
  letzten 2 h; gelegentlich 429 bei zu vielen Abfragen – dann Hinweis in der Fussnote), **Météo-France** (DPObs 6-min, nur
  mit API-Schlüssel `meteofrance_key` in den Zugängen – kostenloser Schlüssel vom Portail API; ohne Schlüssel entfällt F
  stillschweigend). Reihenfolge: SwissMetNet, DWD, regionale Netze, dann MeteoGate (3-km-Regel gegen Doppelnennungen);
  nur Werte jünger als 3 h; höchstens 80 nächste Stationen. Nicht angebunden: Piemonte (ARPA nur mit Token), Friuli
  (OSMER untersagt Weiterverbreitung innert 24 h), übrige italienische Regionen ohne offene Echtzeit-API.
* Hinweistexte (Panel, Fussnote, README) ergänzt; Zugang «Météo-France API-Schlüssel» in den Einstellungen.

## 0.12.16 — 2026-10-11 · Leerlaufsperre serverseitig, Aktivitätsprotokoll

* **Sperre nach 2 h ohne Aktivität – jetzt auch auf dem Server:** jede Anmeldung erhält eine Sitzung (Tabelle `sessions`,
  letzte Anfrage); ohne Anfrage seit mehr als 2 h ist die Sitzung beendet (401) und die App zeigt die Anmeldeseite mit
  Hinweis. Die App prüft zusätzlich im Minutentakt (lange Timer werden in Hintergrund-Tabs ausgesetzt) und reagiert auf
  jedes 401 mit der Anmeldeseite. «Abmelden» beendet die Sitzung auf dem Server. **Alle bestehenden Anmeldungen sind
  damit einmalig ungültig** – nach dem Update ist eine neue Anmeldung nötig.
* **Aktivitätsprotokoll (nur Supermaster):** Einstellungen → Statistik, Karte «Aktivitätsprotokoll»: alle protokollierten
  Aktionen aller Nutzer, neueste zuerst, Filter Nutzer / Aktion / ab Datum / Anzahl, CSV-Export. Neu protokolliert:
  Abmeldung, Briefing geöffnet (bei fremden Briefings mit Eigner), Einstellungen gespeichert, Zugang gesetzt/gelöscht,
  Link widerrufen, über Link gespeichert, Nutzer geändert, Export; bisher schon Anmeldung, Briefing angelegt/gespeichert,
  Freigabe, Nachtrag, Löschen/Ausblenden, Links, Datenabrufe, KI, PDF, Dateien, Stamm-Freigaben, Zugang angezeigt,
  Nutzer angelegt, Kennwort gesetzt. Worker `GET /api/admin/log?user=&kind=&from=&to=&limit=&format=csv`.
* Tests: API (Protokoll, Abmelden → 401), Remote-UI (Protokollkarte, Filter), Smoke, calc.

## 0.12.15a — 2026-10-11

* **B04:** keine Doppelnennungen – MeteoGate-Stationen der WMO-Blöcke CH (066xx–069xx) und DE (10xxx) entfallen, dort gelten SwissMetNet und DWD; übrige Länder bleiben (3-km-Regel).

## 0.12.15 — 2026-10-09 · Rückmeldungen Test 0.12.14 (B02, B04, B05, B10, C03)

* **B02 METAR/TAF:** «zu aktualisieren», sobald der Start mehr als 6 h entfernt ist – auch wenn ein TAF den Fahrtzeitraum
  abdeckt (Entscheid 09.10.2026; die TAF-Regel aus 0.12.13 ist zurückgenommen).
* **B04 Beobachtungen:** lädt im Server-Modus jetzt automatisch beim Öffnen (bisher erst mit «Laden»; Hinweistext war ein
  roher Schlüssel). Stationen ausserhalb CH/DE (AT, FR, IT, …) über **MeteoGate/E-SOH (EUMETNET)** mit einer
  Flächenabfrage (EDR «area», letzte 2 h) – wie in cockpit.wicki.aero, dort je Station; der Stationslink der Liste liefert
  keine Reihen, deshalb die Flächenabfrage. SwissMetNet und DWD bleiben die Quellen in CH/DE.
* **B05 Flugwetterprognose (eingefügt):** in der **Briefingsicht** gegliedert – Zwischentitel fett, harte Zeilenumbrüche
  innerhalb der Absätze entfernt, **Windtabellen Payerne / Zürich / Lugano nebeneinander** (ft · Wind/°C je Termin,
  PS04 → +4 °C), Prognosewerte als Schlüssel/Wert. **Gültigkeit aus dem Text** (Ausgabe, «gültig für hh:mm – hh:mm UTC»,
  «Nächste Aktualisierung …»); «zu aktualisieren» (Dreieck, Schraffur), wenn die nächste Aktualisierung vor Start + 1 h
  liegt oder bereits vorbei ist. Gültigkeitszeile unter dem Einfügefeld (Erarbeitung), «gültig bis (UTC)» von Hand setzbar.
* **B10 SIGWX low Alps:** Gültigkeitszeile; nach dem Einfügen eines Bildes liest die **KI** (wenn freigeschaltet) die
  Gültigkeit aus dem Kartentitel («VALID 12 UTC 09.10.2026» → ±3 h), sonst Knopf «Gültigkeit aus dem Bild lesen» oder von
  Hand; Warnung nach derselben Regel. Gültigkeit wird mit dem Panel gespeichert (`content.valid`).
* **C03 NOTAM:** Meldungen, deren Gültigkeit den Fahrtzeitraum nicht berührt (abgelaufen bzw. erst nach der Fahrt
  beginnend, 1 h Toleranz statt 6 h), werden **nicht mehr gezeigt**; die Kopfzeile nennt «n ausserhalb des Fahrtzeitraums».
* Tests: calc 282 (Berichtsparser, Gültigkeit), Smoke (B05 eingefügt → Gültigkeit, Warnung, Briefingsicht), API, Remote-UI.

## 0.12.14a — 2026-10-09 · Live-Befunde

* Open-Meteo liefert je Modell nicht alle Bodenvariablen (gemessen: ICON-D2/ICON-EU ohne Grenzschichthöhe, ECMWF ohne
  Sicht/0 °C/Grenzschicht, ICON-CH ohne Sicht/Grenzschicht): fehlende Werte (Grenzschicht, Sicht, 0 °C, CAPE) werden
  mit einer zweiten kleinen Abfrage aus «best match» ergänzt; die Standzeile nennt es.
* SIGMET/AIRMET: Gültigkeit lesbar (Epochensekunden der AWC-API → «MM-DD HH:MMZ»).

## 0.12.14 — 2026-10-09 · Mehr aus den Quellen: Sicht/0 °C/Grenzschicht, Modellvergleich, Ensemble, amtliche Warnungen, ICON-CH

* **B12 Meteogramm:** zwei neue Zeilen – **Sicht** (km, Balken; Nebelrisiko als Schattierung) und **Grenzschichthöhe**
  (m AGL, gestrichelt); bei Gasfahrten zusätzlich die **0 °C-Grenze** (m, blaue Linie, für Ballast und Vereisung).
  Tabelle mit den Spalten Sicht, Grenzschicht und (Gas) 0 °C.
* **B06 Windprognose – Modellvergleich:** Wind je Niveau zur Startzeit aus bis zu zwei weiteren Modellfamilien
  (ICON / ECMWF / GFS / Météo-France / UKMO, soweit sie den Horizont decken), auf die Höhen des Hauptmodells
  interpoliert; Spalte «Spannweite» (Δ Richtung, kt-Bereich), orange ab 25°/4 kt, rot ab 45°/8 kt.
* **B06 Ensemble-Spannweite:** Bodenschicht 10–180 m GND aus **ICON-D2-EPS** (20 Member, ≤ 42 h) bzw. **ICON-EU-EPS**
  (40 Member), Druckflächen 925/850/700 hPa aus **ECMWF ENS** (51 Member) – p10/p50/p90 der Geschwindigkeit, mittlere
  Richtung ± Streuung, zur Startzeit und zur Landung (Open-Meteo Ensemble-API; ICON-EPS liefert dort keine Druckflächen).
  Worker: `/api/wx/om?api=ensemble&query=…`.
* **B09 Trajektorien – Spannweite:** dieselben Bahnen mit den Vergleichsmodellen; Spalte «Spannweite» = grösster Abstand
  der Endpunkte je Niveau (orange ab 8 km, rot ab 20 km); auf der Karte dünn gestrichelt mit Ring am Endpunkt.
* **B14 Warnungen – amtliche Warnungen automatisch:** Startort, Landeraum und Bahn-Endpunkte; **CH** über die
  MeteoSchweiz-App-Schnittstelle (PLZ aus Nominatim; Typen Wind, Gewitter, Regen, Schnee, Glatteis, Frost, Hitze,
  Lawinen, Erdbeben, Waldbrand, Hochwasser, Trockenheit; Stufen 1–5), **DE** über den DWD-WFS «Warnungen_Gemeinden»
  (Punktabfrage; Minor/Moderate/Severe/Extreme → Stufe 1–4). Je Meldung ✕ zum Ausblenden. Worker `/api/wx/warnings?pts=`.
  Hinweis: MeteoSchweiz bietet die Warnungen (noch) nicht als Open Data an – die App-Schnittstelle ist inoffiziell.
* **ICON-CH1 (1 km, 33 h) und ICON-CH2 (2 km, 120 h)** von MeteoSchweiz als Modell wählbar (Open-Meteo): Bodenwerte
  (Meteogramm, Ampel, Thermik, Startplatzwerte) aus dem gewählten Modell, **Druckflächen aus dem Ersatzmodell** (feinstes
  Modell mit Flächen, das den Horizont deckt – meist ICON-D2/ICON-EU), da Open-Meteo für ICON-CH keine Druckflächen
  liefert; Standzeile nennt beide. Für Trajektorien/Höhenprofil bleiben die Modelle mit Flächen.
* **Eigener Text:** Schliessen mit Inhalt **klappt ein** (eine Zeile mit Vorschau; Klick klappt auf), Inhalt bleibt;
  ohne Inhalt schliesst das Kästchen.
* Tests: Smoke (Einklappen), API, Remote-UI, calc.

## 0.12.13 — 2026-10-08 · Rückmeldungen Test 0.12.12 (Navigation, Warnmarkierung, Panels B10/B14, C1, C3, C4)

* **Linke Spalte:** Abschnittstitel mit hängendem Einzug (Umbruch bündig unter dem Text, nicht unter dem Kennbuchstaben);
  **Panelnummern stets zweistellig** («B04», auch in den Panelköpfen, der Briefingsicht und den Nummern mit Etappe «E1-B04»);
  das «!»-Symbol entfällt – offene Pflicht-Panels stehen **rot** (zusammen mit dem roten Punkt).
* **Aktualitätswarnung:** Warndreieck als dünnes Strich-Symbol (wie die übrigen Symbole); betroffene Panels tragen links eine
  **dünne rote Schraffur** mit derselben Mitteilung beim Darüberfahren. Abdeckung gilt als erfüllt, sobald die Information
  **bis Start + 1 h** reicht (METAR/TAF: ein TAF gilt bis dahin; Ballonprognose: Vorhersagetag von Start/Start + 1 h;
  Druckdifferenz: Reihen bis Start + 1 h; gegenwärtiger Stand: Start < 6 h entfernt).
* **Eigener Text / Kommentar:** nur noch **ein** Knopf (Text-Symbol, in der Titelzeile links vom AUTO-Vermerk); der
  Kommentar-PIC-Knopf entfällt (bestehende Kommentare bleiben sichtbar). Das Kästchen hat oben rechts ein **Schliesssymbol**:
  ohne Inhalt schliesst es sofort, mit Inhalt Rückfrage «Wirklich schliessen?» (Inhalt wird verworfen).
* **KI:** überall das Sternsymbol statt «KI» (Knöpfe «Kommentar», «Zusammenfassung erstellen», Kopfzeilen, Modell-Feld,
  Nutzer-Freigabe); Violett gedämpft (`--violet` #7a6aa5 hell / #a894c9 dunkel).
* **B10 SIGWX low Alps:** reines Einfügefeld (Datei / Zwischenablage) für die Karte aus skybriefing. **B14 Warnungen:**
  SIGMET/AIRMET (z. B. TURB SEV) automatisch, je Meldung ✕ (ausblenden) und Karten-Knopf (Polygon der Meldung, Fahrtweg,
  Start, Landeraum); amtliche Warnungen darunter einfügen. Bestehende SIGMET-Schnappschüsse wandern beim Öffnen von B10 nach B14.
  **B12** heisst nur noch «Meteogramm».
* **C1 Lufträume** (neuer Titel): FIR-Folge als Tabelle (Niveau · FIR · ab km · ETA · nach Start, Darstellung wie A02);
  Luftraumtabelle mit **ETA** als erster und **km ab Start** als zweiter Spalte; **✕ je Zeile** blendet einen Luftraum aus
  (beim Aktualisieren Rückfrage wie bei NOTAM); Schriftgrössen wie der übrige Panelinhalt.
* **C3 NOTAM:** Auswahl «Breite des Korridors · 25 NM» statt «Strecke»; Statistikzeile entfällt; der Korridor nennt
  Startort → Ortschaften auf dem Fahrtweg (Kreise um die Bahn-Endpunkte tragen den Ortsnamen) → Landeraum; **Kartenübersicht**
  oberhalb der Meldungen (alle NOTAM mit echtem Ort, rot = VFR-relevant; Klick auf ein Symbol öffnet die Meldung;
  FIR-weite NOTAM nicht auf der Karte).
* **C4:** «Fahrt über Landesgrenze» statt «Grenzüberschreitung» (auch Länderhinweise). **A01:** NVFR-Kästchen steht
  unmittelbar links von «NVFR», mit Abstand zu «VFR».
* Tests: calc 274 (TAF-Gültigkeitsende), Smoke (Schliessen mit/ohne Inhalt, zweistellige Nummern), API, Remote-UI.

## 0.12.12 — 2026-10-08 · Ausgeblendete Archiv-Einträge wieder einblenden

* **Supermaster:** Knopf «Ausgeblendete anzeigen» im Archiv-Titel listet die ausgeblendeten Einträge (abgeblendet, eigener
  Abschnitt) mit Ansicht und «Wieder einblenden» (Rückfrage). Worker: `GET /api/briefings?scope=all&hidden=1`,
  `POST /api/briefings/:id/unhide` (beides nur Supermaster, Protokoll `briefing_unhide`); Listenzeilen tragen `hidden`.
* **FAA NMS:** Erreichbarkeits-Diagnose `src=faa&diag=1` (Status der Token- und NOTAM-Endpunkte aus dem Worker, ohne
  Zugangsdaten). Befund 08.10.2026: `api-nms.aim.faa.gov` antwortet dem Cloudflare-Worker mit 403 (aus dem Browser
  erreichbar) – Freigabe bei der FAA angefragt; die App bleibt bei autorouter → DINS → NOTAM Search.
* **Landesgrenzen:** Natural Earth 1:10m bleibt die Grundlage (Entscheid: Genauigkeit ~1 km genügt).
* Tests: API (hidden/unhide), Remote-UI (Ausblenden → anzeigen → einblenden), Smoke.

## 0.12.11b — 2026-10-08 · FAA NMS API

* **FAA NOTAM über das NMS** (NOTAM Management System, `api-nms.aim.faa.gov`): OAuth2 `client_credentials` mit Client
  Key/Secret (Token ~40 min zwischengespeichert), Abfrage `nmsapi/v1/notams?latitude&longitude&radius` als GeoJSON.
  Der frühere API-Portal-Zugang (`external-api.faa.gov`, Header `client_id`/`client_secret`) bleibt als zweiter
  Versuch. Key/Secret werden ohne Randleerzeichen verwendet. Zugänge: «FAA NMS Client Key/Secret».

## 0.12.11a — 2026-10-08 · FAA-NOTAM-Test

* **NOTAM-Quelle erzwingbar:** `GET /api/wx/notam?...&src=autorouter|faa|dins|search` liefert genau diese Quelle
  (ohne Cache) und bei Fehlern den Klartext (z. B. `FAA NOTAM API: HTTP 401 …`) – zum Vergleich der Quellen und zum
  Test des FAA-Zugangs. Ohne `src` unverändert: autorouter → FAA → DINS → NOTAM Search.
* **Zugänge:** Beschriftung «FAA NOTAM Client Key» (statt Client ID); Schlüssel unverändert `faa_client_id`.

## 0.12.11 — 2026-10-08 · Abschnittsregeln, Ausblenden im Archiv, präzise Landesgrenzen

* **Abschnitte der Briefings-Seite (Antworten auf die Rückfragen):** «Briefings in Arbeit» = Startzeitpunkt in der
  Zukunft; **«Laufende Fahrten»** = Start vorbei bis **geplante Landung (Start + Fahrtdauer) + 6 h**, Sperre ab
  Startzeitpunkt (bisher Start + 1 h), Nachtrag je Öffnung; **«Archiv»** = alles Ältere. Worker rechnet `end_ms`
  des Bestands einmalig neu (Landung + 6 h).
* **Supermaster** kann Archiv-Einträge aller Nutzer **ausblenden** (Papierkorb im Archiv, Rückfrage «Es wird nichts
  gelöscht»): Spalte `hidden`, Eintrag verschwindet aus allen Übersichten, Daten bleiben erhalten. Löschen in «Laufende
  Fahrten» bleibt möglich.
* **Landesgrenzen präzise:** `data/countries.geojson` (Natural Earth 1:10m, public domain; CH/LI/DE/AT/FR/IT auf
  ~500 m vereinfacht, NL/BE/LU/CZ/PL/DK/SK/HU/SI/HR/ES/MC/SM ~2 km; 146 KB) wird beim Start geladen (max. 2.5 s
  gewartet) und bestimmt das Land aus Koordinaten; Grenzband für die automatische Korrektur 2 km. Rückfall ohne
  Datei: Umriss/GAFOR/Regeln aus 0.12.10a. Hinweis: Natural Earth liegt an einzelnen Stellen bis ~1 km neben der
  amtlichen Grenze (z. B. Konstanz-Altstadt) – dort bleibt das gespeicherte Land und ist in den Stammdaten zu setzen.

## 0.12.10 — 2026-10-08 · Laufende Fahrten und Nachträge

* **Sperre ab Start + 1 h** (bisher erst nach Fahrtende): ab dann nur Ansicht und Druck. **Archiv** ab Fahrtende
  (Start + Fahrtdauer + 2 h, mindestens 6 h nach Start) – unveränderlich, nicht löschbar.
* **Briefings-Seite mit drei Abschnitten:** «Briefings in Arbeit» (bis Start + 1 h), **«Laufende Fahrten»** (gesperrt,
  Nachtrag möglich; nur sichtbar, wenn eine Fahrt läuft) und «Archiv».
* **Nachtrag während der laufenden Fahrt:** Stift in «Laufende Fahrten» bzw. Knopf «Nachtrag anlegen und bearbeiten» in der
  Briefingsicht → Rückfrage; danach wird der bisherige Stand als **eingefrorene Archivkopie** (bisherige Briefingnummer) ins
  Archiv gelegt, das Briefing selbst (gleiche Kennung, Links bleiben gültig) erhält die **Briefingnummer mit Buchstabe**
  (2026-008 → 2026-008a → 2026-008b …) und ist in dieser Erarbeitung bearbeitbar. Verlassen der Erarbeitung beendet den
  Nachtrag; ein weiteres Öffnen ist ein neuer Nachtrag (nächster Buchstabe). Die Archivkopie zeigt in der Briefingsicht
  «Archivkopie – Stand … vor dem Nachtrag». Worker: `POST /api/briefings/:id/amend` (409 vor Start + 1 h, 423 im Archiv),
  Spalte `frozen`; Bilder bleiben erhalten, solange eine Archivkopie darauf verweist; auch Mitarbeits-Links können
  archivierte Briefings nicht mehr ändern (423). Lokaler Modus gleich.
* Tests: Rechenkern (Sperre, Archiv, Nachtrag-Nummer, Datenfunktion), API (amend, 409/423), Oberfläche (Abschnitt
  «Laufende Fahrten», Rückfrage, Erarbeitung nur im Nachtrag, Archivkopie).
* **Rückmeldungen Test 0.12.9:**
  * Länderkennzeichen: Land aus Koordinaten neu mit **Schweiz-Umriss** (vereinfachtes Polygon), **Deutschland aus den
    GAFOR-Gebieten** und groben Regeln für AT/FR/IT (bisher nur Kästen – «Illmensee» galt als CH). Ein gespeichertes
    Land, das eindeutig (4 km Abstand zur Grenze) nicht zu den Koordinaten passt, wird beim Laden korrigiert
    (Stammdaten-Orte, Treffpunkte, Start-/Landeort, Stopps); im Grenzband bleibt der gespeicherte Wert – dort das Land
    in den Stammdaten prüfen. Orts-Auswahl setzt das Land aus den Koordinaten.
  * A1: Beschriftung «Startort» (ohne «(Koordinaten)»).
  * Karten: **OpenStreetMap-Kacheln statt CARTO** (CARTO verlangt neu einen Schlüssel) – NOTAM-Karte, Höhenprofil-Werkzeug
    «Neutral» und «ICAO/Luftraum».
  * NOTAM-Karte (Symbol) nur bei Meldungen mit echtem Ort: Koordinaten im Meldungstext oder Q-Zeilen-Radius < 999 NM;
    FIR-weite Meldungen ohne Karte.
  * Briefings-Seite: feste Spaltenbreiten – die drei Abschnitte sind untereinander ausgerichtet.
  (Die Punkte Land/Startort/Karten/NOTAM-Karte/Spaltenbreiten sind in 0.12.10a nachgeliefert.)
  * METAR/TAF: Schreibfehler der NOAA-Stationsliste korrigiert (Augsberg → Augsburg, Koln → Köln, Nurnberg → Nürnberg,
    Munich → München, Vienna → Wien, Geneva → Genf, Klammer-/Leerzeichenreste).
  * Startzeit nur im 10-Minuten-Raster: Eingaben werden gerundet und ins Feld zurückgeschrieben (Browser-Picker hält das
    Raster nicht ein).
  * Assistent: Pflicht-Inhalte nicht mehr fett. A1 Fahrtabsicht: «Distanz ~15 km».
  * **TAF:** Änderungsgruppen (BECMG/TEMPO/PROB/FM), deren Zeitraum den Fahrtzeitraum (Start … Start + Fahrtdauer)
    berührt, erhalten einen feinen Rahmen – im Rohtext und im Klartext (Tooltip «Änderungsgruppe betrifft den
    Fahrtzeitraum»); Monatswechsel berücksichtigt.
  * **Aktualisierungswarnung** als rotes Warndreieck ohne Hintergrund **in der Titelzeile** des Panels (Erarbeitung und
    Briefingsicht), nicht mehr in der Standzeile – bei allen Panels, deren Information den Fahrtzeitraum noch nicht
    abdeckt: gegenwärtiger Stand (METAR/TAF, Beobachtungen, SIGMET, NOTAM, Lage, DABS, Radar/Webcams) bei Start > 6 h,
    **Ballonprognose** (DWD-Vorhersagetag der Fahrt fehlt) und **Druckdifferenzprognose** (Reihen reichen nicht bis zur
    Landung).
  * KI-Zusammenfassung: Ergebnis erscheint nach dem Erstellen sofort in einem Dialog mit Hinweis, wo es steht (Karte
    «Zusammenfassung» rechts unten; Briefingsicht im Kopfblock unter der Einschätzung); Fehler als Dialog statt Kurzmeldung.

## 0.12.9 — 2026-10-08 · Archiv unveränderlich, drei Schriften in der Briefingsicht

* **Briefings-Seite:** zwei immer sichtbare Abschnitte **«Briefings in Arbeit»** und **«Archiv»** (statt Filter
  Geplant/Alle/Archiv). Vergangene Fahrten bleiben unbeschränkt im Archiv, sind unveränderlich (Ansicht, Druck) und
  mit ⧉ als Vorlage kopierbar; kein Löschen im Archiv. Der Worker lehnt Änderungen und Löschen gesperrter
  Briefings ab (HTTP 423).
* **Briefingsicht – drei Schriften:** Titel (linke Spalte), Beschriftungen (Mono, klein, grau; «Ordnungsnummer»
  heisst neu **«Briefingnummer»**) und Angaben (Sans 11.5 px) – auch für METAR/NOTAM-Texte, Tabellen, Hinweise.
  Grafiken und das Höhenprofil-Werkzeug unverändert. A2-Tabellen kompakter.
* **A4** heisst **«Geplanter Landeraum»** (ohne fette Wiederholung in der Zelle). **A3:** Startgewicht nicht mehr fett;
  neue Zeile **«Δ max. Startgewicht»** = zulässig − Start (schwarz bei ≥ 0, rot bei negativ) – auch in Erarbeitung und
  Assistent. Hinweis zu Radiosondierung/SondeHub (B3) über beide Spalten.
* Warnsymbol «gegenwärtiger Stand» auch bei DABS und Radar/Webcams (Nachtrag 0.12.8).
* Tests: Smoke «desktop» (Abschnitte der Briefings-Seite, Briefingnummer).

### 0.12.9a — 2026-10-08 · Antworten auf die Rückfragen

* **Archiv:** kein Löschen mehr (auch nicht Supermaster); der Worker lehnt Löschen und Ändern vergangener Fahrten mit
  HTTP 423 ab (die Sperre in 0.12.9 griff nicht, weil `end_ms` nicht mitgelesen wurde – behoben, API-Test ergänzt).
* **A4 Etappenübersicht (Briefingsicht):** Lufträume, Achtung und Kontakte als zweite Zeile je Etappe.

## 0.12.8 — 2026-10-08 · Rückmeldungen aus dem Test 0.12.7 (Oberfläche, A1/A2, Meldungen ausblenden, NOTAM-Karte, Warnsymbol)

* **Oberfläche:** Briefings-Seite ohne Stammdaten-Rekapitulation (Knopf «Einstellungen» bleibt); «Nächste
  Fahrt» in einheitlicher Schriftgrösse (erste Zeile fett); «Neues Briefing» und «Freigeben als Final» nicht
  fett. Erarbeitung: linke Navigation als Raster Punkt · Nummer · Titel (eine Schriftgrösse, Nummern ohne
  Umbruch, Titel linksbündig, weniger Einzug, Zwischentitel hervorgehoben, Legende mit eingefärbten Punkten);
  mittlere Spalte mit eigenem Rollbereich und sichtbarem Rollbalken; «Alle verfügbaren Daten aktualisieren»
  wie «Pflichtinhalte ergänzen» gestaltet; rechte Spalte neu geordnet: Planungshorizont · **Grunddaten**
  (Datum/Zeit, Startort, Kennzeichen, Fahrtdauer, Landeort, Klickbox NVFR) · **Einschätzung (Modellsicht)**
  in Blöcken (Gesamteinschätzung **kritisch / marginal / unkritisch**, Gründe, Modellaussage) · Zusammenfassung;
  Kästchen «Panels» und «Protokoll» entfernt; Spalten bleiben unter der Kopfzeile stehen. Wechsel Erarbeitung ↔
  Briefingsicht öffnet die andere Sicht an der zuletzt gesehenen Stelle (erstes Öffnen der Briefingsicht in
  der Sitzung: oben).
* **A1 Stammdaten:** Ortsname nicht fett; **Landeort (geplant)** als eigene Zeile wie der Startort
  (Koordinaten, Höhe, Google Maps); Fahrtabsicht neu «Fahrtdauer · Fahrthöhen · Grobrichtung · Distanz ·
  Ankunft (Fahrzeit) · ⌀ Fahrthöhe · ⌀ Geschwindigkeit» ohne Landeort (`intent.target`, ältere Briefings
  aus der bisherigen Richtungszeile). **Alle Orte mit Länderkennzeichen**, auch CH («CH-Oberlunkhofen AG»).
* **A2 Astronomische Daten:** Sonne und Mond als Tabellen (LT/UTC), ohne NVFR-Anmerkung.
* **METAR-Klartext:** Änderungsgruppen bündig unter dem Bezugstext, Umbruch rechts von der Pfeilspitze.
* **Meldungen ausblenden:** ✕ je METAR-Station und NOTAM (ohne Rückfrage; auch in der Briefingsicht
  ausgeblendet); «Aktualisieren» fragt «Alle Meldungen aktualisieren» / «Selektion beim Aktualisieren
  beibehalten».
* **NOTAM-Karte:** Karten-Knopf bei NOTAM mit Lage (Felder oder Koordinaten/Radius im Text) – Kreis des
  NOTAM mit geplantem Fahrtweg (Profilbahn, sonst Trajektorien), Startort, Landeraum.
* **Warnsymbol «gegenwärtiger Stand»:** bei Start > 6 h bei METAR/TAF, Beobachtungen, SIGMET, NOTAM,
  Allgemeiner Lage, DABS und Radar/Webcams (Mouseover-Text), nicht bei Modelldaten zum Startzeitpunkt.
* **Gasfahrt:** «Allgemeine Lage» gilt für die ganze Fahrt – steht bei Etappen-Briefings unter «B · Ganze
  Fahrt» vor E1 (Erarbeitung, Navigation, Briefingsicht; Nummer B1).
* **Dialoge:** «Schnappschuss entfernen», Panel leeren und Dokument entfernen fragen im Dialog der Anwendung
  (statt Browser-`confirm`). Radar-Ebenen «Regen», «Webcams», «Wettersonden». Etappenübersicht in der
  Briefingsicht: Orte zweizeilig, Kontakte je Zeile (sauberer Umbruch).
* NOTAM-Quelle (seit 0.12.7a): scheitert autorouter, steht der Grund als Hinweis im Panel der Ersatzquelle.
* Tests: calc 261 (Länderkennzeichen CH), Smoke «desktop» (Station ausblenden, Rückfrage, Warnsymbol,
  rechte/linke Spalte, A1/A2) und «gas» (Abschnitt «Ganze Fahrt»).

## 0.12.7 — 2026-10-07 · 2. Pilot für alle Ballone, Ausschnitt-Schieber, Startetappe auf ihren Bereich, Panel-Nummern mit Etappe, FIS-Werte

* **2. Pilot** jetzt für alle Ballontypen (Feld im Assistenten «Personen», Masse, Flugplan P/, Rolle heisst
  «2. Pilot»; `hasCopilot` ohne Gas-Bedingung).
* **Höhenprofil-Werkzeug – Ausschnitt:** Schieber unterhalb der Zeitskala mit **Beginn- und Endmarke**
  (Übersicht über die ganze Fahrt mit Etappenstrichen); das Fenster wird über die ganze Breite gespreizt
  (km-Schrittweite nach dem Ausschnitt, Lagebezogenes am Rand beschnitten), Band verschiebbar, Klick auf die
  Übersicht zentriert, Doppelklick oder Knopf **«Ganze Fahrt»** hebt den Ausschnitt auf; Beschriftung
  «Ausschnitt 0–120 km · 20:00–23:15 LT». Nicht gespeichert; die Distanz-Spreizung ×1…×8 (0.12.6) entfällt,
  Spreizung Höhe bleibt.
* **Startetappe auf ihren Bereich:** sobald weitere Etappen bestehen, gilt die Planung der Startetappe
  (Abschnitte B/C) nur für die erste Etappe – abgeleitete Sicht `startPlanBriefing()` (Dauer, Höhenband,
  Bahnabschnitt für Luftraum/NOTAM; Temps zur Startzeit; Startort, Landeraum, Panels und Abrufeinstellungen
  des Hauptbriefings, Schreibzugriffe gehen durch); Unterzeile «Etappe 1 bis km … (… km) · bis ‹Ort›»
  in Erarbeitung und Briefingsicht. Die einzige Vorgabe-Etappe **«Enroute» wird «Start»**, sobald im
  Werkzeug eine weitere Etappe angelegt wird (`renameStartStage`).
* **Panel-Nummern mit Etappe:** mit Etappen-Briefings heissen die Panels der Abschnitte B/C «E1-B2»,
  «E3-C3» (Navigation, Panelköpfe, Briefingsicht mit Etappenkopf E1 und B/C als Untertitel); A/D unverändert.
* **FIS-Kontakte (Einstellungen → Experte):** Deutschland mit den Sektoren von Langen Information
  (Stuttgart 128.950, Saarbrücken 123.525, Frankfurt 119.150, Düsseldorf 129.875 – DFS AIC VFR 01/26 vom
  2. April 2026), Frankreich mit Bâle Information 130.905 / 134.680 und Lyon Information 135.200 / 135.530
  (AIP France AIRAC 1. Oktober 2026, AD 2 LFSB/LFLL); München Information und Italien bleiben Platzhalter
  (keine öffentlich zugängliche amtliche Quelle). Gespeicherte Listen, die nur die Platzhalter von 0.12
  enthalten, werden auf die neue Standardliste gehoben; eigene Werte bleiben.
* **NOTAM-Quelle sichtbar:** scheitert der Abruf über autorouter (Zugang hinterlegt, aber z. B. API nicht
  freigegeben), steht der Grund («autorouter: HTTP … oauth2/token: …») als Hinweis im NOTAM-Panel der Ersatzquelle;
  die Quelle steht wie bisher in der Stand-Zeile.
* Tests: calc 261 (Startetappen-Sicht, Umbenennung, Nummern, FIS-Hebung, 2. Pilot Heissluft), Smoke «gas»
  (Ausschnitt-Schieber: Marken ziehen, Band, «Ganze Fahrt», Doppelklick; Spreizung Höhe; Unterzeile E1;
  Nummern «E1-B2»/«E3-C3» in Erarbeitung und Briefingsicht) und «desktop» (2. Pilot bei Heissluft).

## 0.12.6 — 2026-10-07 · 2. Pilot, Etappen-Gliederung, Werkzeug: Spreizung und Speichern/Verwerfen, Übergangshöhen, Version auf der Anmeldeseite

* **Anmeldeseite:** Version diskret unten links (`#gateVer`).
* **2. Pilot (Gasfahrt):** Rolle **«2. Pilot GB»** bei den Personen in den Einstellungen; im Assistenten
  «Personen» Feld «2. Pilot» (Stamm oder frei, nur Gas); zählt zu Personen an Bord, Masse (Normgewicht),
  Flugplan P/, Stammdaten, Briefingsicht, ICS, Crew-Nachricht und Pax-Karte (`persons.copilotId/copilot`,
  `hasCopilot`, `personsOnBoard`).
* **Höhenprofil-Werkzeug:** Kopf mit **«Speichern und schliessen»** und **«Schliessen ohne Speichern»**
  (Stand beim Öffnen: Profil, Etappen, Zeitbasis, Etappen-Planungen); ✕/Escape = speichern. **Spreizung**
  der Achsen: Distanz ×1/×2/×4/×8, Höhe ×1/×2/×3 – Zeichenfläche wächst, Schrift bleibt, Rahmen rollt
  (nur Ansicht im Werkzeug; Panel und Druck unverändert).
* **Erarbeitungssicht mit Etappen-Briefings:** Etappenköpfe «E1 · Etappe 1 · ‹Start›» (= Abschnitte B/C
  des Hauptbriefings, Unterzeile Startort/ganze Fahrt) und «E‹n› …» mit B/C als Untertiteln; Navigation
  links gruppiert A · E1 (B, C) · E‹n› (B, C) · D; Etappen-Knöpfe in der haftenden Zeile neben «Alle
  verfügbaren Daten aktualisieren» springen zum Etappenkopf.
* **Übergangshöhe (C):** die für die Fahrt anwendbaren Höhen sind automatisch angeklickt (Länder von
  Startort, Landeraum, FIR-Folge der Luftraumanalyse und des Profils → Vorgaben je Land aus den
  Einstellungen, sonst Einträge mit passendem Land); Handänderung bleibt (Hinweis «von Hand gesetzt»,
  Knopf «wieder automatisch»); Briefingsicht zeigt denselben Stand (`applicableTransitions`,
  `transitionItems`).
* Tests: calc 252 (2. Pilot in Masse/Flugplan, Übergangshöhen), Smoke «gas» (Version auf der Anmeldeseite,
  2. Pilot im Assistenten/Stammdaten, Übergangshöhen automatisch/von Hand, Spreizung ×2,
  Speichern/Verwerfen im Werkzeug, Gliederung E1/E3 mit Etappen-Knöpfen).

## 0.12.5 — 2026-10-07 · Ops-Briefing je Etappe, Ortsnamen ISO

* **Ops-Briefing je Etappe (Gasfahrt):** Klickbox **«Ops-Briefing für Etappe»** im Etappenmenü des
  Höhenprofil-Werkzeugs und im neuen Dialog beim Anlegen einer Etappe (Klick auf die Zeitzeile: Name + Klickbox);
  Marke **B/C** hinter dem Etappennamen (Grafik, Etappenübersicht, Legende). Die Planung der Startetappe sind die
  Abschnitte B/C; jede weitere Etappe mit Planung bekommt zwischen C und D einen Abschnitt **E‹n›** mit Zeitfenster,
  Ort (Etappenmitte → Etappenende, Ortsnamen über Nominatim) und eigenen Panels: METAR/TAF, Temps (zur
  Etappenmitte), Beobachtungen, Flugwetterprognose (DE), Wind, Ballonprognose, SIGWX, Thermik, Meteogramm,
  Bemerkungen, Luftraum (Bahnabschnitt des Profils), DABS (nur bei Berührung der Schweiz), NOTAM (überlappende
  Kreise entlang des Abschnitts), Bemerkungen. Mindestens eine Etappe je Briefing hat eine Planung (Vorgabe
  Startetappe; Klickbox der letzten Planung gesperrt); Startetappe ohne Planung → orts-/zeitgebundene Panels fehlen
  in B/C (Hinweis). Vorgabe-Etappen: ab 10 h Start/Enroute/Landung, darunter eine Etappe «Enroute». Etappen-
  Briefings in Navigation, «Pflichtinhalte ergänzen», Freigabe-Checkliste, Vollständigkeit, «Alle verfügbaren
  Daten aktualisieren», KI-Kommentar (Etappenkontext) und Briefingsicht/Druck (DABS-Beilagen mit Kennung E‹n›).
  Hinweis bei verschobener Etappe; Planungsdaten gelöschter Etappen werden entfernt. Nahe Etappennamen weichen in
  eine zweite Zeile aus. Neu `js/calc/stageplan.js` (`stagePlanBriefing`, `stageSets`, `coverPoints` …),
  Daten `b.profile.stages[].ops`, `b.stagePlans`.
* **Ortsnamen:** Länderkennzeichen vor Ortsnamen jetzt einheitlich ISO-2 («DE-Stuttgart»), auch bei der
  Radiosonde (vorher Kfz-Kennzeichen «D-»).
* Tests: calc 246 (Etappen-Planung: Vorgaben, Mindestens-eine-Regel, Etappensicht, Kreise, Sichtbarkeit,
  Vollständigkeit), Smoke «gas» (Dialog neue Etappe, Klickbox, Abschnitt E3 im Editor und in der Briefingsicht).

## 0.12.4 — 2026-10-07 · NOTAM ohne Schlüssel, Gas-Startmasse, Modellwahl, Orte mit Länderkennzeichen

* **NOTAM ohne Zugang:** neue schlüssellose Quellen im Worker – **FAA DINS** (`notams.faa.gov/dinsQueryWeb`,
  FIR-NOTAMs der beteiligten Länder, Umkreis über die Koordinaten/Radius der Q-Zeile) und **FAA NOTAM Search**
  (`notams.aim.faa.gov/notamSearch`, Umkreis um Breite/Länge); Reihenfolge autorouter → FAA-API → DINS → NOTAM
  Search; ICAO-NOTAM-Parser `parseIcaoNotam` (Q-Zeile, A–G, PERM/EST). Beide Quellen sind inoffiziell und aus der
  Entwicklungsumgebung nicht erreichbar – Live-Test nötig.
* **Gasballon:** Feld **«Ausrüstung (kg)»** im Schritt «Ballon & Fahrt» (Vorgabe aus dem Korb, Stamm neu 45 kg),
  zählt zur Startmasse; Spezialausrüstung ohne «Druckerhöhung» und «Heli-Bergung».
* **Assistent:** Startzeit in 10-min-Schritten; **Wettermodell** im Schritt «Was ist geplant?» wählbar (⚠ bei zu
  kurzem Horizont), **Vorgabe ICON-EU** für neue Briefings und für die Modell-Leiste.
* **DABS** nur, wenn die Fahrt die Schweiz berührt – Schweiz-Umriss statt Rechteck (Wolfegg, Bregenz, Freiburg
  zählen nicht mehr als CH); `inSwitzerland`, `touchesCH`.
* **Orte:** Start-/Landeorte ausserhalb der Schweiz mit Länderkennzeichen («DE-Wolfegg») in Liste, Kopfzeile,
  Tagesplanung, Kalender/ICS, Pax-Karte, Briefingsicht (`placeLabel`).
* Tests: calc 230 (NOTAM-Parser, placeLabel, Umriss, touchesCH), Smoke «gas» (Ausrüstung, 10-min, Modellwahl,
  A «Spezialausrüstung»).

## 0.12.3 — 2026-10-07 · NVFR und Start-Ampel

* **Start-Ampel / Meteogramm-Ampel:** bei zugelassener Nachtfahrt («NVFR zulassen» bzw. NVFR-Schalter) wird
  «ausserhalb der bürgerlichen Dämmerung» nicht mehr als Kriterium gewertet (`lightForRating` in `js/auto/data.js`);
  die Ampel im Schritt «Ort & Zeit» wird beim Umschalten sofort neu bewertet. Die Nachtkennzeichnung der Stunden im
  Meteogramm bleibt. Smoke-Test «desktop» prüft beides.
* Einführungsfilme (0.12.2) bleiben als Prototyp; Weiterarbeit zurückgestellt.

## 0.12.2 — 2026-10-06 · Höhenprofil Stand 11, App-Rückmeldungen, OSM-Wasser, Einführungsfilme

* **Höhenprofil-Werkzeug (Stand 11):** Zeilenbeschriftungen «Sonne»/«Tag» links der Achsen entfernt;
  **«Level-Out»** statt «Abblasen»; Spalten «Temp.» und «Adiab.» mit Tooltip erklärt; Titel **«Schätzung
  Ballastverbrauch»**; darunter **«Modell der Schätzung»** als einklappbarer Block über die ganze Breite
  (Parameter und Bedeutung der Spalten; Vorgabe zu; im Briefingdruck nur, wenn aufgeklappt); **Legende
  einklappbar** (Vorgabe offen; im Briefingdruck immer) mit dem Bedienhinweis als erster Zeile statt über der
  Grafik; Pille **«Wettermodell ‹Name› ⋯»** zeigt das gewählte bzw. verwendete Modell, Vorgabe = feinstes
  Modell (Gitterweite), das die ganze Fahrt abdeckt (`suggestModel` wählt jetzt nach Gitterweite, gilt auch
  für die Modell-Leiste in B); Zustand der Blöcke je Briefing in `profile.fold`.
* **Wasserflächen aus OpenStreetMap:** Worker `/api/wx/water` (Overpass `is_in` je km-Punkt, Flüsse/Kanäle
  ausgenommen, 30 Tage Cache, Spiegel-Server als Rückfall), lokaler Modus direkt; Legende «Wasserfläche
  (OpenStreetMap)», Heuristik aus dem Relief nur noch als Rückfall (`waterFromItems`).
* **FIS-Kontakte je Etappe:** FIS-Sektoren aus openAIP (Typ «FIS Sector», Frequenzen aus der AIP) entlang der
  Bahn (`fisSectors`, `profile.data.fis`); die Kontakte je Land aus den Einstellungen gelten, wo keine
  Sektoren vorliegen.
* **App:** nach der Anmeldung immer die Übersicht «Meine Briefings»; METAR/TAF-Klartext ohne Fettschrift
  bei «METAR»/«TAF»; neuer Knopf **«Pflichtinhalte ergänzen (n)»** neben «Alle verfügbaren Daten
  aktualisieren» (springt zum nächsten leeren Pflicht-Panel), die Zeile bleibt beim Rollen unter der
  Kopfzeile stehen.
* **Einführungsfilme** (`demo/`): zwei Filme mit Sprecherstimme (Piper, lokal) – Heissluftfahrt HB-QWZ und
  Gasfahrt HB-QPJ, je ≈ 2½ min, aufgenommen in der App mit Beispieldaten (Playwright); Player mit Kapiteln
  und Sprechtext; Menü ≡ → «Einführung (Filme)». Konzept `docs/Konzept_Demo_Einfuehrung.md`, Pipeline
  `demo/build/` (synth → record → assemble → player).
* **Tests:** calc 225 (OSM-Wasser, FIS-Sektoren), Smoke «gas» (Anmeldung → Liste, Legende/Modell
  einklappbar, Level-Out, Wettermodell-Pille mit Vorgabe, OSM-Wasser, Pflichtinhalte-Knopf, Briefingsicht),
  API water 400/400/500. Skizze Stand 11 (Konzept 44–52).

## 0.12.1 — 2026-10-06 · Höhenprofil-Werkzeug: Rückmeldungen Stand 10

* **Grafik:** Pfeil «Ende Prognosemodell» zeigt auf die Prognosegrenze; Höhenlinien über die ganze Breite vor
  Nacht/Dämmerung und Relief (Geländehöhe ablesbar); Regen-Symbol neu (drei Tropfen im Warnkreis);
  Raten-Pillen mittig auf dem Teilstück mit kleinem «m/s»; Punktbeschriftung kompakt «2300m·19:30»;
  Achtung-Zeichen durchscheinend; alte ECET/BCMT-Kürzel im Grafikfeld und die Beschriftung
  «Nullgradgrenze» entfernt; Achsenhinweis als erster Legendeneintrag statt über der Grafik.
* **Wetter-Layer:** Inversionen als Band mit gestrichelter Mittellinie und **Isothermieschichten** (Gradient
  zwischen −0,2 und +0,1 K/100 m) als helles Band aus dem Modellprofil je Stunde (`layersOf`, `inv[].kind`).
* **Werkzeugleiste einzeilig:** Profil/Karte · LT/UTC · Rückgängig · **Modell als Pille mit ⋯** (öffnet die
  Liste mit Horizont-Warnung) · **Beispiel** · Wetter/Lufträume; Hinweis und Modellwarnung darunter.
* **Beispiel:** synthetische Fahrt (180 km, Abendübergang, See, Decken, Inversion/Isothermie, Lufträume mit HX,
  alle Achtung-Zeichen) mit nummerierten Erklärungen in der Grafik und darunter, dazu «Woher die Daten
  kommen»; zum Üben, Änderungen werden nicht gespeichert; «Beispiel schliessen» führt zur Planung zurück
  (`js/ui/profile_sample.js`).
* **Ballasttabelle** unter der Grafik, läuft bei jeder Änderung mit; ab 7 Teilstücken zwei, ab 13 drei
  Spalten; Zeiten und Höhen brechen nicht um (auch Panel, Briefingsicht, Druck).
* Konzept: Entscheide 41–55 (Stand 10), Skizze Stand 10 mit Regen-Optionen A/B/C.
* Tests: calc 222, Smoke «gas» (Modell-Pille, Beispiel mit Erklärungen, Spalten), API, Remote.

## 0.12.0 — 2026-10-06 · Höhenprofil-Werkzeug, Etappen und Ballastmodell (Gasfahrt)

* **Neues Panel A «Fahrtprofil: Höhen, Etappen, Ballast»** (nur Gasballon): «Daten aufbereiten» holt
  die Modellprognosen entlang der Bahn (Startort + Wegpunkte alle 40 km, Modell mit ausreichendem
  Horizont), das **Relief** (Open-Meteo Elevation über den Worker, `/api/wx/elevation`, 7 Tage Cache),
  **Stundenprofile** am jeweiligen Ort (Wolken-/Nebeldecken RH ≥ 95 %, Inversionen, Nullgradgrenze,
  Wind/Scherung in Fahrthöhe), die **Sonnenereignisse** SS · ECET · BCMT · SR entlang der Bahn und die
  **Lufträume** (openAIP, durchfahren und nahe, HX-Status) → `b.profile.data`.
* **Werkzeug (Vollbild):** Grafik Distanz × Höhe mit drei Beschriftungszeilen (km mit Zwischenstrichen
  bei 25/50/75 %; Zeit LT/UTC – aus der Distanz über den Wind der Fahrthöhe – mit 30'-Strichen und den
  Sonnenzeiten darunter; Tag/Datum bei Fahrten über Mitternacht). Punkte ziehen, Doppelklick setzt,
  ≡ Menü (einfügen davor/danach, löschen); Etappen vom Start her nummeriert, Griff ⋮ am unteren Rand
  verschiebt Grenzen, Klick auf die Zeitzeile setzt eine, Menü umbenennen/löschen (mit Vorgänger oder
  Nachfolger zusammenlegen); **Rückgängig** (Knopf, Ctrl+Z, 50 Schritte). Layer «Wetter» und
  «Lufträume», Raten-Pillen zuoberst (grau < 0,5 · grün ≤ 1,75 · gelb ≤ 3 · rot). Lufträume ab GND und
  Nebeldecken enden an der Reliefline; Mindestabstand (300 m, Experten) rot schraffiert mit Warnung
  «<300m AGL · km» auf der Distanzskala; Wasserflächen (ebene Läufe im Höhenmodell) als blaue Einsätze.
  Achtung-Zeichen mit Grund-Symbol (Wind «35 kt», Scherung, CB-Neigung, Nebel nahe Grund, Niederschlag,
  Vereisung als Schneestern; Einzelheiten im Tooltip; Grenzen unter Einstellungen → Experten). Lufträume
  ab GND ohne Bodenlinie, HX/Betriebszeiten umbrochen unter der Bezeichnung; Etappennamen oberhalb der
  Grafik. **Modellwahl** im Werkzeug: Modelle mit ausreichendem Horizont; ein Modell, das die Fahrt nur
  teilweise abdeckt, zeigt «⚠ bis +X h», eine Warnung und den Marker «← Ende Prognosemodell».
  **Kartenansicht** (nur Ansicht): Grundkarte Neutral/OSM/Topo/Luftfahrtkarte (openAIP)/Satellit,
  Bahn, Stundenmarken, Höhenpunkte, Etappenmarker (Raute + Fähnchen), Luftraumflächen.
  Nach jeder Profiländerung wird die Bahn nachgerechnet (Prognosen im Zwischenspeicher).
* **Zeitzone:** LT/UTC-Schalter im Werkzeug ist der Briefing-Schalter (`b.time.base`); Grafik,
  Tabellen und Druck folgen ihm einheitlich (Flugplan bleibt UTC).
* **Ballastschätzung nach der Aerostatik** (`docs/Aerostatik_Gasballon.md`): je Teilstück Manöver
  (WZ · v², Abfangen × 1,3), Abblasen über der Prallhöhe (1 % je 80 m, Prallhöhe aus dem Füllungsgrad),
  Temperatur Gas–Luft (Tag/Nacht klar/bedeckt aus `S.aero`, Übergang ±1 h um ECET/BCMT, Bewölkung
  aus dem Modell), Adiabatik; Summe + Landereserve gegen den Ballastvorrat aus A3 mit Balken (> 85 %
  Warnung). **Widerstandszahl WZ** je Hülle in den Stammdaten (Experten; Vorgabe 3,5 / 3,8).
* **Etappenübersicht** (Panel, Briefingsicht, Druck): Nr., Name, Zeitfenster, km, Höhenband, Ort
  (ICAO-Kurzkoordinaten Beginn → Ende), Land/FIR (Luftraumanalyse), Lufträume, Achtung-Zeichen,
  **FIS-Kontakte je Land** (Einstellungen → Experten, AIP; vorbelegt CH/AT, übrige mit AIP-Verweis).
* **NOTAM «Umkreis um Orte»:** Knopf «Orte aus Etappen» übernimmt die Etappenmitten mit passendem Radius.
* **Nachfahrer-Panel** (A, nur Gas ab 12 h Fahrtdauer): Route, Maut/Vignetten, Übernachtung,
  Grenzdokumente, Treffpunkt als Textvorlage.
* **Druck:** Profil als Vollbreite-Grafik, Etappenübersicht und Ballasttabelle im Briefing.
* Noch nicht in 0.12.0 (geplant 0.12.x): eigene B/C-Abschnitte je Etappe; Kalibrierung über
  Inventurpunkte/Barogramm; Unsicherheit der Zeitzeile (offene Fragen f/g im Konzept).
* Konzept/Skizze: `docs/Konzept_0.12_Hoehenprofil.md` mit Entscheiden 1–40, Skizze Stand 9
  (`docs/Hoehenprofil_Werkzeug_Skizze.html`).
* Tests: calc 221 (Kopplung km/Zeit, Teilstücke, Relief, Etappen, Nachtanteil, Ballastmodell,
  Achtung-Zeichen), Smoke-Lauf «gas» (Panel, Werkzeug: Ziehen, Punkt/Etappe setzen, umbenennen,
  Ctrl+Z, LT/UTC, Modellwahl mit Horizont-Warnung, Karte; Legende; NOTAM-Orte; Briefingsicht), API (`elevation`).

## 0.11.4 — 2026-10-05 · Antworten zu 0.11.3 · Füllungsgrad · Aerostatik-Parameter · Konzept 0.12

* **Vergrösserte Ansicht auch im Editor:** Klick auf Grafiken, Bilder und Datentabellen öffnet wie in
  der Briefingsicht das Grossbild (Eingabefelder, Karten, Niveauliste und Symbole ausgenommen); Bilder
  der Zusatz-/Kommentarboxen ebenfalls.
* **Alter von METAR/TAF und Beobachtungen** «(vor 0:30 h)» bezieht sich auf den **Publikations-
  zeitpunkt des Briefings** (Freigabe als Final); in der Erarbeitung auf jetzt, nach der Fahrt
  (gesperrt, ohne Freigabe) auf den Startzeitpunkt (`ageRefMs`).
* **A3 Gasballon – Füllungsgrad (%)** je Briefing, Vorgabe **100 %** (meist wird voll gefüllt);
  Gasmenge, Ballast und Kennzahlen folgen daraus; Bestand übernimmt den Stammwert der Hülle. Grundlage
  für Prallhöhe und Ballastmodell in 0.12.
* **Einstellungen → Experten → «Aerostatik Gasballon»:** Überhitzung des Traggases Tag/Nacht bei klarem
  (+15 / −3 K) und bedecktem Himmel (+5 / −1 K), Auftriebsänderung je K (0.4 %), Verlust über der
  Prallhöhe (1 % je 80 m) – Parameter des Ballastmodells 0.12 (`S.aero`).
* **Bearbeitungsstand** bleibt wie in 0.11.2 (zählt beim ersten Speichern einer Sitzung, nicht beim
  Öffnen).
* **Konzept 0.12:** `docs/Konzept_0.12_Hoehenprofil.md` mit allen Entscheiden vom 05.10.2026 als
  Startvorlage; Skizze Stand 3 (zwei X-Zeilen Distanz/Zeit, Zeit über den Wind der Fahrthöhe
  gekoppelt, 300-m-Reliefband mit Warnung, Etappenmarker auf der Karte deutlich anders als
  Zeitmarken, Ballastmodell mit 100 % Füllung).
* Tests: calc 197, Smoke (Lightbox im Editor, Aerostatik-Karte), Gasballon-Prüfung A3.
* **Wording:** in der App heisst es durchgehend «Nutzer» statt «Benutzer» (Einstellungen, Liste, Meldungen, Doku).

## 0.11.3 — 2026-10-05 · Kopie ab Schritt 1 · NVFR-Schalter · Niveauliste · Sortierung · Tragkraft-Grafik

* **Kopie eines (gesperrten) Briefings** beginnt den Ablauf wieder bei Schritt 1; Nicht-Zeitabhängiges
  bleibt (Ballon, Startort, PIC, Pax, Nachfahrer, Fahrtabsicht, Ausrüstung, Absprachen, Flugplan-
  Einstellungen), Zeitabhängiges steht auf Vorgabe (Datum morgen 06:30, Anlass leer, Startplatzwerte
  15 °C/1013 hPa manuell, Tagesplanung neu, Meteo-Panels leer).
* **«Wo und wann»:** liegt die Startzeit vor BCMT oder die Landung nach ECET, erscheint der Schalter
  **«NVFR zulassen»**; eingeschaltet macht er den **Flugplan (C) verbindlich** (Pflicht-Markierung,
  Schalter «Flugplan erstellen» fest ein, Panel gilt erst mit erstelltem Flugplan als erledigt) und setzt
  die Nachtausrüstung. Derselbe Schalter wie «NVFR» in Schritt 1.
* **Trajektorien:** Klick ins Niveaufeld öffnet eine senkrechte Liste der verfügbaren Niveaus (SFC,
  500–3000 ft AGL, 2000–10000 ft, FL100–FL150) zum An-/Abwählen; eigene Werte weiterhin tippbar.
* **Liste:** Sortierung über die Spaltenköpfe (▲/▼), Standard Ordnungsnummer absteigend (jüngste
  zuoberst); **Doppelklick** auf eine Zeile öffnet die Briefingsicht.
* **A3 Tragkraft:** Eingabe heisst **«Max. Hüllentemperatur»** mit der Vorgabe des Ballons
  («Vorgabe HB-QWZ: 110 °C»); der Wert ist je Ballon in den Stammdaten einstellbar (ohne
  Expertenmodus, neben MTOM). Grafik Tragkraft/Höhe: **Obergrenze** als rote Linie mit Beschriftung
  «Obergrenze (Hülle 110 °C): 3 450 m», Bereich darüber schraffiert, Startplatzhöhe grün, Zwischen-
  einheiten auf beiden Achsen (500 m, ¼-Schritte der kg-Skala).
* **Konzept 0.12:** `docs/Aerostatik_Gasballon.md` – Grundlagen der Gasballon-Aerostatik aus
  Emden (DFSV-Handbuch 2.10) und «Gone with the Wind» Kap. 4 als Basis des Ballastmodells;
  Skizze des Höhenprofil-Werkzeugs überarbeitet (gefahrene Distanz, Steig-/Sinkraten mit
  Farben, Menüs für Punkte und Etappen, Schichtmächtigkeiten, aerostatisches Ballastmodell).
* **Symbolsatz «Linie»** (Option A der Vorlage `00_Konzept/Icon-Set_Vorschlaege.html`): alle
  Bedienelemente mit einheitlichen SVG-Symbolen (24 × 24, Strich 2 px) statt Emoji – Menü, Drucken,
  Bearbeiten, Briefingsicht, Duplizieren, Löschen, Eigener Text (blau), Kommentar PIC (gelb), KI
  (violett), Aktualisieren, Schliessen, Ort wählen, Sperre, Freigabelink, Sortierpfeile, Griff.
  Gleich auf Windows, iPad und im Druck (`js/ui/icons.js`).
* **A1 Stammdaten:** Hüllenbild rechts im Datenfenster statt im Panelkopf (Erarbeitung und
  Briefingsicht).
* Mobil: Niveaufeld und Titelzeile der Briefingsicht umbrechen, Seite nie breiter als der Bildschirm.

## 0.11.2 — 2026-10-05 · Liste · Editor-Struktur · METAR/TAF · Lightbox · Kopfzeile · NOTAM-Quelle

* **Liste** kompakt: kleinere Schrift, je Zelle höchstens zwei Zeilen (Höhe «467 m» und Kennung
  ohne Umbruch), Spalte **«#»** mit 🔒 hinter der Nummer bei gesperrten Briefings, **«Status»**
  (in Arbeit NN % / Final vN, darunter die Phase) und **«Letzte Änderung»** (vN · Datum · Bearbeiter,
  dazu 🔗 n aktive Freigabelinks – die bisherige Spalte «Links»). Aktionen als Symbole in einer
  Zeile: ✎ Bearbeiten (bei Sperre stattdessen 👁 Briefingsicht), ⧉ Duplizieren, 🗑 Löschen.
* **Bearbeitungsstand «vN»** zählt neu Bearbeitungssitzungen statt Speichervorgänge: +1 beim ersten
  Speichern nach dem Öffnen der Erarbeitung, nach einer Freigabe und nach einem Final-PDF.
  Bestand übernimmt den bisherigen Zähler (Worker-Spalte `edition`, Feld `b.edition`).
* **Erarbeitung:** Knopf «Alle verfügbaren Daten aktualisieren» über dem Abschnitt A; Abschnittstitel
  A–D markant (Kennbuchstabe, Balken); D heisst **«Crew-/Pax-Briefing»**; linke Navigation als
  **Akkordeon** – nur der Abschnitt der gerade bearbeiteten Stelle ist offen (folgt dem Scrollen und
  dem Fokus), selbst geöffnete Abschnitte bleiben offen.
* **Zusatzboxen je Panel:** «Eigener Text / Bilder einfügen» und «Zusatzinfo (eigene Recherche)»
  sind zu **«Eigener Text / Bilder / Daten»** (blau) zusammengelegt, dazu **«Kommentar PIC»** (gelb).
  Beide erscheinen nur mit Inhalt oder nach Klick auf die Symbolknöpfe 📝/💬 im Panelkopf (unter
  KI-Kommentar/Quelle). Ausnahme: Panels mit Einfügepflicht (LINK + EINFÜGEN) behalten das Feld
  «Bericht / Daten einfügen». Bestehende eigene Texte/Bilder in Auto-Panels wandern in die Zusatzbox.
* **METAR/TAF:** Klartext beginnt mit «METAR LSZH …» bzw. «TAF LSZH …»; hinter der Zeit steht das
  Alter **«(vor 0:30 h)»**; Änderungsgruppen (→ BECMG/TEMPO/PROB) ohne Aufzählungspunkt, da sie
  sich auf die Punkte davor beziehen.
* **Briefingsicht:** Klick auf Grafiken, Bilder und Tabellen öffnet eine **vergrösserte Ansicht**
  (Popup mit ✕, Escape); Kopfzeile typographisch neu – eine Schriftfamilie, links Datum · Ort und
  Ballonzeile, rechts Logo, Titelzeile, letzte Änderung, Status (die Titelzeile erbte bisher eine
  SVG-Achsenklasse `.tl` → Monospace).
* **SondeHub:** Startort der Sonde mit Ortsname; im Ausland mit Kfz-Länderkennzeichen («D-Stuttgart»).
* Begriff «grenzwertig» → **«marginal»** (Ampel, Tabellen, KI-Prompts).
* KI-Zusammenfassung (rechte Spalte): Knopf in der KI-Farbe mit «direkt erstellen» und «…»
  (Prompt zuerst anpassen) wie in den Panels.
* **NOTAM: autorouter als zweite Quelle.** Zugänge «autorouter Benutzer/Kennwort» (Einstellungen →
  Zugänge); dann werden NOTAM je FIR der Fahrt (Startort, Landeraum, Lufträume) über
  `api.autorouter.aero` geholt und auf den Umkreis gefiltert; FAA bleibt Rückfall (mit einem
  Wiederholungsversuch). Länder-Matrix nennt die FIR-Kennungen (CH LSAS, DE EDMM/EDGG/EDWW, …).

## 0.11.1 — 2026-10-05 · Länder-Matrix · DWD-Dämmerungszeiten · Rückmeldungen

* **Länder-Matrix** (Einstellungen → Experte): je Land (CH, LI, DE, AT, FR, IT, übrige) amtliches
  Flugwetter mit Zugang, Modell, Luftraum/NOTAM, DABS-Pflicht, Sonnenquelle, Flugplan, Kontakte und
  Pflichtpunkte je **Rolle der Fahrt (Start, Überflug, Landung)**; eigene Notizen je Land werden
  gespeichert. Deutschland nach dem Vorbild GaforCast (DWD über GAFOR-Gebiete), Schweiz mit DABS
  (vorgeschrieben) und RAC 4-4, übrige Länder mit Open-Meteo/openAIP/FAA-NOTAM. Stammdaten A1 zeigen
  die Zeile **«Länder (Rolle)»**, z. B. «CH (Start) · AT (Überflug) · DE (Landung)».
* **Deutschland: Dämmerungszeiten amtlich aus dem DWD-Ballonwetterbericht** des Gebiets
  («Astronomische Angaben», UTC → LT), sobald das Panel B «Ballonprognose» geladen ist und der Bericht
  den Fahrttag abdeckt; A2 nennt die Quelle «amtlich (DWD … Gebiet NN)». Sonst wie bisher berechnet.
* HB-QWP: MTOM 950 kg nach BAZL-Register (bisher 883; gespeicherte 883 werden angehoben).
* Modell (Gasfahrt-Planung): Ballast in kg; Etappen-Briefings mit Meteo + Luftraum/NOTAM/FIR;
  Relief über Open-Meteo-Elevation (weltweit) – festgehalten für 0.12.

## 0.11.0 — 2026-10-05 · Ordnungsnummer · Fortschritt · Sperre nach der Fahrt · Kopfzeilen

* **Ordnungsnummer `JJJJ-NNN`** je Briefing (Jahr des Fahrtdatums, laufend je Jahr; Server-Modus:
  zentraler Zähler in D1, eindeutig über alle Benutzer; lokaler Modus: Browser). Anzeige in der
  Liste (eigene Spalte, suchbar), in den Stammdaten, in der Kopfzeile und auf allen Ausdrucken als
  rechtsbündige Titelzeile **«Fahrtbriefing · 2026-017 · HB-QWZ · Start: Di 06.10.2026, 06:30 –
  Oberlunkhofen AG»**; darunter **«Letzte Änderung: Datum Zeit · Bearbeiter»**. Dateinamen von
  PDF (Server-Render), JSON-Export, Kalender (.ics) und FPL-Text beginnen mit der Nummer. Bestand
  wird beim ersten Aufruf nach dem Update nach Startzeit durchnummeriert (Worker-Migration, neue
  Spalten `no`, `progress`, `end_ms`).
* Liste: Status **«in Arbeit NN %»** (Anteil gefüllter sichtbarer Panels) statt «Entwurf»; finale
  Briefings zeigen nur **«Final vN»**; Phase «läuft» heisst «Fahrt läuft».
* **Sperre nach der Fahrt:** liegt Start + max(6 h, Fahrtdauer + 2 h) zurück, bleibt das Briefing
  unverändert – Erarbeitung und Wizard leiten auf die Briefingsicht um, dort Hinweis mit
  **«Kopieren und neu anlegen»** (neue Nummer, Datum +7 Tage). 🔒 in der Liste und Kopfzeile.
* Briefingsicht: rechts oben Logo, darunter Titelzeile, letzte Änderung, Status; Pax-Blatt ebenso.
* **Panel-Köpfe einheitlich:** links Nummer + Titel und darunter immer «Stand: …» (oder «noch nicht
  bearbeitet»), rechts Kennzeichen + KI-Knöpfe und darunter rechtsbündig der Quell-Link.
  KI-Knopf **«erneuern» violett schraffiert**, «KI-Kommentar» (neu) wie bisher.
* Rechte Spalte: **«Einschätzung/Modellsicht»** (bisher «Tendenz (Modell)»), Wertung in normaler
  Schriftgrösse mit horizontal ausgerichtetem Punkt; zuunterst Karte **«Zusammenfassung»** mit
  Knopf «KI-Zusammenfassung erstellen/erneuern» (Gesamteinschätzung) und Text.
* Stammdaten A1: Zeile **Ordnungsnummer**; **«2 Pax: Name (70 kg), Name (85 kg)»** (Gewicht aus
  dem Briefing, sonst Normgewicht); oben Knopf **«Alle verfügbaren Daten aktualisieren»** (alle
  automatischen Panels, ohne KI-Kommentare) mit Status.
* METAR/TAF kompakter: ohne Zeilen «METAR», «TAF», «Klartext»; Stationsnamen mit ICAO-Abkürzungen
  (AP, INTL, AB, AFLD statt «Arpt»).
* **BAZL-Registerdaten** der vier Ballone (Luftfahrzeugregister, Stand 05.10.2026) in den Stammdaten:
  24-bit-Adresse (HB-QWP 4B2C8B, HB-QWZ 4B2C95, HB-QPJ 4B2BCF, HB-QWV 4B2C91), Muster (HB-QWP
  = Schroeder Fire Balloons G 34/24, bisher falsch «BB34Z»; Wörner NL-STU/1000), Hersteller, S/N,
  Baujahr, MTOM, MOPSC, TCDS, ARC gültig bis (als Dokument «Lufttüchtigkeitszeugnis (ARC)» mit
  Ablaufdatum). Bestehende Einstellungen werden beim Laden ergänzt (alter Hexcode «4c4b4» ersetzt);
  CODE/ im Flugplan erscheint damit automatisch.
* Flugplan: RMK/ bei Ausbildung **«TRG FLT»**, bei Examination **«SKILL TEST»** (getrennt einstellbar).

## 0.10.2 — 2026-10-05 · skybriefing-Importformat · Rückmeldungen 0.10.0/0.10.1

* **Flugplan:** ICAO-Nachricht exakt im Format des skybriefing-Imports («Flightplan and Briefing →
  Flight Plan import», Text einfügen → Import): Felder 7–18 je Zeile mit «-», Feld 19 als Zeile
  `-E/ P/ R/ S/ J/ D/`, danach `A/`, `N/`, `C/` je eigene Zeile, Klammer zu am Schluss (wie die
  skybriefing-Beispiele). Der XML-Export entfällt (skybriefing nimmt nur ICAO-Text).
* Nach AIP Schweiz ENR 1.10 (Flight Planning): **RMK/TRAINING FLT** bei Ausbildung, **RMK/TRAINING FLT
  SKILL TEST** bei Examination (Texte in den Einstellungen → Flugplan anpassbar; NVFR bleibt davor);
  **CODE/** mit der 24-bit-Adresse, wenn beim Ballon ein vollständiger 6-stelliger Hexcode hinterlegt
  ist (Reihenfolge TYP/ CODE/ ALTN/ RMK/); Hinweis im Panel und in der Briefingsicht zum **Schliessen
  des Flugplans** nach der Landung (ARO 0800 437 837) sowie zu DLA/CHG/CNL.
* **DEP/ DEST/ behalten das Kantonskürzel** als eigenes Wort («BUELACH ZH», «OBERLUNKHOFEN AG»).
* **Flugart (Feld 8) je Fahrttyp** in den Einstellungen → Flugplan auch für **Ausbildung** und
  **Examination** (Standard G; Examination ist weiterhin ein eigener Fahrttyp neben privat/gewerblich).
* **Standardradien:** Beobachtungen 75 km (bisher 50), SondeHub-Sonden 250 km (bisher 150); gespeicherte
  alte Standardwerte werden beim Laden angehoben, abweichende eigene Werte bleiben.
* **Hüllenbild:** quadratischer **Mittenausschnitt ohne Verzerrung** (192 px); Anzeige 64 px im Titel
  der Erarbeitung und **im Wizard Schritt 1 neben der Ballonwahl**, 2 × 2 cm in Briefingsicht, Druck
  und Pax-Blatt.

## 0.10.1 — 2026-10-05 · Hüllenbild · Muster bei Gashüllen · Panel-Tabelle

* Einstellungen → Ballone: **Bild der Hülle** je Heissluftballon und Gas-Hülle («Bild wählen …»,
  wird auf 192 px verkleinert als JPEG in den Stammdaten gespeichert, «Bild entfernen»). Das Bild
  erscheint **2 × 2 cm** im Titel des Panels A1 «Stammdaten» (Erarbeitung, Briefingsicht, Druck)
  und links oben im **Pax-Info-/Sicherheitsblatt**. Neue Briefings tragen das Bild als
  Schnappschuss; ältere Briefings zeigen das aktuelle Bild aus den Stammdaten.
* Gas-Hüllen zeigen in der Kartenüberschrift das **Muster nach der Kennung**
  («HB-QPJ · NL/STU-1000»), wie die Heissluftballone.
* Einstellungen → Panels & Pflicht: **kompakte Tabelle je Abschnitt** mit **Panel-Nummer wie im
  Briefing** (A1, A2 … D3), Kennzeichen fix/CH/AUTO und Spalten «ausblenden» / «Pflicht» als
  Häkchen; ausgeblendete Panels erhalten keine Nummer, die übrigen rücken nach.

## 0.10.0 — 2026-10-05 · ICAO-Flugplan aus dem Briefing · Wetterstationen · SondeHub

* Panel **C «Flugplan»**: Schalter «Flugplan erstellen?» (Standard ja bei NVFR, Grenzüberschreitung
  oder Gasfahrt) und **«Aus Briefing erzeugen»** – füllt den ICAO-Flugplan nach den vier
  skybriefing-Mustern (HB-QPJ):
  * 7 Kennung (ohne Bindestrich) · 8 V + Art des Flugs (gewerblich N, privat G; Einstellungen) ·
    9 ZZZZ/L · 10 Ausrüstung/Überwachung (z. B. GY/E, GY/EB1; je Ballontyp) ·
    13 ZZZZ + EOBT UTC aus der Startzeit · 15 Geschwindigkeit (Gas N0025, Heissluft N0015), Höhe
    als Flugfläche aus der Maximalhöhe (ab 5000 ft, sonst VFR) und Route
    `DRIFTING NW LATER NNW THEN NE FROM <DEP> TO <DEST> [VIA …]` (Richtungswörter aus der
    mittleren Trajektorie, VIA frei) · 16 ZZZZ + Gesamt-EET aus der Fahrtdauer, ALTN ZZZZ (Gas:
    zwei) · 18 `DEP/<ORT> <KOORD> DEST/… DOF/ EET/<FIR><HHMM> … TYP/ ALTN/UNKNOWN RMK/NVFR CREW
    CONTACT …` – **EET/ je FIR aus der FIR-Folge der Luftraumanalyse** (FIR-Namen → ICAO-Codes,
    Tabelle Europa; Eintrittszeit ab EOBT aus den Trajektorien) · 19 E/ Autonomie (Gas aus
    Einstellungen, Heissluft aus der Treibstoffrechnung), P/ Personen (PIC + Pax), R/ S/ J/ D/
    (Einstellungen), **A/ Farbe aus dem Ballon** (neu bei Heissluft und Gas-Hülle), N/ und RMK/
    aus Vorlagen mit {picPhone} {satphone}, C/ PIC «NACHNAME VORNAME».
  * Formular mit allen Feldern (editierbar), Plausibilitätsprüfung, **ICAO-Nachricht** (Doc 4444,
    Feld 19 als Zusatzzeile), **Kopieren**, **Download .txt (ICAO-Text) und .xml**; Briefingsicht
    und Druck zeigen Kurzformular und Nachricht.
  * Neue Einstellungs-Seite **«Flugplan»** (Art des Flugs je Fahrttyp, Ausrüstung, Flugflächen-
    Schwelle, Satellitentelefon, Farbe, PIC-Namensform, Vorlagen RMK/ und N/, je Ballontyp
    Geschwindigkeit/Autonomie/TYP/, Feld-19-Ausrüstung).
  * Unverifiziert: das skybriefing-Importformat («ICO» / XML) ist öffentlich nicht dokumentiert –
    das XML folgt einem einfachen eigenen Schema; bitte mit einer Datei im Import prüfen.
* Panel **B «Beobachtungen (Wetterstationen)»** (bisher Einfügen): **Wetterstationen im Umkreis
  des Startorts** (Standard 50 km, im Panel einstellbar) wie in cockpit.wicki.aero – SwissMetNet
  (MeteoSchweiz via api.existenz.ch), DWD (Bright Sky) und übriges Europa EUMETNET
  MeteoGate/E-SOH; Tabelle mit Richtungspfeil · km · Beobachtungszeit · Wind/Böen kt (rot ab 14 /
  20 kt) · T/Td · RH · QNH · Niederschlag; Worker-Route `GET /api/wx/stations`.
* Panel **Temps**: zusätzlich die **nächste Live-Radiosonde aus SondeHub** (Amateurempfang, letzte
  12 h, Umkreis 150 km einstellbar) als drittes Stüve mit Tabelle: Temperatur/Feuchte vom
  Sondensensor, Wind aus der Drift je 200 m, Druck gemessen oder aus der Höhe gerechnet
  (Worker `GET /api/wx/sondes`, `/api/wx/sonde?serial=`). radiosondy.info hat keine
  dokumentierte Schnittstelle – nicht angebunden.
* **Vertikalprofile: Wolkenschichten rötlich** (RH ≥ 95 %), feuchte Schichten weiter blau
  (RH ≥ 85 %); Legende unter dem Modellprofil.
* **Radar-Karte: Klick auf eine Sonde** verkleinert die Karte nach links (Ausschnitt um die Sonde)
  und öffnet rechts ein Fenster mit Emagramm, Kopfdaten und Tabelle der Sonde (✕ schliesst).
* Tests: 147 Rechentests (FIR-Codes, Namen, Telefon, Flugfläche, vollständige Nachricht gegen das
  Muster, XML, Heissluft-Variante); Smoke-Test erzeugt den Flugplan und prüft die Nachricht;
  API-Test prüft die neuen Routen.

## 0.9.2 — 2026-10-05 · Rückmeldungen zu 0.9.1 und vierte Liste (Teil 1)

* Tagesplan: **Dauer der Ballonfahrt** in der Tabelle schreibt zurück nach «Was ist geplant»
  (eine Quelle); **Plausibilitätswarnungen** zur Reihenfolge (z. B. «Bergung» vor «Landung»,
  «Start» nach «Landung»); **Treffpunkt-Auswahl in der Spalte «Ort»** (Dropdown der Treffpunkte aus
  dem Stamm, «anderer …» per Ortswahl, ✎ zum Ändern) – kein Namensfeld mehr unter der Aktivität;
  **Zeilen-Schattierung nach Dämmerung** (dunkel = vor BCMT / nach ECET, hell = BCMT–SR bzw.
  SS–ECET; Legende unter der Tabelle; auch in der Briefingsicht und im Druck).
* **Aktivitäten unter Experte definierbar**: eingebaute ein-/ausblenden und Standarddauer ändern,
  eigene Aktivitäten (DE/EN, Dauer, mit/ohne Ort); Start, Fahrt (Ballon) und Landung bleiben fix.
* **Minder-/Mehrgewicht** neu gegenüber dem **zulässigen Startgewicht = Tragkraft am Startplatz
  (Hüllentemperatur), höchstens MTOM**; die massgebende Grenze wird angezeigt (Ablauf Schritt 4,
  Panel Tragkraft, Briefingsicht). Die Excel-Vergleichstests prüfen weiterhin den MTOM-Bezug.
* **Panel-Nummerierung A1–An, B1–Bn, C1–Cn, D1–Dn** (Titelbalken, linke Navigation, Briefingsicht);
  Nummern folgen der sichtbaren Reihenfolge.
* **Tracker-Links je Ballon** (Heissluft und Gas-Hülle, Einstellungen → Ballone) statt je Person;
  Passagierkarte nimmt die Links des Ballons (Rückfall: PIC). Neu beim Ballon: **Farbe (Hülle)**
  für den Flugplan.
* Einstellungen: **Zurück-Knopf (←)** in der Kopfzeile führt an die Stelle zurück, von der man
  gekommen ist; **«Speichern» ist ein Umriss** und füllt sich erst nach einer Änderung;
  **JSON-Untermenü im Hamburger** (über «Einstellungen»): Import JSON / Export JSON der Einstellungen.
* «Was ist geplant»: **Zielrichtung** beim Setzen des Zielpunkts neu als
  `Ort · W266° · 25 km · ~1:30 h · ⌀ 1200 m AMSL` – Fahrzeit und mittlere Fahrthöhe (konstante
  Höhe) aus den beiden nächsten Trajektorien links und rechts des Ziels, nach Querabstand
  gewichtet (`>` wenn das Ziel jenseits der Bahnenden liegt); **dieselbe Zeile im Panel
  Trajektorien** rechts der Legende.
* **KI-Kommentar** bei «Stammdaten» und «Astronomische Daten» (neuer Name für
  «Sonnenauf-/untergang») ausgeblendet.
* **DABS** nur, wenn die Fahrt die Schweiz berührt (Startort, Landeraum, FIR-Folge der
  Luftraumanalyse oder Trajektorienpunkte in der Schweiz) – nicht mehr nur bei Schweizer Startort.
* **Flugplan-Panel mit Schalter «Flugplan erstellen?»** – Standard «ja» bei NVFR, Grenzüberschreitung
  (Länder entlang der Fahrt) oder Gasfahrt, sonst «nein»; Begründung wird angezeigt. Die
  automatische Erstellung folgt in 0.10.0.
* METAR und Radiosondierung: **Richtungspfeil vor der km-Distanz**.
* Tests: 135 Rechentests (DABS-Regel, Panel-Nummern, Zielschätzung, Reihenfolge-Warnung),
  Smoke-Test prüft Nummerierung, Astronomie-Panel ohne KI, Flugplan-Schalter, Zielzeile,
  Einstellungen (Zurück, Speichern-Zustand, Tracker beim Ballon, JSON-Untermenü).

## 0.9.1 — 2026-10-04 · Dritte Rückmeldungsrunde (Teil 2): tabellarischer Zeitplan

* **Tagesplanung als Tabelle** (Ablauf Schritt 5, Panel «Zeitplan» in der Erarbeitung): je Zeile
  **Zeit · Aktivität (Dropdown) · Info · Dauer (min) · Ort**. Aktivitäten: Treffpunkt, Fahrt,
  Ankunft Startplatz, Aufrüsten, Füllen, Reserve, Briefing, Start, Fahrt (Ballon), Landung,
  Bergung, Rückfahrt, Verpflegung, Tanken, Sonstiges. Zeilen **per Ziehen oder ▲▼ verschieben**,
  hinzufügen (+ Zeile), löschen (✕) – **die Zeiten laufen mit**: Anker ist die Zeile «Start»
  (= Startzeit des Briefings); danach Zeit + Dauer vorwärts, davor rückwärts (Zeile = nächste
  Zeit − eigene Dauer), Rundung auf 5 min. Zeit tippen = Pin (gestrichelt, ↺ löst ihn).
* Orte: Treffpunkt/Fahrt/Rückfahrt/Verpflegung/Tanken/Briefing/Sonstiges mit Ortswahl (📍/✎);
  Ankunft = Startplatz und Landung = geplanter Landeraum aus dem Briefing. **Fahrten werden
  geroutet** (OSRM, Anhängerfaktor + Zuschlag), sobald Ort davor und danach bekannt sind
  (gestrichelte orange Dauer = Routing; manuell überschreibbar, «Neu rechnen» setzt zurück).
* Fahrtdauer der Ballonfahrt aus «Was ist geplant» (in der Zeile überschreibbar); Ballonwechsel
  im Ablauf passt Aufrüstzeit an und blendet die Füllzeile (Gas) ein/aus. «Vorlage neu» baut die
  Tabelle aus den Stammwerten neu (zweistufiger Knopf, kein Browser-Dialog).
* Bestehende Briefings werden beim Öffnen in die Tabelle überführt (Etappen → Treffpunkt/Fahrt,
  Puffer → Reserve, alte Pins bleiben); Pax-Karte, Kalender (ICS), Crew-Nachricht und
  Briefingsicht lesen aus der Tabelle (Crew-Nachricht mit Maps-Links aller Zeilen mit Ort).
* Briefingsicht: Zeitplan mit Dauer und Koordinaten/Maps-Link je Zeile mit Ort.
* Layout: breite Tabelle im Ablauf (Schritt 5 nutzt die volle Breite); in schmalen Spalten
  (Telefon, iPad hochkant, Panel neben der Seitenspalte) wird jede Zeile dreizeilig
  (Zeit/Aktivität/Dauer – Info – Ort).
* Tests: `buildPlan`/`planTemplate`/`planToStops` (127 Tests), Smoke-Test prüft Tabelle,
  Verschieben mit angepassten Zeiten und Zeile hinzufügen.

## 0.9.0 — 2026-10-04 · Dritte Rückmeldungsrunde (Teil 1)

* **KI-Kommentar** in jedem Panel-Titelbalken (Server-Modus mit KI-Freigabe): Klick erzeugt den
  Kommentar direkt (ohne Prompt-Maske) und zeigt ihn unter dem Panelinhalt; «…» daneben öffnet
  die Prompt-Maske zum Anpassen. Prompt enthält den Panelinhalt (inkl. hochgeladener Zusatzinfos
  und Bilder) **und die Gesamtlage** des Briefings (übrige Panels gekürzt) mit Bezug auf das
  Thema des Panels; Fokus auf Besonderheiten und ballonfahrtspezifische Warnungen/Hinweise.
  Kommentar als Text (✎ bearbeiten, ✕ verwerfen).
* Kopfzeile: Pille nur Briefings / Neues Briefing; **Einstellungen, Berechtigungen und «Mehr» als
  Untermenüs im Hamburger** (offene Untermenüs bleiben beim Autosave offen); **Drucken als
  Symbolknopf** rechts von «Freigeben».
* **Druckdialog**: nur Briefing, zusätzlich DABS-Beilage, NOTAM, «Passagier Info-/
  Sicherheitskarte» (Titel unter Experte überschreibbar, DE/EN); die Passagierkarte wird als
  A4-quer-Seite an das Briefing angehängt.
* Abschnitt C: **Flugplan nach dem NOTAM**; NOTAM wahlweise **Strecke** (Start → Landeraum →
  Trajektorien-Enden) oder **Umkreis um Orte** (Ortswahl, Standard Startort, Radius 200 km;
  Kreise > 100 NM werden mit 7 Teilabfragen abgedeckt).
* Radar-Karte: **Klickboxen rechts** für Regen (RainViewer), Webcams, Sonden (SondeHub:
  Startplätze im Umkreis 250 km und Sonden der letzten 6 h); «Zoom level not supported»
  behoben (RainViewer-Kacheln ab Zoom 7 hochskaliert, Karte bis Zoom 14).
* Temps: zusätzlich die **letzte Radiosondierung** der nächsten Station (Payerne 06610,
  Stuttgart, München, Wien, Milano …) als zweites Stüve-Diagramm mit Tabelle der
  Hauptdruckflächen (Worker `GET /api/wx/sounding?stn=`, Archiv University of Wyoming –
  dieselbe Messung wie das MeteoSchweiz-Emagramm, das nur per JavaScript geliefert wird).
* Druckdifferenz: ΔP-Zellen **orange ab 3 hPa, rot ab 4 hPa** in der Warnrichtung des Paars
  (Zürich–Lugano: Südüberdruck; Genève–Güttingen: Bise); Schwellen unter Experte.
* Thermik: Tabelle kompakt ohne horizontales Scrollen, daneben Balken je Stunde in derselben
  Zeilenhöhe.
* Layout: Panel-Titelbalken einheitlich zweizeilig hoch; alle Eingabefelder/Knöpfe in den
  Panel-Werkzeugleisten 30 px hoch, Trajektorien-Eingaben in einer Zeile; linke Panel-
  Navigation und rechte Spalte scrollbar; Pflicht-Inhalte im Ablauf fett in normaler Grösse.
* Offen → 0.9.1: tabellarischer Zeitplan.

## 0.8.1 — 2026-10-04 · Rückmeldungen zu 0.8.0

* Luftraum-Panel: nur Typ und ICAO-Klasse (keine Erklärtexte; Zusatzcodes NOTAM/REQ/AGRMT,
  Squawk und Frequenz klein unter dem Namen); reine Klasse-E/G-Lufträume werden nicht
  gelistet (TMZ, RMZ, ATZ, R/D/P usw. unabhängig von der Klasse schon). **Warnungen**: Startort
  liegt in einer CTR/ATZ; TMA/CTA (Klasse A–D) mit Untergrenze weniger als 900 ft über dem
  Startort (Schwelle unter Einstellungen → Experte); Landeraum in CTR als Hinweis. FIR-Folge
  mit Zeit ab Start (+h:mm) für das spätere EET im Flugplan.
* Schritt 1: **NVFR-Schalter** in der Zeile «Typ der Fahrt» (bewusst geplante Nachtfahrt):
  unterdrückt die Nacht-Warnungen (Ort & Zeit, Fahrtabsicht, Tagesplanung, Briefingsicht),
  zeigt stattdessen «NVFR geplant», setzt die Nachtausrüstung (NVR) in der Spezialausrüstung.
  Die Tag/Nacht-Wahl in der Fahrtabsicht entfällt (alte Briefings: «Nacht»/«Tag und Nacht» →
  NVFR).
* Schritt 3: Trajektorien-Karte mit **allen Niveaus** (Legende, Stundenpunkte); Niveaus-Feld
  über der Karte, Änderungen an Niveaus/Dauer zeichnen neu.
* Schritt 2: «Als Favorit speichern» erscheint nicht mehr, wenn ein Favorit gewählt ist.
* Schritt 4: Kästchen PIC/Nachfahrer unten bündig; Vorschau zeigt Personenzahl und
  Personenmasse; Normgewicht-Rückfall 85 kg, falls ein Ballon-Stammsatz keines hat.
* Textumbruch: Silbentrennung (lang=de/en) statt willkürlicher Trennung mitten im Wort; lange
  Beschriftungen mit weichen Trennstellen (Hüllen·temperatur, Treibstoff·reserve …).

## 0.8.0 — 2026-10-04 · Luftraum entlang des Fahrtwegs

* Neues Panel «Luftraum entlang des Fahrtwegs» (Abschnitt C, vor DABS): Lufträume aus
  openAIP für die berechneten Trajektorien — je Luftraum *durchfahren* (Bahn innerhalb und
  Untergrenze unter der geplanten Maximalhöhe; km ab Start und ETA je Bahn), *nahe* (im
  Korridor, Standard 5 km, Einstellungen → Meteo) oder *oberhalb der Maximalhöhe*
  (eingeklappt); Typ und ICAO-Klasse, Unter-/Obergrenze (GND/AGL/ft/FL), Hinweis je Typ
  (CTR-Freigabe, Transponder, Hörbereitschaft, Aktivierung per NOTAM, Frequenzen);
  FIR-Folge je Bahn mit Wechselpunkt (km, LT) als Vorarbeit für den Flugplan; Karte mit
  Polygonen und Bahnen (Bildschirm, mit openAIP-Overlay) und Nord-oben-Skizze (Druck);
  Text für KI-Hinweis und Leselink. Lädt im Server-Modus von selbst nach den Trajektorien.
* Worker `GET /api/wx/airspace?bbox=…` (openAIP Core API, Schlüssel `openaip` unter Zugänge
  oder Kachel-Schlüssel der Overlay-URL, 6 h Cache); Analyse im Browser
  (`js/calc/airspace.js`, 12 neue Tests).
* SETUP: Anleitung für den openAIP-Schlüssel.

## 0.7.1 — 2026-10-04 · Antworten auf die offenen Fragen

* Webcams europaweit automatisch: der Worker sucht Kameras im Umkreis des Startplatzes
  (und des Landeraums, wenn er weiter weg liegt) in öffentlichen Quellen — Windy
  Webcams API v3 (Schlüssel «Windy Webcams key» unter Zugänge, Vorschaubild im Popup)
  und OpenStreetMap/Overpass (ohne Schlüssel, als Webcam erfasste Punkte mit Adresse);
  Umkreis in Einstellungen → Meteo (Standard 40 km), eigene Liste bleibt zusätzlich;
  Radar-Panel mit aufklappbarer Liste (Distanz, Ort). `GET /api/wx/webcams?lat&lon&km`.
* Grosswetteranalyse: Österreich über die ORF/GeoSphere-Prognoseseite (geprüft);
  MeteoSchweiz und Aeronautica Militare liefern ihren Text nur per JavaScript —
  Einträge ohne «abrufen» erscheinen im Panel als Link; Haken «abrufen» je Eintrag.
* Thermik-Klassen (w*-Grenzen und Einsetzen) unter Einstellungen → Experte
  einstellbar, Standard wie bisher (0.6 / 1.2 / 2.0 / 3.0, Einsetzen 1.0 m/s).
* SETUP: Anleitung für den Windy-Webcams-Schlüssel.

## 0.7.0 — 2026-10-04 · Zweite Rückmeldungsrunde

* Tagesplanung neu: Etappen (mehrere Treffpunkte/Zwischenhalte) mit «+», Ort, Fahrzeit
  je Etappe (Routing), Umsortieren per Ziehen oder ▲▼; Zeiten rückwärts vom Start,
  jede Zeile pinbar (Ankunft ändern → Treffpunkte rückgerechnet, ↺ hebt Pin auf);
  Ablauf und Erarbeitung teilen denselben Editor.
* Einheitliches «+»-Kästchen hinter der Beschriftung für neue Einträge (Nachfahrer, Pax,
  Etappen, Dokumente, alle Stammlisten in den Einstellungen).
* Ablauf: «Wer ist dabei?», «Pflicht-Inhalt», Vorschau Tragkraft zweizeilig mit 2×4
  Werten (Propan-Bedarf, Fahrdauer m/Reserve, Treibstoffreserve), Schritt 6 Karten
  direkt untereinander in zwei Spalten, Sonnen-Label «amtlich (LSAS, RAC 4-4)».
* Tragkraft-Panel: Resultat Höhe/Hüllentemperatur als 2×3 Felder links, Kurve rechts
  klein; «Propan-Zylinder».
* Ballone: Feld «Muster» (z. B. BB26E) und Transponder-Hexcode, im Briefingkopf als
  «HB-QWZ · BB26E (4c4b4)»; Dokumente je Ballon und Person (Typ aus Standardliste,
  Bezeichnung, gültig bis, Datei PDF/Bild in der Worker-Ablage R2, `POST /api/docs`);
  Standardlisten unter Einstellungen → Experte; abgelaufene Dokumente ⚠ im Stammdaten-
  Panel.
* Panels: Werkzeugleiste einzeilig und klein; Quelle als kleiner Link rechts im
  Titelbalken (gekürzt).
* METAR/TAF: Umkreis direkt im Panel (lädt neu), Richtungspfeil zum Platz,
  Schlechtwetter rot (Wind/Böen ≥ 14 kt, Sicht < 5 km, Niederschlag/Nebel/Gewitter,
  Basis BKN/OVC ≤ 1500 ft, CB/TCU) in RAW und Klartext.
* Temps und Windprognose: Zahlen links, Grafik rechts.
* Trajektorien: Landeraum als grüner Punkt verschiebbar (oder Klick), setzt Landeraum
  und Zielrichtung; Stammdaten-Panel folgt.
* Neues Panel «Thermik»: eigene Abschätzung aus Modellwerten (Globalstrahlung,
  Grenzschicht → w*): Einsetzen, Maximum, Abschwächen, Klasse je Stunde, Fahrtfenster.
* Radar: weiter herausgezoomt, Start und Landeraum markiert, Webcams als Kamera-Symbol
  mit Link (Liste in Einstellungen → Meteo).
* Allgemeine Lage: zusätzlich Grosswetteranalyse des nationalen Dienstes als Text
  (DWD Synoptische Übersicht geprüft; MeteoSchweiz/GeoSphere/Aeronautica Militare als
  Seite + Selektor konfigurierbar, Worker `GET /api/wx/wxtext`).
* Pax-Karte: QR-Code des Google-Maps-Links zum Treffpunkt; Druck A4 quer mit zwei
  A5-Karten nebeneinander (Schnittlinie).
* Fix: ein noch laufender Abruf mit altem Sitzungs-Token beendete eine frische Anmeldung;
  Auto-Laden stoppt beim Verlassen der Sicht.

## 0.6.0 — 2026-10-04 · Rückmeldungen aus dem ersten Einsatz

* Ablauf: ein «Neues Briefing»-Knopf (gefüllt, in der Hauptnavigation); tippen
  ins Ortsfeld (Startort, Treffpunkt) öffnet die Ortssuche direkt; Startplätze in
  den Einstellungen als Heissluft/Gas gekennzeichnet (Favoriten je Ballontyp);
  Start-Ampel (denkbar / marginal / eher ausgeschlossen) sobald Ort und Zeit
  stehen; Trajektorien-Vorschau (Min/Max-Höhe) in der Fahrtabsicht — Klick auf
  die Karte setzt Landeraum und Zielrichtung; Platzhalter in Pax-Feldern
  verschwinden beim Tippen (leer = «Pax n (Name folgt)» im Briefing); mehrere
  Nachfahrer; Tagesplanung «kein Plan anlegen / später».
* Ortszeile (Name · Koordinaten · Höhe · Maps-Link · Ändern) auf einer Zeile,
  Felder darunter unten bündig; Ausgabewerte auf einer Zeile ausgerichtet.
* Tragkraft/Masse: Vorgaben (Eingaben Startplatz, Vorgaben aus Stamm) klar von
  den Resultaten (Masse; Höhe und Hüllentemperatur mit Kurve und Achsen) getrennt;
  «Gasflaschen» → «Gasplanung» (nur Heissluft).
* Fix: Tragkraft-Kurve zeigte statt der Grafik eine lange Zahlenreihe
  (SVG-Namensraum).
* METAR/TAF: alle Plätze im Umkreis (Standard 150 km, Anzahl einstellbar, 0 = alle);
  Rohmeldung und Klartext (DE/EN) nebeneinander, TAF-Gruppen entschlüsselt.
* Trajektorien: Legende Farbe = Höhe; Karte als Standard (Satellit/Basiskarte
  wählbar), Distanzraster-Skizze über Knopf ▦; Skizze im Druck.
* Meteogramm neu: beschriftete Bänder mit Einheiten, Zeitachse mit Tageswechsel,
  Start-/Landemarken, Extremwerte, CAPE-Linie, Legende; Fenster −6/+6 h.
* Automatische Panels laden beim ersten Öffnen alle von selbst (auch DABS,
  Karten, NOTAM soweit freigeschaltet).
* DABS/Karten: kleiner Viewer mit Blättern; Beilagen auf eigenen Seiten im Druck,
  abschaltbar («Beilagen mitdrucken»); geparste Karten nicht mehr gestaucht.
* Briefingsicht: einheitliche Breite aller Abschnitte (Tabellen mit fester
  Spaltenbreite, breite Inhalte scrollen bzw. brechen um).
* Personen: mehrere Tracker-Links je Person (Einstellungen) → Pax-Karte zeigt
  die Links des PIC; Pax-Karte druckt A5 hoch.

## 0.5.2 — 2026-10-04

* Zugänge: Auge zum Anzeigen/Verbergen der Eingabe; bei leerem Feld lädt es den
  gespeicherten Wert nach (`GET /api/secrets/:name`, nur Supermaster, als
  `secret_view` protokolliert). Löschen mit Rückfrage; «Speichern» ohne Änderung
  wird gemeldet.

## 0.5.1 — 2026-10-04

* Material-Links für Externe: Materialeigner ohne Konto sehen über einen Link
  (`#/m/<token>`, 1 Jahr, widerrufbar) alle Briefings mit ihren Kennungen —
  Liste, Briefingsicht, Pax-Karte, nur lesen (Tabelle `material_links`).
* Neue Benutzer ohne «Stamm kopieren von» starten mit dem Beispiel-Stamm der App.
* Fix: Flugwetterprognose DE warf bei GAFOR-Perioden ohne bekannten Code einen
  Fehler (leere CSS-Klasse); `h()` ignoriert leere Klassensegmente.
* Einrichtung ohne lokalen Rechner: GitHub-Workflow «Setup worker» (D1, R2,
  Schema/Migration, Deploy, Secrets, `database_id` und workers.dev-Adresse in
  `js/config.js`); `ENC_KEY` darf jede Zeichenkette ab 32 Zeichen sein.

## 0.5.0 — 2026-10-04 · Mehrbenutzer

* Benutzer mit Rollen Supermaster/Master (Anmeldename + Kennwort, Sitzung je
  Benutzer): eigener Stamm, eigene Briefings, eigenes Kennwort je Master; Zugänge
  (API-Schlüssel) zentral, nur Supermaster ändert sie; Freischaltungen KI/NOTAM/PDF
  je Benutzer.
* Freigaben per Klickbox je Kategorie (Ballone, Personen, Startplätze, Treffpunkte,
  Betreiber); freigegebene Einträge im Ablauf mit Geber; Eigner sieht «Fahrten mit
  meinem Material» lesend (Ballonbuch).
* Supermaster: Benutzer anlegen (Stamm kopieren), Kennwort setzen, deaktivieren,
  Stamm ansehen, Sicht «Alle Benutzer» (nur lesen), Export aller Benutzer,
  Nutzungsstatistik (je Benutzer/Monat, Fahrten je Ballon, Speicher; CSV).
* Worker: Tabellen `users`, `shares`, `usage`; `briefings.owner_id/material_owner`
  (`migrate-0.5.sql`); `/api/me`, `/api/users`, `/api/shares`, `/api/admin/*`,
  `?scope=` für Listen; Mitarbeit-Links und Datenabrufe protokolliert.
* Fix: `aria-pressed` wurde als leeres Attribut gesetzt (Chips ohne Markierung).

## 0.4.0 — 2026-10-04 · Phase 3

* Hauptnavigation Briefings · Neu · Einstellungen in jeder Sicht; Einstellungs-
  Kategorien auf Handy als scrollbare Zeile; Editor/Dialoge auf Handy ohne
  horizontales Überlaufen (Grid-Fix).
* Tendenz (Modell) aus Stundenampel + Go/No-Go-Kriterien; Änderungen seit Final;
  Gesamteinschätzung (KI); Pax-Sicherheitskarte; Crew-Nachricht & .ics; Final-PDF
  (Browser Rendering oder Upload); Export JSON; PWA/Service Worker; Luftraum-Overlay.
* Eigener DWD-/METAR-Abruf (GitHub Action, `scripts/fetch-dwd.mjs` aus GaforCast)
  nach `data/dwd/`; GaforCast-Kopie nur noch als Rückfall.
* Setup-Skripte `worker/setup.ps1` / `setup.sh` (nur noch `wrangler login`).

## 0.3.0 — 2026-10-04 · Phase 2

* Automatische Panels mit Schnappschuss (Stand/Modell/Quelle, Druck, Leselink):
  Meteogramm, Windprofil, Temps (Stüve), Trajektorien (Niveaus, Dauer, Startversatz,
  Skizze + Karte + Tabelle), Ballonprognose (DWD-Gebietsvorhersage DE + eigene
  Stundentabelle mit Ampel), Druckdifferenz (Bise/Föhn), METAR/TAF der nächsten
  Plätze, SIGMET/AIRMET, Flugwetterprognose DE (DWD Flugwetterübersicht + GAFOR),
  Allgemeine Lage (DWD-/ECMWF-Karten als Schnappschuss), Radar live, DABS (PDF →
  Seitenbilder), Strecken-NOTAM (FAA) mit Korridor und VFR-Filter.
* Modell-Leiste (Modellwahl je Horizont, «Alle aktualisieren»), Ampel-Grenzen und
  weitere Vorgaben in Einstellungen → Meteo & Auto-Panels.
* KI-Hinweis je Panel (Prompt sichtbar, Anthropic über Worker, editierbar).
* Worker: `/api/wx/*` (Open-Meteo mit Schlüssel, AWC, DWD-Kopie, DABS, Schnappschuss,
  NOTAM, KI) mit Cache; Dateien auch PDF.
* Eigenes Favicon «Checkliste» (SVG, ICO, Apple-Touch, PWA-Icons); fünf Varianten unter `icons/variants`.
* pdf.js vendored (RAC-Upload, DABS). Fix: Briefingsicht ausserhalb CH (Sonnenzeile).
* Tests: 90 Rechenprüfungen, UI-Durchläufe CH und DE mit synthetischem Open-Meteo.

## 0.2.0 — 2026-10-04

* Ortswahl-Fenster (Karte, Suche nach Ort/Adresse/Koordinaten/ICAO/Google-Maps-Link,
  eigener Standort) für Startort, Treffpunkt, geplanten Landeraum und die
  Stammdaten in den Einstellungen; Ausgabe überall als Name · ICAO-Kurzkoordinaten ·
  Höhe · Google-Maps-Link (neues Fenster, im PDF klickbar).
* Neues Feld «Geplanter Landeraum» (Fahrtabsicht, Panel A «Geplante Landeorte») mit
  Distanz und Kurs ab Startort.
* Lizenz: «Alle Rechte vorbehalten – Nutzung nur mit Zustimmung und Quellenangabe»
  (ersetzt Unlicense).

## 0.1.0 — 2026-10-04 · Phase 1

* Kennwortseite (Prüfung im Worker; lokaler Modus ohne Server), Sperre nach 2 h.
* Geführter Ablauf «Neues Briefing» in sechs Schritten (Ballon & Fahrt, Ort & Zeit
  mit Karte und Ortssuche, Fahrtabsicht, Personen mit Tragkraft-Vorschau,
  Tagesplanung mit Routing, Prüfen).
* Erarbeitungssicht mit Navigation A–D, Status je Panel, Zusatzinfo/KI-Hinweis/
  Kommentar, Einfüge-Assistent für Text und Bilder, Arbeitsversion im Kopf,
  Freigabe-Checkliste mit Final-Versionen.
* Briefingsicht nach dem Muster «Briefing 2026», Druck A4, Handy-Darstellung.
* Berechnungen: Sonne/Dämmerung (RAC 4-4 CH, astronomisch), Mond, Tragkraft
  Heissluft (Excel-Modell + Erweiterungen), Ballast Gasballon, Tagesplanung.
* Einstellungen: Ballone als Komponenten (Heissluft, Hüllen, Körbe), Personen,
  Lufttransportführer, Startplätze/Treffpunkte, Fahrtabsicht-Startwerte, Zeitplan,
  RAC-PDF-Upload, Übergangshöhen, Go/No-Go-Kriterien, Panels & Pflicht, Links,
  Zugänge (verschlüsselt), Experte (Kennwort, Reserve-Regel).
* Persönliche Links (Mitarbeit / Nur lesen) mit Ablauf, Widerruf, QR, WhatsApp, E-Mail.
* Cloudflare Worker: Sitzung, Einstellungen, Zugänge, Briefings (D1), Links,
  Bilder (R2), Export; GitHub Action für das Deployment.
* Tests: `test/calc.test.mjs` (70 Prüfungen gegen Excel und RAC),
  `test/api.test.sh`, `test/ui.smoke.py`, `test/ui.remote.py`.
