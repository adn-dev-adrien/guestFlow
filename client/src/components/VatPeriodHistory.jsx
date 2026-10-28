/**
 * VatPeriodHistory — the dated history of the VAT regime (specs/vat-optional-mode.md §6.1): one line per
 * period, newest first, with the server's sentence, its tags (En vigueur / Prévu / Correction), its
 * author and date, and « Annuler ce changement » on an unused latest period. Specific to the VAT card:
 * a dated list of periods with a scope exists nowhere else.
 *
 * Props:
 *   periods:   the server's `periods` (label, regime, rate, scheduled, correction, deletable, reservations…)
 *   inForceId: id of the period in force
 *   onUndo:    (period) => void — asks for the deletion of an unused period
 *   disabled:  boolean
 */
import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import StatusBadge from './StatusBadge';
import { displayDate } from '../utils/formatters';
import { VAT_TEXTS, regimeLabel } from '../constants/vatRegime';

const caption = (period) => {
  const n = period.reservations;
  const parts = [period.createdByName, !period.initial && period.createdAtDay && displayDate(period.createdAtDay), `${n} réservation${n > 1 ? 's' : ''}`];
  return parts.filter(Boolean).join(' · ');
};

export default function VatPeriodHistory({ periods, inForceId, onUndo, disabled = false }) {
  return (
    <Stack component="ul" spacing={0} sx={{ listStyle: 'none', m: 0, p: 0 }} aria-label={VAT_TEXTS.historyTitle}>
      {periods.map((p) => (
        <Box
          key={p.id}
          component="li"
          sx={{
            display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between', gap: 1,
            py: 1.25, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 },
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{regimeLabel(p)}</Typography>
              {p.id === inForceId && <StatusBadge status="success" label={VAT_TEXTS.inForceTag} />}
              {p.scheduled && <StatusBadge status="info" label={VAT_TEXTS.scheduledTag} />}
              {p.correction && <StatusBadge status="warning" label={VAT_TEXTS.correctionTag} />}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{p.label}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>{caption(p)}</Typography>
          </Box>
          {p.deletable && (
            <Button size="small" onClick={() => onUndo(p)} disabled={disabled} sx={{ flexShrink: 0, minHeight: 44 }}>
              {VAT_TEXTS.undo}
            </Button>
          )}
        </Box>
      ))}
    </Stack>
  );
}
