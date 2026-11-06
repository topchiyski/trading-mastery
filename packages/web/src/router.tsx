import { Link, Navigate, createBrowserRouter, type RouteObject } from 'react-router';
import { Layout } from './components/Layout';
import { CashFlowsPage } from './pages/CashFlowsPage';
import { DashboardPage } from './pages/DashboardPage';
import { ImportPage } from './pages/ImportPage';
import { NewTradePage } from './pages/NewTradePage';
import { TradeDetailPage } from './pages/trade/TradeDetailPage';
import { TradesPage } from './pages/TradesPage';

function NotFound() {
  return (
    <div className="card empty">
      Page not found. <Link to="/trades">Go to trades</Link>
    </div>
  );
}

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'trades', element: <TradesPage /> },
      { path: 'trades/new', element: <NewTradePage /> },
      { path: 'trades/:id', element: <TradeDetailPage /> },
      { path: 'cash-flows', element: <CashFlowsPage /> },
      { path: 'imports', element: <ImportPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
