import { useState } from 'react';
import { Link } from 'react-router';
import { useTrades, useUpdateJournal } from '../api/hooks';
import type { TradeListItem } from '../api/types';
import { ErrorBox, Loading } from '../components/ui';
import { fmtMoney, fmtNyDate, fmtPrice, fmtQty, tone } from '../lib/format';
import { parseMoneyInput } from '../lib/validate';

/** One trade: type the stop you planned at entry, save, and it drops off the list. */
function StopRow({ t, onSaved }: { t: TradeListItem; onSaved: (symbol: string) => void }) {
  const update = useUpdateJournal(t.id);
  const [input, setInput] = useState('');
  const parsed = parseMoneyInput(input);
  const value = 'value' in parsed ? parsed.value : null;
  const first = t.firstEntryPrice;
  const error =
    'error' in parsed
      ? parsed.error
      : value !== null && value <= 0
        ? 'Must be positive'
        : value !== null && first !== null && value >= first
          ? `Must be below the first entry (${fmtMoney(first)})`
          : undefined;
  const canSave = value !== null && !error && !update.isPending;
  const pnl = t.netPnl ?? t.realisedNet;
  const errId = `stop-err-${t.id}`;

  return (
    <tr>
      <td>
        <Link to={`/trades/${t.id}`}>{t.symbol}</Link>{' '}
        {t.status === 'OPEN' && <span className="badge open">Open</span>}
      </td>
      <td>{fmtNyDate(t.openedAt)}</td>
      <td>{fmtNyDate(t.closedAt)}</td>
      <td className="num">{fmtQty(t.quantity)}</td>
      <td className="num">{fmtPrice(first)}</td>
      <td className={`num ${tone(pnl)}`}>{fmtMoney(pnl)}</td>
      <td>
        <form
          style={{ display: 'flex', gap: 6, alignItems: 'center' }}
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave && value !== null) {
              update.mutate({ initialStop: value }, { onSuccess: () => onSaved(t.symbol) });
            }
          }}
        >
          <input
            aria-label={`Initial stop for ${t.symbol}`}
            aria-invalid={!!error}
            aria-describedby={error ? errId : undefined}
            inputMode="decimal"
            placeholder="e.g. 48.50"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            style={{ width: 110 }}
          />
          <button
            type="submit"
            className="small"
            disabled={!canSave}
            aria-label={`Save stop for ${t.symbol}`}
          >
            Save
          </button>
        </form>
        {error && (
          <span id={errId} className="field-error">
            {error}
          </span>
        )}
        {update.error && <ErrorBox error={update.error} />}
      </td>
    </tr>
  );
}

export function MissingStopsPage() {
  const trades = useTrades({ missingStop: true, orphaned: 'exclude' });
  const [saved, setSaved] = useState<string | null>(null);
  const list = trades.data?.trades ?? [];

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Missing stops</h1>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Trades without an initial stop are left out of every R statistic. Enter the stop you planned
        when you entered (it must be below the first entry price) and press Save or Enter.
      </p>
      <span role="status" className="ok-text">
        {saved ? `Saved the stop for ${saved}.` : ''}
      </span>
      <ErrorBox error={trades.error} />
      {trades.isPending ? (
        <Loading />
      ) : list.length === 0 ? (
        <div className="card empty">Every trade has an initial stop.</div>
      ) : (
        <>
          <p style={{ margin: 0 }}>
            <strong>
              {list.length} {list.length === 1 ? 'trade' : 'trades'} without an initial stop
            </strong>
          </p>
          <div className="card table-wrap" style={{ padding: 0 }}>
            <table data-testid="missing-stops">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Opened</th>
                  <th>Closed</th>
                  <th className="num">Size</th>
                  <th className="num">First entry</th>
                  <th className="num">Net P&L</th>
                  <th>Initial stop</th>
                </tr>
              </thead>
              <tbody>
                {list.map((t) => (
                  <StopRow key={t.id} t={t} onSaved={setSaved} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
