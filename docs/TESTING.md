# Testing

How this project is tested: strategy, test levels, environments, test data, design techniques,
traceability to the specification, coverage gates, and how to write and debug tests.

- **436 automated tests**: 418 Vitest tests in 54 files (unit, integration/API, component) and
  18 Playwright end-to-end tests in 7 files.
- **Coverage** (lines / branches): core 100% / 95.7%, server 97.5% / 84.9%, web 97.5% / 86.9%,
  enforced by thresholds.
- **No test touches the network, the real journal or your broker statements.**

Contents: [1 Quick start](#1-quick-start) · [2 Strategy](#2-test-strategy) ·
[3 Test levels](#3-test-levels) · [4 Environments and isolation](#4-test-environments-and-isolation) ·
[5 Test data](#5-test-data) · [6 Design techniques](#6-test-design-techniques-istqb) ·
[7 Traceability](#7-traceability-matrix) · [8 Coverage](#8-coverage) ·
[9 Quality gates](#9-quality-gates) · [10 Writing tests](#10-writing-tests) ·
[11 Defects found by tests](#11-defects-found-by-testing) · [12 Known gaps](#12-known-gaps-and-roadmap) ·
[13 Troubleshooting](#13-troubleshooting)

---

## 1. Quick start

```sh
npm test                                  # all Vitest tests (unit, integration/API, component)
npx vitest run --project core             # one package: core | server | web
npx vitest run packages/core/src/money.test.ts   # one file
npx vitest run -t "break-even"            # tests whose name matches
npx vitest                                # watch mode
npm run test:coverage                     # with coverage report and gates (fails below thresholds)
npx playwright install chromium           # once, before the first E2E run
npm run test:e2e                          # end-to-end (starts its own servers)
npx playwright test e2e/imports.spec.ts   # one E2E file
npx playwright test --ui                  # interactive E2E runner
```

The full gate before every commit: `npm run lint && npm run typecheck && npm run test:coverage && npm run test:e2e`.

---

## 2. Test strategy

### 2.1 Objectives

1. **Numbers are right.** P&L, R, expectancy, TWR, drawdown and MAE/MFE are what the journal is
   for; a wrong number is the worst possible defect.
2. **Data is never lost or corrupted.** Imports, regrouping, undo, backup and restore must preserve
   every fill and every journal note.
3. **Private data stays private.** Broker statements and API keys never reach tests, fixtures,
   logs or git.
4. **Every feature in `SPEC.md` is demonstrably working**, from the API to the screen.

### 2.2 Risk-based priorities

| Risk                                                    | Impact | Where most test effort goes                                                                   |
| ------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------- |
| Wrong financial calculation                             | High   | Hand-calculated unit tests in `core` (100% lines), seed cross-checks, pinned dashboard values |
| Fills grouped into the wrong trades; journal notes lost | High   | Grouping and regrouping tests, stable-key/orphan tests, undo and restore round trips          |
| Duplicate or missing rows on import                     | High   | Fingerprint tests, re-import = 0 rows, real-file dry run (counts only)                        |
| Time-zone / DST / calendar mistakes                     | Medium | NY-time conversion, NYSE holiday and DST edge-case tests                                      |
| Provider limits, outages, bad responses                 | Medium | Mocked provider, fake clock, every error path                                                 |
| UI shows wrong or stale data                            | Medium | Component tests against a fake API, E2E journeys                                              |
| Security (path traversal, injected files, leaked token) | Medium | Targeted tests on uploads, backups, CSV export, Tiingo adapter                                |

### 2.3 Approach

- **Test-first (TDD)** for all domain logic and every bug fix: write the failing test, watch it
  fail for the right reason, then implement. Expected values are worked out by hand in test
  comments, not copied from the implementation.
- **The test pyramid**: most tests are fast unit and API tests; E2E covers user journeys only.
- **Real collaborators where cheap** (real SQLite in memory, real Fastify app, real router);
  fakes only at the system edges (market-data provider, HTTP in the browser, the clock).
- **Every defect gets a regression test** (see [section 11](#11-defects-found-by-testing)).

### 2.4 Test types covered

Functional (all levels), data integrity (round trips, undo, migrations), regression (the whole
suite on every change), security-relevant behaviour (targeted), static analysis (TypeScript,
ESLint). Not automated yet: performance/load, accessibility, usability (see
[section 12](#12-known-gaps-and-roadmap)).

---

## 3. Test levels

### 3.1 Unit tests: domain logic (`packages/core`, 144 tests)

Pure functions, no I/O. Every expected value is calculated by hand and the arithmetic is written
in the test comment, for example:

```ts
it('single entry and exit, win', () => {
  // Buy 100 @ 50.00, sell 100 @ 55.00, $1 commission each side.
  // Gross = 5,500 − 5,000 = 500; fees = 2; net = 498; return = 498 / 5,000 = 9.96%.
```

| File                  | Tests | Covers                                                                                                                            |
| --------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------- |
| `money.test.ts`       |    11 | Decimal ↔ micros parsing without float drift, half-away-from-zero rounding, overflow-safe `mulDiv`, USD formatting                |
| `quantity.test.ts`    |     3 | Micro-shares, fractional quantities, shares × price                                                                               |
| `dates.test.ts`       |    17 | NY dates across DST, NYSE holidays and observance rules, trading-day counts, NY wall-clock ↔ UTC (DST gap and overlap)            |
| `grouping.test.ts`    |    27 | Fills → trades: scale-in/out, re-opening, per-symbol, ordering, same-timestamp tie-breaks, oversold and invalid fills, fractional |
| `trade-stats.test.ts` |    13 | All hand-calculated P&L cases from the spec, average-cost partial exits, open trades, holding period                              |
| `risk.test.ts`        |     8 | Initial risk (stop / override / none), R-multiple, planned R:R                                                                    |
| `summary.test.ts`     |     3 | Per-trade summary combining stats, risk and holding period                                                                        |
| `outcome.test.ts`     |     4 | Win/loss/break-even classification and aggregate stats                                                                            |
| `metrics.test.ts`     |    14 | Every §2.4 portfolio metric on a hand-calculated set, streaks, Sharpe/Sortino, metric definitions                                 |
| `equity.test.ts`      |     7 | Equity curve, TWR with a mid-period deposit, drawdown on performance and TWR, cumulative R                                        |
| `drawdown.test.ts`    |     7 | Drawdown series, max drawdown by amount/percent, recovery                                                                         |
| `breakdown.test.ts`   |     7 | Grouping by setup/ticker/weekday/month/mistake, cost of mistakes, ordering                                                        |
| `histogram.test.ts`   |     5 | Fixed-width bins, nice steps, float-drift-free edges                                                                              |
| `market.test.ts`      |     9 | MAE/MFE in $/%/R, split detection (provider and price jump), benchmark index                                                      |
| `csv.test.ts`         |     8 | RFC 4180 parse and write, BOM/CRLF, formula-injection guard, round trip                                                           |
| `index.test.ts`       |     1 | Health helper                                                                                                                     |

### 3.2 Unit tests: server internals (`packages/server`, 45 tests)

| File                           | Tests | Covers                                                                                                          | Test doubles              |
| ------------------------------ | ----: | --------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `import/ibkr-activity.test.ts` |     7 | IBKR Activity Statement parsing, skips with reasons, fingerprints, share classes, malformed rows                | Synthetic fixture CSV     |
| `import/generic-csv.test.ts`   |     5 | Column mapping, date formats, side from sign, missing columns                                                   | Synthetic fixture CSV     |
| `market/tiingo.test.ts`        |     8 | URL, header auth, mapping to micros, every HTTP error, token never leaked                                       | Fake `fetch`              |
| `market/market-data.test.ts`   |     8 | Candle cache: **second request = 0 HTTP calls**, only missing ranges, today after 18:00 NY, rate limit, retries | `MockProvider`            |
| `market/rate-limiter.test.ts`  |     8 | Sliding windows, wait time, window edge (999 vs 1000 ms), max−1/max                                             | Fake clock                |
| `market/from-env.test.ts`      |     4 | Provider selection from env                                                                                     | —                         |
| `db/migrations.test.ts`        |     1 | Migration 0001 rescales quantities; re-running is a no-op                                                       | Partial migrations folder |
| `config.test.ts`               |     4 | DB/uploads/backups paths from env (default, relative, absolute)                                                 | Env save/restore          |
| `seed/demo.test.ts`            |     4 | Demo data covers every edge case, is deterministic, refuses a non-empty DB                                      | —                         |

### 3.3 Integration / API tests (`packages/server/src/routes`, 135 tests)

Every REST endpoint is exercised through the **real Fastify app** with `app.inject` against a
**fresh in-memory SQLite database** with all migrations applied, a temporary uploads folder and,
where needed, a temporary backups folder. Assertions cover status codes, response bodies, error
codes and the resulting database state.

| File                  | Tests | Covers                                                                                                                                            |
| --------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `executions.test.ts`  |    12 | CRUD, UTC normalisation, validation (400), oversold (422), duplicate broker id (409), regroup on update/delete                                    |
| `trades.test.ts`      |    17 | New trade, add fill, journal, list filters and totals, trade tags, stop history, orphans, missing-stop filter                                     |
| `regroup.test.ts`     |     6 | Journal survives earlier-dated fills, merges, deleted first fills and undo (stable keys, orphans)                                                 |
| `tags.test.ts`        |     4 | CRUD, duplicates, delete with reassignment, merge                                                                                                 |
| `cash-flows.test.ts`  |     2 | CRUD, date ranges, sign rules                                                                                                                     |
| `settings.test.ts`    |     3 | Defaults, partial updates, validation                                                                                                             |
| `screenshots.test.ts` |     7 | Upload sniffed by content, size limit, serve, caption, delete with file, orphan cleanup                                                           |
| `imports.test.ts`     |    11 | Preview (dry run), commit, **re-import inserts 0 rows**, duplicate files, **undo restores the exact prior state**, blocked undo, presets, history |
| `dashboard.test.ts`   |     9 | Hand-calculated KPIs, equity/TWR, filters, date range, **seed cross-checks with pinned values**                                                   |
| `market.test.ts`      |    10 | Trade chart, MAE/MFE, splits, open positions, backfill planning and rate limit, dashboard market additions                                        |
| `export.test.ts`      |     5 | CSV exports with metrics and filters, formula-injection guard                                                                                     |
| `backups.test.ts`     |     4 | **Backup → wipe → restore round trip**, keep 10, confirmation, unsafe names, download                                                             |
| `techniques.test.ts`  |    47 | Boundary values, decision tables, state transitions, empty bodies ([section 6](#6-test-design-techniques-istqb))                                  |
| `app.test.ts`         |     2 | Health, 404 and malformed-JSON handling                                                                                                           |

### 3.4 Component tests (`packages/web`, 94 tests)

Pages are rendered with the **real router and real components** in jsdom; only HTTP is faked.
The harness in `src/__fixtures__/harness.tsx` provides:

- `fakeApi({ 'GET /api/trades/:id': handler, ... })`: replaces `fetch`, matches method + path,
  records every call (`method`, `path`, `query`, `body`) and turns `throw apiError(...)` into an
  error response.
- `renderApp('/trades/1')`: renders the app at a URL and returns the memory router, so tests can
  assert navigation.
- `src/__fixtures__/data.ts`: realistic, typed API payloads (trades, details, dashboard, chart,
  positions, previews…).

| File                                   | Tests | Covers                                                                                                      |
| -------------------------------------- | ----: | ----------------------------------------------------------------------------------------------------------- |
| `lib/validate.test.ts`                 |    10 | Form parsing and validation → API payloads (micros, NY time → UTC)                                          |
| `lib/format.test.ts`                   |     8 | Money, prices, %, R, quantities, NY dates, no "-0.00"                                                       |
| `lib/mapping.test.ts`                  |     4 | CSV column and date-format guessing                                                                         |
| `lib/shortcuts.test.ts`                |     3 | `n` shortcut rules, theme resolution                                                                        |
| `components/charts/scale.test.ts`      |     5 | Ticks, scales, diverging colours                                                                            |
| `components/Layout.test.tsx`           |     6 | Redirect, API status, shortcut, dark mode, 404, error page                                                  |
| `pages/TradesPage.test.tsx`            |     6 | Columns, totals, sorting, URL-backed filters, row navigation, empty and orphan states                       |
| `pages/NewTradePage.test.tsx`          |     5 | Default commission, risk preview, payload, validation, new setup, 409 with link                             |
| `pages/trade/TradeDetailPage.test.tsx` |    11 | Stats, fills, add fill (and rejection), journal, tags, stops, screenshots + lightbox, splits, orphans       |
| `pages/CashFlowsPage.test.tsx`         |     2 | Signs, net total, delete, validation, failed save keeps input                                               |
| `pages/ImportPage.test.tsx`            |     7 | IBKR preview/commit, duplicate file, blocked commit, CSV mapping and presets, history/undo, unreadable file |
| `pages/DashboardPage.test.tsx`         |     6 | KPI tiles and definitions, every chart, tooltips, scatter links, heatmap navigation, filters, empty states  |
| `pages/PositionsPage.test.tsx`         |     4 | Valuation, totals, split flag, market-data status, sync, not configured                                     |
| `pages/SettingsPage.test.tsx`          |     6 | Account settings, tag rename/recolour/merge/delete, backups and restore, exports                            |
| `pages/MissingStopsPage.test.tsx`      |     3 | Inline stop entry, below-entry rule, empty state                                                            |

### 3.5 End-to-end tests (`e2e/`, 18 tests)

Playwright drives Chromium against the real servers (API + web). Each journey is a user story:

| File                    | Journeys                                                                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smoke.spec.ts`         | App shell loads the dashboard and reaches the API                                                                                                        |
| `journal.spec.ts`       | Journal a trade with a scale-out, notes, tags and a screenshot, then see the totals · inline validation (stop above entry, oversold) · record cash flows |
| `imports.spec.ts`       | IBKR statement: preview, commit, re-import adds nothing, undo · generic CSV with auto-mapping                                                            |
| `dashboard.spec.ts`     | A filter changes the KPIs · KPI definitions and heatmap → filtered trade list                                                                            |
| `market.spec.ts`        | Open positions at the last close + fetch on demand · candlestick chart with MAE/MFE · portfolio vs SPY                                                   |
| `settings.spec.ts`      | Starting balance · tag rename and merge · dark mode persists · `n` shortcut · CSV export download · backup → delete → restore                            |
| `missing-stops.spec.ts` | Add a stop inline; the trade gets an R-multiple                                                                                                          |

Specs run serially in one shared E2E database (wiped at the start of every run). Tests use unique
symbols and undo what they import, so they don't depend on each other's data.

---

## 4. Test environments and isolation

| Concern     | Unit (core)  | Server unit / API                                                        | Component (web)                                | E2E                                             |
| ----------- | ------------ | ------------------------------------------------------------------------ | ---------------------------------------------- | ----------------------------------------------- |
| Database    | none         | In-memory SQLite per test, migrated                                      | none                                           | `data/e2e/journal.db`, wiped per run            |
| Files       | none         | Temp uploads/backups dirs, deleted after each test                       | none                                           | `data/e2e/uploads`, `data/e2e/backups`          |
| Market data | none         | `MockProvider` (synthetic bars, call log)                                | Fake API                                       | `MARKET_DATA_PROVIDER=synthetic` (offline)      |
| HTTP        | none         | `app.inject` (no socket)                                                 | `fakeApi` replaces `fetch`                     | Real servers on 127.0.0.1:3101 / localhost:5174 |
| Clock       | fixed inputs | Fixed `now` (e.g. `NOW = 2026-03-14T00:00Z`), fake clock for the limiter | real                                           | real                                            |
| Browser     | —            | —                                                                        | jsdom (+ `ResizeObserver`, `matchMedia` shims) | Chromium, `timezoneId: America/New_York`        |

Why E2E can't touch your data: its ports differ from `npm run dev` (3001/5173), `DB_PATH`,
`UPLOADS_DIR` and `BACKUPS_DIR` point into `data/e2e/`, and `MARKET_DATA_PROVIDER=synthetic` is set
in the environment, which takes precedence over `.env`, so your Tiingo key is never used.
Playwright waits for `/api/health` through the web proxy, so both servers are up before tests start.

---

## 5. Test data

| Data                                                 | Location                                            | Notes                                                                                                   |
| ---------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `fill(side, shares, price, at, opts)`                | `packages/core/src/__fixtures__/fill.ts`            | Readable executions; `at(day)` = a March 2026 trading day at 15:00 UTC                                  |
| `createTestApp()`, `at()`, `multipart()`, `TINY_PNG` | `packages/server/src/__fixtures__/test-app.ts`      | App + in-memory DB + temp dirs; multipart bodies; a valid 1×1 PNG                                       |
| `MockProvider`, `mockMarket()`, `NOW`                | `packages/server/src/__fixtures__/market.ts`        | Deterministic bars, call log, adjustable (e.g. inject a split)                                          |
| IBKR / generic CSV fixtures                          | `packages/server/src/import/__fixtures__/`          | **Synthetic**: they copy the real format, never real data                                               |
| Web payloads                                         | `packages/web/src/__fixtures__/data.ts`             | Typed API responses                                                                                     |
| Demo seed                                            | `packages/server/src/seed/demo.ts`                  | About 40 deterministic trades covering every edge case; dashboard figures pinned in `dashboard.test.ts` |
| Money helpers                                        | `toMicros as $`, `toQuantity as sh` from `@tj/core` | `$('50')` = 50 USD in micros; `sh('0.5')` = half a share                                                |

**Privacy rule:** real statements live only in `private/` (gitignored, not linted). Never copy rows
from them into fixtures, tests or logs. To check a real file, run a local script that prints counts
only.

---

## 6. Test design techniques (ISTQB)

### Equivalence partitioning

Inputs are split into valid and invalid classes and each class is tested at least once. Examples:
tickers (`AAPL`, `BRK.B` valid; lowercase, digits first, too long invalid), quantities (positive,
zero, fractional, non-integer micro-shares), cash-flow types × signs, upload content (image vs not),
CSV date formats (five formats, garbage), import rows (stock/USD, non-stock, non-USD, cancelled, total).

### Boundary value analysis (3-value)

In `routes/techniques.test.ts` unless noted:

| Boundary                  | Values tested                                                              |
| ------------------------- | -------------------------------------------------------------------------- |
| Execution rating 1..5     | 0, 1, 2, 4, 5, 6                                                           |
| Initial stop vs $50 entry | 49.999999 (valid), 50, 50.000001 (invalid)                                 |
| Sell vs 10-share position | 9 (stays open), 10 (closes), 11 (422)                                      |
| Quantity                  | 0 (invalid), 1 and 2 micro-shares (valid)                                  |
| Ticker length             | 1, 6 (valid), 7 (invalid)                                                  |
| Break-even threshold $1   | ±0.999999 (break-even), −1 (loss), 1 and 1.000001 (win)                    |
| Upload size limit         | limit = size − 1 (413), = size, = size + 1 (accepted)                      |
| Backups kept              | 9, 10, 11 backups → 9, 10, 10 kept                                         |
| Rate limiter window       | 999 ms (blocked), 1000 ms (allowed); max − 1, max (`rate-limiter.test.ts`) |
| Today's candle            | before / after 18:00 New York (`market-data.test.ts`)                      |
| DST                       | 02:30 on spring-forward, 01:30 on fall-back (`dates.test.ts`)              |

### Decision tables

| Table          | Conditions → action                                         | Where                                   |
| -------------- | ----------------------------------------------------------- | --------------------------------------- |
| Initial risk   | override set? × stop set? × stop below entry? → risk used   | `techniques.test.ts`, `risk.test.ts`    |
| Cash-flow sign | type × sign of amount → accepted? (10 rules)                | `techniques.test.ts`                    |
| Outcome        | net vs threshold → win / loss / break-even                  | `outcome.test.ts`, `techniques.test.ts` |
| Import row     | asset class × currency × code → imported / skipped (reason) | `ibkr-activity.test.ts`                 |

### State transition testing

- **Import batch:** PREVIEW → commit → COMMITTED → undo → UNDONE, plus every invalid event
  (undo a preview, commit twice, commit/undo after undo), each asserting the state is unchanged.
- **Trade:** OPEN → CLOSED by fills; attached → orphaned → re-attached by regrouping; orphan → deleted
  (only orphans can be deleted) — `regroup.test.ts`, `trades.test.ts`.
- **Backup:** create → restore (with a safety backup first) — `backups.test.ts`.

### Use-case / scenario testing

The E2E journeys in [section 3.5](#35-end-to-end-tests-e2e-18-tests).

### Statement and branch coverage (white-box)

Measured on every coverage run, with per-package thresholds ([section 8](#8-coverage)).

### Error guessing

Tests written from experience of what breaks: DST gaps and overlaps, floating-point drift
(`0.1 + 0.2`), identical timestamps, byte-order marks, CRLF, share classes with spaces, path
traversal in uploads and backups, spreadsheet formula injection, "-0.00", same-minute backup names,
provider 401/404/429/500 and network failure, empty request bodies, unhandled promise rejections.

### Experience-based exploratory testing

After each phase the UI was run with demo data and screenshot-reviewed; defects found that way
(section 11) were then pinned with automated tests.

### Collaboration-based (acceptance criteria / ATDD)

Each phase's definition of done in `SPEC.md` is an executable acceptance test (e.g. "importing the
same file twice inserts 0 rows", "undo restores the exact prior state", "backup → wipe → restore").
In Phase 3 the E2E journeys were written before the UI.

### Static testing

Strict TypeScript (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), strict ESLint, Prettier.

---

## 7. Traceability matrix

Specification section → tests at each level (U = unit, A = API/integration, C = component, E = E2E).

| Spec  | Requirement                                                           | U                                     | A                                                             | C                                     | E                     |
| ----- | --------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------- | ------------------------------------- | --------------------- |
| §2.1  | Fills → trades, ordering, oversold error, regrouping with stable keys | `grouping`                            | `executions`, `regroup`, `techniques`                         | `TradeDetailPage`                     | `journal`             |
| §2.2  | Gross/net P&L, partial exits, averages, return, holding period        | `trade-stats`, `summary`, `dates`     | `trades`, `export`                                            | `TradesPage`                          | `journal`             |
| §2.3  | Initial risk, override, R, planned R:R, stop history                  | `risk`, `summary`                     | `trades`, `techniques`                                        | `TradeDetailPage`, `MissingStopsPage` | `missing-stops`       |
| §2.4  | Portfolio metrics, break-even, definitions                            | `metrics`, `outcome`                  | `dashboard` (hand + seed)                                     | `DashboardPage`                       | `dashboard`           |
| §2.5  | Equity, cash flows, TWR, drawdown, cumulative R                       | `equity`, `drawdown`                  | `dashboard`, `cash-flows`                                     | `CashFlowsPage`, `DashboardPage`      | `journal`, `settings` |
| §2.6  | MAE / MFE from daily bars                                             | `market`                              | `market`                                                      | `TradeDetailPage`, `DashboardPage`    | `market`              |
| §3    | Schema, micros, migrations                                            | `money`, `quantity`                   | `migrations`, all route tests                                 | —                                     | —                     |
| §4.1  | Manual entry and inline validation                                    | `validate`                            | `trades`, `techniques`                                        | `NewTradePage`, `TradeDetailPage`     | `journal`             |
| §4.2  | Imports: preview, dedupe, commit, undo, IBKR, CSV presets             | `csv`, `ibkr-activity`, `generic-csv` | `imports`, `techniques`                                       | `ImportPage`                          | `imports`             |
| §4.3  | Trade list and detail, screenshots                                    | —                                     | `trades`, `screenshots`                                       | `TradesPage`, `TradeDetailPage`       | `journal`             |
| §4.4  | Dashboard, filters, heatmap, distributions, breakdowns, benchmark     | `histogram`, `breakdown`              | `dashboard`, `market`                                         | `DashboardPage`                       | `dashboard`, `market` |
| §4.5  | Open positions, open risk                                             | —                                     | `market`                                                      | `PositionsPage`                       | `market`              |
| §4.6  | Provider, cache, rate limit, degradation, splits                      | `market`                              | `tiingo`, `market-data`, `rate-limiter`, `from-env`, `market` | `PositionsPage`                       | `market`              |
| §4.7  | CSV export, backup and restore                                        | `csv`                                 | `export`, `backups`                                           | `SettingsPage`                        | `settings`            |
| §4.8  | Settings, tag management                                              | —                                     | `settings`, `tags`                                            | `SettingsPage`                        | `settings`            |
| §5 P7 | Dark mode, `n` shortcut, error/empty states                           | `shortcuts`                           | —                                                             | `Layout`, all pages                   | `settings`, `smoke`   |
| Extra | Missing-stops workflow                                                | —                                     | `trades`                                                      | `MissingStopsPage`                    | `missing-stops`       |

---

## 8. Coverage

`npm run test:coverage` (V8 provider) prints a per-file table and **fails if a package falls below
its threshold** (`vitest.config.ts`):

| Package  | Lines (gate / actual) | Branches (gate / actual) |
| -------- | --------------------- | ------------------------ |
| `core`   | 98% / 100%            | 92% / 95.7%              |
| `server` | 95% / 97.5%           | 80% / 84.9%              |
| `web`    | 95% / 97.5%           | 82% / 86.9%              |

Excluded from coverage: test files, `__fixtures__/`, `test-setup.ts`, `types.ts` (type-only),
`main.ts`/`main.tsx` (process entry points, covered by E2E).

To find what is not covered, read the "Uncovered Line #s" column, or open the HTML report:
`npx vitest run --coverage --coverage.reporter=html` → `coverage/index.html`.

Coverage is a floor, not the goal: a line can be executed without being checked. The hand-calculated
expectations and the techniques in section 6 are what make the assertions meaningful.

---

## 9. Quality gates

| When                         | Run                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| While coding                 | `npx vitest` (watch) or the single file you are changing                               |
| Before committing            | `npm run lint && npm run typecheck && npm run test:coverage && npm run test:e2e`       |
| After changing the DB schema | `npm run db:generate -w @tj/server -- --name <name>`, then add/extend a migration test |
| After changing an importer   | Fixture tests, then a local counts-only dry run on a real statement in `private/`      |

A phase or feature is done only when all four gates are green (see `CLAUDE.md`).

---

## 10. Writing tests

### 10.1 Conventions

- **One behaviour per test**, named as a sentence about behaviour ("refuses an oversold fill").
- **Arrange / act / assert**; put the hand calculation in a comment next to the expected value.
- **Money in micros, quantities in micro-shares**: build values with `$('50')` and `sh('0.5')`,
  never with floats.
- **Timestamps**: UTC ISO in data, New York time in UI inputs; pick dates that are NYSE trading days.
- **No network, no real files, no real clock where it matters**: use the fixtures in section 5.
- **Web selectors**: by role and label (`getByRole('button', { name: 'Save' })`,
  `getByLabelText('Shares')`), never CSS classes, except for chart internals.
- **Asynchronous UI**: use `findBy…` or `waitFor` for anything that arrives from the API.
- **New bug → failing test first**, then the fix.

### 10.2 Recipes

**Core unit test**

```ts
import { at, fill } from './__fixtures__/fill';
import { toMicros as $ } from './money';

it('fees turn a gross win into a net loss', () => {
  // gross +2.00, fees 4.00 -> net −2.00
  const s = computeTradeStats([
    fill('BUY', 10, '100', at(2), { commission: '1.5', otherFees: '0.5' }),
    fill('SELL', 10, '100.20', at(3), { commission: '1.5', otherFees: '0.5' }),
  ]);
  expect(s.netPnl).toBe($('-2'));
});
```

**API test**

```ts
import { at, createTestApp } from '../__fixtures__/test-app';

it('rejects an oversold fill with 422 and saves nothing', async () => {
  const t = createTestApp();
  await t.post('/api/executions', {
    symbol: 'AAPL',
    side: 'BUY',
    quantity: sh(100),
    price: $('50'),
    executedAt: at(2),
  });
  const res = await t.post('/api/executions', {
    symbol: 'AAPL',
    side: 'SELL',
    quantity: sh(150),
    price: $('51'),
    executedAt: at(3),
  });
  expect(res.status).toBe(422);
  expect((await t.get('/api/executions')).body.executions).toHaveLength(1);
});
```

Options: `createTestApp({ market: mockMarket(provider) })`, `createTestApp({ backups: true })`,
`createTestApp({ maxUploadBytes: 50 })`; `t.database.sqlite` for direct SQL assertions.

**Component test**

```ts
import { fakeApi, renderApp } from '../__fixtures__/harness';
import { detail } from '../__fixtures__/data';

afterEach(() => vi.unstubAllGlobals());

it('saves the journal', async () => {
  const calls = fakeApi({
    'GET /api/trades/:id': () => detail(),
    'PATCH /api/trades/:id': () => detail(),
  });
  renderApp('/trades/1');
  const form = await screen.findByRole('form', { name: 'Journal' });
  fireEvent.change(within(form).getByLabelText('Review'), { target: { value: 'Good exit' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Save journal' }));
  expect(await within(form).findByText('Saved')).toBeInTheDocument();
  expect(calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({ review: 'Good exit' });
});
```

**E2E test**

```ts
test('…', async ({ page, request }) => {
  await request.post('/api/trades', { data: {/* unique symbol, micros */} }); // arrange via the API
  await page.goto('/trades');
  await page.getByLabel('Symbol').fill('XYZQ');
  await expect(page.getByRole('row', { name: /XYZQ/ })).toBeVisible();
});
```

Use a symbol no other spec uses, and undo anything that would change other specs' totals.

### 10.3 Checklist for a new feature

1. Core logic → unit tests with hand-calculated values (and the techniques in section 6 for every
   input and limit).
2. Endpoint → API tests for success, validation (400), not found (404), conflicts (409/422).
3. Page → component test with `fakeApi` covering display, interaction, error and empty states.
4. User journey → one E2E test if it is a new workflow.
5. Add a row to the traceability matrix in section 7.
6. Run the full gate (section 9).

---

## 11. Defects found by testing

Defects caught during development and the test that now guards each one:

| Found by                  | Defect                                                                                                       | Regression test                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| API test (designing undo) | Deleting a trade's first fill orphaned its journal notes                                                     | `regroup.test.ts` "keeps the journal … when its first fill is deleted" |
| E2E                       | Clearing a form only after the save succeeded could wipe the next entry being typed                          | `journal.spec.ts` cash flows; `CashFlowsPage.test.tsx`                 |
| Real-file dry run         | IBKR share classes with a space (`MOG A`) were rejected                                                      | `ibkr-activity.test.ts` (`BRK B` → `BRK.B`)                            |
| Visual review             | SPY benchmark covered only the SPY trade's weeks when SPY was also traded                                    | `market.test.ts` "covers the whole benchmark period"                   |
| E2E (startup)             | Tests could start before the API was listening                                                               | Playwright waits for `/api/health`                                     |
| API test                  | A new backup could reuse a pruned name and be deleted immediately                                            | `backups.test.ts` "keeps only the 10 most recent"                      |
| Component tests           | Unhandled promise rejections on failed trade creation, tag add and screenshot upload                         | `NewTradePage`, `TradeDetailPage` tests                                |
| Typecheck of fixtures     | Web types lacked the `IBKR_ACTIVITY` fill source                                                             | Typecheck on every build                                               |
| Visual review             | Open trades' chart shading stopped at a partial exit; overlapping chart labels; "+" on equity axis; "-0.00R" | `format.test.ts`, chart tests                                          |

---

## 12. Known gaps and roadmap

| Gap                              | Why it matters                                         | Suggested approach                                                                           |
| -------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Pairwise / combinatorial testing | CSV mapping options and dashboard filters combine      | Pairwise table of filter/mapping combinations                                                |
| Property-based testing           | Invariants over many generated inputs                  | `fast-check`: Σ realised = gross P&L; grouping is order-independent; deposits only ⇒ TWR = 0 |
| Mutation testing                 | Measures whether tests catch bugs, not just run code   | Stryker on `packages/core`                                                                   |
| MC/DC                            | Compound conditions (e.g. commit allowed)              | Targeted condition tables                                                                    |
| Accessibility                    | Screen-reader and keyboard use                         | `@axe-core/playwright` in E2E                                                                |
| Performance                      | Large journals (thousands of trades, years of candles) | Seeded large DB + timing budgets on list/dashboard endpoints                                 |
| Real-provider contract           | Tiingo response shape could change                     | Optional, manually run contract test using the real key                                      |

---

## 13. Troubleshooting

| Symptom                                                              | Cause / fix                                                                                                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ResizeObserver is not defined` in a web test                        | jsdom has no layout; the shim in `test-setup.ts` must be a plain global (tests call `vi.unstubAllGlobals()`, which would remove a `vi.stubGlobal` shim) |
| A web assertion fails on "checking…"/loading text                    | Use `findBy…` / `waitFor`; `getBy…` doesn't wait for the fake API                                                                                       |
| "Found multiple elements"                                            | The value also appears in a hidden data table or tooltip; scope with `within(region)` or query the tooltip element                                      |
| E2E: `ERR_CONNECTION_REFUSED` or a request failing at the very start | Another process holds port 3101/5174, or the API is still starting (the config waits for `/api/health`)                                                 |
| E2E: browser missing                                                 | `npx playwright install chromium`                                                                                                                       |
| E2E data from a previous run                                         | `data/e2e/` is wiped by `e2e/reset-data.mjs` at the start of each run; run the whole suite, not a stale server                                          |
| Coverage gate fails                                                  | Read the per-file table; add tests for the uncovered lines/branches rather than lowering the threshold                                                  |
| A test passes immediately when written test-first                    | It doesn't test new behaviour; check the assertion fails without the implementation (temporarily disable it)                                            |
