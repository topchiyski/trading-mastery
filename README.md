# Trading Mastery — Swing Trade Journal

Local-first swing trade journal for long-only US equities. It groups IBKR fills into trades, journals
the reasoning behind each one, and shows honest stats: P&L, R-multiples, expectancy, equity and
drawdown curves.

> Work in progress — built in phases. See [docs/SPEC.md](docs/SPEC.md) for the full specification and build plan.

## Quick start

Requires Node.js 22 or later.

```sh
npm i
npx playwright install chromium   # only needed for E2E tests
npm run dev                       # API on 127.0.0.1:3001, web app on http://localhost:5173
```

## Commands

| Command                                  | What it does                                 |
| ---------------------------------------- | -------------------------------------------- |
| `npm run dev`                            | Run the server and web app together          |
| `npm run typecheck`                      | Type-check every package                     |
| `npm run lint`                           | ESLint + Prettier check                      |
| `npm test`                               | Unit and integration tests (Vitest)          |
| `npm run test:e2e`                       | End-to-end tests (Playwright)                |
| `npm run db:migrate` / `npm run db:seed` | Apply migrations / load demo data (Phase 2+) |

## Contact

Questions or feedback? Reach me on LinkedIn:
[linkedin.com/in/stoyan-topchiyski](https://www.linkedin.com/in/stoyan-topchiyski/)

## License

[MIT](LICENSE) © 2026 Stoyan Topchiyski
