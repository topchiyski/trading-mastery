import { expect, test } from '@playwright/test';

const M = 1_000_000;

test('missing stops: add a stop inline and the trade gets an R-multiple', async ({
  page,
  request,
}) => {
  // A closed trade without a stop: buy 10 @ 40, sell 10 @ 46 -> +$60.
  const res = await request.post('/api/trades', {
    data: {
      symbol: 'MSQ',
      fill: { quantity: 10 * M, price: 40 * M, executedAt: '2026-06-01T15:00:00.000Z' },
    },
  });
  expect(res.ok()).toBe(true);
  const { id } = (await res.json()) as { id: number };
  await request.post(`/api/trades/${id}/fills`, {
    data: { side: 'SELL', quantity: 10 * M, price: 46 * M, executedAt: '2026-06-03T19:00:00.000Z' },
  });

  await page.goto('/dashboard');
  await page.getByRole('navigation').getByRole('link', { name: 'Missing stops' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Missing stops' })).toBeVisible();

  const row = page.getByTestId('missing-stops').getByRole('row', { name: /MSQ/ });
  const input = row.getByLabel('Initial stop for MSQ');
  const save = row.getByRole('button', { name: 'Save stop for MSQ' });

  // A stop at the entry is rejected before anything is sent.
  await input.fill('40');
  await expect(row.getByText('Must be below the first entry ($40.00)')).toBeVisible();
  await expect(save).toBeDisabled();

  // Risk (40 − 37) × 10 = $30, so +$60 is 2R.
  await input.fill('37');
  await input.press('Enter');
  await expect(
    page.getByRole('status').filter({ hasText: 'Saved the stop for MSQ' }),
  ).toBeVisible();
  await expect(page.getByTestId('missing-stops').getByRole('row', { name: /MSQ/ })).toHaveCount(0);

  await page.goto(`/trades/${id}`);
  await expect(page.getByTestId('stat-r')).toContainText('2.00R');
  await expect(page.getByRole('form', { name: 'Journal' }).getByLabel('Initial stop')).toHaveValue(
    '37',
  );
});
