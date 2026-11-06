import { parseCsv } from '@tj/core';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  useCommitImport,
  useImports,
  usePresets,
  usePreviewImport,
  useSavePreset,
  useUndoImport,
} from '../api/hooks';
import type { ImportBatch, ImportPreview, ImportSource } from '../api/types';
import { ConfirmButton, ErrorBox, Field, Loading } from '../components/ui';
import { fmtMoney, fmtNyDate, fmtNyDateTime, fmtPrice, fmtQty, tone } from '../lib/format';
import {
  DATE_FORMATS,
  FIELD_LABELS,
  guessMapping,
  type CsvMapping,
  type MappingField,
  DEFAULT_SIDE_VALUES,
} from '../lib/mapping';

const SOURCE_LABEL: Record<ImportBatch['source'], string> = {
  IBKR_ACTIVITY: 'IBKR Activity Statement',
  IBKR_FLEX: 'IBKR Flex Query',
  CSV: 'CSV',
};

function IbkrHelp() {
  return (
    <details className="hint" style={{ marginTop: 8 }}>
      <summary>How to export the Activity Statement from IBKR</summary>
      <ol>
        <li>In the IBKR portal open Performance &amp; Reports → Statements.</li>
        <li>
          Run the <strong>Activity</strong> statement with Period <em>Year to Date</em> (or a custom
          range up to a year), Format <strong>CSV</strong>, and download it.
        </li>
        <li>
          Upload it here. US stock trades, USD dividends, withholding tax, interest, fees, deposits
          and withdrawals are imported; other currencies and asset classes are listed as skipped.
          Times are read as New York time.
        </li>
        <li>
          Overlapping statements are fine: rows already imported are recognised and skipped. The
          statement has no stops, so add initial stops on trades to get R statistics.
        </li>
      </ol>
    </details>
  );
}

function MappingEditor({
  headers,
  mapping,
  onChange,
}: {
  headers: string[];
  mapping: CsvMapping;
  onChange: (m: CsvMapping) => void;
}) {
  const presets = usePresets();
  const save = useSavePreset();
  const [presetName, setPresetName] = useState('');
  const setColumn = (field: MappingField, value: string) => {
    const columns = Object.fromEntries(
      Object.entries({ ...mapping.columns, [field]: value }).filter(([, v]) => v),
    ) as CsvMapping['columns'];
    onChange({ ...mapping, columns });
  };
  const sides = mapping.sideValues ?? DEFAULT_SIDE_VALUES;
  const list = (s: string) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);

  return (
    <div className="stack" style={{ gap: 10, marginTop: 12 }}>
      <div className="fields">
        <Field label="Saved mapping">
          {(p) => (
            <select
              {...p}
              value=""
              onChange={(e) => {
                const preset = presets.data?.find((x) => String(x.id) === e.target.value);
                if (preset?.mapping) {
                  onChange(preset.mapping);
                  setPresetName(preset.name);
                }
              }}
            >
              <option value="">Load…</option>
              {presets.data?.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="fields" aria-label="Column mapping" role="group">
        {(Object.keys(FIELD_LABELS) as MappingField[]).map((field) => {
          const meta = FIELD_LABELS[field];
          const missing = meta.required && !mapping.columns[field];
          return (
            <Field
              key={field}
              label={`${meta.label}${meta.required ? ' *' : ''}`}
              error={missing ? 'Required' : undefined}
              hint={meta.hint}
            >
              {(p) => (
                <select
                  {...p}
                  value={mapping.columns[field] ?? ''}
                  onChange={(e) => setColumn(field, e.target.value)}
                >
                  <option value="">—</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          );
        })}
        <Field label="Date format">
          {(p) => (
            <select
              {...p}
              value={mapping.dateFormat}
              onChange={(e) =>
                onChange({ ...mapping, dateFormat: e.target.value as CsvMapping['dateFormat'] })
              }
            >
              {DATE_FORMATS.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Times are in">
          {(p) => (
            <select
              {...p}
              value={mapping.timeZone}
              onChange={(e) =>
                onChange({ ...mapping, timeZone: e.target.value as CsvMapping['timeZone'] })
              }
            >
              <option value="America/New_York">New York time</option>
              <option value="UTC">UTC</option>
            </select>
          )}
        </Field>
        {mapping.columns.side && (
          <>
            <Field label="Buy values" hint="Comma-separated, any case">
              {(p) => (
                <input
                  {...p}
                  value={sides.buy.join(', ')}
                  onChange={(e) =>
                    onChange({ ...mapping, sideValues: { ...sides, buy: list(e.target.value) } })
                  }
                />
              )}
            </Field>
            <Field label="Sell values" hint="Comma-separated, any case">
              {(p) => (
                <input
                  {...p}
                  value={sides.sell.join(', ')}
                  onChange={(e) =>
                    onChange({ ...mapping, sideValues: { ...sides, sell: list(e.target.value) } })
                  }
                />
              )}
            </Field>
          </>
        )}
      </div>
      <div className="fields">
        <Field label="Save mapping as">
          {(p) => (
            <input {...p} value={presetName} onChange={(e) => setPresetName(e.target.value)} />
          )}
        </Field>
        <div className="actions" style={{ gridColumn: 'auto', paddingTop: 18 }}>
          <button
            type="button"
            disabled={!presetName.trim() || save.isPending}
            onClick={() => {
              const existing = presets.data?.find((x) => x.name === presetName.trim());
              save.mutate({
                ...(existing ? { id: existing.id } : {}),
                name: presetName.trim(),
                mapping,
              });
            }}
          >
            Save mapping
          </button>
          {save.isSuccess && <span className="ok-text">Saved</span>}
        </div>
      </div>
      {save.error && <ErrorBox error={save.error} />}
    </div>
  );
}

function PreviewPanel({ preview, onDone }: { preview: ImportPreview; onDone: () => void }) {
  const commit = useCommitImport();
  const [force, setForce] = useState(false);
  const s = preview.summary;
  const newRows = s.executions.new + s.cashFlows.new;
  const problems = [
    ...preview.executions
      .filter((e) => e.status === 'error')
      .map((e) => ({
        line: e.line,
        kind: 'Blocks import',
        reason: `${e.symbol}: ${e.error ?? ''}`,
      })),
    ...preview.issues.map((i) => ({
      line: i.line,
      kind:
        i.severity === 'error' ? 'Unreadable' : i.severity === 'warning' ? 'Warning' : 'Skipped',
      reason: i.reason,
    })),
  ].sort((a, b) => a.line - b.line);

  if (commit.data) {
    return (
      <div className="card" role="status" aria-label="Import result">
        <strong>Imported {commit.data.rowsInserted} rows</strong>
        {commit.data.rowsSkippedDuplicate > 0 &&
          ` (${commit.data.rowsSkippedDuplicate} already present, skipped)`}
        . <Link to="/trades">View trades</Link> ·{' '}
        <button type="button" className="small" onClick={onDone}>
          Import another file
        </button>
      </div>
    );
  }

  return (
    <section className="card stack" aria-label="Import preview">
      <h2>Preview: {preview.batch.filename}</h2>
      <div className="stats" data-testid="import-summary">
        <div className="stat">
          <div className="label">New fills</div>
          <div className="value">{s.executions.new}</div>
        </div>
        <div className="stat">
          <div className="label">New cash items</div>
          <div className="value">{s.cashFlows.new}</div>
        </div>
        <div className="stat">
          <div className="label">Already imported</div>
          <div className="value">{s.executions.duplicate + s.cashFlows.duplicate}</div>
        </div>
        <div className="stat">
          <div className="label">Skipped</div>
          <div className="value">{s.skipped}</div>
        </div>
        <div className="stat">
          <div className="label">Problems</div>
          <div className={`value ${s.errors + s.executions.error > 0 ? 'neg' : ''}`}>
            {s.errors + s.executions.error}
          </div>
        </div>
        <div className="stat">
          <div className="label">Trades created / changed</div>
          <div className="value">
            {preview.trades.created.length} / {preview.trades.changed.length}
          </div>
        </div>
      </div>

      {preview.duplicateOf && (
        <div className="banner" role="alert">
          This exact file was already imported on {fmtNyDate(preview.duplicateOf.importedAt)}{' '}
          (import #{preview.duplicateOf.id}).
          <label style={{ display: 'block', marginTop: 6 }}>
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />{' '}
            Import anyway (only rows that are missing get added)
          </label>
        </div>
      )}
      {!preview.canCommit && (
        <div className="error-box" role="alert">
          Some fills would sell more shares than are held (v1 is long-only). Import the earlier
          statement that contains the buys first, or fix the file.
        </div>
      )}

      {preview.trades.created.length + preview.trades.changed.length > 0 && (
        <div className="table-wrap">
          <h2>Trades</h2>
          <table aria-label="Trades affected">
            <thead>
              <tr>
                <th />
                <th>Symbol</th>
                <th>Opened</th>
                <th>Closed</th>
                <th className="num">Fills</th>
                <th className="num">Net P&L</th>
              </tr>
            </thead>
            <tbody>
              {[
                ...preview.trades.created.map((t) => ({ ...t, change: 'New' })),
                ...preview.trades.changed.map((t) => ({ ...t, change: 'Changed' })),
              ].map((t) => (
                <tr key={`${t.change}-${t.id}`}>
                  <td>
                    <span className="badge">{t.change}</span>
                  </td>
                  <td>{t.symbol}</td>
                  <td>{fmtNyDate(t.openedAt)}</td>
                  <td>
                    {t.closedAt ? fmtNyDate(t.closedAt) : <span className="badge open">Open</span>}
                  </td>
                  <td className="num">{t.fills}</td>
                  <td className={`num ${tone(t.netPnl)}`}>{fmtMoney(t.netPnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {problems.length > 0 && (
        <div className="table-wrap">
          <h2>Rows not imported</h2>
          <table aria-label="Rows not imported">
            <thead>
              <tr>
                <th className="num">Line</th>
                <th>Kind</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {problems.map((p, i) => (
                <tr key={i}>
                  <td className="num">{p.line}</td>
                  <td>{p.kind}</td>
                  <td style={{ whiteSpace: 'normal' }}>{p.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {s.executions.new > 0 && (
        <details>
          <summary>New fills ({s.executions.new})</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time (NY)</th>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th className="num">Shares</th>
                  <th className="num">Price</th>
                  <th className="num">Costs</th>
                </tr>
              </thead>
              <tbody>
                {preview.executions
                  .filter((e) => e.status === 'new')
                  .map((e) => (
                    <tr key={e.line}>
                      <td>{fmtNyDateTime(e.executedAt)}</td>
                      <td>{e.symbol}</td>
                      <td>{e.side === 'BUY' ? 'Buy' : 'Sell'}</td>
                      <td className="num">{fmtQty(e.quantity)}</td>
                      <td className="num">{fmtPrice(e.price)}</td>
                      <td className="num">{fmtMoney(e.commission + e.otherFees)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {s.cashFlows.new > 0 && (
        <details>
          <summary>New cash items ({s.cashFlows.new})</summary>
          <table>
            <tbody>
              {preview.cashFlows
                .filter((c) => c.status === 'new')
                .map((c) => (
                  <tr key={c.line}>
                    <td>{c.occurredAt}</td>
                    <td>{c.type.toLowerCase()}</td>
                    <td className={`num ${tone(c.amount)}`}>{fmtMoney(c.amount)}</td>
                    <td style={{ whiteSpace: 'normal' }}>{c.note}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </details>
      )}

      <div className="actions">
        <button
          className="primary"
          type="button"
          disabled={!preview.canCommit || (!!preview.duplicateOf && !force) || commit.isPending}
          onClick={() => commit.mutate({ id: preview.batch.id, force })}
        >
          {newRows === 0 ? 'Commit import' : `Commit import (${newRows} rows)`}
        </button>
        <button type="button" onClick={onDone}>
          Discard
        </button>
      </div>
      {commit.error && <ErrorBox error={commit.error} />}
    </section>
  );
}

function History() {
  const imports = useImports();
  const undo = useUndoImport();
  if (imports.isPending) return <Loading />;
  if (!imports.data?.length) return <p className="muted">No imports yet.</p>;
  return (
    <>
      <div className="table-wrap">
        <table data-testid="import-history">
          <thead>
            <tr>
              <th>#</th>
              <th>Imported</th>
              <th>Source</th>
              <th>File</th>
              <th className="num">Added</th>
              <th className="num">Already present</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {imports.data.map((b) => (
              <tr key={b.id}>
                <td>{b.id}</td>
                <td>{fmtNyDateTime(b.committedAt ?? b.importedAt)}</td>
                <td>{SOURCE_LABEL[b.source]}</td>
                <td>{b.filename}</td>
                <td className="num">{b.rowsInserted}</td>
                <td className="num">{b.rowsSkippedDuplicate}</td>
                <td>{b.status === 'COMMITTED' ? 'Imported' : `Undone ${fmtNyDate(b.undoneAt)}`}</td>
                <td>
                  {b.status === 'COMMITTED' && (
                    <ConfirmButton
                      label="Undo"
                      confirmLabel="Confirm undo"
                      ariaLabel={`Undo import ${b.id}`}
                      disabled={undo.isPending}
                      onConfirm={() => undo.mutate({ id: b.id })}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {undo.error && <ErrorBox error={undo.error} />}
    </>
  );
}

export function ImportPage() {
  const previewImport = usePreviewImport();
  const [source, setSource] = useState<ImportSource>('IBKR_ACTIVITY');
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [inputKey, setInputKey] = useState(0);

  async function chooseFile(f: File | null) {
    setFile(f);
    previewImport.reset();
    setHeaders([]);
    setMapping(null);
    if (!f || source !== 'CSV') return;
    const rows = parseCsv((await f.text()).slice(0, 20_000));
    const [head = [], ...samples] = rows;
    setHeaders(head.map((h) => h.trim()));
    setMapping(
      guessMapping(
        head.map((h) => h.trim()),
        samples.slice(0, 5),
      ),
    );
  }

  const missingRequired =
    source === 'CSV' &&
    (!mapping ||
      (['symbol', 'quantity', 'price', 'date'] as const).some((k) => !mapping.columns[k]));

  const reset = () => {
    previewImport.reset();
    setFile(null);
    setHeaders([]);
    setMapping(null);
    setInputKey((k) => k + 1);
  };

  return (
    <div className="stack">
      <div className="page-head">
        <h1>Import</h1>
      </div>

      {!previewImport.data && (
        <section className="card" aria-label="Import a file">
          <h2>Import a file</h2>
          <div
            className="fields"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}
          >
            <Field label="Source">
              {(p) => (
                <select
                  {...p}
                  value={source}
                  onChange={(e) => {
                    setSource(e.target.value as ImportSource);
                    reset();
                  }}
                >
                  <option value="IBKR_ACTIVITY">IBKR Activity Statement (CSV)</option>
                  <option value="CSV">Other broker (CSV with column mapping)</option>
                </select>
              )}
            </Field>
            <Field label="File">
              {(p) => (
                <input
                  {...p}
                  key={inputKey}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => void chooseFile(e.target.files?.[0] ?? null)}
                />
              )}
            </Field>
          </div>
          {source === 'IBKR_ACTIVITY' && <IbkrHelp />}
          {source === 'CSV' && mapping && (
            <MappingEditor headers={headers} mapping={mapping} onChange={setMapping} />
          )}
          <div className="actions" style={{ marginTop: 12 }}>
            <button
              className="primary"
              type="button"
              disabled={!file || missingRequired || previewImport.isPending}
              onClick={() =>
                file &&
                previewImport.mutate({
                  file,
                  source,
                  ...(source === 'CSV' && mapping ? { mapping } : {}),
                })
              }
            >
              {previewImport.isPending ? 'Reading…' : 'Preview'}
            </button>
            <span className="hint">Nothing is saved until you commit the preview.</span>
          </div>
          {previewImport.error && <ErrorBox error={previewImport.error} />}
        </section>
      )}

      {previewImport.data && <PreviewPanel preview={previewImport.data} onDone={reset} />}

      <section className="card" aria-label="Import history">
        <h2>Import history</h2>
        <History />
      </section>
    </div>
  );
}
