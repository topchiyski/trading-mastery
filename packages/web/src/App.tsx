import { useEffect, useState } from 'react';
import { APP_NAME, type HealthStatus } from '@tj/core';

type State =
  { kind: 'loading' } | { kind: 'ok'; health: HealthStatus } | { kind: 'error'; message: string };

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/health', { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setState({ kind: 'ok', health: (await res.json()) as HealthStatus });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
      });
    return () => ctrl.abort();
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>{APP_NAME}</h1>
      <p data-testid="api-status">
        {state.kind === 'loading' && 'API: checking…'}
        {state.kind === 'ok' && `API: ${state.health.status}`}
        {state.kind === 'error' && `API: unreachable (${state.message})`}
      </p>
    </main>
  );
}
