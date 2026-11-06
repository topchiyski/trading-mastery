/** CSV exports of trades (with derived metrics), executions and cash flows, honouring filters. */
import { formatMicros, nyDateOf, toCsv, toNyDate, type CsvCell } from '@tj/core';
import { asc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client';
import { executions, tradeExecutions, trades } from '../db/schema';
import { listCashFlows } from '../repo/cash-flows';
import { listTrades } from '../repo/trades';
import { plainDate } from '../validation';
import { tradeListQuery } from './trades';

/** Dollars with 2 decimals. */
const money = (m: number | null | undefined): CsvCell => (m == null ? '' : formatMicros(m, 2));
/** Prices: as many decimals as needed (at least 2). */
const price = (m: number | null | undefined): CsvCell => {
  if (m == null) return '';
  const s = formatMicros(m, 6).replace(/0+$/, '');
  return /\.\d$/.test(s) ? `${s}0` : s.endsWith('.') ? `${s}00` : s;
};
/** Shares without trailing zeros or separators. */
const shares = (q: number | null | undefined): CsvCell =>
  q == null ? '' : formatMicros(q, 6).replace(/\.?0+$/, '');
const fixed = (n: number | null | undefined, d = 2): CsvCell => (n == null ? '' : n.toFixed(d));

function send(reply: FastifyReply, name: string, rows: CsvCell[][]) {
  const stamp = toNyDate(new Date().toISOString()).replace(/-/g, '');
  return reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${name}-${stamp}.csv"`)
    .send(toCsv(rows));
}

const execQuery = z.object({
  symbol: z.string().trim().toUpperCase().optional(),
  from: plainDate.optional(),
  to: plainDate.optional(),
});
const rangeQuery = z.object({ from: plainDate.optional(), to: plainDate.optional() });

export function exportRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/export/trades.csv', async (req, reply) => {
    const { trades: items } = listTrades(db, tradeListQuery.parse(req.query));
    const ids = items.map((t) => t.id);
    const journal = new Map(
      (ids.length ? db.select().from(trades).where(inArray(trades.id, ids)).all() : []).map((r) => [
        r.id,
        r,
      ]),
    );
    const head = [
      'id',
      'symbol',
      'direction',
      'status',
      'opened_at',
      'closed_at',
      'trading_days',
      'calendar_days',
      'shares',
      'avg_entry',
      'avg_exit',
      'gross_pnl',
      'fees',
      'net_pnl',
      'return_pct',
      'initial_stop',
      'target',
      'initial_risk',
      'r_multiple',
      'planned_rr',
      'outcome',
      'setup',
      'tags',
      'emotion',
      'execution_rating',
      'followed_plan',
      'thesis',
      'review',
    ];
    const rows = items.map((t): CsvCell[] => {
      const j = journal.get(t.id);
      return [
        t.id,
        t.symbol,
        t.direction,
        t.status,
        t.openedAt,
        t.closedAt,
        t.holding?.tradingDays,
        t.holding?.calendarDays,
        shares(t.quantity),
        price(t.avgEntry),
        price(t.avgExit),
        money(t.netPnl === null ? null : t.netPnl + (t.fees ?? 0)),
        money(t.fees),
        money(t.netPnl),
        fixed(t.returnPct === null ? null : t.returnPct * 100),
        price(j?.initialStop),
        price(j?.target),
        money(t.initialRisk),
        fixed(t.rMultiple),
        fixed(t.plannedRewardRisk),
        t.outcome,
        t.setupTag?.name,
        t.tags.map((x) => x.name).join('; '),
        j?.emotion,
        j?.executionRating,
        j?.followedPlan == null ? '' : j.followedPlan ? 'yes' : 'no',
        j?.thesis,
        j?.review,
      ];
    });
    return send(reply, 'trades', [head, ...rows]);
  });

  app.get('/api/export/executions.csv', async (req, reply) => {
    const q = execQuery.parse(req.query);
    const tradeOf = new Map(
      db
        .select()
        .from(tradeExecutions)
        .all()
        .map((l) => [l.executionId, l.tradeId]),
    );
    const rows = db
      .select()
      .from(executions)
      .where(q.symbol ? eq(executions.symbol, q.symbol) : undefined)
      .orderBy(asc(executions.executedAt), asc(executions.id))
      .all()
      .filter((e) => {
        const d = nyDateOf(e.executedAt);
        return (!q.from || d >= q.from) && (!q.to || d <= q.to);
      })
      .map((e): CsvCell[] => [
        e.id,
        e.executedAt,
        e.symbol,
        e.side,
        shares(e.quantity),
        price(e.price),
        money(e.commission),
        money(e.otherFees),
        e.source,
        e.externalId,
        tradeOf.get(e.id),
      ]);
    const head = [
      'id',
      'executed_at',
      'symbol',
      'side',
      'quantity',
      'price',
      'commission',
      'other_fees',
      'source',
      'external_id',
      'trade_id',
    ];
    return send(reply, 'executions', [head, ...rows]);
  });

  app.get('/api/export/cash-flows.csv', async (req, reply) => {
    const rows = listCashFlows(db, rangeQuery.parse(req.query)).map((c): CsvCell[] => [
      c.id,
      c.occurredAt,
      c.type,
      money(c.amount),
      c.note,
      c.externalId,
    ]);
    return send(reply, 'cash-flows', [
      ['id', 'occurred_at', 'type', 'amount', 'note', 'external_id'],
      ...rows,
    ]);
  });
}
