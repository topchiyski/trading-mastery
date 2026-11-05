# Swing Trade Journal

Local, single-user journal for long-only US-equity swing trades. The full spec and build plan
live in `docs/SPEC.md`; calculation choices the spec leaves open are in `docs/DECISIONS.md`.
Work phase by phase and stop after each phase for go-ahead.

## Layout

- `packages/core` — pure TS domain logic (grouping, P&L, R, metrics, curves). No I/O. TDD.
- `packages/server` — Fastify API + Drizzle/SQLite (`better-sqlite3`). Binds to 127.0.0.1:3001.
- `packages/web` — Vite + React UI on localhost:5173, proxies `/api` to the server.
- `e2e/` — Playwright tests (start the dev servers automatically).

## Commands

- `npm run dev` — server + web concurrently
- `npm run typecheck` — `tsc` in every package
- `npm run lint` — ESLint + Prettier check
- `npm test` — all Vitest projects; single file: `npx vitest run <path>`
- `npm run test:e2e` — Playwright
- `npm run db:migrate` / `npm run db:seed` — apply migrations / load demo data

## Rules

- Money and prices are INTEGER micros (1 USD = 1_000_000); never floats in storage or core math.
- Timestamps are stored as UTC ISO-8601 TEXT; trading-day logic uses America/New_York dates.
- v1 is long-only, but keep `direction` columns and don't hard-code assumptions that block shorts.
- Never silently clip a sell that exceeds the position; surface it as a validation error.
- Journal data is keyed by a trade's `stable_key` (first execution id); never delete orphaned journal data.
- Tests must not hit the network; mock the market-data provider.
- Phase done = `npm run lint && npm test` green (+ `npm run test:e2e` from Phase 3).
