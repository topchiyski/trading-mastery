import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { M, marketStatus, settings, tags } from '../__fixtures__/data';
import { apiError, fakeApi, renderApp } from '../__fixtures__/harness';

const backups = [
  {
    name: 'journal-20261106-0802',
    createdAt: '2026-11-06T13:02:00.000Z',
    dbBytes: 340_000,
    uploadsBytes: 2_000,
  },
  {
    name: 'journal-20261105-1700',
    createdAt: '2026-11-05T22:00:00.000Z',
    dbBytes: 330_000,
    uploadsBytes: 0,
  },
];

function api(over: Record<string, (c: never) => unknown> = {}) {
  return fakeApi({
    'GET /api/health': () => ({ status: 'ok' }),
    'GET /api/settings': () => settings,
    'PUT /api/settings': (c: { body: object }) => ({ ...settings, ...c.body }),
    'GET /api/market-data/status': () => marketStatus,
    'GET /api/tags': () => ({ tags }),
    'PATCH /api/tags/:id': () => tags[0],
    'DELETE /api/tags/:id': () => undefined,
    'GET /api/backups': () => ({ backups }),
    'POST /api/backups': () => backups[0],
    'POST /api/backups/:name/restore': () => ({
      restored: 'journal-20261105-1700',
      safetyBackup: 'journal-20261106-0803',
    }),
    ...over,
  } as never);
}

const region = (name: string) => screen.getByRole('region', { name });

describe('SettingsPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('saves the account settings as micros', async () => {
    const calls = api();
    renderApp('/settings');
    const form = await screen.findByRole('form', { name: 'Account settings' });
    expect(within(form).getByLabelText('Starting balance (USD)')).toHaveValue('25000.00');
    fireEvent.change(within(form).getByLabelText('Starting balance (USD)'), {
      target: { value: '30,000' },
    });
    fireEvent.change(within(form).getByLabelText('Start date'), { target: { value: '' } });
    fireEvent.change(within(form).getByLabelText('Default commission (USD)'), {
      target: { value: '0.35' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Save settings' }));
    expect(await within(form).findByText('Saved')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
      startingBalance: 30_000 * M,
      startDate: null,
      breakEvenThreshold: 1 * M,
      defaultCommission: 350_000,
    });
  });

  it('rejects negative or non-numeric amounts', async () => {
    api();
    renderApp('/settings');
    const form = await screen.findByRole('form', { name: 'Account settings' });
    fireEvent.change(within(form).getByLabelText('Break-even threshold (USD)'), {
      target: { value: '-1' },
    });
    expect(within(form).getByText('Enter an amount of 0 or more')).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText('Starting balance (USD)'), {
      target: { value: 'lots' },
    });
    expect(within(form).getByText('Enter a number')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Save settings' })).toBeDisabled();
  });

  it('renames, recolours, merges and deletes tags', async () => {
    const calls = api();
    renderApp('/settings');
    const card = await screen.findByRole('region', { name: 'Tag management' });
    const name = await within(card).findByLabelText('Name of Breakout');
    fireEvent.change(name, { target: { value: 'Base breakout' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Rename' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ name: 'Base breakout' }),
    );
    fireEvent.change(within(card).getByLabelText('Colour of Pullback'), {
      target: { value: '#123456' },
    });
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toEqual({ color: '#123456' }),
    );

    fireEvent.change(within(card).getByLabelText('Move Pullback into'), { target: { value: '1' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Merge tag Pullback' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Confirm: Merge tag Pullback' }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.method === 'DELETE' && c.path === '/api/tags/2' && c.query.get('reassignTo') === '1',
        ),
      ).toBe(true),
    );

    fireEvent.click(within(card).getByRole('button', { name: 'Delete tag A+ setup' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Confirm: Delete tag A+ setup' }));
    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.method === 'DELETE' && c.path === '/api/tags/4' && !c.query.has('reassignTo'),
        ),
      ).toBe(true),
    );
  });

  it('shows a tag error, e.g. a duplicate name', async () => {
    api({
      'PATCH /api/tags/:id': () => {
        throw apiError(409, 'DUPLICATE', 'A record with the same unique value already exists');
      },
    });
    renderApp('/settings');
    const card = await screen.findByRole('region', { name: 'Tag management' });
    fireEvent.change(await within(card).findByLabelText('Name of Breakout'), {
      target: { value: 'Pullback' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Rename' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('unique value');
  });

  it('backs up, downloads and restores', async () => {
    const calls = api();
    renderApp('/settings');
    const card = await screen.findByRole('region', { name: 'Backups' });
    const table = await within(card).findByTestId('backups');
    expect(within(table).getAllByRole('link', { name: 'Download' })[0]).toHaveAttribute(
      'href',
      '/api/backups/journal-20261106-0802/download',
    );
    fireEvent.click(within(card).getByRole('button', { name: 'Backup now' }));
    expect(await within(card).findByText('Saved journal-20261106-0802')).toBeInTheDocument();

    fireEvent.click(within(table).getByRole('button', { name: 'Restore journal-20261105-1700' }));
    expect(
      within(table).getByRole('button', { name: 'Confirm: Restore journal-20261105-1700' }),
    ).toHaveTextContent('Replace all data?');
    fireEvent.click(
      within(table).getByRole('button', { name: 'Confirm: Restore journal-20261105-1700' }),
    );
    expect(await within(card).findByText(/Restored journal-20261105-1700/)).toHaveTextContent(
      'journal-20261106-0803',
    );
    expect(calls.find((c) => c.path.endsWith('/restore'))?.body).toEqual({ confirm: true });
  });

  it('lists the exports and shows an empty backup list', async () => {
    api({ 'GET /api/backups': () => ({ backups: [] }) });
    renderApp('/settings');
    expect(
      await within(await screen.findByRole('region', { name: 'Backups' })).findByText(
        'No backups yet.',
      ),
    ).toBeInTheDocument();
    const exp = region('Export');
    expect(within(exp).getByRole('link', { name: 'All executions (fills)' })).toHaveAttribute(
      'href',
      '/api/export/executions.csv',
    );
  });
});
