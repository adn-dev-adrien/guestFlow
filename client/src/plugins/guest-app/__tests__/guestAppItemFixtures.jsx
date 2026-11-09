// Shared by the GuestAppItemFields suites (specs/guest-app.md rules 22, 37bis). `vi.mock` stays in each file.
import React from 'react';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../../theme';
import GuestAppItemFields from '../GuestAppItemFields';

/** An item as `GET /api/guest-app/items/:kind/:id` answers it. */
export const itemView = (over = {}) => ({
  kind: 'option',
  id: 12,
  title: 'Jus de pomme',
  priceType: 'per_stay',
  sellable: { ok: true, reason: null },
  sold: true,
  mediaId: null,
  shortDescriptionFr: 'Pur jus.',
  shortDescriptionEn: null,
  maxQuantity: 10,
  needsStaff: true,
  leadMinutes: 30,
  stockable: true,
  stock: {
    tracked: false, quantity: null, quantityLabel: null, held: 0, heldLabel: null, left: null, alertBelow: null, soldOut: false, out: false, restockLine: null,
  },
  ...over,
});

/** Renders the section with a host stand-in: `host.save()` runs what the section registered. */
export function renderFields({ kind = 'option', itemId = 12 } = {}) {
  const host = { save: null, dirty: false };
  const registerSave = (fn) => { host.save = fn; return () => { host.save = null; }; };
  const onDirtyChange = (dirty) => { host.dirty = dirty; };
  const view = render(
    <ThemeProvider theme={theme}>
      <GuestAppItemFields kind={kind} itemId={itemId} registerSave={registerSave} onDirtyChange={onDirtyChange} />
    </ThemeProvider>,
  );
  return { host, ...view };
}
