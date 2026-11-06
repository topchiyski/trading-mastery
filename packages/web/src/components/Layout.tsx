import { useQuery } from '@tanstack/react-query';
import { APP_NAME, type HealthStatus } from '@tj/core';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';
import { api } from '../api/client';
import {
  THEME_KEY,
  applyTheme,
  currentTheme,
  isNewTradeShortcut,
  type Theme,
} from '../lib/shortcuts';

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

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="small"
      aria-pressed={theme === 'dark'}
      onClick={() => {
        localStorage.setItem(THEME_KEY, next);
        applyTheme(next);
        setTheme(next);
      }}
    >
      {theme === 'dark' ? '☀ Light mode' : '☾ Dark mode'}
    </button>
  );
}

export function Layout() {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isNewTradeShortcut(e)) {
        e.preventDefault();
        void navigate('/trades/new');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">{APP_NAME}</div>
        <NavLink
          to="/trades/new"
          className="cta"
          title="Keyboard shortcut: n"
          aria-keyshortcuts="n"
        >
          New trade <kbd>n</kbd>
        </NavLink>
        <NavLink to="/dashboard">Dashboard</NavLink>
        <NavLink to="/trades" end>
          Trades
        </NavLink>
        <NavLink to="/positions">Positions</NavLink>
        <NavLink to="/cash-flows">Cash flows</NavLink>
        <NavLink to="/imports">Import</NavLink>
        <NavLink to="/settings">Settings</NavLink>
        <div className="sidebar-footer stack" style={{ gap: 8 }}>
          <ThemeToggle />
          <ApiStatus />
        </div>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
