import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, IconButton, Box, Typography,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableFooter,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import { displayDate, formatCurrency } from '../utils/formatters';
import PlatformChip from './PlatformChip';
import LoadingState from './LoadingState';
import EmptyState from './EmptyState';
import ErrorAlert from './ErrorAlert';
import api from '../api';

/**
 * FinanceBreakdownDialog — feature-local READ-ONLY dialog for the « Suivi financier » cards.
 * Given a `metric` it fetches /finance/breakdown and lists the reservations composing that figure,
 * with a single amount column whose footer total equals the card. Clicking a row opens the fiche.
 *
 * Kept as a bespoke <Dialog> (not FormDialog): it's a read-only detail view with a close button, so a
 * form dialog's Annuler/Enregistrer actions would be wrong. It sets its own fullScreen-on-xs
 * (specs/ds-sweep-finance.md §9). Money via formatCurrency, PlatformChip, shared load/error states.
 *
 * Props: open, metric, from, to, onClose, onOpenReservation(id).
 */
export default function FinanceBreakdownDialog({ open, metric, from, to, onClose, onOpenReservation }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open || !metric) { setData(null); return undefined; }
    let alive = true;
    setLoading(true);
    setData(null);
    setError(false);
    api.getFinanceBreakdown(metric, from, to)
      .then((res) => { if (alive) { setData(res); setLoading(false); } })
      .catch(() => { if (alive) { setError(true); setLoading(false); } });
    return () => { alive = false; };
  }, [open, metric, from, to]);

  const windowLabel = data?.window?.kind === 'year'
    ? `${data.window.year}`
    // specs/finance-pending-global-remaining.md — « En attente de règlement » is period-free:
    // every finished stay counts, whatever the du/au selection.
    : data?.window?.kind === 'global'
      ? 'séjours terminés (toutes périodes)'
      : data?.window
        ? `du ${displayDate(data.window.from)} au ${displayDate(data.window.to)}`
        : '';

  const footerCellSx = { fontWeight: 700, borderTop: '2px solid', borderTopColor: 'divider', fontVariantNumeric: 'tabular-nums' };

  const handleRowClick = (id) => {
    onClose();
    onOpenReservation(id);
  };

  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        {data ? `${data.label}${windowLabel ? ` — ${windowLabel}` : ''}` : 'Détail du montant'}
        <IconButton onClick={onClose} aria-label="Fermer" sx={{ position: 'absolute', right: 8, top: 8 }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ p: { xs: 1.5, sm: 2 } }}>
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorAlert message="Impossible de charger le détail du montant." />
        ) : !data || data.rows.length === 0 ? (
          <EmptyState message="Aucune réservation ne compose ce montant." py={4} />
        ) : (
          <TableContainer>
            <Table size="small" sx={{ minWidth: 720 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Plateforme</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Séjour</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">{data.column}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.rows.map((r) => (
                  <TableRow key={r.id} hover sx={{ cursor: 'pointer' }} onClick={() => handleRowClick(r.id)}>
                    <TableCell>{r.clientName}</TableCell>
                    <TableCell>{r.propertyName}</TableCell>
                    <TableCell><PlatformChip platform={r.platform} /></TableCell>
                    <TableCell>{displayDate(r.startDate)} → {displayDate(r.endDate)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>{formatCurrency(r.amount)}</Typography>
                      <Typography variant="caption" color="text.secondary">{formatCurrency(r.amountHt)} HT</Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} sx={footerCellSx}>Total</TableCell>
                  <TableCell align="right" sx={footerCellSx}>
                    <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>{formatCurrency(data.total)}</Typography>
                    <Typography variant="caption" color="text.secondary">{formatCurrency(data.totalHt)} HT</Typography>
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </TableContainer>
        )}
      </DialogContent>
    </Dialog>
  );
}
