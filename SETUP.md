# Einrichtung — Frontend (GitHub Pages) und Worker (Cloudflare)

Dauer beim ersten Mal etwa 30 Minuten. Reihenfolge einhalten; jeder Schritt ist
einzeln prüfbar. Schlüssel und Kennwörter nie in Dateien des Repositories
schreiben und nie im Chat weitergeben.

## 1 Frontend auf GitHub Pages

1. Repository `bwicki/briefing`: Settings → Pages → Source «Deploy from a branch»,
   Branch `main`, Ordner `/ (root)`. Die Datei `CNAME` (`ops.wicki.aero`)
   liegt bereits im Repository.
2. DNS für wicki.aero (Cloudflare): `CNAME briefing → bwicki.github.io`, Proxy
   **aus** (graue Wolke), bis GitHub das Zertifikat ausgestellt hat.
3. Settings → Pages → Custom domain `ops.wicki.aero`, nach «DNS check
   successful» **Enforce HTTPS** aktivieren.
4. Prüfung: https://ops.wicki.aero öffnet die Kennwortseite; solange der
   Worker fehlt, erscheint «Lokaler Modus» in der Kopfzeile (Kennwort 1234).

## 2 Cloudflare-Konto vorbereiten

1. Dashboard → rechts oben Account-ID kopieren (für die GitHub Action).
2. API-Token erstellen: My Profile → API Tokens → Create Token → Vorlage
   «Edit Cloudflare Workers»; zusätzlich die Berechtigungen **D1 → Edit** und
   **Workers R2 Storage → Edit** ergänzen. Token kopieren (wird nur einmal gezeigt).
3. Im GitHub-Repository: Settings → Secrets and variables → Actions → New
   repository secret: `CLOUDFLARE_API_TOKEN` (das Token) und
   `CLOUDFLARE_ACCOUNT_ID` (die Account-ID).

## 3 Schnellweg ohne lokalen Rechner: GitHub-Workflow «Setup worker» (empfohlen)

Voraussetzung ist nur Abschnitt 2 (die beiden Secrets `CLOUDFLARE_API_TOKEN`
und `CLOUDFLARE_ACCOUNT_ID` im Repository). Dann:

1. Zwei weitere Repository-Secrets anlegen (Settings → Secrets and variables →
   Actions → New repository secret): `SESSION_SECRET` und `ENC_KEY`, je eine
   lange Zufallszeichenkette (mindestens 32 Zeichen; am einfachsten im
   Passwortmanager «Passwort generieren», 48 Zeichen, dort auch ablegen).
   `ENC_KEY` verschlüsselt die Zugänge (API-Schlüssel) in der Datenbank — ohne
   diesen Wert sind sie nicht mehr lesbar; `SESSION_SECRET` signiert Sitzungen.
2. GitHub → **Actions** → links «Setup worker» → rechts **Run workflow** →
   Auswahl `api_base` auf `auto` lassen → grüner Knopf **Run workflow**.
3. Der Lauf dauert 1–2 Minuten. Er legt die D1-Datenbank und den R2-Bucket an,
   trägt die `database_id` in `worker/wrangler.toml` ein, spielt das Schema ein
   (bei bestehender Datenbank auch die Migration 0.5), deployt den Worker, setzt
   die beiden Secrets, prüft `/api/health` und trägt die erhaltene Adresse
   `https://briefing-api.<konto>.workers.dev` in `js/config.js` ein (Commit
   «Setup worker: database_id, apiBase»). Die Zusammenfassung des Laufs zeigt
   die Adresse und die nächsten Schritte.
4. Weiter mit Abschnitt 7 (erste Anmeldung). Abschnitt 6 (eigene Domain
   `api.ops.wicki.aero`) ist optional und kann jederzeit nachgeholt werden.

Bricht ein Schritt ab, steht die Ursache rot im Protokoll des Laufs (meist ein
fehlendes Secret oder ein Token ohne «D1 Edit»/«R2 Edit»). Der Workflow ist
wiederholbar: Vorhandenes wird erkannt und übersprungen.

## 3b Alternative: Setup-Skript auf dem eigenen Rechner

Auf einem Rechner mit Node 22+ im Ordner `worker\`:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1      # Windows
bash setup.sh                                               # macOS/Linux
```

Das Skript installiert wrangler, öffnet einmal den Browser für die Cloudflare-
Anmeldung und erledigt die Schritte 3–5 unten selbst: D1-Datenbank anlegen und
die `database_id` in `wrangler.toml` eintragen, R2-Bucket, Schema, zufällige
Secrets (Werte landen in `worker/.secrets.local.txt` – in den Passwortmanager
übernehmen und die Datei löschen), Deploy. Am Ende stehen die verbleibenden
Handgriffe (Domain, GitHub-Secrets, Workflow-Berechtigung, Commit) auf dem
Bildschirm. Wiederholbar: Vorhandenes wird übersprungen.

## 3a Von Hand: Datenbank und Bucket anlegen

Auf einem Rechner mit Node 22+:

```bash
cd worker
npm install
npx wrangler login                      # Browser-Anmeldung bei Cloudflare
npx wrangler d1 create briefing         # Ausgabe: database_id
```

Die ausgegebene `database_id` in `worker/wrangler.toml` eintragen (Platzhalter
ersetzen), dann:

```bash
npx wrangler r2 bucket create briefing-files
npx wrangler d1 execute briefing --remote --file=schema.sql
```

## 4 Geheimnisse des Workers setzen (von Hand; der Workflow erledigt das)

```bash
openssl rand -base64 48 | npx wrangler secret put SESSION_SECRET
openssl rand -base64 32 | npx wrangler secret put ENC_KEY
```

`SESSION_SECRET` signiert die Sitzungen, `ENC_KEY` verschlüsselt die Zugänge in
der Datenbank (32 Bytes base64 werden direkt verwendet, jede andere Zeichenkette
ab 32 Zeichen wird per SHA-256 abgeleitet). Beide Werte sicher ablegen
(Passwortmanager) — ohne `ENC_KEY` sind gespeicherte Zugänge nicht mehr lesbar.

**`OPS_HANDOVER_TOKEN` (0.14.0, Übergabe aus analyze.wicki.aero):** ein langer Zufallstext (≥ 32 Zeichen), als
Repository-Secret gleichen Namens in **beiden** Repositories (`bwicki/ops` und `bwicki/analyze`: Settings → Secrets and
variables → Actions → New repository secret). Die Deploy-Workflows beider Worker hinterlegen ihn beim nächsten Lauf als
Worker-Secret (Actions → «Deploy worker» → Run workflow, oder beim nächsten Push unter `worker/`). Von Hand:
`printf '%s' '<Token>' | npx wrangler secret put OPS_HANDOVER_TOKEN`. Ohne das Secret antwortet `/api/handover/*` mit 503.
Ab 0.14.1 braucht auch der NOTAM-Workflow `fetch-notam.yml` dieses Secret (Abfragepunkte vom Worker).

## 5 Worker veröffentlichen

Entweder lokal `npx wrangler deploy` oder die geänderte `wrangler.toml` nach
`main` pushen — die GitHub Action `Deploy worker` deployt automatisch
(Actions-Tab zeigt den Lauf). Ergebnis: `https://briefing-api.<account>.workers.dev`.

Prüfung: `https://briefing-api.<account>.workers.dev/api/health` liefert
`{"ok":true,…}`.

## 6 Eigene Domain für den Worker (optional)

Dashboard → Workers & Pages → `briefing-api` → Settings → Domains & Routes →
**Add → Custom domain** `api.ops.wicki.aero`. Cloudflare legt den DNS-Eintrag
und das Zertifikat an. Prüfung: `https://api.ops.wicki.aero/api/health`.

Danach in `js/config.js` `apiBase: 'https://api.ops.wicki.aero'` eintragen
(direkt auf GitHub: Datei öffnen → Stift → ändern → Commit changes). Ohne eigene
Domain bleibt die vom Workflow eingetragene workers.dev-Adresse — das
funktioniert genauso.

## 7 Erste Anmeldung

1. https://ops.wicki.aero öffnen — die Kopfzeile zeigt jetzt **nicht** mehr
   «Lokaler Modus».
2. Nutzer `bwicki`, Kennwort `1234` (bei einer bestehenden Installation das
   bisherige Kennwort — es wird beim ersten Start in den Supermaster-Nutzer
   übernommen), dann **Einstellungen → Experte → Kennwort ändern** (längeres
   Kennwort wählen).
3. Einstellungen → Zugänge: API-Schlüssel und Logins eintragen; sie werden
   verschlüsselt im Worker gespeichert. Für Phase 2 relevant:
   * `openmeteo` — Open-Meteo-Kundenschlüssel (sonst freie API, 10 000 Abrufe/Tag).
   * `anthropic` — für KI-Hinweise (Modell in Einstellungen → Meteo, Standard
     `claude-sonnet-5-5`). Schlüssel aus der Claude Console:
     https://platform.claude.com → Settings → API keys → Create key (beginnt
     mit `sk-ant-`, wird nur einmal gezeigt); unter Plans & billing
     Zahlungsmethode und ein kleines Guthaben hinterlegen (Abrechnung nach
     Verbrauch, getrennt vom Claude.ai-Abo).
   * `cf_account_id` / `cf_api_token` — für das Final-PDF auf dem Server
     (Cloudflare Browser Rendering öffnet die Briefingsicht unsichtbar und legt
     das A4-PDF im Briefing ab): My Profile → API Tokens → Create Token →
     **Create Custom Token** → Name `Fahrtbriefing PDF`, Permission `Account ·
     Browser Rendering · Edit` (heisst in der Liste je nach Stand auch «Browser
     Run»), Account Resources = dein Konto → Create Token. Account-ID = dieselbe
     wie bei GitHub. Ohne diese Werte bleibt der Weg «PDF / Drucken → als PDF
     speichern → hochladen».
   * `autorouter_user` / `autorouter_pass` — **autorouter NOTAM API** (ab 0.11.2
     bevorzugte NOTAM-Quelle, europaweit, antwortet zuverlässig; FAA bleibt
     Rückfall). Schritte im Browser:
     1. https://www.autorouter.aero öffnen → **Register** (kostenloses Konto:
        E-Mail, Kennwort, Bestätigungsmail) → anmelden.
     2. Im Konto **Support** → neues Ticket: «Please enable API access for my
        account (client_credentials) – private use, balloon flight briefing
        tool.» Die Freischaltung kommt per E-Mail (meist innert Tagen).
     3. Nach der Freischaltung in der App unter Einstellungen → Zugänge
        «autorouter Nutzer» = E-Mail des Kontos, «autorouter Kennwort» =
        Kennwort des Kontos eintragen (die App holt damit ein einstündiges
        Token über `api.autorouter.aero/v1.0/oauth2/token`).
     Das NOTAM-Panel fragt dann je FIR der Fahrt (Startort, Landeraum,
     Lufträume der Analyse; CH LSAS, DE EDMM/EDGG/EDWW, AT LOVV, FR LFMM/LFFF/
     LFEE/LFBB/LFRR, IT LIMM/LIRR/LIBB …) ab und filtert auf den Umkreis.
   * **FAA NMS API (NOTAM) — ab 0.14.1 nicht mehr unter «Zugänge», sondern als
     Repository-Secrets `FAA_CLIENT_ID` / `FAA_CLIENT_SECRET`.** Die FAA-API läuft auf
     der Google Cloud Platform, deren Sperrliste die Ausgangsadressen von Cloudflare
     Workers abweist (HTTP 403; FAA NAIMES, INC0033867, 19.10.2026 – weder die FAA
     noch Cloudflare ändern daran etwas). Der Abruf läuft deshalb als GitHub Action
     `fetch-notam.yml` alle 30 Minuten: Punkte vom Worker (`/api/handover/notam-points`,
     Dienst-Token `OPS_HANDOVER_TOKEN`: Startort, Landeraum, Bahn-Endpunkte und
     NOTAM-Orte der Briefings der nächsten 7 Tage sowie alle in den letzten 7 Tagen
     tatsächlich abgefragten Kreise), Ablage als `data/notam/<key>.json`; der Worker
     liest die Dateien von der eigenen Origin. Einrichten im Browser:
     GitHub → `bwicki/ops` → **Settings → Secrets and variables → Actions → New
     repository secret**: `FAA_CLIENT_ID` (Client Key des NMS-Portals) und
     `FAA_CLIENT_SECRET`; `OPS_HANDOVER_TOKEN` muss gesetzt sein (siehe Abschnitt 4).
     Dann Actions → «NOTAM (FAA NMS) holen» → **Run workflow**; danach läuft der Abruf
     von selbst. Prüfen: `data/notam/index.json` im Repository (Stand, Punkte, Fehler)
     oder im NOTAM-Panel `Stand … FAA NMS API (Abruf GitHub hh:mm UTC)`. Ein Punkt,
     der noch keine Datei hat (neues Briefing, neue Bahn-Endpunkte), wird vorgemerkt
     und beim nächsten Lauf geholt – bis dahin antwortet autorouter (Rückfall).
     Die Felder «FAA NMS Client Key/Secret» unter Zugänge dienen nur noch der
     Diagnose (`src=faa&diag=1`).
     **Produktionszugang nötig:** Die FAA vergibt NMS-Zugangsdaten per E-Mail und oft zuerst für die
     Testumgebung (`api-staging.cgifederal-aim.com` / `api-fit.cgifederal-aim.com`). Solche Zugangsdaten
     weist die Produktion `api-nms.aim.faa.gov` mit `invalid_client – ClientId is Invalid` ab; der Workflow
     meldet dann in `index.json`, dass sie für «staging»/«fit» gelten. Produktionszugang bei der FAA
     (NMS-Portal → API access, NOTAMS@faa.gov) beantragen; Testumgebungen liefern keine operativen NOTAM.
     Zugang zum NMS-Portal (offizielle FAA-Schnittstelle, kostenlos; **nicht** über
     Drittanbieter wie apis.io):
     1. https://api.faa.gov öffnen → rechts oben **Login** → als externer
        Nutzer registrieren (E-Mail, Kennwort, Bestätigungsmail).
     2. **APIs** → Suchfeld «NOTAM» → **NOTAM API** öffnen.
     3. **Request Access** → Environment **Production** → Applikationsname
        z. B. `Wicki Aero – Fahrtbriefing`, Zweck kurz beschreiben
        (Flugvorbereitung Ballon, Strecken-NOTAM) → absenden. Die Anfrage
        wird geprüft; die Freigabe kommt per E-Mail (Tage bis Wochen).
     4. Nach der Freigabe: **My Applications** → Applikation → **View** →
        `client_id` und `client_secret` kopieren und als Repository-Secrets
        eintragen (oben).
     Ohne Zugang bleibt das NOTAM-Panel auf Einfügen (skybriefing).
   * `openaip` — openAIP-Schlüssel für das Panel «Luftraum entlang des
     Fahrtwegs» (Lufträume aus der openAIP-Datenbank; derselbe Schlüssel wie
     für das Karten-Overlay): https://www.openaip.net → anmelden/registrieren
     (kostenlos) → Benutzermenü → **API Clients** (bzw. Account → API) → Client
     anlegen → Schlüssel kopieren → Einstellungen → Zugänge als «openAIP API
     key» eintragen. Steht der Schlüssel bereits in der Overlay-Kachel-URL
     (Einstellungen → Experte, `…?apiKey=…`), wird er als Rückfall verwendet.
   * `windy_webcams` — Windy Webcams API (kostenlos, europaweit ~60 000
     Kameras mit Vorschaubild) für das Panel «Radar / Blitz / Satellit /
     Webcams»: https://api.windy.com/keys öffnen → mit dem Windy-Konto
     anmelden (oder registrieren) → **Webcams API** → Schlüssel erzeugen
     (Name z. B. `Fahrtbriefing`) → Schlüssel kopieren und in der App unter
     Einstellungen → Zugänge als «Windy Webcams key» eintragen. Ohne
     Schlüssel sucht die App nur in OpenStreetMap (als Webcam erfasste Punkte
     mit Adresse); der Umkreis ist unter Einstellungen → Meteo einstellbar
     (Standard 40 km um Startplatz und Landeraum).
4. Einstellungen → Ballone/Personen/Startplätze prüfen (Platzhalter sind markiert),
   speichern.
5. Daten aus dem lokalen Modus werden nicht automatisch übernommen — Briefings dort
   neu anlegen (Phase 1 ist dafür gedacht, mit dem Server zu beginnen).
6. Weitere Nutzer: **Einstellungen → Nutzer & Freigaben → Neuer Nutzer**
   (Anmeldename, Anzeigename, Startkennwort, Rolle, «Stamm kopieren von» oder
   Beispiel-Stamm, KI/NOTAM/PDF freischalten). Der neue Nutzer ändert sein
   Kennwort selbst unter Experte.
7. Externe Materialeigner ohne Konto: Einstellungen → Nutzer & Freigaben →
   *Fahrten mit meinem Material* → Name, Kennungen, Gültigkeit → Link weitergeben.

## 7b Bestehende Datenbank auf 0.5.0 heben (Mehrbenutzer)

Einmalig nach dem Deploy von 0.5.0 (nur bei einer Installation, die schon mit 0.4.x
lief; neue Installationen brauchen nur `schema.sql`):

```
cd worker
npx wrangler d1 execute briefing --remote --file=schema.sql      # neue Tabellen users, shares, usage
npx wrangler d1 execute briefing --remote --file=migrate-0.5.sql  # Spalten owner_id, material_owner
```

Bestehende Briefings gehören danach `bwicki`; Einstellungen und Kennwort werden
beim ersten Aufruf automatisch in den Supermaster übernommen. Alte Sitzungen sind
ungültig — einmal neu anmelden. `schema.sql` ist bei jeder Version erneut
anzuwenden (legt nur Fehlendes an, z. B. `material_links` ab 0.5.1).

## 7a DWD-/METAR-Kopie (GitHub Action)

Der Workflow `fetch-dwd.yml` holt dreimal pro Stunde die DWD-Luftsportberichte
(GAFOR, Flugwetterübersicht, Gebietsvorhersagen Ballonsport) und eine METAR/TAF-
Kopie nach `data/dwd/` und committet sie. Dafür einmalig: GitHub → Settings →
Actions → General → Workflow permissions auf **Read and write** stellen. Erster
Lauf von Hand über den Actions-Tab («Run workflow»). Fällt der Abruf aus, nimmt
die App automatisch die Kopie von gafor.wicki.aero.

## 8 Laufender Betrieb

* **RAC 4-4:** jedes Jahr das neue PDF aus dem eVFR-Manual unter
  Einstellungen → Sonne / RAC 4-4 hochladen.
* **Sicherung:** Einstellungen → Experte → *Alle Briefings exportieren* (eigene)
  bzw. *Alle Nutzer exportieren* (Supermaster; `GET /api/export?all=1`).
* **Nutzungsstatistik:** Einstellungen → Statistik (Supermaster), CSV-Export; die
  Tabelle `usage` wächst mit jedem Abruf (ein paar hundert Zeilen je Briefing) und
  kann bei Bedarf mit `DELETE FROM usage WHERE ts < …` gekürzt werden.
* **Limits (Cloudflare Free):** D1 5 Mio. Zeilen-Lesungen/Tag, 100 000
  Schreibungen/Tag, R2 10 GB — für Briefings weit ausreichend; bei Bedarf Workers
  Paid (5 $/Monat).
* **Lokale Entwicklung:** `cd worker && npm run db:local && npm run dev` (Port 8787)
  und im Repository-Root `python3 -m http.server 8080`; `js/config.js` auf
  `http://localhost:8787` stellen oder die Tests unter `test/` verwenden.

## 8a Quellen der automatischen Panels prüfen

Nach dem ersten Deployment ein Test-Briefing anlegen und in Abschnitt B «Alle
aktualisieren» drücken. Jedes Panel zeigt Stand und Quelle; Fehler stehen rot
neben dem Knopf. Typische Ursachen: Modellhorizont zu kurz (anderes Modell),
aviationweather.gov blockiert (automatischer Rückfall auf die GaforCast-Kopie),
Karten-URL geändert (Einstellungen → Meteo → Karten; Allowlist der Hosts in
`worker/src/wx.js`), DABS-Download ohne PDF (skybriefing-Wartung).

**Gasfahrt (0.12):** im Panel «Fahrtprofil» «Daten aufbereiten» drücken. Es braucht Open-Meteo
(Prognosen an Wegpunkten, Relief über `/api/wx/elevation` – ohne Schlüssel, Cache 7 Tage) und für die
Luftraum-Flächen den openAIP-Schlüssel (sonst meldet die Standzeile «Lufträume: …» als Teilfehler, der
Rest funktioniert). Die Grenzen der Achtung-Zeichen, der Mindestabstand über Grund und die FIS-Kontakte
je Land stehen unter Einstellungen → Experten; die Widerstandszahl WZ je Gashülle bei den Stammdaten
(Experten). Zeitzone der Grafik = Zeitbasis des Briefings (Schritt «Wo und wann», LT/UTC).

## 9 Was im Dashboard noch sinnvoll ist

* Workers & Pages → `briefing-api` → Observability: Logs bei Fehlern.
* D1 → `briefing` → Time Travel: Wiederherstellung auf einen Zeitpunkt der letzten
  30 Tage (Free: 7 Tage).
