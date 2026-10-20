/* Fahrtbriefing — Cloudflare Worker: Benutzer (Super/Master), Sitzung, Einstellungen
 * je Benutzer, Zugänge (verschlüsselt, zentral), Briefings (D1), Freigaben des
 * Stamms, persönliche Links, Bilder (R2), Nutzungsstatistik.
 *
 * Alle JSON-Antworten; Fehler als { error }. Sitzungs-Aufrufe brauchen
 * «Authorization: Bearer <token>» (HMAC-signiert, 30 Tage, enthält die
 * Benutzer-ID). Persönliche Links laufen über /api/shared/<token> ohne Sitzung.
 *
 * Rollen:  super   sieht alles (Briefings, Einstellungen anderer) lesend, verwaltet
 *                  Benutzer, Zugänge (API-Schlüssel) und Statistik.
 *          master  eigener Stamm, eigene Briefings; kann Teile seines Stamms
 *                  (Ballone, Personen, Startplätze, Treffpunkte, Betreiber) anderen
 *                  freigeben; sieht Briefings anderer nur, wenn sein Material
 *                  (Ballon) darin verwendet wird — lesend.
 */

import { handleWx } from './wx.js';
import { handoverAuth, listHandoverBriefings, putTrajectory, getTrajectory, deleteTrajectory, linkMayView, ensureTrajectories } from './trajectory.js';

const SESSION_DAYS = 30;
const MAX_ATTEMPTS = 8;           // Fehlversuche je IP in 15 min
const ATTEMPT_WINDOW = 15 * 60 * 1000;
const DEFAULT_PASSWORD = '1234';
const FIRST_USER = { id: 'bwicki', name: 'Balthasar Wicki' };
const CATEGORIES = ['balloons', 'persons', 'sites', 'meetings', 'operators'];
const FLAGS = ['ai', 'notam', 'pdf'];

// ------------------------------------------------------------ Helfer
const enc = new TextEncoder(), dec = new TextDecoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), (c) => c.charCodeAt(0));
const rnd = (n = 16) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });
const err = (msg, status = 400) => json({ error: msg }, status);
const uidOk = (s) => /^[a-z0-9][a-z0-9_.-]{1,30}$/.test(s || '');

async function pbkdf2(password, saltB64u, iterations = 100000) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64u(saltB64u), iterations }, key, 256);
  return b64u(bits);
}
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
/** AES-Schlüssel aus ENC_KEY: 32 Bytes base64 werden direkt verwendet, jede andere
 *  Zeichenkette (≥ 32 Zeichen, z. B. aus dem Passwortmanager) über SHA-256 abgeleitet. */
async function aesKey(env) {
  const s = env.ENC_KEY || '';
  if (!s) throw new Error('ENC_KEY fehlt (wrangler secret put ENC_KEY)');
  let raw; try { raw = unb64u(s); } catch { raw = new Uint8Array(0); }
  if (raw.length !== 32) {
    if (s.length < 32) throw new Error('ENC_KEY zu kurz (mindestens 32 Zeichen)');
    raw = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  }
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function encrypt(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(text));
  return { iv: b64u(iv), ct: b64u(ct) };
}
export async function decrypt(env, iv, ct) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, await aesKey(env), unb64u(ct));
  return dec.decode(pt);
}
function timingSafeEqual(a, b) { let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

async function getKv(env, k) { const row = await env.DB.prepare('SELECT v FROM kv WHERE k=?').bind(k).first(); return row ? JSON.parse(row.v) : null; }
async function setKv(env, k, v) { await env.DB.prepare('INSERT INTO kv (k,v,updated_at) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at').bind(k, JSON.stringify(v), Date.now()).run(); }

// ------------------------------------------------------------ Schema 0.11: Ordnungsnummer, Fortschritt, Fahrtende
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  await ensureTrajectories(env);   // 0.14.0: Ist-Trajektorien (die Briefing-Liste verknüpft die Tabelle)
  for (const col of ['no TEXT', 'progress INTEGER', 'end_ms INTEGER', 'edition INTEGER', 'frozen INTEGER', 'hidden INTEGER']) {
    try { await env.DB.prepare(`ALTER TABLE briefings ADD COLUMN ${col}`).run(); } catch { /* Spalte besteht */ }
  }
  // 0.12.10a: Archiv-Grenze neu Landung + 6 h → end_ms des Bestands einmalig neu rechnen
  if (!(await getKv(env, 'endms_v2'))) {
    const rows = (await env.DB.prepare('SELECT id, json FROM briefings').all()).results || [];
    for (const r of rows) { try { const b = JSON.parse(r.json); await env.DB.prepare('UPDATE briefings SET end_ms=? WHERE id=?').bind(endMsOf(b), r.id).run(); } catch { /* Zeile überspringen */ } }
    await setKv(env, 'endms_v2', '1');
  }
  // Bestand ohne Nummer: je Jahr des Fahrtdatums fortlaufend nach Startzeit vergeben (einmalig)
  if (!(await getKv(env, 'no_migrated'))) {
    const rows = (await env.DB.prepare('SELECT id, json, start_ms FROM briefings WHERE no IS NULL ORDER BY start_ms, created_at').all()).results || [];
    for (const r of rows) {
      let b; try { b = JSON.parse(r.json); } catch { continue; }
      if (b.no) { await env.DB.prepare('UPDATE briefings SET no=? WHERE id=?').bind(b.no, r.id).run(); continue; }
      b.no = await nextNo(env, yearOf(b));
      await env.DB.prepare('UPDATE briefings SET no=?, json=?, end_ms=? WHERE id=?').bind(b.no, JSON.stringify(b), endMsOf(b), r.id).run();
    }
    await setKv(env, 'no_migrated', Date.now());
  }
  schemaReady = true;
}
/** Jahr des Fahrtdatums (Ablage nach Fahrt). */
function yearOf(b) { const d = b?.time?.date; if (/^\d{4}-/.test(d || '')) return +d.slice(0, 4); return new Date(b?.time?.startMs || b?.createdAt || Date.now()).getUTCFullYear(); }
/** Fahrtende für die Sperre: Start + max(6 h, Dauer + 2 h). */
const LOCK_AFTER_START_MS = 0;   // 0.12.10a: Sperre ab Startzeitpunkt (Nachtrag statt Bearbeitung)
const rowArchived = (row) => !!row?.frozen || !!(row?.end_ms && Date.now() > row.end_ms);
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(12))).map((x) => 'abcdefghijklmnopqrstuvwxyz0123456789'[x % 36]).join('');
/** Briefingnummer des Nachtrags: «2026-008» → «2026-008a» → «2026-008b». */
function nextAmendmentNo(no) { const m = /^(.*?)([a-z])?$/.exec(String(no || '')); const base = m ? m[1] : String(no || ''); const l = m && m[2] ? String.fromCharCode(m[2].charCodeAt(0) + 1) : 'a'; return base + (l > 'z' ? 'z' : l); }
function endMsOf(b) { const start = b?.time?.startMs || 0; const dur = (b?.intent?.durationMin || 0) * 60000; return start + dur + 6 * 3600000; }   // 0.12.10a: Landung + 6 h
/** Nächste Ordnungsnummer «JJJJ-NNN» (Zähler je Jahr in kv; atomar via UPDATE … RETURNING). */
async function nextNo(env, year) {
  const k = `seq:${year}`;
  await env.DB.prepare('INSERT OR IGNORE INTO kv (k,v,updated_at) VALUES (?,?,?)').bind(k, '0', Date.now()).run();
  const r = await env.DB.prepare('UPDATE kv SET v=CAST(CAST(v AS INTEGER)+1 AS TEXT), updated_at=? WHERE k=? RETURNING v').bind(Date.now(), k).first();
  let n = +(r?.v || 0);
  // Lücken durch importierte Nummern schliessen
  const mx = await env.DB.prepare('SELECT MAX(CAST(SUBSTR(no, 6) AS INTEGER)) AS m FROM briefings WHERE no LIKE ?').bind(`${year}-%`).first();
  if ((mx?.m || 0) >= n) { n = (mx.m || 0) + 1; await setKv(env, k, n); }
  return `${year}-${String(n).padStart(3, '0')}`;
}

// ------------------------------------------------------------ Benutzer
let usersReady = false;
/** Erster Start: Supermaster aus dem bisherigen Kennwort (kv) anlegen, Einstellungen übernehmen. */
async function ensureUsers(env) {
  if (usersReady) return;
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  if (!(n?.n > 0)) {
    let pw = await getKv(env, 'password');
    if (!pw) { const salt = rnd(16); pw = { salt, hash: await pbkdf2(DEFAULT_PASSWORD, salt) }; }
    const legacy = await getKv(env, 'settings');
    await env.DB.prepare('INSERT INTO users (id,name,role,salt,hash,active,flags,created_at) VALUES (?,?,?,?,?,1,?,?)')
      .bind(FIRST_USER.id, legacy?.ownerName || FIRST_USER.name, 'super', pw.salt, pw.hash, JSON.stringify({ ai: true, notam: true, pdf: true }), Date.now()).run();
    if (legacy && !(await getKv(env, `settings:${FIRST_USER.id}`))) await setKv(env, `settings:${FIRST_USER.id}`, legacy);
  }
  usersReady = true;
}
function userOut(r) {
  let flags = {}; try { flags = JSON.parse(r.flags || '{}'); } catch { /* leer */ }
  return { id: r.id, name: r.name, role: r.role, active: !!r.active, flags, createdAt: r.created_at, lastLoginAt: r.last_login_at };
}
async function getUser(env, id) { const r = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first(); return r ? userOut(r) : null; }
async function verifyUser(env, id, password) {
  const r = await env.DB.prepare('SELECT * FROM users WHERE id=? AND active=1').bind(id).first();
  if (!r) return null;
  const h = await pbkdf2(String(password || ''), r.salt);
  return timingSafeEqual(h, r.hash) ? userOut(r) : null;
}
async function setPassword(env, id, password) {
  const salt = rnd(16);
  await env.DB.prepare('UPDATE users SET salt=?, hash=? WHERE id=?').bind(salt, await pbkdf2(String(password), salt), id).run();
}
const can = (user, flag) => !!user && (user.role === 'super' || user.flags?.[flag] !== false);

// ------------------------------------------------------------ Sitzung
const IDLE_MS = 2 * 3600000;   // 0.12.16: Sitzung endet serverseitig nach 2 h ohne Anfrage (Entscheid 11.10.2026)
async function ensureSessions(env) {
  if (ensureSessions.done) return; ensureSessions.done = true;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_ms INTEGER NOT NULL, last_ms INTEGER NOT NULL)').run();
}
async function makeToken(env, uid) {
  await ensureSessions(env);
  const sid = rnd(12);
  await env.DB.prepare('INSERT INTO sessions (id,user_id,created_ms,last_ms) VALUES (?,?,?,?)').bind(sid, uid, Date.now(), Date.now()).run();
  const payload = b64u(enc.encode(JSON.stringify({ uid, sid, exp: Date.now() + SESSION_DAYS * 86400000, r: rnd(8) })));
  return `${payload}.${await hmac(env.SESSION_SECRET, payload)}`;
}
/** Sitzung aus dem Token (für Abmelden/Protokoll). */
function tokenPayload(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.get('Authorization') || ''); if (!m) return null;
  try { return JSON.parse(dec.decode(unb64u(m[1].split('.')[0]))); } catch { return null; }
}
/** Gültige Sitzung → Benutzer (aktiv), sonst null. */
async function sessionUser(env, req) {
  const auth = req.headers.get('Authorization') || '';
  const m = /^Bearer (.+)$/.exec(auth);
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig) return null;
  const expect = await hmac(env.SESSION_SECRET, payload);
  if (expect.length !== sig.length || !timingSafeEqual(expect, sig)) return null;
  let p; try { p = JSON.parse(dec.decode(unb64u(payload))); } catch { return null; }
  if (!(p.exp > Date.now()) || !p.uid) return null;
  await ensureUsers(env);
  await ensureSchema(env);
  // 0.12.16: Leerlaufsperre – Sitzung ohne Anfrage seit > 2 h ist beendet; Tokens ohne Sitzungskennung (vor 0.12.16) gelten nicht mehr
  await ensureSessions(env);
  if (!p.sid) return null;
  const ss = await env.DB.prepare('SELECT last_ms FROM sessions WHERE id=? AND user_id=?').bind(p.sid, p.uid).first();
  if (!ss) return null;
  const now = Date.now();
  if (now - ss.last_ms > IDLE_MS) { await env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(p.sid).run(); return null; }
  if (now - ss.last_ms > 60000) env.DB.prepare('UPDATE sessions SET last_ms=? WHERE id=?').bind(now, p.sid).run().catch(() => null);
  const u = await getUser(env, p.uid);
  return u && u.active ? u : null;
}

// ------------------------------------------------------------ Nutzung
function logUsage(env, ctx, uid, kind, detail = null, n = 1) {
  if (!uid) return;
  const p = env.DB.prepare('INSERT INTO usage (user_id,ts,kind,detail,n) VALUES (?,?,?,?,?)').bind(uid, Date.now(), kind, detail == null ? null : String(detail).slice(0, 120), Math.round(+n || 0)).run().catch((e) => console.warn('usage', e));
  ctx ? ctx.waitUntil(p) : null;
}

// ------------------------------------------------------------ Einstellungen & Stamm
async function userSettings(env, uid) {
  return (await getKv(env, `settings:${uid}`)) || (uid === FIRST_USER.id ? (await getKv(env, 'settings')) || {} : {});
}
/** Freigaben, die uid erhalten hat → Stamm-Auszüge je Geber (nur freigegebene Kategorien). */
async function sharedStamm(env, uid) {
  const rows = await env.DB.prepare('SELECT s.from_user, s.categories, u.name FROM shares s JOIN users u ON u.id=s.from_user WHERE s.to_user=? AND u.active=1').bind(uid).all();
  const out = [];
  for (const r of rows.results || []) {
    let cats = []; try { cats = JSON.parse(r.categories); } catch { /* leer */ }
    cats = cats.filter((c) => CATEGORIES.includes(c));
    if (!cats.length) continue;
    const s = await userSettings(env, r.from_user);
    const stamm = {};
    for (const c of cats) {
      if (c === 'balloons') stamm.balloons = { hab: s.balloons?.hab || [], envelopes: s.balloons?.envelopes || [], baskets: s.balloons?.baskets || [] };
      else stamm[c] = s[c] || [];
    }
    out.push({ from: r.from_user, fromName: r.name, categories: cats, stamm });
  }
  return out;
}
async function listShares(env, uid, all = false) {
  const rows = await env.DB.prepare(`SELECT s.id, s.from_user, s.to_user, s.categories, s.created_at, f.name AS from_name, t.name AS to_name FROM shares s
    JOIN users f ON f.id=s.from_user JOIN users t ON t.id=s.to_user ${all ? '' : 'WHERE s.from_user=? OR s.to_user=?'} ORDER BY s.created_at`).bind(...(all ? [] : [uid, uid])).all();
  return (rows.results || []).map((r) => { let c = []; try { c = JSON.parse(r.categories); } catch { /* leer */ } return { id: r.id, from: r.from_user, fromName: r.from_name, to: r.to_user, toName: r.to_name, categories: c, createdAt: r.created_at }; });
}
async function hasShare(env, from, to, category) {
  const r = await env.DB.prepare('SELECT categories FROM shares WHERE from_user=? AND to_user=?').bind(from, to).first();
  if (!r) return false;
  try { return JSON.parse(r.categories).includes(category); } catch { return false; }
}

// ------------------------------------------------------------ Briefings
function summaryOf(b) {
  return { id: b.id, no: b.no || null, startMs: b.time?.startMs, endMs: endMsOf(b), tz: b.site?.tz, site: b.site?.name, icao: b.site?.icao, elev: b.site?.elev, balloon: b.balloon?.label, reg: b.balloon?.reg, kind: b.flight?.kind, status: b.status, finalNo: b.finalNo, progress: Number.isFinite(+b.progress) ? Math.round(+b.progress) : null, edition: Number.isFinite(+b.edition) ? Math.round(+b.edition) : null, revision: b.revision, updatedAt: b.updatedAt, updatedBy: b.updatedBy };
}
const rowOut = (r) => ({ id: r.id, no: r.no || null, startMs: r.start_ms, endMs: r.end_ms ?? null, tz: r.tz, site: r.site, icao: r.icao, elev: r.elev, reg: r.reg, balloon: r.balloon, kind: r.kind, status: r.status, finalNo: r.final_no, progress: r.progress ?? null, edition: r.edition ?? null, frozen: !!r.frozen, hidden: !!r.hidden, revision: r.revision, updatedAt: r.updated_at, updatedBy: r.updated_by, links: r.links ?? 0, owner: r.owner_id, ownerName: r.owner_name || r.owner_id, materialOwner: r.material_owner || null, trajectoryAt: r.traj_at ?? null });
/** Speichern; ownerId nur beim Anlegen gesetzt; materialOwner = Eigner des Ballons (Freigabe nötig). */
async function saveBriefing(env, ctx, b, who, ownerId, logUid, opts = {}) {
  await ensureSchema(env);
  const row = await env.DB.prepare("SELECT revision, owner_id, final_no, no, json_extract(json, '$.docs') AS docs FROM briefings WHERE id=?").bind(b.id).first();
  const isNew = !row;
  const owner = row?.owner_id || ownerId;
  b.revision = (row?.revision || 0) + 1; b.updatedAt = Date.now(); b.updatedBy = who || 'owner';
  if (!b.createdAt) b.createdAt = b.updatedAt;
  b.ownerId = owner;
  // Ordnungsnummer: bleibt, sobald vergeben; neu oder (Import) belegt → nächste Nummer des Fahrtjahres
  if (opts.keepNo) { /* 0.12.10 Nachtrag: Nummer wie übergeben (Archivkopie behält die bisherige, das Briefing bekommt den Buchstaben) */ }
  else if (row?.no) b.no = row.no;
  else {
    const taken = b.no ? await env.DB.prepare('SELECT id FROM briefings WHERE no=? AND id<>?').bind(b.no, b.id).first() : null;
    if (!b.no || taken) b.no = await nextNo(env, yearOf(b));
  }
  let material = b.balloon?.ownerId && b.balloon.ownerId !== owner ? String(b.balloon.ownerId) : null;
  if (material && !(await hasShare(env, material, owner, 'balloons'))) material = null;
  const s = summaryOf(b);
  await env.DB.prepare(`INSERT INTO briefings (id,json,revision,status,final_no,start_ms,tz,site,icao,elev,reg,balloon,kind,created_at,updated_at,updated_by,owner_id,material_owner,no,progress,end_ms,edition,frozen)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET json=excluded.json, revision=excluded.revision, status=excluded.status, final_no=excluded.final_no, start_ms=excluded.start_ms, tz=excluded.tz, site=excluded.site, icao=excluded.icao, elev=excluded.elev, reg=excluded.reg, balloon=excluded.balloon, kind=excluded.kind, updated_at=excluded.updated_at, updated_by=excluded.updated_by, material_owner=excluded.material_owner, no=excluded.no, progress=excluded.progress, end_ms=excluded.end_ms, edition=excluded.edition, frozen=excluded.frozen`)
    .bind(b.id, JSON.stringify(b), b.revision, b.status || 'draft', b.finalNo || 0, s.startMs || null, s.tz || null, s.site || null, s.icao || null, s.elev ?? null, s.reg || null, s.balloon || null, s.kind || null, b.createdAt, b.updatedAt, b.updatedBy, owner, material, b.no, s.progress, s.endMs, s.edition, b.frozen ? 1 : 0).run();
  if (logUid) {
    logUsage(env, ctx, logUid, isNew ? 'briefing_create' : 'briefing_save', b.id);
    if ((b.finalNo || 0) > (row?.final_no || 0)) logUsage(env, ctx, logUid, 'release', `${b.id} v${b.finalNo}`);
    // 0.13.0a: digitale Signaturen der Betriebsdokumente protokollieren (neu gesetzte Signatur gegenüber dem gespeicherten Stand)
    try { const old = row?.docs ? JSON.parse(row.docs) : {}; for (const k of ['bs', 'fa']) for (const r of ['opSig', 'picSig']) { const sig = b.docs?.[k]?.[r]; if (sig?.ts && sig.ts !== old?.[k]?.[r]?.ts) logUsage(env, ctx, logUid, 'doc_sign', `${b.id} ${k} ${r === 'opSig' ? 'Betreiber' : 'PIC'} ${sig.name || ''}`); } } catch { /* ohne Protokoll */ }
  }
  return { revision: b.revision, updatedAt: b.updatedAt, updatedBy: b.updatedBy, no: b.no };
}
async function loadBriefing(env, id) {
  const row = await env.DB.prepare('SELECT json, owner_id, material_owner FROM briefings WHERE id=?').bind(id).first();
  if (!row) return null;
  const b = JSON.parse(row.json);
  b.ownerId = row.owner_id; b.materialOwner = row.material_owner || null;
  const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM access_links WHERE briefing_id=? AND revoked=0 AND expires_at>?').bind(id, Date.now()).first();
  b.accessCount = c?.n || 0;
  return b;
}
/** Zugriff eines Benutzers auf ein Briefing: 'write' (Eigner), 'read' (Super, Materialeigner) oder null. */
async function briefingAccess(env, user, id) {
  const row = await env.DB.prepare('SELECT owner_id, material_owner, end_ms, frozen, start_ms, no FROM briefings WHERE id=?').bind(id).first();
  if (!row) return { row: null, access: null };
  if (row.owner_id === user.id) return { row, access: 'write' };
  if (user.role === 'super' || row.material_owner === user.id) return { row, access: 'read' };
  return { row, access: null };
}

// ------------------------------------------------------------ Router
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const corsOrigin = allowed.includes(origin) ? origin : (allowed[0] || '*');
    const cors = { 'Access-Control-Allow-Origin': corsOrigin, 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400', 'Vary': 'Origin' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      const res = await route(req, env, url, ctx);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      console.error(e);
      return json({ error: e.message || 'error' }, 500, cors);
    }
  },
};

async function route(req, env, url, ctx) {
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const m = (re) => re.exec(p);
  const body = async () => { try { return await req.json(); } catch { return {}; } };
  const ip = req.headers.get('CF-Connecting-IP') || '0.0.0.0';

  if (p === '/api/health') return json({ ok: true, version: env.APP_VERSION || '', time: Date.now() });

  // ---- Dateien (unerratbare Schlüssel, öffentlich lesbar; Cache 1 Jahr)
  let mm = m(/^\/files\/([a-z0-9-]+)\/([a-z0-9-]+\.(?:jpg|png|webp|gif|pdf))$/);
  if (mm && req.method === 'GET') {
    const obj = await env.FILES.get(`${mm[1]}/${mm[2]}`);
    if (!obj) return err('not found', 404);
    const fname = String(mm[2]).split('/').pop().replace(/[^A-Za-z0-9._-]+/g, '_');
    return new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream', 'Content-Disposition': `inline; filename="${fname}"`, 'Cache-Control': 'public, max-age=31536000, immutable' } });
  }

  // ---- Datenabrufe (Sitzung oder gültiger persönlicher Link)
  mm = m(/^\/api\/wx\/([a-z]+)$/);
  if (mm) {
    const kind = mm[1];
    const user = await sessionUser(env, req);
    let link = null;
    if (!user && url.searchParams.get('t')) {
      link = await env.DB.prepare('SELECT * FROM access_links WHERE token=? AND revoked=0').bind(url.searchParams.get('t')).first();
      if (link && link.expires_at < Date.now()) link = null;
    }
    if (!user && !link) return err('unauthorized', 401);
    const b = req.method === 'POST' ? await body() : {};
    // Freischaltungen je Benutzer (Link-Nutzer: die des Briefing-Eigners)
    const bid = url.searchParams.get('b') || b.id || link?.briefing_id || null;
    let owner = user, acc = 'write';   // ohne Briefing-Bezug (oder noch nicht gespeichert): wie Eigner
    if (bid) {
      const row = await env.DB.prepare('SELECT owner_id FROM briefings WHERE id=?').bind(bid).first();
      if (row && !user) owner = await getUser(env, row.owner_id);
      if (row && user) acc = (await briefingAccess(env, user, bid)).access;
    }
    if (kind === 'ai' && !can(owner, 'ai')) return err('KI für diesen Nutzer nicht freigeschaltet', 403);
    if (kind === 'notam' && !can(owner, 'notam')) return err('NOTAM für diesen Nutzer nicht freigeschaltet', 403);
    if (kind === 'pdf' && !can(owner, 'pdf')) return err('PDF für diesen Nutzer nicht freigeschaltet', 403);
    // Schreibende Abrufe (Dateien ins Briefing) nur für den Eigner
    if (user && bid && ['dabs', 'snapshot', 'pdf'].includes(kind) && acc !== 'write') return err('read only', 403);
    const res = await handleWx(kind, req, env, ctx, url.searchParams, b, { owner: !!user && acc !== 'read', link, user }, decrypt);
    const uid = user?.id || owner?.id;
    if (res.ok && uid) {
      if (kind === 'ai') { try { const j = await res.clone().json(); logUsage(env, ctx, uid, 'ai', j.model, (j.usage?.input_tokens || 0) + (j.usage?.output_tokens || 0)); } catch { logUsage(env, ctx, uid, 'ai'); } }
      else if (kind === 'pdf') { try { const j = await res.clone().json(); logUsage(env, ctx, uid, 'pdf', bid, j.size || 0); } catch { logUsage(env, ctx, uid, 'pdf', bid); } }
      else logUsage(env, ctx, uid, `wx_${kind}`, url.searchParams.get('model') || url.searchParams.get('src') || null);
    }
    return res;
  }

  // ---- Sitzung
  if (p === '/api/session' && req.method === 'POST') {
    await ensureUsers(env);
    const since = Date.now() - ATTEMPT_WINDOW;
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip=? AND ts>?').bind(ip, since).first();
    if ((n?.n || 0) >= MAX_ATTEMPTS) return err('too many attempts', 429);
    const { user: uidIn, password } = await body();
    let uid = String(uidIn || '').trim().toLowerCase();
    if (!uid) { const su = await env.DB.prepare('SELECT id FROM users WHERE role=? AND active=1 ORDER BY created_at LIMIT 1').bind('super').first(); uid = su?.id || FIRST_USER.id; }
    const u = uidOk(uid) ? await verifyUser(env, uid, password) : null;
    if (!u) {
      await env.DB.prepare('INSERT INTO login_attempts (ip,ts) VALUES (?,?)').bind(ip, Date.now()).run();
      ctx.waitUntil(env.DB.prepare('DELETE FROM login_attempts WHERE ts<?').bind(since).run());
      return err('wrong password', 401);
    }
    await env.DB.prepare('DELETE FROM login_attempts WHERE ip=?').bind(ip).run();
    await env.DB.prepare('UPDATE users SET last_login_at=? WHERE id=?').bind(Date.now(), u.id).run();
    logUsage(env, ctx, u.id, 'login');
    return json({ token: await makeToken(env, u.id), user: { id: u.id, name: u.name, role: u.role, flags: u.flags } });
  }
  if (p === '/api/session' && req.method === 'DELETE') {
    const pl = tokenPayload(req);
    if (pl?.sid) { await ensureSessions(env); await env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(pl.sid).run(); logUsage(env, ctx, pl.uid, 'logout'); }
    return new Response(null, { status: 204 });
  }

  // ---- Persönliche Links (ohne Sitzung)
  mm = m(/^\/api\/shared\/([A-Za-z0-9_-]+)$/);
  if (mm) {
    const link = await env.DB.prepare('SELECT * FROM access_links WHERE token=?').bind(mm[1]).first();
    if (!link || link.revoked) return err('link revoked', 410);
    if (link.expires_at < Date.now()) return err('link expired', 410);
    const b = await loadBriefing(env, link.briefing_id);
    if (!b) return err('not found', 404);
    if (req.method === 'GET') {
      ctx.waitUntil(env.DB.prepare('UPDATE access_links SET last_opened_at=? WHERE token=?').bind(Date.now(), link.token).run());
      if (link.person !== 'PDF-Renderer') logUsage(env, ctx, b.ownerId, 'link_open', `${b.id} ${link.person}`);
      return json({ briefing: b, role: link.role, person: link.person, settings: await userSettings(env, b.ownerId) });
    }
    if (req.method === 'PUT') {
      if (link.role !== 'edit') return err('read only', 403);
      if (b.frozen || Date.now() > endMsOf(b)) return err('locked', 423);   // 0.12.10: Archiv auch über Links unveränderlich
      const { briefing, who } = await body();
      logUsage(env, ctx, b.ownerId, 'link_save', `${b.id} ${link.person}`);
      if (!briefing || briefing.id !== b.id) return err('bad briefing');
      // Mitarbeit darf weder Freigabe noch Berechtigungen ändern
      briefing.status = b.status; briefing.finalNo = b.finalNo; briefing.versions = b.versions;
      return json(await saveBriefing(env, ctx, briefing, `${who || link.person} (Link)`, b.ownerId, null));
    }
    return err('method', 405);
  }

  // ---- Material-Links (ohne Sitzung): externer Materialeigner sieht alle Briefings mit seinen Kennungen
  mm = m(/^\/api\/material\/([A-Za-z0-9_-]+)(?:\/([a-z0-9]+))?$/);
  if (mm && req.method === 'GET') {
    const ml = await env.DB.prepare('SELECT * FROM material_links WHERE token=?').bind(mm[1]).first();
    if (!ml || ml.revoked) return err('link revoked', 410);
    if (ml.expires_at < Date.now()) return err('link expired', 410);
    let regs = []; try { regs = JSON.parse(ml.regs); } catch { /* leer */ }
    regs = regs.map((r) => String(r)).filter(Boolean);
    if (!regs.length) return err('no regs', 410);
    const owner = await getUser(env, ml.user_id);
    if (!owner || !owner.active) return err('link revoked', 410);
    const marks = regs.map(() => '?').join(',');
    ctx.waitUntil(env.DB.prepare('UPDATE material_links SET last_opened_at=? WHERE token=?').bind(Date.now(), ml.token).run());
    if (!mm[2]) {
      await ensureTrajectories(env);
      const rows = await env.DB.prepare(`SELECT b.id,b.no,b.progress,b.edition,b.end_ms,b.frozen,b.start_ms,b.tz,b.site,b.icao,b.elev,b.reg,b.balloon,b.kind,b.status,b.final_no,b.revision,b.updated_at,b.updated_by,b.owner_id,b.material_owner,u.name AS owner_name,
        (SELECT tr.received_at FROM trajectories tr WHERE tr.briefing_id=b.id) AS traj_at
        FROM briefings b LEFT JOIN users u ON u.id=b.owner_id WHERE (b.owner_id=? OR b.material_owner=?) AND b.reg IN (${marks}) ORDER BY b.start_ms DESC`).bind(ml.user_id, ml.user_id, ...regs).all();
      logUsage(env, ctx, ml.user_id, 'link_open', `material ${ml.person}`);
      return json({ person: ml.person, regs, owner: owner.name, expiresAt: ml.expires_at, briefings: (rows.results || []).map(rowOut) });
    }
    const row = await env.DB.prepare(`SELECT id FROM briefings WHERE id=? AND (owner_id=? OR material_owner=?) AND reg IN (${marks})`).bind(mm[2], ml.user_id, ml.user_id, ...regs).first();
    if (!row) return err('not found', 404);
    const b = await loadBriefing(env, mm[2]);
    logUsage(env, ctx, ml.user_id, 'link_open', `material ${ml.person} ${mm[2]}`);
    return json({ briefing: b, role: 'read', person: ml.person, settings: await userSettings(env, b.ownerId) });
  }

  // ---- Bild-Upload über Link (Mitarbeit)
  mm = m(/^\/api\/briefings\/([a-z0-9]+)\/files$/);
  if (mm && req.method === 'POST' && url.searchParams.get('t')) {
    const link = await env.DB.prepare('SELECT * FROM access_links WHERE token=? AND briefing_id=? AND revoked=0 AND role=?').bind(url.searchParams.get('t'), mm[1], 'edit').first();
    if (!link || link.expires_at < Date.now()) return err('forbidden', 403);
    const row = await env.DB.prepare('SELECT owner_id FROM briefings WHERE id=?').bind(mm[1]).first();
    return uploadFile(env, ctx, mm[1], await body(), row?.owner_id);
  }

  // ---- 0.14.0: Übergabe aus analyze.wicki.aero (Dienst-Token zwischen den Workern, Secret OPS_HANDOVER_TOKEN)
  if (p === '/api/handover/briefings' && req.method === 'GET') {
    const a = handoverAuth(env, req); if (a) return err(a.error, a.status);
    return json({ briefings: await listHandoverBriefings(env, url.searchParams.get('limit')) });
  }
  mm = m(/^\/api\/handover\/briefings\/([a-z0-9]+)\/trajectory$/);
  if (mm && req.method === 'PUT') {
    const a = handoverAuth(env, req); if (a) return err(a.error, a.status);
    const r = await putTrajectory(env, ctx, mm[1], await body(), env.APP_URL, logUsage);
    return r.ok ? json(r) : err(r.error, r.status);
  }
  // Ist-Trajektorie über persönlichen Link (?t=) oder Material-Link (?mt=): bis 3 Monate nach der Landung (Konzept 4.4)
  mm = m(/^\/api\/briefings\/([a-z0-9]+)\/trajectory$/);
  if (mm && req.method === 'GET' && (url.searchParams.get('t') || url.searchParams.get('mt'))) {
    const id = mm[1];
    let ok = false;
    if (url.searchParams.get('t')) { const link = await env.DB.prepare('SELECT * FROM access_links WHERE token=? AND briefing_id=? AND revoked=0').bind(url.searchParams.get('t'), id).first(); ok = !!link && link.expires_at >= Date.now(); }
    else { const ml = await env.DB.prepare('SELECT * FROM material_links WHERE token=? AND revoked=0').bind(url.searchParams.get('mt')).first(); if (ml && ml.expires_at >= Date.now()) { let regs = []; try { regs = JSON.parse(ml.regs); } catch { /* leer */ } const row = await env.DB.prepare('SELECT reg, owner_id, material_owner FROM briefings WHERE id=?').bind(id).first(); ok = !!row && (row.owner_id === ml.user_id || row.material_owner === ml.user_id) && regs.map(String).includes(String(row.reg)); } }
    if (!ok) return err('forbidden', 403);
    const row = await env.DB.prepare('SELECT end_ms FROM briefings WHERE id=?').bind(id).first();
    if (!linkMayView(row)) return err('expired', 410);
    const tr = await getTrajectory(env, id);
    return tr ? json(tr) : err('not found', 404);
  }

  // ---- Alles Weitere braucht eine Sitzung
  if (!p.startsWith('/api/')) return err('not found', 404);
  const user = await sessionUser(env, req);
  if (!user) return err('unauthorized', 401);
  const isSuper = user.role === 'super';

  if (p === '/api/me' && req.method === 'GET') {
    const given = (await listShares(env, user.id)).filter((s) => s.from === user.id).map((s) => ({ to: s.to, toName: s.toName, categories: s.categories }));
    return json({ user: { id: user.id, name: user.name, role: user.role, flags: user.flags }, shared: await sharedStamm(env, user.id), given });
  }
  // ---- Dokumente zu Stammdaten (Ballon, Person): Ablage wie Briefing-Dateien unter docs-<Benutzer>/…
  if (p === '/api/docs' && req.method === 'POST') return uploadFile(env, ctx, `docs-${user.id.toLowerCase().replace(/[^a-z0-9]/g, 'x')}`, await body(), user.id);
  if (p === '/api/password' && req.method === 'POST') {
    const { oldPassword, newPassword } = await body();
    if (!(await verifyUser(env, user.id, oldPassword))) return err('wrong password', 403);
    if (!newPassword || String(newPassword).length < 4) return err('too short');
    await setPassword(env, user.id, newPassword);
    return json({ ok: true });
  }
  if (p === '/api/settings') {
    const other = url.searchParams.get('user');
    if (req.method === 'GET') {
      if (other && other !== user.id) { if (!isSuper) return err('forbidden', 403); return json({ settings: await userSettings(env, other), readOnly: true, user: other }); }
      return json({ settings: await userSettings(env, user.id) });
    }
    if (req.method === 'PUT') { const { settings } = await body(); await setKv(env, `settings:${user.id}`, settings || {}); logUsage(env, ctx, user.id, 'settings_save'); if (settings?.ownerName) ctx.waitUntil(env.DB.prepare('UPDATE users SET name=? WHERE id=?').bind(String(settings.ownerName).slice(0, 80), user.id).run()); return json({ ok: true }); }
  }
  // ---- Zugänge (API-Schlüssel): zentral, nur Super schreibt; alle sehen, was vorhanden ist
  if (p === '/api/secrets') {
    if (req.method === 'GET') { const rows = await env.DB.prepare('SELECT name FROM secrets').all(); return json({ secrets: Object.fromEntries((rows.results || []).map((r) => [r.name, true])), readOnly: !isSuper }); }
    if (req.method === 'PUT') {
      if (!isSuper) return err('forbidden', 403);
      const { name, value } = await body();
      if (!/^[a-z0-9_]{1,40}$/.test(name || '') || typeof value !== 'string' || !value) return err('bad secret');
      const { iv, ct } = await encrypt(env, value);
      logUsage(env, ctx, user.id, 'secret_set', name);
      await env.DB.prepare('INSERT INTO secrets (name,iv,ct,updated_at) VALUES (?,?,?,?) ON CONFLICT(name) DO UPDATE SET iv=excluded.iv, ct=excluded.ct, updated_at=excluded.updated_at').bind(name, iv, ct, Date.now()).run();
      return json({ ok: true });
    }
  }
  mm = m(/^\/api\/secrets\/([a-z0-9_]+)$/);
  if (mm && req.method === 'DELETE') { if (!isSuper) return err('forbidden', 403); await env.DB.prepare('DELETE FROM secrets WHERE name=?').bind(mm[1]).run(); logUsage(env, ctx, user.id, 'secret_delete', mm[1]); return new Response(null, { status: 204 }); }
  if (mm && req.method === 'GET') {
    // Wert anzeigen (nur Supermaster, wird protokolliert) — z. B. um einen Schlüssel zu prüfen oder zu übernehmen
    if (!isSuper) return err('forbidden', 403);
    const row = await env.DB.prepare('SELECT iv, ct, updated_at FROM secrets WHERE name=?').bind(mm[1]).first();
    if (!row) return err('not found', 404);
    logUsage(env, ctx, user.id, 'secret_view', mm[1]);
    return json({ name: mm[1], value: await decrypt(env, row.iv, row.ct), updatedAt: row.updated_at }, 200, { 'Cache-Control': 'no-store' });
  }

  // ---- Benutzerliste (für Freigaben) und Freigaben
  if (p === '/api/users' && req.method === 'GET') {
    const rows = await env.DB.prepare('SELECT id,name,role FROM users WHERE active=1 ORDER BY name').all();
    return json({ users: (rows.results || []).map((r) => ({ id: r.id, name: r.name, role: r.role })) });
  }
  if (p === '/api/shares') {
    if (req.method === 'GET') return json({ shares: await listShares(env, user.id, isSuper && url.searchParams.get('all') === '1') });
    if (req.method === 'POST') {
      const { to, categories } = await body();
      if (!uidOk(to) || to === user.id) return err('bad user');
      if (!(await getUser(env, to))) return err('unknown user', 404);
      const cats = (Array.isArray(categories) ? categories : []).filter((c) => CATEGORIES.includes(c));
      const ex = await env.DB.prepare('SELECT id FROM shares WHERE from_user=? AND to_user=?').bind(user.id, to).first();
      if (!cats.length) { if (ex) await env.DB.prepare('DELETE FROM shares WHERE id=?').bind(ex.id).run(); return json({ ok: true, removed: true }); }
      if (ex) await env.DB.prepare('UPDATE shares SET categories=? WHERE id=?').bind(JSON.stringify(cats), ex.id).run();
      else await env.DB.prepare('INSERT INTO shares (id,from_user,to_user,categories,created_at) VALUES (?,?,?,?,?)').bind(rnd(8).toLowerCase().replace(/[^a-z0-9]/g, 'x'), user.id, to, JSON.stringify(cats), Date.now()).run();
      logUsage(env, ctx, user.id, 'share', `${to}: ${cats.join(',')}`);
      return json({ ok: true, categories: cats });
    }
  }
  mm = m(/^\/api\/shares\/([a-z0-9]+)$/);
  if (mm && req.method === 'DELETE') {
    const r = await env.DB.prepare('SELECT from_user FROM shares WHERE id=?').bind(mm[1]).first();
    if (!r) return err('not found', 404);
    if (r.from_user !== user.id && !isSuper) return err('forbidden', 403);
    await env.DB.prepare('DELETE FROM shares WHERE id=?').bind(mm[1]).run();
    return new Response(null, { status: 204 });
  }

  // ---- Material-Links verwalten (eigene)
  if (p === '/api/material-links') {
    if (req.method === 'GET') {
      const rows = await env.DB.prepare('SELECT token,person,regs,expires_at,created_at,last_opened_at FROM material_links WHERE user_id=? AND revoked=0 ORDER BY created_at').bind(user.id).all();
      return json({ links: (rows.results || []).map((r) => { let regs = []; try { regs = JSON.parse(r.regs); } catch { /* leer */ } return { token: r.token, person: r.person, regs, expiresAt: r.expires_at, createdAt: r.created_at, lastOpenedAt: r.last_opened_at }; }) });
    }
    if (req.method === 'POST') {
      const { person, regs, expiresAt } = await body();
      const list = (Array.isArray(regs) ? regs : []).map((r) => String(r).trim().toUpperCase().slice(0, 20)).filter(Boolean).slice(0, 20);
      if (!person || !list.length) return err('bad link');
      const token = rnd(16);
      await env.DB.prepare('INSERT INTO material_links (token,user_id,person,regs,expires_at,created_at) VALUES (?,?,?,?,?,?)').bind(token, user.id, String(person).slice(0, 80), JSON.stringify(list), +expiresAt || Date.now() + 365 * 86400000, Date.now()).run();
      logUsage(env, ctx, user.id, 'link_create', `material ${list.join(',')}`);
      return json({ link: { token, person, regs: list, expiresAt: +expiresAt || Date.now() + 365 * 86400000 } });
    }
  }
  mm = m(/^\/api\/material-links\/([A-Za-z0-9_-]+)$/);
  if (mm && req.method === 'DELETE') { await env.DB.prepare('UPDATE material_links SET revoked=1 WHERE token=? AND user_id=?').bind(mm[1], user.id).run(); return new Response(null, { status: 204 }); }

  // ---- Briefings: Liste nach Sicht (own | all [Super] | material)
  if (p === '/api/briefings' && req.method === 'GET') {
    const scope = url.searchParams.get('scope') || 'own';
    let where = 'b.owner_id=?', args = [user.id];
    if (scope === 'all') { if (!isSuper) return err('forbidden', 403); where = '1=1'; args = []; }
    else if (scope === 'material') { where = 'b.material_owner=? AND b.owner_id<>?'; args = [user.id, user.id]; }
    // 0.12.10a: vom Supermaster ausgeblendete Archiv-Einträge; 0.12.12: Supermaster kann sie mit hidden=1 auflisten (und wieder einblenden)
    const wantHidden = url.searchParams.get('hidden') === '1';
    if (wantHidden && !isSuper) return err('forbidden', 403);
    where = `(${where}) AND COALESCE(b.hidden,0)=${wantHidden ? 1 : 0}`;
    await ensureSchema(env);
    const rows = await env.DB.prepare(`SELECT b.id,b.no,b.progress,b.edition,b.end_ms,b.frozen,b.start_ms,b.tz,b.site,b.icao,b.elev,b.reg,b.balloon,b.kind,b.status,b.final_no,b.revision,b.updated_at,b.updated_by,b.owner_id,b.material_owner,u.name AS owner_name,
      (SELECT COUNT(*) FROM access_links a WHERE a.briefing_id=b.id AND a.revoked=0 AND a.expires_at>?) AS links,
      (SELECT tr.received_at FROM trajectories tr WHERE tr.briefing_id=b.id) AS traj_at FROM briefings b LEFT JOIN users u ON u.id=b.owner_id WHERE ${where} ORDER BY b.start_ms`).bind(Date.now(), ...args).all();
    return json({ briefings: (rows.results || []).map(rowOut), scope });
  }
  if (p === '/api/export' && req.method === 'GET') {
    const all = isSuper && url.searchParams.get('all') === '1';
    logUsage(env, ctx, user.id, 'export', all ? 'all' : 'own');
    const rows = all ? await env.DB.prepare('SELECT json FROM briefings').all() : await env.DB.prepare('SELECT json FROM briefings WHERE owner_id=?').bind(user.id).all();
    const out = { exportedAt: Date.now(), user: user.id, settings: await userSettings(env, user.id), briefings: (rows.results || []).map((r) => JSON.parse(r.json)) };
    if (all) { const us = await env.DB.prepare('SELECT id FROM users').all(); out.users = {}; for (const u of us.results || []) out.users[u.id] = await userSettings(env, u.id); }
    return json(out);
  }
  mm = m(/^\/api\/briefings\/([a-z0-9]+)$/);
  if (mm) {
    const id = mm[1];
    const { row, access } = await briefingAccess(env, user, id);
    if (req.method === 'PUT') {
      const { briefing, who } = await body();
      if (!briefing || briefing.id !== id) return err('bad briefing');
      if (row && access !== 'write') return err('read only', 403);
      if (row && rowArchived(row)) return err('locked', 423);   // 0.12.9: Fahrt vorbei (oder Archivkopie) → unveränderlich
      return json(await saveBriefing(env, ctx, briefing, who || user.name, user.id, user.id));
    }
    if (!row) return err('not found', 404);
    if (!access) return err('forbidden', 403);
    if (req.method === 'GET') { const b = await loadBriefing(env, id); if (row.owner_id !== user.id) logUsage(env, ctx, user.id, 'briefing_open', `${id} (${row.owner_id})`); else logUsage(env, ctx, user.id, 'briefing_open', id); return json({ briefing: b, access }); }   // 0.12.16: Protokoll
    if (req.method === 'DELETE') {
      if (access !== 'write' && !(isSuper && rowArchived(row))) return err('read only', 403);
      if (rowArchived(row)) {   // 0.12.9: Archiv – kein Löschen; 0.12.10a: der Supermaster blendet Archiv-Einträge aus (nichts wird gelöscht)
        if (!isSuper) return err('locked', 423);
        await env.DB.prepare('UPDATE briefings SET hidden=1 WHERE id=?').bind(id).run();
        logUsage(env, ctx, user.id, 'briefing_hide', id);
        return new Response(null, { status: 204 });
      }
      await env.DB.prepare('DELETE FROM briefings WHERE id=?').bind(id).run();
      await env.DB.prepare('DELETE FROM access_links WHERE briefing_id=?').bind(id).run();
      await deleteTrajectory(env, ctx, id);   // 0.14.0
      // 0.12.10: Bilder bleiben, solange eine Archivkopie (Nachtrag) darauf verweist
      const refs = await env.DB.prepare('SELECT COUNT(*) AS n FROM briefings WHERE json LIKE ?').bind(`%"amendmentOf":"${id}"%`).first();
      if (!(refs?.n > 0)) {
        const files = await env.DB.prepare('SELECT key FROM files WHERE briefing_id=?').bind(id).all();
        for (const f of files.results || []) ctx.waitUntil(env.FILES.delete(f.key));
        await env.DB.prepare('DELETE FROM files WHERE briefing_id=?').bind(id).run();
      }
      logUsage(env, ctx, user.id, 'briefing_delete', id);
      return new Response(null, { status: 204 });
    }
  }
  // ---- 0.14.0: Ist-Trajektorie lesen (Eigner, Supermaster, Materialeigner) oder löschen (Eigner, Supermaster)
  mm = m(/^\/api\/briefings\/([a-z0-9]+)\/trajectory$/);
  if (mm) {
    const { row, access } = await briefingAccess(env, user, mm[1]);
    if (!row) return err('not found', 404);
    if (!access) return err('forbidden', 403);
    if (req.method === 'GET') { const tr = await getTrajectory(env, mm[1]); return tr ? json(tr) : err('not found', 404); }
    if (req.method === 'DELETE') { if (access !== 'write' && !isSuper) return err('read only', 403); const was = await deleteTrajectory(env, ctx, mm[1]); if (was) logUsage(env, ctx, user.id, 'trajectory_delete', mm[1]); return new Response(null, { status: 204 }); }
  }
  // ---- 0.12.12: ausgeblendeten Archiv-Eintrag wieder einblenden (nur Supermaster)
  mm = m(/^\/api\/briefings\/([a-z0-9]+)\/unhide$/);
  if (mm && req.method === 'POST') {
    if (!isSuper) return err('forbidden', 403);
    const r = await env.DB.prepare('UPDATE briefings SET hidden=0 WHERE id=?').bind(mm[1]).run();
    if (!r.meta?.changes) return err('not found', 404);
    logUsage(env, ctx, user.id, 'briefing_unhide', mm[1]);
    return new Response(null, { status: 204 });
  }
  // ---- 0.12.10: Nachtrag während der laufenden Fahrt (Start + 1 h vorbei, Fahrtende noch nicht erreicht)
  mm = m(/^\/api\/briefings\/([a-z0-9]+)\/amend$/);
  if (mm && req.method === 'POST') {
    const id = mm[1];
    const { row, access } = await briefingAccess(env, user, id);
    if (!row) return err('not found', 404);
    if (access !== 'write') return err('read only', 403);
    if (rowArchived(row)) return err('locked', 423);
    if (!(Date.now() > (row.start_ms || 0) + LOCK_AFTER_START_MS)) return err('not running', 409);
    const { who } = await body();
    const b = await loadBriefing(env, id); if (!b) return err('not found', 404);
    const now = Date.now();
    const copy = JSON.parse(JSON.stringify(b));
    copy.id = newId(); copy.frozen = true; copy.frozenAt = now; copy.amendmentOf = id; copy.no = b.no || null;
    delete copy.access; delete copy.amendments; delete copy.materialOwner;
    const oldNo = b.no || null;
    b.no = nextAmendmentNo(b.no || ''); b.amendments = [...(b.amendments || []), { no: oldNo, copyId: copy.id, ts: now }]; b.amendedAt = now;
    delete b.materialOwner;
    await saveBriefing(env, ctx, b, who || user.name, user.id, null, { keepNo: true });
    await saveBriefing(env, ctx, copy, who || user.name, user.id, null, { keepNo: true });
    logUsage(env, ctx, user.id, 'briefing_amend', `${id} ${oldNo} → ${b.no} (Archivkopie ${copy.id})`);
    return json({ no: b.no, copyId: copy.id });
  }
  mm = m(/^\/api\/briefings\/([a-z0-9]+)\/(files|log|access)(?:\/([A-Za-z0-9_-]+))?$/);
  if (mm) {
    const [, id, what, tok] = mm;
    const { row, access } = await briefingAccess(env, user, id);
    if (!row) return err('not found', 404);
    if (!access) return err('forbidden', 403);
    if (what === 'files' && req.method === 'POST') { if (access !== 'write') return err('read only', 403); return uploadFile(env, ctx, id, await body(), user.id); }
    if (what === 'log' && req.method === 'GET') { const b = await loadBriefing(env, id); return json({ log: b?.log || [] }); }
    if (what === 'access') {
      if (req.method === 'GET') {
        const rows = await env.DB.prepare('SELECT token,person,role,expires_at,created_at,last_opened_at FROM access_links WHERE briefing_id=? AND revoked=0 ORDER BY created_at').bind(id).all();
        return json({ links: (rows.results || []).map((r) => ({ token: r.token, person: r.person, role: r.role, expiresAt: r.expires_at, createdAt: r.created_at, lastOpenedAt: r.last_opened_at })) });
      }
      if (access !== 'write') return err('read only', 403);
      if (req.method === 'POST') {
        const { person, role, expiresAt } = await body();
        if (!person || !['read', 'edit'].includes(role)) return err('bad link');
        const token = rnd(16);
        await env.DB.prepare('INSERT INTO access_links (token,briefing_id,person,role,expires_at,created_at) VALUES (?,?,?,?,?,?)').bind(token, id, String(person).slice(0, 80), role, +expiresAt || Date.now() + 7 * 86400000, Date.now()).run();
        logUsage(env, ctx, user.id, 'link_create', `${id} ${role}`);
        return json({ link: { token, person, role, expiresAt } });
      }
      if (req.method === 'DELETE' && tok) { await env.DB.prepare('UPDATE access_links SET revoked=1 WHERE token=? AND briefing_id=?').bind(tok, id).run(); logUsage(env, ctx, user.id, 'link_revoke', id); return new Response(null, { status: 204 }); }
    }
  }

  // ---- Verwaltung (nur Super): Benutzer, Statistik
  if (p.startsWith('/api/admin/')) {
    if (!isSuper) return err('forbidden', 403);
    if (p === '/api/admin/users') {
      if (req.method === 'GET') {
        const rows = await env.DB.prepare(`SELECT u.*, (SELECT COUNT(*) FROM briefings b WHERE b.owner_id=u.id) AS briefings,
          (SELECT COUNT(*) FROM shares s WHERE s.from_user=u.id) AS shares_given, (SELECT COUNT(*) FROM shares s WHERE s.to_user=u.id) AS shares_received FROM users u ORDER BY u.created_at`).all();
        return json({ users: (rows.results || []).map((r) => ({ ...userOut(r), briefings: r.briefings, sharesGiven: r.shares_given, sharesReceived: r.shares_received })) });
      }
      if (req.method === 'POST') {
        const { id, name, password, role, flags, copyFrom } = await body();
        const uid = String(id || '').trim().toLowerCase();
        if (!uidOk(uid)) return err('bad id');
        if (await getUser(env, uid)) return err('exists', 409);
        if (!password || String(password).length < 4) return err('too short');
        const salt = rnd(16);
        const f = {}; for (const k of FLAGS) f[k] = flags?.[k] !== false;
        await env.DB.prepare('INSERT INTO users (id,name,role,salt,hash,active,flags,created_at) VALUES (?,?,?,?,?,1,?,?)')
          .bind(uid, String(name || uid).slice(0, 80), role === 'super' ? 'super' : 'master', salt, await pbkdf2(String(password), salt), JSON.stringify(f), Date.now()).run();
        if (copyFrom && uidOk(copyFrom) && await getUser(env, copyFrom)) {
          const src = await userSettings(env, copyFrom);
          const copy = JSON.parse(JSON.stringify(src)); copy.ownerName = String(name || uid).slice(0, 80);
          await setKv(env, `settings:${uid}`, copy);
        } else await setKv(env, `settings:${uid}`, { ownerName: String(name || uid).slice(0, 80) });   // Rest: Beispiel-Vorgaben der App (Client ergänzt)
        logUsage(env, ctx, user.id, 'user_create', uid);
        return json({ ok: true, user: await getUser(env, uid) });
      }
    }
    mm = m(/^\/api\/admin\/users\/([a-z0-9][a-z0-9_.-]+)$/);
    if (mm && req.method === 'PUT') {
      const uid = mm[1]; const u = await getUser(env, uid);
      if (!u) return err('not found', 404);
      const { name, role, active, flags, password } = await body();
      if (name) await env.DB.prepare('UPDATE users SET name=? WHERE id=?').bind(String(name).slice(0, 80), uid).run();
      if (role && uid !== user.id) await env.DB.prepare('UPDATE users SET role=? WHERE id=?').bind(role === 'super' ? 'super' : 'master', uid).run();
      if (active != null && uid !== user.id) await env.DB.prepare('UPDATE users SET active=? WHERE id=?').bind(active ? 1 : 0, uid).run();
      if (flags && typeof flags === 'object') { const f = { ...u.flags }; for (const k of FLAGS) if (k in flags) f[k] = flags[k] !== false; await env.DB.prepare('UPDATE users SET flags=? WHERE id=?').bind(JSON.stringify(f), uid).run(); }
      if (password) { if (String(password).length < 4) return err('too short'); await setPassword(env, uid, password); logUsage(env, ctx, user.id, 'password_reset', uid); }
      logUsage(env, ctx, user.id, 'user_update', `${uid}${role ? ' role=' + role : ''}${active != null ? ' active=' + (active ? 1 : 0) : ''}${flags ? ' flags' : ''}`);
      return json({ ok: true, user: await getUser(env, uid) });
    }
    if (p === '/api/admin/stats' && req.method === 'GET') return adminStats(env, url);
    if (p === '/api/admin/log' && req.method === 'GET') return adminLog(env, url);   // 0.12.16: Aktivitätsprotokoll (nur Supermaster)
  }

  return err('not found', 404);
}

// ------------------------------------------------------------ Statistik
/** 0.12.16: Aktivitätsprotokoll – Einzelereignisse aus «usage» mit Nutzername; Filter user, kind, from/to (ms), limit ≤ 2000; CSV mit format=csv. */
async function adminLog(env, url) {
  const q = url.searchParams;
  const where = [], args = [];
  if (q.get('user')) { where.push('u.user_id=?'); args.push(q.get('user')); }
  if (q.get('kind')) { where.push('u.kind LIKE ?'); args.push(q.get('kind').replace(/[%_]/g, '') + '%'); }
  if (+q.get('from')) { where.push('u.ts>=?'); args.push(+q.get('from')); }
  if (+q.get('to')) { where.push('u.ts<=?'); args.push(+q.get('to')); }
  const limit = Math.min(2000, Math.max(1, +q.get('limit') || 500));
  const rows = (await env.DB.prepare(`SELECT u.id, u.user_id, u.ts, u.kind, u.detail, u.n, s.name AS user_name FROM usage u LEFT JOIN users s ON s.id=u.user_id${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY u.ts DESC LIMIT ?`).bind(...args, limit).all()).results || [];
  const out = rows.map((r) => ({ id: r.id, ts: r.ts, user: r.user_id, userName: r.user_name || r.user_id, kind: r.kind, detail: r.detail, n: r.n }));
  if (q.get('format') === 'csv') {
    const esc = (v) => { const x = v == null ? '' : String(v); return /[";\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
    const lines = ['zeit_utc;nutzer;name;aktion;detail;n'];
    for (const r of out) lines.push([new Date(r.ts).toISOString().slice(0, 19).replace('T', ' '), r.user, r.userName, r.kind, r.detail, r.n].map(esc).join(';'));
    return new Response('\ufeff' + lines.join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="briefing-protokoll.csv"' } });
  }
  const kinds = ((await env.DB.prepare('SELECT DISTINCT kind FROM usage ORDER BY kind').all()).results || []).map((r) => r.kind);
  return json({ log: out, kinds, generatedAt: Date.now() });
}
async function adminStats(env, url) {
  const month = "strftime('%Y-%m', ts/1000, 'unixepoch')";
  const usage = (await env.DB.prepare(`SELECT user_id, ${month} AS month, kind, COUNT(*) AS c, SUM(n) AS n FROM usage GROUP BY user_id, month, kind ORDER BY month DESC, user_id, kind`).all()).results || [];
  const flights = (await env.DB.prepare(`SELECT owner_id, material_owner, reg, kind, status, strftime('%Y-%m', start_ms/1000, 'unixepoch') AS month, COUNT(*) AS c FROM briefings GROUP BY owner_id, material_owner, reg, kind, status, month ORDER BY month DESC`).all()).results || [];
  const storage = (await env.DB.prepare('SELECT COALESCE(b.owner_id, \'-\') AS owner_id, COUNT(*) AS files, SUM(f.size) AS bytes FROM files f LEFT JOIN briefings b ON b.id=f.briefing_id GROUP BY b.owner_id').all()).results || [];
  const users = ((await env.DB.prepare('SELECT id,name,role,active,created_at,last_login_at FROM users ORDER BY created_at').all()).results || []).map((r) => ({ id: r.id, name: r.name, role: r.role, active: !!r.active, createdAt: r.created_at, lastLoginAt: r.last_login_at }));
  const links = (await env.DB.prepare('SELECT b.owner_id, COUNT(*) AS c, SUM(CASE WHEN a.last_opened_at IS NULL THEN 0 ELSE 1 END) AS opened FROM access_links a JOIN briefings b ON b.id=a.briefing_id GROUP BY b.owner_id').all()).results || [];
  const out = {
    generatedAt: Date.now(), users,
    usage: usage.map((r) => ({ user: r.user_id, month: r.month, kind: r.kind, count: r.c, sum: r.n })),
    flights: flights.map((r) => ({ owner: r.owner_id, materialOwner: r.material_owner, reg: r.reg, kind: r.kind, status: r.status, month: r.month, count: r.c })),
    storage: storage.map((r) => ({ owner: r.owner_id, files: r.files, bytes: r.bytes })),
    links: links.map((r) => ({ owner: r.owner_id, count: r.c, opened: r.opened })),
  };
  if (url.searchParams.get('format') === 'csv') {
    const esc = (v) => { const s = v == null ? '' : String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = ['table;user;month;kind;detail;status;count;sum'];
    for (const r of out.usage) lines.push(['usage', r.user, r.month, r.kind, '', '', r.count, r.sum].map(esc).join(';'));
    for (const r of out.flights) lines.push(['flights', r.owner, r.month, r.kind, `${r.reg || ''}${r.materialOwner ? ` (Material: ${r.materialOwner})` : ''}`, r.status, r.count, ''].map(esc).join(';'));
    for (const r of out.storage) lines.push(['storage', r.owner, '', 'files', '', '', r.files, r.bytes].map(esc).join(';'));
    for (const r of out.links) lines.push(['links', r.owner, '', 'links', '', '', r.count, r.opened].map(esc).join(';'));
    return new Response('﻿' + lines.join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="briefing-statistik.csv"' } });
  }
  return json(out);
}

async function uploadFile(env, ctx, briefingId, { dataUrl }, logUid) {
  const mm = /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,(.+)$/.exec(dataUrl || '');
  if (!mm) return err('bad file');
  const bytes = unb64u(mm[2].replace(/-/g, '+').replace(/_/g, '/'));
  const isPdf = mm[1] === 'application/pdf';
  if (bytes.length > (isPdf ? 12 : 4) * 1024 * 1024) return err(isPdf ? 'too large (12 MB)' : 'too large (4 MB)');
  const ext = isPdf ? 'pdf' : mm[1] === 'image/png' ? 'png' : mm[1] === 'image/webp' ? 'webp' : 'jpg';
  const key = `${briefingId}/${rnd(12).toLowerCase().replace(/[^a-z0-9]/g, 'x')}.${ext}`;
  await env.FILES.put(key, bytes, { httpMetadata: { contentType: mm[1] } });
  await env.DB.prepare('INSERT INTO files (key,briefing_id,content_type,size,created_at) VALUES (?,?,?,?,?)').bind(key, briefingId, mm[1], bytes.length, Date.now()).run();
  if (logUid) logUsage(env, ctx, logUid, 'file', key, bytes.length);
  return json({ url: `/files/${key}`, key });
}
