# Swing Trade Journal — Specification & Build Plan

## 1. Context

- **User:** one swing trader who trades US equities, mostly at Interactive Brokers (IBKR), and only goes long.
  Trades may be a single entry and exit, or scale in and out across several fills.
- **Runs:** locally on `localhost`. One user, no login.
- **Goal:** record every trade accurately, journal the reasoning behind it, and show honest statistics
  and curves that reveal what works and what doesn't.

### Out of scope for v1 (do not build)

Short selling, options and futures, multiple accounts, auth, cloud hosting, live broker API sync
(TWS/Gateway), automatic Flex Web Service pulls, PDF statement parsing, non-USD currencies.
The design must not block adding shorts or multiple accounts later. For example, keep a `direction`
column even though it is always `LONG` for now.

---

## 2. Domain model and calculation rules

All of these live in `packages/core` and are fully unit-tested.

### 2.1 Executions → trades (grouping)

- Process each symbol's executions in chronological order. Break ties on equal timestamps by broker
  execution ID, then by insertion order.
- A BUY while the position is flat **opens** a new trade. Later BUYs **scale in**. SELLs **scale out**.
  When the position returns to 0, the trade **closes**.
- A SELL that would take the position below 0 is a **validation error** because v1 is long-only.
  Show it in the import preview or on the manual entry form, and never silently clip it.
- **Re-grouping:** importing fills with earlier timestamps can change how trades are grouped.
  Regroup the whole symbol deterministically. Journal data (notes, tags, stops, screenshots) stays
  attached to a trade through a **stable key**: the ID of the trade's first execution. If regrouping
  orphans journal data, keep it and flag it for the user. Never delete it.

### 2.2 P&L

- **Gross P&L** of a closed trade = Σ(sell qty × price) − Σ(buy qty × price).
- **Net P&L** = Gross − all commissions and fees on the trade's executions.
- **Realised P&L on a partial exit** uses the average cost of the open position at the time of the sell.
- **Average entry** = volume-weighted average of the buy fills. **Average exit** = volume-weighted average of the sell fills.
- **Return %** = Net P&L ÷ total cost of the buys.
- **Holding period** = trading days and calendar days from first fill to last fill, in NY dates.

### 2.3 Risk and R-multiples

- Each trade has an **initial stop** (required for R stats, optional for saving the trade), an optional **target**, and a
  **stop history** (stop price + timestamp) so trailing stops are recorded.
- **Initial risk ($)** = (first entry fill price − initial stop) × quantity of the first entry fill.
  The user can override it with an explicit planned-risk $ for trades that were scaled in on purpose.
- **R-multiple** = Net P&L ÷ initial risk $. Trades without a stop are left out of every R statistic,
  and the dashboard shows how many were excluded.
- **Planned R:R** = (target − entry) ÷ (entry − initial stop).

### 2.4 Portfolio metrics (closed trades, filterable)

Win rate, average win, average loss, payoff ratio, profit factor, expectancy in $ and in R, total net
P&L, largest win and loss, longest win and loss streaks, average holding period (winners vs losers),
total fees, max drawdown ($ and %), and Sharpe and Sortino on daily equity returns. Each metric needs
a tooltip that gives its definition.

- Break-even trades (|net P&L| < $1, configurable) count separately and are not wins or losses.

### 2.5 Equity and cash flows

- Settings hold a **starting balance** and **start date**. `cash_flows` holds deposits, withdrawals,
  dividends, interest and broker fees that aren't tied to a trade.
- **Equity curve ($)** = starting balance + cumulative cash flows + cumulative realised net P&L, one point per NY day.
- **% performance** uses **time-weighted return (TWR)** so deposits don't count as profit.
  Drawdown % is measured on the TWR index.
- **Cumulative-R curve** and its drawdown are shown separately and are unaffected by account size.

### 2.6 MAE / MFE (needs market data)

Using daily candles from the entry date to the exit date:

- MAE = largest adverse move below average entry, using the lowest low.
- MFE = largest favourable move, using the highest high.
- Express both in $, % and R. Label it clearly that daily bars only approximate intraday extremes on
  the entry and exit days.

---

## 3. Database schema (SQLite, Drizzle)

Money and prices are INTEGER micros. Timestamps are TEXT UTC ISO-8601.

| Table              | Key columns                                                                                                                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `executions`       | id, symbol, side (BUY/SELL), quantity, price, commission, other_fees, executed_at, source (MANUAL/IBKR_FLEX/CSV), external_id (UNIQUE, nullable), import_batch_id                                                                                                    |
| `trades`           | id, stable_key (first execution id), symbol, direction (LONG), status (OPEN/CLOSED), opened_at, closed_at, initial_stop, planned_risk_override, target, setup_tag_id, thesis (pre-trade), review (post-trade), emotion, execution_rating (1–5), followed_plan (bool) |
| `trade_executions` | trade_id, execution_id (rebuilt when trades are regrouped)                                                                                                                                                                                                           |
| `stop_changes`     | id, trade_id, stop_price, changed_at                                                                                                                                                                                                                                 |
| `tags`             | id, name, kind (SETUP/MISTAKE/CUSTOM), color                                                                                                                                                                                                                         |
| `trade_tags`       | trade_id, tag_id                                                                                                                                                                                                                                                     |
| `screenshots`      | id, trade_id, file_path (under `data/uploads/`), caption, created_at                                                                                                                                                                                                 |
| `cash_flows`       | id, type, amount (signed), occurred_at, external_id (UNIQUE, nullable), note, import_batch_id                                                                                                                                                                        |
| `import_batches`   | id, source, filename, file_hash, imported_at, rows_total, rows_inserted, rows_skipped_duplicate, status (PREVIEW/COMMITTED/UNDONE)                                                                                                                                   |
| `candles`          | symbol, date, open, high, low, close, volume, provider — PK(symbol, date)                                                                                                                                                                                            |
| `settings`         | key, value                                                                                                                                                                                                                                                           |

Add indexes on `executions(symbol, executed_at)` and `trades(closed_at)`.
Trade metrics are computed by `packages/core` when they are requested. Add a cache table only if profiling shows a need.

---

## 4. Features

### 4.1 Manual entry

- A "New trade" form with symbol, a first fill (date/time, qty, price, commission), initial stop, target,
  setup tag and thesis. "Add fill" adds scale-ins and scale-outs to an existing trade.
- Validate inline: no negative position, valid tickers (uppercase, from a format check), and a stop below entry for longs.

### 4.2 Imports

Every import follows the same flow: **upload → parse → preview** (new / duplicate / error rows, plus the trades
they would create or change) **→ commit → undoable** from the import history page.

1. **IBKR Flex Query (XML and CSV).** Document in-app how to set up the Flex Query: the Trades section
   at **execution** level with symbol, date/time, quantity, trade price, buy/sell, IB commission, trade ID
   and IB exec ID, plus a Cash Transactions section for deposits, withdrawals, dividends and interest.
   Dedupe on IB exec ID. Skip rows that aren't stocks and report the count.
   **Ask the user for a real redacted sample before you implement this importer.**
2. **Generic CSV.** A column-mapping UI (map file columns to executions fields, set the date format and
   the side values). Mappings are saved as reusable named presets. Dedupe on a hash of
   (symbol, side, qty, price, executed_at) when the file has no ID column.
3. Reject files whose hash matches an already-committed batch, but allow the user to override.

### 4.3 Trade list and trade detail

- List: sortable and filterable table (date range, symbol, setup, mistake tag, win/loss, open/closed),
  with columns for symbol, dates, days held, avg entry and exit, size, net P&L, return %, R and setup.
  Show totals for the filtered set.
- Detail: the fills table, P&L breakdown, R, stop history, journal fields, tags, a screenshot gallery
  (drag-and-drop upload, lightbox) and a candlestick chart with entry and exit markers and stop and
  target lines once market data is available.

### 4.4 Dashboard (every chart respects a global filter bar: date range, setup, tag, symbol)

- **Core curves:** equity curve ($), TWR % curve, drawdown (underwater) curve, cumulative-R curve,
  and a monthly P&L calendar heatmap (cells show $ and trade count; clicking a cell filters the list).
- **Distributions:** R-multiple histogram, P&L histogram, MAE vs MFE scatter (each point links to its
  trade), and a holding-period vs R scatter.
- **Breakdowns:** expectancy, win rate, count and total P&L by setup, ticker, weekday of entry, month,
  and mistake tag. Mistake tags also show "cost of mistakes" (total P&L of trades with that tag).
- **Benchmark:** the TWR curve against SPY buy-and-hold over the same period, both indexed to 100.
- **KPI tiles:** net P&L, win rate, profit factor, expectancy (R), max DD %, number of trades.

### 4.5 Open positions

Symbol, shares, avg cost, last close, unrealised P&L ($, %, R), current stop, distance to stop (% and R),
and open risk $ (sum of shares × (price − stop)). Total open risk is shown as a percentage of equity.
Label prices as **"last close"** because free data is end-of-day or delayed, not real-time.

### 4.6 Market data

- A `MarketDataProvider` interface with `getDailyCandles(symbol, from, to)`. The API key goes in `.env`.
- Before choosing a provider, **check the current free-tier terms and rate limits** (candidates: Tiingo,
  Twelve Data, Alpha Vantage). Present the options to the user and let them pick.
- Cache everything in the `candles` table and fetch only missing ranges. A client-side rate limiter
  respects the provider's limits. Failures degrade gracefully: the app works without market data, and
  MAE/MFE, the benchmark and unrealised P&L show "no data".
- Known limitation: stock splits. v1 detects a split (price ratio jump between consecutive closes ≈ 2, 3, 4, 1/2 and so on)
  and flags affected trades. It does not auto-adjust them.

### 4.7 Export and backup

- Export trades (with derived metrics), executions and cash flows to CSV, using the current filters.
- "Backup now" uses `better-sqlite3`'s online `.backup()` to write `data/backups/journal-YYYYMMDD-HHmm.db`,
  and the uploads folder is zipped alongside it. The last 10 backups are kept. A restore can be run from the settings page.

### 4.8 Settings

Starting balance and date, break-even threshold, default commission, market-data provider and key status,
and tag management (rename, merge, recolour, delete-with-reassign).

---

## 5. Build phases

Each phase ends with: `npm run lint && npm test` green, E2E green from Phase 3 on, and a short summary
to the user. **Stop after each phase and wait for go-ahead.**

### Phase 0 — Scaffold

Workspaces, TS strict, ESLint and Prettier, Vitest in every package, Playwright configured, `npm run dev`
running the server and web concurrently, a health-check endpoint, and a web page that calls it.
Create every script that `CLAUDE.md` § Commands names (`typecheck`, `lint`, `test`, `test:e2e`, `db:migrate`,
`db:seed`, `dev`). Use a root `vitest.config.ts` with `test.projects` so `npx vitest run <file>` works from the root.
Formatting lives in Prettier/ESLint config and is applied by the `.claude/hooks/post-edit-format.sh` hook,
so it needs no CLAUDE.md rules.
**DoD:** a fresh clone followed by `npm i && npm run dev` works, there is one passing test in each package plus one E2E smoke test,
and editing a `.ts` file triggers the format hook.

### Phase 1 — Core domain (pure TS, TDD)

Money helpers, execution grouping, P&L, R, the metrics in §2.4, the equity, TWR and drawdown series, and
breakdown aggregation.
**Required test cases (hand-calculated):** single entry and exit win and loss; scale-in 3 fills then
single exit; single entry then 3 scale-outs; scale-in and scale-out interleaved; fees turning a gross win into a
net loss; a sell exceeding the position (error); a break-even trade; a trade with no stop (excluded from R);
TWR with a mid-period deposit (the deposit must not count as return); drawdown recovery; same-timestamp ordering.
**DoD:** ≥95% line coverage on `packages/core`.

### Phase 2 — Database and API

Drizzle schema and migrations, the repository layer, regrouping on execution insert/update/delete with
stable keys preserved, and REST endpoints for executions, trades, journal fields, tags, stops, cash flows
and settings. Add a seed script with about 40 realistic demo trades covering every edge case from Phase 1.
**DoD:** integration tests for every route, plus a regrouping test showing that journal notes survive an earlier-dated fill being inserted.

### Phase 3 — Manual entry and journaling UI

App shell and navigation, the new trade and add fill forms, trade list, trade detail (no candles yet),
tags, stop history, screenshot upload and gallery, and cash-flow entry.
**DoD:** E2E covering creating a trade with a scale-out, adding notes, tags and a screenshot, then seeing correct totals in the list.

### Phase 4 — Imports

The import pipeline (preview, commit, undo), the IBKR Flex XML and CSV importer (**get the sample from the
user first**), the generic CSV importer with mapping presets, and an import history page.
**DoD:** fixture tests per importer; importing the same file twice inserts 0 rows the second time; undo
restores the exact prior state; an E2E test of the import flow.

### Phase 5 — Dashboard and analytics

Everything in §4.4 except the benchmark and MAE/MFE, plus the global filter bar and KPI tiles.
**DoD:** using the seed data, the dashboard figures match values asserted in tests, and an E2E test checks that applying a filter changes the KPIs.

### Phase 6 — Market data

Provider selection (ask the user), the provider implementation, candle cache, rate limiter, candlestick
chart on trade detail, MAE/MFE (scatter included), the SPY benchmark, the open-positions page, and split detection.
**DoD:** the provider is mocked in tests (no network calls in the test suite), and a cache test proves the second request makes 0 HTTP calls.

### Phase 7 — Export, backup and polish

CSV exports, backup and restore, the settings page, empty states, loading and error states, a dark mode
toggle, keyboard shortcut `n` for a new trade, and a final README.
**DoD:** a backup → wipe → restore round-trip test, and the full E2E suite green.
