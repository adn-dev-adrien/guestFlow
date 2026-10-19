/**
 * DevisExtensionSummary — what « prolonger » is about to change, shown in the confirmation BEFORE the
 * quote is re-issued (specs/ui-review-2026-10-19-operations.md rule 20): the new validity, the total
 * and the schedule today versus after. Every figure is the server's preview
 * (`GET /api/devis/:id/extension`); nothing is computed here.
 *
 * Props: { preview: { validUntil, current: { totalTtc, schedule[] }, next: { totalTtc, schedule[] } },
 *          unsavedChanges?: boolean }
 * Inline elements only: it renders inside the confirmation's paragraph.
 */
import React from 'react';
import { Box } from '@mui/material';
import { displayDate, formatCurrency } from '../../utils/formatters';

const AMOUNT = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

function Column({ title, block }) {
  return (
    <Box component="span" sx={{ display: 'block', minWidth: 0 }}>
      <Box component="span" sx={{ display: 'block', fontWeight: 600, mb: 0.5 }}>{title}</Box>
      <Box component="span" sx={{ display: 'block' }}>
        Total <Box component="b" sx={AMOUNT}>{formatCurrency(block.totalTtc)}</Box>
      </Box>
      {block.schedule.map((line) => (
        <Box component="span" key={`${line.label}-${line.dueDate}`} sx={{ display: 'block', color: 'text.secondary', fontSize: '0.9em' }}>
          {line.label} <Box component="span" sx={AMOUNT}>{formatCurrency(line.amount)}</Box>
          {line.dueDate ? ` avant le ${displayDate(line.dueDate)}` : ''}
        </Box>
      ))}
    </Box>
  );
}

export default function DevisExtensionSummary({ preview, unsavedChanges = false }) {
  return (
    <Box component="span" sx={{ display: 'block' }}>
      <Box component="span" sx={{ display: 'block', mb: 1.5 }}>
        Valable jusqu&apos;au {displayDate(preview.validUntil)}, aux tarifs actuels.
      </Box>
      <Box component="span" sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
        <Column title="Aujourd'hui" block={preview.current} />
        <Column title="Après prolongation" block={preview.next} />
      </Box>
      {unsavedChanges && (
        <Box component="span" sx={{ display: 'block', mt: 1.5, color: 'warning.main' }}>
          Les modifications non enregistrées de la fiche seront perdues.
        </Box>
      )}
    </Box>
  );
}
