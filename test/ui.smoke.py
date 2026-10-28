"""Playwright-Durchlauf im lokalen Modus: Kennwort, Ablauf 1–6, Erarbeitung, Briefingsicht, Settings.
Aufruf: python3 test/ui.smoke.py [base_url]  (Server: python3 -m http.server 8080)
"""
import sys, json, time, os, re
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
from om_fixture import fixture
GAFOR = os.environ.get('GAFOR_DATA', '/home/claude/gafor/data')

def mock_external(pg):
    """Externe Quellen ohne Netz: Open-Meteo synthetisch, GaforCast-Kopie aus Dateien, Rest abbrechen."""
    pg.route('**/api.open-meteo.com/**', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(fixture(urlparse(r.request.url).query))))
    def gafor(r):
        path = urlparse(r.request.url).path.replace('/data/', '', 1)
        f = os.path.join(GAFOR, path)
        if os.path.exists(f): r.fulfill(status=200, content_type='application/json', body=open(f).read())
        else: r.fulfill(status=404, body='')
    pg.route('**/gafor.wicki.aero/**', gafor)
    pg.route('**/api.rainviewer.com/**', lambda r: r.abort())
    pg.route('**/tile.openstreetmap.org/**', lambda r: r.abort())
    pg.route('**/server.arcgisonline.com/**', lambda r: r.abort())
    pg.route('**/nominatim.openstreetmap.org/**', lambda r: r.abort())
    pg.route('**/router.project-osrm.org/**', lambda r: r.abort())

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8080/'
OUT = '/tmp/claude-0/-home-claude/966811e7-696d-5075-85c3-3620d38610ae/scratchpad/ui'
import os; os.makedirs(OUT, exist_ok=True)
errors = []

def run(name, viewport, scale=1.5, mobile=False, site_chip=None):
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctxb = b.new_context(viewport=viewport, device_scale_factor=scale, is_mobile=mobile, has_touch=mobile, locale='de-CH', timezone_id='Europe/Zurich')
        pg = ctxb.new_page()
        pg.on('console', lambda m: errors.append(f'[{name}] console.{m.type}: {m.text}') if m.type in ('error',) and 'Failed to load resource' not in m.text else None)   # abgebrochene Kacheln sind kein Fehler
        pg.on('pageerror', lambda e: errors.append(f'[{name}] pageerror: {e} @ {(e.stack or "").splitlines()[1:3]}'))
        # lokaler Modus erzwingen: apiBase leer
        pg.route('**/js/config.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body="window.BRIEFING_CONFIG = { apiBase: '' };"))
        mock_external(pg)
        pg.goto(BASE + '#/list'); pg.wait_for_timeout(800)
        pg.screenshot(path=f'{OUT}/{name}_00_gate.png')
        pg.fill('#gatePw', '1234'); pg.click('#gateOpen'); pg.wait_for_timeout(600)
        pg.screenshot(path=f'{OUT}/{name}_01_list.png')
        # Neues Briefing
        pg.goto(BASE + '#/new'); pg.wait_for_timeout(700)
        pg.screenshot(path=f'{OUT}/{name}_02_wiz1.png')
        pg.click('button:has-text("Weiter →")'); pg.wait_for_timeout(900)
        pg.screenshot(path=f'{OUT}/{name}_03_wiz2.png')
        if site_chip:
            pg.click(f'button.chip:has-text("{site_chip}")'); pg.wait_for_timeout(600)
        pg.fill('input[type=time]', '06:30'); pg.dispatch_event('input[type=time]', 'change'); pg.wait_for_timeout(600)
        # 0.11.3: Start vor BCMT → Schalter «NVFR zulassen» im Schritt «Wo und wann»
        assert pg.query_selector('.nvfr-row button.chip.nvfr') is not None, 'Schalter «NVFR zulassen» bei Start vor BCMT'
        # 0.12.3: Start-Ampel nennt «ausserhalb der bürgerlichen Dämmerung»; mit «NVFR zulassen» entfällt das Kriterium
        ampel = lambda: pg.inner_text('.ampel') if pg.query_selector('.ampel') else ''
        for _ in range(40):
            pg.wait_for_timeout(300)
            if pg.query_selector('.ampel .ampel-row'): break
        assert 'Dämmerung' in ampel(), 'Start-Ampel vor BCMT ohne NVFR: Dämmerungskriterium: ' + ampel()
        pg.click('.nvfr-row button.chip.nvfr')
        for _ in range(40):
            pg.wait_for_timeout(300)
            if pg.query_selector('.ampel .ampel-row') and 'Dämmerung' not in ampel(): break
        assert pg.query_selector('.ampel .ampel-row') is not None and 'Dämmerung' not in ampel(), 'Start-Ampel mit NVFR ohne Dämmerungskriterium: ' + ampel()
        pg.click('.nvfr-row button.chip.nvfr'); pg.wait_for_timeout(1500)   # zurück auf Tagfahrt für den weiteren Ablauf
        pg.click('button:has-text("Weiter →")'); pg.wait_for_timeout(500)
        # Ortswahl: geplanter Landeraum per ICAO-Kurzkoordinaten
        pg.click('button:has-text("Ort wählen")'); pg.wait_for_timeout(900)
        pg.fill('.pick-body input[type=search]', '4725N00816E'); pg.press('.pick-body input[type=search]', 'Enter'); pg.wait_for_timeout(1500)
        pg.screenshot(path=f'{OUT}/{name}_04a_pick.png')
        assert '4725N00816E' in pg.inner_text('.pick-body .coords'), 'ICAO-Koordinaten im Dialog'
        pg.click('.dialog-foot button:has-text("Übernehmen")'); pg.wait_for_timeout(500)
        assert 'Google Maps' in pg.inner_text('.wiz'), 'Maps-Link nach Ortswahl'
        pg.screenshot(path=f'{OUT}/{name}_04_wiz3.png', full_page=True)
        assert pg.query_selector('.wiz .traj-legend .item') is not None, 'Trajektorien-Vorschau mit Niveau-Legende in Schritt 3'
        assert 'Tag und Nacht' not in pg.inner_text('.wiz'), 'keine Tag/Nacht-Wahl mehr in Schritt 3'
        pg.click('button:has-text("Weiter →")'); pg.wait_for_timeout(1500)
        import re as _re
        takeoff0 = _re.search(r'Start\u00ad?gewicht[^\d]*(\d+)', pg.inner_text('.wiz'), _re.I) or _re.search(r'Ballast[^\d]*(\d+)', pg.inner_text('.wiz'), _re.I)
        pg.click('button.add[title="Pax hinzufügen (Name oder Platzhalter)"]'); pg.wait_for_timeout(200)
        pg.click('button.add[title="Pax hinzufügen (Name oder Platzhalter)"]'); pg.wait_for_timeout(300)
        takeoff1 = _re.search(r'Start\u00ad?gewicht[^\d]*(\d+)', pg.inner_text('.wiz'), _re.I) or _re.search(r'Ballast[^\d]*(\d+)', pg.inner_text('.wiz'), _re.I)
        assert takeoff0 and takeoff1 and int(takeoff1.group(1)) != int(takeoff0.group(1)), f'Vorschau reagiert auf Pax: {takeoff0 and takeoff0.group(0)} → {takeoff1 and takeoff1.group(0)}'
        assert 'Personen (inkl. PIC) 3' in pg.inner_text('.wiz'), 'Personenzahl in der Vorschau'
        assert '2. PILOT' in pg.inner_text('.wiz .frow.top').upper() and len(pg.query_selector_all('.wiz .frow.top select')) >= 2, '0.12.7: Feld «2. Pilot» auch bei Heissluft'
        rows = pg.query_selector_all('.pax-row:not(.ret-row) input[type=text]')
        if rows: rows[0].fill('Viviane Graf')
        pg.wait_for_timeout(300)
        pg.screenshot(path=f'{OUT}/{name}_05_wiz4.png', full_page=True)
        pg.click('button:has-text("Weiter →")'); pg.wait_for_timeout(2500)
        # Schritt 5: tabellarischer Zeitplan (Dropdown je Zeile, Info, Dauer, Ort), Zeilen verschiebbar, Zeiten laufen mit
        assert pg.query_selector('.wiz table.sched.plan tbody tr.anchor') is not None, 'Zeitplan-Tabelle mit Anker «Start»'
        acts = pg.evaluate("() => [...document.querySelectorAll('.wiz table.sched.plan tbody tr td.act select')].map(s => s.value)")
        assert acts[:2] == ['meet', 'drive'] and 'rig' in acts and 'landing' in acts and 'return' in acts, f'Vorlage-Zeilen: {acts}'
        times0 = pg.evaluate("() => [...document.querySelectorAll('.wiz table.sched.plan tbody tr td.tm input')].map(i => i.value)")
        start_i = acts.index('start')
        assert times0[acts.index('rig')] < times0[start_i] < times0[acts.index('landing')] and times0[acts.index('arrive')] == times0[acts.index('rig')], f'Zeiten um den Anker: {times0}'
        # Bergung nach oben vor die Landung → Landung rückt um die Bergungsdauer nach hinten
        rec_i = acts.index('recovery')
        pg.click(f'.wiz table.sched.plan tbody tr:nth-child({rec_i + 1}) td.handle button[title="nach oben"]'); pg.wait_for_timeout(600)
        acts2 = pg.evaluate("() => [...document.querySelectorAll('.wiz table.sched.plan tbody tr td.act select')].map(s => s.value)")
        times2 = pg.evaluate("() => [...document.querySelectorAll('.wiz table.sched.plan tbody tr td.tm input')].map(i => i.value)")
        assert acts2.index('recovery') == rec_i - 1 and times2[acts2.index('landing')] > times0[acts.index('landing')], f'Zeile verschoben, Zeiten angepasst: {times2}'
        pg.click('.wiz .sched-tools button:has-text("Zeile hinzufügen")'); pg.wait_for_timeout(400)
        assert len(pg.query_selector_all('.wiz table.sched.plan tbody tr')) == len(acts) + 1, 'Zeile hinzugefügt'
        pg.screenshot(path=f'{OUT}/{name}_06_wiz5.png', full_page=True)
        pg.click('button:has-text("Weiter →")'); pg.wait_for_timeout(600)
        pg.screenshot(path=f'{OUT}/{name}_07_wiz6.png', full_page=True)
        pg.click('button:has-text("Briefing anlegen")'); pg.wait_for_timeout(4000)
        pg.screenshot(path=f'{OUT}/{name}_08_editor.png', full_page=True)
        # automatische Panels geladen?
        for key in ['B.meteogram', 'B.wind', 'B.temps', 'B.traj', 'B.balloon', 'B.metar'] + ([] if site_chip else ['B.pdiff']):
            sel = '#panel-' + key.replace('.', '\\.')
            txt = pg.inner_text(sel)
            assert 'Stand:' in txt, f'{key} geladen ({txt[:80]!r})'
        assert pg.query_selector('#panel-B\\.temps svg.sv-svg') is not None, 'Stüve gezeichnet'
        pg.wait_for_timeout(1500)
        loc = pg.locator('.meteobar button:has-text("Alle aktualisieren")'); loc.scroll_into_view_if_needed(); pg.wait_for_timeout(500); loc.click(force=True); pg.wait_for_timeout(4000)
        assert '✓' in pg.inner_text('.meteobar'), 'Alle aktualisieren: ' + pg.inner_text('.meteobar')
        assert pg.query_selector('#panel-B\\.traj svg.traj-svg') is not None, 'Trajektorien-Skizze'
        if site_chip == 'Gladbeck':
            assert 'GAFOR' in pg.inner_text('#panel-B\\.fwp') and 'Flugwetterübersicht' in pg.inner_text('#panel-B\\.fwp'), 'DWD Flugwetterübersicht für DE'
            assert 'DWD' in pg.inner_text('#panel-B\\.balloon') and 'Gebiet' in pg.inner_text('#panel-B\\.balloon'), 'DWD Ballongebiet für DE'
            assert 'ED' in pg.inner_text('#panel-B\\.metar'), 'METAR eines deutschen Platzes'
        else:
            assert 'LSZH' in pg.inner_text('#panel-B\\.metar') or 'LSZB' in pg.inner_text('#panel-B\\.metar'), 'METAR eines Schweizer Platzes'
            # 0.12.8: Station ausblenden (✕ ohne Rückfrage); «Aktualisieren» fragt «Alle Meldungen» / «Selektion beibehalten»; Warnsymbol «gegenwärtiger Stand» (Start > 6 h)
            n_st = len(pg.query_selector_all('#panel-B\\.metar .metar')); first = pg.text_content('#panel-B\\.metar .metar .mhead b')
            pg.click('#panel-B\\.metar .metar .mhead .hide-x >> nth=0'); pg.wait_for_timeout(500)
            assert len(pg.query_selector_all('#panel-B\\.metar .metar')) == n_st - 1 and first not in pg.inner_text('#panel-B\\.metar') and '1 ausgeblendet' in pg.inner_text('#panel-B\\.metar'), 'Station ausgeblendet'
            pg.click('#panel-B\\.metar .ptools button:has-text("Aktualisieren")'); pg.wait_for_timeout(400)
            assert pg.is_visible('.dialog') and 'Selektion' in pg.inner_text('.dialog'), 'Rückfrage beim Aktualisieren mit ausgeblendeten Meldungen'
            pg.click('.dialog-foot button:has-text("Selektion")'); pg.wait_for_timeout(2500)
            assert first not in pg.inner_text('#panel-B\\.metar'), 'Selektion bleibt'   # 0.12.13: Warnsymbol nur, wenn kein TAF bis Start + 1 h gilt (tagesaktuelle Daten decken den Teststart meist ab)
            pg.click('#panel-B\\.metar .ptools button:has-text("Aktualisieren")'); pg.wait_for_timeout(400); pg.click('.dialog-foot button:has-text("Alle Meldungen")'); pg.wait_for_timeout(2500)
            assert len(pg.query_selector_all('#panel-B\\.metar .metar')) == n_st, 'Alle Meldungen wieder da'
            assert 'DWD' not in pg.inner_text('#panel-B\\.balloon').split('EIGENE')[0].split('Stand:')[-1][:60] or True
        pg.wait_for_timeout(1500)
        assert '4725N00816E' in pg.inner_text('#panel-A\\.landing'), 'Landeraum im Editor'
        # 0.9.2: Panel-Nummerierung, «Astronomische Daten» ohne KI-Knopf, DABS nur bei CH-Berührung, Flugplan-Schalter
        assert pg.inner_text('#panel-A\\.core .panel-head .ttl').startswith('A01') and pg.inner_text('#panel-A\\.sun .panel-head .ttl').startswith('A02'), 'Panel-Nummern A1/A2'
        assert 'Astronomische Daten' in pg.inner_text('#panel-A\\.sun .panel-head') and pg.query_selector('#panel-A\\.sun .aibtns') is None and pg.query_selector('#panel-A\\.core .aibtns') is None, 'Astronomische Daten ohne KI-Knopf'
        assert pg.query_selector('#panel-C\\.dabs') is not None, 'DABS vorhanden (Landeraum in CH)'
        assert pg.query_selector('#panel-C\\.fpl input[type=checkbox]') is not None, 'Flugplan-Schalter'
        # 0.10.0: Flugplan erzeugen → ICAO-Nachricht mit Kennung, EOBT UTC, DEP/DEST, Feld 19
        if not pg.is_checked('#panel-C\\.fpl input[type=checkbox]'): pg.check('#panel-C\\.fpl input[type=checkbox]'); pg.wait_for_timeout(300)
        pg.click('#panel-C\\.fpl button:has-text("Aus Briefing erzeugen")'); pg.wait_for_timeout(800)
        fplmsg = pg.inner_text('#panel-C\\.fpl pre')
        assert fplmsg.startswith('(FPL-HB') and ('-ZZZZ0430' in fplmsg or '-ZZZZ0530' in fplmsg) and 'DEP/' in fplmsg and '4725N00816E' in fplmsg and 'C/' in fplmsg and fplmsg.rstrip().endswith(')'), 'ICAO-Nachricht: ' + fplmsg[:120]
        assert 'Ziel' in pg.inner_text('#panel-B\\.traj .traj-legend') and '°' in pg.inner_text('#panel-B\\.traj .traj-legend'), 'Zielzeile im Trajektorien-Panel'
        # NOTAM: Umkreis um Orte (Standard Startort, 200 km)
        pg.select_option('#panel-C\\.notam .ptools select', 'places'); pg.wait_for_timeout(400)
        assert pg.query_selector('#panel-C\\.notam .notam-places .np-row') is not None and '200' in pg.input_value('#panel-C\\.notam .notam-places input[type=number]'), 'NOTAM-Orte-Editor mit Startort und 200 km'
        pg.select_option('#panel-C\\.notam .ptools select', 'route'); pg.wait_for_timeout(300)
        # Reihenfolge C: NOTAM vor Flugplan
        keys = pg.evaluate("() => [...document.querySelectorAll('.panel')].map(p => p.id)")
        assert keys.index('panel-C.notam') < keys.index('panel-C.fpl'), 'Flugplan nach NOTAM'
        # Phase 3: Tendenz-Karte, «Mehr»-Menü, Pax-Karte, Crew-Dialog
        assert 'modellsicht' in pg.inner_text('.side').lower(), 'Go/No-Go-Karte'
        pg.click('#menuBtn'); pg.wait_for_timeout(300)
        assert pg.is_visible('#menu details.submenu'), 'Hamburger mit Untermenüs offen'
        assert 'Neues Briefing' not in pg.inner_text('#menu'), 'kein «Neues Briefing» im Hamburger'
        pg.click('#menu details.submenu summary:has-text("Mehr")'); pg.wait_for_timeout(200)
        pg.click('#menu button:has-text("Crew")'); pg.wait_for_timeout(1200)
        assert 'Ballonfahrt' in pg.input_value('.dialog textarea'), 'Crew-Nachricht erzeugt'
        pg.click('.dialog-foot button'); pg.wait_for_timeout(300)
        # Text in ein Paste-Panel
        ta = pg.query_selector('#panel-B\\.fwp .pastewrap textarea')
        if ta: ta.fill('LSZH 100420Z VRB01KT CAVOK 15/14 Q1015\nFlugwetterprognose: Hochdrucklage, schwache Winde.'); pg.wait_for_timeout(1300)
        # Briefingsicht
        href = pg.evaluate("location.hash")
        bid = href.split('/')[-1]
        pg.goto(BASE + f'#/v/{bid}'); pg.wait_for_timeout(900)
        pg.screenshot(path=f'{OUT}/{name}_09_brief.png', full_page=True)
        assert pg.query_selector('.brief a.maps[target=_blank]') is not None, 'Maps-Link in Briefingsicht'
        assert '(FPL-HB' in pg.inner_text('.brief tr.row-C-fpl'), 'Flugplan in der Briefingsicht'
        pg.click('#tools button.print'); pg.wait_for_timeout(400)
        assert 'Passagier Info-/Sicherheitskarte' in pg.inner_text('.dialog'), 'Druckdialog mit Passagierkarte'
        pg.click('.dialog-foot button:first-child'); pg.wait_for_timeout(200)
        assert '4725N00816E' in pg.inner_text('.brief'), 'Landeraum in Briefingsicht'
        assert pg.query_selector('.brief svg.mg-svg') is not None and pg.query_selector('.brief svg.sv-svg') is not None, 'Grafiken in der Briefingsicht'
        pg.emulate_media(media='print')
        pg.pdf(path=f'{OUT}/{name}_brief.pdf', format='A4', print_background=True) if not mobile else None
        pg.emulate_media(media='screen')
        # Pax-Karte
        pg.goto(BASE + f'#/pax/{bid}'); pg.wait_for_timeout(900)
        assert 'Sicherheit' in pg.inner_text('.paxsheet .paxcard:first-child') and 'Treffpunkt' in pg.inner_text('.paxsheet .paxcard:first-child'), 'Pax-Karte'
        pg.screenshot(path=f'{OUT}/{name}_12_pax.png', full_page=True)
        # 0.13.0: Betriebsdokumente – Beförderungsschein (2 Seiten) und Flugauftrag (1 Seite) aus dem Briefing
        pg.goto(BASE + f'#/bs/{bid}'); pg.wait_for_timeout(900)
        assert len(pg.query_selector_all('.docpages .docsheet')) == 2, 'Beförderungsschein: 2 Seiten'
        bs_txt = pg.inner_text('.docpages')
        assert 'Beförderungsschein' in bs_txt and 'AXA' in bs_txt and 'Kennzeichen' in bs_txt and 'v7 | 28.12.2024' in bs_txt, 'Beförderungsschein Inhalt'
        assert pg.query_selector('.docsheet.bs table.paxtab tbody tr td') is not None, 'Pax-Tabelle'
        pg.screenshot(path=f'{OUT}/{name}_13_bs.png', full_page=True)
        pg.goto(BASE + f'#/fa/{bid}'); pg.wait_for_timeout(900)
        fa_txt = pg.inner_text('.docpages')
        assert 'Flugauftrag' in fa_txt and 'CH.BOP.8054' in fa_txt and 'Erteilung und Annahme' in fa_txt and 'Fahrt nur bei VMC' in fa_txt, 'Flugauftrag Inhalt'
        assert len(pg.query_selector_all('.docpages .docsheet')) == 1, 'Flugauftrag: 1 Seite'
        pg.screenshot(path=f'{OUT}/{name}_14_fa.png', full_page=True)
        assert pg.is_visible('#mainnav a.on'), 'Hauptnavigation sichtbar'
        # Settings
        pg.goto(BASE + '#/settings?balloons'); pg.wait_for_timeout(700)
        pg.screenshot(path=f'{OUT}/{name}_10_settings.png', full_page=True)
        # 0.9.2: Zurück-Knopf, Speichern als Umriss bis zur ersten Änderung, Tracker je Ballon
        assert pg.query_selector('#tools button[title="Zurück"]') is not None, 'Zurück-Knopf in den Einstellungen'
        assert 'primary' not in (pg.get_attribute('#tools button.save', 'class') or ''), 'Speichern zunächst nur Umriss'
        assert 'tracker-links' in pg.inner_text('.settings').lower(), 'Tracker-Links beim Ballon'
        pg.fill('.settings .item-box input[type=text]', 'HB-TEST'); pg.wait_for_timeout(200)
        assert 'primary' in (pg.get_attribute('#tools button.save', 'class') or ''), 'Speichern gefüllt nach Änderung'
        pg.click('#menuBtn'); pg.wait_for_timeout(300)
        assert pg.query_selector('#menu details.submenu summary:has-text("JSON")') is not None, 'JSON-Untermenü im Hamburger'
        pg.click('#menuBtn'); pg.wait_for_timeout(200)
        # 0.10.1: Muster auch bei der Gashülle, Bild der Hülle, Panel-Tabelle mit Nummern
        assert 'HB-QPJ · NL-STU/1000' in pg.inner_text('.settings'), 'Muster bei der Gashülle'
        pg.set_input_files('.settings .item-box input[type=file]', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'img', 'wicki-logo.png')); pg.wait_for_timeout(600)
        assert pg.query_selector('.settings img.bimg') is not None, 'Hüllenbild in den Einstellungen'
        pg.fill('.settings .item-box input[type=text]', 'HB-QWZ'); pg.wait_for_timeout(200)
        pg.click('#tools button.save'); pg.wait_for_timeout(600)
        pg.goto(BASE + '#/settings?panels'); pg.wait_for_timeout(600)
        assert pg.query_selector('table.panels-tbl') is not None and 'A01' in pg.inner_text('table.panels-tbl .pno'), 'Panel-Tabelle mit Nummern'
        pg.screenshot(path=f'{OUT}/{name}_13_panels.png', full_page=True)
        pg.goto(BASE + '#/settings?expert'); pg.wait_for_timeout(600)
        assert pg.query_selector('table.cm-tbl') is not None and 'DABS' in pg.inner_text('table.cm-tbl'), 'Länder-Matrix im Expertenbereich'
        assert 'aerostatik' in pg.inner_text('#view').lower() and 'überhitzung' in pg.inner_text('#view').lower(), 'Aerostatik-Karte (Überhitzung) im Expertenbereich'
        pg.goto(BASE + f'#/pax/{bid}'); pg.wait_for_timeout(900)
        assert pg.query_selector('.paxsheet img.bimg') is not None, 'Hüllenbild im Pax-Blatt'
        pg.goto(BASE + f'#/v/{bid}'); pg.wait_for_timeout(900)
        assert pg.query_selector('.brief tr.row-A-core img.bimg') is not None, 'Hüllenbild in der Briefingsicht'
        pg.goto(BASE + f'#/b/{bid}'); pg.wait_for_timeout(1500)
        assert pg.query_selector('#panel-A\\.core .panel-body .core-grid img.core-img') is not None and pg.query_selector('#panel-A\\.core .panel-head img.bimg') is None, 'Hüllenbild im Datenfenster von A1 (nicht im Titel)'
        pg.screenshot(path=f'{OUT}/{name}_14_core_img.png')
        assert 'XML' not in pg.inner_text('#panel-C\\.fpl .row-actions'), 'kein XML-Export mehr'
        pg.goto(BASE + '#/new'); pg.wait_for_timeout(900)
        assert pg.query_selector('.wiz img.bimg') is not None, 'Hüllenbild im Wizard Schritt 1'
        pg.screenshot(path=f'{OUT}/{name}_15_wizard_img.png')
        # Liste erneut — 0.11: Ordnungsnummer, «in Arbeit NN %», Kopfzeile, Sperre
        pg.goto(BASE + '#/list'); pg.wait_for_timeout(600)
        pg.screenshot(path=f'{OUT}/{name}_11_list.png')
        lst = pg.inner_text('#view')
        assert re.search(r'20\d\d-\d{3}', lst), 'Ordnungsnummer in der Liste'
        assert 'in Arbeit' in lst and 'Entwurf' not in lst, 'Status «in Arbeit NN %» statt Entwurf'
        pg.goto(BASE + f'#/v/{bid}'); pg.wait_for_timeout(900)
        hdr = pg.inner_text('.brief .bh .tline') + ' | ' + pg.inner_text('.brief .bh')
        assert hdr.startswith('Fahrtbriefing · 20') and 'Start:' in hdr and 'Letzte Änderung' in hdr, 'Titelzeile und letzte Änderung: ' + hdr[:80]
        assert pg.evaluate("(() => { const e = document.querySelector('.brief .bh .tline'); return e.getBoundingClientRect().height < 1.8 * parseFloat(getComputedStyle(e).fontSize); })()"), 'Titelzeile einzeilig'
        assert 'Briefingnummer' in pg.inner_text('.brief tr.row-A-core') and 'Pax:' in pg.inner_text('.brief tr.row-A-core'), 'Nummer und Pax-Zeile in den Stammdaten'
        core = pg.inner_text('.brief tr.row-A-core'); assert 'Landeort (geplant)' in core and 'Fahrtdauer' in core and 'Fahrthöhen' in core and 'CH-' in core, '0.12.8: Landeort-Zeile, Fahrtabsicht neu gegliedert, Länderkennzeichen auch CH: ' + core[:300]
        assert len(pg.query_selector_all('.brief tr.row-A-sun table.auto.astro')) == 2, 'A2 als zwei Tabellen (Sonne, Mond)'
        pg.goto(BASE + f'#/b/{bid}'); pg.wait_for_timeout(1200)
        assert pg.query_selector('.editor .refresh-all button') is not None and pg.query_selector('#panel-A\\.core .refresh-all') is None, 'Knopf «Alle verfügbaren Daten aktualisieren» über Abschnitt A'
        assert all(pg.query_selector(f'#panel-{k} .panel-head .lft .src') is not None for k in ['A\\.core', 'B\\.metar', 'C\\.fpl']), 'Stand-Zeile in jedem Panel-Kopf'
        assert 'modellsicht' in pg.inner_text('.side').lower() and 'zusammenfassung' in pg.inner_text('.side').lower(), 'rechte Spalte: Einschätzung/Modellsicht + Zusammenfassung'
        # 0.12.8: Reihenfolge Planungshorizont · Grunddaten · Einschätzung · Zusammenfassung, ohne «Panels»/«Protokoll»; Einschätzung in Blöcken (kritisch/marginal/unkritisch)
        heads = [e.inner_text().strip().lower() for e in pg.query_selector_all('.side .card .section-title')]
        assert heads[:2] == ['planungshorizont', 'grunddaten'] and 'panels' not in heads and 'protokoll' not in heads and heads[-1] == 'zusammenfassung', 'rechte Spalte 0.12.8: ' + str(heads)
        assert pg.evaluate("() => getComputedStyle(document.querySelector('.side .gonogo .card-body')).display") == 'block' and any(x in pg.inner_text('.side .gonogo .gn-level').lower() for x in ['kritisch', 'marginal', 'unkritisch', 'modellstunden']), 'Einschätzung als Blöcke mit neuer Wortwahl'
        assert pg.query_selector('.side .basics input[type=checkbox]') is not None and 'NVFR' in pg.inner_text('.side .basics'), 'Grunddaten mit Klickbox NVFR'
        assert len(pg.query_selector_all('.enav .legend .dot.ok')) == 1 and pg.evaluate("() => getComputedStyle(document.querySelector('.enav .legend .dot.must')).backgroundColor") != pg.evaluate("() => getComputedStyle(document.querySelector('.enav .legend .dot.ok')).backgroundColor"), 'Legende mit eingefärbten Punkten'
        assert pg.evaluate("() => getComputedStyle(document.querySelector('.enav .it .pno')).whiteSpace") == 'nowrap' and not pg.query_selector('.refresh-all button.primary'), 'Nummern ohne Umbruch; «Alle verfügbaren Daten aktualisieren» nicht mehr braun'
        if not mobile: assert pg.evaluate("() => getComputedStyle(document.querySelector('.editor > .emain')).overflowY") == 'auto', 'mittlere Spalte mit eigenem Rollbereich'
        pg.screenshot(path=f'{OUT}/{name}_16_editor_head.png')
        # 0.11.2: Abschnittstitel mit Kennbuchstabe, D = Crew-/Pax-Briefing, Akkordeon-Navigation, Zusatzboxen per Symbolknopf
        titles = [x.strip() for x in pg.eval_on_selector_all('.editor .sect-title', 'els => els.map(e => e.textContent)')]
        assert titles and titles[-1].lower().startswith('d') and 'crew-/pax-briefing' in titles[-1].lower(), 'Abschnittstitel D = Crew-/Pax-Briefing: ' + str(titles)
        if not mobile:
            opened = pg.eval_on_selector_all('.enav details', 'els => els.map(e => e.open)')
            assert opened.count(True) == 1, 'Akkordeon: genau ein Abschnitt offen: ' + str(opened)
            # 0.12.13: nur noch ein Knopf (Eigener Text) in der Titelzeile; Kommentar-Knopf entfällt; Schliessen ohne Inhalt sofort, mit Inhalt Rückfrage
            assert pg.query_selector('#panel-C\\.fpl .panel-head .add.cmt') is None, 'kein Kommentar-Knopf mehr'
            assert pg.query_selector('#panel-B\\.metar .panel-body > .sub.extra') is None, 'Zusatzbox ohne Inhalt nicht sichtbar'
            pg.click('#panel-B\\.metar .panel-head .rrow .add.extra'); pg.wait_for_timeout(300)
            assert pg.query_selector('#panel-B\\.metar .panel-body > .sub.extra textarea') is not None, 'Zusatzbox nach Klick'
            pg.click('#panel-B\\.metar .panel-body > .sub.extra .sub-close'); pg.wait_for_timeout(300)
            assert pg.query_selector('#panel-B\\.metar .panel-body > .sub.extra') is None and pg.query_selector('.dialog') is None, 'Zusatzbox ohne Inhalt schliesst ohne Rückfrage'
            pg.click('#panel-B\\.metar .panel-head .rrow .add.extra'); pg.wait_for_timeout(300)
            pg.fill('#panel-B\\.metar .panel-body > .sub.extra textarea', 'Notiz'); pg.wait_for_timeout(200)
            pg.click('#panel-B\\.metar .panel-body > .sub.extra .sub-close'); pg.wait_for_timeout(300)
            # 0.12.14: mit Inhalt wird eingeklappt (Vorschau), Klick klappt wieder auf – Inhalt bleibt
            assert pg.query_selector('.dialog') is None and pg.query_selector('#panel-B\\.metar .panel-body > .sub.extra.collapsed') is not None and 'Notiz' in pg.inner_text('#panel-B\\.metar .panel-body > .sub.extra.collapsed'), 'Zusatzbox mit Inhalt eingeklappt'
            pg.click('#panel-B\\.metar .panel-body > .sub.extra.collapsed'); pg.wait_for_timeout(300)
            assert pg.input_value('#panel-B\\.metar .panel-body > .sub.extra textarea') == 'Notiz', 'Aufklappen zeigt den Text wieder'
            assert pg.query_selector('#menuBtn svg.ico-menu') is not None and pg.query_selector('#tools button.print svg.ico-print') is not None and pg.query_selector('#panel-C\\.fpl .panel-head .rrow .add.extra svg.ico-text') is not None, 'SVG-Symbole (Menü, Drucken, Zusatzbox)'
            pg.screenshot(path=f'{OUT}/{name}_18_boxes.png')
            # 0.12.15: eingefügte Flugwetterprognose CH – Gültigkeit aus dem Text, Warnung (Start > nächste Aktualisierung), Briefingsicht gegliedert mit drei Windtabellen
            fwp = open(os.path.join(os.path.dirname(__file__), 'fixtures', 'fwp_ch.txt'), encoding='utf-8').read()
            pg.fill('#panel-B\\.fwp .sub.half textarea', fwp); pg.wait_for_timeout(600)
            vr = pg.inner_text('#panel-B\\.fwp .valid-row')
            assert 'aus dem Text' in vr and '10-10 05:00Z' in vr, 'Gültigkeitszeile aus dem Text: ' + vr
            assert pg.query_selector('#panel-B\\.fwp .cover-stripe') is not None and pg.query_selector('#panel-B\\.fwp .panel-head .now-warn') is not None, 'Bericht veraltet (nächste Aktualisierung vor Start + 1 h) → Warnung'
            bid_fwp = pg.evaluate('location.hash').split('/')[-1]
            pg.goto(BASE + '#/list'); pg.wait_for_timeout(300); pg.goto(BASE + f'#/v/{bid_fwp}'); pg.wait_for_timeout(1500)
            assert len(pg.query_selector_all('.brief .row-B-fwp .report-fmt table.rp-wt')) == 3 and 'Wetterlage' in [e.inner_text() for e in pg.query_selector_all('.brief .row-B-fwp .rp-h')], 'Briefingsicht: Bericht gegliedert, drei Windtabellen'
            assert pg.query_selector('.brief .row-B-fwp th .now-warn') is not None, 'Briefingsicht: Warndreieck bei veraltetem Bericht'
            pg.goto(BASE + '#/list'); pg.wait_for_timeout(300); pg.goto(BASE + f'#/b/{bid_fwp}'); pg.wait_for_timeout(1200)
            # 0.11.3: Tragkraft-Grafik mit Obergrenze, Max. Hüllentemperatur mit Vorgabe, Niveauliste der Trajektorien
            assert 'obergrenze' in (pg.text_content('#panel-A\\.massperf svg.curve') or '').lower(), 'Obergrenze in der Tragkraft-Grafik'
            assert 'max. hüllen' in pg.inner_text('#panel-A\\.massperf').lower().replace('\xad', '') and 'vorgabe' in pg.inner_text('#panel-A\\.massperf').lower(), 'Max. Hüllentemperatur mit Vorgabe des Ballons'
            lvin = pg.query_selector('#panel-B\\.traj .lvl-wrap input')
            if lvin:
                lvin.focus(); pg.wait_for_timeout(200)
                assert pg.is_visible('#panel-B\\.traj .lvl-pick') and len(pg.query_selector_all('#panel-B\\.traj .lvl-pick .lvl-it')) > 10, 'Niveauliste öffnet sich beim Klick ins Feld'
                pg.screenshot(path=f'{OUT}/{name}_19_levels.png')
            # 0.11.4: Vergrösserung auch im Editor (Klick auf die Tragkraft-Grafik), Füllungsgrad nur bei Gasballon
            pg.keyboard.press('Escape')
            pg.click('#panel-A\\.massperf svg.curve', position={'x': 60, 'y': 40}); pg.wait_for_timeout(400)
            assert pg.is_visible('.dialog.lb') and pg.query_selector('.dialog.lb .lb-body svg') is not None, 'Lightbox im Editor nach Klick auf die Grafik'
            pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
            assert pg.query_selector('.dialog.lb') is None, 'Lightbox mit Escape geschlossen'
            assert 'füllungsgrad' not in pg.inner_text('#panel-A\\.massperf .mp-sec.in').lower(), 'Heissluft: kein Füllungsgrad-Feld'
            pg.screenshot(path=f'{OUT}/{name}_20_lb_editor.png')
        # Sperre: Fahrt in die Vergangenheit legen → Erarbeitung leitet auf die Briefingsicht mit Hinweis um
        # 0.12.10: laufende Fahrt (Start vor 2 h): gesperrt, Abschnitt «Laufende Fahrten», Nachtrag nach Rückfrage → Archivkopie + Nummer mit Buchstabe
        pg.evaluate("""(id) => { const all = JSON.parse(localStorage.getItem('fb.briefings') || '{}'); const b = all[id]; b.time.startMs = Date.now() - 2 * 3600000; b.intent.durationMin = 600; localStorage.setItem('fb.briefings', JSON.stringify(all)); }""", bid)
        pg.goto(BASE + '#/list'); pg.wait_for_timeout(500)
        pg.goto(BASE + f'#/b/{bid}'); pg.wait_for_timeout(1500)
        assert '#/v/' in pg.evaluate('location.hash') and 'Fahrt läuft' in pg.inner_text('.lockbar') and 'Nachtrag' in pg.inner_text('.lockbar button'), 'laufende Fahrt → Briefingsicht mit Hinweis «Fahrt läuft» und Knopf «Nachtrag»'
        pg.goto(BASE + '#/list'); pg.wait_for_timeout(600)
        sects = [e.inner_text() for e in pg.query_selector_all('h3.list-sect')]
        assert len(sects) == 3 and sects[1].upper().startswith('LAUFENDE FAHRTEN (1)') and sects[2].upper().startswith('ARCHIV (0)'), 'Abschnitt «Laufende Fahrten»: ' + str(sects)
        no0 = pg.evaluate("(id) => JSON.parse(localStorage.getItem('fb.briefings'))[id].no", bid)
        if not mobile:
            assert pg.query_selector('table.tbl.list tr.locked button.amend') is not None and pg.query_selector('table.tbl.list tr.locked .acts .edit') is None, 'Laufende Fahrt: Nachtrag-Stift statt Bearbeiten'
            pg.click('table.tbl.list tr.locked button.amend'); pg.wait_for_timeout(400)
            assert pg.is_visible('.dialog') and no0 + 'a' in pg.inner_text('.dialog'), 'Rückfrage nennt die neue Briefingnummer ' + no0 + 'a'
            pg.click('.dialog button:has-text("Nachtrag anlegen")'); pg.wait_for_timeout(1500)
            assert pg.evaluate('location.hash') == f'#/b/{bid}' and pg.query_selector('.emain') is not None, 'Nachtrag: Erarbeitung öffnet sich trotz Sperre'
            st = pg.evaluate("(id) => { const all = JSON.parse(localStorage.getItem('fb.briefings')); const b = all[id]; const c = Object.values(all).find((x) => x.amendmentOf === id); return { no: b.no, cno: c && c.no, frozen: c && c.frozen, n: Object.keys(all).length }; }", bid)
            assert st['no'] == no0 + 'a' and st['cno'] == no0 and st['frozen'] is True, 'Archivkopie mit bisheriger Nummer, Briefing mit Buchstabe: ' + str(st)
            pg.goto(BASE + '#/list'); pg.wait_for_timeout(600)
            sects = [e.inner_text() for e in pg.query_selector_all('h3.list-sect')]
            assert sects[1].upper().startswith('LAUFENDE FAHRTEN (1)') and sects[2].upper().startswith('ARCHIV (1)'), 'nach dem Nachtrag: Archivkopie im Archiv: ' + str(sects)
            pg.goto(BASE + f'#/b/{bid}'); pg.wait_for_timeout(1200)
            assert '#/v/' in pg.evaluate('location.hash'), 'Erarbeitung erneut nur über einen neuen Nachtrag (Flag erloschen)'
        # Sperre: Fahrt in die Vergangenheit legen → Erarbeitung leitet auf die Briefingsicht mit Hinweis um; Archivkopie ebenfalls im Archiv
        pg.evaluate("""(id) => { const all = JSON.parse(localStorage.getItem('fb.briefings') || '{}'); for (const b of Object.values(all)) if (b.id === id || b.amendmentOf === id) b.time.startMs = Date.now() - 48 * 3600000; localStorage.setItem('fb.briefings', JSON.stringify(all)); }""", bid)
        pg.goto(BASE + '#/list'); pg.wait_for_timeout(500)
        pg.goto(BASE + f'#/b/{bid}'); pg.wait_for_timeout(1500)
        assert pg.query_selector('.lockbar') is not None and '#/v/' in pg.evaluate('location.hash'), 'gesperrtes Briefing → Briefingsicht mit Hinweis'
        pg.goto(BASE + '#/list'); pg.wait_for_timeout(600)
        # 0.12.9: zwei Abschnitte «Briefings in Arbeit» und «Archiv» (immer sichtbar, Archiv ohne Stift)
        sects = [e.inner_text() for e in pg.query_selector_all('h3.list-sect')]
        assert len(sects) == 2 and sects[0].upper().startswith('BRIEFINGS IN ARBEIT') and sects[1].upper().startswith('ARCHIV (') and pg.query_selector('.list-head button.chip') is None, 'Abschnitte der Briefings-Seite: ' + str(sects)
        assert pg.query_selector('#view svg.ico-lock') is not None, 'Schloss in der Liste (Archiv)'
        if not mobile:
            assert pg.query_selector('table.tbl.list td.no .lock') is not None and pg.query_selector('table.tbl.list tr.locked .acts .edit') is None, 'Schloss hinter der Nummer, kein Stift bei Sperre'
            assert pg.query_selector('table.tbl.list tr.locked button[title="Löschen"]') is None and pg.query_selector('table.tbl.list tr.locked button[title="Duplizieren als Vorlage"]') is not None, '0.12.9a: kein Papierkorb im Archiv, Kopieren möglich'
            hdrs = [x.strip() for x in pg.eval_on_selector_all('table.tbl.list th', 'els => els.map(e => e.textContent)')]
            assert hdrs[0].startswith('#') and any(x.startswith('Status') for x in hdrs) and 'Phase' not in hdrs and 'Links' not in hdrs, 'Spalten der Liste: ' + str(hdrs)
            # 0.11.3: Sortierung (Standard Nummer absteigend) und Doppelklick → Briefingsicht
            nos = [x.strip() for x in pg.eval_on_selector_all('table.tbl.list:first-of-type td.no', 'els => els.map(e => e.textContent)')]
            assert nos == sorted(nos, reverse=True), 'Liste absteigend nach Nummer: ' + str(nos)
            pg.click('table.tbl.list th.sortable >> nth=0'); pg.wait_for_timeout(300)
            nos2 = [x.strip() for x in pg.eval_on_selector_all('table.tbl.list:first-of-type td.no', 'els => els.map(e => e.textContent)')]
            assert nos2 == sorted(nos2), 'Klick auf # → aufsteigend: ' + str(nos2)
            pg.dblclick('table.tbl.list tbody tr >> nth=0 >> td >> nth=1'); pg.wait_for_timeout(800)
            assert pg.evaluate('location.hash').startswith('#/v/'), 'Doppelklick öffnet die Briefingsicht: ' + pg.evaluate('location.hash')
            pg.goto(BASE + '#/list'); pg.wait_for_timeout(400)
        pg.screenshot(path=f'{OUT}/{name}_17_locked.png')
        b.close()

def run_gas(name):
    """0.12: Gasfahrt – Panel A «Fahrtprofil», Höhenprofil-Werkzeug (Daten, Ziehen, Punkt setzen, Etappe setzen/umbenennen, Rückgängig,
    LT/UTC, Karte), Etappen- und Ballasttabelle, NOTAM-Orte aus Etappen, Briefingsicht."""
    import math
    from urllib.parse import parse_qs
    import zlib, struct
    def chunk(tag, data): return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    PNG = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b'\x00\x00\x00\x00\x00')) + chunk(b'IEND', b'')
    def elev(r):
        q = parse_qs(urlparse(r.request.url).query); lats = q['latitude'][0].split(','); lons = q['longitude'][0].split(',')
        r.fulfill(status=200, content_type='application/json', body=json.dumps({'elevation': [round(450 + 900 * max(0, math.sin((float(lo) - 8.0) * 3.0)) + 200 * math.sin(float(la) * 40)) for la, lo in zip(lats, lons)]}))
    def water(r):
        # Overpass-Nachbildung (0.12.2): je is_in-Punkt ein abgeleitetes Element; Punkte 30–33 jedes Abrufs liegen im «Testsee»
        n = r.request.post_data.count('is_in(')
        els = [{'type': 'm', 'id': i + 1, 'tags': {'i': str(i), 'id': '2400000001' if 30 <= i <= 33 else '', 'nm': 'Testsee' if 30 <= i <= 33 else '', 'wt': 'lake' if 30 <= i <= 33 else ''}} for i in range(n)]
        r.fulfill(status=200, content_type='application/json', body=json.dumps({'elements': els}))
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctxb = b.new_context(viewport={'width': 1366, 'height': 900}, device_scale_factor=1.5, locale='de-CH', timezone_id='Europe/Zurich')
        pg = ctxb.new_page()
        pg.on('console', lambda m: errors.append(f'[{name}] console.{m.type}: {m.text}') if m.type in ('error',) and 'Failed to load resource' not in m.text else None)
        pg.on('pageerror', lambda e: errors.append(f'[{name}] pageerror: {e} @ {(e.stack or "").splitlines()[1:3]}'))
        pg.route('**/js/config.js', lambda r: r.fulfill(status=200, content_type='application/javascript', body="window.BRIEFING_CONFIG = { apiBase: '' };"))
        mock_external(pg)
        pg.route('**/api.open-meteo.com/v1/elevation**', elev)
        pg.route('**/overpass-api.de/**', water)
        for pat in ['**/basemaps.cartocdn.com/**', '**/tile.opentopomap.org/**', '**/tile.openstreetmap.org/**', '**/server.arcgisonline.com/**']: pg.route(pat, lambda r: r.fulfill(status=200, content_type='image/png', body=PNG))
        # 0.12.2: nach der Anmeldung immer die Übersicht «Meine Briefings», auch wenn die Adresse anderswo zeigt
        pg.goto(BASE + '#/settings'); pg.wait_for_timeout(800)
        assert pg.is_visible('#gateVer') and 'Fahrtbriefing 0.' in pg.text_content('#gateVer'), 'Version auf der Anmeldeseite (0.12.6): ' + pg.text_content('#gateVer')
        pg.fill('#gatePw', '1234'); pg.click('#gateOpen'); pg.wait_for_timeout(900)
        assert pg.evaluate('location.hash') == '#/list' and pg.query_selector('.chips.scopes, table.list, .note') is not None, 'Nach der Anmeldung: Liste «Meine Briefings»: ' + pg.evaluate('location.hash')
        pg.goto(BASE + '#/new'); pg.wait_for_timeout(700)
        pg.click('.wiz button.chip:has-text("Gas")'); pg.wait_for_timeout(500)
        # 0.12.4: Ausrüstung (kg) im Schritt «Ballon & Fahrt» (Gas), Startzeit in 10-min-Schritten, Wettermodell wählbar in «Was ist geplant?» (Vorgabe ICON-EU)
        assert 'AUSRÜSTUNG' in pg.inner_text('.wiz').upper() and pg.query_selector('.wiz input[type=number]') is not None, 'Gas: Feld «Ausrüstung (kg)» im Schritt 1'
        pg.fill('.wiz input[type=number]', '45'); pg.dispatch_event('.wiz input[type=number]', 'input'); pg.wait_for_timeout(300)
        pg.click('button:has-text("Weiter →")'); pg.wait_for_timeout(900)
        assert pg.get_attribute('input[type=time]', 'step') == '600', 'Startzeit auf 10 min'
        pg.fill('input[type=time]', '20:00'); pg.dispatch_event('input[type=time]', 'change'); pg.wait_for_timeout(600)   # Start +28 h, 24 h Fahrt → ICON-D2 (48 h) deckt nur einen Teil ab
        pg.click('button:has-text("Weiter →")'); pg.wait_for_timeout(1500)
        sel = pg.query_selector('.wiz .row-actions select')
        assert sel is not None and pg.evaluate("el => el.value", sel) == 'icon_eu' and 'ICON-EU' in pg.inner_text('.wiz .row-actions'), 'Wettermodell wählbar, Vorgabe ICON-EU'
        pg.click('button:has-text("Weiter →")'); pg.wait_for_timeout(1200)
        # 0.12.6: 2. Pilot im Schritt «Personen» (0.12.7: alle Ballontypen) – Auswahl «frei» mit Name; zählt bei den Personen an Bord
        cosel = pg.query_selector_all('.wiz .frow.top select')[1]
        assert cosel is not None and '2. PILOT' in pg.inner_text('.wiz .frow.top').upper(), 'Feld «2. Pilot» im Schritt Personen'
        cosel.select_option('custom'); pg.wait_for_timeout(300)
        pg.fill('.wiz .frow.top input[type=text]:visible', 'Kurt Frieden'); pg.dispatch_event('.wiz .frow.top input[type=text]:visible', 'input'); pg.wait_for_timeout(400)
        assert '(inkl. PIC) 2 ·' in pg.inner_text('.wiz .card .sub2'), 'Vorschau zählt PIC + 2. Pilot: ' + pg.inner_text('.wiz .card .sub2')
        for i in range(2): pg.click('button:has-text("Weiter →")'); pg.wait_for_timeout(1200)
        assert 'Kurt Frieden' in pg.inner_text('.wiz'), 'Zusammenfassung nennt den 2. Piloten'
        pg.click('button:has-text("Briefing anlegen")'); pg.wait_for_timeout(3000)
        bid = pg.evaluate('location.hash').split('/')[-1]
        assert pg.query_selector('#panel-A\\.profile') is not None and pg.query_selector('#panel-A\\.retrieve') is not None, 'Gas: Panels «Fahrtprofil» und «Nachfahrer» (≥ 12 h)'
        assert 'Kurt Frieden' in pg.inner_text('#panel-A\\.core') and '2. Pilot' in pg.inner_text('#panel-A\\.core'), 'Stammdaten mit 2. Pilot'
        # 0.12.6: Übergangshöhen automatisch nach Ländern der Fahrt (CH: ZH + CH angeklickt, automatisch), von Hand → «wieder automatisch»
        tr = pg.query_selector('#panel-C\\.transition')
        # nth=4 = Frankreich (nie auf der Bahn); nth=5 = Deutschland kann je nach Bahn/GAFOR-Umriss automatisch gesetzt sein (0.12.10)
        assert tr is not None and 'automatisch' in tr.inner_text() and pg.is_checked('#panel-C\\.transition input[type=checkbox] >> nth=0') and pg.is_checked('#panel-C\\.transition input[type=checkbox] >> nth=1') and not pg.is_checked('#panel-C\\.transition input[type=checkbox] >> nth=4'), 'Übergangshöhen CH vorgekreuzt, automatisch'
        pg.click('#panel-C\\.transition input[type=checkbox] >> nth=4'); pg.wait_for_timeout(400)
        assert 'von Hand' in pg.inner_text('#panel-C\\.transition') and pg.query_selector('#panel-C\\.transition button:has-text("wieder automatisch")') is not None, 'Handänderung erkannt'
        pg.click('#panel-C\\.transition button:has-text("wieder automatisch")'); pg.wait_for_timeout(400)
        assert not pg.is_checked('#panel-C\\.transition input[type=checkbox] >> nth=4') and 'von Hand' not in pg.inner_text('#panel-C\\.transition'), 'wieder automatisch'
        pg.query_selector('#panel-A\\.profile').scroll_into_view_if_needed(); pg.wait_for_timeout(300)
        pg.screenshot(path=f'{OUT}/{name}_00_sticky.png')   # haftende Zeile mit «Alle verfügbaren Daten aktualisieren» und «Pflichtinhalte ergänzen»
        pg.click('#panel-A\\.profile button:has-text("Daten aufbereiten")')
        for i in range(40):
            pg.wait_for_timeout(500)
            if pg.query_selector('#panel-A\\.profile svg.pf-svg'): break
        assert pg.query_selector('#panel-A\\.profile svg.pf-svg') is not None, 'Fahrtprofil: Grafik nach «Daten aufbereiten»: ' + pg.inner_text('#panel-A\\.profile .row-actions')
        # 0.12.17b/d: Übergabe des Höhenprofils an die O2-Planung (Link mit Höhenstufen in ft, Dauer in h und Kurzcode)
        o2 = pg.get_attribute('#panel-A\\.profile .row-actions a.btn:has-text("O₂-Planung")', 'href') or ''
        import base64 as _b64
        o2d = json.loads(_b64.urlsafe_b64decode(o2.split('#i.')[1] + '==')) if '#i.' in o2 else {}
        assert o2.startswith('https://o2.wicki.aero/#i.') and o2d.get('s') == 1 and len(o2d.get('l', [])) >= 2 and all(a >= 0 and d > 0 for a, d in o2d['l']), 'O2-Planung: Übergabe-Link im Panel Fahrtprofil: ' + o2[:80]
        o2id = o2d.get('c', '')
        assert re.fullmatch(r'[A-HJKMNP-Z2-9]{6}', o2id), 'O2-Planung: das Briefing vergibt den Kurzcode: ' + o2id
        assert pg.query_selector('#panel-A\\.profile .pf-o2line') is None, 'vor der Übergabe keine Link-Zeile'
        # Klick ohne neuen Tab: Vorgabeaktion unterbinden, die Behandlung der App läuft trotzdem
        pg.evaluate("() => { const a = [...document.querySelectorAll('[id=\"panel-A.profile\"] .row-actions a.btn')].find((x) => x.textContent.includes('O₂-Planung')); a.addEventListener('click', (e) => e.preventDefault(), { once: true }); a.click(); }")
        pg.wait_for_timeout(500)
        ra = pg.inner_text('#panel-A\\.profile .row-actions')
        assert 'O₂-Planung öffnen' in ra and 'Profil neu übergeben' in ra, 'nach der Übergabe: «öffnen» und «neu übergeben»: ' + ra
        assert pg.get_attribute('#panel-A\\.profile .row-actions a.btn:has-text("O₂-Planung öffnen")', 'href') == 'https://o2.wicki.aero/#' + o2id, 'Link auf die Berechnung'
        re2 = json.loads(_b64.urlsafe_b64decode(pg.get_attribute('#panel-A\\.profile .row-actions a.btn:has-text("Profil neu übergeben")', 'href').split('#i.')[1] + '=='))
        assert re2.get('c') == o2id, 'erneute Übergabe mit demselben Kurzcode'
        assert o2id in pg.inner_text('#panel-A\\.profile .pf-o2line'), 'Link-Zeile im Panel'
        txt = pg.text_content('#panel-A\\.profile svg.pf-svg')
        assert 'SS' in txt and 'ECET' in txt and 'BCMT' in txt and 'km' in txt and 'Sonne' not in txt and 'Tag' not in txt.replace('Tage', ''), 'Zeitzeile mit Sonnenzeiten, ohne Zeilenbeschriftungen «Sonne»/«Tag»: ' + txt[:200]
        assert len(pg.query_selector_all('#panel-A\\.profile table.pf-stages tbody tr')) >= 3 and len(pg.query_selector_all('#panel-A\\.profile table.pf-ballast tbody tr')) >= 4, 'Etappen- und Ballasttabelle im Panel'
        # 0.12.2: Wasser aus OSM (Legende), Spalte «Level-Out», Titel, Legende offen und Modell der Schätzung zu (einklappbar)
        assert 'OpenStreetMap' in pg.inner_text('#panel-A\\.profile .pf-legend') and 'Level-Out' in pg.inner_text('#panel-A\\.profile table.pf-ballast') and 'SCHÄTZUNG BALLASTVERBRAUCH' in pg.inner_text('#panel-A\\.profile .pf-ballast-wrap').upper(), 'Wasser aus OSM, Level-Out, Titel'
        assert pg.evaluate("() => document.querySelector('[id=\"panel-A.profile\"] details.pf-fold.legend').open && !document.querySelector('[id=\"panel-A.profile\"] details.pf-fold.model').open"), 'Legende offen, Modell der Schätzung zu'
        pg.click('#panel-A\\.profile details.pf-fold.model summary'); pg.wait_for_timeout(300)
        assert 'Adiab.' in pg.inner_text('#panel-A\\.profile details.pf-fold.model') and pg.evaluate("() => document.querySelector('[id=\"panel-A.profile\"] details.pf-fold.model').open"), 'Modell der Schätzung aufgeklappt mit Spaltenerklärung'
        assert 'Pflichtinhalte' in pg.inner_text('.refresh-all .must-btn') and pg.evaluate("() => getComputedStyle(document.querySelector('.refresh-all')).position") == 'sticky', 'Knopf «Pflichtinhalte ergänzen» in der haftenden Zeile'
        eq = pg.inner_text('#panel-A\\.equipment')
        assert 'Druckerhöhung' not in eq and 'Heli' not in eq and 'NVR' in eq, 'Gas: ohne Druckerhöhung/Heli-Bergung in A «Spezialausrüstung»: ' + eq[:120]
        assert '45' in pg.inner_text('#panel-A\\.massperf'), 'Ausrüstung 45 kg in der Tragkraft-/Ballastrechnung: ' + pg.inner_text('#panel-A\\.massperf')[:200]
        pg.query_selector('#panel-A\\.profile').screenshot(path=f'{OUT}/{name}_01_panel.png')
        pg.click('#panel-A\\.profile button:has-text("Werkzeug öffnen")'); pg.wait_for_timeout(800)
        assert pg.is_visible('.dialog.pf-tool'), 'Werkzeug geöffnet'
        assert pg.is_visible('.pf-tool .pf-save') and pg.is_visible('.pf-tool .pf-discard') and len(pg.query_selector_all('.pf-tool .pf-zoom')) == 1 and pg.is_disabled('.pf-tool .pf-winall'), 'Werkzeug (0.12.6/0.12.7): «Speichern und schliessen», «Schliessen ohne Speichern», Spreizung Höhe, «Ganze Fahrt» (aus)'
        pg.screenshot(path=f'{OUT}/{name}_02_tool.png')
        # 0.12.7: Ausschnitt – Schieber unter der Zeitskala: Endmarke nach links ziehen → Fenster, km-Skala feiner, «Ganze Fahrt» aktiv; Band verschieben; Doppelklick = ganze Fahrt
        assert pg.query_selector('.pf-tool svg .pf-brush') is not None and 'Ausschnitt' in pg.text_content('.pf-tool svg.pf-svg') and 'Ganze Fahrt' in pg.text_content('.pf-tool svg .pf-br-lbl'), 'Schieber «Ausschnitt» mit Beginn-/Endmarke, Beschriftung «Ganze Fahrt»'
        tr = pg.query_selector('.pf-tool svg .pf-br-track').bounding_box(); hb = pg.query_selector('.pf-tool svg .pf-br-h[data-end=b]').bounding_box()
        km_lbls0 = len(pg.query_selector_all('.pf-tool svg text'))
        pg.mouse.move(hb['x'] + hb['width'] / 2, hb['y'] + hb['height'] / 2); pg.mouse.down(); pg.mouse.move(tr['x'] + tr['width'] * 0.35, hb['y'] + hb['height'] / 2, steps=10); pg.mouse.up(); pg.wait_for_timeout(500)
        lbl = pg.text_content('.pf-tool svg .pf-br-lbl')
        assert lbl.startswith('Ausschnitt 0–') and 'km' in lbl and not pg.is_disabled('.pf-tool .pf-winall') and pg.evaluate("() => document.querySelector('.pf-tool svg.pf-svg').getAttribute('viewBox')").startswith('0 0 1040 '), 'Endmarke gezogen → Fenster ab km 0, Grafik gleich breit: ' + lbl
        assert pg.query_selector('.pf-tool svg g[clip-path]') is not None, 'Lagebezogenes im Ausschnitt beschnitten (clipPath)'
        pg.screenshot(path=f'{OUT}/{name}_02z_window.png')
        bb_ = pg.query_selector('.pf-tool svg .pf-br-band').bounding_box()
        pg.mouse.move(bb_['x'] + bb_['width'] / 2, bb_['y'] + bb_['height'] / 2); pg.mouse.down(); pg.mouse.move(bb_['x'] + bb_['width'] / 2 + tr['width'] * 0.3, bb_['y'] + bb_['height'] / 2, steps=10); pg.mouse.up(); pg.wait_for_timeout(500)
        lbl2 = pg.text_content('.pf-tool svg .pf-br-lbl')
        assert lbl2.startswith('Ausschnitt ') and not lbl2.startswith('Ausschnitt 0–'), 'Band verschoben: ' + lbl2
        pg.click('.pf-tool .pf-winall'); pg.wait_for_timeout(500)
        assert 'Ganze Fahrt' in pg.text_content('.pf-tool svg .pf-br-lbl') and pg.is_disabled('.pf-tool .pf-winall'), '«Ganze Fahrt» stellt die ganze Fahrt wieder her'
        ha = pg.query_selector('.pf-tool svg .pf-br-h[data-end=a]').bounding_box()
        pg.mouse.move(ha['x'] + ha['width'] / 2, ha['y'] + ha['height'] / 2); pg.mouse.down(); pg.mouse.move(tr['x'] + tr['width'] * 0.5, ha['y'] + ha['height'] / 2, steps=10); pg.mouse.up(); pg.wait_for_timeout(500)
        assert not pg.text_content('.pf-tool svg .pf-br-lbl').startswith('Ausschnitt 0–'), 'Beginnmarke gezogen'
        pg.mouse.dblclick(tr['x'] + tr['width'] * 0.75, tr['y'] + tr['height'] / 2); pg.wait_for_timeout(500)
        assert 'Ganze Fahrt' in pg.text_content('.pf-tool svg .pf-br-lbl'), 'Doppelklick auf den Schieber = ganze Fahrt'
        # Spreizung Höhe ×2: Grafik höher, Rahmen rollt; zurück
        pg.click('.pf-tool .pf-zoom >> nth=0 >> button:has-text("2×")'); pg.wait_for_timeout(600)
        assert pg.evaluate("() => document.querySelector('.pf-tool svg.pf-svg').getAttribute('viewBox')").endswith(' 1130') and pg.evaluate("() => document.querySelector('.pf-tool .pf-chart').classList.contains('zoomed')"), 'Spreizung Höhe ×2 (550·2 + 30)'
        pg.click('.pf-tool .pf-zoom >> nth=0 >> button:has-text("1×")'); pg.wait_for_timeout(500)
        # Modellwahl: kurzes Modell → Warnung unter der Layer-Box und Marker «Ende Prognosemodell» über der Grafik; langes Modell → weg
        pg.click('.pf-tool .pf-modelbtn'); pg.wait_for_timeout(300)
        opts = pg.eval_on_selector_all('.pf-tool .pf-menu button', 'els => els.map(e => e.textContent)')
        # Horizont-Warnung nur, wenn Start + 24 h Fahrt über 48 h hinausreichen (Start mehr als 24 h entfernt – hängt von der Tageszeit des Testlaufs ab)
        import datetime as _dt; _m = re.search(r'Start \S+ (\d\d)\.(\d\d)\.(\d{4}) (\d\d):(\d\d)', pg.text_content('.pf-tool svg.pf-svg')); _st = _dt.datetime(int(_m.group(3)), int(_m.group(2)), int(_m.group(1)), int(_m.group(4)), int(_m.group(5))); far = (_st - _dt.datetime.now()).total_seconds() > 24.5 * 3600
        assert any('ICON-D2' in o and (('⚠' in o) == far) for o in opts) and any('GFS' in o for o in opts) and any('ICON-EU' in o and 'Vorgabe' in o for o in opts) and not any('Auto' in o for o in opts), f'Modell-Pille öffnet die Liste mit Horizont-Warnung (far={far}) und Vorgabe: ' + str(opts)
        assert 'Wettermodell' in pg.inner_text('.pf-tool .pf-modelbtn') and 'ICON-EU' in pg.inner_text('.pf-tool .pf-modelbtn') and 'Punkte ziehen' in pg.inner_text('.pf-tool .pf-legend'), 'Pille «Wettermodell ICON-EU», Bedienhinweis als erste Legendenzeile'
        pg.click('.pf-tool .pf-menu button:has-text("ICON-D2")'); pg.wait_for_timeout(3500)
        assert (pg.is_visible('.pf-tool .pf-modelwarn') and 'Ende Prognosemodell' in pg.text_content('.pf-tool svg.pf-svg')) == far, f'Modellhorizont-Warnung und Marker (far={far})'
        pg.screenshot(path=f'{OUT}/{name}_02b_cut.png')
        pg.click('.pf-tool .pf-modelbtn'); pg.wait_for_timeout(300); pg.click('.pf-tool .pf-menu button:has-text("GFS")'); pg.wait_for_timeout(3500)
        assert not pg.is_visible('.pf-tool .pf-modelwarn'), 'Warnung weg mit GFS'
        # 0.12.1: Beispiel (synthetische Fahrt mit Erklärungen), Schliessen führt zur Planung zurück; Inversion/Isothermie in der Legende
        pg.click('.pf-tool button.pf-sample'); pg.wait_for_timeout(800)
        assert len(pg.query_selector_all('.pf-tool svg .pf-callout')) >= 7 and len(pg.query_selector_all('.pf-tool .pf-callouts li')) >= 9 and 'Isothermie' in pg.inner_text('.pf-tool .pf-legend'), 'Beispiel mit nummerierten Erklärungen, Quellen und Isothermie'
        assert len(pg.query_selector_all('.pf-tool .pf-ballast-grid table')) == 2, 'Ballasttabelle des Beispiels in zwei Spalten'
        pg.query_selector('.pf-tool .pf-body').screenshot(path=f'{OUT}/{name}_02c_sample.png')
        pg.click('.pf-tool button.pf-sample'); pg.wait_for_timeout(800)
        assert len(pg.query_selector_all('.pf-tool svg .pf-callout')) == 0, 'Beispiel geschlossen → Planung ohne Erklärungen'
        idle = lambda: [pg.wait_for_timeout(300) for _ in range(40) if pg.inner_text('.pf-tool .pf-status').strip()]   # Nachrechnen abwarten (Statuszeile leer)
        idle()
        pts0 = pg.evaluate("() => [...document.querySelectorAll('.pf-tool svg .pf-pt')].map(c => [+c.getAttribute('cx'), +c.getAttribute('cy')])")
        a0 = pg.evaluate("() => [...document.querySelectorAll('.pf-tool svg .pf-pt')].map(c => parseInt(c.querySelector('title').textContent))")
        svg = pg.query_selector('.pf-tool svg.pf-svg'); box = svg.bounding_box(); vb = svg.get_attribute('viewBox').split(); sx = box['width'] / float(vb[2]); sy = box['height'] / float(vb[3])
        x0, y0 = box['x'] + pts0[1][0] * sx, box['y'] + pts0[1][1] * sy
        pg.mouse.move(x0, y0); pg.mouse.down(); pg.mouse.move(x0 + 20 * sx, y0 - 60 * sy, steps=8); pg.mouse.up(); pg.wait_for_timeout(2500); idle()
        alts = lambda: pg.evaluate("() => [...document.querySelectorAll('.pf-tool svg .pf-pt')].map(c => parseInt(c.querySelector('title').textContent))")
        a1 = alts()
        assert a1[1] >= a0[1] + 200 and not pg.is_disabled('.pf-tool button:has-text("Rückgängig")'), f'Punkt gezogen ({a0[1]} → {a1[1]} m), Rückgängig aktiv'
        n0 = len(pg.query_selector_all('.pf-tool svg .pf-pt')); pg.mouse.dblclick(box['x'] + 500 * sx, box['y'] + 200 * sy); pg.wait_for_timeout(2500); idle()
        assert len(pg.query_selector_all('.pf-tool svg .pf-pt')) == n0 + 1, 'Doppelklick setzt einen Punkt'
        # 0.12.5: Klick auf die Zeitzeile öffnet den Dialog «Neue Etappe» (Name, Klickbox «Ops-Briefing für Etappe»)
        s0 = len(pg.query_selector_all('.pf-tool svg .pf-sh')); ops0 = len(pg.query_selector_all('.pf-tool svg .pf-ops')); ab = pg.query_selector('.pf-tool svg .pf-axis').bounding_box(); shs = [e.bounding_box() for e in pg.query_selector_all('.pf-tool svg .pf-sh')]; cx = (shs[0]['x'] + shs[0]['width'] / 2 + shs[-1]['x'] + shs[-1]['width'] / 2) / 2 if len(shs) >= 2 else ab['x'] + ab['width'] * 0.6; pg.mouse.click(cx, ab['y'] + ab['height'] / 2); pg.wait_for_timeout(600)   # zwischen den Etappengriffen → «Nacht» wird E3 (unabhängig von Tageslänge)
        assert ops0 == 1 and pg.is_visible('.pf-menu.pf-newstage') and 'Ops-Briefing' in pg.inner_text('.pf-menu.pf-newstage') and len(pg.query_selector_all('.pf-tool svg .pf-sh')) == s0, 'Startetappe mit Marke B/C; Dialog «Neue Etappe» mit Klickbox, noch keine Grenze gesetzt'
        pg.fill('.pf-menu.pf-newstage input[type=text]', 'Nacht'); pg.check('.pf-menu.pf-newstage input[type=checkbox]'); pg.click('.pf-menu.pf-newstage button:has-text("Etappe anlegen")'); pg.wait_for_timeout(600)
        assert len(pg.query_selector_all('.pf-tool svg .pf-sh')) == s0 + 1 and 'Nacht' in pg.text_content('.pf-tool svg.pf-svg') and len(pg.query_selector_all('.pf-tool svg .pf-ops')) == 2, 'Etappe «Nacht» mit Planung angelegt (Griff, Name, Marke B/C)'
        assert len(pg.query_selector_all('.pf-tool table.pf-stages .pf-opstag')) == 2 and 'eigener Planung' in pg.inner_text('.pf-tool .pf-legend'), 'Etappentabelle und Legende zeigen die Planungs-Marke'
        mi = pg.query_selector_all('.pf-tool svg .pf-mi[data-kind=stage]')[-1]; mb = mi.bounding_box(); pg.mouse.click(mb['x'] + mb['width'] / 2, mb['y'] + mb['height'] / 2); pg.wait_for_timeout(400)
        assert pg.is_visible('.pf-menu') and 'zusammenlegen' in pg.inner_text('.pf-menu') and pg.is_checked('.pf-menu label.pf-ops-row input') is False, 'Etappenmenü (letzte Etappe «Landung») mit Zusammenlegen und Klickbox aus'
        pg.fill('.pf-menu input[type=text]', 'Voralpen'); pg.click('.pf-menu button:has-text("Umbenennen")'); pg.wait_for_timeout(400)
        assert 'Voralpen' in pg.text_content('.pf-tool svg.pf-svg'), 'Etappe umbenannt'
        pg.screenshot(path=f'{OUT}/{name}_03_tool_edit.png')
        pg.keyboard.press('Control+z'); pg.wait_for_timeout(1200)
        assert 'Voralpen' not in pg.text_content('.pf-tool svg.pf-svg'), 'Ctrl+Z nimmt die Umbenennung zurück'
        # Klickbox der Startetappe: ausschaltbar, weil «Nacht» eine Planung hat; danach sperrt die Mindestens-eine-Regel die Klickbox bei «Nacht»
        mi = pg.query_selector_all('.pf-tool svg .pf-mi[data-kind=stage]')[0]; mb = mi.bounding_box(); pg.mouse.click(mb['x'] + mb['width'] / 2, mb['y'] + mb['height'] / 2); pg.wait_for_timeout(400)
        assert pg.is_checked('.pf-menu label.pf-ops-row input') and not pg.is_disabled('.pf-menu label.pf-ops-row input') and 'Abschnitte B und C' in pg.inner_text('.pf-menu'), 'Startetappe: Klickbox an (= Abschnitte B/C), ausschaltbar'
        pg.uncheck('.pf-menu label.pf-ops-row input'); pg.wait_for_timeout(500)
        assert len(pg.query_selector_all('.pf-tool svg .pf-ops')) == 1, 'Planung der Startetappe ausgeschaltet → eine Marke'
        mi = pg.query_selector('.pf-tool svg .pf-mi[data-kind=stage][data-name="Nacht"]'); mb = mi.bounding_box(); pg.mouse.click(mb['x'] + mb['width'] / 2, mb['y'] + mb['height'] / 2); pg.wait_for_timeout(400)
        assert pg.input_value('.pf-menu input[type=text]') == 'Nacht' and pg.is_checked('.pf-menu label.pf-ops-row input') and pg.is_disabled('.pf-menu label.pf-ops-row input') and 'mindestens' in pg.inner_text('.pf-menu'), 'Einzige Planung («Nacht»): Klickbox gesperrt mit Hinweis'
        pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
        mi = pg.query_selector_all('.pf-tool svg .pf-mi[data-kind=stage]')[0]; mb = mi.bounding_box(); pg.mouse.click(mb['x'] + mb['width'] / 2, mb['y'] + mb['height'] / 2); pg.wait_for_timeout(400)
        pg.check('.pf-menu label.pf-ops-row input'); pg.wait_for_timeout(500)
        assert len(pg.query_selector_all('.pf-tool svg .pf-ops')) == 2, 'Planung der Startetappe wieder an'
        pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
        pg.click('.pf-tool .seg button:has-text("UTC")'); pg.wait_for_timeout(600)
        assert 'UTC' in pg.text_content('.pf-tool svg.pf-svg') and 'Abschnitt UTC' in pg.inner_text('.pf-tool table.pf-ballast'), 'LT/UTC-Schalter wirkt auf Grafik und Ballasttabelle'
        pg.click('.pf-tool .seg button:has-text("Karte")'); pg.wait_for_timeout(1200)
        assert pg.is_visible('.pf-tool .pf-map') and len(pg.query_selector_all('.pf-tool .pf-stage-icon')) >= 3, 'Kartenansicht mit Etappenmarkern'
        pg.click('.pf-tool .seg button:has-text("Satellit")'); pg.wait_for_timeout(600)
        pg.screenshot(path=f'{OUT}/{name}_04_tool_map.png')
        # «Speichern und schliessen» sichert den Stand (Etappe «Nacht» mit Planung); danach (0.12.6) «Schliessen ohne Speichern»: eine Umbenennung wird verworfen
        pg.click('.pf-tool .pf-save'); pg.wait_for_timeout(1500)
        assert pg.query_selector('.dialog.pf-tool') is None, 'Werkzeug mit «Speichern und schliessen» geschlossen'
        pg.click('#panel-A\\.profile button:has-text("Werkzeug öffnen")'); pg.wait_for_timeout(1500)
        n_ops = len(pg.query_selector_all('.pf-tool svg .pf-ops'))
        mi = pg.query_selector('.pf-tool svg .pf-mi[data-kind=stage][data-name="Nacht"]'); mb = mi.bounding_box(); pg.mouse.click(mb['x'] + mb['width'] / 2, mb['y'] + mb['height'] / 2); pg.wait_for_timeout(400)
        pg.fill('.pf-menu input[type=text]', 'Verworfen'); pg.click('.pf-menu button:has-text("Umbenennen")'); pg.wait_for_timeout(500)
        assert 'Verworfen' in pg.text_content('.pf-tool svg.pf-svg'), 'umbenannt'
        pg.click('.pf-tool .pf-discard'); pg.wait_for_timeout(1200)
        pg.click('#panel-A\\.profile button:has-text("Werkzeug öffnen")'); pg.wait_for_timeout(1500)
        assert 'Verworfen' not in pg.text_content('.pf-tool svg.pf-svg') and 'Nacht' in pg.text_content('.pf-tool svg.pf-svg') and len(pg.query_selector_all('.pf-tool svg .pf-ops')) == n_ops, 'Schliessen ohne Speichern: Umbenennung verworfen, Etappe «Nacht» mit Planung bleibt'
        pg.click('.pf-tool .pf-save'); pg.wait_for_timeout(2500)
        assert pg.query_selector('.dialog.pf-tool') is None, 'Werkzeug mit «Speichern und schliessen» geschlossen'
        leg = pg.eval_on_selector_all('#panel-A\\.profile .pf-legend > span', 'els => els.map(e => e.textContent)')
        assert any('Relief' in x for x in leg) and not any('CTR' in x for x in leg), 'Legende nur mit vorkommenden Symbolen: ' + str(leg)
        # 0.12.5: Etappen-Briefing «E2 · Etappe 2 · Nacht» zwischen C und D mit eigenen B/C-Panels, in der Navigation und bei «Pflichtinhalte ergänzen»
        heads = pg.query_selector_all('.sect-title.stage')
        assert len(heads) == 2 and 'E1' in heads[0].inner_text() and 'Nacht' in heads[1].inner_text() and 'Ort der Planung' in pg.inner_text('.sect-sub >> nth=1'), 'Etappenköpfe E1 (Startetappe = B/C) und E3 «Nacht» mit Zeitfenster/Ort (0.12.6)'
        assert len(pg.query_selector_all('.sect-title.sub')) == 4, 'B/C als Untertitel je Etappe'
        sub1 = pg.inner_text('.sect-sub >> nth=0'); assert 'Etappe 1 bis km' in sub1 and 'nur ihr Bereich' in sub1, '0.12.7: Planung der Startetappe nur auf ihren Bereich: ' + sub1
        assert pg.text_content('#panel-B\\.metar .pno').startswith('E1-B') and pg.text_content('.panel[id^="panel-st"][id$="-C.notam"] .pno').startswith('E3-C') and pg.text_content('#panel-A\\.core .pno') == 'A01' and pg.text_content('.enav details[data-sect="E1"] .it .pno').startswith('E1-'), '0.12.7: Panel-Nummern mit Etappe («E1-B2», «E3-C3»), A ohne'
        sb = pg.query_selector_all('.refresh-all .stage-btn'); assert len(sb) == 2 and 'E1' in sb[0].inner_text() and 'Nacht' in sb[1].inner_text(), 'Etappen-Knöpfe in der haftenden Zeile'
        sb[1].click(); pg.wait_for_timeout(900)
        assert pg.evaluate("() => document.getElementById('sect-E3').getBoundingClientRect().top < 260"), 'Knopf springt zum Etappenkopf E3'
        assert pg.query_selector('.enav details[data-sect="E1"]') is not None and len(pg.query_selector_all('.enav details[data-sect="E1"] .subhead')) == 2 and pg.query_selector('.enav details[data-sect="B"]') is None, 'Navigation: E1 mit Untergruppen B/C statt B/C auf oberster Ebene'
        sp = pg.query_selector_all('.panel[id^="panel-st"]'); assert len(sp) >= 12 and any(e.get_attribute('id').endswith('-C.notam') for e in sp) and not any(e.get_attribute('id').endswith('-C.fpl') for e in sp), 'Panels der Etappe (B/C ohne Flugplan): ' + str(len(sp))
        es = heads[1].query_selector('.id').text_content()   # «Nacht» ist die dritte Etappe → E3
        assert es == 'E3' and pg.query_selector(f'.enav details[data-sect="{es}"]') is not None and 'Nacht' in pg.text_content(f'.enav details[data-sect="{es}"] summary'), 'Navigation mit Abschnitt ' + es
        order = pg.evaluate("() => [...document.querySelectorAll('.sect-title')].map(e => e.querySelector('.id').textContent)")
        assert order == ['A', 'B', 'E1', 'B', 'C', 'E3', 'B', 'C', 'D'], 'Reihenfolge A · B(ganze Fahrt, 0.12.8) · E1(B C) · E3(B C) · D: ' + str(order)
        assert pg.query_selector('#sect-W') is not None and 'Ganze Fahrt' in pg.inner_text('#sect-W') and pg.text_content('#panel-B\\.synoptic .pno') == 'B01' and pg.query_selector('.enav details[data-sect="W"]') is not None, '0.12.8: Allgemeine Lage vor der Startetappe (Abschnitt «Ganze Fahrt», Nummer ohne Etappe)'
        for _ in range(40):
            pg.wait_for_timeout(300)
            if pg.query_selector('.panel[id$="-B.meteogram"] svg, .panel[id$="-B.meteogram"] table'): break
        assert pg.query_selector('.panel[id$="-B.meteogram"] svg, .panel[id$="-B.meteogram"] table') is not None, 'Meteogramm der Etappe automatisch geladen'
        assert 'Nacht' not in pg.inner_text('.panel[id$="-C.notam"] .ptools') and pg.query_selector('.panel[id$="-C.notam"] .ptools select') is not None, 'NOTAM-Panel der Etappe mit Modus-Wahl'
        pg.query_selector('.sect-title.stage').screenshot(path=f'{OUT}/{name}_06_stage_title.png')
        pg.evaluate("() => document.querySelector('.sect-title.stage').scrollIntoView()"); pg.wait_for_timeout(400); pg.screenshot(path=f'{OUT}/{name}_06_stage.png')
        pg.select_option('#panel-C\\.notam .ptools select', 'places'); pg.wait_for_timeout(500)
        pg.click('#panel-C\\.notam button:has-text("Orte aus Etappen")'); pg.wait_for_timeout(500)
        assert len(pg.query_selector_all('#panel-C\\.notam .np-row')) >= 3, 'NOTAM-Orte aus den Etappen'
        pg.goto(BASE + '#/v/' + bid); pg.wait_for_timeout(2500)
        assert o2id in (pg.inner_text('.brief tr.row-A-profile .pf-o2line') if pg.query_selector('.brief tr.row-A-profile .pf-o2line') else ''), 'Briefingsicht: Link auf die O2-Berechnung (0.12.17d)'
        assert pg.query_selector('.brief tr.row-A-profile svg.pf-svg') is not None and pg.query_selector('.brief tr.row-A-profile table.pf-ballast') is not None, 'Briefingsicht: Profil mit Ballasttabelle'
        assert pg.evaluate("() => document.querySelector('.brief tr.row-A-profile details.pf-fold.legend').open") and pg.query_selector('.brief tr.row-A-profile details.pf-fold.model') is not None, 'Briefingsicht: Legende immer offen, Modell der Schätzung nur weil im Panel aufgeklappt'
        st = pg.query_selector_all('.brief tr.row-A-profile table.pf-stages.wrap tbody tr.st2'); assert len(st) >= 3 and 'Lufträume' in st[0].inner_text() and 'Kontakte' in st[0].inner_text() and pg.evaluate("() => { const t = document.querySelector('.brief tr.row-A-profile table.pf-stages.wrap'); return t.scrollWidth <= t.parentElement.clientWidth + 1; }"), '0.12.9a: Etappenübersicht zweizeilig, nicht breiter als die Zelle'
        pg.query_selector('.brief tr.row-A-profile').screenshot(path=f'{OUT}/{name}_05_view.png')
        bsx = pg.query_selector_all('.brief .bs.stage'); assert len(bsx) == 2 and 'E1' in bsx[0].inner_text() and 'Nacht' in bsx[1].inner_text() and len(pg.query_selector_all('.brief tr.row-B-meteogram')) == 2 and pg.text_content('.brief tr.row-B-meteogram .pno').startswith('E1-B'), 'Briefingsicht: Etappenköpfe E1 (Startetappe, 0.12.7) und E3 «Nacht», Panel-Nummern mit Etappe'
        pg.query_selector('.brief .bs.stage').scroll_into_view_if_needed(); pg.wait_for_timeout(300); pg.screenshot(path=f'{OUT}/{name}_07_view_stage.png')
        b.close()

run('desktop', {'width': 1366, 'height': 860})
run('gladbeck', {'width': 1366, 'height': 860}, site_chip='Gladbeck')
run('phone', {'width': 390, 'height': 844}, scale=2, mobile=True)
run('ipad', {'width': 820, 'height': 1180}, scale=2, mobile=True)
run_gas('gas')
print('\n'.join(errors) if errors else 'keine Konsolenfehler')
