/* ops — Ist-Trajektorie (0.14.0, Konzept 4.1 «Soll/Ist-Vergleich», Zeile «Bahn»): Punkte aus dem analyze-GeoJSON,
 * geplante Trajektorien des Briefings (Profilbahn, Niveaus aus B.traj) und die Kennzahlen des Vergleichs –
 * Querabweichung je Stunde (Soll-Position zur selben Zeit), Endpunktabstand, Richtungsfehler. Reine Rechnung, testbar. */
import { distKm, bearing } from './geo.js';

const HOUR = 3600000;

/** Trackpunkte [{ms, lat, lon, alt, vs, gs}] aus dem GeoJSON (LineStrings kind 'track' mit properties.times), nach Zeit. */
export function actualPoints(geojson) {
  const out = [];
  for (const f of geojson?.features || []) {
    if (!f?.geometry || f.geometry.type !== 'LineString') continue;
    const p = f.properties || {}, co = f.geometry.coordinates || [], times = p.times || [];
    for (let i = 0; i < co.length; i++) {
      const ms = times[i] ? Date.parse(times[i]) : NaN;
      if (!Number.isFinite(ms) || !Number.isFinite(co[i][0]) || !Number.isFinite(co[i][1])) continue;
      out.push({ ms, lon: co[i][0], lat: co[i][1], alt: Number.isFinite(co[i][2]) ? co[i][2] : null, vs: p.vs_ms?.[i] ?? null, gs: p.gs_ms?.[i] ?? null, seg: p.segment || 1 });
    }
  }
  return out.sort((a, b) => a.ms - b.ms);
}

/** Start/Landung/Zwischenlandungen aus den Punkt-Features (kind takeoff|landing|intermediate). */
export function actualWaypoints(geojson) {
  const w = { takeoff: null, landing: null, intermediate: [] };
  for (const f of geojson?.features || []) {
    if (!f?.geometry || f.geometry.type !== 'Point') continue;
    const k = f.properties?.kind, c = f.geometry.coordinates || [];
    const q = { ms: Date.parse(f.properties?.time || '') || null, lon: c[0], lat: c[1], alt: Number.isFinite(c[2]) ? c[2] : null, name: f.properties?.name || '' };
    if (k === 'takeoff') w.takeoff = q; else if (k === 'landing') w.landing = q; else if (k === 'intermediate') w.intermediate.push(q);
  }
  return w;
}

/**
 * Geplante Bahnen des Briefings: zuerst die Profilbahn (Gas, Höhenprofil-Werkzeug), dann die Niveaus aus B.traj.
 * → [{ key, kind:'profile'|'level', label, altFt, altM, points:[{ms,lat,lon}], end:{lat,lon} }]
 */
export function plannedTracks(b) {
  const out = [];
  const prof = b?.profile?.data?.track?.points;
  if (Array.isArray(prof) && prof.length > 1) { const pts = prof.filter((q) => Number.isFinite(q.ms) && Number.isFinite(q.lat)).map((q) => ({ ms: q.ms, lat: q.lat, lon: q.lon })); if (pts.length > 1) out.push({ key: 'profile', kind: 'profile', label: 'Profil', altFt: null, altM: null, points: pts, end: pts[pts.length - 1] }); }
  for (const tr of b?.panels?.['B.traj']?.content?.auto?.data?.tracks || []) {
    if (tr.belowGround || !Array.isArray(tr.points) || tr.points.length < 2) continue;
    const pts = tr.points.filter((q) => Number.isFinite(q.ms) && Number.isFinite(q.lat)).map((q) => ({ ms: q.ms, lat: q.lat, lon: q.lon }));
    if (pts.length > 1) out.push({ key: `level:${tr.label}`, kind: 'level', label: tr.label, altFt: tr.altFt ?? null, altM: tr.altM ?? null, points: pts, end: tr.end && Number.isFinite(tr.end.lat) ? { lat: tr.end.lat, lon: tr.end.lon } : pts[pts.length - 1] });
  }
  return out;
}

/** Position auf einer Bahn zur Zeit ms (linear zwischen den Stützpunkten); null ausserhalb des Zeitbereichs. */
export function posAt(points, ms) {
  if (!points?.length || !Number.isFinite(ms)) return null;
  if (ms < points[0].ms || ms > points[points.length - 1].ms) return null;
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (points[m].ms <= ms) lo = m; else hi = m; }
  const a = points[lo], c = points[hi]; if (c.ms === a.ms) return { lat: a.lat, lon: a.lon };
  const f = (ms - a.ms) / (c.ms - a.ms);
  return { lat: a.lat + (c.lat - a.lat) * f, lon: a.lon + (c.lon - a.lon) * f };
}

const signedDiff = (a, b) => ((a - b + 540) % 360) - 180;   // a − b in −180…180

/**
 * Soll/Ist einer geplanten Bahn gegen die Ist-Punkte.
 * → { hours:[{h, ms, planned, actual, devKm, side:'L'|'R'|''}], n, meanDevKm, maxDevKm, coverage (0…1 der Ist-Dauer, die die Planung abdeckt),
 *     endKm (Ist-Ende ↔ geplantes Bahnende), sameTimeKm (Ist-Ende ↔ Soll-Position zur Landezeit, oder null), brgErr (° Richtungsfehler, +rechts),
 *     plannedEnd, actualEnd, site }
 */
export function compareTrack(planned, actual, opts = {}) {
  if (!planned?.points?.length || !actual?.length) return null;
  const site = opts.site && Number.isFinite(opts.site.lat) ? opts.site : { lat: actual[0].lat, lon: actual[0].lon };
  const t0 = actual[0].ms, t1 = actual[actual.length - 1].ms;
  const hours = [];
  for (let k = 1; t0 + k * HOUR <= t1 + 60000; k++) {
    const ms = t0 + k * HOUR;
    const pp = posAt(planned.points, ms), ap = posAt(actual, ms);
    if (!pp || !ap) continue;
    const devKm = distKm(pp.lat, pp.lon, ap.lat, ap.lon);
    // Seite: Kurs der Soll-Bahn (10 min voraus) gegen die Richtung Soll → Ist
    const ahead = posAt(planned.points, ms + 600000), behind = posAt(planned.points, ms - 600000);
    const crs = ahead ? bearing(pp.lat, pp.lon, ahead.lat, ahead.lon) : behind ? bearing(behind.lat, behind.lon, pp.lat, pp.lon) : null;
    const side = crs == null || devKm < 0.05 ? '' : signedDiff(bearing(pp.lat, pp.lon, ap.lat, ap.lon), crs) > 0 ? 'R' : 'L';
    hours.push({ h: k, ms, planned: pp, actual: ap, devKm, side });
  }
  const devs = hours.map((x) => x.devKm);
  const plannedEnd = planned.end || planned.points[planned.points.length - 1];
  const actualEnd = { lat: actual[actual.length - 1].lat, lon: actual[actual.length - 1].lon, ms: t1 };
  const pAtLanding = posAt(planned.points, t1);
  const pt0 = planned.points[0].ms, pt1 = planned.points[planned.points.length - 1].ms;
  const overlap = Math.max(0, Math.min(t1, pt1) - Math.max(t0, pt0));
  const brgErr = site ? signedDiff(bearing(site.lat, site.lon, actualEnd.lat, actualEnd.lon), bearing(site.lat, site.lon, plannedEnd.lat, plannedEnd.lon)) : null;
  return {
    hours, n: hours.length, meanDevKm: devs.length ? devs.reduce((s, v) => s + v, 0) / devs.length : null, maxDevKm: devs.length ? Math.max(...devs) : null,
    coverage: t1 > t0 ? overlap / (t1 - t0) : 0,
    endKm: distKm(actualEnd.lat, actualEnd.lon, plannedEnd.lat, plannedEnd.lon), sameTimeKm: pAtLanding ? distKm(actualEnd.lat, actualEnd.lon, pAtLanding.lat, pAtLanding.lon) : null,
    brgErr, plannedEnd, actualEnd, site,
  };
}

/** Alle geplanten Bahnen vergleichen; die mit der kleinsten mittleren Querabweichung (dann Endpunktabstand) gilt als beste. */
export function compareAll(b, actual, opts = {}) {
  const tracks = plannedTracks(b);
  const site = b?.site && Number.isFinite(b.site.lat) ? { lat: b.site.lat, lon: b.site.lon } : null;
  const rows = tracks.map((tr) => ({ track: tr, cmp: compareTrack(tr, actual, { site, ...opts }) })).filter((r) => r.cmp);
  const score = (r) => (r.cmp.meanDevKm != null ? r.cmp.meanDevKm : 1e6) * 10 + r.cmp.endKm;
  let best = null; for (const r of rows) if (!best || score(r) < score(best)) best = r;
  return { rows, best };
}

/** Stundenpunkte auf der Ist-Bahn (volle Stunden nach dem Start) – für Karte und Skizze. */
export function hourlyPoints(actual) {
  const out = []; if (!actual?.length) return out;
  const t0 = actual[0].ms, t1 = actual[actual.length - 1].ms;
  for (let k = 1; t0 + k * HOUR <= t1; k++) { const p = posAt(actual, t0 + k * HOUR); if (p) out.push({ ...p, ms: t0 + k * HOUR, h: k }); }
  return out;
}
