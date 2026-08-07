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

/* Returns the Monday of ISO week `week` in `year` as a UTC Date */
function isoWeekMonday(year, week) {
  const DAY = 86400000;
  const jan4ts = Date.UTC(year, 0, 4);
  const dow    = (new Date(jan4ts)).getUTCDay() || 7;
  const week1monday = jan4ts - (dow - 1) * DAY;
  return new Date(week1monday + (week - 1) * 7 * DAY);
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

/* Return ISO week number AND ISO year (important: year can differ from calendar year) */
function getISOWeekAndYear(dateStr) {
  const d   = new Date(dateStr);
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const isoYear  = utc.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const isoWeek  = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
  return { year: isoYear, week: isoWeek };
}

/* Sort an array of ISO week numbers in temporal (calendar) order.
   Detects year-wrap by finding the largest gap between sorted values.
   Example: [1,2,3,51,52] → [51,52,1,2,3] */
function temporalSortWeeks(weekNums) {
  if (weekNums.length <= 1) return [...weekNums];
  const sorted = [...weekNums].sort((a, b) => a - b);
  let maxGap = 0, wrapIdx = -1;
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1] - sorted[i];
    if (gap > maxGap) { maxGap = gap; wrapIdx = i; }
  }
  if (maxGap < 10 || wrapIdx === -1) return sorted;
  return [...sorted.slice(wrapIdx + 1), ...sorted.slice(0, wrapIdx + 1)];
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
  const co   = d.cycleOverview      || {};
  const wo   = d.weekOverview       || {};
  const sbc  = d.sumByCycle         || {};
  const sbw  = d.sumByWeeks         || {};
  const sick = d.sickDaysInCycles   || [];

  // Normalise entries: accept both startDate and date fields
  const allLogEntries = Object.values(logRaw.results?.data || {}).map(e => ({
    ...e,
    _date: (e.startDate || e.date || '').slice(0, 10)
  })).filter(e => e._date);

  // Restrict to team validity period to avoid historical data from other seasons
  const VALIDITY_START = '2025-10-27';
  const VALIDITY_END   = '2026-10-25';
  const logEntries = allLogEntries.filter(
    e => e._date >= VALIDITY_START && e._date <= VALIDITY_END
  );

  /* ── Build year-aware week lookup ───────────────────────── */
  /* Within one validity period (≈52 weeks) each ISO week number is unique:
     weeks 44–52 belong to 2025, weeks 1–43 belong to 2026 — no repeats.
     So we derive the year for each week directly from the activity dates
     rather than trying to infer it from week-number sequences. */

  const sortedCycles = Object.keys(wo).map(Number).sort((a, b) => a - b);

  // Count how many activities land in each (isoYear, isoWeek) combination
  const weekYearCounts = {};
  for (const e of logEntries) {
    const { year, week } = getISOWeekAndYear(e._date);
    if (!weekYearCounts[week]) weekYearCounts[week] = {};
    weekYearCounts[week][year] = (weekYearCounts[week][year] || 0) + 1;
  }

  // For weeks that have no activities (sick/rest weeks), fall back to the
  // validity-period rule: week ≤ 43 → 2026, week ≥ 44 → 2025
  const VALIDITY_YEAR = getISOWeekAndYear(VALIDITY_START).year; // 2025
  function resolveYear(weekNum) {
    const yCounts = weekYearCounts[weekNum];
    if (yCounts) {
      return Number(Object.entries(yCounts).sort((a, b) => b[1] - a[1])[0][0]);
    }
    return weekNum >= 44 ? VALIDITY_YEAR : VALIDITY_YEAR + 1;
  }

  // weekLookup: `${isoYear}-${weekNum}` → { cycle, week }
  const weekLookup = {};
  for (const c of sortedCycles) {
    const rawWeeks = [...new Set((wo[c] || []).map(w => w.week))];
    for (const weekNum of rawWeeks) {
      const year = resolveYear(weekNum);
      weekLookup[`${year}-${weekNum}`] = { cycle: c, week: weekNum };
    }
  }

  /* ── Group training-log activities by (cycle, week) ─────── */
  const activsByWeek    = {};   // `${cycle}-${week}` → [activity]
  const unmatchedByWeek = {};   // `${isoYear}-W${isoWeek}` → [activity]

  for (const e of logEntries) {
    const { year: actYear, week: actWeek } = getISOWeekAndYear(e._date);
    const match = weekLookup[`${actYear}-${actWeek}`];
    const nezp  = e.time === null && e.movingTime != null;
    const sport = e.sport || e.kind || null;
    const act   = {
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
    };

    if (match) {
      const key = `${match.cycle}-${match.week}`;
      (activsByWeek[key] = activsByWeek[key] || []).push(act);
    } else {
      const wkKey = `${actYear}-W${String(actWeek).padStart(2, '0')}`;
      (unmatchedByWeek[wkKey] = unmatchedByWeek[wkKey] || []).push(act);
    }
  }

  // Sort by date within each week
  for (const key of Object.keys(activsByWeek))    activsByWeek[key].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  for (const key of Object.keys(unmatchedByWeek)) unmatchedByWeek[key].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const nezp = logEntries.filter(e => e.time === null && e.movingTime != null).length;

  /* ── Build cycleData (planned cycles) ───────────────────── */
  const cycleNums = Object.keys(co).map(Number).sort((a, b) => a - b);

  const cycleData = cycleNums.map(c => {
    const coRow  = co[c]?.[0] || {};
    const sbcArr = sbc[c]     || [];
    const sickC  = sick.find(s => s.cycle === c) || {};
    const woArr  = wo[c]      || [];
    const sbwArr = sbw[c]     || [];
    const weekNums = [...new Set(woArr.map(w => w.week))].sort((a, b) => {
      const ya = resolveYear(a), yb = resolveYear(b);
      return ya !== yb ? ya - yb : a - b;
    });

    const weeks = weekNums.map(w => {
      const we     = woArr.find(x => x.week === w) || {};
      const wSp    = sbwArr.filter(x => x.week === w);
      const sickW  = (sickC.weeks || []).find(x => x.week === w) || {};
      const acts   = activsByWeek[`${c}-${w}`] || [];
      const nezpA  = acts.filter(a => a.nezp);
      return {
        week:     w,
        isoYear:  resolveYear(w),
        hasNezp:  nezpA.length > 0,
        DZ:       (we.day_load       || 0) + new Set(nezpA.map(a => a.date)).size,
        FA:       (we.activity_count || 0) + nezpA.length,
        ZA:       (we.raceCount      || 0) + nezpA.filter(a => a.isRace).length,
        NE:       (sickW.sickdays    || 0) + nezpA.filter(a => a.isSick).length,
        runDist:  wSp.filter(e => e.kind === 'run').reduce((s, e) => s + (e.distance || 0), 0)
                  + nezpA.reduce((s, a) => s + a.dist, 0),
        zatSec:   wSp.reduce((s, e) => s + (e.time || 0), 0)
                  + nezpA.reduce((s, a) => s + a.movTime, 0)
      };
    });

    return {
      num:      c,
      hasNezp:  weeks.some(w => w.hasNezp),
      DZ:       weeks.reduce((s, w) => s + w.DZ, 0),
      FA:       weeks.reduce((s, w) => s + w.FA, 0),
      ZA:       weeks.reduce((s, w) => s + w.ZA, 0),
      NE:       weeks.reduce((s, w) => s + w.NE, 0),
      runDist:  weeks.reduce((s, w) => s + w.runDist, 0),
      zatSec:   weeks.reduce((s, w) => s + w.zatSec, 0),
      weeks
    };
  });

  /* ── Append extra cycles from unmatched weeks (4 weeks each) */
  const unmatchedWkKeys = Object.keys(unmatchedByWeek).sort();
  const lastCycleNum    = cycleNums.length ? Math.max(...cycleNums) : 0;

  for (let i = 0; i < unmatchedWkKeys.length; i += 4) {
    const group    = unmatchedWkKeys.slice(i, i + 4);
    const cycleNum = lastCycleNum + Math.floor(i / 4) + 1;

    const weeks = group.map(wkKey => {
      const acts    = unmatchedByWeek[wkKey];
      const [wkYear, wkW] = wkKey.split('-W');
      const weekNum = parseInt(wkW, 10);
      const isoYear = parseInt(wkYear, 10);
      activsByWeek[`${cycleNum}-${weekNum}`] = acts;
      return {
        week:    weekNum,
        isoYear,
        hasNezp: acts.some(a => a.nezp),
        DZ:      new Set(acts.map(a => a.date)).size,
        FA:      acts.length,
        ZA:      acts.filter(a => a.isRace).length,
        NE:      acts.filter(a => a.isSick).length,
        runDist: acts.reduce((s, a) => s + a.dist, 0),
        zatSec:  acts.reduce((s, a) => s + a.movTime, 0)
      };
    });

    cycleData.push({
      num:     cycleNum,
      extra:   true,
      hasNezp: weeks.some(w => w.hasNezp),
      DZ:      weeks.reduce((s, w) => s + w.DZ, 0),
      FA:      weeks.reduce((s, w) => s + w.FA, 0),
      ZA:      weeks.reduce((s, w) => s + w.ZA, 0),
      NE:      weeks.reduce((s, w) => s + w.NE, 0),
      runDist: weeks.reduce((s, w) => s + w.runDist, 0),
      zatSec:  weeks.reduce((s, w) => s + w.zatSec, 0),
      weeks
    });
  }

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
      const wkMon = isoWeekMonday(w.isoYear, w.week);
      const wkSun = new Date(wkMon.getTime() + 6 * 86400000);
      const wkDateRange = `<span class="cy-dates">${fmtDateObj(wkMon)} &#x2013; ${fmtDateObj(wkSun)}</span>`;
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

    const firstW  = c.weeks[0];
    const lastW   = c.weeks[c.weeks.length - 1];
const dateFrom = firstW ? fmtDateObj(isoWeekMonday(firstW.isoYear, firstW.week)) : '';
    const dateTo   = lastW  ? (() => { const s = isoWeekMonday(lastW.isoYear, lastW.week); s.setUTCDate(s.getUTCDate() + 6); return fmtDateObj(s); })() : '';
    const dateRange = dateFrom ? `<span class="cy-dates">${dateFrom} – ${dateTo}</span>` : '';

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
