/**
 * TransactionRef — an identifier that belongs to another system (a Qonto transaction id, a Mollie settlement
 * « T19274230.2603.01 », a Mollie payment « tr_… », a Stripe charge…), shortened in the middle so a long id
 * still fits a phone, with a « Copier » button. The full value is the title, the copied text and what screen
 * readers read; only the drawing is shortened.
 *
 * Generic: it knows nothing about banks or reservations (specs/mollie-rolling-reserve-and-incoming-payments.md
 * rule 12). Copying shows a toast; a browser that refuses the clipboard shows an error toast.
 *
 * Props:
 *   label:      string — what the id is, shown before it and named by the button (« Qonto », « Lot Mollie »)
 *   value:      string — the full identifier; nothing is drawn when empty
 *   maxLength?: number — an id longer than this is shortened (default 24)
 */
import React from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useToast } from './DialogProvider';

const HEAD = 12;
const TAIL = 8;

function shorten(value, maxLength) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, HEAD)}…${value.slice(-TAIL)}`;
}

export default function TransactionRef({ label, value, maxLength = 24 }) {
  const { showSuccess, showError } = useToast();
  if (!value) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      showSuccess(`Référence ${label} copiée.`);
    } catch {
      showError('Copie impossible : sélectionnez la référence à la main.');
    }
  };

  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, maxWidth: '100%' }}>
      <Typography component="span" variant="caption" color="text.secondary">{label}</Typography>
      <Typography component="span" variant="caption" title={value} sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>
        {shorten(value, maxLength)}
      </Typography>
      <Tooltip title="Copier">
        <IconButton
          size="small"
          onClick={copy}
          aria-label={`Copier la référence ${label} ${value}`}
          sx={{ minWidth: 44, minHeight: 44, m: -1.25, color: 'text.secondary', '&:active': { transform: 'scale(0.94)' }, '@media (prefers-reduced-motion: reduce)': { '&:active': { transform: 'none' } } }}
        >
          <ContentCopyIcon sx={{ fontSize: 15 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
