/**
 * FilterChip — the « active filter » chip of a list: « Écarts · 9 ✕ ». One click on the close button, or
 * `Échap` while the chip is mounted, leaves the filter (specs/reconciliation-assisted-matching.md rule 11).
 * Generic: any list whose view can be narrowed by a counter or a toggle.
 *
 * Props: label (string, e.g. « Écarts »), count? (number), onClear () => void, clearLabel? (aria-label of the close button)
 */
import React, { useEffect } from 'react';
import { Chip } from '@mui/material';

export default function FilterChip({ label, count, onClear, clearLabel = 'Retirer le filtre' }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClear(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClear]);
  return (
    <Chip
      color="primary" variant="outlined" label={count == null ? label : `${label} · ${count}`}
      onDelete={onClear} slotProps={{ deleteIcon: { 'aria-label': clearLabel } }}
      aria-label={`Filtre actif : ${label}`} sx={{ minHeight: 32 }}
    />
  );
}
