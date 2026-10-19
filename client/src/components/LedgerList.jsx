/**
 * LedgerList — a list of money movements, one row each: label · amount · state · one action
 * (specs/reservation-payment-ledger.md §6). The rows come from the server ready to print; this
 * component computes nothing — no state, no total, no rule. It knows nothing about reservations: the
 * same « row = amount + state + one action » shape serves any ledger.
 *
 * Props:
 *   rows:            [{ key, label, amount (number|null), stateLabel, tone, action?: { label, kind },
 *                      amountEdit?: { editable, mode, reason } }]   (required)
 *   closing:         { label, amount|null, tone? } — the closing line (« Reste à percevoir » 614,40 € /
 *                    « Tout est perçu », amount null)
 *   formatAmount:    (number) → string                                   (required)
 *   onAction:        (row) → void — the row's single action
 *   onAmountClick:   (row) → void — the amount affordance (an editable or a locked amount)
 *   renderDetail:    (row) → ReactNode — the detail under a row (lines, link, warnings)
 *   renderPanel:     (row) → ReactNode — the inline panel under a row (form, editor, confirmation),
 *                    rendered in place of the row's action while it is open
 *   openKey:         string|null — the row whose panel is open
 *   readOnly:        boolean — hides every action and amount affordance
 *   footer:          ReactNode — secondary actions under the closing line
 *
 * Responsive: under 600 px of width (container query) a row is two lines — label + amount, then state
 * + action; wider, one line `label | amount | state | action`. Amounts never wrap.
 */
import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import StatusBadge from './StatusBadge';

const amountSx = {
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

function AmountCell({ row, formatAmount, onAmountClick, readOnly }) {
  const edit = row.amountEdit || {};
  const text = row.amount == null ? '—' : formatAmount(row.amount);
  const muted = row.tone === 'muted';
  const clickable = !readOnly && typeof onAmountClick === 'function' && edit.mode && edit.mode !== 'none';
  if (!clickable) {
    return (
      <Typography component="span" sx={{ ...amountSx, color: muted ? 'text.secondary' : 'text.primary', fontWeight: muted ? 500 : 600 }}>
        {text}
      </Typography>
    );
  }
  const locked = !edit.editable;
  return (
    <Button
      variant="text"
      data-ledger-amount=""
      onClick={() => onAmountClick(row)}
      aria-label={`${locked ? 'Montant figé' : 'Modifier le montant'} : ${row.label}, ${text}`}
      endIcon={locked
        ? <LockOutlinedIcon sx={{ fontSize: '0.9rem !important', color: 'text.secondary' }} />
        : <EditOutlinedIcon sx={{ fontSize: '0.9rem !important', color: 'text.secondary' }} />}
      sx={{
        ...amountSx,
        color: 'text.primary',
        minHeight: 44,
        minWidth: 0,
        px: 0.5,
        borderRadius: 1,
        textTransform: 'none',
        fontSize: 'inherit',
        borderBottom: '1px dashed',
        borderBottomStyle: locked ? 'dotted' : 'dashed',
        borderColor: locked ? 'divider' : 'text.disabled',
        '&:active': { transform: 'scale(0.97)' },
        transition: 'transform 100ms ease-out',
      }}
    >
      {text}
    </Button>
  );
}

const TONE_TO_STATUS = { due: 'warning', late: 'error', done: 'success', warning: 'warning', info: 'info', muted: 'neutral' };

export default function LedgerList({
  rows = [], closing = null, formatAmount, onAction, onAmountClick,
  renderDetail, renderPanel, openKey = null, readOnly = false, footer = null,
}) {
  return (
    <Box sx={{ containerType: 'inline-size' }} data-testid="ledger">
      {rows.map((row, index) => {
        const open = openKey === row.key;
        const action = !readOnly && row.action && !open ? row.action : null;
        const muted = row.tone === 'muted';
        return (
          <Box
            key={row.key}
            data-row={row.key}
            sx={{ borderTop: index === 0 ? 0 : '1px solid', borderColor: 'divider', py: 1.25 }}
          >
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                gridTemplateAreas: '"label amount" "state action"',
                columnGap: 1.25,
                rowGap: 0.75,
                alignItems: 'center',
                '@container (min-width: 600px)': {
                  gridTemplateColumns: 'minmax(0, 1fr) 132px minmax(0, 240px) 150px',
                  gridTemplateAreas: '"label amount state action"',
                },
              }}
            >
              <Typography
                component="span"
                sx={{ gridArea: 'label', fontWeight: muted ? 500 : 600, color: muted ? 'text.secondary' : 'text.primary', minWidth: 0, overflowWrap: 'anywhere' }}
              >
                {row.label}
              </Typography>
              <Box sx={{ gridArea: 'amount', justifySelf: 'end' }}>
                <AmountCell row={row} formatAmount={formatAmount} onAmountClick={onAmountClick} readOnly={readOnly} />
              </Box>
              <Box sx={{ gridArea: 'state', minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {/* §6 — an open panel replaces the state line while it is open. */}
                {row.stateLabel && !open && <StatusBadge status={TONE_TO_STATUS[row.tone] || 'neutral'} label={row.stateLabel} wrap />}
              </Box>
              <Box sx={{ gridArea: 'action', justifySelf: 'end' }}>
                {action && (
                  <Button
                    data-ledger-action=""
                    aria-label={`${action.label} : ${row.label}`}
                    variant={action.kind === 'undo' || action.kind === 'deleteRefund' ? 'text' : 'outlined'}
                    color={action.kind === 'deleteRefund' ? 'error' : 'primary'}
                    onClick={() => onAction && onAction(row)}
                    sx={{ minHeight: 44, borderRadius: 999, whiteSpace: 'nowrap', textTransform: 'none', '&:active': { transform: 'scale(0.97)' } }}
                  >
                    {action.label}
                  </Button>
                )}
              </Box>
            </Box>
            {renderDetail ? renderDetail(row) : null}
            {open && renderPanel ? renderPanel(row) : null}
          </Box>
        );
      })}
      {closing && closing.label && (
        <Box
          sx={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1.25,
            borderTop: '2px solid', borderColor: 'divider', pt: 1.25, mt: 0.25,
            color: closing.tone === 'muted' ? 'text.secondary' : (closing.amount == null ? 'success.text' : 'text.primary'),
          }}
          data-testid="ledger-closing"
        >
          <Typography component="span" sx={{ fontWeight: 600, color: 'inherit' }}>{closing.label}</Typography>
          {closing.amount != null && (
            <Typography component="span" sx={{ ...amountSx, fontSize: '1.0625rem', color: 'inherit' }}>
              {formatAmount(closing.amount)}
            </Typography>
          )}
        </Box>
      )}
      {footer}
    </Box>
  );
}
