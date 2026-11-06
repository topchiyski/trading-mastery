import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cashFlows, settings, tags } from '../__fixtures__/data';
import { fakeApi, renderApp } from '../__fixtures__/harness';

function api(health: () => unknown = () => ({ status: 'ok', app: 'x', time: 'now' })) {
  return fakeApi({
    'GET /api/health': health,
    'GET /api/cash-flows': () => ({ cashFlows }),
    'GET /api/tags': () => ({ tags }),
    'GET /api/settings': () => settings,
  });
}

describe('Layout and routing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('redirects / to the dashboard and shows the API status', async () => {
    api();
    const { router } = renderApp('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
    expect(await screen.findByText('API: ok')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toHaveTextContent('Missing stops');
  });

  it('reports an unreachable API', async () => {
    api(() => {
      throw { status: 500, error: { code: 'X', message: 'down' } };
    });
    renderApp('/cash-flows');
    expect(await screen.findByText('API: unreachable')).toBeInTheDocument();
  });

  it('opens a new trade with the "n" shortcut, but not while typing', async () => {
    api();
    const { router } = renderApp('/cash-flows');
    const note = await screen.findByLabelText('Note');
    fireEvent.keyDown(note, { key: 'n' });
    expect(router.state.location.pathname).toBe('/cash-flows');
    fireEvent.keyDown(document.body, { key: 'n', ctrlKey: true });
    expect(router.state.location.pathname).toBe('/cash-flows');
    fireEvent.keyDown(document.body, { key: 'n' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/trades/new'));
  });

  it('toggles and remembers dark mode', async () => {
    api();
    renderApp('/cash-flows');
    fireEvent.click(await screen.findByRole('button', { name: /Dark mode/ }));
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(localStorage.getItem('tj-theme')).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: /Light mode/ }));
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('shows a not-found page for unknown routes', async () => {
    api();
    renderApp('/nope');
    expect(await screen.findByText(/Page not found/)).toBeInTheDocument();
  });

  it('shows an error page instead of a blank screen when a page crashes', async () => {
    api();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // A malformed cash-flow list makes the page throw while rendering.
    fakeApi({
      'GET /api/health': () => ({ status: 'ok' }),
      'GET /api/cash-flows': () => ({
        cashFlows: [{ id: 1, type: 'DEPOSIT', amount: 'x', occurredAt: '2026-03-02' }],
      }),
    });
    renderApp('/cash-flows');
    expect(
      await screen.findByRole('heading', { name: 'Something went wrong' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reload the app' })).toBeInTheDocument();
  });
});
