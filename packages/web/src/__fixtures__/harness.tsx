// Test-only: render the real app routes against a fake API (no server, no network).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { vi } from 'vitest';
import { routes } from '../router';

export interface ApiCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

type Handler = (call: ApiCall, params: Record<string, string>) => unknown;

/** `{ 'GET /api/trades/:id': handler }`. A thrown `{ status, error }` becomes an error response. */
export function fakeApi(handlers: Record<string, Handler>) {
  const calls: ApiCall[] = [];
  const table = Object.entries(handlers).map(([key, fn]) => {
    const [method, pattern = ''] = key.split(' ');
    const names: string[] = [];
    const re = new RegExp(
      `^${pattern.replace(/:[a-zA-Z]+/g, (m) => {
        names.push(m.slice(1));
        return '([^/]+)';
      })}$`,
    );
    return { method, re, names, fn };
  });
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'http://localhost');
    const method = init?.method ?? 'GET';
    const body =
      init?.body instanceof FormData
        ? init.body
        : init?.body
          ? JSON.parse(String(init.body))
          : undefined;
    const call: ApiCall = { method, path: url.pathname, query: url.searchParams, body };
    calls.push(call);
    for (const h of table) {
      const m = h.method === method ? h.re.exec(url.pathname) : null;
      if (!m) continue;
      const params = Object.fromEntries(
        h.names.map((n, i) => [n, decodeURIComponent(m[i + 1] ?? '')]),
      );
      try {
        const result = await h.fn(call, params);
        if (result === undefined) return new Response(null, { status: 204 });
        return new Response(JSON.stringify(result), { status: method === 'POST' ? 201 : 200 });
      } catch (err) {
        const e = err as { status?: number; error?: unknown };
        if (e.status) return new Response(JSON.stringify({ error: e.error }), { status: e.status });
        throw err;
      }
    }
    return new Response(
      JSON.stringify({ error: { code: 'NOT_FOUND', message: `${method} ${url.pathname}` } }),
      {
        status: 404,
      },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

/** An API error to throw from a handler. */
export const apiError = (status: number, code: string, message: string, details?: unknown) => ({
  status,
  error: { code, message, details },
});

/** Render the app at `path` with the real router. */
export function renderApp(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const utils = render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, router };
}
