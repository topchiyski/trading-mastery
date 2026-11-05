import { toNyLocal } from '@tj/core';
import { useState } from 'react';
import { useCashFlows, useCreateCashFlow, useDeleteCashFlow } from '../api/hooks';
import type { CashFlowType } from '../api/types';
import { ConfirmButton, ErrorBox, Field, Loading } from '../components/ui';
import { fmtMoney, fmtNyDate, tone } from '../lib/format';
import { parseMoneyInput } from '../lib/validate';

const TYPES: { value: CashFlowType; label: string; sign: 1 | -1 }[] = [
  { value: 'DEPOSIT', label: 'Deposit', sign: 1 },
  { value: 'WITHDRAWAL', label: 'Withdrawal', sign: -1 },
  { value: 'DIVIDEND', label: 'Dividend', sign: 1 },
  { value: 'INTEREST', label: 'Interest', sign: 1 },
  { value: 'FEE', label: 'Fee', sign: -1 },
];
const labelOf = (t: CashFlowType) => TYPES.find((x) => x.value === t)?.label ?? t;

export function CashFlowsPage() {
  const flows = useCashFlows();
  const create = useCreateCashFlow();
  const del = useDeleteCashFlow();
  const [v, setV] = useState({
    type: 'DEPOSIT' as CashFlowType,
    date: toNyLocal(new Date().toISOString()).date,
    amount: '',
    note: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const parsed = parseMoneyInput(v.amount);
  const amount = 'value' in parsed ? parsed.value : null;
  const amountError =
    'error' in parsed
      ? parsed.error
      : submitted && (amount === null || amount <= 0)
        ? 'Enter a positive amount'
        : undefined;
  const sign = TYPES.find((t) => t.value === v.type)?.sign ?? 1;
  const net = (flows.data ?? []).reduce((acc, f) => acc + f.amount, 0);

  return (
    <>
      <div className="page-head">
        <h1>Cash flows</h1>
      </div>
      <p className="muted">
        Deposits and withdrawals change the account size but not performance (time-weighted return).
        Dividends, interest and account fees count as performance.
      </p>
      <form
        className="card fields"
        aria-label="Add cash flow"
        noValidate
        style={{ marginBottom: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
          if (amount === null || amount <= 0 || !v.date) return;
          // Clear right away so typing the next entry can't race the save; restore on failure.
          const before = v;
          setSubmitted(false);
          setV((x) => ({ ...x, amount: '', note: '' }));
          create.mutate(
            {
              type: v.type,
              amount: sign * amount,
              occurredAt: v.date,
              note: v.note.trim() || null,
            },
            { onError: () => setV(before) },
          );
        }}
      >
        <Field label="Type">
          {(p) => (
            <select
              {...p}
              value={v.type}
              onChange={(e) => setV({ ...v, type: e.target.value as CashFlowType })}
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
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
        <Field
          label="Amount"
          error={amountError}
          hint={sign < 0 ? 'Recorded as money out' : 'Recorded as money in'}
        >
          {(p) => (
            <input
              {...p}
              inputMode="decimal"
              value={v.amount}
              onChange={(e) => setV({ ...v, amount: e.target.value })}
            />
          )}
        </Field>
        <Field label="Note">
          {(p) => (
            <input {...p} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} />
          )}
        </Field>
        <div className="actions">
          <button className="primary" type="submit" disabled={create.isPending}>
            Add
          </button>
          {create.error && <ErrorBox error={create.error} />}
        </div>
      </form>

      <ErrorBox error={flows.error ?? del.error} />
      {flows.isPending ? (
        <Loading />
      ) : flows.data && flows.data.length === 0 ? (
        <div className="card empty">No cash flows recorded.</div>
      ) : (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table data-testid="cash-flows">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th className="num">Amount</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {flows.data?.map((f) => (
                <tr key={f.id}>
                  <td>
                    {/^\d{4}-\d{2}-\d{2}$/.test(f.occurredAt)
                      ? f.occurredAt
                      : fmtNyDate(f.occurredAt)}
                  </td>
                  <td>{labelOf(f.type)}</td>
                  <td className={`num ${tone(f.amount)}`}>{fmtMoney(f.amount)}</td>
                  <td>{f.note}</td>
                  <td>
                    <ConfirmButton
                      ariaLabel={`Delete cash flow ${f.id}`}
                      onConfirm={() => del.mutate(f.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Net</td>
                <td className={`num ${tone(net)}`} data-testid="cash-flow-net">
                  {fmtMoney(net)}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}
