/**
 * AccountingCollectionsTab — the « Encaissements » tab of Comptabilité (specs/accounting-synthesis.md rules
 * 31-32): the collected money by means and by settlement type (segmented bar + table, shares from the
 * server), then the amount per day, week or month with its running total and last year's. Renders the
 * server's payload as is. Feature-local.
 *
 * Props:
 *   data:  the GET /api/accounting/synthesis payload
 */
import React from 'react';
import { Box, Grid, Typography } from '@mui/material';
import { Panel, ShareTable, AlignedDailyCumulativeCharts, formatCurrency, formatCurrencyRounded } from '../sdk';
import { SOURCE_CAPTIONS, GRANULARITY, NO_COLLECTION, refunds as refundsLabel, axisEuro } from './synthesisCopy';

// The server's one-decimal share (rule 14), printed as it was rounded there: « 52,5 % ».
// A share the server could not read (rule 14: a negative row, a total of zero) prints « — », never « 0,0 % ».
const formatShare = (share) => (share == null ? '—' : `${(Math.round(share * 1000) / 10).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`);
// The server's rows in the share table's shape: its own count and its fraction of 1, renamed only.
// Rule 37 — the folded tail « Autres » is the share table's `other` row: its neutral grey, never a hue another row has.
const shareRows = (rows) => rows.map((r) => ({
  key: r.key, label: r.label, quantity: r.count, amount: r.amount, share: r.ratio, ...(r.key === 'other' ? { other: true } : {}),
}));

function Breakdown({ rows, total, labelHeader, ariaLabel }) {
  if (rows.length === 0) return <Typography variant="body2" color="text.secondary">{NO_COLLECTION}</Typography>;
  return <ShareTable rows={shareRows(rows)} total={total} formatAmount={formatCurrency} formatShare={formatShare} labelHeader={labelHeader} ariaLabel={ariaLabel} />;
}

export default function AccountingCollectionsTab({ data }) {
  const { collections, kpis, window: win } = data;
  const total = { quantity: collections.payments, amount: collections.total };
  const g = GRANULARITY[collections.series.granularity] || GRANULARITY.day;
  const buckets = collections.series.buckets;
  const source = <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{SOURCE_CAPTIONS[collections.source]}</Typography>;
  const refunds = kpis.collected.refunds;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Panel label="Encaissements par moyen de paiement">
            <Breakdown rows={collections.byMeans} total={total} labelHeader="Moyen" ariaLabel="Répartition par moyen de paiement" />
            {source}
          </Panel>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Panel label="Répartition par type de règlement">
            <Breakdown rows={collections.byType} total={total} labelHeader="Type" ariaLabel="Répartition par type de règlement" />
            {source}
          </Panel>
        </Grid>
      </Grid>
      {refunds.count > 0 && (
        <Typography variant="body2" color="text.secondary">
          Remboursements sur la période, hors encaissements : {refundsLabel(refunds.count)} · {formatCurrency(refunds.amount)}
        </Typography>
      )}
      <Panel label={g.panel}>
        <AlignedDailyCumulativeCharts
          categories={buckets.map((b) => ({ key: b.key, label: b.label }))}
          daily={buckets.map((b) => b.amount)}
          cumulative={buckets.map((b) => b.cumulative)}
          previousCumulative={collections.series.previousAvailable ? buckets.map((b) => b.previousCumulative) : undefined}
          labels={{ daily: g.daily, cumulative: 'Cumul', previous: 'Cumul N-1' }}
          formatValue={formatCurrencyRounded}
          formatAxis={axisEuro}
          ariaLabel={`${g.panel}, ${win.label}`}
          categoryHeader={g.header}
        />
        {source}
      </Panel>
    </Box>
  );
}
