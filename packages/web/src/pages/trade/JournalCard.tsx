import { useState } from 'react';
import { useTags, useUpdateJournal } from '../../api/hooks';
import type { TradeDetail } from '../../api/types';
import { ErrorBox, Field } from '../../components/ui';
import { parseMoneyInput } from '../../lib/validate';

const money = (m: number | null) => (m === null ? '' : String(m / 1_000_000));

/** Pre- and post-trade journal. Local state is seeded once per trade (the parent keys on id). */
export function JournalCard({ trade }: { trade: TradeDetail }) {
  const update = useUpdateJournal(trade.id);
  const tags = useTags();
  const j = trade.journal;
  const [v, setV] = useState({
    initialStop: money(j.initialStop),
    target: money(j.target),
    plannedRiskOverride: money(j.plannedRiskOverride),
    setupTagId: trade.setupTag ? String(trade.setupTag.id) : '',
    thesis: j.thesis ?? '',
    review: j.review ?? '',
    emotion: j.emotion ?? '',
    executionRating: j.executionRating === null ? '' : String(j.executionRating),
    followedPlan: j.followedPlan ?? false,
  });
  const [saved, setSaved] = useState(false);

  const parsed = {
    initialStop: parseMoneyInput(v.initialStop),
    target: parseMoneyInput(v.target),
    plannedRiskOverride: parseMoneyInput(v.plannedRiskOverride),
  };
  const err = (k: keyof typeof parsed) =>
    'error' in parsed[k] ? (parsed[k] as { error: string }).error : undefined;
  const val = (k: keyof typeof parsed) =>
    'value' in parsed[k] ? (parsed[k] as { value: number | null }).value : null;
  const firstEntry = trade.executions.find((e) => e.side === 'BUY')?.price;
  const stop = val('initialStop');
  const stopError =
    err('initialStop') ??
    (stop !== null && firstEntry !== undefined && stop >= firstEntry
      ? 'Stop must be below the entry price'
      : undefined);
  const invalid = !!(stopError || err('target') || err('plannedRiskOverride'));

  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => {
    setSaved(false);
    setV((x) => ({ ...x, [k]: e.target.value }));
  };

  return (
    <section className="card" aria-label="Journal section">
      <h2>Journal</h2>
      <form
        className="fields"
        aria-label="Journal"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (invalid) return;
          update.mutate(
            {
              initialStop: stop,
              target: val('target'),
              plannedRiskOverride: val('plannedRiskOverride'),
              setupTagId: v.setupTagId ? Number(v.setupTagId) : null,
              thesis: v.thesis.trim() || null,
              review: v.review.trim() || null,
              emotion: v.emotion.trim() || null,
              executionRating: v.executionRating ? Number(v.executionRating) : null,
              followedPlan: v.followedPlan,
            },
            { onSuccess: () => setSaved(true) },
          );
        }}
      >
        <Field label="Initial stop" error={stopError}>
          {(p) => (
            <input {...p} inputMode="decimal" value={v.initialStop} onChange={set('initialStop')} />
          )}
        </Field>
        <Field label="Target" error={err('target')}>
          {(p) => <input {...p} inputMode="decimal" value={v.target} onChange={set('target')} />}
        </Field>
        <Field
          label="Planned risk ($)"
          error={err('plannedRiskOverride')}
          hint="Overrides stop-based risk for planned scale-ins"
        >
          {(p) => (
            <input
              {...p}
              inputMode="decimal"
              value={v.plannedRiskOverride}
              onChange={set('plannedRiskOverride')}
            />
          )}
        </Field>
        <Field label="Setup">
          {(p) => (
            <select {...p} value={v.setupTagId} onChange={set('setupTagId')}>
              <option value="">None</option>
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
        <Field label="Thesis" wide hint="Before the trade: why, and what invalidates it">
          {(p) => <textarea {...p} value={v.thesis} onChange={set('thesis')} />}
        </Field>
        <Field label="Review" wide hint="After the trade: what went right or wrong">
          {(p) => <textarea {...p} value={v.review} onChange={set('review')} />}
        </Field>
        <Field label="Emotion">
          {(p) => (
            <input
              {...p}
              value={v.emotion}
              onChange={set('emotion')}
              placeholder="calm, fearful…"
            />
          )}
        </Field>
        <Field label="Execution rating">
          {(p) => (
            <select {...p} value={v.executionRating} onChange={set('executionRating')}>
              <option value="">—</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="field check">
          <input
            id={`followed-${trade.id}`}
            type="checkbox"
            checked={v.followedPlan}
            onChange={(e) => {
              setSaved(false);
              setV((x) => ({ ...x, followedPlan: e.target.checked }));
            }}
          />
          <label htmlFor={`followed-${trade.id}`}>Followed plan</label>
        </div>
        <div className="actions">
          <button className="primary" type="submit" disabled={update.isPending || invalid}>
            Save journal
          </button>
          <span role="status" className="ok-text">
            {saved ? 'Saved' : ''}
          </span>
        </div>
        {update.error && (
          <div style={{ gridColumn: '1 / -1' }}>
            <ErrorBox error={update.error} />
          </div>
        )}
      </form>
    </section>
  );
}
