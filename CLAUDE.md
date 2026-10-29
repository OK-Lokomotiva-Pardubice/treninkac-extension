# Tréninkáč Dashboard – Chrome Extension

Chrome extension (Manifest V3) providing an alternative training-data dashboard for team **Dorost LPU** (team ID `117`) from the Tréninkáč app.

## Architecture

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest, permissions: `storage`, `scripting`, `tabs` |
| `background.js` | Service worker — opens `dashboard.html` as a full tab on icon click |
| `dashboard.html` | Full-viewport page; all CSS is inline in a `<style>` block, no external assets |
| `popup.js` | All application logic — data fetching, cache, rendering |
| `plan.json` | Planned running km per cycle and level (kasper+, kasper, emil, simone), one entry per training year in `seasons[]` (`year`, `start` = Monday of C1, `levels`, `cycles[{n,label,km}]`). Loaded by the Plán vs. realita page; add a new object per year |

There is no build step. Edit the files directly and reload the extension at `chrome://extensions`.

## API

```
Base: https://treninkac-api.orientacnisporty.cz/api
Auth: Bearer token stored in chrome.storage.local under key "token"
      (read from localStorage.trainee.token on the treninkac tab)

Endpoints used:
  GET /team/117/stats                                      → athlete list
  GET /team/detail/117/athlete/:uid                        → Tréninkáč weekly/cycle statistics + sport stats (not the training plan)
  GET /team/detail/117/athlete/:uid/training-log           → individual activity log
  GET /team/detail/117/athlete/:uid/calendar               → results.data.activityList[]: events of type activity | sickness | regeneration (sickness = a from–to record, `start`/`end`)
  GET /team/{117,108,8}/stats                              → rosters for the Sezóny page
  GET /team/detail/{team}/athlete/:uid/training-log        → same log, fetched via the team the athlete belongs to
```

Training years are listed in `SEASONS` (`popup.js`: `label`, `team`, `start`, `end`). A header dropdown picks the year shown on the athlete, totals and calendar pages (`useSeason` sets `TEAM_ID`, `SEASON_START/END`, …); the default is the year containing today. Activities outside the selected range are filtered out. Sezóny follows the dropdown too (it shows that year and up to 3 before it, never later ones); Plán uses the dropdown too (plan season matched by `start`; a year without a `plan.json` entry shows a note).
**New season checklist:** append an entry to `SEASONS` (Monday start, end = the Sunday 363 days later). If Tréninkáč just moves the existing team's from–to range (as happened for team 117 in 2026), set `stats: false` on the previous year's entry — the team's statistics then only describe the newest year (they are keyed by ISO week, so they would be mixed up), and that year is computed from the log and calendar alone. A year with its own team just sets `team`. Add a `plan.json` season when the plan arrives.

### Seasons are separate teams
Every training year is its own team: `8` = 2022-10-31..2023-10-29, `108` = 2023-10-30..2024-10-27, `117` = 2025-10-27..2026-10-25 until Oct 2026, when its range was moved to 2026-10-26..2027-10-24 (same team, no new ID). The 2024/25 team no longer exists. The training log endpoint ignores period parameters and returns the athlete's **whole history**, so cross-season numbers are rebuilt from the log alone (the statistics endpoint is per team and is the only source of sick days).

### Unprocessed ("nezp") activities
Entries with `time === null && movingTime != null`. They have `sport`, `name`, `startDate`, `movingTime` and `movingDistance`, but **no `distance`**. Always read distance as `distance || movingDistance`.

### km vs Zátěž
**Běh km** counts only running sports (`isRunSport`), also for unprocessed activities and weeks without statistics. **Zátěž** sums the time of all sports. Both include unprocessed activities (explained in `UNITS_NOTE`, shown on the Celkové součty and Sezóny pages).

### Flaky network
Short outages are frequent. The Sezóny page loads through `apiFetchRetry` (15 s timeout, up to 5 attempts for network and 5xx errors). `apiFetch` (used elsewhere) does not retry.

### Getting the token

Open the Tréninkáč app in Chrome, then run in DevTools console:

```js
JSON.parse(localStorage.getItem('trainee')).token
```

Copy the resulting `eyJ…` string and use it as `<TOKEN>` below.

### Example requests

**curl**

```bash
TOKEN="eyJ..."

# Athlete list
curl -s \
  -H "Authorization: Bearer $TOKEN" \
  "https://treninkac-api.orientacnisporty.cz/api/team/117/stats"

# Tréninkáč cycle/week statistics + sport stats for one athlete
curl -s \
  -H "Authorization: Bearer $TOKEN" \
  "https://treninkac-api.orientacnisporty.cz/api/team/detail/117/athlete/12345"

# Training log for one athlete
curl -s \
  -H "Authorization: Bearer $TOKEN" \
  "https://treninkac-api.orientacnisporty.cz/api/team/detail/117/athlete/12345/training-log"
```

Replace `12345` with a real `userId` from the `/stats` response (`results.data.stats[].userId`).

**Postman**

1. Create a new request, set method to **GET**.
2. URL: `https://treninkac-api.orientacnisporty.cz/api/team/117/stats`
3. Tab **Authorization** → Type: **Bearer Token** → paste `<TOKEN>`.
4. Click **Send**.

For the other two endpoints substitute the URL; no request body is needed for any endpoint (all GET).

## Data model (`buildCache`)

`buildCache(detailRaw, logRaw)` returns `{ cycleData, nezp, activsByWeek }`.

**`activsByWeek`** — keyed `"${cycleNum}-${weekNum}"` → activity array.

**`cycleData`** — array of cycle objects, one per calendar cycle that has any data:
```js
{
  num,               // 1–13
  mon, sun,          // UTC Dates — first Monday / last Sunday of the cycle
  hasNezp,           // true if any week in cycle has nezp activities
  DZ, FA, ZA, NE, runDist, zatSec,
  weeks: [{ week, isoYear, mon, sun, hasNezp, DZ, FA, ZA, NE, runDist, zatSec }]
}
```
`week` is the ISO week number (the label shown as `T44`, and the key the statistics API uses); `mon`/`sun` are the authoritative dates.

Terminology: "statistics" = what the API returns for an athlete (`weekOverview`, `sumByWeeks`, `sickDaysInCycles`; computed by Tréninkáč from processed activities). The **training plan** is something else: `plan.json`.

**Week with statistics** (a `weekOverview` row exists for its ISO week) — stats = statistics + nezp activity contributions (processed activities are already inside the statistics).  
**Week without statistics** — no row, so stats are computed entirely from that week's activities.  
**NE (sick days)** comes from the **calendar** endpoint, not from the statistics: every `type: "sickness"` event (a from–to period entered by hand in Tréninkáč) is expanded into days (`calSickDates`) and counted per calendar week. An `end` at exactly 00:00 on a later day is treated as exclusive, anything else as inclusive (an assumption — check it against a known sickness). If the calendar fetch fails or has an unexpected shape, NE falls back to `max(sickdays from sickDaysInCycles, distinct days with an activity flagged isSick)` and the athlete header shows a red "NE ze statistik" pill. `buildCache` also returns `sickDates` (Set of YYYY-MM-DD) for the calendar view.

### Activity fields (normalised inside `buildCache`)
```js
{
  _date, date,       // YYYY-MM-DD (startDate || date)
  sortKey,           // for intra-day ordering
  sport, name, note,
  nezp,              // time===null && movingTime!=null
  isRace, isSick,
  dist,              // metres (distance || movingDistance)
  movTime,           // seconds (movingTime)
}
```

### Cycle calendar — the one rule that matters
Cycles are **driven by the calendar, never by the athlete's activities or by the API's own cycle grouping**
(that grouping drifts per athlete whenever statistics weeks are missing, which is why it is discarded).

* The training year starts Monday `SEASON_START` (`2025-10-27`, ISO 2025-W44).
* Every cycle spans exactly **4 consecutive weeks**, always all 4 — empty weeks included.
* **13 cycles = 52 weeks** per training year; after C13 a new training year begins again at C1.

So C1 = 27.10.2025–23.11.2025, C9 = 08.06.2026–05.07.2026, C13 = 28.09.2026–25.10.2026 — identical for every athlete.

Internally everything is keyed by the **absolute week index** `wi` (0–51) since `SEASON_START`:
`weekIndexOf(dateStr)` → `wi`, `weekMonday(wi)` → UTC Date, cycle index = `Math.floor(wi / WEEKS_PER_CYCLE)`,
cycle number = `(cycleIdx % CYCLES_PER_YEAR) + 1`. ISO week numbers are only labels and statistics-API keys,
resolved via `isoWeekOfTs(ts)`; no year guessing is involved.

## Key functions in `popup.js`

| Function | Purpose |
|----------|---------|
| `buildCache(detailRaw, logRaw)` | Normalise + cache all data for one athlete |
| `renderSidebar()` | Render athlete list in `<aside>` |
| `selectAthlete(uid)` | Load (if needed) + render athlete detail |
| `renderMain(uid)` | Render cycle/week/activity table for athlete |
| `renderTotals()` | Load all athletes + render sortable totals table |
| `renderSeasons()` | Sezóny page: load rosters + logs, render controls, detail charts and grid/table |
| `szLoadAll(onProgress)` / `szLoadRoster()` | Fetch athletes of teams 117/108/8 (deduplicated by userId) and their logs, 6 in parallel |
| `szAggregate(entries)` | Sum a log into per-cycle running km and load hours for each of the `SZ_ALL` (5) aggregated seasons; `szWindow()` picks the `SZ_COUNT` (4) shown ones, ending at the header-dropdown season |
| `szChart(ath, metric, opts)` | SVG line chart (large detail or small grid card) with crosshair + tooltip |
| `apiFetchRetry(path)` | `apiFetch` with timeout and retries for short outages |
| `weekIndexOf(dateStr)` | Absolute week index (0-based) of a `YYYY-MM-DD` date since `SEASON_START` |
| `weekMonday(wi)` | UTC Date of the Monday of absolute week index `wi` |
| `isoWeekOfTs(ts)` | `{ year, week }` — ISO week number + ISO year of a UTC timestamp |
| `fmtDateObj(d)` | Format a Date object as `DD.MM.YYYY` (UTC) |
| `fmtDate(dateStr)` | Format a `YYYY-MM-DD` string as `Po 27.10.` (Czech day name + short date) — **used for activity rows** |
| `buildActRows(acts, isOpen)` | Render `<tr>` rows for individual activities |

> ⚠️ `fmtDate` and `fmtDateObj` are two different functions. `fmtDate` takes a **string** and returns Czech day-name format. `fmtDateObj` takes a **Date object** and returns `DD.MM.YYYY`. Do not confuse them.

## CSS conventions (dashboard.html)

All CSS lives in the `<style>` block in `dashboard.html`. Key classes:

| Class | Meaning |
|-------|---------|
| `.cr` | Cycle row (`<tr>`) |
| `.wr` | Week row (`<tr>`) |
| `.cr.has-nezp .cy-tag` | Red cycle name when cycle has nezp activities |
| `.wr.has-nezp .wk-cell` | Red week name when week has nezp activities |
| `.cy-tag` | Cycle label span (e.g. "C5") |
| `.cy-dates` | Date range span next to cycle/week label (muted, small) |
| `.cy-copy` | Clipboard copy button on cycle row (hidden until hover) |
| `.totals-table` | Table on the Celkové součty page |
| `.sz-*` | Sezóny page (`.sz-wrap`, `.sz-bar`, `.sz-card`, `.sz-mini`, `.sz-table`, …); `#sz-tip` is the chart tooltip |

CSS uses CSS variables (`--accent`, `--text`, `--text-muted`, `--surface`, `--border`, `--alert`, …) and supports both light and dark themes via `@media (prefers-color-scheme: dark)` and `[data-theme]` overrides.

## State

```js
state = {
  token,
  athletes,          // sorted by lastname
  selected,          // userId of active athlete (null on totals page)
  cache,             // userId → { cycleData, nezp, activsByWeek }
  expCyc,            // userId → Set<cycleNum>  (expanded cycles)
  expWk,             // userId → Set<"cycleNum-weekNum">  (expanded weeks)
}

sz = {               // Sezóny page
  active,            // false when another page replaced it (stops late renders)
  roster,            // [{ userId, firstname, lastname, team, current }] from teams 117/108/8
  agg,               // userId → per-season { n, km[13], h[13] }, oldest → newest
  metric, view, scale, sort, who, sel   // UI state; sort defaults to 'vol'
}
```

## Features summary

- Cycle/week drill-down with expandable activity rows
- Activity name links to detail page on treninkac.orientacnisporty.cz
- Cycles fixed by the calendar (4 weeks each, 13 per training year) — same boundaries for every athlete
- Activities in weeks without statistics still counted, in their calendar cycle
- Nezpracované (unprocessed) activities counted into week/cycle sums
- Red highlighting on cycle/week names when nezp activities present
- Date range (DD.MM.YYYY – DD.MM.YYYY) shown next to cycle and week names
- ⎘ copy button on cycle rows — copies DZ/FA/ZA/NE/Zátěž/Běh km as TSV for Google Sheets
- **Celkové součty** page: all athletes loaded in parallel, sortable summary table
- **Sezóny** page: progress of every athlete (current and former members of teams 117/108/8) across the last 4 training years, per cycle, as small-multiple line charts (Běh km / Zátěž) or a table; default sort by volume of the newest shown year
- **Plán vs. realita** page: per athlete and the training year picked in the header dropdown, planned vs. actual running km per cycle — chart (bars = actual, line = plan, red dot = weeks without any activity), summary and a table with weekly chips. The plan level is picked per athlete and year and remembered in `chrome.storage.local` (`planLevels`)
- **Kalendář** toggle in the athlete view (next to Tabulka): 13 small calendars, one per cycle, days shaded by run km; pips top-right per activity when a day has several or an unprocessed one (red), click a day for links to its activities

## Releasing

Bump `"version"` in `manifest.json`, commit, then:
```bash
git tag v1.x.x
git push origin v1.x.x
```
GitHub Actions (`.github/workflows/release.yml`) zips the five extension files (`manifest.json`, `background.js`, `dashboard.html`, `popup.js`, `plan.json`) and publishes a GitHub Release automatically. See `RELEASE.md` for details.
