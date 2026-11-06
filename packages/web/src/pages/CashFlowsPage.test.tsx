import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { M, cashFlows } from '../__fixtures__/data';
import { apiError, fakeApi, renderApp } from '../__fixtures__/harness';

describe('CashFlowsPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists cash flows with the net total and adds flows with the right sign', async () => {
    const calls = fakeApi({
      'GET /api/health': () => ({ status: 'ok' }),
      'GET /api/cash-flows': () => ({ cashFlows }),
      'POST /api/cash-flows': (c) => ({ id: 3, ...(c.body as object) }),
      'DELETE /api/cash-flows/:id': () => undefined,
    });
    renderApp('/cash-flows');
    const table = await screen.findByTestId('cash-flows');
    expect(within(table).getByRole('row', { name: /Initial funding/ })).toHaveTextContent(
      '$10,000.00',
    );
    expect(within(table).getByRole('row', { name: /Dividend/ })).toHaveTextContent('2026-03-26');
    expect(screen.getByTestId('cash-flow-net')).toHaveTextContent('$10,012.45');
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute(
      'href',
      '/api/export/cash-flows.csv',
    );

    const form = screen.getByRole('form', { name: 'Add cash flow' });
    fireEvent.change(within(form).getByLabelText('Type'), { target: { value: 'WITHDRAWAL' } });
    expect(within(form).getByText('Recorded as money out')).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText('Date'), { target: { value: '2026-04-01' } });
    fireEvent.change(within(form).getByLabelText('Amount'), { target: { value: '500' } });
    fireEvent.change(within(form).getByLabelText('Note'), { target: { value: 'Taxes' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
        type: 'WITHDRAWAL',
        amount: -500 * M,
        occurredAt: '2026-04-01',
        note: 'Taxes',
      }),
    );
    expect(within(form).getByLabelText('Amount')).toHaveValue('');

    fireEvent.click(within(table).getByRole('button', { name: 'Delete cash flow 1' }));
    fireEvent.click(within(table).getByRole('button', { name: 'Confirm: Delete cash flow 1' }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'DELETE' && c.path === '/api/cash-flows/1')).toBe(true),
    );
  });

  it('validates the amount and restores the form when saving fails', async () => {
    fakeApi({
      'GET /api/health': () => ({ status: 'ok' }),
      'GET /api/cash-flows': () => ({ cashFlows: [] }),
      'POST /api/cash-flows': () => {
        throw apiError(400, 'VALIDATION_ERROR', 'A deposit must be positive');
      },
    });
    renderApp('/cash-flows');
    expect(await screen.findByText('No cash flows recorded.')).toBeInTheDocument();
    const form = screen.getByRole('form', { name: 'Add cash flow' });
    fireEvent.click(within(form).getByRole('button', { name: 'Add' }));
    expect(within(form).getByText('Enter a positive amount')).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText('Amount'), { target: { value: 'abc' } });
    expect(within(form).getByText('Enter a number')).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText('Amount'), { target: { value: '100' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('A deposit must be positive');
    expect(within(form).getByLabelText('Amount')).toHaveValue('100');
  });
});
