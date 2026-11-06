import { useTradeChart } from '../../api/hooks';
import type { Excursion, TradeDetail } from '../../api/types';
import { CandlestickChart } from '../../components/charts/MarketCharts';
import { ErrorBox, Loading, Stat } from '../../components/ui';
import { fmtMoney, fmtPct, fmtPrice, fmtR, tone } from '../../lib/format';

const ratio = (r: number) => (r >= 1 ? `${r}:1` : `1:${Math.round(1 / r)}`);

function ExcursionStat({ label, x, testId }: { label: string; x: Excursion; testId: string }) {
  return (
    <Stat
      testId={testId}
      label={label}
      className={tone(x.dollars)}
      value={
        <>
          {fmtMoney(x.dollars)}{' '}
          <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>
            {fmtPct(x.pct, 1)} · {fmtR(x.r)}
          </span>
        </>
      }
    />
  );
}

export function PriceChartCard({ trade }: { trade: TradeDetail }) {
  const chart = useTradeChart(trade.id);
  return (
    <section className="card chart-card" aria-label="Price chart">
      <h2>Price chart</h2>
      <div className="sub">
        Daily candles (last close basis). Shaded: while the trade was open. ▲ buy, ▼ sell.
      </div>
      {chart.isPending ? (
        <Loading />
      ) : chart.error ? (
        <ErrorBox error={chart.error} />
      ) : (
        <>
          {chart.data.note && (
            <p className="muted" role="status" style={{ marginTop: 0 }}>
              {chart.data.note}
            </p>
          )}
          {chart.data.splits.length > 0 && (
            <div className="banner" role="alert">
              Possible stock split during this trade (
              {chart.data.splits.map((s) => `${ratio(s.ratio)} on ${s.date}`).join(', ')}). Fill
              prices are not adjusted in v1, so the chart and MAE/MFE may be off around that date.
            </div>
          )}
          {chart.data.excursions && (
            <>
              <div className="stats" style={{ marginBottom: 10 }}>
                <ExcursionStat
                  label="MAE (max adverse)"
                  x={chart.data.excursions.mae}
                  testId="stat-mae"
                />
                <ExcursionStat
                  label="MFE (max favourable)"
                  x={chart.data.excursions.mfe}
                  testId="stat-mfe"
                />
              </div>
              <p className="hint" style={{ marginTop: 0 }}>
                From daily highs and lows, so the entry and exit days are approximate (the intraday
                order of prices is unknown).
              </p>
            </>
          )}
          <CandlestickChart chart={chart.data} formatPrice={fmtPrice} />
          {chart.data.candles.length > 0 && (
            <details>
              <summary>Data</summary>
              <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th className="num">Open</th>
                      <th className="num">High</th>
                      <th className="num">Low</th>
                      <th className="num">Close</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chart.data.candles.map((c) => (
                      <tr key={c.date}>
                        <td>{c.date}</td>
                        <td className="num">{fmtPrice(c.open)}</td>
                        <td className="num">{fmtPrice(c.high)}</td>
                        <td className="num">{fmtPrice(c.low)}</td>
                        <td className="num">{fmtPrice(c.close)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}
