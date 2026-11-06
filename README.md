# Trading Mastery — Swing Trade Journal

A local-first journal for long-only US-equity swing trades. It turns broker fills into trades,
keeps the reasoning behind each one, and shows honest statistics: P&L, R-multiples, expectancy,
equity, time-weighted return and drawdown, MAE/MFE, and a comparison with SPY.

Everything runs on your own computer. There is no account, no cloud and no telemetry; your data
lives in a single SQLite file under `data/`.

## Features

- **Trades from fills.** Executions are grouped into trades automatically (scale-ins and scale-outs,
  fractional shares). Re-importing or back-dating fills regroups safely; journal notes stay attached.
- **Journal.** Thesis, review, emotion, execution rating, setup and mistake tags, trailing-stop
  history and screenshots (drag and drop, lightbox) on every trade.
- **Imports.** IBKR Activity Statement (CSV) and any broker's CSV through a saved column mapping.
  Every import is previewed first, duplicates are skipped, and imports can be undone.
- **Dashboard.** KPI tiles, equity / TWR / drawdown / cumulative-R curves, a monthly P&L heatmap,
  R and P&L distributions, holding period vs R, MAE vs MFE, breakdowns by setup, ticker, weekday,
  month and mistake ("cost of mistakes"), and portfolio vs SPY. Every metric explains itself.
- **Market data.** Daily candles from Tiingo (free plan), cached locally: candlestick chart per
  trade, MAE/MFE, open positions valued at the last close with open risk, split warnings.
- **Exports and backups.** CSV export of trades (with metrics), fills and cash flows; one-click
  backups of the database and screenshots, with restore.
- **Comfort.** Dark mode, keyboard shortcut <kbd>n</kbd> for a new trade, New York time throughout.

## Quick start

Requires **Node.js 22 or later**.

```sh
npm install
npm run dev          # API on 127.0.0.1:3001, app on http://localhost:5173
```

Then open http://localhost:5173:

1. **Settings** → set your starting balance (USD) and start date, so % returns can be computed.
2. **Import** your broker statement, or record trades with **New trade** (<kbd>n</kbd>).
3. Add an initial stop to the trades you want in the R statistics.

Want to look around first? `npm run db:seed` loads ~40 demo trades into an empty database
(`npm run db:seed -- --force` wipes the database first — careful with real data).

## Configuration (`.env`)

Copy `.env.example` to `.env`. All settings are optional.

| Variable               | Default             | Meaning                                                     |
| ---------------------- | ------------------- | ----------------------------------------------------------- |
| `MARKET_DATA_API_KEY`  | —                   | Tiingo API token (enables prices, MAE/MFE, positions, SPY). |
| `MARKET_DATA_PROVIDER` | `tiingo` with a key | `tiingo`, `synthetic` (offline made-up prices) or `none`.   |
| `PORT`                 | `3001`              | API port.                                                   |
| `DB_PATH`              | `data/journal.db`   | SQLite database.                                            |
| `UPLOADS_DIR`          | `data/uploads`      | Screenshots.                                                |
| `BACKUPS_DIR`          | `data/backups`      | Backups.                                                    |

Paths are relative to the repository root. `.env` and `data/` are gitignored.

### Market data (Tiingo)

1. Create a free account at [tiingo.com](https://www.tiingo.com) and copy your API token.
2. Put it in `.env` as `MARKET_DATA_API_KEY=...` and restart `npm run dev`.

Prices are fetched in the background (and on demand) within the free plan's limits of 50 requests
per hour and 1,000 per day, then cached permanently. A first backfill of ~130 symbols takes about
three hours; progress is shown under **Positions → Market data**. Prices are end-of-day ("last
close"), not real-time.

### Importing from Interactive Brokers

In the IBKR portal: **Performance & Reports → Statements → Activity**, period _Year to Date_ (or
a custom range), format **CSV**. Upload it under **Import**. US stock trades, USD dividends,
withholding tax, interest, fees, deposits and withdrawals are imported; other currencies and asset
classes are listed as skipped. Overlapping statements are fine — rows already imported are skipped.

Broker statements contain personal data: keep them outside the repo, or in the gitignored
`private/` folder.

## Backups

**Settings → Backups → Backup now** writes `data/backups/journal-YYYYMMDD-HHmm.db` plus a zip of
your screenshots, and keeps the 10 newest. Restoring replaces all data, after first backing up the
current state (so a restore can be undone). To keep a copy elsewhere, use **Download** or copy the
`data/backups/` folder.

## Commands

| Command                                  | What it does                                         |
| ---------------------------------------- | ---------------------------------------------------- |
| `npm run dev`                            | Run the API and the web app                          |
| `npm run typecheck`                      | Type-check every package                             |
| `npm run lint`                           | ESLint + Prettier check                              |
| `npm test`                               | Unit and integration tests (Vitest)                  |
| `npm run test:coverage`                  | Tests with coverage (≥ 95% lines enforced on core)   |
| `npm run test:e2e`                       | End-to-end tests (Playwright; isolated DB and ports) |
| `npm run db:migrate` / `npm run db:seed` | Apply migrations / load demo data                    |

E2E tests need a browser once: `npx playwright install chromium`. They use their own database in
`data/e2e/`, ports 3101/5174 and offline synthetic prices, so they never touch your journal or
call Tiingo.

## How it's built

```
packages/core     Pure TypeScript domain logic: grouping, P&L, R, metrics, equity, TWR,
                  drawdown, MAE/MFE, CSV, NYSE calendar. No I/O; 100% line coverage.
packages/server   Fastify REST API, SQLite via Drizzle + better-sqlite3, importers,
                  market-data cache, backups.
packages/web      React + Vite UI with TanStack Query; small SVG chart kit.
e2e/              Playwright tests.
docs/             SPEC.md (requirements) and DECISIONS.md (every calculation choice).
```

Money and prices are stored as integer micro-dollars and quantities as integer micro-shares, so
sums are exact. Times are stored in UTC and shown in New York time. The rules behind every number
(R, expectancy, TWR, drawdown, MAE/MFE…) are written down in [docs/DECISIONS.md](docs/DECISIONS.md).

## Contact

Questions or feedback? Reach me on LinkedIn:
[linkedin.com/in/stoyan-topchiyski](https://www.linkedin.com/in/stoyan-topchiyski/)

## License

[MIT](LICENSE) © 2026 Stoyan Topchiyski
