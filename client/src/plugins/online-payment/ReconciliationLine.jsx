/**
 * ReconciliationLine — one expected receipt, as the fiche's card and the page's mobile cards draw it:
 * what the fiche expects, what the account shows (confirmed or proposed), the state, the wording of the
 * gap and the actions (specs/qonto-bank-reconciliation.md rules 25–26). Everything is the server's; the
 * line only draws it and forwards the clicks.
 *
 * Props:
 *   item        the server's receipt item (`state`, `stateLabel`, `tone`, `fixText`, `bank`, `proposal`…)
 *   busy        boolean — a write on this line is in flight
 *   blocked?    string — why a write is refused right now (unsaved fiche); disables the actions
 *   onConfirm, onDiscard, onUndo   (item) => void
 *   showReservation?  boolean — name the client and the platform (the page; the fiche knows its stay)
 *   onOpenFiche?      (item) => void — « Ouvrir la fiche » on a gap (the page)
 */
import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { PlatformChip, StatusBadge } from '../sdk';
import { money, CONFIDENCE_STATUS } from './reconciliationShared';

const BANK_ROW_SX = { display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'baseline', mt: 0.75, fontSize: 13 };

function BankRow({ label, side, amountCents }) {
  return (
    <Box sx={BANK_ROW_SX}>
      <Typography component="span" variant="caption" color="text.secondary" sx={{ minWidth: { sm: 120 } }}>{label}</Typography>
      <Typography component="span" variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {money(amountCents != null ? amountCents : side.amountCents)}
      </Typography>
      <Typography component="span" variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
        {side.counterparty}{side.reference ? ` · « ${side.reference} »` : ''}
      </Typography>
    </Box>
  );
}

export default function ReconciliationLine({ item, busy = false, blocked = '', onConfirm, onDiscard, onUndo, showReservation = false, onOpenFiche }) {
  const { proposal } = item;
  const disabled = busy || Boolean(blocked);
  const buttonSx = { minHeight: 44, textTransform: 'none', width: { xs: '100%', sm: 'auto' } };
  return (
    <Box sx={{ py: 1.5, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 } }} data-testid={`line-${item.key}`}>
      <Stack direction="row" gap={1} sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {showReservation && `${item.reservation.clientName || 'Client'} · `}{item.label}
            {showReservation && <PlatformChip platform={item.reservation.platform} sx={{ ml: 1 }} />}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            La fiche attend <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(item.expectedCents)}</span>
            {item.expectedDateLabel ? ` · ${item.paid ? 'reçu' : 'attendu'} le ${item.expectedDateLabel}` : ''}
          </Typography>
        </Box>
        <StatusBadge status={item.tone} label={item.stateLabel} />
      </Stack>

      {item.bank.map((b) => (
        <BankRow key={b.transactionId} label={`Sur le compte le ${b.dateLabel}`} side={b} amountCents={b.allocatedCents} />
      ))}

      {proposal && (
        <>
          <BankRow label={`Proposé · ${proposal.bank.dateLabel}`} side={proposal.bank} />
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
            <StatusBadge status={CONFIDENCE_STATUS[proposal.confidence] || 'neutral'} label={proposal.confidenceLabel} />
            {' '}{proposal.reason}
            {proposal.alsoCovers.length > 0 && ` · couvre aussi ${proposal.alsoCovers.map((c) => `${c.clientName || 'client'} (${c.label})`).join(', ')}`}
          </Typography>
        </>
      )}

      {item.alternatives.length > 0 && (
        <Box component="details" sx={{ mt: 0.5, fontSize: 13 }}>
          <Box component="summary" sx={{ cursor: 'pointer', color: 'primary.main', fontWeight: 600, minHeight: 32, display: 'flex', alignItems: 'center' }}>
            {item.alternatives.length} autre{item.alternatives.length > 1 ? 's' : ''} virement{item.alternatives.length > 1 ? 's' : ''} possible{item.alternatives.length > 1 ? 's' : ''}
          </Box>
          <Box component="ul" sx={{ m: 0, pl: 2.5, color: 'text.secondary' }}>
            {item.alternatives.map((a) => (
              <li key={a.proposalId}>{a.bank.dateLabel} · {money(a.bank.amountCents)} · {a.bank.counterparty}</li>
            ))}
          </Box>
        </Box>
      )}

      {item.fixText && (
        <Box sx={{ mt: 1, px: 1.25, py: 1, borderRadius: 1.25, fontSize: 13, bgcolor: item.tone === 'error' ? 'error.soft' : item.tone === 'info' ? 'info.soft' : 'warning.soft', color: item.tone === 'error' ? 'error.text' : item.tone === 'info' ? 'info.text' : 'warning.text' }}>
          {item.fixText}
        </Box>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} sx={{ mt: 1.25 }}>
        {proposal && (
          <>
            <Button variant="contained" disabled={disabled} onClick={() => onConfirm(item)} sx={buttonSx}>Confirmer</Button>
            <Button variant="text" color="inherit" disabled={disabled} onClick={() => onDiscard(item)} sx={buttonSx}>Écarter</Button>
          </>
        )}
        {item.canUndo && <Button variant="text" color="inherit" disabled={disabled} onClick={() => onUndo(item)} sx={buttonSx}>Défaire</Button>}
        {onOpenFiche && item.isGap && <Button variant="outlined" onClick={() => onOpenFiche(item)} sx={buttonSx}>Ouvrir la fiche</Button>}
      </Stack>
      {blocked && proposal && <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>{blocked}</Typography>}
    </Box>
  );
}
