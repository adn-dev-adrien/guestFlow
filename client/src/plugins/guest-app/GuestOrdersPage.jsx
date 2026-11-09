/**
 * GuestOrdersPage — « Commandes clients » (specs/guest-app.md rules 41bis, 45; §6.6): the orders guests placed in
 * « Mon séjour », by delivery time. « À préparer » (default) lists what is on the fiche and not delivered yet;
 * « Toutes » the last 30 days. Each order: when, lodging and guest, its lines, how it is paid, its status, « Voir
 * la fiche » and « Marquer livrée » (« Marquer retirée » in pickup mode — the server's words). Every label comes
 * from `GET /api/guest-app/orders`; the page only renders.
 *
 * The « Commandes clients » push opens `/commandes-app?order=<id>`: that order is outlined and scrolled into view,
 * looked for in « Toutes » when it is no longer to prepare.
 *
 * Admin and reception (the reception prepares and delivers).
 */
import React, {
  useCallback, useEffect, useRef, useState,
} from 'react';
import {
  Box, Button, Card, CardContent, CircularProgress, Stack, Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import CheckIcon from '@mui/icons-material/Check';
import RoomServiceOutlinedIcon from '@mui/icons-material/RoomServiceOutlined';
import { Link as RouterLink, useSearchParams } from 'react-router';
import {
  EmptyState, ErrorAlert, LoadingState, PageActionBar, PageTabs, StatusBadge, useToast, withFrom,
} from '../sdk';
import guestAppApi from './guestAppApi';

const FILTERS = [{ value: 'todo', label: 'À préparer' }, { value: 'all', label: 'Toutes' }];
const STATUS_TONE = {
  awaiting_payment: 'warning', confirmed: 'info', paid: 'info', delivered: 'success',
  paid_conflict: 'error', expired: 'neutral', abandoned: 'neutral',
};
const PAYMENT_TONE = { card: 'info', note: 'neutral', none: 'success' };
const EMPTY = {
  todo: 'Aucune commande à préparer. Les commandes passées dans l’application « Mon séjour » arrivent ici.',
  all: 'Aucune commande ces 30 derniers jours.',
};

function OrderRow({
  order, highlighted, busy, onMark, rowRef,
}) {
  return (
    <Card
      ref={rowRef}
      variant="outlined"
      data-order-id={order.id}
      sx={(t) => ({
        scrollMarginTop: 140,
        ...(highlighted ? { borderColor: t.palette.primary.main, boxShadow: `0 0 0 1px ${t.palette.primary.main}` } : {}),
      })}
    >
      <CardContent
        sx={{
          p: { xs: 2, sm: 2.25 },
          '&:last-child': { pb: { xs: 2, sm: 2.25 } },
          display: 'grid',
          gap: { xs: 1.5, md: 2.5 },
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: '150px minmax(0, 1.1fr) minmax(0, 1.4fr) auto' },
          alignItems: 'start',
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body1" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {order.deliverLabel || 'Sans heure de livraison'}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {`Commande n° ${order.id}`}
          </Typography>
        </Box>

        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
            {[order.lodging, order.guest].filter(Boolean).join(' · ')}
          </Typography>
          <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap', mt: 0.75 }}>
            <StatusBadge status={PAYMENT_TONE[order.payment] || 'neutral'} label={`${order.paymentLabel} · ${order.totalLabel}`} />
            <StatusBadge status={STATUS_TONE[order.status] || 'neutral'} label={order.statusLabel} wrap />
          </Stack>
          {order.fulfilment === 'pickup' && (
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.75, overflowWrap: 'anywhere' }}>
              {order.pickupPlace ? `${order.fulfilmentLabel} : ${order.pickupPlace}` : order.fulfilmentLabel}
            </Typography>
          )}
        </Box>

        <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', minWidth: 0 }}>
          {order.lines.map((line, i) => (
            <Box
              component="li"
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.25 }}
            >
              <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{line.label}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {line.totalLabel}
              </Typography>
            </Box>
          ))}
        </Box>

        <Stack
          direction={{ xs: 'column', sm: 'row', md: 'column' }}
          spacing={1}
          sx={{ alignItems: { xs: 'stretch', md: 'flex-end' }, justifySelf: { md: 'end' } }}
        >
          <Button
            component={RouterLink}
            to={withFrom(`/reservations/${order.reservationId}`, '/commandes-app')}
            variant="outlined"
            size="small"
            startIcon={<OpenInNewIcon fontSize="small" />}
            sx={{ minHeight: 44, whiteSpace: 'nowrap' }}
          >
            Voir la fiche
          </Button>
          {order.canMarkDelivered && (
            <Button
              variant="contained"
              size="small"
              disabled={busy}
              onClick={() => onMark(order)}
              startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <CheckIcon fontSize="small" />}
              sx={{ minHeight: 44, whiteSpace: 'nowrap' }}
            >
              {order.markLabel}
            </Button>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function GuestOrdersPage() {
  const [params] = useSearchParams();
  const focusId = Number(params.get('order')) || null;
  const [status, setStatus] = useState('todo');
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [looked, setLooked] = useState(false);
  const rows = useRef(new Map());
  const { showError } = useToast();

  const load = useCallback(async (which) => {
    setError(false);
    try {
      const body = await guestAppApi.getOrders(which);
      setOrders((body && body.orders) || []);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => { setOrders(null); load(status); }, [status, load]);

  // The push's order: outlined and brought into view; looked for in « Toutes » once if it is no longer to prepare.
  useEffect(() => {
    if (!focusId || !orders) return;
    const node = rows.current.get(focusId);
    if (node) {
      if (node.scrollIntoView) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (status === 'todo' && !looked) {
      setLooked(true);
      setStatus('all');
    }
  }, [focusId, orders, status, looked]);

  const mark = async (order) => {
    setBusyId(order.id);
    try {
      await guestAppApi.markDelivered(order.id);
      await load(status);
    } catch (err) {
      showError(err.message || 'La commande n’a pas pu être marquée.');
    } finally {
      setBusyId(null);
    }
  };

  let body;
  if (error) body = <ErrorAlert onRetry={() => load(status)} />;
  else if (!orders) body = <LoadingState variant="skeleton" rows={4} />;
  else if (orders.length === 0) body = <EmptyState icon={<RoomServiceOutlinedIcon />} message={EMPTY[status]} />;
  else {
    body = (
      <Stack spacing={1.5}>
        {orders.map((order) => (
          <OrderRow
            key={order.id}
            order={order}
            highlighted={order.id === focusId}
            busy={busyId === order.id}
            onMark={mark}
            rowRef={(node) => { if (node) rows.current.set(order.id, node); else rows.current.delete(order.id); }}
          />
        ))}
      </Stack>
    );
  }

  return (
    <Box>
      <PageActionBar
        title="Commandes clients"
        tabs={<PageTabs value={status} onChange={setStatus} items={FILTERS} ariaLabel="Commandes à afficher" />}
        actionsBefore={[{
          icon: <RefreshIcon />, tooltip: 'Actualiser', color: 'info', onClick: () => load(status),
        }]}
      />
      <Box sx={{ mt: 2 }}>{body}</Box>
    </Box>
  );
}
