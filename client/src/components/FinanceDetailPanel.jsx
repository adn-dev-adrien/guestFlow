/**
 * FinanceDetailPanel — the table opened by a tile of the Suivi financier
 * (specs/finance-dashboard-redesign.md §3.5 rule 13). Feature-local: each body renders the server's
 * `/finance/dashboard/detail/:tile` payload as is — every amount, total and label comes ready-made.
 * Tables become cards on `xs` (rule 16) through ResponsiveTable / OperationalPaymentsTable.
 *
 * Props:
 *   id:                 string   the panel id (aria-controls of its tile)
 *   tile:               'collected' | 'toCollect' | 'late' | 'stays' | 'properties' | 'channels'
 *   data:               the detail payload, or null while loading
 *   loading, error:     request state; `onRetry` retries
 *   windowLabel:        string   « Exercice 2026 »…
 *   staysScope:         'window' | 'upcoming';  onStaysScopeChange(scope)
 *   until:              'YYYY-MM-DD';           onUntilChange(date)
 *   onClose, onOpenReservation(id), onTogglePayment(row, field), onSettleAll(row), onSelectProperty(id)
 */
import React from 'react';
import {
  Box, Button, Card, CardContent, Chip, IconButton, Stack, TableCell, TableRow, TextField,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ResponsiveTable from './ResponsiveTable';
import OperationalPaymentsTable from './OperationalPaymentsTable';
import PlatformChip from './PlatformChip';
import LoadingState from './LoadingState';
import ErrorAlert from './ErrorAlert';
import YearOverYearBadge from './YearOverYearBadge';
import { displayDate, formatCurrency, formatCurrencyRounded } from '../utils/formatters';

const TAB = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)} %`);
const money = (n) => (n == null ? '—' : formatCurrencyRounded(n));
const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;

const TITLES = {
  collected: ['Encaissé', 'Chaque paiement reçu pour les séjours de la période, du plus récent au plus ancien'],
  toCollect: ['À encaisser', 'Séjours terminés pas encore soldés, tous exercices · cochez un paiement à sa réception'],
  late: ['En retard', 'Échéances dépassées des réservations en direct, tous exercices · à relancer'],
  stays: ['Réservations', 'Rattachées à la période par leur date comptable'],
  properties: ['Logements', 'Nuits, occupation, revenu moyen par nuit vendue, RevPAR (revenu ÷ nuits ouvrables)'],
  channels: ['Canaux', 'Ce que chaque canal rapporte vraiment, commission déduite'],
};

function Total({ label, children }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, px: 1, pt: 1.25, mt: 0.5, borderTop: '2px solid', borderColor: 'divider', fontWeight: 700, ...TAB }}>
      <span>{label}</span><span>{children}</span>
    </Box>
  );
}

function Line({ label, children }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={TAB}>{children}</Typography>
    </Stack>
  );
}

function CollectedTable({ data, onOpenReservation }) {
  return (
    <>
      <ResponsiveTable
        items={data.rows}
        getKey={(r) => `${r.reservationId}-${r.kind}-${r.date}-${r.amount}`}
        emptyText="Aucun paiement reçu pour les séjours de la période."
        minWidth={760}
        onItemClick={(r) => onOpenReservation(r.reservationId)}
        head={(
          <TableRow>
            <TableCell>Date</TableCell><TableCell>Client</TableCell><TableCell>Logement</TableCell>
            <TableCell>Canal</TableCell><TableCell>Paiement</TableCell><TableCell align="right">Montant</TableCell>
          </TableRow>
        )}
        renderRow={(r) => (
          <TableRow key={`${r.reservationId}-${r.kind}-${r.date}-${r.amount}`} hover sx={{ cursor: 'pointer' }} onClick={() => onOpenReservation(r.reservationId)}>
            <TableCell sx={TAB}>{displayDate(r.date)}</TableCell>
            <TableCell>{r.clientName}</TableCell>
            <TableCell>{r.propertyName}</TableCell>
            <TableCell><PlatformChip platform={r.platform} /></TableCell>
            <TableCell>{r.label}</TableCell>
            <TableCell align="right" sx={{ ...TAB, fontWeight: 700, color: r.amount < 0 ? 'error.main' : 'success.main' }}>{r.amount > 0 ? '+ ' : ''}{formatCurrency(r.amount)}</TableCell>
          </TableRow>
        )}
        renderMobileCard={(r) => (
          <>
            <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.clientName}</Typography>
              <Typography variant="body2" sx={{ ...TAB, fontWeight: 700, color: r.amount < 0 ? 'error.main' : 'success.main' }}>{formatCurrency(r.amount)}</Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary">{displayDate(r.date)} · {r.label} · {r.propertyName}</Typography>
          </>
        )}
      />
      {data.rows.length > 0 && <Total label={`Total encaissé · ${plural(data.totals.count, 'paiement')}`}>{formatCurrency(data.totals.amount)}</Total>}
    </>
  );
}

function LateTable({ data, onOpenReservation, onSettleAll }) {
  const chips = (r) => (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {r.depositOverdue && <Chip size="small" color="error" variant="outlined" label={`Acompte ${formatCurrency(r.depositAmount)} · échu ${displayDate(r.depositDueDate)}`} />}
      {r.balanceOverdue && <Chip size="small" color="error" variant="outlined" label={`Solde ${formatCurrency(r.balanceAmount)} · échu ${displayDate(r.balanceDueDate)}`} />}
    </Box>
  );
  const settle = (r) => (e) => { e.stopPropagation(); onSettleAll(r); };
  return (
    <>
      <ResponsiveTable
        items={data.rows}
        getKey={(r) => r.id}
        emptyText="Aucun paiement en retard."
        minWidth={900}
        onItemClick={(r) => onOpenReservation(r.id)}
        head={(
          <TableRow>
            <TableCell>Client</TableCell><TableCell>Logement</TableCell><TableCell>Séjour</TableCell>
            <TableCell>Éléments en retard</TableCell><TableCell align="right">Montant</TableCell><TableCell />
          </TableRow>
        )}
        renderRow={(r) => (
          <TableRow key={r.id} hover sx={{ cursor: 'pointer' }} onClick={() => onOpenReservation(r.id)}>
            <TableCell>{r.firstName} {r.lastName}</TableCell>
            <TableCell>{r.propertyName}</TableCell>
            <TableCell sx={TAB}>{displayDate(r.startDate)} → {displayDate(r.endDate)}</TableCell>
            <TableCell>{chips(r)}</TableCell>
            <TableCell align="right" sx={{ ...TAB, fontWeight: 700, color: 'error.main' }}>{formatCurrency(r.overdueAmount)}</TableCell>
            <TableCell><Button size="small" variant="outlined" onClick={settle(r)}>Marquer payé</Button></TableCell>
          </TableRow>
        )}
        renderMobileCard={(r) => (
          <>
            <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.firstName} {r.lastName}</Typography>
              <Typography variant="body2" sx={{ ...TAB, fontWeight: 700, color: 'error.main' }}>{formatCurrency(r.overdueAmount)}</Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>{r.propertyName} · {displayDate(r.startDate)} → {displayDate(r.endDate)}</Typography>
            {chips(r)}
            <Button size="small" variant="outlined" sx={{ mt: 1 }} onClick={settle(r)}>Marquer payé</Button>
          </>
        )}
      />
      {data.rows.length > 0 && <Total label="Total en retard">{formatCurrency(data.totals.amount)}</Total>}
    </>
  );
}

function StaysTable({ data, onOpenReservation }) {
  const paymentChips = (r) => (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      <Chip size="small" color={r.settled ? 'success' : 'warning'} label={r.settled ? 'Réglé' : `Reste ${formatCurrency(r.remainingDue)}`} />
      {r.depositDisabled
        ? <Chip size="small" variant="outlined" label="Acompte désactivé" sx={{ fontStyle: 'italic' }} />
        : <Chip size="small" color={r.depositPaid ? 'success' : 'default'} variant={r.depositPaid ? 'filled' : 'outlined'} label={`Acompte ${r.depositPaid ? 'payé' : 'non payé'}${r.depositDueDate && !r.depositPaid ? ` (${displayDate(r.depositDueDate)})` : ''}`} />}
      <Chip size="small" color={r.balancePaid ? 'success' : 'default'} variant={r.balancePaid ? 'filled' : 'outlined'} label={`Solde ${r.balancePaid ? 'payé' : 'non payé'}${r.balanceDueDate && !r.balancePaid ? ` (${displayDate(r.balanceDueDate)})` : ''}`} />
    </Box>
  );
  return (
    <>
      <ResponsiveTable
        items={data.rows}
        getKey={(r) => r.id}
        emptyText="Aucune réservation sur la période."
        minWidth={980}
        onItemClick={(r) => onOpenReservation(r.id)}
        head={(
          <TableRow>
            <TableCell>Client</TableCell><TableCell>Logement</TableCell><TableCell>Dates</TableCell><TableCell>Canal</TableCell>
            <TableCell align="right">Nuits</TableCell><TableCell align="right">Total de séjour</TableCell><TableCell>Suivi paiement</TableCell>
          </TableRow>
        )}
        renderRow={(r) => (
          <TableRow key={r.id} hover sx={{ cursor: 'pointer' }} onClick={() => onOpenReservation(r.id)}>
            <TableCell>{r.clientName}</TableCell>
            <TableCell>{r.propertyName}</TableCell>
            <TableCell sx={TAB}>{displayDate(r.startDate)} → {displayDate(r.endDate)}</TableCell>
            <TableCell><PlatformChip platform={r.platform} /></TableCell>
            <TableCell align="right" sx={TAB}>{r.nights}</TableCell>
            <TableCell align="right" sx={{ ...TAB, fontWeight: 700 }}>{formatCurrency(r.totalSejour)}</TableCell>
            <TableCell>{paymentChips(r)}</TableCell>
          </TableRow>
        )}
        renderMobileCard={(r) => (
          <>
            <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.clientName}</Typography>
              <Typography variant="body2" sx={{ ...TAB, fontWeight: 700 }}>{formatCurrency(r.totalSejour)}</Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>{r.propertyName} · {displayDate(r.startDate)} → {displayDate(r.endDate)} · {plural(r.nights, 'nuit')}</Typography>
            {paymentChips(r)}
          </>
        )}
      />
      {data.rows.length > 0 && <Total label={`Total · ${plural(data.totals.count, 'séjour')} · ${plural(data.totals.nights, 'nuit')}`}>{formatCurrency(data.totals.totalSejour)}</Total>}
    </>
  );
}

function PropertiesTable({ data, onSelectProperty }) {
  const cmp = data.comparableMonths;
  const badge = (change) => <YearOverYearBadge change={change} months={cmp && cmp.months} totalMonths={cmp && cmp.totalMonths} />;
  return (
    <>
      <ResponsiveTable
        items={data.rows}
        getKey={(r) => r.propertyId}
        emptyText="Aucun logement."
        minWidth={900}
        onItemClick={(r) => onSelectProperty(r.propertyId)}
        head={(
          <TableRow>
            <TableCell>Logement</TableCell><TableCell align="right">Nuits</TableCell><TableCell align="right">Occupation</TableCell>
            <TableCell align="right">Revenu / nuit</TableCell><TableCell align="right">RevPAR</TableCell>
            <TableCell align="right">TTC</TableCell><TableCell align="right">HT</TableCell><TableCell align="right">vs N-1</TableCell>
          </TableRow>
        )}
        renderRow={(r) => (
          <TableRow key={r.propertyId} hover sx={{ cursor: 'pointer' }} onClick={() => onSelectProperty(r.propertyId)}>
            <TableCell><Box component="span" sx={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', bgcolor: r.color, mr: 1 }} />{r.name}</TableCell>
            <TableCell align="right" sx={TAB}>{r.nights}</TableCell>
            <TableCell align="right" sx={TAB}>{pct(r.occupancy)}</TableCell>
            <TableCell align="right" sx={TAB}>{money(r.revenuePerNight)}</TableCell>
            <TableCell align="right" sx={TAB}>{money(r.revPar)}</TableCell>
            <TableCell align="right" sx={{ ...TAB, fontWeight: 700 }}>{formatCurrencyRounded(r.revenue)}</TableCell>
            <TableCell align="right" sx={TAB}>{formatCurrencyRounded(r.revenueHt)}</TableCell>
            <TableCell align="right">{r.change == null ? <Typography variant="caption" color="text.secondary">—</Typography> : badge(r.change)}</TableCell>
          </TableRow>
        )}
        renderMobileCard={(r) => (
          <>
            <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{r.name}</Typography>
              <Typography variant="body2" sx={{ ...TAB, fontWeight: 700 }}>{formatCurrencyRounded(r.revenue)}</Typography>
            </Stack>
            <Line label="Occupation">{pct(r.occupancy)} · {plural(r.nights, 'nuit')}</Line>
            <Line label="Revenu / nuit · RevPAR">{money(r.revenuePerNight)} · {money(r.revPar)}</Line>
            {r.change != null && <Box sx={{ mt: 0.5 }}>{badge(r.change)}</Box>}
          </>
        )}
      />
      {data.rows.length > 1 && (
        <Total label={`Total · ${pct(data.totals.occupancy)} occupé · ${money(data.totals.revenuePerNight)} / nuit`}>{formatCurrencyRounded(data.totals.revenue)}</Total>
      )}
    </>
  );
}

function ChannelsTable({ data }) {
  const rate = (r) => (r.conversionRate == null ? '—' : `${String(r.conversionRate).replace('.', ',')} %`);
  const items = [
    ...(data.site.rows.length ? [{ group: true, key: 'site-header', label: 'Site internet', ...data.site.subtotal }] : []),
    ...data.site.rows.map((r) => ({ ...r, indent: true })),
    ...data.others,
  ];
  return (
    <>
      <ResponsiveTable
        items={items}
        getKey={(r) => r.key}
        emptyText="Aucune réservation sur la période."
        minWidth={900}
        head={(
          <TableRow>
            <TableCell>Canal</TableCell><TableCell align="right">Séjours</TableCell><TableCell align="right">Nuits</TableCell>
            <TableCell align="right">Brut</TableCell><TableCell align="right">Commission</TableCell><TableCell align="right">Net</TableCell>
            <TableCell align="right">Part</TableCell><TableCell align="right">Demandes · conversion</TableCell>
          </TableRow>
        )}
        renderRow={(r) => (
          <TableRow key={r.key} sx={r.group ? { bgcolor: 'rgba(60,54,36,0.04)' } : undefined}>
            <TableCell sx={{ pl: r.indent ? 4 : 2, fontWeight: r.group ? 700 : 400 }}>{r.label}</TableCell>
            <TableCell align="right" sx={TAB}>{r.reservations}</TableCell>
            <TableCell align="right" sx={TAB}>{r.nights}</TableCell>
            <TableCell align="right" sx={TAB}>{formatCurrencyRounded(r.gross)}</TableCell>
            <TableCell align="right" sx={{ ...TAB, color: r.commission ? 'error.main' : 'text.secondary' }}>{r.commission ? `− ${formatCurrencyRounded(r.commission)}` : '—'}</TableCell>
            <TableCell align="right" sx={{ ...TAB, fontWeight: 700 }}>{formatCurrencyRounded(r.revenue)}</TableCell>
            <TableCell align="right" sx={TAB}>{pct(r.share)}</TableCell>
            <TableCell align="right" sx={TAB}>{r.requests !== undefined ? `${r.requests} · ${rate(r)}` : ''}</TableCell>
          </TableRow>
        )}
        renderMobileCard={(r) => (
          <>
            <Stack direction="row" sx={{ justifyContent: 'space-between', gap: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: r.group ? 700 : 600, pl: r.indent ? 1.5 : 0 }}>{r.label}</Typography>
              <Typography variant="body2" sx={{ ...TAB, fontWeight: 700 }}>{formatCurrencyRounded(r.revenue)}</Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {plural(r.reservations, 'séjour')}{r.commission ? ` · commission ${formatCurrencyRounded(r.commission)}` : ''}{r.requests !== undefined ? ` · ${r.requests} demandes, ${rate(r)}` : ''}
            </Typography>
          </>
        )}
      />
      {items.length > 0 && (
        <Total label={`Total · ${plural(data.total.reservations, 'séjour')} · commissions − ${formatCurrencyRounded(data.total.commission)}`}>{formatCurrencyRounded(data.total.revenue)}</Total>
      )}
    </>
  );
}

export default function FinanceDetailPanel({
  id, tile, data, loading, error, onRetry, windowLabel, staysScope, onStaysScopeChange, until, onUntilChange,
  onClose, onOpenReservation, onTogglePayment, onSettleAll, onSelectProperty,
}) {
  const [title, caption] = TITLES[tile];
  const windowed = !['toCollect', 'late'].includes(tile) && !(tile === 'stays' && staysScope === 'upcoming');
  let body = null;
  if (error) body = <ErrorAlert message="Impossible de charger ce tableau." onRetry={onRetry} />;
  else if (loading || !data) body = <LoadingState label="Chargement du tableau…" />;
  else if (tile === 'collected') body = <CollectedTable data={data} onOpenReservation={onOpenReservation} />;
  else if (tile === 'late') body = <LateTable data={data} onOpenReservation={onOpenReservation} onSettleAll={onSettleAll} />;
  else if (tile === 'properties') body = <PropertiesTable data={data} onSelectProperty={onSelectProperty} />;
  else if (tile === 'channels') body = <ChannelsTable data={data} />;
  else if (tile === 'stays' && data.scope === 'upcoming') {
    body = <OperationalPaymentsTable rows={data.rows} totals={data.totals} onOpenReservation={onOpenReservation} minWidth={960} />;
  } else if (tile === 'stays') body = <StaysTable data={data} onOpenReservation={onOpenReservation} />;
  else if (tile === 'toCollect') {
    body = (
      <>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: { xs: 1, sm: 2.5 }, bgcolor: 'rgba(60,54,36,0.04)', borderRadius: 2.5, px: 1.5, py: 1.25, mb: 1.5 }}>
          <TextField size="small" type="date" label="Arrivées d'ici le" value={until} onChange={(e) => e.target.value && onUntilChange(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <Typography variant="body2" sx={TAB}>Total de séjour <b>{formatCurrencyRounded(data.projection.total)}</b></Typography>
          <Typography variant="body2" sx={TAB}>Déjà encaissé <b>{formatCurrencyRounded(data.projection.collected)}</b></Typography>
          <Typography variant="body2" sx={TAB}>Reste <b>{formatCurrencyRounded(data.projection.pending)}</b></Typography>
        </Box>
        {data.rows.length === 0
          ? <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>Aucun paiement en attente.</Typography>
          : <OperationalPaymentsTable rows={data.rows} totals={data.totals} interactive showEndOfStayComplement onTogglePayment={onTogglePayment} onSettleAll={onSettleAll} onOpenReservation={onOpenReservation} minWidth={1180} />}
      </>
    );
  }

  return (
    <Card id={id} role="region" aria-label={title} sx={{ my: 1.5, border: '1.5px solid', borderColor: 'primary.main' }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1.5, flexWrap: 'wrap', mb: 1.5 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="sectionHeader">{title}{windowed ? ` · ${windowLabel}` : ''}</Typography>
            <Typography variant="body2" color="text.secondary">{caption}</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {tile === 'stays' && (
              <ToggleButtonGroup exclusive size="small" value={staysScope} onChange={(_, v) => v && onStaysScopeChange(v)} aria-label="Réservations" sx={{ '& .MuiToggleButton-root': { textTransform: 'none', minHeight: 36 } }}>
                <ToggleButton value="window">De la période</ToggleButton>
                <ToggleButton value="upcoming">À venir</ToggleButton>
              </ToggleButtonGroup>
            )}
            <Tooltip title="Fermer">
              <IconButton onClick={onClose} aria-label="Fermer le tableau" sx={{ border: 1, borderColor: 'divider', minWidth: 44, minHeight: 44 }}><CloseIcon fontSize="small" /></IconButton>
            </Tooltip>
          </Box>
        </Box>
        {body}
      </CardContent>
    </Card>
  );
}
