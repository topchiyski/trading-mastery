import { toNyLocal } from '@tj/core';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { useCreateTag, useCreateTrade, useSettings, useTags } from '../api/hooks';
import { ErrorBox, Field } from '../components/ui';
import { fmtMoney } from '../lib/format';
import { validateNewTrade, type NewTradeValues } from '../lib/validate';

const NEW_SETUP = '__new';

function nowNy() {
  return toNyLocal(new Date().toISOString());
}

export function NewTradePage() {
  const navigate = useNavigate();
  const settings = useSettings();
  const tags = useTags();
  const createTrade = useCreateTrade();
  const createTag = useCreateTag();
  const [values, setValues] = useState<NewTradeValues>(() => ({
    symbol: '',
    ...nowNy(),
    shares: '',
    price: '',
    commission: '',
    initialStop: '',
    target: '',
  }));
  const [setup, setSetup] = useState('');
  const [newSetup, setNewSetup] = useState('');
  const [thesis, setThesis] = useState('');
  const [touched, setTouched] = useState<Partial<Record<keyof NewTradeValues, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);

  // Until the user edits the commission, it shows the default from settings.
  const [commissionEdited, setCommissionEdited] = useState(false);
  const defaultCommission = settings.data?.defaultCommission;
  const effective: NewTradeValues = {
    ...values,
    commission:
      commissionEdited || !defaultCommission
        ? values.commission
        : String(defaultCommission / 1_000_000),
  };

  const { errors, payload, preview } = validateNewTrade(effective);
  const show = (k: keyof NewTradeValues) => (touched[k] || submitted ? errors[k] : undefined);
  // Business-rule errors are shown as soon as both values exist.
  const stopError =
    errors.initialStop === 'Stop must be below the entry price'
      ? errors.initialStop
      : show('initialStop');
  const setupMissing = setup === NEW_SETUP && !newSetup.trim();

  const bind = (k: keyof NewTradeValues, transform?: (s: string) => string) => ({
    value: effective[k],
    onChange: (e: { target: { value: string } }) => {
      if (k === 'commission') setCommissionEdited(true);
      setValues((v) => ({ ...v, [k]: transform ? transform(e.target.value) : e.target.value }));
    },
    onBlur: () => setTouched((t) => ({ ...t, [k]: true })),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!payload || setupMissing) return;
    let setupTagId: number | null = setup && setup !== NEW_SETUP ? Number(setup) : null;
    try {
      if (setup === NEW_SETUP) {
        setupTagId = (await createTag.mutateAsync({ name: newSetup.trim(), kind: 'SETUP' })).id;
      }
      const trade = await createTrade.mutateAsync({
        ...payload,
        setupTagId,
        thesis: thesis.trim() || null,
      });
      void navigate(`/trades/${trade.id}`);
    } catch {
      // The error is shown from the mutation state (createTrade.error / createTag.error).
    }
  }

  const apiError = createTrade.error ?? createTag.error;
  const openTradeId =
    apiError instanceof ApiError && apiError.code === 'POSITION_ALREADY_OPEN'
      ? (apiError.details as { tradeId?: number } | undefined)?.tradeId
      : undefined;
  const busy = createTrade.isPending || createTag.isPending;

  return (
    <>
      <div className="page-head">
        <h1>New trade</h1>
      </div>
      <form
        className="card fields"
        aria-label="New trade"
        onSubmit={(e) => void submit(e)}
        noValidate
      >
        <Field label="Symbol" error={show('symbol')}>
          {(p) => (
            <input
              {...p}
              {...bind('symbol', (s) => s.toUpperCase().trim())}
              autoFocus
              autoComplete="off"
            />
          )}
        </Field>
        <Field label="Date" error={show('date')}>
          {(p) => <input {...p} type="date" {...bind('date')} />}
        </Field>
        <Field label="Time (New York)" error={show('time')}>
          {(p) => <input {...p} type="time" {...bind('time')} />}
        </Field>
        <Field label="Shares" error={show('shares')}>
          {(p) => <input {...p} inputMode="numeric" {...bind('shares')} />}
        </Field>
        <Field label="Price" error={show('price')}>
          {(p) => <input {...p} inputMode="decimal" {...bind('price')} />}
        </Field>
        <Field label="Commission" error={show('commission')}>
          {(p) => <input {...p} inputMode="decimal" {...bind('commission')} />}
        </Field>
        <Field label="Initial stop" error={stopError} hint="Needed for R statistics">
          {(p) => <input {...p} inputMode="decimal" {...bind('initialStop')} />}
        </Field>
        <Field label="Target" error={show('target')}>
          {(p) => <input {...p} inputMode="decimal" {...bind('target')} />}
        </Field>
        <Field label="Setup">
          {(p) => (
            <select {...p} value={setup} onChange={(e) => setSetup(e.target.value)}>
              <option value="">None</option>
              {tags.data
                ?.filter((t) => t.kind === 'SETUP')
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              <option value={NEW_SETUP}>+ New setup…</option>
            </select>
          )}
        </Field>
        {setup === NEW_SETUP && (
          <Field label="New setup name" error={submitted && setupMissing ? 'Required' : undefined}>
            {(p) => <input {...p} value={newSetup} onChange={(e) => setNewSetup(e.target.value)} />}
          </Field>
        )}
        <div className="field" data-testid="risk-preview" aria-live="polite">
          <span className="label">Risk preview</span>
          <span>
            Initial risk <strong>{fmtMoney(preview.risk)}</strong>
          </span>
          <span>
            Planned R:R{' '}
            <strong>{preview.rewardRisk === null ? '—' : preview.rewardRisk.toFixed(2)}</strong>
          </span>
        </div>
        <Field label="Thesis" wide hint="Why are you taking this trade? What invalidates it?">
          {(p) => <textarea {...p} value={thesis} onChange={(e) => setThesis(e.target.value)} />}
        </Field>
        {apiError && (
          <div className="wide" style={{ gridColumn: '1 / -1' }}>
            <ErrorBox error={apiError} />
            {openTradeId && (
              <p>
                <Link to={`/trades/${openTradeId}`}>Open that trade</Link> to add a fill instead.
              </p>
            )}
          </div>
        )}
        <div className="actions">
          <button
            className="primary"
            type="submit"
            disabled={
              busy ||
              (Object.keys(errors).length > 0 && (submitted || !!errors.initialStop)) ||
              (setupMissing && submitted)
            }
          >
            {busy ? 'Saving…' : 'Create trade'}
          </button>
          <span className="hint">
            Times are New York time. Add scale-ins and exits on the trade page.
          </span>
        </div>
      </form>
    </>
  );
}
