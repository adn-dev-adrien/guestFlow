/**
 * ReportGrammarPreview — the dev-only page showing every component of the report grammar with fixture
 * data (specs/report-grammar.md rule 17). Mounted only by a development build (`import.meta.env.DEV`),
 * never in production, never in a menu: it is a workbench for whoever builds a report screen.
 */
import React, { useState } from 'react';
import { Box, Grid } from '@mui/material';
import PageActionBar from '../components/PageActionBar';
import SelectableTile from '../components/SelectableTile';
import NoComparisonNotice from '../components/NoComparisonNotice';
import PageTabs from '../components/PageTabs';
import Panel from '../components/Panel';
import TrendChart from '../components/TrendChart';
import ShareTable from '../components/ShareTable';
import AlignedDailyCumulativeCharts from '../components/AlignedDailyCumulativeCharts';
import SegmentedSelect from '../components/SegmentedSelect';
import { formatCurrency, formatCurrencyRounded } from '../utils/formatters';
import {
  KPI_TILES, NO_COMPARISON_TEXT, TABS, EXERCISE_MONTHS, TREND_SERIES, SHARE_ROWS, SHARE_TOTAL,
  DAYS, DAILY, CUMULATIVE, PREVIOUS_CUMULATIVE, OCCUPANCY_SERIES, EMPTY_TEXT,
} from './reportGrammarFixtures';

const kEuro = (v) => `${String(v / 1000).replace('.', ',')} k€`;
const rate = (v) => `${(v * 100).toFixed(1).replace('.', ',')} %`;
const rateAxis = (v) => `${Math.round(v * 100)} %`;

export default function ReportGrammarPreview() {
  const [withRef, setWithRef] = useState('yes');
  const [tab, setTab] = useState('cash');
  const ref = withRef === 'yes';
  return (
    <Box>
      <PageActionBar title="Grammaire des rapports" />
      <Box sx={{ p: { xs: 1.5, sm: 3 }, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <SegmentedSelect
          label="Référence"
          value={withRef}
          onChange={setWithRef}
          options={[{ value: 'yes', label: "Avec l'an dernier" }, { value: 'no', label: 'Premier exercice' }]}
        />
        <Box>
          <Grid container spacing={1.5}>
            {KPI_TILES.map((k) => (
              <Grid key={k.key} size={{ xs: 6, md: 3 }}>
                <SelectableTile label={k.label} value={k.value} caption={k.caption} info={k.info} comparison={ref ? k.comparison : { change: null }} />
              </Grid>
            ))}
          </Grid>
          <NoComparisonNotice text={ref ? null : NO_COMPARISON_TEXT} />
        </Box>
        <PageTabs value={tab} onChange={setTab} items={TABS} variant="card" ariaLabel="Détail" />
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Panel label="Encaissements cumulés par exercice">
              <TrendChart categories={EXERCISE_MONTHS} series={TREND_SERIES} formatValue={formatCurrencyRounded} formatAxis={kEuro} ariaLabel="Encaissements cumulés par exercice" />
            </Panel>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <Panel label="Répartition des encaissements">
              <ShareTable rows={SHARE_ROWS} total={SHARE_TOTAL} formatAmount={formatCurrency} labelHeader="Moyen" />
            </Panel>
          </Grid>
        </Grid>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Panel label="Taux d'occupation">
              <TrendChart categories={EXERCISE_MONTHS} series={OCCUPANCY_SERIES} formatValue={rate} formatAxis={rateAxis} yDomain={[0, 1]} ratio ariaLabel="Taux d'occupation par mois" />
            </Panel>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <Panel label="Période vide">
              <ShareTable rows={[]} total={{ amount: 0 }} formatAmount={formatCurrency} emptyText={EMPTY_TEXT} />
            </Panel>
          </Grid>
        </Grid>
        <Panel label="Encaissements journaliers et cumul">
          <AlignedDailyCumulativeCharts
            categories={DAYS}
            daily={DAILY}
            cumulative={CUMULATIVE}
            previousCumulative={ref ? PREVIOUS_CUMULATIVE : undefined}
            formatValue={formatCurrencyRounded}
            ariaLabel="Encaissements journaliers et cumulés, octobre 2026"
          />
        </Panel>
      </Box>
    </Box>
  );
}
