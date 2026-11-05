import { useNavigate, useParams } from 'react-router';
import { Link } from 'react-router';
import { useDeleteOrphan, useTrade } from '../../api/hooks';
import type { TradeDetail } from '../../api/types';
import { ConfirmButton, ErrorBox, Loading, Stat } from '../../components/ui';
import { fmtDays, fmtMoney, fmtNyDate, fmtPct, fmtPrice, fmtR, tone } from '../../lib/format';
import { FillsCard } from './FillsCard';
import { JournalCard } from './JournalCard';
import { ScreenshotsCard } from './ScreenshotsCard';
import { StopsCard } from './StopsCard';
import { TagsCard } from './TagsCard';

function Stats({ t }: { t: TradeDetail }) {
  const closed = t.status === 'CLOSED';
  const pnl = closed ? t.netPnl : t.realisedNet;
  return (
    <div className="stats">
      <Stat
        testId="stat-net-pnl"
        label={closed ? 'Net P&L' : 'Realised (net)'}
        value={fmtMoney(pnl)}
        className={tone(pnl)}
        title={
          closed
            ? 'Sells − buys − commissions and fees'
            : 'Realised P&L on shares sold so far, minus all fees paid'
        }
      />
      <Stat
        testId="stat-r"
        label="R-multiple"
        value={fmtR(t.rMultiple)}
        className={tone(t.rMultiple)}
        title={
          t.initialRisk === null ? 'Set an initial stop to compute R' : 'Net P&L ÷ initial risk'
        }
      />
      <Stat
        testId="stat-return"
        label="Return"
        value={fmtPct(t.returnPct)}
        className={tone(t.returnPct)}
        title="Net P&L ÷ total cost of the buys"
      />
      <Stat testId="stat-avg-entry" label="Avg entry" value={fmtMoney(t.avgEntry)} />
      <Stat testId="stat-avg-exit" label="Avg exit" value={fmtMoney(t.avgExit)} />
      <Stat
        label={closed ? 'Size' : 'Open shares'}
        value={closed ? (t.quantity ?? '—') : `${t.openQty ?? 0} / ${t.quantity ?? 0}`}
      />
      <Stat
        label="Held"
        value={fmtDays(t.holding)}
        title="Trading days (calendar days), New York dates"
      />
      <Stat
        label="Initial risk"
        value={fmtMoney(t.initialRisk)}
        title="(First entry − initial stop) × first entry shares, or the planned-risk override"
      />
      <Stat
        label="Planned R:R"
        value={t.plannedRewardRisk === null ? '—' : t.plannedRewardRisk.toFixed(2)}
      />
      <Stat label="Current stop" value={fmtPrice(t.currentStop)} />
      <Stat label="Fees" value={fmtMoney(t.fees)} />
    </div>
  );
}

function PnlBreakdown({ t }: { t: TradeDetail }) {
  return (
    <section className="card" aria-label="P&L breakdown">
      <h2>P&L breakdown</h2>
      <table>
        <tbody>
          <tr>
            <td>Total bought</td>
            <td className="num">{fmtMoney(t.buyCost)}</td>
          </tr>
          <tr>
            <td>Total sold</td>
            <td className="num">{fmtMoney(t.sellProceeds)}</td>
          </tr>
          <tr>
            <td>Gross P&L</td>
            <td className={`num ${tone(t.grossPnl)}`}>{fmtMoney(t.grossPnl)}</td>
          </tr>
          <tr>
            <td>Commissions</td>
            <td className="num">{fmtMoney(t.commissions === null ? null : -t.commissions)}</td>
          </tr>
          <tr>
            <td>Other fees</td>
            <td className="num">{fmtMoney(t.otherFees === null ? null : -t.otherFees)}</td>
          </tr>
          <tr>
            <td>
              <strong>Net P&L</strong>
            </td>
            <td className={`num ${tone(t.netPnl)}`}>
              <strong>{fmtMoney(t.netPnl)}</strong>
            </td>
          </tr>
          {t.status === 'OPEN' && (
            <tr>
              <td>Realised so far (net)</td>
              <td className={`num ${tone(t.realisedNet)}`}>{fmtMoney(t.realisedNet)}</td>
            </tr>
          )}
          {t.status === 'OPEN' && (
            <tr>
              <td>Open cost basis</td>
              <td className="num">
                {fmtMoney(t.openCostBasis)} ({fmtMoney(t.avgOpenCost)} avg)
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

export function TradeDetailPage() {
  const id = Number(useParams().id);
  const trade = useTrade(id);
  const deleteOrphan = useDeleteOrphan();
  const navigate = useNavigate();

  if (trade.isPending) return <Loading />;
  if (trade.error) {
    return (
      <>
        <ErrorBox error={trade.error} />
        <p>
          <Link to="/trades">← Back</Link>
        </p>
      </>
    );
  }
  const t = trade.data;

  return (
    <div className="stack">
      <div className="page-head">
        <Link to="/trades">← Back</Link>
        <h1>
          {t.symbol}{' '}
          <span className="muted" style={{ fontWeight: 400, fontSize: 15 }}>
            {t.direction === 'LONG' ? 'Long' : t.direction}
          </span>
        </h1>
        <span data-testid="status" className={`badge${t.status === 'OPEN' ? ' open' : ''}`}>
          {t.status === 'OPEN' ? 'Open' : 'Closed'}
        </span>
        {t.setupTag && (
          <span className="badge" style={{ borderColor: t.setupTag.color }}>
            {t.setupTag.name}
          </span>
        )}
        <span className="muted">
          {fmtNyDate(t.openedAt)} → {t.closedAt ? fmtNyDate(t.closedAt) : 'open'}
        </span>
      </div>

      {t.orphaned && (
        <div className="banner" role="status">
          This journal entry lost its executions when fills were regrouped. Its notes, tags and
          screenshots are kept. Delete it once you no longer need it.{' '}
          <ConfirmButton
            label="Delete entry"
            ariaLabel="Delete orphaned entry"
            onConfirm={() =>
              deleteOrphan.mutate(t.id, { onSuccess: () => void navigate('/trades') })
            }
          />
        </div>
      )}

      {!t.orphaned && <Stats t={t} />}
      {!t.orphaned && <FillsCard trade={t} />}
      <div className="grid-2">
        <JournalCard key={t.id} trade={t} />
        <div className="stack">
          {!t.orphaned && <PnlBreakdown t={t} />}
          <TagsCard trade={t} />
          <StopsCard trade={t} />
        </div>
      </div>
      <ScreenshotsCard trade={t} />
    </div>
  );
}
