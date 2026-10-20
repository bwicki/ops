/* Fahrtbriefing — Übersicht der Briefings. */
import { h, clear, toast, dialog, confirmDialog } from '../util.js';
import { t } from '../i18n.js';
import { setHeader } from '../app.js';
import { fmtDate, hhmm, fmtDateTime } from '../calc/time.js';
import { phaseOf, duplicateBriefing, sunFor, LOCK_AFTER_START_MS, archiveMs, nextAmendmentNo } from '../model.js';
import { racFmt, racLookup } from '../calc/rac.js';
import { isoDate } from '../calc/time.js';
import { tag } from './widgets.js';
import { icon, iconSvg } from './icons.js';

export async function renderList(view, ctx) {
  setHeader({ title: t('briefings'), tools: [] });   // «+ Neues Briefing» steht als gefüllter Knopf in der Hauptnavigation
  // Sichten: eigene · alle Benutzer (Super) · Fahrten mit meinem Material (Ballon freigegeben)
  const remote = ctx.store.mode === 'remote';
  const scopes = ['own'];
  if (remote && ctx.isSuper) scopes.push('all');
  if (remote && (ctx.given || []).some((g) => g.categories?.includes('balloons'))) scopes.push('material');
  const want = (location.hash.split('?')[1] || '').replace(/^scope=/, '');
  let scope = scopes.includes(want) ? want : 'own';
  let all = await ctx.store.listBriefings(scope);
  // 0.12.12: Supermaster kann ausgeblendete Archiv-Einträge einblenden (Umschalter im Archiv) und wieder sichtbar machen
  const superRemote = remote && !!ctx.isSuper;
  let showHidden = false, hiddenRows = null;
  const foreign = (b) => ctx.user && b.owner && b.owner !== ctx.user.id;
  const openHash = (b) => (foreign(b) ? `#/v/${b.id}` : `#/b/${b.id}`);
  let q = '';
  const now = Date.now();
  // Sortierung: Standard Ordnungsnummer absteigend (jüngste zuoberst); Klick auf die Spaltenköpfe wechselt
  let sortKey = 'no', sortDir = -1;
  const sortVal = (b, k) => k === 'no' ? (b.no || '') : k === 'date' ? (b.startMs || 0) : k === 'site' ? (b.site || '').toLowerCase() : k === 'reg' ? (b.reg || b.balloon || '') : k === 'kind' ? t('kind_' + (b.kind || 'commercial')) : k === 'status' ? (b.status === 'final' ? 100 + (b.finalNo || 0) : (b.progress ?? -1)) : k === 'change' ? (b.updatedAt || 0) : k === 'owner' ? (b.ownerName || b.owner || '') : '';
  const sorted = (list) => [...list].sort((a, c) => { const x = sortVal(a, sortKey), y = sortVal(c, sortKey); const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'de', { numeric: true }); return (r || (a.startMs || 0) - (c.startMs || 0)) * sortDir; });
  const setSort = (k) => { if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === 'no' || k === 'date' || k === 'change' ? -1 : 1; } drawTable(); };
  const th = (k, label) => h('th.sortable', { onclick: () => setSort(k), title: label }, [label, sortKey === k ? h('span.sarrow', icon(sortDir > 0 ? 'up' : 'down', 12)) : null]);

  const body = h('div');
  const side = h('div');
  view.appendChild(h('div.layout-2', [body, side]));

  // 0.12.9/0.12.10: drei Abschnitte statt Filter – «Briefings in Arbeit» (bis Start + 1 h), «Laufende Fahrten» (gesperrt; Nachtrag möglich)
  // und «Archiv» (Fahrt vorbei oder Archivkopie: unbeschränkt, unveränderlich, nicht löschbar; Kopie als Vorlage möglich)
  function rows(group) {
    return sorted(all.filter((b) => {
      if (groupOf(b) !== group) return false;
      if (q) { const s = `${b.no || ''} ${b.site || ''} ${b.reg || ''} ${b.balloon || ''} ${b.ownerName || ''} ${fmtDate(b.tz || 'Europe/Zurich', b.startMs || 0)}`.toLowerCase(); if (!s.includes(q.toLowerCase())) return false; }
      return true;
    }));
  }
  function draw() {
    clear(body);
    const search = h('input', { type: 'search', placeholder: t('search'), value: q, oninput: (e) => { q = e.target.value; drawTable(); } });
    body.appendChild(h('div.list-head', [h('h2', t('briefings'))]));
    if (scopes.length > 1) body.appendChild(h('div.chips.scopes', scopes.map((sc) => h('button.chip', { type: 'button', 'aria-pressed': scope === sc, onclick: async () => { scope = sc; all = await ctx.store.listBriefings(scope); draw(); } }, t('scope_' + sc)))));
    body.appendChild(h('div', { style: { marginBottom: '10px' } }, search));
    body.appendChild(tableWrap);
    drawTable();
  }
  const tableWrap = h('div');
  function drawTable() {
    clear(tableWrap);
    const work = rows('work'), run = rows('running'), arch = rows('archive');
    if (!work.length && !run.length && !arch.length) { tableWrap.appendChild(h('div.note', t('noBriefings'))); return; }
    tableWrap.appendChild(h('h3.list-sect', `${t('listWork')} (${work.length})`));
    if (work.length) tableWrap.appendChild(groupTable(work, 'work')); else tableWrap.appendChild(h('div.note', t('noBriefings')));
    if (run.length) {   // 0.12.10: nur zeigen, wenn eine Fahrt läuft
      tableWrap.appendChild(h('h3.list-sect.running', `${t('listRunning')} (${run.length})`));
      tableWrap.appendChild(h('div.note.small', t('listRunningHint')));
      tableWrap.appendChild(groupTable(run, 'running'));
    }
    tableWrap.appendChild(h('h3.list-sect.archive', [`${t('listArchive')} (${arch.length})`,
      superRemote ? h('button.btn.small.hidden-toggle', { type: 'button', 'aria-pressed': showHidden, onclick: toggleHidden }, showHidden ? t('hide_hidden') : t('show_hidden')) : null]));
    tableWrap.appendChild(h('div.note.small', t('listArchiveHint')));
    if (arch.length) tableWrap.appendChild(groupTable(arch, 'archive'));
    if (showHidden && hiddenRows) {
      const hid = sorted(hiddenRows.filter((b) => !q || `${b.no || ''} ${b.site || ''} ${b.reg || ''} ${b.ownerName || ''}`.toLowerCase().includes(q.toLowerCase())));
      tableWrap.appendChild(h('h3.list-sect.archive.hidden-sect', `${t('hidden_tag')} (${hid.length})`));
      if (hid.length) tableWrap.appendChild(groupTable(hid, 'hidden')); else tableWrap.appendChild(h('div.note', t('noBriefings')));
    }
  }
  async function toggleHidden() {
    showHidden = !showHidden;
    if (showHidden && !hiddenRows) { try { hiddenRows = await ctx.store.listHidden(); } catch (e) { console.error(e); hiddenRows = []; } }
    drawTable();
  }
  async function unhide(id) {
    if (!(await dialog(t('unhide_super'), h('p', t('unhide_superQ')), [{ label: t('cancel'), value: false }, { label: t('unhide_superDo'), value: true, primary: true }]))) return;
    try { await ctx.store.unhideBriefing(id); } catch (e) { toast(t('error')); console.error(e); return; }
    const i = (hiddenRows || []).findIndex((b) => b.id === id); if (i >= 0) { const [b] = hiddenRows.splice(i, 1); b.hidden = false; all.push(b); }
    drawTable(); toast(t('ok'));
  }
  function groupTable(rs, group) {
    const archive = group === 'archive', running = group === 'running', hiddenG = group === 'hidden';
    const narrow = window.innerWidth < 700;
    if (narrow) {
      return h('div.cards-list', rs.map((b) => h('div.bcard', { onclick: () => ctx.navigate(openHash(b)) }, [
        h('div.t', `${b.no ? b.no + ' · ' : ''}${fmtDate(b.tz || 'Europe/Zurich', b.startMs || 0)} · ${hhmm(b.tz || 'Europe/Zurich', b.startMs || 0)} LT · ${b.reg || ''}`),
        h('div', `${b.site || '–'}${scope !== 'own' ? ` · ${b.ownerName || b.owner || ''}` : ''}`),
        h('div.m', [locked(b) ? icon('lock', 13) : null, ' ', phaseTag(b), ' ', b.trajectoryAt ? h('span.tag.traj', t('tag_traj')) : null, ' ', statusText(b)]),
      ])));
    }
    const showOwner = scope !== 'own';
    const tz = (b) => b.tz || 'Europe/Zurich';
    // 0.12.10: feste Spaltenbreiten (colgroup) – die drei Abschnitte sind damit sauber untereinander ausgerichtet
    const cols = showOwner ? [10, 10, 13, 11, 8, 8, 12, 14, 14] : [10, 11, 17, 9, 9, 13, 16, 15];
    const tbl = h('table.tbl.list.fixed', [h('colgroup', cols.map((w) => h('col', { style: { width: w + '%' } }))), h('thead', h('tr', [th('no', '#'), th('date', t('colDate')), th('site', t('colSite')), showOwner ? th('owner', t('colOwner')) : null, th('reg', t('colBalloon')), th('kind', t('colType')), th('status', t('colStatus')), th('change', t('colChange')), h('th', '')].filter(Boolean))),
      h('tbody', rs.map((b) => h('tr', { class: (locked(b) ? 'locked' : '') + (hiddenG ? ' hidden-row' : ''), title: t('view_brief'), ondblclick: (e) => { if (!e.target.closest('button')) ctx.navigate(`#/v/${b.id}`); } }, [
        h('td.mono.no', [b.no || '–', locked(b) ? h('span.lock', { title: t('locked') }, [' ', icon('lock', 14)]) : null]),
        h('td', [h('div.l1', fmtDate(tz(b), b.startMs || 0)), h('div.l2', `${hhmm(tz(b), b.startMs || 0)} LT`)]),
        h('td', [h('div.l1', b.site || '–'), h('div.l2', `${b.icao || ''}${b.elev != null ? ' · ' + Math.round(b.elev) + '\u00a0m' : ''}`)]),
        showOwner ? h('td', [h('div.l1', b.ownerName || b.owner || '–'), b.materialOwner && b.materialOwner !== b.owner ? h('div.l2', `${t('colMaterial')}: ${b.materialOwner}`) : null]) : null,
        h('td.nowrap', b.reg || b.balloon || '–'),
        h('td.nowrap', t('kind_' + (b.kind || 'commercial'))),
        h('td', [h('div.l1', statusTag(b)), h('div.l2', [phaseTag(b), b.trajectoryAt ? h('span.tag.traj', { title: `${t('colTraj')} · ${fmtDateTime(tz(b), b.trajectoryAt)}` }, t('tag_traj')) : null])]),   // 0.14.0: Ist-Trajektorie vorhanden
        h('td', [h('div.l1', `v${b.edition ?? b.revision ?? 0} · ${b.updatedAt ? fmtDateTime(tz(b), b.updatedAt) : '–'}`), h('div.l2', [b.updatedBy || '', b.links ? h('span', { title: t('colLinks') }, [' · ', icon('link', 13), ` ${b.links}`]) : null])]),
        h('td.row-actions.acts', hiddenG ? [
          h('button.btn.icon.small', { type: 'button', title: t('view_brief'), onclick: () => ctx.navigate(`#/v/${b.id}`) }, icon('view')),
          h('button.btn.icon.small.unhide', { type: 'button', title: t('unhide_super'), onclick: () => unhide(b.id) }, icon('restore')),
        ] : foreign(b) ? [h('button.btn.icon.small', { type: 'button', title: t('view_brief'), onclick: () => ctx.navigate(openHash(b)) }, icon('view'))] : [
          locked(b) ? h('button.btn.icon.small', { type: 'button', title: t('view_brief'), onclick: () => ctx.navigate(`#/v/${b.id}`) }, icon('view')) : h('button.btn.icon.small.edit', { type: 'button', title: t('edit'), onclick: () => ctx.navigate(`#/b/${b.id}`) }, icon('edit')),
          running ? h('button.btn.icon.small.amend', { type: 'button', title: t('amend'), onclick: () => amend(b) }, icon('edit')) : null,   // 0.12.10: Nachtrag während der laufenden Fahrt
          h('button.btn.icon.small', { type: 'button', title: t('duplicate'), onclick: () => dup(b.id) }, icon('dup')),
          archive ? (ctx.isSuper && ctx.store.mode === 'remote' ? h('button.btn.icon.small', { type: 'button', title: t('hide_super'), onclick: () => delB(b.id, true) }, icon('del')) : null) : h('button.btn.icon.small', { type: 'button', title: t('delete'), onclick: () => delB(b.id) }, icon('del')),   // 0.12.10a: Archiv – nur der Supermaster blendet aus (nichts wird gelöscht)
        ].filter(Boolean)),
      ].filter(Boolean))))]);
    return tbl;
  }
  // 0.12.10: Sperre ab Start + 1 h; Archiv ab Fahrtende (endMs: Start + max(6 h, Dauer + 2 h)) oder bei eingefrorener Archivkopie
  const archived = (b) => !!b.frozen || now > (b.endMs || archiveMs({ time: { startMs: b.startMs || 0 }, intent: {} }));
  const locked = (b) => archived(b) || now > (b.startMs || 0) + LOCK_AFTER_START_MS;
  const groupOf = (b) => (archived(b) ? 'archive' : locked(b) ? 'running' : 'work');
  /** Nachtrag: Rückfrage, dann Archivkopie (bisherige Nummer) + Nummer mit Buchstabe; danach Erarbeitung öffnen. */
  async function amend(b) {
    const newNo = nextAmendmentNo(b.no || '');
    const ok = await confirmDialog(t('amend_title'), t('amend_q', { t: `${fmtDate(b.tz || 'Europe/Zurich', b.startMs || 0)} ${hhmm(b.tz || 'Europe/Zurich', b.startMs || 0)}`, no: b.no || '–', newNo }), { yes: t('amend_yes'), no: t('cancel') });
    if (!ok) return;
    try {
      const r = await ctx.store.amendBriefing(b.id, ctx.who);
      try { sessionStorage.setItem('fb.amend.' + b.id, '1'); } catch { /* ohne Sitzungsspeicher */ }
      toast(`${r.no} ✓`); ctx.navigate(`#/b/${b.id}`);
    } catch (e) { toast(t('amend_fail')); console.error(e); }
  }
  /** Phase der Fahrt (Vorplanung/Planung/Final/vergangen) als kleines Etikett. */
  function phaseTag(b) {
    const ph = phaseOf(b.startMs || 0, now);
    const cls = ph === 'plan' ? 'plan' : ph === 'final' ? 'final-phase' : 'pre';
    return tag(cls, t('phase_' + ph));
  }
  /** Status: «Final v2» oder «in Arbeit 75 %» (Fortschritt = gefüllte Panels). */
  function statusTag(b) {
    return b.status === 'final' ? tag('final', t('released', { n: b.finalNo })) : tag('', b.progress == null ? t('status_inwork') : t('status_progress', { p: b.progress }));
  }
  function statusText(b) {
    const st = b.status === 'final' ? t('released', { n: b.finalNo }) : b.progress == null ? t('status_inwork') : t('status_progress', { p: b.progress });
    return `${st} · v${b.edition ?? b.revision ?? 0} · ${b.updatedAt ? fmtDateTime(b.tz || 'Europe/Zurich', b.updatedAt) : ''}${b.updatedBy ? ' · ' + b.updatedBy : ''}`;
  }
  async function dup(id) {
    const src = await ctx.store.getBriefing(id);
    const b = duplicateBriefing(src, ctx.settings);
    await ctx.store.saveBriefing(b, ctx.who);
    ctx.navigate(`#/new/${b.id}`);
  }
  async function delB(id, hide = false) {
    if (!(await dialog(hide ? t('hide_super') : t('delete'), h('p', hide ? t('hide_superQ') : t('confirmDelete')), [{ label: t('cancel'), value: false }, { label: hide ? t('hide_superDo') : t('delete'), value: true, primary: true }]))) return;
    await ctx.store.deleteBriefing(id);
    const i = all.findIndex((b) => b.id === id); if (i >= 0) { const [b] = all.splice(i, 1); if (hide && hiddenRows) { b.hidden = true; hiddenRows.push(b); } }
    drawTable(); toast(t('ok'));
  }

  // rechte Spalte: nächste Fahrt, Stammdaten
  const upcoming = all.filter((b) => !foreign(b) && (b.startMs || 0) > now - 6 * 3600000).sort((a, b) => a.startMs - b.startMs)[0];
  const sideCards = [];
  if (upcoming) {
    const full = await ctx.store.getBriefing(upcoming.id);
    const sun = full ? sunFor(full, ctx.settings, ctx.racTable) : null;
    const tz = upcoming.tz || 'Europe/Zurich';
    sideCards.push(h('div.card', [h('div.card-head', h('div.section-title', t('nextFlight'))), h('div.card-body', [
      h('div.note', { style: { fontWeight: 600 } }, `${fmtDate(tz, upcoming.startMs)} ${hhmm(tz, upcoming.startMs)} LT · ${upcoming.reg || ''}`),   // 0.12.8: gleiche Grösse wie die zweite Zeile, nur fett
      h('div.note', upcoming.site || ''),
      sun ? h('div.note', `BCMT ${hhmm(tz, sun.official.bcmt)} · SR ${hhmm(tz, sun.official.sr)} · SS ${hhmm(tz, sun.official.ss)} · ECET ${hhmm(tz, sun.official.ecet)}`) : null,
      h('div', { style: { marginTop: '8px' } }, h('button.btn', { type: 'button', onclick: () => ctx.navigate(`#/b/${upcoming.id}`) }, t('open'))),
    ])]));
  }
  // 0.12.8: ohne Rekapitulation der Stammdaten – nur noch der Knopf «Einstellungen»
  sideCards.push(h('div.card', [h('div.card-head', h('div.section-title', t('masterData'))), h('div.card-body', [
    h('div', h('button.btn', { type: 'button', onclick: () => ctx.navigate('#/settings') }, t('nav_settings'))),
  ])]));
  side.append(...sideCards);
  draw();
}
