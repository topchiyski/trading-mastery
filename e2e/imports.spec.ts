import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const fixture = (name: string) =>
  fileURLToPath(new URL(`../packages/server/src/import/__fixtures__/${name}`, import.meta.url));

async function previewFile(page: Page, source: 'IBKR_ACTIVITY' | 'CSV', file: string) {
  await page.goto('/imports');
  const form = page.getByRole('region', { name: 'Import a file' });
  await form.getByLabel('Source').selectOption(source);
  await form.getByLabel('File').setInputFiles(file);
  await form.getByRole('button', { name: 'Preview' }).click();
  return page.getByRole('region', { name: 'Import preview' });
}

const stat = (page: Page, label: string) =>
  page.getByTestId('import-summary').locator('.stat', { hasText: label }).locator('.value');

async function undo(page: Page, id: string) {
  const history = page.getByTestId('import-history');
  await history.getByRole('button', { name: `Undo import ${id}` }).click();
  await history.getByRole('button', { name: `Confirm: Undo import ${id}` }).click();
  await expect(history.getByRole('row', { name: new RegExp(`^${id} `) })).toContainText('Undone');
}

test('IBKR statement: preview, commit, re-import adds nothing, undo', async ({ page }) => {
  const preview = await previewFile(page, 'IBKR_ACTIVITY', fixture('ibkr-activity.csv'));
  await expect(stat(page, 'New fills')).toHaveText('10');
  await expect(stat(page, 'New cash items')).toHaveText('8');
  await expect(stat(page, 'Skipped')).toHaveText('7');
  await expect(stat(page, 'Problems')).toHaveText('0');
  await expect(
    preview.getByRole('table', { name: 'Trades affected' }).getByRole('row'),
  ).toHaveCount(6); // header + 5
  await expect(preview.getByRole('table', { name: 'Rows not imported' })).toContainText(
    'Non-USD (HKD)',
  );

  await preview.getByRole('button', { name: 'Commit import (18 rows)' }).click();
  await expect(page.getByRole('status', { name: 'Import result' })).toContainText(
    'Imported 18 rows',
  );
  const firstId = (await page
    .getByTestId('import-history')
    .getByRole('row')
    .nth(1)
    .locator('td')
    .first()
    .textContent())!;

  // Trades are in the list with the statement's numbers.
  await page.getByRole('navigation').getByRole('link', { name: 'Trades' }).click();
  await page.getByLabel('Symbol').fill('MSFT');
  await expect(
    page.getByRole('row', { name: /MSFT/ }).filter({ hasText: '2026-03-10' }),
  ).toContainText('$246.93');

  // The same file again: flagged, and nothing new to add.
  const again = await previewFile(page, 'IBKR_ACTIVITY', fixture('ibkr-activity.csv'));
  await expect(again.getByRole('alert').filter({ hasText: 'already imported' })).toBeVisible();
  await expect(stat(page, 'New fills')).toHaveText('0');
  await expect(stat(page, 'Already imported')).toHaveText('18');
  const commit = again.getByRole('button', { name: 'Commit import' });
  await expect(commit).toBeDisabled();
  await again.getByLabel(/Import anyway/).check();
  await commit.click();
  await expect(page.getByRole('status', { name: 'Import result' })).toContainText(
    'Imported 0 rows',
  );

  // Undo both imports; the trades disappear.
  const history = page.getByTestId('import-history');
  await expect(history.getByRole('row')).toHaveCount(3);
  const secondId = (await history.getByRole('row').nth(1).locator('td').first().textContent())!;
  await undo(page, secondId);
  await undo(page, firstId);
  await page.getByRole('navigation').getByRole('link', { name: 'Trades' }).click();
  await page.getByLabel('Symbol').fill('NVDA');
  await expect(page.getByText('No trades match these filters.')).toBeVisible();
});

test('generic CSV: columns are mapped from the header, problem rows are listed', async ({
  page,
}) => {
  await page.goto('/imports');
  const form = page.getByRole('region', { name: 'Import a file' });
  await form.getByLabel('Source').selectOption('CSV');
  await form.getByLabel('File').setInputFiles(fixture('generic.csv'));
  // The mapping is guessed from the header row.
  await expect(form.getByLabel('Symbol *')).toHaveValue('Ticker');
  await expect(form.getByLabel('Date format')).toHaveValue('MM/DD/YYYY');
  await form.getByRole('button', { name: 'Preview' }).click();
  const preview = page.getByRole('region', { name: 'Import preview' });
  await expect(stat(page, 'New fills')).toHaveText('5');
  await expect(preview.getByRole('table', { name: 'Rows not imported' })).toContainText(
    'Unknown side "Dividend"',
  );
  await preview.getByRole('button', { name: /Commit import/ }).click();
  await expect(page.getByRole('status', { name: 'Import result' })).toContainText(
    'Imported 5 rows',
  );
  const id = (await page
    .getByTestId('import-history')
    .getByRole('row')
    .nth(1)
    .locator('td')
    .first()
    .textContent())!;
  await undo(page, id);
});
