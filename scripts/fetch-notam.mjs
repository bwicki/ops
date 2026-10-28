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
const LEGACY = (process.env.FAA_LEGACY || 'https://external-api.faa.gov').replace(/\/$/, '');
const UA = 'Fahrtbriefing/0.14 fetch-notam (+https://ops.wicki.aero)';
const MAX_POINTS = 80;
const ID = (process.env.FAA_CLIENT_ID || '').trim(), SECRET = (process.env.FAA_CLIENT_SECRET || '').trim(), TOKEN = (process.env.OPS_HANDOVER_TOKEN || '').trim();
// Token transportsicher (Nicht-ASCII-Zeichen überleben einen HTTP-Header nicht): «b64u:» + base64url(UTF-8); der Worker versteht beides
const TOKEN_HDR = 'b64u:' + Buffer.from(TOKEN, 'utf8').toString('base64url');

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
/** Abbruch: Grund auch nach index.json schreiben (die Protokolle der Actions sind nicht von überall lesbar); nie Secrets. */
const fail = async (msg) => {
  console.error(msg);
  try { await mkdir(OUT, { recursive: true }); await writeFile(`${OUT}/index.json`, JSON.stringify({ generated: new Date().toISOString(), fatal: String(msg).slice(0, 700), ok: 0, points: [], errors: [] }, null, 1)); } catch { /* egal */ }
  process.exit(1);
};
if (!ID || !SECRET) await fail('FAA_CLIENT_ID / FAA_CLIENT_SECRET fehlen (Repository-Secrets)');
if (!TOKEN) await fail('OPS_HANDOVER_TOKEN fehlt (Repository-Secret)');

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
  let points;
  try { ({ points } = await fetchJson(`${API}/api/handover/notam-points`, { headers: { 'X-Handover-Token': TOKEN_HDR } })); }
  catch (e) {
    let diag = '';   // Diagnose ohne Geheimnisse: Längen und Hash-Präfixe beider Seiten
    try { const d = await fetchJson(`${API}/api/handover/diag`, { headers: { 'X-Handover-Token': TOKEN_HDR } }); diag = ` | diag ${JSON.stringify(d)}`; } catch (e2) { diag = ` | diag: ${e2.message}`; }
    await fail(`Abfragepunkte vom Worker: ${e.message}${diag}`);
  }
  if (!Array.isArray(points)) await fail('Antwort des Workers ohne points');
  // ohne Punkte (keine Briefings in den nächsten 7 Tagen, nichts abgefragt): ein fester Prüfpunkt, damit der Zugang laufend geprüft bleibt
  const todo = points.length ? points.slice(0, MAX_POINTS) : [{ key: '47.32_8.38_25', lat: 47.32, lon: 8.38, nm: 25, why: 'probe' }];
  log(`${points.length} Punkte (${todo.length} werden geholt)`);
  // 2) Zugang: NMS (api-nms.aim.faa.gov, OAuth2 client_credentials mit Basic client_id:client_secret) – weist die FAA den
  //    Client ab (invalid_client), sind es vermutlich Schlüssel des älteren API-Portals (api.faa.gov → external-api.faa.gov,
  //    Header client_id/client_secret); dann wird dieser Weg genommen. Welcher Weg trug, steht in index.json (mode).
  const basic = Buffer.from(`${ID}:${SECRET}`).toString('base64');
  let tk = null, mode = 'nms', authErr = '';
  // zwei Varianten des Token-Aufrufs: Basic-Header (Doku) und Felder client_id/client_secret im Body
  const tokenTries = [
    ['basic', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` }, body: 'grant_type=client_credentials' }],
    ['body', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: ID, client_secret: SECRET }).toString() }],
  ];
  for (const [name, init] of tokenTries) {
    try { tk = await fetchJson(`${NMS}/v1/auth/token`, init); if (!tk.access_token) throw new Error('keine access_token in der Antwort'); authErr = ''; break; }
    catch (e) { authErr += `${authErr ? ' | ' : ''}NMS-Token (${name}): ${e.message}`; tk = null; }
  }
  if (!tk) { mode = 'legacy'; log(authErr); }
  const idInfo = `Client-ID ${ID.length} Zeichen (${/^[0-9a-f]+$/i.test(ID) ? 'hex' : /^[A-Za-z0-9_-]+$/.test(ID) ? 'alnum' : 'andere Zeichen'}), Secret ${SECRET.length} Zeichen`;   // Diagnose ohne Werte
  const fetchPoint = async (p) => {
    if (mode === 'nms') {
      const url = `${NMS}/nmsapi/v1/notams?latitude=${(+p.lat).toFixed(4)}&longitude=${(+p.lon).toFixed(4)}&radius=${Math.round(p.nm)}`;
      const j = await fetchJson(url, { headers: { Authorization: `Bearer ${tk.access_token}`, nmsResponseFormat: 'GEOJSON' } }, 40000);
      return j?.data?.geojson || j?.data?.features || j?.features || j?.items || (Array.isArray(j) ? j : []);
    }
    const url = `${LEGACY}/notamapi/v1/notams?locationLatitude=${(+p.lat).toFixed(4)}&locationLongitude=${(+p.lon).toFixed(4)}&locationRadius=${Math.round(p.nm)}&pageSize=1000&sortBy=effectiveStartDate&sortOrder=Asc`;
    const j = await fetchJson(url, { headers: { client_id: ID, client_secret: SECRET } }, 40000);
    return j.items || [];
  };
  // 3) je Punkt
  const errors = []; let ok = 0;
  for (const p of todo) {
    try {
      const raw = await fetchPoint(p);
      const items = raw.map(normalize);
      await writeFile(`${OUT}/${p.key}.json`, JSON.stringify({ key: p.key, lat: p.lat, lon: p.lon, nm: p.nm, why: p.why, source: mode === 'nms' ? 'FAA NMS API' : 'FAA NOTAM API (api.faa.gov)', generated: new Date().toISOString(), total: items.length, items }));
      ok++; log(`${p.key} (${p.why}): ${items.length} NOTAM`);
    } catch (e) {
      errors.push(`${p.key}: ${e.message}`); log(`${p.key}: FEHLER ${e.message}`);
      // bestehende Datei behalten, aber den Fehler vermerken
      try { const old = JSON.parse(await readFile(`${OUT}/${p.key}.json`, 'utf8')); old.error = `${new Date().toISOString().slice(0, 16)}Z ${e.message}`; await writeFile(`${OUT}/${p.key}.json`, JSON.stringify(old)); } catch { /* keine alte Datei */ }
      if (/HTTP 40[13]/.test(e.message) && !ok) { if (authErr) errors.unshift(authErr); await writeIndex(todo, ok, errors, mode); await fail(`FAA: Zugang abgewiesen (${mode}): ${e.message}${authErr ? ' | ' + authErr : ''} | ${idInfo}`); }
    }
    await new Promise((r) => setTimeout(r, 400));   // Rücksicht auf die API
  }
  if (authErr) errors.unshift(authErr);
  // 4) Aufräumen und Index
  const keep = new Set(todo.map((p) => `${p.key}.json`));
  for (const f of await readdir(OUT)) if (f.endsWith('.json') && f !== 'index.json' && !keep.has(f)) { await unlink(`${OUT}/${f}`); log(`entfernt ${f}`); }
  await writeIndex(todo, ok, errors, mode);
  log(`fertig: ${ok}/${todo.length} ok, ${errors.length} Fehler (${mode})`);
}
const writeIndex = (todo, ok, errors, mode) => writeFile(`${OUT}/index.json`, JSON.stringify({ generated: new Date().toISOString(), mode, points: todo.map((p) => ({ key: p.key, nm: p.nm, why: p.why })), ok, errors }, null, 1));
main().catch((e) => fail(e.message));
