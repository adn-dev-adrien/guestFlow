import React from 'react';
import { Stack } from '@mui/material';
import CollapsibleSection from '../CollapsibleSection';
import OptionRow from './OptionRow';

/**
 * One option category on the reservation form (specs/option-categories.md §3 rules 8-11).
 *
 * The point of the component is the *pinned* slice: options that are enabled on this reservation
 * render OUTSIDE the collapse, so folding a category can never hide a line the guest is being
 * billed for. Only the untouched remainder folds away.
 *
 * Props:
 *  - `category`  (string)   The label, as stored on the options.
 *  - `enabled`   (array)    Options currently enabled — always visible, rendered first.
 *  - `remaining` (array)    The rest — behind the toggle.
 *
 * Both slices are computed server-side (`utils/optionGrouping.js`); this component does no
 * filtering or sorting of its own.
 */
export default function OptionCategorySection({ category, enabled = [], remaining = [] }) {
  const rows = (list) => (
    <Stack spacing={1.25}>
      {list.map((opt) => <OptionRow key={opt.id} opt={opt} />)}
    </Stack>
  );

  // Nothing left to reveal (every option of the category is already on) → no affordance at all,
  // rather than a button that expands into an empty box.
  const toggleLabel = remaining.length === 0
    ? null
    : (enabled.length > 0
      ? `Voir les ${remaining.length} autre${remaining.length > 1 ? 's' : ''}`
      : `Voir les ${remaining.length} option${remaining.length > 1 ? 's' : ''}`);

  return (
    <CollapsibleSection
      title={category}
      count={enabled.length}
      toggleLabel={toggleLabel}
      pinned={enabled.length > 0 ? rows(enabled) : null}
    >
      {rows(remaining)}
    </CollapsibleSection>
  );
}
