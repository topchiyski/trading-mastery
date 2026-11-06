import { Link } from 'react-router';
import { useMarketStatus, usePositions, useSyncMarket } from '../api/hooks';
import type { MarketStatus } from '../api/types';
import { ErrorBox, Loading, Stat } from '../components/ui';
import { fmtMoney, fmtPct, fmtPrice, fmtQty, fmtR, tone } from '../lib/format';

/** Market-data provider status and a manual "fetch now" (the server also syncs every 15 min). */
export function MarketDataCard() {
  const sync = useSyncMarket();
  const status = useMarketStatus(sync.isPending);
  const s: MarketStatus | undefined = status.data;
  return (
    <section className="card" aria-label="Market data">
      <h2>Market data</h2>
      {!s ? (
        <Loading />
      ) : !s.configured ? (
        <p className="muted" style={{ margin: 0 }}>
          Not configured. Add <code>MARKET_DATA_API_KEY</code> (Tiingo) to <code>.env</code> and
          restart the server. Everything else works without it; prices, MAE/MFE and the benchmark
          show "no data".
        </p>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          <div>
            Provider <strong>{s.provider}</strong> · prices up to{' '}
            <strong>{s.lastCompleteDay}</strong> (last close) ·{' '}
            <span data-testid="pending-symbols">
              {s.pendingSymbols === 0
                ? 'all symbols up to date'
                : `${s.pendingSymbols} symbols still to fetch`}
            </span>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            Requests used: {s.usage.map((u) => `${u.used}/${u.max} per ${u.label}`).join(', ')}
            {s.nextSlotInMs > 0 && ` · next request in ${Math.ceil(s.nextSlotInMs / 60_000)} min`}
            {s.unknownSymbols.length > 0 && ` · no data for ${s.unknownSymbols.join(', ')}`}
          </div>
          {s.lastError && s.lastError.kind !== 'not-configured' && (
            <div className="muted" role="status">
              {s.lastError.kind === 'rate-limited'
                ? 'Paused at the provider rate limit; the rest is fetched automatically later.'
                : s.lastError.message}
            </div>
          )}
          <div>
            <button
              type="button"
              onClick={() => sync.mutate()}
              disabled={sync.isPending || s.running}
            >
              {sync.isPending || s.running ? 'Fetching…' : 'Fetch prices now'}
            </button>
          </div>
          {sync.error && <ErrorBox error={sync.error} />}
        </div>
      )}
    </section>
  );
}

export function PositionsPage() {
  const positions = usePositions();
  const d = positions.data;
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Open positions</h1>
      </div>
      <ErrorBox error={positions.error} />
      {!d ? (
        <Loading />
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>
            Valued at the <strong>last close</strong> ({d.asOf}). Free market data is end-of-day,
            not real-time.
            {d.note && ` ${d.note}`}
          </p>
          <div className="kpis">
            <Stat
              testId="pos-unrealised"
              label="Unrealised P&L"
              value={fmtMoney(d.totals.unrealised)}
              className={tone(d.totals.unrealised)}
            />
            <Stat
              testId="pos-open-risk"
              label="Open risk"
              value={fmtMoney(d.totals.openRisk)}
              title="Σ shares × (last close − current stop): what you'd give back if every stop were hit"
            />
            <Stat
              testId="pos-open-risk-pct"
              label="Open risk / equity"
              value={fmtPct(d.totals.openRiskPctOfEquity, 2)}
              title="Open risk ÷ (realised equity + unrealised P&L)"
            />
            <Stat label="Market value" value={fmtMoney(d.totals.marketValue)} />
          </div>
          {d.positions.length === 0 ? (
            <div className="card empty">No open positions.</div>
          ) : (
            <div className="card table-wrap" style={{ padding: 0 }}>
              <table data-testid="positions">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th className="num">Shares</th>
                    <th className="num">Avg cost</th>
                    <th className="num">Last close</th>
                    <th className="num">Unrealised</th>
                    <th className="num">%</th>
                    <th className="num">R</th>
                    <th className="num">Stop</th>
                    <th className="num">To stop</th>
                    <th className="num">To stop (R)</th>
                    <th className="num">Open risk</th>
                  </tr>
                </thead>
                <tbody>
                  {d.positions.map((p) => (
                    <tr key={p.tradeId}>
                      <td>
                        <Link to={`/trades/${p.tradeId}`}>{p.symbol}</Link>
                        {p.splits.length > 0 && (
                          <span
                            className="badge"
                            title="A split was detected since entry; values may be off"
                          >
                            {' '}
                            split?
                          </span>
                        )}
                      </td>
                      <td className="num">{fmtQty(p.shares)}</td>
                      <td className="num">{fmtMoney(p.avgCost)}</td>
                      <td
                        className="num"
                        title={p.lastCloseDate ? `Close of ${p.lastCloseDate}` : 'No price data'}
                      >
                        {fmtPrice(p.lastClose)}
                      </td>
                      <td className={`num ${tone(p.unrealised)}`}>{fmtMoney(p.unrealised)}</td>
                      <td className={`num ${tone(p.unrealisedPct)}`}>{fmtPct(p.unrealisedPct)}</td>
                      <td className={`num ${tone(p.unrealisedR)}`}>{fmtR(p.unrealisedR)}</td>
                      <td className="num">{fmtPrice(p.currentStop)}</td>
                      <td className="num">{fmtPct(p.stopDistancePct)}</td>
                      <td className="num">{fmtR(p.stopDistanceR)}</td>
                      <td className="num">{fmtMoney(p.openRisk)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {d.totals.unpriced > 0 && (
            <p className="muted" style={{ margin: 0 }}>
              {d.totals.unpriced} position(s) have no price yet ("no data") and are left out of the
              totals.
            </p>
          )}
        </>
      )}
      <MarketDataCard />
    </div>
  );
}
