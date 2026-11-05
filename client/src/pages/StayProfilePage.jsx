// « Profil des séjours » (specs/stay-profile.md §3.4). Renders `/finance/stay-profile`: the stays of the
// dashboard's window split by channel, length, lead time and price band, and the average basket per
// month against last year. Every figure, share, ranking, delta and caption is the server's; the local
// state is the URL (window + logement, as on the Suivi financier) and the two switches.
import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  Box, Button, MenuItem, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import EventBusyOutlinedIcon from '@mui/icons-material/EventBusyOutlined';
import PageActionBar from '../components/PageActionBar';
import LoadingState from '../components/LoadingState';
import ErrorAlert from '../components/ErrorAlert';
import EmptyState from '../components/EmptyState';
import PeriodSelector, { customWindowError } from '../components/PeriodSelector';
import SegmentedSelect from '../components/SegmentedSelect';
import Panel from '../components/Panel';
import ShareTable from '../components/ShareTable';
import YearOverYearBadge from '../components/YearOverYearBadge';
import NoComparisonNotice from '../components/NoComparisonNotice';
import { formatCurrencyRounded, plural } from '../utils/formatters';
import { localIsoToday } from '../utils/isoDay';
import useServerToday from '../hooks/useServerToday';
import useLatestRequest from '../hooks/useLatestRequest';
import { STAY_PROFILE_TEXT as T, MEASURES } from '../constants/stayProfile';
import api from '../api';

const URL_KEYS = { fiscalYear: 'exercice', period: 'periode', month: 'mois', from: 'du', to: 'au', propertyId: 'logement' };
const iso = (d) => localIsoToday(d);
const money = (n) => (n == null ? '—' : formatCurrencyRounded(n));
const TOOLBAR_SX = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.25, mb: 1.75 };
const COARSE = { '@media (pointer: coarse)': { minHeight: 44 } };

function SourceCaption({ children }) {
  return <Typography variant="caption" component="p" color="text.secondary" sx={{ mt: 1, mb: 0 }}>{children}</Typography>;
}

function BreakdownPanel({ data, dimension, onDimension, measure, onMeasure }) {
  const dim = data.dimensions.find((d) => d.key === dimension) || data.dimensions[0];
  const shareKey = measure === 'amount' ? 'amountShare' : 'countShare';
  return (
    <Panel label={T.breakdownPanel}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
        <SegmentedSelect
          label={T.dimensionLabel}
          maxSegments={4}
          options={data.dimensions.map((d) => ({ value: d.key, label: d.label }))}
          value={dim.key}
          onChange={onDimension}
        />
        <SegmentedSelect label={T.measureLabel} options={MEASURES} value={measure} onChange={onMeasure} />
      </Box>
      {data.empty ? (
        <EmptyState icon={<EventBusyOutlinedIcon />} message={T.empty} py={3} />
      ) : (
        <ShareTable
          ariaLabel={`${T.breakdownPanel} — ${dim.label}`}
          labelHeader={dim.label}
          quantityHeader={T.stays}
          amountHeader={T.amount}
          shareHeader={T.share}
          formatAmount={money}
          rows={dim.rows.map((r) => ({ key: r.key, label: r.label, quantity: r.count, amount: r.amount, share: r[shareKey] ?? 0 }))}
          total={{ quantity: data.totals.count, amount: data.totals.amount }}
        />
      )}
      <SourceCaption>
        {plural(data.totals.count, 'séjour')} · {data.window.label}, {T.notCancelled}. {dim.sourceLabel}.
      </SourceCaption>
    </Panel>
  );
}

function BasketPanel({ basket }) {
  return (
    <Panel label={T.basketPanel}>
      {basket.rows.length === 0 ? (
        <EmptyState message={T.basketEmpty} py={3} />
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ '& td, & th': { px: { xs: 0.75, sm: 2 } } }}>
            <TableHead>
              <TableRow>
                <TableCell scope="col">{T.month}</TableCell>
                <TableCell scope="col" align="right">{basket.previousLabel}</TableCell>
                <TableCell scope="col" align="right">{basket.currentLabel}</TableCell>
                <TableCell scope="col" align="right">{T.delta}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {basket.rows.map((r) => (
                <TableRow key={r.month} data-testid={`basket-row-${r.month}`}>
                  <TableCell component="th" scope="row"><abbr title={r.label} style={{ textDecoration: 'none' }}>{r.short}</abbr></TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{money(r.previous && r.previous.average)}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{money(r.current.average)}</TableCell>
                  <TableCell align="right"><YearOverYearBadge change={r.delta ? r.delta.change : null} showEmpty /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
      <NoComparisonNotice text={basket.notice} />
      <SourceCaption>{basket.sourceLabel}.</SourceCaption>
    </Panel>
  );
}

export default function StayProfilePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = {
    fiscalYear: searchParams.get('exercice') || '',
    period: searchParams.get('periode') || 'fy',
    month: searchParams.get('mois') || '',
    from: searchParams.get('du') || '',
    to: searchParams.get('au') || '',
    propertyId: searchParams.get('logement') || '',
  };
  const setParams = (next) => {
    const out = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([k, v]) => {
      if (v == null || v === '' || (k === 'period' && v === 'fy')) out.delete(URL_KEYS[k]);
      else out.set(URL_KEYS[k], String(v));
    });
    setSearchParams(out, { replace: true });
  };
  const paramsKey = searchParams.toString();
  const today = useServerToday() || localIsoToday();
  const periodRefusal = params.period === 'custom' ? customWindowError(params.from, params.to, today) : '';

  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [dimension, setDimension] = useState('channel');
  const [measure, setMeasure] = useState('count');
  const begin = useLatestRequest();

  const load = useCallback(async () => {
    const current = begin();
    setLoadError(null);
    if (periodRefusal) { setData(null); return; }
    try {
      const answer = await api.getFinanceStayProfile(params);
      if (current()) setData(answer);
    } catch (err) {
      if (current()) { setData(null); setLoadError((err && err.error) || T.loadError); }
    }
  }, [paramsKey, periodRefusal]);
  useEffect(() => { load(); }, [load]);

  const defaultMonth = () => {
    const now = iso(new Date()).slice(0, 7);
    return data && data.months.some((m) => m.month === now) ? now : (data && data.months[0] ? data.months[0].month : now);
  };
  const defaultCustom = () => {
    const start = new Date(); start.setDate(1);
    const end = new Date(start); end.setMonth(end.getMonth() + 1, 0);
    return { from: iso(start), to: iso(end) };
  };
  const onPeriodChange = (w) => {
    if (w.kind === 'fy') setParams({ period: 'fy', month: '', from: '', to: '' });
    else if (w.kind === 'month') setParams({ period: 'month', month: w.month || defaultMonth(), from: '', to: '' });
    else setParams({ period: 'custom', month: '', from: w.from, to: w.to });
  };

  return (
    <Box>
      <PageActionBar
        title={T.title}
        actionsBefore={[{ icon: <SyncIcon />, tooltip: T.refresh, onClick: load, color: 'info' }]}
      />
      <Box sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 1240, mx: 'auto' }}>
        {loadError && <ErrorAlert message={loadError} onRetry={load} sx={{ mb: 2 }} />}
        {/* Rule 18 — no payload to show: a refused window keeps its selector, never a dead end. */}
        {!data && (periodRefusal || loadError) && (
          <Box sx={TOOLBAR_SX}>
            <PeriodSelector
              kind={params.period}
              from={periodRefusal ? params.from : params.from || defaultCustom().from}
              to={periodRefusal ? params.to : params.to || defaultCustom().to}
              months={[]}
              onChange={onPeriodChange}
              today={today}
            />
            {params.propertyId && (
              <Button size="small" variant="outlined" onClick={() => setParams({ propertyId: '' })} sx={{ textTransform: 'none', minHeight: 36, ...COARSE }}>
                {T.allProperties}
              </Button>
            )}
          </Box>
        )}
        {!data && !loadError && !periodRefusal && <LoadingState label={T.loading} />}
        {data && (
          <>
            <Box sx={TOOLBAR_SX}>
              <TextField select size="small" label={T.exerciseLabel} value={data.fiscalYear.key} onChange={(e) => setParams({ fiscalYear: e.target.value, period: 'fy', month: '' })} sx={{ minWidth: 170, flex: { xs: '1 1 100%', sm: '0 0 auto' } }}>
                {data.fiscalYears.map((fy) => <MenuItem key={fy.key} value={fy.key}>{fy.label}{fy.isCurrent ? ' (en cours)' : ''}</MenuItem>)}
              </TextField>
              <PeriodSelector
                kind={data.window.kind}
                month={data.window.month || params.month}
                from={params.from || defaultCustom().from}
                to={params.to || defaultCustom().to}
                months={data.months}
                onChange={onPeriodChange}
                today={today}
              />
              <TextField select size="small" label={T.propertyLabel} value={data.propertyId == null ? '' : data.propertyId} onChange={(e) => setParams({ propertyId: e.target.value })} sx={{ minWidth: 190, flex: { xs: '1 1 100%', sm: '0 0 auto' } }} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
                <MenuItem value="">{T.allProperties}</MenuItem>
                {data.properties.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
              </TextField>
            </Box>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) minmax(0, 1fr)' }, alignItems: 'start' }}>
              <BreakdownPanel data={data} dimension={dimension} onDimension={setDimension} measure={measure} onMeasure={setMeasure} />
              <BasketPanel basket={data.basket} />
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}
