import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the API status from /api/health', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok', app: 'x', time: '2026-01-01T00:00:00Z' }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByText('API: ok')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.anything());
  });

  it('shows an error when the API is down', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    render(<App />);
    expect(await screen.findByText(/API: unreachable/)).toBeInTheDocument();
  });
});
