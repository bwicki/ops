/* Fahrtbriefing — Datenabrufe im Worker (/api/wx/<kind>).
 *
 * Der Browser darf viele Quellen nicht direkt lesen (CORS) oder soll den
 * Schlüssel nicht sehen. Hier laufen deshalb: Open-Meteo (mit Kundenschlüssel),
 * METAR/TAF/SIGMET (aviationweather.gov, Rückfall GaforCast-Kopie), DABS-PDF
 * (skybriefing), Bild-Schnappschüsse amtlicher Karten (R2), Wettertexte der
 * nationalen Dienste, Webcams im Umkreis (Windy/OSM), Wetterstationen im Umkreis
 * (SwissMetNet/Bright Sky/MeteoGate), Radiosonden (SondeHub), FAA-NOTAM und die
 * Anthropic-API für KI-Hinweise. Antworten werden über die Cache-API kurz
 * zwischengespeichert, damit mehrere Nutzer eines Briefings die Quellen nicht
 * mehrfach belasten.
 */

const UA = 'Fahrtbriefing/0.3 (+https://ops.wicki.aero)';
const AWC = 'https://aviationweather.gov/api/data';
const GAFOR = 'https://gafor.wicki.aero/data/dwd';
/** Eigene Kopie (GitHub Action im Repo), Rückfall GaforCast. */
const dataBase = (env) => (env.DATA_BASE || 'https://ops.wicki.aero/data/dwd').replace(/\/$/, '');
async function copyJson(env, name) {
  const bust = `?t=${Math.floor(Date.now() / 600000)}`;
  try { return await (await get(`${dataBase(env)}/${name}${bust}`, {}, 12000)).json(); }
  catch { return (await get(`${GAFOR}/${name}${bust}`, {}, 12000)).json(); }
}
const SNAPSHOT_HOSTS = ['www.dwd.de', 'charts.ecmwf.int', 'www.meteoschweiz.admin.ch', 'www.meteoswiss.admin.ch', 'tilecache.rainviewer.com', 'api.rainviewer.com', 'static.meteoblue.com', 'my.meteoblue.com', 'www.meteoblue.com', 'www.skybriefing.com', 'eumetview.eumetsat.int', 'view.eumetsat.int', 'opendata.dwd.de'];

const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
const err = (msg, status = 400) => json({ error: msg }, status);

async function getSecret(env, decrypt, name) {
  const row = await env.DB.prepare('SELECT iv,ct FROM secrets WHERE name=?').bind(name).first();
  if (!row) return null;
  try { return await decrypt(env, row.iv, row.ct); } catch { return null; }
}

/** Abruf mit Zeitlimit; wirft bei HTTP-Fehler. */
async function get(url, opts = {}, ms = 20000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal, headers: { 'User-Agent': UA, Accept: opts.accept || 'application/json, text/plain, */*', ...(opts.headers || {}) }, redirect: 'follow' });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url.split('?')[0]}`);
    return r;
  } finally { clearTimeout(t); }
}

/** Cache-API: Antwort unter einem synthetischen Schlüssel für `ttl` Sekunden halten. */
async function cached(ctx, key, ttl, make) {
  const cache = caches.default;
  const req = new Request(`https://cache.briefing.local/${key}`);
  const hit = await cache.match(req);
  if (hit) return hit.json();
  const data = await make();
  ctx.waitUntil(cache.put(req, new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` } })));
  return data;
}

const R = 6371.0088, rad = (d) => d * Math.PI / 180;
const distKm = (a, b, c, d) => 2 * R * Math.asin(Math.min(1, Math.sqrt(Math.sin(rad(c - a) / 2) ** 2 + Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2)));

// ------------------------------------------------------------ Open-Meteo
async function openMeteo(env, decrypt, ctx, q) {
  const query = q.get('query') || '';
  if (!/^latitude=/.test(query) || /[^\w=&.,%:-]/.test(query)) return err('bad query');
  const key = await getSecret(env, decrypt, 'openmeteo');
  // 0.12.14: api=ensemble → Ensemble-API (ICON-D2-EPS/ICON-EU-EPS, Member je Variable)
  const ens = q.get('api') === 'ensemble';
  const base = ens ? (key ? 'https://customer-ensemble-api.open-meteo.com' : 'https://ensemble-api.open-meteo.com') : (key ? 'https://customer-api.open-meteo.com' : 'https://api.open-meteo.com');
  const url = `${base}/v1/${ens ? 'ensemble' : 'forecast'}?${query}${key ? `&apikey=${encodeURIComponent(key)}` : ''}`;
  const data = await cached(ctx, `om${ens ? 'e' : ''}/${await sha(query)}`, 900, async () => (await get(url, {}, 25000)).json());
  return json(data);
}
/** 0.12.14: Amtliche Warnungen – CH über die MeteoSchweiz-App-Schnittstelle (PLZ aus Nominatim), DE über den DWD-WFS (Warnungen_Gemeinden).
 * Punkte: lat,lon-Paare (bis 6). Antwort: einheitliche Liste {src, type, level, headline, text, from, to, area, point}. */
const CH_WARN = { 0: 'Wind', 1: 'Gewitter', 2: 'Regen', 3: 'Schnee', 4: 'Glatteis', 5: 'Frost', 6: 'Hitze', 7: 'Hitze', 8: 'Lawinen', 9: 'Erdbeben', 10: 'Waldbrand', 11: 'Hochwasser', 12: 'Trockenheit' };
const DWD_LEVEL = { Minor: 1, Moderate: 2, Severe: 3, Extreme: 4 };
async function warnings(ctx, q) {
  const pts = String(q.get('pts') || '').split(';').map((x) => x.split(',').map(Number)).filter((x) => x.length === 2 && x.every(isFinite)).slice(0, 6);
  if (!pts.length) return err('pts');
  const out = [], errors = [], seen = new Set();
  for (const [lat, lon] of pts) {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    try {
      const w = await cached(ctx, `warn/${key}`, 600, async () => {
        // Land und PLZ über Nominatim (zoom 10 → Gemeinde/PLZ)
        const n = await (await get(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&zoom=10&accept-language=de`, {}, 10000)).json();
        const a = n.address || {}; const cc = String(a.country_code || '').toUpperCase(); const area = a.town || a.city || a.village || a.municipality || a.county || '';
        const list = [];
        if (cc === 'CH' && /^\d{4}$/.test(a.postcode || '')) {
          const j = await (await get(`https://app-prod-ws.meteoswiss-app.ch/v1/plzDetail?plz=${a.postcode}00`, {}, 12000)).json();
          for (const x of j.warnings || []) list.push({ src: 'MeteoSchweiz', cc, type: CH_WARN[x.warnType] || `Typ ${x.warnType}`, level: x.warnLevel, headline: `${CH_WARN[x.warnType] || 'Warnung'} Stufe ${x.warnLevel}${x.outlook ? ' (Vorwarnung)' : ''}`, text: x.text || '', from: x.validFrom || null, to: x.validTo || null, area: `${a.postcode} ${area}`.trim(), outlook: !!x.outlook, links: (x.links || []).map((l) => l.url).slice(0, 2) });
        } else if (cc === 'DE') {
          const u = `https://maps.dwd.de/geoserver/dwd/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=dwd:Warnungen_Gemeinden&outputFormat=application/json&CQL_FILTER=${encodeURIComponent(`INTERSECTS(THE_GEOM,POINT(${lat.toFixed(4)} ${lon.toFixed(4)}))`)}&count=50`;
          const j = await (await get(u, {}, 15000)).json();
          for (const f of j.features || []) { const p = f.properties || {}; list.push({ src: 'DWD', cc, type: p.EC_GROUP || p.EVENT || '', level: DWD_LEVEL[p.SEVERITY] || 1, headline: p.HEADLINE || p.EVENT || '', text: [p.DESCRIPTION, p.INSTRUCTION].filter(Boolean).join('\n'), from: p.ONSET ? Date.parse(p.ONSET) : null, to: p.EXPIRES ? Date.parse(p.EXPIRES) : null, area: p.NAME || area, outlook: /Vorab/i.test(p.HEADLINE || ''), id: p.IDENTIFIER || '' }); }
        }
        return { cc, area, list };
      });
      for (const x of w.list) { const id = `${x.src}|${x.id || x.type}|${x.level}|${x.from}|${x.area}`; if (seen.has(id)) continue; seen.add(id); out.push({ ...x, id, point: key }); }
      if (!['CH', 'DE'].includes(w.cc)) errors.push(`${key}: ${w.cc || '?'} – keine Warnquelle`);
    } catch (e) { errors.push(`${key}: ${e.message}`); }
  }
  return json({ warnings: out, errors, generated: new Date().toISOString() });
}
/** Geländehöhe (Open-Meteo Elevation API, Copernicus DEM 90 m): bis 100 Koordinaten je Abruf; 7 Tage im Cache. */
async function elevation(ctx, q) {
  const lat = q.get('lat') || '', lon = q.get('lon') || '';
  if (!/^-?\d{1,2}(\.\d{1,5})?(,-?\d{1,2}(\.\d{1,5})?){0,99}$/.test(lat) || !/^-?\d{1,3}(\.\d{1,5})?(,-?\d{1,3}(\.\d{1,5})?){0,99}$/.test(lon)) return err('bad coords');
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`;
  const data = await cached(ctx, `elev/${await sha(lat + '|' + lon)}`, 7 * 86400, async () => (await get(url, {}, 20000)).json());
  return json(data);
}
async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].slice(0, 16).map((x) => x.toString(16).padStart(2, '0')).join(''); }
/**
 * Wasserflächen (OpenStreetMap über Overpass, 0.12.2): je Koordinate, ob sie in einer Fläche natural=water liegt
 * (is_in → Flächen; Flüsse, Bäche und Kanäle zählen nicht). Bis 100 Koordinaten je Abruf, 30 Tage im Cache.
 * Antwort { items: [ { name, type } | null ] } in der Reihenfolge der Eingabe. Spiegel-Server als Rückfall.
 */
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const WATER_SKIP = /^(river|stream|canal|ditch|drain|wastewater|moat|fish_pass)$/;
function waterQuery(lats, lons) {
  const parts = lats.map((la, i) => `is_in(${la},${lons[i]})->.p${i};area.p${i}[natural=water]->.w${i};.w${i} make m i="${i}",id=w${i}.min(id()),nm=w${i}.set(t["name"]),wt=w${i}.set(t["water"]);out;`);
  return `[out:json][timeout:90];${parts.join('')}`;
}
export function waterItems(j, n) {
  const items = new Array(n).fill(null);
  for (const e of j.elements || []) {
    if (e.type !== 'm' || !e.tags) continue;
    const i = +e.tags.i, id = e.tags.id || '', wt = (e.tags.wt || '').split(';')[0];
    if (!(i >= 0 && i < n) || !id || WATER_SKIP.test(wt)) continue;
    items[i] = { name: (e.tags.nm || '').split(';')[0] || null, type: wt || null };
  }
  return items;
}
async function water(ctx, q) {
  const lat = q.get('lat') || '', lon = q.get('lon') || '';
  if (!/^-?\d{1,2}(\.\d{1,5})?(,-?\d{1,2}(\.\d{1,5})?){0,99}$/.test(lat) || !/^-?\d{1,3}(\.\d{1,5})?(,-?\d{1,3}(\.\d{1,5})?){0,99}$/.test(lon)) return err('bad coords');
  const lats = lat.split(','), lons = lon.split(',');
  if (lats.length !== lons.length) return err('bad coords');
  const data = await cached(ctx, `water/${await sha(lat + '|' + lon)}`, 30 * 86400, async () => {
    const body = 'data=' + encodeURIComponent(waterQuery(lats, lons));
    let last = null;
    for (const u of OVERPASS) {
      try { const j = await (await get(u, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 60000)).json(); return { items: waterItems(j, lats.length), source: 'OpenStreetMap · Overpass' }; }
      catch (e) { last = e; }
    }
    throw last || new Error('overpass');
  });
  return json(data);
}

// ------------------------------------------------------------ METAR / TAF / SIGMET
function pickNearest(list, lat, lon, km, limit) {
  const best = new Map();
  for (const m of Array.isArray(list) ? list : []) { if (!m.icaoId || m.lat == null) continue; const prev = best.get(m.icaoId); if (!prev || (m.obsTime || 0) > (prev.obsTime || 0)) best.set(m.icaoId, m); }
  return [...best.values()].map((m) => ({ ...m, distKm: distKm(lat, lon, m.lat, m.lon) })).filter((m) => m.distKm <= km).sort((a, b) => a.distKm - b.distKm).slice(0, limit);
}
function tafByIcao(list, ids) {
  const out = {};
  for (const t of Array.isArray(list) ? list : []) { if (!t.icaoId || !ids.includes(t.icaoId)) continue; const prev = out[t.icaoId]; if (!prev || t.mostRecent === 1 || (prev.mostRecent !== 1 && (t.issueTime || '') > (prev.issueTime || ''))) out[t.icaoId] = t; }
  return out;
}
async function metar(env, ctx, q) {
  const lat = +q.get('lat'), lon = +q.get('lon'), km = Math.min(400, +q.get('km') || 150), limit = Math.min(40, +q.get('limit') || 40);
  if (!isFinite(lat) || !isFinite(lon)) return err('lat/lon');
  const cell = `${lat.toFixed(1)},${lon.toFixed(1)},${km},${limit}`;
  const data = await cached(ctx, `metar/${cell}`, 600, async () => {
    const dLat = km / 111.2, dLon = km / (111.2 * Math.max(0.2, Math.cos(rad(lat))));
    const bbox = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((v) => v.toFixed(3)).join(',');
    try {
      const list = await (await get(`${AWC}/metar?bbox=${bbox}&format=json&hours=3`, {}, 12000)).json();
      const m = pickNearest(list, lat, lon, km, limit);
      if (!m.length) throw new Error('empty');
      const ids = m.map((x) => x.icaoId);
      let taf = {};
      try { taf = tafByIcao(await (await get(`${AWC}/taf?ids=${ids.join(',')}&format=json`, {}, 12000)).json(), ids); } catch { /* ohne TAF */ }
      return { metar: m, taf, source: 'aviationweather.gov', generated: new Date().toISOString() };
    } catch (e) {
      const j = await copyJson(env, 'metar.json');
      const m = pickNearest(j.metar, lat, lon, km, limit);
      return { metar: m, taf: tafByIcao(j.taf, m.map((x) => x.icaoId)), source: `Kopie NOAA AWC (${j.via || 'awc'}; live: ${e.message})`, generated: j.generated };
    }
  });
  return json(data);
}
async function sigmet(ctx, q) {
  const lat = +q.get('lat'), lon = +q.get('lon');
  if (!isFinite(lat) || !isFinite(lon)) return err('lat/lon');
  const data = await cached(ctx, `sigmet/${lat.toFixed(0)},${lon.toFixed(0)}`, 600, async () => {
    const list = await (await get(`${AWC}/isigmet?format=json`, {}, 15000)).json();
    const near = (Array.isArray(list) ? list : []).filter((s) => {
      const pts = (s.coords || []).filter((c) => c.lat != null);
      if (!pts.length) return /^(LS|ED|ET|LO|LF|LI|EB|EH|EL)/.test(s.firId || s.icaoId || '');
      const cLat = pts.reduce((a, c) => a + c.lat, 0) / pts.length, cLon = pts.reduce((a, c) => a + c.lon, 0) / pts.length;
      return distKm(lat, lon, cLat, cLon) < 450 || pts.some((c) => distKm(lat, lon, c.lat, c.lon) < 250);
    });
    return { sigmet: near.map((s) => ({ id: s.isigmetId || s.airSigmetId, fir: s.firId || s.icaoId, firName: s.firName, hazard: s.hazard, qualifier: s.qualifier, validFrom: s.validTimeFrom, validTo: s.validTimeTo, base: s.base, top: s.top, raw: s.rawSigmet || s.rawAirSigmet, coords: s.coords })), source: 'aviationweather.gov', generated: new Date().toISOString() };
  });
  return json(data);
}

// ------------------------------------------------------------ DWD-Kopie (GaforCast)
async function dwd(env, ctx) {
  const data = await cached(ctx, 'dwd/index', 600, () => copyJson(env, 'index.json'));
  return json(data);
}

// ------------------------------------------------------------ DABS (PDF → R2)
async function dabs(env, ctx, q, briefingId) {
  const day = q.get('day') === 'tomorrow' ? 'tomorrow' : 'today';
  const date = new Date(Date.now() + (day === 'tomorrow' ? 86400000 : 0)).toISOString().slice(0, 10);
  const key = `dabs/${date}-${day}-${Math.floor(Date.now() / 1800000)}.pdf`;
  let obj = await env.FILES.get(key);
  if (!obj) {
    const r = await get(`https://www.skybriefing.com/o/dabs?${day}`, { accept: 'application/pdf,*/*' }, 25000);
    const buf = await r.arrayBuffer();
    if (buf.byteLength < 1000 || new Uint8Array(buf, 0, 4).join(',') !== '37,80,68,70') return err('DABS: kein PDF erhalten', 502);
    await env.FILES.put(key, buf, { httpMetadata: { contentType: 'application/pdf' } });
    ctx.waitUntil(env.DB.prepare('INSERT OR IGNORE INTO files (key,briefing_id,content_type,size,created_at) VALUES (?,?,?,?,?)').bind(key, briefingId || 'dabs', 'application/pdf', buf.byteLength, Date.now()).run());
  }
  return json({ url: `/files/${key}`, key, day, date, fetched: Date.now() });
}

// ------------------------------------------------------------ Bild-Schnappschuss
async function snapshot(env, body, briefingId, q) {
  const u = (() => { try { return new URL(body.url || q.get('url') || ''); } catch { return null; } })();
  if (!u || u.protocol !== 'https:' || !SNAPSHOT_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))) return err('host not allowed');
  let target = u.toString();
  // ECMWF Open Charts: die API liefert JSON mit dem Bildlink
  if (u.hostname === 'charts.ecmwf.int' && u.pathname.startsWith('/opencharts-api/')) {
    const j = await (await get(target, { accept: 'application/json' }, 25000)).json();
    target = j?.data?.link?.href; if (!target) return err('ECMWF: kein Bildlink');
  }
  const r = await get(target, { accept: 'image/*,application/pdf' }, 25000);
  const ct = (r.headers.get('Content-Type') || '').split(';')[0].trim();
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf' }[ct];
  if (!ext) return err(`unsupported type ${ct}`);
  const buf = await r.arrayBuffer();
  if (buf.byteLength > 8 * 1024 * 1024) return err('too large');
  const id = [...crypto.getRandomValues(new Uint8Array(9))].map((b) => (b % 36).toString(36)).join('');
  const key = `${briefingId || 'snap'}/${id}.${ext}`;
  await env.FILES.put(key, buf, { httpMetadata: { contentType: ct } });
  await env.DB.prepare('INSERT INTO files (key,briefing_id,content_type,size,created_at) VALUES (?,?,?,?,?)').bind(key, briefingId || 'snap', ct, buf.byteLength, Date.now()).run();
  return json({ url: `/files/${key}`, key, contentType: ct, fetched: Date.now() });
}

// ------------------------------------------------------------ Wettertexte nationaler Dienste (Grosswetteranalyse)
const WXTEXT_HOSTS = ['opendata.dwd.de', 'www.dwd.de', 'www.meteoschweiz.admin.ch', 'www.meteoswiss.admin.ch', 'www.geosphere.at', 'www.zamg.ac.at', 'warnungen.zamg.at', 'wetter.orf.at', 'www.meteoam.it', 'meteofrance.com', 'www.meteofrance.com'];
/** Text (Roh-Textdatei oder HTML-Ausschnitt per CSS-Selektor über HTMLRewriter), 30 min Cache. */
async function wxText(ctx, q) {
  const u = (() => { try { return new URL(q.get('url') || ''); } catch { return null; } })();
  if (!u || u.protocol !== 'https:' || !WXTEXT_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))) return err('host not allowed');
  const sel = (q.get('sel') || '').slice(0, 120);
  const data = await cached(ctx, `wxtext/${await sha(u.toString() + '|' + sel)}`, 1800, async () => {
    const r = await get(u.toString(), { accept: 'text/html,text/plain;q=0.9,*/*;q=0.5' }, 20000);
    const ct = (r.headers.get('Content-Type') || '').toLowerCase();
    let text = '';
    if (ct.includes('text/html')) {
      // Skripte/Styles vorab entfernen, dann Text des Selektors sammeln; Blockelemente als Zeilenumbruch
      const html = (await r.text()).replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ');
      const root = sel || 'main';
      const parts = [];
      const rw = new HTMLRewriter()
        .on(root, { text(tx) { parts.push(tx.text); } })
        .on(`${root} p, ${root} div, ${root} li, ${root} h1, ${root} h2, ${root} h3, ${root} h4, ${root} br, ${root} tr, ${root} section, ${root} article`, { element() { parts.push('\n'); } });
      await rw.transform(new Response(html, { headers: { 'Content-Type': 'text/html' } })).text();
      text = parts.join('').replace(/<[^>]+>/g, '');
      if (!text.trim() && root === 'main') {   // kein <main>: ganzer Body
        const p2 = [];
        await new HTMLRewriter().on('body', { text(tx) { p2.push(tx.text); } }).on('body p, body div, body li, body h1, body h2, body h3, body br', { element() { p2.push('\n'); } }).transform(new Response(html, { headers: { 'Content-Type': 'text/html' } })).text();
        text = p2.join('');
      }
    } else {
      const buf = await r.arrayBuffer();
      text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      if (/\uFFFD/.test(text)) text = new TextDecoder('iso-8859-1').decode(buf);
    }
    text = text.replace(/&nbsp;/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
    if (!text) throw new Error('empty');
    return { text: text.slice(0, 8000), truncated: text.length > 8000, fetched: Date.now(), url: u.toString() };
  });
  return json(data);
}

// ------------------------------------------------------------ Webcams im Umkreis (Windy Webcams API v3 + OpenStreetMap)
/** Öffentliche Webcams rund um einen Punkt, europaweit: Windy (Schlüssel `windy_webcams`, Bildlinks 10 min gültig)
 *  und OpenStreetMap-Punkte mit Webcam-Tag und Adresse (Overpass, ohne Schlüssel). Sortiert nach Distanz. */
async function webcams(env, decrypt, ctx, q) {
  const lat = q.get('lat') == null ? NaN : +q.get('lat'), lon = q.get('lon') == null ? NaN : +q.get('lon'), km = Math.min(100, Math.max(5, Math.round(+q.get('km') || 40)));
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return err('lat/lon');
  const key = await getSecret(env, decrypt, 'windy_webcams');
  const cell = `${lat.toFixed(2)},${lon.toFixed(2)},${km}`;
  const data = await cached(ctx, `webcams/${key ? 'w' : 'o'}/${cell}`, key ? 540 : 21600, async () => {
    const out = []; const errs = []; const sources = [];
    if (key) {
      try {
        const u = `https://api.windy.com/webcams/api/v3/webcams?nearby=${lat.toFixed(4)},${lon.toFixed(4)},${km}&include=location,images,urls&limit=50&sortKey=popularity&sortDirection=desc`;
        const j = await (await get(u, { headers: { 'x-windy-api-key': key } }, 15000)).json();
        for (const w of j.webcams || []) {
          if ((w.status && w.status !== 'active') || w.location?.latitude == null) continue;
          out.push({ id: `windy:${w.webcamId}`, name: w.title || 'Webcam', lat: w.location.latitude, lon: w.location.longitude, place: [w.location.city, w.location.country_code].filter(Boolean).join(', '), url: w.urls?.detail || `https://www.windy.com/webcams/${w.webcamId}`, img: w.images?.current?.preview || w.images?.current?.thumbnail || null, icon: w.images?.current?.icon || null, updated: w.lastUpdatedOn || null, src: 'Windy' });
        }
        sources.push('Windy Webcams');
      } catch (e) { errs.push(`Windy: ${e.message}`); }
    }
    try {
      const r = km * 1000;
      const ql = `[out:json][timeout:20];(node["man_made"="surveillance"]["surveillance:type"="webcam"](around:${r},${lat.toFixed(4)},${lon.toFixed(4)});nwr["contact:webcam"](around:${r},${lat.toFixed(4)},${lon.toFixed(4)});nwr["webcam"~"^https?://"](around:${r},${lat.toFixed(4)},${lon.toFixed(4)}););out center 120;`;
      const j = await (await get('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(ql), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 25000)).json();
      for (const el of j.elements || []) {
        const tg = el.tags || {}; const la = el.lat ?? el.center?.lat, lo = el.lon ?? el.center?.lon;
        const url = [tg['contact:webcam'], tg.webcam, tg.website, tg['contact:website'], tg.url, tg.image].find((x) => /^https?:\/\//.test(x || ''));
        if (la == null || !url) continue;
        if (out.some((o) => distKm(o.lat, o.lon, la, lo) < 0.15)) continue;   // schon über Windy bekannt
        out.push({ id: `osm:${el.type}${el.id}`, name: tg.name || tg.description || tg.operator || 'Webcam', lat: la, lon: lo, place: [tg['addr:city'], tg['addr:country']].filter(Boolean).join(', '), url, img: null, icon: null, updated: null, src: 'OSM' });
      }
      sources.push('OpenStreetMap');
    } catch (e) { errs.push(`OSM: ${e.message}`); }
    for (const o of out) o.distKm = Math.round(distKm(lat, lon, o.lat, o.lon) * 10) / 10;
    out.sort((a, b) => a.distKm - b.distKm);
    return { webcams: out.slice(0, 80), total: out.length, hasKey: !!key, source: sources.join(' + '), errors: errs, generated: new Date().toISOString() };
  });
  return json(data);
}

// ------------------------------------------------------------ Lufträume (openAIP Core API)
/** Lufträume im Kartenausschnitt; Schlüssel `openaip` (Zugänge) oder – Rückfall – der Kachel-Schlüssel aus den
 *  Einstellungen (`key`, im Browser ohnehin sichtbar). 6 h Cache je Ausschnitt (auf 0.05° gerundet). */
async function airspace(env, decrypt, ctx, q) {
  const bb = (q.get('bbox') || '').split(',').map(Number);
  if (bb.length !== 4 || bb.some((v) => !isFinite(v)) || bb[0] >= bb[2] || bb[1] >= bb[3] || Math.abs(bb[1]) > 90 || Math.abs(bb[3]) > 90) return err('bbox');
  if ((bb[2] - bb[0]) > 6 || (bb[3] - bb[1]) > 4) return err('bbox too large');
  const key = await getSecret(env, decrypt, 'openaip') || (/^[A-Za-z0-9]{16,80}$/.test(q.get('key') || '') ? q.get('key') : null);
  if (!key) return err('openAIP-Schlüssel fehlt (Einstellungen → Zugänge: openaip)', 424);
  const r5 = (v) => (Math.round(v / 0.05) * 0.05).toFixed(2);
  const cell = bb.map(r5).join(',');
  let data;
  try { data = await cached(ctx, `airspace/${cell}`, 21600, async () => {
    const fetchAll = async (bboxStr) => {
      const items = [];
      for (let page = 1; page <= 4; page++) {
        const u = `https://api.core.openaip.net/api/airspaces?bbox=${bboxStr}&limit=1000&page=${page}`;
        const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 25000);
        let j;
        try {
          const r = await fetch(u, { headers: { 'x-openaip-api-key': key, 'User-Agent': UA, Accept: 'application/json' }, signal: ctl.signal });
          if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)}`);   // Antworttext für die Diagnose (Sperre vs. Schlüssel)
          j = await r.json();
        } finally { clearTimeout(tm); }
        items.push(...(j.items || []));
        if (!j.totalPages || page >= j.totalPages) break;
      }
      return items;
    };
    // openAIP erwartet minLon,minLat,maxLon,maxLat; bei HTTP 400 Rückfall auf lat/lon-Reihenfolge.
    // 0.14.2: 401/403/429/5xx werden nicht mehr still zu einer leeren Liste (das Panel meldete «kein Luftraum»),
    // sondern als Fehler gemeldet – und nicht gecacht.
    const why = (e) => { const m = /HTTP (\d{3})/.exec(e.message); const c = m ? +m[1] : 0; return c === 401 || c === 403 ? `openAIP ${e.message} – Abruf abgewiesen (Schlüssel «openaip» prüfen; sperrt openAIP den Worker?)` : c === 429 ? 'openAIP HTTP 429: Abfragelimit erreicht – später erneut' : `openAIP: ${e.message}`; };
    let items = [];
    try { items = await fetchAll(cell); }
    catch (e) {
      if (!/HTTP 400/.test(e.message)) throw new Error(why(e));
      try { items = await fetchAll([bb[1], bb[0], bb[3], bb[2]].map(r5).join(',')); } catch (e2) { throw new Error(why(e2)); }
    }
    const slim = items.map((it) => ({ _id: it._id, name: it.name, type: it.type, icaoClass: it.icaoClass, country: it.country, activity: it.activity, onDemand: it.onDemand, onRequest: it.onRequest, byNotam: it.byNotam, specialAgreement: it.specialAgreement, upperLimit: it.upperLimit, lowerLimit: it.lowerLimit, hoursOfOperation: it.hoursOfOperation, transponderCode: it.transponderCode, frequencies: it.frequencies, geometry: it.geometry }));
    return { items: slim, total: slim.length, source: 'openAIP', generated: new Date().toISOString(), ...(slim.length ? {} : { warning: 'openAIP lieferte keine Lufträume für diesen Ausschnitt' }) };
  }); } catch (e) { return err(e.message, 502); }
  return json(data);
}

// ------------------------------------------------------------ Radiosondierung (Payerne 06610 u. a.)
/** Letzte Sondierung einer WMO-Station als Niveau-Liste. Quelle: Archiv der University of Wyoming
 *  (TEXT:LIST, dieselbe Messung wie bei MeteoSchweiz, dort nur per JavaScript). 00Z/12Z, Rückschau 36 h. 1 h Cache. */
async function sounding(ctx, q) {
  const stn = (q.get('stn') || '06610').replace(/[^0-9A-Z]/g, '').slice(0, 6);
  const data = await cached(ctx, `sounding/${stn}/${Math.floor(Date.now() / 3600000)}`, 3600, async () => {
    const now = new Date();
    const tries = [];
    for (let k = 0; k < 4; k++) {   // letzte 00Z/12Z-Termine
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() >= 12 ? 12 : 0) - k * 12 * 3600000);
      tries.push(d);
    }
    let last = null;
    for (const d of tries) {
      const y = d.getUTCFullYear(), m = String(d.getUTCMonth() + 1).padStart(2, '0'), dd = String(d.getUTCDate()).padStart(2, '0'), hh = String(d.getUTCHours()).padStart(2, '0');
      const urls = [
        `https://weather.uwyo.edu/wsgi/sounding?datetime=${y}-${m}-${dd}%20${hh}:00:00&id=${stn}&type=TEXT:LIST`,
        `https://weather.uwyo.edu/cgi-bin/sounding?region=europe&TYPE=TEXT%3ALIST&YEAR=${y}&MONTH=${m}&FROM=${dd}${hh}&TO=${dd}${hh}&STNM=${stn}`,
      ];
      for (const u of urls) {
        try {
          const html = await (await get(u, { accept: 'text/html' }, 20000)).text();
          const pre = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(html)?.[1];
          if (!pre || !/PRES\s+HGHT\s+TEMP/.test(pre)) { last = `${u}: keine Tabelle`; continue; }
          const levels = [];
          for (const line of pre.split('\n')) {
            const m2 = /^\s*(\d{3,4}\.\d)\s+(\d+)\s+(-?\d+\.\d)\s+(-?\d+\.\d)\s+(\d+)\s+(\d+\.\d+)\s+(\d+)\s+(\d+)/.exec(line);
            if (m2) levels.push({ hPa: +m2[1], m: +m2[2], temp: +m2[3], dew: +m2[4], rh: +m2[5], dir: +m2[7], kt: +m2[8] });
          }
          if (levels.length < 5) { last = `${u}: zu wenig Niveaus`; continue; }
          const title = /<h2[^>]*>([^<]*)<\/h2>/i.exec(html)?.[1]?.trim() || '';
          return { station: stn, time: d.toISOString(), title, levels, source: 'University of Wyoming (Radiosonde)', url: u, generated: new Date().toISOString() };
        } catch (e) { last = `${u}: ${e.message}`; }
      }
    }
    throw new Error(`Sondierung ${stn} nicht verfügbar (${last || '?'})`);
  });
  return json(data);
}

// ------------------------------------------------------------ Wetterstationen im Umkreis (Beobachtungen)
/** SwissMetNet (MeteoSchweiz) über api.existenz.ch; Liste wie cockpit.wicki.aero. */
const SMN = [
  ['ABO','Adelboden',46.491703,7.560703],['AEG','Oberägeri',47.133636,8.608206],['AIG','Aigle',46.326647,6.924472],['ALT','Altdorf',46.887069,8.621894],['AND','Andeer',46.610139,9.431981],['ANT','Andermatt',46.630914,8.580553],['ARH','Altenrhein',47.483631,9.56685],['ARO','Arosa',46.792661,9.679014],['ATT','Les Attelas',46.0991,7.26865],['BAN','Bantiger',46.977806,7.528667],['BAS','Basel',47.541142,7.583525],['BEH','Passo del Bernina',46.409158,10.019567],['BER','Bern',46.990744,7.464061],['BEZ','Beznau',47.557256,8.233325],['BIA','Biasca',46.336053,8.978197],['BIE','Bière',46.524908,6.342386],['BIN','Binn',46.367661,8.192306],['BIV','Bivio',46.462494,9.668639],['BIZ','Bischofszell',47.508828,9.266797],['BLA','Blatten',46.422261,7.825914],['BOL','Boltigen',46.623519,7.384206],['BOU','Bouveret',46.393447,6.857006],['BRL','La Brevine',46.983844,6.610297],['BRZ','Brienz',46.740719,8.060864],['BUF','Buffalora',46.648408,10.2672],['BUS','Buchs/Aarau',47.384381,8.07955],['CDF','La Chaux-de-Fonds',47.082947,6.792314],['CDM','Col des Mosses',46.391525,7.098239],['CEV','Cevio',46.320486,8.603161],['CGI','Nyon',46.401053,6.227722],['CHA','Chasseral',47.131761,7.054367],['CHB','Les Charbonnieres',46.67015,6.312428],['CHD','Chateau-dOex',46.479819,7.139656],['CHM','Chaumont',47.049169,6.978825],['CHU','Chur',46.870572,9.530761],['CHZ','Cham',47.188278,8.464642],['CIM','Cimetta',46.200467,8.79165],['CMA','Crap Masegn',46.842275,9.180042],['COM','Comprovasco',46.459517,8.935486],['COV','Piz Corvatsch',46.418039,9.821308],['COY','Courtelary',47.180811,7.090656],['CRM','Cressier',47.047581,7.059147],['DAV','Davos',46.812969,9.843558],['DEM','Delemont',47.351706,7.349567],['DIA','Les Diablerets',46.32675,7.203781],['DIS','Disentis',46.706569,8.853478],['DOL','La Dole',46.424794,6.099453],['EBK','Ebnat-Kappel',47.273389,9.108494],['EGH','Eggishorn',46.426528,8.092728],['EGO','Egolzwil',47.179428,8.004758],['EIN','Einsiedeln',47.133042,8.756556],['ELM','Elm',46.923742,9.175347],['ENG','Engelberg',46.821639,8.410514],['EVI','Evionnaz',46.182953,7.026747],['EVO','Evolene',46.112211,7.508631],['FAH','Fahy',47.423814,6.941194],['FLU','Fluhli',46.889436,8.020336],['FRE','La Fretaz',46.840622,6.576369],['FRU','Frutigen',46.599003,7.657542],['GEN','Monte Generoso',45.927592,9.017875],['GES','Gersau',46.996069,8.523442],['GIH','Giswil',46.849447,8.190225],['GLA','Glarus',47.034586,9.066961],['GOE','Gosgen',47.363147,7.973733],['GOR','Gornergrat',45.983644,7.785944],['GOS','Goschenen',46.692678,8.595364],['GRA','Fribourg/Grangeneuve',46.7714,7.113736],['GRC','Grachen',46.195314,7.836822],['GRE','Grenchen',47.179097,7.415144],['GRH','Grimsel Hospiz',46.571689,8.333256],['GRO','Grono',46.255075,9.163758],['GSB','Grand St-Bernard',45.869092,7.170683],['GUE','Gutsch/Andermatt',46.652475,8.615531],['GUT','Guttingen',47.601733,9.279428],['GVE','Geneve',46.247519,6.127742],['HAI','Salen-Reutenen',47.651242,9.023911],['HLL','Hallau',47.697278,8.470464],['HOE','Hornli',47.370864,8.941644],['ILZ','Ilanz',46.775039,9.215353],['INT','Interlaken',46.672033,7.87045],['JUN','Jungfraujoch',46.547556,7.985444],['KLO','Zurich/Kloten',47.479611,8.535961],['KOP','Koppigen',47.11885,7.605503],['LAC','Lachen',47.179197,8.858686],['LAE','Lagern',47.481933,8.397222],['LAG','Langnau',46.939633,7.806425],['LAT','Bergun/Latsch',46.627275,9.753706],['LEI','Leibstadt',47.597361,8.1882],['LUG','Lugano',46.004217,8.960322],['LUZ','Luzern',47.036439,8.301022],['MAG','Magadino',46.160025,8.933672],['MAH','Mathod',46.736978,6.567983],['MAR','Les Marecottes',46.118903,7.016597],['MAS','Marsens',46.656486,7.069669],['MER','Meiringen',46.732222,8.169247],['MLS','Le Moleson',46.546197,7.017753],['MOA','Mosen',47.243847,8.232831],['MOB','Montagnier',46.071019,7.225272],['MOE','Mohlin',47.572197,7.877911],['MRP','Monte Rosa-Plattje',45.956628,7.814575]
];
const DEW = (t, rh) => { if (t == null || rh == null || rh <= 0) return null; const a = 17.62, b = 243.12; const g = Math.log(rh / 100) + a * t / (b + t); return Math.round(b * g / (a - g) * 10) / 10; };
/**
 * Beobachtungen der Wetterstationen im Umkreis: CH SwissMetNet (api.existenz.ch), DE DWD (Bright Sky),
 * übriges Europa EUMETNET MeteoGate/E-SOH. Rückgabe vereinheitlicht: [{ id, name, lat, lon, km, time, dir, kt, gustKt, tempC, dewC, rh, qnh, precipMm, src }].
 */
/** 0.12.17: regionale Messnetze (offene Daten). Jede Quelle nur, wenn ihr Gebiet den Umkreis berührt; Fehler je Quelle in errors. */
const REGIONS = {
  at: { lat: [46.3, 49.1], lon: [9.4, 17.2] }, st: { lat: [46.2, 47.1], lon: [10.3, 12.5] },
  it: { lat: [35.4, 47.2], lon: [6.5, 18.7] }, fr: { lat: [42.0, 51.2], lon: [-5.2, 8.3] },
};
const MS_KT = 1.943844;
const localIsoToMs = (s, tz = 'Europe/Rome') => {   // «2026-10-11T18:30:00» (Lokalzeit ohne Zone) → UTC-ms über die Zeitzonenregel
  const d = new Date(s + 'Z'); if (isNaN(d)) return null;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d);
  const g = (t) => +parts.find((x) => x.type === t).value;
  const asLocal = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'));
  return d.getTime() - (asLocal - d.getTime());
};
async function regionalStations(ctx, env, decrypt, lat, lon, km, push, errors, diag) {
  const dLat = km / 111, dLon = km / (111 * Math.cos(lat * Math.PI / 180));
  const box = { lat: [lat - dLat, lat + dLat], lon: [lon - dLon, lon + dLon] };
  const hits = (r) => box.lat[0] <= r.lat[1] && box.lat[1] >= r.lat[0] && box.lon[0] <= r.lon[1] && box.lon[1] >= r.lon[0];
  const fresh = (ms) => ms != null && Date.now() - ms < 3 * 3600000;
  const inBox = (la, lo) => la >= box.lat[0] && la <= box.lat[1] && lo >= box.lon[0] && lo <= box.lon[1];
  const tasks = [];
  // Österreich: GeoSphere Austria, TAWES 10-min (CC BY 4.0)
  if (hits(REGIONS.at)) tasks.push((async () => {
    const meta = await cached(ctx, 'stations/geosphere-meta', 86400, async () => { const j = await (await get('https://dataset.api.hub.geosphere.at/v1/station/current/tawes-v1-10min/metadata', {}, 15000)).json(); return (j.stations || []).filter((x) => x.is_active !== false).map((x) => ({ id: String(x.id), name: x.name, lat: x.lat, lon: x.lon })); });
    const near = meta.filter((x) => inBox(x.lat, x.lon)).map((x) => ({ ...x, d: distKm(lat, lon, x.lat, x.lon) })).filter((x) => x.d <= km).sort((a, b) => a.d - b.d).slice(0, 40);
    if (!near.length) return;
    const j = await (await get(`https://dataset.api.hub.geosphere.at/v1/station/current/tawes-v1-10min?parameters=TL,TP,FF,DD,FFX,RF,PRED,RR&station_ids=${near.map((x) => x.id).join(',')}`, {}, 15000)).json();
    const TS = (j.timestamps || []).map((t) => Date.parse(t));   // mehrere Zeitstempel, wenn Stationen unterschiedlich aktuell sind; data[] ist dazu ausgerichtet
    for (const f of j.features || []) {
      const st = near.find((x) => x.id === String(f.properties?.station)); if (!st) continue;
      const P = f.properties.parameters || {}; let ti = -1;
      const v = (k) => { const d = P[k]?.data || []; for (let i = d.length - 1; i >= 0; i--) if (d[i] != null) { ti = Math.max(ti, i); return d[i]; } return null; };
      const row = { dir: v('DD') != null ? Math.round(v('DD')) : null, kt: v('FF') != null ? Math.round(v('FF') * MS_KT * 10) / 10 : null, gustKt: v('FFX') != null ? Math.round(v('FFX') * MS_KT) : null, tempC: v('TL'), dewC: v('TP') ?? DEW(v('TL'), v('RF')), rh: v('RF') != null ? Math.round(v('RF')) : null, qnh: v('PRED') != null ? Math.round(v('PRED')) : null, precipMm: v('RR') };
      const ts = ti >= 0 ? TS[ti] : null; if (!fresh(ts)) continue;
      push({ id: `at-${st.id}`, name: st.name.replace(/\b([A-ZÄÖÜ])([A-ZÄÖÜ]{2,})\b/g, (m, a, b) => a + b.toLowerCase()), lat: st.lat, lon: st.lon, time: new Date(ts).toISOString(), ...row, src: 'GeoSphere Austria' });
    }
  })().catch((e) => errors.push('GeoSphere: ' + e.message)));
  // Südtirol: Landeswetterdienst, Open Data (CC0) – Stationsliste + alle aktuellen Sensorwerte in einem Abruf
  if (hits(REGIONS.st)) tasks.push((async () => {
    const [stn, sens] = await Promise.all([
      cached(ctx, 'stations/suedtirol-stations', 86400, async () => { const j = await (await get('https://geoservices.buergernetz.bz.it/services/meteo/v1/stations?coord_sys=EPSG:4326', {}, 15000)).json(); return (j.features || []).map((f) => ({ id: f.properties.SCODE, name: f.properties.NAME_D, lat: +f.properties.LAT, lon: +f.properties.LONG })); }),
      cached(ctx, 'stations/suedtirol-sensors', 600, async () => (await get('https://geoservices.buergernetz.bz.it/services/meteo/v1/sensors', {}, 20000)).json()),
    ]);
    const by = {};
    for (const x of sens || []) { if (!['LT', 'LF', 'WG', 'WR', 'WG.BOE', 'LD.RED', 'N'].includes(x.TYPE)) continue; const ms = Date.parse(String(x.DATE).replace(/CEST$/, '+02:00').replace(/CET$/, '+01:00')); if (!fresh(ms)) continue; (by[x.SCODE] = by[x.SCODE] || { ms: 0 })[x.TYPE] = x.VALUE; by[x.SCODE].ms = Math.max(by[x.SCODE].ms, ms); }
    for (const st of stn) { const v = by[st.id]; if (!v || !inBox(st.lat, st.lon) || (v.LT == null && v.WG == null)) continue;
      push({ id: `st-${st.id}`, name: st.name.replace(/\b([A-ZÄÖÜ])([A-ZÄÖÜ]{2,})\b/g, (m, a, b) => a + b.toLowerCase()), lat: st.lat, lon: st.lon, time: new Date(v.ms).toISOString(), dir: v.WR != null ? Math.round(v.WR) : null, kt: v.WG != null ? Math.round(v.WG * MS_KT * 10) / 10 : null, gustKt: v['WG.BOE'] != null ? Math.round(v['WG.BOE'] * MS_KT) : null, tempC: v.LT ?? null, dewC: DEW(v.LT, v.LF), rh: v.LF != null ? Math.round(v.LF) : null, qnh: v['LD.RED'] != null ? Math.round(v['LD.RED']) : null, precipMm: v.N ?? null, src: 'Südtirol' }); }
  })().catch((e) => errors.push('Südtirol: ' + e.message)));
  // Italien: Meteo-Hub (Agenzia ItaliaMeteo/CINECA) – Beobachtungskarte-API ohne Anmeldung, CC BY 4.0: regionale Netze
  // (DPCN Veneto/Lombardia/Piemonte/Liguria/…, Open-Trentino, SIR Toscana, ARPA FVG, Emilia-Romagna); je Grösse ein Abruf,
  // letzter Wert je Station; Amateurnetz «mnw» (MeteoNetwork) gekennzeichnet (0.12.17c). 0.12.17a (ersetzt Meteotrentino/ARPA-Socrata)
  if (hits(REGIONS.it)) tasks.push((async () => {
    const f = (d) => d.toISOString().slice(0, 16).replace('T', ' ');
    const from = f(new Date(Date.now() - 100 * 60000)), to = f(new Date(Date.now() + 10 * 60000));
    const bb = `lonmin=${box.lon[0].toFixed(3)}&lonmax=${box.lon[1].toFixed(3)}&latmin=${box.lat[0].toFixed(3)}&latmax=${box.lat[1].toFixed(3)}`;
    const VARS = { B12101: 'tt', B11001: 'dd', B11002: 'ff', B11041: 'fx', B13003: 'rh', B13011: 'rr' };
    const TR = { B11041: ';timerange:2,0,3600', B13011: ';timerange:1,0,3600' };
    const st = {};
    await Promise.all(Object.keys(VARS).map(async (v) => {
      const j = await (await get(`https://meteohub.agenziaitaliameteo.it/api/observations?q=${encodeURIComponent(`reftime: >=${from},<=${to};product:${v};license:CCBY_COMPLIANT${TR[v] || ''}`)}&reliabilityCheck=true&last=true&${bb}`, {}, 15000)).json();
      for (const s of j.data || []) {
        const net = s.stat?.net; if (!net || (net === 'dpcn-bolzanoboze' && hits(REGIONS.st)) || s.stat.lat == null) continue;   // Südtirol direkt (10-min, QNH); «mnw» = Amateurnetz, gekennzeichnet (Entscheid 12.10.2026)
        const vals = (s.prod?.[0]?.val || []).filter((x) => x.val != null && x.rel !== 0); if (!vals.length) continue;
        const last = vals[vals.length - 1]; const ms = Date.parse(last.ref + 'Z'); if (!fresh(ms)) continue;
        const key = `${net}/${s.stat.lat.toFixed(4)},${s.stat.lon.toFixed(4)}`;
        const o = (st[key] = st[key] || { net, lat: s.stat.lat, lon: s.stat.lon, name: (s.stat.details || []).find((d) => d.var === 'B01019')?.val || '', v: {}, ms: 0 });
        o.v[VARS[v]] = last.val; o.ms = Math.max(o.ms, ms);
      }
    }));
    const REG = { mnw: 'MeteoNetwork (Amateur)', 'open-trentino': 'Trentino', 'sir-toscana': 'Toscana', arpafvg: 'Friuli VG', agrmet: 'Emilia-Romagna', locali: 'Emilia-Romagna', simnbo: 'Emilia-Romagna', simnpr: 'Emilia-Romagna', spdsra: 'Emilia-Romagna', urbane: 'Emilia-Romagna', claster: 'Emilia-Romagna', 'dpcn-bolzanoboze': 'Südtirol' };
    const region = (net) => REG[net] || (net.startsWith('dpcn-') ? net.slice(5).replace(/^./, (c) => c.toUpperCase()) : net);
    for (const o of Object.values(st)) {
      if (o.v.tt == null && o.v.ff == null) continue;
      const tempC = o.v.tt != null ? Math.round((o.v.tt - 273.15) * 10) / 10 : null;
      push({ id: `it-${o.net}-${o.lat.toFixed(3)},${o.lon.toFixed(3)}`, name: (o.name || region(o.net)).replace(/^[A-Z]{1,2}\d{3,5}\s*-\s*/, '').replace(/^SM\s+/, '').replace(/\s+/g, ' ').trim(), lat: o.lat, lon: o.lon, time: new Date(o.ms).toISOString(), dir: o.v.dd != null ? Math.round(o.v.dd) : null, kt: o.v.ff != null ? Math.round(o.v.ff * MS_KT * 10) / 10 : null, gustKt: o.v.fx != null ? Math.round(o.v.fx * MS_KT) : null, tempC, dewC: DEW(tempC, o.v.rh), rh: o.v.rh != null ? Math.round(o.v.rh) : null, qnh: null, precipMm: o.v.rr != null ? Math.round(o.v.rr * 10) / 10 : null, src: o.net === 'mnw' ? 'MeteoNetwork (Amateur)' : `Meteo-Hub ${region(o.net)}`, amateur: o.net === 'mnw' || undefined });
    }
  })().catch((e) => errors.push('Meteo-Hub: ' + e.message)));
  // Frankreich: Météo-France «Données d'observation» (Portail API, Schlüssel «meteofrance_key» in den Zugängen) – 6-min-Werte je Station, die 15 nächsten
  if (hits(REGIONS.fr)) tasks.push((async () => {
    const key = env && decrypt ? await getSecret(env, decrypt, 'meteofrance_key') : null;
    if (!key) return;
    // Portail API: entweder ein API-Schlüssel (JWT, Kopfzeile «apikey») oder die Application-ID → OAuth2-Token (1 h, hier 50 min gecacht)
    const H = { headers: /^eyJ/.test(key) ? { apikey: key } : { Authorization: `Bearer ${await cached(ctx, 'mf-token', 3000, async () => { const r = await fetch('https://portail-api.meteofrance.fr/token', { method: 'POST', headers: { Authorization: `Basic ${key}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, body: 'grant_type=client_credentials' }); if (!r.ok) throw new Error('Token HTTP ' + r.status); return (await r.json()).access_token; })}` } };
    const list = await cached(ctx, 'stations/mf-stations', 86400, async () => { const csv = await (await get('https://public-api.meteofrance.fr/public/DPObs/v1/liste-stations', { ...H, accept: 'text/csv' }, 20000)).text(); const rows = csv.split(/\r?\n/).filter(Boolean); const head = rows[0].split(';').map((x) => x.trim().toLowerCase()); const ix = (n) => head.findIndex((h) => h.includes(n)); const iId = ix('id_station'), iName = ix('nom'), iLat = ix('latitude'), iLon = ix('longitude'); return rows.slice(1).map((r) => r.split(';')).filter((c) => c.length > 3).map((c) => ({ id: c[iId], name: c[iName], lat: +c[iLat], lon: +c[iLon] })).filter((x) => isFinite(x.lat)); });
    const near = list.filter((x) => inBox(x.lat, x.lon)).map((x) => ({ ...x, d: distKm(lat, lon, x.lat, x.lon) })).filter((x) => x.d <= km).sort((a, b) => a.d - b.d).slice(0, 15);
    const res = await Promise.allSettled(near.map((st) => get(`https://public-api.meteofrance.fr/public/DPObs/v1/station/infrahoraire-6m?id_station=${st.id}&format=json`, H, 15000).then((r) => r.json()).then((j) => ({ st, j }))));
    for (const r of res) {
      if (r.status !== 'fulfilled') continue; const { st, j } = r.value; const o = Array.isArray(j) ? j[j.length - 1] : j?.features ? j.features[j.features.length - 1]?.properties : j; if (!o) continue;
      if (diag && !diag.length) diag.push({ src: 'mf', station: st, keys: Object.keys(o), raw: o });
      const ms = o.validity_time ? Date.parse(o.validity_time) : null; if (!fresh(ms)) continue;
      const k = (x) => (x == null ? null : +x); const tK = k(o.t); const tempC = tK != null ? (tK > 100 ? Math.round((tK - 273.15) * 10) / 10 : tK) : null; const tdK = k(o.td); const dewC = tdK != null ? (tdK > 100 ? Math.round((tdK - 273.15) * 10) / 10 : tdK) : null;
      push({ id: `fr-${st.id}`, name: String(st.name || '').replace(/_/g, ' ').toLowerCase().replace(/(^|[\s\-'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()).replace(/\bSapc\b/, 'SAPC'), lat: st.lat, lon: st.lon, time: new Date(ms).toISOString(), dir: k(o.dd) != null ? Math.round(k(o.dd)) : null, kt: k(o.ff) != null ? Math.round(k(o.ff) * MS_KT * 10) / 10 : null, gustKt: k(o.fxi10) != null ? Math.round(k(o.fxi10) * MS_KT) : null, tempC, dewC, rh: k(o.u) != null ? Math.round(k(o.u)) : null, qnh: k(o.pmer) != null ? Math.round(k(o.pmer) > 2000 ? k(o.pmer) / 100 : k(o.pmer)) : null, precipMm: k(o.rr_per), visM: k(o.vv) != null && k(o.vv) >= 0 ? Math.round(k(o.vv)) : null, src: 'Météo-France' });   // vv: Sichtweite in m (0.12.17d, nur Météo-France)
    }
  })().catch((e) => errors.push('Météo-France: ' + e.message)));
  await Promise.all(tasks);
}
async function stations(ctx, q, env, decrypt) {
  if (q.get('lat') == null || q.get('lon') == null) return err('lat/lon');
  const lat = +q.get('lat'), lon = +q.get('lon'), km = Math.min(150, Math.max(10, +q.get('km') || 50));
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return err('lat/lon');
  const diag = q.get('diag') === 'mf' ? [] : null;   // 0.12.17c: Rohdatensatz der ersten Météo-France-Station (Felder prüfen), ohne Cache
  const data = await cached(ctx, `stations/${lat.toFixed(2)},${lon.toFixed(2)},${km}${diag ? ',diag' + Date.now() : ''}`, 600, async () => {
    const out = [], errors = [];
    const push = (st) => { if (st.lat == null || (st.tempC == null && st.dir == null && st.kt == null)) return; st.km = Math.round(distKm(lat, lon, st.lat, st.lon) * 10) / 10; if (st.km <= km) out.push(st); };
    // CH
    // 0.12.17a: vollständige SwissMetNet-Liste (161 Stationen, z. B. Zürich/Fluntern, Affoltern) von api.existenz.ch, 24 h gecacht; Rückfall: eingebaute Tabelle (100)
    const smnList = await cached(ctx, 'stations/smn-locations', 86400, async () => { const j = await (await get(`https://api.existenz.ch/apiv1/smn/locations?app=fahrtbriefing&version=${encodeURIComponent(UA.split(' ')[0])}`, {}, 15000)).json(); const out = Object.values(j.payload || {}).map((x) => [x.details?.id || x.name, x.details?.name || x.name, +x.details?.lat, +x.details?.lon]).filter((x) => x[0] && isFinite(x[2]) && isFinite(x[3])); if (out.length < 100) throw new Error('SMN-Liste unvollständig'); return out; }).catch(() => SMN);
    const chNear = smnList.map(([code, name, la, lo]) => ({ code, name, lat: la, lon: lo, d: distKm(lat, lon, la, lo) })).filter((s) => s.d <= km).sort((a, b) => a.d - b.d).slice(0, 40);
    if (chNear.length) {
      try {
        const j = await (await get(`https://api.existenz.ch/apiv1/smn/latest?locations=${chNear.map((s) => s.code).join(',')}&parameters=dd,ff,ffx,tt,rh,pp,rr&app=fahrtbriefing&version=${encodeURIComponent(UA.split(' ')[0])}`, {}, 15000)).json();
        const by = {};
        const add = (code, p, v, ts) => { if (v == null || isNaN(+v)) return; (by[code] = by[code] || {})[p] = +v; if (ts) by[code].ts = ts; };
        const recs = Array.isArray(j) ? j : Array.isArray(j?.payload) ? j.payload : [];
        for (const r of recs) { const code = r.loc || r.location || r.station; if (!code) continue; if (r.par && r.val != null) add(code, r.par, r.val, r.timestamp); else if (r.parameter && r.value != null) add(code, r.parameter, r.value, r.timestamp); else for (const k of ['dd', 'ff', 'ffx', 'tt', 'rh', 'pp', 'rr']) if (r[k] != null) add(code, k, r[k], r.timestamp); }
        if (!recs.length && j && typeof j === 'object') for (const [code, rec] of Object.entries(j)) { const v = rec?.values || rec; if (v && typeof v === 'object') for (const k of ['dd', 'ff', 'ffx', 'tt', 'rh', 'pp', 'rr']) { const x = v[k]; if (x != null) add(code, k, typeof x === 'object' ? x.value : x, v.timestamp || rec.timestamp); } }
        for (const s of chNear) { const v = by[s.code]; if (!v) continue; push({ id: s.code, name: s.name, lat: s.lat, lon: s.lon, time: v.ts ? new Date((v.ts > 1e12 ? v.ts : v.ts * 1000)).toISOString() : null, dir: v.dd ?? null, kt: v.ff != null ? Math.round(v.ff / 1.852 * 10) / 10 : null, gustKt: v.ffx != null ? Math.round(v.ffx / 1.852 * 10) / 10 : null, tempC: v.tt ?? null, rh: v.rh ?? null, dewC: DEW(v.tt, v.rh), qnh: v.pp ?? null, precipMm: v.rr ?? null, src: 'SwissMetNet' }); }
      } catch (e) { errors.push('SMN: ' + e.message); }
    }
    // DE: Bright Sky – nächste DWD-Station je Rasterpunkt (nur innerhalb Deutschlands Treffer)
    // 0.12.17a: nur Rasterpunkte innerhalb Deutschlands (sonst 19 Leerabfragen – Limit von 50 Unteranfragen je Aufruf wurde in Bozen überschritten), zwei Ringe
    const inDE = (la, lo) => la >= 47.2 && la <= 55.2 && lo >= 5.8 && lo <= 15.1;
    const pts = [[lat, lon]];
    for (const r of [km / 2, km]) for (let a = 0; a < 360; a += 60) { const d = r / 111; pts.push([lat + d * Math.cos(a * Math.PI / 180), lon + d * Math.sin(a * Math.PI / 180) / Math.cos(lat * Math.PI / 180)]); }
    const seen = new Set();
    const deRes = await Promise.allSettled(pts.filter(([la, lo]) => inDE(la, lo)).slice(0, 13).map(([la, lo]) => get(`https://api.brightsky.dev/current_weather?lat=${la.toFixed(3)}&lon=${lo.toFixed(3)}&max_dist=${Math.round(Math.min(60000, km * 1000))}`, {}, 10000).then((r) => r.json()).catch((e) => { if (!/HTTP 404/.test(e.message)) errors.push('BrightSky: ' + e.message); return null; })));
    for (const r of deRes) { const j = r.status === 'fulfilled' ? r.value : null; if (!j?.weather) continue; const src = j.sources?.[0] || {}; const key = src.dwd_station_id || src.station_name; if (!key || seen.has(key)) continue; seen.add(key); const w = j.weather; push({ id: src.dwd_station_id || '', name: src.station_name || 'DWD', lat: src.lat, lon: src.lon, time: w.timestamp || null, dir: w.wind_direction_10 ?? w.wind_direction ?? null, kt: (w.wind_speed_10 ?? w.wind_speed) != null ? Math.round((w.wind_speed_10 ?? w.wind_speed) / 1.852 * 10) / 10 : null, gustKt: (w.wind_gust_speed_10 ?? w.wind_gust_speed) != null ? Math.round((w.wind_gust_speed_10 ?? w.wind_gust_speed) / 1.852 * 10) / 10 : null, tempC: w.temperature ?? null, rh: w.relative_humidity ?? null, dewC: w.dew_point ?? DEW(w.temperature, w.relative_humidity), qnh: w.pressure_msl ?? null, precipMm: w.precipitation_60 ?? w.precipitation_10 ?? null, src: 'DWD (Bright Sky)' }); }
    // 0.12.17: regionale Netze – Österreich (GeoSphere), Südtirol, Trentino, Lombardei, Frankreich (Météo-France mit Schlüssel)
    await regionalStations(ctx, env, decrypt, lat, lon, km, push, errors, diag);
    // übriges Europa: MeteoGate/E-SOH (EUMETNET, 33 Länder) – 0.12.15: eine Flächenabfrage (EDR «area», letzte 2 h) statt je Station
    // (der «timeseries-link» der Stationsliste liefert keine Reihen); Namen aus der Stationsliste im gleichen Rechteck
    try {
      const dLat = km / 111, dLon = km / (111 * Math.cos(lat * Math.PI / 180));
      const bbox = `${(lon - dLon).toFixed(3)},${(lat - dLat).toFixed(3)},${(lon + dLon).toFixed(3)},${(lat + dLat).toFixed(3)}`;
      const poly = `POLYGON((${(lon - dLon).toFixed(3)} ${(lat - dLat).toFixed(3)},${(lon + dLon).toFixed(3)} ${(lat - dLat).toFixed(3)},${(lon + dLon).toFixed(3)} ${(lat + dLat).toFixed(3)},${(lon - dLon).toFixed(3)} ${(lat + dLat).toFixed(3)},${(lon - dLon).toFixed(3)} ${(lat - dLat).toFixed(3)}))`;
      const PARS = ['wind_speed:10.0:point:PT10M', 'wind_from_direction:10.0:point:PT10M', 'wind_speed_of_gust:10.0:point:PT1H', 'air_temperature:2.0:point:PT0S', 'dew_point_temperature:2.0:point:PT0S', 'relative_humidity:2.0:point:PT0S', 'air_pressure_at_mean_sea_level:0.0:point:PT0S', 'precipitation_amount:1.5:sum:PT1H'];
      const from = new Date(Date.now() - 2 * 3600000).toISOString();
      const [locs, cov] = await Promise.all([
        get(`https://observations.meteogate.eu/collections/observations/locations?bbox=${bbox}`, {}, 15000).then((r) => r.json()).catch(() => ({})),
        get(`https://observations.meteogate.eu/collections/observations/area?coords=${encodeURIComponent(poly)}&parameter-name=${PARS.join(',')}&datetime=${encodeURIComponent(from + '/..')}`, {}, 20000).then((r) => r.json()),
      ]);
      const names = {}; for (const f of locs.features || []) names[f.id] = { name: f.properties?.name || '', lat: f.geometry?.coordinates?.[1], lon: f.geometry?.coordinates?.[0] };
      const byId = {};
      for (const c of cov.coverages || []) {
        const id = c['metocean:wigosId'] || c.id; if (!id) continue;
        const ts = c.domain?.axes?.t?.values || []; const x = c.domain?.axes?.x?.values?.[0], y = c.domain?.axes?.y?.values?.[0];
        const st = (byId[id] = byId[id] || { id, lat: y, lon: x, v: {} });
        for (const [k, rg] of Object.entries(c.ranges || {})) { const vals = rg.values || []; for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null) { const pre = k.split(':')[0]; if (!st.v[pre] || ts[i] > st.v[pre].t) st.v[pre] = { v: vals[i], t: ts[i] }; break; } }
      }
      for (const st of Object.values(byId)) {
        // CH/DE sind über SwissMetNet/Bright Sky abgedeckt – deren WMO-Blöcke (066xx–069xx, 10xxx) nicht nochmals (Doppelnennungen, Entscheid 11.10.2026); übrige zusätzlich 3-km-Regel
        if (st.lat == null || /^0-20000-0-(06[6-9]\d\d|10\d{3})$/.test(String(st.id)) || out.some((o) => distKm(o.lat, o.lon, st.lat, st.lon) < 3)) continue;
        const g = (k) => st.v[k] || null; const dir = g('wind_from_direction'), spd = g('wind_speed'), gst = g('wind_speed_of_gust'), tt = g('air_temperature'), td = g('dew_point_temperature'), rh = g('relative_humidity'), pp = g('air_pressure_at_mean_sea_level'), rr = g('precipitation_amount');
        push({ id: st.id, name: names[st.id]?.name ? names[st.id].name.replace(/_/g, ' ').replace(/\s*\(\d{4,5}\s*\d?\)\s*$/, '').replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim().replace(/\b([A-ZÄÖÜ])([A-ZÄÖÜ]{2,})\b/g, (m, a, b) => a + b.toLowerCase()) : st.id, lat: st.lat, lon: st.lon, time: (spd || tt || dir)?.t || null, dir: dir ? Math.round(dir.v) : null, kt: spd ? Math.round(spd.v * 1.943844 * 10) / 10 : null, gustKt: gst ? Math.round(gst.v * 1.943844) : null, tempC: tt ? Math.round(tt.v * 10) / 10 : null, dewC: td ? Math.round(td.v * 10) / 10 : null, rh: rh ? Math.round(rh.v) : null, qnh: pp ? Math.round(pp.v) : null, precipMm: rr ? Math.round(rr.v * 10) / 10 : null, src: 'MeteoGate (EUMETNET)' });
      }
    } catch (e) { errors.push('MeteoGate: ' + e.message); }
    out.sort((a, b) => a.km - b.km);
    const official = out.filter((x) => !x.amateur).slice(0, 80), amateur = out.filter((x) => x.amateur).slice(0, 30);   // Amateurstationen zusätzlich (höchstens 30), verdrängen keine amtlichen
    return { stations: [...official, ...amateur].sort((a, b) => a.km - b.km), errors: [...new Set(errors)], generated: new Date().toISOString(), ...(diag ? { diag } : {}) };   // höchstens 80 nächste (dichte Netze wie Südtirol)
  });
  return json(data);
}

// ------------------------------------------------------------ Radiosonden (SondeHub)
/** Sonden der letzten Stunden im Umkreis: letzte Telemetrie je Sonde (Position, Höhe, Zeit). */
async function sondes(ctx, q) {
  if (q.get('lat') == null || q.get('lon') == null) return err('lat/lon');
  const lat = +q.get('lat'), lon = +q.get('lon'), km = Math.min(400, Math.max(20, +q.get('km') || 200)), hours = Math.min(48, Math.max(1, +q.get('h') || 12));
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return err('lat/lon');
  const data = await cached(ctx, `sondes/${lat.toFixed(1)},${lon.toFixed(1)},${km},${hours}`, 300, async () => {
    const j = await (await get(`https://api.v2.sondehub.org/sondes?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&distance=${Math.round(km * 1000)}&last=${hours * 3600}`, {}, 20000)).json();
    const list = Object.values(j || {}).filter((s) => s && s.lat != null).map((s) => ({ serial: s.serial, type: s.type || s.subtype || '', lat: s.lat, lon: s.lon, alt: s.alt, time: s.datetime, velV: s.vel_v ?? null, temp: s.temp ?? null, humidity: s.humidity ?? null, pressure: s.pressure ?? null, km: Math.round(distKm(lat, lon, s.lat, s.lon) * 10) / 10, uploader: s.uploader_callsign || '' }));
    list.sort((a, b) => a.km - b.km);
    return { sondes: list, generated: new Date().toISOString() };
  });
  return json(data);
}
/** Telemetrie einer Sonde (bis 12 h) als Profil: T, Td/RH, Druck, Wind aus der Drift; für Emagramm und Tabelle. */
async function sonde(ctx, q) {
  const serial = (q.get('serial') || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (!serial) return err('serial');
  const data = await cached(ctx, `sonde/${serial}`, 600, async () => {
    const j = await (await get(`https://api.v2.sondehub.org/sondes/telemetry?serial=${encodeURIComponent(serial)}&duration=12h`, {}, 25000)).json();
    const bySerial = j?.[serial] || {};
    const pts = Object.keys(bySerial).map((ts) => ({ ...bySerial[ts], datetime: bySerial[ts].datetime || ts })).filter((p) => p.lat != null && p.lon != null && p.alt != null).sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
    // Aufstieg: bis zur maximalen Höhe
    let top = 0; pts.forEach((p, i) => { if (p.alt > (pts[top]?.alt ?? -1)) top = i; });
    const asc = pts.slice(0, top + 1);
    const levels = [];
    let lastBin = -1;
    for (let i = 1; i < asc.length; i++) {
      const a = asc[i - 1], b = asc[i]; const bin = Math.floor(b.alt / 200);
      if (bin === lastBin) continue; lastBin = bin;
      const dt = (new Date(b.datetime) - new Date(a.datetime)) / 1000; let dir = null, kt = null;
      if (dt > 0 && dt < 300) { const dKm = distKm(a.lat, a.lon, b.lat, b.lon); const brg = (Math.atan2(Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat)), Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon))) * 180 / Math.PI + 360) % 360; dir = Math.round((brg + 180) % 360); kt = Math.round(dKm * 1000 / dt * 1.943844 * 10) / 10; }
      const temp = b.temp != null && b.temp > -200 ? Math.round(b.temp * 10) / 10 : null, rh = b.humidity != null && b.humidity >= 0 ? Math.round(b.humidity) : null;
      const hPa = b.pressure != null && b.pressure > 0 ? Math.round(b.pressure * 10) / 10 : Math.round(1013.25 * Math.pow(1 - 2.25577e-5 * b.alt, 5.25588) * 10) / 10;
      levels.push({ m: Math.round(b.alt), ft: Math.round(b.alt * 3.28084), hPa, temp, dew: DEW(temp, rh), rh, dir, kt, pressureMeasured: b.pressure != null && b.pressure > 0 });
    }
    const first = pts[0], last = pts[pts.length - 1];
    return { serial, type: first?.type || first?.subtype || '', launch: first?.datetime || null, lastFix: last?.datetime || null, lat: first?.lat, lon: first?.lon, topM: asc.length ? Math.round(asc[asc.length - 1].alt) : null, points: pts.length, levels, generated: new Date().toISOString() };
  });
  return json(data);
}

// ------------------------------------------------------------ NOTAM (autorouter · FAA)
/** FIR-Kennungen je Land (Item A für autorouter); Rückfall LSAS. */
const FIRS = { CH: ['LSAS'], LI: ['LSAS'], DE: ['EDMM', 'EDGG', 'EDWW'], AT: ['LOVV'], FR: ['LFMM', 'LFFF', 'LFEE', 'LFBB', 'LFRR'], IT: ['LIMM', 'LIRR', 'LIBB'], SI: ['LJLA'], HR: ['LDZO'], HU: ['LHCC'], CZ: ['LKAA'], SK: ['LZBB'], PL: ['EPWW'], BE: ['EBBU'], NL: ['EHAA'], LU: ['ELLX'], DK: ['EKDK'], ES: ['LECM', 'LECB'], PT: ['LPPC'], GB: ['EGTT', 'EGPX'], IE: ['EISN'] };
/** autorouter: OAuth2 client_credentials (E-Mail/Kennwort), Token 1 h – im Cache. */
async function autorouterToken(env, decrypt, ctx) {
  const user = (await getSecret(env, decrypt, 'autorouter_user') || '').trim(), pass = (await getSecret(env, decrypt, 'autorouter_pass') || '').trim();
  if (!user || !pass) return null;
  const j = await cached(ctx, `autorouter/token/${user.length}`, 3000, async () => {
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: user, client_secret: pass });
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch('https://api.autorouter.aero/v1.0/oauth2/token', { method: 'POST', headers: { 'User-Agent': UA, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(), signal: ctl.signal });
      const txt = await r.text();
      // Fehler mit Antworttext melden (z. B. invalid_client = Zugangsdaten, access_denied = API-Freigabe fehlt)
      if (!r.ok) throw new Error(`HTTP ${r.status} oauth2/token: ${txt.replace(/\s+/g, ' ').slice(0, 160) || 'ohne Antworttext'}`);
      return JSON.parse(txt);
    } finally { clearTimeout(t); }
  });
  return j?.access_token || null;
}
/** NOTAM über autorouter nach FIR-Kennungen (Item A), gefiltert auf den Umkreis (NOTAM mit Koordinaten) – FIR-weite bleiben. */
async function notamAutorouter(env, decrypt, ctx, lat, lon, radiusNm, cc) {
  const token = await autorouterToken(env, decrypt, ctx);
  if (!token) return null;
  const codes = [...new Set((cc || ['CH']).flatMap((c) => FIRS[String(c).toUpperCase()] || []))];
  if (!codes.length) codes.push('LSAS');
  const now = Math.floor(Date.now() / 1000);
  const rows = await cached(ctx, `notam/ar/${codes.join('-')}`, 900, async () => {
    const out = []; let offset = 0;
    for (let k = 0; k < 20; k++) {
      const url = `https://api.autorouter.aero/v1.0/notam?itemas=${encodeURIComponent(JSON.stringify(codes))}&offset=${offset}&limit=100&startvalidity=${now - 86400}&endvalidity=${now + 7 * 86400}`;
      const j = await (await get(url, { headers: { Authorization: `Bearer ${token}` } }, 20000)).json();
      out.push(...(j.rows || [])); offset += (j.rows || []).length;
      if (!(j.rows || []).length || offset >= (j.total || 0)) break;
    }
    return out;
  });
  const items = rows.map((r) => {
    const num = `${r.series || ''}${String(r.number ?? '').padStart(4, '0')}/${String(r.year ?? '').slice(-2)}`;
    // Koordinaten: Dezimalgrad; die Doku nennt «Garmin format» – kommen Halbkreis-Einheiten (|Wert| > 180), umrechnen (× 180 / 2³¹)
    const deg = (v) => { if (v == null || v === '') return null; const n = +v; if (!Number.isFinite(n)) return null; return Math.abs(n) > 180 ? n * 180 / 2147483648 : n; };
    const plat = deg(r.lat), plon = deg(r.lon);
    const iso = (v) => (v ? new Date(+v * 1000).toISOString() : null);
    const formatted = `Q) ${r.fir || ''}/Q${r.code23 || ''}${r.code45 || ''}/${r.traffic || ''}/${r.purpose || ''}/${r.scope || ''}/${String(r.lower ?? '000').padStart(3, '0')}/${String(r.upper ?? '999').padStart(3, '0')}/\nA) ${r.itema || ''} B) ${iso(r.startvalidity) || ''} C) ${r.endvalidity ? iso(r.endvalidity) : 'PERM'}${r.estimation ? ' EST' : ''}\n${r.itemd ? 'D) ' + r.itemd + '\n' : ''}E) ${r.iteme || ''}${r.itemf ? '\nF) ' + r.itemf : ''}${r.itemg ? ' G) ' + r.itemg : ''}`;
    return { id: `${r.itema}-${num}`, number: num, type: r.type, location: r.itema, icao: r.itema, start: iso(r.startvalidity), end: r.endvalidity ? iso(r.endvalidity) : 'PERM', text: r.iteme || '', formatted, minFL: r.lower ?? null, maxFL: r.upper ?? null, radius: r.radius ?? null, lat: plat, lon: plon, scope: r.scope, code: `${r.code23 || ''}${r.code45 || ''}` };
  }).filter((it) => {
    if (it.lat == null || it.lon == null) return true;                      // ohne Koordinaten: FIR-weit → behalten
    const d = distKm(lat, lon, it.lat, it.lon) / 1.852;                    // NM
    return d <= radiusNm + (it.radius || 0);
  });
  return { items, total: items.length, source: 'autorouter NOTAM API', generated: new Date().toISOString() };
}
/**
 * ICAO-NOTAM-Text (A1234/26 NOTAMN … Q) … A) … B) … C) … E) …) in ein Objekt zerlegen; Koordinaten und Radius aus der Q-Zeile
 * (4723N00757E005 → 47.38, 7.95, 5 NM). Gemeinsam für DINS und FAA NOTAM Search (0.12.4).
 */
export function parseIcaoNotam(txt, fallbackLoc) {
  const s = String(txt || '').replace(/\r/g, '').trim();
  const head = /^([A-Z]\d{4}\/\d{2})\s+NOTAM([NRC])/m.exec(s);
  const qm = /Q\)\s*([A-Z]{4})\/(Q[A-Z]{4})\/([IV]+)\/([A-Z]+)\/([A-Z]+)\/(\d{3})\/(\d{3})\/(\d{4})([NS])(\d{5})([EW])(\d{3})/.exec(s);
  const fld = (k, next) => { const m = new RegExp(`\\b${k}\\)\\s*([\\s\\S]*?)(?=\\s(?:${next})\\)|$)`).exec(s); return m ? m[1].trim() : ''; };
  const a = fld('A', 'B|C|D|E|F|G'), b = fld('B', 'C|D|E|F|G'), c = fld('C', 'D|E|F|G'), e = fld('E', 'F|G'), f = fld('F', 'G'), g = fld('G', '$');
  const ymd = (v) => { const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(v || ''); return m ? `20${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z` : null; };
  const lat = qm ? (+qm[8].slice(0, 2) + +qm[8].slice(2) / 60) * (qm[9] === 'S' ? -1 : 1) : null;
  const lon = qm ? (+qm[10].slice(0, 3) + +qm[10].slice(3) / 60) * (qm[11] === 'W' ? -1 : 1) : null;
  const loc = (a.split(/\s+/)[0] || fallbackLoc || '').toUpperCase();
  return { id: `${loc}-${head ? head[1] : s.slice(0, 12)}`, number: head ? head[1] : '', type: head ? head[2] : 'N', location: loc, icao: loc, fir: qm ? qm[1] : null, code: qm ? qm[2].slice(1) : null, scope: qm ? qm[5] : null,
    start: ymd(b), end: /PERM/.test(c) ? 'PERM' : ymd(c), est: /EST/.test(c), text: e, formatted: s, minFL: qm ? +qm[6] : null, maxFL: qm ? +qm[7] : null, lat, lon, radius: qm ? +qm[12] : null, lowerTxt: f || null, upperTxt: g || null };
}
const withinNm = (lat, lon, radiusNm) => (it) => { if (it.lat == null || it.lon == null) return true; return distKm(lat, lon, it.lat, it.lon) / 1.852 <= radiusNm + Math.min(it.radius || 0, 300); };
/** DINS (notams.faa.gov, US-DoD-NOTAM-Dienst, weltweit, ohne Schlüssel): NOTAMs der FIRs der beteiligten Länder, Umkreis über die Q-Zeile. */
async function notamDins(ctx, lat, lon, radiusNm, cc) {
  const codes = [...new Set((cc.length ? cc : ['CH']).flatMap((c) => FIRS[String(c).toUpperCase()] || []))];
  if (!codes.length) codes.push('LSAS');
  const rows = await cached(ctx, `notam/dins/${codes.join('-')}`, 900, async () => {
    const url = `https://www.notams.faa.gov/dinsQueryWeb/queryRetrievalMapAction.do?reportType=Raw&retrieveLocId=${encodeURIComponent(codes.join(' '))}&actionType=notamRetrievalByICAOs`;
    const html = await (await get(url, { accept: 'text/html' }, 25000)).text();
    const out = [];
    for (const m of html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)) {
      const txt = m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
      if (/^[A-Z]\d{4}\/\d{2}\s+NOTAM/.test(txt)) out.push(parseIcaoNotam(txt));
    }
    if (!out.length && !/NOTAM/i.test(html)) throw new Error('DINS: keine NOTAM-Daten im Antworttext');
    return out;
  });
  const items = rows.filter(withinNm(lat, lon, radiusNm));
  return { items, total: items.length, source: 'FAA DINS (FIR-NOTAMs, ohne Schlüssel)', generated: new Date().toISOString(), note: `FIR ${codes.join(', ')}` };
}
/** FAA NOTAM Search (notams.aim.faa.gov, ohne Schlüssel, inoffizielle JSON-Schnittstelle der Suchseite): Umkreis um Breite/Länge. */
async function notamSearch(ctx, lat, lon, radiusNm) {
  const dms = (v) => { const a = Math.abs(v), d = Math.floor(a), mi = Math.floor((a - d) * 60), se = Math.round(((a - d) * 60 - mi) * 60); return [d, mi, se]; };
  const [latD, latM, latS] = dms(lat), [lonD, lonM, lonS] = dms(lon);
  const data = await cached(ctx, `notam/search/${lat.toFixed(2)},${lon.toFixed(2)},${radiusNm}`, 900, async () => {
    const items = [];
    for (let offset = 0; offset < 600; offset += 30) {
      const body = new URLSearchParams({ searchType: '3', designatorsForLocation: '', designatorForAccountable: '', latDegrees: String(latD), latMinutes: String(latM), latSeconds: String(latS), longDegrees: String(lonD), longMinutes: String(lonM), longSeconds: String(lonS),
        radius: String(Math.round(radiusNm)), sortColumns: '5 false', sortDirection: 'true', radiusSearchOnDesignator: 'false', radiusSearchDesignator: '', latitudeDirection: lat >= 0 ? 'N' : 'S', longitudeDirection: lon >= 0 ? 'E' : 'W',
        freeFormText: '', flightPathText: '', flightPathDivertAirfields: '', flightPathBuffer: '4', flightPathIncludeNavaids: 'true', flightPathIncludeArtcc: 'false', flightPathIncludeTfr: 'true', flightPathIncludeRegulatory: 'false', flightPathResultsType: 'All NOTAMs',
        archiveDate: '', archiveDesignator: '', offset: String(offset), notamsOnly: 'false', filters: '', minRunwayLength: '', minRunwayWidth: '', runwaySurfaceTypes: '', predefinedAbbreviation: '', searchQuery: '' });
      const j = await (await get('https://notams.aim.faa.gov/notamSearch/search', { method: 'POST', body: body.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', Referer: 'https://notams.aim.faa.gov/notamSearch/nsapp.html', 'X-Requested-With': 'XMLHttpRequest' } }, 25000)).json();
      if (!Array.isArray(j.notamList)) throw new Error('NOTAM Search: unerwartete Antwort');
      for (const n of j.notamList) {
        const txt = n.icaoMessage || n.traditionalMessage || '';
        const it = /NOTAM[NRC]/.test(txt) ? parseIcaoNotam(txt, n.facilityDesignator) : { id: `${n.facilityDesignator}-${n.notamNumber}`, number: n.notamNumber || '', type: 'N', location: n.facilityDesignator, icao: n.icaoId || n.facilityDesignator, start: null, end: null, text: txt, formatted: txt, minFL: null, maxFL: null, lat: null, lon: null, radius: null };
        if (!it.number && n.notamNumber) it.number = n.notamNumber;
        items.push(it);
      }
      if (j.notamList.length < 30 || offset + 30 >= (j.totalNotamCount || 0)) break;
    }
    return items;
  });
  return { items: data, total: data.length, source: 'FAA NOTAM Search (ohne Schlüssel, inoffiziell)', generated: new Date().toISOString() };
}
// ---- 0.14.1: FAA NMS über GitHub Actions. Die Google-Cloud-Sperrliste weist Cloudflare Workers ab (403; FAA NAIMES
// INC0033867, 19.10.2026); ein Actions-Runner erreicht die API. Der Workflow fetch-notam holt alle 30 min die NOTAMs
// je Abfragepunkt (Umkreis) und legt sie als data/notam/<key>.json ab (Ablage wie die DWD-Berichte); der Worker liest
// diese Dateien. Welche Punkte: Startort, Landeraum, Bahn-Endpunkte und NOTAM-Orte der Briefings der nächsten 7 Tage
// (aus den Briefing-JSON) sowie alles, was in den letzten 7 Tagen tatsächlich abgefragt wurde (Tabelle notam_points).
export const notamKey = (lat, lon, nm) => `${(+lat).toFixed(2)}_${(+lon).toFixed(2)}_${Math.round(nm)}`;
const notamBase = (env) => `${dataBase(env).replace(/\/dwd$/, '')}/notam`;
const NOTAM_FRESH_MS = 3 * 3600000;   // älterer Abrufstand gilt als veraltet → Hinweis, Rückfall autorouter
let notamPointsReady = false;
export async function ensureNotamPoints(env) {
  if (notamPointsReady) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS notam_points (key TEXT PRIMARY KEY, lat REAL NOT NULL, lon REAL NOT NULL, nm INTEGER NOT NULL, asked_ms INTEGER NOT NULL, briefing_id TEXT)').run();
  notamPointsReady = true;
}
/** Abfragepunkt vormerken (der Workflow holt ihn beim nächsten Lauf); Fehler bleiben ohne Folgen. */
async function noteNotamPoint(env, ctx, lat, lon, nm, briefingId) {
  const run = (async () => {
    await ensureNotamPoints(env);
    await env.DB.prepare('INSERT INTO notam_points (key,lat,lon,nm,asked_ms,briefing_id) VALUES (?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET asked_ms=excluded.asked_ms, briefing_id=COALESCE(excluded.briefing_id, notam_points.briefing_id)')
      .bind(notamKey(lat, lon, nm), +lat.toFixed(2), +lon.toFixed(2), Math.round(nm), Date.now(), briefingId || null).run();
  })().catch((e) => console.warn('notam_points', e.message));
  ctx.waitUntil(run);
}
/** Abrufdatei des Workflows lesen (10-min-Bucket gegen den Pages-Cache); null = (noch) nicht vorhanden. */
async function notamFile(env, key) {
  const bust = `?t=${Math.floor(Date.now() / 600000)}`;
  try { return await (await get(`${notamBase(env)}/${key}.json${bust}`, {}, 12000)).json(); }
  catch { return null; }
}
/** Stand des Workflows (index.json): läuft der Abruf überhaupt? */
async function notamIndex(ctx, env) {
  return cached(ctx, 'notam/index', 300, async () => (await notamFile(env, 'index')) || { missing: true });
}
/** Die Abfragekreise, wie sie die App bildet (js/auto/data.js notam/hexCover): > 100 NM wird in sieben 100-NM-Kreise zerlegt. */
export function notamCover(lat, lon, nm) {
  if (nm <= 100) return [{ lat, lon, nm }];
  const sub = 100, dist = Math.max(0, nm - sub * 0.55);
  const out = [{ lat, lon, nm: sub }];
  for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; out.push({ lat: lat + (dist / 60) * Math.cos(a), lon: lon + (dist / 60) * Math.sin(a) / Math.cos(lat * Math.PI / 180), nm: sub }); }
  return out;
}
/** Abfragepunkte eines Briefings (Strecke: Startort, Bahn-Endpunkte, Landeraum; Orte: gewählte Orte mit eigenem Radius). */
export function notamPointsOfBriefing(b, defaultNm) {
  const pts = [];
  if (b?.notamMode === 'places') {
    for (const p of b.notamPlaces || []) if (p.lat != null && p.lon != null) pts.push({ lat: +p.lat, lon: +p.lon, nm: Math.max(5, Math.round((+p.km || 200) / 1.852)) });
  } else if (b?.site?.lat != null) {
    const nm = Math.max(5, +defaultNm || 25);
    pts.push({ lat: +b.site.lat, lon: +b.site.lon, nm });
    for (const tr of b.panels?.['B.traj']?.content?.auto?.data?.tracks || []) if (tr.end?.lat != null) pts.push({ lat: +tr.end.lat, lon: +tr.end.lon, nm });
    if (b.landing?.lat != null) pts.push({ lat: +b.landing.lat, lon: +b.landing.lon, nm });
  }
  return pts.slice(0, 6).flatMap((p) => notamCover(p.lat, p.lon, p.nm)).filter((c) => isFinite(c.lat) && isFinite(c.lon));
}
/** Punkte für den Workflow: vorgemerkte Abfragen der letzten 7 Tage + Briefings der nächsten 7 Tage (Aufruf aus index.js, Dienst-Token). */
export async function notamPointsForFetch(env, briefingRows, settingsOf) {
  await ensureNotamPoints(env);
  const now = Date.now();
  await env.DB.prepare('DELETE FROM notam_points WHERE asked_ms < ?').bind(now - 7 * 86400000).run();
  const map = new Map();
  const add = (c, why) => { const key = notamKey(c.lat, c.lon, c.nm); if (!map.has(key)) map.set(key, { key, lat: +c.lat.toFixed(2), lon: +c.lon.toFixed(2), nm: Math.round(c.nm), why }); };
  for (const row of briefingRows) {
    let b; try { b = JSON.parse(row.json); } catch { continue; }
    const nm = (await settingsOf(row.owner_id))?.notamRadiusNm || 25;
    for (const c of notamPointsOfBriefing(b, nm)) add(c, b.no || row.id);
  }
  const asked = await env.DB.prepare('SELECT key,lat,lon,nm FROM notam_points ORDER BY asked_ms DESC LIMIT 200').all();
  for (const r of asked.results || []) add(r, 'asked');
  return [...map.values()];
}
async function notam(env, decrypt, ctx, q, briefingId) {
  const lat = +q.get('lat'), lon = +q.get('lon'), radius = Math.min(100, +q.get('nm') || 25);
  if (!isFinite(lat) || !isFinite(lon)) return err('lat/lon');
  const cc = String(q.get('cc') || '').split(',').map((x) => x.trim()).filter(Boolean);
  // 0.12.11: src=autorouter|faa|dins|search erzwingt eine Quelle (Vergleich der Quellen; ohne Cache)
  const src = String(q.get('src') || '').toLowerCase();
  // 1) 0.14.1: Abrufdatei des GitHub-Workflows (FAA NMS); Punkt vormerken, damit der nächste Lauf ihn holt.
  //    Veraltete Datei (> 3 h): erst die Rückfallquellen versuchen, scheitern alle, gilt die veraltete Datei mit Hinweis.
  let stale = null;
  if (!src || src === 'faa') {
    noteNotamPoint(env, ctx, lat, lon, radius, briefingId);
    const f = await notamFile(env, notamKey(lat, lon, radius));
    const ageMs = f?.generated ? Date.now() - Date.parse(f.generated) : Infinity;
    if (f && Array.isArray(f.items)) {
      const stand = String(f.generated || '').slice(11, 16);
      const out = { items: f.items, total: f.items.length, source: `FAA NMS API (Abruf GitHub ${stand} UTC)`, generated: f.generated, errors: [] };
      if (ageMs > NOTAM_FRESH_MS) out.errors.push(`FAA: Abrufstand ${Math.round(ageMs / 3600000)} h alt`);
      if (f.error) out.errors.push(`FAA: ${f.error}`);
      if (ageMs <= NOTAM_FRESH_MS || src === 'faa') return json(out);
      stale = out;
    }
    if (src === 'faa') {
      const idx = await notamIndex(ctx, env);
      return err(idx.missing ? 'FAA: der GitHub-Abruf (fetch-notam) ist noch nie gelaufen – Secrets FAA_CLIENT_ID/FAA_CLIENT_SECRET/OPS_HANDOVER_TOKEN im Repository prüfen' : `FAA: noch kein Abruf für diesen Punkt (vorgemerkt; nächster Lauf innert 30 min, letzter ${String(idx.generated || '').slice(0, 16).replace('T', ' ')} UTC)`, 424);
    }
  }
  // 2) autorouter, wenn Zugang hinterlegt (Einstellungen → Zugänge); scheitert der Abruf, wandert der Grund als Hinweis in die Antwort der Ersatzquelle (0.12.7)
  let arErr = null;
  if (!src || src === 'autorouter') {
    try {
      const ar = await notamAutorouter(env, decrypt, ctx, lat, lon, radius, cc);
      if (ar) {   // 0.14.1: läuft der GitHub-Abruf, folgt die FAA-Fassung dieses Punkts beim nächsten Lauf
        if (!src) { const idx = await notamIndex(ctx, env); if (!idx.missing) ar.errors = [...(ar.errors || []), 'FAA-Abruf für diesen Punkt vorgemerkt (nächster GitHub-Lauf innert 30 min) – bis dahin autorouter']; }
        return json(ar);
      }
      if (src) return err('autorouter: kein Zugang hinterlegt', 424);
    }
    catch (e) { console.warn('autorouter', e.message); arErr = `autorouter: ${e.message}`; if (src) return err(arErr, 502); }
  }
  if (src === 'dins') { try { return json(await notamDins(ctx, lat, lon, radius, cc)); } catch (e) { return err(`DINS: ${e.message}`, 502); } }
  if (src === 'search') { try { return json(await notamSearch(ctx, lat, lon, radius)); } catch (e) { return err(`NOTAM Search: ${e.message}`, 502); } }
  // 2) FAA NOTAM API (ein Wiederholungsversuch, da der Dienst oft nicht antwortet); ohne Schlüssel → 3) DINS, 4) FAA NOTAM Search (beide ohne Schlüssel, 0.12.4)
  const id = await getSecret(env, decrypt, 'faa_client_id'), secret = await getSecret(env, decrypt, 'faa_client_secret');
  if (src === 'faa' && (!id || !secret)) return err('FAA: Client Key/Secret fehlen (Einstellungen → Zugänge)', 424);
  if (src === 'faa' && q.get('diag')) {   // 0.12.11b: Erreichbarkeits-Diagnose (ohne Zugangsdaten)
    const probe = async (url, ua, init = {}) => { try { const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), 'User-Agent': ua, Accept: 'application/json' } }); return `${r.status} ${(await r.text()).replace(/\s+/g, ' ').slice(0, 80)}`; } catch (e) { return `ERR ${e.message}`; } };
    const bua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
    return json({ notams_ua: await probe('https://api-nms.aim.faa.gov/nmsapi/v1/notams', UA), notams_browser: await probe('https://api-nms.aim.faa.gov/nmsapi/v1/notams', bua),
      token_ua: await probe('https://api-nms.aim.faa.gov/v1/auth/token', UA, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' }),
      token_browser: await probe('https://api-nms.aim.faa.gov/v1/auth/token', bua, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' }),
      root_browser: await probe('https://api-nms.aim.faa.gov/', bua), nms_site: await probe('https://nms.aim.faa.gov/', bua) });
  }
  if (!id || !secret) {
    const errors = arErr ? [arErr] : [];
    for (const [name, fn] of [['DINS', () => notamDins(ctx, lat, lon, radius, cc)], ['NOTAM Search', () => notamSearch(ctx, lat, lon, radius)]]) {
      try { const r = await fn(); if (r.items.length || name === 'NOTAM Search') return json({ ...r, errors }); errors.push(`${name}: keine Treffer`); }
      catch (e) { console.warn(name, e.message); errors.push(`${name}: ${e.message}`); }
    }
    if (stale) return json({ ...stale, errors: [...stale.errors, ...errors] });
    return err(`NOTAM-Quellen ohne Schlüssel nicht erreichbar (${errors.join('; ')}) – Zugang hinterlegen (Einstellungen → Zugänge: autorouter oder FAA)`, 502);
  }
  // 0.12.11a: FAA NMS API (OAuth2 client_credentials, api-nms.aim.faa.gov) – der frühere API-Portal-Zugang (external-api.faa.gov, Header client_id/client_secret) bleibt als zweiter Versuch
  const nmsToken = async () => {
    const basic = btoa(`${id.trim()}:${secret.trim()}`);
    const r = await fetch('https://api-nms.aim.faa.gov/v1/auth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}`, Accept: 'application/json', 'User-Agent': UA }, body: 'grant_type=client_credentials' });
    if (!r.ok) throw new Error(`Token HTTP ${r.status}: ${(await r.text()).replace(/\s+/g, ' ').slice(0, 200)}`);
    const j = await r.json();
    if (!j.access_token) throw new Error('Token: keine access_token in der Antwort');
    return { token: j.access_token, exp: Date.now() + Math.max(60, (+j.expires_in || 3600) - 120) * 1000 };
  };
  const nmsNormalize = (f) => {
    const p = f.properties || f; const core = p.coreNOTAMData?.notam || p.notam || p; const tr = p.coreNOTAMData?.notamTranslation?.[0] || p.notamTranslation?.[0] || {};
    const geom = f.geometry || null; let glat = null, glon = null;
    if (geom?.type === 'Point' && Array.isArray(geom.coordinates)) { glon = +geom.coordinates[0]; glat = +geom.coordinates[1]; }
    return { id: core.id || core.nmsId || p.id, number: core.number || core.notamNumber, type: core.type, location: core.location, icao: core.icaoLocation || core.icaoId || core.location, start: core.effectiveStart || core.effectiveStartDate, end: core.effectiveEnd || core.effectiveEndDate, classification: core.classification, text: core.text || core.icaoMessage || core.traditionalMessage || '', minFL: core.minimumFL, maxFL: core.maximumFL, radius: core.radius, coordinates: core.coordinates, lat: core.lat ?? glat, lon: core.lon ?? glon, formatted: tr.formattedText || tr.simpleText || '', geometry: geom };
  };
  const fetchNms = async () => {
    let tk = await cached(ctx, 'faa/nms-token', 2400, nmsToken);
    if (!tk?.token || tk.exp < Date.now()) tk = await nmsToken();
    const url = `https://api-nms.aim.faa.gov/nmsapi/v1/notams?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&radius=${radius}`;
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 25000);
    let j;
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${tk.token}`, nmsResponseFormat: 'GEOJSON', Accept: 'application/json', 'User-Agent': UA }, signal: ctl.signal });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).replace(/\s+/g, ' ').slice(0, 200)}`);
      j = await r.json();
    } finally { clearTimeout(tm); }
    const raw = j?.data?.geojson || j?.data?.features || j?.features || j?.items || (Array.isArray(j) ? j : []);
    const items = raw.map(nmsNormalize);
    const out = { items, total: items.length, source: 'FAA NMS API', generated: new Date().toISOString() };
    if (src === 'faa') out.sample = JSON.stringify(raw[0] ?? j).slice(0, 1500);   // Diagnose: Rohform des ersten Treffers
    return out;
  };
  const fetchFaaLegacy = async () => {
    const url = `https://external-api.faa.gov/notamapi/v1/notams?locationLatitude=${lat.toFixed(4)}&locationLongitude=${lon.toFixed(4)}&locationRadius=${radius}&pageSize=1000&sortBy=effectiveStartDate&sortOrder=Asc`;
    let j;
    for (let k = 0; k < 2; k++) {
      try {
        const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 20000);
        try {
          const r = await fetch(url, { headers: { client_id: id.trim(), client_secret: secret.trim(), Accept: 'application/json', 'User-Agent': UA }, signal: ctl.signal });
          if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).replace(/\s+/g, ' ').slice(0, 200)}`);   // 0.12.11: Antworttext für die Diagnose (401/403/429)
          j = await r.json();
        } finally { clearTimeout(tm); }
        break;
      } catch (e) { if (k || /HTTP 4\d\d/.test(e.message)) throw e; }
    }
    const items = (j.items || []).map(nmsNormalize);
    return { items, total: j.totalCount, source: 'FAA NOTAM API', generated: new Date().toISOString() };
  };
  const fetchFaa = async () => {
    try { return await fetchNms(); }
    catch (e1) {
      try { const r = await fetchFaaLegacy(); return { ...r, errors: [`NMS: ${e1.message}`] }; }
      catch (e2) { throw new Error(`NMS: ${e1.message} | API-Portal: ${e2.message}`); }
    }
  };
  if (src === 'faa') { try { return json(await fetchFaa()); } catch (e) { return err(`FAA NOTAM API: ${e.message}`, 502); } }
  let data;
  try { data = await cached(ctx, `notam/${lat.toFixed(2)},${lon.toFixed(2)},${radius}`, 900, fetchFaa); }
  catch (e) { if (stale) return json({ ...stale, errors: [...stale.errors, ...(arErr ? [arErr] : []), `FAA direkt: ${e.message}`] }); throw e; }
  return json(arErr ? { ...data, errors: [arErr, ...(data.errors || [])] } : data);
}

// ------------------------------------------------------------ KI (Anthropic)
async function ai(env, decrypt, body) {
  const key = await getSecret(env, decrypt, 'anthropic');
  if (!key) return err('Anthropic-Schlüssel fehlt (Einstellungen → Zugänge)', 424);
  const model = /^[a-z0-9.-]+$/.test(body.model || '') ? body.model : 'claude-sonnet-5-5';
  const content = [];
  for (const u of (body.images || []).slice(0, 6)) {
    const mm = /^\/files\/(.+\.(jpg|png|webp))$/.exec(String(u).replace(/^https?:\/\/[^/]+/, ''));
    if (!mm) continue;
    const obj = await env.FILES.get(mm[1]); if (!obj) continue;
    const bytes = new Uint8Array(await obj.arrayBuffer());
    if (bytes.length > 4 * 1024 * 1024) continue;
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    content.push({ type: 'image', source: { type: 'base64', media_type: obj.httpMetadata?.contentType || 'image/jpeg', data: btoa(bin) } });
  }
  content.push({ type: 'text', text: String(body.prompt || '').slice(0, 60000) });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 700, system: String(body.system || '').slice(0, 8000), messages: [{ role: 'user', content }] }),
  });
  const j = await r.json();
  if (!r.ok) return err(j.error?.message || `Anthropic HTTP ${r.status}`, 502);
  const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
  return json({ text, model: j.model, usage: j.usage });
}

// ------------------------------------------------------------ Final-PDF (Cloudflare Browser Rendering)
async function pdfRender(env, decrypt, ctx, body, auth) {
  const token = await getSecret(env, decrypt, 'cf_api_token'), acc = await getSecret(env, decrypt, 'cf_account_id');
  if (!token || !acc) return err('Browser Rendering nicht konfiguriert (Zugänge: cf_api_token, cf_account_id)', 424);
  const id = String(body.id || '').replace(/[^a-z0-9]/g, '');
  if (!id) return err('id');
  const doc = ['bs', 'fa'].includes(body.doc) ? body.doc : '';   // 0.13.0: Betriebsdokumente (Beförderungsschein, Flugauftrag) statt Briefingsicht
  const row = await env.DB.prepare('SELECT json FROM briefings WHERE id=?').bind(id).first();
  if (!row) return err('not found', 404);
  const b = JSON.parse(row.json);
  // temporärer Leselink (1 h), damit der Renderer die Briefingsicht ohne Kennwort öffnen kann
  const tmp = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => (x % 36).toString(36)).join('');
  await env.DB.prepare('INSERT INTO access_links (token,briefing_id,person,role,expires_at,created_at) VALUES (?,?,?,?,?,?)').bind(tmp, id, 'PDF-Renderer', 'read', Date.now() + 3600000, Date.now()).run();
  try {
    const page = `${(env.APP_URL || 'https://ops.wicki.aero').replace(/\/$/, '')}/#/s/${tmp}/${doc || 'v'}`;
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}/browser-rendering/pdf`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: page, gotoOptions: { waitUntil: 'networkidle0', timeout: 60000 }, waitForTimeout: 2500, viewport: { width: 1200, height: 1600 }, pdfOptions: { format: 'A4', printBackground: true, preferCSSPageSize: true, margin: doc ? { top: '10mm', right: '11mm', bottom: '10mm', left: '11mm' } : { top: '12mm', right: '12mm', bottom: '14mm', left: '12mm' } } }),
    });
    const ct = (r.headers.get('Content-Type') || '').split(';')[0];
    if (!r.ok || ct !== 'application/pdf') { let m = `Browser Rendering HTTP ${r.status}`; try { const j = await r.json(); m = j.errors?.[0]?.message || m; } catch { /* kein JSON */ } return err(m, 502); }
    const buf = await r.arrayBuffer();
    const base = [b.no || 'ohne-Nr', doc === 'bs' ? 'Befoerderungsschein' : doc === 'fa' ? 'Flugauftrag' : 'Fahrtbriefing', String(b.balloon?.reg || '').replace(/[^A-Za-z0-9-]+/g, ''), b.time?.date || ''].filter(Boolean).join('_');
    const key = `${id}/${base}_final-v${b.finalNo || 0}-${Date.now()}.pdf`;
    await env.FILES.put(key, buf, { httpMetadata: { contentType: 'application/pdf' } });
    await env.DB.prepare('INSERT INTO files (key,briefing_id,content_type,size,created_at) VALUES (?,?,?,?,?)').bind(key, id, 'application/pdf', buf.byteLength, Date.now()).run();
    return json({ url: `/files/${key}`, key, size: buf.byteLength, finalNo: b.finalNo || 0 });
  } finally {
    ctx.waitUntil(env.DB.prepare('UPDATE access_links SET revoked=1 WHERE token=?').bind(tmp).run());
  }
}

/** Einstieg: kind, Query, Body; auth = { owner: bool (Sitzung mit Schreibrecht), link: row|null, user: {id,role,flags}|null }. */
export async function handleWx(kind, req, env, ctx, q, body, auth, decrypt) {
  const canWrite = auth.owner || auth.link?.role === 'edit';
  const briefingId = q.get('b') || auth.link?.briefing_id || null;
  switch (kind) {
    case 'om': return openMeteo(env, decrypt, ctx, q);
    case 'metar': return metar(env, ctx, q);
    case 'sigmet': return sigmet(ctx, q);
    case 'warnings': return warnings(ctx, q);
    case 'dwd': return dwd(env, ctx);
    case 'dabs': if (!canWrite) return err('forbidden', 403); return dabs(env, ctx, q, briefingId);
    case 'snapshot': if (!canWrite) return err('forbidden', 403); return snapshot(env, body, briefingId, q);
    case 'wxtext': return wxText(ctx, q);
    case 'webcams': return webcams(env, decrypt, ctx, q);
    case 'airspace': return airspace(env, decrypt, ctx, q);
    case 'sounding': return sounding(ctx, q);
    case 'stations': return stations(ctx, q, env, decrypt);
    case 'sondes': return sondes(ctx, q);
    case 'elevation': return elevation(ctx, q);
    case 'water': return water(ctx, q);
    case 'sonde': return sonde(ctx, q);
    case 'notam': return notam(env, decrypt, ctx, q, briefingId);
    case 'ai': if (!canWrite) return err('forbidden', 403); return ai(env, decrypt, body);
    case 'pdf': if (!auth.owner) return err('forbidden', 403); return pdfRender(env, decrypt, ctx, body, auth);
    default: return err('unknown kind', 404);
  }
}
