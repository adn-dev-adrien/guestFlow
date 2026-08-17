import React from 'react';
import { Button, Stack, Typography } from '@mui/material';

/**
 * One line of a SAS recap, with the « Offrir / ✓ Offert » geste commercial toggle
 * (specs/sas-offer-complement-lines.md §6).
 *
 * Props:
 * - `text`      : the already-formatted line, ALWAYS carrying the real price
 *                 (« libellé : 2 × 8 € = 16 € ») — struck through once offered.
 * - `offered`   : true when the operator gave this line away (it then counts 0 € in the total).
 * - `onToggle`  : toggles the gesture. Omit it to render a line that can never be offered
 *                 (taxe de séjour, read-only reminders) — no button at all.
 * - `prefix`    : optional leading marker, e.g. « + » for the lines the SAS just added.
 */
export default function OfferableLine({ text, offered = false, onToggle, prefix = '' }) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
    >
      <Typography
        variant="body2"
        sx={{
          minWidth: 0,
          flex: 1,
          textDecoration: offered ? 'line-through' : 'none',
          color: offered ? 'text.disabled' : 'text.primary',
        }}
      >
        {prefix}{text}
      </Typography>
      {offered && <Typography variant="body2" sx={{ fontWeight: 700, color: 'success.main' }}>0 €</Typography>}
      {onToggle && (
        <Button
          size="small"
          color="success"
          variant={offered ? 'contained' : 'outlined'}
          onClick={onToggle}
          sx={{ minHeight: 44, minWidth: 88, flexShrink: 0 }}
        >
          {offered ? '✓ Offert' : 'Offrir'}
        </Button>
      )}
    </Stack>
  );
}
