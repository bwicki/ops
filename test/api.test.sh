#!/usr/bin/env bash
# API-Durchlauf gegen einen laufenden Worker (wrangler dev --local, Port 8787).
# Ab 0.5.0 mehrbenutzerfähig: Super «bwicki» (Kennwort 1234 beim ersten Start), Master «test2».
set -e
A=${1:-http://localhost:8787}
j() { curl -s -H 'Content-Type: application/json' "$@"; }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
tok() { sed -E 's/.*"token":"([^"]+)".*/\1/'; }
echo "# health"; j $A/api/health; echo
echo "# falsches Kennwort → 401"; code -X POST $A/api/session -H 'Content-Type: application/json' -d '{"user":"bwicki","password":"0000"}'; echo
echo "# Login bwicki/1234"; TOK=$(j -X POST $A/api/session -d '{"user":"bwicki","password":"1234"}' | tok); echo "token ${TOK:0:20}…"
H="Authorization: Bearer $TOK"
echo "# Login ohne Benutzer (Rückfall auf Super)"; j -X POST $A/api/session -d '{"password":"1234"}' | grep -o '"user":{[^}]*}'; echo
echo "# me"; j -H "$H" $A/api/me; echo
echo "# Settings leer"; j -H "$H" $A/api/settings; echo
echo "# Settings speichern"; j -H "$H" -X PUT $A/api/settings -d '{"settings":{"ownerName":"B. Wicki","lang":"de","balloons":{"hab":[{"id":"HB-QWZ","name":"HB-QWZ"}],"envelopes":[],"baskets":[]},"persons":[{"id":"p1","name":"Pilot"}],"sites":[{"id":"s1","name":"Oberlunkhofen"}],"meetings":[],"operators":[{"id":"o1","name":"Wicki Aero"}]}}'; echo
echo "# Secret (Super)"; j -H "$H" -X PUT $A/api/secrets -d '{"name":"openmeteo","value":"abc123"}'; j -H "$H" $A/api/secrets; echo
echo "# Secret anzeigen (Super)"; j -H "$H" $A/api/secrets/openmeteo | grep -o '"value":"abc123"'; code -H "$H" $A/api/secrets/nixda; echo
echo "# Briefing anlegen"; j -H "$H" -X PUT $A/api/briefings/test00000001 -d '{"briefing":{"id":"test00000001","status":"draft","time":{"startMs":1791100800000},"site":{"name":"Oberlunkhofen","tz":"Europe/Zurich","icao":"4719N00824E","elev":461},"balloon":{"label":"HB-QWZ","reg":"HB-QWZ"},"flight":{"kind":"commercial"},"panels":{},"log":[]},"who":"test"}'; echo
echo "# Liste (own)"; j -H "$H" $A/api/briefings; echo
echo "# Ordnungsnummer vergeben (0.11)"; j -H "$H" $A/api/briefings | grep -o '"no":"[0-9]\{4\}-[0-9]\{3\}"' | head -1; echo
echo "# Link erstellen"; LINK=$(j -H "$H" -X POST $A/api/briefings/test00000001/access -d '{"person":"Martin","role":"edit","expiresAt":1900000000000}'); echo "$LINK"; T=$(echo "$LINK" | tok)
echo "# Shared GET"; j "$A/api/shared/$T?who=Martin" | head -c 300; echo
echo "# Shared PUT"; j -X PUT "$A/api/shared/$T" -d '{"briefing":{"id":"test00000001","status":"final","time":{"startMs":1791100800000},"site":{"name":"Oberlunkhofen","tz":"Europe/Zurich"},"balloon":{"label":"HB-QWZ","reg":"HB-QWZ"},"flight":{"kind":"commercial"},"panels":{"A.landing":{"content":{"text":"Wohlen"}}},"log":[]},"who":"Martin"}'; echo
echo "# Status bleibt draft (Mitarbeit darf nicht freigeben)"; j -H "$H" $A/api/briefings/test00000001 | grep -o '"status":"[a-z]*"'
echo "# Bild hochladen"; PNG="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="; UP=$(j -H "$H" -X POST $A/api/briefings/test00000001/files -d "{\"dataUrl\":\"data:image/png;base64,$PNG\"}"); echo "$UP"; U=$(echo "$UP" | sed -E 's/.*"url":"([^"]+)".*/\1/'); curl -s -o /dev/null -w "file GET %{http_code} %{content_type}\n" "$A$U"
echo "# Link widerrufen"; code -H "$H" -X DELETE $A/api/briefings/test00000001/access/$T; echo; j "$A/api/shared/$T"; echo
echo "# Kennwort ändern"; j -H "$H" -X POST $A/api/password -d '{"oldPassword":"1234","newPassword":"5678"}'; code -X POST $A/api/session -H 'Content-Type: application/json' -d '{"user":"bwicki","password":"1234"}'; echo
echo "# zurück auf 1234"; TOK2=$(j -X POST $A/api/session -d '{"user":"bwicki","password":"5678"}' | tok); j -H "Authorization: Bearer $TOK2" -X POST $A/api/password -d '{"oldPassword":"5678","newPassword":"1234"}'; echo
echo "# Dokument-Ablage (Stammdaten)"; DOC=$(j -H "$H" -X POST $A/api/docs -d "{\"dataUrl\":\"data:image/png;base64,$PNG\"}"); echo "$DOC"; DU=$(echo "$DOC" | sed -E 's/.*"url":"([^"]+)".*/\1/'); curl -s -o /dev/null -w "doc GET %{http_code}\n" "$A$DU"
echo "# wxtext fremder Host → 400"; code -H "$H" "$A/api/wx/wxtext?url=https://example.com/x"; echo
echo "# webcams ohne Koordinaten → 400"; code -H "$H" "$A/api/wx/webcams"; echo
echo "# sounding-Route vorhanden (Netz im Test gesperrt → 500, nicht 404)"; code -H "$H" "$A/api/wx/sounding?stn=06610"; echo
echo "# stations ohne Koordinaten → 400"; code -H "$H" "$A/api/wx/stations"; echo
echo "# stations Umkreis (Quellen im Test gesperrt → leere Liste mit errors, 200)"; j -H "$H" "$A/api/wx/stations?lat=47.26&lon=8.30&km=40" | head -c 200; echo
echo "# sondes-Route vorhanden (Netz gesperrt → 500, nicht 404)"; code -H "$H" "$A/api/wx/sondes?lat=47.26&lon=8.30&km=150&h=12"; echo
echo "# sonde ohne serial → 400"; code -H "$H" "$A/api/wx/sonde"; echo
echo "# airspace ohne Schlüssel → 424, bbox fehlerhaft → 400"; code -H "$H" "$A/api/wx/airspace?bbox=8.2,47.2,8.9,47.6"; echo; code -H "$H" "$A/api/wx/airspace?bbox=9,47,8,48"; echo
echo "# 0.12 elevation: Koordinaten fehlerhaft → 400, Route vorhanden (Netz im Test gesperrt → 500, nicht 404)"; code -H "$H" "$A/api/wx/elevation?lat=abc&lon=1"; echo; code -H "$H" "$A/api/wx/elevation?lat=47.26,47.27&lon=8.30,8.31"; echo
echo "# 0.12.2 water (OSM/Overpass): Koordinaten fehlerhaft/ungleich → 400, Route vorhanden (Netz gesperrt → 500)"; code -H "$H" "$A/api/wx/water?lat=abc&lon=1"; echo; code -H "$H" "$A/api/wx/water?lat=47.26,47.27&lon=8.30"; echo; code -H "$H" "$A/api/wx/water?lat=47.26,47.27&lon=8.30,8.31"; echo
echo "# webcams Umkreis (ohne Windy-Schlüssel: OSM)"; j -H "$H" "$A/api/wx/webcams?lat=47.26&lon=8.30&km=30" | head -c 300; echo
echo "# Export"; j -H "$H" $A/api/export | head -c 200; echo
echo "# ohne Token → 401"; code $A/api/briefings; echo

echo "# --- Mehrbenutzer ---"
echo "# Benutzer anlegen (Kopie des Stamms von bwicki, ohne KI)"; j -H "$H" -X POST $A/api/admin/users -d '{"id":"test2","name":"Test Zwei","password":"abcd","copyFrom":"bwicki","flags":{"ai":false}}'; echo
echo "# nochmals → 409"; code -H "$H" -X POST $A/api/admin/users -H 'Content-Type: application/json' -d '{"id":"test2","name":"x","password":"abcd"}'; echo
echo "# Benutzerliste (Admin)"; j -H "$H" $A/api/admin/users | head -c 400; echo
TOK3=$(j -X POST $A/api/session -d '{"user":"test2","password":"abcd"}' | tok); H3="Authorization: Bearer $TOK3"
echo "# test2: me"; j -H "$H3" $A/api/me; echo
echo "# test2: kopierter Stamm"; j -H "$H3" $A/api/settings | grep -o '"ownerName":"[^"]*"\|"sites":\[[^]]*\]'; echo
echo "# test2: Liste leer, all → 403"; j -H "$H3" $A/api/briefings; echo; code -H "$H3" "$A/api/briefings?scope=all"; echo
echo "# test2: fremdes Briefing → 403"; code -H "$H3" $A/api/briefings/test00000001; echo
echo "# test2: Secrets lesen ok, schreiben → 403, anzeigen → 403"; j -H "$H3" $A/api/secrets; echo; code -H "$H3" -X PUT $A/api/secrets -H 'Content-Type: application/json' -d '{"name":"x","value":"y"}'; echo; code -H "$H3" $A/api/secrets/openmeteo; echo
echo "# test2: admin → 403"; code -H "$H3" $A/api/admin/users; echo
echo "# test2: ai nicht freigeschaltet → 403"; code -H "$H3" -X POST "$A/api/wx/ai" -H 'Content-Type: application/json' -d '{"prompt":"x"}'; echo
echo "# bwicki gibt test2 Ballone+Startplätze frei"; j -H "$H" -X POST $A/api/shares -d '{"to":"test2","categories":["balloons","sites"]}'; echo
echo "# Freigaben (bwicki)"; j -H "$H" $A/api/shares; echo
echo "# test2: me enthält freigegebenen Stamm"; j -H "$H3" $A/api/me | grep -o '"from":"bwicki".*"categories":\[[^]]*\]'; echo
echo "# test2: Briefing mit Material von bwicki"; j -H "$H3" -X PUT $A/api/briefings/test00000003 -d '{"briefing":{"id":"test00000003","status":"draft","time":{"startMs":1791200000000},"site":{"name":"Gladbeck","tz":"Europe/Berlin"},"balloon":{"label":"HB-QWZ","reg":"HB-QWZ","ownerId":"bwicki"},"flight":{"kind":"private"},"panels":{},"log":[]},"who":"test2"}'; echo
echo "# bwicki: scope=material zeigt test2-Briefing"; j -H "$H" "$A/api/briefings?scope=material" | grep -o '"id":"test00000003"[^}]*"owner":"test2"' | head -c 200; echo
echo "# bwicki: scope=own zeigt es nicht"; j -H "$H" "$A/api/briefings" | grep -c test00000003 || true
echo "# bwicki (Super) liest es (access=read), speichern → 403"; j -H "$H" $A/api/briefings/test00000003 | grep -o '"access":"[a-z]*"'; code -H "$H" -X PUT $A/api/briefings/test00000003 -H 'Content-Type: application/json' -d '{"briefing":{"id":"test00000003"}}'; echo
echo "# bwicki: scope=all"; j -H "$H" "$A/api/briefings?scope=all" | grep -o '"id":"test0000000[0-9]"' | tr '\n' ' '; echo
echo "# bwicki liest Einstellungen von test2 (readOnly)"; j -H "$H" "$A/api/settings?user=test2" | grep -o '"readOnly":true'; echo
echo "# Freigabe entziehen (leere Kategorien)"; j -H "$H" -X POST $A/api/shares -d '{"to":"test2","categories":[]}'; echo
echo "# test2: Material-Eigner ohne Freigabe wird beim Speichern verworfen"; j -H "$H3" -X PUT $A/api/briefings/test00000003 -d '{"briefing":{"id":"test00000003","status":"draft","time":{"startMs":1791200000000},"site":{"name":"Gladbeck","tz":"Europe/Berlin"},"balloon":{"label":"HB-QWZ","reg":"HB-QWZ","ownerId":"bwicki"},"flight":{"kind":"private"},"panels":{},"log":[]},"who":"test2"}' > /dev/null; j -H "$H" "$A/api/briefings?scope=material" | grep -c test00000003 || true
echo "# Benutzer ändern (Kennwort, deaktivieren)"; j -H "$H" -X PUT $A/api/admin/users/test2 -d '{"password":"efgh","active":false}' | head -c 120; echo; code -X POST $A/api/session -H 'Content-Type: application/json' -d '{"user":"test2","password":"efgh"}'; echo " (401 = deaktiviert)"
j -H "$H" -X PUT $A/api/admin/users/test2 -d '{"active":true}' > /dev/null
echo "# Material-Link (Extern): bwicki erstellt Link für HB-QWZ"; ML=$(j -H "$H" -X POST $A/api/material-links -d '{"person":"Halter Extern","regs":["HB-QWZ"],"expiresAt":1900000000000}'); echo "$ML"; MT=$(echo "$ML" | tok)
echo "# Material-Link Liste (ohne Sitzung): eigenes test00000001 + fremdes test00000003 mit Material bwicki"
j -H "$H" -X POST $A/api/shares -d '{"to":"test2","categories":["balloons"]}' > /dev/null; TOK3=$(j -X POST $A/api/session -d '{"user":"test2","password":"efgh"}' | tok)
j -H "Authorization: Bearer $TOK3" -X PUT $A/api/briefings/test00000003 -d '{"briefing":{"id":"test00000003","status":"draft","time":{"startMs":1791200000000},"site":{"name":"Gladbeck","tz":"Europe/Berlin"},"balloon":{"label":"HB-QWZ","reg":"HB-QWZ","ownerId":"bwicki"},"flight":{"kind":"private"},"panels":{},"log":[]},"who":"test2"}' > /dev/null
j "$A/api/material/$MT" | grep -o '"id":"test0000000[0-9]"' | tr '\n' ' '; echo
echo "# Material-Link: Briefing lesen"; j "$A/api/material/$MT/test00000003" | grep -o '"role":"read"\|"person":"Halter Extern"' | tr '\n' ' '; echo
echo "# Material-Link: Briefing mit anderer Kennung → 404"; j -H "$H" -X PUT $A/api/briefings/test00000004 -d '{"briefing":{"id":"test00000004","status":"draft","time":{"startMs":1791300000000},"site":{"name":"X","tz":"Europe/Zurich"},"balloon":{"label":"HB-QWP","reg":"HB-QWP"},"flight":{"kind":"private"},"panels":{},"log":[]},"who":"test"}' > /dev/null; code "$A/api/material/$MT/test00000004"; echo
echo "# Material-Link widerrufen → 410"; code -H "$H" -X DELETE $A/api/material-links/$MT; echo; code "$A/api/material/$MT"; echo
code -H "$H" -X DELETE $A/api/briefings/test00000004; echo
echo "# 0.12.9 Archiv: vergangene Fahrt anlegen (erlaubt), danach Ändern → 423, Löschen → 423"; code -H "$H" -X PUT $A/api/briefings/test00000005 -d '{"briefing":{"id":"test00000005","status":"draft","time":{"startMs":1700000000000},"site":{"name":"Alt","tz":"Europe/Zurich"},"balloon":{"label":"HB-QWZ","reg":"HB-QWZ"},"flight":{"kind":"private"},"panels":{},"log":[]},"who":"test"}'; echo; code -H "$H" -X PUT $A/api/briefings/test00000005 -d '{"briefing":{"id":"test00000005","status":"draft","time":{"startMs":1700000000000},"site":{"name":"Alt2","tz":"Europe/Zurich"},"balloon":{"label":"HB-QWZ","reg":"HB-QWZ"},"flight":{"kind":"private"},"panels":{},"log":[]},"who":"test"}'; echo; code -H "$H" -X DELETE $A/api/briefings/test00000005; echo
echo "# 0.12.10a Archiv: Supermaster blendet aus (204, danach nicht mehr in der Liste); Master test2 → 423"; TOK3=$(j -X POST $A/api/session -d '{"user":"test2","password":"efgh"}' | tok); code -H "Authorization: Bearer $TOK3" -X PUT $A/api/briefings/test00000008 -d '{"briefing":{"id":"test00000008","status":"draft","time":{"startMs":1700000000000},"site":{"name":"Alt3","tz":"Europe/Zurich"},"balloon":{"label":"HB-QWZ","reg":"HB-QWZ"},"flight":{"kind":"private"},"panels":{},"log":[]},"who":"test2"}'; echo; code -H "Authorization: Bearer $TOK3" -X DELETE $A/api/briefings/test00000008; echo; code -H "$H" -X DELETE $A/api/briefings/test00000008; echo; j -H "$H" "$A/api/briefings?scope=all" | grep -c test00000008 || true
echo "# 0.12.12 ausgeblendet: Super listet hidden=1 (1 Treffer), Master → 403, unhide 204, danach wieder in der Liste, hidden=1 leer"; j -H "$H" "$A/api/briefings?scope=all&hidden=1" | grep -c test00000008 || true; code -H "Authorization: Bearer $TOK3" "$A/api/briefings?scope=all&hidden=1"; echo; code -H "Authorization: Bearer $TOK3" -X POST $A/api/briefings/test00000008/unhide; echo; code -H "$H" -X POST $A/api/briefings/test00000008/unhide; echo; j -H "$H" "$A/api/briefings?scope=all" | grep -c test00000008 || true; j -H "$H" "$A/api/briefings?scope=all&hidden=1" | grep -c test00000008 || true; code -H "$H" -X POST $A/api/briefings/nothere00/unhide; echo
echo "# 0.12.10 Nachtrag: laufende Fahrt (Start vor 2 h) → amend 200 mit Buchstabe, Archivkopie eingefroren (PUT/DELETE 423), Original weiter bearbeitbar"; ST=$(( $(date +%s) * 1000 - 7200000 )); code -H "$H" -X PUT $A/api/briefings/test00000006 -d "{\"briefing\":{\"id\":\"test00000006\",\"status\":\"draft\",\"time\":{\"startMs\":$ST},\"intent\":{\"durationMin\":600},\"site\":{\"name\":\"Lauf\",\"tz\":\"Europe/Zurich\"},\"balloon\":{\"label\":\"HB-QWZ\",\"reg\":\"HB-QWZ\"},\"flight\":{\"kind\":\"private\"},\"panels\":{},\"log\":[]},\"who\":\"test\"}"; echo
AM=$(j -H "$H" -X POST $A/api/briefings/test00000006/amend -d '{"who":"test"}'); echo "$AM" | grep -o '"no":"[0-9]\{4\}-[0-9]\{3\}a"'; CP=$(echo "$AM" | sed -E 's/.*"copyId":"([^"]+)".*/\1/')
j -H "$H" $A/api/briefings | grep -o "\"id\":\"$CP\"[^}]*\"frozen\":true" | head -c 60; echo
code -H "$H" -X PUT $A/api/briefings/$CP -d "{\"briefing\":{\"id\":\"$CP\"}}"; echo; code -H "$H" -X DELETE $A/api/briefings/$CP; echo
code -H "$H" -X PUT $A/api/briefings/test00000006 -d "{\"briefing\":{\"id\":\"test00000006\",\"status\":\"draft\",\"time\":{\"startMs\":$ST},\"intent\":{\"durationMin\":600},\"site\":{\"name\":\"Lauf2\",\"tz\":\"Europe/Zurich\"},\"balloon\":{\"label\":\"HB-QWZ\",\"reg\":\"HB-QWZ\"},\"flight\":{\"kind\":\"private\"},\"panels\":{},\"log\":[]},\"who\":\"test\"}"; echo
j -H "$H" $A/api/briefings/test00000006 | grep -o '"no":"[0-9]\{4\}-[0-9]\{3\}a"' | head -1; echo "# Nachtrag vor der Fahrt → 409"; FT=$(( $(date +%s) * 1000 + 172800000 )); code -H "$H" -X PUT $A/api/briefings/test00000007 -d "{\"briefing\":{\"id\":\"test00000007\",\"status\":\"draft\",\"time\":{\"startMs\":$FT},\"site\":{\"name\":\"Bald\",\"tz\":\"Europe/Zurich\"},\"balloon\":{\"label\":\"HB-QWZ\",\"reg\":\"HB-QWZ\"},\"flight\":{\"kind\":\"private\"},\"panels\":{},\"log\":[]},\"who\":\"test\"}" >/dev/null; code -H "$H" -X POST $A/api/briefings/test00000007/amend -d '{"who":"test"}'; echo; code -H "$H" -X DELETE $A/api/briefings/test00000007; echo; code -H "$H" -X DELETE $A/api/briefings/test00000006; echo
echo "# Statistik"; j -H "$H" $A/api/admin/stats | head -c 400; echo
echo "# 0.12.16 Protokoll (Super): Einträge mit Nutzername, Filter kind=login, CSV; Master → 403"; j -H "$H" "$A/api/admin/log?limit=5" | grep -o '"kind":"[a-z_]*"' | head -3 | tr '\n' ' '; echo; j -H "$H" "$A/api/admin/log?kind=login&limit=3" | grep -c '"kind":"login"'; curl -s -H "$H" "$A/api/admin/log?format=csv&limit=2" | head -1; code -H "Authorization: Bearer $TOK3" "$A/api/admin/log"; echo
echo "# 0.12.16 Abmelden beendet die Sitzung (danach 401); Token ohne Sitzungskennung ungültig"; TOKX=$(j -X POST $A/api/session -d '{"user":"bwicki","password":"1234"}' | tok); code -H "Authorization: Bearer $TOKX" $A/api/me; code -H "Authorization: Bearer $TOKX" -X DELETE $A/api/session; code -H "Authorization: Bearer $TOKX" $A/api/me; echo
echo "# Statistik CSV"; curl -s -H "$H" "$A/api/admin/stats?format=csv" | head -5
echo "# Export all (Super)"; j -H "$H" "$A/api/export?all=1" | grep -o '"users":{"[a-z0-9]*"' ; echo
echo "# aufräumen"; code -H "$H" -X DELETE $A/api/briefings/test00000001; echo; TOK3=$(j -X POST $A/api/session -d '{"user":"test2","password":"efgh"}' | tok); code -H "Authorization: Bearer $TOK3" -X DELETE $A/api/briefings/test00000003; echo

echo "# --- Datenabrufe (/api/wx) ---"
TOK=$(j -X POST $A/api/session -d '{"user":"bwicki","password":"1234"}' | tok); H="Authorization: Bearer $TOK"
echo "# wx ohne Token → 401"; code "$A/api/wx/metar?lat=47.3&lon=8.4"; echo
echo "# om ungültige Query → 400"; curl -s -w " %{http_code}\n" -H "$H" "$A/api/wx/om?query=foo"
echo "# notam ohne Zugang (0.12.4): schlüssellose Quellen DINS/NOTAM Search werden versucht – im Test ohne Netz → 502 mit beiden Fehlern"; curl -s -w " %{http_code}\n" -H "$H" "$A/api/wx/notam?lat=47.3&lon=8.4" | grep -o "DINS: .*NOTAM Search: .*\"} 502"
echo "# ai ohne Zugang → 424"; curl -s -w " %{http_code}\n" -H "$H" -X POST "$A/api/wx/ai" -d '{"prompt":"x"}'
echo "# snapshot fremder Host → 400"; curl -s -w " %{http_code}\n" -H "$H" -X POST "$A/api/wx/snapshot?b=test00000001" -d '{"url":"https://example.com/x.png"}'
echo "# unbekannt → 404"; code -H "$H" "$A/api/wx/foo"; echo
echo "# Link-Nutzer (read) darf dabs nicht → 403 (nach Anlage eines Links)"
j -H "$H" -X PUT $A/api/briefings/test00000002 -d '{"briefing":{"id":"test00000002","status":"draft","time":{"startMs":1791100800000},"site":{"name":"X","tz":"Europe/Zurich"},"balloon":{"label":"HB-QWZ","reg":"HB-QWZ"},"flight":{"kind":"private"},"panels":{},"log":[]},"who":"test"}' > /dev/null
T2=$(j -H "$H" -X POST $A/api/briefings/test00000002/access -d '{"person":"Leser","role":"read","expiresAt":1900000000000}' | tok)
code "$A/api/wx/dabs?t=$T2"; echo
echo "# Link-Nutzer darf metar (Abruf extern, hier Netz evtl. gesperrt → 200 oder 500)"; code "$A/api/wx/metar?lat=47.3&lon=8.4&t=$T2"; echo
code -H "$H" -X DELETE $A/api/briefings/test00000002; echo
echo "# Nutzung protokolliert"; j -H "$H" $A/api/admin/stats | grep -o '"kind":"[a-z_]*"' | sort | uniq -c | tr '\n' ' '; echo
echo "# 0.14.0 Ist-Trajektorie (Übergabe aus analyze): ohne Dienst-Token → 401 (503, wenn OPS_HANDOVER_TOKEN nicht gesetzt)"; code $A/api/handover/briefings; echo
if [ -n "$OPS_HANDOVER_TOKEN" ]; then
  HT="X-Handover-Token: $OPS_HANDOVER_TOKEN"
  j -H "$H" -X PUT $A/api/briefings/test00000002 -d '{"briefing":{"id":"test00000002","status":"draft","time":{"startMs":1900000000000},"site":{"name":"Oberlunkhofen","tz":"Europe/Zurich","lat":47.32,"lon":8.4},"balloon":{"label":"HB-QWZ","reg":"HB-QWZ"},"flight":{"kind":"commercial"},"intent":{"durationMin":120},"panels":{},"log":[]},"who":"test"}' > /dev/null
  echo "# Liste für analyze (letzte Briefings)"; j -H "$HT" "$A/api/handover/briefings?limit=50" | grep -o '"id":"test00000002"'
  PKG='{"source":"analyze.wicki.aero","format":1,"flight":{"id":"ABCD1234","title":"Test","url":"https://analyze.wicki.aero/v/ABCD1234"},"stats":{"durationSec":3600},"trajectory":{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"kind":"track","times":["2026-10-04T08:00:00Z","2026-10-04T09:00:00Z"]},"geometry":{"type":"LineString","coordinates":[[8.4,47.32,500],[8.5,47.4,600]]}}]}}'
  echo "# Trajektorie ablegen"; j -X PUT -H "$HT" -d "$PKG" $A/api/handover/briefings/test00000002/trajectory | grep -o '"ok":true'
  echo "# lesen (Sitzung) / Liste trajectoryAt / löschen"; j -H "$H" $A/api/briefings/test00000002/trajectory | grep -o '"points":2'; j -H "$H" $A/api/briefings | grep -o '"trajectoryAt":[0-9]*' | head -1; code -H "$H" -X DELETE $A/api/briefings/test00000002/trajectory; echo
  code -H "$H" -X DELETE $A/api/briefings/test00000002; echo
fi
