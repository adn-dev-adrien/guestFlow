/**
 * SasArrivalOrdersStep — « Commandes Mon séjour », the arrival SAS step (specs/guest-app.md rules 71, 87).
 *
 * The orders the stay took in the guest app before its arrival, ready to render by the server (`ordersAtArrival`): one line
 * that folds and unfolds the list (« 2 commandes · 34 € à percevoir »), one group per order (number, delivery time, status chip,
 * one row per article with its unit line and price, its total), « Total à percevoir » and « Déjà payé par carte ». An unpaid
 * order is edited here (stepper per line, « Retirer », « Retirer la commande » through a ConfirmDialog): each gesture is one
 * request, then the SAS data is read again (`onRefresh`) so nothing stale remains. A card-paid order is read-only and never
 * counts in what is collected. The step collects nothing itself: the recap's single payment does. Laid out as the HTML mock
 * of specs/guest-app-j7-resume.html: the price stays beside the label and wraps under it at 390 px, the controls take their own row.
 *
 * Props: `data` (`pluginData['guest-app']` of the SAS, `{ ordersAtArrival }`), `onRefresh` (reads the SAS data and the recap again).
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
  hint: 'Comprises dans le complément d’arrivée.',
  toCollect: 'Total à percevoir',
  paid: 'Déjà payé par carte',
  total: 'Total de la commande',
  remove: 'Retirer',
  removeOrder: 'Retirer la commande',
  confirmTitle: 'Retirer la commande ?',
  confirmMessage: (number) => `La commande n° ${number} est retirée du séjour : elle ne sera ni livrée ni facturée.`,
  changed: 'Lignes modifiées depuis la commande : le montant à percevoir est celui du récapitulatif.',
  error: 'Modification impossible.',
  none: 'Plus aucune commande à percevoir.',
};

const figure = { fontVariantNumeric: 'tabular-nums' };

function QuantityControl({ line, disabled, onChange }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', border: 1, borderColor: 'divider', borderRadius: 999 }}>
      <IconButton aria-label={`Moins de ${line.label}`} disabled={disabled || line.quantity <= 1} onClick={() => onChange(line.quantity - 1)} sx={{ width: 44, height: 44 }}>
        <RemoveIcon fontSize="small" />
      </IconButton>
      <Typography component="span" sx={{ minWidth: 28, textAlign: 'center', ...figure }} aria-label={`Quantité de ${line.label}`}>{line.quantity}</Typography>
      <IconButton aria-label={`Plus de ${line.label}`} disabled={disabled || line.quantity >= line.maxQuantity} onClick={() => onChange(line.quantity + 1)} sx={{ width: 44, height: 44 }}>
        <AddIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}

function LineRow({ line, editable, busy, onAmend }) {
  const controls = editable && (line.editable || line.removable);
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: 2, rowGap: 0.25, alignItems: 'center', py: 1, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 } }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{line.label}</Typography>
        {line.unitLabel ? <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere', ...figure }}>{line.unitLabel}</Typography> : null}
      </Box>
      <Typography variant="body2" sx={{ textAlign: 'right', ...figure }}>{line.amountLabel}</Typography>
      {controls ? (
        <Stack direction="row" spacing={1} sx={{ gridColumn: '1 / -1', alignItems: 'center' }}>
          {line.editable ? <QuantityControl line={line} disabled={busy} onChange={(quantity) => onAmend({ lines: [{ key: line.key, quantity }] })} /> : null}
          {line.removable ? (
            <Button size="small" color="error" disabled={busy} onClick={() => onAmend({ lines: [{ key: line.key, quantity: 0 }] })} sx={{ minHeight: 44, textTransform: 'none' }}>{TEXT.remove}</Button>
          ) : null}
        </Stack>
      ) : null}
    </Box>
  );
}

function OrderGroup({ order, busy, onAmend, onRemoveOrder }) {
  return (
    <Box component="section" aria-label={`Commande n° ${order.number}`} sx={{ borderTop: 1, borderColor: 'divider', px: { xs: 1.5, sm: 2 }, py: 1.5 }}>
      <Stack direction="row" useFlexGap sx={{ flexWrap: 'wrap', columnGap: 1, rowGap: 0.5, justifyContent: 'space-between', alignItems: 'baseline', mb: 0.5 }}>
        <Typography component="span" variant="subtitle2">
          {`Commande n° ${order.number}`}
          {order.deliveryLabel ? <Typography component="span" variant="caption" color="text.secondary">{` ${order.deliveryLabel}`}</Typography> : null}
        </Typography>
        <Chip size="small" label={order.statusLabel} color={order.paid ? 'success' : 'default'} variant="outlined" />
      </Stack>
      {order.lines.map((line) => (
        <LineRow key={line.key} line={line} editable={order.editable} busy={busy} onAmend={(body) => onAmend(order, body)} />
      ))}
      <Stack direction="row" sx={{ justifyContent: 'space-between', pt: 1, mt: 0.5, borderTop: 1, borderColor: 'divider', ...figure }}>
        <Typography variant="subtitle2">{TEXT.total}</Typography>
        <Typography variant="subtitle2">{order.totalLabel}</Typography>
      </Stack>
      {order.editable ? (
        <Box sx={{ textAlign: 'right' }}>
          <Button color="error" size="small" disabled={busy} onClick={() => onRemoveOrder(order)} sx={{ minHeight: 44, textTransform: 'none' }}>{TEXT.removeOrder}</Button>
        </Box>
      ) : null}
    </Box>
  );
}

export default function SasArrivalOrdersStep({ data, onRefresh }) {
  const served = data ? data.ordersAtArrival : null;
  const [current, setCurrent] = useState(served);
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(null);
  useEffect(() => { setCurrent(served); }, [served]);
  if (!current) return <Typography variant="body2" color="text.secondary">{TEXT.none}</Typography>;
  // Folded when every order is paid, unfolded otherwise (rule 71).
  const expanded = open === null ? current.toCollect > 0 : open;

  const amend = async (order, body) => {
    setBusy(true);
    setError('');
    try {
      const out = await guestAppApi.amendOrder(order.id, body);
      setCurrent(out.ordersAtArrival);
      if (onRefresh) await onRefresh();
    } catch (err) {
      setError((err && err.message) || TEXT.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">{TEXT.hint}</Typography>
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden', bgcolor: 'background.paper' }}>
        <Button
          onClick={() => setOpen(!expanded)}
          aria-expanded={expanded}
          aria-controls="stay-app-orders-list"
          color="inherit"
          fullWidth
          endIcon={<ExpandMoreIcon sx={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 200ms ease', '@media (prefers-reduced-motion: reduce)': { transition: 'none' } }} />}
          sx={{ justifyContent: 'space-between', minHeight: 56, px: 2, borderRadius: 0, textAlign: 'left', textTransform: 'none' }}
        >
          <Typography component="span" variant="subtitle2" sx={{ ...figure, overflowWrap: 'anywhere' }}>{current.summaryLabel}</Typography>
        </Button>
        <Collapse in={expanded} unmountOnExit>
          <Box id="stay-app-orders-list">
            {error ? <Alert severity="error" onClose={() => setError('')} sx={{ m: 1.5 }}>{error}</Alert> : null}
            {current.orders.map((order) => <OrderGroup key={order.id} order={order} busy={busy} onAmend={amend} onRemoveOrder={setRemoving} />)}
            <Stack spacing={0.5} sx={{ px: { xs: 1.5, sm: 2 }, py: 1.5, borderTop: 1, borderColor: 'divider', bgcolor: 'action.hover', ...figure }}>
              <Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography variant="subtitle2">{TEXT.toCollect}</Typography><Typography variant="subtitle2">{current.toCollectLabel}</Typography></Stack>
              {current.paidLabel ? <Stack direction="row" sx={{ justifyContent: 'space-between' }}><Typography variant="body2" color="text.secondary">{TEXT.paid}</Typography><Typography variant="body2" color="text.secondary">{current.paidLabel}</Typography></Stack> : null}
            </Stack>
          </Box>
        </Collapse>
      </Box>
      {current.changed ? <Typography variant="caption" color="text.secondary">{TEXT.changed}</Typography> : null}
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
