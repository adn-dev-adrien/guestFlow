/**
 * SasArrivalOrdersStep — « Commandes Mon séjour », the arrival SAS step (specs/guest-app.md rules 71, 87).
 *
 * The orders the stay took in the guest app before its arrival, ready to render by the server (`ordersAtArrival`): a
 * summary line « 2 commandes · 36 € à percevoir » that folds and unfolds the list, one group per order (number, delivery
 * time, status, its lines « label · quantity × unit · price », its total), « Total à percevoir » and « Déjà payé par carte ».
 * An unpaid order is edited here (stepper per line, « Retirer », « Retirer la commande » through a ConfirmDialog): each
 * gesture is one request, answered with the fresh data. A card-paid order is read-only and never counts in what is
 * collected. The step collects nothing itself: the recap's single payment does.
 *
 * Props: `data` (`pluginData['guest-app'].ordersAtArrival` carried by the SAS payload as `{ ordersAtArrival }`).
 */
import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, Collapse, IconButton, Stack, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { ConfirmDialog } from '../sdk';
import guestAppApi from './guestAppApi';

const TEXT = {
  title: 'Commandes Mon séjour',
  summary: (count, toCollect) => `${count} commande${count > 1 ? 's' : ''}${toCollect ? ` · ${toCollect} à percevoir` : ''}`,
  hint: 'Comprises dans le complément d’arrivée.',
  toCollect: 'Total à percevoir',
  paid: 'Déjà payé par carte',
  remove: 'Retirer',
  removeOrder: 'Retirer la commande',
  confirmTitle: 'Retirer la commande ?',
  confirmMessage: (number) => `La commande n° ${number} est retirée du séjour : elle ne sera pas livrée ni facturée.`,
  changed: 'Lignes modifiées depuis la commande : le montant à percevoir est celui du récapitulatif.',
  error: 'Modification impossible.',
};

function QuantityControl({ line, disabled, onChange }) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <IconButton size="small" aria-label={`Moins de ${line.label}`} disabled={disabled || line.quantity <= 1} onClick={() => onChange(line.quantity - 1)} sx={{ width: 44, height: 44 }}>
        <RemoveIcon fontSize="small" />
      </IconButton>
      <Typography component="span" sx={{ minWidth: 24, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }} aria-label={`Quantité de ${line.label}`}>{line.quantity}</Typography>
      <IconButton size="small" aria-label={`Plus de ${line.label}`} disabled={disabled || line.quantity >= line.maxQuantity} onClick={() => onChange(line.quantity + 1)} sx={{ width: 44, height: 44 }}>
        <AddIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}

function OrderGroup({ order, busy, onAmend, onRemoveOrder }) {
  return (
    <Box component="section" aria-label={`Commande n° ${order.number}`} sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: { xs: 1.5, sm: 2 } }}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box>
          <Typography variant="subtitle2">{`Commande n° ${order.number}`}</Typography>
          {order.deliveryLabel ? <Typography variant="caption" color="text.secondary">{order.deliveryLabel}</Typography> : null}
        </Box>
        <Chip size="small" label={order.statusLabel} color={order.paid ? 'success' : 'default'} variant="outlined" />
      </Stack>
      <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />} sx={{ mt: 1 }}>
        {order.lines.map((line) => (
          <Stack key={line.key} direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between',  py: 0.75 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{line.label}</Typography>
              {line.unitLabel ? <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{line.unitLabel}</Typography> : null}
            </Box>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center',  flexShrink: 0 }}>
              {order.editable && line.editable ? <QuantityControl line={line} disabled={busy} onChange={(quantity) => onAmend(order, { lines: [{ key: line.key, quantity }] })} /> : null}
              <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', minWidth: 56, textAlign: 'right' }}>{line.amountLabel}</Typography>
              {order.editable && line.removable ? (
                <Button size="small" color="inherit" disabled={busy} onClick={() => onAmend(order, { lines: [{ key: line.key, quantity: 0 }] })} sx={{ minHeight: 44 }}>{TEXT.remove}</Button>
              ) : null}
            </Stack>
          </Stack>
        ))}
      </Stack>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center',  mt: 1 }}>
        <Typography variant="subtitle2">Total</Typography>
        <Typography variant="subtitle2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{order.totalLabel}</Typography>
      </Stack>
      {order.editable ? (
        <Button color="error" size="small" disabled={busy} onClick={() => onRemoveOrder(order)} sx={{ mt: 1, minHeight: 44 }}>{TEXT.removeOrder}</Button>
      ) : null}
    </Box>
  );
}

export default function SasArrivalOrdersStep({ data }) {
  const [current, setCurrent] = useState(data ? data.ordersAtArrival : null);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(null);
  useEffect(() => { setCurrent(data ? data.ordersAtArrival : null); }, [data]);
  if (!current) return null;
  // Folded when every order is paid, unfolded otherwise (rule 71).
  const expanded = open === null ? current.toCollect > 0 : open;

  const amend = async (order, body) => {
    setBusy(true);
    setError('');
    try {
      const out = await guestAppApi.amendOrder(order.id, body);
      setCurrent(out.ordersAtArrival);
    } catch (err) {
      setError((err && err.message) || TEXT.error);
    } finally {
      setBusy(false);
    }
  };

  const toCollect = current.toCollect > 0 ? current.toCollectLabel : '';
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">{TEXT.hint}</Typography>
      <Button
        onClick={() => setOpen(!expanded)}
        aria-expanded={expanded}
        aria-controls="stay-app-orders-list"
        color="inherit"
        endIcon={<ExpandMoreIcon sx={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 200ms ease', '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }} />}
        sx={{ justifyContent: 'space-between', border: 1, borderColor: 'divider', borderRadius: 2, minHeight: 56, textAlign: 'left', textTransform: 'none' }}
      >
        <Typography component="span" variant="subtitle1">{`${TEXT.title} — ${TEXT.summary(current.orders.length, toCollect)}`}</Typography>
      </Button>
      <Collapse in={expanded} unmountOnExit>
        <Stack spacing={1.5} id="stay-app-orders-list">
          {error ? <Alert severity="error" onClose={() => setError('')}>{error}</Alert> : null}
          {current.orders.map((order) => <OrderGroup key={order.id} order={order} busy={busy} onAmend={amend} onRemoveOrder={setRemoving} />)}
          <Stack spacing={0.5} sx={{ pt: 1 }}>
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography variant="subtitle2">{TEXT.toCollect}</Typography><Typography variant="subtitle2">{current.toCollectLabel}</Typography></Stack>
            {current.paidLabel ? <Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography variant="body2" color="text.secondary">{TEXT.paid}</Typography><Typography variant="body2" color="text.secondary">{current.paidLabel}</Typography></Stack> : null}
          </Stack>
          {current.changed ? <Typography variant="caption" color="text.secondary">{TEXT.changed}</Typography> : null}
        </Stack>
      </Collapse>
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={() => { const order = removing; setRemoving(null); amend(order, { removeOrder: true }); }}
        title={TEXT.confirmTitle}
        message={removing ? TEXT.confirmMessage(removing.number) : ''}
        confirmLabel={TEXT.removeOrder}
      />
    </Stack>
  );
}
