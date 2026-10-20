/* Fahrtbriefing — Datenhaltung.
 *
 * Zwei Adapter mit derselben Schnittstelle:
 *   remote  Cloudflare Worker (D1, R2) unter config.apiBase — Normalbetrieb.
 *   local   localStorage dieses Browsers — ohne Server, zum Ausprobieren und
 *           als Rückfall, wenn der Worker nicht erreichbar ist.
 * Die Oberfläche spricht nur `store`. Welche Variante aktiv ist, steht in
 * store.mode; Berechtigungs-Links und Zugänge gibt es nur remote.
 */
import { load, save, del, uid } from './util.js';
import { mergeSettings } from './defaults.js';
import { briefingYear, formatNo, archiveMs, amendBriefingData, placeLabel } from './model.js';

const cfg = (typeof window !== 'undefined' && window.BRIEFING_CONFIG) || {};
const API = (cfg.apiBase || '').replace(/\/$/, '');
const LS = { settings: 'fb.settings', briefings: 'fb.briefings', unlocked: 'fb.unlocked', pw: 'fb.localpw', token: 'fb.token', touch: 'fb.touch', user: 'fb.user', me: 'fb.me' };

// ----------------------------------------------------------------- local
const local = {
  mode: 'local',
  async health() { return true; },
  async login(user, pw) {
    const stored = load(LS.pw, '1234');
    if (pw !== stored) return false;
    save(LS.unlocked, 1); return true;
  },
  /** Lokal gibt es einen Benutzer; er darf alles. */
  async me() { const s = await this.getSettings(); return { user: { id: 'local', name: s.ownerName || 'Owner', role: 'super', flags: { ai: true, notam: true, pdf: true } }, shared: [], given: [] }; },
  async listUsers() { return []; },
  async listShares() { return []; },
  async setShare() { throw new Error('local'); },
  async getSettingsOf() { throw new Error('local'); },
  async adminUsers() { return []; },
  async adminCreateUser() { throw new Error('local'); },
  async adminUpdateUser() { throw new Error('local'); },
  async adminStats() { throw new Error('local'); },
  async adminLog() { throw new Error('local'); },
  async adminLogCsv() { throw new Error('local'); },
  async adminStatsCsv() { throw new Error('local'); },
  async listMaterialLinks() { return []; },
  async createMaterialLink() { throw new Error('local'); },
  async revokeMaterialLink() { throw new Error('local'); },
  async openMaterial() { throw new Error('local'); },
  logout() { del(LS.unlocked); },
  isAuthed() { return load(LS.unlocked, 0) === 1; },
  async changePassword(oldPw, newPw) {
    if (oldPw !== load(LS.pw, '1234')) throw new Error('wrong');
    save(LS.pw, newPw); return true;
  },
  async getSettings() { return mergeSettings(load(LS.settings, null)); },
  async saveSettings(s) { save(LS.settings, s); return s; },
  async listBriefings(scope = 'own') { if (scope !== 'own') return []; return Object.values(load(LS.briefings, {})).map(summary).sort((a, b) => (a.startMs || 0) - (b.startMs || 0)); },
  async listHidden() { return []; },
  async unhideBriefing() {},
  async getBriefing(id) { const all = load(LS.briefings, {}); return all[id] || null; },
  async saveBriefing(b, who) {
    const all = load(LS.briefings, {});
    b.revision = (b.revision || 0) + 1; b.updatedAt = Date.now(); b.updatedBy = who || 'local';
    if (!b.no) b.no = nextLocalNo(briefingYear(b), all);
    all[b.id] = b; save(LS.briefings, all); return b;
  },
  async deleteBriefing(id) { const all = load(LS.briefings, {}); delete all[id]; save(LS.briefings, all); },
  /** 0.12.10: Nachtrag während der laufenden Fahrt – Archivkopie (bisherige Nummer, eingefroren) + Nummer mit Buchstabe. */
  async amendBriefing(id, who) {
    const all = load(LS.briefings, {}); const b = all[id]; if (!b) throw new Error('not found');
    const { copy } = amendBriefingData(b);
    copy.updatedAt = Date.now(); copy.updatedBy = who || 'local';
    b.revision = (b.revision || 0) + 1; b.updatedAt = Date.now(); b.updatedBy = who || 'local';
    all[copy.id] = copy; all[b.id] = b; save(LS.briefings, all);
    return { no: b.no, copyId: copy.id };
  },
  async uploadImage(briefingId, dataUrl) { return { url: dataUrl, key: uid(8) }; },
  async uploadDoc(dataUrl) { return { url: dataUrl, key: uid(8) }; },
  async listAccess() { return []; },
  async createAccess() { throw new Error('local'); },
  async revokeAccess() { throw new Error('local'); },
  async listSecrets() { return {}; },
  async setSecret() { throw new Error('local'); },
  async deleteSecret() { throw new Error('local'); },
  async getSecret() { throw new Error('local'); },
  async openShared() { throw new Error('local'); },
  async saveShared() { throw new Error('local'); },
  async getLog(id) { const b = await this.getBriefing(id); return b?.log || []; },
  async exportAll() { const all = load(LS.briefings, {}); return { exportedAt: Date.now(), settings: load(LS.settings, null), briefings: Object.values(all) }; },
  /** Datenabrufe ohne Server: nur, was öffentlich und CORS-frei ist. */
  async data(kind, params = {}, shareToken, body = null) { const { localData } = await import('./net.js'); return localData(kind, { ...params, ...(body || {}) }); },
  async getTrajectory() { return null; },
  async deleteTrajectory() { /* lokal keine */ },
};

// ---------------------------------------------------------------- remote
function authHeaders() { const t = load(LS.token, null); return t ? { Authorization: `Bearer ${t}` } : {}; }
async function api(path, opts = {}) {
  const usedToken = load(LS.token, null);
  const r = await fetch(API + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(opts.headers || {}) },
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
  // 401 nur dann als «Sitzung weg» werten, wenn die Anfrage mit der aktuellen Sitzung lief
  // (ein noch laufender Abruf mit altem Token darf eine frische Anmeldung nicht beenden)
  if (r.status === 401) { if (usedToken && usedToken === load(LS.token, null)) { del(LS.token); try { document.dispatchEvent(new CustomEvent('fb:unauth')); } catch { /* ohne DOM */ } } throw Object.assign(new Error('unauthorized'), { status: 401 }); }   // 0.12.16: Sitzung serverseitig beendet → Anmeldeseite
  if (!r.ok) { let m = `HTTP ${r.status}`; try { m = (await r.json()).error || m; } catch { /* egal */ } throw Object.assign(new Error(m), { status: r.status }); }
  if (r.status === 204) return null;
  return r.json();
}

const remote = {
  mode: 'remote',
  async health() { try { const r = await fetch(API + '/api/health', { signal: AbortSignal.timeout(5000) }); return r.ok; } catch { return false; } },
  async login(user, pw) {
    try { const j = await api('/api/session', { method: 'POST', body: { user: user || '', password: pw } }); save(LS.token, j.token); save(LS.me, j.user || null); if (j.user?.id) save(LS.user, j.user.id); return true; }
    catch (e) { if (e.status === 401 || e.status === 403 || e.status === 429) return false; throw e; }
  },
  logout() { api('/api/session', { method: 'DELETE' }).catch(() => {}); del(LS.token); del(LS.me); },
  /** Angemeldeter Benutzer, Freischaltungen, freigegebener Stamm anderer. */
  async me() { const j = await api('/api/me'); save(LS.me, j.user); return j; },
  async listUsers() { return (await api('/api/users')).users; },
  async listShares(all) { return (await api(`/api/shares${all ? '?all=1' : ''}`)).shares; },
  async setShare(to, categories) { return api('/api/shares', { method: 'POST', body: { to, categories } }); },
  async getSettingsOf(uid) { const j = await api(`/api/settings?user=${encodeURIComponent(uid)}`); return mergeSettings(j.settings); },
  async adminUsers() { return (await api('/api/admin/users')).users; },
  async adminCreateUser(body) { return (await api('/api/admin/users', { method: 'POST', body })).user; },
  async adminUpdateUser(id, body) { return (await api(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'PUT', body })).user; },
  async adminStats() { return api('/api/admin/stats'); },
  async adminLog(params = {}) { const q = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v != null && v !== '') q.set(k, String(v)); return api(`/api/admin/log?${q}`); },   // 0.12.16: Aktivitätsprotokoll
  async adminLogCsv(params = {}) { const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== '')), format: 'csv' }); const r = await fetch(API + `/api/admin/log?${q}`, { headers: authHeaders() }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); },
  async adminStatsCsv() { const r = await fetch(API + '/api/admin/stats?format=csv', { headers: authHeaders() }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); },
  /** Material-Links: externer Materialeigner sieht alle Briefings mit seinen Kennungen (ohne Sitzung). */
  async listMaterialLinks() { return (await api('/api/material-links')).links; },
  async createMaterialLink(body) { return (await api('/api/material-links', { method: 'POST', body })).link; },
  async revokeMaterialLink(token) { await api(`/api/material-links/${token}`, { method: 'DELETE' }); },
  async openMaterial(token, id) { return api(`/api/material/${token}${id ? `/${id}` : ''}`); },
  isAuthed() { return !!load(LS.token, null); },
  async changePassword(oldPw, newPw) { await api('/api/password', { method: 'POST', body: { oldPassword: oldPw, newPassword: newPw } }); return true; },
  async getSettings() {
    const j = await api('/api/settings'); const s = mergeSettings(j.settings);
    // noch nichts gespeichert (erste Anmeldung): Vorgaben ablegen, damit der Stamm auch serverseitig (Freigaben) vorhanden ist
    if (!j.settings || !Object.keys(j.settings).length) this.saveSettings(s).catch(() => {});
    return s;
  },
  async saveSettings(s) { await api('/api/settings', { method: 'PUT', body: { settings: s } }); return s; },
  async listBriefings(scope = 'own') { return (await api(`/api/briefings?scope=${scope}`)).briefings; },
  async listHidden() { return (await api('/api/briefings?scope=all&hidden=1')).briefings; },   // 0.12.12: ausgeblendete Archiv-Einträge (Supermaster)
  async unhideBriefing(id) { await api(`/api/briefings/${id}/unhide`, { method: 'POST' }); },
  async getBriefing(id) { const j = await api(`/api/briefings/${id}`); if (j.briefing) j.briefing.access = j.access || 'write'; return j.briefing; },
  async saveBriefing(b, who) {
    const j = await api(`/api/briefings/${b.id}`, { method: 'PUT', body: { briefing: b, who } });
    Object.assign(b, { revision: j.revision, updatedAt: j.updatedAt, updatedBy: j.updatedBy }); if (j.no) b.no = j.no;
    return b;
  },
  async deleteBriefing(id) { await api(`/api/briefings/${id}`, { method: 'DELETE' }); },
  // 0.14.0: Ist-Trajektorie aus analyze.wicki.aero (Sitzung; Links mit ?t= bzw. Material-Links mit ?mt=); null, wenn keine da ist
  async getTrajectory(id, link) { const q = link?.material ? `?mt=${encodeURIComponent(link.token)}` : link?.token ? `?t=${encodeURIComponent(link.token)}` : ''; try { return await api(`/api/briefings/${id}/trajectory${q}`); } catch (e) { if ([403, 404, 410].includes(e.status)) return null; throw e; } },
  async deleteTrajectory(id) { await api(`/api/briefings/${id}/trajectory`, { method: 'DELETE' }); },
  async amendBriefing(id, who) { return api(`/api/briefings/${id}/amend`, { method: 'POST', body: { who } }); },
  async uploadImage(briefingId, dataUrl, shareToken) {
    const j = await api(`/api/briefings/${briefingId}/files${shareToken ? `?t=${shareToken}` : ''}`, { method: 'POST', body: { dataUrl } });
    return { url: API + j.url, key: j.key };
  },
  async uploadDoc(dataUrl) { const j = await api('/api/docs', { method: 'POST', body: { dataUrl } }); return { url: API + j.url, key: j.key }; },
  async listAccess(id) { return (await api(`/api/briefings/${id}/access`)).links; },
  async createAccess(id, body) { return (await api(`/api/briefings/${id}/access`, { method: 'POST', body })).link; },
  async revokeAccess(id, token) { await api(`/api/briefings/${id}/access/${token}`, { method: 'DELETE' }); },
  async listSecrets() { return (await api('/api/secrets')).secrets; },
  async setSecret(name, value) { await api('/api/secrets', { method: 'PUT', body: { name, value } }); },
  async deleteSecret(name) { await api(`/api/secrets/${name}`, { method: 'DELETE' }); },
  async getSecret(name) { return api(`/api/secrets/${name}`); },
  async openShared(token, who) { return api(`/api/shared/${token}${who ? `?who=${encodeURIComponent(who)}` : ''}`); },
  async saveShared(token, b, who) {
    const j = await api(`/api/shared/${token}`, { method: 'PUT', body: { briefing: b, who } });
    Object.assign(b, { revision: j.revision, updatedAt: j.updatedAt, updatedBy: j.updatedBy }); if (j.no) b.no = j.no;
    return b;
  },
  async getLog(id) { return (await api(`/api/briefings/${id}/log`)).log; },
  async exportAll(all) { return api(`/api/export${all ? '?all=1' : ''}`); },
  /** Datenabrufe über den Worker (Schlüssel bleiben dort); shareToken für Link-Nutzer. */
  async data(kind, params = {}, shareToken, body = null) {
    const q = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v != null) q.set(k, String(v));
    if (shareToken) q.set('t', shareToken);
    return api(`/api/wx/${kind}?${q.toString()}`, body ? { method: 'POST', body } : {});
  },
};

function summary(b) {
  return {
    id: b.id, no: b.no || null, startMs: b.time?.startMs, endMs: archiveMs(b), frozen: !!b.frozen, tz: b.site?.tz, site: placeLabel(b.site), icao: b.site?.icao, elev: b.site?.elev,
    balloon: b.balloon?.label, reg: b.balloon?.reg, kind: b.flight?.kind, status: b.status, finalNo: b.finalNo, progress: b.progress ?? null, edition: b.edition ?? null,
    revision: b.revision, updatedAt: b.updatedAt, updatedBy: b.updatedBy, links: (b.accessCount || 0),
  };
}
/** Lokaler Modus: Ordnungsnummer «JJJJ-NNN» fortlaufend je Jahr (Zähler in localStorage, Lücken durch Bestand geschlossen). */
function nextLocalNo(year, all) {
  const seq = load('fb.seq', {});
  let n = Math.max(seq[year] || 0, ...Object.values(all).map((x) => (x.no && x.no.startsWith(`${year}-`) ? +x.no.slice(5) || 0 : 0)));
  n += 1; seq[year] = n; save('fb.seq', seq);
  return formatNo(year, n);
}

export const store = {
  mode: 'local', impl: local, apiBase: API,
  async init() {
    if (API && await remote.health()) { this.impl = remote; this.mode = 'remote'; }
    else { this.impl = local; this.mode = 'local'; }
    return this.mode;
  },
  touch() { save(LS.touch, Date.now()); },
  lastUser() { return load(LS.user, ''); },
  cachedUser() { return load(LS.me, null); },
  idleExpired(ms = 2 * 60 * 60 * 1000) { const t = load(LS.touch, 0); return t && Date.now() - t > ms; },
};
for (const k of ['health', 'login', 'logout', 'isAuthed', 'changePassword', 'getSettings', 'saveSettings', 'listBriefings', 'getBriefing', 'saveBriefing', 'deleteBriefing', 'amendBriefing', 'listHidden', 'unhideBriefing', 'uploadImage', 'uploadDoc', 'listAccess', 'createAccess', 'revokeAccess', 'listSecrets', 'setSecret', 'deleteSecret', 'getSecret', 'openShared', 'saveShared', 'getLog', 'data', 'exportAll',
  'me', 'listUsers', 'listShares', 'setShare', 'getSettingsOf', 'adminUsers', 'adminCreateUser', 'adminUpdateUser', 'adminStats', 'adminStatsCsv', 'adminLog', 'adminLogCsv',
  'listMaterialLinks', 'createMaterialLink', 'revokeMaterialLink', 'openMaterial', 'getTrajectory', 'deleteTrajectory']) {
  store[k] = (...a) => store.impl[k](...a);
}
export { summary };
