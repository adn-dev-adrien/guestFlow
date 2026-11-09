/**
 * « Mon séjour » — the guest app (specs/guest-app.md). The `.app` root carries the register's tokens
 * (`theme.js`) and the layout classes (rule 51); the routes are the screens of §6.6.
 */
import { useEffect, useMemo } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { cssVars, muiTheme } from './theme';
import { LangContext } from './i18n';
import { SessionProvider, useModules, useSession } from './hooks/useSession';
import { CartProvider } from './hooks/useCart';
import { useLayout } from './hooks/useLayout';
import { ToastProvider } from './components/Toast';
import AppShell from './components/AppShell';
import HomePage from './pages/HomePage';
import BookletScreen from './pages/BookletPages';
import ShopPage from './pages/ShopPage';
import CartPage from './pages/CartPage';
import SlotPickerPage from './pages/SlotPickerPage';
import { OrderPage, OrdersPage } from './pages/OrdersPages';
import LookupPage from './pages/LookupPage';
import SoliomapPage from './pages/SoliomapPage';
import EntryPage from './pages/EntryPage';
import { FailedScreen, UnavailableScreen, UnknownCodeScreen } from './pages/GateScreens';

/** Rule 11bis — a screen of a module the lodging does not show is not reachable: home instead. */
function Guard({ module, children }) {
  const { has } = useModules();
  return has(module) ? children : <Navigate to="/" replace />;
}

function Screens() {
  const session = useSession();
  const { pathname } = useLocation();
  if (pathname.startsWith('/s/')) return <Routes><Route path="/s/:token" element={<EntryPage kind="stay" />} /></Routes>;
  if (pathname.startsWith('/l/')) return <Routes><Route path="/l/:code" element={<EntryPage kind="lodging" />} /></Routes>;
  if (pathname === '/retrouver' && session.status !== 'inactive') return <LookupPage />;
  if (session.status === 'loading' && !session.me) return <EntryPage kind="none" />;
  if (session.status === 'inactive') return <UnavailableScreen />;
  if (session.status === 'unknown') return <UnknownCodeScreen />;
  if (!session.me) return <FailedScreen error={session.error} onRetry={session.reload} />;
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/livret" element={<Guard module="booklet"><BookletScreen /></Guard>} />
      <Route path="/livret/:slug" element={<Guard module="booklet"><BookletScreen /></Guard>} />
      <Route path="/boutique" element={<Guard module="shop"><ShopPage /></Guard>} />
      <Route path="/boutique/bain" element={<Guard module="shop"><SlotPickerPage /></Guard>} />
      <Route path="/boutique/bain/:id" element={<Guard module="shop"><SlotPickerPage /></Guard>} />
      <Route path="/panier" element={<Guard module="shop"><CartPage /></Guard>} />
      <Route path="/commandes" element={<Guard module="orders"><OrdersPage /></Guard>} />
      <Route path="/commandes/:id" element={<OrderPage />} />
      <Route path="/commande/:id" element={<OrderPage />} />
      <Route path="/activites" element={<Guard module="soliomap"><SoliomapPage /></Guard>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Root() {
  const session = useSession();
  const layout = useLayout();
  const register = session.night ? 'night' : 'day';
  const theme = useMemo(() => muiTheme(register), [register]);
  const vars = useMemo(() => cssVars(register), [register]);
  const { pathname } = useLocation();
  const bare = !session.me || pathname.startsWith('/s/') || pathname.startsWith('/l/') || pathname === '/retrouver';

  useEffect(() => { document.documentElement.lang = session.lang; }, [session.lang]);
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', vars['--paper']);
  }, [vars]);

  const cls = ['app', session.night ? 'night' : '', layout.wide ? 'wide' : '', layout.desk ? 'desk' : ''].filter(Boolean).join(' ');
  return (
    <LangContext.Provider value={session.lang}>
      <ThemeProvider theme={theme}>
        <div className={cls} style={vars} lang={session.lang}>
          <ToastProvider>
            {bare ? <div className="shell"><main className="main"><Screens /></main></div> : (
              <AppShell layout={layout} appName={session.me && session.me.appName}>
                <Screens />
              </AppShell>
            )}
          </ToastProvider>
        </div>
      </ThemeProvider>
    </LangContext.Provider>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <CartProvider>
        <Root />
      </CartProvider>
    </SessionProvider>
  );
}
