import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { M, listItem, tags } from '../__fixtures__/data';
import { fakeApi, renderApp } from '../__fixtures__/harness';

const trades = [
  listItem(),
  listItem({
    id: 2,
    symbol: 'MSFT',
    netPnl: -202 * M,
    realisedNet: -202 * M,
    rMultiple: -2.02,
    returnPct: -0.05,
    openedAt: '2026-03-05T15:00:00.000Z',
    setupTag: null,
    outcome: 'LOSS',
  }),
  listItem({
    id: 3,
    symbol: 'NVDA',
    status: 'OPEN',
    closedAt: null,
    netPnl: null,
    realisedNet: 478 * M,
    returnPct: null,
    rMultiple: null,
    openedAt: '2026-10-14T14:45:00.000Z',
    outcome: null,
  }),
];
const totals = {
  count: 3,
  closedCount: 2,
  openCount: 1,
  netPnl: 296 * M,
  fees: 6 * M,
  wins: 1,
  losses: 1,
  breakEvens: 0,
  winRate: 0.5,
  expectancy: 148 * M,
  expectancyR: 0.235,
  rExcludedCount: 0,
};

function api(list = trades, orphans: typeof trades = []) {
  return fakeApi({
    'GET /api/trades': (c) =>
      c.query.get('orphaned') === 'only'
        ? { trades: orphans, totals: { ...totals, count: orphans.length } }
        : { trades: list, totals },
    'GET /api/tags': () => ({ tags }),
    'GET /api/health': () => ({ status: 'ok', app: 'x', time: 'now' }),
  });
}

const symbols = () =>
  screen
    .getAllByRole('row')
    .slice(1, -1)
    .map((r) =>
      within(r)
        .getAllByRole('cell')[0]
        ?.textContent?.replace(/Open|Orphaned/, '')
        .trim(),
    );

describe('TradesPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists trades with derived columns and the totals row', async () => {
    api();
    renderApp('/trades');
    const row = await screen.findByRole('row', { name: /AAPL/ });
    expect(row).toHaveTextContent('$498.00');
    expect(row).toHaveTextContent('9.96%');
    expect(row).toHaveTextContent('2.49R');
    expect(row).toHaveTextContent('Breakout');
    expect(screen.getByRole('row', { name: /NVDA/ })).toHaveTextContent('Open');
    const t = screen.getByTestId('totals');
    expect(t).toHaveTextContent('3 trades');
    expect(t).toHaveTextContent('$296.00');
    expect(t).toHaveTextContent('1W / 1L');
  });

  it('sorts by a column and toggles the direction', async () => {
    api();
    renderApp('/trades');
    await screen.findByRole('row', { name: /AAPL/ });
    fireEvent.click(screen.getByRole('button', { name: 'Net P&L' }));
    expect(symbols()).toEqual(['AAPL', 'NVDA', 'MSFT']); // the open trade sorts by realised $478
    expect(screen.getByRole('columnheader', { name: /Net P&L/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    fireEvent.click(screen.getByRole('button', { name: /Net P&L/ }));
    expect(symbols()).toEqual(['MSFT', 'NVDA', 'AAPL']);
    fireEvent.click(screen.getByRole('button', { name: 'Symbol' }));
    expect(symbols()).toEqual(['NVDA', 'MSFT', 'AAPL']);
    fireEvent.click(screen.getByRole('button', { name: 'R' }));
    expect(symbols()).toEqual(['AAPL', 'MSFT', 'NVDA']); // empty values last
  });

  it('sends every filter to the API from the URL-backed filter bar', async () => {
    const calls = api();
    const { router } = renderApp('/trades');
    await screen.findByRole('row', { name: /AAPL/ });
    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'msft' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-03-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-03-31' } });
    fireEvent.change(screen.getByLabelText('Setup'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Mistake / tag'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'LOSS' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'CLOSED' } });
    await waitFor(() => {
      const last = calls.filter((c) => c.path === '/api/trades' && !c.query.has('orphaned')).at(-1);
      expect(Object.fromEntries(last?.query ?? [])).toEqual({
        symbol: 'MSFT',
        from: '2026-03-01',
        to: '2026-03-31',
        setupTagId: '1',
        tagId: '3',
        outcome: 'LOSS',
        status: 'CLOSED',
      });
    });
    expect(router.state.location.search).toContain('outcome=LOSS');
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute(
      'href',
      expect.stringContaining('/api/export/trades.csv?status=CLOSED'),
    );
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: '' } });
    await waitFor(() => expect(router.state.location.search).not.toContain('status='));
  });

  it('opens a trade when its row is clicked', async () => {
    api();
    const { router } = renderApp('/trades');
    fireEvent.click(await screen.findByRole('row', { name: /MSFT/ }));
    expect(router.state.location.pathname).toBe('/trades/2');
  });

  it('shows empty states and the orphan banner', async () => {
    api([], [listItem({ id: 9, orphaned: true, netPnl: null })]);
    renderApp('/trades');
    expect(await screen.findByText(/No trades yet/)).toBeInTheDocument();
    expect(await screen.findByText(/1 journal entry has lost/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'ZZ' } });
    expect(await screen.findByText('No trades match these filters.')).toBeInTheDocument();
  });

  it('lists orphaned journal entries on their own view', async () => {
    api(trades, [listItem({ id: 9, symbol: 'OLD', orphaned: true, netPnl: null })]);
    renderApp('/trades?orphaned=only');
    expect(
      await screen.findByRole('heading', { name: 'Orphaned journal entries' }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('row', { name: /OLD/ })).toHaveTextContent('Orphaned');
  });
});
