import { expect, test } from '@playwright/test';

test('app shell loads and reaches the API', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation')).toContainText('Swing Trade Journal');
  await expect(page.getByTestId('api-status')).toHaveText('API: ok');
  await expect(page.getByRole('heading', { level: 1, name: 'Trades' })).toBeVisible();
});
