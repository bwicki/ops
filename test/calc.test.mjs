/* Tests der Rechenmodule gegen die Excel-Vorlagen und die RAC-4-4-Tabelle.
 * Aufruf: node test/calc.test.mjs
 */
import { hotAir, gasBalloon, reserveMinutes, CYLINDER_CATALOG } from '../js/calc/aero.js';
import { sunTimes, moonTimes, moonIllumination, moonPhaseName } from '../js/calc/sun.js';
import { parseRacText, racLookup } from '../js/calc/rac.js';
import { fromLocal, hhmm, localParts, tzOffsetMin, isoDate } from '../js/calc/time.js';
import { icao, parseIcao, distKm, countryGuess, countryGuessStrict, fixCountry, setDeRings, setCountryRings } from '../js/calc/geo.js';
import { touchesCH, panelNo, visiblePanels, mandatoryPanels, panelFilled, panelByKey } from '../js/panels.js';
import { targetEstimate } from '../js/auto/traj.js';
import { buildFpl, fplMessage, fplCheck, firCode, fplName, fplPlace, fplPerson, fplPhone, fplLevel, driftWords, eetFromFirs } from '../js/calc/fpl.js';
import { buildSchedule, trailerMinutes, buildPlan, planTemplate, planToStops, scheduleWarnings, planOrderWarnings, ACT_DEFAULT_MIN } from '../js/calc/schedule.js';
import { readFileSync } from 'node:fs';
import * as OM from '../js/auto/openmeteo.js';
import { parseLevel, tracks, levelAltM } from '../js/auto/traj.js';
import { vfrRelevant } from '../js/auto/data.js';
import { normalizeAirspace, analyzeAirspaces, limitFt, limitText, inAirspace, distToAirspaceKm, requirementKey, siteWarnings, isPlainEG } from '../js/calc/airspace.js';
import { goNoGo } from '../js/calc/gonogo.js';
import { changesSinceFinal } from '../js/calc/diff.js';
import { resolveBalloon, mergeSettings } from '../js/defaults.js';
import { routeMatrix, countryInfo } from '../js/countries.js';
import { altAt, msAtKm, kmAtMs, segments, rateClass, reliefBreaches, addStage, removeStage, moveStage, stageWindows, nightFraction, ballastPlan, fitPoints, defaultPoints, hazards, rhoAir, waterRuns, waterFromItems } from '../js/calc/profile.js';
import { fisSectors } from '../js/auto/profiledata.js';
import { parseIcaoNotam, notamKey, notamCover, notamPointsOfBriefing } from '../worker/src/wx.js';
import { placeLabel } from '../js/model.js';
import { actualPoints, actualWaypoints, plannedTracks, posAt, compareTrack, compareAll, hourlyPoints } from '../js/calc/actual.js';
import { inSwitzerland } from '../js/panels.js';
import { parseDwdAstro } from '../js/calc/sun.js';
import { balloonImage, formatNo, sunFor, countriesLine, briefingYear, lockMs, isLocked, archiveMs, isArchived, isRunning, nextAmendmentNo, amendBriefingData, completion, fileBase, titleLine, lastChangeLine, paxLine, duplicateBriefing, newBriefing, upgradeBriefing, ageRefMs, fillFractionOf, massPerf, personsOnBoard, hasCopilot, applicableTransitions, transitionItems } from '../js/model.js';
import { carCode } from '../js/net.js';
import { stageOps, canDropOps, ensureOps, coverPoints, countryAtKm, stagePlanBriefing, stageSets, startPlanOff, startPlanBriefing, startPlanSig, planStale, pruneStagePlans } from '../js/calc/stageplan.js';
import { defaultStages, renameStartStage } from '../js/calc/profile.js';
import { decodeMetar as dMetar, decodeTaf as dTaf, tafGroupWindows, tafValidEnd } from '../js/calc/metar.js';
import { parseReport, reportValidity, parseDeDateUtc } from '../js/calc/report.js';

let fails = 0, n = 0;
const ok = (cond, msg) => { n++; if (!cond) { fails++; console.log('  FAIL', msg); } else console.log('  ok  ', msg); };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

console.log('Heissluft HB-QWP (Excel: Startgewicht 765, Minder −118, Max. Steighöhe 5700)');
const va70 = CYLINDER_CATALOG.find((c) => c.id === 'va70');
const qwp = hotAir({
  volume: 3400, siteAlt: 1085, tempC: 8, qnh: 1024, envTempC: 100,
  masses: { envelope: 139, burner: 26, basket: 68, equipment: 20 },
  persons: 4, personWeight: 80, cylinders: [{ ...va70, count: 4 }], mtom: 883,
  usableFraction: 0.9, burnRate: 25, durationMin: 120, reserve: { pct: 25, capMin: 30 },
});
near(qwp.takeoff, 765, 0.5, 'Startgewicht');
near(qwp.massDeltaMtom, -118, 0.5, 'Minder-/Mehrgewicht (MTOM)');
ok(qwp.allowed <= qwp.mtom && qwp.massDelta === qwp.takeoff - qwp.allowed && ['lift', 'mtom'].includes(qwp.limitBy), 'zulässig = min(Tragkraft, MTOM)');
near(qwp.required, 0.225, 0.001, 'nötige Tragkraft/m³');
ok(qwp.maxAltExcel === 5700, `Max. Steighöhe Excel-Regel = ${qwp.maxAltExcel}`);
near(qwp.usable, 108, 0.01, 'Gasvorrat ausfliegbar');
near(qwp.enduranceMin, 4.32 * 60, 0.1, 'Fahrdauer ohne Reserve (min)');
near(qwp.enduranceExcelReserve, 3.24 * 60, 0.1, 'Fahrdauer mit 25 % Reserve (min)');
near(qwp.reserveMin, 30, 0.01, 'Reserve 2 h → 30 min (gedeckelt)');
near(qwp.needKg, 62.5, 0.01, 'Bedarf 2.5 h × 25 kg/h');
// Tabellenwerte der Excel-Zeilen h=5600 (D=0.2266987, F=+5.775) und h=5700 (D=0.2254201, F=+1.428)
const r5600 = qwp.rows.find((r) => r.h === 5600), r5700 = qwp.rows.find((r) => r.h === 5700);
near(r5600.liftM3, 0.2266986548962544, 1e-9, 'Tragkraft/m³ bei 5600 m');
near(r5600.climb, 5.7754266472650215, 1e-6, 'Steigkraft bei 5600 m');
near(r5700.liftM3, 0.22542011488901836, 1e-9, 'Tragkraft/m³ bei 5700 m');
near(r5700.climb, 1.4283906226623913, 1e-6, 'Steigkraft bei 5700 m');

console.log('Heissluft HB-QWZ (Excel: Startgewicht 568, Minder −162, Max. Steighöhe 5400, 110 °C, 85 kg)');
const wo = CYLINDER_CATALOG.find((c) => c.id === 'wo_s');
const qwz = hotAir({
  volume: 2600, siteAlt: 475, tempC: 22, qnh: 1017, envTempC: 110,
  masses: { envelope: 103, burner: 14, basket: 49, equipment: 15 },
  persons: 3, personWeight: 85, cylinders: [{ ...wo, count: 4 }], mtom: 730,
  usableFraction: 1.0, burnRate: 25, durationMin: 90, reserve: { pct: 25, capMin: 30 },
});
near(qwz.takeoff, 568, 0.5, 'Startgewicht');
near(qwz.massDeltaMtom, -162, 0.5, 'Minder-/Mehrgewicht (MTOM)');
ok(qwz.maxAltExcel === 5400, `Max. Steighöhe Excel-Regel = ${qwz.maxAltExcel}`);
near(qwz.usable, 80, 0.01, 'Gasvorrat ausfliegbar 100 %');
near(qwz.reserveMin, 22.5, 0.01, 'Reserve 1.5 h → 22.5 min');
ok(qwz.envReq > 60 && qwz.envReq < 110, `benötigte Hüllentemperatur ${qwz.envReq.toFixed(1)} °C plausibel`);

console.log('Heissluft Muster 11.07.2026 HB-QWZ (PDF: 540 m, 24 °C, 1016 hPa, 100 °C, 90 kg, Startgewicht 583, −147, 1800 m)');
const qwzPdf = hotAir({
  volume: 2600, siteAlt: 540, tempC: 24, qnh: 1016, envTempC: 100,
  masses: { envelope: 103, burner: 14, basket: 49, equipment: 15 },
  persons: 3, personWeight: 90, cylinders: [{ ...wo, count: 4 }], mtom: 730, usableFraction: 1.0, burnRate: 25,
});
near(qwzPdf.takeoff, 583, 0.5, 'Startgewicht');
near(qwzPdf.massDeltaMtom, -147, 0.5, 'Minder-/Mehrgewicht (MTOM)');
ok(qwzPdf.maxAltExcel === 1800, `Max. Steighöhe = ${qwzPdf.maxAltExcel}`);

console.log('Gasballon HB-QPJ (Excel v2: ρ 1.21398, Auftrieb 1274.68, Ballast 804.32)');
const gbx = gasBalloon({
  volume: 1050, tempC: 20, qnh: 1026, rh: 50, siteAlt: 47, excelMode: true,
  masses: { envelope: 116, basket: 50, equipment: 40 }, persons: 2, personWeight: 85,
});
near(gbx.rhoAir, 1.2139802549196117, 1e-9, 'Luftdichte Excel-Modus');
near(gbx.ballast, 804.3157676655923, 1e-6, 'Ballast Excel-Modus');
const gb = gasBalloon({
  volume: 1050, tempC: 15, qnh: 1013, rh: 50, siteAlt: 0, gas: 'H2', purity: 0.995,
  masses: { envelope: 116, basket: 50, equipment: 40 }, persons: 2, personWeight: 85, ballastUnitKg: 15, reserveUnits: 3,
});
near(gb.rhoAir, 1.221, 0.003, 'Luftdichte feucht 15 °C');
near(gb.grossLift, 1187, 3, 'Brutto-Auftrieb Beispiel Konzept');
near(gb.coolingLossPerK, 4.1, 0.2, 'Abkühlung kg/K');
ok(gb.ballastPer100m > 12 && gb.ballastPer100m < 15, `Ballast je 100 m ${gb.ballastPer100m.toFixed(1)} kg`);

console.log('Reserve-Regel');
near(reserveMinutes(90, { pct: 25, capMin: 30 }), 22.5, 0.01, '1.5 h');
near(reserveMinutes(180, { pct: 25, capMin: 30 }), 30, 0.01, '3 h gedeckelt');
near(reserveMinutes(60, { pct: 25, capMin: 30, minMin: 20 }), 20, 0.01, 'Minimum');

console.log('RAC 4-4 Parser gegen Referenz-JSON');
const ref = JSON.parse(readFileSync(new URL('../data/rac/rac-ch.json', import.meta.url), 'utf8'));
const txt = ['VFR Manual', '2026 FIR SWITZERLAND (LT)', 'OCT NOV DEC', 'Day', '1 2 3 4 1 2 3 4 1 2 3 4',
  '1 0658 0729 1910 1940 0641 0713 1714 1746 0720 0755 1643 1718',
  '31 0639 0710 1716 1748 0741 0816 1652 1727',
  '2027 FIR SWITZERLAND (LT)', 'JAN FEB MAR',
  '28 0727 0800 1727 1800 0642 0713 1814 1844 0648 0718 1954 2024',
  '29 0726 0759 1728 1801 0646 0716 1955 2026'].join('\n');
const t = parseRacText(txt, 'test');
ok(t.days['2026-10-01'].bcmt === '0658', 'Oktober 1');
ok(t.days['2026-12-31'].ecet === '1727' && !t.days['2026-11-31'], '31. Dezember, kein 31. November');
ok(t.days['2027-02-28'].sr === '0713' && t.days['2027-03-29'].ss === '1955' && !t.days['2027-02-29'], 'Februar/März Ende');
ok(t.problems.length === 0, 'keine Parser-Probleme');
ok(racLookup(ref, '2026-10-03').bcmt === '0701' && racLookup(ref, '2027-06-21').ss === '2129', 'Referenz-Lookup');
ok(Object.keys(ref.days).length === 457, 'Referenz 457 Tage');

console.log('Sonne astronomisch Bern vs. RAC (Toleranz 2 min)');
const tz = 'Europe/Zurich';
function cmp(dateStr) {
  const noon = fromLocal(tz, dateStr, '12:00');
  const s = sunTimes(46.95, 7.433, noon);
  const r = racLookup(ref, dateStr);
  const toMin = (ms) => { const p = localParts(tz, ms); return p.hh * 60 + p.mm; };
  const rm = (t) => +t.slice(0, 2) * 60 + +t.slice(2);
  near(toMin(s.dawn), rm(r.bcmt), 2, `${dateStr} BCMT`);
  near(toMin(s.sunrise), rm(r.sr), 2, `${dateStr} SR`);
  near(toMin(s.sunset), rm(r.ss), 2, `${dateStr} SS`);
  near(toMin(s.dusk), rm(r.ecet), 2, `${dateStr} ECET`);
}
cmp('2026-10-03'); cmp('2026-12-21'); cmp('2027-03-28'); cmp('2027-06-21'); cmp('2027-10-25');

console.log('Mond');
const full = fromLocal(tz, '2026-10-26', '12:00'); // Vollmond 26.10.2026 (≈ 04:12 UTC)
const ill = moonIllumination(full);
ok(ill.fraction > 0.97, `Vollmond 26.10.2026 beleuchtet ${(ill.fraction * 100).toFixed(0)} %`);
const mt = moonTimes(47.3, 8.4, fromLocal(tz, '2026-10-10', '00:00'));
ok(mt.rise != null || mt.set != null, `Mondzeiten 10.10.2026: rise ${mt.rise ? hhmm(tz, mt.rise) : '–'} set ${mt.set ? hhmm(tz, mt.set) : '–'}`);
ok(typeof moonPhaseName(ill.phase) === 'string', 'Phasenname');

console.log('Zeit / Zeitzone');
ok(tzOffsetMin(tz, Date.UTC(2026, 6, 1)) === 120 && tzOffsetMin(tz, Date.UTC(2026, 0, 1)) === 60, 'Sommer-/Winterzeit');
ok(hhmm(tz, fromLocal(tz, '2026-10-25', '02:30')) === '02:30', 'Rückkonversion am Umstelltag');
ok(isoDate(tz, fromLocal(tz, '2026-10-10', '00:10')) === '2026-10-10', 'isoDate nach Mitternacht lokal');

console.log('Geo');
ok(icao(47.3167, 8.3917) === '4719N00824E', `ICAO ${icao(47.3167, 8.3917)}`);
ok(icao(51.5713, 6.9827) === '5134N00659E', `ICAO Gladbeck ${icao(51.5713, 6.9827)}`);
const p = parseIcao('4719N00824E'); near(p.lat, 47.3167, 0.01, 'parseIcao lat'); near(p.lon, 8.4, 0.01, 'parseIcao lon');
near(distKm(47.4, 8.5, 47.3167, 8.3917), 12, 2, 'Distanz Katzenrüti–Oberlunkhofen grob');

console.log('Tagesplanung');
const start = fromLocal(tz, '2026-10-10', '06:30');
const rows = buildSchedule({ startMs: start, type: 'hab', rigMin: 45, driveMin: trailerMinutes(24 * 60), bufferMin: 0, durationMin: 120 });
const by = Object.fromEntries(rows.map((r) => [r.key, hhmm(tz, r.ms)]));
ok(by.start === '06:30' && by.arrive === '05:45' && by['depart:m1'] === '05:10' && by.landing === '08:30', JSON.stringify(by));
const gasRows = buildSchedule({ startMs: start, type: 'gas', rigMin: 30, fillMin: 150, driveMin: 30, bufferMin: 10, durationMin: 24 * 60 });
const gby = Object.fromEntries(gasRows.map((r) => [r.key, hhmm(tz, r.ms)]));
ok(gby.arrive === '03:30' && gby.fillStart === '04:00' && gby.fillEnd === '06:30' && gby['depart:m1'] === '02:50', JSON.stringify(gby));
// mehrere Etappen + Pins: Ankunft gepinnt → Etappen rückwärts; Abfahrt der mittleren Etappe gepinnt → erste rechnet davon
const multi = buildSchedule({ startMs: start, type: 'hab', rigMin: 45, bufferMin: 0, durationMin: 120, stops: [{ id: 'a', name: 'A', driveMin: 20 }, { id: 'b', name: 'B', driveMin: 30 }], overrides: { arrive: fromLocal(tz, '2026-10-10', '06:00') } });
const mby = Object.fromEntries(multi.map((r) => [r.key, hhmm(tz, r.ms)]));
ok(mby.arrive === '06:00' && mby['depart:b'] === '05:30' && mby['depart:a'] === '05:10', JSON.stringify(mby));
const multi2 = buildSchedule({ startMs: start, type: 'hab', rigMin: 45, bufferMin: 0, durationMin: 120, stops: [{ id: 'a', name: 'A', driveMin: 20 }, { id: 'b', name: 'B', driveMin: 30 }], overrides: { 'depart:b': fromLocal(tz, '2026-10-10', '05:00') } });
const m2 = Object.fromEntries(multi2.map((r) => [r.key, hhmm(tz, r.ms)]));
ok(m2.arrive === '05:45' && m2['depart:b'] === '05:00' && m2['depart:a'] === '04:40', JSON.stringify(m2));


console.log('Trajektorien / Open-Meteo-Helfer');
ok(parseLevel('SFC').kind === 'sfc' && parseLevel('1000 AGL').ft === 1000 && parseLevel('FL065').ft === 6500 && parseLevel('3000').kind === 'amsl' && parseLevel('500 m AGL').ft === 1640, 'Niveau-Schreibweisen');
near(levelAltM(parseLevel('1000 AGL'), 461), 461 + 304.8, 0.1, 'Niveau AGL → m AMSL');
// synthetisches Modell: Wind überall 270°/10 m/s (aus West), 6 Stunden ab T0
const T0 = Date.UTC(2026, 9, 5, 4, 0);
const hours = Array.from({ length: 7 }, (_, i) => T0 / 1000 + i * 3600);
const H = { time: hours };
const fill = (k, v) => { H[k] = hours.map(() => v); };
fill('wind_speed_10m', 10); fill('wind_direction_10m', 270); fill('wind_speed_80m', 10); fill('wind_direction_80m', 270); fill('wind_speed_180m', 10); fill('wind_direction_180m', 270);
for (const p of [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500]) { fill(`wind_speed_${p}hPa`, 10); fill(`wind_direction_${p}hPa`, 270); fill(`temperature_${p}hPa`, 10); fill(`geopotential_height_${p}hPa`, OM.stdHeight(p)); fill(`relative_humidity_${p}hPa`, 50); }
const J = { hourly: H, elevation: 461, _levels: [1000, 975, 950, 925, 900, 850, 800, 700, 600, 500] };
ok(OM.indexAt(J, T0 + 1800000) === 0 || OM.indexAt(J, T0 + 1800000) === 1, 'indexAt rundet auf die nächste Stunde');
const prof = OM.profile(J, 0, 461);
ok(prof.length >= 8 && prof[0].m > prof[prof.length - 1].m, 'Profil von oben nach unten');
const w = OM.windAt(prof, 1500);
near(w.u, 10, 0.01, 'windAt: u = +10 m/s (Wind aus West → Drift nach Ost)'); near(w.v, 0, 0.01, 'windAt: v = 0');
const trs = tracks(J, { lat: 47.3167, lon: 8.3917, elev: 461, startMs: T0, durationMin: 60, levels: ['SFC', '3000', 'FL065'], stepMin: 10 });
ok(trs.length === 3 && trs.every((x) => x.ok), 'drei Bahnen, vollständig');
near(trs[1].end.km, 36, 0.3, 'nach 60 min bei 10 m/s: 36 km');
near(trs[1].end.brg, 90, 1, 'Kurs 090° (nach Osten)');
ok(trs[1].hourly.length === 1 && /^47\d\dN008\d\dE$/.test(trs[1].end.icao), 'Stundenmarke und ICAO-Endpunkt');
const rec = { temp: 10, dew: 9.8, rh: 98, w10: 1, gust: 2, precip: 0, cape: 50, vis: 800, cloudLow: 10 };
ok(OM.fogRisk(rec).level === 3, 'Nebelrisiko hoch bei Sicht < 1 km');
ok(OM.flyRating(rec, true).level === 0, 'Ampel nein bei Sicht 0.8 km');
ok(OM.flyRating({ temp: 15, dew: 5, w10: 5, gust: 7, precip: 0, cape: 100 }, true).level === 1, 'Ampel grenzwertig bei 5 m/s / Böen 7');
ok(OM.flyRating({ temp: 15, dew: 5, w10: 2, gust: 3, precip: 0, cape: 100 }, true).level === 2, 'Ampel fahrbar');
ok(OM.flyRating({ temp: 15, dew: 5, w10: 2, gust: 3, precip: 0, cape: 100 }, false).level === 0, 'Ampel nein ausserhalb der Dämmerung');
ok(OM.suggestModel(10) === 'icon_d2' && OM.suggestModel(100) === 'icon_eu' && OM.suggestModel(200) === 'gfs_global', 'Modellvorschlag je Horizont');
const fromMs = T0, toMs = T0 + 7200000;
ok(vfrRelevant({ text: 'TEMPO RESTRICTED AREA ACT SFC-FL100', start: '2026-10-04T00:00:00Z', end: '2026-10-06T00:00:00Z', minFL: 0 }, 8000, fromMs, toMs).relevant, 'NOTAM Sperrgebiet relevant');
ok(!vfrRelevant({ text: 'ILS RWY 14 U/S', start: '2026-10-04T00:00:00Z', end: '2026-10-06T00:00:00Z' }, 8000, fromMs, toMs).relevant, 'NOTAM ILS nicht VFR-relevant');
ok(!vfrRelevant({ text: 'AIRSPACE RESTRICTION', start: '2026-10-04T00:00:00Z', end: '2026-10-06T00:00:00Z', minFL: 150 }, 8000, fromMs, toMs).relevant, 'NOTAM über FL150 nicht relevant');
ok(!vfrRelevant({ text: 'AIRSPACE RESTRICTION', start: '2026-10-09T00:00:00Z', end: '2026-10-10T00:00:00Z' }, 8000, fromMs, toMs).relevant, 'NOTAM erst später');


console.log('Go/No-Go und Änderungen seit Final');
const S3 = { goNoGo: { dryWindowH: 3, noTsH: 3, meanWindKt: 10, gustKt: 12 }, flyLimits: { cape: [300, 800] } };
const mkRec = (i, o = {}) => ({ ms: T0 + i * 3600000, fly: 2, precip: 0, cape: 20, w10: 2, gust: 3, why: [], ...o });
const B3 = { time: { startMs: T0, date: '2026-10-05', time: '06:00' }, intent: { durationMin: 120 }, panels: { 'B.meteogram': { content: { auto: { stand: 1, modelName: 'ICON-D2', data: { recs: Array.from({ length: 12 }, (_, i) => mkRec(i - 4)) } } } } }, versions: [] };
ok(goNoGo(B3, S3).level === 2, 'fahrbar bei ruhigen Stunden');
B3.panels['B.meteogram'].content.auto.data.recs[5] = mkRec(1, { fly: 1, w10: 5, gust: 7, why: ['Bodenwind 10 kt'] });
const g1 = goNoGo(B3, S3); ok(g1.level === 1 && g1.reasons[0].includes('Bodenwind'), 'grenzwertig übernimmt Stundenampel + Grund');
B3.panels['B.meteogram'].content.auto.data.recs[7] = mkRec(3, { precip: 0.6 });
ok(goNoGo(B3, S3).level === 0, 'Regen 1 h nach Landung → nein (Trockenfenster)');
B3.panels['B.meteogram'].content.auto.data.recs[7] = mkRec(3, { cape: 900 });
ok(goNoGo(B3, S3).level === 0 && goNoGo(B3, S3).reasons.some((r) => r.includes('CAPE')), 'CAPE 900 innert 3 h → nein');
ok(goNoGo({ time: { startMs: T0 }, intent: {}, panels: {} }, S3).level === null, 'ohne Meteogramm: keine Aussage');
const snap = JSON.parse(JSON.stringify({ ...B3, panels: { 'A.landing': { content: { text: 'Wohlen' }, extra: { text: '' } } }, persons: { pax: [{ name: 'A' }] }, schedule: { meetingName: 'Katzenrüti' } }));
const B4 = { ...JSON.parse(JSON.stringify(snap)), versions: [{ no: 1, ts: 1, who: 'x', snapshot: snap }] };
ok(changesSinceFinal(B4).any === false, 'keine Änderungen direkt nach Freigabe');
B4.panels['A.landing'].content.text = 'Bremgarten'; B4.persons.pax.push({ name: 'B' });
const ch = changesSinceFinal(B4);
ok(ch.any && ch.fields.includes('persons') && ch.panels.some((p) => p.key === 'A.landing' && p.what.includes('content')), 'Pax und Landeort als geändert erkannt');
ok(changesSinceFinal({ versions: [] }) === null, 'ohne Final: null');
console.log('Luftraumanalyse');
const ft0 = () => ({ value: 0, unit: 1, referenceDatum: 0 });
const sq = (lat0, lon0, lat1, lon1) => ({ type: 'Polygon', coordinates: [[[lon0, lat0], [lon1, lat0], [lon1, lat1], [lon0, lat1], [lon0, lat0]]] });
const ctr = normalizeAirspace({ _id: 'c1', name: 'ZURICH CTR', type: 4, icaoClass: 3, country: 'CH', lowerLimit: { value: 0, unit: 1, referenceDatum: 0 }, upperLimit: { value: 4500, unit: 1, referenceDatum: 1 }, geometry: sq(47.40, 8.40, 47.55, 8.65) }, 430);
ok(ctr.typeKey === 'CTR' && ctr.cls === 'D' && ctr.lowerTxt === 'GND' && ctr.upperTxt === '4500 ft' && ctr.lowerFt === Math.round(430 * 3.28084), 'CTR normalisiert (GND = Platzhöhe)');
ok(limitFt({ value: 95, unit: 6, referenceDatum: 2 }) === 9500 && limitText({ value: 95, unit: 6, referenceDatum: 2 }) === 'FL 095' && limitText({ value: 1000, unit: 0, referenceDatum: 0 }) === '3281 ft AGL', 'Höhenangaben FL/m/AGL');
ok(inAirspace(47.45, 8.5, ctr) && !inAirspace(47.30, 8.5, ctr), 'Punkt in Polygon');
const dHole = normalizeAirspace({ name: 'H', type: 2, geometry: { type: 'Polygon', coordinates: [[[8.0, 47.0], [8.4, 47.0], [8.4, 47.3], [8.0, 47.3], [8.0, 47.0]], [[8.1, 47.1], [8.3, 47.1], [8.3, 47.2], [8.1, 47.2], [8.1, 47.1]]] }, lowerLimit: { value: 0, unit: 1, referenceDatum: 0 }, upperLimit: { value: 100, unit: 6, referenceDatum: 2 } });
ok(inAirspace(47.05, 8.05, dHole) && !inAirspace(47.15, 8.2, dHole), 'Loch im Polygon');
ok(Math.abs(distToAirspaceKm(47.30, 8.5, ctr) - 11.1) < 0.5 && distToAirspaceKm(47.45, 8.5, ctr) === 0, 'Distanz zum Rand ≈ 11 km');
const tma = normalizeAirspace({ _id: 't1', name: 'ZURICH TMA 3', type: 7, icaoClass: 2, lowerLimit: { value: 5500, unit: 1, referenceDatum: 1 }, upperLimit: { value: 195, unit: 6, referenceDatum: 2 }, geometry: sq(47.2, 8.2, 47.7, 8.9) });
const fir1 = normalizeAirspace({ name: 'SWITZERLAND FIR', type: 10, country: 'CH', lowerLimit: { value: 0, unit: 1, referenceDatum: 0 }, upperLimit: { value: 195, unit: 6, referenceDatum: 2 }, geometry: sq(45.8, 5.9, 47.5, 10.5) });
const fir2 = normalizeAirspace({ name: 'LANGEN FIR', type: 10, country: 'DE', lowerLimit: { value: 0, unit: 1, referenceDatum: 0 }, upperLimit: { value: 245, unit: 6, referenceDatum: 2 }, geometry: sq(47.5, 7.0, 50.0, 10.5) });
const dang = normalizeAirspace({ name: 'LS-D16', type: 2, lowerLimit: { value: 0, unit: 1, referenceDatum: 0 }, upperLimit: { value: 150, unit: 6, referenceDatum: 2 }, geometry: sq(47.30, 8.30, 47.36, 8.36) });
const uir = normalizeAirspace({ name: 'SWITZERLAND UIR', type: 11, lowerLimit: { value: 195, unit: 6, referenceDatum: 2 }, upperLimit: { value: 660, unit: 6, referenceDatum: 2 }, geometry: sq(45.8, 5.9, 48.5, 10.5) });
// Bahn von 47.30/8.50 nach Norden bis 47.60 (≈ 33 km), 10-min-Punkte
const trk = { label: 'SFC', altFt: 1500, points: Array.from({ length: 12 }, (_, i) => ({ ms: T0 + i * 600000, lat: 47.30 + i * 0.0273, lon: 8.50 })) };
const an = analyzeAirspaces([trk], [ctr, tma, fir1, fir2, dang, uir], { altMinFt: 1500, altMaxFt: 4000, corridorKm: 5 });
ok(an.crossed.length === 1 && an.crossed[0].as.name === 'ZURICH CTR' && an.crossed[0].req === 'ctr', 'CTR wird durchfahren');
ok(Math.abs(an.crossed[0].firstKm - 12.1) < 1.5 && an.crossed[0].hits[0].label === 'SFC', 'Einfahrt CTR nach ≈ 12 km');
ok(an.above.length === 1 && an.above[0].as.name === 'ZURICH TMA 3', 'TMA über Maximalhöhe → darüber');
ok(an.near.length === 0 && !JSON.stringify(an).includes('UIR'), 'Gefahrengebiet > 5 km und UIR nicht gelistet');
ok(an.firs.length === 1 && an.firs[0].seq.map((x) => x.name).join('>') === 'SWITZERLAND FIR>LANGEN FIR' && an.firs[0].seq[1].fromKm > 20, 'FIR-Folge CH → DE mit km');
const an2 = analyzeAirspaces([trk], [dang], { altMaxFt: 4000, corridorKm: 15 });
ok(an2.near.length === 1 && an2.near[0].minDistKm > 10 && an2.near[0].minDistKm < 12, 'Gefahrengebiet im 15-km-Korridor als «nahe»');
const clsE = normalizeAirspace({ name: 'E-SEKTOR', type: 0, icaoClass: 4, lowerLimit: ft0(), upperLimit: { value: 100, unit: 6, referenceDatum: 2 }, geometry: sq(47.2, 8.2, 47.7, 8.9) });
const tmzG = normalizeAirspace({ name: 'TMZ TEST', type: 5, icaoClass: 6, lowerLimit: ft0(), upperLimit: { value: 5000, unit: 1, referenceDatum: 1 }, geometry: sq(47.2, 8.2, 47.7, 8.9) });
const an3 = analyzeAirspaces([trk], [clsE, tmzG], { altMaxFt: 4000, corridorKm: 5 });
ok(isPlainEG(clsE) && !isPlainEG(tmzG) && an3.crossed.length === 1 && an3.crossed[0].as.name === 'TMZ TEST', 'Klasse E nicht gelistet, TMZ in Klasse G schon');
const sw = siteWarnings({ lat: 47.45, lon: 8.5, elevFt: 1400 }, [ctr, tma, clsE], 900);
ok(sw.some((w) => w.kind === 'ctr' && w.as.name === 'ZURICH CTR'), 'Startort in CTR → Warnung');
ok(!sw.some((w) => w.kind === 'tma'), 'TMA 5500 ft bei Platz 1400 ft (4100 ft darüber) → keine Warnung');
const sw2 = siteWarnings({ lat: 47.45, lon: 8.5, elevFt: 4800 }, [tma], 900);
ok(sw2.length === 1 && sw2[0].kind === 'tma' && sw2[0].aglFt === 700, 'TMA nur 700 ft über Platz → Warnung');
ok(requirementKey({ typeKey: 'TMA', cls: 'E' }) === 'classE' && requirementKey({ typeKey: 'OTHER', cls: 'C' }) === 'clearance' && requirementKey({ typeKey: 'P' }) === 'prohibited' && requirementKey({ typeKey: 'TRA' }) === 'activation', 'Hinweis-Schlüssel je Typ/Klasse');

// ---- Tabellarischer Zeitplan (0.9.1): Anker «Start», vorwärts/rückwärts, Pins, Vorlage, Etappen-Rückführung
{
  const startMs = Date.UTC(2026, 9, 10, 4, 0);   // 06:00 LT (CEST)
  const tpl = planTemplate({ type: 'hab', stops: [{ id: 'm1', name: 'Katzenrüti', lat: 47.4, lon: 8.5, driveMin: 25, driveSource: 'routing', driveKm: 18 }, { id: 'm2', name: 'Buchs', lat: 47.3, lon: 8.3, driveMin: 10 }], rigMin: 45, bufferMin: 15, recoveryMin: 60 });
  ok(tpl.map((x) => x.type).join(',') === 'meet,drive,meet,drive,buffer,arrive,rig,start,flight,landing,recovery,return', 'Vorlage HAB: Treffpunkte, Fahrten, Reserve, Ankunft, Aufrüsten, Start, Fahrt, Landung, Bergung, Rückfahrt');
  ok(planTemplate({ type: 'gas', stops: [], fillMin: 150 }).some((x) => x.type === 'fill'), 'Vorlage Gas enthält Füllen');
  const rows = buildPlan(tpl, { startMs, flightMin: 90 });
  const by = Object.fromEntries(rows.map((r) => [r.type + (r.type === 'meet' ? ':' + r.id : ''), r]));
  ok(by.start.ms === startMs && by.flight.ms === startMs && by.flight.dur === 90, 'Start ist Anker, Fahrtdauer aus der Absicht');
  ok(by.landing.ms === startMs + 90 * 60000 && by.recovery.ms === by.landing.ms && by.return.ms === by.landing.ms + 60 * 60000, 'vorwärts: Landung = Start + Fahrt, Rückfahrt = Landung + Bergung');
  ok(by.rig.ms === startMs - 45 * 60000 && by.arrive.ms === by.rig.ms && by.buffer.ms === by.arrive.ms - 15 * 60000, 'rückwärts: Aufrüsten = Start − 45, Reserve davor');
  ok(by['meet:meet-m2'].ms === by.buffer.ms - 10 * 60000 - ACT_DEFAULT_MIN.meet * 60000 && by['meet:meet-m1'].ms === by['meet:meet-m2'].ms - 25 * 60000 - ACT_DEFAULT_MIN.meet * 60000, 'Etappen: Abfahrt = nächste Zeit − Fahrt − Aufenthalt');
  // Pin auf Ankunft: Zeilen davor rechnen vom Pin, Start bleibt
  const pinned = tpl.map((x) => (x.type === 'arrive' ? { ...x, pin: startMs - 120 * 60000 } : x));
  const r2 = buildPlan(pinned, { startMs, flightMin: 90 });
  const b2 = Object.fromEntries(r2.map((r) => [r.type, r]));
  ok(b2.arrive.ms === startMs - 120 * 60000 && b2.arrive.overridden && b2.rig.ms === startMs - 45 * 60000 && b2.buffer.ms === b2.arrive.ms - 15 * 60000, 'Pin Ankunft: Reserve/Etappen rechnen vom Pin, Aufrüsten weiter vom Start');
  // Umsortieren: Bergung vor Landung → Zeiten laufen mit
  const moved = tpl.slice(); const ri = moved.findIndex((x) => x.type === 'recovery'); const [rec] = moved.splice(ri, 1); moved.splice(moved.findIndex((x) => x.type === 'flight'), 0, rec);
  const r3 = buildPlan(moved, { startMs, flightMin: 90 }); const b3 = Object.fromEntries(r3.map((r) => [r.type, r]));
  ok(b3.recovery.ms === startMs && b3.flight.ms === startMs + 60 * 60000 && b3.landing.ms === b3.flight.ms + 90 * 60000, 'verschobene Zeile: Nachfolger rechnen neu');
  ok(buildPlan([{ id: 'a', type: 'custom', min: 7 }, { id: 'start', type: 'start' }, { id: 'b', type: 'custom', min: 7 }, { id: 'c', type: 'custom', min: 7 }], { startMs }).map((r) => (r.ms - startMs) / 60000).join() === '-10,0,0,5', 'Rundung auf 5 min (rückwärts abgerundet, vorwärts kaufmännisch)');
  const stops = planToStops(tpl);
  ok(stops.length === 2 && stops[0].name === 'Katzenrüti' && stops[0].driveMin === 25 && stops[0].driveSource === 'routing' && stops[0].driveKm === 18 && stops[1].driveMin === 10, 'Etappen (Altform) aus dem Zeitplan abgeleitet');
  const ow = planOrderWarnings(moved);
  ok(ow.length === 2 && ow.some((x) => x.a === 'recovery' && x.b === 'flight') && ow.some((x) => x.a === 'recovery' && x.b === 'landing') && planOrderWarnings(tpl).length === 0, 'Reihenfolge-Warnung: Bergung vor Fahrt/Landung');
  const w = scheduleWarnings(rows, { bcmt: startMs + 60000, ecet: startMs + 60 * 60000, ss: startMs + 30 * 60000 });
  ok(w.join() === 'nightStart,nightLanding,returnAfterSunset', 'Warnungen aus Typ-Schlüsseln');
}

// ---- 0.9.2: DABS nur bei CH-Berührung, Panel-Nummern, Zielschätzung aus der Trajektorienschar
{
  const bDE = { site: { country: 'DE', lat: 51.57, lon: 6.98 }, landing: { lat: null }, panels: {} };
  ok(!touchesCH(bDE) && !visiblePanels({ panels: { hidden: [] } }, bDE).some((p) => p.key === 'C.dabs'), 'Gladbeck ohne CH-Berührung: kein DABS');
  const bDE2 = { ...bDE, panels: { 'B.traj': { content: { auto: { data: { tracks: [{ points: [{ lat: 47.5, lon: 8.2 }] }] } } } } } };
  ok(touchesCH(bDE2), 'Trajektorienpunkt in CH → DABS');
  const bFir = { ...bDE, panels: { 'C.airspace': { content: { auto: { data: { firs: [{ seq: [{ country: 'DE' }, { country: 'CH' }] }] } } } } } };
  ok(touchesCH(bFir), 'FIR-Folge mit CH → DABS');
  const vis = visiblePanels({ panels: { hidden: [] } }, { site: { country: 'CH' }, panels: {} });
  ok(panelNo(vis[0], vis) === 'A01' && panelNo(vis.find((p) => p.key === 'C.dabs'), vis) === 'C02' && panelNo(vis.find((p) => p.key === 'B.metar'), vis) === 'B02', 'Panel-Nummern A01 / B02 / C02');
  const t0 = Date.UTC(2026, 9, 10, 4, 0);
  const mk = (altM, brg) => ({ altM, points: Array.from({ length: 13 }, (_, k) => { const km = k * 2; const r = km / 111; return { ms: t0 + k * 10 * 60000, lat: 47 + r * Math.cos(brg * Math.PI / 180), lon: 8 + r * Math.sin(brg * Math.PI / 180) / Math.cos(47 * Math.PI / 180) }; }) });
  const trs = [mk(800, 80), mk(1500, 100)];
  const est = targetEstimate(trs, { lat: 47, lon: 8 }, { lat: 47 + (12 / 111) * Math.cos(90 * Math.PI / 180), lon: 8 + (12 / 111) * Math.sin(90 * Math.PI / 180) / Math.cos(47 * Math.PI / 180) });
  ok(est && est.min >= 55 && est.min <= 65 && est.altM > 800 && est.altM < 1500 && !est.beyond, `Ziel zwischen zwei Bahnen: ~60 min, Höhe gemittelt (${est && est.min} min, ${est && est.altM} m)`);
  const far = targetEstimate(trs, { lat: 47, lon: 8 }, { lat: 47, lon: 8 + (40 / 111) / Math.cos(47 * Math.PI / 180) });
  ok(far && far.beyond, 'Ziel jenseits der Bahnenden → «>»');
}

// ---- 0.10.0: ICAO-Flugplan aus dem Briefing (Muster HB-QPJ Gasfahrten)
{
  ok(firCode('SWITZERLAND FIR') === 'LSAS' && firCode('Praha FIR') === 'LKAA' && firCode('LZBB BRATISLAVA FIR') === 'LZBB' && firCode('KOBENHAVN FIR') === 'EKDK' && firCode('unbekannt') === '', 'FIR-Namen → ICAO-Codes');
  ok(fplName('Bitterfeld-Wolfen') === 'BITTERFELDWOLFEN' && fplName('Neumarkt in der Oberpfalz') === 'NEUMARKTINDEROBERPFALZ' && fplName('Bad Leonfelden') === 'BADLEONFELDEN' && fplName('Zürich Süd') === 'ZUERICHSUED', 'Ortsnamen für DEP/ DEST/');
  ok(fplPerson('Balthasar Wicki') === 'WICKI BALTHASAR' && fplPhone('+41 79 611 12 10') === '0041796111210' && fplLevel(12500) === 'F125' && fplLevel(16500) === 'F165' && fplLevel(4000) === 'VFR', 'PIC-Name, Telefon, Flugfläche');
  const t0 = Date.UTC(2026, 4, 1, 17, 0);
  const S = { persons: [{ id: 'p1', name: 'Balthasar Wicki', phone: '+41 79 611 12 10' }], fpl: { satphone: '+881632624091', gas: { enduranceMin: 2880, equip10b: 'EB1', speed15: 'N0025', typ18: 'GASBALLOON' }, r19: { vhf: true, elba: true }, s19: { maritime: true }, j19: { light: true }, d19: { number: '2', capacity: '2', cover: true, colour: 'orange' } } };
  const firs = [{ seq: [{ name: 'BREMEN FIR', country: 'DE', fromKm: 0, fromMs: t0 }, { name: 'KOBENHAVN FIR', country: 'DK', fromKm: 300, fromMs: t0 + 8 * 3600000 }, { name: 'SWEDEN FIR', country: 'SE', fromKm: 600, fromMs: t0 + 13.5 * 3600000 }, { name: 'RIGA FIR', country: 'LV', fromKm: 900, fromMs: t0 + 20 * 3600000 }] }];
  const b = { balloon: { type: 'gas', reg: 'HB-QPJ', colour: 'white' }, flight: { kind: 'private', nvfr: true }, time: { startMs: t0 }, intent: { durationMin: 1440, altMaxFt: 12500 }, site: { name: 'Bitterfeld-Wolfen', lat: 51.62, lon: 12.28, country: 'DE' }, landing: { name: 'Jelgava', lat: 56.57, lon: 23.5 }, persons: { picId: 'p1', pic: 'Balthasar Wicki', pax: [{ name: 'X' }] },
    panels: { 'C.airspace': { content: { auto: { data: { firs } } } }, 'B.traj': { content: { auto: { data: { startMs: t0, tracks: [{ altM: 3000, points: [{ lat: 51.62, lon: 12.28 }, { lat: 52.4, lon: 11.0 }, { lat: 53.5, lon: 11.4 }, { lat: 55, lon: 14 }, { lat: 56.5, lon: 23 }] }] } } } } } };
  const d = buildFpl(b, S);
  const msg = fplMessage(d);
  ok(msg.startsWith('(FPL-HBQPJ-VG\n-ZZZZ/L-GY/EB1\n-ZZZZ1700\n-N0025F125 DRIFTING '), 'Felder 7–15: ' + msg.split('\n').slice(0, 4).join(' | '));
  ok(msg.includes('FROM BITTERFELDWOLFEN TO JELGAVA') && msg.includes('\n-ZZZZ2400 ZZZZ ZZZZ\n'), 'Route und Feld 16 (EET 2400, ALTN ZZZZ ZZZZ)');
  ok(msg.includes('DEP/BITTERFELDWOLFEN 5137N01217E DEST/JELGAVA 5634N02330E DOF/260501 EET/EKDK0800 ESAA1330 EVRR2000 TYP/GASBALLOON ALTN/UNKNOWN UNKNOWN RMK/NVFR CREW CONTACT 0041796111210 AND 00881632624091'), 'Feld 18 wie Muster (DEP/DEST/DOF/EET/TYP/ALTN/RMK)');
  ok(msg.endsWith('\n-E/4800 P/2 R/VE S/M J/L D/2 2 C ORANGE\nA/WHITE\nN/GSM PIC 0041796111210 AND SATPHONE 00881632624091\nC/WICKI BALTHASAR)'), 'Feld 19 wie skybriefing-Import (E/ P/ R/ S/ J/ D/ · A/ · N/ · C/ je Zeile): ' + msg.split('\n').slice(-4).join(' | '));
  ok(msg.split('\n').length === 10 && msg.split('\n').filter((l) => l.startsWith('-')).length === 6, 'Nachricht: 10 Zeilen, 6 mit führendem Strich');
  ok(fplCheck(d).length === 0, 'Plausibilität ohne Beanstandung');
  ok(fplPlace('Bülach ZH') === 'BUELACH ZH' && fplPlace('Oberlunkhofen AG') === 'OBERLUNKHOFEN AG' && fplPlace('Bitterfeld-Wolfen') === 'BITTERFELDWOLFEN' && fplPlace('Gladbeck') === 'GLADBECK', 'DEP/ DEST/: Kanton bleibt als eigenes Wort');
  const bCH = { ...b, site: { name: 'Oberlunkhofen AG', lat: 47.32, lon: 8.4, country: 'CH' }, landing: { name: 'Bülach ZH', lat: 47.52, lon: 8.54 }, panels: {} };
  ok(fplMessage(buildFpl(bCH, S)).includes('DEP/OBERLUNKHOFEN AG 4719N00824E DEST/BUELACH ZH 4731N00832E'), 'DEP/ DEST/ mit Kanton');
  const bHabBase = () => ({ ...b, balloon: { type: 'hab', reg: 'HB-QWZ' }, flight: { kind: 'commercial', nvfr: false }, intent: { durationMin: 120, altMaxFt: 4000 }, panels: {} });
  const bHab = bHabBase();
  const bEx = { ...bHabBase(), flight: { kind: 'exam', nvfr: false } };
  ok(buildFpl(bEx, S).typeOfFlight8 === 'G' && buildFpl({ ...bEx, flight: { kind: 'training', nvfr: false } }, S).typeOfFlight8 === 'G' && buildFpl(bEx, { ...S, fpl: { ...S.fpl, typeOfFlight: { exam: 'X' } } }).typeOfFlight8 === 'X', 'Flugart je Fahrttyp: Ausbildung/Examination G, in Einstellungen überschreibbar');
  ok(buildFpl({ ...bEx, flight: { kind: 'training', nvfr: true } }, S).rmk18.startsWith('NVFR TRG FLT ') && buildFpl(bEx, S).rmk18.startsWith('SKILL TEST') && !buildFpl(bHab, S).rmk18.includes('TRG'), 'RMK/ nach AIP CH: NVFR, TRG FLT (Ausbildung) und SKILL TEST (Examination) getrennt');
  ok(buildFpl({ ...bHab, balloon: { type: 'hab', reg: 'HB-QWZ', hex: '4b1c2d' } }, S).code18 === '4B1C2D' && fplMessage(buildFpl({ ...bHab, balloon: { type: 'hab', reg: 'HB-QWZ', hex: '4b1c2d' } }, S)).includes('TYP/HOT AIR BALLOON CODE/4B1C2D ALTN/') && buildFpl({ ...bHab, balloon: { type: 'hab', reg: 'HB-QWZ', hex: '4c4b4' } }, S).code18 === '', 'CODE/ nur bei vollständiger 24-bit-Adresse, Reihenfolge TYP CODE ALTN');
  const dh = buildFpl(bHab, S, { fuelEnduranceMin: 190 });
  ok(dh.typeOfFlight8 === 'N' && dh.level15 === 'VFR' && dh.speed15 === 'N0015' && dh.e19 === '0310' && dh.eet16 === '0200' && dh.altn16b === '' && !dh.rmk18.startsWith('NVFR') && dh.typ18 === 'HOT AIR BALLOON', 'Heissluft gewerblich: N, VFR, N0015, Autonomie aus Treibstoff, kein 2. ALTN');
  ok(fplCheck(dh).includes('eet18') === false && eetFromFirs([], t0).length === 0, 'ohne FIR-Folge keine EET/-Einträge');
  ok(driftWords([{ lat: 47, lon: 8 }, { lat: 47.5, lon: 8 }, { lat: 48, lon: 8 }]) === 'N', 'Richtungswörter: Nord');
}

console.log('Bild der Hülle (0.10.1)');
// 0.10.1: Bild der Hülle — Schnappschuss im Briefing, Rückgriff auf die Stammdaten
{
  const S = mergeSettings({});
  S.balloons.envelopes[0].image = 'data:image/jpeg;base64,AAA';
  const gas = resolveBalloon(S, { type: 'gas', envelopeId: S.balloons.envelopes[0].id, basketId: S.balloons.baskets[0].id });
  ok(gas.image === 'data:image/jpeg;base64,AAA' && gas.label.includes('NL-STU/1000'), 'resolveBalloon gas: Bild und Muster im Schnappschuss');
  S.balloons.hab[0].image = 'data:image/jpeg;base64,BBB';
  const hab = resolveBalloon(S, { type: 'hab', id: S.balloons.hab[0].id });
  ok(hab.image === 'data:image/jpeg;base64,BBB', 'resolveBalloon hab: Bild im Schnappschuss');
  ok(balloonImage({ balloon: { ...hab, image: 'data:x' } }, S) === 'data:x', 'balloonImage: Schnappschuss vor Stammdaten');
  ok(balloonImage({ balloon: { type: 'hab', id: hab.id } }, S) === 'data:image/jpeg;base64,BBB' && balloonImage({ balloon: { type: 'gas', envelopeId: gas.envelopeId } }, S) === 'data:image/jpeg;base64,AAA', 'balloonImage: Rückgriff auf Stammdaten (altes Briefing ohne Bild)');
  ok(balloonImage({ balloon: { type: 'hab', id: 'nope' } }, S) === '', 'balloonImage: leer ohne Bild');
}


console.log('Ordnungsnummer, Fortschritt, Sperre (0.11.0)');
{
  const S = mergeSettings({});
  const b = newBriefing(S, Date.UTC(2026, 9, 5, 8, 0));
  ok(formatNo(2026, 17) === '2026-017' && formatNo(2027, 123) === '2027-123', 'Ordnungsnummer JJJJ-NNN');
  ok(briefingYear({ time: { date: '2027-01-03', startMs: Date.UTC(2026, 11, 31) } }) === 2027 && briefingYear({ time: {}, createdAt: Date.UTC(2026, 5, 1) }) === 2026, 'Jahr aus dem Fahrtdatum, sonst Erstellung');
  const t0 = Date.UTC(2026, 9, 6, 4, 30);
  const bh = { time: { startMs: t0 }, intent: { durationMin: 120 } }, bg = { time: { startMs: t0 }, intent: { durationMin: 1440 } };
  ok(archiveMs(bh) === t0 + 8 * 3600000 && archiveMs(bg) === t0 + 30 * 3600000, '0.12.10a: Archiv ab geplanter Landung + 6 h');
  ok(lockMs(bh) === t0 && !isLocked(bh, t0 - 60000) && isLocked(bh, t0 + 60000), '0.12.10a: Sperre ab Startzeitpunkt');
  ok(isRunning(bh, t0 + 2 * 3600000) && !isArchived(bh, t0 + 7 * 3600000) && isArchived(bh, t0 + 9 * 3600000) && !isRunning(bh, t0 + 9 * 3600000) && isRunning(bg, t0 + 29 * 3600000), 'laufende Fahrt zwischen Start und Landung + 6 h');
  ok(isArchived({ ...bh, frozen: true }, t0) && !isLocked(bh, t0), 'Archivkopie ist immer archiviert; vor der Fahrt nicht gesperrt');
  // 0.12.10: Land aus Koordinaten – Schweiz-Umriss, Deutschland aus GAFOR-Gebieten, Nachbarn grob; «strict» nur mit 4 km Abstand zur Grenze
  const gj = JSON.parse(readFileSync(new URL('../data/gafor-areas.geojson', import.meta.url), 'utf8')); setDeRings(gj.features);
  const cg = [['Illmensee', 47.87, 9.37, 'DE'], ['Oberlunkhofen', 47.32, 8.39, 'CH'], ['Gladbeck', 51.57, 6.98, 'DE'], ['Colmar', 48.08, 7.36, 'FR'], ['Freiburg', 48.0, 7.85, 'DE'], ['Bregenz', 47.50, 9.75, 'AT'], ['Lindau', 47.55, 9.69, 'DE'], ['Como', 45.81, 9.08, 'IT'], ['Lugano', 46.0, 8.95, 'CH'], ['Vaduz', 47.14, 9.52, 'LI'], ['Genf', 46.2, 6.15, 'CH'], ['Annemasse', 46.19, 6.24, 'FR'], ['Samedan', 46.53, 9.87, 'CH'], ['Innsbruck', 47.26, 11.39, 'AT'], ['Bozen', 46.5, 11.35, 'IT'], ['Pontarlier', 46.9, 6.35, 'FR'], ['Kreuzlingen', 47.645, 9.17, 'CH'], ['Konstanz', 47.665, 9.18, 'DE']];
  const bad = cg.filter(([, la, lo, cc]) => countryGuess(la, lo) !== cc).map(([n, la, lo]) => `${n}=${countryGuess(la, lo)}`);
  ok(!bad.length, 'Land aus Koordinaten: ' + (bad.join(', ') || 'alle richtig'));
  ok(countryGuessStrict(47.87, 9.37) === 'DE' && countryGuessStrict(47.665, 9.18) === '' && countryGuessStrict(47.56, 7.59) === '', 'strict: Illmensee DE, Konstanz/Basel im Grenzband offen');
  const lp = fixCountry({ name: 'Illmensee', lat: 47.87, lon: 9.37, country: 'CH' }); const kp = fixCountry({ name: 'Konstanz', lat: 47.665, lon: 9.18, country: 'CH' });
  ok(lp.country === 'DE' && kp.country === 'CH', 'fixCountry: CH→DE bei Illmensee, Konstanz bleibt wie gespeichert');
  // 0.12.10a: präzise Landesgrenzen (Natural Earth 1:10m, ~500 m vereinfacht) – Grenzband 2 km
  setCountryRings(JSON.parse(readFileSync(new URL('../data/countries.geojson', import.meta.url), 'utf8')).features);
  const cg2 = [...cg, ['Chamonix', 45.92, 6.87, 'FR'], ['Kufstein', 47.58, 12.17, 'AT'], ['Konstanz-Nord', 47.68, 9.19, 'DE'], ['Saint-Louis', 47.59, 7.56, 'FR'], ['Salzburg', 47.8, 13.04, 'AT'], ['Rosenheim', 47.85, 12.12, 'DE'], ['Luxemburg', 49.61, 6.13, 'LU'], ['Prag', 50.08, 14.44, 'CZ']].filter(([n]) => n !== 'Konstanz');
  const bad2 = cg2.filter(([, la, lo, cc]) => countryGuess(la, lo) !== cc).map(([n, la, lo]) => `${n}=${countryGuess(la, lo)}`);
  ok(!bad2.length, 'Land aus Landesgrenzen: ' + (bad2.join(', ') || 'alle richtig'));
  ok(countryGuessStrict(47.87, 9.37) === 'DE' && countryGuessStrict(47.665, 9.18) === '' && countryGuessStrict(47.56, 7.59) === 'CH' && countryGuessStrict(47.14, 9.52) === '', 'strict mit Grenzen: Illmensee DE, Konstanz-Zentrum offen, Basel CH, Vaduz offen (LI < 4 km breit)');
  ok(nextAmendmentNo('2026-008') === '2026-008a' && nextAmendmentNo('2026-008a') === '2026-008b' && nextAmendmentNo('') === 'a', 'Nachtrag-Nummer mit Buchstabe');
  { const src = { id: 'abc', no: '2026-008', time: { startMs: t0 }, intent: { durationMin: 120 }, panels: { x: 1 } };
    const { copy, b: am } = amendBriefingData(src, t0 + 2 * 3600000);
    ok(copy.id !== 'abc' && copy.frozen === true && copy.no === '2026-008' && copy.amendmentOf === 'abc' && copy.panels.x === 1 && am.no === '2026-008a' && am.amendments.length === 1 && am.amendments[0].copyId === copy.id && am.id === 'abc', 'Nachtrag: Archivkopie (bisherige Nummer, eingefroren) + Briefing mit Buchstabe');
    const { b: am2 } = amendBriefingData(am, t0 + 3 * 3600000); ok(am2.no === '2026-008b' && am2.amendments.length === 2, 'zweiter Nachtrag → b'); }
  b.no = '2026-017'; b.balloon.reg = 'HB-QWZ'; b.time.date = '2026-10-06'; b.time.startMs = t0; b.site.name = 'Oberlunkhofen AG'; b.site.tz = 'Europe/Zurich'; b.updatedAt = Date.UTC(2026, 9, 5, 7, 37); b.updatedBy = 'B. Wicki';
  ok(fileBase(b) === '2026-017_Fahrtbriefing_HB-QWZ_2026-10-06', 'Dateibasis: ' + fileBase(b));
  const tl = titleLine(b, 'de');
  ok(tl.startsWith('Fahrtbriefing · 2026-017 · HB-QWZ · Start: ') && tl.includes('06:30 – CH-Oberlunkhofen AG'), 'Titelzeile: ' + tl);
  ok(lastChangeLine(b, 'de').startsWith('Letzte Änderung: ') && lastChangeLine(b, 'de').endsWith(' · B. Wicki'), 'Letzte Änderung: ' + lastChangeLine(b, 'de'));
  b.persons.pax = [{ name: 'Viviane Graf', weight: 70 }, { name: '', weight: null }];
  ok(paxLine(b, S) === `2 Pax: Viviane Graf (70 kg), Pax 2 (${Math.round(b.balloon.personWeight)} kg)`, 'Pax-Zeile mit Gewichten: ' + paxLine(b, S));
  const c0 = completion(b, S);
  ok(c0 >= 0 && c0 <= 100 && Number.isInteger(c0), `Fortschritt in Prozent (${c0} %)`);
  const d = duplicateBriefing(b, S);
  ok(d.no === null && d.id !== b.id && d.status === 'draft', 'Kopie: neue Nummer wird beim Speichern vergeben');
}


console.log('Länder-Matrix und DWD-Astroangaben (0.11.1)');
{
  const S = mergeSettings({});
  ok(countryInfo('ch').dabs.startsWith('Pflicht') && countryInfo('XX').name.de === 'übrige Länder' && countryInfo('DE').panels.includes('B.balloon'), 'Länder-Matrix: CH DABS Pflicht, Standard für unbekannte Länder, DE Ballonbericht');
  const bR = { site: { country: 'CH' }, landing: { lat: 47.9, lon: 11.5, country: 'DE' }, panels: { 'C.airspace': { content: { auto: { data: { firs: [{ seq: [{ country: 'CH' }, { country: 'AT' }, { country: 'DE' }] }] } } } } } };
  const rm = routeMatrix(bR, new Set(['CH', 'AT', 'DE']));
  ok(rm.map((e) => `${e.code}:${e.roles.join('/')}`).join(' ') === 'CH:start AT:overflight DE:landing', 'Rollen Start/Überflug/Landung: ' + rm.map((e) => `${e.code}:${e.roles.join('/')}`).join(' '));
  ok(countriesLine(bR).startsWith('CH (Start) · AT (Überflug) · DE (Landung)'), 'Länderzeile: ' + countriesLine(bR));
  const a = parseDwdAstro('Vorhersagen für Montag, 05.10.2026\n\nAstronomische Angaben [UTC]\n\nSonnenaufgang  05:37  Sonnenuntergang  16:56\n\nBeginn bürgerl. Dämmerung  05:01  Ende bürgerl. Dämmerung  17:30\n');
  ok(a && a.date === '2026-10-05' && a.bcmt === '05:01' && a.ecet === '17:30', 'DWD-Astroangaben geparst');
  ok(parseDwdAstro('kein Bericht') === null, 'ohne Angaben → null');
  const bDE = newBriefing(S, Date.UTC(2026, 9, 4, 8, 0));
  bDE.site = { name: 'Gladbeck', lat: 51.57, lon: 6.98, elev: 40, tz: 'Europe/Berlin', country: 'DE' }; bDE.time = { date: '2026-10-05', time: '08:00', startMs: Date.UTC(2026, 9, 5, 6, 0) }; bDE.intent.durationMin = 120;
  bDE.panels['B.balloon'].content.auto = { data: { dwd: { id: '31', text: 'Vorhersagen für Montag, 05.10.2026\nSonnenaufgang  05:37  Sonnenuntergang  16:56\nBeginn bürgerl. Dämmerung  05:01  Ende bürgerl. Dämmerung  17:30\n' } } };
  const sun = sunFor(bDE, S, null);
  ok(sun.source === 'dwd' && sun.dwdArea === '31' && sun.official.bcmt === Date.UTC(2026, 9, 5, 5, 1) && sun.official.ecet === Date.UTC(2026, 9, 5, 17, 30), 'DE: amtliche Dämmerungszeiten aus dem DWD-Bericht (UTC) übernommen');
  bDE.panels['B.balloon'].content.auto.data.dwd.text = 'Vorhersagen für Sonntag, 04.10.2026\nSonnenaufgang  05:37  Sonnenuntergang  16:56\nBeginn bürgerl. Dämmerung  05:01  Ende bürgerl. Dämmerung  17:30\n';
  ok(sunFor(bDE, S, null).source === 'astro', 'DWD-Bericht eines anderen Tages → berechnet');
  ok(mergeSettings({ balloons: { hab: [{ id: 'HB-QWP', mtom: 883 }] } }).balloons.hab[0].mtom === 950, 'HB-QWP MTOM 883 → 950 (BAZL)');
}

// ---------------------------------------------------------------- 0.11.2: Bearbeitungsstand, Zusatzbox-Migration, Länderkennzeichen, Klartext-Zeilen
{
  const S = mergeSettings(null);
  const b = newBriefing(S); b.revision = 7; delete b.edition;
  b.panels['B.metar'].content = { auto: { kind: 'metar' }, text: 'eigener Hinweis', images: [{ url: 'x' }] };
  b.panels['B.fwp'].content = { text: 'Bericht (Pflicht)', images: [] };
  upgradeBriefing(b);
  ok(b.edition === 7, 'Bestand: Bearbeitungsstand übernimmt den Speicherzähler');
  ok(b.panels['B.metar'].extra.text === 'eigener Hinweis' && b.panels['B.metar'].extra.images.length === 1 && b.panels['B.metar'].content.text == null && b.panels['B.metar'].content.auto, 'Auto-Panel: eigener Text/Bilder → Zusatzbox, Schnappschuss bleibt');
  ok(b.panels['B.fwp'].content.text === 'Bericht (Pflicht)', 'Einfügepflicht-Panel (half): Bericht bleibt im Inhalt');
  const d = duplicateBriefing(b, S);
  ok(d.edition === 0 && newBriefing(S).edition === 0, 'neu/dupliziert: Bearbeitungsstand 0');
  ok(carCode('DE') === 'DE' && carCode('AT') === 'AT' && carCode('li') === 'LI' && carCode('xx') === 'XX', 'Länderkennzeichen für Ortsangaben im Ausland: ISO-2, einheitlich mit placeLabel (0.12.5)');
  const ml = dMetar('METAR LSZH 051120Z 24008KT 9999 FEW040 BKN100 14/08 Q1018 TEMPO 4000 RA=', 'de');
  ok(ml[0].startsWith('LSZH') && ml.some((x) => x.startsWith('→')), 'METAR-Klartext: Kopfzeile ohne Präfix (Präfix setzt die Anzeige), Änderungsgruppe mit →');
  const tl = dTaf('TAF LSZH 051025Z 0512/0618 24008KT 9999 SCT040 BECMG 0518/0521 VRB02KT=', 'de');
  ok(tl.length === 3 && tl[2].startsWith('→'), 'TAF-Klartext: Basis + Änderungsgruppe mit →');
  // 0.12.10: Zeitfenster der Änderungsgruppen (Monat/Jahr aus dem Stand), FM bis zur nächsten FM-Gruppe
  const ref = Date.UTC(2026, 9, 5, 11, 0);
  const tw = tafGroupWindows('TAF LSZH 051025Z 0512/0618 24008KT 9999 SCT040 BECMG 0518/0521 VRB02KT PROB30 TEMPO 0603/0607 0800 FG FM061000 30005KT FM061500 27010KT=', ref);
  ok(tw.length === 5 && tw[0] === null && tw[1].from === Date.UTC(2026, 9, 5, 18) && tw[1].to === Date.UTC(2026, 9, 5, 21) && tw[2].from === Date.UTC(2026, 9, 6, 3) && tw[3].from === Date.UTC(2026, 9, 6, 10) && tw[3].to === Date.UTC(2026, 9, 6, 15), 'TAF-Gruppenfenster: ' + JSON.stringify(tw));
  const tw2 = tafGroupWindows('TAF EDDM 311720Z 3118/0124 BECMG 0103/0106 VRB02KT=', Date.UTC(2026, 9, 31, 18));
  ok(tw2.length === 1 && tw2[0].from === Date.UTC(2026, 10, 1, 3) && tw2[0].to === Date.UTC(2026, 10, 1, 6), 'TAF-Gruppenfenster über den Monatswechsel (ohne Basisgruppe)');
  // 0.12.13: Ende der TAF-Gültigkeit (Abdeckung bis Start + 1 h)
  ok(tafValidEnd('TAF LSZH 051025Z 0512/0618 24008KT 9999 SCT040=', ref) === Date.UTC(2026, 9, 6, 18) && tafValidEnd('TAF AMD EDDM 311720Z 3118/0124 VRB02KT=', Date.UTC(2026, 9, 31, 18)) === Date.UTC(2026, 10, 1, 24) && tafValidEnd('LSZH 051025Z NIL=', ref) === null, 'TAF-Gültigkeitsende (auch über den Monatswechsel; NIL → null)');
}

// ---------------------------------------------------------------- 0.11.3: Kopie eines Briefings, NVFR → Flugplan Pflicht
{
  const S = mergeSettings(null);
  const src = newBriefing(S);
  src.persons.pax = [{ name: 'Viviane Graf', weight: 70 }]; src.persons.retrieve = 'Martin Baumann'; src.flight.occasion = 'Firmenanlass'; src.weather.tempC = 22; src.weather.source = 'model';
  src.time.date = '2026-09-01'; src.time.time = '17:30'; src.time.startMs = fromLocal('Europe/Zurich', '2026-09-01', '17:30');
  const d = duplicateBriefing(src, S);
  ok(d.wizardStep === 1, 'Kopie: Ablauf beginnt bei Schritt 1');
  ok(d.persons.pax[0].name === 'Viviane Graf' && d.persons.retrieve === 'Martin Baumann' && d.site.name === src.site.name && d.balloon.reg === src.balloon.reg, 'Kopie: Pax, Nachfahrer, Startort, Ballon bleiben');
  ok(d.time.time === '06:30' && d.time.date !== '2026-09-01' && d.flight.occasion === '' && d.weather.source === 'manual' && d.weather.tempC === 15, 'Kopie: Datum/Zeit, Anlass, Startplatzwerte auf Vorgabe');
  const b = newBriefing(S); b.flight.nvfr = false;
  ok(!mandatoryPanels(S, b).some((p) => p.key === 'C.fpl'), 'ohne NVFR: Flugplan nicht Pflicht (Standard)');
  b.flight.nvfr = true;
  ok(mandatoryPanels(S, b).some((p) => p.key === 'C.fpl'), 'NVFR: Flugplan (C) Pflicht');
  ok(!panelFilled(panelByKey('C.fpl'), b), 'NVFR ohne erstellten Flugplan: Panel offen');
  b.fpl = { enabled: true };
  ok(panelFilled(panelByKey('C.fpl'), b), 'NVFR mit Flugplan: Panel erledigt');
}

// Bezugszeit für das Alter von Meldungen (0.11.4): Publikation (Final) > gesperrt: Start > sonst jetzt
{
  const S = mergeSettings(null);
  const b = newBriefing(S);
  const now = fromLocal('Europe/Zurich', '2026-10-05', '12:00');
  b.time.startMs = fromLocal('Europe/Zurich', '2026-10-06', '06:30');
  ok(ageRefMs(b, now) === now, 'in Erarbeitung: Alter bezogen auf jetzt');
  b.status = 'final'; b.finalNo = 1; b.versions = [{ no: 1, ts: now - 3600000 }];
  ok(ageRefMs(b, now) === now - 3600000, 'Final: Alter bezogen auf die Freigabe (Publikation)');
  const c = newBriefing(S); c.time.startMs = fromLocal('Europe/Zurich', '2026-09-01', '06:30');
  ok(ageRefMs(c, now) === c.time.startMs, 'gesperrt ohne Freigabe: Alter bezogen auf den Start');
}

// Füllungsgrad je Briefing (0.11.4): Vorgabe 100 %, Bestand übernimmt den Stammwert, Ballast folgt dem Füllungsgrad
{
  const S = mergeSettings(null);
  const b = newBriefing(S);
  ok(b.weather.fillPct === 100, 'neues Briefing: Füllungsgrad 100 %');
  const gasBal = S.balloons.envelopes?.[0];
  if (gasBal) {
    b.balloon = { ...JSON.parse(JSON.stringify(gasBal)), type: 'gas', reg: gasBal.id, masses: { envelope: gasBal.mass || 116, basket: 60, equipment: 30, instruments: 0 }, ballastUnitKg: 12, reserveUnits: 4 };
    b.site.elev = 450;
    const full = massPerf(b, S).r.ballast;
    b.weather.fillPct = 80;
    ok(fillFractionOf(b) === 0.8, 'Füllungsgrad 80 % → 0.8');
    const part = massPerf(b, S).r.ballast;
    ok(part < full, `Ballast bei 80 % (${Math.round(part)} kg) kleiner als bei 100 % (${Math.round(full)} kg)`);
  }
  const old = newBriefing(S); delete old.weather.fillPct; old.balloon.fillFraction = 0.9;
  upgradeBriefing(old);
  ok(old.weather.fillPct === 90, 'Bestand ohne Füllungsgrad: Stammwert der Hülle (90 %)');
  ok(S.aero.dtDayClear === 15 && S.aero.dtNightClear === -3 && S.aero.dtDayOvercast === 5 && S.aero.dtNightOvercast === -1, 'Aerostatik-Vorgaben im Expertenbereich');
}

// ---------------------------------------------------------------- 0.12 Höhenprofil, Etappen, Ballastmodell
{
  // Bahn: 180 km, 16:00 Start, Geschwindigkeit wächst mit der Höhe (Kopplung km ↔ Zeit)
  const t0 = Date.UTC(2026, 9, 6, 14, 0);   // 16:00 LT
  const track = { totalKm: 180, points: [] };
  for (let k = 0; k <= 180; k += 10) track.points.push({ km: k, ms: t0 + k * 5 * 60000, lat: 47 + k * 0.004, lon: 8 + k * 0.01 });   // 12 km/h
  const pts = [{ km: 0, alt: 450 }, { km: 2, alt: 1300 }, { km: 40, alt: 1300 }, { km: 42, alt: 1600 }, { km: 75, alt: 1600 }, { km: 80, alt: 2300 }, { km: 125, alt: 2300 }, { km: 128, alt: 1900 }, { km: 150, alt: 1900 }, { km: 156, alt: 900 }, { km: 176, alt: 900 }, { km: 180, alt: 280 }];
  ok(altAt(pts, 1) === 875 && altAt(pts, 60) === 1600 && altAt(pts, 999) === 280, 'altAt: linear, geklemmt');
  ok(msAtKm(track, 90) === t0 + 90 * 5 * 60000 && kmAtMs(track, t0 + 3600000) === 12, 'Kopplung km↔Zeit');
  const seg = segments(pts, track);
  ok(seg.length === 11 && Math.abs(seg[0].rate - 850 / 600) < 0.01, `Rate 0–2 km: 850 m in 10 min = ${seg[0].rate} m/s`);
  ok(rateClass(0.2) === 'hold' && rateClass(1.0) === 'ok' && rateClass(2.5) === 'warn' && rateClass(4) === 'bad', 'Ratenklassen');
  const relief = []; for (let k = 0; k <= 180; k += 10) relief.push({ km: k, m: k >= 60 && k <= 120 ? 1700 : 400 });
  const br = reliefBreaches(pts, relief);
  ok(br.length === 1 && br[0].km0 >= 55 && br[0].km0 <= 62 && br[0].km1 >= 76 && br[0].km1 <= 80, 'Relief: Unterschreitung 300 m am Anstieg (≈ 57–78 km): ' + JSON.stringify(br));
  // Etappen
  const st = [{ id: 'a', km: 0, name: 'Start' }, { id: 'b', km: 30, name: 'Enroute' }, { id: 'c', km: 140, name: 'Landung' }];
  ok(addStage(st, 75, 'Voralpen') && st.map((x) => x.name).join(',') === 'Start,Enroute,Voralpen,Landung', 'Etappe einfügen → Reihenfolge/Nummerierung');
  ok(addStage(st, 76) === null, 'Etappe zu nahe an bestehender Grenze → abgelehnt');
  ok(moveStage(st, 1, 90, 180) === 73 && moveStage(st, 1, 10, 180) === 10, 'Verschieben zwischen Vorgänger/Nachfolger geklemmt (≥ 2 km)');
  ok(moveStage(st, 0, 20, 180) === 0, 'Startgrenze bleibt bei 0');
  ok(removeStage(st, 2, 'next') && st.length === 3 && st[2].km === 75 && st[2].name === 'Landung', 'Löschen mit Nachfolger: Nachfolger beginnt hier');
  ok(removeStage(st, 1, 'prev') && st.length === 2 && st[1].km === 75, 'Löschen mit Vorgänger: Vorgänger übernimmt');
  ok(!removeStage(st, 0, 'prev') && !removeStage(st, 1, 'next'), 'erste nur mit Nachfolger, letzte nur mit Vorgänger');
  const win = stageWindows(st, track, pts, 180);
  ok(win.length === 2 && win[0].no === 1 && win[0].km1 === 75 && win[1].km1 === 180 && win[1].altMax === 2300 && win[0].ms1 === msAtKm(track, 75), 'Etappenfenster mit Zeit und Höhenband');
  // Sonne: Nachtanteil mit Übergang ±1 h
  const ev = [{ kind: 'ecet', ms: t0 + 3 * 3600000 }, { kind: 'bcmt', ms: t0 + 14 * 3600000 }];
  ok(nightFraction(ev, t0) === 0 && nightFraction(ev, t0 + 3 * 3600000) === 0.5 && nightFraction(ev, t0 + 8 * 3600000) === 1 && nightFraction(ev, t0 + 16 * 3600000) === 0, 'Nachtanteil Tag → Übergang → Nacht → Tag');
  // Ballast: 1000 m³ H2, 100 % Füllung: Steigen 450 → 1300 m kostet ≈ 10–11 % der Tragfähigkeit (Abblasen) + Manöver
  const plan = ballastPlan(pts, track, { volume: 1000, fillFraction: 1, gas: 'H2', siteAlt: 450, wz: 3.8, nightAt: (ms) => nightFraction(ev, ms), landingKg: 60, availKg: 550 });
  const r0 = plan.rows[0];
  ok(r0.blow > 100 && r0.blow < 125, `Abblasen 450→1300 m ≈ 10,6 % von ${plan.liftStart} kg: ${r0.blow} kg`);
  ok(r0.man > 5 && r0.man < 15, `Manöver Steigen mit ${seg[0].rate} m/s: ${r0.man} kg`);
  ok(plan.prallH === 450, 'Prallhöhe bei 100 % Füllung = Starthöhe');
  const tempSum = plan.rows.reduce((a, r) => a + r.temp, 0);
  ok(tempSum > 65 && tempSum < 95, `Abendübergang +15 → −3 K ≈ 18 K × 4.3 kg über die Teilstücke: ${tempSum.toFixed(0)} kg`);
  ok(plan.total > 300 && plan.total < 550 && plan.pct === Math.round(plan.total / 550 * 100), `Summe plausibel: ${plan.total} kg (${plan.pct} %)`);
  const plan85 = ballastPlan(pts, track, { volume: 1000, fillFraction: 0.85, gas: 'H2', siteAlt: 450, wz: 3.8, landingKg: 60 });
  ok(plan85.prallH > 2000 && plan85.prallH < 2200 && plan85.rows[0].blow === 0, `85 % Füllung ab 450 m: Prallhöhe ≈ 2 100 m AMSL (ISA; ${plan85.prallH}), erster Aufstieg ohne Abblasen`);
  ok(Math.abs(rhoAir(0) - 1.225) < 1e-9 && rhoAir(1000) < 1.12 && rhoAir(1000) > 1.11, 'ISA-Dichte');
  // Punkte an die Bahnlänge anpassen
  const fp = fitPoints([{ km: 5, alt: 1000 }, { km: 0, alt: 450 }, { km: 300, alt: 2000 }, { km: 190, alt: 300 }], 180);
  ok(fp.length === 3 && fp[0].km === 0 && fp[fp.length - 1].km === 180 && fp[fp.length - 1].alt === 2000, 'fitPoints: sortiert, 0 km, letzter Punkt (Landung) bei Bahnlänge: ' + JSON.stringify(fp));
  const dp = defaultPoints(450, 1500, 120);
  ok(dp.length === 4 && dp[0].alt === 450 && dp[1].alt === 1500 && dp[3].km === 120, 'Standardprofil');
  const hz = hazards([{ ms: t0, km: 10, alt: 1300, windKt: 35, cape: 100 }, { ms: t0 + 3600000, km: 20, alt: 1300, windKt: 36 }, { ms: t0 + 2 * 3600000, km: 90, alt: 2300, tempAtAlt: -2, rhAtAlt: 95 }, { ms: t0 + 3 * 3600000, km: 120, alt: 2300, ground: 500, cape: 700, fogRisk: 2 }, { ms: t0 + 7 * 3600000, km: 200, alt: 1300, windKt: 40 }]);
  const wr = waterRuns([{ km: 0, m: 450 }, { km: 1, m: 452 }, { km: 2, m: 406 }, { km: 3, m: 406 }, { km: 4, m: 407 }, { km: 5, m: 406 }, { km: 6, m: 480 }, { km: 7, m: 500 }, { km: 8, m: 500 }, { km: 9, m: 520 }]);
  ok(wr.length === 1 && wr[0].km0 === 2 && wr[0].km1 === 5 && wr[0].m === 406, 'Wasserflächen: ebener Lauf ≥ 3 km (±1 m), kurze ebene Stücke nicht: ' + JSON.stringify(wr));
  const wf = waterFromItems([0, 1, 2, 3, 4, 5, 6, 7].map((km) => ({ km })), [null, null, { name: 'Sempachersee', type: 'lake' }, { name: null, type: 'lake' }, null, null, { name: 'Baldeggersee', type: 'lake' }, null], [{ km: 2, m: 505 }, { km: 3, m: 504 }, { km: 6, m: 463 }]);
  ok(wf.length === 2 && wf[0].km0 === 1.5 && wf[0].km1 === 3.5 && wf[0].m === 504 && wf[0].name === 'Sempachersee' && wf[1].km0 === 5.5 && wf[1].km1 === 6.5 && wf[1].name === 'Baldeggersee', 'Wasserflächen aus OSM: Punkte ±½ km, benachbarte verbunden, Seespiegel = tiefste Reliefhöhe, Name: ' + JSON.stringify(wf));
  const sq = (lat0, lon0, lat1, lon1) => [[[lat0, lon0], [lat0, lon1], [lat1, lon1], [lat1, lon0], [lat0, lon0]]];
  const fs = fisSectors([{ id: 'a', typeKey: 'FIS', name: 'A INFORMATION', country: 'CH', freqs: [{ value: '124.700' }], polys: [sq(47, 8, 48, 9)] }, { id: 'b', typeKey: 'FIS', name: 'B INFORMATION', country: 'DE', freqs: [{ value: '128.950' }], polys: [sq(48, 8, 49, 9)] }, { id: 'c', typeKey: 'CTR', name: 'x', polys: [sq(47, 8, 49, 9)] }], Array.from({ length: 21 }, (_, i) => ({ km: i * 10, lat: 47.2 + i * 0.1, lon: 8.5 })));
  ok(fs.length === 2 && fs[0].name === 'A INFORMATION' && fs[0].toKm === 70 && fs[1].fromKm === 80 && fs[1].freqs[0] === '128.950' && fisSectors([], []).length === 0, 'FIS-Sektoren entlang der Bahn (openAIP Typ FIS): Folge mit km-Abschnitten und Frequenz: ' + JSON.stringify(fs));
  // 0.12.4: NOTAM-Text (DINS / NOTAM Search), Ortsname mit Länderkennzeichen, Schweiz-Umriss
  const nt = parseIcaoNotam('B1234/26 NOTAMN\nQ) LSAS/QRTCA/IV/BO/W/000/130/4723N00757E005\nA) LSAS B) 2610071000 C) 2610071600\nE) TEMPO RESTRICTED AREA LS-R5 ACTIVE.\nF) GND G) FL130');
  ok(nt.number === 'B1234/26' && nt.location === 'LSAS' && nt.code === 'RTCA' && Math.abs(nt.lat - 47.383) < 0.01 && Math.abs(nt.lon - 7.95) < 0.01 && nt.radius === 5 && nt.minFL === 0 && nt.maxFL === 130 && nt.start === '2026-10-07T10:00:00Z' && nt.end === '2026-10-07T16:00:00Z' && nt.text.startsWith('TEMPO') && nt.lowerTxt === 'GND' && nt.upperTxt === 'FL130', 'ICAO-NOTAM zerlegt (Q-Zeile, A–G): ' + JSON.stringify(nt).slice(0, 160));
  ok(parseIcaoNotam('A0456/26 NOTAMR A0400/26\nQ) EDMM/QMRLC/IV/NBO/A/000/999/4812N01147E005\nA) EDDM B) 2610061200 C) PERM\nE) RWY 08L/26R CLSD.').end === 'PERM', 'NOTAM PERM');
  ok(placeLabel({ name: 'Wolfegg', country: 'DE' }) === 'DE-Wolfegg' && placeLabel({ name: 'Gladbeck (DE)', country: 'DE' }) === 'DE-Gladbeck' && placeLabel({ name: 'Oberlunkhofen AG', country: 'CH' }) === 'CH-Oberlunkhofen AG' && placeLabel({ name: 'DE-Wolfegg', country: 'DE' }) === 'DE-Wolfegg', 'Ortsname mit Länderkennzeichen (0.12.8: auch CH)');
  ok(inSwitzerland(47.37, 8.54) && inSwitzerland(46.20, 6.14) && inSwitzerland(46.0, 8.95) && !inSwitzerland(47.82, 9.80) && !inSwitzerland(47.50, 9.75) && !inSwitzerland(47.99, 7.85), 'Schweiz-Umriss: Zürich/Genf/Lugano innen, Wolfegg/Bregenz/Freiburg aussen');
  ok(!touchesCH({ site: { country: 'DE', lat: 47.82, lon: 9.80 }, landing: { country: 'PL', lat: 52.2, lon: 21.0 }, panels: { 'B.traj': { content: { auto: { data: { tracks: [{ points: [{ lat: 47.82, lon: 9.80 }, { lat: 48.5, lon: 11 }] }] } } } } } }) && touchesCH({ site: { country: 'DE', lat: 47.82, lon: 9.80 }, panels: { 'B.traj': { content: { auto: { data: { tracks: [{ points: [{ lat: 47.4, lon: 9.0 }] }] } } } } } }), 'DABS nur, wenn die Fahrt die Schweiz berührt (Wolfegg → Polen nicht; Bahn über CH schon)');
  ok(waterFromItems([], [], []).length === 0 && waterFromItems([{ km: 0 }, { km: 1 }], [null, null], []).length === 0, 'Wasserflächen aus OSM: leer ohne Treffer');
  ok(hz.map((x) => x.type).join(',') === 'wind,ice,cb,wind' && hz[0].kmEnd === 20, 'Achtung-Zeichen: Wind (anhaltend zusammengefasst, nach Pause neu), Vereisung, CB, kein Nebel in 1800 m über Grund: ' + hz.map((x) => x.type + '@' + x.km + '-' + x.kmEnd).join(','));
}

// ---------------------------------------------------------------- 0.12.5 Ops-Briefing je Etappe
{
  const S = mergeSettings({});
  const t0 = Date.UTC(2026, 9, 6, 14, 0);
  const track = { totalKm: 180, points: [] };
  for (let k = 0; k <= 180; k += 5) track.points.push({ km: k, ms: t0 + k * 5 * 60000, lat: 47.0 + k * 0.004, lon: 8.0 + k * 0.012, alt: k < 40 ? 1300 : 2300 });
  const st = defaultStages({ start: 'Start', enroute: 'Enroute', landing: 'Landung' }, 180, 1200);
  ok(st.length === 3 && st[0].ops === true && st[1].ops === false && stageOps(st, 0) && !stageOps(st, 1) && defaultStages({ start: 'Start', enroute: 'Enroute', landing: 'Landung' }, 100, 480).length === 1 && defaultStages({ start: 'Start', enroute: 'Enroute', landing: 'Landung' }, 100, 480)[0].name === 'Enroute', 'Vorgabe-Etappen: ab 10 h drei (Start mit Planung), darunter eine «Enroute» mit Planung');
  ok(stageOps([{ id: 'a', km: 0 }, { id: 'b', km: 50 }], 0) && !stageOps([{ id: 'a', km: 0 }, { id: 'b', km: 50 }], 1) && !canDropOps(st, 0) && (st[1].ops = true, canDropOps(st, 0)) && canDropOps(st, 1), 'Planung ohne Angabe: erste Etappe ja; ausschalten nur, wenn eine andere Etappe eine Planung hat');
  st[0].ops = false; st[1].ops = false; ensureOps(st);
  ok(st[0].ops === true, 'ensureOps: ohne Planung fällt sie an die Startetappe');
  const ns = addStage(st, 120, 'Nacht', 2, true);
  ok(ns.ops === true && addStage(st, 60, 'x').ops === false, 'addStage übernimmt die Klickbox');
  const cp = coverPoints(track, 27, 153, 25, '2 · Enroute');
  ok(cp.length === 2 && cp.every((q) => q.nm === 25) && Math.abs(cp[0].lat - (47 + 58.5 * 0.004)) < 0.01 && cp[1].name === '2 · Enroute 122 km' && coverPoints(track, 0, 20, 25).length === 1 && coverPoints(track, 0, 180, 10).length === 6, 'NOTAM-Kreise entlang der Etappe: überlappend, max. 6: ' + JSON.stringify(cp.map((q) => q.name)));
  ok(countryAtKm([{ country: 'CH', fromKm: 0, toKm: 40 }, { country: 'DE', fromKm: 40, toKm: 180 }], 90) === 'DE' && countryAtKm([], 90, { lat: 48.5, lon: 9 }) === 'DE' && countryAtKm([], 90, null, 'CH') === 'CH', 'Land an km aus der FIR-Folge, sonst Schätzung');
  // Abgeleitete Sicht einer Etappe
  const b = newBriefing(S); b.balloon = { ...b.balloon, type: 'gas' }; b.site = { ...b.site, name: 'Oberlunkhofen', lat: 47.0, lon: 8.0, elev: 450, country: 'CH', tz: 'Europe/Zurich' }; b.time.startMs = t0; b.intent.durationMin = 900;
  b.profile = { points: [{ km: 0, alt: 450 }, { km: 5, alt: 1300 }, { km: 40, alt: 1300 }, { km: 45, alt: 2300 }, { km: 170, alt: 2300 }, { km: 180, alt: 600 }], stages: [{ id: 's1', km: 0, name: 'Start', ops: true }, { id: 's2', km: 27, name: 'Enroute', ops: true }, { id: 's3', km: 153, name: 'Landung' }], layers: {}, data: { track, totalKm: 180, relief: track.points.map((q) => ({ km: q.km, m: 400 + q.km })), firs: [{ name: 'SWITZERLAND', country: 'CH', fromKm: 0, toKm: 40 }, { name: 'LANGEN', country: 'DE', fromKm: 40, toKm: 180 }] } };
  upgradeBriefing(b);
  const bs = stagePlanBriefing(b, 's2');
  ok(bs && bs.stagePlan.no === 2 && bs.stagePlan.km0 === 27 && bs.stagePlan.km1 === 153 && bs.time.startMs === t0 + 27 * 5 * 60000 && bs.intent.durationMin === 126 * 5 && Math.abs(bs.site.lat - (47 + 90 * 0.004)) < 0.001 && bs.site.country === 'DE' && bs.site.elev === 490 && bs.landing.country === 'DE' && Math.abs(bs.landing.lat - (47 + 153 * 0.004)) < 0.001, 'Etappensicht: Zeitfenster der Etappe, Ort = Etappenmitte (Relief, Land aus der FIR-Folge), Landeraum = Etappenende: ' + JSON.stringify({ start: bs.time.startMs - t0, dur: bs.intent.durationMin, site: bs.site, landing: bs.landing }));
  ok(bs.intent.altMinFt === Math.round(1300 * 3.28084) && bs.intent.altMaxFt === Math.round(2300 * 3.28084) && bs.stagePlan.traj.tracks[0].points.length === 25 && bs.panels === b.stagePlans.s2.panels && bs.panels['C.notam'] && !bs.panels['A.core'], 'Höhenband und Bahnabschnitt der Etappe; Panels = Planungsdatensatz');
  bs.metarKm = 80; bs.dabsDay = 'tomorrow';
  ok(b.stagePlans.s2.metarKm === 80 && b.stagePlans.s2.dabsDay === 'tomorrow' && bs.metarKm === 80, 'Abrufeinstellungen der Etappe landen im Planungsdatensatz');
  const sets = stageSets(b);
  ok(sets.length === 1 && sets[0].sid === 's2' && sets[0].no === 2 && stageSets({ ...b, balloon: { type: 'hab' } }).length === 0, 'Etappen-Briefings: Etappen mit Planung ausser der ersten; keine bei Heissluft');
  const vp = visiblePanels(S, bs).map((p) => p.key);
  ok(vp.includes('B.meteogram') && vp.includes('C.notam') && vp.includes('B.remarks') && !vp.includes('B.traj') && !vp.includes('C.fpl') && !vp.includes('A.core') && vp.includes('C.dabs'), 'Sichtbare Panels der Etappe: Planung + Bemerkungen, DABS weil der Bahnabschnitt über die Schweiz führt: ' + vp.join(','));
  const far = { ...bs, site: { ...bs.site, country: 'DE' }, landing: { ...bs.landing, country: 'DE' }, stagePlan: { ...bs.stagePlan, traj: { tracks: [{ points: [{ lat: 48.5, lon: 10 }, { lat: 49, lon: 11 }] }] } } };
  ok(!visiblePanels(S, far).some((p) => p.key === 'C.dabs'), 'kein DABS in der Etappe, wenn ihr Bahnabschnitt die Schweiz nicht berührt');
  b.profile.stages[1].km = 10; b.profile.data.firs[0].toKm = 100;
  const bs2 = stagePlanBriefing(b, 's2');
  ok(!startPlanOff(b) && (b.profile.stages[0].ops = false, startPlanOff(b)) && !visiblePanels(S, b).some((p) => p.key === 'B.meteogram') && visiblePanels(S, b).some((p) => p.key === 'C.fpl') && visiblePanels(S, b).some((p) => p.key === 'B.remarks'), 'Startetappe ohne Planung: orts-/zeitgebundene Panels fehlen in B/C, Flugplan und Bemerkungen bleiben');
  b.profile.stages[0].ops = true;
  ok(planStale({ km0: 10, km1: 153, ms0: bs2.stagePlan.ms0, ms1: bs2.stagePlan.ms1 }, { km0: 10, km1: 153, ms0: bs2.stagePlan.ms0 + 60000, ms1: bs2.stagePlan.ms1 }) === false && planStale({ km0: 27, km1: 153, ms0: 0, ms1: 0 }, { km0: 10, km1: 153, ms0: 0, ms1: 0 }) === true, 'planStale: verschoben > 2 km oder > 20 min');
  const c0 = completion(b, S);
  b.stagePlans.s2.panels['B.meteogram'].content.auto = { kind: 'meteogram', text: 'x' };
  ok(completion(b, S) > c0, 'Vollständigkeit zählt die Panels der Etappen-Briefings mit');
  b.profile.stages.splice(1, 1); pruneStagePlans(b);
  ok(!b.stagePlans.s2 && stageSets(b).length === 0, 'Planungsdaten gelöschter Etappen werden entfernt');
}

// ---------------------------------------------------------------- 0.12.6 2. Pilot (Gas), Übergangshöhen nach Ländern der Fahrt
{
  const S = mergeSettings({});
  const b = newBriefing(S); b.balloon = { ...b.balloon, type: 'gas', personWeight: 80 }; b.persons.pax = [{ name: 'A', weight: null }];
  upgradeBriefing(b);
  ok(b.persons.copilotId === '' && personsOnBoard(b) === 2 && !hasCopilot(b), 'ohne 2. Pilot: PIC + Pax');
  b.persons.copilotId = 'custom'; b.persons.copilot = 'Kurt';
  ok(hasCopilot(b) && personsOnBoard(b) === 3 && massPerf(b, S).r.paxMass === 240, '2. Pilot zählt zu den Personen an Bord und zur Masse (3 × 80 kg)');
  ok(buildFpl(b, S).p19 === 3 && (b.balloon.type = 'hab', personsOnBoard(b)) === 3 && hasCopilot(b), 'Flugplan P/ 3; 0.12.7: 2. Pilot auch bei Heissluft');
  b.balloon.type = 'gas';
  const c = newBriefing(S); c.site = { ...c.site, country: 'CH', lat: 47.3, lon: 8.3 }; upgradeBriefing(c);
  ok(applicableTransitions(c, S).join(',') === 'zh,ch', 'Übergangshöhen CH: zh, ch');
  c.landing = { name: 'x', lat: 48.5, lon: 9.9, country: 'DE' };
  ok(applicableTransitions(c, S).join(',') === 'zh,ch,de' && transitionItems(c, S).join(',') === 'zh,ch,de', 'Landeraum DE → zusätzlich de (automatisch)');
  c.panels['C.transition'].content = { items: ['fr'], manual: true };
  ok(transitionItems(c, S).join(',') === 'fr', 'von Hand gesetzt bleibt');
}

// ---------------------------------------------------------------- 0.12.7 Startetappe auf ihren Bereich, Umbenennung, Panel-Nummern mit Etappe, FIS-Werte
{
  const S = mergeSettings({});
  const t0 = Date.UTC(2026, 9, 6, 14, 0);
  const track = { totalKm: 180, points: [] };
  for (let k = 0; k <= 180; k += 5) track.points.push({ km: k, ms: t0 + k * 5 * 60000, lat: 47.0 + k * 0.004, lon: 8.0 + k * 0.012, alt: k < 40 ? 1300 : 2300 });
  const b = newBriefing(S); b.balloon = { ...b.balloon, type: 'gas' }; b.site = { ...b.site, name: 'Oberlunkhofen', lat: 47.0, lon: 8.0, elev: 450, country: 'CH', tz: 'Europe/Zurich' }; b.time.startMs = t0; b.intent.durationMin = 900;
  b.landing = { name: 'Ziel', lat: 47.7, lon: 10.2, country: 'DE' };
  b.profile = { points: [{ km: 0, alt: 450 }, { km: 5, alt: 1300 }, { km: 40, alt: 1300 }, { km: 45, alt: 2300 }, { km: 170, alt: 2300 }, { km: 180, alt: 600 }], stages: [{ id: 's1', km: 0, name: 'Enroute', ops: true }], layers: {}, data: { track, totalKm: 180, relief: track.points.map((q) => ({ km: q.km, m: 400 + q.km })), firs: [{ name: 'SWITZERLAND', country: 'CH', fromKm: 0, toKm: 40 }, { name: 'LANGEN', country: 'DE', fromKm: 40, toKm: 180 }] } };
  upgradeBriefing(b);
  ok(startPlanBriefing(b) === b && startPlanSig(b) === '', 'eine Etappe: Planung der Startetappe = ganze Fahrt (Briefing selbst)');
  const s2 = addStage(b.profile.stages, 40, 'Nacht', 2, true);
  ok(s2 && renameStartStage(b.profile.stages, { start: 'Start', enroute: 'Enroute' }) === true && b.profile.stages[0].name === 'Start' && renameStartStage(b.profile.stages, { start: 'Start', enroute: 'Enroute' }) === false, 'weitere Etappe → «Enroute» wird «Start» (nur einmal, nur beim Vorgabenamen)');
  const v = startPlanBriefing(b);
  ok(v !== b && v.stagePlan.start === true && v.stagePlan.no === 1 && v.stagePlan.km0 === 0 && v.stagePlan.km1 === 40 && v.intent.durationMin === 200 && v.time.startMs === t0 && v.site === b.site && v.landing === b.landing && v.panels === b.panels, 'Sicht der Startetappe: Dauer = Etappe 1 (200 min), Startort/Landeraum/Panels bleiben');
  ok(v.intent.altMinFt === Math.round(450 * 3.28084) && v.intent.altMaxFt === Math.round(1300 * 3.28084) && v.stagePlan.traj.tracks[0].points.length === 9 && v.stagePlan.to.country === 'CH' && v.stagePlan.lenKm === 40 && startPlanSig(b) === `s:40:${Math.round(v.stagePlan.ms1 / 600000)}`, 'Höhenband und Bahnabschnitt (0–40 km) der Startetappe');
  v.metarKm = 90; v.notamMode = 'places';
  ok(b.metarKm === 90 && b.notamMode === 'places' && v.metarKm === 90, 'Abrufeinstellungen der Startetappen-Sicht landen im Briefing');
  const vp = visiblePanels(S, v).map((p) => p.key);
  ok(vp.includes('A.core') && vp.includes('B.traj') && vp.includes('C.fpl') && vp.includes('B.meteogram'), 'Sicht der Startetappe behält alle Panels (kein Etappen-Satz): ' + vp.length);
  b.profile.stages[0].ops = false;
  ok(startPlanBriefing(b) === b, 'ohne Planung bei der Startetappe keine Sicht');
  b.profile.stages[0].ops = true;
  const vis = visiblePanels(S, b);
  ok(panelNo(vis.find((p) => p.key === 'C.notam'), vis, 'E1-') === 'E1-' + panelNo(vis.find((p) => p.key === 'C.notam'), vis) && panelNo(vis[0], vis) === 'A01', 'Panel-Nummer mit Etappe: «E1-C‹n›»');
  const fis = mergeSettings({ fisContacts: [{ cc: 'CH', name: 'Zürich Information (FIS)', freq: '124.700', phone: '' }, { cc: 'DE', name: 'alt', freq: '', phone: '' }] }).fisContacts;
  ok(fis.some((c) => c.cc === 'DE' && c.freq === '128.950') && fis.some((c) => c.cc === 'FR' && c.freq === '130.905') && mergeSettings({ fisContacts: [{ cc: 'DE', name: 'eigen', freq: '123.000', phone: '' }] }).fisContacts.length === 1, 'FIS-Liste: alte Platzhalter → neue Standardwerte; eigene Werte bleiben');
}

// ---------------------------------------------------------------- 0.12.15: eingefügte Berichte (Flugwetterprognose CH)
{
  const txt = readFileSync(new URL('./fixtures/fwp_ch.txt', import.meta.url), 'utf8');
  const r = parseReport(txt);
  ok(r.ch && r.wind.length === 3 && r.wind.map((w) => w.station).join(',') === 'Payerne,Zürich,Lugano' && r.wind[1].rows[0].w1 === '240/13' && r.wind[1].rows[0].t1 === 3 && r.wind[0].rows[2].t2 === -1 && r.wind[0].ground === 'NW-N / 3-6 KT', 'Windtabellen je Station (PS/MS → ±°C, Ground)');
  const heads = r.blocks.filter((b) => b.kind === 'h').map((b) => b.text);
  ok(heads.includes('Wetterlage') && heads.includes('Flachland und Jura') && heads.includes('Wolken, Sicht und Wetter gültig für 12:00 - 18:00 UTC') && heads.includes('Wind (GRAD/KT) und Temperatur (GRAD CELSIUS)'), 'Zwischentitel erkannt: ' + heads.join(' | '));
  const p0 = r.blocks.find((b) => b.kind === 'p' && b.text.startsWith('Nach einer'));
  ok(p0 && !p0.text.includes('\n') && p0.text.includes('Island führt am Samstag'), 'harte Umbrüche im Absatz entfernt');
  ok(r.blocks.some((b) => b.kind === 'kv' && b.k === 'Nullgradgrenze'), 'Prognosewerte als Schlüssel/Wert');
  const v = r.validity;
  ok(v.issued === Date.UTC(2026, 9, 9, 11) && v.from === Date.UTC(2026, 9, 9, 12) && v.to === Date.UTC(2026, 9, 9, 18) && v.next === Date.UTC(2026, 9, 10, 5), 'Gültigkeit: Ausgabe 11:00, 12–18 UTC, nächste Aktualisierung 10.10. 05:00');
  ok(parseDeDateUtc('am Samstag, den 10. Oktober 2026 05:00 UTC') === Date.UTC(2026, 9, 10, 5), 'deutsches Datum mit/ohne Komma');
  const s1 = reportValidity('SIGWX LOW ALPS VALID 12 UTC 09.10.2026', Date.UTC(2026, 9, 9));
  ok(s1.from === Date.UTC(2026, 9, 9, 9) && s1.to === Date.UTC(2026, 9, 9, 15), 'SIGWX «VALID 12 UTC 09.10.2026» → ±3 h');
  ok(reportValidity('nur Text ohne Zeiten') === null, 'ohne Angabe → null');
}

// ---------------------------------------------------------------- 0.12.17b: Übergabe des Höhenprofils an die O2-Planung
{
  const { o2Levels, o2Link, o2NewId, o2CalcLink, O2_ID_RE } = await import('../js/calc/profile.js');
  const t0 = Date.UTC(2026, 9, 6, 14, 0);
  const track = { totalKm: 180, points: [] };
  for (let k = 0; k <= 180; k += 10) track.points.push({ km: k, ms: t0 + k * 5 * 60000, lat: 47, lon: 8 });   // 12 km/h → 15 h
  const pts = [{ km: 0, alt: 450 }, { km: 6, alt: 3050 }, { km: 90, alt: 3050 }, { km: 96, alt: 4270 }, { km: 150, alt: 4270 }, { km: 180, alt: 600 }];
  const lv = o2Levels(pts, track);
  const sum = lv.reduce((a, l) => a + l.dur, 0);
  ok(Math.abs(sum - 15) < 0.01, 'O2-Übergabe: Gesamtdauer bleibt erhalten (15 h): ' + sum);
  ok(lv.some((l) => l.alt === 10000 && Math.abs(l.dur - 7) < 0.01) && lv.some((l) => l.alt === 14000 && Math.abs(l.dur - 4.5) < 0.01), 'Haltestrecken werden je eine Stufe in ft: ' + JSON.stringify(lv));
  ok(lv.length === 14 && lv[0].alt < lv[1].alt && lv[lv.length - 1].alt < lv[lv.length - 2].alt && lv.every((l) => l.alt % 100 === 0 && l.dur > 0), 'Steigen und Sinken in je vier Teilstufen, auf 100 ft gerundet');
  const low = o2Levels(pts, track, { qnh: 993.25 });
  ok(low.find((l) => Math.abs(l.dur - 7) < 0.01).alt === 10500, 'QNH 993 hPa: Druckhöhe 540 ft über der Höhe AMSL');
  const few = o2Levels(pts, track, { max: 6 });
  ok(few.length <= 6 && Math.abs(few.reduce((a, l) => a + l.dur, 0) - 15) < 0.01, 'Obergrenze der Stufenzahl: zusammengefasst, Dauer bleibt');
  ok(o2Levels(pts, null).length === 0 && o2Levels([], track).length === 0, 'ohne Bahn oder ohne Punkte keine Übergabe');
  const url = o2Link(lv, '2026-017 · HB-QWZ · 2026-10-06');
  const back = JSON.parse(Buffer.from(url.split('#i.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  ok(url.startsWith('https://o2.wicki.aero/#i.') && back.v === 1 && back.s === 1 && back.t === '2026-017 · HB-QWZ · 2026-10-06' && back.l.length === lv.length && back.l[0][0] === lv[0].alt && back.c === undefined, 'Übergabe-Link: Titel, Stufen, Kennzeichen «Verlauf»');
  // 0.12.17d: das Briefing vergibt den Kurzcode der O2-Berechnung
  const id = o2NewId(), dec = (u) => JSON.parse(Buffer.from(u.split('#i.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  ok(O2_ID_RE.test(id) && o2NewId() !== id && dec(o2Link(lv, 'x', id)).c === id && dec(o2Link(lv, 'x', 'abc')).c === undefined && o2CalcLink(id) === 'https://o2.wicki.aero/#' + id, 'Kurzcode: Form wie in der O2-Planung, im Übergabe-Link, Link auf die Berechnung');
  const S2 = mergeSettings({}); const src = newBriefing(S2); src.profile = { points: [], stages: [], o2: { id, sent: 1 } };
  ok(duplicateBriefing(src, S2).profile.o2 === undefined && src.profile.o2.id === id, 'Kopie eines Briefings: eigene O2-Berechnung (Kurzcode nicht übernommen)');
}

// ---- 0.14.0: Ist-Trajektorie – Punkte aus dem analyze-GeoJSON, geplante Bahnen, Soll/Ist
{
  const t0 = Date.UTC(2026, 7, 29, 6, 0);
  const iso = (ms) => new Date(ms).toISOString();
  const geo = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { kind: 'track', segment: 1, times: [iso(t0), iso(t0 + 1800000), iso(t0 + 3600000)], vs_ms: [0.5, 0.2, -0.1], gs_ms: [8, 9, 10] }, geometry: { type: 'LineString', coordinates: [[8, 47, 500], [8.1, 47.01, 900], [8.2, 47.02, 1200]] } },
    { type: 'Feature', properties: { kind: 'track', segment: 2, restart: true, times: [iso(t0 + 3660000), iso(t0 + 7200000)], vs_ms: [0, 0], gs_ms: [10, 10] }, geometry: { type: 'LineString', coordinates: [[8.21, 47.02, 1200], [8.4, 47.04, 800]] } },
    { type: 'Feature', properties: { kind: 'takeoff', name: 'Start', time: iso(t0) }, geometry: { type: 'Point', coordinates: [8, 47, 500] } },
    { type: 'Feature', properties: { kind: 'landing', name: 'Landung', time: iso(t0 + 7200000) }, geometry: { type: 'Point', coordinates: [8.4, 47.04, 800] } },
  ] };
  const pts = actualPoints(geo), wp = actualWaypoints(geo);
  ok(pts.length === 5 && pts[0].ms === t0 && pts[4].lon === 8.4 && pts[1].alt === 900 && pts[1].vs === 0.2 && wp.takeoff.lat === 47 && wp.landing.ms === t0 + 7200000, 'Ist-Trajektorie: Punkte beider Segmente nach Zeit, Start/Landung aus den Punkt-Features');
  const mid = posAt(pts, t0 + 900000);
  ok(Math.abs(mid.lon - 8.05) < 1e-9 && Math.abs(mid.lat - 47.005) < 1e-9 && posAt(pts, t0 - 1) === null && posAt(pts, t0 + 7200001) === null, 'posAt: linear zwischen den Stützpunkten, null ausserhalb');
  ok(hourlyPoints(pts).length === 2 && Math.abs(hourlyPoints(pts)[0].lon - 8.2) < 1e-9, 'Stundenpunkte auf der Ist-Bahn');
  // geplante Bahnen: Profilbahn vor den Niveaus; Niveau ohne Punkte / belowGround ausgelassen
  const b = { site: { lat: 47, lon: 8 }, profile: { data: { track: { points: [{ ms: t0, lat: 47, lon: 8, alt: 500 }, { ms: t0 + 7200000, lat: 47.04, lon: 8.36, alt: 900 }] } } },
    panels: { 'B.traj': { content: { auto: { data: { tracks: [{ label: '1000 ft AGL', altFt: 1000, altM: 305, points: [{ ms: t0, lat: 47, lon: 8 }, { ms: t0 + 7200000, lat: 47.1, lon: 8.3 }], end: { lat: 47.1, lon: 8.3 } }, { label: 'SFC', belowGround: true, points: [{ ms: t0, lat: 47, lon: 8 }], hourly: [] }] } } } } } };
  const pl = plannedTracks(b);
  ok(pl.length === 2 && pl[0].kind === 'profile' && pl[1].label === '1000 ft AGL' && pl[1].end.lat === 47.1, 'plannedTracks: Profilbahn zuerst, Niveaus aus B.traj, belowGround ausgelassen');
  const c = compareTrack(pl[0], pts, { site: b.site });
  ok(c.n === 2 && c.hours[0].h === 1 && c.hours[1].h === 2 && c.endKm < 4 && c.endKm > 2 && c.coverage === 1 && c.brgErr != null && Math.abs(c.brgErr) < 5, 'compareTrack: zwei Stundenwerte, Endpunktabstand ≈ 3 km (0.04° Länge), Richtungsfehler klein, Abdeckung 1');
  const all = compareAll(b, pts);
  ok(all.rows.length === 2 && all.best.track.kind === 'profile' && all.rows[1].cmp.endKm > all.rows[0].cmp.endKm, 'compareAll: Profilbahn passt besser als das Niveau (kleinerer Endpunktabstand)');
  // Seite: Ist nördlich einer nach Osten laufenden Soll-Bahn = links
  const east = { points: [0, 1, 2].map((h) => ({ ms: t0 + h * 3600000, lat: 47, lon: 8 + 0.2 * h })), end: { lat: 47, lon: 8.4 } };
  const north = [0, 1, 2].map((h) => ({ ms: t0 + h * 3600000, lat: 47 + 0.05 * h, lon: 8 + 0.2 * h }));
  const cs = compareTrack(east, north, { site: { lat: 47, lon: 8 } });
  ok(cs.hours.every((x) => x.side === 'L') && cs.brgErr < 0 && Math.abs(cs.meanDevKm - (5.56 + 11.12) / 2) < 0.2, 'Seite der Abweichung: nördlich der Ostbahn = links, Richtungsfehler negativ');
}

// ---- 0.14.1: NOTAM-Abfragepunkte für den GitHub-Workflow (wie die App sie bildet)
{
  console.log('\n# NOTAM-Abfragepunkte (fetch-notam)');
  ok(notamKey(47.3812, 8.5401, 25) === '47.38_8.54_25' && notamKey(-33.9, -70.65, 50) === '-33.90_-70.65_50', 'Schlüssel = Breite/Länge auf 0.01° und Radius NM');
  ok(notamCover(47, 8, 100).length === 1 && notamCover(47, 8, 150).length === 7, 'Kreise: bis 100 NM einer, darüber sieben (wie hexCover in der App)');
  const b = { site: { lat: 47.3, lon: 8.4 }, landing: { lat: 47.5, lon: 9.0 }, panels: { 'B.traj': { content: { auto: { data: { tracks: [{ end: { lat: 47.4, lon: 8.8 } }, { end: null }] } } } } } };
  const pts = notamPointsOfBriefing(b, 30);
  ok(pts.length === 3 && pts.every((p) => p.nm === 30) && pts[0].lat === 47.3 && pts[2].lon === 9.0, 'Strecke: Startort, Bahn-Endpunkt, Landeraum mit dem Radius aus den Einstellungen');
  ok(notamPointsOfBriefing({ ...b, notamMode: 'places', notamPlaces: [{ lat: 46.9, lon: 7.4, km: 200 }, { lat: 46.0, lon: 8.9, km: 50 }] }).length === 8, 'Orte: 200 km (108 NM) → sieben Kreise, 50 km → einer');
  ok(notamPointsOfBriefing({}, 25).length === 0 && notamPointsOfBriefing({ site: { lat: 47.3, lon: 8.4 } }, 150).length === 7, 'ohne Startort keine Punkte; Radius über 100 NM wird in Kreise zerlegt');
}

console.log(`\n${n - fails}/${n} Tests bestanden`);
process.exit(fails ? 1 : 0);

