import { toNyLocal } from '@tj/core';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useAddFill, useDeleteExecution, useSettings } from '../../api/hooks';
import type { TradeDetail } from '../../api/types';
import { ConfirmButton, ErrorBox, Field } from '../../components/ui';
import { fmtMoney, fmtNyDateTime, fmtPrice, tone } from '../../lib/format';
import { validateFill, type FillValues } from '../../lib/validate';

function AddFillForm({ trade }: { trade: TradeDetail }) {
  const addFill = useAddFill(trade.id);
  const settings = useSettings();
  const empty = (): FillValues => ({
    // Open trades usually take exits; a closed trade can only take a missed fill.
    side: (trade.openQty ?? 0) > 0 ? 'SELL' : 'BUY',
    ...toNyLocal(new Date().toISOString()),
    shares: '',
    price: '',
    commission: settings.data?.defaultCommission
      ? String(settings.data.defaultCommission / 1_000_000)
      : '',
  });
  const [v, setV] = useState<FillValues>(empty);
  const [submitted, setSubmitted] = useState(false);
  const openQty = trade.openQty ?? 0;
  const { errors, payload } = validateFill(v, openQty);
  // The position check is shown immediately; other errors after a submit attempt.
  const show = (k: keyof FillValues) =>
    submitted || (k === 'shares' && errors.shares?.startsWith('Only')) ? errors[k] : undefined;
  const bind = (k: keyof FillValues) => ({
    value: v[k],
    onChange: (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value })),
  });

  return (
    <form
      className="fields"
      aria-label="Add fill"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        if (!payload) return;
        // Clear right away so the next entry can't race the save; restore on failure.
        const before = v;
        setSubmitted(false);
        setV((x) => ({ ...x, shares: '', price: '' }));
        addFill.mutate(payload, { onError: () => setV(before) });
      }}
    >
      <Field label="Side">
        {(p) => (
          <select {...p} {...bind('side')}>
            <option value="BUY">Buy (scale in)</option>
            <option value="SELL">Sell (scale out)</option>
          </select>
        )}
      </Field>
      <Field label="Date" error={show('date')}>
        {(p) => <input {...p} type="date" {...bind('date')} />}
      </Field>
      <Field label="Time (New York)" error={show('time')}>
        {(p) => <input {...p} type="time" {...bind('time')} />}
      </Field>
      <Field
        label="Shares"
        error={show('shares')}
        hint={v.side === 'SELL' ? `${openQty} open` : undefined}
      >
        {(p) => <input {...p} inputMode="numeric" {...bind('shares')} />}
      </Field>
      <Field label="Price" error={show('price')}>
        {(p) => <input {...p} inputMode="decimal" {...bind('price')} />}
      </Field>
      <Field label="Commission" error={show('commission')}>
        {(p) => <input {...p} inputMode="decimal" {...bind('commission')} />}
      </Field>
      <div className="actions">
        <button
          className="primary"
          type="submit"
          disabled={addFill.isPending || !!errors.shares?.startsWith('Only')}
        >
          Add fill
        </button>
        {addFill.error && <ErrorBox error={addFill.error} />}
      </div>
    </form>
  );
}

export function FillsCard({ trade }: { trade: TradeDetail }) {
  const del = useDeleteExecution(trade.id);
  const [showAdd, setShowAdd] = useState(false);
  const navigate = useNavigate();
  const remove = (id: number) =>
    del.mutate(id, {
      // Deleting the only fill removes the trade itself.
      onSuccess: () => {
        if (trade.executions.length === 1) void navigate('/trades');
      },
    });
  const realised = new Map(trade.realisations.map((r) => [r.executionId, r.realisedGross]));
  return (
    <section className="card" aria-label="Fills">
      <h2>Fills</h2>
      <div className="table-wrap">
        <table data-testid="fills">
          <thead>
            <tr>
              <th>Time (NY)</th>
              <th>Side</th>
              <th className="num">Shares</th>
              <th className="num">Price</th>
              <th className="num">Commission</th>
              <th className="num">Fees</th>
              <th className="num">Realised (gross)</th>
              <th>Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {trade.executions.map((e) => {
              const r = realised.get(e.id);
              return (
                <tr key={e.id}>
                  <td>{fmtNyDateTime(e.executedAt)}</td>
                  <td>{e.side === 'BUY' ? 'Buy' : 'Sell'}</td>
                  <td className="num">{e.quantity}</td>
                  <td className="num">{fmtPrice(e.price)}</td>
                  <td className="num">{fmtMoney(e.commission)}</td>
                  <td className="num">{fmtMoney(e.otherFees)}</td>
                  <td className={`num ${tone(r)}`}>{r === undefined ? '' : fmtMoney(r)}</td>
                  <td className="muted">{e.source === 'MANUAL' ? 'Manual' : e.source}</td>
                  <td>
                    <ConfirmButton
                      ariaLabel={`Delete fill ${e.id}`}
                      onConfirm={() => remove(e.id)}
                      disabled={del.isPending}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {del.error && <ErrorBox error={del.error} />}
      {trade.status === 'OPEN' || showAdd ? (
        <>
          <h2 style={{ marginTop: 16 }}>Add fill</h2>
          <AddFillForm trade={trade} />
        </>
      ) : (
        <button
          type="button"
          className="small"
          style={{ marginTop: 12 }}
          onClick={() => setShowAdd(true)}
        >
          Add a missed fill…
        </button>
      )}
    </section>
  );
}
