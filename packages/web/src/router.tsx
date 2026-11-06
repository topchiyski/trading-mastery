import {
  Link,
  Navigate,
  createBrowserRouter,
  isRouteErrorResponse,
  useRouteError,
  type RouteObject,
} from 'react-router';
import { Layout } from './components/Layout';
import { CashFlowsPage } from './pages/CashFlowsPage';
import { DashboardPage } from './pages/DashboardPage';
import { ImportPage } from './pages/ImportPage';
import { MissingStopsPage } from './pages/MissingStopsPage';
import { NewTradePage } from './pages/NewTradePage';
import { PositionsPage } from './pages/PositionsPage';
import { SettingsPage } from './pages/SettingsPage';
import { TradeDetailPage } from './pages/trade/TradeDetailPage';
import { TradesPage } from './pages/TradesPage';

function NotFound() {
  return (
    <div className="card empty">
      Page not found. <Link to="/dashboard">Go to the dashboard</Link>
    </div>
  );
}

/** Shown instead of a blank page if a page crashes while rendering. */
function ErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : String(error);
  return (
    <div className="main" role="alert">
      <h1>Something went wrong</h1>
      <p className="error-box">{message}</p>
      <p>
        Your data is safe. <a href="/dashboard">Reload the app</a>.
      </p>
    </div>
  );
}

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    errorElement: <ErrorPage />,
    children: [
      {
        errorElement: <ErrorPage />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'trades', element: <TradesPage /> },
          { path: 'trades/new', element: <NewTradePage /> },
          { path: 'trades/:id', element: <TradeDetailPage /> },
          { path: 'positions', element: <PositionsPage /> },
          { path: 'missing-stops', element: <MissingStopsPage /> },
          { path: 'cash-flows', element: <CashFlowsPage /> },
          { path: 'imports', element: <ImportPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
