import { expect, test, type Page } from '@playwright/test';

// Smallest valid PNG (1×1).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function addFill(
  page: Page,
  f: {
    side: 'BUY' | 'SELL';
    date: string;
    time: string;
    qty: string;
    price: string;
    commission: string;
  },
) {
  const form = page.getByRole('form', { name: 'Add fill' });
  await form.getByLabel('Side').selectOption(f.side);
  await form.getByLabel('Date').fill(f.date);
  await form.getByLabel('Time (New York)').fill(f.time);
  await form.getByLabel('Shares').fill(f.qty);
  await form.getByLabel('Price').fill(f.price);
  await form.getByLabel('Commission').fill(f.commission);
  await form.getByRole('button', { name: 'Add fill' }).click();
}

test('journal a trade with a scale-out, notes, tags and a screenshot, then see the totals', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'New trade' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New trade' })).toBeVisible();

  // --- New trade: buy 100 AMD @ 50, $1 commission, stop 48, target 56.
  const form = page.getByRole('form', { name: 'New trade' });
  await form.getByLabel('Symbol').fill('amd'); // uppercased as you type
  await expect(form.getByLabel('Symbol')).toHaveValue('AMD');
  await form.getByLabel('Date').fill('2026-03-02');
  await form.getByLabel('Time (New York)').fill('10:00');
  await form.getByLabel('Shares').fill('100');
  await form.getByLabel('Price').fill('50');
  await form.getByLabel('Commission').fill('1');
  await form.getByLabel('Initial stop').fill('48');
  await form.getByLabel('Target').fill('56');
  await expect(form.getByTestId('risk-preview')).toContainText('$200.00'); // (50 − 48) × 100
  await expect(form.getByTestId('risk-preview')).toContainText('3.00'); // planned R:R
  await form.getByLabel('Thesis').fill('Breakout over 49.80 on volume');
  await form.getByRole('button', { name: 'Create trade' }).click();

  await expect(page).toHaveURL(/\/trades\/\d+$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('AMD');
  await expect(page.getByTestId('status')).toHaveText('Open');

  // --- Scale out in two sells: 60 @ 55 ($1), 40 @ 53.80 ($0).
  await addFill(page, {
    side: 'SELL',
    date: '2026-03-04',
    time: '15:30',
    qty: '60',
    price: '55',
    commission: '1',
  });
  await expect(page.getByTestId('fills').getByRole('row')).toHaveCount(3); // header + 2 fills
  await addFill(page, {
    side: 'SELL',
    date: '2026-03-05',
    time: '14:00',
    qty: '40',
    price: '53.80',
    commission: '0',
  });
  await expect(page.getByTestId('status')).toHaveText('Closed');

  // Proceeds 3,300 + 2,152 = 5,452; cost 5,000 -> gross 452; fees 2 -> net 450; R 450/200 = 2.25.
  await expect(page.getByTestId('stat-net-pnl')).toContainText('$450.00');
  await expect(page.getByTestId('stat-r')).toContainText('2.25R');
  await expect(page.getByTestId('stat-return')).toContainText('9.00%');
  await expect(page.getByTestId('stat-avg-exit')).toContainText('$54.52');

  // --- Notes.
  const journal = page.getByRole('form', { name: 'Journal' });
  await journal.getByLabel('Review').fill('Took a partial at 55; the rest faded. Plan followed.');
  await journal.getByLabel('Emotion').fill('calm');
  await journal.getByLabel('Execution rating').selectOption('4');
  await journal.getByLabel('Followed plan').check();
  await journal.getByRole('button', { name: 'Save journal' }).click();
  await expect(journal.getByRole('status')).toHaveText('Saved');

  // --- Tags: create a mistake tag inline and attach it.
  const tags = page.getByRole('region', { name: 'Tags' });
  await tags.getByLabel('New tag').fill('Early exit');
  await tags.getByLabel('Kind').selectOption('MISTAKE');
  await tags.getByRole('button', { name: 'Add tag' }).click();
  await expect(tags.getByRole('listitem').filter({ hasText: 'Early exit' })).toBeVisible();

  // --- Screenshot upload, then open it in the lightbox.
  const shots = page.getByRole('region', { name: 'Screenshots' });
  await shots.getByLabel('Caption').fill('Daily chart at exit');
  await shots.getByLabel('Upload screenshot').setInputFiles({
    name: 'chart.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  const thumb = shots.getByRole('button', { name: /Daily chart at exit/ });
  await expect(thumb).toBeVisible();
  await thumb.click();
  const lightbox = page.getByRole('dialog', { name: 'Screenshot' });
  await expect(lightbox).toBeVisible();
  await expect(lightbox.getByRole('img')).toHaveAttribute('src', /\/api\/screenshots\/\d+\/file/);
  await page.keyboard.press('Escape');
  await expect(lightbox).toBeHidden();

  // --- Everything persisted: reload the page.
  await page.reload();
  await expect(page.getByRole('form', { name: 'Journal' }).getByLabel('Review')).toHaveValue(
    /Took a partial/,
  );
  await expect(page.getByRole('region', { name: 'Tags' }).getByRole('listitem')).toContainText([
    'Early exit',
  ]);

  // --- Trade list shows the right numbers and totals.
  await page.getByRole('link', { name: 'Trades' }).click();
  await page.getByLabel('Symbol').fill('AMD');
  const row = page.getByRole('row', { name: /AMD/ });
  await expect(row).toContainText('$450.00');
  await expect(row).toContainText('2.25R');
  await expect(row).toContainText('9.00%');
  await expect(row).toContainText('100'); // size
  const totals = page.getByTestId('totals');
  await expect(totals).toContainText('1 trade');
  await expect(totals).toContainText('$450.00');
});

test('inline validation blocks a stop above entry and an oversized sell', async ({ page }) => {
  await page.goto('/trades/new');
  const form = page.getByRole('form', { name: 'New trade' });
  await form.getByLabel('Symbol').fill('MSFT');
  await form.getByLabel('Date').fill('2026-03-02');
  await form.getByLabel('Time (New York)').fill('10:00');
  await form.getByLabel('Shares').fill('10');
  await form.getByLabel('Price').fill('400');
  await form.getByLabel('Initial stop').fill('410');
  await expect(form.getByText('Stop must be below the entry price')).toBeVisible();
  await expect(form.getByRole('button', { name: 'Create trade' })).toBeDisabled();
  await form.getByLabel('Initial stop').fill('390');
  await form.getByRole('button', { name: 'Create trade' }).click();
  await expect(page).toHaveURL(/\/trades\/\d+$/);

  const fill = page.getByRole('form', { name: 'Add fill' });
  await fill.getByLabel('Side').selectOption('SELL');
  await fill.getByLabel('Shares').fill('11');
  await expect(fill.getByText('Only 10 shares are open')).toBeVisible();
  await expect(fill.getByRole('button', { name: 'Add fill' })).toBeDisabled();
});

test('cash flows can be recorded', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Cash flows' }).click();
  const form = page.getByRole('form', { name: 'Add cash flow' });
  await form.getByLabel('Type').selectOption('DEPOSIT');
  await form.getByLabel('Date').fill('2026-03-02');
  await form.getByLabel('Amount').fill('10000');
  await form.getByLabel('Note').fill('Initial funding');
  await form.getByRole('button', { name: 'Add' }).click();
  await form.getByLabel('Type').selectOption('WITHDRAWAL');
  await form.getByLabel('Date').fill('2026-04-01');
  await form.getByLabel('Amount').fill('500');
  await form.getByRole('button', { name: 'Add' }).click();
  const table = page.getByTestId('cash-flows');
  await expect(table.getByRole('row', { name: /Initial funding/ })).toContainText('$10,000.00');
  await expect(table.getByRole('row', { name: /Withdrawal/ })).toContainText('-$500.00');
  await expect(page.getByTestId('cash-flow-net')).toContainText('$9,500.00');
});
