/**
 * ReservationReconciliationCard — « Rapprochement bancaire » of the fiche, right under the payments
 * ledger (specs/qonto-bank-reconciliation.md rules 25–27, 33, 39).
 *
 * It draws `pluginBlocks['online-payment']` as the server shaped it (built from stored credits only, never
 * a Qonto call) and nothing when the block is absent (out of scope, Qonto not connected). Confirming a
 * proposal marks the échéance received on the fiche, so every write reloads the fiche's finance.
 *
 * Props: reservationId, cardSx, contentSx (the fiche's section rhythm), pluginBlocks, reloadFinance, formDirty
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import { StatusBadge } from '../sdk';
import ReconciliationLine from './ReconciliationLine';
import LinkTransactionDialog from './LinkTransactionDialog';
import useReconciliationActions from './useReconciliationActions';
import { lastReadLabel, readFailureLabel } from './reconciliationShared';

const UNSAVED = 'Enregistrer ou annuler les modifications avant de rapprocher.';

export default function ReservationReconciliationCard({ cardSx, contentSx, pluginBlocks, reloadFinance, formDirty = false }) {
  const block = pluginBlocks ? pluginBlocks['online-payment'] : null;
  const [expanded, setExpanded] = useState(false);
  const [linking, setLinking] = useState(false);
  const reload = useCallback(async () => { if (reloadFinance) await reloadFinance(); }, [reloadFinance]);
  const actions = useReconciliationActions({ onChanged: reload });

  const receipts = useMemo(() => (block ? block.lines.map((l) => ({
    key: l.key, reservationId: l.reservation.id, ledgerKey: l.ledgerKey, label: l.label, expectedCents: l.expectedCents,
  })) : []), [block]);

  if (!block || !block.lines || block.lines.length === 0) return null;
  const folded = block.allReconciled && !expanded;
  const failure = readFailureLabel(block.lastError);

  const submitLink = async (link) => {
    const ok = await actions.link('manual', link.transactionId, [{ reservationId: link.reservationId, ledgerKey: link.ledgerKey, amountCents: link.amountCents }]);
    if (ok) setLinking(false);
  };

  return (
    <Card variant="outlined" sx={cardSx}>
      <CardContent sx={contentSx}>
        <Stack direction="row" gap={1} sx={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <Box>
            <Typography variant="sectionHeader">Rapprochement bancaire</Typography>
            <Typography variant="caption" color="text.secondary" component="div">{failure || lastReadLabel(block.lastReadAt)}</Typography>
          </Box>
        </Stack>

        {folded ? (
          <Stack direction="row" sx={{ mt: 1.5, justifyContent: 'space-between', alignItems: 'center' }}>
            <Stack direction="row" gap={1} sx={{ alignItems: 'center' }}>
              <StatusBadge status="success" label="Rapproché" />
              <Typography variant="body2">Tout est rapproché.</Typography>
            </Stack>
            <Button variant="text" onClick={() => setExpanded(true)} sx={{ minHeight: 44, textTransform: 'none' }}>Voir le détail</Button>
          </Stack>
        ) : (
          <>
            <Box sx={{ mt: 0.5 }}>
              {block.lines.map((item) => (
                <ReconciliationLine
                  key={item.key}
                  item={item}
                  busy={actions.busy === item.key}
                  blocked={formDirty ? UNSAVED : ''}
                  onConfirm={actions.confirm}
                  onDiscard={actions.discard}
                  onUndo={actions.undo}
                />
              ))}
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} sx={{ borderTop: 1, borderColor: 'divider', mt: 0.5, pt: 1.25, justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
              <Typography variant="body2" color="text.secondary">Un virement manque ou est mal proposé ?</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} gap={1}>
                {block.allReconciled && <Button variant="text" onClick={() => setExpanded(false)} sx={{ minHeight: 44, textTransform: 'none' }}>Replier</Button>}
                <Button variant="outlined" disabled={formDirty} onClick={() => setLinking(true)} sx={{ minHeight: 44, textTransform: 'none' }}>Rattacher un virement</Button>
              </Stack>
            </Stack>
          </>
        )}
      </CardContent>
      <LinkTransactionDialog
        open={linking} onClose={() => setLinking(false)} receipts={receipts} credits={block.credits || []}
        busy={actions.busy === 'manual'} onSubmit={submitLink}
      />
    </Card>
  );
}
