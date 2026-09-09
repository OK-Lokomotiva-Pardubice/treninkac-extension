'use strict';

const API     = 'https://treninkac-api.orientacnisporty.cz/api';
const TEAM_ID = 117;

const state = {
  token:    null,
  athletes: [],
  selected: null,
  cache:    {},
  expCyc:   {},   // userId → Set<cycleNum>
  expWk:    {}    // userId → Set<"cycleNum-weekNum">
};

/* ── Sport name mapping ─────────────────────────────────────── */
const SPORT = {
  run: 'Běh', road_run: 'Běh/silnice', trail_run: 'Trail', track_run: 'Atletika',
  ski: 'Lyže', cross_country_ski: 'Běžky', nordic_ski: 'Běžky', skate_ski: 'Běžky/bruslení',
  bike: 'Kolo', cycling: 'Kolo', road_cycling: 'Silniční kolo', mountain_bike: 'MTB', mtb: 'MTB',
  swim: 'Plavání', walk: 'Chůze', hike: 'Turistika',
  strength: 'Posilování', gym: 'Posilování', fitness: 'Fitness',
  orienteering: 'OB', ob: 'OB',
  other: 'Jiné'
};

function sportName(sport) {
  if (!sport) return null;
  const key = sport.toLowerCase();
  return SPORT[key] || sport;
}

/* ── Training-year calendar ────────────────────────────────────────
   Cycles are driven by the calendar, never by the athlete's activities:
   the training year starts on SEASON_START (a Monday), every cycle spans
   exactly 4 consecutive weeks, and after 13 cycles (= 52 weeks) a new
   training year begins again at C1. */
const SEASON_START    = '2025-10-27';
const SEASON_END      = '2026-10-25';
const WEEKS_PER_CYCLE = 4;
const CYCLES_PER_YEAR = 13;
const DAY_MS          = 86400000;
const WEEK_MS         = 7 * DAY_MS;
const SEASON_START_TS = Date.parse(SEASON_START + 'T00:00:00Z');

/* Absolute week index (0-based) of a YYYY-MM-DD date since SEASON_START */
function weekIndexOf(dateStr) {
  const ts = Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10));
  return Math.floor((ts - SEASON_START_TS) / WEEK_MS);
}

/* Monday (UTC Date) of an absolute week index */
function weekMonday(wi) {
  return new Date(SEASON_START_TS + wi * WEEK_MS);
}

const SEASON_WEEKS = weekIndexOf(SEASON_END) + 1;   // 52

/* ISO week number + ISO year of a UTC timestamp */
function isoWeekOfTs(ts) {
  const dow  = (new Date(ts)).getUTCDay() || 7;
  const thu  = ts + (4 - dow) * DAY_MS;             // Thursday of that week
  const year = (new Date(thu)).getUTCFullYear();
  return { year, week: Math.floor((thu - Date.UTC(year, 0, 1)) / DAY_MS / 7) + 1 };
}

function fmtDateObj(d) {
  if (!d || isNaN(d.getTime())) return '?';
  return `${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth()+1).padStart(2,'0')}.${d.getUTCFullYear()}`;
}

function isRunSport(sport) {
  if (!sport) return false;
  const k = sport.toLowerCase();
  return k.includes('run') || k === 'orienteering' || k === 'ob' || k === 'trail';
}

/* ── Utilities ─────────────────────────────────────────────── */

function fmtTime(sec) {
  if (!sec) return null;
  return Math.floor(sec / 3600) + ':' + String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
}

function fmtKm(m) {
  if (!m) return null;
  return (m / 1000).toFixed(1);
}

const DAYS_CZ = ['Ne', 'Po', 'Út', 'St', 'Čt', 'Pá', 'So'];
function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return `${DAYS_CZ[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}.`;
}

function td(val, cls) {
  return (val || 0) === 0
    ? `<td class="num dim">—</td>`
    : `<td class="num ${cls}">${val}</td>`;
}
function tdKm(dist) {
  return !dist ? `<td class="num dim">—</td>` : `<td class="num c-beh">${(dist/1000).toFixed(1)}</td>`;
}
function tdTime(sec) {
  const t = fmtTime(sec);
  return !t ? `<td class="num dim">—</td>` : `<td class="num c-zat">${t}</td>`;
}

async function apiFetch(path) {
  const r = await fetch(API + path, { headers: { 'Authorization': 'Bearer ' + state.token } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/* ── Data processing ───────────────────────────────────────── */

function buildCache(detailRaw, logRaw) {
  const d    = detailRaw.results.data;
  const wo   = d.weekOverview       || {};
  const sbw  = d.sumByWeeks         || {};
  const sick = d.sickDaysInCycles   || [];

  // Normalise entries: accept both startDate and date fields
  const allLogEntries = Object.values(logRaw.results?.data || {}).map(e => ({
    ...e,
    _date: (e.startDate || e.date || '').slice(0, 10)
  })).filter(e => e._date);

  // Restrict to the training year to avoid historical data from other seasons
  const logEntries = allLogEntries.filter(
    e => e._date >= SEASON_START && e._date <= SEASON_END
  );

  /* ── Plan data, re-keyed by ISO week ─────────────────────
     The API groups plan weeks into cycles of its own, and that grouping
     drifts per athlete whenever weeks are missing. Cycles here come from
     the calendar instead, so the API's cycle numbers are dropped and only
     the ISO week number of each plan row is kept. */
  const planWeek = {};                      // isoWeek → weekOverview row
  for (const rows of Object.values(wo))
    for (const r of rows) planWeek[r.week] = r;

  const planSport = {};                     // isoWeek → sumByWeeks rows
  for (const rows of Object.values(sbw))
    for (const r of rows) (planSport[r.week] = planSport[r.week] || []).push(r);

  const planSick = {};                      // isoWeek → sick days
  for (const c of sick)
    for (const w of (c.weeks || []))
      planSick[w.week] = (planSick[w.week] || 0) + (w.sickdays || 0);

  /* ── Season calendar ─────────────────────────────────────
     Week `wi` is the (wi+1)-th week of the training year; its ISO week
     number is only a label (and the key the plan API uses). */
  const weekMeta    = [];                   // wi → { week, isoYear, mon, sun }
  const wiOfIsoWeek = {};                   // isoWeek → wi
  for (let wi = 0; wi < SEASON_WEEKS; wi++) {
    const monTs = SEASON_START_TS + wi * WEEK_MS;
    const { year, week } = isoWeekOfTs(monTs);
    weekMeta[wi]       = { week, isoYear: year, mon: new Date(monTs), sun: new Date(monTs + 6 * DAY_MS) };
    wiOfIsoWeek[week]  = wi;
  }

  /* ── Group training-log activities by week ──────────────── */
  const actsByWi = {};                      // wi → [activity]

  for (const e of logEntries) {
    const wi    = weekIndexOf(e._date);
    const nezp  = e.time === null && e.movingTime != null;
    const sport = e.sport || e.kind || null;
    (actsByWi[wi] = actsByWi[wi] || []).push({
      id:      e.activityId,
      name:    e.name || '(bez názvu)',
      sport,
      date:    e._date,
      sortKey: e.startDate || e.date || e._date,
      note:    e.note || e.description || e.comment || null,
      nezp,
      isRace:  !!(e.isRace || e.race || e.raceCount),
      isSick:  !!(e.isSick || e.sick || e.sickDay),
      dist:    e.distance || e.movingDistance || 0,
      movTime: e.movingTime || 0
    });
  }

  for (const wi of Object.keys(actsByWi))
    actsByWi[wi].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const nezp = logEntries.filter(e => e.time === null && e.movingTime != null).length;

  /* ── Cycles that carry any data (plan rows or activities) ── */
  const activeCycles = new Set();
  for (const isoWeek of Object.keys(planWeek)) {
    const wi = wiOfIsoWeek[isoWeek];
    if (wi != null) activeCycles.add(Math.floor(wi / WEEKS_PER_CYCLE));
  }
  for (const wi of Object.keys(actsByWi))
    activeCycles.add(Math.floor(Number(wi) / WEEKS_PER_CYCLE));

  /* ── Build cycleData ─────────────────────────────────────
     Every cycle spans its full 4 calendar weeks, whether or not the
     athlete has a plan or any activity in them. */
  const activsByWeek = {};                  // `${cycleNum}-${isoWeek}` → [activity]

  const cycleData = [...activeCycles].sort((a, b) => a - b).map(ci => {
    const num = (ci % CYCLES_PER_YEAR) + 1;
    const weeks = [];

    for (let k = 0; k < WEEKS_PER_CYCLE; k++) {
      const meta = weekMeta[ci * WEEKS_PER_CYCLE + k];
      if (!meta) break;                     // past the end of the training year
      const acts  = actsByWi[ci * WEEKS_PER_CYCLE + k] || [];
      const nezpA = acts.filter(a => a.nezp);
      activsByWeek[`${num}-${meta.week}`] = acts;

      // A planned week already counts its processed activities in the plan
      // stats, so only nezp ones are added. An unplanned week has no plan
      // stats at all, so every activity in it counts.
      const pw      = planWeek[meta.week];
      const planned = pw != null;
      const ps      = planSport[meta.week] || [];
      const add     = planned ? nezpA : acts;

      weeks.push({
        week:    meta.week,
        isoYear: meta.isoYear,
        mon:     meta.mon,
        sun:     meta.sun,
        hasNezp: nezpA.length > 0,
        DZ:      (planned ? (pw.day_load       || 0) : 0) + new Set(add.map(a => a.date)).size,
        FA:      (planned ? (pw.activity_count || 0) : 0) + add.length,
        ZA:      (planned ? (pw.raceCount      || 0) : 0) + add.filter(a => a.isRace).length,
        NE:      (planned ? (planSick[meta.week] || 0) : 0) + add.filter(a => a.isSick).length,
        runDist: (planned ? ps.filter(e => e.kind === 'run').reduce((s, e) => s + (e.distance || 0), 0) : 0)
                 + add.reduce((s, a) => s + a.dist, 0),
        zatSec:  (planned ? ps.reduce((s, e) => s + (e.time || 0), 0) : 0)
                 + add.reduce((s, a) => s + a.movTime, 0)
      });
    }

    const mon = weekMonday(ci * WEEKS_PER_CYCLE);
    return {
      num,
      mon,
      sun:     new Date(mon.getTime() + (WEEKS_PER_CYCLE * 7 - 1) * DAY_MS),
      hasNezp: weeks.some(w => w.hasNezp),
      DZ:      weeks.reduce((s, w) => s + w.DZ, 0),
      FA:      weeks.reduce((s, w) => s + w.FA, 0),
      ZA:      weeks.reduce((s, w) => s + w.ZA, 0),
      NE:      weeks.reduce((s, w) => s + w.NE, 0),
      runDist: weeks.reduce((s, w) => s + w.runDist, 0),
      zatSec:  weeks.reduce((s, w) => s + w.zatSec, 0),
      weeks
    };
  });

  return { cycleData, nezp, activsByWeek };
}

/* ── Rendering ─────────────────────────────────────────────── */

function renderSidebar() {
  const el = document.getElementById('ath-list');
  el.innerHTML = state.athletes.map(a => {
    const inits  = (a.firstname[0] + a.lastname[0]).toUpperCase();
    const cached = state.cache[a.userId];
    const nezp   = cached?.nezp;
    const badge  = nezp == null
      ? `<span class="nezp-badge loading">…</span>`
      : nezp === 0
        ? `<span class="nezp-badge zero">0</span>`
        : `<span class="nezp-badge">${nezp}</span>`;
    const active = state.selected === a.userId ? 'active' : '';
    return `
      <div class="ath-item ${active}" data-id="${a.userId}">
        <div class="ath-avatar">${inits}</div>
        <div class="ath-name">${a.lastname} ${a.firstname}</div>
        ${badge}
      </div>`;
  }).join('');
  el.querySelectorAll('.ath-item').forEach(row =>
    row.addEventListener('click', () => selectAthlete(+row.dataset.id))
  );
}

async function selectAthlete(uid) {
  state.selected = uid;
  document.getElementById('nav-totals')?.classList.remove('active');
  if (!state.expCyc[uid]) state.expCyc[uid] = new Set();
  if (!state.expWk[uid])  state.expWk[uid]  = new Set();
  renderSidebar();
  setMain(`<div class="state-box"><div class="spinner"></div><div>Načítám…</div></div>`);
  try {
    if (!state.cache[uid]?.cycleData) {
      const [detailRaw, logRaw] = await Promise.all([
        apiFetch(`/team/detail/${TEAM_ID}/athlete/${uid}`),
        apiFetch(`/team/detail/${TEAM_ID}/athlete/${uid}/training-log`)
      ]);
      state.cache[uid] = buildCache(detailRaw, logRaw);
    }
    renderMain(uid);
    renderSidebar();
  } catch (e) {
    setMain(`<div class="state-box"><div class="err-txt">Chyba: ${e.message}</div></div>`);
  }
}

function setMain(html) {
  document.getElementById('main').innerHTML = html;
}

function buildActRows(acts, isOpen) {
  let prevDate = null;
  return acts.map(act => {
    const isFirstOfDay = act.date !== prevDate;
    prevDate = act.date;
    const isNezp   = act.nezp;
    const sName    = isNezp ? 'nezpracov&#225;no' : (sportName(act.sport) || 'Neza&#345;azeno');
    const tagCls   = 'sport-tag' + (isNezp ? ' nezp' : '');
    const noteHtml = act.note ? `<span class="ar-note">${act.note}</span>` : '';
    const kmHtml = act.dist
      ? `<td class="num ar-beh">${(act.dist / 1000).toFixed(1)}</td>`
      : `<td class="num ar-beh dim">&#8212;</td>`;
    const ztHtml = act.movTime
      ? `<td class="num ar-zat">${fmtTime(act.movTime)}</td>`
      : `<td class="num ar-zat dim">&#8212;</td>`;
    const zaHtml = act.isRace
      ? `<td class="num c-za">1</td>`
      : `<td class="num dim">&#8212;</td>`;
    const neHtml = act.isSick
      ? `<td class="num c-ne">1</td>`
      : `<td class="num dim">&#8212;</td>`;
    return `
      <tr class="ar ${isOpen ? 'show' : ''} ${isFirstOfDay ? 'day-start' : ''}">
        <td class="ar-date-cell">${fmtDate(act.date)}</td>
        <td colspan="3" class="ar-detail-cell">
          <a class="ar-name" href="https://treninkac.orientacnisporty.cz/activities/training/detail/${act.id}" target="_blank" rel="noopener">${act.name}</a>
          <span class="${tagCls}">${sName}</span>
          ${noteHtml}
        </td>
        ${zaHtml}${neHtml}${ztHtml}${kmHtml}
      </tr>`;
  }).join('');
}

function renderMain(uid) {
  const a        = state.athletes.find(x => x.userId === uid);
  const { cycleData, nezp, activsByWeek } = state.cache[uid];
  const expCyc   = state.expCyc[uid];
  const expWk    = state.expWk[uid];

  const totDZ  = cycleData.reduce((s, c) => s + c.DZ, 0);
  const totFA  = cycleData.reduce((s, c) => s + c.FA, 0);
  const totBeh = cycleData.reduce((s, c) => s + c.runDist, 0);
  const totZ   = cycleData.reduce((s, c) => s + c.zatSec, 0);

  const pillNezp = nezp > 0
    ? `<span class="pill alert"><strong>${nezp}</strong> nezprac.</span>`
    : '';

  const rows = cycleData.map(c => {
    const cycOpen = expCyc.has(c.num);

    const weekRows = c.weeks.map(w => {
      const wkKey  = `${c.num}-${w.week}`;
      const wkOpen = expWk.has(wkKey);
      const acts   = activsByWeek[wkKey] || [];

      const actRows = buildActRows(acts, cycOpen && wkOpen);

      const hasActs = acts.length > 0;
      const wkDateRange = `<span class="cy-dates">${fmtDateObj(w.mon)} &#x2013; ${fmtDateObj(w.sun)}</span>`;
      return `
        <tr class="wr ${cycOpen ? 'show' : ''} ${hasActs ? 'expandable' : ''} ${wkOpen ? 'wk-open' : ''} ${w.hasNezp ? 'has-nezp' : ''}"
            data-wk="${wkKey}">
          <td class="wk-cell">
            <span class="wk-chevron">${hasActs ? '▶' : ' '}</span>T${w.week} ${wkDateRange}
          </td>
          <td></td>
          ${td(w.DZ, 'c-dz')}
          ${td(w.FA, 'c-fa')}
          ${td(w.ZA, 'c-za')}
          ${td(w.NE, 'c-ne')}
          ${tdTime(w.zatSec)}
          ${tdKm(w.runDist)}
        </tr>
        ${actRows}`;
    }).join('');

    const dateRange = `<span class="cy-dates">${fmtDateObj(c.mon)} – ${fmtDateObj(c.sun)}</span>`;

    const copyTsv = [
      c.DZ,
      c.FA,
      c.ZA,
      c.NE,
      fmtTime(c.zatSec) || 0,
      c.runDist ? (c.runDist / 1000).toFixed(1) : 0
    ].join('\t');

    return `
      <tr class="cr ${cycOpen ? 'open' : ''} ${c.hasNezp ? 'has-nezp' : ''}" data-c="${c.num}">
        <td>
          <div class="cy-cell">
            <span class="chevron">▶</span>
            <span class="cy-tag">C${c.num}</span>
            ${dateRange}
            <button class="cy-copy" data-tsv="${copyTsv.replace(/"/g, '&quot;')}" title="Kopírovat do schránky">⎘</button>
          </div>
        </td>
        <td class="num dim" style="font-size:11px;font-weight:400;">${c.weeks.length}T</td>
        ${td(c.DZ, 'c-dz')}
        ${td(c.FA, 'c-fa')}
        ${td(c.ZA, 'c-za')}
        ${td(c.NE, 'c-ne')}
        ${tdTime(c.zatSec)}
        ${tdKm(c.runDist)}
      </tr>
      ${weekRows}`;
  }).join('');


  setMain(`
    <div class="main-head">
      <div class="ath-title">${a.lastname} ${a.firstname}</div>
      <div class="stat-pills">
        <span class="pill"><strong>${cycleData.length}</strong> cykl&#367;</span>
        <span class="pill"><strong>${totDZ}</strong> DZ</span>
        <span class="pill"><strong>${totFA}</strong> aktivit</span>
        <span class="pill"><strong>${(totBeh / 1000).toFixed(0)} km</strong> b&#283;h</span>
        <span class="pill"><strong>${fmtTime(totZ) || '&#8212;'}</strong> z&#225;t&#283;&#382;</span>
        ${pillNezp}
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="col-cy">Cyklus</th>
            <th class="col-wk">T&#253;dny</th>
            <th>DZ</th><th>FA</th><th>ZA</th><th>NE</th>
            <th>Z&#225;t&#283;&#382;</th><th>B&#283;h km</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`);

  document.querySelectorAll('.cr').forEach(row => {
    row.addEventListener('click', () => {
      const c = +row.dataset.c;
      expCyc.has(c) ? expCyc.delete(c) : expCyc.add(c);
      renderMain(uid);
    });
  });

  document.querySelectorAll('.cy-copy').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const tsv = btn.dataset.tsv;
      navigator.clipboard.writeText(tsv).then(() => {
        const orig = btn.textContent;
        btn.textContent = '✓';
        setTimeout(() => { btn.textContent = orig; }, 1200);
      });
    });
  });

  document.querySelectorAll('.wr.expandable').forEach(row => {
    row.addEventListener('click', e => {
      e.stopPropagation();
      const wk = row.dataset.wk;
      expWk.has(wk) ? expWk.delete(wk) : expWk.add(wk);
      renderMain(uid);
    });
  });
}

/* ── Auth ──────────────────────────────────────────────────── */

async function connect(token) {
  state.token = token;
  document.getElementById('setup-err').textContent = '';
  try {
    const data = await apiFetch(`/team/${TEAM_ID}/stats`);
    state.athletes = (data.results.data.stats || [])
      .filter(a => a.role === 'athlete')
      .sort((a, b) => a.lastname.localeCompare(b.lastname, 'cs'));
    await chrome.storage.local.set({ token });
    document.getElementById('setup').style.display = 'none';
    document.getElementById('app').style.display   = 'flex';
    renderSidebar();
    state.athletes.forEach(a => prefetchNezp(a.userId));
  } catch (e) {
    state.token = null;
    document.getElementById('setup-err').textContent = 'Nepodařilo se připojit: ' + e.message;
  }
}

async function prefetchNezp(uid) {
  try {
    const raw     = await apiFetch(`/team/detail/${TEAM_ID}/athlete/${uid}/training-log`);
    const entries = Object.values(raw.results?.data || {}).filter(e => {
      const d = (e.startDate || e.date || '').slice(0, 10);
      return d >= '2025-10-27' && d <= '2026-10-25';
    });
    if (!state.cache[uid]) state.cache[uid] = {};
    if (state.cache[uid].nezp == null) {
      state.cache[uid].nezp = entries.filter(e => e.time === null && e.movingTime != null).length;
    }
    renderSidebar();
    if (state.selected === uid && state.cache[uid].cycleData) renderMain(uid);
  } catch (_) {}
}

/* ── Totals page ───────────────────────────────────────────── */

const TOTALS_COLS = [
  { key: 'name',    label: 'Sportovec',  fmt: v => v,                            num: false },
  { key: 'DZ',      label: 'DZ',         fmt: v => v || '—',                     num: true  },
  { key: 'FA',      label: 'FA',         fmt: v => v || '—',                     num: true  },
  { key: 'ZA',      label: 'ZA',         fmt: v => v || '—',                     num: true  },
  { key: 'NE',      label: 'NE',         fmt: v => v || '—',                     num: true  },
  { key: 'zatSec',  label: 'Zátěž',      fmt: v => fmtTime(v) || '—',            num: true  },
  { key: 'runDist', label: 'Běh km',     fmt: v => v ? (v/1000).toFixed(1) : '—', num: true },
];

let totalsSort = { col: 'name', asc: true };

async function renderTotals() {
  const main = document.getElementById('main');
  main.innerHTML = '<div class="totals-loading">Načítám data…</div>';

  // Ensure all athletes are loaded
  await Promise.all(state.athletes.map(async a => {
    if (!state.cache[a.userId]?.cycleData) {
      try {
        const [detailRaw, logRaw] = await Promise.all([
          apiFetch(`/team/detail/${TEAM_ID}/athlete/${a.userId}`),
          apiFetch(`/team/detail/${TEAM_ID}/athlete/${a.userId}/training-log`)
        ]);
        state.cache[a.userId] = buildCache(detailRaw, logRaw);
      } catch (_) {}
    }
  }));

  const rows = state.athletes.map(a => {
    const cd = state.cache[a.userId]?.cycleData || [];
    return {
      name:    `${a.lastname} ${a.firstname}`,
      DZ:      cd.reduce((s, c) => s + c.DZ, 0),
      FA:      cd.reduce((s, c) => s + c.FA, 0),
      ZA:      cd.reduce((s, c) => s + c.ZA, 0),
      NE:      cd.reduce((s, c) => s + c.NE, 0),
      zatSec:  cd.reduce((s, c) => s + c.zatSec, 0),
      runDist: cd.reduce((s, c) => s + c.runDist, 0),
    };
  });

  const { col, asc } = totalsSort;
  rows.sort((a, b) => {
    const va = a[col], vb = b[col];
    const cmp = typeof va === 'string' ? va.localeCompare(vb, 'cs') : (va - vb);
    return asc ? cmp : -cmp;
  });

  const thead = TOTALS_COLS.map(c => {
    const cls = totalsSort.col === c.key
      ? (totalsSort.asc ? 'sort-asc' : 'sort-desc')
      : '';
    return `<th class="${cls}" data-col="${c.key}">${c.label}</th>`;
  }).join('');

  const tbody = rows.map(r =>
    `<tr>${TOTALS_COLS.map(c => `<td>${c.fmt(r[c.key])}</td>`).join('')}</tr>`
  ).join('');

  main.innerHTML = `
    <div class="totals-wrap">
      <h2>Celkové součty — sezóna 2025/2026</h2>
      <table class="totals-table">
        <thead><tr>${thead}</tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>`;

  main.querySelectorAll('.totals-table th').forEach(th => {
    th.addEventListener('click', () => {
      const c = th.dataset.col;
      if (totalsSort.col === c) totalsSort.asc = !totalsSort.asc;
      else { totalsSort.col = c; totalsSort.asc = c === 'name'; }
      renderTotals();
    });
  });
}

/* ── Wire-up ───────────────────────────────────────────────── */

document.getElementById('btn-connect').addEventListener('click', () => {
  const t = document.getElementById('tok-input').value.trim();
  if (t) connect(t);
});

document.getElementById('tok-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-connect').click();
});

document.getElementById('btn-extract').addEventListener('click', async () => {
  try {
    const tabs = await chrome.tabs.query({ url: '*://treninkac.orientacnisporty.cz/*' });
    const tab  = tabs[0];
    if (!tab) {
      document.getElementById('setup-err').textContent =
        'Otevřete nejprve záložku treninkac.orientacnisporty.cz';
      return;
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const raw = localStorage.getItem('trainee');
        return raw ? JSON.parse(raw).token : null;
      }
    });
    const token = results?.[0]?.result;
    if (token) {
      document.getElementById('tok-input').value = token;
      connect(token);
    } else {
      document.getElementById('setup-err').textContent =
        'Token nenalezen — přihlašte se nejprve na tréninkáč.';
    }
  } catch (e) {
    document.getElementById('setup-err').textContent = 'Chyba: ' + e.message;
  }
});

document.getElementById('nav-totals').addEventListener('click', e => {
  e.preventDefault();
  if (!state.token) return;
  state.selected = null;
  document.querySelectorAll('.ath-item').forEach(el => el.classList.remove('active'));
  document.getElementById('nav-totals').classList.add('active');
  renderTotals();
});

document.getElementById('btn-reset').addEventListener('click', async () => {
  await chrome.storage.local.remove('token');
  Object.assign(state, { token: null, athletes: [], selected: null, cache: {}, expCyc: {}, expWk: {} });
  document.getElementById('app').style.display   = 'none';
  document.getElementById('setup').style.display = 'flex';
  document.getElementById('tok-input').value     = '';
});

chrome.storage.local.get('token', ({ token }) => {
  if (token) {
    document.getElementById('tok-input').value = token;
    connect(token);
  }
});
