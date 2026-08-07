import React from 'react';
import { Stack } from '@mui/material';
import CollapsibleSection from '../CollapsibleSection';
import OptionRow from './OptionRow';

/**
 * One option category on the reservation form (specs/option-categories.md §3 rules 8-11).
 *
 * The point of the component is the *pinned* slice: options that are enabled on this reservation,
 * or flagged `alwaysVisible` in the catalogue, render OUTSIDE the collapse. Folding a category can
 * never hide a line the guest is billed for, nor a service the operator is expected to offer on
 * every stay (« Petit déjeuner »). Only the untouched remainder folds away.
 *
 * Props:
 *  - `category`     (string)  The label, as stored on the options.
 *  - `pinned`       (array)   Always visible, rendered first.
 *  - `foldable`     (array)   Behind the toggle.
 *  - `enabledCount` (number)  Header chip — counts what is actually SELECTED, so an always-visible
 *                             option the operator hasn't ticked doesn't inflate it.
 *
 * Membership and order come from the server (`utils/optionGrouping.js`); this component does no
 * filtering or sorting of its own.
 */
export default function OptionCategorySection({ category, pinned = [], foldable = [], enabledCount = 0 }) {
  const rows = (list) => (
    <Stack spacing={1.25}>
      {list.map((opt) => <OptionRow key={opt.id} opt={opt} />)}
    </Stack>
  );

  // Nothing left to reveal (every option is already pinned) → no affordance at all, rather than a
  // button that expands into an empty box.
  const toggleLabel = foldable.length === 0
    ? null
    : (pinned.length > 0
      ? `Voir les ${foldable.length} autre${foldable.length > 1 ? 's' : ''}`
      : `Voir les ${foldable.length} option${foldable.length > 1 ? 's' : ''}`);

  return (
    <CollapsibleSection
      title={category}
      count={enabledCount}
      toggleLabel={toggleLabel}
      pinned={pinned.length > 0 ? rows(pinned) : null}
    >
      {rows(foldable)}
    </CollapsibleSection>
  );
}
