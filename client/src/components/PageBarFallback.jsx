/**
 * PageBarFallback — the Suspense fallback of a tab whose page loads on demand
 * (specs/ds-tabs.md rule 12). It draws the same bar the loaded tab will draw — title, tabs and the
 * Save / Cancel slots, inert — so nothing moves when the real bar mounts.
 *
 * Props:
 *   title  string     the tab's title
 *   tabs   ReactNode  the wrapper's PageTabs
 */
import React from 'react';
import PageActionBar from './PageActionBar';

const noop = () => {};

export default function PageBarFallback({ title, tabs }) {
  return <PageActionBar title={title} tabs={tabs} onSave={noop} saveDisabled onCancel={noop} cancelDisabled />;
}
