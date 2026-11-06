import { METRIC_DEFINITIONS, histogram, niceStep, type PortfolioMetrics } from '@tj/core';
import { useMemo, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useDashboard, useTags } from '../api/hooks';
import type { BreakdownRow, DashboardFilters } from '../api/types';
import { Histogram, LineChart, MonthHeatmap, Scatter } from '../components/charts/Charts';
import { ErrorBox, Field, Loading } from '../components/ui';
import { fmtCompactMoney, fmtMoney, fmtPct, fmtR, tone } from '../lib/format';

// --- filters (URL-backed, one row above every chart)

function useDashboardFilters() {
  const [params, setParams] = useSearchParams();
  const filters: DashboardFilters = {};
  const get = (k: string) => params.get(k) || undefined;
  const from = get('from');
  if (from) filters.from = from;
  const to = get('to');
  if (to) filters.to = to;
  const symbol = get('symbol');
  if (symbol) filters.symbol = symbol;
  const setupTagId = Number(get('setupTagId'));
  if (setupTagId) filters.setupTagId = setupTagId;
  const tagId = Number(get('tagId'));
  if (tagId) filters.tagId = tagId;
  const set = (k: string, v: string) =>
    setParams(
      (p) => {
        if (v) p.set(k, v);
        else p.delete(k);
        return p;
      },
      { replace: true },
    );
  return { filters, params, set, clear: () => setParams({}, { replace: true }) };
}

function FilterBar() {
  const { params, set, clear } = useDashboardFilters();
  const tags = useTags();
  const any = [...params.keys()].length > 0;
  return (
    <div className="filters" role="search" aria-label="Dashboard filters">
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
      <Field label="Setup">
        {(p) => (
          <select
            {...p}
            value={params.get('setupTagId') ?? ''}
            onChange={(e) => set('setupTagId', e.target.value)}
          >
            <option value="">All</option>
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
      <Field label="Tag">
        {(p) => (
          <select
            {...p}
            value={params.get('tagId') ?? ''}
            onChange={(e) => set('tagId', e.target.value)}
          >
            <option value="">All</option>
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
      <Field label="Symbol">
        {(p) => (
          <input
            {...p}
            value={params.get('symbol') ?? ''}
            placeholder="All"
            style={{ width: 100 }}
            onChange={(e) => set('symbol', e.target.value.toUpperCase().trim())}
          />
        )}
      </Field>
      {any && (
        <button type="button" onClick={clear}>
          Clear filters
        </button>
      )}
    </div>
  );
}

// --- metric formatting

const MONEY: (keyof PortfolioMetrics)[] = [
  'totalNetPnl',
  'grossWins',
  'grossLosses',
  'avgWin',
  'avgLoss',
  'expectancy',
  'largestWin',
  'largestLoss',
  'totalFees',
  'maxDrawdown',
];

function fmtMetric(key: keyof PortfolioMetrics, m: PortfolioMetrics): string {
  const v = m[key];
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') {
    return `${v.tradingDays.toFixed(1)} trading days (${v.calendarDays.toFixed(1)} calendar)`;
  }
  if (MONEY.includes(key)) return fmtMoney(v);
  if (key === 'winRate' || key === 'maxDrawdownPct') return fmtPct(v, 1);
  if (key === 'expectancyR') return fmtR(v);
  if (key === 'payoffRatio' || key === 'profitFactor' || key === 'sharpe' || key === 'sortino')
    return v.toFixed(2);
  return String(v);
}

function Kpi({
  k,
  m,
  label,
  testId,
}: {
  k: keyof PortfolioMetrics;
  m: PortfolioMetrics;
  label?: string;
  testId: string;
}) {
  const def = METRIC_DEFINITIONS[k];
  const v = m[k];
  return (
    <div className="stat" data-testid={testId} title={def.definition}>
      <div className="label">
        {label ?? def.label} <span aria-hidden>ⓘ</span>
      </div>
      <div
        className={`value ${typeof v === 'number' && (MONEY.includes(k) || k === 'expectancyR') ? tone(v) : ''}`}
      >
        {fmtMetric(k, m)}
      </div>
      <span className="visually-hidden">{def.definition}</span>
    </div>
  );
}

// --- cards and tables

function ChartCard({
  title,
  sub,
  children,
  data,
}: {
  title: string;
  sub?: ReactNode;
  children: ReactNode;
  data?: ReactNode;
}) {
  return (
    <section className="card chart-card" aria-label={title}>
      <h2>{title}</h2>
      {sub && <div className="sub">{sub}</div>}
      {children}
      {data && (
        <details>
          <summary>Data</summary>
          <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
            {data}
          </div>
        </details>
      )}
    </section>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table>
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={h} className={i > 0 ? 'num' : undefined}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} className={j > 0 ? 'num' : undefined}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BreakdownTable({
  title,
  rows,
  rank = 'desc',
  link,
  note,
}: {
  title: string;
  rows: BreakdownRow[];
  /** Order by net P&L ('asc' puts the costliest first), or keep the natural order. */
  rank?: 'desc' | 'asc' | false;
  link?: (key: string) => string;
  note?: string;
}) {
  const sorted = rank
    ? [...rows].sort((a, b) => (rank === 'asc' ? 1 : -1) * (a.totalNetPnl - b.totalNetPnl))
    : rows;
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.totalNetPnl)));
  return (
    <section className="card" aria-label={title}>
      <h2>{title}</h2>
      {note && (
        <div className="sub muted" style={{ fontSize: 12, marginBottom: 8 }}>
          {note}
        </div>
      )}
      {rows.length === 0 ? (
        <p className="muted">No trades.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th />
                <th className="num">Trades</th>
                <th className="num">Win rate</th>
                <th className="num">Expectancy</th>
                <th className="num">Exp. R</th>
                <th className="num">Net P&L</th>
                <th aria-hidden />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const w = (Math.abs(r.totalNetPnl) / maxAbs) * 50;
                return (
                  <tr key={r.key}>
                    <td>{link ? <Link to={link(r.key)}>{r.key}</Link> : r.key}</td>
                    <td className="num">{r.count}</td>
                    <td className="num">{fmtPct(r.winRate, 0)}</td>
                    <td className={`num ${tone(r.expectancy)}`}>{fmtMoney(r.expectancy)}</td>
                    <td
                      className={`num ${tone(r.expectancyR)}`}
                      title={
                        r.rExcludedCount ? `${r.rExcludedCount} without a stop excluded` : undefined
                      }
                    >
                      {fmtR(r.expectancyR)}
                    </td>
                    <td className={`num ${tone(r.totalNetPnl)}`}>{fmtMoney(r.totalNetPnl)}</td>
                    <td className="bar-cell" aria-hidden>
                      <span className="bar-axis" />
                      <span
                        className="bar"
                        style={{
                          width: `${w}%`,
                          left: r.totalNetPnl >= 0 ? '50%' : `${50 - w}%`,
                          background:
                            r.totalNetPnl >= 0 ? 'var(--chart-series)' : 'var(--chart-neg)',
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// --- page

const lastDayOf = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y ?? 2000, m ?? 1, 0)).toISOString().slice(0, 10);
};

export function DashboardPage() {
  const { filters } = useDashboardFilters();
  const dash = useDashboard(filters);
  const navigate = useNavigate();
  const d = dash.data;

  const series = useMemo(() => {
    if (!d) return null;
    const pnl = d.trades.map((t) => t.netPnl / 1e6);
    const rs = d.trades.map((t) => t.rMultiple).filter((r): r is number => r !== null);
    const pnlWidth = niceStep(Math.max(...pnl, 0) - Math.min(...pnl, 0), 12);
    return {
      equity: d.equity.map((p) => ({ x: p.date, y: p.equity })),
      twr: d.equity.map((p) => ({ x: p.date, y: p.twrIndex - 1 })),
      drawdown: d.equity.map((p) => ({ x: p.date, y: p.twrDrawdownPct })),
      cumR: d.rCurve.points.map((p) => ({ x: p.closedAt.slice(0, 10), y: p.cumR })),
      rBins: histogram(rs, 0.5),
      pnlBins: histogram(pnl, pnlWidth),
      scatter: d.trades
        .filter((t) => t.rMultiple !== null)
        .map((t) => ({
          id: t.id,
          x: t.tradingDays,
          y: t.rMultiple ?? 0,
          label: `${t.symbol}, closed ${t.closedAt.slice(0, 10)}, ${t.tradingDays} trading days`,
        })),
    };
  }, [d]);

  const trailing = new URLSearchParams(
    Object.entries({
      setupTagId: filters.setupTagId,
      tagId: filters.tagId,
      symbol: filters.symbol,
    }).flatMap(([k, v]) => (v ? [[k, String(v)]] : [])),
  ).toString();

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Dashboard</h1>
      </div>
      <FilterBar />
      <ErrorBox error={dash.error} />
      {!d || !series ? (
        <Loading />
      ) : (
        <>
          {d.startingBalance === 0 && d.includesCashFlows && (
            <div className="banner" role="status">
              No starting balance is set, so % returns and % drawdown can't be computed until the
              account has a balance. Dollar figures and R are unaffected.
            </div>
          )}
          {!d.includesCashFlows && (
            <p className="muted" style={{ margin: 0 }}>
              Filtered view: the equity curve shows the starting balance plus the matching trades
              only; deposits, withdrawals and other cash items are left out.
            </p>
          )}

          <div className="kpis" aria-label="Key figures">
            <Kpi k="totalNetPnl" m={d.metrics} testId="kpi-net-pnl" />
            <Kpi k="winRate" m={d.metrics} testId="kpi-win-rate" />
            <Kpi k="profitFactor" m={d.metrics} testId="kpi-profit-factor" />
            <Kpi k="expectancyR" m={d.metrics} testId="kpi-expectancy-r" />
            <Kpi k="maxDrawdownPct" m={d.metrics} testId="kpi-max-dd" />
            <Kpi k="count" m={d.metrics} testId="kpi-trades" label="Closed trades" />
          </div>
          {d.metrics.rExcludedCount > 0 && (
            <p className="muted" style={{ margin: 0 }}>
              {d.metrics.rExcludedCount} of {d.metrics.count} trades have no initial stop and are
              left out of every R statistic.
            </p>
          )}

          <div className="dash-grid">
            <ChartCard
              title="Equity"
              sub={
                d.includesCashFlows
                  ? 'Starting balance + cash flows + realised P&L'
                  : 'Starting balance + matching trades'
              }
              data={
                <DataTable
                  head={['Date', 'Equity']}
                  rows={d.equity.map((p) => [p.date, fmtMoney(p.equity)])}
                />
              }
            >
              <LineChart
                points={series.equity}
                format={(v) => fmtCompactMoney(v, { signed: false })}
                tooltipFormat={fmtMoney}
                label="Equity curve"
              />
            </ChartCard>
            <ChartCard
              title="Time-weighted return"
              sub="Deposits and withdrawals are not counted as return"
              data={
                <DataTable
                  head={['Date', 'TWR']}
                  rows={d.equity.map((p) => [p.date, fmtPct(p.twrIndex - 1)])}
                />
              }
            >
              <LineChart
                points={series.twr}
                format={(v) => fmtPct(v, 1)}
                tooltipFormat={(v) => fmtPct(v, 2)}
                includeZero
                label="Time-weighted return"
              />
            </ChartCard>
            <ChartCard
              title="Drawdown"
              sub="Distance below the previous high of the time-weighted return"
              data={
                <DataTable
                  head={['Date', 'Drawdown']}
                  rows={d.equity.map((p) => [p.date, fmtPct(p.twrDrawdownPct)])}
                />
              }
            >
              <LineChart
                points={series.drawdown}
                format={(v) => fmtPct(v, 1)}
                tooltipFormat={(v) => fmtPct(v, 2)}
                area="toZero"
                color="var(--chart-neg)"
                label="Drawdown"
              />
            </ChartCard>
            <ChartCard
              title="Cumulative R"
              sub={`Trades in close order${d.rCurve.excluded ? `; ${d.rCurve.excluded} without a stop excluded` : ''}`}
              data={
                <DataTable
                  head={['Closed', 'R', 'Cumulative R']}
                  rows={d.rCurve.points.map((p) => [
                    p.closedAt.slice(0, 10),
                    fmtR(p.rMultiple),
                    fmtR(p.cumR),
                  ])}
                />
              }
            >
              <LineChart
                points={series.cumR}
                format={(v) => `${v.toFixed(1)}R`}
                tooltipFormat={fmtR}
                includeZero
                label="Cumulative R"
              />
            </ChartCard>
            <ChartCard
              title="Monthly net P&L"
              sub="Blue = gain, red = loss; click a month to see its trades"
              data={
                <DataTable
                  head={['Month', 'Net P&L', 'Trades']}
                  rows={d.monthly.map((m) => [m.month, fmtMoney(m.netPnl), m.count])}
                />
              }
            >
              <MonthHeatmap
                cells={d.monthly}
                formatMoney={fmtMoney}
                formatCompact={fmtCompactMoney}
                onOpen={(month) =>
                  void navigate(
                    `/trades?status=CLOSED&from=${month}-01&to=${lastDayOf(month)}${trailing ? `&${trailing}` : ''}`,
                  )
                }
              />
            </ChartCard>
            <ChartCard
              title="R-multiple distribution"
              sub="Trades per 0.5R bucket"
              data={
                <DataTable
                  head={['From', 'To', 'Trades']}
                  rows={series.rBins.map((b) => [fmtR(b.from), fmtR(b.to), b.count])}
                />
              }
            >
              <Histogram
                bins={series.rBins}
                binLabel={(b) => `${fmtR(b.from)} to ${fmtR(b.to)}`}
                label="R-multiple distribution"
              />
            </ChartCard>
            <ChartCard
              title="P&L distribution"
              sub="Trades per net P&L bucket"
              data={
                <DataTable
                  head={['From', 'To', 'Trades']}
                  rows={series.pnlBins.map((b) => [
                    fmtMoney(b.from * 1e6),
                    fmtMoney(b.to * 1e6),
                    b.count,
                  ])}
                />
              }
            >
              <Histogram
                bins={series.pnlBins}
                binLabel={(b) =>
                  `${fmtCompactMoney(b.from * 1e6)} to ${fmtCompactMoney(b.to * 1e6)}`
                }
                label="Net P&L distribution"
              />
            </ChartCard>
            <ChartCard
              title="Holding period vs R"
              sub="Each dot is a trade; click to open it"
              data={
                <DataTable
                  head={['Trade', 'Trading days', 'R']}
                  rows={series.scatter.map((p) => [p.label.split(',')[0] ?? '', p.x, fmtR(p.y)])}
                />
              }
            >
              <Scatter
                points={series.scatter}
                xFormat={(v) => String(v)}
                yFormat={(v) => `${v.toFixed(1)}R`}
                xTitle="Trading days held"
                onOpen={(id) => void navigate(`/trades/${id}`)}
                label="Holding period versus R-multiple"
              />
            </ChartCard>
          </div>

          <div className="dash-grid">
            <BreakdownTable title="By setup" rows={d.breakdowns.setup} />
            <BreakdownTable
              title="By mistake — cost of mistakes"
              rows={d.breakdowns.mistake}
              rank="asc"
              note="Net P&L of the trades carrying each mistake tag (a trade with two tags counts in both)."
            />
            <BreakdownTable
              title="By ticker"
              rows={d.breakdowns.symbol}
              link={(s) => `/trades?symbol=${encodeURIComponent(s)}`}
            />
            <BreakdownTable title="By weekday of entry" rows={d.breakdowns.weekday} rank={false} />
            <BreakdownTable title="By month (close)" rows={d.breakdowns.month} rank={false} />
          </div>

          <section className="card" aria-label="All statistics">
            <h2>All statistics</h2>
            <div className="table-wrap">
              <table>
                <tbody>
                  {(Object.keys(METRIC_DEFINITIONS) as (keyof PortfolioMetrics)[]).map((k) => (
                    <tr key={k}>
                      <td>{METRIC_DEFINITIONS[k].label}</td>
                      <td className="num">{fmtMetric(k, d.metrics)}</td>
                      <td className="muted" style={{ whiteSpace: 'normal' }}>
                        {METRIC_DEFINITIONS[k].definition}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
