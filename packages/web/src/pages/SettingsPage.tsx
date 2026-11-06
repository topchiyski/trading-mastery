import { formatMicros } from '@tj/core';
import { useState } from 'react';
import {
  useBackups,
  useCreateBackup,
  useDeleteTag,
  useRestoreBackup,
  useSettings,
  useTags,
  useUpdateSettings,
  useUpdateTag,
} from '../api/hooks';
import type { Settings, Tag, TagKind } from '../api/types';
import { ConfirmButton, ErrorBox, Field, Loading } from '../components/ui';
import { fmtNyDateTime } from '../lib/format';
import { parseMoneyInput } from '../lib/validate';
import { MarketDataCard } from './PositionsPage';

const dollars = (m: number) => formatMicros(m, 2);

function AccountCard({ settings }: { settings: Settings }) {
  const update = useUpdateSettings();
  const [v, setV] = useState({
    startingBalance: dollars(settings.startingBalance),
    startDate: settings.startDate ?? '',
    breakEvenThreshold: dollars(settings.breakEvenThreshold),
    defaultCommission: dollars(settings.defaultCommission),
  });
  const [saved, setSaved] = useState(false);
  const money = (k: 'startingBalance' | 'breakEvenThreshold' | 'defaultCommission') => {
    const p = parseMoneyInput(v[k]);
    if ('error' in p) return { error: p.error };
    if (p.value === null || p.value < 0) return { error: 'Enter an amount of 0 or more' };
    return { value: p.value };
  };
  const fields = {
    startingBalance: money('startingBalance'),
    breakEvenThreshold: money('breakEvenThreshold'),
    defaultCommission: money('defaultCommission'),
  };
  const err = (k: keyof typeof fields) => ('error' in fields[k] ? fields[k].error : undefined);
  const invalid = Object.values(fields).some((f) => 'error' in f);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => {
    setSaved(false);
    setV((x) => ({ ...x, [k]: e.target.value }));
  };

  return (
    <section className="card" aria-label="Account">
      <h2>Account</h2>
      <form
        className="fields"
        aria-label="Account settings"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (invalid) return;
          const value = (k: keyof typeof fields) => ('value' in fields[k] ? fields[k].value : 0);
          update.mutate(
            {
              startingBalance: value('startingBalance'),
              startDate: v.startDate || null,
              breakEvenThreshold: value('breakEvenThreshold'),
              defaultCommission: value('defaultCommission'),
            },
            { onSuccess: () => setSaved(true) },
          );
        }}
      >
        <Field
          label="Starting balance (USD)"
          error={err('startingBalance')}
          hint="Account value on the start date"
        >
          {(p) => (
            <input
              {...p}
              inputMode="decimal"
              value={v.startingBalance}
              onChange={set('startingBalance')}
            />
          )}
        </Field>
        <Field label="Start date" hint="Empty: the date of the first trade or cash flow">
          {(p) => <input {...p} type="date" value={v.startDate} onChange={set('startDate')} />}
        </Field>
        <Field
          label="Break-even threshold (USD)"
          error={err('breakEvenThreshold')}
          hint="|net P&L| below this is break-even"
        >
          {(p) => (
            <input
              {...p}
              inputMode="decimal"
              value={v.breakEvenThreshold}
              onChange={set('breakEvenThreshold')}
            />
          )}
        </Field>
        <Field
          label="Default commission (USD)"
          error={err('defaultCommission')}
          hint="Pre-filled on new fills"
        >
          {(p) => (
            <input
              {...p}
              inputMode="decimal"
              value={v.defaultCommission}
              onChange={set('defaultCommission')}
            />
          )}
        </Field>
        <div className="actions">
          <button className="primary" type="submit" disabled={invalid || update.isPending}>
            Save settings
          </button>
          <span role="status" className="ok-text">
            {saved ? 'Saved' : ''}
          </span>
        </div>
      </form>
      {update.error && <ErrorBox error={update.error} />}
    </section>
  );
}

const KIND_LABEL: Record<TagKind, string> = {
  SETUP: 'Setups',
  MISTAKE: 'Mistakes',
  CUSTOM: 'Custom tags',
};

function TagRow({ tag, others }: { tag: Tag; others: Tag[] }) {
  const update = useUpdateTag();
  const del = useDeleteTag();
  const [name, setName] = useState(tag.name);
  const [into, setInto] = useState('');
  const error = update.error ?? del.error;
  return (
    <tr>
      <td>
        <input
          type="color"
          aria-label={`Colour of ${tag.name}`}
          value={tag.color}
          onChange={(e) => update.mutate({ id: tag.id, color: e.target.value })}
          style={{ width: 36, padding: 2 }}
        />
      </td>
      <td>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && name.trim() !== tag.name)
              update.mutate({ id: tag.id, name: name.trim() });
          }}
          style={{ display: 'flex', gap: 6 }}
        >
          <input
            aria-label={`Name of ${tag.name}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {name.trim() !== tag.name && (
            <button type="submit" className="small">
              Rename
            </button>
          )}
        </form>
        {error && <ErrorBox error={error} />}
      </td>
      <td>
        <select
          aria-label={`Move ${tag.name} into`}
          value={into}
          onChange={(e) => setInto(e.target.value)}
        >
          <option value="">Delete only</option>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              Merge into {o.name}
            </option>
          ))}
        </select>
      </td>
      <td>
        <ConfirmButton
          label={into ? 'Merge' : 'Delete'}
          confirmLabel={into ? 'Confirm merge' : 'Confirm delete'}
          ariaLabel={`${into ? 'Merge' : 'Delete'} tag ${tag.name}`}
          onConfirm={() =>
            del.mutate({ id: tag.id, ...(into ? { reassignTo: Number(into) } : {}) })
          }
        />
      </td>
    </tr>
  );
}

function TagsCard() {
  const tags = useTags();
  if (!tags.data) return <Loading />;
  return (
    <section className="card" aria-label="Tag management">
      <h2>Tags</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Merging moves every trade to the other tag, then deletes this one. Deleting only removes the
        tag from its trades.
      </p>
      {(['SETUP', 'MISTAKE', 'CUSTOM'] as TagKind[]).map((kind) => {
        const list = tags.data.filter((t) => t.kind === kind);
        return (
          <div key={kind} style={{ marginBottom: 12 }}>
            <h3 style={{ fontSize: 13, margin: '8px 0' }}>{KIND_LABEL[kind]}</h3>
            {list.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                None yet. Create them from a trade's Tags card or the New trade form.
              </p>
            ) : (
              <table>
                <tbody>
                  {list.map((t) => (
                    <TagRow
                      key={`${t.id}-${t.name}`}
                      tag={t}
                      others={list.filter((o) => o.id !== t.id)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </section>
  );
}

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

function BackupsCard() {
  const backups = useBackups();
  const create = useCreateBackup();
  const restore = useRestoreBackup();
  return (
    <section className="card" aria-label="Backups">
      <h2>Backups</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Saves the database and your screenshots to <code>data/backups/</code>. The 10 newest are
        kept. Restoring first backs up the current state, so a restore can be undone.
      </p>
      <div className="actions" style={{ marginBottom: 10 }}>
        <button
          className="primary"
          type="button"
          onClick={() => create.mutate()}
          disabled={create.isPending}
        >
          {create.isPending ? 'Backing up…' : 'Backup now'}
        </button>
        {create.data && (
          <span className="ok-text" role="status">
            Saved {create.data.name}
          </span>
        )}
      </div>
      <ErrorBox error={create.error ?? restore.error ?? backups.error} />
      {restore.data && (
        <div className="banner" role="status">
          Restored {restore.data.restored}. The previous state was saved as{' '}
          {restore.data.safetyBackup}.
        </div>
      )}
      {backups.data && backups.data.length > 0 ? (
        <table data-testid="backups">
          <thead>
            <tr>
              <th>Backup</th>
              <th>Created</th>
              <th className="num">Database</th>
              <th className="num">Screenshots</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {backups.data.map((b) => (
              <tr key={b.name}>
                <td>{b.name}</td>
                <td>{fmtNyDateTime(b.createdAt)}</td>
                <td className="num">{kb(b.dbBytes)}</td>
                <td className="num">{kb(b.uploadsBytes)}</td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <a href={`/api/backups/${b.name}/download`} className="small" download>
                    Download
                  </a>
                  <ConfirmButton
                    label="Restore"
                    confirmLabel="Replace all data?"
                    ariaLabel={`Restore ${b.name}`}
                    disabled={restore.isPending}
                    onConfirm={() => restore.mutate(b.name)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">No backups yet.</p>
      )}
    </section>
  );
}

function ExportCard() {
  return (
    <section className="card" aria-label="Export">
      <h2>Export</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        CSV files (amounts in dollars, times in UTC). The trade list's own export button applies its
        filters.
      </p>
      <ul>
        <li>
          <a href="/api/export/trades.csv" download>
            All trades with metrics
          </a>
        </li>
        <li>
          <a href="/api/export/executions.csv" download>
            All executions (fills)
          </a>
        </li>
        <li>
          <a href="/api/export/cash-flows.csv" download>
            All cash flows
          </a>
        </li>
      </ul>
    </section>
  );
}

export function SettingsPage() {
  const settings = useSettings();
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Settings</h1>
      </div>
      <ErrorBox error={settings.error} />
      {settings.data ? <AccountCard settings={settings.data} /> : <Loading />}
      <MarketDataCard />
      <TagsCard />
      <BackupsCard />
      <ExportCard />
    </div>
  );
}
