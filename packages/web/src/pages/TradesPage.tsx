import type { Outcome } from '@tj/core';
import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTags, useTrades } from '../api/hooks';
import type { TradeFilters, TradeListItem } from '../api/types';
import { ErrorBox, Field, Loading } from '../components/ui';
import { fmtDays, fmtMoney, fmtNyDate, fmtPct, fmtR, tone } from '../lib/format';

type SortKey =
  | 'symbol'
  | 'openedAt'
  | 'closedAt'
  | 'days'
  | 'avgEntry'
  | 'avgExit'
  | 'quantity'
  | 'netPnl'
  | 'returnPct'
  | 'rMultiple'
  | 'setup';

const COLUMNS: { key: SortKey; label: string; num?: boolean }[] = [
  { key: 'symbol', label: 'Symbol' },
  { key: 'openedAt', label: 'Opened' },
  { key: 'closedAt', label: 'Closed' },
  { key: 'days', label: 'Days', num: true },
  { key: 'avgEntry', label: 'Avg entry', num: true },
  { key: 'avgExit', label: 'Avg exit', num: true },
  { key: 'quantity', label: 'Size', num: true },
  { key: 'netPnl', label: 'Net P&L', num: true },
  { key: 'returnPct', label: 'Return', num: true },
  { key: 'rMultiple', label: 'R', num: true },
  { key: 'setup', label: 'Setup' },
];

function sortValue(t: TradeListItem, key: SortKey): string | number | null {
  switch (key) {
    case 'days':
      return t.holding?.tradingDays ?? null;
    case 'setup':
      return t.setupTag?.name ?? null;
    case 'netPnl':
      return t.netPnl ?? t.realisedNet;
    default:
      return t[key];
  }
}

function sortTrades(trades: TradeListItem[], key: SortKey | null, dir: 'asc' | 'desc') {
  if (!key) return trades;
  const sign = dir === 'asc' ? 1 : -1;
  return [...trades].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === vb) return 0;
    if (va === null) return 1; // empty values last either way
    if (vb === null) return -1;
    return (va < vb ? -1 : 1) * sign;
  });
}

/** Filters live in the URL so other pages (e.g. the dashboard heatmap) can link to a filtered list. */
function useFilters() {
  const [params, setParams] = useSearchParams();
  const filters: TradeFilters = {};
  const str = (k: string) => params.get(k) || undefined;
  const num = (k: string) => (params.get(k) ? Number(params.get(k)) : undefined);
  const status = str('status');
  if (status === 'OPEN' || status === 'CLOSED') filters.status = status;
  const symbol = str('symbol');
  if (symbol) filters.symbol = symbol;
  const setupTagId = num('setupTagId');
  if (setupTagId) filters.setupTagId = setupTagId;
  const tagId = num('tagId');
  if (tagId) filters.tagId = tagId;
  const outcome = str('outcome');
  if (outcome === 'WIN' || outcome === 'LOSS' || outcome === 'BREAKEVEN')
    filters.outcome = outcome as Outcome;
  const from = str('from');
  if (from) filters.from = from;
  const to = str('to');
  if (to) filters.to = to;
  if (params.get('orphaned') === 'only') filters.orphaned = 'only';
  const set = (k: string, v: string) =>
    setParams(
      (p) => {
        if (v) p.set(k, v);
        else p.delete(k);
        return p;
      },
      { replace: true },
    );
  const sort = (str('sort') as SortKey | undefined) ?? null;
  const dir = params.get('dir') === 'asc' ? 'asc' : 'desc';
  return { filters, params, set, sort, dir: dir as 'asc' | 'desc', setParams };
}

export function TradesPage() {
  const { filters, params, set, sort, dir, setParams } = useFilters();
  const trades = useTrades(filters);
  const orphans = useTrades({ orphaned: 'only' });
  const tags = useTags();
  const navigate = useNavigate();
  const rows = useMemo(
    () => sortTrades(trades.data?.trades ?? [], sort, dir),
    [trades.data, sort, dir],
  );
  const totals = trades.data?.totals;
  const showingOrphans = filters.orphaned === 'only';

  const toggleSort = (key: SortKey) =>
    setParams(
      (p) => {
        p.set('sort', key);
        p.set('dir', sort === key && dir === 'desc' ? 'asc' : 'desc');
        return p;
      },
      { replace: true },
    );

  return (
    <>
      <div className="page-head">
        <h1>{showingOrphans ? 'Orphaned journal entries' : 'Trades'}</h1>
      </div>

      {!showingOrphans && (orphans.data?.trades.length ?? 0) > 0 && (
        <div className="banner" role="status">
          {orphans.data?.trades.length} journal{' '}
          {orphans.data?.trades.length === 1 ? 'entry has' : 'entries have'} lost their executions
          after a regroup. <Link to="/trades?orphaned=only">Review them</Link>.
        </div>
      )}
      {showingOrphans && (
        <p className="muted">
          These journal entries no longer match any executions (for example after an import changed
          how fills group). Their notes, tags and screenshots are kept until you delete them.{' '}
          <Link to="/trades">Back to all trades</Link>
        </p>
      )}

      <div className="filters" role="search">
        <Field label="From">
          {(p) => (
            <input
              {...p}
              type="date"
              value={params.get('from') ?? ''}
              onChange={(e) => set('from', e.target.value)}
            />
          )}
        </Field>
        <Field label="To">
          {(p) => (
            <input
              {...p}
              type="date"
              value={params.get('to') ?? ''}
              onChange={(e) => set('to', e.target.value)}
            />
          )}
        </Field>
        <Field label="Symbol">
          {(p) => (
            <input
              {...p}
              value={params.get('symbol') ?? ''}
              placeholder="Any"
              onChange={(e) => set('symbol', e.target.value.toUpperCase())}
              style={{ width: 100 }}
            />
          )}
        </Field>
        <Field label="Setup">
          {(p) => (
            <select
              {...p}
              value={params.get('setupTagId') ?? ''}
              onChange={(e) => set('setupTagId', e.target.value)}
            >
              <option value="">Any</option>
              {tags.data
                ?.filter((t) => t.kind === 'SETUP')
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          )}
        </Field>
        <Field label="Mistake / tag">
          {(p) => (
            <select
              {...p}
              value={params.get('tagId') ?? ''}
              onChange={(e) => set('tagId', e.target.value)}
            >
              <option value="">Any</option>
              {tags.data
                ?.filter((t) => t.kind !== 'SETUP')
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          )}
        </Field>
        <Field label="Result">
          {(p) => (
            <select
              {...p}
              value={params.get('outcome') ?? ''}
              onChange={(e) => set('outcome', e.target.value)}
            >
              <option value="">Any</option>
              <option value="WIN">Winners</option>
              <option value="LOSS">Losers</option>
              <option value="BREAKEVEN">Break-even</option>
            </select>
          )}
        </Field>
        <Field label="Status">
          {(p) => (
            <select
              {...p}
              value={params.get('status') ?? ''}
              onChange={(e) => set('status', e.target.value)}
            >
              <option value="">Any</option>
              <option value="OPEN">Open</option>
              <option value="CLOSED">Closed</option>
            </select>
          )}
        </Field>
      </div>

      <ErrorBox error={trades.error} />
      {trades.isPending ? (
        <Loading />
      ) : rows.length === 0 ? (
        <div className="card empty">
          {Object.keys(filters).length > 0 ? (
            'No trades match these filters.'
          ) : (
            <>
              No trades yet. <Link to="/trades/new">Record your first trade</Link>.
            </>
          )}
        </div>
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    className={c.num ? 'num' : undefined}
                    aria-sort={
                      sort === c.key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'
                    }
                  >
                    <button type="button" onClick={() => toggleSort(c.key)}>
                      {c.label}
                      {sort === c.key ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const pnl = t.netPnl ?? t.realisedNet;
                return (
                  <tr key={t.id} className="clickable" onClick={() => navigate(`/trades/${t.id}`)}>
                    <td>
                      <Link to={`/trades/${t.id}`} onClick={(e) => e.stopPropagation()}>
                        {t.symbol}
                      </Link>{' '}
                      {t.status === 'OPEN' && !t.orphaned && (
                        <span className="badge open">Open</span>
                      )}
                      {t.orphaned && <span className="badge">Orphaned</span>}
                    </td>
                    <td>{fmtNyDate(t.openedAt)}</td>
                    <td>{fmtNyDate(t.closedAt)}</td>
                    <td className="num">{fmtDays(t.holding)}</td>
                    <td className="num">{fmtMoney(t.avgEntry)}</td>
                    <td className="num">{fmtMoney(t.avgExit)}</td>
                    <td className="num">{t.quantity ?? '—'}</td>
                    <td
                      className={`num ${tone(pnl)}`}
                      title={
                        t.netPnl === null && pnl !== null
                          ? 'Realised so far (open trade)'
                          : undefined
                      }
                    >
                      {fmtMoney(pnl)}
                    </td>
                    <td className={`num ${tone(t.returnPct)}`}>{fmtPct(t.returnPct)}</td>
                    <td className={`num ${tone(t.rMultiple)}`}>{fmtR(t.rMultiple)}</td>
                    <td>{t.setupTag?.name ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
            {totals && (
              <tfoot>
                <tr data-testid="totals">
                  <td colSpan={7}>
                    {totals.count} {totals.count === 1 ? 'trade' : 'trades'}
                    <span className="muted" style={{ fontWeight: 400 }}>
                      {' '}
                      · {totals.closedCount} closed · {totals.wins}W / {totals.losses}L
                      {totals.breakEvens ? ` / ${totals.breakEvens} BE` : ''} · win rate{' '}
                      {fmtPct(totals.winRate, 0)}
                    </span>
                  </td>
                  <td className={`num ${tone(totals.netPnl)}`} title="Net P&L of closed trades">
                    {fmtMoney(totals.netPnl)}
                  </td>
                  <td />
                  <td
                    className={`num ${tone(totals.expectancyR)}`}
                    title={`Average R; ${totals.rExcludedCount} closed trade(s) without a stop excluded`}
                  >
                    {fmtR(totals.expectancyR)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </>
  );
}
