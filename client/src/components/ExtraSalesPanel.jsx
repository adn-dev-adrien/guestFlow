/**
 * ExtraSalesPanel — what the stay sold, with « Ajouter un produit » and the moment of each unpaid line (specs/pricing-components.md §3 rules 27, 31, 37).
 *
 * Props: `reservationId` (a saved stay), `articles` (`[{ articleRef, label }]`), `locked` (no sale: a closed stay, or a started stay whose
 * mid-stay window the server closed), `heldReason` (a string while the fiche has unsaved edits: the writes are held, read-only, with this
 * reason — a write re-reads the fiche, which would drop the typed edits), `initialDetail` (the `saleDetail` the fiche already read; when
 * given, the panel does not ask for it again), `onChanged()` (called after every write the server accepted, so the fiche re-reads the new line).
 * Renders the server's `saleDetail`; every change goes through the server, which answers the new payload.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Box, Button, Stack, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import api from '../api';
import SaleDetailList from './SaleDetailList';
import AddProductDialog from './AddProductDialog';
import ErrorAlert from './ErrorAlert';
import { EXTRA_SALES_PANEL_TEXTS as TEXTS } from '../constants/extraSale';

export default function ExtraSalesPanel({ reservationId, articles = [], locked = false, heldReason = null, initialDetail, onChanged }) {
  const [detail, setDetail] = useState(initialDetail || null);
  const [open, setOpen] = useState(false);
  const [busyRef, setBusyRef] = useState(null);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(() => {
    setLoadFailed(false);
    return api.getSaleDetail(reservationId).then(setDetail).catch(() => { setDetail(null); setLoadFailed(true); });
  }, [reservationId]);
  // The fiche's own read is the first payload (rule 31: no second request); the panel reads alone only without it.
  useEffect(() => {
    if (!reservationId) return;
    if (initialDetail) { setDetail(initialDetail); setLoadFailed(false); } else load();
  }, [reservationId, initialDetail, load]);

  const changeMoment = async (line, collectAt) => {
    setBusyRef(line.ref);
    setError('');
    try {
      const result = await api.patchExtraLine(reservationId, line.ref, { collectAt });
      setDetail(result.saleDetail);
      if (onChanged) onChanged();
    } catch (err) {
      setError((err && err.message) || TEXTS.changeRefused);
    } finally {
      setBusyRef(null);
    }
  };

  if (!reservationId) return null;
  const held = Boolean(heldReason);
  return (
    <Box sx={{ px: { xs: 1.5, sm: 2 }, py: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, mb: 1 }}>
        <Typography variant="sectionHeader" sx={{ fontSize: '0.95rem' }}>{TEXTS.title}</Typography>
        {!locked && (
          <Tooltip title={held ? heldReason : ''}>
            <span>
              <Button
                variant="outlined"
                size="small"
                startIcon={<AddIcon />}
                onClick={held ? undefined : () => setOpen(true)}
                aria-disabled={held || undefined}
                aria-describedby={held ? 'extra-sales-held' : undefined}
                sx={{ minHeight: 44, ...(held ? { opacity: 0.38, cursor: 'default' } : {}) }}
              >
                {TEXTS.add}
              </Button>
            </span>
          </Tooltip>
        )}
      </Stack>
      {!locked && held && (
        <Typography id="extra-sales-held" variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{heldReason}</Typography>
      )}
      {error && <ErrorAlert message={error} sx={{ mb: 1 }} />}
      {loadFailed && <ErrorAlert message={TEXTS.loadFailed} onRetry={load} sx={{ mb: 1 }} />}
      <SaleDetailList detail={detail} onChangeMoment={locked ? undefined : changeMoment} heldReason={held ? heldReason : null} busyRef={busyRef} />
      <AddProductDialog open={open} onClose={() => setOpen(false)} reservationId={reservationId} articles={articles} onSold={(next) => { setDetail(next); if (onChanged) onChanged(); }} />
    </Box>
  );
}
