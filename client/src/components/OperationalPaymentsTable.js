import React from 'react';
import {
  Box, Stack, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TableFooter, Checkbox, Tooltip, IconButton, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import { displayDate, formatCurrency } from '../utils/formatters';
import PlatformChip from './PlatformChip';

/**
 * OperationalPaymentsTable — the shared « Suivi opérationnel » payments table.
 * Drives both « Paiements en attente » (interactive, 4 buckets) and « Réservations à venir »
 * (read-only, 3 buckets) from one implementation (specs/finance-upcoming-payments-table.md §4.2).
 *
 * Since the phase-4 sweep (specs/ds-sweep-finance.md §3.5): money columns are right-aligned in
 * tabular figures via formatCurrency, and on xs the table becomes stacked cards (this is the block's
 * most operator-critical list). The totals footer becomes a summary card on xs.
 *
 * Props:
 *  - rows:     enriched reservations (server-shaped amounts + *Paid/*PaidCash flags + due dates).
 *  - totals:   column totals.
 *  - interactive: when true, Acompte/Solde get a paid checkbox and a « Tout solder » action.
 *  - showEndOfStayComplement: when true, adds the « Compl. fin de séjour » column.
 *  - onTogglePayment(row, field) / onSettleAll(row) / onOpenReservation(id).
 *  - minWidth: md+ table min width (px) before horizontal scroll.
 */

const TABULAR = { fontVariantNumeric: 'tabular-nums' };

// Complement bucket amount: green when settled, red when owed, muted « — » when nothing to collect.
function PaymentBucketAmount({ amount, settled, cash }) {
  const n = Number(amount || 0);
  if (n <= 0) return <Typography variant="body2" sx={{ color: 'text.disabled', ...TABULAR }}>—</Typography>;
  return (
    <Box>
      <Typography variant="body2" sx={{ color: settled ? 'success.main' : 'error.main', fontWeight: 600, ...TABULAR }}>{formatCurrency(n)}</Typography>
      {cash && <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>caisse</Typography>}
    </Box>
  );
}

// Acompte / Solde amount coloured by paid state + due date; « Désactivé » when the bucket is off.
function ScheduledBucketAmount({ amount, paid, dueDate, overdue, disabled }) {
  if (disabled) {
    return <Typography variant="body2" sx={{ fontStyle: 'italic', color: 'text.disabled' }}>Désactivé</Typography>;
  }
  return (
    <Box>
      <Typography variant="body2" sx={{ color: paid ? 'success.main' : 'error.main', fontWeight: overdue ? 700 : 600, ...TABULAR }}>{formatCurrency(amount)}</Typography>
      {dueDate && <Typography variant="caption" sx={{ display: 'block', color: overdue ? 'error.main' : 'text.secondary', fontWeight: overdue ? 700 : 400 }}>{displayDate(dueDate)}</Typography>}
    </Box>
  );
}

// md+ scheduled cell: the amount, right-aligned, with an optional leading checkbox in interactive mode.
function ScheduledBucketCell({ interactive, onToggle, paid, ...amountProps }) {
  const amount = <ScheduledBucketAmount paid={paid} {...amountProps} />;
  if (!interactive || amountProps.disabled) return amount;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
      <Checkbox checked={!!paid} onChange={onToggle} size="small" />
      {amount}
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
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));
  const footerCellSx = { fontWeight: 700, borderTop: '2px solid', borderTopColor: 'divider', ...TABULAR };
  const stop = (e) => e.stopPropagation();

  // ---- xs: stacked cards + a totals summary ----
  if (isXs) {
    const Line = ({ label, children }) => (
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 1 }}>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
        <Box sx={{ textAlign: 'right' }}>{children}</Box>
      </Stack>
    );
    return (
      <Stack spacing={1.5}>
        {rows.map((r) => {
          const complementSettled = !!r.complementPaid || !!r.complementPaidCash;
          const endOfStaySettled = !!r.endOfStayComplementPaid || !!r.endOfStayComplementPaidCash;
          return (
            <Box key={r.id} onClick={() => onOpenReservation?.(r.id)} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, cursor: 'pointer' }}>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.firstName} {r.lastName}</Typography>
                  <Typography variant="caption" color="text.secondary">{r.propertyName} · {displayDate(r.startDate)} → {displayDate(r.endDate)}</Typography>
                </Box>
                <PlatformChip platform={r.platform} />
              </Stack>
              <Stack spacing={0.5} divider={<Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }} />}>
                <Line label="Acompte">
                  <Box onClick={interactive ? stop : undefined} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
                    {interactive && !r.depositDisabled && <Checkbox checked={!!r.depositPaid} onChange={() => onTogglePayment?.(r, 'depositPaid')} size="small" sx={{ p: 0.25 }} />}
                    <ScheduledBucketAmount amount={r.depositAmount} paid={!!r.depositPaid} dueDate={r.depositDueDate} overdue={r.depositOverdue} disabled={r.depositDisabled} />
                  </Box>
                </Line>
                <Line label="Solde">
                  <Box onClick={interactive ? stop : undefined} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
                    {interactive && <Checkbox checked={!!r.balancePaid} onChange={() => onTogglePayment?.(r, 'balancePaid')} size="small" sx={{ p: 0.25 }} />}
                    <ScheduledBucketAmount amount={r.balanceAmount} paid={!!r.balancePaid} dueDate={r.balanceDueDate} overdue={r.balanceOverdue} />
                  </Box>
                </Line>
                {/* specs/defer-arrival-complement-to-checkout.md §3.2 rule 10 — a deferred complement
                    is collected at the door, not at check-in: label it as such (amount unchanged). */}
                <Line label={r.complementDeferredToCheckout && !complementSettled ? 'Complément (fin de séjour)' : 'Complément'}>
                  <PaymentBucketAmount amount={r.complementAmount} settled={complementSettled} cash={!!r.complementPaidCash} />
                </Line>
                {showEndOfStayComplement && <Line label="Compl. fin de séjour"><PaymentBucketAmount amount={r.endOfStayComplementAmount} settled={endOfStaySettled} cash={!!r.endOfStayComplementPaidCash} /></Line>}
                <Line label="Reste à payer">
                  <Typography variant="body2" sx={{ color: r.remainingToPay > 0 ? 'error.main' : 'success.main', fontWeight: 700, ...TABULAR }}>{formatCurrency(r.remainingToPay)}</Typography>
                </Line>
                <Line label="Total de séjour">
                  <Typography variant="body2" sx={{ fontWeight: 700, ...TABULAR }}>{formatCurrency(r.totalSejour)}</Typography>
                </Line>
              </Stack>
              {interactive && (
                <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end' }} onClick={stop}>
                  <Tooltip title="Tout solder">
                    <IconButton size="small" color="success" onClick={() => onSettleAll?.(r)} aria-label="Tout solder"><DoneAllIcon fontSize="small" /></IconButton>
                  </Tooltip>
                </Box>
              )}
            </Box>
          );
        })}
        <Box sx={{ p: 1.5, border: '2px solid', borderColor: 'divider', borderRadius: 2 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>Total</Typography>
          <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 0.5 }}>
            <Typography variant="body2">Reste à payer</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, ...TABULAR }}>{formatCurrency(totals.remainingToPay)}</Typography>
          </Stack>
          <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
            <Typography variant="body2">Total de séjour</Typography>
            <Typography variant="body2" sx={{ fontWeight: 700, ...TABULAR }}>{formatCurrency(totals.totalSejour)}</Typography>
          </Stack>
        </Box>
      </Stack>
    );
  }

  // ---- md+: table with right-aligned tabular numerics + totals footer ----
  return (
    <TableContainer>
      <Table size="small" sx={{ minWidth }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ fontWeight: 600 }}>Client</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Logement</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Séjour</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>Plateforme</TableCell>
            <TableCell sx={{ fontWeight: 600 }} align="right">Acompte</TableCell>
            <TableCell sx={{ fontWeight: 600 }} align="right">Solde</TableCell>
            <TableCell sx={{ fontWeight: 600 }} align="right">Complément</TableCell>
            {showEndOfStayComplement && <TableCell sx={{ fontWeight: 600 }} align="right">Compl. fin de séjour</TableCell>}
            <TableCell sx={{ fontWeight: 600 }} align="right">Reste à payer</TableCell>
            <TableCell sx={{ fontWeight: 600 }} align="right">Total de séjour</TableCell>
            {interactive && <TableCell sx={{ fontWeight: 600 }} align="center">Solder</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => {
            const complementSettled = !!r.complementPaid || !!r.complementPaidCash;
            const endOfStaySettled = !!r.endOfStayComplementPaid || !!r.endOfStayComplementPaidCash;
            return (
              <TableRow key={r.id} hover sx={{ cursor: 'pointer' }} onClick={() => onOpenReservation?.(r.id)}>
                <TableCell>{r.firstName} {r.lastName}</TableCell>
                <TableCell>{r.propertyName}</TableCell>
                <TableCell>{displayDate(r.startDate)} → {displayDate(r.endDate)}</TableCell>
                <TableCell><PlatformChip platform={r.platform} /></TableCell>
                <TableCell align="right" onClick={interactive ? stop : undefined}>
                  <ScheduledBucketCell amount={r.depositAmount} paid={!!r.depositPaid} dueDate={r.depositDueDate} overdue={r.depositOverdue} disabled={r.depositDisabled} interactive={interactive} onToggle={() => onTogglePayment?.(r, 'depositPaid')} />
                </TableCell>
                <TableCell align="right" onClick={interactive ? stop : undefined}>
                  <ScheduledBucketCell amount={r.balanceAmount} paid={!!r.balancePaid} dueDate={r.balanceDueDate} overdue={r.balanceOverdue} interactive={interactive} onToggle={() => onTogglePayment?.(r, 'balancePaid')} />
                </TableCell>
                <TableCell align="right">
                  <PaymentBucketAmount amount={r.complementAmount} settled={complementSettled} cash={!!r.complementPaidCash} />
                </TableCell>
                {showEndOfStayComplement && (
                  <TableCell align="right">
                    <PaymentBucketAmount amount={r.endOfStayComplementAmount} settled={endOfStaySettled} cash={!!r.endOfStayComplementPaidCash} />
                  </TableCell>
                )}
                <TableCell align="right" sx={{ color: r.remainingToPay > 0 ? 'error.main' : 'success.main', fontWeight: 700, ...TABULAR }}>
                  {formatCurrency(r.remainingToPay)}
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, ...TABULAR }}>{formatCurrency(r.totalSejour)}</TableCell>
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
            <TableCell align="right" sx={footerCellSx}>{formatCurrency(totals.depositAmount)}</TableCell>
            <TableCell align="right" sx={footerCellSx}>{formatCurrency(totals.balanceAmount)}</TableCell>
            <TableCell align="right" sx={footerCellSx}>{formatCurrency(totals.complementAmount)}</TableCell>
            {showEndOfStayComplement && <TableCell align="right" sx={footerCellSx}>{formatCurrency(totals.endOfStayComplementAmount)}</TableCell>}
            <TableCell align="right" sx={footerCellSx}>{formatCurrency(totals.remainingToPay)}</TableCell>
            <TableCell align="right" sx={footerCellSx}>{formatCurrency(totals.totalSejour)}</TableCell>
            {interactive && <TableCell sx={footerCellSx} />}
          </TableRow>
        </TableFooter>
      </Table>
    </TableContainer>
  );
}
