import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const M = 1_000_000;

test('settings: starting balance switches on % returns', async ({ page }) => {
  await page.goto('/settings');
  const form = page.getByRole('form', { name: 'Account settings' });
  await form.getByLabel('Starting balance (USD)').fill('25000');
  await form.getByLabel('Start date').fill('2026-01-02');
  await form.getByLabel('Break-even threshold (USD)').fill('1');
  await form.getByRole('button', { name: 'Save settings' }).click();
  await expect(form.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await expect(
    page.getByRole('form', { name: 'Account settings' }).getByLabel('Starting balance (USD)'),
  ).toHaveValue('25000.00');
  await page.getByRole('navigation').getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByTestId('kpi-net-pnl')).toBeVisible();
  await expect(page.getByText('No starting balance is set')).toHaveCount(0);
});

test('tags can be renamed and merged', async ({ page, request }) => {
  await request.post('/api/tags', { data: { name: 'Late entry', kind: 'MISTAKE' } });
  await request.post('/api/tags', { data: { name: 'FOMO entry', kind: 'MISTAKE' } });
  await page.goto('/settings');
  const tags = page.getByRole('region', { name: 'Tag management' });

  await tags.getByLabel('Name of Late entry').fill('Late entry (chased)');
  await tags.getByRole('button', { name: 'Rename' }).click();
  await expect(tags.getByLabel('Name of Late entry (chased)')).toBeVisible();

  await tags
    .getByLabel('Move FOMO entry into')
    .selectOption({ label: 'Merge into Late entry (chased)' });
  await tags.getByRole('button', { name: 'Merge tag FOMO entry' }).click();
  await tags.getByRole('button', { name: 'Confirm: Merge tag FOMO entry' }).click();
  await expect(tags.getByLabel('Name of FOMO entry')).toHaveCount(0);
});

test('dark mode toggles and persists', async ({ page }) => {
  await page.goto('/dashboard');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: /Dark mode/ }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: /Light mode/ }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
});

test('the "n" shortcut opens a new trade, but not while typing', async ({ page }) => {
  await page.goto('/trades');
  await page.getByLabel('Symbol').fill('n'); // typing in a field
  await expect(page).toHaveURL(/\/trades(\?.*)?$/);
  await page.getByRole('heading', { level: 1 }).click(); // leave the field
  await page.keyboard.press('n');
  await expect(page).toHaveURL(/\/trades\/new$/);
});

test('the trade list exports the filtered trades as CSV', async ({ page, request }) => {
  const res = await request.post('/api/trades', {
    data: {
      symbol: 'EXPQ',
      fill: { quantity: 3 * M, price: 20 * M, executedAt: '2026-05-04T15:00:00.000Z' },
    },
  });
  expect(res.ok()).toBe(true);
  await page.goto('/trades?symbol=EXPQ');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Export CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^trades-\d{8}\.csv$/);
  const text = readFileSync((await download.path())!, 'utf8');
  const lines = text.trim().split(/\r\n/);
  expect(lines[0]).toContain('symbol');
  expect(lines).toHaveLength(2);
  expect(lines[1]).toContain('EXPQ');
});

test('backup now, then restore brings deleted data back', async ({ page, request }) => {
  const created = await request.post('/api/trades', {
    data: {
      symbol: 'BKPQ',
      fill: { quantity: 2 * M, price: 30 * M, executedAt: '2026-05-05T15:00:00.000Z' },
    },
  });
  const trade = (await created.json()) as { id: number; executions: { id: number }[] };

  await page.goto('/settings');
  const card = page.getByRole('region', { name: 'Backups' });
  await card.getByRole('button', { name: 'Backup now' }).click();
  await expect(card.getByRole('status')).toContainText('Saved journal-');
  const name = ((await card.getByRole('status').textContent()) ?? '').replace('Saved ', '').trim();

  // Delete the trade (its only fill), then restore the backup.
  expect((await request.delete(`/api/executions/${trade.executions[0]!.id}`)).ok()).toBe(true);
  expect((await request.get(`/api/trades/${trade.id}`)).status()).toBe(404);

  await page.reload();
  const restore = page.getByRole('region', { name: 'Backups' });
  await restore.getByRole('button', { name: `Restore ${name}` }).click();
  await restore.getByRole('button', { name: `Confirm: Restore ${name}` }).click();
  await expect(restore.getByRole('status').filter({ hasText: 'Restored' })).toContainText(
    `Restored ${name}`,
  );

  await page.goto('/trades?symbol=BKPQ');
  await expect(page.getByRole('row', { name: /BKPQ/ })).toBeVisible();
});
