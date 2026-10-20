/* Fahrtbriefing — Trajektorien aus dem Modellwind.
 *
 * Für jedes Niveau wird der Ballon als Luftpaket mit dem Wind des Niveaus
 * verschoben: Zeitschritt `stepMin`, Wind linear zwischen den Stunden und
 * zwischen den Druckflächen interpoliert. Das ist eine Punktprognose am
 * Startort — der Wind wird nicht entlang der Bahn aus einem Gitter gelesen —
 * und deshalb über 2–3 Stunden hinaus nur eine Richtungsangabe. Die Ausgabe
 * sagt das jeweils dazu.
 *
 * Niveau-Schreibweise (Fahrtabsicht): «SFC», «1000 AGL», «3000» (ft AMSL),
 * «FL065».
 */
import { profile, windAt, indexAt, uvToDirSpd, M_TO_FT } from './openmeteo.js';
import { destination, distKm, bearing, icao } from '../calc/geo.js';

/** Niveau-Text → { label, kind: 'sfc'|'agl'|'amsl', ft } */
export function parseLevel(s) {
  const t = String(s || '').trim().toUpperCase();
  if (!t || t === 'SFC' || t === 'GND' || t === 'BODEN') return { label: 'SFC', kind: 'sfc', ft: 0 };
  let m = /^FL\s*(\d{2,3})$/.exec(t);
  if (m) return { label: `FL${m[1].padStart(3, '0')}`, kind: 'amsl', ft: +m[1] * 100 };
  m = /^(\d{3,5})\s*(FT)?\s*(AGL|GND)$/.exec(t);
  if (m) return { label: `${m[1]} ft AGL`, kind: 'agl', ft: +m[1] };
  m = /^(\d{3,5})\s*(FT)?\s*(AMSL|MSL)?$/.exec(t);
  if (m) return { label: `${m[1]} ft`, kind: 'amsl', ft: +m[1] };
  m = /^(\d{2,4})\s*M\s*(AGL|GND)?$/.exec(t);
  if (m) return { label: `${m[1]} m${m[2] ? ' AGL' : ''}`, kind: m[2] ? 'agl' : 'amsl', ft: Math.round(+m[1] * M_TO_FT) };
  return null;
}

/** Höhe in m AMSL eines Niveaus am Ort mit Geländehöhe elevM. */
export const levelAltM = (lv, elevM) => (lv.kind === 'sfc' ? elevM + 10 : lv.kind === 'agl' ? elevM + lv.ft / M_TO_FT : lv.ft / M_TO_FT);

/**
 * tracks(j, { lat, lon, elev, startMs, durationMin, levels, stepMin })
 * → [{ level, label, altM, altFt, points:[{ms, lat, lon}], hourly:[{ms, lat, lon, km, brg, icao, spdKt, dir}], end:{...}, ok, note }]
 */
export function tracks(j, o) {
  const levels = (o.levels || []).map(parseLevel).filter(Boolean);
  const stepMin = o.stepMin || 10;
  const steps = Math.max(1, Math.round(o.durationMin / stepMin));
  const t = j.hourly.time;
  const out = [];
  for (const lv of levels) {
    const altM = levelAltM(lv, o.elev || 0);
    if (lv.kind === 'amsl' && altM < (o.elev || 0) + 15) { out.push({ level: lv, label: lv.label, altM, altFt: Math.round(altM * M_TO_FT), points: [{ ms: o.startMs, lat: o.lat, lon: o.lon }], hourly: [], ok: false, belowGround: true, end: { ms: o.startMs, lat: o.lat, lon: o.lon, km: 0, brg: 0, icao: icao(o.lat, o.lon) } }); continue; }
    let lat = o.lat, lon = o.lon, ms = o.startMs;
    const points = [{ ms, lat, lon }], hourly = [];
    let ok = true, lastHourMark = ms;
    for (let s = 0; s < steps; s++) {
      const i = indexAt(j, ms);
      if (i < 0) { ok = false; break; }
      // Wind linear zwischen Stunde i und der nächsten
      const sec = ms / 1000;
      let i0 = i, i1 = i;
      if (t[i] > sec && i > 0) { i0 = i - 1; i1 = i; } else if (t[i] <= sec && i < t.length - 1) { i0 = i; i1 = i + 1; }
      const w0 = windAt(profile(j, i0, o.elev), altM), w1 = windAt(profile(j, i1, o.elev), altM);
      if (!w0 || !w1) { ok = false; break; }
      const f = i1 === i0 ? 0 : (sec - t[i0]) / ((t[i1] - t[i0]) || 1);
      const u = w0.u + f * (w1.u - w0.u), v = w0.v + f * (w1.v - w0.v);
      const dt = stepMin * 60;
      const dKm = Math.hypot(u, v) * dt / 1000;
      const brg = (Math.atan2(u, v) * 180 / Math.PI + 360) % 360;
      const p = destination(lat, lon, brg, dKm);
      lat = p.lat; lon = p.lon; ms += dt * 1000;
      points.push({ ms, lat, lon });
      if (ms - lastHourMark >= 3600000 - 1 || s === steps - 1) {
        const { spd, dir } = uvToDirSpd(u, v);
        hourly.push({ ms, lat, lon, km: distKm(o.lat, o.lon, lat, lon), brg: bearing(o.lat, o.lon, lat, lon), icao: icao(lat, lon), spdKt: spd * 1.943844, dir });
        lastHourMark = ms;
      }
    }
    const end = points[points.length - 1];
    out.push({ level: lv, label: lv.label, altM, altFt: Math.round(altM * M_TO_FT), points, hourly, ok,
      end: { ...end, km: distKm(o.lat, o.lon, end.lat, end.lon), brg: bearing(o.lat, o.lon, end.lat, end.lon), icao: icao(end.lat, end.lon) } });
  }
  return out;
}

/** Nord-oben-Skizze der Bahnen als SVG (druckbar, ohne Kacheln). */
/** Farben der Trajektorien (Reihenfolge der Niveaus); Legende und Karte verwenden dieselben. */
export const TRAJ_COLORS = ['#c2481a', '#1673a8', '#2f8f4e', '#8a4fb5', '#b5892f', '#444', '#d1476e', '#2aa198'];
export function trajSvg(trs, o = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs, txt) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); if (txt != null) n.textContent = txt; return n; };
  const W = o.w || 420, H = o.h || 360, pad = 28;
  const lat0 = o.lat, lon0 = o.lon;
  const kx = 111.2 * Math.cos(lat0 * Math.PI / 180), ky = 111.2;
  const toKm = (p) => [(p.lon - lon0) * kx, (p.lat - lat0) * ky];
  const all = [[0, 0]];
  for (const tr of trs) for (const p of tr.points) all.push(toKm(p));
  if (o.landing?.lat != null) all.push(toKm(o.landing));
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  let r = Math.max(2, ...all.map(([x, y]) => Math.max(Math.abs(x - cx), Math.abs(y - cy)))) * 1.15 + 1;
  const grid = r > 60 ? 20 : r > 25 ? 10 : r > 12 ? 5 : r > 5 ? 2 : 1;
  r = Math.ceil(r / grid) * grid;
  const sc = (Math.min(W, H) - 2 * pad) / (2 * r);
  const X = (x) => W / 2 + (x - cx) * sc, Y = (y) => H / 2 - (y - cy) * sc;
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, class: 'traj-svg', role: 'img' });
  const g0 = Math.ceil((cx - r) / grid) * grid, g1 = Math.floor((cx + r) / grid) * grid, h0 = Math.ceil((cy - r) / grid) * grid, h1 = Math.floor((cy + r) / grid) * grid;
  for (let g = g0; g <= g1 + 1e-6; g += grid) { svg.appendChild(mk('line', { x1: X(g), y1: Y(cy - r), x2: X(g), y2: Y(cy + r), class: 'tg' + (Math.abs(g) < 1e-6 ? ' tz' : '') })); svg.appendChild(mk('text', { x: X(g), y: H - pad + 12, class: 'tl', 'text-anchor': 'middle' }, `${g > 0 ? '+' : ''}${g}`)); }
  for (let g = h0; g <= h1 + 1e-6; g += grid) { svg.appendChild(mk('line', { x1: X(cx - r), y1: Y(g), x2: X(cx + r), y2: Y(g), class: 'tg' + (Math.abs(g) < 1e-6 ? ' tz' : '') })); svg.appendChild(mk('text', { x: pad - 4, y: Y(g) + 3, class: 'tl', 'text-anchor': 'end' }, `${g > 0 ? '+' : ''}${g}`)); }
  svg.appendChild(mk('text', { x: W / 2, y: 11, class: 'tl', 'text-anchor': 'middle' }, 'N ↑'));
  svg.appendChild(mk('text', { x: W - 4, y: H - 4, class: 'tl', 'text-anchor': 'end' }, `km · Raster ${grid} km`));
  const colors = TRAJ_COLORS;
  const labels = [];
  trs.forEach((tr, k) => {
    if (tr.belowGround) return;
    const col = tr.color || colors[k % colors.length];   // 0.14.0: eigene Farbe/Breite/Strichelung (Ist-Trajektorie)
    const pts = tr.points.map((p) => { const [x, y] = toKm(p); return `${X(x).toFixed(1)},${Y(y).toFixed(1)}`; }).join(' ');
    svg.appendChild(mk('polyline', { points: pts, fill: 'none', stroke: col, 'stroke-width': tr.width || 2, 'stroke-linejoin': 'round', ...(tr.dash ? { 'stroke-dasharray': '4 3' } : {}) }));
    for (const hpt of tr.hourly) { const [x, y] = toKm(hpt); svg.appendChild(mk('circle', { cx: X(x), cy: Y(y), r: 2.6, fill: col })); }
    const [ex, ey] = toKm(tr.end);
    let lx = X(ex) + 5, ly = Y(ey) + 3;
    while (labels.some(([ax, ay]) => Math.abs(ax - lx) < 40 && Math.abs(ay - ly) < 9)) ly += 10;
    labels.push([lx, ly]);
    svg.appendChild(mk('text', { x: lx, y: ly, class: 'tl', fill: col, style: 'font-weight:600' }, tr.label));
  });
  svg.appendChild(mk('circle', { cx: X(0), cy: Y(0), r: 4, class: 'tsite' }));
  if (o.landing?.lat != null) { const [x, y] = toKm(o.landing); svg.appendChild(mk('path', { d: `M${X(x) - 5},${Y(y) + 5} L${X(x)},${Y(y) - 5} L${X(x) + 5},${Y(y) + 5} Z`, class: 'tland' })); }
  return svg;
}

/**
 * Schätzung für einen Zielpunkt aus der Trajektorienschar: Fahrzeit und mittlere Fahrthöhe (Annahme
 * konstante Höhe) aus den beiden nächsten Bahnen links und rechts des Ziels, gewichtet nach Querabstand.
 * tracks: [{ altM, points:[{ms,lat,lon}], belowGround? }], site {lat,lon}, target {lat,lon}
 * → { min, altM, beyond (Ziel jenseits der Bahnenden), nearestKm } oder null
 */
export function targetEstimate(tracks, site, target) {
  if (!site || site.lat == null || !target || target.lat == null) return null;
  const brgT = bearing(site.lat, site.lon, target.lat, target.lon);
  const cands = [];
  for (const tr of tracks || []) {
    if (tr.belowGround || !tr.points?.length || tr.altM == null) continue;
    let best = null;
    tr.points.forEach((p, k) => { const d = distKm(p.lat, p.lon, target.lat, target.lon); if (!best || d < best.d) best = { d, k, p }; });
    const brgP = bearing(site.lat, site.lon, best.p.lat, best.p.lon);
    const side = ((brgP - brgT + 540) % 360) - 180;   // > 0 rechts der Linie Start→Ziel, < 0 links
    cands.push({ d: best.d, side, min: (best.p.ms - tr.points[0].ms) / 60000, altM: tr.altM, atEnd: best.k >= tr.points.length - 1 });
  }
  if (!cands.length) return null;
  const byD = (a, b) => a.d - b.d;
  const left = cands.filter((c) => c.side < 0).sort(byD)[0], right = cands.filter((c) => c.side >= 0).sort(byD)[0];
  let min, altM, beyond;
  if (left && right) { const w = left.d + right.d || 1; const fl = right.d / w, fr = left.d / w; min = left.min * fl + right.min * fr; altM = left.altM * fl + right.altM * fr; beyond = left.atEnd && right.atEnd; }
  else { const c = left || right; min = c.min; altM = c.altM; beyond = c.atEnd; }
  const nearestKm = Math.min(...cands.map((c) => c.d));
  const distKmT = distKm(site.lat, site.lon, target.lat, target.lon);
  // Ziel abseits der Schar (nächste Bahn weiter weg als die halbe Zieldistanz) oder nur am Startpunkt am nächsten → keine Schätzung
  const unreliable = min <= 0 || nearestKm > Math.max(3, 0.5 * distKmT);
  return { min: Math.round(min / 5) * 5, altM: Math.round(altM / 10) * 10, beyond, nearestKm, unreliable };
}
