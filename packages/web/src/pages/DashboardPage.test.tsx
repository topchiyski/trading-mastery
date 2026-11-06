import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dashboard, tags } from '../__fixtures__/data';
import { fakeApi, renderApp } from '../__fixtures__/harness';
import type { Dashboard } from '../api/types';

function api(d: () => Dashboard = () => dashboard()) {
  return fakeApi({
    'GET /api/health': () => ({ status: 'ok' }),
    'GET /api/tags': () => ({ tags }),
    'GET /api/dashboard': () => d(),
  });
}

const region = (name: string) => screen.getByRole('region', { name });

/** Hover over an SVG chart at a relative x position (jsdom has no layout, so fake the box). */
function hover(svg: Element, fx: number) {
  svg.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 800,
    height: 220,
    right: 800,
    bottom: 220,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  fireEvent.pointerMove(svg, { clientX: 64 + fx * (800 - 64 - 12) });
}

describe('DashboardPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the KPI tiles with their definitions', async () => {
    api();
    renderApp('/dashboard');
    const net = await screen.findByTestId('kpi-net-pnl');
    expect(net).toHaveTextContent('$596.00');
    expect(net).toHaveAttribute('title', expect.stringContaining('Sum of net P&L'));
    expect(screen.getByTestId('kpi-win-rate')).toHaveTextContent('66.7%');
    expect(screen.getByTestId('kpi-trades')).toHaveTextContent('3');
    expect(screen.getByText(/1 of 3 trades have no initial stop/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add their stops' })).toHaveAttribute(
      'href',
      '/missing-stops',
    );
    expect(region('All statistics')).toHaveTextContent('Profit factor');
  });

  it('renders every chart with a data table and crosshair tooltips', async () => {
    api();
    renderApp('/dashboard');
    const eq = await screen.findByRole('img', { name: 'Equity curve' });
    hover(eq, 0.5);
    const tip = () => region('Equity').querySelector('.chart-tooltip');
    expect(tip()).toHaveTextContent('$25,200.00');
    fireEvent.pointerLeave(eq);
    expect(tip()).toBeNull();

    for (const name of [
      'Time-weighted return',
      'Drawdown',
      'Cumulative R',
      'R-multiple distribution',
      'Net P&L distribution',
      'Holding period versus R-multiple',
      'Maximum adverse versus maximum favourable excursion, in R',
    ]) {
      expect(screen.getByRole('img', { name })).toBeInTheDocument();
    }
    const bench = screen.getByRole('img', { name: /indexed to 100/ });
    hover(bench, 1);
    expect(within(region('Portfolio vs SPY')).getAllByText(/SPY/).length).toBeGreaterThan(1);

    fireEvent.click(within(region('Equity')).getByText('Data'));
    expect(within(region('Equity')).getByRole('table')).toHaveTextContent('2026-03-06');
  });

  it('shows histogram tooltips and opens a trade from a scatter dot', async () => {
    api();
    const { router } = renderApp('/dashboard');
    const hist = await screen.findByRole('img', { name: 'R-multiple distribution' });
    // svg children: the y-axis group, then one group per bin
    fireEvent.pointerEnter(hist.querySelectorAll(':scope > g')[1]!);
    expect(region('R-multiple distribution').querySelector('.chart-tooltip')).toHaveTextContent(
      /1 trade/,
    );

    const dot = within(region('Holding period vs R')).getByRole('link', {
      name: /AAPL, closed 2026-03-04/,
    });
    fireEvent.focus(dot);
    expect(within(region('Holding period vs R')).getByText('2.5R')).toBeInTheDocument();
    fireEvent.keyDown(dot, { key: 'Enter' });
    expect(router.state.location.pathname).toBe('/trades/1');
  });

  it('opens a month of trades from the heatmap, keeping the filters', async () => {
    api();
    const { router } = renderApp('/dashboard?symbol=AAPL');
    const cell = await screen.findByRole('gridcell', { name: /Mar 2026: \$296\.00, 2 trades/ });
    fireEvent.pointerEnter(cell);
    fireEvent.click(cell);
    expect(router.state.location.pathname).toBe('/trades');
    expect(router.state.location.search).toBe(
      '?status=CLOSED&from=2026-03-01&to=2026-03-31&symbol=AAPL',
    );
  });

  it('sends the filters and can clear them', async () => {
    const calls = api(() => dashboard({ includesCashFlows: false }));
    renderApp('/dashboard');
    const bar = await screen.findByRole('search', { name: 'Dashboard filters' });
    fireEvent.change(within(bar).getByLabelText('Symbol'), { target: { value: 'aapl' } });
    fireEvent.change(within(bar).getByLabelText('Setup'), { target: { value: '1' } });
    fireEvent.change(within(bar).getByLabelText('Tag'), { target: { value: '3' } });
    fireEvent.change(within(bar).getByLabelText('From'), { target: { value: '2026-03-01' } });
    fireEvent.change(within(bar).getByLabelText('To'), { target: { value: '2026-03-31' } });
    await waitFor(() =>
      expect(
        Object.fromEntries(calls.filter((c) => c.path === '/api/dashboard').at(-1)?.query ?? []),
      ).toEqual({
        from: '2026-03-01',
        to: '2026-03-31',
        symbol: 'AAPL',
        setupTagId: '1',
        tagId: '3',
      }),
    );
    expect(screen.getByText(/Filtered view/)).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole('button', { name: 'Clear filters' }));
    await waitFor(() =>
      expect([...(calls.filter((c) => c.path === '/api/dashboard').at(-1)?.query ?? [])]).toEqual(
        [],
      ),
    );
  });

  it('explains empty data and a missing starting balance', async () => {
    const empty = dashboard({
      startingBalance: 0,
      benchmark: null,
      trades: [],
      monthly: [],
      equity: [],
      rCurve: { points: [], excluded: 0 },
    });
    empty.metrics = { ...empty.metrics, count: 0, rExcludedCount: 0 };
    api(() => empty);
    renderApp('/dashboard');
    expect(await screen.findByText(/No closed trades yet/)).toBeInTheDocument();
    expect(screen.getByText(/No starting balance is set/)).toBeInTheDocument();
    expect(screen.getByText(/No SPY prices yet/)).toBeInTheDocument();
    expect(within(region('MAE vs MFE')).getByText(/needs cached prices/)).toBeInTheDocument();
    expect(
      within(region('Monthly net P&L')).getByText('No closed trades for this filter.'),
    ).toBeInTheDocument();
  });
});
