import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { preview } from '../__fixtures__/data';
import { apiError, fakeApi, renderApp } from '../__fixtures__/harness';
import type { ImportBatch } from '../api/types';

const committed: ImportBatch = {
  ...preview().batch,
  id: 3,
  status: 'COMMITTED',
  committedAt: '2026-11-05T10:00:00.000Z',
  rowsInserted: 18,
  rowsSkippedDuplicate: 0,
};
const undone: ImportBatch = {
  ...committed,
  id: 2,
  status: 'UNDONE',
  undoneAt: '2026-11-05T11:00:00.000Z',
};

function api(over: Record<string, (c: never) => unknown> = {}) {
  return fakeApi({
    'GET /api/health': () => ({ status: 'ok' }),
    'GET /api/imports': () => ({ imports: [committed, undone] }),
    'GET /api/import-presets': () => ({
      presets: [
        {
          id: 1,
          name: 'Broker A',
          createdAt: '',
          mapping: {
            columns: { symbol: 'Sym', quantity: 'Qty', price: 'Px', date: 'When' },
            dateFormat: 'YYYY-MM-DD',
            timeZone: 'UTC',
          },
        },
      ],
    }),
    'POST /api/import-presets': (c: { body: object }) => ({ id: 2, createdAt: '', ...c.body }),
    'PUT /api/import-presets/:id': (c: { body: object }) => ({ id: 1, createdAt: '', ...c.body }),
    'POST /api/imports/preview': () => preview(),
    'POST /api/imports/:id/commit': () => ({
      ...preview().batch,
      status: 'COMMITTED',
      rowsInserted: 3,
      rowsSkippedDuplicate: 0,
    }),
    'POST /api/imports/:id/undo': () => ({ ...committed, status: 'UNDONE' }),
    ...over,
  } as never);
}

const csvFile = (text: string, name = 'trades.csv') => {
  const f = new File([text], name, { type: 'text/csv' });
  // jsdom's File has no text() in some versions.
  Object.defineProperty(f, 'text', { value: async () => text });
  return f;
};
const region = (name: string) => screen.getByRole('region', { name });

describe('ImportPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('previews an IBKR statement and commits it', async () => {
    const calls = api();
    renderApp('/imports');
    const card = await screen.findByRole('region', { name: 'Import a file' });
    expect(
      within(card).getByText('How to export the Activity Statement from IBKR'),
    ).toBeInTheDocument();
    fireEvent.change(within(card).getByLabelText('File'), {
      target: { files: [csvFile('Statement,Header')] },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Preview' }));

    const pv = await screen.findByRole('region', { name: 'Import preview' });
    const summary = within(pv).getByTestId('import-summary');
    expect(summary).toHaveTextContent('New fills2');
    expect(summary).toHaveTextContent('Trades created / changed1 / 1');
    expect(within(pv).getByRole('table', { name: 'Trades affected' })).toHaveTextContent('Changed');
    expect(within(pv).getByRole('table', { name: 'Rows not imported' })).toHaveTextContent(
      'Non-USD (HKD)',
    );
    expect(within(pv).getByText('New fills (2)')).toBeInTheDocument();
    expect(within(pv).getByText('New cash items (1)')).toBeInTheDocument();
    const form = calls.find((c) => c.path === '/api/imports/preview')?.body as FormData;
    expect(form.get('source')).toBe('IBKR_ACTIVITY');

    fireEvent.click(within(pv).getByRole('button', { name: 'Commit import (3 rows)' }));
    expect(await screen.findByRole('status', { name: 'Import result' })).toHaveTextContent(
      'Imported 3 rows',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Import another file' }));
    expect(await screen.findByRole('region', { name: 'Import a file' })).toBeInTheDocument();
  });

  it('needs "Import anyway" for an already imported file, and blocks long-only violations', async () => {
    const calls = api({
      'POST /api/imports/preview': () =>
        preview({
          duplicateOf: { id: 3, filename: 'statement.csv', importedAt: '2026-11-05T10:00:00.000Z' },
          canCommit: true,
          summary: {
            executions: { new: 0, duplicate: 2, error: 0 },
            cashFlows: { new: 0, duplicate: 1 },
            skipped: 0,
            errors: 1,
            warnings: 1,
          },
          issues: [
            { line: 5, severity: 'warning', reason: 'Commission rebate ignored' },
            { line: 6, severity: 'error', reason: 'bad date' },
          ],
          trades: { created: [], changed: [] },
        }),
    });
    renderApp('/imports');
    const card = await screen.findByRole('region', { name: 'Import a file' });
    fireEvent.change(within(card).getByLabelText('File'), { target: { files: [csvFile('x')] } });
    fireEvent.click(within(card).getByRole('button', { name: 'Preview' }));
    const pv = await screen.findByRole('region', { name: 'Import preview' });
    const commit = within(pv).getByRole('button', { name: 'Commit import' });
    expect(commit).toBeDisabled();
    expect(within(pv).getByRole('table', { name: 'Rows not imported' })).toHaveTextContent(
      'Warning',
    );
    fireEvent.click(within(pv).getByLabelText(/Import anyway/));
    fireEvent.click(commit);
    await waitFor(() =>
      expect(calls.find((c) => c.path.endsWith('/commit'))?.body).toEqual({ force: true }),
    );
  });

  it('shows why a preview cannot be committed', async () => {
    api({ 'POST /api/imports/preview': () => preview({ canCommit: false }) });
    renderApp('/imports');
    const card = await screen.findByRole('region', { name: 'Import a file' });
    fireEvent.change(within(card).getByLabelText('File'), { target: { files: [csvFile('x')] } });
    fireEvent.click(within(card).getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText(/would sell more shares than are held/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(await screen.findByRole('region', { name: 'Import a file' })).toBeInTheDocument();
  });

  it('maps CSV columns from the header, loads and saves presets, and sends the mapping', async () => {
    const calls = api();
    renderApp('/imports');
    const card = await screen.findByRole('region', { name: 'Import a file' });
    fireEvent.change(within(card).getByLabelText('Source'), { target: { value: 'CSV' } });
    fireEvent.change(within(card).getByLabelText('File'), {
      target: { files: [csvFile('Date,Action,Ticker,Shares,Price\n27/03/2026,Bought,AMD,1,10\n')] },
    });
    expect(await within(card).findByLabelText('Symbol *')).toHaveValue('Ticker');
    expect(within(card).getByLabelText('Date format')).toHaveValue('DD/MM/YYYY');
    expect(within(card).getByLabelText('Buy values')).toHaveValue('BUY, B, BOT, BOUGHT');
    fireEvent.change(within(card).getByLabelText('Buy values'), { target: { value: 'Bought, B' } });
    fireEvent.change(within(card).getByLabelText('Sell values'), { target: { value: 'Sold' } });
    fireEvent.change(within(card).getByLabelText('Times are in'), { target: { value: 'UTC' } });
    fireEvent.change(within(card).getByLabelText('Date format'), {
      target: { value: 'YYYY-MM-DD' },
    });
    fireEvent.change(within(card).getByLabelText('Commission'), { target: { value: 'Price' } });
    fireEvent.change(within(card).getByLabelText('Commission'), { target: { value: '' } });

    fireEvent.change(within(card).getByLabelText('Save mapping as'), {
      target: { value: 'My broker' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Save mapping' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/api/import-presets')).toBe(true),
    );
    expect(await within(card).findByText('Saved')).toBeInTheDocument();

    fireEvent.click(within(card).getByRole('button', { name: 'Preview' }));
    await screen.findByRole('region', { name: 'Import preview' });
    const form = calls.find((c) => c.path === '/api/imports/preview')?.body as FormData;
    expect(form.get('source')).toBe('CSV');
    expect(JSON.parse(String(form.get('mapping')))).toEqual({
      columns: {
        date: 'Date',
        side: 'Action',
        symbol: 'Ticker',
        quantity: 'Shares',
        price: 'Price',
      },
      dateFormat: 'YYYY-MM-DD',
      timeZone: 'UTC',
      sideValues: { buy: ['Bought', 'B'], sell: ['Sold'] },
    });
  });

  it('applies a saved preset and requires the mandatory columns', async () => {
    api();
    renderApp('/imports');
    const card = await screen.findByRole('region', { name: 'Import a file' });
    fireEvent.change(within(card).getByLabelText('Source'), { target: { value: 'CSV' } });
    fireEvent.change(within(card).getByLabelText('File'), {
      target: { files: [csvFile('Sym,Qty,Px,When\n')] },
    });
    await within(card).findByLabelText('Symbol *');
    expect(within(card).getAllByText('Required').length).toBeGreaterThan(0);
    expect(within(card).getByRole('button', { name: 'Preview' })).toBeDisabled();
    fireEvent.change(await within(card).findByLabelText('Saved mapping'), {
      target: { value: '1' },
    });
    expect(within(card).getByLabelText('Symbol *')).toHaveValue('Sym');
    expect(within(card).getByLabelText('Save mapping as')).toHaveValue('Broker A');
    expect(within(card).getByRole('button', { name: 'Preview' })).toBeEnabled();
  });

  it('shows the history and undoes an import', async () => {
    const calls = api({
      'POST /api/imports/:id/undo': () => {
        throw apiError(422, 'UNDO_BREAKS_POSITIONS', 'Later fills depend on this import');
      },
    });
    renderApp('/imports');
    const history = await screen.findByTestId('import-history');
    expect(within(history).getByRole('row', { name: /^2 / })).toHaveTextContent('Undone');
    fireEvent.click(within(history).getByRole('button', { name: 'Undo import 3' }));
    fireEvent.click(within(history).getByRole('button', { name: 'Confirm: Undo import 3' }));
    expect(await within(region('Import history')).findByRole('alert')).toHaveTextContent(
      'Later fills depend',
    );
    expect(calls.some((c) => c.path === '/api/imports/3/undo')).toBe(true);
  });

  it('reports an unreadable file', async () => {
    api({
      'POST /api/imports/preview': () => {
        throw apiError(
          400,
          'UNREADABLE_FILE',
          'This file is not an IBKR Activity Statement (CSV).',
        );
      },
      'GET /api/imports': () => ({ imports: [] }),
    });
    renderApp('/imports');
    expect(await screen.findByText('No imports yet.')).toBeInTheDocument();
    const card = region('Import a file');
    fireEvent.change(within(card).getByLabelText('File'), { target: { files: [csvFile('x')] } });
    fireEvent.click(within(card).getByRole('button', { name: 'Preview' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent(
      'not an IBKR Activity Statement',
    );
  });
});
