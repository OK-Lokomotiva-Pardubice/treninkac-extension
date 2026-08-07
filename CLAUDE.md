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
```

Validity period: `2025-10-27` – `2026-10-25` (activities outside this range are filtered out).

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

**`cycleData`** — array of cycle objects:
```js
{
  num, extra,        // extra=true for cycles built from unmatched activities
  hasNezp,           // true if any week in cycle has nezp activities
  DZ, FA, ZA, NE, runDist, zatSec,
  weeks: [{ week, isoYear, hasNezp, DZ, FA, ZA, NE, runDist, zatSec }]
}
```

**Planned cycles** — weeks come from the plan API; stats = plan stats + nezp activity contributions.  
**Extra cycles** — unmatched activities grouped into 4-consecutive-ISO-week blocks, numbered C[n+1], C[n+2], …; stats computed entirely from activities.

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

### Year resolution
ISO week numbers are shared between years (week 1–43 = 2026, week 44–52 = 2025).  
`resolveYear(weekNum)` inside `buildCache` votes using actual activity dates; falls back to: `week >= 44 → 2025`, else `2026`.  
Each week object stores `isoYear` so rendering doesn't need to call `resolveYear`.

## Key functions in `popup.js`

| Function | Purpose |
|----------|---------|
| `buildCache(detailRaw, logRaw)` | Normalise + cache all data for one athlete |
| `renderSidebar()` | Render athlete list in `<aside>` |
| `selectAthlete(uid)` | Load (if needed) + render athlete detail |
| `renderMain(uid)` | Render cycle/week/activity table for athlete |
| `renderTotals()` | Load all athletes + render sortable totals table |
| `isoWeekMonday(year, week)` | Returns UTC Date of Monday of ISO week (pure timestamp arithmetic) |
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
```

## Features summary

- Cycle/week drill-down with expandable activity rows
- Activity name links to detail page on treninkac.orientacnisporty.cz
- Unmatched activities assigned to extra cycles (C[n+1], …), shown in same structure
- Nezpracované (unprocessed) activities counted into week/cycle sums
- Red highlighting on cycle/week names when nezp activities present
- Date range (DD.MM.YYYY – DD.MM.YYYY) shown next to cycle and week names
- ⎘ copy button on cycle rows — copies DZ/FA/ZA/NE/Zátěž/Běh km as TSV for Google Sheets
- **Celkové součty** page: all athletes loaded in parallel, sortable summary table

## Releasing

Bump `"version"` in `manifest.json`, commit, then:
```bash
git tag v1.x.x
git push origin v1.x.x
```
GitHub Actions (`.github/workflows/release.yml`) zips the four extension files and publishes a GitHub Release automatically. See `RELEASE.md` for details.
