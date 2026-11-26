/**
 * LazySaleComponents — the sale blocks as the plugin SDK hands them out (specs/plugins/plugins-phase-1-sdk.md rule 54, readings of
 * 2026-11-18; specs/tech/inte-performance.md rule 4, loop t19 A19-1). The SDK is part of the initial bundle, so a static re-export
 * made every first page pay for the sale screens of the SAS and of the outside visit (« Vente hors séjour » alone was ~8 kB
 * gzip, the three sections ~6 kB more). Their code is fetched apart, like the report charts (LazyReportCharts).
 *
 * A block that arrived after its dialog's own content pushed that content down (loop t20 UI20-1: +186 px in the visit
 * dialog). So a consumer starts the four imports when it opens, in parallel with its data, and shows its content once both
 * are there: `useSaleComponentsReady(open)` answers false until then, and its loading state covers the wait. A block whose
 * code is already loaded renders at once, without suspending (the `lazyPage` pattern, inte-performance rule 10).
 *
 * Exports, with exactly the props of the component they stand for:
 *   LazyStaySalesSection       → StaySalesSection
 *   LazySuggestedArticlesStep  → SuggestedArticlesStep
 *   LazySalePaymentLink        → SalePaymentLink
 *   LazyStandaloneSaleDialog   → StandaloneSaleDialog — mounted on its first `open`, then kept mounted so its closing
 *                                transition still plays
 * and
 *   preloadSaleComponents()       starts the four imports once for the whole session; always resolves (a failed import is
 *                                 tried again by the next call or render, which shows the error through the boundary)
 *   useSaleComponentsReady(active) true once the four are loaded, or their loading failed; starts them while `active`
 */
import React, { Suspense, lazy, useEffect, useState } from 'react';

function lazySale(loader) {
  let loading = null;
  let loaded = null;
  let gate = null;
  const preload = () => {
    if (!loading) {
      loading = (gate ? gate().then(loader) : loader()).then(
        (module) => { loaded = module; return module; },
        (error) => { loading = null; throw error; },
      );
    }
    return loading;
  };
  let Lazy = lazy(preload);
  function LazySale(props) {
    // Chosen once per mount: switching from the lazy element to the loaded one would remount the block and drop its state.
    const [Ready] = useState(() => (loaded ? loaded.default : null));
    if (Ready) return <Ready {...props} />;
    return <Suspense fallback={null}><Lazy {...props} /></Suspense>;
  }
  const forget = (arrive) => {
    loading = null;
    loaded = null;
    gate = arrive || null;
    Lazy = lazy(preload);
  };
  return { Component: LazySale, preload, isLoaded: () => Boolean(loaded), forget };
}

const blocks = {
  StaySalesSection: lazySale(() => import('./StaySalesSection')),
  SuggestedArticlesStep: lazySale(() => import('./SuggestedArticlesStep')),
  SalePaymentLink: lazySale(() => import('./SalePaymentLink')),
  StandaloneSaleDialog: lazySale(() => import('./StandaloneSaleDialog')),
};

export function preloadSaleComponents() {
  return Promise.all(Object.values(blocks).map((block) => block.preload().catch(() => null))).then(() => undefined);
}

export const saleComponentsLoaded = () => Object.values(blocks).every((block) => block.isLoaded());

export function useSaleComponentsReady(active) {
  const [ready, setReady] = useState(saleComponentsLoaded);
  useEffect(() => {
    if (!active || ready) return undefined;
    let live = true;
    preloadSaleComponents().then(() => { if (live) setReady(true); });
    return () => { live = false; };
  }, [active, ready]);
  return ready;
}

// Test seam only (specs/tech/server-test-isolation.md rule 23, reading of 2026-11-18, loop t23 UI23-1): forgets the four blocks' loaded code,
// so the next dialog meets it cold, and makes each block's next import wait for `arrive()` first. `setupLateSaleChunks.js` calls it
// before every client test, so every test — not only the first of its file — runs the late path. The app never calls it.
export function resetSaleComponentsForTests(arrive) {
  Object.values(blocks).forEach((block) => block.forget(arrive));
}

export const LazyStaySalesSection = blocks.StaySalesSection.Component;
export const LazySuggestedArticlesStep = blocks.SuggestedArticlesStep.Component;
export const LazySalePaymentLink = blocks.SalePaymentLink.Component;

const SaleDialog = blocks.StandaloneSaleDialog.Component;

export function LazyStandaloneSaleDialog(props) {
  const [opened, setOpened] = useState(Boolean(props.open));
  if (props.open && !opened) setOpened(true);
  if (!opened) return null;
  return <SaleDialog {...props} />;
}
