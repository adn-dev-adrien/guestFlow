/**
 * StatusBadge — THE status chip (specs/ds-components.md §3.5): soft semantic background + dark
 * text (`palette.<sem>.text`, ≥ 4.5:1) from the « Maison » `palette.<sem>.soft` tokens — never a filled semantic Chip.
 *
 * Props:
 *   status:  'success' | 'warning' | 'error' | 'info' | 'neutral'   (required)
 *   label:   string                                                  (required)
 *   icon?:   ReactNode                                               (optional leading icon)
 *   wrap?:   boolean — a long label wraps on several lines instead of being cut (ledger states,
 *            specs/reservation-payment-ledger.md §6)
 */
import React from 'react';
import { Chip } from '@mui/material';

const SEMANTIC = ['success', 'warning', 'error', 'info'];

export default function StatusBadge({ status, label, icon, wrap = false }) {
  const sem = SEMANTIC.includes(status) ? status : null;
  return (
    <Chip
      size="small"
      label={label}
      icon={icon || undefined}
      sx={(t) => ({
        fontWeight: 600,
        bgcolor: sem ? t.palette[sem].soft : t.palette.grey[200],
        // AA on the soft background (specs/shell-and-home-day-first.md rule 14).
        color: sem ? t.palette[sem].text : t.palette.text.secondary,
        '& .MuiChip-icon': { color: 'inherit' },
        ...(wrap ? {
          height: 'auto', maxWidth: '100%', py: 0.25,
          '& .MuiChip-label': { whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: 1.35 },
        } : {}),
      })}
    />
  );
}
