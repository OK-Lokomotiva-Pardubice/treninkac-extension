'use strict';

const API     = 'https://treninkac-api.orientacnisporty.cz/api';

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
  ride: 'Kolo', nordicski: 'Běžky', alpineski: 'Sjezdovky', weighttraining: 'Posilování', workout: 'Cvičení',
  soccer: 'Fotbal', inlineskate: 'Brusle', rowing: 'Veslování', kayaking: 'Kajak', snowboard: 'Snowboard',
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
/* One entry per training year, oldest first. Team 117 had its from–to range
   moved to the new year instead of a new team being created, so its
   statistics now only describe the newest year: older years that still live
   in the same team get `stats: false` and are computed from the training log
   (and the calendar) alone. A year that gets its own team just sets `team`.
   Adding a year: append an entry, nothing else needs to change. */
const SEASONS = [
  { label: '2025/26', team: 117, stats: false, start: '2025-10-27', end: '2026-10-25' },
  { label: '2026/27', team: 117,               start: '2026-10-26', end: '2027-10-24' }
];
const WEEKS_PER_CYCLE = 4;
const CYCLES_PER_YEAR = 13;
const DAY_MS          = 86400000;
const WEEK_MS         = 7 * DAY_MS;

/* The season shown on the athlete, totals and calendar pages (see useSeason) */
let season, TEAM_ID, HAS_STATS, SEASON_START, SEASON_END, SEASON_START_TS, SEASON_WEEKS;

/* Absolute week index (0-based) of a YYYY-MM-DD date since SEASON_START */
function weekIndexOf(dateStr) {
  const ts = Date.UTC(+dateStr.slice(0, 4), +dateStr.slice(5, 7) - 1, +dateStr.slice(8, 10));
  return Math.floor((ts - SEASON_START_TS) / WEEK_MS);
}

/* Monday (UTC Date) of an absolute week index */
function weekMonday(wi) {
  return new Date(SEASON_START_TS + wi * WEEK_MS);
}

function useSeason(s) {
  season          = s;
  TEAM_ID         = s.team;
  HAS_STATS       = s.stats !== false;          // statistics endpoint matches this year's dates
  SEASON_START    = s.start;
  SEASON_END      = s.end;
  SEASON_START_TS = Date.parse(s.start + 'T00:00:00Z');
  SEASON_WEEKS    = weekIndexOf(s.end) + 1;     // 52
}
/* default: the training year that contains today */
useSeason(SEASONS.filter(s => s.start <= new Date().toISOString().slice(0, 10)).pop() || SEASONS[0]);

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

/* Sickness records live in the athlete's calendar (type "sickness", entered in
   Tréninkáč as a from–to period), not in the statistics. Returns the set of
   YYYY-MM-DD days covered by any sickness. An end at exactly 00:00 on a later
   day is read as exclusive (all-day calendar convention); a date-only end,
   or any other time, is inclusive. */
function calSickDates(calRaw) {
  const list = calRaw?.results?.data?.activityList;
  if (!Array.isArray(list)) return null;             // unexpected shape → treat the calendar as unavailable
  const out = new Set();
  const day  = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  for (const e of list) {
    if (e.type !== 'sickness' || !e.start) continue;
    const from = String(e.start).slice(0, 10);
    const rawTo = String(e.end || e.start);
    let   to   = rawTo.slice(0, 10);
    const midnight = /[T ]00:00(:00(\.0+)?)?(Z|[+-]00:?00)?$/.test(rawTo);
    let endTs = day(to);
    if (midnight && endTs > day(from)) endTs -= DAY_MS;
    for (let ts = day(from), n = 0; ts <= endTs && n < 366; ts += DAY_MS, n++)
      out.add(new Date(ts).toISOString().slice(0, 10));
  }
  return out;
}

/* Statistics, training log and calendar of one athlete. The calendar is only
   needed for sick days, so a failed fetch falls back to the statistics. */
async function loadAthlete(uid) {
  const [detailRaw, logRaw, calRaw] = await Promise.all([
    HAS_STATS ? apiFetch(`/team/detail/${TEAM_ID}/athlete/${uid}`) : { results: { data: {} } },
    apiFetch(`/team/detail/${TEAM_ID}/athlete/${uid}/training-log`),
    apiFetchRetry(`/team/detail/${TEAM_ID}/athlete/${uid}/calendar`, 3).catch(() => null)
  ]);
  return buildCache(detailRaw, logRaw, calRaw);
}

function buildCache(detailRaw, logRaw, calRaw) {
  const d    = detailRaw.results.data;
  const wo   = d.weekOverview       || {};
  const sbw  = d.sumByWeeks         || {};
  const sick = d.sickDaysInCycles   || [];
  const sickDates = calRaw ? calSickDates(calRaw) : null;   // null → calendar not available

  // Normalise entries: accept both startDate and date fields
  const allLogEntries = Object.values(logRaw.results?.data || {}).map(e => ({
    ...e,
    _date: (e.startDate || e.date || '').slice(0, 10)
  })).filter(e => e._date);

  // Restrict to the training year to avoid historical data from other seasons
  const logEntries = allLogEntries.filter(
    e => e._date >= SEASON_START && e._date <= SEASON_END
  );

  /* ── Tréninkáč statistics, re-keyed by ISO week ──────────
     Weekly stats that Tréninkáč computes itself from processed activities
     (not the training plan in plan.json). The API groups them into cycles
     of its own, and that grouping drifts per athlete whenever weeks are
     missing. Cycles here come from the calendar instead, so the API's cycle
     numbers are dropped and only the ISO week number of each row is kept. */
  const statsWeek = {};                     // isoWeek → weekOverview row
  for (const rows of Object.values(wo))
    for (const r of rows) statsWeek[r.week] = r;

  const statsSport = {};                    // isoWeek → sumByWeeks rows
  for (const rows of Object.values(sbw))
    for (const r of rows) (statsSport[r.week] = statsSport[r.week] || []).push(r);

  const statsSick = {};                     // isoWeek → sick days
  for (const c of sick)
    for (const w of (c.weeks || []))
      statsSick[w.week] = (statsSick[w.week] || 0) + (w.sickdays || 0);

  /* ── Season calendar ─────────────────────────────────────
     Week `wi` is the (wi+1)-th week of the training year; its ISO week
     number is only a label (and the key the statistics API uses). */
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

  const sickByWi = {};                      // wi → sick days (from the calendar)
  for (const iso of sickDates || []) {
    const wi = weekIndexOf(iso);
    if (wi >= 0 && wi < SEASON_WEEKS) sickByWi[wi] = (sickByWi[wi] || 0) + 1;
  }

  /* ── Cycles that carry any data (statistics rows, activities or sickness) ── */
  const activeCycles = new Set();
  for (const isoWeek of Object.keys(statsWeek)) {
    const wi = wiOfIsoWeek[isoWeek];
    if (wi != null) activeCycles.add(Math.floor(wi / WEEKS_PER_CYCLE));
  }
  for (const wi of Object.keys(actsByWi))
    activeCycles.add(Math.floor(Number(wi) / WEEKS_PER_CYCLE));
  for (const wi of Object.keys(sickByWi))
    activeCycles.add(Math.floor(Number(wi) / WEEKS_PER_CYCLE));

  /* ── Build cycleData ─────────────────────────────────────
     Every cycle spans its full 4 calendar weeks, whether or not the
     athlete has statistics or any activity in them. */
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

      // A week with statistics already counts its processed activities in
      // them, so only nezp ones are added. A week without statistics has
      // none, so every activity in it counts.
      const pw       = statsWeek[meta.week];
      const hasStats = pw != null;
      const ps       = statsSport[meta.week] || [];
      const add      = hasStats ? nezpA : acts;

      // Sick days: the calendar's sickness records when available. Otherwise
      // (calendar fetch failed) Tréninkáč's own statistics count and days with
      // an activity flagged as sick; those can describe the same days, so the
      // larger is taken instead of the sum.
      const flagSick = new Set(acts.filter(a => a.isSick).map(a => a.date)).size;
      const sickDays = sickDates
        ? (sickByWi[ci * WEEKS_PER_CYCLE + k] || 0)
        : Math.max(statsSick[meta.week] || 0, flagSick);

      weeks.push({
        week:    meta.week,
        isoYear: meta.isoYear,
        mon:     meta.mon,
        sun:     meta.sun,
        hasNezp: nezpA.length > 0,
        DZ:      (hasStats ? (pw.day_load       || 0) : 0) + new Set(add.map(a => a.date)).size,
        FA:      (hasStats ? (pw.activity_count || 0) : 0) + add.length,
        ZA:      (hasStats ? (pw.raceCount      || 0) : 0) + add.filter(a => a.isRace).length,
        NE:      sickDays,
        runDist: (hasStats ? ps.filter(e => e.kind === 'run').reduce((s, e) => s + (e.distance || 0), 0) : 0)
                 + add.filter(a => isRunSport(a.sport)).reduce((s, a) => s + a.dist, 0),
        zatSec:  (hasStats ? ps.reduce((s, e) => s + (e.time || 0), 0) : 0)
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

  return { cycleData, nezp, activsByWeek, sickDates };
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
  sz.active = false;
  szHideTip();
  document.getElementById('nav-totals')?.classList.remove('active');
  document.getElementById('nav-seasons')?.classList.remove('active');
  document.getElementById('nav-plan')?.classList.remove('active');
  if (!state.expCyc[uid]) state.expCyc[uid] = new Set();
  if (!state.expWk[uid])  state.expWk[uid]  = new Set();
  renderSidebar();
  setMain(`<div class="state-box"><div class="spinner"></div><div>Načítám…</div></div>`);
  try {
    if (!state.cache[uid]?.cycleData) {
      state.cache[uid] = await loadAthlete(uid);
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
    const sName    = isNezp
      ? (sportName(act.sport) ? sportName(act.sport) + ' &#183; ' : '') + 'nezpracov&#225;no'
      : (sportName(act.sport) || 'Neza&#345;azeno');
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

/* ── Calendar view of one athlete ─────────────────────────────
   Alternative to the cycle/week table: one small calendar per cycle (4 weeks
   × Mon–Sun), every day shaded by the km run that day. Always draws all 13
   cycles; the week totals reuse the table's numbers. */

let detailView = 'table';                    // 'table' | 'cal'
const CAL_DOW = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];
let calDays = {};                             // date → activities of that day, for the click popover

function calClosePop() { document.getElementById('cal-pop')?.remove(); }

/* Popover with a link to every activity of the clicked day (like the links in the table) */
function calOpenPop(ev, iso) {
  calClosePop();
  const acts = calDays[iso] || [];
  if (!acts.length) return;
  const pop = szNode('div'); pop.id = 'cal-pop';
  pop.appendChild(szNode('div', 'ph', fmtDate(iso)));
  acts.forEach(a => {
    const row = szNode('div', 'pr');
    const link = szNode('a', null, a.name);
    link.href = `https://treninkac.orientacnisporty.cz/activities/training/detail/${a.id}`;
    link.target = '_blank'; link.rel = 'noopener';
    const tag = szNode('span', 'sport-tag' + (a.nezp ? ' nezp' : ''),
      a.nezp ? (sportName(a.sport) ? sportName(a.sport) + ' · ' : '') + 'nezpracováno' : (sportName(a.sport) || 'Nezařazeno'));
    const km = szNode('span', 'pk', a.dist ? (a.dist / 1000).toFixed(1) + ' km' : (a.movTime ? fmtTime(a.movTime) : ''));
    row.append(link, tag, km);
    pop.appendChild(row);
  });
  document.body.appendChild(pop);
  let x = ev.clientX + 10, y = ev.clientY + 10;
  if (x + pop.offsetWidth  > innerWidth  - 8) x = Math.max(8, innerWidth  - pop.offsetWidth  - 8);
  if (y + pop.offsetHeight > innerHeight - 8) y = Math.max(8, ev.clientY - pop.offsetHeight - 10);
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
}
document.addEventListener('click', e => { if (!e.target.closest('#cal-pop, .cd.has')) calClosePop(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') calClosePop(); });

function calHtml(uid) {
  const { cycleData, activsByWeek, sickDates } = state.cache[uid];
  const todayTs = Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const dayKm = {};                                    // date → run km, for the shading scale
  calDays = {};
  let maxKm = 0;
  for (const acts of Object.values(activsByWeek))
    for (const a of acts) (calDays[a.date] = calDays[a.date] || []).push(a);
  for (const acts of Object.values(activsByWeek))
    for (const a of acts) if (isRunSport(a.sport)) {
      dayKm[a.date] = (dayKm[a.date] || 0) + a.dist / 1000;
      maxKm = Math.max(maxKm, dayKm[a.date]);
    }
  const lvl = km => km <= 0 ? 0 : Math.min(4, Math.ceil(km / maxKm * 4));

  const cards = Array.from({ length: CYCLES_PER_YEAR }, (_, ci) => {
    const num = ci + 1;
    const cd  = cycleData.find(c => c.num === num);
    const mon = weekMonday(ci * WEEKS_PER_CYCLE);
    const sun = new Date(mon.getTime() + (WEEKS_PER_CYCLE * 7 - 1) * DAY_MS);

    const weeks = Array.from({ length: WEEKS_PER_CYCLE }, (_, k) => {
      const wTs  = SEASON_START_TS + (ci * WEEKS_PER_CYCLE + k) * WEEK_MS;
      const wk   = isoWeekOfTs(wTs).week;
      const acts = activsByWeek[`${num}-${wk}`] || [];
      const wd   = cd && cd.weeks[k];
      const days = CAL_DOW.map((dn, di) => {
        const ts  = wTs + di * DAY_MS;
        const d   = new Date(ts);
        const iso = d.toISOString().slice(0, 10);
        const da  = acts.filter(a => a.date === iso);
        const km  = dayKm[iso] || 0;
        const other = da.some(a => !isRunSport(a.sport));
        const race  = da.some(a => a.isRace), sick = da.some(a => a.isSick) || !!sickDates?.has(iso), nezp = da.some(a => a.nezp);
        const sec   = da.reduce((s, a) => s + a.movTime, 0);
        const cls = ['cd', 'l' + lvl(km), ts > todayTs ? 'fut' : '', ts === todayTs ? 'today' : '',
                     race ? 'race' : '', sick ? 'sick' : '', nezp ? 'nezp' : '', da.length ? 'has' : '', !km && other ? 'other' : ''].filter(Boolean).join(' ');
        const tip = `${dn} ${fmtDateObj(d)}` + (da.length
          ? ` · ${da.length > 1 ? da.length + '× aktivita · ' : ''}${km ? km.toFixed(1) + ' km běh' : 'bez běhu'}${other ? ' · jiný sport' : ''}${sec ? ' · zátěž ' + fmtTime(sec) : ''}${race ? ' · závod' : ''}${sick ? ' · nemoc' : ''}${nezp ? ' · nezpracováno' : ''}${da.length ? ' · klikněte pro odkaz' : ''}`
          : sick ? ' · nemoc (bez aktivity)' : ' · bez aktivity');
        const label = d.getUTCDate() === 1 ? `${d.getUTCDate()}.${d.getUTCMonth() + 1}.` : d.getUTCDate();
        // one pip per activity when a day has several (or an unprocessed one): filled = run, hollow = other sport, red = unprocessed
        const pips = da.length < 2 && !nezp ? '' : '<span class="pips">' + da.slice(0, 4).map(a =>
          `<i class="${a.nezp ? 'nz' : isRunSport(a.sport) ? 'run' : 'oth'}"></i>`).join('') + (da.length > 4 ? '<b>+</b>' : '') + '</span>';
        return `<div class="${cls}" data-date="${iso}" title="${tip}"><span class="d">${label}</span>${pips}<span class="k">${km ? (km < 10 ? km.toFixed(1) : Math.round(km)) : ''}</span></div>`;
      }).join('');
      const tot = wd && wd.runDist ? (wd.runDist / 1000).toFixed(0) : '';
      const ne  = wd && wd.NE ? `<span class="ne" title="dny nemoci v týdnu">NE ${wd.NE}</span>` : '';
      return `<div class="cwk${wd && wd.hasNezp ? ' nz' : ''}">T${wk}</div>${days}<div class="cwt">${ne}${tot}</div>`;
    }).join('');

    const sum = cd ? `${(cd.runDist / 1000).toFixed(0)} km · ${fmtTime(cd.zatSec) || '0:00'}` : '—';
    return `<div class="cal-card">
      <div class="cal-h"><b${cd && cd.hasNezp ? ' class="nz"' : ''}>C${num}</b><span>${fmtDateObj(mon)} – ${fmtDateObj(sun)}</span><em>${sum}</em></div>
      <div class="cal-g"><div></div>${CAL_DOW.map(d => `<div class="cdow">${d}</div>`).join('')}<div class="cdow">km</div>${weeks}</div>
    </div>`;
  }).join('');

  return `<div class="cal-wrap">
    <div class="cal-legend">
      <span>běh za den (vůči nejdelšímu dni sportovce${maxKm ? ', ' + maxKm.toFixed(1) + ' km' : ''}):</span>
      ${[1, 2, 3, 4].map(l => `<i class="cd l${l}"></i>`).join('')}
      <span><i class="cd other"></i>jiný sport</span>
      <span><i class="cd race"></i>závod</span>
      <span><i class="cd sick"></i>nemoc</span>
      <span><span class="pips"><i class="run"></i><i class="oth"></i><i class="nz"></i></span>čtverečky vpravo nahoře = aktivity dne, když jsou víc nebo nezpracovaná (plná = běh, prázdná = jiný sport, červená = nezpracováno)</span>
      <span><i class="cd"></i>bez aktivity</span>
    </div>
    <div class="cal-grid">${cards}</div>
  </div>`;
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

  const pillSick = state.cache[uid].sickDates
    ? ''
    : `<span class="pill alert" title="Kalendář s nemocemi se nepodařilo načíst, NE je jen ze statistik a může být neúplné">NE ze statistik</span>`;
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
        ${pillNezp}${pillSick}
      </div>
    </div>
    <div class="view-sw">
      <button data-v="table" class="${detailView === 'table' ? 'on' : ''}">Tabulka</button>
      <button data-v="cal" class="${detailView === 'cal' ? 'on' : ''}">Kalendář</button>
    </div>
    ${detailView === 'cal' ? calHtml(uid) : `<div class="table-wrap">
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
    </div>`}`);

  document.querySelectorAll('.cd.has').forEach(el =>
    el.addEventListener('click', e => calOpenPop(e, el.dataset.date))
  );
  document.querySelectorAll('.view-sw button').forEach(b =>
    b.addEventListener('click', () => { detailView = b.dataset.v; renderMain(uid); })
  );

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

async function loadRoster() {
  const data = await apiFetch(`/team/${TEAM_ID}/stats`);
  state.athletes = (data.results.data.stats || [])
    .filter(a => a.role === 'athlete')
    .sort((a, b) => a.lastname.localeCompare(b.lastname, 'cs'));
}

function initSeasonPicker() {
  const sel = document.getElementById('season-sel');
  sel.replaceChildren(...SEASONS.map((s, i) => Object.assign(document.createElement('option'), { value: i, textContent: s.label })));
  sel.value = SEASONS.indexOf(season);
  sel.onchange = () => switchSeason(+sel.value);
}

/* Athlete, totals and calendar pages show one training year; Sezóny and Plán span all of them */
async function switchSeason(i) {
  useSeason(SEASONS[i]);
  Object.assign(state, { cache: {}, expCyc: {}, expWk: {} });
  try { await loadRoster(); } catch (e) { setMain(`<div class="state-box"><div class="err-txt">Chyba: ${e.message}</div></div>`); return; }
  renderSidebar();
  state.athletes.forEach(a => prefetchNezp(a.userId));
  if (document.getElementById('nav-totals').classList.contains('active')) renderTotals();
  else if (document.getElementById('nav-seasons').classList.contains('active')) renderSeasons();
  else if (document.getElementById('nav-plan').classList.contains('active')) renderPlan();
  else if (state.selected != null && state.athletes.some(a => a.userId === state.selected)) selectAthlete(state.selected);
  else if (!sz.active) { state.selected = null; setMain('<div class="state-box">&#8592; Vyberte sportovce</div>'); }
}

async function connect(token) {
  state.token = token;
  document.getElementById('setup-err').textContent = '';
  try {
    await loadRoster();
    await chrome.storage.local.set({ token });
    document.getElementById('setup').style.display = 'none';
    document.getElementById('app').style.display   = 'flex';
    initSeasonPicker();
    renderSidebar();
    state.athletes.forEach(a => prefetchNezp(a.userId));
  } catch (e) {
    state.token = null;
    document.getElementById('setup-err').textContent = 'Nepodařilo se připojit: ' + e.message;
  }
}

async function prefetchNezp(uid) {
  const forSeason = season;
  try {
    const raw     = await apiFetch(`/team/detail/${TEAM_ID}/athlete/${uid}/training-log`);
    const entries = Object.values(raw.results?.data || {}).filter(e => {
      const d = (e.startDate || e.date || '').slice(0, 10);
      return d >= SEASON_START && d <= SEASON_END;
    });
    if (forSeason !== season) return;       // the season was switched meanwhile
    if (!state.cache[uid]) state.cache[uid] = {};
    if (state.cache[uid].nezp == null) {
      state.cache[uid].nezp = entries.filter(e => e.time === null && e.movingTime != null).length;
    }
    renderSidebar();
    if (state.selected === uid && state.cache[uid].cycleData) renderMain(uid);
  } catch (_) {}
}

/* ── Totals page ───────────────────────────────────────────── */

const UNITS_NOTE =
  'Běh km = součet kilometrů pouze běžeckých aktivit (běh, trail, OB); chůze, kolo a další sporty se do kilometrů nepočítají. ' +
  'Zátěž = součet času všech sportů dohromady. ' +
  'Obojí zahrnuje i nezpracované aktivity, takže čísla mohou být vyšší než na webu Tréninkáče, který počítá jen zpracované.';

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
        state.cache[a.userId] = await loadAthlete(a.userId);
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
      <h2>Celkové součty — sezóna ${season.label}</h2>
      <p class="totals-note">${UNITS_NOTE}</p>
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

/* ── Seasons page ──────────────────────────────────────────────
   Progress of every athlete across training years, regardless of the team
   the year was run in. Built from each athlete's own training log (which
   spans all years), so it does not depend on the team statistics data. Cycles
   come from the same calendar as above, shifted back by 52 weeks per year.
   Athletes are collected from the current team and the two previous ones. */

const SZ_TEAMS    = [...SEASONS.map(s => s.team).reverse(), 108, 8]
  .filter((t, i, a) => a.indexOf(t) === i);   // newest first; first hit decides which team a log is fetched through
const SZ_ANCHOR_TS = Date.parse(SEASONS[SEASONS.length - 1].start + 'T00:00:00Z');   // newest year
const SZ_COUNT    = 4;                     // years shown: the one picked in the header dropdown and up to 3 before it
const SZ_ALL      = 5;                     // years aggregated (oldest data: team 8, 2022/23)
const SZ_LEN_MS   = CYCLES_PER_YEAR * WEEKS_PER_CYCLE * WEEK_MS;
const SZ_CYCLE_MS = WEEKS_PER_CYCLE * WEEK_MS;
const SZ_FIRST_TS = SZ_ANCHOR_TS - (SZ_ALL - 1) * SZ_LEN_MS;

const SZ_ALL_LABELS = Array.from({ length: SZ_ALL }, (_, i) => {
  const y = new Date(SZ_FIRST_TS + i * SZ_LEN_MS).getUTCFullYear();
  return `${y}/${String((y + 1) % 100).padStart(2, '0')}`;
});

/* The years on screen: the season picked in the header dropdown is the newest,
   up to SZ_COUNT years end at it. `end`/`off` index the aggregated years. */
function szWindow() {
  const end = Math.max(0, SZ_ALL - 1 - (SEASONS.length - 1 - SEASONS.indexOf(season)));
  const n   = Math.min(SZ_COUNT, end + 1);
  return { end, n, off: end - n + 1 };
}
const szLabels = () => { const w = szWindow(); return SZ_ALL_LABELS.slice(w.off, w.end + 1); };
const szLine   = i => SZ_LINE[SZ_COUNT - szWindow().n + i];   // newest shown year always gets the lightest line

/* oldest → newest; the ramp validates as one hue on the dark card surface */
const SZ_LINE = [
  { color: '#1c5cab', w: 2,   dash: '2 3' },
  { color: '#2a78d6', w: 2,   dash: '5 3' },
  { color: '#6da7ec', w: 2,   dash: ''    },
  { color: '#b7d3f6', w: 2.5, dash: ''    }
];

const SZ_METRIC = {
  km: { label: 'Běh km', unit: 'km', tick: v => String(v), fmt: v => v.toFixed(1), tot: v => v.toFixed(0) },
  h:  { label: 'Zátěž',  unit: 'h',  tick: v => String(v), fmt: v => fmtTime(Math.round(v * 3600)) || '0:00',
        tot: v => fmtTime(Math.round(v * 3600)) || '0:00' }
};

const sz = {
  active: false,
  roster: null,                // [{ userId, firstname, lastname, team, current }]
  agg:    {},                  // userId → [{ n, km[13], h[13] }] oldest → newest
  metric: 'km', view: 'charts', scale: 'own', sort: 'vol', who: 'all',
  sel:    null
};

/* Short outages are frequent: time out quickly and retry network/5xx errors */
async function apiFetchRetry(path, tries = 5) {
  for (let i = 1; ; i++) {
    const ctl   = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(API + path, { headers: { 'Authorization': 'Bearer ' + state.token }, signal: ctl.signal });
      if (r.status >= 500 && i < tries) throw new Error('HTTP ' + r.status);
      if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { fatal: true });
      return await r.json();
    } catch (e) {
      if (e.fatal || i >= tries) throw e;
      await new Promise(res => setTimeout(res, 400 * i));
    } finally {
      clearTimeout(timer);
    }
  }
}

async function szLoadRoster() {
  if (sz.roster) return sz.roster;
  const lists = await Promise.all(SZ_TEAMS.map(t => apiFetchRetry(`/team/${t}/stats`)));
  const byId  = new Map();
  lists.forEach((d, i) => {
    for (const a of d.results.data.stats || []) {
      if (a.role !== 'athlete' || byId.has(a.userId)) continue;
      byId.set(a.userId, { userId: a.userId, firstname: a.firstname, lastname: a.lastname,
                           team: SZ_TEAMS[i], current: i === 0 });
    }
  });
  sz.roster = [...byId.values()];
  return sz.roster;
}

/* Sum a training log into per-cycle running km and load hours for each year */
function szAggregate(entries) {
  const seasons = Array.from({ length: SZ_ALL }, () => ({ n: 0, km: Array(13).fill(0), h: Array(13).fill(0) }));
  for (const e of entries) {
    const d = (e.startDate || e.date || '').slice(0, 10);
    if (!d) continue;
    const off = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - SZ_FIRST_TS;
    const si  = Math.floor(off / SZ_LEN_MS);
    if (off < 0 || si >= SZ_ALL) continue;
    const c = Math.floor((off % SZ_LEN_MS) / SZ_CYCLE_MS);
    const s = seasons[si];
    s.n++;
    // unprocessed activities (time === null) carry their distance in movingDistance only
    if (isRunSport(e.sport)) s.km[c] += (e.distance || e.movingDistance || 0) / 1000;
    s.h[c] += (e.movingTime || 0) / 3600;
  }
  const now = Date.now();
  return seasons.map((s, si) => {
    if (!s.n) return { n: 0, km: null, h: null };
    const started = Math.min(13, Math.floor((now - (SZ_FIRST_TS + si * SZ_LEN_MS)) / SZ_CYCLE_MS) + 1);
    const cut = arr => arr.map((v, c) => c < started ? Math.round(v * 10) / 10 : null);
    return { n: s.n, km: cut(s.km), h: cut(s.h) };
  });
}

async function szLoadAll(onProgress) {
  const roster = await szLoadRoster();
  const queue  = roster.filter(a => !sz.agg[a.userId]);
  let done = roster.length - queue.length, failed = 0;
  const worker = async () => {
    while (queue.length) {
      const a = queue.shift();
      try {
        const raw = await apiFetchRetry(`/team/detail/${a.team}/athlete/${a.userId}/training-log`);
        sz.agg[a.userId] = szAggregate(Object.values(raw.results?.data || {}));
      } catch (_) { failed++; }
      onProgress(++done, roster.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return failed;
}

/* ── helpers ── */
const szSum   = a => a ? a.reduce((s, v) => s + (v || 0), 0) : null;
const szTotal = (ath, i) => szSum(ath.seasons[i][sz.metric]);

function szNode(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function szSvg(tag, attrs, parent) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

/* newest season with a non-zero value of the selected metric, and its change
   against the season right before it */
function szLatest(ath) {
  for (let i = szWindow().n - 1; i >= 0; i--) if (szTotal(ath, i) > 0) return i;
  return -1;
}
/* Number of finished cycles (0–13) of season index si */
function szDone(si) {
  return Math.max(0, Math.min(CYCLES_PER_YEAR,
    Math.floor((Date.now() - (SZ_FIRST_TS + (szWindow().off + si) * SZ_LEN_MS)) / SZ_CYCLE_MS)));
}
/* Change of the newest season against the one before it, over the cycles the
   newest one has finished (so a season in progress is not compared with a whole one) */
function szDelta(ath) {
  const li = szLatest(ath);
  if (li < 1) return null;
  const k = szDone(li);
  if (!k) return null;
  const head = i => szSum(ath.seasons[i][sz.metric]?.slice(0, k));
  const a = head(li - 1), b = head(li);
  return a && b != null ? b / a - 1 : null;
}
const szFmtDelta = d => d == null ? '—' : (d >= 0 ? '▲ +' : '▼ ') + (d * 100).toFixed(0) + ' %';

function szNiceMax(m) {
  const p    = Math.pow(10, Math.floor(Math.log10(Math.max(m, 1e-9) / 4)));
  const step = [1, 2, 5, 10].map(x => x * p).find(s => m / s <= 5) || p;
  return { step, max: Math.ceil(m / step) * step };
}

/* ── tooltip ── */
function szTip() {
  let t = document.getElementById('sz-tip');
  if (!t) { t = szNode('div'); t.id = 'sz-tip'; document.body.appendChild(t); }
  return t;
}
function szShowTip(ev, cycle, rows, fmt) {
  const t = szTip();
  t.replaceChildren(szNode('div', 'h', 'Cyklus ' + (cycle + 1)));
  rows.slice().reverse().forEach(r => {
    const d = szNode('div', 'r');
    const k = szSvg('svg', { viewBox: '0 0 14 6' });
    szSvg('line', { x1: 0, x2: 14, y1: 3, y2: 3, stroke: szLine(r.i).color,
                    'stroke-width': 2, 'stroke-dasharray': szLine(r.i).dash }, k);
    d.append(k, szNode('b', null, r.v == null ? '—' : fmt(r.v)), szNode('span', null, szLabels()[r.i]));
    t.appendChild(d);
  });
  t.style.display = 'block';
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + t.offsetWidth  > innerWidth  - 8) x = ev.clientX - t.offsetWidth  - 14;
  if (y + t.offsetHeight > innerHeight - 8) y = ev.clientY - t.offsetHeight - 14;
  t.style.left = x + 'px'; t.style.top = y + 'px';
}
function szHideTip() { szTip().style.display = 'none'; }

/* ── line chart (large for the detail, small for the grid) ── */
function szChart(ath, metric, o) {
  const big = !!o.big;
  const W = big ? 520 : 240, H = big ? 220 : 84;
  const ml = big ? 40 : 4, mr = big ? 58 : 4, mt = big ? 10 : 14, mb = big ? 24 : 14;
  const M   = SZ_METRIC[metric];
  const svg = szSvg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img',
                             'aria-label': `${ath.lastname} ${ath.firstname}: ${M.label} po cyklech a sezónách` });
  const series = ath.seasons.map((s, i) => ({ i, v: s[metric] })).filter(s => szSum(s.v) > 0);
  const top  = o.ymax != null ? o.ymax : Math.max(1, ...series.flatMap(s => s.v.filter(v => v != null)));
  const nm   = szNiceMax(top), ymax = nm.max;
  const X = c => ml + c * (W - ml - mr) / 12;
  const Y = v => mt + (1 - v / ymax) * (H - mt - mb);

  if (big) {
    for (let t = 0; t <= ymax + 1e-9; t += nm.step) {
      szSvg('line', { x1: ml, x2: W - mr, y1: Y(t), y2: Y(t), stroke: t === 0 ? 'var(--border)' : 'var(--border-sub)', 'stroke-width': 1 }, svg);
      szSvg('text', { x: ml - 6, y: Y(t) + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--text-muted)' }, svg).textContent = M.tick(t);
    }
    for (let c = 0; c < 13; c++)
      szSvg('text', { x: X(c), y: H - 6, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--text-muted)' }, svg).textContent = 'C' + (c + 1);
  } else {
    szSvg('line', { x1: ml, x2: W - mr, y1: Y(0), y2: Y(0), stroke: 'var(--border)', 'stroke-width': 1 }, svg);
    szSvg('text', { x: ml, y: 9, 'font-size': 10, fill: 'var(--text-muted)' }, svg).textContent = M.tick(ymax) + ' ' + M.unit;
    [0, 12].forEach(c =>
      szSvg('text', { x: X(c), y: H - 2, 'text-anchor': c ? 'end' : 'start', 'font-size': 10, fill: 'var(--text-muted)' }, svg).textContent = 'C' + (c + 1));
  }

  series.forEach(s => {
    const pts = s.v.map((v, c) => v == null ? null : X(c) + ',' + Y(v)).filter(Boolean);
    szSvg('polyline', { points: pts.join(' '), fill: 'none', stroke: szLine(s.i).color,
      'stroke-width': big ? szLine(s.i).w : szLine(s.i).w - 0.5, 'stroke-dasharray': szLine(s.i).dash,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
  });

  /* end-of-line dots; on the large chart also direct labels, nudged apart */
  const ends = series.map(s => {
    let c = 12; while (s.v[c] == null) c--;
    return { i: s.i, x: X(c), y: Y(s.v[c]) };
  });
  const newest = series.length ? series[series.length - 1].i : -1;
  ends.forEach(e => {
    if (big || e.i === newest)
      szSvg('circle', { cx: e.x, cy: e.y, r: big ? 4 : 3, fill: szLine(e.i).color, stroke: 'var(--surface)', 'stroke-width': 2 }, svg);
  });
  if (big) {
    const L = ends.map(e => ({ i: e.i, y: e.y })).sort((a, b) => a.y - b.y);
    for (let k = 1; k < L.length; k++) if (L[k].y - L[k - 1].y < 13) L[k].y = L[k - 1].y + 13;
    for (let k = L.length - 1; k >= 0; k--) {          // keep the stack above the x-axis
      const lim = H - mb - (L.length - 1 - k) * 13;
      if (L[k].y > lim) L[k].y = lim;
    }
    L.forEach(l => szSvg('text', { x: W - mr + 8, y: l.y + 4, 'font-size': 11, fill: 'var(--text-sec)' }, svg).textContent = szLabels()[l.i]);
  }

  /* hover: the crosshair snaps to the nearest cycle, one tooltip lists every season */
  const cross = szSvg('line', { y1: mt, y2: H - mb, stroke: 'var(--border)', 'stroke-width': 1, visibility: 'hidden' }, svg);
  const dots  = series.map(s => szSvg('circle', { r: big ? 4 : 3, fill: szLine(s.i).color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }, svg));
  const hit   = szSvg('rect', { x: ml - 6, y: 0, width: W - ml - mr + 12, height: H, fill: 'transparent' }, svg);
  if (o.onClick) hit.style.cursor = 'pointer';
  hit.addEventListener('pointermove', ev => {
    const r  = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * W / r.width;
    const c  = Math.max(0, Math.min(12, Math.round((px - ml) / ((W - ml - mr) / 12))));
    cross.setAttribute('x1', X(c)); cross.setAttribute('x2', X(c)); cross.setAttribute('visibility', 'visible');
    series.forEach((s, k) => {
      if (s.v[c] == null) { dots[k].setAttribute('visibility', 'hidden'); return; }
      dots[k].setAttribute('cx', X(c)); dots[k].setAttribute('cy', Y(s.v[c])); dots[k].setAttribute('visibility', 'visible');
    });
    szShowTip(ev, c, ath.seasons.map((s, i) => ({ i, v: s[metric] ? s[metric][c] : null })), M.fmt);
  });
  hit.addEventListener('pointerleave', () => {
    cross.setAttribute('visibility', 'hidden');
    dots.forEach(d => d.setAttribute('visibility', 'hidden'));
    szHideTip();
  });
  if (o.onClick) hit.addEventListener('click', o.onClick);
  return svg;
}

/* ── page ── */
function szRows() {
  let rows = sz.roster.filter(a => sz.agg[a.userId]).map(a => ({ ...a, seasons: sz.agg[a.userId].slice(szWindow().off, szWindow().end + 1) }));
  if (sz.who === 'current') rows = rows.filter(a => a.current);
  if (sz.who === 'former')  rows = rows.filter(a => !a.current);
  const name = a => `${a.lastname} ${a.firstname}`;
  if (sz.sort === 'name')  rows.sort((a, b) => name(a).localeCompare(name(b), 'cs'));
  if (sz.sort === 'delta') rows.sort((a, b) => (szDelta(b) ?? -9) - (szDelta(a) ?? -9));
  if (sz.sort === 'vol') {
    const si = szWindow().n - 1;           // the season picked in the header dropdown
    rows.sort((a, b) => (szTotal(b, si) || 0) - (szTotal(a, si) || 0));
  }
  return rows;
}

function szSeg(options, key, onChange) {
  const box = szNode('div', 'sz-seg');
  options.forEach(([v, label]) => {
    const b = szNode('button', null, label);
    b.dataset.v = v;
    b.setAttribute('aria-pressed', String(sz[key] === v));
    b.addEventListener('click', () => {
      sz[key] = v;
      box.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      onChange();
    });
    box.appendChild(b);
  });
  return box;
}
function szSelect(label, options, key, onChange) {
  const l = szNode('label', 'sz-fl', label);
  const s = szNode('select');
  options.forEach(([v, t]) => { const o = szNode('option', null, t); o.value = v; s.appendChild(o); });
  s.value = sz[key];
  s.addEventListener('change', () => { sz[key] = s.value; onChange(); });
  l.appendChild(s);
  return l;
}

async function renderSeasons() {
  sz.active = true;
  szHideTip();
  const main = document.getElementById('main');
  const box = szNode('div', 'state-box');
  const msg = szNode('div', null, 'Načítám sportovce…');
  box.append(szNode('div', 'spinner'), msg);
  main.replaceChildren(box);

  let failed = 0;
  try {
    failed = await szLoadAll((done, total) => { msg.textContent = `Načítám tréninkové deníky… ${done}/${total}`; });
  } catch (e) {
    if (!sz.active) return;
    const err = szNode('div', 'state-box');
    const retry = szNode('button', 'ghost', 'Zkusit znovu');
    retry.addEventListener('click', renderSeasons);
    err.append(szNode('div', 'err-txt', 'Chyba: ' + e.message), retry);
    main.replaceChildren(err);
    return;
  }
  if (!sz.active) return;

  const root = szNode('div', 'sz-wrap');
  const bar  = szNode('div', 'sz-bar');
  const detail = szNode('section', 'sz-card');
  const title  = szNode('div', 'sz-sec');
  const list   = szNode('div');

  const legend = szNode('div', 'sz-legend');
  szLabels().forEach((l, i) => {
    const sp = szNode('span');
    const k  = szSvg('svg', { viewBox: '0 0 22 8' });
    szSvg('line', { x1: 0, x2: 22, y1: 4, y2: 4, stroke: szLine(i).color, 'stroke-width': szLine(i).w, 'stroke-dasharray': szLine(i).dash }, k);
    sp.append(k, document.createTextNode(l));
    legend.appendChild(sp);
  });

  const nCur = sz.roster.filter(a => a.current).length;
  const draw = () => { drawDetail(); drawList(); };
  bar.append(
    szSeg([['km', 'Běh km'], ['h', 'Zátěž']], 'metric', draw),
    szSeg([['charts', 'Grafy'], ['table', 'Tabulka']], 'view', drawList),
    szSelect('Škála', [['own', 'vlastní u každého'], ['shared', 'společná']], 'scale', drawList),
    szSelect('Řazení', [['vol', 'objem'], ['delta', 'změna oproti předchozí sezóně'], ['name', 'jméno']], 'sort', drawList),
    szSelect('Sportovci', [['all', `všichni (${sz.roster.length})`], ['current', `současní (${nCur})`], ['former', `bývalí (${sz.roster.length - nCur})`]], 'who', draw),
    legend
  );

  function pick(id) { sz.sel = id; drawDetail(); drawList(); }

  function drawDetail() {
    detail.replaceChildren();
    const rows = szRows();
    if (!rows.some(a => a.userId === sz.sel)) sz.sel = rows.length ? rows[0].userId : null;
    const ath = rows.find(a => a.userId === sz.sel);
    if (!ath) { detail.appendChild(szNode('div', 'sz-note', 'Žádní sportovci k zobrazení.')); return; }

    const head = szNode('div', 'sz-dhead');
    head.appendChild(szNode('h2', null, `${ath.lastname} ${ath.firstname}`));
    const pills = szNode('div', 'sz-pills');
    ['km', 'h'].forEach(m => {
      const parts = ath.seasons.map((s, i) => s[m] ? `${szLabels()[i]}: ${SZ_METRIC[m].tot(szSum(s[m]))} ${SZ_METRIC[m].unit}` : null).filter(Boolean);
      const p = szNode('span');
      p.append(szNode('b', null, SZ_METRIC[m].label + ' celkem  '), document.createTextNode(parts.join('  ·  ') || 'bez dat'));
      pills.appendChild(p);
    });
    head.appendChild(pills);

    const charts = szNode('div', 'sz-charts');
    ['km', 'h'].forEach(m => {
      const c = szNode('div');
      c.append(szNode('p', 'sz-ctitle', `${SZ_METRIC[m].label}${m === 'h' ? ' (h)' : ''} za cyklus (4 týdny)`), szChart(ath, m, { big: true }));
      charts.appendChild(c);
    });
    detail.append(head, charts);
  }

  function drawList() {
    list.replaceChildren();
    const rows = szRows();
    const M    = SZ_METRIC[sz.metric];
    title.textContent = `${rows.length} sportovců · ${M.label} po cyklech · klikněte na sportovce pro detail`;

    if (sz.view === 'charts') {
      const ymax = sz.scale === 'shared'
        ? Math.max(1, ...rows.flatMap(a => a.seasons.flatMap(s => (s[sz.metric] || []).filter(v => v != null))))
        : null;
      const grid = szNode('div', 'sz-grid');
      rows.forEach(a => {
        const card = szNode('div', 'sz-card sz-mini');
        card.setAttribute('role', 'button'); card.tabIndex = 0;
        if (a.userId === sz.sel) card.setAttribute('aria-current', 'true');
        const top = szNode('div', 'nm');
        const nm  = szNode('span', null, `${a.lastname} ${a.firstname}`);
        if (!a.current) nm.appendChild(szNode('span', 'sz-tag', 'bývalý'));
        top.append(nm, szNode('span', 'dl', szFmtDelta(szDelta(a))));
        const li  = szLatest(a);
        const tot = szNode('div', 'tot', li < 0 ? 'bez dat' : `${szLabels()[li]}: ${M.tot(szTotal(a, li))} ${M.unit}`);
        card.append(top, tot, szChart(a, sz.metric, { big: false, ymax, onClick: () => pick(a.userId) }));
        card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(a.userId); } });
        grid.appendChild(card);
      });
      list.appendChild(grid);
    } else {
      const wrap = szNode('div', 'sz-card');
      const tb = szNode('table', 'sz-table');
      const hr = szNode('tr');
      ['Sportovec', ...szLabels(), 'Změna vs předchozí sezóna'].forEach(t => hr.appendChild(szNode('th', null, t)));
      tb.appendChild(szNode('thead')).appendChild(hr);
      const body = szNode('tbody');
      rows.forEach(a => {
        const tr = szNode('tr');
        tr.tabIndex = 0;
        if (a.userId === sz.sel) tr.setAttribute('aria-current', 'true');
        const first = szNode('td', null, `${a.lastname} ${a.firstname}`);
        if (!a.current) first.appendChild(szNode('span', 'sz-tag', 'bývalý'));
        tr.appendChild(first);
        for (let i = 0; i < szWindow().n; i++) {
          const v = szTotal(a, i);
          tr.appendChild(szNode('td', v == null ? 'dim' : null, v == null ? '—' : M.tot(v)));
        }
        const d = szDelta(a);
        tr.appendChild(szNode('td', d == null ? 'dim' : null, szFmtDelta(d)));
        tr.addEventListener('click', () => pick(a.userId));
        tr.addEventListener('keydown', e => { if (e.key === 'Enter') pick(a.userId); });
        body.appendChild(tr);
      });
      tb.appendChild(body); wrap.appendChild(tb); list.appendChild(wrap);
    }
  }

  root.appendChild(bar);
  if (failed) {
    const w = szNode('div', 'sz-warn');
    w.appendChild(document.createTextNode(`${failed} sportovců se nepodařilo načíst (výpadek spojení). `));
    const b = szNode('button', 'ghost', 'Zkusit znovu');
    b.addEventListener('click', renderSeasons);
    w.appendChild(b);
    root.appendChild(w);
  }
  const units = szNode('p', 'sz-note', UNITS_NOTE);
  units.style.margin = '0 0 14px';
  root.append(units, detail, title, list,
    szNode('p', 'sz-note', 'Sezóna = 52 týdnů od pondělí, cykly po 4 týdnech od ' + fmtDateObj(new Date(SZ_ANCHOR_TS)) +
      ' (a o násobky 52 týdnů zpět). Zobrazuje se sezóna vybraná v hlavičce a až 3 před ní. Změna porovnává jen cykly, které už nejnovější zobrazená sezóna dokončila, se stejnými cykly předchozí sezóny. Nemocné dny se z deníku zrekonstruovat nedají.'));
  main.replaceChildren(root);
  drawDetail(); drawList();
}

/* ── Plan vs. reality ──────────────────────────────────────────
   Compares the planned running km per cycle (plan.json, one value per level)
   with the km actually logged by one athlete this training year. The level
   an athlete trains in is picked here and only remembered in this browser. */

const pv = { plan: null, level: {}, uid: null, cache: {} };

const pvStartTs = s => Date.parse(s.start + 'T00:00:00Z');
/* "27.10.–23.11.2025" for the cycle with 0-based index c of a season */
function pvRange(s, c) {
  const a = new Date(pvStartTs(s) + c * WEEKS_PER_CYCLE * WEEK_MS);
  const b = new Date(a.getTime() + (WEEKS_PER_CYCLE * WEEK_MS - DAY_MS));
  const d = x => `${x.getUTCDate()}.${x.getUTCMonth() + 1}.`;
  return `${d(a)} – ${d(b)}${b.getUTCFullYear()}`;
}

async function pvLoadPlan() {
  if (pv.plan) return pv.plan;
  const r = await fetch(chrome.runtime.getURL('plan.json'));
  pv.plan = await r.json();
  return pv.plan;
}

/* Per-week running km and activity count of this training year, from the athlete's log */
async function pvLoadWeeks(a, season) {
  const key = season.year + ':' + a.userId;
  if (pv.cache[key]) return pv.cache[key];
  const t0 = pvStartTs(season);
  const raw   = await apiFetchRetry(`/team/detail/${a.team}/athlete/${a.userId}/training-log`);
  const weeks = Array.from({ length: CYCLES_PER_YEAR * WEEKS_PER_CYCLE }, () => ({ km: 0, n: 0 }));
  for (const e of Object.values(raw.results?.data || {})) {
    const d = (e.startDate || e.date || '').slice(0, 10);
    if (!d) continue;
    const wi = Math.floor((Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - t0) / WEEK_MS);
    if (wi < 0 || wi >= weeks.length) continue;
    weeks[wi].n++;
    if (isRunSport(e.sport)) weeks[wi].km += (e.distance || e.movingDistance || 0) / 1000;
  }
  return (pv.cache[key] = weeks);
}

/* Planned (line) vs. actual (bars) km per cycle; one axis, both in km */
function pvChart(S, data) {
  const W = 760, H = 240, ml = 40, mr = 12, mt = 12, mb = 38;
  const n   = data.length;
  const top = Math.max(1, ...data.map(d => Math.max(d.pl, d.started ? d.real : 0)));
  const nm  = szNiceMax(top), ymax = nm.max;
  const slot = (W - ml - mr) / n, bw = Math.min(28, slot * 0.5);
  const X = i => ml + slot * (i + 0.5);
  const Y = v => mt + (1 - v / ymax) * (H - mt - mb);

  const wrap = szNode('div', 'sz-card pv-chart');
  const legend = szNode('div', 'sz-legend pv-legend');
  const sw1 = szNode('span'); sw1.append(szNode('i', 'pv-sw-bar'), document.createTextNode('Skutečnost (km běhu)'));
  const sw2 = szNode('span'); sw2.append(szNode('i', 'pv-sw-line'), document.createTextNode('Plán'));
  legend.append(sw1, sw2);
  wrap.appendChild(legend);

  const svg = szSvg('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img',
                             'aria-label': 'Plánované a skutečné kilometry po cyklech' });
  for (let t = 0; t <= ymax + 1e-9; t += nm.step) {
    szSvg('line', { x1: ml, x2: W - mr, y1: Y(t), y2: Y(t), stroke: t === 0 ? 'var(--border)' : 'var(--border-sub)', 'stroke-width': 1 }, svg);
    szSvg('text', { x: ml - 6, y: Y(t) + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'var(--text-muted)' }, svg).textContent = String(t);
  }
  data.forEach((d, i) => {
    szSvg('text', { x: X(i), y: H - 20, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--text-muted)' }, svg).textContent = d.c.label;
    if (d.gaps) {
      szSvg('circle', { cx: X(i), cy: H - 8, r: 3, fill: 'var(--alert)' }, svg);
      szSvg('text', { x: X(i) + 7, y: H - 4.5, 'font-size': 10, fill: 'var(--text-sec)' }, svg).textContent = d.gaps + '×';
    }
    if (d.started && d.real > 0) {
      const y = Y(d.real), h = Y(0) - y, r = Math.min(4, bw / 2, h);
      szSvg('path', { d: `M${X(i) - bw / 2},${Y(0)} V${y + r} Q${X(i) - bw / 2},${y} ${X(i) - bw / 2 + r},${y} H${X(i) + bw / 2 - r} Q${X(i) + bw / 2},${y} ${X(i) + bw / 2},${y + r} V${Y(0)} Z`,
                  fill: 'var(--accent)', opacity: d.finished ? 1 : 0.45 }, svg);
    }
  });
  szSvg('polyline', { points: data.map((d, i) => X(i) + ',' + Y(d.pl)).join(' '), fill: 'none',
                      stroke: 'var(--text)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
  data.forEach((d, i) =>
    szSvg('circle', { cx: X(i), cy: Y(d.pl), r: 4, fill: 'var(--text)', stroke: 'var(--surface)', 'stroke-width': 2 }, svg));

  /* hover: one column per cycle, tooltip with plan, actual and gaps */
  const band = szSvg('rect', { y: mt, height: H - mt - mb, width: slot, fill: 'var(--hover)', visibility: 'hidden' }, svg);
  const hit  = szSvg('rect', { x: ml, y: 0, width: W - ml - mr, height: H, fill: 'transparent' }, svg);
  hit.addEventListener('pointermove', ev => {
    const r = svg.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.floor(((ev.clientX - r.left) * W / r.width - ml) / slot)));
    const d = data[i];
    band.setAttribute('x', ml + slot * i); band.setAttribute('visibility', 'visible');
    const t = szTip();
    t.replaceChildren(szNode('div', 'h', `Cyklus ${d.c.label} · ${pvRange(S, i)}`));
    const row = (k, v) => { const e = szNode('div', 'r'); e.append(szNode('b', null, v), szNode('span', null, k)); t.appendChild(e); };
    row('plán', d.pl + ' km');
    row('skutečnost', d.started ? d.real.toFixed(1) + ' km' + (d.finished ? ` (${Math.round(d.real / d.pl * 100)} %)` : ' (probíhá)') : '—');
    if (d.gaps) row('týdny bez aktivity', String(d.gaps));
    t.style.display = 'block';
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + t.offsetWidth  > innerWidth  - 8) x = ev.clientX - t.offsetWidth  - 14;
    if (y + t.offsetHeight > innerHeight - 8) y = ev.clientY - t.offsetHeight - 14;
    t.style.left = x + 'px'; t.style.top = y + 'px';
  });
  hit.addEventListener('pointerleave', () => { band.setAttribute('visibility', 'hidden'); szHideTip(); });
  wrap.appendChild(svg);
  return wrap;
}

async function renderPlan() {
  sz.active = true;                        // same guard against late async renders
  const main = document.getElementById('main');
  const box  = szNode('div', 'state-box');
  const msg  = szNode('div', null, 'Načítám plán a sportovce…');
  box.append(szNode('div', 'spinner'), msg);
  main.replaceChildren(box);

  let plan, roster;
  try {
    [plan, roster] = await Promise.all([pvLoadPlan(), szLoadRoster()]);
    const stored = await chrome.storage.local.get('planLevels');
    pv.level = stored.planLevels || pv.level;
  } catch (e) {
    const err = szNode('div', 'state-box');
    const retry = szNode('button', 'ghost', 'Zkusit znovu');
    retry.addEventListener('click', renderPlan);
    err.append(szNode('div', 'err-txt', 'Chyba: ' + e.message), retry);
    main.replaceChildren(err);
    return;
  }
  if (!sz.active) return;

  /* the plan of the training year picked in the header dropdown (matched by its Monday start) */
  const planSeason = () => plan.seasons.find(s => s.start === season.start);

  const athletes = roster.slice().sort((x, y) => x.lastname.localeCompare(y.lastname, 'cs'));
  if (!athletes.some(a => a.userId === pv.uid)) pv.uid = athletes.length ? athletes[0].userId : null;

  const root = szNode('div', 'sz-wrap');
  const bar  = szNode('div', 'sz-bar');
  const out  = szNode('div');

  const who = szNode('label', 'sz-fl', 'Sportovec');
  const whoSel = szNode('select');
  athletes.forEach(a => {
    const o = szNode('option', null, `${a.lastname} ${a.firstname}${a.current ? '' : ' (bývalý)'}`);
    o.value = a.userId; whoSel.appendChild(o);
  });
  whoSel.value = pv.uid;
  who.appendChild(whoSel);

  const lv = szNode('label', 'sz-fl', 'Úroveň v plánu');
  const lvSel = szNode('select');
  lv.appendChild(lvSel);

  const lvKey = () => planSeason().year + ':' + pv.uid;
  const syncLevel = () => {
    lvSel.replaceChildren();
    const P = planSeason();
    lv.style.display = P ? '' : 'none';
    if (!P) return;
    P.levels.forEach(l => { const o = szNode('option', null, l); o.value = l; lvSel.appendChild(o); });
    lvSel.value = pv.level[lvKey()] || P.levels[0];
  };
  whoSel.addEventListener('change', () => { pv.uid = +whoSel.value; syncLevel(); draw(); });
  lvSel.addEventListener('change', async () => {
    pv.level[lvKey()] = lvSel.value;
    await chrome.storage.local.set({ planLevels: pv.level });
    draw();
  });
  syncLevel();
  bar.append(who, lv);

  async function draw() {
    const a = athletes.find(x => x.userId === pv.uid);
    if (!a) { out.replaceChildren(szNode('div', 'sz-note', 'Žádní sportovci k zobrazení.')); return; }
    const S = planSeason();
    if (!S) { out.replaceChildren(szNode('div', 'sz-note', `Plán pro sezónu ${season.label} zatím není v plan.json.`)); return; }
    out.replaceChildren(szNode('div', 'sz-note', 'Načítám tréninkový deník…'));
    let weeks;
    const t0 = pvStartTs(S);
    try { weeks = await pvLoadWeeks(a, S); }
    catch (e) { if (pv.uid === a.userId) out.replaceChildren(szNode('div', 'sz-warn', 'Deník se nepodařilo načíst: ' + e.message)); return; }
    if (pv.uid !== a.userId || planSeason() !== S || !sz.active) return;

    const level = pv.level[lvKey()] || S.levels[0];
    const now   = Date.now();
    const tb    = szNode('table', 'sz-table');
    const hr    = szNode('tr');
    ['Cyklus', 'Plán km', 'Skutečnost km', 'Rozdíl', '% plánu', 'Týdny (běh)'].forEach(t => hr.appendChild(szNode('th', null, t)));
    tb.appendChild(szNode('thead')).appendChild(hr);
    const body = szNode('tbody');
    let sumPlan = 0, sumReal = 0, gaps = 0;
    const data = [];

    S.cycles.forEach(c => {
      const w0   = (c.n - 1) * WEEKS_PER_CYCLE;
      const ws   = weeks.slice(w0, w0 + WEEKS_PER_CYCLE);
      const real = ws.reduce((s, w) => s + w.km, 0);
      const pl   = c.km[level];
      const started  = t0 + w0 * WEEK_MS <= now;
      const finished = t0 + (w0 + WEEKS_PER_CYCLE) * WEEK_MS <= now;
      const tr = szNode('tr');
      tr.style.cursor = 'default';
      tr.appendChild(szNode('td', null, `${c.label} · ${pvRange(S, c.n - 1)}`));
      tr.appendChild(szNode('td', null, String(pl)));
      if (!started) {
        ['—', '—', '—'].forEach(t => tr.appendChild(szNode('td', 'dim', t)));
      } else {
        tr.appendChild(szNode('td', null, real.toFixed(1) + (finished ? '' : ' (probíhá)')));
        tr.appendChild(szNode('td', finished ? null : 'dim', finished ? (real - pl >= 0 ? '+' : '') + (real - pl).toFixed(0) : '—'));
        tr.appendChild(szNode('td', finished ? null : 'dim', finished ? Math.round(real / pl * 100) + ' %' : '—'));
        if (finished) { sumPlan += pl; sumReal += real; }
      }
      const strip = szNode('td', 'pv-strip');
      const d = { c, pl, real, started, finished, gaps: 0 };
      data.push(d);
      ws.forEach((w, i) => {
        const wStart = t0 + (w0 + i) * WEEK_MS;
        const past = wStart + WEEK_MS <= now;
        const empty = past && w.n === 0, noRun = past && w.n > 0 && w.km === 0;
        if (empty) { gaps++; d.gaps++; }
        const chip = szNode('span', 'pv-chip' + (!past && wStart > now ? ' fut' : '') + (empty ? ' gap' : noRun ? ' norun' : ''),
                            wStart > now ? '·' : w.km.toFixed(0));
        chip.title = empty ? 'bez jakékoli aktivity' : noRun ? 'aktivity, ale žádný běh' : `${w.km.toFixed(1)} km běhu`;
        strip.appendChild(chip);
      });
      tr.appendChild(strip);
      body.appendChild(tr);
    });
    tb.appendChild(body);

    const wrap = szNode('div', 'sz-card'); wrap.appendChild(tb);
    const sum = szNode('p', 'sz-note',
      `Dokončené cykly: plán ${sumPlan} km, skutečnost ${sumReal.toFixed(0)} km` +
      (sumPlan ? ` (${Math.round(sumReal / sumPlan * 100)} % plánu)` : '') +
      `. Týdnů bez jakékoli aktivity: ${gaps}.`);
    out.replaceChildren(pvChart(S, data), sum, wrap,
      szNode('p', 'sz-note', 'Plán je z přehledu objemů (plánované km na cyklus). Týdenní plán v km neexistuje, proto se porovnává po cyklech. ' +
        'Týden bez aktivity může být nemoc, zranění i pauza – z deníku se to rozlišit nedá. Zvýrazněné týdny: červeně bez aktivity, žlutě bez běhu.'));
  }

  root.append(bar, out);
  main.replaceChildren(root);
  draw();
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
  sz.active = false;
  szHideTip();
  document.querySelectorAll('.ath-item').forEach(el => el.classList.remove('active'));
  document.getElementById('nav-seasons').classList.remove('active');
  document.getElementById('nav-plan').classList.remove('active');
  document.getElementById('nav-totals').classList.add('active');
  renderTotals();
});

document.getElementById('nav-seasons').addEventListener('click', e => {
  e.preventDefault();
  if (!state.token) return;
  state.selected = null;
  document.querySelectorAll('.ath-item').forEach(el => el.classList.remove('active'));
  document.getElementById('nav-totals').classList.remove('active');
  document.getElementById('nav-plan').classList.remove('active');
  document.getElementById('nav-seasons').classList.add('active');
  renderSeasons();
});

document.getElementById('nav-plan').addEventListener('click', e => {
  e.preventDefault();
  if (!state.token) return;
  state.selected = null;
  szHideTip();
  document.querySelectorAll('.ath-item').forEach(el => el.classList.remove('active'));
  document.getElementById('nav-totals').classList.remove('active');
  document.getElementById('nav-seasons').classList.remove('active');
  document.getElementById('nav-plan').classList.add('active');
  renderPlan();
});

document.getElementById('btn-reset').addEventListener('click', async () => {
  await chrome.storage.local.remove('token');
  Object.assign(state, { token: null, athletes: [], selected: null, cache: {}, expCyc: {}, expWk: {} });
  Object.assign(sz, { active: false, roster: null, agg: {}, sel: null });
  Object.assign(pv, { uid: null, cache: {} });
  useSeason(SEASONS.filter(s => s.start <= new Date().toISOString().slice(0, 10)).pop() || SEASONS[0]);
  document.getElementById('nav-seasons').classList.remove('active');
  document.getElementById('nav-totals').classList.remove('active');
  document.getElementById('nav-plan').classList.remove('active');
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
