/**
 * CancellationCompensationsSection — the « Indemnités d'annulation » card of the Comptabilité page
 * (specs/cancellation-compensation.md §6.3).
 *
 * Two lists in one card: the compensations BANKED in the selected month (they carry the month's
 * journal entries) and, month-independent, the ones still PENDING — they have no accounting date
 * yet, so hiding them behind a month picker would make them invisible.
 *
 * Read-only for the accountant role (`canEdit=false`): the server refuses their writes anyway, and
 * showing dead buttons would be a lie. Amounts, totals and the « En retard » flag all arrive
 * computed from the server.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Box, Card, CardContent, Stack, Typography, Button, TableCell, TableRow, Link,
} from '@mui/material';
import { Link as RouterLink } from 'react-router';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import PaymentsIcon from '@mui/icons-material/Payments';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import api from '../api';
import ResponsiveTable from './ResponsiveTable';
import StatusBadge from './StatusBadge';
import PlatformChip from './PlatformChip';
import LoadingState from './LoadingState';
import CancellationCompensationDialog from './CancellationCompensationDialog';
import { useAppDialogs, useToast } from './DialogProvider';
import { displayDate, displayDateShort, formatCurrency } from '../utils/formatters';

export default function CancellationCompensationsSection({ month, year, canEdit = false }) {
  const { confirm } = useAppDialogs();
  const { showSuccess, showError } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null); // { mode, compensation }

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.getCancellationCompensations(month, year));
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSubmit = useCallback(async (payload) => {
    if (!dialog) return;
    const { mode, compensation } = dialog;
    setBusy(true);
    try {
      if (mode === 'create') {
        await api.createCancellationCompensation(payload);
        showSuccess('Indemnité ajoutée.');
      } else if (mode === 'receive') {
        await api.receiveCancellationCompensation(compensation.id, payload);
        showSuccess('Indemnité encaissée.');
      } else {
        await api.updateCancellationCompensation(compensation.id, { ...compensation, ...payload });
        showSuccess('Indemnité mise à jour.');
      }
      setDialog(null);
      await refresh();
      window.dispatchEvent(new CustomEvent('guestflow:compensations-changed'));
    } catch (err) {
      showError(err.message || 'Enregistrement impossible.');
    } finally {
      setBusy(false);
    }
  }, [dialog, refresh, showSuccess, showError]);

  const handleReopen = useCallback(async (compensation) => {
    const ok = await confirm({
      title: "Rouvrir cette indemnité ?",
      message: "Elle quittera immédiatement le journal comptable du mois. Si le CSV de ce mois a déjà été transmis au comptable, il faudra le renvoyer.",
      confirmLabel: 'Rouvrir',
      confirmColor: 'warning',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api.reopenCancellationCompensation(compensation.id);
      await refresh();
      window.dispatchEvent(new CustomEvent('guestflow:compensations-changed'));
    } catch (err) {
      showError(err.message || 'Réouverture impossible.');
    } finally {
      setBusy(false);
    }
  }, [confirm, refresh, showError]);

  const received = data?.received || [];
  const pending = data?.pending || [];

  const clientCell = (c) => c.clientName || `Indemnité #${c.id}`;
  // specs/payment-schedule-and-cancellation.md §3.6 rule 33 — an indemnity is either what a platform
  // pays back, or an acompte we already held and kept after cancelling for non-payment. The two are
  // the same accounting object but not the same story, so the card says which one it is and, for the
  // retained acompte, links to the stay it came from.
  const originBadge = (c) => (c.origin === 'retained_deposit'
    ? (
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <StatusBadge status="neutral" label="Acompte conservé" />
        {c.reservationId ? (
          <Link component={RouterLink} to={`/reservations/${c.reservationId}`} variant="caption">
            voir le séjour
          </Link>
        ) : null}
      </Stack>
    )
    : null);
  const stayCell = (c) => (c.startDate && c.endDate
    ? `${displayDateShort(c.startDate)} → ${displayDateShort(c.endDate)}`
    : '—');

  return (
    <Card variant="outlined" sx={{ mb: 3 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          sx={{ mb: 2, gap: 1, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Box>
            <Typography variant="sectionHeader">Indemnités d&apos;annulation</Typography>
            <Typography variant="body2" color="text.secondary">
              Ce qu&apos;une plateforme verse pour un séjour annulé, ou l&apos;acompte conservé quand nous
              annulons un séjour faute de règlement. Comptabilisée au mois du versement, modifiable tant
              qu&apos;elle n&apos;est pas encaissée.
            </Typography>
          </Box>
          {canEdit && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => setDialog({ mode: 'create', compensation: null })}
            >
              Ajouter
            </Button>
          )}
        </Stack>

        {loading ? <LoadingState py={2} /> : (
          <Stack spacing={3}>
            <Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', mb: 1, flexWrap: 'wrap' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>Encaissées ce mois</Typography>
                <Typography variant="body2" color="text.secondary">
                  Total : <strong>{formatCurrency(data?.totals?.receivedInMonth || 0)}</strong>
                </Typography>
              </Stack>
              <ResponsiveTable
                items={received}
                getKey={(c) => c.id}
                emptyText="Aucune indemnité encaissée ce mois-ci."
                head={(
                  <TableRow>
                    <TableCell>Versement</TableCell>
                    <TableCell>Logement</TableCell>
                    <TableCell>Client</TableCell>
                    <TableCell>Plateforme</TableCell>
                    <TableCell>Séjour annulé</TableCell>
                    <TableCell align="right">Montant</TableCell>
                    {canEdit && <TableCell align="right" sx={{ width: 120 }} />}
                  </TableRow>
                )}
                renderRow={(c) => (
                  <TableRow key={c.id}>
                    <TableCell>{displayDate(c.receivedDate)}</TableCell>
                    <TableCell>{c.propertyName || '—'}</TableCell>
                    <TableCell>
                      {clientCell(c)}
                      {originBadge(c)}
                    </TableCell>
                    <TableCell><PlatformChip platform={c.platform} /></TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{stayCell(c)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {formatCurrency(c.receivedAmount)}
                    </TableCell>
                    {canEdit && (
                      <TableCell align="right">
                        <Button size="small" startIcon={<LockOpenIcon />} disabled={busy} onClick={() => handleReopen(c)}>
                          Rouvrir
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                )}
                renderMobileCard={(c) => (
                  <Stack spacing={0.5}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{clientCell(c)}</Typography>
                    {originBadge(c)}
                    <Typography variant="body2" color="text.secondary">
                      {displayDate(c.receivedDate)} · {c.propertyName || '—'} · {c.platform || '—'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">Séjour annulé : {stayCell(c)}</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{formatCurrency(c.receivedAmount)}</Typography>
                    {canEdit && (
                      <Button size="small" startIcon={<LockOpenIcon />} disabled={busy} onClick={() => handleReopen(c)} sx={{ alignSelf: 'flex-start' }}>
                        Rouvrir
                      </Button>
                    )}
                  </Stack>
                )}
              />
            </Box>

            <Box>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', mb: 1, flexWrap: 'wrap' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>En attente de versement</Typography>
                <Typography variant="body2" color="text.secondary">
                  Attendu : <strong>{formatCurrency(data?.totals?.pendingExpected || 0)}</strong> — hors comptabilité
                  tant que l&apos;argent n&apos;est pas arrivé.
                </Typography>
              </Stack>
              <ResponsiveTable
                items={pending}
                getKey={(c) => c.id}
                emptyText="Aucune indemnité en attente."
                head={(
                  <TableRow>
                    <TableCell>Prévu le</TableCell>
                    <TableCell>Logement</TableCell>
                    <TableCell>Client</TableCell>
                    <TableCell>Plateforme</TableCell>
                    <TableCell>Séjour annulé</TableCell>
                    <TableCell align="right">Attendu</TableCell>
                    {canEdit && <TableCell align="right" sx={{ width: 200 }} />}
                  </TableRow>
                )}
                renderRow={(c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <span>{c.expectedDate ? displayDate(c.expectedDate) : '—'}</span>
                        {c.overdue && <StatusBadge status="warning" label="En retard" />}
                      </Stack>
                    </TableCell>
                    <TableCell>{c.propertyName || '—'}</TableCell>
                    <TableCell>{clientCell(c)}</TableCell>
                    <TableCell><PlatformChip platform={c.platform} /></TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{stayCell(c)}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatCurrency(c.expectedAmount)}
                    </TableCell>
                    {canEdit && (
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                          <Button size="small" startIcon={<PaymentsIcon />} disabled={busy} onClick={() => setDialog({ mode: 'receive', compensation: c })}>
                            Encaisser
                          </Button>
                          <Button size="small" startIcon={<EditIcon />} disabled={busy} onClick={() => setDialog({ mode: 'edit', compensation: c })}>
                            Modifier
                          </Button>
                        </Stack>
                      </TableCell>
                    )}
                  </TableRow>
                )}
                renderMobileCard={(c) => (
                  <Stack spacing={0.5}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{clientCell(c)}</Typography>
                      {c.overdue && <StatusBadge status="warning" label="En retard" />}
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {c.propertyName || '—'} · {c.platform || '—'} · séjour {stayCell(c)}
                    </Typography>
                    <Typography variant="body2">
                      Attendu : <strong>{formatCurrency(c.expectedAmount)}</strong>
                      {c.expectedDate ? ` · prévu le ${displayDateShort(c.expectedDate)}` : ''}
                    </Typography>
                    {canEdit && (
                      <Stack direction="row" spacing={1} sx={{ pt: 0.5 }}>
                        <Button size="small" startIcon={<PaymentsIcon />} disabled={busy} onClick={() => setDialog({ mode: 'receive', compensation: c })}>
                          Encaisser
                        </Button>
                        <Button size="small" startIcon={<EditIcon />} disabled={busy} onClick={() => setDialog({ mode: 'edit', compensation: c })}>
                          Modifier
                        </Button>
                      </Stack>
                    )}
                  </Stack>
                )}
              />
            </Box>
          </Stack>
        )}
      </CardContent>

      <CancellationCompensationDialog
        open={Boolean(dialog)}
        mode={dialog ? dialog.mode : 'edit'}
        busy={busy}
        context={dialog?.compensation || {}}
        onClose={() => setDialog(null)}
        onSubmit={handleSubmit}
      />
    </Card>
  );
}
