/* Fahrtbriefing — Einstellungen (Stammdaten, Regeln, Zugänge, Experte). */
import { h, clear, toast, deepCopy, num, dialog, uid, shrinkImageSquare, shrinkImage } from '../util.js';
import { t, tt, getLang, setLang } from '../i18n.js';
import { setHeader } from '../app.js';
import { field, input, select, textarea, check, listHead, fieldAdd, docsEditor } from './widgets.js';
import { PANELS, SECTIONS, visiblePanels, panelNo } from '../panels.js';
import { parseRacText, racValidity, linesFromPdfItems } from '../calc/rac.js';
import { CYLINDER_CATALOG } from '../calc/aero.js';
import { ACT_TYPES, ACT_DEFAULT_MIN } from '../calc/schedule.js';
import { placeRow, mapsUrl } from './place.js';
import { countryGuess } from '../calc/geo.js';
import { exportAll } from './extras.js';
import { COUNTRY_MATRIX, ROLES } from '../countries.js';
import { usersSection, statsSection, logSection } from './users.js';
import { icon, iconSvg } from './icons.js';

const SECTS = ['general', 'balloons', 'persons', 'operators', 'sites', 'intent', 'schedule', 'fpl', 'rac', 'transition', 'gonogo', 'meteo', 'panels', 'links', 'users', 'stats', 'access', 'expert'];

export async function renderSettings(view, ctx) {
  let S = deepCopy(ctx.settings);
  let cur = location.hash.split('?')[1] || 'general';
  // «Speichern» als Umriss; gefüllt, sobald sich etwas geändert hat
  const saveBtn = h('button.btn.save', { type: 'button', onclick: async () => { await ctx.saveSettings(S); S = deepCopy(ctx.settings); toast(t('set_saved')); draw(); markDirty(); } }, t('set_save'));
  const markDirty = () => { const dirty = JSON.stringify(S) !== JSON.stringify(ctx.settings); saveBtn.classList.toggle('primary', dirty); saveBtn.classList.toggle('dirty', dirty); };
  const backBtn = h('button.btn.icon', { type: 'button', title: t('back'), 'aria-label': t('back'), onclick: () => ctx.navigate(ctx.settingsReturn && !ctx.settingsReturn.startsWith('#/settings') ? ctx.settingsReturn : '#/list') }, '←');
  setHeader({ title: t('set_title'), tools: [backBtn, saveBtn] });
  const nav = h('div.snav');
  const body = h('div');
  view.appendChild(h('div.settings', [nav, body]));
  for (const ev of ['input', 'change', 'click']) body.addEventListener(ev, () => setTimeout(markDirty, 0));

  function draw() {
    clear(nav);
    const sects = SECTS.filter((x) => x !== 'stats' || (ctx.isSuper && ctx.store.mode === 'remote'));
    if (!sects.includes(cur)) cur = 'general';
    for (const s of sects) nav.appendChild(h('button', { type: 'button', class: cur === s ? 'on' : '', onclick: () => { cur = s; draw(); } }, t('set_' + s)));
    setTimeout(() => nav.querySelector('button.on')?.scrollIntoView({ inline: 'center', block: 'nearest' }), 0);
    clear(body);
    body.appendChild(({ general, balloons, persons, operators, sites, intent, schedule, fpl, rac, transition, gonogo, meteo, panels, links, users, stats, access, expert })[cur]());
  }
  const numField = (obj, key, label, step = 1, cls) => field(label, input('number', obj[key] ?? '', { step, oninput: (e) => { obj[key] = num(e.target.value, null); } }), cls);
  const txtField = (obj, key, label, cls) => field(label, input('text', obj[key] ?? '', { oninput: (e) => { obj[key] = e.target.value; } }), cls);
  /** BAZL-Registerzeile (nur Anzeige): Hersteller · Muster · S/N · Baujahr · MTOM · MOPSC · ARC bis. */
  const regLine = (x) => x.register ? h('div.note.small.regline', `${t('b_register')}: ${x.register.manufacturer} · ${x.register.model} · S/N ${x.register.serial} · ${x.register.year} · MTOM ${x.register.mtom} kg · MOPSC ${x.register.mopsc} · TCDS ${x.register.tcds} · ARC → ${x.register.arcUntil}`) : null;
  /** Bild der Hülle: Datei wählen → quadratischer Mittenausschnitt, 192 px, JPEG-Daten-URL im Objekt (x.image). */
  const imageField = (x) => {
    const box = h('div.imgfield');
    const draw = () => {
      clear(box);
      const file = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onchange: async (e) => { const f = e.target.files?.[0]; if (!f) return; try { x.image = await shrinkImageSquare(f, 192); draw(); markDirty(); } catch { toast(t('b_imageErr')); } } });
      box.append(
        x.image ? h('img.bimg', { src: x.image, alt: '' }) : h('div.bimg.empty', '—'),
        h('div.col', [
          h('button.btn.small', { type: 'button', onclick: () => file.click() }, t('b_imageChoose')),
          x.image ? h('button.btn.small', { type: 'button', onclick: () => { delete x.image; draw(); markDirty(); } }, t('b_imageRemove')) : null,
          h('span.note.small', t('b_imageHint')),
        ]), file,
      );
    };
    draw();
    return field(t('b_image'), box);
  };

  function general() {
    return h('div.card', h('div.card-body', [
      h('div.frow.c3', [
        field(t('set_lang'), select([{ value: 'de', label: 'Deutsch' }, { value: 'en', label: 'English' }], S.lang, { onchange: (e) => { S.lang = e.target.value; } })),
        field(t('set_theme'), select([{ value: 'light', label: t('theme_light') }, { value: 'dark', label: t('theme_dark') }], S.theme, { onchange: (e) => { S.theme = e.target.value; } })),
        txtField(S, 'ownerName', t('set_ownerName')),
      ]),
      check(t('set_expertMode'), S.expert, (v) => { S.expert = v; }),
      signatureField(),
      h('div.note', `${t('localMode')}/${t('remoteMode')}: ${ctx.store.mode === 'remote' ? ctx.store.apiBase : t('localMode')}`),
    ]));
  }

  /** 0.13.0: Unterschriftenbild des Nutzers (gescannt, PNG/JPG) für das digitale Signieren von Flugauftrag und Beförderungsschein. */
  function signatureField() {
    const box = h('div.imgfield');
    const draw = () => {
      clear(box);
      const sig = S.signature || null;
      const file = h('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onchange: async (e) => { const f = e.target.files?.[0]; if (!f) return; try { const dataUrl = await shrinkImage(f, 900, 0.9); const r = ctx.store.mode === 'remote' ? await ctx.store.uploadDoc(dataUrl) : { url: dataUrl }; S.signature = { url: r.url, key: r.key || '', ts: Date.now() }; draw(); markDirty(); } catch (err) { toast(`${t('error')}: ${err.message}`); } } });
      box.append(
        sig?.url ? h('img.sigimg', { src: sig.url, alt: '' }) : h('div.bimg.empty', '—'),
        h('div.col', [h('button.btn.small', { type: 'button', onclick: () => file.click() }, t('b_imageChoose')), sig ? h('button.btn.small', { type: 'button', onclick: () => { delete S.signature; draw(); markDirty(); } }, t('b_imageRemove')) : null, h('span.note.small', t('set_signatureHint'))]), file,
      );
    };
    draw();
    return field(t('set_signature'), box);
  }

  function balloons() {
    const B = S.balloons;
    const wrap = h('div');
    const habBox = h('div');
    const drawHab = () => {
      clear(habBox);
      B.hab.forEach((x, i) => {
        const cylRows = CYLINDER_CATALOG.map((c) => { const cur = x.cylinders.find((y) => y.id === c.id); return h('tr', [h('td', c.name), h('td', input('number', cur?.count ?? 0, { min: 0, step: 1, oninput: (e) => { const n = num(e.target.value); const idx = x.cylinders.findIndex((y) => y.id === c.id); if (idx >= 0) x.cylinders[idx].count = n; else x.cylinders.push({ ...c, count: n }); } })), h('td', c.litres), h('td', c.gasKg), h('td', c.totalKg)]); });
        habBox.appendChild(h('div.item-box', [
          h('div.head', [h('b', `${x.id}${x.model ? ' · ' + x.model : ''}`), h('label.check', [h('input', { type: 'radio', name: 'defHab', checked: B.defaultHab === x.id, onchange: () => { B.defaultHab = x.id; } }), h('span', t('default'))]), h('button.btn.icon', { type: 'button', onclick: () => { B.hab.splice(i, 1); drawHab(); } }, icon('del'))]),
          h('div.frow.c4', [txtField(x, 'id', t('registration')), txtField(x, 'model', t('b_model')), txtField(x, 'hex', t('b_hex')), numField(x, 'volume', t('b_volume'))]),
          regLine(x),
          h('div.frow.c4', [numField(x, 'mtom', t('b_mtom')), numField(x, 'envTempC', t('b_envTemp'))]),
          h('div.frow.c4', [numField(x.masses, 'envelope', `${t('b_envelope')} kg`), numField(x.masses, 'burner', `${t('b_burner')} kg`), numField(x.masses, 'basket', `${t('b_basket')} kg`), numField(x.masses, 'equipment', `${t('b_equipment')} kg`)]),
          h('div.frow.c4', [numField(x, 'personWeight', `${t('b_personWeight')} kg`), numField(x, 'maxPersons', t('b_maxPersons')), numField(x, 'burnRate', t('b_burn')), numField(x, 'rigMin', t('b_rig'))]),
          h('div.frow.c2', [txtField(x, 'colour', t('b_colour')), field(t('b_trackers'), textarea((x.trackers || []).join('\n'), { rows: 2, placeholder: 'https://live.garmin.com/… · https://aprs.fi/… · https://www.flightradar24.com/…', oninput: (e) => { x.trackers = e.target.value.split(/[\n,;\s]+/).map((x2) => x2.trim()).filter((x2) => /^https?:\/\//i.test(x2)); } })),]),
          imageField(x),
          S.expert ? h('div.frow.c3', [numField(x, 'envMaxC', t('b_envMax')), field(`${t('b_usable')} (0–1)`, input('number', x.usableFraction, { step: 0.05, min: 0, max: 1, oninput: (e) => { x.usableFraction = num(e.target.value, 1); } }))]) : null,
          h('details', [h('summary.small', t('b_cyl')), h('table.cyl', [h('thead', h('tr', [h('th', t('b_cyl')), h('th', t('mp_count')), h('th', 'l'), h('th', 'kg Gas'), h('th', 'kg')])), h('tbody', cylRows)])]),
          (() => { const de = docsEditor(x, S.docTypes?.balloon, ctx); return fieldAdd(t('docs'), de, () => de.addFn(), t('doc_add')); })(),
        ]));
      });
      habBox.addFn = () => { B.hab.push({ id: 'HB-XXX', name: 'HB-XXX', model: 'Heissluft', volume: 3000, masses: { envelope: 120, burner: 20, basket: 60, equipment: 20 }, mtom: 800, personWeight: 85, envTempC: 100, envMaxC: null, usableFraction: 0.9, burnRate: 25, cylinders: [], rigMin: 45, maxPersons: 4 }); drawHab(); };
    };
    drawHab();
    const envBox = h('div');
    const drawEnv = () => {
      clear(envBox);
      B.envelopes.forEach((x, i) => envBox.appendChild(h('div.item-box', [
        h('div.head', [h('b', `${x.id}${x.model ? ' · ' + x.model : ''}`), x.placeholder ? h('span.tag.half', t('placeholderMark')) : null, h('label.check', [h('input', { type: 'radio', name: 'defEnv', checked: B.defaultEnvelope === x.id, onchange: () => { B.defaultEnvelope = x.id; } }), h('span', t('default'))]), h('button.btn.icon', { type: 'button', onclick: () => { B.envelopes.splice(i, 1); drawEnv(); } }, icon('del'))]),
        h('div.frow.c4', [txtField(x, 'id', t('registration')), txtField(x, 'model', t('b_model')), txtField(x, 'hex', t('b_hex')), numField(x, 'volume', t('b_volume'))]),
        regLine(x),
        h('div.frow.c4', [numField(x, 'mass', `${t('b_envelope')} kg`)]),
        h('div.frow.c2', [txtField(x, 'colour', t('b_colour')), field(t('b_trackers'), textarea((x.trackers || []).join('\n'), { rows: 2, placeholder: 'https://live.garmin.com/… · https://aprs.fi/… · https://www.flightradar24.com/…', oninput: (e) => { x.trackers = e.target.value.split(/[\n,;\s]+/).map((x2) => x2.trim()).filter((x2) => /^https?:\/\//i.test(x2)); } })),]),
        imageField(x),
        (() => { const de = docsEditor(x, S.docTypes?.balloon, ctx); return fieldAdd(t('docs'), de, () => de.addFn(), t('doc_add')); })(),
        S.expert ? h('div.frow.c3', [field(t('b_gas'), select([{ value: 'H2', label: 'H₂' }, { value: 'He', label: 'He' }], x.gas, { onchange: (e) => { x.gas = e.target.value; } })), field(`${t('b_purity')} (0–1)`, input('number', x.purity, { step: 0.001, oninput: (e) => { x.purity = num(e.target.value, 1); } })), field('Füllgrad (0–1)', input('number', x.fillFraction ?? 1, { step: 0.05, oninput: (e) => { x.fillFraction = num(e.target.value, 1); } })), field(t('b_wz'), input('number', x.wz ?? '', { step: 0.1, placeholder: (x.volume || 0) >= 1000 ? '3.8' : '3.5', oninput: (e) => { x.wz = e.target.value === '' ? null : num(e.target.value, 3.8); } }))]) : null,
        check(t('placeholderMark'), x.placeholder, (v) => { x.placeholder = v; }),
      ])));
      envBox.addFn = () => { B.envelopes.push({ id: 'HB-XXX', name: 'HB-XXX', model: 'NL-STU/1000', volume: 1050, mass: 116, gas: 'H2', purity: 0.995, fillFraction: 1, placeholder: true }); drawEnv(); };
    };
    drawEnv();
    const basBox = h('div');
    const drawBas = () => {
      clear(basBox);
      B.baskets.forEach((x, i) => basBox.appendChild(h('div.item-box', [
        h('div.head', [h('b', x.name), x.placeholder ? h('span.tag.half', t('placeholderMark')) : null, h('label.check', [h('input', { type: 'radio', name: 'defBas', checked: B.defaultBasket === x.id, onchange: () => { B.defaultBasket = x.id; } }), h('span', t('default'))]), h('button.btn.icon', { type: 'button', onclick: () => { B.baskets.splice(i, 1); drawBas(); } }, icon('del'))]),
        h('div.frow.c4', [txtField(x, 'name', t('name')), numField(x, 'mass', `${t('b_basket')} kg`), numField(x, 'equipment', `${t('b_equipment')} kg`), numField(x, 'instruments', `${t('b_instruments')} kg`)]),
        h('div.frow.c3', [numField(x, 'maxPersons', t('b_maxPersons')), numField(x, 'ballastUnitKg', t('b_ballastUnit')), numField(x, 'reserveUnits', t('b_reserveUnits'))]),
        check(t('placeholderMark'), x.placeholder, (v) => { x.placeholder = v; }),
      ])));
      basBox.addFn = () => { B.baskets.push({ id: uid(6), name: 'Korb', mass: 50, equipment: 40, instruments: 0, maxPersons: 2, ballastUnitKg: 15, reserveUnits: 3, placeholder: true }); drawBas(); };
    };
    drawBas();
    wrap.append(
      h('div.card', [listHead(t('hab'), habBox, `${t('add')} ${t('hab')}`), h('div.card-body', habBox)]),
      h('div.card', [listHead(`${t('gas')} · ${t('envelope')}`, envBox, `${t('add')} ${t('envelope')}`), h('div.card-body', envBox)]),
      h('div.card', [listHead(`${t('gas')} · ${t('basket')}`, basBox, `${t('add')} ${t('basket')}`), h('div.card-body', [basBox, h('div.frow.c3', [numField(B.gasDefaults, 'personWeight', `${t('b_personWeight')} kg (${t('gas')})`), numField(B.gasDefaults, 'rigMin', t('b_rig')), numField(B.gasDefaults, 'fillMin', t('b_fill'))])])]),
      h('div.card', h('div.card-body', field(t('balloonType') + ' ' + t('default'), select([{ value: 'hab', label: t('hab') }, { value: 'gas', label: t('gas') }], B.defaultType, { onchange: (e) => { B.defaultType = e.target.value; } })))),
    );
    return wrap;
  }

  function persons() {
    const box = h('div');
    const ROLES = ['pic', 'copilot', 'crew', 'retrieve', 'pax'];   // 0.12.6: «2. Pilot» (0.12.7: alle Ballontypen)
    const ROLE_LBL = { pic: 'PIC', copilot: t('role_copilot'), crew: 'CREW', retrieve: 'RETRIEVE', pax: 'PAX' };
    const drawP = () => {
      clear(box);
      S.persons.forEach((p, i) => box.appendChild(h('div.item-box', [
        h('div.head', [h('b', p.name), h('button.btn.icon', { type: 'button', onclick: () => { S.persons.splice(i, 1); drawP(); } }, icon('del'))]),
        h('div.frow.c4', [txtField(p, 'name', t('name')), txtField(p, 'phone', t('phone')), txtField(p, 'email', t('email')), numField(p, 'weight', `${t('weight')} kg`)]),
        h('div.chips', ROLES.map((r) => h('button.chip', { type: 'button', 'aria-pressed': (p.roles || []).includes(r), onclick: (e) => { p.roles = p.roles || []; const i2 = p.roles.indexOf(r); if (i2 >= 0) p.roles.splice(i2, 1); else p.roles.push(r); e.currentTarget.setAttribute('aria-pressed', p.roles.includes(r)); } }, ROLE_LBL[r] || r.toUpperCase()))),
        (() => { const de = docsEditor(p, S.docTypes?.person, ctx); return fieldAdd(t('docs'), de, () => de.addFn(), t('doc_add')); })(),
      ])));
      box.addFn = () => { S.persons.push({ id: uid(6), name: '', roles: ['crew'], phone: '', email: '', weight: null }); drawP(); };
    };
    drawP();
    return h('div.card', [listHead(t('set_persons'), box), h('div.card-body', box)]);
  }

  function operators() {
    const box = h('div');
    const drawO = () => {
      clear(box);
      S.operators.forEach((o, i) => box.appendChild(h('div.item-box', h('div.frow.c3', [txtField(o, 'name', t('name')), field(t('default'), h('label.check', [h('input', { type: 'radio', name: 'defOp', checked: !!o.default, onchange: () => { S.operators.forEach((x) => { x.default = false; }); o.default = true; } }), h('span', t('default'))])), h('div.f', [h('label', ' '), h('button.btn', { type: 'button', onclick: () => { S.operators.splice(i, 1); drawO(); } }, t('remove'))])]))));
      box.addFn = () => { S.operators.push({ id: uid(6), name: '' }); drawO(); };
    };
    drawO();
    return h('div.card', [listHead(t('set_operators'), box), h('div.card-body', box)]);
  }

  function sites() {
    const sBox = h('div'), mBox = h('div');
    const drawS = () => {
      clear(sBox);
      S.sites.forEach((s, i) => sBox.appendChild(h('div.item-box', [
        h('div.head', [h('b', s.name), h('button.btn.icon', { type: 'button', onclick: () => { S.sites.splice(i, 1); drawS(); } }, icon('del'))]),
        h('div.frow', [txtField(s, 'name', t('name')), placeRow(s, { label: t('coords'), title: t('site'), noName: true, onPick: (p) => { Object.assign(s, { lat: p.lat, lon: p.lon, elev: p.elev ?? s.elev, tz: p.tz || s.tz, country: p.country || countryGuess(p.lat, p.lon) || s.country }); if (!s.name) s.name = p.name; drawS(); } })]),
        h('div.frow.c4', [numField(s, 'elev', t('s_elev')), txtField(s, 'country', t('s_country')), txtField(s, 'tz', t('s_tz')), field(t('s_meeting'), select([{ value: '', label: '–' }].concat(S.meetings.map((m) => ({ value: m.id, label: m.name }))), s.meetingId, { onchange: (e) => { s.meetingId = e.target.value; } }))]),
        h('div.frow', [field(t('s_fav'), check('', s.favorite, (v) => { s.favorite = v; })), field(t('s_types'), h('div.chips', ['hab', 'gas'].map((ty) => h('button.chip', { type: 'button', 'aria-pressed': !s.types?.length || s.types.includes(ty), title: t('s_typesHint'), onclick: (e) => {
          // leer = beide; Klick schaltet um; nie beide aus
          let cur = s.types?.length ? [...s.types] : ['hab', 'gas'];
          cur = cur.includes(ty) ? cur.filter((x) => x !== ty) : cur.concat(ty);
          if (!cur.length) cur = [ty === 'hab' ? 'gas' : 'hab'];
          s.types = cur.length === 2 ? [] : cur;
          e.currentTarget.parentElement.querySelectorAll('.chip').forEach((c, k) => c.setAttribute('aria-pressed', !s.types.length || s.types.includes(['hab', 'gas'][k])));
        } }, t(ty)))))]),
        field(t('s_notes'), textarea(s.notes, { rows: 2, oninput: (e) => { s.notes = e.target.value; } })),
      ])));
      sBox.addFn = () => { S.sites.push({ id: uid(6), name: '', lat: null, lon: null, elev: null, country: 'CH', tz: 'Europe/Zurich', notes: '', meetingId: '', favorite: true }); drawS(); };
    };
    const drawM = () => {
      clear(mBox);
      S.meetings.forEach((m, i) => mBox.appendChild(h('div.item-box', [
        h('div.head', [h('b', m.name), h('label.check', [h('input', { type: 'radio', name: 'defM', checked: !!m.default, onchange: () => { S.meetings.forEach((x) => { x.default = false; }); m.default = true; } }), h('span', t('default'))]), h('button.btn.icon', { type: 'button', onclick: () => { S.meetings.splice(i, 1); drawM(); } }, icon('del'))]),
        h('div.frow', [txtField(m, 'name', t('name')), txtField(m, 'address', t('m_address'))]),
        placeRow(m, { label: t('coords'), title: t('meeting'), noName: true, onPick: (p) => { Object.assign(m, { lat: p.lat, lon: p.lon, mapsUrl: mapsUrl(p.lat, p.lon) }); if (!m.address && p.address) m.address = p.address; if (!m.name) m.name = p.name; drawM(); } }),
      ])));
      mBox.addFn = () => { S.meetings.push({ id: uid(6), name: '', address: '', lat: null, lon: null, mapsUrl: '' }); drawM(); };
    };
    drawS(); drawM();
    return h('div', [h('div.card', [listHead(t('site'), sBox), h('div.card-body', sBox)]), h('div.card', [listHead(t('meeting'), mBox), h('div.card-body', mBox)])]);
  }

  function intent() {
    const box = h('div');
    for (const ty of ['hab', 'gas']) {
      const d = S.intentDefaults[ty];
      box.appendChild(h('div.item-box', [h('div.head', h('b', t(ty))), h('div.frow.c3', [numField(d, 'durationMin', `${t('duration')} (min)`), numField(d, 'altMinFt', `${t('altMin')} ft`), numField(d, 'altMaxFt', `${t('altMax')} ft`)]), S.expert ? field(t('levels'), input('text', d.levels.join(', '), { oninput: (e) => { d.levels = e.target.value.split(/[,;]+/).map((x) => x.trim()).filter(Boolean); } })) : h('div.note', `${t('levels')}: ${d.levels.join(', ')} (${t('set_expert')})`)]));
    }
    return h('div.card', h('div.card-body', box));
  }

  /** Flugplan: Standardwerte für den ICAO-FPL (Felder 8, 10, 15, 18, 19) je Ballontyp, Vorlagen mit Platzhaltern. */
  function fpl() {
    S.fpl = S.fpl || {}; const F = S.fpl;
    for (const k of ['gas', 'hab', 'r19', 's19', 'j19', 'd19', 'typeOfFlight']) F[k] = F[k] || {};
    const flags = (key, labels) => h('div.f', [h('label', t('fpl_f_' + key)), h('div.chips', Object.keys(labels).map((k) => h('button.chip', { type: 'button', 'aria-pressed': !!F[key][k], onclick: (e) => { F[key][k] = !F[key][k]; e.currentTarget.setAttribute('aria-pressed', F[key][k]); } }, labels[k])))]);
    const tof = (k) => field(`${t('fpl_f_typeOfFlight8')} (${t('kind_' + k)})`, select([['G', 'G – General aviation'], ['N', 'N – Non-scheduled'], ['S', 'S – Scheduled'], ['X', 'X – Other']].map(([v, l]) => ({ value: v, label: l })), F.typeOfFlight[k] || (k === 'commercial' ? 'N' : 'G'), { onchange: (e) => { F.typeOfFlight[k] = e.target.value; } }));
    return h('div', [
      h('div.card', [h('div.card-head', h('div.section-title', t('set_fpl'))), h('div.card-body', [
        h('div.note', t('set_fplHint')),
        h('div.frow.c4', [tof('commercial'), tof('private'), tof('training'), tof('exam')]),
        h('div.frow.c4', [txtField(F, 'equip10a', t('fpl_f_equip10a')), txtField(F, 'equip10b', t('fpl_f_equip10b'))]),
        h('div.frow.c4', [numField(F, 'levelFromFt', t('set_fplLevelFrom'), 500), txtField(F, 'satphone', t('set_fplSatphone')), txtField(F, 'colour', t('set_fplColour')), field(t('set_fplPicOrder'), select([{ value: 'last-first', label: 'WICKI BALTHASAR' }, { value: 'first-last', label: 'BALTHASAR WICKI' }], F.picNameOrder || 'last-first', { onchange: (e) => { F.picNameOrder = e.target.value; } }))]),
        h('div.frow', [txtField(F, 'rmk18', 'RMK/ ' + t('set_fplTemplate')), txtField(F, 'n19', 'N/ ' + t('set_fplTemplate'))]),
        h('div.frow.c2', [txtField(F, 'rmkTraining', `RMK/ ${t('kind_training')}`), txtField(F, 'rmkExam', `RMK/ ${t('kind_exam')}`)]),
        h('div.note.small', t('set_fplRmkKind')),
        h('div.note.small', t('set_fplVars')),
      ])]),
      h('div.card', [h('div.card-head', h('div.section-title', `${t('gas')}`)), h('div.card-body', h('div.frow.c4', [txtField(F.gas, 'speed15', t('fpl_f_speed15')), numField(F.gas, 'enduranceMin', t('set_fplEndurance')), txtField(F.gas, 'typ18', 'TYP/'), txtField(F.gas, 'equip10b', `${t('fpl_f_equip10b')} (${t('gas')})`)]))]),
      h('div.card', [h('div.card-head', h('div.section-title', `${t('hab')}`)), h('div.card-body', [h('div.frow.c4', [txtField(F.hab, 'speed15', t('fpl_f_speed15')), txtField(F.hab, 'typ18', 'TYP/'), txtField(F.hab, 'equip10b', `${t('fpl_f_equip10b')} (${t('hab')})`)]), h('div.note.small', t('set_fplHabEndurance'))])]),
      h('div.card', [h('div.card-head', h('div.section-title', t('fpl_i19'))), h('div.card-body', [
        h('div.frow.c3', [flags('r19', { uhf: 'UHF', vhf: 'VHF', elba: 'ELBA' }), flags('s19', { polar: 'POLAR', desert: 'DESERT', maritime: 'MARITIME', jungle: 'JUNGLE' }), flags('j19', { light: 'LIGHT', fluores: 'FLUORES', uhf: 'UHF', vhf: 'VHF' })]),
        h('div.frow.c4', [txtField(F.d19, 'number', 'D/ ' + t('fpl_f_dNumber')), txtField(F.d19, 'capacity', t('fpl_f_dCapacity')), check(t('fpl_f_dCover'), !!F.d19.cover, (v) => { F.d19.cover = v; }), txtField(F.d19, 'colour', t('fpl_f_dColour'))]),
      ])]),
    ]);
  }

  function schedule() {
    const d = S.scheduleDefaults;
    return h('div.card', h('div.card-body', h('div.frow.c4', [numField(d, 'trailerFactor', t('set_trailer'), 0.05), numField(d, 'surchargeMin', t('set_surcharge')), numField(d, 'bufferMin', t('set_buffer')), numField(d, 'recoveryMin', t('set_recovery'))])));
  }

  function rac() {
    const status = h('div.note');
    const fileIn = h('input', { type: 'file', accept: 'application/pdf', style: { display: 'none' } });
    const refresh = () => { status.textContent = `${t('set_racDefault')}: ${ctx.racDefault ? racValidity(ctx.racDefault) : '–'} · ${t('set_racCustom')}: ${S.rac.custom ? racValidity(S.rac.custom) + ' (' + Object.keys(S.rac.custom.days).length + ' d)' : '–'}`; };
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files[0]; if (!f) return;
      status.textContent = t('set_racParse');
      try {
        const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
        const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
        let lines = [];
        for (let i = 1; i <= doc.numPages; i++) { const pg = await doc.getPage(i); const tc = await pg.getTextContent(); lines = lines.concat(linesFromPdfItems(tc.items)); }
        const table = parseRacText(lines.join('\n'), f.name);
        S.rac.custom = table;
        status.textContent = t('set_racOk', { n: Object.keys(table.days).length, v: racValidity(table) }) + (table.problems.length ? ` · ${table.problems.length} ?` : '');
      } catch (e) { status.textContent = t('set_racErr', { e: e.message }); }
    });
    refresh();
    return h('div.card', h('div.card-body', [
      h('div.row-actions', [h('button.btn', { type: 'button', onclick: () => fileIn.click() }, t('set_racUpload')), S.rac.custom ? h('button.btn', { type: 'button', onclick: () => { S.rac.custom = null; refresh(); } }, t('set_racRemove')) : null, fileIn]),
      status,
      h('div.note', { style: { marginTop: '8px' } }, 'VFR Manual Switzerland, RAC 4-4 «Tag- und Nachtgrenzen» (skyguide). Lokalzeit, Referenz Sternwarte Bern, gültig für die FIR Schweiz.'),
    ]));
  }

  function transition() {
    const box = h('div');
    const drawT = () => {
      clear(box);
      S.transitionAltitudes.forEach((ta, i) => box.appendChild(h('div.frow.c3', [txtField(ta, 'label', t('name')), field(t('s_country'), input('text', (ta.countries || []).join(','), { oninput: (e) => { ta.countries = e.target.value.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean); } })), h('div.f', [h('label', ' '), h('button.btn', { type: 'button', onclick: () => { S.transitionAltitudes.splice(i, 1); drawT(); } }, t('remove'))])])));
      box.addFn = () => { S.transitionAltitudes.push({ id: uid(5), label: '', countries: [] }); drawT(); };
    };
    drawT();
    const defs = h('div.frow.c3', ['CH', 'DE', 'FR', 'AT', 'IT'].map((cc) => field(`${t('default')} ${cc}`, input('text', (S.transitionDefaults[cc] || []).join(','), { placeholder: 'ids', oninput: (e) => { S.transitionDefaults[cc] = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); } }))));
    return h('div.card', [listHead(t('set_transition'), box), h('div.card-body', [box, h('div.note', t('tr_hint')), defs])]);
  }

  function gonogo() {
    const g = S.goNoGo;
    return h('div.card', h('div.card-body', [h('div.frow.c4', [numField(g, 'dryWindowH', 'Trockenfenster ≥ h'), numField(g, 'noTsH', 'kein Gewitter innert h'), numField(g, 'meanWindKt', 'Mittelwind < kt'), numField(g, 'gustKt', 'Böen < kt')]), h('div.note', 'Ampel ab Phase 3.')]));
  }

  function meteo() {
    const F = S.flyLimits, T = S.trajDefaults;
    const pair = (key, label) => field(label, h('div.inline', [input('number', F[key][0], { step: 0.5, oninput: (e) => { F[key][0] = num(e.target.value); } }), input('number', F[key][1], { step: 0.5, oninput: (e) => { F[key][1] = num(e.target.value); } })]));
    const chartsBox = h('div');
    const drawCharts = () => {
      clear(chartsBox);
      (S.synopticCharts || []).forEach((c, i) => chartsBox.appendChild(h('div.frow', [txtField(c, 'name', t('name')), h('div.inline', [input('text', c.url, { oninput: (e) => { c.url = e.target.value; } }), h('button.btn.icon', { type: 'button', onclick: () => { S.synopticCharts.splice(i, 1); drawCharts(); } }, icon('del'))])])));
      chartsBox.addFn = () => { (S.synopticCharts = S.synopticCharts || []).push({ name: '', url: 'https://' }); drawCharts(); };
    };
    drawCharts();
    const camBox = h('div');
    const drawCams = () => {
      clear(camBox);
      (S.webcams || []).forEach((w, i) => camBox.appendChild(h('div.item-box', [
        h('div.frow', [txtField(w, 'name', t('name')), h('div.inline', [input('text', w.url, { placeholder: 'https://', oninput: (e) => { w.url = e.target.value; } }), h('button.btn.icon', { type: 'button', title: t('remove'), onclick: () => { S.webcams.splice(i, 1); drawCams(); } }, icon('del'))])]),
        placeRow(w, { label: t('coords'), title: t('set_webcams'), noName: true, onPick: (p) => { w.lat = p.lat; w.lon = p.lon; if (!w.name) w.name = p.name; drawCams(); } }),
      ])));
      camBox.addFn = () => { (S.webcams = S.webcams || []).push({ id: uid(5), name: '', lat: null, lon: null, url: 'https://' }); drawCams(); };
    };
    drawCams();
    const txtBox = h('div');
    const drawTxt = () => {
      clear(txtBox);
      (S.wxTexts || []).forEach((x, i) => txtBox.appendChild(h('div.frow.c4', [field(t('s_country'), h('div.inline', [input('text', x.cc, { maxlength: 2, style: { width: '64px' }, oninput: (e) => { x.cc = e.target.value.toUpperCase(); } }), check(t('set_wxFetch'), !x.disabled, (v) => { x.disabled = !v; })])), txtField(x, 'name', t('name')), field('URL', input('text', x.url, { oninput: (e) => { x.url = e.target.value; } })), h('div.f', [h('label', t('set_wxSel')), h('div.inline', [input('text', x.sel || '', { placeholder: 'main', oninput: (e) => { x.sel = e.target.value; } }), h('button.btn.icon', { type: 'button', title: t('remove'), onclick: () => { S.wxTexts.splice(i, 1); drawTxt(); } }, icon('del'))])])])));
      txtBox.addFn = () => { (S.wxTexts = S.wxTexts || []).push({ cc: 'CH', name: '', url: 'https://', sel: 'main' }); drawTxt(); };
    };
    drawTxt();
    return h('div', [
      h('div.card', [h('div.card-head', h('div.section-title', t('set_flyLimits'))), h('div.card-body', [h('div.frow.c4', [pair('wind', `${t('auto_wind')} m/s (marginal / nein)`), pair('gust', `${t('auto_gust')} m/s`), pair('gustSpread', 'Böe − Wind m/s'), pair('cape', 'CAPE J/kg')]), h('div.frow.c3', [numField(F, 'precip', 'Niederschlag ≥ mm/h → nein', 0.1), numField(F, 'visKm', 'Sicht < km → nein', 0.5), numField(F, 'baseFt', 'Wolkenbasis < ft → marginal', 100)])])]),
      h('div.card', [h('div.card-head', h('div.section-title', t('set_trajDefaults'))), h('div.card-body', h('div.frow.c3', [numField(T, 'hab', `${t('hab')} (min)`, 30), numField(T, 'gas', `${t('gas')} (min)`, 60), numField(T, 'stepMin', 'Zeitschritt (min)', 5)]))]),
      h('div.card', [h('div.card-head', h('div.section-title', t('set_meteo'))), h('div.card-body', [h('div.frow.c4', [numField(S.meteoDefaults, 'topHpa', 'Profil bis hPa', 50), numField(S, 'metarRadiusKm', t('set_metar'), 10), numField(S, 'metarCount', t('set_metarN')), numField(S, 'notamRadiusNm', t('set_notamNm'), 5)]), h('div.frow.c4', [numField(S, 'airspaceCorridorKm', t('set_airspaceCorridor'), 1), numField(S, 'obsRadiusKm', t('set_obsRadius'), 10), numField(S, 'sondeKm', t('set_sondeKm'), 10), field([icon('ai', 12), ' ', t('set_aiModel')], input('text', S.aiModel ?? '', { oninput: (e) => { S.aiModel = e.target.value; } }))])])]),
      h('div.card', [listHead(t('set_wxTexts'), txtBox), h('div.card-body', [txtBox, h('div.note', t('set_wxTextsHint'))])]),
      h('div.card', [listHead(t('set_webcams'), camBox), h('div.card-body', [h('div.note', t('set_webcamsAuto')), h('div.frow.c4', [numField(S, 'webcamKm', t('set_webcamKm'), 5)]), camBox, h('div.note', t('set_webcamsHint'))])]),
      h('div.card', [listHead(t('set_synoptic'), chartsBox), h('div.card-body', [chartsBox, h('div.note', 'Nur Bild-URLs von dwd.de, ecmwf.int, meteoschweiz.admin.ch, rainviewer, meteoblue, skybriefing, eumetsat (Allowlist im Worker).')])]),
    ]);
  }

  function panels() {
    const box = h('div');
    const hidden = new Set(S.panels.hidden || []), mand = new Set(S.panels.mandatory || []);
    /** Kompakte Tabelle je Abschnitt: Nr. (wie im Briefing, ausgeblendete ohne Nummer) · Panel · ausblenden · Pflicht. */
    const draw = () => {
      clear(box);
      const vis = visiblePanels(S);
      for (const s of SECTIONS) {
        const rows = PANELS.filter((x) => x.section === s.id).map((p) => {
          const on = !hidden.has(p.key);
          return h('tr' + (on ? '' : '.off'), [
            h('td.no', on ? h('span.pno', panelNo(p, vis)) : h('span.muted', '–')),
            h('td.nm', [tt(p), p.always ? h('span.tag.calc', 'fix') : null, p.chOnly ? h('span.tag', 'CH') : null, p.grade === 'auto' ? h('span.tag.auto', 'AUTO') : null]),
            h('td.ck', p.always ? '' : h('input', { type: 'checkbox', checked: hidden.has(p.key), title: t('set_hidden'), onchange: (e) => { if (e.target.checked) hidden.add(p.key); else hidden.delete(p.key); S.panels.hidden = [...hidden]; markDirty(); draw(); } })),
            h('td.ck', p.always ? '' : h('input', { type: 'checkbox', checked: mand.has(p.key), title: t('set_mandatory'), onchange: (e) => { if (e.target.checked) mand.add(p.key); else mand.delete(p.key); S.panels.mandatory = [...mand]; markDirty(); } })),
          ]);
        });
        box.appendChild(h('table.panels-tbl', [
          h('thead', h('tr', [h('th.no', t('set_panelNo')), h('th.nm', `${s.id} · ${s[getLang()] || s.de}`), h('th.ck', t('set_hidden')), h('th.ck', t('set_mandatory'))])),
          h('tbody', rows),
        ]));
      }
    };
    draw();
    return h('div.card', h('div.card-body', [h('div.note', t('set_mandatoryHint')), box]));
  }

  function links() {
    return h('div.card', h('div.card-body', h('div.frow.c3', [numField(S.links, 'defaultExpiryDays', t('set_linkDays'))])));
  }

  const users = () => usersSection(ctx);
  const stats = () => h('div', [statsSection(ctx), logSection(ctx)]);   // 0.12.16: Aktivitätsprotokoll unter der Statistik

  function access() {
    const box = h('div');
    const ro = ctx.store.mode === 'remote' && !ctx.isSuper;
    const names = [['openmeteo', 'Open-Meteo API key'], ['meteoblue', 'meteoblue API key'], ['anthropic', 'Anthropic API key'], ['pcmet_user', 'pc_met Benutzer'], ['pcmet_pass', 'pc_met Kennwort'], ['skybriefing_user', 'skybriefing Benutzer'], ['skybriefing_pass', 'skybriefing Kennwort'], ['ors', 'OpenRouteService key'], ['openaip', 'openAIP API key (nur noch Karten-Overlay; Luftraumanalyse braucht keinen Schlüssel)'], ['windy_webcams', 'Windy Webcams key'], ['autorouter_user', 'autorouter Benutzer (E-Mail) – NOTAM'], ['autorouter_pass', 'autorouter Kennwort – NOTAM'], ['faa_client_id', 'FAA NMS Client Key (nur Diagnose – der Abruf läuft über GitHub-Secrets FAA_CLIENT_ID/FAA_CLIENT_SECRET, siehe SETUP)'], ['faa_client_secret', 'FAA NMS Client Secret (nur Diagnose)'], ['meteofrance_key', 'Météo-France API-Schlüssel (Beobachtungen F)'], ['cf_account_id', 'Cloudflare Account-ID (Final-PDF)'], ['cf_api_token', 'Cloudflare API-Token mit «Browser Rendering» (Final-PDF)']];
    const drawA = async () => {
      clear(box);
      if (ctx.store.mode !== 'remote') { box.appendChild(h('div.note', t('ac_localOnly'))); return; }
      let have = {};
      try { have = await ctx.store.listSecrets(); } catch (e) { box.appendChild(h('div.err', e.message)); return; }
      if (ro) { box.appendChild(h('div.note', t('set_secretsReadOnly'))); box.appendChild(h('ul.plain', names.map(([k, label]) => h('li', `${label}: ${have[k] ? t('set_secretSet') : t('set_secretUnset')}`)))); return; }
      for (const [k, label] of names) {
        const inp = input('password', '', { placeholder: have[k] ? '••••••••' : '', autocomplete: 'off', spellcheck: 'false' });
        // Auge: Eingabe im Klartext zeigen; bei leerem Feld den gespeicherten Wert nachladen (Supermaster, protokolliert)
        let shown = false, loaded = '';
        const eye = h('button.btn.icon.eye', { type: 'button', title: t('set_secretShow'), 'aria-label': t('set_secretShow') }, icon('view'));
        eye.onclick = async () => {
          if (!shown) {
            if (!inp.value && have[k]) { try { loaded = (await ctx.store.getSecret(k)).value || ''; inp.value = loaded; } catch (e) { toast(e.status === 403 ? t('set_secretsReadOnly') : `${t('error')}: ${e.message}`); return; } }
            inp.type = 'text'; shown = true; eye.textContent = '🙈'; eye.title = t('set_secretHide');
          } else {
            inp.type = 'password'; shown = false; eye.replaceChildren(icon('view')); eye.title = t('set_secretShow');
            if (loaded && inp.value === loaded) { inp.value = ''; loaded = ''; }   // unverändert nachgeladen → wieder leeren (kein versehentliches Neu-Speichern)
          }
        };
        box.appendChild(h('div.frow.c3', [field(label, h('div.pwwrap', [inp, eye])), h('div.f', [h('label', have[k] ? t('set_secretSet') : t('set_secretUnset')), h('div.row-actions', [h('button.btn', { type: 'button', onclick: async () => { if (!inp.value || inp.value === loaded) { toast(t('set_secretUnchanged')); return; } await ctx.store.setSecret(k, inp.value); inp.value = ''; loaded = ''; toast(t('set_saved')); drawA(); } }, t('set_secretSave')), have[k] ? h('button.btn', { type: 'button', onclick: async () => { if (!(await dialog(t('set_secretDelete'), h('p', `${label}: ${t('set_secretConfirm')}`), [{ label: t('cancel'), value: false }, { label: t('delete'), value: true, primary: true }]))) return; await ctx.store.deleteSecret(k); drawA(); } }, t('set_secretDelete')) : null])])]));
      }
    };
    drawA();
    return h('div.card', h('div.card-body', [h('details.exp', { open: ro }, [h('summary', t('set_access')), h('div.note', t('set_secretsHint')), box])]));
  }

  /** Aktivitäten des Tagesplans: eingebaute ein-/ausblenden, Standarddauer; eigene (DE/EN, Dauer, mit Ort). */
  function activitiesCard() {
    S.activities = S.activities || { hidden: [], minutes: {}, custom: [] };
    const A = S.activities; A.hidden = A.hidden || []; A.minutes = A.minutes || {}; A.custom = A.custom || [];
    const fixed = new Set(['start', 'flight', 'landing']);
    const builtin = h('table.auto.acts', [h('thead', h('tr', [t('sch_colAct'), t('sch_colMin'), t('act_visible')].map((x) => h('th', x)))), h('tbody', ACT_TYPES.map((k) => h('tr', [h('td', t('act_' + k)), h('td', k === 'flight' ? h('span.muted', t('sch_flightFromIntent')) : input('number', A.minutes[k] ?? ACT_DEFAULT_MIN[k], { step: 5, min: 0, oninput: (e) => { const v = num(e.target.value, null); if (v == null || v === ACT_DEFAULT_MIN[k]) delete A.minutes[k]; else A.minutes[k] = v; } })), h('td', fixed.has(k) ? '✓' : h('input', { type: 'checkbox', checked: !A.hidden.includes(k), onchange: (e) => { const i = A.hidden.indexOf(k); if (e.target.checked && i >= 0) A.hidden.splice(i, 1); if (!e.target.checked && i < 0) A.hidden.push(k); } }))])))]);
    const box = h('div');
    const drawC = () => { clear(box); A.custom.forEach((a, i) => box.appendChild(h('div.frow.c4', [txtField(a, 'de', 'DE'), txtField(a, 'en', 'EN'), numField(a, 'min', t('sch_colMin'), 5), h('div.f', [h('label', t('sch_colPlace')), h('div.row-actions', [check(t('act_withPlace'), a.place !== false, (v) => { a.place = v; }), h('button.btn.icon', { type: 'button', onclick: () => { A.custom.splice(i, 1); drawC(); } }, icon('del'))])])]))); };
    drawC();
    box.addFn = () => { A.custom.push({ id: uid(5), de: '', en: '', min: 15, place: true }); drawC(); };
    return h('div.card', [listHead(t('set_activities'), box, t('act_add')), h('div.card-body', [h('div.note', t('set_activitiesHint')), h('div.tbl-scroll', builtin), h('div.lbl', { style: { marginTop: '10px' } }, t('act_own')), box])]);
  }

  /** Länder-Matrix: Quellen und Pflichtpunkte je Land und Rolle (Start/Überflug/Landung); eigene Notizen je Land. */
  function countryMatrixCard() {
    const lang = getLang();
    S.countryNotes = S.countryNotes || {};
    const rows = Object.entries(COUNTRY_MATRIX).map(([code, c]) => h('tr', [
      h('td.cc', [h('b', code), h('div.small.muted', c.name[lang] || c.name.de)]),
      h('td', [c.official.url ? h('a', { href: c.official.url, target: '_blank', rel: 'noopener' }, c.official.label) : c.official.label, h('div.small.muted', `${c.official.reports} · ${t('cm_access')}: ${c.official.access}`), h('div.small.muted', `${t('cm_model')}: ${c.model}`)]),
      h('td', [h('div', c.airspace), h('div.small.muted', `NOTAM: ${c.notam}`), c.dabs !== '–' ? h('div.small', { style: { color: 'var(--neg,#b00)' } }, `DABS: ${c.dabs}`) : null]),
      h('td', [h('div', c.sun), h('div.small.muted', `FPL: ${c.fpl}`), h('div.small.muted', c.contacts)]),
      h('td', ROLES.map((r) => h('div.small', [h('b', t('cm_role_' + r) + ': '), (c.roles[r] || []).join('; ') || '–']))),
      h('td', [c.notes?.length ? h('div.small.muted', c.notes.join(' · ')) : null, textarea(S.countryNotes[code] || '', { rows: 2, placeholder: t('cm_notes'), oninput: (e) => { S.countryNotes[code] = e.target.value; } })]),
    ]));
    return h('div.card', [h('div.card-head', h('div.section-title', t('cm_title'))), h('div.card-body', [
      h('div.note', t('cm_hint')),
      h('div.tbl-wrap', h('table.cm-tbl', [h('thead', h('tr', [h('th', t('cm_country')), h('th', t('cm_official')), h('th', t('cm_airspace')), h('th', t('cm_sunFpl')), h('th', t('cm_roles')), h('th', t('cm_notesCol'))])), h('tbody', rows)])),
    ])]);
  }
  function expert() {
    const pwOld = input('password', '', { autocomplete: 'current-password' }), pwNew = input('password', '', { autocomplete: 'new-password' }), pwNew2 = input('password', '', { autocomplete: 'new-password' });
    const pwBtn = h('button.btn', { type: 'button', onclick: async () => {
      if (pwNew.value !== pwNew2.value) { toast(t('set_pwMismatch')); return; }
      if (pwNew.value.length < 4) { toast('≥ 4'); return; }
      try { await ctx.store.changePassword(pwOld.value, pwNew.value); toast(t('set_pwChanged')); pwOld.value = pwNew.value = pwNew2.value = ''; }
      catch (e) { toast(e.message === 'wrong' || e.status === 403 ? t('set_pwWrong') : `${t('error')}: ${e.message}`); }
    } }, t('set_password'));
    const r = S.reserve;
    return h('div', [
      h('div.card', [h('div.card-head', h('div.section-title', t('set_password'))), h('div.card-body', [h('div.frow.c3', [field(t('set_pwOld'), pwOld), field(t('set_pwNew'), pwNew), field(t('set_pwNew2'), pwNew2)]), pwBtn])]),
      h('div.card', [h('div.card-head', h('div.section-title', t('set_reserve'))), h('div.card-body', h('div.frow.c3', [numField(r, 'pct', `${t('set_reservePct')} %`), numField(r, 'capMin', t('set_reserveCap')), numField(r, 'minMin', t('set_reserveMin'))]))]),
      h('div.card', [h('div.card-head', h('div.section-title', t('set_expertMode'))), h('div.card-body', check(t('set_expertMode'), S.expert, (v) => { S.expert = v; }))]),
      h('div.card', [h('div.card-head', h('div.section-title', t('set_export'))), h('div.card-body', [h('div.row-actions', [h('button.btn', { type: 'button', onclick: () => exportAll(ctx).catch((e) => toast(e.message)) }, t('export_all')), ctx.isSuper && ctx.store.mode === 'remote' ? h('button.btn', { type: 'button', onclick: () => exportAll(ctx, true).catch((e) => toast(e.message)) }, t('export_allUsers')) : null]), h('div.note', t('export_hint'))])]),
      h('div.card', [h('div.card-head', h('div.section-title', t('pax_title'))), h('div.card-body', [field(t('pax_bring') + ' (DE, eine Zeile je Punkt)', textarea((S.paxCardItems?.de || []).join('\n'), { rows: 5, oninput: (e) => { S.paxCardItems = S.paxCardItems || {}; S.paxCardItems.de = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); } })), field(t('pax_bring') + ' (EN)', textarea((S.paxCardItems?.en || []).join('\n'), { rows: 5, oninput: (e) => { S.paxCardItems = S.paxCardItems || {}; S.paxCardItems.en = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); } }))])]),
      h('div.card', [h('div.card-head', h('div.section-title', t('set_airspace'))), h('div.card-body', [txtField(S, 'airspaceTileUrl', t('set_airspaceUrl')), h('div.note', t('set_airspaceHint'))])]),
      h('div.card', [h('div.card-head', h('div.section-title', t('set_thermal'))), h('div.card-body', [h('div.frow.c4', [numField(S.thermalLimits, 'none', `${t('th_weak')} ab w* m/s`, 0.1), numField(S.thermalLimits, 'weak', `${t('th_moderate')} ab m/s`, 0.1), numField(S.thermalLimits, 'moderate', `${t('th_strong')} ab m/s`, 0.1), numField(S.thermalLimits, 'strong', `${t('th_severe')} ab m/s`, 0.1)]), h('div.frow.c4', [numField(S.thermalLimits, 'onset', `${t('th_onset')} ab w* m/s`, 0.1)]), h('div.note', t('set_thermalHint'))])]),
      h('div.card', [h('div.card-head', h('div.section-title', t('set_airspaceWarn'))), h('div.card-body', h('div.frow.c4', [numField(S, 'airspaceTmaWarnFt', t('set_tmaWarn'), 100)]))]),
      h('div.card', [h('div.card-head', h('div.section-title', t('set_paxCardTitle'))), h('div.card-body', [h('div.frow', [txtField(S.paxCardTitle, 'de', 'DE'), txtField(S.paxCardTitle, 'en', 'EN')]), h('div.note', t('set_paxCardTitleHint'))])]),
      h('div.card', [h('div.card-head', h('div.section-title', t('set_pdiffWarn'))), h('div.card-body', h('div.frow.c4', [numField(S.pdiffWarn, 'half', `${t('set_pdiffHalf')} hPa`, 0.5), numField(S.pdiffWarn, 'neg', `${t('set_pdiffNeg')} hPa`, 0.5)]))]),
      h('div.card', [h('div.card-head', h('div.section-title', t('set_aero'))), h('div.card-body', [
        h('div.lbl', t('set_aeroClear')), h('div.frow.c4', [numField(S.aero, 'dtDayClear', `${t('set_aeroDay')} K`, 1), numField(S.aero, 'dtNightClear', `${t('set_aeroNight')} K`, 1)]),
        h('div.lbl', t('set_aeroOvercast')), h('div.frow.c4', [numField(S.aero, 'dtDayOvercast', `${t('set_aeroDay')} K`, 1), numField(S.aero, 'dtNightOvercast', `${t('set_aeroNight')} K`, 1)]),
        h('div.frow.c4', [numField(S.aero, 'liftPctPerK', `${t('set_aeroPerK')} %/K`, 0.05), numField(S.aero, 'fullLossPctPer80m', `${t('set_aeroFull')} %/80 m`, 0.1)]),
        h('div.note', t('set_aeroHint')),
      ])]),
      h('div.card', [h('div.card-head', h('div.section-title', t('set_profileLimits'))), h('div.card-body', h('div.frow.c4', [numField(S.profileLimits, 'windKt', t('set_pfWind'), 1), numField(S.profileLimits, 'shearKt', t('set_pfShear'), 1), numField(S.profileLimits, 'cape', t('set_pfCape'), 50), numField(S.profileLimits, 'minAgl', t('set_pfAgl'), 50)]))]),
      h('div.card', [h('div.card-head', h('div.section-title', t('set_fis'))), h('div.card-body', [textarea((S.fisContacts || []).map((c) => [c.cc, c.name, c.freq, c.phone].join(' · ')).join('\n'), { rows: 7, oninput: (e) => { S.fisContacts = e.target.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [cc = '', name = '', freq = '', phone = ''] = l.split('·').map((x) => x.trim()); return { cc: cc.toUpperCase(), name, freq, phone }; }); } }), h('div.note', t('set_fisHint'))])]),
      activitiesCard(),
      countryMatrixCard(),
      h('div.card', [h('div.card-head', h('div.section-title', t('set_docTypes'))), h('div.card-body', h('div.frow', [field(t('set_docTypesBalloon'), textarea((S.docTypes?.balloon || []).join('\n'), { rows: 6, oninput: (e) => { (S.docTypes = S.docTypes || {}).balloon = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); } })), field(t('set_docTypesPerson'), textarea((S.docTypes?.person || []).join('\n'), { rows: 6, oninput: (e) => { (S.docTypes = S.docTypes || {}).person = e.target.value.split('\n').map((x) => x.trim()).filter(Boolean); } }))]))]),
    ]);
  }
  draw();
}
