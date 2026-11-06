import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MissingStopsPage } from './MissingStopsPage';

const M = 1_000_000;

const trade = (id: number, symbol: string, status: 'OPEN' | 'CLOSED', netPnl: number | null) => ({
  id,
  stableKey: id,
  symbol,
  direction: 'LONG',
  status,
  openedAt: '2026-03-02T15:00:00.000Z',
  closedAt: status === 'CLOSED' ? '2026-03-04T19:00:00.000Z' : null,
  orphaned: false,
  orphanedAt: null,
  setupTag: null,
  tags: [],
  quantity: 100 * M,
  openQty: status === 'OPEN' ? 100 * M : 0,
  avgEntry: 50 * M,
  avgExit: null,
  firstEntryPrice: 50 * M,
  netPnl,
  realisedNet: 0,
  fees: 0,
  returnPct: null,
  initialRisk: null,
  rMultiple: null,
  plannedRewardRisk: null,
  holding: { calendarDays: 2, tradingDays: 2 },
  outcome: null,
});

/** Fake API: the list shrinks once a stop is saved. */
function fakeApi() {
  let missing = [trade(1, 'MSFT', 'OPEN', null), trade(2, 'NVDA', 'CLOSED', 120 * M)];
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    if (method === 'PATCH') {
      const id = Number(url.split('/').pop());
      missing = missing.filter((t) => t.id !== id);
      return new Response(JSON.stringify({ id }), { status: 200 });
    }
    return new Response(JSON.stringify({ trades: missing, totals: {} }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MissingStopsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MissingStopsPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists trades without a stop and saves a stop inline (as micros)', async () => {
    const calls = fakeApi();
    renderPage();
    expect(await screen.findByRole('row', { name: /MSFT/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /NVDA/ })).toBeInTheDocument();
    expect(calls[0]?.url).toBe('/api/trades?missingStop=true&orphaned=exclude');

    const row = screen.getByRole('row', { name: /MSFT/ });
    fireEvent.change(within(row).getByLabelText('Initial stop for MSFT'), {
      target: { value: '48.5' },
    });
    fireEvent.click(within(row).getByRole('button', { name: 'Save stop for MSFT' }));

    await waitFor(() =>
      expect(screen.queryByRole('row', { name: /MSFT/ })).not.toBeInTheDocument(),
    );
    expect(calls.find((c) => c.method === 'PATCH')).toEqual({
      method: 'PATCH',
      url: '/api/trades/1',
      body: { initialStop: 48_500_000 },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Saved the stop for MSFT');
    expect(screen.getByText(/1 trade without/)).toBeInTheDocument();
  });

  it('blocks a stop at or above the first entry price', async () => {
    const calls = fakeApi();
    renderPage();
    const row = await screen.findByRole('row', { name: /MSFT/ });
    fireEvent.change(within(row).getByLabelText('Initial stop for MSFT'), {
      target: { value: '50' },
    });
    expect(within(row).getByText('Must be below the first entry ($50.00)')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Save stop for MSFT' })).toBeDisabled();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('shows an empty state when every trade has a stop', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ trades: [], totals: {} }), { status: 200 })),
    );
    renderPage();
    expect(await screen.findByText('Every trade has an initial stop.')).toBeInTheDocument();
  });
});
