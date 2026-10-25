# Tréninkáč Dashboard – Chrome Extension

Chrome extension (Manifest V3) providing an alternative training-data dashboard for team **Dorost LPU** (team ID `117`) from the Tréninkáč app.

## Architecture

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest, permissions: `storage`, `scripting`, `tabs` |
| `background.js` | Service worker — opens `dashboard.html` as a full tab on icon click |
| `dashboard.html` | Full-viewport page; all CSS is inline in a `<style>` block, no external assets |
| `popup.js` | All application logic — data fetching, cache, rendering |

There is no build step. Edit the files directly and reload the extension at `chrome://extensions`.

## API

```
Base: https://treninkac-api.orientacnisporty.cz/api
Auth: Bearer token stored in chrome.storage.local under key "token"
      (read from localStorage.trainee.token on the treninkac tab)

Endpoints used:
  GET /team/117/stats                                      → athlete list
  GET /team/detail/117/athlete/:uid                        → cycle/week plan + sport stats
  GET /team/detail/117/athlete/:uid/training-log           → individual activity log
  GET /team/{117,108,8}/stats                              → rosters for the Sezóny page
  GET /team/detail/{team}/athlete/:uid/training-log        → same log, fetched via the team the athlete belongs to
```

Training year: `2025-10-27` – `2026-10-25` (activities outside this range are filtered out).

### Seasons are separate teams
Every training year is its own team: `8` = 2022-10-31..2023-10-29, `108` = 2023-10-30..2024-10-27, `117` = 2025-10-27..2026-10-25. The 2024/25 team no longer exists. The training log endpoint ignores period parameters and returns the athlete's **whole history**, so cross-season numbers are rebuilt from the log alone (the plan data is per team and has no sick days).

### Unprocessed ("nezp") activities
Entries with `time === null && movingTime != null`. They have `sport`, `name`, `startDate`, `movingTime` and `movingDistance`, but **no `distance`**. Always read distance as `distance || movingDistance`.

### km vs Zátěž
**Běh km** counts only running sports (`isRunSport`), also for unprocessed activities and unplanned weeks. **Zátěž** sums the time of all sports. Both include unprocessed activities (explained in `UNITS_NOTE`, shown on the Celkové součty and Sezóny pages).

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

# Cycle/week plan + sport stats for one athlete
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
`week` is the ISO week number (the label shown as `T44`, and the key the plan API uses); `mon`/`sun` are the authoritative dates.

**Planned week** (the plan API has a row for its ISO week) — stats = plan stats + nezp activity contributions (processed activities are already inside the plan stats).  
**Unplanned week** — no plan row, so stats are computed entirely from that week's activities.

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
(that grouping drifts per athlete whenever plan weeks are missing, which is why it is discarded).

* The training year starts Monday `SEASON_START` (`2025-10-27`, ISO 2025-W44).
* Every cycle spans exactly **4 consecutive weeks**, always all 4 — empty weeks included.
* **13 cycles = 52 weeks** per training year; after C13 a new training year begins again at C1.

So C1 = 27.10.2025–23.11.2025, C9 = 08.06.2026–05.07.2026, C13 = 28.09.2026–25.10.2026 — identical for every athlete.

Internally everything is keyed by the **absolute week index** `wi` (0–51) since `SEASON_START`:
`weekIndexOf(dateStr)` → `wi`, `weekMonday(wi)` → UTC Date, cycle index = `Math.floor(wi / WEEKS_PER_CYCLE)`,
cycle number = `(cycleIdx % CYCLES_PER_YEAR) + 1`. ISO week numbers are only labels and plan-API keys,
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
| `szAggregate(entries)` | Sum a log into per-cycle running km and load hours for each of the `SZ_COUNT` (4) seasons |
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
- Activities in weeks with no training plan still counted, in their calendar cycle
- Nezpracované (unprocessed) activities counted into week/cycle sums
- Red highlighting on cycle/week names when nezp activities present
- Date range (DD.MM.YYYY – DD.MM.YYYY) shown next to cycle and week names
- ⎘ copy button on cycle rows — copies DZ/FA/ZA/NE/Zátěž/Běh km as TSV for Google Sheets
- **Celkové součty** page: all athletes loaded in parallel, sortable summary table
- **Sezóny** page: progress of every athlete (current and former members of teams 117/108/8) across the last 4 training years, per cycle, as small-multiple line charts (Běh km / Zátěž) or a table; default sort by volume

## Releasing

Bump `"version"` in `manifest.json`, commit, then:
```bash
git tag v1.x.x
git push origin v1.x.x
```
GitHub Actions (`.github/workflows/release.yml`) zips the four extension files and publishes a GitHub Release automatically. See `RELEASE.md` for details.
