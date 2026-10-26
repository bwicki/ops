#!/usr/bin/env node
/* ops.wicki.aero — NOTAM der FAA NMS API je Abfragepunkt holen (GitHub Actions, Workflow fetch-notam, 0.14.1).
 *
 * Warum hier und nicht im Worker: die FAA-NMS-API läuft auf der Google Cloud Platform, deren Sperrliste die
 * Ausgangsadressen von Cloudflare Workers abweist (HTTP 403; FAA NAIMES, INC0033867, 19.10.2026). Ein
 * GitHub-Actions-Runner wird nicht abgewiesen (Probe 19.10.2026: 401 ohne Zugangsdaten).
 *
 * Ablauf: 1) Abfragepunkte vom Worker (/api/handover/notam-points, Dienst-Token OPS_HANDOVER_TOKEN):
 * Startort, Landeraum, Bahn-Endpunkte und NOTAM-Orte der Briefings der nächsten 7 Tage sowie alle in den
 * letzten 7 Tagen tatsächlich abgefragten Kreise. 2) OAuth2-Token der FAA (client_credentials). 3) je Punkt
 * GET /nmsapi/v1/notams?latitude&longitude&radius (GEOJSON), normalisiert wie im Worker (nmsNormalize) nach
 * data/notam/<key>.json. 4) data/notam/index.json mit Stand, Punkten und Fehlern; Dateien zu Punkten, die
 * nicht mehr gefragt sind, werden entfernt. Der Worker liest die Dateien von der eigenen Origin
 * (ops.wicki.aero/data/notam/…), wie die DWD-Berichte.
 *
 * Umgebung: FAA_CLIENT_ID, FAA_CLIENT_SECRET, OPS_HANDOVER_TOKEN (Repository-Secrets), OPS_API (Standard
 * https://briefing-api.balthasar.workers.dev), FAA_NMS (nur Test). Exit ≠ 0 nur, wenn Punkte oder Token nicht zu holen sind.
 */
import { writeFile, mkdir, readdir, unlink, readFile } from 'node:fs/promises';

const OUT = 'data/notam';
const API = (process.env.OPS_API || 'https://briefing-api.balthasar.workers.dev').replace(/\/$/, '');
const NMS = (process.env.FAA_NMS || 'https://api-nms.aim.faa.gov').replace(/\/$/, '');   // FAA_NMS nur für lokale Tests
const UA = 'Fahrtbriefing/0.14 fetch-notam (+https://ops.wicki.aero)';
const MAX_POINTS = 80;
const { FAA_CLIENT_ID: ID, FAA_CLIENT_SECRET: SECRET, OPS_HANDOVER_TOKEN: TOKEN } = process.env;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const fail = (msg) => { console.error(msg); process.exit(1); };
if (!ID || !SECRET) fail('FAA_CLIENT_ID / FAA_CLIENT_SECRET fehlen (Repository-Secrets)');
if (!TOKEN) fail('OPS_HANDOVER_TOKEN fehlt (Repository-Secret)');

async function fetchJson(url, init = {}, ms = 30000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'application/json', ...(init.headers || {}) } });
    const txt = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.replace(/\s+/g, ' ').slice(0, 200)}`);
    return JSON.parse(txt);
  } finally { clearTimeout(t); }
}

/** Wie worker/src/wx.js nmsNormalize – ein NOTAM aus der GEOJSON-Antwort in die Form der App. */
function normalize(f) {
  const p = f.properties || f; const core = p.coreNOTAMData?.notam || p.notam || p; const tr = p.coreNOTAMData?.notamTranslation?.[0] || p.notamTranslation?.[0] || {};
  const geom = f.geometry || null; let glat = null, glon = null;
  if (geom?.type === 'Point' && Array.isArray(geom.coordinates)) { glon = +geom.coordinates[0]; glat = +geom.coordinates[1]; }
  return { id: core.id || core.nmsId || p.id, number: core.number || core.notamNumber, type: core.type, location: core.location, icao: core.icaoLocation || core.icaoId || core.location, start: core.effectiveStart || core.effectiveStartDate, end: core.effectiveEnd || core.effectiveEndDate, classification: core.classification, text: core.text || core.icaoMessage || core.traditionalMessage || '', minFL: core.minimumFL, maxFL: core.maximumFL, radius: core.radius, coordinates: core.coordinates, lat: core.lat ?? glat, lon: core.lon ?? glon, formatted: tr.formattedText || tr.simpleText || '', geometry: geom };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  // 1) Punkte
  const { points } = await fetchJson(`${API}/api/handover/notam-points`, { headers: { 'X-Handover-Token': TOKEN } });
  if (!Array.isArray(points)) fail('Antwort des Workers ohne points');
  const todo = points.slice(0, MAX_POINTS);
  log(`${points.length} Punkte (${todo.length} werden geholt)`);
  // 2) Token
  const basic = Buffer.from(`${ID.trim()}:${SECRET.trim()}`).toString('base64');
  const tk = await fetchJson(`${NMS}/v1/auth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` }, body: 'grant_type=client_credentials' });
  if (!tk.access_token) fail('Token: keine access_token in der Antwort');
  // 3) je Punkt
  const errors = []; let ok = 0;
  for (const p of todo) {
    const url = `${NMS}/nmsapi/v1/notams?latitude=${(+p.lat).toFixed(4)}&longitude=${(+p.lon).toFixed(4)}&radius=${Math.round(p.nm)}`;
    try {
      const j = await fetchJson(url, { headers: { Authorization: `Bearer ${tk.access_token}`, nmsResponseFormat: 'GEOJSON' } }, 40000);
      const raw = j?.data?.geojson || j?.data?.features || j?.features || j?.items || (Array.isArray(j) ? j : []);
      const items = raw.map(normalize);
      await writeFile(`${OUT}/${p.key}.json`, JSON.stringify({ key: p.key, lat: p.lat, lon: p.lon, nm: p.nm, why: p.why, source: 'FAA NMS API', generated: new Date().toISOString(), total: items.length, items }));
      ok++; log(`${p.key} (${p.why}): ${items.length} NOTAM`);
    } catch (e) {
      errors.push(`${p.key}: ${e.message}`); log(`${p.key}: FEHLER ${e.message}`);
      // bestehende Datei behalten, aber den Fehler vermerken
      try { const old = JSON.parse(await readFile(`${OUT}/${p.key}.json`, 'utf8')); old.error = `${new Date().toISOString().slice(0, 16)}Z ${e.message}`; await writeFile(`${OUT}/${p.key}.json`, JSON.stringify(old)); } catch { /* keine alte Datei */ }
    }
    await new Promise((r) => setTimeout(r, 400));   // Rücksicht auf die API
  }
  // 4) Aufräumen und Index
  const keep = new Set(todo.map((p) => `${p.key}.json`));
  for (const f of await readdir(OUT)) if (f.endsWith('.json') && f !== 'index.json' && !keep.has(f)) { await unlink(`${OUT}/${f}`); log(`entfernt ${f}`); }
  await writeFile(`${OUT}/index.json`, JSON.stringify({ generated: new Date().toISOString(), points: todo.map((p) => ({ key: p.key, nm: p.nm, why: p.why })), ok, errors }, null, 1));
  log(`fertig: ${ok}/${todo.length} ok, ${errors.length} Fehler`);
}
main().catch((e) => fail(e.message));
