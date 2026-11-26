/**
 * GiftVouchersPage — « Bons cadeaux » (specs/gift-vouchers.md rules 24-29, §6): the issued vouchers with the total still
 * outstanding, searched by number, e-mail or name and filtered by state — all judged by the server. A table on `md+`,
 * stacked cards on `xs`; the detail is a side panel on `lg`, a dialog below (full-screen on `xs`/`sm`).
 *
 * The list reads the campaign, the contents and the day of use of each voucher from the server (specs/gift-voucher-campaigns.md rule 42) and filters by campaign and
 * kind; « Nouveau bon » opens its own page. Admin only (`index.js`): the reception role sees nothing of the plugin (rule 29).
 */
import React, {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';
import {
  Box, Card, CardActionArea, CardContent, Dialog, DialogContent, InputAdornment, Link, MenuItem, Paper, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import CardGiftcardOutlinedIcon from '@mui/icons-material/CardGiftcardOutlined';
import {
  EmptyState, ErrorAlert, LoadingState, PageActionBar, StatusBadge,
} from '../sdk';
import giftVouchersApi from './giftVouchersApi';
import GiftVoucherDetail from './GiftVoucherDetail';
import GiftVoucherTabs from './GiftVoucherTabs';
import { formatCents, formatDay } from './giftVoucherFormat';
import { STATE_BADGES, STATE_FILTERS, TEXTS } from './giftVoucherTexts';

const SEARCH_DELAY_MS = 250;
const C = TEXTS.columns;

function StateBadge({ state }) {
  const badge = STATE_BADGES[state] || STATE_BADGES.pending;
  return <StatusBadge status={badge.status} label={badge.label} />;
}

// The day a voucher was used, a link to the fiche of the passage when the server names one (the page itself is the hourly-resources plugin's).
function UsedOn({ voucher }) {
  if (!voucher.usedOn) return '—';
  if (!voucher.bookingId) return formatDay(voucher.usedOn);
  return (
    <Link component={RouterLink} to={`/passages/${voucher.bookingId}`} onClick={(e) => e.stopPropagation()} sx={{ whiteSpace: 'nowrap' }}>{formatDay(voucher.usedOn)}</Link>
  );
}

function VoucherCards({ items, selectedId, onSelect }) {
  return (
    <Stack spacing={1}>
      {items.map((v) => (
        <Card key={v.id} variant="outlined" sx={selectedId === v.id ? { borderColor: 'primary.main' } : undefined}>
          <CardActionArea onClick={() => onSelect(v.id)} sx={{ minHeight: 44 }}>
            <CardContent sx={{ p: 1.75, '&:last-child': { pb: 1.75 } }}>
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body1" fontWeight={600}>{v.number}</Typography>
                <StateBadge state={v.state} />
              </Stack>
              <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{[v.campaignName, v.contentsText].filter(Boolean).join(' · ')}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                {[v.senderName, v.recipientLabel].filter(Boolean).join(' → ') || v.buyerEmail || '—'}
              </Typography>
              <Stack direction="row" sx={{ mt: 0.5, justifyContent: 'space-between' }}>
                <Typography variant="body2">{`${formatCents(v.balanceCents)} / ${formatCents(v.amountCents)}`}</Typography>
                <Typography variant="body2" color="text.secondary">{formatDay(v.expiresOn)}</Typography>
              </Stack>
              {v.usedOn ? <Typography variant="body2" color="text.secondary">{`${C.usedOn} ${formatDay(v.usedOn)}`}</Typography> : null}
            </CardContent>
          </CardActionArea>
        </Card>
      ))}
    </Stack>
  );
}

// `compact`: with the side panel open the table keeps the columns that identify a voucher.
function VoucherTable({
  items, selectedId, onSelect, compact,
}) {
  return (
    <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{C.number}</TableCell>
            {!compact && <TableCell>{C.campaign}</TableCell>}
            {!compact && <TableCell>{C.contents}</TableCell>}
            {!compact && <TableCell>{C.from}</TableCell>}
            {!compact && <TableCell>{C.to}</TableCell>}
            {!compact && <TableCell>{C.issued}</TableCell>}
            <TableCell>{C.state}</TableCell>
            <TableCell align="right">{C.balance}</TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>{C.expiry}</TableCell>
            {!compact && <TableCell sx={{ whiteSpace: 'nowrap' }}>{C.usedOn}</TableCell>}
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((v) => (
            <TableRow
              key={v.id} hover selected={selectedId === v.id} onClick={() => onSelect(v.id)}
              sx={{ cursor: 'pointer', '& td': { py: 1.25 } }}
            >
              <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{v.number}</TableCell>
              {!compact && <TableCell>{v.campaignName || '—'}</TableCell>}
              {!compact && <TableCell>{v.contentsText}</TableCell>}
              {!compact && <TableCell>{v.senderName || '—'}</TableCell>}
              {!compact && <TableCell>{v.recipientLabel || '—'}</TableCell>}
              {!compact && <TableCell>{formatDay(v.issuedAt)}</TableCell>}
              <TableCell><StateBadge state={v.state} /></TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{`${formatCents(v.balanceCents)} / ${formatCents(v.amountCents)}`}</TableCell>
              <TableCell>{formatDay(v.expiresOn)}</TableCell>
              {!compact && <TableCell><UsedOn voucher={v} /></TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}

export default function GiftVouchersPage() {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('lg'));
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const wide = useMediaQuery(theme.breakpoints.up('md'));
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [selectedId, setSelectedId] = useState(() => (Number(params.get('bon')) || null));
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState(false);
  const [campaignId, setCampaignId] = useState('');
  const [kind, setKind] = useState('');
  const latest = useRef(0);

  const load = useCallback(() => {
    const ticket = ++latest.current;
    setError(false);
    return giftVouchersApi.list({
      q: q.trim(), state, campaignId, kind,
    })
      .then((result) => { if (ticket === latest.current) setData(result); })
      .catch(() => { if (ticket === latest.current) setError(true); });
  }, [q, state, campaignId, kind]);

  useEffect(() => {
    const timer = setTimeout(load, data === null ? 0 : SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (selectedId === null) { setDetail(null); return undefined; }
    let alive = true;
    setDetailError(false);
    giftVouchersApi.get(selectedId).then((v) => { if (alive) setDetail(v); }).catch(() => { if (alive) setDetailError(true); });
    return () => { alive = false; };
  }, [selectedId]);

  const onDetailChange = (voucher) => { setDetail(voucher); load(); };
  const select = (id) => {
    setSelectedId(id);
    if (params.has('bon')) setParams({}, { replace: true });
  };
  const newVoucher = () => navigate('/bons-cadeaux/nouveau');

  const items = data ? data.items : [];
  const filtered = Boolean(q.trim() || state || campaignId || kind);

  let body;
  if (error && !data) body = <ErrorAlert message={TEXTS.loadError} onRetry={load} />;
  else if (!data) body = <LoadingState />;
  else if (!items.length) {
    body = (
      <EmptyState
        icon={<CardGiftcardOutlinedIcon />} message={filtered ? TEXTS.emptyFiltered : TEXTS.empty}
        actionLabel={filtered ? undefined : TEXTS.newVoucher} onAction={newVoucher}
      />
    );
  } else body = wide ? <VoucherTable items={items} selectedId={selectedId} onSelect={select} compact={isDesktop && selectedId !== null} /> : <VoucherCards items={items} selectedId={selectedId} onSelect={select} />;

  let panel = null;
  if (selectedId !== null) {
    if (detailError) panel = <ErrorAlert message={TEXTS.detailError} onRetry={() => setSelectedId(selectedId)} />;
    else if (!detail) panel = <LoadingState />;
    else panel = <GiftVoucherDetail voucher={detail} onChange={onDetailChange} onClose={isDesktop ? undefined : () => select(null)} />;
  }

  return (
    <Box>
      <PageActionBar
        title={TEXTS.title} tabs={<GiftVoucherTabs value="vouchers" />}
        actionsBefore={[{ icon: <AddIcon />, tooltip: TEXTS.newVoucher, onClick: newVoucher, color: 'primary' }]}
      />
      <Box sx={{ p: { xs: 1.5, sm: 3 } }}>
        <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: selectedId !== null ? 'minmax(0, 1fr) 380px' : 'minmax(0, 1fr)' }, alignItems: 'start' }}>
          <Stack spacing={2} sx={{ minWidth: 0 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
              <TextField
                size="small" label={TEXTS.search} value={q} onChange={(e) => setQ(e.target.value)} sx={{ flex: 1, maxWidth: { sm: 360 } }}
                slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
              />
              <TextField select size="small" label={TEXTS.stateFilter} value={state} onChange={(e) => setState(e.target.value)} sx={{ minWidth: 150 }}>
                {STATE_FILTERS.map((f) => <MenuItem key={f.value || 'all'} value={f.value}>{f.label}</MenuItem>)}
              </TextField>
              <TextField select size="small" label={TEXTS.campaignFilter} value={campaignId} onChange={(e) => setCampaignId(e.target.value)} sx={{ minWidth: 150 }}>
                <MenuItem value="">{TEXTS.allCampaigns}</MenuItem>
                {((data && data.campaigns) || []).map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
              </TextField>
              <TextField select size="small" label={TEXTS.kindFilter} value={kind} onChange={(e) => setKind(e.target.value)} sx={{ minWidth: 130 }}>
                {TEXTS.kinds.map((k) => <MenuItem key={k.value || 'all'} value={k.value}>{k.label}</MenuItem>)}
              </TextField>
              {data ? (
                <Typography variant="body2" color="text.secondary" sx={{ ml: { sm: 'auto' } }} data-testid="outstanding">
                  {`${TEXTS.outstanding} : ${formatCents(data.outstandingCents)}`}
                </Typography>
              ) : null}
            </Stack>
            {error && data ? <ErrorAlert message={TEXTS.loadError} onRetry={load} /> : null}
            {body}
          </Stack>
          {isDesktop && selectedId !== null ? (
            <Paper variant="outlined" sx={{ p: 2.5, position: 'sticky', top: 'calc(var(--gf-page-bar-bottom, 120px) + 16px)' }}>{panel}</Paper>
          ) : null}
        </Box>
      </Box>
      {!isDesktop ? (
        <Dialog open={selectedId !== null} onClose={() => select(null)} fullScreen={isMobile} fullWidth maxWidth="sm">
          <DialogContent>{panel}</DialogContent>
        </Dialog>
      ) : null}
    </Box>
  );
}
