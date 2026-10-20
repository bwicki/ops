/* ops — Briefingsicht, Abschnitt «Ist-Trajektorie» (0.14.0): die aus analyze.wicki.aero übergebene Fahrt – Kennzahlen,
 * Soll/Ist je geplanter Bahn (Querabweichung je Stunde, Endpunktabstand, Richtungsfehler), Karte (Bildschirm) und
 * Nord-oben-Skizze (Druck). Sichtbar für Eigner, Supermaster, Materialeigner und Links bis 3 Monate nach der Landung. */
import { h, fmt, fmtSigned, confirmDialog, toast } from '../util.js';
import { t, getLang } from '../i18n.js';
import { fmtDate, fmtDateTime, hhmm, fmtDur } from '../calc/time.js';
import { icao, bearing, distKm, mToFt } from '../calc/geo.js';
import { actualPoints, actualWaypoints, compareAll, hourlyPoints } from '../calc/actual.js';
import { trajSvg, TRAJ_COLORS } from '../auto/traj.js';
import { baseLayers } from './autorender.js';

const ACT_COLOR = '#14202e', PROFILE_COLOR = '#b8640f';
const ktOf = (ms) => (ms == null ? null : ms / 0.514444);

/**
 * tr: {trajectory: {flight, stats, meta, events, receivedAt, points}, geojson}; o: {canDelete, onDeleted}
 * → Knoten [div.bs, table.bp] für die Briefingsicht (brief.appendChild je Knoten).
 */
export function actualSection(ctx, b, tr, o = {}) {
  const z = b.site?.tz || 'Europe/Zurich', lang = getLang();
  const sm = tr.trajectory || {}, st = sm.stats || {}, fl = sm.flight || {};
  const pts = actualPoints(tr.geojson), wp = actualWaypoints(tr.geojson);
  const bs = h('div.bs', `F · ${t('act_title')}`);
  const tbl = h('table.bp');
  const row = (no, title, cell) => h('tr.row-F-' + no, [h('th', [h('span.pno', `F${no}`), ' ', title]), h('td', cell)]);
  const kv = (pairs) => h('div.kv', pairs.filter(Boolean).map(([k, v]) => [h('div.k', k), h('div.v', v)]));

  // --- F1 Fahrt: Kennzahlen aus analyze
  const to = st.takeoff, ld = st.landing;
  const tms = (x) => (x?.time ? Date.parse(x.time) : NaN);
  const when = (x) => (Number.isFinite(tms(x)) ? `${fmtDate(z, tms(x), lang)} ${hhmm(z, tms(x))} LT (${hhmm('UTC', tms(x))} UTC)` : '–');
  const place = (x, name) => (x && Number.isFinite(x.lat) ? `${name ? name + ' · ' : ''}${icao(x.lat, x.lon)}` : name || '–');
  const crs = to && ld && Number.isFinite(to.lat) && Number.isFinite(ld.lat) ? Math.round(bearing(to.lat, to.lon, ld.lat, ld.lon)) : null;
  const link = fl.url ? h('a', { href: fl.url, target: '_blank', rel: 'noopener' }, `${t('act_open')} ↗`) : null;
  const flightCell = h('div', [
    kv([
      [t('act_flightTitle'), h('span', [fl.title || '–', link ? ' · ' : '', link])],
      [t('act_takeoff'), `${when(to)} · ${place(to, st.startPlace)}`],
      [t('act_landing'), `${when(ld)} · ${place(ld, st.landPlace)}`],
      [t('act_duration'), `${fmtDur(Math.round((st.durationSec || 0) / 60))} · ${t('act_landingsN', { n: st.landings ?? '–' })}${st.nightSec ? ` · ${t('act_night')} ${fmtDur(Math.round(st.nightSec / 60))}` : ''}`],
      [t('act_dist'), `${fmt((st.distanceM || 0) / 1000)} km · ${fmt((st.straightM || 0) / 1000)} km${crs != null ? ` · ${String(crs).padStart(3, '0')}°` : ''}`],
      [t('act_altMax'), st.altMaxM != null ? `${fmt(st.altMaxM)} m AMSL (${fmt(mToFt(st.altMaxM))} ft)` : '–'],
      [t('act_vs'), st.vsMaxMs != null ? `${fmtSigned(st.vsMaxMs, 1)} / ${fmtSigned(st.vsMinMs ?? 0, 1)} m/s` : '–'],
      [t('act_gs'), st.gsMaxMs != null ? `${fmt(ktOf(st.gsMaxMs))} kt (${fmt(st.gsMaxMs * 3.6)} km/h)` : '–'],
      sm.meta && (sm.meta.balloon || sm.meta.pic) ? [t('act_master'), [sm.meta.balloon, sm.meta.type, sm.meta.pic ? `PIC ${sm.meta.pic}` : '', sm.meta.copilot].filter(Boolean).join(' · ')] : null,
      st.trackers?.length ? [t('act_trackers'), `${st.trackers.join(', ')} · ${fmt(sm.points)} ${t('act_points')}${sm.thinnedToSec ? ` (${sm.thinnedToSec} s)` : ''}`] : null,
      sm.events ? [t('act_events'), `${sm.events.n ?? 0} ${t('act_eventsN')}${sm.events.source ? ` · ${sm.events.source}` : ''}`] : null,
      [t('act_received'), `${sm.receivedAt ? fmtDateTime(z, Date.parse(sm.receivedAt), lang) : '–'} · ${sm.source || 'analyze'}`],
    ]),
    o.canDelete ? h('div.no-print', { style: { marginTop: '6px' } }, h('button.btn.small', { type: 'button', onclick: async () => { if (!(await confirmDialog(t('act_deleteTitle'), t('act_deleteText'), { yes: t('delete'), no: t('cancel') }))) return; try { await ctx.store.deleteTrajectory(b.id); toast(t('act_deleted')); o.onDeleted && o.onDeleted(); } catch (e) { toast(e.message || 'error'); } } }, t('act_delete'))) : null,
  ]);
  tbl.appendChild(row(1, t('act_flight'), flightCell));

  // --- F2 Soll/Ist je geplanter Bahn
  const cmpAll = compareAll(b, pts);
  const lbl = (trk) => (trk.kind === 'profile' ? t('act_profile') : `${trk.label}${trk.altFt != null ? ` · ${fmt(trk.altFt)} ft` : ''}`);
  let cmpCell;
  if (!cmpAll.rows.length) cmpCell = h('div.mini', pts.length ? t('act_noPlan') : t('act_noPoints'));
  else {
    const rows = cmpAll.rows.map((r) => {
      const c = r.cmp, best = r === cmpAll.best;
      return h('tr', { class: best ? 'best' : '' }, [h('td', [best ? h('b', lbl(r.track)) : lbl(r.track), best ? h('span.tag.pos', { style: { marginLeft: '6px' } }, t('act_best')) : null]),
        h('td.num', c.meanDevKm != null ? fmt(c.meanDevKm, 1) : '–'), h('td.num', c.maxDevKm != null ? fmt(c.maxDevKm, 1) : '–'), h('td.num', fmt(c.endKm, 1)), h('td.num', c.sameTimeKm != null ? fmt(c.sameTimeKm, 1) : '–'),
        h('td.num', c.brgErr != null ? `${fmtSigned(c.brgErr, 0)}° ${c.brgErr > 0.5 ? t('act_right') : c.brgErr < -0.5 ? t('act_left') : ''}` : '–'), h('td.num', `${Math.round(c.coverage * 100)} %`)]);
    });
    const head = h('thead', h('tr', [h('th', t('act_level')), h('th.num', `${t('act_meanDev')} km`), h('th.num', `${t('act_maxDev')} km`), h('th.num', `${t('act_endKm')} km`), h('th.num', `${t('act_sameTime')} km`), h('th.num', t('act_brgErr')), h('th.num', t('act_cover'))]));
    const bestC = cmpAll.best.cmp;
    const hourly = bestC.hours.length ? h('table.inner.act-hours', [h('thead', h('tr', [h('th', t('act_hour')), h('th', `${t('act_planned')} (${lbl(cmpAll.best.track)})`), h('th', t('act_actual')), h('th.num', `${t('act_dev')} km`)])),
      h('tbody', bestC.hours.map((x) => h('tr', [h('td', `+${x.h} h · ${hhmm('UTC', x.ms)} UTC`), h('td.mono', icao(x.planned.lat, x.planned.lon)), h('td.mono', icao(x.actual.lat, x.actual.lon)), h('td.num', `${fmt(x.devKm, 1)}${x.side ? ' ' + (x.side === 'R' ? t('act_right') : t('act_left')) : ''}`)])))]) : null;
    cmpCell = h('div', [h('table.inner.act-cmp', [head, h('tbody', rows)]), h('div.mini', t('act_cmpHint')), hourly]);
  }
  tbl.appendChild(row(2, t('act_compare'), cmpCell));

  // --- F3 Karte (Bildschirm) + Skizze (Druck)
  const planned = cmpAll.rows.map((r) => r.track);
  const mapCell = h('div');
  const mapEl = h('div.map.traj.no-print');
  mapCell.appendChild(mapEl);
  const sketchTracks = [...planned.map((trk, k) => ({ label: lbl(trk), points: trk.points, hourly: [], end: trk.end, color: trk.kind === 'profile' ? PROFILE_COLOR : TRAJ_COLORS[k % TRAJ_COLORS.length], dash: trk.kind !== 'profile' })),
    ...(pts.length ? [{ label: t('act_actual'), points: pts, hourly: hourlyPoints(pts), end: pts[pts.length - 1], color: ACT_COLOR, width: 3 }] : [])];
  const site = b.site?.lat != null ? { lat: b.site.lat, lon: b.site.lon } : (wp.takeoff || pts[0]);
  if (site && sketchTracks.length) { try { const svg = trajSvg(sketchTracks, { lat: site.lat, lon: site.lon, landing: b.landing?.lat != null ? b.landing : null, w: 520, h: 400 }); svg.classList.add('act-sketch'); mapCell.appendChild(h('div.print-only', svg)); } catch (e) { console.warn('sketch', e); } }
  mapCell.appendChild(h('div.mini', t('act_legend')));
  tbl.appendChild(row(3, t('act_map'), mapCell));
  setTimeout(() => drawMap(mapEl, b, pts, wp, planned, lbl), 30);
  return [bs, tbl];
}

function drawMap(el, b, pts, wp, planned, lbl) {
  if (typeof L === 'undefined' || !el.isConnected) return;
  const map = L.map(el, { zoomControl: true, scrollWheelZoom: false });
  const { osm, base, over } = baseLayers(); osm.addTo(map);
  L.control.layers(base, over, { collapsed: true }).addTo(map);
  const all = [];
  planned.forEach((trk, k) => {
    const ll = trk.points.map((q) => [q.lat, q.lon]);
    L.polyline(ll, trk.kind === 'profile' ? { color: PROFILE_COLOR, weight: 3 } : { color: TRAJ_COLORS[k % TRAJ_COLORS.length], weight: 2, dashArray: '4 3' }).addTo(map).bindTooltip(lbl(trk));
    all.push(...ll);
  });
  if (pts.length) {
    const ll = pts.map((q) => [q.lat, q.lon]);
    L.polyline(ll, { color: '#fff', weight: 6, opacity: 0.9 }).addTo(map);
    L.polyline(ll, { color: ACT_COLOR, weight: 3 }).addTo(map).bindTooltip(t('act_actual'));
    for (const hp of hourlyPoints(pts)) L.circleMarker([hp.lat, hp.lon], { radius: 3.5, color: ACT_COLOR, weight: 1.5, fillColor: '#fff', fillOpacity: 1 }).addTo(map).bindTooltip(`+${hp.h} h · ${hhmm('UTC', hp.ms)} UTC`);
    const tk = wp.takeoff || pts[0], ln = wp.landing || pts[pts.length - 1];
    if (tk) L.circleMarker([tk.lat, tk.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#2f8f4e', fillOpacity: 1 }).addTo(map).bindTooltip(t('act_takeoff'));
    if (ln) L.circleMarker([ln.lat, ln.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#c2481a', fillOpacity: 1 }).addTo(map).bindTooltip(t('act_landing'));
    all.push(...ll);
  }
  if (b.site?.lat != null) { L.marker([b.site.lat, b.site.lon]).addTo(map).bindTooltip(`${t('site')}: ${b.site.name || ''}`); all.push([b.site.lat, b.site.lon]); }
  if (b.landing?.lat != null) { L.marker([b.landing.lat, b.landing.lon], { icon: L.divIcon({ className: 'land-dot', iconSize: [16, 16], iconAnchor: [8, 8] }) }).addTo(map).bindTooltip(`${t('landingSite')}: ${b.landing.name || ''}`); all.push([b.landing.lat, b.landing.lon]); }
  setTimeout(() => { map.invalidateSize(); if (all.length) map.fitBounds(all, { padding: [20, 20] }); else map.setView([47, 8], 7); }, 60);
}

export { distKm };
