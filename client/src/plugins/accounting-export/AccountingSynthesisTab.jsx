/**
 * AccountingSynthesisTab — the « Synthèse » tab of Comptabilité (specs/accounting-synthesis.md rules 25-30):
 * four figures against last year, the one notice that says why there is no comparison, the checks strip, the
 * VAT to declare by rate or by account, the collected running total against last year. Renders the server's
 * payload as is: no figure is computed here. Feature-local: it arranges the report grammar on this payload.
 *
 * Props:
 *   data:               the GET /api/accounting/synthesis payload
 *   canOpenReservation: boolean — admins open a stay; the accountant reads its name only
 *   onOpenEntriesMonth: ({ month, year }) => void — « Écritures » on the month of an entry
 */
import React, { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  Box, Grid, Link, Table, TableBody, TableCell, TableFooter, TableHead, TableRow, ToggleButton, ToggleButtonGroup, Typography, Button,
} from '@mui/material';
import {
  SelectableTile, NoComparisonNotice, Panel, TrendChart, formatCurrency, formatCurrencyRounded, displayDate,
} from '../sdk';
import {
  KPI, SOURCE_CAPTIONS, CHECKS, CHECKS_FAILED, VAT_PANEL, payments as paymentsLabel, stays as staysLabel, entries as entriesLabel, axisEuro,
} from './synthesisCopy';

const rate = (r) => `${String(r).replace('.', ',')} %`;

function Source({ source, sx }) {
  return <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ...sx }}>{SOURCE_CAPTIONS[source]}</Typography>;
}

// The tile's second line and, under it, what the figure is computed on (D-HC8).
const caption = (line, source) => (
  <>
    {line}
    {line ? <br /> : null}
    {SOURCE_CAPTIONS[source]}
  </>
);

const pillOf = (yoy) => (yoy ? { change: yoy.change, previous: formatCurrencyRounded(yoy.previous) } : { change: null });

function KpiRow({ kpis }) {
  const { revenue, collected, touristTax, vat } = kpis;
  const vatTop = vat.mainRate;
  const tiles = [
    {
      key: 'revenue', ...KPI.revenue,
      // R2-10 — outside the VAT the figure is the TTC one: the label says « CA ».
      label: revenue.showHt ? KPI.revenue.label : 'CA',
      value: formatCurrency(revenue.showHt ? revenue.ht : revenue.ttc),
      caption: caption(revenue.showHt ? `TTC : ${formatCurrencyRounded(revenue.ttc)}` : staysLabel(revenue.stays), revenue.source),
      comparison: pillOf(revenue.yoy),
    },
    {
      key: 'collected', ...KPI.collected,
      value: formatCurrency(collected.amount),
      caption: caption(paymentsLabel(collected.payments), collected.source),
      comparison: pillOf(collected.yoy),
    },
    {
      key: 'touristTax', ...KPI.touristTax,
      value: touristTax.amount == null ? '—' : formatCurrency(touristTax.amount),
      caption: caption(
        touristTax.amount == null ? touristTax.reason
          : (touristTax.until ? `${staysLabel(touristTax.stays)} · jusqu’à ${touristTax.until}` : staysLabel(touristTax.stays)),
        touristTax.source,
      ),
      comparison: touristTax.amount == null ? undefined : pillOf(touristTax.yoy),
    },
    vat.notSubject
      ? { key: 'vat', ...KPI.vat, value: vat.notSubject.label, caption: caption('', vat.source) }
      : {
        key: 'vat', ...KPI.vat,
        value: formatCurrency(vat.amount),
        caption: caption(vatTop ? `dont ${rate(vatTop.ratePercent)} : ${formatCurrencyRounded(vatTop.vat)}` : '', vat.source),
        comparison: pillOf(vat.yoy),
      },
  ];
  return (
    <Grid container spacing={1.5}>
      {tiles.map((t) => (
        <Grid key={t.key} size={{ xs: 6, lg: 3 }}>
          <SelectableTile label={t.label} value={t.value} caption={t.caption} info={t.info} comparison={t.comparison} />
        </Grid>
      ))}
    </Grid>
  );
}

const DOT = { ok: 'success.main', gap: 'warning.main', error: 'error.main', info: 'info.main', rounding: 'text.disabled' };

function Check({ tone, title, children, testId }) {
  return (
    <Box data-testid={testId} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', minWidth: 0 }}>
      <Box component="span" aria-hidden="true" sx={{ mt: '6px', width: 8, height: 8, borderRadius: '50%', flex: 'none', bgcolor: DOT[tone] }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>{title}</Typography>
        <Typography component="div" variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{children}</Typography>
      </Box>
    </Box>
  );
}

function ChecksStrip({ checks, canOpenReservation, onOpenEntriesMonth }) {
  const [open, setOpen] = useState(null);
  const { balanced, vatCoherence, settled, lastExport } = checks;
  const toggle = (key) => setOpen((o) => (o === key ? null : key));
  const seeButton = (key, text) => (
    <Button size="small" variant="text" onClick={() => toggle(key)} aria-expanded={open === key} sx={{ p: 0, minWidth: 0, minHeight: 0, verticalAlign: 'baseline', textTransform: 'none', fontSize: 'inherit', '@media (pointer: coarse)': { minHeight: 44 } }}>
      {open === key ? 'masquer' : text}
    </Button>
  );
  const openMonth = (iso) => onOpenEntriesMonth({ month: Number(iso.slice(5, 7)), year: Number(iso.slice(0, 4)) });
  return (
    <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: '14px', p: { xs: 1.5, sm: 2 } }}>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(4, 1fr)' } }}>
        <Check testId="check-balanced" tone={balanced.status === 'ok' ? 'ok' : 'error'} title={balanced.status === 'ok' ? CHECKS.balanced : CHECKS_FAILED.balanced}>
          {balanced.status === 'ok'
            ? `Débits = crédits : ${formatCurrency(balanced.totalDebits)}`
            : <>{entriesLabel(balanced.unbalanced.length)} déséquilibrée{balanced.unbalanced.length > 1 ? 's' : ''} · {seeButton('balanced', 'voir')}</>}
        </Check>
        {/* D-HC12 (rule 38) — a cent per entry is rounding, in grey; red only beyond, with its entries. */}
        <Check testId="check-vat" tone={{ ok: 'ok', rounding: 'rounding', gap: 'error' }[vatCoherence.status]} title={vatCoherence.status === 'gap' ? CHECKS_FAILED.vatCoherence : CHECKS.vatCoherence}>
          {vatCoherence.status === 'ok' && 'Aucun écart avec les écritures'}
          {vatCoherence.status === 'rounding' && `Écart d’arrondi : ${vatCoherence.roundingCents} ct`}
          {vatCoherence.status === 'gap' && (
            <>Écart de {formatCurrency(vatCoherence.gap)} · {seeButton('vat', `voir ${vatCoherence.entries.length > 1 ? `les ${entriesLabel(vatCoherence.entries.length)}` : 'l’écriture'}`)}</>
          )}
        </Check>
        <Check testId="check-settled" tone={settled.status === 'ok' ? 'ok' : 'gap'} title={settled.status === 'ok' ? CHECKS.settled : CHECKS_FAILED.settled}>
          {settled.status === 'ok'
            ? 'Tous les séjours terminés sont soldés'
            : <>{staysLabel(settled.count)} terminé{settled.count > 1 ? 's' : ''} non soldé{settled.count > 1 ? 's' : ''} · {seeButton('settled', 'voir')}</>}
        </Check>
        <Check testId="check-export" tone="info" title={CHECKS.lastExport}>
          {lastExport ? `${displayDate(lastExport.at.slice(0, 10))} à ${lastExport.at.slice(11, 16)} · ${lastExport.monthLabel}` : 'Aucun export'}
        </Check>
      </Box>

      {open === 'vat' && (
        <Box sx={{ mt: 2, overflowX: 'auto' }}>
          <Table size="small" aria-label="Écritures avec un écart de TVA">
            <TableHead><TableRow><TableCell>Date</TableCell><TableCell>Écriture</TableCell><TableCell align="right">TVA</TableCell><TableCell align="right">Attendue</TableCell><TableCell align="right">Écart</TableCell><TableCell /></TableRow></TableHead>
            <TableBody>
              {vatCoherence.entries.flatMap((e) => e.rates.map((r) => (
                <TableRow key={`${e.key}|${r.ratePercent}`}>
                  <TableCell>{displayDate(e.paidDate)}</TableCell>
                  <TableCell>{e.libelle} · {rate(r.ratePercent)}</TableCell>
                  <TableCell align="right">{formatCurrency(r.vat)}</TableCell>
                  <TableCell align="right">{formatCurrency(r.expectedVat)}</TableCell>
                  <TableCell align="right">{formatCurrency(r.gap)}</TableCell>
                  <TableCell><Link component="button" type="button" variant="caption" onClick={() => openMonth(e.paidDate)}>Écritures du mois</Link></TableCell>
                </TableRow>
              )))}
            </TableBody>
          </Table>
        </Box>
      )}
      {open === 'balanced' && (
        <Box component="ul" sx={{ mt: 2, mb: 0, pl: 2.5 }}>
          {balanced.unbalanced.map((e) => (
            <li key={e.key}><Typography variant="body2">{displayDate(e.paidDate)} · {e.libelle} · écart {formatCurrency(e.gap)} · <Link component="button" type="button" variant="body2" onClick={() => openMonth(e.paidDate)}>Écritures du mois</Link></Typography></li>
          ))}
        </Box>
      )}
      {open === 'settled' && (
        <Box component="ul" sx={{ mt: 2, mb: 0, pl: 2.5 }}>
          {settled.stays.map((s) => (
            <li key={s.reservationId}>
              <Typography variant="body2">
                {canOpenReservation
                  ? <Link component={RouterLink} to={`/reservations/${s.reservationId}`}>{s.name || `Réservation #${s.reservationId}`}</Link>
                  : (s.name || `Réservation #${s.reservationId}`)}
                {' '}· {s.propertyName} · départ le {displayDate(s.endDate)} · reste {formatCurrency(s.remaining)}
              </Typography>
            </li>
          ))}
        </Box>
      )}
    </Box>
  );
}

function VatPanel({ vatReturn, notSubject }) {
  const [group, setGroup] = useState('rate');
  const byAccount = group === 'account';
  const rows = byAccount ? vatReturn.byAccount : vatReturn.byRate;
  return (
    <Panel
      label={VAT_PANEL.label}
      action={(
        <ToggleButtonGroup exclusive size="small" value={group} onChange={(_, v) => v && setGroup(v)} aria-label="Regrouper par" sx={{ flex: 'none', '& .MuiToggleButton-root': { textTransform: 'none', whiteSpace: 'nowrap', px: { xs: 1, sm: 1.25 }, py: 0.25, '@media (pointer: coarse)': { minHeight: 44 } } }}>
          <ToggleButton value="rate">{VAT_PANEL.byRate}</ToggleButton>
          <ToggleButton value="account">{VAT_PANEL.byAccount}</ToggleButton>
        </ToggleButtonGroup>
      )}
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{notSubject ? `${notSubject.label} : aucune TVA à déclarer.` : VAT_PANEL.note}</Typography>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" aria-label={VAT_PANEL.label} sx={{ '& td, & th': { px: { xs: 0.75, sm: 1.5 } } }}>
          <TableHead>
            <TableRow>
              <TableCell>{byAccount ? 'Compte' : 'Taux'}</TableCell>
              {byAccount && <TableCell align="right">Taux</TableCell>}
              <TableCell align="right">Base HT</TableCell>
              <TableCell align="right">TVA</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={byAccount ? 4 : 3}><Typography variant="body2" color="text.secondary">Aucun encaissement sur la période.</Typography></TableCell></TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={byAccount ? `${r.account}|${r.ratePercent}` : r.ratePercent}>
                <TableCell sx={{ overflowWrap: 'anywhere' }}>{byAccount ? `${r.account} · ${r.label}` : rate(r.ratePercent)}</TableCell>
                {byAccount && <TableCell align="right">{rate(r.ratePercent)}</TableCell>}
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatCurrency(r.base)}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatCurrency(r.vat)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow sx={{ '& td': { fontWeight: 700, color: 'text.primary', borderBottom: 0 } }}>
              <TableCell>Total</TableCell>
              {byAccount && <TableCell />}
              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{formatCurrency(vatReturn.totals.base)}</TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap', color: 'primary.main' }}>{formatCurrency(vatReturn.totals.vat)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </Box>
      {vatReturn.deductibleOnCommissions > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {VAT_PANEL.deductible} : {formatCurrency(vatReturn.deductibleOnCommissions)}
        </Typography>
      )}
      <Source source={vatReturn.source} sx={{ mt: 1 }} />
    </Panel>
  );
}

function CumulativePanel({ data }) {
  const { buckets, previousAvailable } = data.collections.series;
  const categories = buckets.map((b) => ({ key: b.key, label: b.label }));
  const series = [{ key: 'current', name: data.window.label, values: buckets.map((b) => b.cumulative), area: true }];
  if (previousAvailable) series.push({ key: 'previous', name: 'N-1', values: buckets.map((b) => b.previousCumulative), dashed: true });
  return (
    <Panel label="Encaissements cumulés">
      <TrendChart categories={categories} series={series} formatValue={formatCurrencyRounded} formatAxis={axisEuro} ariaLabel={`Encaissements cumulés, ${data.window.label}`} height={200} />
      <Source source={data.collections.source} sx={{ mt: 1 }} />
    </Panel>
  );
}

export default function AccountingSynthesisTab({ data, canOpenReservation, onOpenEntriesMonth }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box>
        <KpiRow kpis={data.kpis} />
        <NoComparisonNotice text={data.comparison.notice} />
      </Box>
      <ChecksStrip checks={data.checks} canOpenReservation={canOpenReservation} onOpenEntriesMonth={onOpenEntriesMonth} />
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 6 }}><VatPanel vatReturn={data.vatReturn} notSubject={data.kpis.vat.notSubject} /></Grid>
        <Grid size={{ xs: 12, lg: 6 }}><CumulativePanel data={data} /></Grid>
      </Grid>
    </Box>
  );
}
