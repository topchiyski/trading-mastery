import { nyLocalToUtc, toNyLocal } from '@tj/core';
import { useState } from 'react';
import { useAddStop, useDeleteStop } from '../../api/hooks';
import type { TradeDetail } from '../../api/types';
import { ConfirmButton, ErrorBox, Field } from '../../components/ui';
import { fmtNyDateTime, fmtPrice } from '../../lib/format';
import { parseMoneyInput } from '../../lib/validate';

/** Stop history: the initial stop plus every trailing-stop change. */
export function StopsCard({ trade }: { trade: TradeDetail }) {
  const add = useAddStop(trade.id);
  const del = useDeleteStop(trade.id);
  const [v, setV] = useState(() => ({ price: '', ...toNyLocal(new Date().toISOString()) }));
  const price = parseMoneyInput(v.price);
  const priceError = 'error' in price ? price.error : undefined;
  const value = 'value' in price ? price.value : null;

  return (
    <section className="card" aria-label="Stop history">
      <h2>Stop history</h2>
      <table>
        <tbody>
          <tr>
            <td>Initial stop</td>
            <td className="num">{fmtPrice(trade.journal.initialStop)}</td>
            <td />
          </tr>
          {trade.stops.map((s) => (
            <tr key={s.id}>
              <td>{fmtNyDateTime(s.changedAt)}</td>
              <td className="num">{fmtPrice(s.stopPrice)}</td>
              <td>
                <ConfirmButton
                  ariaLabel={`Delete stop ${s.id}`}
                  onConfirm={() => del.mutate(s.id)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="fields"
        aria-label="Add stop"
        style={{ marginTop: 12 }}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (value === null || value <= 0) return;
          let changedAt: string | undefined;
          try {
            changedAt = nyLocalToUtc(v.date, v.time);
          } catch {
            changedAt = undefined; // server defaults to now
          }
          add.mutate(
            { stopPrice: value, ...(changedAt ? { changedAt } : {}) },
            { onSuccess: () => setV((x) => ({ ...x, price: '' })) },
          );
        }}
      >
        <Field label="Stop price" error={priceError}>
          {(p) => (
            <input
              {...p}
              inputMode="decimal"
              value={v.price}
              onChange={(e) => setV({ ...v, price: e.target.value })}
            />
          )}
        </Field>
        <Field label="Date">
          {(p) => (
            <input
              {...p}
              type="date"
              value={v.date}
              onChange={(e) => setV({ ...v, date: e.target.value })}
            />
          )}
        </Field>
        <Field label="Time (New York)">
          {(p) => (
            <input
              {...p}
              type="time"
              value={v.time}
              onChange={(e) => setV({ ...v, time: e.target.value })}
            />
          )}
        </Field>
        <div className="actions">
          <button type="submit" disabled={add.isPending || value === null || value <= 0}>
            Add stop
          </button>
        </div>
      </form>
      {(add.error ?? del.error) && <ErrorBox error={add.error ?? del.error} />}
    </section>
  );
}
