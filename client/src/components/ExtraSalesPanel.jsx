/**
 * ExtraSalesPanel — what the stay sold, with « Ajouter un produit » and the moment of each unpaid line (specs/pricing-components.md §3 rules 27, 31, 37).
 *
 * Props: `reservationId` (a saved stay), `articles` (`[{ articleRef, label }]`), `locked` (no sale on a closed stay), `onChanged()` (called after every write the server accepted, so the fiche re-reads the new line). Reads the server's
 * `saleDetail` and renders it; every change goes through the server, which answers the new payload.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import api from '../api';
import SaleDetailList from './SaleDetailList';
import AddProductDialog from './AddProductDialog';
import ErrorAlert from './ErrorAlert';

export default function ExtraSalesPanel({ reservationId, articles = [], locked = false, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [open, setOpen] = useState(false);
  const [busyRef, setBusyRef] = useState(null);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(() => {
    setLoadFailed(false);
    return api.getSaleDetail(reservationId).then(setDetail).catch(() => { setDetail(null); setLoadFailed(true); });
  }, [reservationId]);
  useEffect(() => { if (reservationId) load(); }, [reservationId, load]);

  const changeMoment = async (line, collectAt) => {
    setBusyRef(line.ref);
    setError('');
    try {
      const result = await api.patchExtraLine(reservationId, line.ref, { collectAt });
      setDetail(result.saleDetail);
      if (onChanged) onChanged();
    } catch (err) {
      setError((err && err.message) || 'Changement refusé.');
    } finally {
      setBusyRef(null);
    }
  };

  if (!reservationId) return null;
  return (
    <Box sx={{ px: { xs: 1.5, sm: 2 }, py: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' }, mb: 1 }}>
        <Typography variant="sectionHeader" sx={{ fontSize: '0.95rem' }}>Ventes du séjour</Typography>
        {!locked && (
          <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={() => setOpen(true)} sx={{ minHeight: 44 }}>
            Ajouter un produit
          </Button>
        )}
      </Stack>
      {error && <ErrorAlert message={error} sx={{ mb: 1 }} />}
      {loadFailed && <ErrorAlert message="Ventes du séjour indisponibles." onRetry={load} sx={{ mb: 1 }} />}
      <SaleDetailList detail={detail} onChangeMoment={locked ? undefined : changeMoment} busyRef={busyRef} />
      <AddProductDialog open={open} onClose={() => setOpen(false)} reservationId={reservationId} articles={articles} onSold={(next) => { setDetail(next); if (onChanged) onChanged(); }} />
    </Box>
  );
}
