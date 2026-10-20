/* Fahrtbriefing — Briefingsicht: das fertige Briefing, Grundlage für Druck und Leselink. */
import { h, clear, fmt, fmtSigned, textToNodes, dialog, confirmDialog, toast, lightbox } from '../util.js';
import { t, tt, getLang } from '../i18n.js';
import { setHeader, printButton } from '../app.js';
import { APP } from '../version.js';
import { SECTIONS, visiblePanels, panelNo, AMC1_BOP_BAS_115, GAS_BRIEFING_EXTRA } from '../panels.js';
import { sunTables, twilightClass } from './parts.js';
import { massPerf, fillFractionOf, scheduleFor, sunFor, upgradeBriefing, scheduleRowLabel, balloonImage, isLocked, isArchived, nextAmendmentNo, duplicateBriefing, titleLine, lastChangeLine, paxLine, countriesLine, placeLabel, hasCopilot, routeCountries, transitionItems, intentLine } from '../model.js';
import { fplView } from './fplpanel.js';
import { profileView } from './profile.js';
import { docsLine } from '../stamm.js';
import { placeLine } from './place.js';
import { renderSnapshot, standLine, coverWarn, liveWarn, pasteWarn, renderReport, isReport } from './autorender.js';
import { load, save } from '../util.js';
import { goNoGo } from '../calc/gonogo.js';
import { changesSinceFinal } from '../calc/diff.js';
import { fmtDate, fmtDateTime, hhmm, fmtDur } from '../calc/time.js';
import { printDialog, paxSheet, paxCardTitle } from './extras.js';
import { distKm, bearing } from '../calc/geo.js';
import { actualSection } from './actual.js';
import { icon, iconSvg } from './icons.js';
import { stageSets, startPlanOff, startPlanBriefing } from '../calc/stageplan.js';

export async function renderBrief(view, ctx, id, opts = {}) {
  const shared = ctx.shared;
  const b = opts.briefing || await ctx.store.getBriefing(id);
  if (!b) { view.appendChild(h('div.err', 'not found')); return; }
  upgradeBriefing(b);
  const S = ctx.settings, z = b.site.tz || 'Europe/Zurich', lang = getLang();
  const foreign = !shared && b.access === 'read';   // Briefing eines anderen Benutzers (Super / Materialeigner): nur lesen
  const canEdit = !foreign && (!shared || shared.role === 'edit');
  const locked = isLocked(b);
  const archived = isArchived(b), running = locked && !archived;   // 0.12.10: laufende Fahrt (Start + 1 h vorbei) → Nachtrag; Archiv → Kopie als Vorlage
  const startLT = `${fmtDate(z, b.time.startMs, lang)} ${hhmm(z, b.time.startMs)}`;
  const lockTitle = b.frozen ? t('frozen_title') : running ? t('running_title') : t('locked_title');
  const lockText = b.frozen ? t('frozen_text', { no: b.no || '–', t: b.frozenAt ? `${fmtDate(z, b.frozenAt, lang)} ${hhmm(z, b.frozenAt)}` : '–' }) : running ? t('running_text', { t: startLT }) : t('locked_text', { d: fmtDate(z, b.time.startMs, lang) });
  /** Fahrt vorbei: Hinweis mit «Kopieren und neu anlegen» (nur Eigner); laufende Fahrt: «Nachtrag anlegen»; das Briefing selbst bleibt unverändert. */
  const lockDialog = async () => {
    const own = !shared && !foreign;
    if (running && own) {
      const ok = await confirmDialog(t('amend_title'), t('amend_q', { t: startLT, no: b.no || '–', newNo: nextAmendmentNo(b.no || '') }), { yes: t('amend_yes'), no: t('cancel') });
      if (!ok) return;
      try { const r = await ctx.store.amendBriefing(b.id, ctx.who); try { sessionStorage.setItem('fb.amend.' + b.id, '1'); } catch { /* ohne Sitzungsspeicher */ } toast(`${r.no} ✓`); ctx.navigate(`#/b/${b.id}`); } catch (e) { toast(t('amend_fail')); console.error(e); }
      return;
    }
    const r = await dialog(lockTitle, h('p', lockText), [{ label: t('close'), value: false }, own ? { label: t('locked_copy'), value: true, primary: true } : null].filter(Boolean));
    if (r === true) { const c = duplicateBriefing(b, S); await ctx.store.saveBriefing(c, ctx.who); toast(`${c.no || ''} ✓`); ctx.navigate(`#/new/${c.id}`); }
  };
  const tools = [];
  // 0.12.8: Stelle merken (zuletzt gesehene Panelzeile) – «Erarbeitung» öffnet dort; beim ersten Öffnen in der Sitzung beginnt die Briefingsicht oben
  const posKey = 'fb.pos.' + b.id, seenKey = 'fb.seen.' + b.id; let curPos = '';
  const rowPos = (tr) => { const cls = [...tr.classList]; const m = cls.find((c) => /^row-[A-E]-/.test(c)); if (!m) return ''; const sid = cls.find((c) => /^row-st/.test(c))?.slice(4); return `${sid ? sid + '-' : ''}${m.slice(4).replace('-', '.')}`; };
  const onScroll = () => { if (!view.isConnected) { window.removeEventListener('scroll', onScroll); return; } let cur = null; for (const tr of view.querySelectorAll('.brief tr[class*="row-"]')) { if (tr.getBoundingClientRect().top <= 140) cur = tr; else break; } if (cur) curPos = rowPos(cur); };
  window.addEventListener('scroll', onScroll, { passive: true });
  const toggle = h('div.viewtoggle', [canEdit ? h('button', { type: 'button', onclick: () => { try { sessionStorage.setItem(posKey, curPos); } catch { /* ohne Speicher */ } return locked ? lockDialog() : ctx.navigate(shared ? `#/s/${shared.token}` : `#/b/${b.id}`); } }, t('view_edit')) : null, h('button.on', { type: 'button' }, t('view_brief'))]);
  const paxHash = shared?.material ? `#/m/${shared.token}/${b.id}/p` : shared ? `#/s/${shared.token}/p` : `#/pax/${b.id}`;
  if (shared?.material) tools.push(h('button.btn', { type: 'button', onclick: () => ctx.navigate(`#/m/${shared.token}`) }, `← ${t('ml_title')}`));
  // Druckteile aus dem Hash (?parts=brief,dabs,notam,pax) oder aus dem Druckdialog; Standard: Briefing + DABS-Beilage + NOTAM
  const q = new URLSearchParams((location.hash.split('?')[1] || ''));
  let parts = (q.get('parts') || 'brief,dabs,notam').split(',');
  const brief = h('div.brief');
  let paxEl = null;
  const applyParts = (list) => {
    parts = list;
    brief.classList.toggle('noatt', !parts.includes('dabs'));
    brief.classList.toggle('nonotam', !parts.includes('notam'));
    if (paxEl) { paxEl.remove(); paxEl = null; }
    if (parts.includes('pax')) { paxEl = paxSheet(b, ctx); paxEl.classList.add('print-only', 'pax-append'); brief.appendChild(paxEl); }
  };
  tools.push(toggle, printButton(() => printDialog(b, ctx, shared, (p) => { applyParts(p.split(',')); setTimeout(() => window.print(), 150); })));
  // 0.13.0: Betriebsdokumente (Beförderungsschein, Flugauftrag) – Eigner und Links mit Schreibrecht
  const docHash = (k) => (shared?.material ? `#/m/${shared.token}/${b.id}/${k}` : shared ? `#/s/${shared.token}/${k}` : `#/${k}/${b.id}`);
  const menu = [{ label: t('more'), items: [{ label: paxCardTitle(S), fn: () => ctx.navigate(paxHash) }, ...(canEdit || !shared ? [{ label: t('doc_bs'), fn: () => ctx.navigate(docHash('bs')) }, { label: t('doc_fa'), fn: () => ctx.navigate(docHash('fa')) }] : [])] }];
  const ownerNote = foreign ? ` · ${t('readOnlyBriefing', { n: b.updatedBy || b.ownerId || '' })}` : '';
  setHeader({ title: `${b.no ? b.no + ' · ' : ''}${fmtDate(z, b.time.startMs, lang)} ${placeLabel(b.site)} · ${b.balloon.reg}`, sub: `${t('stand')}: ${b.updatedAt ? fmtDateTime(z, b.updatedAt, lang) : '–'}${b.status === 'final' ? ' · ' + t('released', { n: b.finalNo }) : ''}${locked ? ' · 🔒 ' + t('locked') : ''}${ownerNote}`, tools, menu });
  if (locked) view.appendChild(h('div.card.lockbar.no-print', h('div.card-body.row-actions', [h('span', [icon('lock', 16), ` ${lockTitle}`]), h('span.note.small', lockText), !shared && !foreign ? h('button.btn.small.primary', { type: 'button', onclick: lockDialog }, running ? t('amend') : t('locked_copy')) : null])));
  view.appendChild(brief);
  const attachments = [];   // [{ title, images }] → Beilagen am Schluss
  const sun = sunFor(b, S, ctx.racTable);
  const mp = massPerf(b, S);
  const sched = scheduleFor(b, sun);

  // Kopf: links Datum/Ort und Ballon; rechts Logo, darunter Titelzeile «Fahrtbriefing · Nr · Kennzeichen · Start: …», letzte Änderung, Status
  brief.appendChild(h('div.bh', [
    h('div.l', [
      h('h1', `${fmtDate(z, b.time.startMs, lang)} · ${placeLabel(b.site)}`),
      h('div.bline', `${b.balloon.label} · ${t('kind_' + b.flight.kind)} · LTF ${b.flight.operatorName}`),
    ]),
    h('div.r', h('img', { src: 'img/wicki-logo.png', alt: 'Wicki Partners Ballonteam' })),
    // Titelzeile und Metazeilen über die ganze Breite, rechtsbündig (bricht nicht um)
    h('div.tline', titleLine(b, lang, t('appName'))),
    h('div.meta', lastChangeLine(b, lang, t('lastChange'))),
    h('div.meta', `${b.status === 'final' ? t('released', { n: b.finalNo }) : b.progress == null ? t('status_inwork') : t('status_progress', { p: b.progress })} · v${b.edition ?? b.revision ?? 0} · PIC ${b.persons.pic}${locked ? ' · 🔒' : ''}`),
  ]));
  // Grafiken, Bilder und Tabellen: Klick öffnet eine vergrösserte Ansicht (nur am Bildschirm)
  brief.addEventListener('click', (e) => {
    if (e.target.closest('a, button, input, .leaflet-container, .bh, .no-lb')) return;
    const el = e.target.closest('svg, img.pimg, table.auto, table.inner, table.dwd');
    if (!el || !brief.contains(el)) return;
    const row = el.closest('tr'); const th = row?.querySelector(':scope > th');
    lightbox(el, th ? th.textContent.replace(/\s+/g, ' ').trim() : '');
  });

  const gn = goNoGo(b, S);
  const ch = b.status !== 'final' ? changesSinceFinal(b) : null;
  const changed = new Set((ch?.panels || []).map((p) => p.key));
  const lastV = (b.versions || []).slice(-1)[0];
  if (gn.level != null || b.assessment?.text || lastV?.pdfUrl) brief.appendChild(h('div.bsum', [
    gn.level != null ? h('div', [h('b', `${t('gn_title')}: `), h('span.tag.' + ['neg', 'half', 'pos'][gn.level], t('gn_' + gn.level)), gn.reasons.length ? ` – ${gn.reasons.join('; ')}` : '', h('span.mini', ` (${gn.model || ''}, ${t('gn_disclaimer')})`)]) : null,
    b.assessment?.text ? h('div', { style: { marginTop: '4px', whiteSpace: 'pre-wrap' } }, [h('b.ai-lbl', [`${t('ass_title')} (`, icon('ai', 12), ` ${t('ai')}, ${fmtDateTime(z, b.assessment.ts, lang)}): `]), b.assessment.text]) : null,
    lastV?.pdfUrl ? h('div.mini.no-print', [h('a', { href: lastV.pdfUrl, target: '_blank', rel: 'noopener' }, `Final v${lastV.no} PDF ↗`)]) : null,
  ]));
  const panels = visiblePanels(S, b);
  /** Zeile eines Panels (th: Nummer/Titel, td: Inhalt); bb = Hauptbriefing oder abgeleitete Sicht einer Etappe (0.12.5). */
  const WHOLE = new Set(['B.synoptic']), wholeP = (p) => setsV.length && WHOLE.has(p.key);   // 0.12.8: Allgemeine Lage gilt für die ganze Fahrt – vor E1
  const setsV = stageSets(b), pfx = (p, bb) => (setsV.length && !wholeP(p) && (bb !== b || p.section === 'B' || p.section === 'C') ? `E${bb !== b ? bb.stagePlan.no : 1}-` : '');   // 0.12.7: «E1-C3» mit mehreren Etappen
  function panelRow(p, bb, list, rowClass = '') {
      const d = bb.panels[p.key] || { content: {}, extra: {}, comment: '' };
      const cell = h('td');
      switch (p.kind) {
        case 'core': cell.appendChild(h('div.core-grid', [coreRows(), balloonImage(b, S) ? h('img.bimg.core-img', { src: balloonImage(b, S), alt: b.balloon.reg || '' }) : null])); break;
        case 'sun': cell.appendChild(h('div', [sunTables(b, ctx) || h('div.note', '–'), sun?.nightStart ? h('div.ns', `⚠ ${t('nightWarn', { t: hhmm(z, b.time.startMs), b: hhmm(z, sun.official.bcmt) })}`) : null, sun?.nightLanding ? h('div.ns', `⚠ ${t('nightLandWarn', { e: hhmm(z, sun.official.ecet) })}`) : null])); break;
        case 'massperf': cell.appendChild(massBlock()); break;
        case 'schedule': {
          if (b.schedule.skip) { cell.appendChild(h('div', t('sch_skipped'))); break; }
          // Zeit · Aktivität (Ort, Info) · Dauer · Ort mit Maps-Link, wo einer gesetzt ist
          const rowPlace = (r) => (r.type === 'arrive' ? b.site : r.type === 'landing' ? b.landing : r.place);
          const twl = twilightClass(sun);
          cell.appendChild(h('table.inner.sched-view', sched.rows.map((r) => { const pl = rowPlace(r); return h('tr', { class: twl(r.ms) }, [h('td', { style: { textAlign: 'left', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } }, hhmm(z, r.ms)), h('td', { style: { textAlign: 'left' } }, [scheduleRowLabel(r, b, t, S.activities?.custom), r.dur ? h('span.muted.small', ` · ${r.dur} min`) : null]), h('td', { style: { textAlign: 'left' } }, pl?.lat != null ? placeLine({ name: '', lat: pl.lat, lon: pl.lon }, { noElev: true }) : '')]); })));
          break;
        }
        case 'equipment': { const items = d.content.items || ['none']; cell.appendChild(h('div', S.equipmentItems.filter((it) => b.balloon?.type !== 'gas' || !['pressurisation', 'heli'].includes(it)).map((it) => h('span.chk', `${items.includes(it) ? '☑' : '☐'} ${t('eq_' + it)}`)))); break; }
        case 'transition': { const items = transitionItems(bb, S); cell.appendChild(h('div', S.transitionAltitudes.map((ta) => h('span.chk', `${items.includes(ta.id) ? '☑' : '☐'} ${ta.label}`)))); break; }
        case 'paxbriefing': cell.appendChild(h('div', [h('div', S.paxBriefingItems.map((it) => h('span.chk', `${(d.content.items || S.paxBriefingItems).includes(it) ? '☑' : '☐'} ${t('pb_' + it)}`))), b.balloon.type === 'gas' ? h('ul', { style: { margin: '4px 0', paddingLeft: '16px' } }, GAS_BRIEFING_EXTRA[lang].map((x) => h('li', x))) : null, h('div.mini', { style: { marginTop: '4px', whiteSpace: 'pre-wrap' } }, AMC1_BOP_BAS_115)])); break;
        case 'text': cell.appendChild(h('div', { style: { whiteSpace: 'pre-wrap' } }, textToNodes(d.content.text || (p.defaultText ? tt(p.defaultText) : '–')))); break;
        case 'profile': cell.appendChild(profileView(b, ctx)); break;
        case 'fpl': cell.appendChild(fplView(b, ctx)); if (d.content?.text) cell.appendChild(h('div', { style: { whiteSpace: 'pre-wrap', marginTop: '4px' } }, textToNodes(d.content.text))); break;
        case 'landing': cell.appendChild(h('div', [b.landing?.lat != null ? h('div', [placeLine(b.landing), b.site.lat != null ? h('span.mini', ` · ${distKm(b.site.lat, b.site.lon, b.landing.lat, b.landing.lon).toFixed(1)} km · ${Math.round(bearing(b.site.lat, b.site.lon, b.landing.lat, b.landing.lon)).toString().padStart(3, '0')}°`) : null]) : null, h('div', { style: { whiteSpace: 'pre-wrap' } }, textToNodes(d.content.text || (b.landing?.lat != null ? '' : '–')))])); break;
        case 'auto': {
          const snap = d.content?.auto;
          if (snap && ['dabs', 'synoptic'].includes(snap.kind) && (snap.images || []).length) {
            // Bilder als Beilage (eigene Seiten), im Panel nur der Verweis
            attachments.push({ title: `${bb.stagePlan ? `E${bb.stagePlan.no} · ` : ''}${tt(p)}`, images: snap.images, stand: standLine(snap, bb) });
            const viewer = renderSnapshot(snap, bb, ctx, { interactive: false, hidden: d.content?.hidden || [] }); viewer.classList.add('no-print');
            cell.appendChild(h('div', [h('div.mini.attref', t('att_ref', { n: attachments.length, p: snap.images.length })), viewer]));
            for (const x of (snap.data?.texts || []).filter((y) => !y.linkOnly)) cell.appendChild(h('div.print-only', [h('div.mini', [h('b', x.name), x.fetched ? ` · ${new Date(x.fetched).toISOString().slice(0, 16).replace('T', ' ')} UTC` : '']), h('pre.report.wx', { style: { whiteSpace: 'pre-wrap', fontSize: '10px', fontFamily: 'inherit' } }, x.text)]));
          } else if (snap) cell.appendChild(renderSnapshot(snap, bb, ctx, { interactive: false, hidden: d.content?.hidden || [] }));
          if (d.content?.text) cell.appendChild(isReport(d.content.text) ? renderReport(d.content.text) : h('div', { style: { whiteSpace: 'pre-wrap', marginTop: '4px' } }, textToNodes(d.content.text)));   // 0.12.15: Bericht gegliedert
          for (const im of d.content?.images || []) cell.appendChild(h('figure', { style: { margin: '4px 0' } }, [h('img.pimg', { src: im.url, alt: im.caption || '' }), im.caption ? h('figcaption.mini', im.caption) : null]));
          if (!d.content?.auto && !d.content?.text && !(d.content?.images || []).length) cell.appendChild(h('span.mini', '–'));
          break;
        }
        case 'paste': default: {
          if (d.content.text) cell.appendChild(isReport(d.content.text) ? renderReport(d.content.text) : h('div', { style: { whiteSpace: 'pre-wrap' } }, textToNodes(d.content.text)));   // 0.12.15
          for (const im of d.content.images || []) cell.appendChild(h('figure', { style: { margin: '4px 0' } }, [h('img.pimg', { src: im.url, alt: im.caption || '' }), im.caption ? h('figcaption.mini', im.caption) : null]));
          if (!d.content.text && !(d.content.images || []).length) cell.appendChild(h('span.mini', '–'));
        }
      }
      if (d.extra?.text || (d.extra?.images || []).length) {
        const ex = h('div.ex', [h('b', t('extra') + ': '), textToNodes(d.extra.text || '')]);
        for (const im of d.extra.images || []) ex.appendChild(h('figure', { style: { margin: '4px 0' } }, [h('img.pimg', { src: im.url, alt: im.caption || '' }), im.caption ? h('figcaption.mini', im.caption) : null]));
        cell.appendChild(ex);
      }
      if (d.ai?.text) cell.appendChild(h('div.aiN', [h('b.ai-lbl', [icon('ai', 12), ' ' + t('ai') + ': ']), d.ai.text]));
      if (d.comment) cell.appendChild(h('div.cm', [h('b', t('comment') + ': '), textToNodes(d.comment)]));
      return h('tr', { class: `row-${p.key.replace('.', '-')}${rowClass}` }, [h('th', [h('span.pno', panelNo(p, list, pfx(p, bb))), ' ', tt(p), p.kind === 'auto' ? (p.auto === 'radar' ? liveWarn(bb) : coverWarn(d.content?.auto, bb) || pasteWarn(d, bb)) : pasteWarn(d, bb), bb === b && changed.has(p.key) ? h('span.tag.half', { style: { marginLeft: '6px' } }, t('chg_tag', { n: ch.since.no })) : null, ]), cell]);   // 0.12.10: Warndreieck in der Titelzelle; 0.12.15: auch eingefügte Berichte (Gültigkeit)
  }
  for (const s of SECTIONS) {
    const ps = panels.filter((p) => p.section === s.id);
    if (ps.length) {
      // 0.12.7: mit Etappen-Briefings steht über B der Etappenkopf «E1 · Etappe 1 · ‹Start›» mit dem Bereich der Startetappe
      if (setsV.length && s.id === 'B' && ps.some(wholeP)) { brief.appendChild(h('div.bs', `B · ${t('sp_whole')}`)); const tw = h('table.bp'); for (const p of ps.filter(wholeP)) tw.appendChild(panelRow(p, b, panels)); brief.appendChild(tw); }
      if (setsV.length && s.id === 'B') { const sp1 = startPlanBriefing(b).stagePlan; brief.appendChild(h('div.bs.stage', `E1 · ${t('sp_title', { n: 1, name: b.profile?.stages?.[0]?.name || t('pf_stStart') })}`)); brief.appendChild(h('div.mini', sp1 ? t('sp_subStart1', { site: placeLabel(b.site), d: fmtDate(z, sp1.ms0, lang), t0: hhmm(z, sp1.ms0), t1: hhmm(z, sp1.ms1), tz: 'LT', k1: Math.round(sp1.km1), len: Math.round(sp1.lenKm), b: sp1.to.name }) : t('sp_subStart', { site: placeLabel(b.site), d: fmtDate(z, b.time.startMs, lang), t0: hhmm(z, b.time.startMs), t1: hhmm(z, b.time.startMs + (b.intent.durationMin || 0) * 60000), tz: 'LT' }))); }
      brief.appendChild(h('div.bs' + (setsV.length && (s.id === 'B' || s.id === 'C') ? '.sub' : ''), `${s.id} · ${s[lang] || s.de}`));
      if (s.id === 'B' && startPlanOff(b)) brief.appendChild(h('div.mini', t('sp_startOff')));
      const tbl = h('table.bp');
      for (const p of ps) if (!wholeP(p)) tbl.appendChild(panelRow(p, b, panels));
      brief.appendChild(tbl);
    }
    // Etappen-Briefings (0.12.5) zwischen C und D: je Etappe mit Planung ein Abschnitt mit Zeitfenster/Ort und den B/C-Panels
    if (s.id === 'C') for (const X of setsV) {
      const sp = X.bs.stagePlan, list = visiblePanels(S, X.bs);
      brief.appendChild(h('div.bs.stage', `E${X.no} · ${t('sp_title', { n: X.no, name: X.name || '–' })}`));
      brief.appendChild(h('div.mini', t('sp_sub', { d: fmtDate(z, sp.ms0, lang), t0: hhmm(z, sp.ms0), t1: hhmm(z, sp.ms1), tz: 'LT', k0: Math.round(sp.km0), k1: Math.round(sp.km1), len: Math.round(sp.lenKm), a: sp.from.name, b: sp.to.name, mid: sp.mid.name })));
      const tbl = h('table.bp');
      for (const p of list) tbl.appendChild(panelRow(p, X.bs, list, ` row-${X.sid}`));
      brief.appendChild(tbl);
    }
  }
  try {
    const pos = sessionStorage.getItem(posKey);
    if (sessionStorage.getItem(seenKey) && pos) setTimeout(() => { const [sid, key] = pos.includes('-') && /^st/.test(pos) ? [pos.slice(0, pos.indexOf('-')), pos.slice(pos.indexOf('-') + 1)] : [null, pos]; const sel = `.brief tr.row-${key.replace('.', '-')}${sid ? '.row-' + sid : ''}`; const tr = view.querySelector(sel); if (tr) tr.scrollIntoView({ block: 'start' }); }, 80);
    sessionStorage.setItem(seenKey, '1');
  } catch { /* ohne Speicher */ }
  // 0.14.0: Ist-Trajektorie aus analyze.wicki.aero – Eigner, Supermaster, Materialeigner; Links bis 3 Monate nach der Landung
  let traj = null;
  try { traj = await ctx.store.getTrajectory(b.id, shared); } catch (e) { console.warn('trajectory', e); }
  if (traj?.trajectory) { const nodes = actualSection(ctx, b, traj, { canDelete: !shared && (canEdit || ctx.isSuper), onDeleted: () => nodes.forEach((n) => n.remove()) }); for (const n of nodes) brief.appendChild(n); }
  brief.appendChild(h('div.bf', [h('span', `${APP.name} ${APP.version} · Wicki Aero GmbH · ${t('printDisclaimer')}`), h('span', `${b.site.icao} · ${b.site.tz}`)]));
  if (attachments.length) brief.appendChild(h('div.appendix', attachments.map((a, i) => h('div.att', [h('div.bs', `${t('att_title', { n: i + 1 })} · ${a.title}`), a.stand, ...a.images.map((im) => h('figure', { style: { margin: '4px 0' } }, [h('img.pimg.att', { src: im.url, alt: im.caption || '' }), im.caption ? h('figcaption.mini', im.caption) : null]))]))));

  function coreRows() {
    return h('div.kv', [
      [t('core_no'), b.no || '–'], [t('core_reg'), b.balloon.label], [t('core_countries'), countriesLine(b)], [t('core_date'), `${fmtDate(z, b.time.startMs, lang)}${b.flight.occasion ? ' · ' + b.flight.occasion : ''}`],
      [t('core_kind'), ['private', 'commercial', 'training', 'exam'].map((k) => `${b.flight.kind === k ? '☑' : '☐'} ${t('kind_' + k)}`).join('  ') + ` · LTF: ${b.flight.operatorName}`],
      [t('core_start'), `${hhmm(z, b.time.startMs)} LT (${hhmm('UTC', b.time.startMs)} UTC)`], [t('core_pic'), b.persons.pic], ...(hasCopilot(b) ? [[t('copilot'), b.persons.copilot]] : []),
      [t('core_pax'), paxLine(b, S, (i) => t('paxPlaceholder', { n: i + 1 }))], [t('core_retrieve'), b.persons.retrieve || '–'],
      [t('core_site'), placeLine(b.site)],
      [t('core_landing'), b.landing?.lat != null ? placeLine(b.landing) : '–'],
      [t('core_intent'), intentLine(b, t, z, { remark: true, lang })],
      ...(docsLine(b.balloon.docs) ? [[t('docs'), docsLine(b.balloon.docs)]] : []),
      ...(docsLine(ctx.stamm?.persons?.find((x) => x.id === b.persons.picId)?.docs) ? [[`${t('docs')} PIC`, docsLine(ctx.stamm.persons.find((x) => x.id === b.persons.picId).docs)]] : []),
    ].map(([k, v]) => [h('div.k', k), h('div.v', v)]));
  }
  function massBlock() {
    const w = b.weather, bal = b.balloon, r = mp.r;
    const src = w.source === 'model' ? t('mp_modelStand', { t: w.stand || '' }) : 'manuell';
    if (mp.type === 'hab') {
      return h('div.cols', [
        h('div.kv', [[t('mp_volume'), `${fmt(bal.volume)} m³`], [t('mp_siteAlt'), `${fmt(b.site.elev)} m · ${w.tempC} °C · QNH ${w.qnh} hPa${w.rh != null ? ' · RH ' + w.rh + ' %' : ''} (${src})`], [t('mp_envTemp'), `${w.envTempC ?? bal.envTempC} °C`], [t('mp_equip'), `${bal.masses.envelope} / ${bal.masses.burner} / ${bal.masses.basket} / ${bal.masses.equipment} kg = ${fmt(r.equipMass)} kg`], [t('mp_persons'), `${1 + (hasCopilot(b) ? 1 : 0) + b.persons.pax.length} · ${fmt(r.paxMass)} kg`], [t('mp_cyl'), (b.cylinders || bal.cylinders).filter((c) => c.count).map((c) => `${c.count}× ${c.name}`).join(', ') + ` = ${fmt(r.cylMass)} kg`], [t('mp_takeoff'), `${fmt(r.takeoff)} kg`], [t('mp_allowed'), `${fmt(r.allowed)} kg (${t(r.limitBy === 'mtom' ? 'mp_limitMtom' : 'mp_limitLift', { l: fmt(r.liftAtSite), m: fmt(r.mtom) })})`], [t('mp_delta'), h('span', { class: r.massDelta > 0 ? 'neg-val' : '' }, `${fmtSigned(-r.massDelta)} kg`)]].map(([k, v]) => [h('div.k', k), h('div.v', v)])),
        h('div.kv', [[t('mp_maxAlt'), `${r.maxAltExcel != null ? fmt(r.maxAltExcel) + ' m AMSL' : '> 10 000 m'} (${t('mp_required')} ${r.required.toFixed(3)} kg/m³)`], [t('mp_envReq'), r.envReq != null ? `${fmt(r.envReq)} °C · ${t('mp_envMargin', { t: w.envTempC ?? bal.envTempC })} ${fmtSigned(r.envMargin)} K` : '–'], [t('mp_usable'), `${fmt(r.usable)} kg`], [t('mp_burn'), `${fmt(r.burn)} kg/h`], [t('mp_endurance'), fmtDur(r.enduranceMin)], [t('mp_enduranceRes'), fmtDur(r.enduranceExcelReserve)], [t('mp_need', { d: fmtDur(b.intent.durationMin), r: `${Math.round(r.reserveMin)} min` }), `${fmt(r.needKg)} kg → ${t('mp_margin')} ${fmtSigned(r.fuelMargin)} kg`]].map(([k, v]) => [h('div.k', k), h('div.v', v)])),
      ]);
    }
    return h('div.cols', [
      h('div.kv', [[t('mp_volume'), `${fmt(bal.volume)} m³ · ${t('gb_fillPct')} ${Math.round(fillFractionOf(b) * 100)} % · ${bal.gas} ${Math.round((bal.purity ?? 1) * 1000) / 10} %`], [t('mp_siteAlt'), `${fmt(b.site.elev)} m · ${w.tempC} °C · QNH ${w.qnh} hPa${w.rh != null ? ' · RH ' + w.rh + ' %' : ''} (${src})`], [t('gb_rhoAir'), `${r.rhoAir.toFixed(4)} kg/m³`], [t('gb_rhoGas'), `${r.rhoGas.toFixed(4)} kg/m³ · ${fmt(r.gasMass)} kg`], [t('gb_net'), `${fmt(r.net)} kg`]].map(([k, v]) => [h('div.k', k), h('div.v', v)])),
      h('div.kv', [[t('gb_gross'), `${fmt(r.grossLift)} kg`], [t('gb_ballast'), h('b', `${fmt(r.ballast)} kg · ${fmt(r.ballastPct, 1)} %`)], [t('gb_units'), r.units != null ? `${fmt(r.units, 1)} × ${bal.ballastUnitKg} kg` : '–'], [t('gb_reserve'), `${fmt(r.reserveKg)} kg`], [t('gb_cooling'), `${fmt(r.coolingLossPerK, 1)} kg/K`], [t('gb_per100'), `${fmt(r.ballastPer100m, 1)} kg`]].map(([k, v]) => [h('div.k', k), h('div.v', v)])),
    ]);
  }
  applyParts(parts);
  if (opts.print || /print=1/.test(location.hash)) setTimeout(() => window.print(), 400);
}
