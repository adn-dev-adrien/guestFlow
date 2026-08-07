/**
 * StatusBadge — THE status chip (specs/ds-components.md §3.5): soft semantic background + dark
 * text from the « Maison » `palette.<sem>.soft` tokens — never a filled semantic Chip.
 *
 * Props:
 *   status:  'success' | 'warning' | 'error' | 'info' | 'neutral'   (required)
 *   label:   string                                                  (required)
 *   icon?:   ReactNode                                               (optional leading icon)
 */
import React from 'react';
import { Chip } from '@mui/material';

const SEMANTIC = ['success', 'warning', 'error', 'info'];

export default function StatusBadge({ status, label, icon }) {
  const sem = SEMANTIC.includes(status) ? status : null;
  return (
    <Chip
      size="small"
      label={label}
      icon={icon || undefined}
      sx={(t) => ({
        fontWeight: 600,
        bgcolor: sem ? t.palette[sem].soft : t.palette.grey[200],
        color: sem ? t.palette[sem].main : t.palette.text.secondary,
        '& .MuiChip-icon': { color: 'inherit' },
      })}
    />
  );
}
