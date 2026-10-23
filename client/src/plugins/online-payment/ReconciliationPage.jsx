/**
 * ReconciliationPage — « Rapprochement bancaire » of Suivi financier (specs/qonto-bank-reconciliation.md
 * rule 28, §6): the overview of every gap and proposal across reservations, and the only place for the
 * credits no fiche claims. Table on md+, cards on xs. Counters, states, wording and actions are the
 * server's (`GET /api/payments/reconciliation?view=`); this page draws them.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box, Button, Stack, TableBody, TableCell, TableHead, TableRow, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import SyncIcon from '@mui/icons-material/Sync';
import { useNavigate } from 'react-router';
import {
  api, PageActionBar, PageTabs, TableCard, EmptyState, ErrorAlert, LoadingState, StatusBadge, PlatformChip,
} from '../sdk';
import ReconciliationLine from './ReconciliationLine';
import LinkTransactionDialog from './LinkTransactionDialog';
import useReconciliationActions from './useReconciliationActions';
import { money, lastReadLabel, readFailureLabel } from './reconciliationShared';

const TABS = [
  { view: 'todo', label: 'À traiter', count: (c) => c.gaps + c.proposed + c.unmatched },
  { view: 'done', label: 'Rapprochés', count: (c) => c.reconciled },
  { view: 'waiting', label: 'Attendus', count: (c) => c.waiting },
  { view: 'other', label: 'Autres crédits', count: (c) => c.other },
];
const COUNTERS = [
  { label: 'Écarts', key: 'gaps', view: 'todo', color: 'error.main' },
  { label: 'À confirmer', key: 'proposed', view: 'todo', color: 'info.main' },
  { label: 'Non rattachés', key: 'unmatched', view: 'todo', color: 'warning.main' },
  { label: 'Rapprochés', key: 'reconciled', view: 'done', color: 'success.main' },
];
const CREDIT_BADGE = { unmatched: ['warning', 'Non rattaché'], other: ['neutral', 'Autre crédit'], outside: ['neutral', 'Hors réservation'] };

export default function ReconciliationPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const navigate = useNavigate();
  const [view, setView] = useState('todo');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [linkCredit, setLinkCredit] = useState(null);
  const [candidates, setCandidates] = useState([]);

  const load = useCallback(async (which) => {
    try {
      setData(await api.getReconciliation(which));
      setError(null);
    } catch (err) {
      setData(null);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { setLoading(true); load(view); }, [view, load]);
  const reload = useCallback(() => load(view), [load, view]);
  const actions = useReconciliationActions({ onChanged: reload });

  const refresh = async () => {
    setReading(true);
    try {
      setData(await api.readReconciliation(view));
      setError(null);
    } catch (err) {
      if (err && err.code === 'READ_TOO_SOON') await load(view); else setError(err);
    } finally {
      setReading(false);
    }
  };

  const openLink = async (credit) => {
    try { setCandidates((await api.getReconciliationCandidates('')).items || []); } catch { setCandidates([]); }
    setLinkCredit(credit);
  };
  const receiptsForDialog = useMemo(() => candidates.map((c) => ({
    key: c.key, reservationId: c.reservation.id, ledgerKey: c.ledgerKey, label: c.label, expectedCents: c.expectedCents, clientName: c.reservation.clientName,
  })), [candidates]);
  const submitLink = async (l) => {
    const ok = await actions.link('manual', l.transactionId, [{ reservationId: l.reservationId, ledgerKey: l.ledgerKey, amountCents: l.amountCents }]);
    if (ok) setLinkCredit(null);
  };

  const openFiche = (item) => navigate(`/reservations/${item.reservation.id}`);

  const bar = (
    <PageActionBar
      title="Rapprochement bancaire"
      subtitle={data ? (
        <Typography variant="caption" color={data.lastError ? 'error.main' : 'text.secondary'}>
          {readFailureLabel(data.lastError) || lastReadLabel(data.lastReadAt)}
        </Typography>
      ) : null}
      actionsBefore={[{ icon: <SyncIcon />, tooltip: 'Actualiser', onClick: refresh, color: 'info', disabled: reading || !data }]}
    />
  );

  if (loading && !data) return <>{bar}<LoadingState /></>;
  if (error && error.code === 'QONTO_NOT_CONNECTED') {
    return (
      <>
        {bar}
        <EmptyState
          title="Qonto n'est pas connecté" message="Le rapprochement lit le compte Qonto des paiements en ligne."
          actionLabel="Ouvrir les paiements en ligne" onAction={() => navigate('/parametres/paiements')}
        />
      </>
    );
  }
  if (!data) return <>{bar}<ErrorAlert message={(error && error.message) || 'Lecture impossible.'} onRetry={reload} /></>;

  const { counts, items, credits } = data;
  const empty = items.length === 0 && credits.length === 0;

  return (
    <>
      {bar}
      {error && <ErrorAlert message={error.message} onRetry={refresh} />}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 1.25, mb: 1.5 }}>
        {COUNTERS.map((c) => (
          <Box
            key={c.key} component="button" type="button" onClick={() => setView(c.view)}
            sx={{ textAlign: 'left', font: 'inherit', cursor: 'pointer', bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1.5, p: 1.25, minHeight: 44 }}
          >
            <Typography variant="caption" color="text.secondary" component="div">{c.label}</Typography>
            <Typography sx={{ fontSize: 24, fontWeight: 700, color: c.color, fontVariantNumeric: 'tabular-nums' }}>{counts[c.key]}</Typography>
          </Box>
        ))}
      </Box>

      <PageTabs
        variant="card" value={view} onChange={setView} ariaLabel="Vues du rapprochement"
        items={TABS.map((t) => ({ value: t.view, label: `${t.label} ${t.count(counts)}` }))}
      />

      {empty ? (
        <EmptyState message={view === 'todo' ? 'Rien à traiter : chaque échéance est rapprochée ou attendue.' : 'Aucune ligne ici.'} />
      ) : (
        <>
          {items.length > 0 && (isMobile ? (
            <Box sx={{ bgcolor: 'background.paper', borderRadius: 2, px: 1.5 }}>
              {items.map((item) => (
                <ReconciliationLine
                  key={item.key} item={item} showReservation busy={actions.busy === item.key}
                  onConfirm={actions.confirm} onDiscard={actions.discard} onUndo={actions.undo} onOpenFiche={openFiche}
                />
              ))}
            </Box>
          ) : (
            <TableCard minWidth={860}>
              <TableHead>
                <TableRow>
                  <TableCell>Fiche</TableCell><TableCell>Échéance</TableCell><TableCell align="right">Attendu</TableCell>
                  <TableCell>Sur le compte</TableCell><TableCell>État</TableCell><TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((item) => {
                  const side = item.bank[0] || (item.proposal && item.proposal.bank);
                  const busy = actions.busy === item.key;
                  return (
                    <TableRow key={item.key} hover>
                      <TableCell>
                        {item.reservation.clientName || '—'} <PlatformChip platform={item.reservation.platform} sx={{ ml: 0.5 }} />
                        <Typography variant="caption" color="text.secondary" component="div">{item.reservation.propertyName}</Typography>
                      </TableCell>
                      <TableCell>{item.label}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{money(item.expectedCents)}</TableCell>
                      <TableCell>
                        {side ? (
                          <>
                            {!item.bank[0] && <Typography variant="caption" color="text.secondary">proposé · </Typography>}
                            {side.dateLabel} · <span style={{ fontVariantNumeric: 'tabular-nums' }}>{money(item.bank[0] ? item.bank.reduce((s, b) => s + b.allocatedCents, 0) : side.amountCents)}</span>
                            <Typography variant="caption" color="text.secondary" component="div">{side.counterparty}</Typography>
                          </>
                        ) : '—'}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={item.tone} label={item.stateLabel} />
                        {item.proposal && <Typography variant="caption" color="text.secondary" component="div">{item.proposal.confidenceLabel}</Typography>}
                        {item.fixText && <Typography variant="caption" color="text.secondary" component="div" sx={{ maxWidth: 260 }}>{item.fixText}</Typography>}
                      </TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        {item.proposal && <Button size="small" variant="contained" disabled={busy} onClick={() => actions.confirm(item)} sx={{ mr: 0.5, textTransform: 'none' }}>Confirmer</Button>}
                        {item.proposal && <Button size="small" color="inherit" disabled={busy} onClick={() => actions.discard(item)} sx={{ textTransform: 'none' }}>Écarter</Button>}
                        {item.canUndo && <Button size="small" color="inherit" disabled={busy} onClick={() => actions.undo(item)} sx={{ textTransform: 'none' }}>Défaire</Button>}
                        {item.isGap && <Button size="small" variant="outlined" onClick={() => openFiche(item)} sx={{ ml: 0.5, textTransform: 'none' }}>Ouvrir la fiche</Button>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </TableCard>
          ))}

          {credits.length > 0 && (
            <Box sx={{ bgcolor: 'background.paper', borderRadius: 2, px: 1.5, mt: items.length > 0 ? 1.5 : 0 }}>
              {credits.map((credit) => {
                const [tone, label] = CREDIT_BADGE[credit.status] || CREDIT_BADGE.other;
                const busy = actions.busy === credit.transactionId;
                return (
                  <Box key={credit.transactionId} sx={{ py: 1.5, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 } }}>
                    <Stack direction="row" gap={1} sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{money(credit.remainingCents || credit.amountCents)} · {credit.dateLabel}</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                          {credit.counterparty}{credit.reference ? ` · « ${credit.reference} »` : ''}
                        </Typography>
                        {credit.note && <Typography variant="caption" color="text.secondary" component="div">{credit.note}</Typography>}
                      </Box>
                      <StatusBadge status={tone} label={label} />
                    </Stack>
                    <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} sx={{ mt: 1 }}>
                      {credit.status !== 'outside' && <Button variant="outlined" disabled={busy} onClick={() => openLink(credit)} sx={{ minHeight: 44, textTransform: 'none' }}>Rattacher à une fiche</Button>}
                      {credit.status !== 'outside' && <Button variant="text" color="inherit" disabled={busy} onClick={() => actions.setOutside(credit, true)} sx={{ minHeight: 44, textTransform: 'none' }}>Hors réservation</Button>}
                      {credit.status === 'outside' && <Button variant="text" color="inherit" disabled={busy} onClick={() => actions.setOutside(credit, false)} sx={{ minHeight: 44, textTransform: 'none' }}>Remettre</Button>}
                    </Stack>
                  </Box>
                );
              })}
            </Box>
          )}
        </>
      )}

      <LinkTransactionDialog
        open={Boolean(linkCredit)} onClose={() => setLinkCredit(null)} credit={linkCredit} receipts={receiptsForDialog}
        busy={actions.busy === 'manual'} onSubmit={submitLink}
      />
    </>
  );
}
