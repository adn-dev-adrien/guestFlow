/**
 * OfferedTimeField — the minutes offered on a booking, by steps of 15 (specs/resource-booking-pricing-and-invoicing.md
 * rules 7-9, A3). A stepper only: the server prices the offer and refuses what exceeds the slot; its refusal is shown here.
 *
 * Props:
 *   value     number — minutes offered
 *   max       number — the booking's duration, the stepper's ceiling (the server still judges)
 *   onChange  (minutes) => void
 *   refusal   string | null — the server's refusal of the current value
 *   disabled  boolean
 */
import React from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';

export const OFFER_STEP = 15;

export default function OfferedTimeField({ value = 0, max = 0, onChange, refusal = null, disabled = false }) {
  const minutes = Number(value) || 0;
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Box
          role="group"
          aria-label="Temps offert"
          sx={{ display: 'inline-flex', alignItems: 'center', border: 1, borderColor: refusal ? 'error.main' : 'divider', borderRadius: 999 }}
        >
          <IconButton aria-label="Moins 15 minutes" disabled={disabled || minutes <= 0} onClick={() => onChange(Math.max(0, minutes - OFFER_STEP))} sx={{ minWidth: 44, minHeight: 44 }}>
            <RemoveIcon fontSize="small" />
          </IconButton>
          <Typography aria-live="polite" sx={{ minWidth: 48, textAlign: 'center', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{minutes}</Typography>
          <IconButton aria-label="Plus 15 minutes" disabled={disabled || minutes + OFFER_STEP > max} onClick={() => onChange(minutes + OFFER_STEP)} sx={{ minWidth: 44, minHeight: 44 }}>
            <AddIcon fontSize="small" />
          </IconButton>
        </Box>
        <Typography variant="caption" color="text.secondary">min offertes</Typography>
      </Box>
      {refusal ? <Typography variant="caption" color="error.main" sx={{ display: 'block', mt: 0.5 }}>{refusal}</Typography> : null}
    </Box>
  );
}
