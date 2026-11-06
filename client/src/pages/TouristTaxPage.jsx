// specs/tourist-tax-report-v2.md §3 rules 17-24 and §6 — the « Taxe de séjour » page: any period, by logement and
// declaration status, as a list of stays or a night-by-night register, with the totals pinned at the bottom.
// Every figure comes from GET /finance/tourist-tax/report; the page renders it and keeps local UI state only.
import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  Box, Typography, Stack, Checkbox, Tooltip, Chip, TableRow, TableCell, TextField, MenuItem, Alert,
} from '@mui/material';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import PageActionBar from '../components/PageActionBar';
import PeriodSelector from '../components/PeriodSelector';
import SegmentedSelect from '../components/SegmentedSelect';
import ResponsiveTable from '../components/ResponsiveTable';
import LoadingState from '../components/LoadingState';
import ErrorAlert from '../components/ErrorAlert';
import Panel from '../components/Panel';
import StickyTotalsBar from '../components/StickyTotalsBar';
import { useToast } from '../components/DialogProvider';
import useServerToday from '../hooks/useServerToday';
import api from '../api';
import { withFrom } from '../utils/navigation';
import { displayDate, formatCurrency } from '../utils/formatters';
import { localIsoToday } from '../utils/isoDay';
import { TAX_PAGE, TAX_COLUMNS, TAX_TOTALS } from '../constants/touristTaxReport';

const TABULAR = { fontVariantNumeric: 'tabular-nums' };
const MONEY = { ...TABULAR, whiteSpace: 'nowrap' };
const HEAD = { fontWeight: 600, whiteSpace: 'nowrap' };
const GROUP = { ...HEAD, fontSize: '0.72rem', color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.06em' };
const DENSE = { '& .MuiTableCell-root': { px: 0.875 } };

function pad2(v) {
  return String(v).padStart(2, '0');
}

const PERIOD_KINDS = ['month', 'quarter', 'year', 'custom'];
const DECLARATIONS = ['all', 'todo', 'done'];

// The page opens on the month before the server's (rule 32), the month a declaration is usually made for.
function previousMonth(today) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`;
}

// specs/finance-data-checks.md rule 16 — `?month=YYYY-MM` (a link of « À vérifier ») opens that month when it is
// a real one not still to come, judged from the server's day (rule 32); anything else opens the default month.
function linkedMonth(asked, today) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(asked || ''));
  if (!m || Number(m[1]) < 1000) return null;
  return asked <= today.slice(0, 7) ? asked : null;
}

// The default selection; its month waits for the server's day when it is not known yet (rule 32).
const defaultQuery = (serverToday) => ({ period: 'month', month: serverToday ? previousMonth(serverToday) : '', quarter: '', year: '', from: '', to: '', propertyId: '', declaration: 'all' });

// Rule 31 — the selection and the view live in the URL, so returning from a fiche (or a shared link) restores them.
// The month of a month selection waits for the server's day (rule 32); the rest is read as sent, the server judging it.
function queryFromUrl(params) {
  const period = PERIOD_KINDS.includes(params.get('period')) ? params.get('period') : 'month';
  const propertyId = /^\d+$/.test(params.get('propertyId') || '') ? params.get('propertyId') : '';
  const declaration = DECLARATIONS.includes(params.get('declaration')) ? params.get('declaration') : 'all';
  return {
    period,
    month: '',
    quarter: period === 'quarter' ? params.get('quarter') || '' : '',
    year: period === 'year' ? params.get('year') || '' : '',
    from: period === 'custom' ? params.get('from') || '' : '',
    to: period === 'custom' ? params.get('to') || '' : '',
    propertyId,
    declaration,
  };
}

// The query of a selection: the period's own key only, the filters when set.
function paramsOf(q) {
  const own = { month: { month: q.month }, quarter: { quarter: q.quarter }, year: { year: q.year }, custom: { from: q.from, to: q.to } }[q.period];
  return { period: q.period, ...own, propertyId: q.propertyId, declaration: q.declaration === 'all' ? '' : q.declaration };
}
const sameQuery = (a, b) => JSON.stringify(paramsOf(a)) === JSON.stringify(paramsOf(b));

// « Dates » = the reservation's stay dates (arrival → departure), like the fiche
// (specs/tourist-tax-declared-checkbox.md rule 1).
function formatReservationDates(startDate, endDate) {
  const start = displayDate(startDate);
  if (!endDate) return start;
  return `${start} au ${displayDate(endDate)}`;
}

function formatDeclaredDate(declaredAt) {
  if (!declaredAt || declaredAt === '__pending__') return '';
  return displayDate(String(declaredAt).slice(0, 10));
}

const NIGHT_DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', timeZone: 'UTC' });
const formatNight = (iso) => `${NIGHT_DAY.format(new Date(`${iso}T00:00:00Z`))} ${displayDate(iso)}`;

// specs/reservation-refunds.md §3.5 — the row's figures are NET of the refunded nights; the note says what left.
function refundedTaxCaption(row) {
  const nights = Number(row.refundedTaxNights || 0);
  const amount = Number(row.refundedTaxAmount || 0);
  if (nights <= 0 && amount <= 0) return '';
  const nightsPart = nights > 0 ? `${nights} nuit${nights > 1 ? 's' : ''} remboursée${nights > 1 ? 's' : ''}` : 'taxe remboursée';
  return `dont ${nightsPart} (− ${formatCurrency(amount)})`;
}

// specs/platform-added-guests-tourist-tax.md rule 12 — a stay can list a second row, its added guests.
const rowName = (row) => `${row.reservationName || 'Réservation'}${row.addedGuestsRow ? TAX_PAGE.addedGuestsSuffix : ''}`;
const byPlatform = (row) => row.remittedBy === 'platform';
const dash = (row, value) => (row.noGuestAdded ? '—' : value);

function totalsItems(t) {
  return [
    { key: 'stays', label: TAX_TOTALS.stays, value: String(t.staysCount), caption: t.platformRemittedStaysCount ? TAX_TOTALS.platformStays(t.platformRemittedStaysCount) : '', compact: true },
    { key: 'persons', label: TAX_TOTALS.persons, value: String(t.persons) },
    { key: 'taxed', label: TAX_TOTALS.taxedExempt, value: `${t.taxedPersons} · ${t.exemptPersons}`, caption: TAX_TOTALS.minorsExempt },
    { key: 'nights', label: TAX_TOTALS.nights, value: String(t.nights) },
    { key: 'personNights', label: TAX_TOTALS.taxedNights, value: String(t.taxedPersonNights), caption: TAX_TOTALS.exemptNights(t.exemptPersonNights) },
    { key: 'declared', label: TAX_TOTALS.declared, value: formatCurrency(t.declaredAmount), caption: t.platformRemittedAmount ? TAX_TOTALS.platformAmount(formatCurrency(t.platformRemittedAmount)) : '' },
    {
      key: 'amount',
      label: TAX_TOTALS.toRemit,
      value: formatCurrency(t.amount),
      caption: t.allDeclared ? TAX_TOTALS.allDeclared : (t.rowsCount ? TAX_TOTALS.remaining(formatCurrency(t.remainingAmount)) : ''),
      main: true,
      compact: true,
    },
  ];
}

export default function TouristTaxPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showError } = useToast();
  const serverToday = useServerToday();
  const today = serverToday || localIsoToday();
  const linkMonth = useRef(searchParams.get('month'));
  const [query, setQuery] = useState(() => queryFromUrl(searchParams));
  const [view, setView] = useState(() => (searchParams.get('view') === 'night' ? 'night' : 'list'));
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);
  const queryRef = useRef(query);
  queryRef.current = query;
  const lastGood = useRef(null);
  const refused = useRef(false);
  const keepRefusal = useRef(false);
  const readSeq = useRef(0);
  const pendingTicks = useRef(0);
  const waitingForDay = query.period === 'month' && !query.month;

  // Rule 32 — the month a month selection opens on is judged from the server's day, once it is known.
  useEffect(() => {
    if (!serverToday || !waitingForDay) return;
    setQuery((q) => ({ ...q, month: linkedMonth(linkMonth.current, serverToday) || previousMonth(serverToday) }));
  }, [serverToday, waitingForDay]);

  // Rule 31 — the URL follows the selection and the view (replace: the back button leaves the page, not a filter).
  // Rule 40 (review V1-3) — while a refusal is shown, the URL holds the selection last READ, the one on screen, so a
  // fiche opened then, a reload or a shared link comes back to it rather than to the refused one.
  useEffect(() => {
    if (waitingForDay) return;
    const shown = refused.current && lastGood.current ? lastGood.current.query : query;
    const next = new URLSearchParams();
    Object.entries(paramsOf(shown)).forEach(([k, v]) => { if (v) next.set(k, v); });
    if (view === 'night') next.set('view', 'night');
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true });
  }, [query, view, waitingForDay, refusal, data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rule 33 — the selection on screen: the last one read while a refusal is shown, else the one asked.
  const shownQuery = () => (refused.current && lastGood.current ? lastGood.current.query : queryRef.current);

  const setSelection = (patch) => setQuery((q) => ({ ...q, ...patch }));

  // specs/tourist-tax-declared-checkbox.md §3 — optimistic « Déclarée » toggle; revert + toast on error.
  const patchDeclared = (target, value) =>
    setData((prev) => (prev ? {
      ...prev,
      stays: prev.stays.map((r) => (r.key === target.key ? { ...r, touristTaxDeclaredAt: value, touristTaxDeclaredOn: null } : r)),
    } : prev));

  // Rule 21 — the rows and the totals are the server's: once no tick is on its way the selection is read again,
  // without a loading state. Only the last read counts, and only if its selection is still on screen
  // (specs/platform-added-guests-tourist-tax.md rules 24, 26).
  const refresh = (forQuery) => {
    const read = readSeq.current + 1;
    readSeq.current = read;
    api.getTouristTaxReport(paramsOf(forQuery))
      .then((res) => {
        if (read !== readSeq.current || !sameQuery(forQuery, shownQuery())) return;
        lastGood.current = { data: res, query: forQuery };
        setData(res);
      })
      .catch(() => {});
  };

  const handleToggleDeclared = async (row) => {
    const forQuery = shownQuery();
    const declared = !row.touristTaxDeclaredAt;
    readSeq.current += 1;
    pendingTicks.current += 1;
    patchDeclared(row, declared ? '__pending__' : null);
    try {
      const res = await api.setTouristTaxDeclared(row.reservationId, declared, { addedGuests: Boolean(row.addedGuestsRow) });
      if (sameQuery(forQuery, shownQuery())) patchDeclared(row, res.declaredAt);
    } catch (e) {
      if (sameQuery(forQuery, shownQuery())) patchDeclared(row, row.touristTaxDeclaredAt);
      showError(e.message || TAX_PAGE.tickError);
    }
    pendingTicks.current -= 1;
    if (pendingTicks.current === 0) refresh(shownQuery());
  };

  useEffect(() => {
    if (waitingForDay) return undefined;
    let isMounted = true;
    const forQuery = query;
    readSeq.current += 1;
    refused.current = false;
    setLoadError(false);
    setData(null);
    api.getTouristTaxReport(paramsOf(forQuery))
      .then((res) => {
        if (!isMounted) return;
        lastGood.current = { data: res, query: forQuery };
        if (!keepRefusal.current) setRefusal('');
        keepRefusal.current = false;
        setData(res);
      })
      .catch((e) => {
        if (!isMounted) return;
        const status = e && e.status;
        if (status === 400 && lastGood.current) {
          // Rule 19 — a refused selection keeps the last result on screen and says why.
          refused.current = true;
          setRefusal(e.message);
          setData(lastGood.current.data);
          return;
        }
        const fallback = defaultQuery(serverToday);
        if (status === 400 && !sameQuery(forQuery, fallback)) {
          linkMonth.current = null;
          // Rule 32 — a FIRST read refused says why and opens the default month instead: never a dead end.
          keepRefusal.current = true;
          setRefusal(e.message);
          setQuery(fallback);
          return;
        }
        setData(null);
        setLoadError(true);
      });
    return () => { isMounted = false; };
  }, [query, reloadNonce, waitingForDay]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExport = async () => {
    const shown = lastGood.current ? lastGood.current.query : query;
    try {
      await api.downloadTouristTaxReportCsv(paramsOf(shown), view);
    } catch (e) {
      showError(e.message || TAX_PAGE.exportError);
    }
  };

  // Rule 30 — the day of the tick as the server reads it (`touristTaxDeclaredOn`), the stamp's own day until it arrives.
  const declaredDay = (row) => (row.touristTaxDeclaredOn ? displayDate(row.touristTaxDeclaredOn) : formatDeclaredDate(row.touristTaxDeclaredAt));
  const declaredTooltip = (row) => (row.touristTaxDeclaredAt
    ? (declaredDay(row) ? `${TAX_PAGE.declared} le ${declaredDay(row)}` : TAX_PAGE.declared)
    : TAX_PAGE.notDeclared);

  // specs/tourist-tax-declared-checkbox.md rule 8 — the server says when a tick can be made; an existing one can always go.
  const notDeclarableYet = (row) => !row.declarable && !row.touristTaxDeclaredAt;

  const declaredCell = (row) => {
    if (byPlatform(row)) return <Typography component="span" color="text.secondary" aria-hidden>—</Typography>;
    const checkbox = (
      <Checkbox
        size="small"
        checked={!!row.touristTaxDeclaredAt}
        disabled={notDeclarableYet(row)}
        onChange={() => handleToggleDeclared(row)}
        slotProps={{ input: { 'aria-label': `${TAX_PAGE.declared} — ${rowName(row)}` } }}
      />
    );
    return notDeclarableYet(row)
      ? <Tooltip title={TAX_PAGE.notDeclarable}><Box component="span" sx={{ display: 'inline-flex' }}>{checkbox}</Box></Tooltip>
      : <Tooltip title={declaredTooltip(row)}>{checkbox}</Tooltip>;
  };

  const platformTag = (row) => (
    <Tooltip title={TAX_PAGE.remittedByTooltip}>
      <Chip size="small" variant="outlined" label={TAX_PAGE.remittedBy(row.platformLabel)} sx={{ maxWidth: '100%', color: 'text.secondary', height: 'auto', minHeight: 22, '& .MuiChip-label': { whiteSpace: 'normal', py: 0.25 } }} />
    </Tooltip>
  );

  const rowNotes = (row) => (
    <>
      {notDeclarableYet(row) && !byPlatform(row) && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{TAX_PAGE.notDeclarable}</Typography>
      )}
      {row.noGuestAdded && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{TAX_PAGE.noGuestAdded}</Typography>
      )}
      {refundedTaxCaption(row) && (
        <Typography variant="caption" sx={{ display: 'block', color: 'warning.main' }}>{`↳ ${refundedTaxCaption(row)}`}</Typography>
      )}
    </>
  );

  const openStay = (row) => navigate(withFrom(`/reservations/${row.reservationId}`, `${location.pathname}${location.search}`));
  const base = Boolean(data?.columns?.percentageBase);
  // While a selection loads, the pickers keep the options of the last report read (their values stay offered).
  const known = data || (lastGood.current && lastGood.current.data);

  const listTable = data && (
    <ResponsiveTable
      items={data.stays}
      getKey={(row) => row.key}
      minWidth={base ? 860 : 700}
      cardsBelowWidth={base ? 860 : 700}
      cardsWhenOverflow
      emptyText={TAX_PAGE.emptyList}
      head={(
        <>
          <TableRow sx={{ '& th': { borderBottom: 0, pb: 0 } }}>
            <TableCell colSpan={3} />
            <TableCell sx={GROUP} align="center" colSpan={3}>{TAX_COLUMNS.personsLong}</TableCell>
            <TableCell sx={GROUP} align="center" colSpan={2}>{TAX_COLUMNS.personNights}</TableCell>
            <TableCell colSpan={base ? 3 : 1} />
          </TableRow>
          <TableRow>
            <TableCell sx={HEAD} align="center" padding="checkbox">{TAX_COLUMNS.declared}</TableCell>
            <TableCell sx={HEAD}>{TAX_COLUMNS.stay}</TableCell>
            <TableCell sx={HEAD} align="right">{TAX_COLUMNS.nights}</TableCell>
            <TableCell sx={HEAD} align="right">{TAX_COLUMNS.persons}</TableCell>
            <TableCell sx={HEAD} align="right">{TAX_COLUMNS.taxed}</TableCell>
            <TableCell sx={HEAD} align="right">{TAX_COLUMNS.exempt}</TableCell>
            <TableCell sx={HEAD} align="right" aria-label={TAX_COLUMNS.taxedNights}>{TAX_COLUMNS.taxed}</TableCell>
            <TableCell sx={HEAD} align="right" aria-label={TAX_COLUMNS.exemptNights}>{TAX_COLUMNS.exempt}</TableCell>
            {/* specs/tourist-tax-included-services-deduction.md rule 15 — the base the commune's percentage form asks for. */}
            {base && <TableCell sx={{ ...HEAD, whiteSpace: 'normal', maxWidth: 84 }} align="right">{TAX_COLUMNS.nightPrice}</TableCell>}
            {base && <TableCell sx={{ ...HEAD, whiteSpace: 'normal', maxWidth: 84 }} align="right">{TAX_COLUMNS.accommodation}</TableCell>}
            <TableCell sx={HEAD} align="right">{TAX_COLUMNS.amount}</TableCell>
          </TableRow>
        </>
      )}
      renderRow={(row) => (
        <TableRow
          key={row.key}
          hover
          data-remitted-by={row.remittedBy}
          onClick={() => openStay(row)}
          sx={{ cursor: 'pointer', ...(byPlatform(row) ? { '& td': { color: 'text.secondary' }, bgcolor: 'action.hover' } : {}) }}
        >
          <TableCell padding="checkbox" align="center" onClick={(e) => e.stopPropagation()} sx={{ cursor: 'default' }}>
            {declaredCell(row)}
          </TableCell>
          <TableCell>
            {rowName(row)}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', whiteSpace: 'nowrap' }}>{formatReservationDates(row.startDate, row.endDate)}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{`${row.propertyName} · ${row.platformLabel}`}</Typography>
            {byPlatform(row) && <Box sx={{ mt: 0.5 }}>{platformTag(row)}</Box>}
            {rowNotes(row)}
          </TableCell>
          <TableCell align="right" sx={TABULAR}>{row.nightsCount}</TableCell>
          <TableCell align="right" sx={TABULAR}>{dash(row, row.persons)}</TableCell>
          <TableCell align="right" sx={TABULAR}>{dash(row, row.taxedPersons)}</TableCell>
          <TableCell align="right" sx={TABULAR}>{dash(row, row.exemptPersons)}</TableCell>
          <TableCell align="right" sx={TABULAR}>{dash(row, row.taxedPersonNights)}</TableCell>
          <TableCell align="right" sx={TABULAR}>{dash(row, row.exemptPersonNights)}</TableCell>
          {base && (
            <TableCell align="right" sx={MONEY}>{row.nightPricePerOccupantHt == null ? '—' : formatCurrency(row.nightPricePerOccupantHt)}</TableCell>
          )}
          {base && <TableCell align="right" sx={MONEY}>{row.accommodationAmount == null ? '—' : formatCurrency(row.accommodationAmount)}</TableCell>}
          <TableCell align="right" sx={{ ...MONEY, fontWeight: 600 }}>{formatCurrency(row.taxAmount)}</TableCell>
        </TableRow>
      )}
      renderMobileCard={(row) => (
        <Stack onClick={() => openStay(row)} data-remitted-by={row.remittedBy} sx={{ cursor: 'pointer', gap: 0.5, ...(byPlatform(row) ? { color: 'text.secondary' } : {}) }}>
          {/* Rule 22 (review V1-4) — a platform's tag sits beside the name when both fit, else wraps under it whole; it is
              cut only when it is wider than the card itself. */}
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: byPlatform(row) ? 'wrap' : 'nowrap' }}>
            <Box data-card-name="" sx={{ minWidth: 0, flex: '1 1 auto' }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{rowName(row)}</Typography>
              <Typography variant="caption" color="text.secondary">{`${row.propertyName} · ${row.platformLabel}`}</Typography>
            </Box>
            <Box onClick={(e) => e.stopPropagation()} sx={{ flex: '0 1 auto', minWidth: 0, maxWidth: '100%', display: 'flex', justifyContent: 'flex-end' }}>{byPlatform(row) ? platformTag(row) : declaredCell(row)}</Box>
          </Stack>
          {rowNotes(row)}
          <Typography variant="caption" color="text.secondary">
            {formatReservationDates(row.startDate, row.endDate)} · {row.nightsCount} nuit{row.nightsCount > 1 ? 's' : ''}
            {row.noGuestAdded ? '' : ` · ${row.taxedPersons} taxée${row.taxedPersons > 1 ? 's' : ''} · ${row.exemptPersons} exonérée${row.exemptPersons > 1 ? 's' : ''}`}
          </Typography>
          {row.nightPricePerOccupantHt != null && (
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
              <Typography variant="caption" color="text.secondary">{TAX_COLUMNS.nightPrice}</Typography>
              <Typography variant="body2" sx={TABULAR}>{formatCurrency(row.nightPricePerOccupantHt)}</Typography>
            </Stack>
          )}
          <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
            <Typography variant="caption" color="text.secondary">{TAX_COLUMNS.amount}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600, ...TABULAR }}>{formatCurrency(row.taxAmount)}</Typography>
          </Stack>
        </Stack>
      )}
    />
  );

  const nightTable = data && (
    <ResponsiveTable
      items={data.nights}
      getKey={(n) => n.date}
      minWidth={640}
      emptyText={TAX_PAGE.emptyNights}
      head={(
        <TableRow>
          <TableCell sx={HEAD}>{TAX_COLUMNS.night}</TableCell>
          <TableCell sx={HEAD} align="right">{TAX_COLUMNS.stays}</TableCell>
          <TableCell sx={HEAD} align="right">{TAX_COLUMNS.personsLong}</TableCell>
          <TableCell sx={HEAD} align="right">{TAX_COLUMNS.taxed}</TableCell>
          <TableCell sx={HEAD} align="right">{TAX_COLUMNS.exempt}</TableCell>
          <TableCell sx={HEAD} align="right">{TAX_COLUMNS.amount}</TableCell>
        </TableRow>
      )}
      renderRow={(n) => (
        <TableRow key={n.date} data-outside-window={n.outsideWindow ? 'true' : undefined} sx={n.outsideWindow ? { '& td': { color: 'text.secondary' } } : undefined}>
          <TableCell sx={TABULAR}>{formatNight(n.date)}{n.outsideWindow ? ' *' : ''}</TableCell>
          <TableCell align="right" sx={TABULAR}>{n.staysCount}</TableCell>
          <TableCell align="right" sx={TABULAR}>{n.persons}</TableCell>
          <TableCell align="right" sx={TABULAR}>{n.taxedPersons}</TableCell>
          <TableCell align="right" sx={TABULAR}>{n.exemptPersons}</TableCell>
          <TableCell align="right" sx={{ ...MONEY, fontWeight: 600 }}>{formatCurrency(n.taxAmount)}</TableCell>
        </TableRow>
      )}
      renderMobileCard={(n) => (
        <Stack sx={{ gap: 0.25 }}>
          <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
            <Typography variant="body2" sx={{ fontWeight: 600, ...TABULAR, ...(n.outsideWindow ? { color: 'text.secondary' } : {}) }}>{formatNight(n.date)}{n.outsideWindow ? ' *' : ''}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600, ...TABULAR }}>{formatCurrency(n.taxAmount)}</Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {`${n.staysCount} séjour${n.staysCount > 1 ? 's' : ''} · ${n.persons} pers. · ${n.taxedPersons} taxée${n.taxedPersons > 1 ? 's' : ''} · ${n.exemptPersons} exonérée${n.exemptPersons > 1 ? 's' : ''}`}
          </Typography>
        </Stack>
      )}
    />
  );

  const viewSwitch = <SegmentedSelect label={TAX_PAGE.viewLabel} options={TAX_PAGE.views} value={view} onChange={setView} />;

  return (
    <Box>
      <PageActionBar
        title={TAX_PAGE.title}
        center={viewSwitch}
        actionsBefore={[{ icon: <FileDownloadOutlinedIcon />, tooltip: TAX_PAGE.exportTooltip, onClick: handleExport, color: 'info', disabled: !data }]}
      />
      <Box sx={{ px: { xs: 1.5, sm: 3 }, pt: { xs: 1.5, sm: 3 }, maxWidth: 1240, mx: 'auto' }}>
        {known && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5, mb: 2 }}>
            <PeriodSelector
              kinds={['month', 'quarter', 'year', 'custom']}
              labels={TAX_PAGE.periodLabels}
              kind={query.period}
              month={query.month}
              quarter={query.quarter}
              year={query.year}
              from={query.from || known.window.from}
              to={query.to || known.window.to}
              months={known.choices.months.map((m) => ({ month: m.value, label: m.label }))}
              quarters={known.choices.quarters}
              years={known.choices.years}
              today={today}
              onChange={({ kind, ...rest }) => setSelection({ period: kind, ...rest })}
            />
            <TextField select size="small" label={TAX_PAGE.propertyLabel} value={query.propertyId} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }} onChange={(e) => setSelection({ propertyId: e.target.value })} sx={{ minWidth: 150, flex: { xs: '1 1 140px', sm: 'none' } }}>
              <MenuItem value="">{TAX_PAGE.propertyAll}</MenuItem>
              {known.properties.map((p) => <MenuItem key={p.id} value={String(p.id)}>{p.name}</MenuItem>)}
            </TextField>
            <TextField select size="small" label={TAX_PAGE.declarationLabel} value={query.declaration} onChange={(e) => setSelection({ declaration: e.target.value })} sx={{ minWidth: 150, flex: { xs: '1 1 140px', sm: 'none' } }}>
              {TAX_PAGE.declarations.map((d) => <MenuItem key={d.value} value={d.value}>{d.label}</MenuItem>)}
            </TextField>
            <Box sx={{ display: { xs: 'block', md: 'none' }, width: { xs: '100%', sm: 'auto' } }}>{viewSwitch}</Box>
          </Box>
        )}

        {refusal && <Alert severity="warning" role="alert" sx={{ mb: 2 }} onClose={() => setRefusal('')}>{refusal}</Alert>}
        {loadError && <ErrorAlert message={TAX_PAGE.loadError} onRetry={() => setReloadNonce((n) => n + 1)} sx={{ mb: 3 }} />}
        {!data && !loadError && <LoadingState label={TAX_PAGE.loading} />}
        {data && (
          <>
            <Panel
              label={`${view === 'list' ? TAX_PAGE.listPanel : TAX_PAGE.nightPanel} · ${data.window.label}`}
            >
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -0.75, mb: 1 }}>{TAX_PAGE.source}</Typography>
              {data.window.futureExcluded && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{TAX_PAGE.futureExcluded}</Typography>
              )}
              {view === 'night' && data.columns?.nightsOutsideWindow && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>{TAX_PAGE.nightsOutside}</Typography>
              )}
              <Box sx={DENSE}>{view === 'list' ? listTable : nightTable}</Box>
            </Panel>
            <StickyTotalsBar items={totalsItems(data.totals)} label={TAX_TOTALS.barLabel} moreLabel={TAX_TOTALS.more} lessLabel={TAX_TOTALS.less} />
          </>
        )}
      </Box>
    </Box>
  );
}
