# Swing Trade Journal

Local, single-user journal for long-only US-equity swing trades. The full spec and build plan
live in `docs/SPEC.md`; calculation choices the spec leaves open are in `docs/DECISIONS.md`.
Work phase by phase and stop after each phase for go-ahead.

## Layout

- `packages/core` — pure TS domain logic (grouping, P&L, R, metrics, curves). No I/O. TDD.
- `packages/server` — Fastify API + Drizzle/SQLite (`better-sqlite3`). Binds to 127.0.0.1:3001.
- `packages/web` — Vite + React UI on localhost:5173, proxies `/api` to the server.
- `e2e/` — Playwright tests. They start their own servers on ports 3101/5174 with a throwaway DB in
  `data/e2e/` (wiped each run), so they never touch the real journal or a running dev session.

## Commands

- `npm run dev` — server + web concurrently
- `npm run typecheck` — `tsc` in every package
- `npm run lint` — ESLint + Prettier check
- `npm test` — all Vitest projects; single file: `npx vitest run <path>`
- `npm run test:e2e` — Playwright
- `npm run db:migrate` / `npm run db:seed` — apply migrations / load demo data (`-- --force` wipes first)
- `npm run db:generate -w @tj/server -- --name <name>` — new migration after editing `src/db/schema.ts`

## Rules

- Money and prices are INTEGER micros (1 USD = 1_000_000); never floats in storage or core math.
  The REST API also speaks micros; the web app converts with `toMicros` / `formatUsd` from `@tj/core`.
- Any write that touches executions must go through `repo/executions` (or `repo/trades`) so the
  symbol is regrouped in the same transaction (`regroupSymbol`). Never write `trades` status/keys directly.
- API errors are `{ error: { code, message, details? } }`; throw `DomainError` (see `src/errors.ts`).
- Server tests use `createTestApp()` (in-memory DB + temp uploads dir, `src/__fixtures__/test-app.ts`).
- Web: TanStack Query hooks in `src/api/hooks.ts`; form parsing/validation as pure functions in
  `src/lib/validate.ts` (unit-tested). Forms take New York local time; never use the browser time zone.
- E2E selectors use roles and labels (`getByRole`, `getByLabel`); keep labels unique within a form/region.
- Timestamps are stored as UTC ISO-8601 TEXT; trading-day logic uses America/New_York dates.
- v1 is long-only, but keep `direction` columns and don't hard-code assumptions that block shorts.
- Never silently clip a sell that exceeds the position; surface it as a validation error.
- Journal data is keyed by a trade's `stable_key` (first execution id); never delete orphaned journal data.
- Tests must not hit the network; mock the market-data provider.
- Phase done = `npm run lint && npm test` green (+ `npm run test:e2e` from Phase 3).
