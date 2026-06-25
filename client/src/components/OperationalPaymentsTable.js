import React from 'react';
import {
  Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TableFooter, Chip, Checkbox, Tooltip, IconButton,
} from '@mui/material';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import { displayDate } from '../utils/formatters';
import { getPlatformColor } from '../constants/platforms';

/**
 * OperationalPaymentsTable — the shared « Suivi opérationnel » payments table.
 * Drives both « Paiements en attente » (interactive, 4 buckets) and « Réservations à venir »
 * (read-only, 3 buckets) from one implementation (specs/finance-upcoming-payments-table.md §4.2).
 *
 * Props:
 *  - rows:     enriched reservations (server-shaped: amounts, *Paid / *PaidCash flags, due dates,
 *              remainingToPay, totalSejour).
 *  - totals:   column totals { depositAmount, balanceAmount, complementAmount,
 *              endOfStayComplementAmount?, remainingToPay, totalSejour }.
 *  - interactive: when true, Acompte/Solde get a paid checkbox and a « Tout solder » action column.
 *  - showEndOfStayComplement: when true, adds the « Compl. fin de séjour » column.
 *  - onTogglePayment(row, field): toggles a bucket's paid flag (interactive only).
 *  - onSettleAll(row): marks every still-open bucket paid (interactive only).
 *  - onOpenReservation(id): row click → navigate to the fiche.
 *  - minWidth: table min width (px) before horizontal scroll.
 */

const eur = (n) => `${Number(n || 0).toLocaleString('fr-FR')} €`;

// Bucket cell for the complements: green amount when settled (paid / caisse-interne), red when still
// owed, muted « — » when nothing to collect (amount 0). Display-only.
function PaymentBucketAmount({ amount, settled, cash }) {
  const n = Number(amount || 0);
  if (n <= 0) return <Typography variant="body2" sx={{ color: 'text.disabled' }}>—</Typography>;
  return (
    <Box>
      <Typography variant="body2" sx={{ color: settled ? 'success.main' : 'error.main', fontWeight: 600 }}>{n}€</Typography>
      {cash && <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>caisse</Typography>}
    </Box>
  );
}

// Acompte / Solde cell: amount coloured by paid state + due date. In interactive mode a checkbox is
// prepended; in read-only mode only the amount + due date show. Deposit can be « Désactivé ».
function ScheduledBucketCell({ amount, paid, dueDate, overdue, disabled, interactive, onToggle }) {
  if (disabled) {
    return <Typography variant="body2" sx={{ fontStyle: 'italic', color: 'text.disabled' }}>Désactivé</Typography>;
  }
  const detail = (
    <Box>
      <Typography variant="body2" sx={{ color: paid ? 'success.main' : 'error.main', fontWeight: overdue ? 700 : 600 }}>{amount}€</Typography>
      {dueDate && <Typography variant="caption" sx={{ display: 'block', color: overdue ? 'error.main' : 'text.secondary', fontWeight: overdue ? 700 : 400 }}>{displayDate(dueDate)}</Typography>}
    </Box>
  );
  if (!interactive) return detail;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
      <Checkbox checked={!!paid} onChange={onToggle} size="small" />
      {detail}
    </Box>
  );
}

export default function OperationalPaymentsTable({
  rows,
  totals = {},
  interactive = false,
  showEndOfStayComplement = false,
  onTogglePayment,
  onSettleAll,
  onOpenReservation,
  minWidth = 1180,
}) {
  const footerCellSx = { fontWeight: 700, borderTop: '2px solid', borderTopColor: 'divider' };
  const stop = (e) => e.stopPropagation();

  return (
    <TableContainer>
      <Table size="small" sx={{ minWidth }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Séjour</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Plateforme</TableCell>
            <TableCell sx={{ fontWeight: 600 }} align="center">Acompte</TableCell>
            <TableCell sx={{ fontWeight: 600 }} align="center">Solde</TableCell>
            <TableCell sx={{ fontWeight: 600 }} align="center">Complément</TableCell>
            {showEndOfStayComplement && <TableCell sx={{ fontWeight: 600 }} align="center">Compl. fin de séjour</TableCell>}
            <TableCell sx={{ fontWeight: 600 }} align="center">Reste à payer</TableCell>
            <TableCell sx={{ fontWeight: 600 }} align="right">Total de séjour</TableCell>
            {interactive && <TableCell sx={{ fontWeight: 600 }} align="center">Solder</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => {
            const { depositOverdue, balanceOverdue, remainingToPay } = r;
            const complementSettled = !!r.complementPaid || !!r.complementPaidCash;
            const endOfStaySettled = !!r.endOfStayComplementPaid || !!r.endOfStayComplementPaidCash;
            return (
              <TableRow key={r.id} hover sx={{ cursor: 'pointer' }} onClick={() => onOpenReservation?.(r.id)}>
                <TableCell>{r.firstName} {r.lastName}</TableCell>
                <TableCell>{r.propertyName}</TableCell>
                <TableCell>{displayDate(r.startDate)} → {displayDate(r.endDate)}</TableCell>
                <TableCell><Chip label={r.platform} size="small" sx={{ bgcolor: getPlatformColor(r.platform), color: 'white' }} /></TableCell>
                <TableCell align="center" onClick={interactive ? stop : undefined}>
                  <ScheduledBucketCell
                    amount={r.depositAmount}
                    paid={!!r.depositPaid}
                    dueDate={r.depositDueDate}
                    overdue={depositOverdue}
                    disabled={r.depositDisabled}
                    interactive={interactive}
                    onToggle={() => onTogglePayment?.(r, 'depositPaid')}
                  />
                </TableCell>
                <TableCell align="center" onClick={interactive ? stop : undefined}>
                  <ScheduledBucketCell
                    amount={r.balanceAmount}
                    paid={!!r.balancePaid}
                    dueDate={r.balanceDueDate}
                    overdue={balanceOverdue}
                    interactive={interactive}
                    onToggle={() => onTogglePayment?.(r, 'balancePaid')}
                  />
                </TableCell>
                <TableCell align="center">
                  <PaymentBucketAmount amount={r.complementAmount} settled={complementSettled} cash={!!r.complementPaidCash} />
                </TableCell>
                {showEndOfStayComplement && (
                  <TableCell align="center">
                    <PaymentBucketAmount amount={r.endOfStayComplementAmount} settled={endOfStaySettled} cash={!!r.endOfStayComplementPaidCash} />
                  </TableCell>
                )}
                <TableCell align="center" sx={{ color: remainingToPay > 0 ? 'error.main' : 'success.main', fontWeight: 700 }}>
                  {Math.round(remainingToPay * 100) / 100}€
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>{eur(r.totalSejour)}</TableCell>
                {interactive && (
                  <TableCell align="center" onClick={stop}>
                    <Tooltip title="Tout solder">
                      <IconButton size="small" color="success" onClick={() => onSettleAll?.(r)} aria-label="Tout solder">
                        <DoneAllIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={4} sx={footerCellSx}>Total</TableCell>
            <TableCell align="center" sx={footerCellSx}>{eur(totals.depositAmount)}</TableCell>
            <TableCell align="center" sx={footerCellSx}>{eur(totals.balanceAmount)}</TableCell>
            <TableCell align="center" sx={footerCellSx}>{eur(totals.complementAmount)}</TableCell>
            {showEndOfStayComplement && <TableCell align="center" sx={footerCellSx}>{eur(totals.endOfStayComplementAmount)}</TableCell>}
            <TableCell align="center" sx={footerCellSx}>{eur(totals.remainingToPay)}</TableCell>
            <TableCell align="right" sx={footerCellSx}>{eur(totals.totalSejour)}</TableCell>
            {interactive && <TableCell sx={footerCellSx} />}
          </TableRow>
        </TableFooter>
      </Table>
    </TableContainer>
  );
}
