import { expect, test, type APIRequestContext } from '@playwright/test';

const M = 1_000_000; // micros / micro-shares

async function closedTrade(
  request: APIRequestContext,
  symbol: string,
  entry: { day: string; price: number },
  exit: { day: string; price: number },
  stop: number,
) {
  const res = await request.post('/api/trades', {
    data: {
      symbol,
      fill: { quantity: 10 * M, price: entry.price * M, executedAt: `${entry.day}T15:00:00.000Z` },
      initialStop: stop * M,
    },
  });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: number };
  const sell = await request.post(`/api/trades/${id}/fills`, {
    data: {
      side: 'SELL',
      quantity: 10 * M,
      price: exit.price * M,
      executedAt: `${exit.day}T19:00:00.000Z`,
    },
  });
  expect(sell.ok()).toBe(true);
}

test.beforeAll(async ({ request }) => {
  // DSA: +$100, 2R. DSB: −$50.
  await closedTrade(
    request,
    'DSA',
    { day: '2026-02-02', price: 100 },
    { day: '2026-02-05', price: 110 },
    95,
  );
  await closedTrade(
    request,
    'DSB',
    { day: '2026-02-09', price: 100 },
    { day: '2026-02-11', price: 95 },
    97,
  );
});

test('applying a filter changes the KPIs', async ({ page }) => {
  await page.goto('/dashboard');
  const filters = page.getByRole('search', { name: 'Dashboard filters' });
  const trades = page.getByTestId('kpi-trades');
  await expect(trades).not.toContainText('—');
  const allCount = Number((await trades.locator('.value').textContent()) ?? '0');
  expect(allCount).toBeGreaterThanOrEqual(2);

  await filters.getByLabel('Symbol').fill('DSA');
  await expect(trades.locator('.value')).toHaveText('1');
  await expect(page.getByTestId('kpi-net-pnl')).toContainText('$100.00');
  await expect(page.getByTestId('kpi-win-rate')).toContainText('100.0%');
  await expect(page.getByTestId('kpi-expectancy-r')).toContainText('2.00R');
  await expect(page).toHaveURL(/symbol=DSA/);

  await filters.getByLabel('Symbol').fill('DSB');
  await expect(page.getByTestId('kpi-net-pnl')).toContainText('-$50.00');
  await expect(page.getByTestId('kpi-win-rate')).toContainText('0.0%');

  await filters.getByRole('button', { name: 'Clear filters' }).click();
  await expect(trades.locator('.value')).toHaveText(String(allCount));
});

test('KPI tiles explain themselves and a heatmap month opens its trades', async ({ page }) => {
  await page.goto('/dashboard?symbol=DSA');
  await expect(page.getByTestId('kpi-win-rate')).toHaveAttribute(
    'title',
    /wins ÷ \(wins \+ losses\)/i,
  );
  await page.getByRole('gridcell', { name: /Feb 2026: \$100\.00, 1 trade/ }).click();
  await expect(page).toHaveURL(/\/trades\?status=CLOSED&from=2026-02-01&to=2026-02-28&symbol=DSA/);
  await expect(page.getByRole('row', { name: /DSA/ })).toBeVisible();
});
