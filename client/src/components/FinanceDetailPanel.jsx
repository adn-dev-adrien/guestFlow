/**
 * FinanceDetailPanel — the table opened by a tile of the Suivi financier
 * (specs/finance-dashboard-redesign.md §3.5 rule 13). Feature-local: each body renders the server's
 * `/finance/dashboard/detail/:tile` payload as is — every amount, total and label comes ready-made.
 * Tables become cards on `xs` (rule 16) through ResponsiveTable / OperationalPaymentsTable.
 *
 * Props:
 *   id:                 string   the panel id (aria-controls of its tile)
 *   tile:               'collected' | 'toCollect' | 'incoming' | 'late' | 'stays' | 'properties' | 'channels'
 *   data:               the detail payload, or null while loading
 *   loading, error:     request state; `onRetry` retries
 *   windowLabel:        string   « Exercice 2026 »…
 *   staysScope:         'window' | 'upcoming';  onStaysScopeChange(scope)
 *   incomingRecent:     boolean;                onIncomingRecentChange(boolean) — « Versements à venir » (specs/mollie-rolling-reserve-and-incoming-payments.md rule 24)
 *   onClose, onOpenReservation(id), onSettleOverdue(row) (ticks only the row's `overdueItems`), onSelectProperty(id)
 *
 * « Encaissé » and « Reste à encaisser » list one line per payment, grouped by month with the month's subtotal
 * (specs/mobile-dashboard-exercise-cash.md rules 16-17); a line opens the fiche.
 */
import React from 'react';
import {
  Box, Button, Card, CardContent, Chip, IconButton, Stack, TableCell, TableRow,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ResponsiveTable from './ResponsiveTable';
import OperationalPaymentsTable from './OperationalPaymentsTable';
import PlatformChip from './PlatformChip';
import IncomingPaymentsTable from './finance/IncomingPaymentsTable';
import LoadingState from './LoadingState';
import ErrorAlert from './ErrorAlert';
import YearOverYearBadge from './YearOverYearBadge';
import { displayDate, formatCurrency, formatCurrencyRounded, plural } from '../utils/formatters';
import { seriesColor } from '../utils/chartColors';

const TAB = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)} %`);
const money = (n) => (n == null ? '—' : formatCurrencyRounded(n));

const TITLES = {
  collected: ['Encaissé', 'Chaque paiement reçu pour les séjours de la période, par mois, du plus récent au plus ancien'],
  incoming: ['Versements à venir', 'Ce que la banque va recevoir, par client · sans rapport avec la période'],
  toCollect: ['Reste à encaisser', 'Ce que les séjours de la période doivent encore, paiement par paiement, dans l\'ordre où l\'argent arrive'],
  late: ['En retard', 'Échéances dépassées des réservations en direct et versements plateforme attendus, tous exercices'],
  stays: ['Réservations', 'Rattachées à la période par leur date comptable'],
  properties: ['Logements', 'Nuits, occupation, revenu moyen par nuit vendue, RevPAR (revenu des nuits ÷ nuits ouvertes)'],
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

const LIST_COLUMNS = '110px minmax(0, 1.2fr) minmax(0, 1fr) 130px minmax(0, 1.1fr) 110px';

// One line per payment under its month's header (date · amount, then client · logement · kind on a phone).
function PaymentLine({ row, tone, onOpen }) {
  const color = row.amount < 0 || row.late ? 'error.main' : (tone === 'received' ? 'success.main' : 'text.primary');
  return (
    <Box
      component="button"
      type="button"
      onClick={() => onOpen(row.reservationId)}
      aria-label={`${row.label} de ${row.clientName}, ${row.dateLabel}, ${formatCurrency(row.amount)}`}
      sx={{
        display: 'grid', width: '100%', textAlign: 'left', font: 'inherit', color: 'inherit', bgcolor: 'transparent', border: 0, borderTop: '1px solid', borderColor: 'divider',
        cursor: 'pointer', minHeight: 44, px: 1, py: 0.75, alignItems: 'center', columnGap: 1.5,
        gridTemplateColumns: { xs: '1fr auto', md: LIST_COLUMNS },
        '&:hover': { bgcolor: 'action.hover' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
      }}
    >
      <Typography variant="body2" sx={{ ...TAB, gridColumn: { xs: 1, md: 'auto' }, gridRow: { xs: 1, md: 'auto' } }}>{row.dateLabel}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, gridColumn: { xs: '1 / -1', md: 'auto' }, gridRow: { xs: 2, md: 'auto' }, display: { xs: 'none', md: 'block' } }}>{row.clientName}</Typography>
      <Typography variant="body2" sx={{ display: { xs: 'none', md: 'block' } }}>{row.propertyName}</Typography>
      <Box sx={{ display: { xs: 'none', md: 'block' } }}><PlatformChip platform={row.platform} /></Box>
      <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 1 }}>
        <span>{row.label}</span>{row.late && <Chip size="small" color="error" variant="outlined" label="En retard" />}
      </Box>
      <Typography variant="body2" sx={{ ...TAB, fontWeight: 700, color, textAlign: 'right', gridColumn: { xs: 2, md: 'auto' }, gridRow: { xs: 1, md: 'auto' } }}>
        {tone === 'received' && row.amount > 0 ? '+ ' : ''}{formatCurrency(row.amount)}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'block', md: 'none' }, gridColumn: '1 / -1', gridRow: 2 }}>
        {row.clientName} · {row.propertyName} · {row.label}{row.late ? ' · en retard' : ''}
      </Typography>
    </Box>
  );
}

function MonthGroups({ groups, tone, emptyText, onOpen }) {
  if (groups.length === 0) return <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>{emptyText}</Typography>;
  return (
    <Stack spacing={1.5}>
      <Box role="row" sx={(t) => ({ display: 'grid', columnGap: 1.5, px: 1, gridTemplateColumns: LIST_COLUMNS, color: 'text.secondary', typography: 'caption', [t.breakpoints.down('md')]: { display: 'none' } })}>
        {['Date', 'Client', 'Logement', 'Plateforme', 'Paiement'].map((h) => <span key={h} role="columnheader">{h}</span>)}
        <span role="columnheader" style={{ textAlign: 'right' }}>Montant</span>
      </Box>
      {groups.map((g) => (
        <Box key={g.key} component="section" aria-label={g.label}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, px: 1, pb: 0.5, fontWeight: 700, color: g.key === 'late' ? 'error.main' : 'text.primary', ...TAB }}>
            <span>{g.label}</span><span>{formatCurrency(g.total)}</span>
          </Box>
          {g.rows.map((r) => <PaymentLine key={`${r.reservationId}-${r.kind}-${r.label}-${r.date}-${r.amount}`} row={r} tone={tone} onOpen={onOpen} />)}
        </Box>
      ))}
    </Stack>
  );
}

function CollectedTable({ data, onOpenReservation }) {
  return (
    <>
      <MonthGroups groups={data.groups} tone="received" emptyText="Aucun paiement reçu pour les séjours de la période." onOpen={onOpenReservation} />
      {data.rows.length > 0 && <Total label={`Total encaissé · ${plural(data.totals.count, 'paiement')}`}>{formatCurrency(data.totals.amount)}</Total>}
    </>
  );
}

function ToCollectTable({ data, onOpenReservation }) {
  return (
    <>
      <MonthGroups groups={data.groups} tone="expected" emptyText="Tout est encaissé pour les séjours de la période." onOpen={onOpenReservation} />
      {data.rows.length > 0 && <Total label={`Total à encaisser · ${plural(data.totals.payments, 'paiement')}`}>{formatCurrency(data.totals.amount)}</Total>}
    </>
  );
}

function LateTable({ data, onOpenReservation, onSettleOverdue }) {
  const chips = (r) => (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      {(r.overdueItems || []).map((item) => (
        <Chip
          key={item.kind}
          size="small"
          color="error"
          variant="outlined"
          label={`${item.label} ${formatCurrency(item.amount)} · échu ${displayDate(item.dueDate)}`}
          sx={{ height: 'auto', maxWidth: '100%', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.25 } }}
        />
      ))}
    </Box>
  );
  const settle = (r) => (e) => { e.stopPropagation(); onSettleOverdue(r); };
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

function StaysTable({ data, emptyText, onOpenReservation }) {
  const paymentChips = (r) => (r.amountMissing ? (
    <Chip size="small" color="warning" variant="outlined" label="Montant à saisir" />
  ) : (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
      <Chip size="small" color={r.settled ? 'success' : 'warning'} label={r.settled ? 'Réglé' : `Reste ${formatCurrency(r.remainingDue)}`} />
      {r.depositDisabled
        ? <Chip size="small" variant="outlined" label="Acompte désactivé" sx={{ fontStyle: 'italic' }} />
        : <Chip size="small" color={r.depositPaid ? 'success' : 'default'} variant={r.depositPaid ? 'filled' : 'outlined'} label={`Acompte ${r.depositPaid ? 'payé' : 'non payé'}${r.depositDueDate && !r.depositPaid ? ` (${displayDate(r.depositDueDate)})` : ''}`} />}
      <Chip size="small" color={r.balancePaid ? 'success' : 'default'} variant={r.balancePaid ? 'filled' : 'outlined'} label={`Solde ${r.balancePaid ? 'payé' : 'non payé'}${r.balanceDueDate && !r.balancePaid ? ` (${displayDate(r.balanceDueDate)})` : ''}`} />
    </Box>
  ));
  return (
    <>
      <ResponsiveTable
        items={data.rows}
        getKey={(r) => r.id}
        emptyText={emptyText}
        minWidth={980}
        onItemClick={(r) => onOpenReservation(r.id)}
        head={(
          <TableRow>
            <TableCell>Client</TableCell><TableCell>Logement</TableCell><TableCell>Dates</TableCell><TableCell>Plateforme</TableCell>
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
            <TableCell align="right">{data.showHt === false ? 'Revenu' : 'TTC'}</TableCell>
            {data.showHt !== false && <TableCell align="right">HT</TableCell>}
            <TableCell align="right">vs N-1</TableCell>
          </TableRow>
        )}
        renderRow={(r) => (
          <TableRow key={r.propertyId} hover sx={{ cursor: 'pointer' }} onClick={() => onSelectProperty(r.propertyId)}>
            <TableCell><Box component="span" sx={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', bgcolor: seriesColor(r.colorIndex), mr: 1 }} />{r.name}</TableCell>
            <TableCell align="right" sx={TAB}>{r.nights}</TableCell>
            <TableCell align="right" sx={TAB}>{pct(r.occupancy)}</TableCell>
            <TableCell align="right" sx={TAB}>{money(r.revenuePerNight)}</TableCell>
            <TableCell align="right" sx={TAB}>{money(r.revPar)}</TableCell>
            <TableCell align="right" sx={{ ...TAB, fontWeight: 700 }}>{formatCurrencyRounded(r.revenue)}</TableCell>
            {data.showHt !== false && <TableCell align="right" sx={TAB}>{formatCurrencyRounded(r.revenueHt)}</TableCell>}
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
  id, tile, data, loading, error, onRetry, windowLabel, staysScope, onStaysScopeChange, incomingRecent = false, onIncomingRecentChange = () => {},
  onClose, onOpenReservation, onSettleOverdue, onSelectProperty,
}) {
  const [title, caption] = TITLES[tile];
  const windowed = !['late', 'incoming'].includes(tile) && !(tile === 'stays' && staysScope === 'upcoming');
  const staysEmptyText = staysScope === 'unpriced' ? 'Aucun séjour sans montant sur la période.' : 'Aucune réservation sur la période.';
  let body = null;
  if (error) body = <ErrorAlert message="Impossible de charger ce tableau." onRetry={onRetry} />;
  else if (loading || !data) body = <LoadingState label="Chargement du tableau…" />;
  else if (tile === 'collected') body = <CollectedTable data={data} onOpenReservation={onOpenReservation} />;
  else if (tile === 'incoming') body = <IncomingPaymentsTable data={data} recent={incomingRecent} onRecentChange={onIncomingRecentChange} onOpenReservation={onOpenReservation} />;
  else if (tile === 'late') body = <LateTable data={data} onOpenReservation={onOpenReservation} onSettleOverdue={onSettleOverdue} />;
  else if (tile === 'properties') body = <PropertiesTable data={data} onSelectProperty={onSelectProperty} />;
  else if (tile === 'channels') body = <ChannelsTable data={data} />;
  else if (tile === 'stays' && data.scope === 'upcoming') {
    body = <OperationalPaymentsTable rows={data.rows} totals={data.totals} onOpenReservation={onOpenReservation} minWidth={960} />;
  } else if (tile === 'stays') body = <StaysTable data={data} emptyText={staysEmptyText} onOpenReservation={onOpenReservation} />;
  else if (tile === 'toCollect') body = <ToCollectTable data={data} onOpenReservation={onOpenReservation} />;

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
              <ToggleButtonGroup exclusive size="small" value={staysScope} onChange={(_, v) => v && onStaysScopeChange(v)} aria-label="Réservations" sx={{ '& .MuiToggleButton-root': { textTransform: 'none', minHeight: 36, '@media (pointer: coarse)': { minHeight: 44 } } }}>
                <ToggleButton value="window">De la période</ToggleButton>
                <ToggleButton value="upcoming">À venir</ToggleButton>
                <ToggleButton value="unpriced">Sans montant</ToggleButton>
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
