import { expect, test } from '@playwright/test';

test('app shell loads the dashboard and reaches the API', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('navigation')).toContainText('Swing Trade Journal');
  await expect(page.getByTestId('api-status')).toHaveText('API: ok');
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
});
