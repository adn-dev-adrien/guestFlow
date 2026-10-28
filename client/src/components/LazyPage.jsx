/**
 * LazyPage — loads a page's code on demand, inside the shell (specs/inte-performance.md rules 2–3).
 *
 *   const ClientsPage = lazyPage(() => import('./pages/ClientsPage'));   // a core route element
 *   <LazyPage><PluginComponent /></LazyPage>                              // a plugin route (already React.lazy)
 *
 * While the chunk loads the page area shows `LoadingState`, only after 150 ms so a fast load flashes
 * nothing; the app bar and the menu never leave. A chunk that fails to load (a release installed while
 * the tab was open) reloads the page once — a `sessionStorage` flag stops any loop — then shows
 * `ErrorAlert` « Page indisponible. » with « Recharger ».
 *
 * Props of `LazyPage`: children (the lazy element, a core page or a plugin's). `lazyPage(loader)`
 * returns a component taking the page's own props.
 */
import React, { Suspense, lazy, useEffect, useState } from 'react';
import LoadingState from './LoadingState';
import ErrorAlert from './ErrorAlert';

const RELOADED_FLAG = 'guestflow.chunkReloaded';
const FALLBACK_DELAY_MS = 150;

const flag = {
  isSet: () => { try { return sessionStorage.getItem(RELOADED_FLAG) === '1'; } catch { return false; } },
  set: () => { try { sessionStorage.setItem(RELOADED_FLAG, '1'); } catch { /* storage blocked: the second failure still shows the error */ } },
  clear: () => { try { sessionStorage.removeItem(RELOADED_FLAG); } catch { /* nothing to clear */ } },
};

function DelayedLoading() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), FALLBACK_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  return visible ? <LoadingState /> : null;
}

// What a browser throws when a module chunk cannot be fetched: Chromium, Safari, Firefox, webpack-style.
const CHUNK_ERROR = /dynamically imported module|importing a module script failed|loading chunk|chunkloaderror/i;
const isChunkError = (error) => Boolean(error) && CHUNK_ERROR.test(`${error.name} ${error.message}`);

class ChunkBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, reloading: false };
  }

  static getDerivedStateFromError(error) {
    return { error, reloading: isChunkError(error) && !flag.isSet() };
  }

  componentDidCatch() {
    if (this.state.reloading) {
      flag.set();
      window.location.reload();
    }
  }

  render() {
    const { error, reloading } = this.state;
    if (!error) return this.props.children;
    if (!isChunkError(error)) throw error;
    if (reloading) return null;
    return <ErrorAlert message="Page indisponible." retryLabel="Recharger" onRetry={() => window.location.reload()} />;
  }
}

export default function LazyPage({ children }) {
  return (
    <ChunkBoundary>
      <Suspense fallback={<DelayedLoading />}>{children}</Suspense>
    </ChunkBoundary>
  );
}

export function lazyPage(loader) {
  const Page = lazy(() => loader().then((module) => { flag.clear(); return module; }));
  function LazyRoute(props) {
    return <LazyPage><Page {...props} /></LazyPage>;
  }
  return LazyRoute;
}
