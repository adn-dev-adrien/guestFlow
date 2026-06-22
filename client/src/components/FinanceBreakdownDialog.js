import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, IconButton, Box, Typography,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableFooter, Chip,
  useMediaQuery, useTheme,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { displayDate } from '../utils/formatters';
import { getPlatformColor } from '../constants/platforms';
import api from '../api';

/**
 * FinanceBreakdownDialog — feature-local dialog for the « Suivi financier » cards.
 * Given a `metric` (one of the five card figures) it fetches /finance/breakdown and lists the
 * reservations that compose that figure, with a single amount column whose footer total equals the card.
 * Clicking a row opens the reservation fiche (via onOpenReservation) and closes the dialog.
 *
 * Props:
 *   open               boolean
 *   metric             string | null — revenueTotal | totalCollected | totalPending | yearToDate | yearTotal
 *   from, to           string (YYYY-MM-DD) — used only for the period metrics
 *   onClose            () => void
 *   onOpenReservation  (id) => void
 */
const eur = (n) => `${Number(n || 0).toLocaleString('fr-FR')} €`;

export default function FinanceBreakdownDialog({ open, metric, from, to, onClose, onOpenReservation }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !metric) { setData(null); return undefined; }
    let alive = true;
    setLoading(true);
    setData(null);
    api.getFinanceBreakdown(metric, from, to)
      .then((res) => { if (alive) { setData(res); setLoading(false); } })
      .catch(() => { if (alive) { setData(null); setLoading(false); } });
    return () => { alive = false; };
  }, [open, metric, from, to]);

  const windowLabel = data?.window?.kind === 'year'
    ? `${data.window.year}`
    : data?.window
      ? `du ${displayDate(data.window.from)} au ${displayDate(data.window.to)}`
      : '';

  const footerCellSx = { fontWeight: 700, borderTop: '2px solid', borderTopColor: 'divider' };

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
          <Typography color="text.secondary">Chargement…</Typography>
        ) : !data || data.rows.length === 0 ? (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Typography color="text.secondary" sx={{ mb: 1 }}>Aucune réservation ne compose ce montant.</Typography>
            <Typography variant="h6">{eur(0)}</Typography>
          </Box>
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
                    <TableCell>
                      <Chip label={r.platform} size="small" sx={{ bgcolor: getPlatformColor(r.platform), color: 'white' }} />
                    </TableCell>
                    <TableCell>{displayDate(r.startDate)} → {displayDate(r.endDate)}</TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>{eur(r.amount)}</Typography>
                      <Typography variant="caption" color="text.secondary">{eur(r.amountHt)} HT</Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} sx={footerCellSx}>Total</TableCell>
                  <TableCell align="right" sx={footerCellSx}>
                    <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>{eur(data.total)}</Typography>
                    <Typography variant="caption" color="text.secondary">{eur(data.totalHt)} HT</Typography>
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
