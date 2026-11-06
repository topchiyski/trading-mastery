import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { marketStatus, positions } from '../__fixtures__/data';
import { fakeApi, renderApp } from '../__fixtures__/harness';
import type { MarketStatus } from '../api/types';

function api(status: MarketStatus = marketStatus) {
  return fakeApi({
    'GET /api/health': () => ({ status: 'ok' }),
    'GET /api/positions': () => positions,
    'GET /api/market-data/status': () => status,
    'POST /api/market-data/sync': () => ({ ...status, pendingSymbols: 0, lastError: null }),
  });
}

describe('PositionsPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('values positions at the last close with totals and flags', async () => {
    api();
    renderApp('/positions');
    const nvda = await screen.findByRole('row', { name: /NVDA/ });
    const cells = within(nvda).getAllByRole('cell');
    expect(cells[3]).toHaveTextContent('$190.00');
    expect(cells[4]).toHaveTextContent('$700.00');
    expect(cells[10]).toHaveTextContent('$560.00');
    expect(within(nvda).getByText(/split\?/)).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /ORCL/ })).toHaveTextContent('—');
    expect(screen.getByTestId('pos-open-risk-pct')).toHaveTextContent('2.15%');
    expect(screen.getByText(/1 position\(s\) have no price yet/)).toBeInTheDocument();
    expect(screen.getByText(/Valued at the/)).toHaveTextContent('last close (2026-11-05)');
  });

  it('shows market-data status and fetches prices on demand', async () => {
    const calls = api();
    renderApp('/positions');
    const card = await screen.findByRole('region', { name: 'Market data' });
    expect(await within(card).findByTestId('pending-symbols')).toHaveTextContent(
      '3 symbols still to fetch',
    );
    expect(card).toHaveTextContent('50/50 per hour');
    expect(card).toHaveTextContent('next request in 30 min');
    expect(card).toHaveTextContent('no data for ZZZZ');
    expect(card).toHaveTextContent('Paused at the provider rate limit');
    fireEvent.click(within(card).getByRole('button', { name: 'Fetch prices now' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/api/market-data/sync')).toBe(
        true,
      ),
    );
  });

  it('explains how to configure market data', async () => {
    api({ ...marketStatus, configured: false, provider: null });
    renderApp('/positions');
    expect(await screen.findByText(/Not configured/)).toBeInTheDocument();
  });

  it('shows other provider errors as they are', async () => {
    api({
      ...marketStatus,
      lastError: { kind: 'auth', message: 'The API key was rejected' },
      unknownSymbols: [],
      nextSlotInMs: 0,
      pendingSymbols: 0,
    });
    renderApp('/positions');
    expect(await screen.findByText('The API key was rejected')).toBeInTheDocument();
    expect(screen.getByTestId('pending-symbols')).toHaveTextContent('all symbols up to date');
  });
});
