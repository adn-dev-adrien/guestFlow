/**
 * LazySaleComponents — the sale blocks as the plugin SDK hands them out (specs/inte-performance.md rule 4, loop t19 A19-1).
 * The SDK is part of the initial bundle, so a static re-export made every first page pay for the sale screens of the
 * SAS and of the outside visit (« Vente hors séjour » alone was ~8 kB gzip, the three sections ~6 kB more). Each is
 * fetched the first time a plugin renders it, like the report charts (LazyReportCharts). Nothing shows while its code
 * arrives: they render inside a dialog that is already loading its own data.
 *
 * Exports, with exactly the props of the component they stand for:
 *   LazyStaySalesSection       → StaySalesSection
 *   LazySuggestedArticlesStep  → SuggestedArticlesStep
 *   LazySalePaymentLink        → SalePaymentLink
 *   LazyStandaloneSaleDialog   → StandaloneSaleDialog — fetched on its first `open`, then kept mounted so its closing
 *                                transition still plays
 */
import React, { Suspense, lazy, useState } from 'react';

const StaySalesSection = lazy(() => import('./StaySalesSection'));
const SuggestedArticlesStep = lazy(() => import('./SuggestedArticlesStep'));
const SalePaymentLink = lazy(() => import('./SalePaymentLink'));
const StandaloneSaleDialog = lazy(() => import('./StandaloneSaleDialog'));

export function LazyStaySalesSection(props) {
  return <Suspense fallback={null}><StaySalesSection {...props} /></Suspense>;
}

export function LazySuggestedArticlesStep(props) {
  return <Suspense fallback={null}><SuggestedArticlesStep {...props} /></Suspense>;
}

export function LazySalePaymentLink(props) {
  return <Suspense fallback={null}><SalePaymentLink {...props} /></Suspense>;
}

export function LazyStandaloneSaleDialog(props) {
  const [opened, setOpened] = useState(Boolean(props.open));
  if (props.open && !opened) setOpened(true);
  if (!opened) return null;
  return <Suspense fallback={null}><StandaloneSaleDialog {...props} /></Suspense>;
}
