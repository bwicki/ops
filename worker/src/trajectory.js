/* ops.wicki.aero — Ist-Trajektorie (0.14.0, Konzept «Fahrtdaten/Debriefing» 3.1 «Nachträgliche Logs» und 4.1):
 * analyze.wicki.aero übergibt die ausgewertete Fahrt (Trajektorie als GeoJSON, Kennzahlen, Stammdaten,
 * Viewer-Link, Verweis auf das Ereignislog) an ein Briefing. Die beiden Worker kennen ein gemeinsames
 * Dienst-Token (Secret OPS_HANDOVER_TOKEN); ein Browser sieht es nie. Ablage: Zusammenfassung in D1
 * (Tabelle trajectories, je Briefing eine Zeile), GeoJSON in R2 (<briefing>/trajectory.geojson). Die
 * Briefing-JSON bleibt unberührt (kein Revisionskonflikt, keine Archivsperre).
 */

const MAX_BYTES = 4 * 1024 * 1024;   // Paket (JSON) höchstens 4 MB
const MAX_POINTS = 20000;             // Trackpunkte
const LIST_DEFAULT = 20, LIST_MAX = 50;
const LINK_MONTHS_MS = 92 * 86400000;   // Konzept 4.4: Links sehen die Ist-Trajektorie bis 3 Monate nach der Landung

let ready = false;
export async function ensureTrajectories(env) {
  if (ready) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS trajectories (
    briefing_id TEXT PRIMARY KEY, json TEXT NOT NULL, geo_key TEXT NOT NULL, points INTEGER NOT NULL DEFAULT 0,
    source TEXT, flight_id TEXT, received_at INTEGER NOT NULL)`).run();
  ready = true;
}

function timingSafeEqual(a, b) { let r = a.length ^ b.length; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i % Math.max(1, b.length)); return r === 0; }

/** null = ok; sonst die Fehlerantwort {status, error}. Token im Header X-Handover-Token. */
export function handoverAuth(env, req) {
  if (!env.OPS_HANDOVER_TOKEN) return { status: 503, error: 'handover not configured (OPS_HANDOVER_TOKEN missing)' };
  const given = req.headers.get('X-Handover-Token') || '';
  if (!given || !timingSafeEqual(given, env.OPS_HANDOVER_TOKEN)) return { status: 401, error: 'bad handover token' };
  return null;
}

/** Die letzten Briefings (alle Eigner, nicht ausgeblendet), jüngste zuerst – zur Auswahl in analyze. */
export async function listHandoverBriefings(env, limit) {
  await ensureTrajectories(env);
  const n = Math.min(LIST_MAX, Math.max(1, +limit || LIST_DEFAULT));
  const rows = await env.DB.prepare(`SELECT b.id,b.no,b.start_ms,b.end_ms,b.tz,b.site,b.icao,b.reg,b.balloon,b.kind,b.status,b.final_no,b.owner_id,
      t.received_at AS traj_at, t.flight_id AS traj_flight, t.points AS traj_points, t.source AS traj_source
    FROM briefings b LEFT JOIN trajectories t ON t.briefing_id=b.id WHERE COALESCE(b.hidden,0)=0 ORDER BY b.start_ms DESC LIMIT ?`).bind(n).all();
  return (rows.results || []).map((r) => ({ id: r.id, no: r.no || null, startMs: r.start_ms, endMs: r.end_ms ?? null, tz: r.tz, site: r.site, icao: r.icao, reg: r.reg, balloon: r.balloon, kind: r.kind, status: r.status, finalNo: r.final_no, owner: r.owner_id,
    trajectory: r.traj_at ? { receivedAt: new Date(r.traj_at).toISOString(), flightId: r.traj_flight, points: r.traj_points, source: r.traj_source } : null }));
}

const geoKey = (id) => `${id}/trajectory.geojson`;

/** Paket prüfen und ablegen; Antwort {ok, briefingId, url, receivedAt, points}. */
export async function putTrajectory(env, ctx, id, pkg, appUrl, logUsage) {
  await ensureTrajectories(env);
  const row = await env.DB.prepare('SELECT id, owner_id, no FROM briefings WHERE id=?').bind(id).first();
  if (!row) return { status: 404, error: 'briefing not found' };
  if (!pkg || typeof pkg !== 'object') return { status: 400, error: 'bad package' };
  const geo = pkg.trajectory;
  if (!geo || geo.type !== 'FeatureCollection' || !Array.isArray(geo.features)) return { status: 400, error: 'trajectory must be a GeoJSON FeatureCollection' };
  let points = 0;
  for (const f of geo.features) {
    if (!f || !f.geometry) return { status: 400, error: 'bad feature' };
    if (f.geometry.type === 'LineString') { if (!Array.isArray(f.geometry.coordinates)) return { status: 400, error: 'bad geometry' }; points += f.geometry.coordinates.length; }
    else if (f.geometry.type !== 'Point') return { status: 400, error: `unsupported geometry ${f.geometry.type}` };
  }
  if (points < 2) return { status: 400, error: 'trajectory has no points' };
  if (points > MAX_POINTS) return { status: 413, error: `too many points (${points} > ${MAX_POINTS})` };
  const geoText = JSON.stringify(geo);
  if (geoText.length > MAX_BYTES) return { status: 413, error: 'trajectory too large (4 MB)' };
  const now = Date.now();
  const flight = pkg.flight && typeof pkg.flight === 'object' ? pkg.flight : {};
  const summary = {
    source: String(pkg.source || 'analyze').slice(0, 60), format: pkg.format || 1, sentAt: pkg.sentAt || null, receivedAt: new Date(now).toISOString(),
    flight: { id: String(flight.id || '').slice(0, 40), title: String(flight.title || '').slice(0, 200), url: /^https:\/\//.test(String(flight.url || '')) ? String(flight.url).slice(0, 200) : '', startTs: flight.startTs ?? null, endTs: flight.endTs ?? null, points: flight.points ?? null, updatedAt: flight.updatedAt ?? null },
    stats: pkg.stats && typeof pkg.stats === 'object' ? pkg.stats : {},
    meta: pkg.meta && typeof pkg.meta === 'object' ? pkg.meta : {},
    events: pkg.events && typeof pkg.events === 'object' ? pkg.events : null,
    points, thinnedToSec: geo.properties && geo.properties.thinnedToSec || null,
  };
  const sumText = JSON.stringify(summary);
  if (sumText.length > 200000) return { status: 413, error: 'summary too large' };
  await env.FILES.put(geoKey(id), geoText, { httpMetadata: { contentType: 'application/geo+json' }, customMetadata: { briefing: id, flight: summary.flight.id } });
  await env.DB.prepare('INSERT INTO trajectories (briefing_id,json,geo_key,points,source,flight_id,received_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(briefing_id) DO UPDATE SET json=excluded.json, geo_key=excluded.geo_key, points=excluded.points, source=excluded.source, flight_id=excluded.flight_id, received_at=excluded.received_at')
    .bind(id, sumText, geoKey(id), points, summary.source, summary.flight.id || null, now).run();
  if (logUsage) logUsage(env, ctx, row.owner_id, 'trajectory', `${id} ← ${summary.flight.id || '?'} (${points} pts)`, points);
  return { ok: true, briefingId: id, no: row.no || null, url: `${(appUrl || 'https://ops.wicki.aero').replace(/\/+$/, '')}/#/v/${id}?traj=1`, receivedAt: summary.receivedAt, points };
}

/** Zusammenfassung + GeoJSON eines Briefings, oder null. */
export async function getTrajectory(env, id) {
  await ensureTrajectories(env);
  const row = await env.DB.prepare('SELECT json, geo_key, points, received_at FROM trajectories WHERE briefing_id=?').bind(id).first();
  if (!row) return null;
  let summary; try { summary = JSON.parse(row.json); } catch { summary = {}; }
  const obj = await env.FILES.get(row.geo_key);
  let geojson = null; if (obj) { try { geojson = JSON.parse(await obj.text()); } catch { geojson = null; } }
  return { trajectory: { ...summary, points: row.points, receivedAtMs: row.received_at }, geojson };
}

export async function deleteTrajectory(env, ctx, id) {
  await ensureTrajectories(env);
  const row = await env.DB.prepare('SELECT geo_key FROM trajectories WHERE briefing_id=?').bind(id).first();
  if (!row) return false;
  await env.DB.prepare('DELETE FROM trajectories WHERE briefing_id=?').bind(id).run();
  const del = env.FILES.delete(row.geo_key); if (ctx) ctx.waitUntil(del); else await del;
  return true;
}

/** Links (Crew, Rückholer, Material) sehen die Ist-Trajektorie bis 3 Monate nach dem Fahrtende (Konzept 4.4). */
export const linkMayView = (row) => !row?.end_ms || Date.now() < row.end_ms + LINK_MONTHS_MS;
