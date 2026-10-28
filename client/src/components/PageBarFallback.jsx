/**
 * PageBarFallback — the Suspense fallback of a tab whose page loads on demand
 * (specs/ds-tabs.md rule 12). It draws the same bar the loaded tab will draw, so nothing moves when
 * the real bar mounts: title, tabs, and either the inert Save / Cancel pair (when the tab's page has
 * one) or an empty action-sized slot that holds the row's height without showing a wrong button.
 *
 * Props:
 *   title     string     the tab's title
 *   tabs      ReactNode  the wrapper's PageTabs
 *   withSave  boolean    the loaded tab's bar has Save / Cancel (default false)
 */
import React from 'react';
import Box from '@mui/material/Box';
import PageActionBar from './PageActionBar';

const noop = () => {};
const SLOT = [{ node: <Box aria-hidden sx={{ width: 44, height: 44 }} /> }];

export default function PageBarFallback({ title, tabs, withSave = false }) {
  if (withSave) {
    return <PageActionBar title={title} tabs={tabs} onSave={noop} saveDisabled onCancel={noop} cancelDisabled />;
  }
  return <PageActionBar title={title} tabs={tabs} actionsBefore={SLOT} />;
}
