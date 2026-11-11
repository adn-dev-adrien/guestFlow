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
 * returns a component taking the page's own props, with `.preload()` to start its import early
 * (specs/inte-performance.md rule 10).
 */
import React, { Suspense, lazy, useEffect, useState } from 'react';
import LoadingState from './LoadingState';
import ErrorAlert from './ErrorAlert';

const RELOADED_FLAG = 'guestflow.chunkReloaded';
const FALLBACK_DELAY_MS = 150;

// The route whose chunk failed and was reloaded once. It is cleared only when THAT route renders: a
// prefetch of another page that succeeds says nothing about the one that keeps failing.
const flag = {
  get: () => { try { return sessionStorage.getItem(RELOADED_FLAG); } catch { return null; } },
  set: (route) => { try { sessionStorage.setItem(RELOADED_FLAG, route); } catch { /* storage blocked: the second failure still shows the error */ } },
  clear: (route) => { try { if (sessionStorage.getItem(RELOADED_FLAG) === route) sessionStorage.removeItem(RELOADED_FLAG); } catch { /* nothing to clear */ } },
};
const currentRoute = () => window.location.pathname;

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
    return { error, reloading: isChunkError(error) && flag.get() !== currentRoute() };
  }

  componentDidCatch() {
    if (this.state.reloading) {
      flag.set(currentRoute());
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

// Commits only once the page under the same boundary has rendered: the route is then known to load.
function RouteLoaded() {
  useEffect(() => { flag.clear(currentRoute()); }, []);
  return null;
}

export default function LazyPage({ children }) {
  return (
    <ChunkBoundary>
      <Suspense fallback={<DelayedLoading />}><RouteLoaded />{children}</Suspense>
    </ChunkBoundary>
  );
}

export function lazyPage(loader) {
  let loading = null;
  let loaded = null;
  // One import for the whole life of the page: the boot preload, the idle prefetch and React.lazy share it.
  const preload = () => {
    if (!loading) loading = loader().then((module) => { loaded = module; return module; });
    return loading;
  };
  const Lazy = lazy(preload);
  function LazyRoute(props) {
    // A chunk already loaded renders at once: going through React.lazy would suspend once more and React
    // holds back a boundary that showed a fallback for 300 ms, which is what the preload is meant to avoid.
    const [Page] = useState(() => (loaded ? loaded.default : Lazy));
    return <LazyPage><Page {...props} /></LazyPage>;
  }
  LazyRoute.preload = () => preload().catch(() => { loading = null; });
  return LazyRoute;
}
