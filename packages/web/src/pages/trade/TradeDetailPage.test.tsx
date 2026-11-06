import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { M, chart, detail, openDetail, settings, tags } from '../../__fixtures__/data';
import { apiError, fakeApi, renderApp } from '../../__fixtures__/harness';
import type { TradeDetail } from '../../api/types';

function api(trade: TradeDetail, extra: Record<string, (c: never, p: never) => unknown> = {}) {
  return fakeApi({
    'GET /api/trades/:id': () => trade,
    'GET /api/trades/:id/chart': () => chart,
    'GET /api/tags': () => ({ tags }),
    'GET /api/settings': () => settings,
    'GET /api/health': () => ({ status: 'ok' }),
    'POST /api/trades/:id/fills': () => trade,
    'PATCH /api/trades/:id': () => trade,
    'PUT /api/trades/:id/tags': () => trade,
    'POST /api/tags': (c: { body: { name: string; kind: string } }) => ({
      id: 77,
      color: '#000',
      ...c.body,
    }),
    'POST /api/trades/:id/stops': () => ({ id: 6 }),
    'DELETE /api/stops/:id': () => undefined,
    'DELETE /api/executions/:id': () => undefined,
    'POST /api/trades/:id/screenshots': () => ({ id: 9 }),
    'PATCH /api/screenshots/:id': () => ({ id: 7 }),
    'DELETE /api/screenshots/:id': () => undefined,
    'DELETE /api/trades/:id': () => undefined,
    ...extra,
  } as never);
}

const region = (name: string) => screen.getByRole('region', { name });
const confirmClick = async (scope: HTMLElement, name: string) => {
  fireEvent.click(within(scope).getByRole('button', { name }));
  fireEvent.click(within(scope).getByRole('button', { name: `Confirm: ${name}` }));
};

describe('TradeDetailPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the stats, fills, P&L breakdown and price chart of a closed trade', async () => {
    api(detail());
    renderApp('/trades/1');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('AAPL');
    expect(screen.getByTestId('status')).toHaveTextContent('Closed');
    expect(screen.getByTestId('stat-net-pnl')).toHaveTextContent('$498.00');
    expect(screen.getByTestId('stat-r')).toHaveTextContent('2.49R');
    expect(within(screen.getByTestId('fills')).getAllByRole('row')).toHaveLength(3);
    expect(region('P&L breakdown')).toHaveTextContent('$5,500.00');
    expect(
      await screen.findByRole('img', { name: 'Daily price chart of AAPL' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('stat-mae')).toHaveTextContent('-$300.00');
    // Closed trades hide the add-fill form behind a button.
    expect(screen.queryByRole('form', { name: 'Add fill' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add a missed fill…' }));
    expect(screen.getByRole('form', { name: 'Add fill' })).toBeInTheDocument();
    expect(screen.getByLabelText('Side')).toHaveValue('BUY');
  });

  it('adds a fill to an open trade and blocks overselling', async () => {
    const calls = api(openDetail());
    renderApp('/trades/2');
    const form = await screen.findByRole('form', { name: 'Add fill' });
    expect(region('P&L breakdown')).toHaveTextContent('Realised so far');
    expect(within(form).getByLabelText('Side')).toHaveValue('SELL');
    fireEvent.change(within(form).getByLabelText('Shares'), { target: { value: '71' } });
    expect(within(form).getByText('Only 70 shares are open')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Add fill' })).toBeDisabled();
    fireEvent.change(within(form).getByLabelText('Shares'), { target: { value: '70' } });
    fireEvent.change(within(form).getByLabelText('Price'), { target: { value: '200' } });
    fireEvent.change(within(form).getByLabelText('Date'), { target: { value: '2026-11-05' } });
    fireEvent.change(within(form).getByLabelText('Time (New York)'), {
      target: { value: '15:30' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Add fill' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/api/trades/2/fills')).toBe(true),
    );
    expect(calls.find((c) => c.path === '/api/trades/2/fills')?.body).toMatchObject({
      side: 'SELL',
      quantity: 70 * M,
      price: 200 * M,
      executedAt: '2026-11-05T20:30:00.000Z',
    });
  });

  it('restores the fill form and shows the error when the server rejects a fill', async () => {
    api(openDetail(), {
      'POST /api/trades/:id/fills': () => {
        throw apiError(409, 'FILL_OUTSIDE_TRADE', 'This fill would belong to a different trade');
      },
    });
    renderApp('/trades/2');
    const form = await screen.findByRole('form', { name: 'Add fill' });
    fireEvent.change(within(form).getByLabelText('Shares'), { target: { value: '5' } });
    fireEvent.change(within(form).getByLabelText('Price'), { target: { value: '190' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add fill' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('different trade');
    expect(within(form).getByLabelText('Shares')).toHaveValue('5');
  });

  it('deletes a fill after a confirmation click', async () => {
    const calls = api(detail());
    renderApp('/trades/1');
    const fills = await screen.findByTestId('fills');
    await confirmClick(fills, 'Delete fill 10');
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/executions/10')).toBe(
        true,
      ),
    );
  });

  it('saves the journal and validates the stop against the entry', async () => {
    const calls = api(detail());
    renderApp('/trades/1');
    const form = await screen.findByRole('form', { name: 'Journal' });
    fireEvent.change(within(form).getByLabelText('Initial stop'), { target: { value: '60' } });
    expect(within(form).getByText('Stop must be below the entry price')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Save journal' })).toBeDisabled();
    fireEvent.change(within(form).getByLabelText('Initial stop'), { target: { value: '47' } });
    fireEvent.change(within(form).getByLabelText('Planned risk ($)'), { target: { value: '250' } });
    fireEvent.change(within(form).getByLabelText('Review'), { target: { value: 'Good exit' } });
    fireEvent.change(within(form).getByLabelText('Emotion'), { target: { value: 'calm' } });
    fireEvent.change(within(form).getByLabelText('Execution rating'), { target: { value: '4' } });
    fireEvent.change(within(form).getByLabelText('Setup'), { target: { value: '2' } });
    fireEvent.click(within(form).getByLabelText('Followed plan'));
    fireEvent.click(within(form).getByRole('button', { name: 'Save journal' }));
    expect(await within(form).findByText('Saved')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'PATCH' && c.path === '/api/trades/1')?.body).toEqual({
      initialStop: 47 * M,
      target: 56 * M,
      plannedRiskOverride: 250 * M,
      setupTagId: 2,
      thesis: 'Base breakout',
      review: 'Good exit',
      emotion: 'calm',
      executionRating: 4,
      followedPlan: true,
    });
  });

  it('adds existing and new tags, and removes one', async () => {
    const calls = api(detail({ tags: [tags[3]!] }));
    renderApp('/trades/1');
    const card = await screen.findByRole('region', { name: 'Tags' });
    fireEvent.change(await within(card).findByLabelText('Existing tag'), {
      target: { value: '3' },
    });
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ tagIds: [4, 3] }),
    );
    fireEvent.change(within(card).getByLabelText('New tag'), { target: { value: 'Moved stop' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Add tag' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ tagIds: [4, 77] }),
    );
    fireEvent.change(within(card).getByLabelText('New tag'), { target: { value: 'Gap' } });
    fireEvent.change(within(card).getByLabelText('Kind'), { target: { value: 'SETUP' } });
    fireEvent.keyDown(within(card).getByLabelText('New tag'), { key: 'Enter' });
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PATCH').at(-1)?.body).toEqual({ setupTagId: 77 }),
    );
    fireEvent.click(within(card).getByRole('button', { name: 'Remove tag A+ setup' }));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'PUT').at(-1)?.body).toEqual({ tagIds: [] }),
    );
  });

  it('records and deletes trailing stops', async () => {
    const calls = api(detail());
    renderApp('/trades/1');
    const card = await screen.findByRole('region', { name: 'Stop history' });
    expect(card).toHaveTextContent('$48.00');
    const form = within(card).getByRole('form', { name: 'Add stop' });
    fireEvent.change(within(form).getByLabelText('Stop price'), { target: { value: '52' } });
    fireEvent.change(within(form).getByLabelText('Date'), { target: { value: '2026-03-04' } });
    fireEvent.change(within(form).getByLabelText('Time (New York)'), {
      target: { value: '16:30' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Add stop' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/trades/1/stops')?.body).toEqual({
        stopPrice: 52 * M,
        changedAt: '2026-03-04T21:30:00.000Z',
      }),
    );
    await confirmClick(card, 'Delete stop 5');
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/stops/5')).toBe(true),
    );
  });

  it('uploads screenshots, opens them in a lightbox and edits or deletes them', async () => {
    const calls = api(detail());
    renderApp('/trades/1');
    const card = await screen.findByRole('region', { name: 'Screenshots' });
    fireEvent.change(within(card).getByLabelText('Caption'), { target: { value: 'Weekly' } });
    const png = new File([new Uint8Array([137, 80, 78, 71])], 'c.png', { type: 'image/png' });
    const txt = new File(['x'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(within(card).getByLabelText('Upload screenshot'), {
      target: { files: [png, txt] },
    });
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/api/trades/1/screenshots')).toHaveLength(1),
    );
    const form = calls.find((c) => c.path === '/api/trades/1/screenshots')?.body as FormData;
    expect(form.get('caption')).toBe('Weekly');

    fireEvent.drop(
      within(card)
        .getByText(/drop images here/)
        .closest('.dropzone')!,
      { dataTransfer: { files: [png] } },
    );
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/api/trades/1/screenshots')).toHaveLength(2),
    );

    fireEvent.click(within(card).getByRole('button', { name: 'Open screenshot: Daily chart' }));
    const dialog = screen.getByRole('dialog', { name: 'Screenshot' });
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', '/api/screenshots/7/file');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', '/api/screenshots/8/file');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next →' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '← Prev' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(within(card).getAllByRole('button', { name: 'Edit' })[0]!);
    fireEvent.change(within(card).getByLabelText('Rename screenshot'), {
      target: { value: 'Daily' },
    });
    fireEvent.submit(within(card).getByLabelText('Rename screenshot'));
    await waitFor(() =>
      expect(
        calls.find((c) => c.method === 'PATCH' && c.path === '/api/screenshots/7')?.body,
      ).toEqual({ caption: 'Daily' }),
    );
    await confirmClick(card, 'Delete screenshot 8');
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/screenshots/8')).toBe(
        true,
      ),
    );
  });

  it('warns about a split and shows the market-data note', async () => {
    api(detail(), {
      'GET /api/trades/:id/chart': () => ({
        ...chart,
        note: 'Market data is not configured',
        splits: [
          { date: '2026-03-03', ratio: 4, source: 'provider' },
          { date: '2026-03-04', ratio: 0.5, source: 'price-jump' },
        ],
      }),
    });
    renderApp('/trades/1');
    expect(await screen.findByText('Market data is not configured')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('4:1 on 2026-03-03, 1:2 on 2026-03-04');
  });

  it('lets the user delete an orphaned journal entry', async () => {
    const calls = api(detail({ orphaned: true, executions: [], netPnl: null }));
    const { router } = renderApp('/trades/1');
    const banner = await screen.findByText(/lost its executions/);
    expect(screen.queryByTestId('fills')).not.toBeInTheDocument();
    await confirmClick(banner, 'Delete orphaned entry');
    await waitFor(() => expect(router.state.location.pathname).toBe('/trades'));
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/trades/1')).toBe(true);
  });

  it('shows an error for an unknown trade', async () => {
    fakeApi({ 'GET /api/health': () => ({ status: 'ok' }) });
    renderApp('/trades/999');
    expect(await screen.findByRole('alert')).toHaveTextContent('GET /api/trades/999');
  });
});
