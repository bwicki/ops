/* Fahrtbriefing — Beschaffung der automatischen Panel-Inhalte.
 *
 * Jede Funktion liefert einen Schnappschuss { kind, stand, model, source, data,
 * text }, der im Briefing gespeichert wird (Druck, Leselink, KI). Die
 * Modellprognose wird je Briefing/Modell nur einmal geholt (Memo im ctx).
 */
import * as OM from './openmeteo.js';
import { tracks } from './traj.js';
import { sunFor, scheduleFor } from '../model.js';
import { thermalHours, thermalSummary, classOf, THERMAL_DEFAULTS } from '../calc/thermal.js';
import { normalizeAirspace, analyzeAirspaces, thinRing, siteWarnings } from '../calc/airspace.js';
import { isoDate, hhmm, fmtDur } from '../calc/time.js';
import { distKm, bearing, icao, setDeRings, setCountryRings } from '../calc/geo.js';
import { t, getLang } from '../i18n.js';
import { dataFile, placeName } from '../net.js';
import { coverPoints } from '../calc/stageplan.js';

const memo = new Map();
const shareTok = (ctx) => ctx.shared?.token;

/** Prognose für das Briefing (Fenster Start−6 h … Landung+6 h). */
export async function getForecast(ctx, b, modelOverride, opts = {}) {
  const model = modelOverride ?? b.meteo?.model ?? '';
  const landing = b.time.startMs + (b.intent.durationMin || 0) * 60000;
  const from = b.time.startMs - 6 * 3600000, to = Math.max(landing, b.time.startMs + 3 * 3600000) + 6 * 3600000;
  const startDate = isoDate('UTC', Math.min(from, Date.now())), endDate = isoDate('UTC', to);
  const key = `${b.site.lat?.toFixed(3)},${b.site.lon?.toFixed(3)}|${model}|${startDate}|${endDate}|${b.meteo?.topHpa || 500}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < 15 * 60000) return hit.p;
  const hours = (b.time.startMs - Date.now()) / 3600000;
  if (model && !opts.allowShort && OM.modelHours(model) < hours + (b.intent.durationMin || 0) / 60) throw new Error(t('auto_horizon', { m: OM.modelName(model), h: OM.modelHours(model) }));
  const fetcher = (query) => ctx.store.data('om', { query }, shareTok(ctx));
  const p = OM.forecast(fetcher, b.site.lat, b.site.lon, { model, topHpa: b.meteo?.topHpa || 500, startDate, endDate });
  memo.set(key, { p, at: Date.now() });
  p.catch(() => memo.delete(key));
  return p;
}
export const clearMemo = () => memo.clear();
/** Prognose an einem beliebigen Ort (für die Bahn der Gasfahrt: Wegpunkte), gleiches Fenster und Modell wie am Startort. */
export async function getForecastAt(ctx, b, lat, lon, modelOverride) {
  const model = modelOverride ?? b.meteo?.model ?? '';
  const landing = b.time.startMs + (b.intent.durationMin || 0) * 60000;
  const from = b.time.startMs - 6 * 3600000, to = Math.max(landing, b.time.startMs + 3 * 3600000) + 6 * 3600000;
  const startDate = isoDate('UTC', Math.min(from, Date.now())), endDate = isoDate('UTC', to);
  const key = `${(+lat).toFixed(2)},${(+lon).toFixed(2)}|${model}|${startDate}|${endDate}|${b.meteo?.topHpa || 500}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < 15 * 60000) return hit.p;
  const fetcher = (query) => ctx.store.data('om', { query }, shareTok(ctx));
  const p = OM.forecast(fetcher, lat, lon, { model, topHpa: b.meteo?.topHpa || 500, startDate, endDate });
  memo.set(key, { p, at: Date.now() });
  p.catch(() => memo.delete(key));
  return p;
}

const standOf = (j, b) => ({ stand: Date.now(), model: j._model, modelName: OM.modelName(j._model) + (j._levelModel ? ` (${t('auto_levelsFrom')} ${OM.modelName(j._levelModel)})` : '') + (j._filled?.length ? ` (${t('auto_filledFrom', { v: j._filled.map((k) => ({ boundary_layer_height: t('auto_pbl'), visibility: t('auto_vis'), freezing_level_height: t('auto_fzl'), cape: 'CAPE' })[k] || k).join(', ') })})` : ''), source: 'Open-Meteo', fetched: j._fetched, elevModel: j.elevation });   // 0.12.14: Ersatzmodell für Druckflächen
const hoursAhead = (b) => (b.time.startMs + (b.intent.durationMin || 0) * 60000 - Date.now()) / 3600000;
const lightFn = (b, ctx) => { const sun = sunFor(b, ctx.settings, ctx.racTable); return (ms) => (sun ? ms >= sun.official.bcmt - 1800000 && ms <= sun.official.ecet + 1800000 : true); };
/** Ampel-Kriterium «Tageslicht»: bei zugelassener Nachtfahrt (NVFR) entfällt es (0.12.3); die Nachtkennzeichnung im Meteogramm bleibt. */
const lightForRating = (b, light) => (b.flight?.nvfr ? () => true : light);

/** Meteogramm: Stundenwerte Start−3 h … Landung+3 h mit Ampel. */
export async function meteogram(ctx, b) {
  const j = await getForecast(ctx, b);
  const landing = b.time.startMs + (b.intent.durationMin || 0) * 60000;
  const idx = OM.window(j, b.time.startMs - 6 * 3600000, Math.max(landing, b.time.startMs + 2 * 3600000) + 6 * 3600000);
  if (!idx.length) throw new Error(t('auto_noHours'));
  const light = lightFn(b, ctx);
  const lim = ctx.settings.flyLimits;
  const lightOk = lightForRating(b, light);
  const recs = idx.map((i) => { const r = OM.rec(j, i); const fr = OM.flyRating(r, lightOk(r.ms), lim, getLang()); return { ...r, night: !light(r.ms), fog: OM.fogRisk(r).level, baseFt: OM.cloudBaseFt(r), fly: fr.level, why: fr.why }; });
  const z = b.site.tz || 'Europe/Zurich';
  const text = recs.map((r) => `${hhmm(z, r.ms)} T ${r.temp?.toFixed(0)}°/Td ${r.dew?.toFixed(0)}° Wind ${r.d10 != null ? Math.round(r.d10).toString().padStart(3, '0') : '–'}/${Math.round((r.w10 || 0) * OM.MS_TO_KT)}G${Math.round((r.gust || 0) * OM.MS_TO_KT)} kt Wolken ${r.cloud ?? '–'}% RR ${r.precip ?? 0} mm CAPE ${r.cape ?? '–'} → ${['nein', 'marginal', 'fahrbar'][r.fly] || '–'}${r.why?.length ? ' (' + r.why.join(', ') + ')' : ''}`).join('\n');
  return { kind: 'meteogram', sourceUrl: 'https://open-meteo.com/', ...standOf(j, b), data: { recs, fromMs: b.time.startMs, toMs: landing }, text };
}

/** Thermik: Tagesgang des Starttags (Sonnenaufgang−2 h … Sonnenuntergang+2 h) aus Strahlung und Grenzschicht. */
export async function thermal(ctx, b) {
  const j = await getForecast(ctx, b);
  const sun = sunFor(b, ctx.settings, ctx.racTable);
  const from = (sun?.official?.bcmt || b.time.startMs - 6 * 3600000) - 2 * 3600000, to = (sun?.official?.ecet || b.time.startMs + 10 * 3600000) + 2 * 3600000;
  const idx = OM.window(j, from, to);
  if (!idx.length) throw new Error(t('auto_noHours'));
  const light = lightFn(b, ctx);
  const recs = idx.map((i) => ({ ...OM.rec(j, i) })).map((r) => ({ ...r, night: !light(r.ms) }));
  const th = { ...THERMAL_DEFAULTS, ...(ctx.settings.thermalLimits || {}) };
  const hours = thermalHours(recs, th);
  const landing = b.time.startMs + (b.intent.durationMin || 0) * 60000;
  const sum = thermalSummary(hours, th);
  const z = b.site.tz || 'Europe/Zurich';
  const inWin = hours.filter((x) => x.ms >= b.time.startMs - 1800000 && x.ms <= landing);
  const winMax = inWin.reduce((a, x) => Math.max(a, x.wstar), 0);
  const text = `${t('th_onset')}: ${sum.onsetMs ? hhmm(z, sum.onsetMs) : '–'} · ${t('th_peak')}: ${sum.peak ? `${hhmm(z, sum.peak.ms)} w* ${sum.peak.wstar} m/s (${t('th_' + sum.peak.klass)})` : '–'} · ${t('th_end')}: ${sum.endMs ? hhmm(z, sum.endMs) : '–'} · ${t('th_window')}: ${t('th_' + classOf(winMax, th))} (max w* ${winMax} m/s)\n` + hours.map((x) => `${hhmm(z, x.ms)} ${x.rad} W/m² zi ${x.pbl != null ? Math.round(x.pbl) : '–'} m w* ${x.wstar} ${t('th_' + x.klass)}`).join('\n');
  return { kind: 'thermal', sourceUrl: 'https://open-meteo.com/', ...standOf(j, b), data: { hours, fromMs: b.time.startMs, toMs: landing, onsetMs: sum.onsetMs, endMs: sum.endMs, peak: sum.peak, winMax, winClass: classOf(winMax, th), limits: th }, text };
}

/** Start-Ampel für den Ablauf: schlechteste Stundenampel im Fahrtfenster (Start … Landung). */
export async function startAmpel(ctx, b) {
  const j = await getForecast(ctx, b);
  const landing = b.time.startMs + (b.intent.durationMin || 0) * 60000;
  const idx = OM.window(j, b.time.startMs - 1800000, Math.max(landing, b.time.startMs + 3600000));
  if (!idx.length) throw new Error(t('auto_noHours'));
  const light = lightFn(b, ctx);
  const lim = ctx.settings.flyLimits;
  const lightOk = lightForRating(b, light);
  const recs = idx.map((i) => { const r = OM.rec(j, i); const fr = OM.flyRating(r, lightOk(r.ms), lim, getLang()); return { ms: r.ms, fly: fr.level, why: fr.why, w10: r.w10, gust: r.gust, precip: r.precip, cloud: r.cloud }; });
  const level = Math.min(...recs.map((r) => r.fly ?? 2));
  const why = [...new Set(recs.filter((r) => r.fly === level).flatMap((r) => r.why || []))].slice(0, 4);
  return { level, why, recs, ...standOf(j, b) };
}

/** Trajektorien-Vorschau für den Ablauf: wenige Niveaus (z. B. Min/Max der Fahrtabsicht), ohne Speichern. */
export async function quickTraj(ctx, b, levels) {
  const j = await getForecast(ctx, b);
  const durationMin = b.intent.durationMin || ctx.settings.trajDefaults?.[b.balloon.type] || 120;
  const elev = b.site.elev ?? j.elevation ?? 0;
  const trs = tracks(j, { lat: b.site.lat, lon: b.site.lon, elev, startMs: b.time.startMs, durationMin, levels, stepMin: ctx.settings.trajDefaults?.stepMin || 10 });
  return { tracks: trs, durationMin, ...standOf(j, b) };
}

/** Windprofil zur Startzeit und stündlich bis zur Landung. */
export async function wind(ctx, b) {
  const j = await getForecast(ctx, b);
  const landing = b.time.startMs + (b.intent.durationMin || 0) * 60000;
  const idx = OM.window(j, b.time.startMs, Math.max(landing, b.time.startMs + 3600000));
  if (!idx.length) throw new Error(t('auto_noHours'));
  const elev = b.site.elev ?? j.elevation;
  const hours = idx.map((i) => ({ ms: j.hourly.time[i] * 1000, profile: OM.profile(j, i, elev).map((l) => ({ label: l.label, hPa: l.hPa, ft: l.ft, m: Math.round(l.m), spd: l.spd, dir: l.dir, temp: l.temp })), pbl: j.hourly.boundary_layer_height?.[i] ?? null, fzl: j.hourly.freezing_level_height?.[i] ?? null }));
  const top = (b.intent.altMaxFt || 6000) + 3000;
  for (const h of hours) h.profile = h.profile.filter((l) => l.ft <= Math.max(top, 8000) + 2000);
  const z = b.site.tz || 'Europe/Zurich';
  // 0.12.14: Modellvergleich zur Startzeit (bis 2 weitere Modellfamilien) und Ensemble-Spannweite
  const compare = await modelCompare(ctx, b, j, hours[0], elev).catch((e) => ({ error: e.message, models: [] }));
  const ensemble = await ensembleSpread(ctx, b, elev).catch((e) => ({ error: e.message }));
  const text = hours.map((h) => `${hhmm(z, h.ms)} LT: ` + h.profile.slice().reverse().map((l) => `${l.ft} ft ${l.dir != null ? Math.round(l.dir).toString().padStart(3, '0') : '–'}/${Math.round(l.spd * OM.MS_TO_KT)} kt`).join(' · ')).join('\n')
    + (compare?.rows?.length ? `\n${t('auto_modelCompare')} ${hhmm(z, hours[0].ms)} LT: ` + compare.rows.filter((r) => r.spreadDir != null).map((r) => `${r.ft} ft: ${compare.models.map((m, k) => `${m.name} ${r.cells[k] ? `${String(Math.round(r.cells[k].dir)).padStart(3, '0')}/${Math.round(r.cells[k].spd * OM.MS_TO_KT)}` : '–'}`).join(', ')} (Δ ${r.spreadDir}°, ${Math.round(r.spdMin * OM.MS_TO_KT)}–${Math.round(r.spdMax * OM.MS_TO_KT)} kt)`).join(' · ') : '')
    + (ensemble?.rows?.length ? `\n${t('auto_ensemble')} ${ensemble.label}: ` + ensemble.rows.map((r) => `${r.label}: ${Math.round(r.spd[0] * OM.MS_TO_KT)}–${Math.round(r.spd[1] * OM.MS_TO_KT)}–${Math.round(r.spd[2] * OM.MS_TO_KT)} kt, ${String(Math.round(r.dirMean)).padStart(3, '0')}° ±${r.dirSpread}°`).join(' · ') : '');
  return { kind: 'wind', sourceUrl: 'https://open-meteo.com/', ...standOf(j, b), data: { hours, elev, compare, ensemble }, text };
}
/** 0.12.14: Windprofil zur Startzeit aus weiteren Modellen, auf die Höhen des Hauptprofils interpoliert; Spannweite je Niveau. */
async function modelCompare(ctx, b, j, hour0, elev) {
  const main = j._levelModel || j._model || '';
  const keys = OM.compareModels(main, hoursAhead(b), 2);
  const models = [{ key: main, name: OM.modelName(main) }];
  const profs = [hour0.profile];
  for (const k of keys) {
    try { const jj = await getForecast(ctx, b, k, { allowShort: true }); const i = OM.indexAt(jj, hour0.ms); if (i < 0) continue; models.push({ key: k, name: OM.modelName(k) }); profs.push(OM.profile(jj, i, elev)); }
    catch (e) { console.warn('compare', k, e.message); }
  }
  if (profs.length < 2) return { models, rows: [] };
  const angDiff = (a, c) => Math.abs(((a - c + 540) % 360) - 180);
  const rows = hour0.profile.map((l) => {
    const cells = profs.map((pr, k) => { if (k === 0) return { dir: l.dir, spd: l.spd }; const w = OM.windAt(pr, l.m); if (!w) return null; const ds = OM.uvToDirSpd(w.u, w.v); return { dir: ds.dir, spd: ds.spd }; });
    const ok = cells.filter(Boolean);
    const dirs = ok.map((c) => c.dir).filter((v) => v != null), spds = ok.map((c) => c.spd);
    let spreadDir = null; for (let a = 0; a < dirs.length; a++) for (let c = a + 1; c < dirs.length; c++) spreadDir = Math.max(spreadDir ?? 0, angDiff(dirs[a], dirs[c]));
    return { label: l.label, ft: l.ft, cells, spreadDir: spreadDir != null ? Math.round(spreadDir) : null, spdMin: Math.min(...spds), spdMax: Math.max(...spds) };
  });
  return { models, atMs: hour0.ms, rows };
}
/** 0.12.14: Ensemble-Spannweite am Startort – Bodenschicht (10–180 m AGL) aus ICON-D2-EPS (≤ 46 h) bzw. ICON-EU-EPS, Druckflächen aus ECMWF ENS (51 Member);
 * je Niveau p10/p50/p90 der Geschwindigkeit und mittlere Richtung ± Streuung (p90 der Abweichung), zur Startzeit und zur Landung. */
async function ensembleSpread(ctx, b, elev) {
  const landing = b.time.startMs + (b.intent.durationMin || 0) * 60000;
  const startDate = isoDate('UTC', Math.min(b.time.startMs, Date.now())), endDate = isoDate('UTC', Math.max(landing, b.time.startMs + 3600000));
  const ha = hoursAhead(b);
  const sfcModel = ha <= 42 ? 'icon_d2_eps' : ha <= 114 ? 'icon_eu_eps' : null;
  const top = (b.intent.altMaxFt || 6000) + 3000;
  const lv = [['10m', 10, null], ['80m', 80, null], ['180m', 180, null], ['925hPa', null, 925], ['850hPa', null, 850], ['700hPa', null, 700]].filter(([, agl, hpa]) => (agl != null ? ((elev || 0) + agl) * OM.M_TO_FT : OM.stdHeight(hpa) * OM.M_TO_FT) <= Math.max(top, 8000) + 2000);
  const fetchEns = async (model, vars) => {
    const q = new URLSearchParams({ latitude: (+b.site.lat).toFixed(4), longitude: (+b.site.lon).toFixed(4), hourly: vars.join(','), models: model, wind_speed_unit: 'ms', timeformat: 'unixtime', timezone: 'UTC', start_date: startDate, end_date: endDate });
    const j = await ctx.store.data('om', { query: q.toString(), api: 'ensemble' }, shareTok(ctx));
    if (!j || j.error || !j.hourly?.time) throw new Error(j?.reason || 'ensemble');
    return j;
  };
  const sfcVars = lv.filter(([, agl]) => agl != null).flatMap(([k]) => [`wind_speed_${k}`, `wind_direction_${k}`]);
  const lvlVars = lv.filter(([, , hpa]) => hpa != null).flatMap(([k]) => [`wind_speed_${k}`, `wind_direction_${k}`]);
  const [js, jl] = await Promise.all([sfcModel && sfcVars.length ? fetchEns(sfcModel, sfcVars).catch(() => null) : null, lvlVars.length ? fetchEns('ecmwf_ifs025', lvlVars).catch(() => null) : null]);
  const stats = (j, key, ms) => {
    if (!j) return null;
    const i = OM.indexAt(j, ms); if (i < 0) return null;
    const H = j.hourly; const sp = [], di = [];
    for (const k of Object.keys(H)) { const m = new RegExp(`^wind_speed_${key}(_member\\d+)?$`).exec(k); if (!m) continue; const v = H[k][i], d = H[`wind_direction_${key}${m[1] || ''}`]?.[i]; if (v == null || d == null) continue; sp.push(v); di.push(d); }
    if (sp.length < 3) return null;
    sp.sort((a, c) => a - c);
    const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.round((arr.length - 1) * p)))];
    const u = di.reduce((a, d) => a + Math.sin(d * Math.PI / 180), 0), v = di.reduce((a, d) => a + Math.cos(d * Math.PI / 180), 0);
    const mean = (Math.atan2(u, v) * 180 / Math.PI + 360) % 360;
    const dev = di.map((d) => Math.abs(((d - mean + 540) % 360) - 180)).sort((a, c) => a - c);
    return { n: sp.length, spd: [pct(sp, .1), pct(sp, .5), pct(sp, .9)], dirMean: mean, dirSpread: Math.round(pct(dev, .9)) };
  };
  const rows = [];
  for (const [k, agl, hpa] of lv) {
    const j = agl != null ? js : jl; if (!j) continue;
    const s0 = stats(j, k, b.time.startMs), s1 = stats(j, k, landing);
    if (!s0 && !s1) continue;
    const ft = Math.round((agl != null ? (elev || 0) + agl : OM.stdHeight(hpa)) * OM.M_TO_FT);
    rows.push({ label: agl != null ? `${agl} m GND` : `${hpa} hPa`, ft, model: agl != null ? sfcModel : 'ecmwf_ifs025', ...(s0 || s1), start: s0, land: s1 });
  }
  rows.sort((a, c) => c.ft - a.ft);
  const names = { icon_d2_eps: 'ICON-D2-EPS (20)', icon_eu_eps: 'ICON-EU-EPS (40)', ecmwf_ifs025: 'ECMWF ENS (51)' };
  return { rows, label: [...new Set(rows.map((r) => names[r.model]))].join(' + '), sfcModel, startMs: b.time.startMs, landMs: landing };
}

/** Stüve zur Startzeit (volles Profil bis topHpa). */
export async function temps(ctx, b) {
  const j = await getForecast(ctx, b);
  const atMs = b.stagePlan && !b.stagePlan.start ? b.stagePlan.msMid : b.time.startMs;   // Etappen-Briefing: Profil zur Etappenmitte (0.12.5); Startetappe: zur Startzeit
  const i = OM.indexAt(j, atMs);
  if (i < 0) throw new Error(t('auto_noHours'));
  const elev = b.site.elev ?? j.elevation;
  const prof = OM.profile(j, i, elev).map((l) => ({ label: l.label, hPa: l.hPa, ft: l.ft, m: Math.round(l.m), spd: l.spd, dir: l.dir, temp: l.temp, dew: l.dew, rh: l.rh }));
  const pbl = j.hourly.boundary_layer_height?.[i] ?? null, fzl = j.hourly.freezing_level_height?.[i] ?? null;
  // Inversionen: Temperatur nimmt mit der Höhe zu
  const inv = [];
  const asc = prof.filter((l) => l.temp != null).sort((a, b2) => a.m - b2.m);
  for (let k = 1; k < asc.length; k++) if (asc[k].temp > asc[k - 1].temp + 0.2) inv.push({ fromFt: asc[k - 1].ft, toFt: asc[k].ft, dT: +(asc[k].temp - asc[k - 1].temp).toFixed(1) });
  const text = `${t('auto_profileAt')} ${hhmm(b.site.tz || 'Europe/Zurich', atMs)} LT: ` + asc.map((l) => `${l.ft} ft ${l.temp?.toFixed(1)}°/${l.dew?.toFixed(1)}° ${l.dir != null ? Math.round(l.dir).toString().padStart(3, '0') : '–'}/${Math.round(l.spd * OM.MS_TO_KT)} kt`).join(' · ') + (inv.length ? ` · Inversion: ${inv.map((x) => `${x.fromFt}–${x.toFt} ft (+${x.dT} K)`).join(', ')}` : '') + (pbl != null ? ` · Grenzschicht ${Math.round(pbl * OM.M_TO_FT)} ft AGL` : '') + (fzl != null ? ` · 0 °C ${Math.round(fzl * OM.M_TO_FT)} ft` : '');
  // Letzte Messung der nächsten Radiosondenstation (Payerne 06610 u. a.) – Server-Modus
  let obs = null, obsErr = '';
  if (ctx.store.mode === 'remote') {
    const st = nearestSounding(b.site.lat, b.site.lon);
    try {
      const so = await ctx.store.data('sounding', { stn: st.id }, shareTok(ctx));
      const lv = (so.levels || []).filter((l) => l.hPa >= (ctx.settings.meteoDefaults?.topHpa || 500) - 50).map((l) => ({ label: `${Math.round(l.hPa)} hPa`, hPa: l.hPa, ft: Math.round(l.m * OM.M_TO_FT), m: l.m, temp: l.temp, dew: l.dew, rh: l.rh, dir: l.dir, spd: l.kt / OM.MS_TO_KT }));
      obs = { station: st, time: so.time, title: so.title, levels: lv, url: so.url, source: so.source };
    } catch (e) { obsErr = e.message; }
  }
  const obsText = obs ? `\n${t('auto_sounding')} ${obs.station.name} ${obs.time.slice(0, 13).replace('T', ' ')}Z: ` + obs.levels.filter((l) => [1000, 925, 850, 700, 500].includes(Math.round(l.hPa))).map((l) => `${Math.round(l.hPa)} hPa ${l.ft} ft ${l.temp}°/${l.dew}° ${String(l.dir).padStart(3, '0')}/${Math.round(l.spd * OM.MS_TO_KT)} kt`).join(' · ') : '';
  // SondeHub: nächste Radiosonde der letzten 12 h im Umkreis (Amateur-Empfang, Live-Telemetrie) – Server-Modus
  let sonde = null;
  if (ctx.store.mode === 'remote') {
    try {
      const sj = await ctx.store.data('sondes', { lat: b.site.lat.toFixed(3), lon: b.site.lon.toFixed(3), km: ctx.settings.sondeKm || 150, h: 12 }, shareTok(ctx));
      const cand = (sj.sondes || []).filter((x) => x.alt > 3000)[0] || (sj.sondes || [])[0];
      if (cand) { const so = await ctx.store.data('sonde', { serial: cand.serial }, shareTok(ctx)); if (so.levels?.length >= 5) sonde = { ...so, km: cand.km, brg: bearing(b.site.lat, b.site.lon, so.lat, so.lon), place: so.lat != null ? await placeName(so.lat, so.lon, b.site.country, getLang()) : '', levels: so.levels.map((l) => ({ label: `${l.hPa} hPa`, hPa: l.hPa, ft: l.ft, m: l.m, temp: l.temp, dew: l.dew, rh: l.rh, dir: l.dir, spd: l.kt != null ? l.kt / OM.MS_TO_KT : null })) }; }
    } catch { /* ohne Sonde */ }
  }
  const sondeText = sonde ? `\n${t('auto_sondehub')} ${sonde.serial}${sonde.place ? ' ' + sonde.place : ''} (${Math.round(sonde.km)} km, ${(sonde.launch || '').slice(0, 16).replace('T', ' ')}Z): ` + sonde.levels.filter((l, i, a) => i % Math.max(1, Math.floor(a.length / 8)) === 0).map((l) => `${l.ft} ft ${l.temp ?? '–'}°/${l.dew ?? '–'}° ${l.dir != null ? String(l.dir).padStart(3, '0') : '–'}/${l.spd != null ? Math.round(l.spd * OM.MS_TO_KT) : '–'} kt`).join(' · ') : '';
  return { kind: 'temps', sourceUrl: 'https://open-meteo.com/', ...standOf(j, b), data: { profile: prof, pbl, fzl, inversions: inv, elev, obs, obsErr, sonde, atMs }, text: text + obsText + sondeText };
}
/** Radiosondenstationen (WMO) – die nächste zum Startort. */
export const SOUNDING_STATIONS = [
  { id: '06610', name: 'Payerne', lat: 46.81, lon: 6.94 }, { id: '10739', name: 'Stuttgart', lat: 48.83, lon: 9.20 }, { id: '10868', name: 'München-Oberschleissheim', lat: 48.25, lon: 11.55 },
  { id: '10618', name: 'Idar-Oberstein', lat: 49.70, lon: 7.33 }, { id: '10410', name: 'Essen', lat: 51.40, lon: 6.97 }, { id: '10548', name: 'Meiningen', lat: 50.56, lon: 10.38 }, { id: '10393', name: 'Lindenberg', lat: 52.21, lon: 14.12 },
  { id: '11035', name: 'Wien', lat: 48.25, lon: 16.36 }, { id: '11120', name: 'Innsbruck', lat: 47.26, lon: 11.35 }, { id: '16080', name: 'Milano Linate', lat: 45.43, lon: 9.28 }, { id: '16044', name: 'Udine', lat: 46.04, lon: 13.19 },
  { id: '07180', name: 'Nancy-Essey', lat: 48.68, lon: 6.22 }, { id: '07481', name: 'Lyon-Satolas', lat: 45.73, lon: 5.08 }, { id: '07145', name: 'Trappes', lat: 48.77, lon: 2.01 }, { id: '06260', name: 'De Bilt', lat: 52.10, lon: 5.18 }, { id: '11520', name: 'Praha-Libus', lat: 50.01, lon: 14.45 },
];
export function nearestSounding(lat, lon) {
  return SOUNDING_STATIONS.map((s) => ({ ...s, d: distKm(lat, lon, s.lat, s.lon) })).sort((a, b) => a.d - b.d)[0];
}

/** Trajektorien je Niveau. */
export async function traj(ctx, b) {
  const j = await getForecast(ctx, b);
  const tr = b.traj || {};
  const durationMin = tr.durationMin || ctx.settings.trajDefaults?.[b.balloon.type] || 120;
  const startMs = b.time.startMs + (tr.startOffsetMin || 0) * 60000;
  const levels = (tr.levels && tr.levels.length ? tr.levels : b.intent.levels) || ['SFC'];
  const elev = b.site.elev ?? j.elevation ?? 0;
  const trs = tracks(j, { lat: b.site.lat, lon: b.site.lon, elev, startMs, durationMin, levels, stepMin: ctx.settings.trajDefaults?.stepMin || 10 });
  const z = b.site.tz || 'Europe/Zurich';
  const text = trs.map((x) => `${x.label} (${x.altFt} ft): ` + x.hourly.map((h) => `${hhmm(z, h.ms)} ${h.km.toFixed(1)} km/${Math.round(h.brg).toString().padStart(3, '0')}° ${h.icao}`).join(' → ') + (x.ok ? '' : ` (${t('auto_trajCut')})`)).join('\n');
  const slim = trs.map((x) => ({ label: x.label, altFt: x.altFt, altM: Math.round(x.altM), ok: x.ok, points: x.points.filter((_, k) => k % 3 === 0 || k === x.points.length - 1).map((p) => ({ ms: p.ms, lat: +p.lat.toFixed(4), lon: +p.lon.toFixed(4) })), hourly: x.hourly.map((h) => ({ ...h, lat: +h.lat.toFixed(4), lon: +h.lon.toFixed(4), km: +h.km.toFixed(1), brg: Math.round(h.brg), spdKt: Math.round(h.spdKt), dir: Math.round(h.dir) })), end: { ...x.end, lat: +x.end.lat.toFixed(4), lon: +x.end.lon.toFixed(4), km: +x.end.km.toFixed(1), brg: Math.round(x.end.brg) } }));
  // 0.12.14: Spannweite – dieselben Bahnen mit bis zu zwei weiteren Modellfamilien; je Niveau der grösste Abstand der Endpunkte
  const spread = { models: [], ends: {} };
  try {
    const main = j._levelModel || j._model || '';
    for (const k of OM.compareModels(main, hoursAhead(b), 2)) {
      try {
        const jj = await getForecast(ctx, b, k, { allowShort: true });
        const alt = tracks(jj, { lat: b.site.lat, lon: b.site.lon, elev, startMs, durationMin, levels, stepMin: ctx.settings.trajDefaults?.stepMin || 10 });
        spread.models.push({ key: k, name: OM.modelName(k), tracks: alt.filter((x) => !x.belowGround && x.points?.length).map((x) => ({ label: x.label, points: x.points.filter((_, i) => i % 6 === 0 || i === x.points.length - 1).map((p) => ({ lat: +p.lat.toFixed(4), lon: +p.lon.toFixed(4) })), end: { lat: +x.end.lat.toFixed(4), lon: +x.end.lon.toFixed(4), km: +x.end.km.toFixed(1), brg: Math.round(x.end.brg) } })) });
      } catch (e) { console.warn('traj compare', k, e.message); }
    }
    for (const x of slim) {
      const ends = [x.end, ...spread.models.map((m) => m.tracks.find((y) => y.label === x.label)?.end).filter(Boolean)];
      let maxKm = 0; for (let a = 0; a < ends.length; a++) for (let c = a + 1; c < ends.length; c++) maxKm = Math.max(maxKm, distKm(ends[a].lat, ends[a].lon, ends[c].lat, ends[c].lon));
      spread.ends[x.label] = { n: ends.length, maxKm: +maxKm.toFixed(1) };
    }
  } catch (e) { console.warn('traj spread', e.message); }
  const spreadText = spread.models.length ? `\n${t('auto_spread')} (${spread.models.map((m) => m.name).join(', ')}): ` + slim.map((x) => `${x.label} ${spread.ends[x.label]?.maxKm ?? '–'} km`).join(' · ') : '';
  return { kind: 'traj', sourceUrl: 'https://open-meteo.com/', ...standOf(j, b), data: { tracks: slim, startMs, durationMin, levels, landing: b.landing?.lat != null ? { lat: b.landing.lat, lon: b.landing.lon, name: b.landing.name } : null, spread }, text: text + spreadText };
}

/** Ballonprognose: DWD-Gebietsvorhersage (DE, nächstes Gebiet) + eigene Stundentabelle. */
export async function balloon(ctx, b) {
  const mg = await meteogram(ctx, b);
  let dwd = null, note = '';
  try {
    const idxj = await ctx.store.data('dwd', {}, shareTok(ctx));
    const areas = Object.values(idxj.balloon || {}).filter((a) => a.station?.lat != null);
    if (areas.length) {
      const near = areas.map((a) => ({ a, d: distKm(b.site.lat, b.site.lon, a.station.lat, a.station.lon) })).sort((x, y) => x.d - y.d)[0];
      if (near.d < 40 || (b.site.country === 'DE' && near.d < 150)) {
        const file = await dataFile(String(near.a.file || `data/dwd/balloon/${near.a.id}.json`).replace(/^data\//, ''));
        dwd = { id: near.a.id, name: near.a.name, refAltFt: near.a.refAltFt, station: near.a.station, distKm: Math.round(near.d), fetched: near.a.fetched, source: near.a.source, blocks: file.blocks, text: file.text, issued: (file.text || '').match(/Vorhersage ausgegeben ([^\n]+)/)?.[1] || '' };
      } else note = t('auto_dwdFar', { km: Math.round(near.d) });
    }
  } catch (e) { note = `DWD: ${e.message}`; }
  return { kind: 'balloon', sourceUrl: 'https://www.dwd.de/DE/fachnutzer/luftfahrt/teaser/gebietsvorhersagen_ballonsport/gebietsvorhersagen_ballonsport_node.html', stand: mg.stand, model: mg.model, modelName: mg.modelName, source: dwd ? 'DWD Gebietsvorhersage Ballonsport + Open-Meteo' : 'Open-Meteo', data: { recs: mg.data.recs, fromMs: mg.data.fromMs, toMs: mg.data.toMs, dwd, note }, text: (dwd ? `DWD Gebiet ${dwd.id} ${dwd.name} (${dwd.issued}):\n${(dwd.text || '').slice(0, 4000)}\n\n` : '') + mg.text };
}

/** Punkt in Polygon (GeoJSON-Ring [lon, lat]). */
function inRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
  }
  return inside;
}
let gaforAreasP = null;
/** GAFOR-Gebiete laden (einmalig); liefert zugleich den Deutschland-Umriss für countryGuess (0.12.10). */
export function loadGaforAreas() {
  gaforAreasP = gaforAreasP || dataFile('gafor-areas.geojson', 20000).then((g) => { try { setDeRings(g.features); } catch { /* ohne Umriss */ } return g; });
  return gaforAreasP;
}
let countriesP = null;
/** 0.12.10a: Landesgrenzen (data/countries.geojson) für countryGuess laden – einmalig, beim Start. */
export function loadCountries() {
  countriesP = countriesP || dataFile('countries.geojson', 20000).then((g) => { setCountryRings(g.features); return g; });
  return countriesP;
}
export function gaforArea(lat, lon) {
  gaforAreasP = loadGaforAreas();
  return gaforAreasP.then((g) => {
    for (const f of g.features || []) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
      for (const poly of polys) if (inRing(lat, lon, poly[0])) return f.properties;
    }
    return null;
  });
}

/** Offizielle Flugwetterprognose: DE automatisch (DWD Flugwetterübersicht + GAFOR des Gebiets), sonst Einfügen. */
export async function fwp(ctx, b) {
  if (b.site.country !== 'DE') throw new Error(t('auto_fwpOnlyDe'));
  const area = await gaforArea(b.site.lat, b.site.lon);
  if (!area) throw new Error(t('auto_fwpNoArea'));
  const idx = await ctx.store.data('dwd', {}, shareTok(ctx));
  const office = Object.values(idx.overview || {}).find((o) => (o.areas || []).includes(area.id));
  const gafor = Object.values(idx.gafor || {}).find((g) => g.details?.[area.id]);
  const det = gafor?.details?.[area.id];
  const text = `${office ? office.fullText || office.text : ''}

GAFOR ${area.id} ${area.name}${gafor ? ` (${gafor.title}): ${(gafor.periods || []).map((pp, i) => `${pp} UTC ${det?.codes?.[i] || '?'}${det?.remarks?.[i] ? ' ' + det.remarks[i] : ''}`).join(' · ')}` : ''}`;
  return { kind: 'fwp', sourceUrl: 'https://www.dwd.de/DE/fachnutzer/luftfahrt/teaser/luftsportberichte/luftsportberichte_node.html', stand: Date.now(), source: 'DWD Luftsportberichte (Kopie gafor.wicki.aero)', data: { area, office: office ? { bereich: office.bereich, office: office.office, issued: office.issued, validFrom: office.validFrom, validTo: office.validTo, source: office.source, text: office.fullText || office.text } : null, gafor: gafor ? { title: gafor.title, periods: gafor.periods, codes: det?.codes, remarks: det?.remarks, source: gafor.source, issued: gafor.issued } : null }, text };
}

/** Druckdifferenz (Bise/Föhn) aus Modell-QNH an Referenzpunkten. */
export async function pdiff(ctx, b) {
  const chRegion = b.site.lat > 45.3 && b.site.lat < 48.6 && b.site.lon > 5 && b.site.lon < 11.5;
  const pairs = ctx.settings.pdiffPairs?.length ? ctx.settings.pdiffPairs : !chRegion ? [] : [
    { name: 'Genève – Güttingen (Bise)', a: { name: 'Genève', lat: 46.25, lon: 6.13 }, b: { name: 'Güttingen', lat: 47.60, lon: 9.28 }, hint: 'ΔP > +3 hPa (GE höher) → Bise', sign: 1 },
    { name: 'Zürich – Lugano (Föhn N/S)', a: { name: 'Zürich', lat: 47.38, lon: 8.57 }, b: { name: 'Lugano', lat: 46.00, lon: 8.96 }, hint: 'ΔP < −3 hPa (LUG höher = Südüberdruck) → Südföhn; > +4 → Nordföhn', sign: -1 },
  ];
  const landing = b.time.startMs + (b.intent.durationMin || 0) * 60000;
  const from = b.time.startMs - 6 * 3600000, to = Math.max(landing, b.time.startMs + 3 * 3600000) + 6 * 3600000;
  const startDate = isoDate('UTC', Math.min(from, Date.now())), endDate = isoDate('UTC', to);
  const model = b.meteo?.model || '';
  const fetchP = async (pt) => {
    const q = new URLSearchParams({ latitude: pt.lat.toFixed(3), longitude: pt.lon.toFixed(3), hourly: 'pressure_msl', timeformat: 'unixtime', timezone: 'UTC', start_date: startDate, end_date: endDate });
    if (model) q.set('models', model);
    return ctx.store.data('om', { query: q.toString() }, shareTok(ctx));
  };
  const out = [];
  if (!pairs.length) throw new Error(t('auto_noPairs'));
  for (const p of pairs) {
    const [ja, jb] = await Promise.all([fetchP(p.a), fetchP(p.b)]);
    const rows = [];
    for (let i = 0; i < ja.hourly.time.length; i++) { const ms = ja.hourly.time[i] * 1000; if (ms < from || ms > to) continue; const pa = ja.hourly.pressure_msl[i], pb = jb.hourly.pressure_msl[i]; if (pa == null || pb == null) continue; rows.push({ ms, pa, pb, d: +(pa - pb).toFixed(1) }); }
    out.push({ name: p.name, a: p.a.name, b: p.b.name, hint: p.hint, sign: p.sign ?? 0, rows });
  }
  const z = b.site.tz || 'Europe/Zurich';
  const text = out.map((p) => `${p.name}: ` + p.rows.filter((r) => r.ms >= b.time.startMs - 3600000 && r.ms <= landing + 3600000).map((r) => `${hhmm(z, r.ms)} ${r.d > 0 ? '+' : ''}${r.d} hPa`).join(', ') + ` (${p.hint})`).join('\n');
  const lim = { half: +ctx.settings.pdiffWarn?.half || 3, neg: +ctx.settings.pdiffWarn?.neg || 4 };
  return { kind: 'pdiff', sourceUrl: 'https://open-meteo.com/', stand: Date.now(), model, modelName: OM.modelName(model), source: 'Open-Meteo', data: { pairs: out, fromMs: b.time.startMs, toMs: landing, limits: lim }, text };
}

/** METAR/TAF der nächsten Plätze. */
export async function metar(ctx, b) {
  const j = await ctx.store.data('metar', { lat: b.site.lat, lon: b.site.lon, km: b.metarKm || ctx.settings.metarRadiusKm || 150, limit: ctx.settings.metarCount || 40 }, shareTok(ctx));
  const text = (j.metar || []).map((m) => `${m.icaoId} (${Math.round(m.distKm)} km): ${m.rawOb || ''}${j.taf?.[m.icaoId] ? `\nTAF ${j.taf[m.icaoId].rawTAF || ''}` : ''}`).join('\n\n');
  return { kind: 'metar', sourceUrl: 'https://aviationweather.gov/data/metar/', stand: Date.now(), source: j.source, data: { metar: j.metar || [], taf: j.taf || {}, generated: j.generated, radiusKm: b.metarKm || ctx.settings.metarRadiusKm || 150 }, text };
}

/** Beobachtungen: Wetterstationen im Umkreis (SwissMetNet, DWD/Bright Sky, EUMETNET MeteoGate) – Server-Modus. */
export async function obs(ctx, b) {
  const km = b.obsKm || ctx.settings.obsRadiusKm || 50;
  if (ctx.store.mode !== 'remote') return { kind: 'obs', stand: Date.now(), source: '', data: { stations: [], km, local: true }, text: t('auto_obsLocal') };
  const j = await ctx.store.data('stations', { lat: b.site.lat.toFixed(4), lon: b.site.lon.toFixed(4), km }, shareTok(ctx));
  const st = (j.stations || []).map((x) => ({ ...x, brg: Math.round(bearing(b.site.lat, b.site.lon, x.lat, x.lon)) }));
  const text = st.map((x) => `${x.name} (${x.km} km): ${x.dir != null ? String(x.dir).padStart(3, '0') : '–'}/${x.kt ?? '–'} kt${x.gustKt != null ? ` G${x.gustKt}` : ''} · ${x.tempC ?? '–'} °C${x.dewC != null ? `/${x.dewC}` : ''}${x.rh != null ? ` · ${x.rh} %` : ''}${x.qnh != null ? ` · ${x.qnh} hPa` : ''}${x.precipMm != null ? ` · ${x.precipMm} mm` : ''}${x.visM != null ? ` · Sicht ${x.visM >= 10000 ? '≥10 km' : Math.round(x.visM / 100) / 10 + ' km'}` : ''}`).join('\n') || t('auto_none');
  return { kind: 'obs', sourceUrl: 'https://www.meteoschweiz.admin.ch/', stand: Date.now(), source: [...new Set(st.map((x) => x.src))].join(', '), data: { stations: st, km, errors: j.errors || [], generated: j.generated }, text };
}

/** SIGMET/AIRMET in der Umgebung. */
export async function sigmet(ctx, b) {
  const j = await ctx.store.data('sigmet', { lat: b.site.lat, lon: b.site.lon }, shareTok(ctx));
  // 0.12.14: amtliche Warnungen (MeteoSchweiz/DWD) an Startort, Landeraum und Bahn-Endpunkten
  let warn = { warnings: [], errors: [] };
  try {
    const pts = [[b.site.lat, b.site.lon]];
    if (b.landing?.lat != null) pts.push([b.landing.lat, b.landing.lon]);
    for (const tr of b.panels?.['B.traj']?.content?.auto?.data?.tracks || []) if (tr.end && pts.length < 6 && !pts.some((p) => distKm(p[0], p[1], tr.end.lat, tr.end.lon) < 15)) pts.push([tr.end.lat, tr.end.lon]);
    warn = await ctx.store.data('warnings', { pts: pts.map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join(';') }, shareTok(ctx));
  } catch (e) { warn = { warnings: [], errors: [e.message === 'remote only' ? t('ac_localOnly') : e.message] }; }
  const text = ((j.sigmet || []).map((s) => s.raw || `${s.fir} ${s.hazard} ${s.validFrom}–${s.validTo}`).join('\n\n') || t('auto_none')) + ((warn.warnings || []).length ? '\n\n' + warn.warnings.map((w) => `${w.src} ${w.area}: ${w.headline} – ${w.text}`).join('\n\n') : '');
  return { kind: 'sigmet', sourceUrl: 'https://aviationweather.gov/data/sigmet/', stand: Date.now(), source: j.source, data: { list: j.sigmet || [], warnings: warn.warnings || [], warnErrors: warn.errors || [] }, text };
}

/** Kreis > 100 NM (FAA-Maximum je Abfrage) mit 7 Teilkreisen abdecken: Mitte + Sechseck. */
function hexCover(lat, lon, nm) {
  if (nm <= 100) return [{ lat, lon, nm }];
  const sub = 100, dist = Math.max(0, nm - sub * 0.55);
  const out = [{ lat, lon, nm: sub }];
  for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; out.push({ lat: lat + (dist / 60) * Math.cos(a), lon: lon + (dist / 60) * Math.sin(a) / Math.cos(lat * Math.PI / 180), nm: sub }); }
  return out;
}
/** NOTAM: Strecke (Start → Landeraum/Trajektorien-Endpunkte, Korridor) oder Umkreis um gewählte Orte; VFR-Filter. */
export async function notam(ctx, b, opts = {}) {
  const mode = b.notamMode === 'places' ? 'places' : 'route';
  let pts;
  if (mode === 'places') {
    pts = (b.notamPlaces || []).filter((p) => p.lat != null).map((p) => ({ lat: p.lat, lon: p.lon, name: p.name || icao(p.lat, p.lon), nm: Math.max(5, Math.round((+p.km || 200) / 1.852)) }));
    if (!pts.length) throw new Error(t('notam_noPlaces'));
  } else if (b.stagePlan) {
    // Etappen-Briefing (0.12.5): überlappende Kreise entlang des Etappenabschnitts der Bahn
    const nm = opts.nm || ctx.settings.notamRadiusNm || 25;
    pts = coverPoints(b.stagePlan.track, b.stagePlan.km0, b.stagePlan.km1, nm, `${b.stagePlan.no} · ${b.stagePlan.name}`.trim());
    if (!pts.length) pts = [{ lat: b.site.lat, lon: b.site.lon, name: b.site.name, nm }];
  } else {
    const nm = opts.nm || ctx.settings.notamRadiusNm || 25;
    pts = [{ lat: b.site.lat, lon: b.site.lon, name: b.site.name, nm, kind: 'site' }];
    const trj = b.panels['B.traj']?.content?.auto?.data?.tracks || [];
    for (const tr of trj) if (tr.end) pts.push({ lat: tr.end.lat, lon: tr.end.lon, name: `${t('auto_trajEnd')} ${tr.label}`, nm, kind: 'traj' });
    if (b.landing?.lat != null) pts.push({ lat: b.landing.lat, lon: b.landing.lon, name: b.landing.name, nm, kind: 'landing' });
    // 0.12.13: Kreise um die Bahn-Endpunkte tragen den Namen der Ortschaft (statt «Endpunkt 3000 ft»)
    await Promise.all(pts.filter((p) => p.kind === 'traj').map(async (p) => { try { const n = await placeName(p.lat, p.lon, b.site.country || 'CH'); if (n) p.name = typeof n === 'string' ? n : n.name || p.name; } catch { /* Name bleibt */ } }));
  }
  const nm = pts[0].nm;
  // Länder der Fahrt (FIR-Auswahl für autorouter): Startort, Landeraum, Lufträume der Analyse
  const cc = [...new Set([b.site.country, b.landing?.country, ...((b.panels['C.airspace']?.content?.auto?.data?.crossed || []).map((x) => x.as?.country))].filter(Boolean).map((x) => String(x).toUpperCase()))].join(',');
  const all = new Map(); const errors = []; let source = 'FAA NOTAM API', generated = null;
  outer: for (const p of pts.slice(0, 6)) {
    for (const c of hexCover(p.lat, p.lon, p.nm)) {
      try { const j = await ctx.store.data('notam', { lat: c.lat, lon: c.lon, nm: c.nm, cc }, shareTok(ctx)); if (j.source) source = j.source; if (j.generated && (!generated || j.generated < generated)) generated = j.generated; for (const e of j.errors || []) if (!errors.includes(e)) errors.push(e); for (const it of j.items || []) if (!all.has(it.id)) all.set(it.id, it); }   // Hinweise des Workers (z. B. autorouter-Fehler) einmal übernehmen (0.12.7); ältester Abrufstand (0.14.1)
      catch (e) { errors.push(`${p.name}: ${e.message}`); if (e.status === 424) break outer; break; }
    }
  }
  const maxFt = (b.intent.altMaxFt || 6000) + 2000;
  const items = [...all.values()].map((it) => ({ ...it, vfr: vfrRelevant(it, maxFt, b.time.startMs, b.time.startMs + (b.intent.durationMin || 0) * 60000) }));
  const rel = items.filter((x) => x.vfr.relevant).sort((x, y) => (x.start || '').localeCompare(y.start || ''));
  const text = rel.map((x) => `${x.icao || x.location} ${x.number || ''}: ${(x.formatted || x.text || '').replace(/\s+/g, ' ').slice(0, 400)}`).join('\n\n');
  return { kind: 'notam', sourceUrl: /autorouter/.test(source) ? 'https://www.autorouter.aero/' : 'https://notams.aim.faa.gov/', stand: Date.now(), source, generated, data: { items, relevantCount: rel.length, points: pts, nm, mode, errors }, text };
}
/** VFR-Relevanz: zeitlich überlappend, untere Grenze unter maxFt, keine reinen IFR-/Infrastruktur-Themen. */
export function vfrRelevant(it, maxFt, fromMs, toMs) {
  const why = [];
  const s = it.start ? Date.parse(it.start) : null, e = it.end && !/PERM/i.test(it.end) ? Date.parse(it.end) : null;
  if (s && s > toMs + 3600000) why.push('later');      // 0.12.15: 1 h Toleranz statt 6 h – ausserhalb des Fahrtzeitraums wird nicht gezeigt
  if (e && e < fromMs - 3600000) why.push('expired');
  const txt = `${it.text || ''} ${it.formatted || ''}`.toUpperCase();
  const minFL = it.minFL != null ? +it.minFL : null;
  if (minFL != null && minFL * 100 > maxFt) why.push(`above FL${minFL}`);
  if (/\b(ILS|VOR|DME|NDB|LOC|GP|RNAV|RNP|SID|STAR|IAP|APCH|TWY|RWY LGT|PAPI|ALS|OBST LGT U\/S)\b/.test(txt) && !/(RESTRICT|PROHIB|DANGER|TEMPO|AIRSPACE|PARACHUT|PJE|UAS|DRONE|BALLOON|GLIDER|AEROBAT|MIL|EXERCISE|FIREWORK|CRANE|OBST)/.test(txt)) why.push('ifr/infra');
  return { relevant: !why.length, why };
}

/** Lufträume entlang der Trajektorien (openAIP über den Worker): durchfahren / nahe / darüber, FIR-Folge. */
export async function airspace(ctx, b) {
  let trj = b.stagePlan?.traj || b.panels['B.traj']?.content?.auto?.data;   // Etappen-Briefing: Bahnabschnitt des Profils (0.12.5)
  if (!trj?.tracks?.length) trj = (await traj(ctx, b)).data;
  const tracks = trj.tracks.filter((x) => !x.belowGround);
  const corridorKm = +ctx.settings.airspaceCorridorKm || 5;
  const pts = tracks.flatMap((x) => x.points).concat(b.stagePlan ? [] : [{ lat: b.site.lat, lon: b.site.lon }], !b.stagePlan && b.landing?.lat != null ? [{ lat: b.landing.lat, lon: b.landing.lon }] : []);   // Etappen-Sicht (0.12.5/0.12.7): nur der Bahnabschnitt
  const dLat = (corridorKm + 3) / 111.2, dLon = (corridorKm + 3) / (111.2 * Math.max(0.2, Math.cos(b.site.lat * Math.PI / 180)));
  const bbox = [Math.min(...pts.map((p) => p.lon)) - dLon, Math.min(...pts.map((p) => p.lat)) - dLat, Math.max(...pts.map((p) => p.lon)) + dLon, Math.max(...pts.map((p) => p.lat)) + dLat].map((v) => +v.toFixed(3));
  const tileKey = /[?&]apiKey=([A-Za-z0-9]+)/.exec(ctx.settings.airspaceTileUrl || '')?.[1];
  const j = await ctx.store.data('airspace', { bbox: bbox.join(','), key: tileKey || null }, shareTok(ctx));
  if (!(j.items || []).length) throw new Error(j.warning || 'openAIP: keine Lufträume geliefert');   // 0.14.2: leere Antwort ist ein Fehler, keine Analyse «kein Luftraum»
  const elevM = b.site.elev || 0;
  const items = (j.items || []).map((it) => normalizeAirspace(it, elevM));
  const altMaxFt = b.intent.altMaxFt || 6000, altMinFt = b.intent.altMinFt || 0;
  const siteElevFt = elevM * 3.28084;
  const a = analyzeAirspaces(tracks, items, { altMinFt, altMaxFt, corridorKm, siteElevFt });
  const tmaWarnFt = +ctx.settings.airspaceTmaWarnFt || 900;
  const warns = siteWarnings({ lat: b.site.lat, lon: b.site.lon, elevFt: siteElevFt }, items, tmaWarnFt).map((w) => ({ kind: w.kind, aglFt: w.aglFt, name: w.as.name, typeKey: w.as.typeKey, cls: w.as.cls, lowerTxt: w.as.lowerTxt, upperTxt: w.as.upperTxt }));
  const landWarns = b.landing?.lat != null ? siteWarnings({ lat: b.landing.lat, lon: b.landing.lon, elevFt: (b.landing.elev || elevM) * 3.28084 }, items, tmaWarnFt).filter((w) => w.kind === 'ctr').map((w) => ({ kind: w.kind, name: w.as.name, typeKey: w.as.typeKey, cls: w.as.cls })) : [];
  const slimAs = (x) => ({ ...x, as: { ...x.as, polys: x.as.polys.map((p) => [thinRing(p[0], 160)]) } });
  const z = b.site.tz || 'Europe/Zurich';
  const line = (x) => `${x.as.name} (${x.as.typeKey}${x.as.cls ? ' ' + x.as.cls : ''}) ${x.as.lowerTxt}–${x.as.upperTxt}${x.firstKm != null ? ` · ${x.firstKm} km · ${hhmm(z, x.firstMs)} LT` : ` · ${x.minDistKm} km`}`;
  const text = [
    warns.map((w) => `⚠ ${w.kind === 'ctr' ? t('as_warnCtr', { n: w.name }) : t('as_warnTma', { n: w.name, l: w.lowerTxt, d: w.aglFt })}`).join('\n'),
    a.firs.length ? `FIR: ` + a.firs.map((f) => `${f.label}: ${f.seq.map((s) => `${s.name}${s.fromKm ? ` (${t('as_fromKm')} ${s.fromKm} km, +${fmtDur(Math.round((s.fromMs - b.time.startMs) / 60000))})` : ''}`).join(' → ')}`).join('; ') : '',
    a.crossed.length ? `${t('as_crossed')}:\n` + a.crossed.map(line).join('\n') : t('as_noneCrossed'),
    a.near.length ? `${t('as_near')} (${corridorKm} km):\n` + a.near.map(line).join('\n') : '',
    a.above.length ? `${t('as_above')} (> ${altMaxFt} ft):\n` + a.above.map(line).join('\n') : '',
  ].filter(Boolean).join('\n\n');
  return { kind: 'airspace', sourceUrl: 'https://www.openaip.net/map', stand: Date.now(), source: 'openAIP', data: { crossed: a.crossed.map(slimAs), near: a.near.map(slimAs), above: a.above.map((x) => ({ ...x, as: { ...x.as, polys: [] } })), firs: a.firs, warns, landWarns, tmaWarnFt, altMinFt, altMaxFt, corridorKm, bbox, total: j.total, tracks: tracks.map((x) => ({ label: x.label, altFt: x.altFt, points: x.points })), landing: trj.landing || null, trajStand: b.panels['B.traj']?.content?.auto?.stand || null }, text };
}

/** Alle automatischen Panels eines Briefings nacheinander; onStep(key, status, err). */
export const AUTO_FETCHERS = { 'B.thermal': thermal, 'B.meteogram': meteogram, 'B.wind': wind, 'B.temps': temps, 'B.traj': traj, 'B.balloon': balloon, 'B.pdiff': pdiff, 'B.metar': metar, 'B.obs': obs, 'B.warnings': sigmet, 'B.fwp': fwp, 'C.airspace': airspace, 'C.notam': notam };
export async function refreshAll(ctx, b, keys, onStep) {
  const out = {};
  for (const k of keys) {
    const f = AUTO_FETCHERS[k]; if (!f) continue;
    onStep?.(k, 'loading');
    try { out[k] = await f(ctx, b); onStep?.(k, 'ok'); } catch (e) { out[k] = { error: e.message }; onStep?.(k, 'error', e); }
  }
  return out;
}
