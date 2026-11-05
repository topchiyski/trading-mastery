import { useQuery } from '@tanstack/react-query';
import { APP_NAME, type HealthStatus } from '@tj/core';
import { NavLink, Outlet } from 'react-router';
import { api } from '../api/client';

function ApiStatus() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthStatus>('/api/health'),
    refetchInterval: 30_000,
    retry: false,
  });
  return (
    <span data-testid="api-status">
      {health.isPending
        ? 'API: checking…'
        : health.isError
          ? 'API: unreachable'
          : `API: ${health.data.status}`}
    </span>
  );
}

export function Layout() {
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">{APP_NAME}</div>
        <NavLink to="/trades/new" className="cta">
          New trade
        </NavLink>
        <NavLink to="/trades" end>
          Trades
        </NavLink>
        <NavLink to="/cash-flows">Cash flows</NavLink>
        <div className="sidebar-footer">
          <ApiStatus />
        </div>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
