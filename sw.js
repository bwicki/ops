/* Fahrtbriefing — Service Worker (PWA).
 *
 * App-Hülle: beim Installieren vorgeladen, Cache-Name aus js/version.js
 * (neue Version → neuer Cache, alte werden gelöscht). Statische Dateien:
 * zuerst Cache, dann Netz. Worker-API: zuerst Netz, bei Ausfall die letzte
 * Antwort aus dem Cache (nur GET: Briefings, Einstellungen, Dateien) — so bleibt
 * die Briefingsicht eines zuvor geöffneten Briefings offline lesbar.
 * Schreibende Aufrufe und externe Dienste (Open-Meteo, Kacheln) laufen immer
 * über das Netz.
 */
import { APP } from './js/version.js';

const CACHE = APP.cache;
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/base.css', 'css/app.css', 'css/print.css', 'img/wicki-logo.png',
  'icons/favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/config.js', 'js/version.js', 'js/app.js', 'js/util.js', 'js/store.js', 'js/i18n.js', 'js/defaults.js', 'js/panels.js', 'js/model.js', 'js/net.js', 'js/stamm.js',
  'js/calc/time.js', 'js/calc/geo.js', 'js/calc/sun.js', 'js/calc/rac.js', 'js/calc/aero.js', 'js/calc/schedule.js', 'js/calc/gonogo.js', 'js/calc/diff.js', 'js/calc/actual.js',
  'js/auto/openmeteo.js', 'js/auto/traj.js', 'js/auto/charts.js', 'js/auto/data.js', 'js/auto/ai.js',
  'js/ui/widgets.js', 'js/ui/parts.js', 'js/ui/place.js', 'js/ui/list.js', 'js/ui/wizard.js', 'js/ui/editor.js', 'js/ui/view.js', 'js/ui/access.js', 'js/ui/shared.js', 'js/ui/settings.js', 'js/ui/users.js', 'js/ui/material.js', 'js/ui/autopanels.js', 'js/ui/autorender.js', 'js/ui/extras.js', 'js/ui/actual.js',
  'js/vendor/leaflet/leaflet.js', 'js/vendor/leaflet/leaflet.css', 'js/vendor/leaflet/images/marker-icon.png', 'js/vendor/leaflet/images/marker-icon-2x.png', 'js/vendor/leaflet/images/marker-shadow.png', 'js/vendor/qrcode.js',
  'data/rac/rac-ch.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))).catch(() => null)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const isApi = (u) => /\/api\/(briefings|settings|shared|export|me|material)/.test(u.pathname) || /\/files\//.test(u.pathname);
const isStatic = (u) => u.origin === self.location.origin && !u.pathname.includes('/data/dwd/');

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (isApi(u)) {
    // Netz zuerst; letzte Antwort als Rückfall (offline lesen)
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return r; }).catch(() => caches.match(req).then((c) => c || new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))));
    return;
  }
  if (isStatic(u)) {
    e.respondWith(caches.match(req).then((c) => c || fetch(req).then((r) => { if (r.ok && (u.pathname.startsWith('/js/') || u.pathname.startsWith('/css/') || u.pathname.startsWith('/icons/') || u.pathname.startsWith('/data/'))) { const copy = r.clone(); caches.open(CACHE).then((cc) => cc.put(req, copy)); } return r; })));
  }
});
