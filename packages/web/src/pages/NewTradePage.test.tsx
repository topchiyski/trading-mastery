import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { M, detail, settings, tags } from '../__fixtures__/data';
import { apiError, fakeApi, renderApp } from '../__fixtures__/harness';

function api(create: (body: unknown) => unknown = () => detail({ id: 42 })) {
  return fakeApi({
    'GET /api/tags': () => ({ tags }),
    'GET /api/settings': () => settings,
    'GET /api/health': () => ({ status: 'ok' }),
    'POST /api/tags': (c) => ({ id: 99, ...(c.body as object), color: '#000000' }),
    'POST /api/trades': (c) => create(c.body),
    'GET /api/trades/:id': () => detail({ id: 42 }),
    'GET /api/trades/:id/chart': () => ({
      candles: [],
      markers: [],
      levels: {},
      excursions: null,
      splits: [],
      complete: false,
      note: null,
      status: 'OPEN',
      symbol: 'X',
      from: '',
      to: '',
    }),
  });
}

const form = () => screen.getByRole('form', { name: 'New trade' });
const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('NewTradePage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('pre-fills the default commission, previews risk and creates the trade', async () => {
    const calls = api();
    const { router } = renderApp('/trades/new');
    await waitFor(() => expect(screen.getByLabelText('Commission')).toHaveValue('1'));
    fill('Symbol', 'amd');
    expect(screen.getByLabelText('Symbol')).toHaveValue('AMD');
    fill('Date', '2026-03-02');
    fill('Time (New York)', '10:00');
    fill('Shares', '100');
    fill('Price', '50');
    fill('Initial stop', '48');
    fill('Target', '56');
    expect(screen.getByTestId('risk-preview')).toHaveTextContent('$200.00');
    expect(screen.getByTestId('risk-preview')).toHaveTextContent('3.00');
    fireEvent.change(screen.getByLabelText('Setup'), { target: { value: '1' } });
    fill('Thesis', 'Breakout');
    fireEvent.click(screen.getByRole('button', { name: 'Create trade' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/trades/42'));
    expect(calls.find((c) => c.method === 'POST' && c.path === '/api/trades')?.body).toEqual({
      symbol: 'AMD',
      fill: {
        quantity: 100 * M,
        price: 50 * M,
        commission: 1 * M,
        otherFees: 0,
        executedAt: '2026-03-02T15:00:00.000Z',
      },
      initialStop: 48 * M,
      target: 56 * M,
      setupTagId: 1,
      thesis: 'Breakout',
    });
  });

  it('shows every missing field after a submit attempt', async () => {
    api();
    renderApp('/trades/new');
    await screen.findByRole('form', { name: 'New trade' });
    fill('Time (New York)', '');
    fireEvent.click(screen.getByRole('button', { name: 'Create trade' }));
    expect(await screen.findAllByText('Required')).toHaveLength(4); // symbol, time, shares, price
    fill('Symbol', 'AMD1!');
    expect(screen.getByText('Use an uppercase ticker like AAPL or BRK.B')).toBeInTheDocument();
  });

  it('blocks a stop at or above the entry, and a target below it', async () => {
    api();
    renderApp('/trades/new');
    await screen.findByRole('form', { name: 'New trade' });
    fill('Price', '50');
    fill('Shares', '1');
    fill('Initial stop', '50');
    expect(screen.getByText('Stop must be below the entry price')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create trade' })).toBeDisabled();
    fill('Initial stop', '');
    fill('Target', '49');
    fireEvent.blur(screen.getByLabelText('Target'));
    expect(screen.getByText('Target must be above the entry price')).toBeInTheDocument();
  });

  it('creates a new setup tag first when asked to', async () => {
    const calls = api();
    renderApp('/trades/new');
    await screen.findByRole('form', { name: 'New trade' });
    fill('Symbol', 'AMD');
    fill('Date', '2026-03-02');
    fill('Time (New York)', '10:00');
    fill('Shares', '1');
    fill('Price', '50');
    fireEvent.change(screen.getByLabelText('Setup'), { target: { value: '__new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create trade' }));
    expect(await screen.findByText('Required')).toBeInTheDocument(); // the new setup's name
    fill('New setup name', 'Gap fill');
    fireEvent.click(screen.getByRole('button', { name: 'Create trade' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/api/trades')).toBe(true),
    );
    expect(calls.find((c) => c.path === '/api/tags' && c.method === 'POST')?.body).toEqual({
      name: 'Gap fill',
      kind: 'SETUP',
    });
    expect(
      (
        calls.find((c) => c.path === '/api/trades' && c.method === 'POST')?.body as {
          setupTagId: number;
        }
      ).setupTagId,
    ).toBe(99);
  });

  it('links to the open trade when the symbol already has a position', async () => {
    api(() => {
      throw apiError(409, 'POSITION_ALREADY_OPEN', 'There is already an open AMD trade', {
        tradeId: 5,
      });
    });
    renderApp('/trades/new');
    await screen.findByRole('form', { name: 'New trade' });
    fill('Symbol', 'AMD');
    fill('Date', '2026-03-02');
    fill('Time (New York)', '10:00');
    fill('Shares', '1');
    fill('Price', '50');
    fireEvent.click(screen.getByRole('button', { name: 'Create trade' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'There is already an open AMD trade',
    );
    expect(screen.getByRole('link', { name: 'Open that trade' })).toHaveAttribute(
      'href',
      '/trades/5',
    );
    expect(form()).toBeInTheDocument();
  });
});
