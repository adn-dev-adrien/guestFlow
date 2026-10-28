/**
 * ReconciliationPage — « Rapprochement bancaire » of Suivi financier (specs/qonto-bank-reconciliation.md
 * rule 28, §6): the overview of every gap and proposal across reservations, and the only place for the
 * credits no fiche claims. Table on md+, cards on xs. Counters, states, wording and actions are the
 * server's (`GET /api/payments/reconciliation?view=&filter=`); this page draws them. A counter is a filter
 * kept in the URL (specs/reconciliation-assisted-matching.md rule 11); « Tout confirmer » confirms the
 * view's proposals in one batch (rules 12–13).
 */
import React, {
  useCallback, useEffect, useRef, useState,
} from 'react';
import {
  Box, Button, Stack, TableBody, TableCell, TableHead, TableRow, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import SyncIcon from '@mui/icons-material/Sync';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import { useNavigate, useSearchParams } from 'react-router';
import {
  api, useToast, PageActionBar, PageTabs, TableCard, EmptyState, ErrorAlert, LoadingState, StatusBadge, PlatformChip, FilterChip, PlatformPenaltyDialog,
} from '../sdk';
import ReconciliationLine, { BankCell } from './ReconciliationLine';
import LinkTransactionDialog from './LinkTransactionDialog';
import BulkConfirmDialog from './BulkConfirmDialog';
import SplitSharesDialog from './SplitSharesDialog';
import useReconciliationActions from './useReconciliationActions';
import { money, lastReadLabel, readFailureLabel, shareLabels } from './reconciliationShared';

const TABS = [
  { view: 'todo', label: 'À traiter', count: (c) => c.todo },
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
// `auto` is no counter: « Voir » after an automatic read leads to the lines the server confirmed alone.
const FILTER_VIEWS = { gaps: 'todo', proposed: 'todo', unmatched: 'todo', reconciled: 'done', auto: 'done' };
const FILTER_LABELS = { gaps: 'Écarts', proposed: 'À confirmer', unmatched: 'Non rattachés', reconciled: 'Rapprochés', auto: 'Rapprochements automatiques' };
const FILTER_EMPTY = {
  gaps: 'Aucun écart à traiter.', proposed: 'Plus rien à confirmer.', unmatched: 'Aucun virement non rattaché.',
  reconciled: 'Aucun rapprochement.', auto: 'Aucun rapprochement automatique.',
};
const FILTER_KEYS = Object.keys(FILTER_VIEWS);
const CREDIT_BADGE = { unmatched: ['warning', 'Non rattaché'], other: ['neutral', 'Autre crédit'], outside: ['neutral', 'Hors réservation'] };

export default function ReconciliationPage() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const navigate = useNavigate();
  const { showError } = useToast();
  const latest = useRef(0);
  const [params, setParams] = useSearchParams();
  const [view, setViewState] = useState(() => {
    const f = params.get('filter');
    return FILTER_VIEWS[f] || 'todo';
  });
  const filter = FILTER_KEYS.includes(params.get('filter')) ? params.get('filter') : null;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [linkCredit, setLinkCredit] = useState(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [sharesItem, setSharesItem] = useState(null);
  const [penaltyItem, setPenaltyItem] = useState(null);
  const [dismissedAuto, setDismissedAuto] = useState(null);

  const setView = useCallback((next) => {
    setViewState(next);
    setParams({}, { replace: true });
  }, [setParams]);
  const toggleFilter = (counter) => {
    if (filter === counter.key) { setParams({}, { replace: true }); return; }
    setViewState(counter.view);
    setParams({ filter: counter.key }, { replace: true });
  };
  const clearFilter = useCallback(() => setParams({}, { replace: true }), [setParams]);

  const load = useCallback(async (which, narrow) => {
    latest.current += 1;
    const ticket = latest.current;
    try {
      const answer = await api.getReconciliation(which, narrow);
      if (ticket === latest.current) { setData(answer); setError(null); }
    } catch (err) {
      if (ticket === latest.current) { setData(null); setError(err); }
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => { setLoading(true); setData(null); load(view, filter); }, [view, filter, load]);
  const reload = useCallback(() => load(view, filter), [load, view, filter]);
  const actions = useReconciliationActions({ onChanged: reload });

  const refresh = async () => {
    setReading(true);
    try {
      setData(await api.readReconciliation(view, filter));
      setError(null);
    } catch (err) {
      if (err && err.code === 'READ_TOO_SOON') await load(view, filter); else setError(err);
    } finally {
      setReading(false);
    }
  };

  const submitLink = async (pairs) => {
    const ok = await actions.linkBatch('manual', pairs);
    if (ok) setLinkCredit(null);
  };
  const submitShares = async ({ pairs, proposalId }) => {
    const ok = await actions.linkBatch(sharesItem.key, pairs, proposalId);
    if (ok) setSharesItem(null);
  };
  const showAutomatic = () => {
    setViewState('done');
    setParams({ filter: 'auto' }, { replace: true });
  };
  const confirmAll = async (payload) => {
    const answer = await actions.confirmAll(payload);
    if (answer) setBulkOpen(false);
  };

  const openFiche = (item) => navigate(`/reservations/${item.reservation.id}`);

  const hasProposals = Boolean(data && data.bulk && data.bulk.count + data.bulk.toVerify.count > 0);
  const bar = (
    <PageActionBar
      title="Rapprochement bancaire"
      subtitle={data ? (
        <Typography variant="caption" color={data.lastError ? 'error.main' : 'text.secondary'}>
          {readFailureLabel(data.lastError) || lastReadLabel(data.lastReadAt)}
        </Typography>
      ) : null}
      actionsBefore={[
        { icon: <SyncIcon />, tooltip: 'Actualiser', onClick: refresh, color: 'info', disabled: reading || !data },
        ...(hasProposals ? [{ icon: <DoneAllIcon />, tooltip: 'Tout confirmer', onClick: () => setBulkOpen(true), color: 'success' }] : []),
      ]}
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
      {data.autoConfirmed && data.autoConfirmed.count > 0 && dismissedAuto !== data.autoConfirmed.at && (
        <Stack direction="row" gap={1} sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1.5, px: 1.5, py: 0.5, borderRadius: 1.5, bgcolor: 'info.soft', color: 'info.text' }}>
          <Typography variant="body2">
            {data.autoConfirmed.count} rapprochement{data.autoConfirmed.count > 1 ? 's' : ''} automatique{data.autoConfirmed.count > 1 ? 's' : ''}
          </Typography>
          <Button size="small" color="inherit" onClick={showAutomatic} sx={{ textTransform: 'none', minHeight: 44, fontWeight: 600 }}>Voir</Button>
          <Button size="small" color="inherit" onClick={() => setDismissedAuto(data.autoConfirmed.at)} sx={{ textTransform: 'none', minHeight: 44 }} aria-label="Fermer l'information">Fermer</Button>
        </Stack>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 1.25, mb: 1.5 }}>
        {COUNTERS.map((c) => {
          const pressed = filter === c.key;
          return (
            <Box
              key={c.key} component="button" type="button" onClick={() => toggleFilter(c)} aria-pressed={pressed}
              sx={{
                textAlign: 'left', font: 'inherit', cursor: 'pointer', bgcolor: pressed ? 'action.selected' : 'background.paper', border: 1,
                borderColor: pressed ? 'primary.main' : 'divider', boxShadow: pressed ? (t) => `0 0 0 1px ${t.palette.primary.main}` : 'none',
                borderRadius: 1.5, p: 1.25, minHeight: 44,
              }}
            >
              <Typography variant="caption" color="text.secondary" component="div">{c.label}</Typography>
              <Typography sx={{ fontSize: 24, fontWeight: 700, color: c.color, fontVariantNumeric: 'tabular-nums' }}>{counts[c.key]}</Typography>
            </Box>
          );
        })}
      </Box>
      {filter && (
        <Box sx={{ mb: 1.5 }}>
          <FilterChip label={FILTER_LABELS[filter]} count={counts[filter]} onClear={clearFilter} clearLabel="Retirer le filtre" />
        </Box>
      )}

      <PageTabs
        variant="card" value={view} onChange={setView} ariaLabel="Vues du rapprochement"
        items={TABS.map((t) => ({ value: t.view, label: `${t.label} ${t.count(counts)}` }))}
      />

      {empty ? (
        <EmptyState
          message={filter ? FILTER_EMPTY[filter] : (view === 'todo' ? 'Rien à traiter : chaque échéance est rapprochée ou attendue.' : 'Aucune ligne ici.')}
          actionLabel={filter ? 'Retirer le filtre' : undefined} onAction={filter ? clearFilter : undefined}
        />
      ) : (
        <>
          {items.length > 0 && (isMobile ? (
            <Box sx={{ bgcolor: 'background.paper', borderRadius: 2, px: 1.5 }}>
              {items.map((item) => (
                <ReconciliationLine
                  key={item.key} item={item} showReservation busy={actions.busy === item.key}
                  onConfirm={actions.confirm} onDiscard={actions.discard} onUndo={actions.undo} onShares={setSharesItem} onDeclarePenalty={setPenaltyItem} onOpenFiche={openFiche}
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
                  const busy = actions.busy === item.key;
                  return (
                    <TableRow key={item.key} hover>
                      <TableCell>
                        {item.reservation.clientName || '—'} <PlatformChip platform={item.reservation.platform} sx={{ ml: 0.5 }} />
                        <Typography variant="caption" color="text.secondary" component="div">{item.reservation.propertyName}</Typography>
                      </TableCell>
                      <TableCell>{item.label}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{money(item.expectedCents)}</TableCell>
                      <TableCell><BankCell item={item} /></TableCell>
                      <TableCell>
                        <StatusBadge status={item.tone} label={item.stateLabel} />
                        {item.proposal && <Typography variant="caption" color="text.secondary" component="div">{item.proposal.confidenceLabel}</Typography>}
                        {item.fixText && <Typography variant="caption" color="text.secondary" component="div" sx={{ maxWidth: 260 }}>{item.fixText}</Typography>}
                      </TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        {item.proposal && <Button size="small" variant="contained" disabled={busy} onClick={() => (item.proposal.needsShares ? setSharesItem(item) : actions.confirm(item))} sx={{ mr: 0.5, textTransform: 'none' }}>{item.proposal.needsShares ? 'Répartir et confirmer' : 'Confirmer'}</Button>}
                        {item.proposal && <Button size="small" color="inherit" disabled={busy} onClick={() => actions.discard(item)} sx={{ textTransform: 'none' }}>Écarter</Button>}
                        {item.canUndo && <Button size="small" color="inherit" disabled={busy} onClick={() => actions.undo(item)} sx={{ textTransform: 'none' }}>Défaire</Button>}
                        {item.declarePenalty && <Button size="small" variant="outlined" onClick={() => setPenaltyItem(item)} sx={{ ml: 0.5, minHeight: 44, textTransform: 'none' }}>Déclarer une pénalité de {money(item.declarePenalty.amountCents)}</Button>}
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
                      {credit.status !== 'outside' && <Button variant="outlined" disabled={busy} onClick={() => setLinkCredit(credit)} sx={{ minHeight: 44, textTransform: 'none' }}>Rattacher à des fiches</Button>}
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

      {linkCredit && (
        <LinkTransactionDialog open onClose={() => setLinkCredit(null)} credit={linkCredit} busy={actions.busy === 'manual'} onSubmit={submitLink} />
      )}
      {penaltyItem && (
        <PlatformPenaltyDialog
          open onClose={() => setPenaltyItem(null)} reservationId={penaltyItem.reservation.id} source="reconciliation"
          initialAmount={penaltyItem.declarePenalty.amount} onDone={reload}
        />
      )}
      <SplitSharesDialog
        open={Boolean(sharesItem)} onClose={() => setSharesItem(null)} proposal={sharesItem ? sharesItem.proposal : null}
        labels={sharesItem ? shareLabels(sharesItem) : {}} busy={Boolean(sharesItem) && actions.busy === sharesItem.key} onSubmit={submitShares}
      />
      <BulkConfirmDialog open={bulkOpen} onClose={() => setBulkOpen(false)} bulk={data.bulk} busy={actions.busy === 'bulk'} onConfirm={confirmAll} />
    </>
  );
}
