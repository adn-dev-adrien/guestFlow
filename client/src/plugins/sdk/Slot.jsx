import React, { Suspense } from 'react';
import { useSlot } from './useSlot';

/**
 * Slot — renders, in place, what active plugins contributed to a named slot
 * (specs/plugins-phase-1-sdk.md rules 13-14). Each contribution is a lazily loaded component: a
 * plugin's code reaches the browser only when one of its slots renders. An inactive plugin leaves
 * nothing, not even an empty box.
 *
 * Props:
 *   name      string  the slot name, e.g. 'dashboard.alerts'
 *   ...props  passed to every contributed component
 */
export default function Slot({ name, ...props }) {
  const contributions = useSlot(name);
  if (contributions.length === 0) return null;
  return (
    <>
      {contributions.map(({ key, pluginId, Component }) => (
        <Suspense key={`${pluginId}:${key}`} fallback={null}>
          <Component {...props} />
        </Suspense>
      ))}
    </>
  );
}
