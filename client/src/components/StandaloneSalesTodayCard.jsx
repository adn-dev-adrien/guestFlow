/**
 * StandaloneSalesTodayCard — « Ventes hors séjour · aujourd'hui » on the Suivi financier (owner M4): the counter's sales of the day, newest first, each with its client, its lines, its total
 * and the server's status (« Payée », « Reste 5,00 € », « Offerte », « Annulée »), and the « Vente hors séjour » button that opens the counter dialog. It reads `GET /api/standalone-sales`;
 * nothing is derived here. A refusal stays inside the card with a retry. Above the day's list, under the server's `owedTitle` (« À rembourser »): the sales of any
 * day whose document still owes money back (`owed`, outside-visit rule 41), each naming its sale's day (`soldDayLabel`, « Vente du 14/11 ») and carrying
 * « Marquer remboursé » (confirmed, then the card is read again).
 *
 * Props: refreshKey — bumped by the page's refresh action; onNewSale — opens the dialog; reloadKey — bumped after a sale
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Typography } from '@mui/material';
import api from '../api';
import StatusBadge from './StatusBadge';
import LoadingState from './LoadingState';
import ErrorAlert from './ErrorAlert';
import ConfirmDialog from './ConfirmDialog';
import useLatestRequest from '../hooks/useLatestRequest';
import { formatCurrency } from '../utils/formatters';

const STATUS_OF_TONE = { paid: 'success', due: 'warning', off: 'neutral' };
const TEXTS = Object.freeze({
  title: 'Ventes hors séjour · aujourd’hui',
  action: 'Vente hors séjour',
  none: 'Aucune vente aujourd’hui.',
  failed: 'Impossible de charger les ventes du jour.',
  sale: (id, client) => `Vente n° ${id} · ${client}`,
  refunded: 'Marquer remboursé',
  refundedAsk: 'Marquer comme remboursé ?',
  refundedFailed: 'Clôture impossible.',
});

export default function StandaloneSalesTodayCard({ refreshKey = 0, reloadKey = 0, onNewSale }) {
  const [state, setState] = useState({ sales: null, owed: [], owedTitle: '', error: false });
  const [ask, setAsk] = useState(null);
  const [closeError, setCloseError] = useState(null);
  const begin = useLatestRequest();
  const load = useCallback(async () => {
    const current = begin();
    setState((s) => ({ ...s, error: false }));
    try {
      const data = await api.getStandaloneSales();
      if (current()) setState({ sales: data.sales, owed: data.owed || [], owedTitle: data.owedTitle || '', error: false });
    } catch {
      if (current()) setState({ sales: null, owed: [], owedTitle: '', error: true });
    }
  }, [begin]);
  useEffect(() => { load(); }, [load, refreshKey, reloadKey]);

  const close = async ({ sale, row }) => {
    setCloseError(null);
    try {
      await api.closeStandaloneSaleObligation(sale.id, row.id, 'settled');
      await load();
    } catch (e) {
      setCloseError(e.message || TEXTS.refundedFailed);
    }
  };

  return (
    <Card variant="outlined" sx={{ borderRadius: 2 }} component="section" aria-label={TEXTS.title}>
      <CardContent sx={{ display: 'grid', gap: 1.25, p: { xs: 1.5, sm: 2 }, '&:last-child': { pb: { xs: 1.5, sm: 2 } } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="sectionHeader">{TEXTS.title}</Typography>
          <Button variant="outlined" onClick={onNewSale} sx={{ minHeight: 44, textTransform: 'none' }}>{TEXTS.action}</Button>
        </Box>
        {state.error && <ErrorAlert message={TEXTS.failed} onRetry={load} />}
        {state.owed.length > 0 && (
          <Box component="section" aria-label={state.owedTitle || undefined} sx={{ display: 'grid', gap: 1 }}>
            {state.owedTitle && <Typography variant="subtitle2" component="h3">{state.owedTitle}</Typography>}
            {closeError && <Typography role="alert" variant="caption" color="error">{closeError}</Typography>}
            {state.owed.flatMap((sale) => sale.refundObligations.map((row) => (
              <Alert
                key={`${sale.id}-${row.id}`}
                severity="warning"
                action={<Button color="inherit" size="small" aria-describedby={`owed-${sale.id}-${row.id}`} onClick={() => setAsk({ sale, row })} sx={{ minHeight: 44, textTransform: 'none' }}>{TEXTS.refunded}</Button>}
                sx={{ '& .MuiAlert-message': { minWidth: 0, overflowWrap: 'anywhere' } }}
              >
                <Typography id={`owed-${sale.id}-${row.id}`} variant="body2" sx={{ fontWeight: 600 }}>{TEXTS.sale(sale.id, sale.clientLabel)}</Typography>
                <Typography variant="caption">{[sale.soldDayLabel, row.label, row.detail].filter(Boolean).join(' · ')}</Typography>
              </Alert>
            )))}
          </Box>
        )}
        {!state.error && !state.sales && <LoadingState py={2} />}
        {state.sales && state.sales.length === 0 && <Typography variant="body2" color="text.secondary">{TEXTS.none}</Typography>}
        {state.sales && state.sales.length > 0 && (
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
            {state.sales.map((sale) => (
              <Box
                component="li"
                key={sale.id}
                sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr auto', sm: 'minmax(0, 1fr) auto auto' }, alignItems: 'center', py: 1.25, borderBottom: 1, borderColor: 'divider' }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{TEXTS.sale(sale.id, sale.clientLabel)}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{sale.lines.join(' · ')}</Typography>
                </Box>
                <StatusBadge status={STATUS_OF_TONE[sale.tone] || 'neutral'} label={sale.statusLabel} />
                <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'right', gridColumn: { xs: '1 / -1', sm: 'auto' } }}>{formatCurrency(sale.totalCents / 100)}</Typography>
              </Box>
            ))}
          </Box>
        )}
      </CardContent>
      <ConfirmDialog
        open={Boolean(ask)}
        title={TEXTS.refundedAsk}
        message={ask ? [TEXTS.sale(ask.sale.id, ask.sale.clientLabel), ask.row.label].join(' · ') : ''}
        confirmLabel={TEXTS.refunded}
        confirmColor="primary"
        onClose={() => setAsk(null)}
        onConfirm={() => { const target = ask; setAsk(null); close(target); }}
      />
    </Card>
  );
}
