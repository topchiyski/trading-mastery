import { expect, test } from '@playwright/test';

// E2E runs with MARKET_DATA_PROVIDER=synthetic: deterministic offline prices, no network.
const M = 1_000_000;

let openId = 0;

test.beforeAll(async ({ request }) => {
  const open = await request.post('/api/trades', {
    data: {
      symbol: 'MKA',
      fill: { quantity: 10 * M, price: 100 * M, executedAt: '2026-10-01T15:00:00.000Z' },
      initialStop: 90 * M,
    },
  });
  expect(open.ok()).toBe(true);
  openId = ((await open.json()) as { id: number }).id;
  const closed = await request.post('/api/trades', {
    data: {
      symbol: 'MKB',
      fill: { quantity: 5 * M, price: 50 * M, executedAt: '2026-09-01T15:00:00.000Z' },
      initialStop: 45 * M,
    },
  });
  const { id } = (await closed.json()) as { id: number };
  await request.post(`/api/trades/${id}/fills`, {
    data: { side: 'SELL', quantity: 5 * M, price: 55 * M, executedAt: '2026-09-10T19:00:00.000Z' },
  });
});

test('open positions are valued at the last close, and prices can be fetched on demand', async ({
  page,
}) => {
  await page.goto('/positions');
  const card = page.getByRole('region', { name: 'Market data' });
  await expect(card).toContainText('synthetic');
  await card.getByRole('button', { name: 'Fetch prices now' }).click();
  await expect(card.getByTestId('pending-symbols')).toHaveText('all symbols up to date');

  const row = page.getByTestId('positions').getByRole('row', { name: /MKA/ });
  await expect(row).toBeVisible();
  const cells = row.getByRole('cell');
  await expect(cells.nth(3)).toHaveText(/^\$\d/); // last close
  await expect(cells.nth(4)).toHaveText(/\$\d/); // unrealised
  await expect(cells.nth(10)).toHaveText(/\$\d/); // open risk
  await expect(page.getByTestId('pos-open-risk-pct')).toContainText('%');
  await expect(page.getByText('last close', { exact: false }).first()).toBeVisible();
});

test('trade detail shows a candlestick chart with MAE/MFE', async ({ page }) => {
  await page.goto(`/trades/${openId}`);
  const chart = page.getByRole('region', { name: 'Price chart' });
  await expect(chart.getByRole('img', { name: 'Daily price chart of MKA' })).toBeVisible();
  await expect(chart.getByTestId('stat-mae')).toContainText('$');
  await expect(chart.getByTestId('stat-mfe')).toContainText('$');
  await expect(chart).toContainText('approximate');
});

test('the dashboard compares the portfolio with SPY once prices are cached', async ({ page }) => {
  await page.goto('/dashboard');
  const bench = page.getByRole('region', { name: 'Portfolio vs SPY' });
  await expect(bench.getByRole('img', { name: /indexed to 100/ })).toBeVisible();
  await expect(bench).toContainText('SPY');
});
